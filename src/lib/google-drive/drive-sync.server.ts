/**
 * Fase 8D — motor CRM -> Drive.
 *
 * Dos mitades bien separadas:
 *
 *   PRODUCTORES: se invocan desde el CRM después de que la operación
 *   primaria (crear cliente, subir documento, renombrar, borrar) haya
 *   terminado con éxito. Solo encolan trabajo. NUNCA llaman a Google.
 *
 *   WORKERS: los ejecuta el procesador de la cola. Son los únicos que hablan
 *   con Drive.
 *
 * ── REGLA FUNDAMENTAL ────────────────────────────────────────────────────
 * Google Drive es una integración SECUNDARIA. Que Drive esté caído, mal
 * configurado o desconectado jamás puede convertir en fallo una operación
 * del CRM que ya se completó correctamente. Un PDF guardado en Supabase
 * Storage está guardado, aunque su copia en Drive quede pendiente. Por eso
 * los productores devuelven un resultado descriptivo (`queued: false` con
 * un motivo) en vez de lanzar, y por eso el CRM nunca hace rollback de un
 * documento porque Google falló.
 *
 * ── CONSISTENCIA EVENTUAL ────────────────────────────────────────────────
 * Los productores son best-effort a propósito: no se mete a Google dentro de
 * la transacción del CRM, y tampoco se usan triggers de base de datos que
 * pudieran bloquear una inserción en `documents`. La consecuencia asumida es
 * que un encolado puntual puede perderse (el navegador se cierra entre el
 * guardado y la llamada al productor, la red del cliente falla, un
 * importador inserta documentos por otra vía). Eso NO se intenta resolver
 * aquí. La Fase 8F añadirá un barrido de reconciliación que encuentre
 * clientes sin carpeta, documentos sin mapping y mappings desactualizados, y
 * repare los eventos perdidos.
 */
import { resolveClientPermissions, resolveDocumentPermissions } from "@/lib/permissions";
import { matchClientToFolders } from "./client-folder-matching";
import { normalizeClientName } from "@/lib/zip-import/client-normalizer";
import { DriveError } from "./drive-errors";
import {
  buildDriveClientFolderAppProperties,
  buildDriveDocumentAppProperties,
  classifyAppPropertiesOwnership,
  matchesClientFolderIdentity,
  matchesDocumentIdentity,
} from "./drive-app-properties";
import {
  classifyUnsupportedDriveEntry,
  createDriveFileWithContent,
  createDriveFolder,
  downloadDriveFileBounded,
  DriveDownloadSizeMismatchError,
  DriveDownloadStreamUnavailableError,
  DriveDownloadTooLargeError,
  driveFileMetadataUnchanged,
  generateDriveIds,
  getDriveFile,
  getDriveFileMetadata,
  isDriveHttpError,
  isRetryableDriveFailure,
  parseDriveDeclaredSize,
  renameDriveFile,
  trashDriveFile,
  type DriveFileResource,
} from "./drive-files";
import { DRIVE_FOLDER_MIME_TYPE, listChildDriveFolders } from "./drive-folders";
import {
  formatDocumentSizeLabel,
  md5Hex,
  readDocumentContent,
  sha256Hex,
  writeDocumentToStorageIdempotent,
} from "./drive-storage.server";
import {
  accessTokenForDrive,
  activeDriveConnection,
  adminClient,
  isGoogleDriveConfigured,
  requireActiveActor,
  type DriveConnection,
} from "./google-drive.server";
import { MAX_DOCUMENT_SIZE_BYTES, validateDocumentFile } from "@/hooks/use-documents";

// ── constantes ───────────────────────────────────────────────────────────

/**
 * Margen antes de intentar mover a la papelera. El productor encola el
 * trabajo ANTES de que el CRM ejecute el borrado, así que hay que darle
 * tiempo a que ese borrado ocurra (o falle). No se usa ningún `sleep`: el
 * margen se expresa en `available_at`, así que el worker sencillamente no ve
 * el trabajo hasta que toca.
 */
export const GOOGLE_DRIVE_TRASH_GRACE_MS = 45 * 1000;

/** Reintentos por operación antes de darla por fallida. */
export const GOOGLE_DRIVE_MAX_ATTEMPTS = 5;

/**
 * Backoff acotado y deliberadamente simple: 30 s, 2 min, 5 min, 15 min,
 * 30 min. No hace falta nada más sofisticado para una cola cuyo volumen es
 * el de un estudio jurídico, y un algoritmo complejo sería más difícil de
 * razonar cuando algo va mal.
 */
const RETRY_DELAYS_MS = [30_000, 120_000, 300_000, 900_000, 1_800_000];

export function driveRetryDelayMs(attempt: number): number {
  const index = Math.min(Math.max(attempt, 1), RETRY_DELAYS_MS.length) - 1;
  return RETRY_DELAYS_MS[index];
}

export type DriveSyncSkipReason =
  | "not_configured"
  | "not_connected"
  | "root_not_configured"
  | "no_client"
  | "no_mapping"
  | "already_synced";

export interface ProducerResult {
  queued: boolean;
  reason?: DriveSyncSkipReason;
  operation?: string;
}

// ── contexto de conexión ─────────────────────────────────────────────────
interface DriveContext {
  connection: DriveConnection;
  rootFolderId: string;
}

/**
 * Resuelve la conexión utilizable. Devuelve un motivo en vez de lanzar: para
 * un productor, "Drive no está listo" es un no-op honesto, no un error que
 * deba propagarse al usuario que acaba de guardar un documento.
 */
async function resolveDriveContext(): Promise<
  { ok: true; context: DriveContext } | { ok: false; reason: DriveSyncSkipReason }
> {
  if (!isGoogleDriveConfigured()) return { ok: false, reason: "not_configured" };
  const connection = await activeDriveConnection();
  if (!connection || connection.status !== "connected") {
    return { ok: false, reason: "not_connected" };
  }
  if (!connection.root_folder_id) return { ok: false, reason: "root_not_configured" };
  return { ok: true, context: { connection, rootFolderId: connection.root_folder_id } };
}

function driveScope(connection: DriveConnection) {
  return { sharedDriveId: connection.shared_drive_id };
}

// ── claves de dedupe ─────────────────────────────────────────────────────
// La clave identifica la operación LÓGICA, no la petición: si el usuario
// guarda dos veces seguidas, la segunda encuentra la primera todavía
// pendiente y no crea trabajo duplicado (índice único parcial de Fase 8B).
export function driveDedupeKey(operation: string, connectionId: string, entityId: string): string {
  return `${operation}:${connectionId}:${entityId}`;
}

interface EnqueueInput {
  connectionId: string;
  operation: string;
  dedupeKey: string;
  clientId?: string | null;
  documentId?: string | null;
  driveFileId?: string | null;
  availableAt?: Date;
}

