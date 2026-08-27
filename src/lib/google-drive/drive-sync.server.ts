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
  generateGoogleDriveChannelToken,
  getGoogleDriveStartPageToken,
  GOOGLE_DRIVE_WATCH_MAX_DURATION_MS,
  GOOGLE_DRIVE_WATCH_RENEWAL_WINDOW_MS,
  hashGoogleDriveChannelToken,
  listGoogleDriveChangesPage,
  listGoogleDriveFolderChildren,
  searchGoogleDriveManagedFiles,
  stopGoogleDriveChannel,
  watchGoogleDriveChanges,
  type DriveChangeEntry,
  type DriveChangeFileResource,
} from "./drive-changes";
import {
  accessTokenForDrive,
  activeDriveConnection,
  adminClient,
  isGoogleDriveConfigured,
  requireActiveActor,
  timingSafeEqual,
  type DriveConnection,
} from "./google-drive.server";
import { MAX_DOCUMENT_SIZE_BYTES, validateDocumentFile } from "@/hooks/use-documents";
import { readServerRuntimeEnv } from "@/lib/server-runtime-env";

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

/**
 * Tope defensivo de páginas del feed de cambios DENTRO de una sola
 * ejecución de `poll_changes` (Fase 8F Sección 8). No es un límite de
 * cuántos cambios puede haber en total -- si se agota sin llegar a
 * `newStartPageToken`, el trabajo se reintenta (Sección 9: reanudar desde
 * el mismo `changes_page_token` persistido es siempre seguro, nunca se
 * avanza el cursor a mitad de una paginación incompleta).
 */
const MAX_DRIVE_CHANGE_POLL_PAGES = 200;

/**
 * Ventana por defecto para considerar "abandonada" una reconciliación
 * reclamada (Fase 8F Sección 47): un proceso que murió a mitad de un
 * escaneo no debe bloquear reconciliaciones futuras para siempre.
 */
export const GOOGLE_DRIVE_RECONCILIATION_STALE_SECONDS = 60 * 60;

/**
 * Cada cuánto se considera "hora de reconciliar" (Fase 8F Sección 39): la
 * reconciliación es una red de seguridad, no la ruta principal -- no tiene
 * sentido ejecutarla en cada llamada de mantenimiento.
 */
export const GOOGLE_DRIVE_RECONCILIATION_INTERVAL_MS = 6 * 60 * 60 * 1000;

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

// ── PRODUCTOR (server-only): sondear el feed de cambios (Fase 8F) ───────
/**
 * Encola `poll_changes`. Server-only, sin permisos de usuario: solo lo
 * invocan el webhook (Sección 33: "solo enqueue, deduped") y el propio
 * mantenimiento periódico (Sección 49: la durabilidad real). El dedupe usa
 * una clave fija por conexión ("tracking") -- nunca puede haber más de un
 * `poll_changes` pendiente o en curso a la vez para la misma conexión,
 * exactamente lo que Sección 68 exige para absorber notificaciones
 * duplicadas de dos canales solapados sin duplicar trabajo.
 */
