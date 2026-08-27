/**
 * Fase 8F — primitivas REST de detección de cambios en Google Drive:
 * change feed (`changes.getStartPageToken` / `changes.list`), canal de
 * notificación (`changes.watch` / `channels.stop`), y las dos consultas de
 * solo lectura que la reconciliación necesita para escanear Drive
 * directamente (hijos de una carpeta de Cliente, búsqueda por
 * `appProperties`).
 *
 * Mismo criterio que drive-folders.ts/drive-files.ts: sin Supabase, sin
 * sesión -- recibe un access token ya resuelto, para poder probar el
 * comportamiento real con `fetch` mockeado. Es estrictamente de LECTURA
 * salvo watch/stop (que no tocan ningún archivo ni carpeta, solo el ciclo
 * de vida de una suscripción de notificaciones).
 *
 * Minimización de datos en todos los `fields`: nunca `owners` ni
 * `permissions` completas (Fase 8A/8D/8E, mismo criterio en toda la
 * integración).
 */
import { sha256Hex } from "./drive-storage.server";

const DRIVE_CHANGES_URL = "https://www.googleapis.com/drive/v3/changes";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_CHANNELS_STOP_URL = "https://www.googleapis.com/drive/v3/channels/stop";

export interface DriveScope {
  sharedDriveId?: string | null;
}

/**
 * Params comunes a `changes.list` y `changes.watch`: ambos devuelven (o
 * suscriben a) un LISTADO de elementos, así que ambos aceptan
 * `includeItemsFromAllDrives` para Unidad compartida -- documentado igual
 * en los dos endpoints.
 *
 * `changes/startPageToken` es distinto (Fase 8F.1 Sección 3): no devuelve
 * ningún elemento, solo un cursor, y Google documenta ese endpoint SIN
 * `includeItemsFromAllDrives` -- enviarlo ahí sería un parámetro inventado,
 * no uno real. Por eso NO se reutiliza esta función para ese caso: ver
 * `startPageTokenParams` más abajo.
 */
function scopeParams(extra: Record<string, string>, scope: DriveScope = {}) {
  const params = new URLSearchParams({ supportsAllDrives: "true", ...extra });
  if (scope.sharedDriveId) {
    params.set("driveId", scope.sharedDriveId);
    params.set("includeItemsFromAllDrives", "true");
  }
  return params;
}

/**
 * Params reales de `changes/startPageToken` (Fase 8F.1 Sección 3): solo
 * `supportsAllDrives` y, para Unidad compartida, `driveId`. NUNCA
 * `includeItemsFromAllDrives` -- ese parámetro no existe en este endpoint.
 */
function startPageTokenParams(scope: DriveScope = {}) {
  const params = new URLSearchParams({ supportsAllDrives: "true" });
  if (scope.sharedDriveId) params.set("driveId", scope.sharedDriveId);
  return params;
}

async function driveGet<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    await response.text().catch(() => "");
    const error = new Error(`Google Drive respondió ${response.status}.`);
    Object.assign(error, { status: response.status });
    throw error;
  }
  return (await response.json()) as T;
}

// ── changes.getStartPageToken (Fase 8F Sección 4) ───────────────────────
/**
 * Obtiene T0: el cursor a partir del cual `changes.list` devolverá
 * cambios futuros. NUNCA sustituye a un histórico completo -- captura el
 * punto de partida, no el estado anterior (Sección 5: eso lo cubre la
 * reconciliación).
 */
export async function getGoogleDriveStartPageToken(
  accessToken: string,
  scope: DriveScope = {},
): Promise<string> {
  const params = startPageTokenParams(scope);
  const body = await driveGet<{ startPageToken?: string }>(
    `${DRIVE_CHANGES_URL}/startPageToken?${params}`,
    accessToken,
  );
  if (!body.startPageToken || !body.startPageToken.trim()) {
    throw new Error("Google Drive no devolvió un startPageToken válido.");
  }
  return body.startPageToken;
}

// ── changes.list (Fase 8F Sección 7/8) ──────────────────────────────────
/**
 * Campos mínimos de un archivo dentro de una entrada de `changes.list`.
 * Misma minimización que `DRIVE_INBOUND_FILE_FIELDS` de 8E: sin `owners`
 * ni `permissions`.
 */
const DRIVE_CHANGE_FILE_FIELDS =
  "id,name,mimeType,parents,trashed,size,md5Checksum,modifiedTime,version,webViewLink,driveId,appProperties,capabilities(canDownload)";

const DRIVE_CHANGES_FIELDS = `nextPageToken,newStartPageToken,changes(removed,fileId,changeType,time,driveId,file(${DRIVE_CHANGE_FILE_FIELDS}))`;