async function enqueue(input: EnqueueInput): Promise<boolean> {
  const db = adminClient();
  const { error } = await db.from("google_drive_sync_queue").insert({
    connection_id: input.connectionId,
    operation: input.operation,
    dedupe_key: input.dedupeKey,
    client_id: input.clientId ?? null,
    document_id: input.documentId ?? null,
    drive_file_id: input.driveFileId ?? null,
    available_at: (input.availableAt ?? new Date()).toISOString(),
  });
  // 23505 = ya existe una operación equivalente pending/processing. No es un
  // error: es el dedupe funcionando.
  if (error && error.code !== "23505") throw new Error(error.message);
  return true;
}

// ── PRODUCTOR: cliente nuevo -> asegurar carpeta ─────────────────────────
/**
 * Se llama tras crear un Cliente. Encola `ensure_client_folder`.
 *
 * No llama a Google: si Drive estuviera caído, la creación del Cliente ya
 * terminó y no debe verse afectada.
 */
export async function requestClientFolderSync(
  request: Request,
  rawClientId: unknown,
): Promise<ProducerResult> {
  const clientId = requireUuid(rawClientId, "cliente");
  const { role } = await requireActiveActor(request);
  // Mismo permiso que gobierna crear/editar clientes en el CRM.
  if (!resolveClientPermissions(role).canCreateClients) {
    throw new Error("No tienes permiso para realizar esta acción.");
  }

  const resolved = await resolveDriveContext();
  if (!resolved.ok) return { queued: false, reason: resolved.reason };
  const { connection } = resolved.context;

  const db = adminClient();
  const { data: existing } = await db
    .from("google_drive_client_folders")
    .select("sync_status")
    .eq("client_id", clientId)
    .maybeSingle();
  if (existing?.sync_status === "synced") return { queued: false, reason: "already_synced" };

  await enqueue({
    connectionId: connection.id,
    operation: "ensure_client_folder",
    dedupeKey: driveDedupeKey("ensure_client_folder", connection.id, clientId),
    clientId,
  });
  return { queued: true, operation: "ensure_client_folder" };
}

// ── PRODUCTOR: documento creado o renombrado ─────────────────────────────
/**
 * Se llama tras guardar un documento (alta o cambio de nombre). El servidor
 * decide qué operación corresponde -- el navegador solo envía el ID del
 * documento y nunca ve ningún identificador de Drive.
 */
export async function requestDocumentSync(
  request: Request,
  rawDocumentId: unknown,
): Promise<ProducerResult> {
  const documentId = requireUuid(rawDocumentId, "documento");
  const { role } = await requireActiveActor(request);
  if (!resolveDocumentPermissions(role).canUploadDocuments) {
    throw new Error("No tienes permiso para realizar esta acción.");
  }

  const resolved = await resolveDriveContext();
  if (!resolved.ok) return { queued: false, reason: resolved.reason };
  const { connection } = resolved.context;

  const db = adminClient();
  const { data: document } = await db
    .from("documents")
    .select("id, name, client_id")
    .eq("id", documentId)
    .maybeSingle();
  if (!document) throw new Error("El documento indicado ya no existe.");
  // Un documento sin cliente no tiene carpeta de destino. No es un error:
  // simplemente no se sincroniza (Drive se organiza por Cliente).
  if (!document.client_id) return { queued: false, reason: "no_client" };

  const { data: mapping } = await db
    .from("google_drive_document_files")
    .select("drive_file_id, last_synced_file_name, sync_status")
    .eq("document_id", documentId)
    .maybeSingle();

  // Sin mapping todavía: hay que subirlo. Si además falta la carpeta del
  // cliente, se encola primero su creación -- el worker de subida esperará.
  if (!mapping) {
    const { data: folder } = await db
      .from("google_drive_client_folders")
      .select("sync_status")
      .eq("client_id", document.client_id)
      .maybeSingle();
    if (folder?.sync_status !== "synced") {
      await enqueue({
        connectionId: connection.id,
        operation: "ensure_client_folder",
        dedupeKey: driveDedupeKey("ensure_client_folder", connection.id, document.client_id),
        clientId: document.client_id,
      });
    }
    await enqueue({
      connectionId: connection.id,
      operation: "upload_document",
      dedupeKey: driveDedupeKey("upload_document", connection.id, documentId),
      clientId: document.client_id,
      documentId,
    });
    return { queued: true, operation: "upload_document" };
  }

  // Ya existe copia en Drive: lo único que esta fase puede propagar es el
  // cambio de nombre. El CRM todavía no ofrece reemplazar el CONTENIDO de un
  // documento, así que no hay nada más que sincronizar.
  if (mapping.last_synced_file_name !== document.name) {
    await enqueue({
      connectionId: connection.id,
      operation: "rename_document",
      dedupeKey: driveDedupeKey("rename_document", connection.id, documentId),
      clientId: document.client_id,
      documentId,
      driveFileId: mapping.drive_file_id,
    });
    return { queued: true, operation: "rename_document" };
  }

  return { queued: false, reason: "already_synced" };
}

// ── PRODUCTOR: preparar papelera antes de borrar ─────────────────────────
/**
 * Se llama ANTES de que el CRM borre el documento, y encola el trabajo con
 * un margen (`available_at` en el futuro). El worker comprobará después si
 * el borrado realmente ocurrió; ver la nota de seguridad en
 * `handleTrashDocument`.
 *
 * Exige el permiso REAL de eliminar documentos, no uno genérico: encolar la
 * papelera es, en la práctica, pedir que se retire la copia en Drive.
 */
export async function prepareDocumentTrash(
  request: Request,
  rawDocumentId: unknown,
): Promise<ProducerResult> {
  const documentId = requireUuid(rawDocumentId, "documento");
  const { role } = await requireActiveActor(request);
  if (!resolveDocumentPermissions(role).canDeleteDocuments) {
    throw new Error("No tienes permiso para eliminar documentos.");
  }

  const resolved = await resolveDriveContext();
  if (!resolved.ok) return { queued: false, reason: resolved.reason };
  const { connection } = resolved.context;

  const db = adminClient();
  const { data: mapping } = await db
    .from("google_drive_document_files")
    .select("drive_file_id")
    .eq("document_id", documentId)
    .maybeSingle();
  if (!mapping) return { queued: false, reason: "no_mapping" };

  await enqueue({
    connectionId: connection.id,
    operation: "trash_document",
    // La clave usa el ID de Drive, no el del documento: cuando el documento
    // se borre, su ID desaparecerá de la fila, pero la operación lógica
    // sigue siendo la misma.
    dedupeKey: driveDedupeKey("trash_document", connection.id, mapping.drive_file_id),
    documentId,
    driveFileId: mapping.drive_file_id,
    availableAt: new Date(Date.now() + GOOGLE_DRIVE_TRASH_GRACE_MS),
  });
  return { queued: true, operation: "trash_document" };
}

