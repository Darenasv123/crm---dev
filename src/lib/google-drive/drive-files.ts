/**
 * Fase 8D — primitivas REST de ARCHIVOS y CARPETAS creados por el CRM.
 *
 * Separado de drive-folders.ts a propósito: aquel es estrictamente de solo
 * lectura (navegar y listar), este es el que escribe. Mantenerlos aparte
 * hace que "¿qué código puede modificar el Drive del estudio?" tenga una
 * respuesta de un solo archivo.
 *
 * Igual que drive-folders.ts: sin Supabase, sin sesión, sin lógica de auth.
 * Recibe un access token ya resuelto por google-drive.server.ts, para poder
 * probar el comportamiento real con `fetch` mockeado.
 *
 * NUNCA hace hard-delete. La única forma de quitar algo de Drive desde el
 * CRM es mover a la papelera (`trashed: true`), que es reversible durante 30
 * días. Un borrado accidental jamás debe poder destruir evidencia jurídica.
 */
import { DriveError } from "./drive-errors";
import { DRIVE_FOLDER_MIME_TYPE } from "./drive-folders";

const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";

/**
 * Campos que se piden de vuelta. No se piden `permissions` ni `owners`:
 * minimización de datos, y además abultan la respuesta sin aportar nada.
 */
export const DRIVE_FILE_FIELDS =
  "id,name,parents,mimeType,modifiedTime,version,md5Checksum,webViewLink,trashed,appProperties,driveId";

/**
 * Umbral entre subida multipart y resumable. Por debajo, una sola petición
 * es más simple y más rápida; por encima, resumable evita tener que
 * reenviar todo el fichero si la conexión se corta a mitad. El máximo real
 * del CRM son 10 MB (MAX_DOCUMENT_SIZE_BYTES), así que resumable solo entra
 * en la mitad alta del rango.
 */
export const DRIVE_RESUMABLE_THRESHOLD_BYTES = 5 * 1024 * 1024;

export interface DriveFileResource {
  id: string;
  name: string;
  parents?: string[];
  mimeType?: string;
  modifiedTime?: string;
  version?: string;
  md5Checksum?: string;
  webViewLink?: string;
  trashed?: boolean;
  appProperties?: Record<string, string>;
  driveId?: string;
}

export interface DriveScope {
  sharedDriveId?: string | null;
}

/** Error de transporte con el status de Google, sin su cuerpo. */
export class DriveHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Google Drive respondió ${status}.`);
    this.name = "DriveHttpError";
    this.status = status;
  }
}

export function isDriveHttpError(value: unknown): value is DriveHttpError {
  return value instanceof DriveHttpError;
}

function scopedParams(extra: Record<string, string>, scope: DriveScope = {}) {
  const params = new URLSearchParams({ supportsAllDrives: "true", ...extra });
  // includeItemsFromAllDrives solo aplica a listados, no a get/create/update;
  // supportsAllDrives es el que habilita operar sobre Unidades compartidas.
  void scope;
  return params;
}

async function driveJson<T>(url: string, accessToken: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${accessToken}`);
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    // El cuerpo de Google se descarta explícitamente: puede contener rutas
    // internas, el correo de la cuenta o identificadores del proyecto, y
    // nunca debe acabar en un mensaje visible ni en un log.
    await response.text().catch(() => "");
    throw new DriveHttpError(response.status);
  }
  return (await response.json()) as T;
}

// ── generateIds ──────────────────────────────────────────────────────────
/**
 * Pide a Google identificadores válidos POR ADELANTADO.
 *
 * Es el mecanismo central contra duplicados: se reserva el ID en PostgreSQL
 * antes de crear nada en Drive, y cualquier reintento usa el MISMO ID. Si un
 * intento anterior llegó a crear el objeto pero perdimos la respuesta (timeout,
 * proceso caído), el reintento recibe un 409 en vez de crear un segundo
 * archivo -- y ese 409 se reconcilia comprobando identidad.
 */