export async function enqueueGoogleDrivePollChanges(connectionId: string): Promise<boolean> {
  return enqueue({
    connectionId,
    operation: "poll_changes",
    dedupeKey: driveDedupeKey("poll_changes", connectionId, "tracking"),
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

// ── poll_changes: descubrimiento automático Drive -> CRM (Fase 8F) ──────

/**
 * Bootstrap de UNA sola vez (Sección 5): si la conexión ya tiene un
 * cursor, es un no-op -- nunca se sobrescribe con un T0 más nuevo, porque
 * eso perdería exactamente los cambios ocurridos entre el T0 original y
 * este segundo intento. Solo el mantenimiento la invoca; el propio poll
 * jamás inventa un token si falta (Sección 11).
 */
export async function bootstrapGoogleDriveChangeTracking(
  context: DriveContext,
  accessToken: string,
): Promise<void> {
  const { connection } = context;
  if (connection.changes_page_token) return;
  const db = adminClient();
  const startPageToken = await getGoogleDriveStartPageToken(accessToken, driveScope(connection));
  const { error } = await db.rpc("initialize_google_drive_change_token", {
    p_connection_id: connection.id,
    p_start_page_token: startPageToken,
  });
  // Nunca se descarta el error en silencio: si la RPC falla, el llamador
  // (runGoogleDriveMaintenance) NO debe reportar `changeTrackingBootstrapped:
  // true` cuando en realidad no se persistió nada.
  if (error) throw new Error(error.message);
}

/** Forma mínima común a DriveFileResource (8D/8E) y DriveChangeFileResource
 *  (8F): lo único que la clasificación de abajo necesita leer, para no
 *  atarse a un solo origen de metadata (change feed vs. `files.get` directo
 *  de la verificación de mapeados). */
interface DriveKnownFileSnapshot {
  name: string;
  parents?: string[];
  trashed?: boolean;
  md5Checksum?: string;
  version?: string;
}

interface DriveKnownDocumentBaseline {
  last_synced_file_name: string | null;
  last_synced_drive_parent_id: string | null;
  last_synced_drive_md5_checksum: string | null;
  last_synced_drive_version: number | null;
}

export type DriveKnownEntityAction =
  | { kind: "unchanged" }
  | { kind: "missing"; reason: "DRIVE_FILE_TRASHED" | "DRIVE_FILE_REMOVED_OR_ACCESS_LOST" }
  | {
      kind: "conflict";
      reason: "DRIVE_NAME_CHANGED" | "DRIVE_CONTENT_CHANGED" | "DRIVE_PARENT_MISMATCH";
    };

/**
 * Función PURA (Fase 8F Sección 17-22): dado el baseline persistido
 * (`last_synced_*`) y lo que Drive reporta AHORA para un archivo ya
 * mapeado, decide qué corresponde -- nunca toca la base de datos ni Drive.
 * La reutilizan tanto el procesador del change feed como la verificación
 * de mapeados de la reconciliación (Sección 42): "¿este archivo mapeado
 * sigue como lo dejamos?" tiene una sola respuesta en todo el sistema.
 *
 * Comparar contra el BASELINE (`last_synced_*`), nunca contra
 * `drive_parent_id` a secas -- ese es el fundamento documentado en la
 * cabecera de la migración de 8B para poder distinguir "cambió Drive" de
 * "cambiamos ambos".
 *
 * Orden de prioridad cuando varias cosas cambiaron a la vez (el pedido no
 * fija uno, y solo puede persistirse un código a la vez en `sync_error`):
 * parent primero (lo más estructural: ¿sigue siendo del mismo Cliente?),
 * luego contenido, luego nombre.
 */
export function evaluateKnownDriveDocumentState(
  baseline: DriveKnownDocumentBaseline,
  removed: boolean,
  file: DriveKnownFileSnapshot | undefined,
): DriveKnownEntityAction {
  if (removed) return { kind: "missing", reason: "DRIVE_FILE_REMOVED_OR_ACCESS_LOST" };
  if (!file || file.trashed) return { kind: "missing", reason: "DRIVE_FILE_TRASHED" };

  const parentUnchanged =
    !baseline.last_synced_drive_parent_id ||
    (file.parents ?? []).includes(baseline.last_synced_drive_parent_id);
  if (!parentUnchanged) return { kind: "conflict", reason: "DRIVE_PARENT_MISMATCH" };

  const md5Unchanged =
    !baseline.last_synced_drive_md5_checksum ||
    !file.md5Checksum ||
    file.md5Checksum === baseline.last_synced_drive_md5_checksum;
  const versionUnchanged =
    !baseline.last_synced_drive_version ||
    !file.version ||
    Number(file.version) === baseline.last_synced_drive_version;
  if (!md5Unchanged || !versionUnchanged)
    return { kind: "conflict", reason: "DRIVE_CONTENT_CHANGED" };

  const nameUnchanged =
    !baseline.last_synced_file_name || file.name === baseline.last_synced_file_name;
  if (!nameUnchanged) return { kind: "conflict", reason: "DRIVE_NAME_CHANGED" };

  return { kind: "unchanged" };
}

/**
 * Fase 8F.1 Sección 6-13 (bloqueador crítico): toda lectura/escritura que
 * participa en decidir si un cambio del feed quedó procesado DEBE lanzar
 * ante un error de Postgres/Supabase -- nunca tratarlo como "la fila no
 * existe" o "la actualización tuvo éxito". Sin esto, un fallo TRANSITORIO
 * en un solo `change` (por ejemplo, la conexión a Postgres se corta justo
 * al marcar un conflicto) se interpretaría como "ya se procesó", y el
 * `poll_changes` seguiría hasta la página final y avanzaría el cursor
 * durable -- perdiendo ese cambio para siempre, porque el próximo poll ya
 * partiría de un cursor posterior a él.
 *
 * Al lanzar aquí, la excepción sube sin capturarse por
 * `processDriveChangeEntry`/`processDriveClientFolderChange`/
 * `handlePollGoogleDriveChanges` (ninguno de los tres la atrapa) hasta el
 * `try/catch` de `processGoogleDriveSyncQueue` alrededor de `dispatch()`,
 * que la convierte en `retry`/`failed` -- y crucialmente, eso ocurre ANTES
 * de llegar nunca a `advance_google_drive_change_token`.
 */
function unwrap<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

/**
 * Códigos de negocio con los que `repair_google_drive_document_mapping`
 * rechaza reparar por un invariante DEFINITIVO sobre este documento en
 * particular (Sección 16) -- deferirlo a un ciclo futuro (reconciliación u
 * otro `poll_changes`) es seguro, así que son los ÚNICOS que
 * `attemptDriveDocumentMappingRepair` puede tratar como "no reparado" sin
 * relanzar.
 *
 * Deliberadamente NO incluye `CLIENT_FOLDER_CHANGED_RETRY`,
 * `DRIVE_ROOT_CHANGED_RETRY` ni `DRIVE_NOT_CONNECTED`: esos nombres ya
 * indican "el estado de la conexión/carpeta cambió mientras procesábamos",
 * una señal de que el CONTEXTO de todo este poll puede estar obsoleto --
 * más seguro relanzar y abortar el lote entero (Sección 9: "cualquier
 * excepción inesperada -> abortar poll -> no avanzar token") que continuar
 * silenciosamente con un contexto potencialmente ya inválido.
 */
const REPAIR_MAPPING_KNOWN_REJECTIONS = [
  "DOCUMENT_NOT_FOUND",
  "DOCUMENT_CLIENT_MISMATCH",
  "DOCUMENT_ALREADY_MAPPED",
  "DRIVE_FILE_ALREADY_IMPORTED",
];

/**
 * Repara automáticamente el mapping de un documento outbound existente
 * cuyo `google_drive_document_files` se perdió (Fase 8F Sección 16). SOLO
 * si TODOS los invariantes coinciden exactamente -- nunca descarga ni
 * recrea el documento; la RPC (`repair_google_drive_document_mapping`)
 * hace la validación final y atómica. Cualquier discrepancia se resuelve
 * como "no reparado" en silencio: la reconciliación volverá a intentarlo
 * en su próximo ciclo, y el lost-delete scan (Sección 43) sigue cubriendo
 * el caso de que el documento en realidad ya no exista.
 */
async function attemptDriveDocumentMappingRepair(
  db: ReturnType<typeof adminClient>,
  context: DriveContext,
  documentId: string,
  clientId: string,
  contentHash: string | null,
  file: DriveKnownFileSnapshot & { id: string; webViewLink?: string; modifiedTime?: string },
): Promise<boolean> {
  const { connection, rootFolderId } = context;
  const parents = file.parents ?? [];
  // Identidad inequívoca exigida por la Sección 16: si el archivo cuelga de
  // más de un padre (posible en Unidades compartidas), no hay un ÚNICO
  // Cliente al que atribuirlo automáticamente.
  if (parents.length !== 1) return false;

  const folder = unwrap(
    await db
      .from("google_drive_client_folders")
      .select("drive_folder_id, sync_status")
      .eq("connection_id", connection.id)
      .eq("client_id", clientId)
      .maybeSingle(),
  );
  if (!folder || folder.drive_folder_id !== parents[0] || folder.sync_status !== "synced") {
    return false;
  }

  const { error } = await db.rpc("repair_google_drive_document_mapping", {
    p_connection_id: connection.id,
    p_expected_root_folder_id: rootFolderId,
    p_document_id: documentId,
    p_client_id: clientId,
    p_drive_file_id: file.id,
    p_drive_parent_id: parents[0],
    p_name: file.name,
    p_web_view_link: file.webViewLink ?? null,
    p_drive_modified_time: file.modifiedTime ?? null,
    p_drive_version: file.version ? Number(file.version) : null,
    p_drive_md5: file.md5Checksum ?? null,
    p_content_hash: contentHash,
  });
  if (!error) return true;
  // Códigos de negocio conocidos (Sección 16 del pedido de 8F): la RPC
  // rechazó reparar por un invariante real -- es un resultado seguro y
  // esperado, no un fallo. Cualquier OTRO error (transitorio, de conexión,
  // desconocido) se propaga: nunca se trata en silencio como "no reparado".
  const knownRejection = REPAIR_MAPPING_KNOWN_REJECTIONS.some((code) =>
    error.message.includes(code),
  );
  if (knownRejection) return false;
  throw new Error(error.message);
}

/**
 * Procesa un cambio reportado sobre un `drive_file_id` que YA es la carpeta
 * de un Cliente vinculado (Fase 8F Sección 23). Nunca reasigna el mapping
 * documental del Cliente ni mueve nada -- solo marca el estado para
 * revisión humana.
 */
async function processDriveClientFolderChange(
  db: ReturnType<typeof adminClient>,
  context: DriveContext,
  folderRow: { id: string; sync_status: string },
  removed: boolean,
  file: DriveKnownFileSnapshot | undefined,
): Promise<void> {
  const markFolder = async (status: "missing" | "conflict", reason: string) =>
    unwrap(
      await db
        .from("google_drive_client_folders")
        .update({ sync_status: status, sync_error: reason })
        .eq("id", folderRow.id),
    );

  if (removed || !file || file.trashed) {
    await markFolder("missing", "CLIENT_DRIVE_FOLDER_MISSING");
    return;
  }
  if (!(file.parents ?? []).includes(context.rootFolderId)) {
    await markFolder("conflict", "DRIVE_PARENT_MISMATCH");
    return;
  }
  // Sigue todo correcto: no se auto-repara desde 'conflict'/'missing' de
  // vuelta a 'synced' -- ninguna sección lo pide, y decidirlo sin
  // intervención humana sería inventar una política no especificada.
}

/**
 * Procesa UNA entrada del change feed (Fase 8F Sección 13-15/17-22).
 * Nunca llama a Google ni descarga nada -- solo lee/actualiza filas ya
 * mapeadas o encola trabajo que 8E (import) / el propio worker de
 * reparación ya validan a fondo.
 */
async function processDriveChangeEntry(
  db: ReturnType<typeof adminClient>,
  context: DriveContext,
  entry: DriveChangeEntry,
): Promise<void> {
  // Sección 13: en V1 solo se procesan cambios de tipo 'file' -- el resto se
  // ignora salvo observabilidad, que no forma parte de este alcance.
  if (entry.changeType && entry.changeType !== "file") return;

  const { connection } = context;

  const folderRow = unwrap(
    await db
      .from("google_drive_client_folders")
      .select("id, sync_status")
      .eq("connection_id", connection.id)
      .eq("drive_folder_id", entry.fileId)
      .maybeSingle(),
  );
  if (folderRow) {
    await processDriveClientFolderChange(db, context, folderRow, entry.removed, entry.file);
    return;
  }

  const mapping = unwrap(
    await db
      .from("google_drive_document_files")
      .select(
        "id, last_synced_file_name, last_synced_drive_parent_id, last_synced_drive_md5_checksum, last_synced_drive_version",
      )
      .eq("connection_id", connection.id)
      .eq("drive_file_id", entry.fileId)
      .maybeSingle(),
  );
  if (mapping) {
    const action = evaluateKnownDriveDocumentState(mapping, entry.removed, entry.file);
    if (action.kind === "unchanged") return; // Sección 17: absorbe el eco de nuestras propias operaciones.
    unwrap(
      await db
        .from("google_drive_document_files")
        .update({
          sync_status: action.kind === "missing" ? "missing" : "conflict",
          sync_error: action.reason,
        })
        .eq("id", mapping.id),
    );
    return;
  }

  // Desconocido para nosotros. "removed" sobre algo que nunca supimos no es
  // accionable (Sección 22 solo aplica a archivos YA conocidos).
  if (entry.removed) return;
  const file = entry.file;
  if (!file || file.trashed) return;
  if (classifyUnsupportedDriveEntry(file.mimeType) !== null) return;

  const ownership = classifyAppPropertiesOwnership(file.appProperties);
  if (ownership.kind === "conflict") return; // sin fila que marcar; la reconciliación lo revisa (Sección 38).

  if (ownership.kind === "known_document") {
    const document = unwrap(
      await db
        .from("documents")
        .select("id, client_id, content_hash")
        .eq("id", ownership.documentId)
        .maybeSingle(),
    );
    // Documento inexistente o Cliente discrepante: NUNCA se resucita ni se
    // repara aquí -- el lost-delete scan de la reconciliación (Sección 43)
    // es la ruta pensada para el primer caso.
    if (!document || document.client_id !== ownership.clientId) return;
    const existingMapping = unwrap(
      await db
        .from("google_drive_document_files")
        .select("id")
        .eq("document_id", document.id)
        .maybeSingle(),
    );
    if (existingMapping) return; // ya reparado por otra vía.
    await attemptDriveDocumentMappingRepair(
      db,
      context,
      document.id,
      document.client_id,
      document.content_hash,
      file,
    );
    return;
  }

  // unmanaged: candidato normal a import (Sección 14). Solo hijos DIRECTOS
  // de exactamente una carpeta de Cliente vinculada+sincronizada -- 8E hace
  // TODA la validación real (M1/M2, tamaño, integridad); aquí solo se
  // decide si vale la pena encolarlo. Nunca se importa "todo My Drive".
  const parents = file.parents ?? [];
  const candidateFolders = parents.length
    ? unwrap(
        await db
          .from("google_drive_client_folders")
          .select("client_id")
          .eq("connection_id", connection.id)
          .eq("sync_status", "synced")
          .in("drive_folder_id", parents),
      )
    : ([] as Array<{ client_id: string }>);
  if ((candidateFolders ?? []).length === 1) {
    await enqueueGoogleDriveImportFile({ connectionId: connection.id, driveFileId: entry.fileId });
  }
}

/**
 * Worker de `poll_changes` (Fase 8F Sección 8/9/11). Sigue el algoritmo
 * exacto del pedido: pide páginas una a una, procesa cada una de inmediato,
 * y SOLO al llegar a la página final (la que trae `newStartPageToken`)
 * intenta avanzar el cursor durable -- nunca antes. Si el proceso muere a
 * mitad de la paginación, el cursor en base de datos sigue siendo el
 * anterior; el reintento vuelve a pedir desde ahí y reprocesa lo mismo,
 * seguro porque todo lo que este código produce (enqueues) es idempotente
 * por dedupe_key.
 */
async function handlePollGoogleDriveChanges(
  job: QueueJob,
  context: DriveContext,
  accessToken: string,
): Promise<JobOutcome> {
  void job;
  const { connection } = context;
  if (!connection.changes_page_token) {
    // Nunca se inventa un token (Sección 11): se reintenta hasta que el
    // mantenimiento complete el bootstrap.
    return { status: "retry", reason: "DRIVE_CHANGE_TOKEN_NOT_INITIALIZED" };
  }

  const db = adminClient();
  const scope = driveScope(connection);
  let currentToken = connection.changes_page_token;
  let finalToken: string | null = null;

  for (let page = 0; page < MAX_DRIVE_CHANGE_POLL_PAGES; page += 1) {
    let pageResult;
    try {
      pageResult = await listGoogleDriveChangesPage(accessToken, currentToken, scope);
    } catch (cause) {
      const reason = sanitizeReason(String((cause as Error)?.message ?? "drive_error"));
      return isRetryableDriveFailure(cause)
        ? { status: "retry", reason }
        : { status: "failed", reason };
    }
    for (const change of pageResult.changes) {
      try {
        await processDriveChangeEntry(db, context, change);
      } catch (cause) {
        // Fase 8F.1 Sección 6-13 (bloqueador crítico): CUALQUIER fallo al
        // procesar un solo change -- transitorio o no, en la página que sea
        // -- aborta el poll ENTERO sin avanzar el cursor, en vez de
        // continuar con los cambios restantes. `unwrap()` ya garantiza que
        // un error real de Postgres/Supabase llega aquí como excepción en
        // vez de leerse como "la fila no existe"/"la actualización tuvo
        // éxito"; este catch es lo que impide que esa excepción se trate
        // como si el change se hubiera procesado. El reintento vuelve a
        // pedir `changes.list` desde el MISMO `changes_page_token`
        // persistido -- nunca desde `finalToken` ni desde `currentToken` de
        // esta página -- y reprocesa TODO el tramo; los cambios ya
        // aplicados antes del fallo son seguros de repetir porque cada
        // efecto (enqueue, update de conflicto) es idempotente por
        // dedupe_key o por ser una escritura que fija el mismo valor.
        return {
          status: "retry",
          reason: sanitizeReason(
            `DRIVE_CHANGE_PROCESSING_FAILED: ${String((cause as Error)?.message ?? cause)}`,
          ),
        };
      }
    }
    if (pageResult.newStartPageToken) {
      finalToken = pageResult.newStartPageToken;
      break;
    }
    if (!pageResult.nextPageToken) {
      return { status: "retry", reason: "DRIVE_CHANGES_PAGE_TOKEN_MISSING" };
    }
    currentToken = pageResult.nextPageToken;
  }
  if (!finalToken) return { status: "retry", reason: "DRIVE_CHANGES_TOO_MANY_PAGES" };

  const { error } = await db.rpc("advance_google_drive_change_token", {
    p_connection_id: connection.id,
    p_expected_current_token: connection.changes_page_token,
    p_new_token: finalToken,
  });
  if (error) {
    if (error.message.includes("DRIVE_CHANGE_TOKEN_CHANGED_RETRY")) {
      // Otro poller ya avanzó el cursor: como ambos partieron del MISMO
      // token, procesamos el mismo tramo de cambios -- el trabajo ya quedó
      // hecho (los enqueues son idempotentes), no es un fallo (Sección 10).
      return { status: "completed" };
    }
    return { status: "retry", reason: sanitizeReason(error.message) };
  }
  return { status: "completed" };
}

// ── watch / renovación de canal (Fase 8F Sección 25/26/34-36) ───────────
/**
 * Crea o renueva el canal de notificación si hay webhook configurado. Sin
 * `GOOGLE_DRIVE_WEBHOOK_URL`, el watch queda deliberadamente deshabilitado
 * (Sección 26: "Opcional mientras Drive no esté configurado... No inventar
 * localhost para producción") -- el poll periódico sigue siendo la vía de
 * durabilidad real (Sección 49).
 */
export async function ensureGoogleDriveWatch(
  context: DriveContext,
  accessToken: string,
): Promise<void> {
  const webhookUrl = readServerRuntimeEnv("GOOGLE_DRIVE_WEBHOOK_URL");
  if (!webhookUrl) return;
  const { connection } = context;
  if (!connection.changes_page_token) return; // sin cursor todavía, nada que vigilar.

  const db = adminClient();
  const current = unwrap(
    await db
      .from("google_drive_channels")
      .select("channel_id, resource_id, expires_at, stopped_at")
      .eq("connection_id", connection.id)
      .is("superseded_at", null)
      .maybeSingle(),
  );

  // Fase 8F.1 Sección 14-16: "needsNew" no puede depender solo de
  // `expires_at`. Un canal ya `stopped_at` (parado local/explícitamente,
  // pero todavía no superseded por ningún otro) sigue sin servir para
  // nada aunque falten días para su expiración -- sin este chequeo, el
  // sistema se quedaría sin watch funcional hasta que ese canal expirase
  // por sí solo.
  const needsNew =
    !current ||
    Boolean(current.stopped_at) ||
    new Date(current.expires_at).getTime() - Date.now() <= GOOGLE_DRIVE_WATCH_RENEWAL_WINDOW_MS;
  if (!needsNew) return;

  const channelToken = generateGoogleDriveChannelToken();
  const channelTokenHash = await hashGoogleDriveChannelToken(channelToken);
  const newChannelId = crypto.randomUUID();
  const expiresAtMs = Date.now() + GOOGLE_DRIVE_WATCH_MAX_DURATION_MS;

  const watchResult = await watchGoogleDriveChanges(
    accessToken,
    {
      pageToken: connection.changes_page_token,
      channelId: newChannelId,
      channelToken,
      webhookUrl,
      expiresAtMs,
    },
    driveScope(connection),
  );

  // Fase 8F.1 Sección 20 (bloqueador crítico): si la rotación en base de
  // datos falla -- por lo que sea, incluido un fallo transitorio de
  // Postgres --, el canal `current` (si todavía estaba activo) NUNCA debe
  // detenerse: seguiría siendo el único canal funcional que tenemos. Se
  // relanza para que el llamador (`runGoogleDriveMaintenance`, que ya trata
  // el watch como best-effort) lo capture sin tocar `current` -- el
  // siguiente ciclo de mantenimiento reintentará la rotación completa desde
  // cero, con el MISMO canal `current` todavía usable mientras tanto. B
  // puede quedar como un canal remoto huérfano en Google hasta entonces:
  // aceptable, documentado, y sin corromper el estado local.
  const { error: rotateError } = await db.rpc("rotate_google_drive_channel", {
    p_connection_id: connection.id,
    p_old_channel_id: current?.channel_id ?? null,
    p_new_channel_id: newChannelId,
    p_new_resource_id: watchResult.resourceId,
    p_new_channel_token_hash: channelTokenHash,
    p_new_expires_at: new Date(
      watchResult.expiration ? Number(watchResult.expiration) : expiresAtMs,
    ).toISOString(),
  });
  if (rotateError) throw new Error(rotateError.message);

  // channels.stop remoto: best-effort, NUNCA invalida el canal nuevo ya
  // persistido localmente (Sección 35/68 -- el solapamiento es un resultado
  // aceptado, no un error).
  if (current) {
    await stopGoogleDriveChannel(accessToken, {
      channelId: current.channel_id,
      resourceId: current.resource_id,
    }).catch(() => {});
  }
}

// ── webhook: validación ligera, sin llamar a Google (Fase 8F Sección
// 28-33/58/61) ────────────────────────────────────────────────────────────
export type GoogleDriveWebhookAction =
  { kind: "ignore" } | { kind: "reject" } | { kind: "enqueue_poll" };

export interface GoogleDriveWebhookHeaders {
  channelId: string | null;
  channelToken: string | null;
  resourceId: string | null;
  resourceState: string | null;
}

/**
 * Decide qué hacer con una notificación entrante SIN llamar nunca a
 * Google: toda autoridad real está en `changes.list`, que el `poll_changes`
 * encolado aquí ejecutará por separado (Sección 12/33).
 *
 * Un `channelId` desconocido se ignora, nunca se rechaza con error: Google
 * puede mandar el mensaje `sync` antes de que la respuesta de
 * `changes.watch` haya terminado de persistirse (Sección 28/61) -- un
 * canal que "todavía no existe" desde nuestro punto de vista no implica
 * nada malicioso.
 */
export async function handleGoogleDriveWebhookNotification(
  headers: GoogleDriveWebhookHeaders,
): Promise<GoogleDriveWebhookAction> {
  if (!headers.channelId || !headers.channelToken) return { kind: "ignore" };

  const db = adminClient();
  const { data: channel } = await db
    .from("google_drive_channels")
    .select("connection_id, resource_id, channel_token_hash, expires_at, stopped_at")
    .eq("channel_id", headers.channelId)
    .maybeSingle();
  if (!channel) return { kind: "ignore" };
  if (channel.stopped_at) return { kind: "ignore" };
  if (new Date(channel.expires_at).getTime() < Date.now()) return { kind: "ignore" };

  const providedHash = await hashGoogleDriveChannelToken(headers.channelToken);
  if (!(await timingSafeEqual(providedHash, channel.channel_token_hash))) {
    return { kind: "reject" };
  }
  if (headers.resourceId && headers.resourceId !== channel.resource_id) {
    return { kind: "reject" };
  }

  // Sección 31/58: solo 'change' encola; 'sync' y cualquier estado futuro
  // desconocido se ignoran de forma segura, nunca un 500.
  if (headers.resourceState === "change") {
    await enqueueGoogleDrivePollChanges(channel.connection_id);
    return { kind: "enqueue_poll" };
  }
  return { kind: "ignore" };
}

// ── reconciliación (Fase 8F Sección 38-48) ──────────────────────────────
export interface GoogleDriveReconciliationSummary {
  claimed: boolean;
  clientFoldersEnsured: number;
  documentsUploaded: number;
  mappingsRepaired: number;
  filesImported: number;
  /** Nunca se auto-resuelve (Sección 44): solo review humano. */
  orphanDriveFileIds: string[];
}

const EMPTY_RECONCILIATION_SUMMARY: GoogleDriveReconciliationSummary = {
  claimed: false,
  clientFoldersEnsured: 0,
  documentsUploaded: 0,
  mappingsRepaired: 0,
  filesImported: 0,
  orphanDriveFileIds: [],
};

/**
 * Pagina cualquier lectura de la propia base de datos con un tope
 * defensivo (Fase 8F Sección 46: "Nunca asumir: 100 archivos. 100
 * clientes."). No es paginación de Drive -- eso ya lo hacen
 * `listGoogleDriveFolderChildren`/`searchGoogleDriveManagedFiles`.
 */
async function selectAllRows<T>(
  build: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let page = 0; page < 500; page += 1) {
    const from = page * pageSize;
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
  }
  throw new Error("Demasiadas páginas al leer de la base de datos durante la reconciliación.");
}

/**
 * Red de seguridad periódica (Fase 8F Sección 38-48), NO la ruta principal.
 * Un solo reconciliation activo por conexión (CAS vía
 * `claim_google_drive_reconciliation`); nunca toca `changes_page_token`
 * (Sección 48: son mecanismos independientes).
 *
 * Si algo catastrófico impide completar el pase (p. ej. no se pudo
 * refrescar el access token), deliberadamente NO se llama a
 * `complete_google_drive_reconciliation`: el claim expira solo por
 * staleness y una futura ejecución lo reintenta desde cero, en vez de
 * marcar como "reconciliado" un pase que en realidad no corrió.
 */
export async function runGoogleDriveReconciliation(): Promise<GoogleDriveReconciliationSummary> {
  const resolved = await resolveDriveContext();
  if (!resolved.ok) return EMPTY_RECONCILIATION_SUMMARY;
  const context = resolved.context;
  const { connection, rootFolderId } = context;
  const db = adminClient();

  const { data: claimResult, error: claimError } = await db.rpc(
    "claim_google_drive_reconciliation",
    {
      p_connection_id: connection.id,
      p_stale_after_seconds: GOOGLE_DRIVE_RECONCILIATION_STALE_SECONDS,
    },
  );
  if (claimError || !(claimResult as { claimed?: boolean } | null)?.claimed) {
    return EMPTY_RECONCILIATION_SUMMARY;
  }

  const summary: GoogleDriveReconciliationSummary = {
    ...EMPTY_RECONCILIATION_SUMMARY,
    claimed: true,
  };

  try {
    const accessToken = await accessTokenForDrive(connection);
    const scope = driveScope(connection);

    // 1. Clientes sin carpeta de Drive (Sección 40).
    const clients = await selectAllRows<{ id: string }>((from, to) =>
      db.from("clients").select("id").range(from, to),
    );
    const clientFolderRows = await selectAllRows<{
      id: string;
      client_id: string;
      drive_folder_id: string;
      sync_status: string;
    }>((from, to) =>
      db
        .from("google_drive_client_folders")
        .select("id, client_id, drive_folder_id, sync_status")
        .eq("connection_id", connection.id)
        .range(from, to),
    );
    const mappedClientIds = new Set(clientFolderRows.map((row) => row.client_id));
    for (const client of clients) {
      if (mappedClientIds.has(client.id)) continue;
      await enqueue({
        connectionId: connection.id,
        operation: "ensure_client_folder",
        dedupeKey: driveDedupeKey("ensure_client_folder", connection.id, client.id),
        clientId: client.id,
      });
      summary.clientFoldersEnsured += 1;
    }

    // 2. Documentos con Cliente pero sin mapping (Sección 40). Los de
    // procedencia Drive NUNCA generan un upload outbound duplicado --
    // se intenta reparar identidad si el drive_file_id sigue siendo válido.
    const documents = await selectAllRows<{
      id: string;
      client_id: string | null;
      source_provider: string | null;
      external_file_id: string | null;
      content_hash: string | null;
    }>((from, to) =>
      db
        .from("documents")
        .select("id, client_id, source_provider, external_file_id, content_hash")
        .not("client_id", "is", null)
        .range(from, to),
    );
    const documentMappingRows = await selectAllRows<{ document_id: string }>((from, to) =>
      db
        .from("google_drive_document_files")
        .select("document_id")
        .eq("connection_id", connection.id)
        .range(from, to),
    );
    const mappedDocumentIds = new Set(documentMappingRows.map((row) => row.document_id));
    for (const document of documents) {
      if (!document.client_id || mappedDocumentIds.has(document.id)) continue;
      if (document.source_provider === "google_drive") {
        if (!document.external_file_id) continue;
        let file: DriveFileResource | null;
        try {
          file = await getDriveFile(accessToken, document.external_file_id, scope);
        } catch {
          continue; // fallo transitorio: se reintenta en el próximo ciclo, nunca se marca nada.
        }
        if (!file || file.trashed) continue; // el lost-delete scan (paso 5) cubre esto si corresponde.
        const repaired = await attemptDriveDocumentMappingRepair(
          db,
          context,
          document.id,
          document.client_id,
          document.content_hash,
          file,
        );
        if (repaired) summary.mappingsRepaired += 1;
        continue;
      }
      await enqueue({
        connectionId: connection.id,
        operation: "upload_document",
        dedupeKey: driveDedupeKey("upload_document", connection.id, document.id),
        clientId: document.client_id,
        documentId: document.id,
      });
      summary.documentsUploaded += 1;
    }

    // 3. Por cada carpeta de Cliente: revalidar la carpeta en sí (mismo
    // criterio que el change feed, Sección 23) y escanear sus hijos
    // DIRECTOS -- nunca recursivo (Sección 41/46/47).
    for (const folder of clientFolderRows) {
      let liveFolder: DriveFileResource | null;
      try {
        liveFolder = await getDriveFile(accessToken, folder.drive_folder_id, scope);
      } catch {
        continue; // fallo transitorio de Drive: no se marca nada, se reintenta.
      }
      const missing =
        !liveFolder || liveFolder.trashed || liveFolder.mimeType !== DRIVE_FOLDER_MIME_TYPE;
      if (missing) {
        await db
          .from("google_drive_client_folders")
          .update({ sync_status: "missing", sync_error: "CLIENT_DRIVE_FOLDER_MISSING" })
          .eq("id", folder.id);
        continue;
      }
      const moved = !(liveFolder!.parents ?? []).includes(rootFolderId);
      if (moved) {
        await db
          .from("google_drive_client_folders")
          .update({ sync_status: "conflict", sync_error: "DRIVE_PARENT_MISMATCH" })
          .eq("id", folder.id);
        continue;
      }
      if (folder.sync_status !== "synced") continue; // pendiente/error de onboarding, no es candidato a escaneo todavía.

      const children = await listGoogleDriveFolderChildren(
        accessToken,
        folder.drive_folder_id,
        scope,
      );
      for (const child of children) {
        if (child.mimeType === DRIVE_FOLDER_MIME_TYPE) continue; // sin recursión.
        if (child.trashed) continue;
        if (classifyUnsupportedDriveEntry(child.mimeType) !== null) continue;

        const { data: existingMapping } = await db
          .from("google_drive_document_files")
          .select("id")
          .eq("connection_id", connection.id)
          .eq("drive_file_id", child.id)
          .maybeSingle();
        if (existingMapping) continue; // el paso 4 verifica los ya mapeados.

        const ownership = classifyAppPropertiesOwnership(child.appProperties);
        if (ownership.kind === "conflict") continue;
        if (ownership.kind === "known_document") {
          const { data: document } = await db
            .from("documents")
            .select("id, client_id, content_hash")
            .eq("id", ownership.documentId)
            .maybeSingle();
          if (!document || document.client_id !== ownership.clientId) continue;
          const { data: alreadyMapped } = await db
            .from("google_drive_document_files")
            .select("id")
            .eq("document_id", document.id)
            .maybeSingle();
          if (alreadyMapped) continue;
          const repaired = await attemptDriveDocumentMappingRepair(
            db,
            context,
            document.id,
            document.client_id,
            document.content_hash,
            child,
          );
          if (repaired) summary.mappingsRepaired += 1;
          continue;
        }
        await enqueueGoogleDriveImportFile({ connectionId: connection.id, driveFileId: child.id });
        summary.filesImported += 1;
      }
    }

    // 4. Verificación de mapeados existentes (Sección 42): detecta archivos
    // movidos FUERA de la jerarquía de carpetas de Cliente, que el escaneo
    // del paso 3 nunca vería (ya no cuelga de ninguna carpeta vinculada).
    const mappings = await selectAllRows<{
      id: string;
      drive_file_id: string;
      last_synced_file_name: string | null;
      last_synced_drive_parent_id: string | null;
      last_synced_drive_md5_checksum: string | null;
      last_synced_drive_version: number | null;
    }>((from, to) =>
      db
        .from("google_drive_document_files")
        .select(
          "id, drive_file_id, last_synced_file_name, last_synced_drive_parent_id, last_synced_drive_md5_checksum, last_synced_drive_version",
        )
        .eq("connection_id", connection.id)
        .range(from, to),
    );
    for (const mapping of mappings) {
      let file: DriveFileResource | null;
      try {
        file = await getDriveFile(accessToken, mapping.drive_file_id, scope);
      } catch {
        continue; // fallo transitorio: no se marca nada.
      }
      const action = evaluateKnownDriveDocumentState(mapping, file === null, file ?? undefined);
      if (action.kind === "unchanged") continue;
      await db
        .from("google_drive_document_files")
        .update({
          sync_status: action.kind === "missing" ? "missing" : "conflict",
          sync_error: action.reason,
        })
        .eq("id", mapping.id);
    }

    // 5. Lost-delete scan (Sección 43/44/45, OBLIGATORIO): archivos que
    // Drive sigue teniendo marcados como gestionados por el CRM
    // (`appProperties.crm_entity=document`) cuyo `documents` YA NO EXISTE.
    // Nunca se resucita ni se auto-trashea (Sección 44) -- solo se reporta
    // para revisión humana.
    const managedFiles = await searchGoogleDriveManagedFiles(accessToken, scope);
    for (const file of managedFiles) {
      const ownership = classifyAppPropertiesOwnership(file.appProperties);
      if (ownership.kind !== "known_document") continue;
      const { data: document } = await db
        .from("documents")
        .select("id")
        .eq("id", ownership.documentId)
        .maybeSingle();
      if (document) continue; // existe: lo cubren los pasos 3/4 si le falta mapping o cambió.
      summary.orphanDriveFileIds.push(file.id);
    }

    await db.rpc("complete_google_drive_reconciliation", { p_connection_id: connection.id });
  } catch {
    // Fallo catastrófico (p. ej. el access token no se pudo refrescar): se
    // devuelve el resumen parcial, pero NUNCA se marca como completada --
    // el claim expira solo por staleness para un reintento limpio.
  }

  return summary;
}

// ── procesador ───────────────────────────────────────────────────────────
/** Nunca se propaga texto crudo de Google ni de PostgreSQL. */
function sanitizeReason(message: string): string {
  return message.replace(/\s+/g, " ").slice(0, 200);
}

/**
 * Procesa un lote de la cola.
 *
 * Despacha las nueve operaciones existentes: seis productoras CRM -> Drive
 * (8B-8D), `import_drive_file` (Drive -> CRM, 8E) y `poll_changes`
 * (descubrimiento automático Drive -> CRM, 8F). Solo `update_document`
 * sigue sin ningún productor real que la encole -- el CRM todavía no
 * ofrece reemplazar el contenido de un documento.
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
    case "poll_changes":
      return handlePollGoogleDriveChanges(job, context, accessToken);
    default:
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

// ── mantenimiento (Fase 8F Sección 37) ──────────────────────────────────
export interface GoogleDriveMaintenanceSummary {
  processed: number;
  completed: number;
  retried: number;
  failed: number;
  changeTrackingBootstrapped: boolean;
  watchEnsured: boolean;
  pollEnqueued: boolean;
  reconciliation: GoogleDriveReconciliationSummary | null;
}

/**
 * Único punto de entrada del mantenimiento periódico. En orden (Sección
 * 37): 1) bootstrap del cursor de cambios si falta; 2) asegurar/renovar el
 * canal de watch si hay webhook configurado; 3) encolar `poll_changes`;
 * 4) reconciliación si ya toca (Sección 39: no en cada llamada); 5) procesar
 * la cola -- lo que incluye el propio `poll_changes` recién encolado, en la
 * MISMA ejecución.
 *
 * Cada paso es best-effort respecto a los demás: un fallo al asegurar el
 * watch (por ejemplo, Drive caído un instante) nunca debe impedir que la
 * cola se siga procesando -- el poll periódico sigue siendo la vía de
 * durabilidad real (Sección 49), el watch es solo una optimización de
 * latencia.
 */
export async function runGoogleDriveMaintenance(): Promise<GoogleDriveMaintenanceSummary> {
  const resolved = await resolveDriveContext();
  if (!resolved.ok) {
    const queueResult = await processGoogleDriveSyncQueue();
    return {
      ...queueResult,
      changeTrackingBootstrapped: false,
      watchEnsured: false,
      pollEnqueued: false,
      reconciliation: null,
    };
  }

  const context = resolved.context;
  const accessToken = await accessTokenForDrive(context.connection);

  let changeTrackingBootstrapped = false;
  if (!context.connection.changes_page_token) {
    try {
      await bootstrapGoogleDriveChangeTracking(context, accessToken);
      changeTrackingBootstrapped = true;
    } catch {
      // best-effort: si Drive falla aquí, el resto del mantenimiento sigue.
    }
  }

  // El bootstrap pudo haber fijado el token recién -- se relee para que los
  // pasos siguientes de ESTA misma ejecución ya lo vean.
  const refreshedConnection = changeTrackingBootstrapped
    ? await activeDriveConnection()
    : context.connection;
  const refreshedContext: DriveContext = {
    connection: refreshedConnection ?? context.connection,
    rootFolderId: context.rootFolderId,
  };

  let watchEnsured = false;
  try {
    await ensureGoogleDriveWatch(refreshedContext, accessToken);
    watchEnsured = true;
  } catch {
    // best-effort (Sección 35): un fallo de watch/renovación nunca bloquea
    // el resto del mantenimiento.
  }

  let pollEnqueued = false;
  if (refreshedContext.connection.changes_page_token) {
    pollEnqueued = await enqueueGoogleDrivePollChanges(refreshedContext.connection.id);
  }

  let reconciliation: GoogleDriveReconciliationSummary | null = null;
  const lastReconciledAt = refreshedContext.connection.last_reconciled_at;
  const dueForReconciliation =
    !lastReconciledAt ||
    Date.now() - new Date(lastReconciledAt).getTime() >= GOOGLE_DRIVE_RECONCILIATION_INTERVAL_MS;
  if (dueForReconciliation) {
    reconciliation = await runGoogleDriveReconciliation();
  }

  const queueResult = await processGoogleDriveSyncQueue();
  return { ...queueResult, changeTrackingBootstrapped, watchEnsured, pollEnqueued, reconciliation };
}

// Se re-exporta para que las rutas no tengan que importar de dos módulos.
export { DriveError };