function requireUuid(value: unknown, label: string): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) throw new Error(`Falta el identificador de ${label}.`);
  return id;
}

// ── PRODUCTOR (server-only): archivo descubierto en Drive -> CRM ─────────
export interface EnqueueImportInput {
  connectionId: string;
  driveFileId: string;
}

/**
 * Encola la importación de un archivo de Drive a documento del CRM.
 *
 * SERVER-ONLY a propósito (Fase 8E Sección 3): no existe ningún endpoint
 * HTTP que acepte un `driveFileId` escrito por el navegador. Convertir esto
 * en una API administrativa general sería, en la práctica, un proxy para
 * importar cualquier archivo cuyo ID alguien conociera. Quien puede llamar
 * a esta función es exclusivamente código de servidor de confianza: hoy,
 * los propios tests; en Fase 8F, el consumidor de `changes.list`.
 *
 * No recibe `clientId`: el worker lo resuelve desde el padre REAL del
 * archivo en Drive en el momento de procesar el trabajo, nunca de un valor
 * que el llamante ya hubiera adivinado (Fase 8E Sección 35) -- Drive pudo
 * cambiar entre que algo detectó este archivo y que el worker lo procesa.
 */
export async function enqueueGoogleDriveImportFile(input: EnqueueImportInput): Promise<boolean> {
  return enqueue({
    connectionId: input.connectionId,
    operation: "import_drive_file",
    dedupeKey: driveDedupeKey("import_drive_file", input.connectionId, input.driveFileId),
    driveFileId: input.driveFileId,
  });
}

// ── WORKERS ──────────────────────────────────────────────────────────────

export interface QueueJob {
  id: number;
  operation: string;
  connection_id: string;
  client_id: string | null;
  document_id: string | null;
  drive_file_id: string | null;
  attempt_count: number;
  /**
   * Reserva durable del trabajo (Fase 8E Sección 22). `import_drive_file`
   * la usa para persistir `target_document_id`/`storage_path` la primera
   * vez que se procesa, y reutilizarlos en cualquier reintento -- así un
   * crash entre "subí a Storage" y "finalicé en la base de datos" no genera
   * un segundo UUID ni un segundo blob.
   */
  payload: Record<string, unknown>;
}

type JobOutcome =
  | { status: "completed" }
  | { status: "retry"; reason: string }
  | { status: "failed"; reason: string };

// ── ensure_client_folder ─────────────────────────────────────────────────
/**
 * Garantiza que el Cliente tenga carpeta en Drive, sin crear duplicados
 * nunca.
 *
 * El punto delicado es el paso 3: antes de crear una carpeta se mira si ya
 * existe una con ese nombre bajo la raíz. Un estudio que lleva años
 * organizando carpetas a mano casi seguro ya tiene "Juan Pérez"; crear otra
 * automáticamente produciría "Juan Pérez" y "Juan Perez" conviviendo, con
 * los documentos repartidos entre las dos. Ante cualquier candidata se para
 * y se pide revisión humana (el onboarding de 8C), que es exactamente la
 * herramienta para eso.
 */
async function handleEnsureClientFolder(
  job: QueueJob,
  context: DriveContext,
  accessToken: string,
): Promise<JobOutcome> {
  if (!job.client_id) return { status: "failed", reason: "MISSING_CLIENT" };
  const db = adminClient();
  const { connection, rootFolderId } = context;

  const { data: client } = await db
    .from("clients")
    .select("id, name")
    .eq("id", job.client_id)
    .maybeSingle();
  if (!client) return { status: "failed", reason: "CLIENT_NOT_FOUND" };

  const { data: mapping } = await db
    .from("google_drive_client_folders")
    .select("drive_folder_id, sync_status")
    .eq("client_id", job.client_id)
    .maybeSingle();

  // 1. Ya sincronizada: nada que hacer.
  if (mapping?.sync_status === "synced") return { status: "completed" };

  // 2. Reserva previa (pending/error): reconciliar ESE ID antes que nada.
  //    Puede que el create anterior sí llegara a Google y solo perdiéramos
  //    la respuesta. IMPORTANTE: esto ocurre ANTES de la comprobación de
  //    colisión de nombres de abajo, a propósito -- que aparezca un Cliente
  //    homónimo después de que este ya tuviera una reserva no debe bloquear
  //    su reconciliación. La colisión solo importa para decidir si es seguro
  //    CREAR una reserva nueva, nunca para abandonar una ya existente.
  if (mapping?.drive_folder_id) {
    return finalizeClientFolder(
      job.client_id,
      mapping.drive_folder_id,
      client.name,
      context,
      accessToken,
    );
  }

  // 3. Sin mapping todavía: ¿existe otro Cliente del CRM cuyo nombre
  //    normaliza igual? (Fase 8D.1)
  //
  //    La reserva por client_id (RPC + UNIQUE) ya protege contra dos
  //    workers procesando el MISMO Cliente a la vez, pero no protege contra
  //    dos Clientes DISTINTOS -- "Juan Pérez" y "JUAN PEREZ" -- que
  //    normalizarían a la misma carpeta. Auto-crear en ese caso podría
  //    terminar mezclando los documentos de dos personas distintas bajo una
  //    sola carpeta, o crear dos carpetas casi idénticas. Ninguna opción es
  //    segura sin que una persona decida. Se usa exactamente
  //    normalizeClientName, la misma normalización que ya gobierna el
  //    matching de 8A -- no una tercera regla.
  //
  //    No hace falta serializar esta comprobación: los dos Clientes ya
  //    existen en la tabla `clients` desde antes de que cualquiera de sus
  //    trabajos de `ensure_client_folder` se procese (la creación del
  //    Cliente es síncrona y termina antes de encolar), así que el orden en
  //    que se procesen los dos trabajos no cambia el resultado -- cada uno
  //    encontrará al otro.
  const normalizedCurrentName = normalizeClientName(client.name);
  const { data: otherClients } = await db
    .from("clients")
    .select("id, name")
    .neq("id", job.client_id);
  const hasHomonym = (otherClients ?? []).some(
    (other) => normalizeClientName(other.name) === normalizedCurrentName,
  );
  if (hasHomonym) {
    return { status: "failed", reason: "CLIENT_NAME_REVIEW_REQUIRED" };
  }

  // 4. Sin mapping y sin homónimos: ¿existe ya una carpeta con ese nombre
  //    creada a mano?
  const folders = await listChildDriveFolders(accessToken, rootFolderId, driveScope(connection));
  const match = matchClientToFolders(
    client.name,
    folders.map((folder) => ({ id: folder.id, name: folder.name })),
  );
  if (match.type !== "NO_MATCH") {
    return { status: "failed", reason: "CLIENT_FOLDER_REVIEW_REQUIRED" };
  }

  // 5. Ninguna candidata: reservar ID y crear.
  const [reservedId] = await generateDriveIds(accessToken, 1);
  const { data: reservation, error: reserveError } = await db.rpc(
    "reserve_google_drive_created_client_folder",
    {
      p_connection_id: connection.id,
      p_expected_root_folder_id: rootFolderId,
      p_client_id: job.client_id,
      p_reserved_folder_id: reservedId,
      p_folder_name: client.name,
      p_linked_by: connection.connected_by,
    },
  );
  if (reserveError) {
    return { status: "retry", reason: sanitizeReason(reserveError.message) };
  }
  const reserved = (reservation ?? {}) as { driveFolderId?: string };
  const folderId = reserved.driveFolderId ?? reservedId;

  return finalizeClientFolder(job.client_id, folderId, client.name, context, accessToken);
}