export async function generateDriveIds(accessToken: string, count: number): Promise<string[]> {
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    throw new Error("La cantidad de identificadores solicitada no es válida.");
  }
  const params = new URLSearchParams({ count: String(count), space: "drive" });
  const body = await driveJson<{ ids?: unknown }>(
    `${DRIVE_FILES_URL}/generateIds?${params}`,
    accessToken,
  );
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length !== count) {
    throw new Error("Google no devolvió la cantidad de identificadores solicitada.");
  }
  for (const id of ids) {
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("Google devolvió un identificador vacío.");
    }
  }
  return ids as string[];
}

// ── get ──────────────────────────────────────────────────────────────────
/** Metadata de un archivo/carpeta por ID. `null` si ya no existe (404). */
export async function getDriveFile(
  accessToken: string,
  fileId: string,
  scope: DriveScope = {},
): Promise<DriveFileResource | null> {
  const params = scopedParams({ fields: DRIVE_FILE_FIELDS }, scope);
  try {
    return await driveJson<DriveFileResource>(
      `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?${params}`,
      accessToken,
    );
  } catch (cause) {
    if (isDriveHttpError(cause) && cause.status === 404) return null;
    throw cause;
  }
}

// ── create folder ────────────────────────────────────────────────────────
export async function createDriveFolder(
  accessToken: string,
  input: {
    id: string;
    name: string;
    parentId: string;
    appProperties: Record<string, string>;
  },
  scope: DriveScope = {},
): Promise<DriveFileResource> {
  const params = scopedParams({ fields: DRIVE_FILE_FIELDS }, scope);
  return driveJson<DriveFileResource>(`${DRIVE_FILES_URL}?${params}`, accessToken, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: input.id,
      name: input.name,
      mimeType: DRIVE_FOLDER_MIME_TYPE,
      parents: [input.parentId],
      appProperties: input.appProperties,
    }),
  });
}

// ── upload: multipart ────────────────────────────────────────────────────
/**
 * Construye el cuerpo multipart/related a mano.
 *
 * Se opera sobre bytes (Uint8Array), nunca sobre strings: convertir un PDF o
 * un DOCX a string y de vuelta lo corrompe silenciosamente. El separador se
 * genera aleatorio para que no pueda aparecer dentro del contenido.
 */
