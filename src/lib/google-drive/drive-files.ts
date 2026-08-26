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
  /** Solo poblado por getDriveFileMetadata (Fase 8E). Drive lo da como string. */
  size?: string;
  /** Solo poblado por getDriveFileMetadata (Fase 8E). */
  capabilities?: { canDownload?: boolean };
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

// ── metadata inbound (Fase 8E) ────────────────────────────────────────────
/**
 * Campos para leer un archivo DESCUBIERTO en Drive (Drive -> CRM), no uno
 * que el CRM haya creado. Extiende `DRIVE_FILE_FIELDS` con `size` (para
 * rechazar por tamaño antes de descargar) y `capabilities/canDownload` (para
 * no intentar `alt=media` sobre algo que Drive ya sabe que no se puede
 * descargar). Sin `owners`, `permissions` completas, `description` ni
 * `contentHints`/`sharingUser`: minimización de datos, igual criterio que el
 * resto del módulo.
 */
export const DRIVE_INBOUND_FILE_FIELDS = `${DRIVE_FILE_FIELDS},size,capabilities(canDownload)`;

/** Igual que getDriveFile, pero pidiendo los campos adicionales de inbound. */
export async function getDriveFileMetadata(
  accessToken: string,
  fileId: string,
  scope: DriveScope = {},
): Promise<DriveFileResource | null> {
  const params = scopedParams({ fields: DRIVE_INBOUND_FILE_FIELDS }, scope);
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

/**
 * ¿Estos dos snapshots de metadata describen el mismo estado del archivo?
 * (Fase 8E Sección 17 -- doble comprobación entre "voy a descargar" y "ya
 * descargué", porque Drive es externo y puede cambiar entre medias.)
 *
 * Compara identidad, versión, momento de modificación, padres, papelera,
 * nombre y -- cuando existe -- el checksum. Cualquier diferencia significa
 * que no es seguro escribir lo que se descargó: hay que reintentar contra el
 * estado actual, nunca guardar un snapshot incoherente.
 */
export function driveFileMetadataUnchanged(
  before: DriveFileResource,
  after: DriveFileResource,
): boolean {
  return (
    before.id === after.id &&
    before.version === after.version &&
    before.modifiedTime === after.modifiedTime &&
    before.trashed === after.trashed &&
    before.name === after.name &&
    JSON.stringify(before.parents ?? []) === JSON.stringify(after.parents ?? []) &&
    (!before.md5Checksum || before.md5Checksum === after.md5Checksum)
  );
}

// ── clasificación de tipo (Fase 8E) ───────────────────────────────────────
const GOOGLE_APPS_MIME_PREFIX = "application/vnd.google-apps.";
export const DRIVE_SHORTCUT_MIME_TYPE = "application/vnd.google-apps.shortcut";

export type UnsupportedDriveEntryReason =
  "GOOGLE_WORKSPACE_FILE_UNSUPPORTED" | "DRIVE_ENTRY_NOT_IMPORTABLE";

/**
 * V1 solo importa "blob files" (PDF, DOCX, imágenes, hojas de cálculo de
 * Office, etc. -- cualquier cosa con bytes reales descargables tal cual).
 * Los tipos nativos de Google Workspace (Docs/Sheets/Slides/Drawings/
 * Forms/Scripts/Sites/Jam...) no tienen bytes propios: requerirían
 * `files.export` para convertirlos a un formato de blob, lo que implica
 * decisiones de formato y una copia-snapshot que esta fase delibera-
 * damente NO toma (ver documentación operativa). Carpetas y accesos
 * directos tampoco son documentos importables.
 *
 * Devuelve `null` cuando el tipo SÍ es un blob importable.
 */
export function classifyUnsupportedDriveEntry(
  mimeType: string | undefined,
): UnsupportedDriveEntryReason | null {
  if (!mimeType) return null;
  if (mimeType === DRIVE_FOLDER_MIME_TYPE || mimeType === DRIVE_SHORTCUT_MIME_TYPE) {
    return "DRIVE_ENTRY_NOT_IMPORTABLE";
  }
  if (mimeType.startsWith(GOOGLE_APPS_MIME_PREFIX)) return "GOOGLE_WORKSPACE_FILE_UNSUPPORTED";
  return null;
}

// ── tamaño declarado (Fase 8E.1) ────────────────────────────────────────────
export type DriveDeclaredSize =
  { kind: "ok"; bytes: number } | { kind: "unknown" } | { kind: "too_large" };

/** Solo dígitos decimales, sin signo -- el formato real que devuelve Drive. */
const DRIVE_SIZE_PATTERN = /^\d{1,18}$/;

/**
 * Parsea `metadata.size` de forma segura ANTES de gastar una petición de
 * descarga (Fase 8E.1 Sección 3). `size` es un string en la respuesta de
 * Drive: convertirlo con `Number(...)` sin validar el formato admitiría
 * basura (vacío, negativo, notación científica, `NaN`) como si fuera un
 * tamaño válido. Se usa `BigInt` para comparar contra `maxBytes` sin riesgo
 * de overflow de precisión de `Number` en archivos absurdamente grandes,
 * volviendo a `Number` solo una vez confirmado que el valor cabe dentro del
 * límite real del CRM (unos pocos MB).
 *
 * `unknown` cubre tanto "no vino `size`" como "vino con un formato que no
 * podemos confiar": en ambos casos el llamador debe rechazar el archivo
 * ANTES de intentar `alt=media`, nunca proceder a una descarga cuyo tamaño
 * real desconocemos de antemano.
 */
export function parseDriveDeclaredSize(
  size: string | undefined,
  maxBytes: number,
): DriveDeclaredSize {
  if (!size || !DRIVE_SIZE_PATTERN.test(size)) return { kind: "unknown" };
  const asBigInt = BigInt(size);
  if (asBigInt > BigInt(maxBytes)) return { kind: "too_large" };
  return { kind: "ok", bytes: Number(asBigInt) };
}

// ── descarga acotada (Fase 8E) ─────────────────────────────────────────────
export class DriveDownloadTooLargeError extends Error {
  constructor() {
    super("El archivo de Drive supera el límite permitido de tamaño.");
    this.name = "DriveDownloadTooLargeError";
  }
}

/**
 * El cuerpo de la respuesta no llegó como stream (Fase 8E.1 Sección 4).
 *
 * Deliberadamente NO existe una ruta de recuperación con `arrayBuffer()`:
 * eso materializaría la respuesta completa en memoria ANTES de poder
 * comprobar ningún tope, exactamente lo que el streaming acotado existe para
 * evitar. Sin `response.body`, no hay forma segura de acotar la descarga --
 * se falla de forma clasificable (normalmente transitorio: un runtime/fetch
 * que en ese momento no expone streaming).
 */
export class DriveDownloadStreamUnavailableError extends Error {
  constructor() {
    super("La respuesta de Drive no llegó como stream.");
    this.name = "DriveDownloadStreamUnavailableError";
  }
}

/**
 * Los bytes realmente descargados no coinciden con `metadata.size`
 * (Fase 8E.1 Sección 5). No sustituye a la doble comprobación M1/M2: es una
 * verificación adicional barata que puede detectar antes la misma clase de
 * problema (el archivo cambió mientras se descargaba).
 */
export class DriveDownloadSizeMismatchError extends Error {
  constructor() {
    super("El tamaño descargado no coincide con el tamaño declarado por Drive.");
    this.name = "DriveDownloadSizeMismatchError";
  }
}

/**
 * Descarga el contenido de un blob, con un tope REAL de bytes -- nunca se
 * confía solo en `metadata.size` (puede faltar, o estar desactualizado si el
 * archivo cambió). Se lee el cuerpo como stream y se cuenta cada chunk; en
 * cuanto se supera `maxBytes` se aborta la lectura sin haber acumulado el
 * archivo completo en memoria y sin escribir nada en Storage.
 *
 * `expectedSize`, cuando se pasa, es el `metadata.size` ya validado por el
 * llamador (Sección 3): si los bytes reales no coinciden al terminar, se
 * lanza `DriveDownloadSizeMismatchError` en vez de devolver un contenido que
 * no es el que Drive anunció.
 *
 * No usa `webContentLink` (requiere flujo de navegador) ni ninguna URL
 * firmada de Google: la autorización va siempre en la cabecera
 * `Authorization`, resuelta server-side.
 */
export async function downloadDriveFileBounded(
  accessToken: string,
  fileId: string,
  maxBytes: number,
  scope: DriveScope = {},
  expectedSize?: number,
): Promise<Uint8Array> {
  const params = scopedParams({ alt: "media" }, scope);
  const response = await fetch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?${params}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    await response.text().catch(() => "");
    throw new DriveHttpError(response.status);
  }

  // Defensa adicional barata (Sección 6): si Google manda Content-Length y
  // YA excede el tope, ni siquiera hace falta empezar a leer el cuerpo. No
  // es obligatoria -- si falta o no es numérica, se ignora y el contador de
  // stream real (abajo) sigue siendo la autoridad.
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new DriveDownloadTooLargeError();
  }

  if (!response.body) throw new DriveDownloadStreamUnavailableError();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new DriveDownloadTooLargeError();
    }
    chunks.push(value);
  }
  if (expectedSize !== undefined && total !== expectedSize) {
    throw new DriveDownloadSizeMismatchError();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
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