/**
 * Crea la carpeta con el ID reservado y cierra el mapping. Si Google
 * responde 409 el ID ya existe: se comprueba si es NUESTRA carpeta y, si lo
 * es, se trata como éxito idempotente. Si el ID pertenece a otra cosa se
 * para en seco -- crear "otra carpeta" en ese punto sería precisamente el
 * duplicado que todo este mecanismo evita.
 */
async function finalizeClientFolder(
  clientId: string,
  folderId: string,
  clientName: string,
  context: DriveContext,
  accessToken: string,
): Promise<JobOutcome> {
  const db = adminClient();
  const { connection, rootFolderId } = context;
  const appProperties = buildDriveClientFolderAppProperties(clientId);

  let folder: DriveFileResource | null = null;
  try {
    folder = await createDriveFolder(
      accessToken,
      { id: folderId, name: clientName, parentId: rootFolderId, appProperties },
      driveScope(connection),
    );
  } catch (cause) {
    if (isDriveHttpError(cause) && cause.status === 409) {
      folder = await getDriveFile(accessToken, folderId, driveScope(connection));
      const isOurs =
        folder &&
        !folder.trashed &&
        folder.parents?.includes(rootFolderId) &&
        matchesClientFolderIdentity(folder.appProperties, clientId);
      if (!isOurs) {
        await markClientFolderError(db, clientId, folderId, "DRIVE_IDENTITY_CONFLICT");
        return { status: "failed", reason: "DRIVE_IDENTITY_CONFLICT" };
      }
    } else {
      const reason = sanitizeReason(String((cause as Error)?.message ?? "drive_error"));
      await markClientFolderError(db, clientId, folderId, reason);
      return isRetryableDriveFailure(cause)
        ? { status: "retry", reason }
        : { status: "failed", reason };
    }
  }

  const { error } = await db.rpc("finalize_google_drive_client_folder", {
    p_client_id: clientId,
    p_drive_folder_id: folderId,
    p_folder_name: folder?.name ?? clientName,
    p_sync_error: null,
  });
  if (error) return { status: "retry", reason: sanitizeReason(error.message) };
  return { status: "completed" };
}

async function markClientFolderError(
  db: ReturnType<typeof adminClient>,
  clientId: string,
  folderId: string,
  reason: string,
) {
  // La reserva NO se borra: conservar el drive_folder_id reservado es lo que
  // permite reconciliar en el siguiente intento en vez de crear otra carpeta.
  await db
    .rpc("finalize_google_drive_client_folder", {
      p_client_id: clientId,
      p_drive_folder_id: folderId,
      p_folder_name: null,
      p_sync_error: reason,
    })
    .then(
      () => undefined,
      () => undefined,
    );
}

// ── upload_document ──────────────────────────────────────────────────────
async function handleUploadDocument(
  job: QueueJob,
  context: DriveContext,
  accessToken: string,
): Promise<JobOutcome> {
  if (!job.document_id) return { status: "failed", reason: "MISSING_DOCUMENT" };
  const db = adminClient();
  const { connection } = context;

  const { data: document } = await db
    .from("documents")
    .select("id, name, client_id, storage_path, mime_type, file_size")
    .eq("id", job.document_id)
    .maybeSingle();
  if (!document) return { status: "failed", reason: "DOCUMENT_NOT_FOUND" };
  if (!document.client_id) return { status: "failed", reason: "DOCUMENT_WITHOUT_CLIENT" };

  const { data: folder } = await db
    .from("google_drive_client_folders")
    .select("drive_folder_id, sync_status")
    .eq("client_id", document.client_id)
    .maybeSingle();

  // La carpeta quedó marcada para revisión humana: no se crea nada ni se
  // insiste. Cuando el Administrador la resuelva en el onboarding, este
  // trabajo se puede reencolar.
  if (folder?.sync_status === "error") {
    return { status: "failed", reason: "CLIENT_FOLDER_REVIEW_REQUIRED" };
  }
  // Todavía no está lista: reprogramar en vez de fallar.
  if (!folder || folder.sync_status !== "synced") {
    return { status: "retry", reason: "WAITING_CLIENT_FOLDER" };
  }

  const { data: existing } = await db
    .from("google_drive_document_files")
    .select("drive_file_id, sync_status")
    .eq("document_id", job.document_id)
    .maybeSingle();
  if (existing?.sync_status === "synced") return { status: "completed" };

  const content = await readDocumentContent(db as never, {
    name: document.name,
    storage_path: document.storage_path ?? "",
    mime_type: document.mime_type,
    file_size: document.file_size,
  });

  // Reutiliza el ID ya reservado si lo hay; solo pide uno nuevo la primera
  // vez. Ese es el invariante que impide dos copias del mismo documento.
  let fileId = existing?.drive_file_id ?? null;
  if (!fileId) {
    const [generated] = await generateDriveIds(accessToken, 1);
    const { data: reservation, error: reserveError } = await db.rpc(
      "reserve_google_drive_document_file",
      {
        p_connection_id: connection.id,
        p_document_id: job.document_id,
        p_reserved_file_id: generated,
        p_expected_parent_id: folder.drive_folder_id,
      },
    );
    if (reserveError) return { status: "retry", reason: sanitizeReason(reserveError.message) };
    fileId = ((reservation ?? {}) as { driveFileId?: string }).driveFileId ?? generated;
  }

  const appProperties = buildDriveDocumentAppProperties(job.document_id, document.client_id);
  let file: DriveFileResource | null = null;
  try {
    file = await createDriveFileWithContent(
      accessToken,
      {
        id: fileId,
        name: document.name,
        parentId: folder.drive_folder_id,
        mimeType: content.contentType,
        appProperties,
        content: content.bytes,
      },
      driveScope(connection),
    );
  } catch (cause) {
    if (isDriveHttpError(cause) && cause.status === 409) {
      // El intento anterior sí subió el archivo y perdimos la respuesta.
      file = await getDriveFile(accessToken, fileId, driveScope(connection));
      const isOurs =
        file &&
        !file.trashed &&
        matchesDocumentIdentity(file.appProperties, job.document_id, document.client_id);
      if (!isOurs) return { status: "failed", reason: "DRIVE_IDENTITY_CONFLICT" };
    } else {
      const reason = sanitizeReason(String((cause as Error)?.message ?? "drive_error"));
      return isRetryableDriveFailure(cause)
        ? { status: "retry", reason }
        : { status: "failed", reason };
    }
  }

  // Guarda universal, tanto para multipart como para resumable: una subida
  // resumable puede terminar sin confirmación (sesión perdida y el archivo
  // todavía no existe con el ID reservado). En ese caso NO se puede dar por
  // sincronizado -- se reprograma y el siguiente intento reutiliza el mismo
  // ID reservado.
  if (!file) return { status: "retry", reason: "UPLOAD_NOT_CONFIRMED" };
  // Y sea cual sea el camino por el que llegó la metadata, tiene que ser
  // nuestro archivo: mismo documento, mismo cliente, no en la papelera.
  if (
    file.trashed ||
    !matchesDocumentIdentity(file.appProperties, job.document_id, document.client_id)
  ) {
    return { status: "failed", reason: "DRIVE_IDENTITY_CONFLICT" };
  }

  const { error } = await db.rpc("finalize_google_drive_document_file", {
    p_document_id: job.document_id,
    p_drive_file_id: fileId,
    p_drive_parent_id: file?.parents?.[0] ?? folder.drive_folder_id,
    p_web_view_link: file?.webViewLink ?? null,
    p_drive_modified_time: file?.modifiedTime ?? null,
    p_drive_version: file?.version ? Number(file.version) : null,
    p_drive_md5: file?.md5Checksum ?? null,
    p_content_hash: content.contentHash,
    p_file_name: document.name,
    p_sync_error: null,
  });
  if (error) return { status: "retry", reason: sanitizeReason(error.message) };
  return { status: "completed" };
}