export function buildMultipartBody(
  metadata: Record<string, unknown>,
  content: Uint8Array,
  contentType: string,
  boundary: string,
): Uint8Array {
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\n` +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + content.length + tail.length);
  body.set(head, 0);
  body.set(content, head.length);
  body.set(tail, head.length + content.length);
  return body;
}

function randomBoundary() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `crm-drive-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

async function uploadMultipart(
  accessToken: string,
  metadata: Record<string, unknown>,
  content: Uint8Array,
  contentType: string,
  scope: DriveScope,
): Promise<DriveFileResource> {
  const params = scopedParams({ uploadType: "multipart", fields: DRIVE_FILE_FIELDS }, scope);
  const boundary = randomBoundary();
  const body = buildMultipartBody(metadata, content, contentType, boundary);
  return driveJson<DriveFileResource>(`${DRIVE_UPLOAD_URL}?${params}`, accessToken, {
    method: "POST",
    headers: { "content-type": `multipart/related; boundary=${boundary}` },
    body: body as unknown as BodyInit,
  });
}

// ── upload: resumable ────────────────────────────────────────────────────
/**
 * Tope de sondeos/reanudaciones dentro de UNA ejecución del worker.
 *
 * Reanudar en el sitio evita reenviar megabytes ya subidos, pero un bucle sin
 * tope convertiría un fallo persistente en un worker colgado. Al agotarlo se
 * devuelve un error transitorio y la cola lo reprograma con su backoff, que
 * es donde debe vivir la espera larga.
 */
export const MAX_RESUMABLE_ATTEMPTS_PER_RUN = 3;

export type ResumableStatus =
  | { kind: "complete"; resource: DriveFileResource | null }
  | { kind: "incomplete"; nextOffset: number }
  | { kind: "expired" }
  | { kind: "unusable" };

/**
 * Pregunta a Google en qué punto quedó una sesión resumable, con el PUT vacío
 * que documenta la API: cabecera Content-Range con "bytes STAR/TOTAL" (STAR = comodín), y sin cuerpo.
 *
 * Es lo que convierte "se cortó la red a mitad de subida" en algo recuperable
 * en vez de en un reintento que vuelve a enviar el archivo entero -- o, peor,
 * en un segundo archivo.
 */
export async function queryResumableUploadStatus(
  sessionUrl: string,
  totalBytes: number,
): Promise<ResumableStatus> {
  const response = await fetch(sessionUrl, {
    method: "PUT",
    headers: { "content-range": `bytes */${totalBytes}`, "content-length": "0" },
  });

  if (response.status === 200 || response.status === 201) {
    // La subida SÍ se completó; probablemente perdimos la respuesta final.
    const resource = await response.json().catch(() => null);
    return { kind: "complete", resource: resource as DriveFileResource | null };
  }

  if (response.status === 308) {
    // "Resume Incomplete". El header Range dice hasta qué byte llegó; su
    // ausencia significa que no se recibió nada todavía.
    const range = response.headers.get("range");
    const lastByte = range ? Number(/bytes=0-(\d+)/.exec(range)?.[1] ?? NaN) : NaN;
    return { kind: "incomplete", nextOffset: Number.isFinite(lastByte) ? lastByte + 1 : 0 };
  }

  // 404: la sesión caducó (Google las mantiene ~1 semana, pero también las
  // invalida antes en algunos casos). Se puede abrir otra -- siempre con el
  // MISMO id reservado.
  if (response.status === 404) return { kind: "expired" };

  // 5xx o cuota: el problema es de Google ahora mismo, no de la sesión.
  if (response.status === 429 || response.status >= 500) {
    await response.text().catch(() => "");
    throw new DriveHttpError(response.status);
  }

  // Cualquier otro 4xx: la sesión no vale, pero tampoco es un fallo
  // transitorio del que reintentar sirva.
  await response.text().catch(() => "");
  return { kind: "unusable" };
}

/** Abre una sesión resumable y devuelve su URL. Nunca se persiste. */
async function openResumableSession(
  accessToken: string,
  metadata: Record<string, unknown>,
  totalBytes: number,
  contentType: string,
  scope: DriveScope,
): Promise<string> {
  const params = scopedParams({ uploadType: "resumable", fields: DRIVE_FILE_FIELDS }, scope);
  const response = await fetch(`${DRIVE_UPLOAD_URL}?${params}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "x-upload-content-type": contentType,
      "x-upload-content-length": String(totalBytes),
    },
    body: JSON.stringify(metadata),
  });
  if (!response.ok) {
    await response.text().catch(() => "");
    throw new DriveHttpError(response.status);
  }
  const sessionUrl = response.headers.get("location");
  if (!sessionUrl) throw new Error("Google no devolvió la sesión de subida.");
  return sessionUrl;
}

/**
 * Envía (o reanuda) el contenido a partir de `offset`.
 *
 * Devuelve `null` si el PUT no concluyó, para que quien llama consulte el
 * estado de la sesión en vez de darla por perdida. Un 5xx a mitad de subida
 * no significa que no haya llegado nada.
 */
async function putResumableChunk(
  sessionUrl: string,
  content: Uint8Array,
  contentType: string,
  offset: number,
): Promise<DriveFileResource | null> {
  const total = content.length;
  const chunk = offset === 0 ? content : content.subarray(offset);
  const response = await fetch(sessionUrl, {
    method: "PUT",
    headers: {
      "content-type": contentType,
      "content-length": String(chunk.length),
      "content-range": `bytes ${offset}-${total - 1}/${total}`,
    },
    body: chunk as unknown as BodyInit,
  });
  if (response.status === 200 || response.status === 201) {
    return (await response.json()) as DriveFileResource;
  }
  await response.text().catch(() => "");
  // 308 = falta contenido; 5xx/429 = fallo puntual. En ambos casos hay que
  // preguntar por el estado real antes de decidir nada.
  if (response.status === 308 || response.status === 429 || response.status >= 500) return null;
  throw new DriveHttpError(response.status);
}

/**
 * Subida resumable con recuperación.
 *
 * La session URL es una *capability URL*: quien la tenga puede escribir en
 * ese archivo sin más credenciales. Por eso vive SOLO en esta variable local
 * -- nunca se guarda en PostgreSQL, ni en el payload de la cola, ni en un
 * log, ni llega al navegador. Si el proceso muere del todo, esa sesión se
 * pierde y no pasa nada: la siguiente ejecución sigue protegida por el ID
 * reservado, que es la garantía real contra duplicados.
 */
async function uploadResumable(
  accessToken: string,
  metadata: Record<string, unknown>,
  content: Uint8Array,
  contentType: string,
  scope: DriveScope,
  onSessionLost?: () => Promise<DriveFileResource | null>,
): Promise<DriveFileResource | null> {
  let sessionUrl = await openResumableSession(
    accessToken,
    metadata,
    content.length,
    contentType,
    scope,
  );
  let offset = 0;

  for (let attempt = 0; attempt < MAX_RESUMABLE_ATTEMPTS_PER_RUN; attempt += 1) {
    let uploaded: DriveFileResource | null = null;
    let putFailed = false;
    try {
      uploaded = await putResumableChunk(sessionUrl, content, contentType, offset);
    } catch (cause) {
      // Fallo de red: la sesión puede seguir viva y con parte del contenido.
      if (!(cause instanceof TypeError)) throw cause;
      putFailed = true;
    }
    if (uploaded) return uploaded;
    void putFailed;

    const status = await queryResumableUploadStatus(sessionUrl, content.length);

    if (status.kind === "complete") {
      // Llegó entero y perdimos la respuesta. Si el sondeo no trajo la
      // metadata, quien llama la resuelve consultando el ID reservado.
      return status.resource ?? (onSessionLost ? await onSessionLost() : null);
    }
    if (status.kind === "incomplete") {
      offset = status.nextOffset;
      continue;
    }
    if (status.kind === "expired") {
      // Sesión caducada: antes de abrir otra, comprobar si el archivo ya
      // existe con el ID reservado (pudo completarse antes de caducar).
      const existing = onSessionLost ? await onSessionLost() : null;
      if (existing) return existing;
      sessionUrl = await openResumableSession(
        accessToken,
        metadata,
        content.length,
        contentType,
        scope,
      );
      offset = 0;
      continue;
    }
    // 'unusable': la sesión no sirve y reintentarla no ayudaría.
    return onSessionLost ? await onSessionLost() : null;
  }

  // Agotados los intentos de esta ejecución: transitorio, que lo reprograme
  // la cola con su backoff en vez de insistir aquí.
  throw new DriveHttpError(503);
}

/**
 * Crea un archivo en Drive con un ID pre-reservado.
 *
 * No se usa `uploadType=media` porque necesitamos enviar metadata junto al
 * contenido: el ID reservado, el nombre, la carpeta padre y las
 * appProperties de identidad. Sin ellas la idempotencia por ID reservado no
 * funcionaría.
 */
export async function createDriveFileWithContent(
  accessToken: string,
  input: {
    id: string;
    name: string;
    parentId: string;
    mimeType: string;
    appProperties: Record<string, string>;
    content: Uint8Array;
  },
  scope: DriveScope = {},
): Promise<DriveFileResource | null> {
  const metadata = {
    id: input.id,
    name: input.name,
    parents: [input.parentId],
    mimeType: input.mimeType,
    appProperties: input.appProperties,
  };
  const contentType = input.mimeType || "application/octet-stream";
  if (input.content.length <= DRIVE_RESUMABLE_THRESHOLD_BYTES) {
    return uploadMultipart(accessToken, metadata, input.content, contentType, scope);
  }
  // Si la sesión resumable se pierde o completa sin devolver metadata, se
  // resuelve consultando el ID reservado: es la misma reconciliación por
  // identidad que ya usa el 409 de multipart. Nunca se genera otro ID.
  return uploadResumable(accessToken, metadata, input.content, contentType, scope, () =>
    getDriveFile(accessToken, input.id, scope),
  );
}

// ── rename ───────────────────────────────────────────────────────────────
/**
 * Cambia SOLO el nombre. Nunca toca `parents`: mover un archivo entre
 * carpetas cambiaría la relación Cliente<->Carpeta, y esa relación la
 * gobierna el CRM, no una operación de renombrado.
 */
export async function renameDriveFile(
  accessToken: string,
  fileId: string,
  name: string,
  scope: DriveScope = {},
): Promise<DriveFileResource> {
  const params = scopedParams({ fields: DRIVE_FILE_FIELDS }, scope);
  return driveJson<DriveFileResource>(
    `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?${params}`,
    accessToken,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    },
  );
}

// ── update content ───────────────────────────────────────────────────────
/**
 * Sustituye el contenido de un archivo EXISTENTE, conservando su ID.
 *
 * Implementado porque comparte toda la infraestructura de subida y porque el
 * worker `update_document` de la cola lo necesitaría, pero en esta fase NO
 * hay ningún productor que lo dispare: el CRM todavía no ofrece reemplazar
 * el contenido de un documento (ver la auditoría de Fase 8D). Cuando exista
 * esa función en el CRM, esto ya está listo y no habrá que improvisarlo.
 */
export async function updateDriveFileContent(
  accessToken: string,
  fileId: string,
  content: Uint8Array,
  contentType: string,
  scope: DriveScope = {},
): Promise<DriveFileResource> {
  const params = scopedParams({ uploadType: "media", fields: DRIVE_FILE_FIELDS }, scope);
  return driveJson<DriveFileResource>(
    `${DRIVE_UPLOAD_URL}/${encodeURIComponent(fileId)}?${params}`,
    accessToken,
    {
      method: "PATCH",
      headers: { "content-type": contentType },
      body: content as unknown as BodyInit,
    },
  );
}

// ── trash ────────────────────────────────────────────────────────────────
/**
 * Mueve a la papelera. Deliberadamente NO existe una función de borrado
 * definitivo en este módulo: `files.delete` destruiría el archivo de
 * inmediato y sin retorno.
 */
export async function trashDriveFile(
  accessToken: string,
  fileId: string,
  scope: DriveScope = {},
): Promise<DriveFileResource> {
  const params = scopedParams({ fields: DRIVE_FILE_FIELDS }, scope);
  return driveJson<DriveFileResource>(
    `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?${params}`,
    accessToken,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    },
  );
}

// ── clasificación de errores ─────────────────────────────────────────────
export type DriveErrorKind = "auth" | "permission" | "missing" | "conflict" | "transient" | "fatal";

/**
 * Clasifica un fallo para decidir si la operación se reintenta o se da por
 * perdida. Se mira solo el status, nunca el cuerpo de Google.
 */
export function classifyDriveFailure(cause: unknown): DriveErrorKind {
  if (cause instanceof DriveError) return "fatal";
  if (isDriveHttpError(cause)) {
    if (cause.status === 401) return "auth";
    if (cause.status === 403) return "permission";
    if (cause.status === 404) return "missing";
    if (cause.status === 409) return "conflict";
    if (cause.status === 429 || cause.status >= 500) return "transient";
    return "fatal";
  }
  // Fallo de red (fetch rechaza sin status): casi siempre transitorio.
  if (cause instanceof TypeError) return "transient";
  return "fatal";
}

export function isRetryableDriveFailure(cause: unknown): boolean {
  const kind = classifyDriveFailure(cause);
  // 'auth' se reintenta: el access token se pide de nuevo en cada intento,
  // así que un 401 puntual suele resolverse solo.
  return kind === "transient" || kind === "auth";
}