export interface DriveChangeFileResource {
  id: string;
  name: string;
  mimeType?: string;
  parents?: string[];
  trashed?: boolean;
  size?: string;
  md5Checksum?: string;
  modifiedTime?: string;
  version?: string;
  webViewLink?: string;
  driveId?: string;
  appProperties?: Record<string, string>;
  capabilities?: { canDownload?: boolean };
}

export interface DriveChangeEntry {
  fileId: string;
  removed: boolean;
  changeType: string;
  time?: string;
  driveId?: string;
  /** Ausente cuando removed=true (Fase 8F Sección 13): nunca asumir presencia. */
  file?: DriveChangeFileResource;
}

export interface DriveChangesPage {
  changes: DriveChangeEntry[];
  /** Presente si hay más páginas -- seguir pidiendo con este token. */
  nextPageToken?: string;
  /** Presente SOLO en la última página. Es el único cursor durable válido. */
  newStartPageToken?: string;
}

interface RawDriveChangeEntry {
  removed?: boolean;
  fileId?: string;
  changeType?: string;
  time?: string;
  driveId?: string;
  file?: DriveChangeFileResource;
}

/**
 * Pide UNA página del feed de cambios a partir de `pageToken`. No pagina
 * internamente -- la decisión de cuándo avanzar el cursor durable
 * (`advance_google_drive_change_token`) pertenece a quien orquesta el
 * poll completo (Fase 8F Sección 8: nunca persistir un `nextPageToken`
 * intermedio como cursor final), así que esta función deliberadamente
 * expone cada página por separado.
 */
export async function listGoogleDriveChangesPage(
  accessToken: string,
  pageToken: string,
  scope: DriveScope = {},
): Promise<DriveChangesPage> {
  const params = scopeParams(
    { pageToken, includeRemoved: "true", fields: DRIVE_CHANGES_FIELDS, pageSize: "1000" },
    scope,
  );
  const body = await driveGet<{
    nextPageToken?: string;
    newStartPageToken?: string;
    changes?: RawDriveChangeEntry[];
  }>(`${DRIVE_CHANGES_URL}?${params}`, accessToken);

  const changes: DriveChangeEntry[] = [];
  for (const raw of body.changes ?? []) {
    if (!raw.fileId) continue;
    changes.push({
      fileId: raw.fileId,
      removed: raw.removed === true,
      changeType: raw.changeType ?? "file",
      ...(raw.time ? { time: raw.time } : {}),
      ...(raw.driveId ? { driveId: raw.driveId } : {}),
      ...(raw.file ? { file: raw.file } : {}),
    });
  }
  return {
    changes,
    ...(body.nextPageToken ? { nextPageToken: body.nextPageToken } : {}),
    ...(body.newStartPageToken ? { newStartPageToken: body.newStartPageToken } : {}),
  };
}

// ── channels.watch / channels.stop (Fase 8F Sección 25/26/34-36) ───────
/** Nunca exceder el máximo real de Google (7 días); margen conservador. */
export const GOOGLE_DRIVE_WATCH_MAX_DURATION_MS = 6 * 24 * 60 * 60 * 1000;
/** Ventana de renovación: a partir de aquí antes de expirar, se renueva. */
export const GOOGLE_DRIVE_WATCH_RENEWAL_WINDOW_MS = 24 * 60 * 60 * 1000;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/**
 * Token de canal aleatorio (Fase 8F Sección 27): 32 bytes -> ~43
 * caracteres base64url, muy por debajo del máximo de 256 que documenta
 * Drive. Se envía en texto plano a Google (es Google quien debe
 * devolverlo en cada notificación para que podamos verificarlo); nunca se
 * persiste en texto plano -- solo su hash, vía `hashGoogleDriveChannelToken`.
 */
export function generateGoogleDriveChannelToken(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

/** SHA-256 hex del token de canal, para comparar en tiempo constante contra lo persistido. */
export async function hashGoogleDriveChannelToken(token: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(token));
}

export interface DriveWatchResult {
  resourceId: string;
  expiration: string | null;
}

/**
 * Suscribe un webhook al feed de cambios a partir de `pageToken` (Sección
 * 25). El `id` del canal lo elige el llamador (se persiste ANTES de
 * llamar aquí, vía `rotate_google_drive_channel`, para que una respuesta
 * perdida nunca deje un canal activo en Google sin rastro local -- ver
 * Sección 28/61, la carrera "sync antes de que watch responda").
 */