// ── rename_document ──────────────────────────────────────────────────────
async function handleRenameDocument(
  job: QueueJob,
  context: DriveContext,
  accessToken: string,
): Promise<JobOutcome> {
  if (!job.document_id) return { status: "failed", reason: "MISSING_DOCUMENT" };
  const db = adminClient();

  const { data: document } = await db
    .from("documents")
    .select("id, name")
    .eq("id", job.document_id)
    .maybeSingle();
  if (!document) return { status: "failed", reason: "DOCUMENT_NOT_FOUND" };

  const { data: mapping } = await db
    .from("google_drive_document_files")
    .select("drive_file_id, drive_parent_id, last_synced_file_name")
    .eq("document_id", job.document_id)
    .maybeSingle();
  if (!mapping) return { status: "failed", reason: "DOCUMENT_NOT_LINKED" };
  // Ya coincide: reintento de un trabajo que ya se aplicó.
  if (mapping.last_synced_file_name === document.name) return { status: "completed" };

  let file: DriveFileResource;
  try {
    file = await renameDriveFile(
      accessToken,
      mapping.drive_file_id,
      document.name,
      driveScope(context.connection),
    );
  } catch (cause) {
    const reason = sanitizeReason(String((cause as Error)?.message ?? "drive_error"));
    return isRetryableDriveFailure(cause)
      ? { status: "retry", reason }
      : { status: "failed", reason };
  }

  const { error } = await db.rpc("finalize_google_drive_document_file", {
    p_document_id: job.document_id,
    p_drive_file_id: mapping.drive_file_id,
    // El padre no se toca: renombrar nunca mueve el archivo de carpeta.
    p_drive_parent_id: mapping.drive_parent_id,
    p_web_view_link: file.webViewLink ?? null,
    p_drive_modified_time: file.modifiedTime ?? null,
    p_drive_version: file.version ? Number(file.version) : null,
    p_drive_md5: file.md5Checksum ?? null,
    // El contenido no cambió: se conserva el hash del último sync real.
    p_content_hash: null,
    p_file_name: document.name,
    p_sync_error: null,
  });
  if (error) return { status: "retry", reason: sanitizeReason(error.message) };
  return { status: "completed" };
}

// ── trash_document ───────────────────────────────────────────────────────
/**
 * Mueve a la papelera la copia en Drive de un documento borrado del CRM.
 *
 * SEGURIDAD: el trabajo se encoló ANTES del borrado, así que lo primero es
 * comprobar que el borrado realmente ocurrió. La señal es `document_id`: la
 * FK de la cola es ON DELETE SET NULL, así que borrar el documento pone ese
 * campo a NULL. Si sigue teniendo valor y el documento existe, el borrado no
 * se consumó (falló, o el usuario canceló) y la copia en Drive NO se toca.
 *
 * Tras agotar los reintentos sin que el documento desaparezca, el trabajo se
 * marca fallido con DOCUMENT_STILL_EXISTS. No se mueve nada a la papelera:
 * ante la duda, el archivo se queda.
 */
async function handleTrashDocument(
  job: QueueJob,
  context: DriveContext,
  accessToken: string,
): Promise<JobOutcome> {
  if (!job.drive_file_id) return { status: "failed", reason: "MISSING_DRIVE_FILE" };
  const db = adminClient();

  if (job.document_id) {
    const { data: stillThere } = await db
      .from("documents")
      .select("id")
      .eq("id", job.document_id)
      .maybeSingle();
    if (stillThere) {
      return job.attempt_count >= GOOGLE_DRIVE_MAX_ATTEMPTS
        ? { status: "failed", reason: "DOCUMENT_STILL_EXISTS" }
        : { status: "retry", reason: "DOCUMENT_STILL_EXISTS" };
    }
  }

  const file = await getDriveFile(accessToken, job.drive_file_id, driveScope(context.connection));
  // Ya no existe, o ya estaba en la papelera: éxito idempotente.
  if (!file || file.trashed) return { status: "completed" };

  try {
    await trashDriveFile(accessToken, job.drive_file_id, driveScope(context.connection));
  } catch (cause) {
    const reason = sanitizeReason(String((cause as Error)?.message ?? "drive_error"));
    return isRetryableDriveFailure(cause)
      ? { status: "retry", reason }
      : { status: "failed", reason };
  }
  return { status: "completed" };
}

// ── import_drive_file (Drive -> CRM, Fase 8E) ────────────────────────────
/**
 * Importa un archivo descubierto manualmente en Drive como un documento del
 * CRM.
 *
 * Nada en esta fase PRODUCE el trabajo que llega aquí -- ningún
 * `changes.list`, `changes.watch` ni reconciliación: eso es Fase 8F. Este
 * worker es el consumidor seguro que 8F invocará; hoy solo lo alimentan
 * `enqueueGoogleDriveImportFile` (server-only) y los propios tests.
 *
 * Algoritmo completo, en orden (cada paso puede terminar el trabajo):
 *   0. ¿Ya está mapeado por drive_file_id? -> no-op (Sección 38).
 *   1. Metadata M1.
 *   2. ¿Trashed? -> no importar.
 *   3. ¿Blob soportado? (no carpeta/atajo/nativo de Workspace).
 *   4. ¿appProperties ya indican que esto lo gestiona el CRM? (Sección 12).
 *   5. ¿canDownload?
 *   6. Preflight de tamaño con metadata.size (nunca definitivo).
 *   7. Resolver Cliente por el padre DIRECTO (Sección 7/15).
 *   8. Validar que esa carpeta de Cliente siga siendo real en Drive
 *      (Sección 16).
 *   9. Descargar bytes con tope real de bytes (Sección 19).
 *  10. Metadata M2 y comparación contra M1 (Sección 17).
 *  11. Verificar MD5 de Drive si existe; calcular SHA-256 propio.
 *  12. Revalidar con las MISMAS reglas que una subida manual (Sección 20).
 *  13. Reservar target_document_id + storage_path en el payload de la cola
 *      (una sola vez; los reintentos reutilizan lo ya reservado).
 *  14. Escribir en Storage de forma idempotente.
 *  15. Finalizar con la RPC atómica.
 */