export async function watchGoogleDriveChanges(
  accessToken: string,
  input: {
    pageToken: string;
    channelId: string;
    channelToken: string;
    webhookUrl: string;
    expiresAtMs: number;
  },
  scope: DriveScope = {},
): Promise<DriveWatchResult> {
  const params = scopeParams({ pageToken: input.pageToken, includeRemoved: "true" }, scope);
  const response = await fetch(`${DRIVE_CHANGES_URL}/watch?${params}`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      id: input.channelId,
      type: "web_hook",
      address: input.webhookUrl,
      token: input.channelToken,
      expiration: String(input.expiresAtMs),
    }),
  });
  if (!response.ok) {
    await response.text().catch(() => "");
    const error = new Error(`Google Drive respondió ${response.status}.`);
    Object.assign(error, { status: response.status });
    throw error;
  }
  const body = (await response.json()) as { resourceId?: string; expiration?: string };
  if (!body.resourceId) throw new Error("Google Drive no devolvió resourceId al crear el canal.");
  return { resourceId: body.resourceId, expiration: body.expiration ?? null };
}

/**
 * Detiene un canal de notificación (Sección 36). Deliberadamente
 * best-effort desde quien llama: un fallo aquí NUNCA debe invalidar un
 * canal de reemplazo ya creado y persistido (Sección 35/68 -- el
 * solapamiento de dos canales activos es un resultado aceptado, no un
 * error). No es `oauth2.revoke` -- es específico de este canal de
 * notificación, nunca afecta a Calendar ni a ningún otro canal.
 */
export async function stopGoogleDriveChannel(
  accessToken: string,
  input: { channelId: string; resourceId: string },
): Promise<void> {
  const response = await fetch(DRIVE_CHANNELS_STOP_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ id: input.channelId, resourceId: input.resourceId }),
  });
  if (!response.ok) {
    await response.text().catch(() => "");
    const error = new Error(`Google Drive respondió ${response.status}.`);
    Object.assign(error, { status: response.status });
    throw error;
  }
}

// ── escaneo de reconciliación (Fase 8F Sección 41/43/45/46) ─────────────
/** Tope defensivo de páginas, mismo criterio que MAX_DRIVE_FOLDER_PAGES de 8C. */
export const MAX_DRIVE_RECONCILIATION_PAGES = 200;

function escapeDriveQueryValue(value: string) {
  return value.split("\\").join("\\\\").split("'").join("\\'");
}

interface RawDriveListResponse {
  files?: DriveChangeFileResource[];
  nextPageToken?: string;
}

async function listAllPages(
  accessToken: string,
  buildParams: (pageToken: string | null) => URLSearchParams,
): Promise<DriveChangeFileResource[]> {
  const results: DriveChangeFileResource[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < MAX_DRIVE_RECONCILIATION_PAGES; page += 1) {
    const params = buildParams(pageToken);
    const body = await driveGet<RawDriveListResponse>(`${DRIVE_FILES_URL}?${params}`, accessToken);
    for (const file of body.files ?? []) {
      if (file.id && file.name) results.push(file);
    }
    pageToken = body.nextPageToken ?? null;
    if (!pageToken) return results;
  }
  throw new Error(
    "Google Drive devolvió demasiadas páginas durante la reconciliación; revisa la carpeta o la cuenta.",
  );
}

/**
 * Hijos DIRECTOS (archivos y carpetas, sin recursión -- Fase 8F Sección
 * 41/47: "Subfolders: no import") de una carpeta de Cliente vinculada, no
 * en la papelera. Mismos campos mínimos que el change feed.
 */
export async function listGoogleDriveFolderChildren(
  accessToken: string,
  folderId: string,
  scope: DriveScope = {},
): Promise<DriveChangeFileResource[]> {
  const query = `'${escapeDriveQueryValue(folderId)}' in parents and trashed = false`;
  return listAllPages(accessToken, (pageToken) => {
    const params = scopeParams(
      {
        q: query,
        fields: `nextPageToken,files(${DRIVE_CHANGE_FILE_FIELDS})`,
        pageSize: "1000",
        spaces: "drive",
      },
      scope,
    );
    if (pageToken) params.set("pageToken", pageToken);
    return params;
  });
}

/**
 * Búsqueda Drive-side de archivos marcados como documento del CRM (Fase
 * 8F Sección 43/45), para detectar un borrado perdido: un archivo que
 * Drive sigue teniendo con `appProperties.crm_entity=document` pero cuyo
 * `documents` ya no existe en el CRM. Consulta por `appProperties`
 * PRIVADAS -- nunca por nombre, y nunca intenta extraer un UUID del
 * nombre del archivo.
 */
export async function searchGoogleDriveManagedFiles(
  accessToken: string,
  scope: DriveScope = {},
): Promise<DriveChangeFileResource[]> {
  const query = "appProperties has { key='crm_entity' and value='document' } and trashed = false";
  return listAllPages(accessToken, (pageToken) => {
    const params = scopeParams(
      {
        q: query,
        fields: `nextPageToken,files(${DRIVE_CHANGE_FILE_FIELDS})`,
        pageSize: "1000",
        spaces: "drive",
      },
      scope,
    );
    if (pageToken) params.set("pageToken", pageToken);
    return params;
  });
}