async function handleImportDriveFile(
  job: QueueJob,
  context: DriveContext,
  accessToken: string,
): Promise<JobOutcome> {
  if (!job.drive_file_id) return { status: "failed", reason: "MISSING_DRIVE_FILE_ID" };
  const db = adminClient();
  const { connection, rootFolderId } = context;
  const scope = driveScope(connection);

  // 0. Ya mapeado -- no crear una segunda copia nunca (Sección 38).
  const { data: existingByFile } = await db
    .from("google_drive_document_files")
    .select("document_id")
    .eq("connection_id", connection.id)
    .eq("drive_file_id", job.drive_file_id)
    .maybeSingle();
  if (existingByFile) return { status: "completed" };

  // 1. Metadata M1.
  const m1 = await getDriveFileMetadata(accessToken, job.drive_file_id, scope);
  if (!m1) return { status: "failed", reason: "DRIVE_FILE_NOT_FOUND" };

  // 2. Trashed: no se importa un archivo que ya está en la papelera.
  if (m1.trashed) return { status: "failed", reason: "DRIVE_FILE_TRASHED" };

  // 3. Solo blob files (Sección 10/42). Nunca files.export en V1: convertir
  // un Doc nativo a DOCX/PDF automáticamente cambiaría su representación y
  // crearía una copia-snapshot fuera de nuestro control -- decisión
  // deliberadamente diferida a una fase futura con política explícita.
  const unsupported = classifyUnsupportedDriveEntry(m1.mimeType);
  if (unsupported) return { status: "failed", reason: unsupported };

  // 4. ¿Ya lo gestiona el CRM? (Sección 12 -- regla crítica). Un archivo con
  // appProperties.crm_entity="document" NUNCA es un documento inbound
  // nuevo: es una subida outbound existente, o el rastro de un documento
  // que el CRM ya borró (y entonces NO se resucita).
  const ownership = classifyAppPropertiesOwnership(m1.appProperties);
  if (ownership.kind === "conflict") {
    return { status: "failed", reason: "DRIVE_APP_PROPERTY_CONFLICT" };
  }
  if (ownership.kind === "known_document") {
    const { data: ownedDocument } = await db
      .from("documents")
      .select("id, client_id")
      .eq("id", ownership.documentId)
      .maybeSingle();
    if (!ownedDocument) {
      // Caso C: el documento ya no existe en el CRM. Puede ser exactamente
      // el rastro de un borrado cuyo prepare-trash se perdió (ver el
      // contrato de reconciliación en la documentación operativa). NUNCA
      // se reimporta: 0 Storage, 0 documents, 0 mapping.
      return { status: "failed", reason: "OUTBOUND_ORPHAN_REVIEW_REQUIRED" };
    }
    const { data: ownedMapping } = await db
      .from("google_drive_document_files")
      .select("drive_file_id")
      .eq("document_id", ownership.documentId)
      .maybeSingle();
    if (ownedMapping?.drive_file_id === job.drive_file_id) {
      // Caso A: ya gestionado, coincide. No-op.
      return { status: "completed" };
    }
    // Caso B: el documento existe pero el mapping no coincide (o falta).
    // 8F reconciliará; aquí nunca se crea un segundo documento.
    return { status: "failed", reason: "OUTBOUND_MAPPING_REPAIR_REQUIRED" };
  }

  // 5. canDownload.
  if (m1.capabilities?.canDownload !== true) {
    return { status: "failed", reason: "DRIVE_DOWNLOAD_NOT_ALLOWED" };
  }

  // 6. Preflight de tamaño OBLIGATORIO (Fase 8E.1 Sección 3). Un candidato a
  // blob sin `size` válido NUNCA procede a `alt=media`: el tope real de
  // bytes del paso 9 sigue acotando cualquier descarga que sí se intente,
  // pero eso no es excusa para lanzar una descarga cuyo tamaño declarado no
  // podemos siquiera confiar de antemano.
  const declaredSize = parseDriveDeclaredSize(m1.size, MAX_DOCUMENT_SIZE_BYTES);
  if (declaredSize.kind === "unknown") {
    return { status: "failed", reason: "DRIVE_FILE_SIZE_UNKNOWN" };
  }
  if (declaredSize.kind === "too_large") {
    return { status: "failed", reason: "DOCUMENT_TOO_LARGE" };
  }

  // 7. Resolver Cliente por el padre DIRECTO. Solo hijos directos de una
  // carpeta de Cliente vinculada son candidatos en V1 (Sección 7): una
  // subcarpeta interna ("Expediente 2025/demanda.pdf") NUNCA se interpreta
  // automáticamente, porque eso sería inferencia jurídica.
  const parents = m1.parents ?? [];
  const { data: candidateFolders } = parents.length
    ? await db
        .from("google_drive_client_folders")
        .select("client_id, drive_folder_id")
        .eq("connection_id", connection.id)
        .eq("sync_status", "synced")
        .in("drive_folder_id", parents)
    : { data: [] as Array<{ client_id: string; drive_folder_id: string }> };
  const matches = candidateFolders ?? [];
  if (matches.length === 0) return { status: "failed", reason: "DRIVE_PARENT_UNLINKED" };
  if (matches.length > 1) return { status: "failed", reason: "DRIVE_PARENT_AMBIGUOUS" };
  const { client_id: clientId, drive_folder_id: parentFolderId } = matches[0];

  // 8. La carpeta del Cliente pudo haberse movido externamente desde que se
  // vinculó. Se revalida en vivo: sigue siendo carpeta, no está en la
  // papelera, y su padre sigue siendo la raíz configurada (Sección 16 --
  // la misma regla que 8F usará para DRIVE_PARENT_MISMATCH).
  const folderMeta = await getDriveFile(accessToken, parentFolderId, scope);
  if (
    !folderMeta ||
    folderMeta.mimeType !== DRIVE_FOLDER_MIME_TYPE ||
    folderMeta.trashed ||
    !folderMeta.parents?.includes(rootFolderId)
  ) {
    return { status: "failed", reason: "DRIVE_PARENT_MISMATCH" };
  }

  // 9. Descarga con tope REAL de bytes -- nunca confiar solo en
  // metadata.size (Sección 19).
  let bytes: Uint8Array;
  try {
    bytes = await downloadDriveFileBounded(
      accessToken,
      job.drive_file_id,
      MAX_DOCUMENT_SIZE_BYTES,
      scope,
      declaredSize.bytes,
    );
  } catch (cause) {
    if (cause instanceof DriveDownloadTooLargeError) {
      return { status: "failed", reason: "DOCUMENT_TOO_LARGE" };
    }
    if (cause instanceof DriveDownloadStreamUnavailableError) {
      // Sin stream no hay forma segura de acotar: nunca se cae a
      // arrayBuffer(). Se trata como transitorio -- el siguiente intento
      // vuelve a pedir metadata fresca y a intentar la descarga en
      // streaming (Fase 8E.1 Sección 4).
      return { status: "retry", reason: "DRIVE_DOWNLOAD_STREAM_UNAVAILABLE" };
    }
    if (cause instanceof DriveDownloadSizeMismatchError) {
      // Los bytes reales no coinciden con metadata.size: la misma clase de
      // problema que M1/M2 detecta, visto más temprano (Sección 5).
      return { status: "retry", reason: "DRIVE_DOWNLOAD_SIZE_MISMATCH" };
    }
    const reason = sanitizeReason(String((cause as Error)?.message ?? "drive_error"));
    return isRetryableDriveFailure(cause)
      ? { status: "retry", reason }
      : { status: "failed", reason };
  }

  // 10. Drive es externo: puede cambiar entre "voy a descargar" y "ya
  // descargué" (Sección 17). Si M2 difiere de M1 en cualquier campo
  // relevante, NO se escribe nada -- se reintenta contra el estado actual.
  const m2 = await getDriveFileMetadata(accessToken, job.drive_file_id, scope);
  if (!m2 || !driveFileMetadataUnchanged(m1, m2)) {
    return { status: "retry", reason: "DRIVE_FILE_CHANGED_RETRY" };
  }

  // 11. Integridad: MD5 de Drive verifica la descarga; SHA-256 es el
  // baseline propio del CRM. Nunca se sustituye uno por otro (Sección 21).
  if (m2.md5Checksum && md5Hex(bytes) !== m2.md5Checksum) {
    return { status: "retry", reason: "DRIVE_DOWNLOAD_CHECKSUM_MISMATCH" };
  }
  const contentHash = await sha256Hex(bytes);

  // 12. Mismas reglas documentales que una subida manual -- ni una
  // allowlist paralela para Drive (Sección 20). Un archivo que una subida
  // manual equivalente rechazaría tampoco entra por aquí.
  try {
    validateDocumentFile({ name: m2.name, size: bytes.length, type: m2.mimeType ?? "" });
  } catch (cause) {
    return { status: "failed", reason: sanitizeReason(String((cause as Error)?.message ?? "")) };
  }

  // 13. Reserva durable (Sección 22/23): se persiste UNA sola vez en el
  // payload de la propia fila de la cola. Un reintento tras un crash lee
  // exactamente el mismo target_document_id y el mismo storage_path --
  // nunca genera un UUID nuevo ni cambia el path por un posible renombrado
  // de Drive detectado mientras tanto (eso ya habría disparado
  // DRIVE_FILE_CHANGED_RETRY en el paso 10 de ESTE intento).
  let targetDocumentId = job.payload?.target_document_id as string | undefined;
  let storagePath = job.payload?.storage_path as string | undefined;
  if (!targetDocumentId || !storagePath) {
    targetDocumentId = crypto.randomUUID();
    const safeName = m2.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    storagePath = `google-drive/${clientId}/${targetDocumentId}_${safeName}`;
    const { error: payloadError } = await db
      .from("google_drive_sync_queue")
      .update({ payload: { target_document_id: targetDocumentId, storage_path: storagePath } })
      .eq("id", job.id);
    if (payloadError) return { status: "retry", reason: sanitizeReason(payloadError.message) };
  }

  // 14. Storage: `upsert:false` siempre. Si el path reservado ya tiene un
  // objeto (crash previo entre Storage y la finalización en BD), se
  // reutiliza solo si el hash coincide -- nunca se sobrescribe en silencio
  // (Sección 24/25).
  let storageOutcome;
  try {
    storageOutcome = await writeDocumentToStorageIdempotent(
      db as never,
      storagePath,
      bytes,
      m2.mimeType ?? "application/octet-stream",
      contentHash,
    );
  } catch (cause) {
    return { status: "retry", reason: sanitizeReason(String((cause as Error)?.message ?? "")) };
  }
  if (storageOutcome.kind === "conflict") {
    return { status: "failed", reason: "STORAGE_IMPORT_IDENTITY_CONFLICT" };
  }

  // 15. Finalización atómica (documents + google_drive_document_files en
  // UNA transacción -- Sección 27/28).
  const { data, error } = await db.rpc("finalize_google_drive_import", {
    p_connection_id: connection.id,
    p_expected_root_folder_id: rootFolderId,
    p_client_id: clientId,
    p_target_document_id: targetDocumentId,
    p_drive_file_id: job.drive_file_id,
    p_drive_parent_id: parentFolderId,
    p_storage_path: storagePath,
    p_name: m2.name,
    p_mime_type: m2.mimeType ?? "application/octet-stream",
    p_size_label: formatDocumentSizeLabel(bytes.length),
    p_file_size: bytes.length,
    p_content_hash: contentHash,
    p_web_view_link: m2.webViewLink ?? null,
    p_drive_modified_time: m2.modifiedTime ?? null,
    p_drive_version: m2.version ? Number(m2.version) : null,
    p_drive_md5: m2.md5Checksum ?? null,
  });

  if (error) {
    const message = error.message;
    if (
      message.includes("DRIVE_FILE_ALREADY_IMPORTED") ||
      message.includes("IMPORT_IDENTITY_CONFLICT")
    ) {
      // Otro worker ganó la carrera de forma PERMANENTE (no es un error
      // transitorio/de BD, que en cambio debe conservar el blob para el
      // reintento -- Sección 17): nuestro target_document_id NUNCA llegó a
      // insertarse (la RPC es atómica), así que la reserva de Storage de
      // ESTE intento -- recién escrita o reutilizada de un crash previo por
      // igual, Sección 12 -- quedó huérfana. Se compensa best-effort, pero
      // solo tras confirmar contra la propia base de datos que ningún
      // documento la referencia (Sección 11/13): la condición de seguridad
      // nunca depende de si fuimos nosotros quienes la creamos.
      await cleanupOrphanedStorageObject(db, storagePath);
      // El archivo YA está importado (por otro worker): el objetivo de
      // sincronización está cumplido, no es un fallo que requiera revisión.
      return { status: "completed" };
    }
    if (message.includes("DRIVE_NOT_CONNECTED")) {
      return { status: "retry", reason: "DRIVE_NOT_CONNECTED" };
    }
    if (message.includes("DRIVE_ROOT_CHANGED_RETRY")) {
      return { status: "retry", reason: "DRIVE_ROOT_CHANGED_RETRY" };
    }
    if (message.includes("CLIENT_FOLDER_CHANGED_RETRY")) {
      return { status: "retry", reason: "CLIENT_FOLDER_CHANGED_RETRY" };
    }
    // Error de BD desconocido: nunca se propaga el texto crudo de
    // PostgreSQL, y el blob de Storage se conserva para el reintento.
    return { status: "retry", reason: sanitizeReason(message) };
  }

  void data;
  return { status: "completed" };
}

/**
 * Compensación de Storage para una reserva que perdió PERMANENTEMENTE la
 * carrera de finalización (Fase 8E.1 Sección 8-16).
 *
 * Nunca se borra a ciegas. Antes de intentar `remove`, se pregunta a la
 * propia base de datos si algún documento real ya referencia ese
 * `storage_path` -- da igual si fuimos nosotros quienes lo creamos en este
 * intento o si lo reutilizamos de un crash anterior (Sección 12): la única
 * garantía válida es "¿algo lo referencia ahora mismo?", nunca una bandera
 * derivada de qué hizo ESTE intento. Si hay cualquier referencia, no se
 * toca -- podría ser evidencia jurídica real de otro documento.
 *
 * El propio `remove` es best-effort: un fallo aquí no cambia el resultado
 * semántico de la finalización (el import ya terminó como `completed`
 * porque el objetivo -- que el archivo esté sincronizado -- está cumplido
 * por el ganador) ni se reintenta dentro de este worker. Puede quedar un
 * objeto huérfano ocasional; una reconciliación operativa futura (Fase 8F o
 * posterior) puede detectarlo, este worker no lo persigue indefinidamente.
 */
async function cleanupOrphanedStorageObject(
  db: ReturnType<typeof adminClient>,
  storagePath: string,
): Promise<void> {
  const { data: referencing } = await db
    .from("documents")
    .select("id")
    .eq("storage_path", storagePath)
    .maybeSingle();
  if (referencing) return;
  await db.storage
    .from("documents")
    .remove([storagePath])
    .catch(() => {});
}

// ── procesador ───────────────────────────────────────────────────────────
/** Nunca se propaga texto crudo de Google ni de PostgreSQL. */
function sanitizeReason(message: string): string {
  return message.replace(/\s+/g, " ").slice(0, 200);
}

/**
 * Procesa un lote de la cola.
 *
 * Solo despacha las operaciones CRM -> Drive de esta fase. `poll_changes` e
 * `import_drive_file` pertenecen a Drive -> CRM (Fases 8E/8F): si
 * apareciesen, se marcan como no implementadas SIN llamar a Google, en vez
 * de intentar algo a medias.
 */
export async function processGoogleDriveSyncQueue(limit = 10) {
  const db = adminClient();
  const { data: claimed, error } = await db.rpc("claim_google_drive_sync_operations", {
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  const jobs = (claimed ?? []) as QueueJob[];
  if (jobs.length === 0) return { processed: 0, completed: 0, retried: 0, failed: 0 };

  const resolved = await resolveDriveContext();
  if (!resolved.ok) {
    // Drive dejó de estar disponible entre el claim y el procesado: se
    // devuelven los trabajos a pending, no se marcan fallidos.
    for (const job of jobs) await requeue(db, job, "DRIVE_UNAVAILABLE");
    return { processed: jobs.length, completed: 0, retried: jobs.length, failed: 0 };
  }
  const context = resolved.context;
  const accessToken = await accessTokenForDrive(context.connection);

  let completed = 0;
  let retried = 0;
  let failed = 0;

  for (const job of jobs) {
    let outcome: JobOutcome;
    try {
      outcome = await dispatch(job, context, accessToken);
    } catch (cause) {
      const reason = sanitizeReason(String((cause as Error)?.message ?? "unexpected"));
      outcome = isRetryableDriveFailure(cause)
        ? { status: "retry", reason }
        : { status: "failed", reason };
    }

    if (outcome.status === "completed") {
      await db
        .from("google_drive_sync_queue")
        .update({ status: "completed", processed_at: new Date().toISOString() })
        .eq("id", job.id);
      completed += 1;
    } else if (outcome.status === "retry" && job.attempt_count < GOOGLE_DRIVE_MAX_ATTEMPTS) {
      await requeue(db, job, outcome.reason);
      retried += 1;
    } else {
      await db
        .from("google_drive_sync_queue")
        .update({
          status: "failed",
          last_error: outcome.reason,
          processed_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      failed += 1;
    }
  }

  return { processed: jobs.length, completed, retried, failed };
}

async function dispatch(
  job: QueueJob,
  context: DriveContext,
  accessToken: string,
): Promise<JobOutcome> {
  switch (job.operation) {
    case "ensure_client_folder":
      return handleEnsureClientFolder(job, context, accessToken);
    case "upload_document":
      return handleUploadDocument(job, context, accessToken);
    case "rename_document":
      return handleRenameDocument(job, context, accessToken);
    case "trash_document":
      return handleTrashDocument(job, context, accessToken);
    case "update_document":
      // El helper de Drive existe, pero el CRM todavía no permite reemplazar
      // el contenido de un documento, así que nada puede encolar esto.
      return { status: "failed", reason: "OPERATION_NOT_IMPLEMENTED" };
    case "import_drive_file":
      return handleImportDriveFile(job, context, accessToken);
    default:
      // poll_changes: descubrimiento automático Drive -> CRM, Fase 8F.
      return { status: "failed", reason: "OPERATION_NOT_IMPLEMENTED" };
  }
}

async function requeue(db: ReturnType<typeof adminClient>, job: QueueJob, reason: string) {
  await db
    .from("google_drive_sync_queue")
    .update({
      status: "pending",
      claimed_at: null,
      last_error: reason,
      available_at: new Date(Date.now() + driveRetryDelayMs(job.attempt_count)).toISOString(),
    })
    .eq("id", job.id);
}

// Se re-exporta para que las rutas no tengan que importar de dos módulos.
export { DriveError };
