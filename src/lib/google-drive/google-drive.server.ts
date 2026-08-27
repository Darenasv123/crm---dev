import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth-server";
import { readServerRuntimeEnv } from "@/lib/server-runtime-env";
import { DriveError, driveErrorFromPostgres, isDriveError } from "./drive-errors";
import { getDriveFolder, listChildDriveFolders, type DriveFolder } from "./drive-folders";
import { computeOnboardingPreview, matchClientToFolders } from "./client-folder-matching";

/**
 * Fase 8B — fundación server-side de Google Drive.
 * Fase 8B.1 — hardening: independencia total de Calendar.
 *
 * Este módulo NO importa nada de google-calendar.server.ts. La versión
 * inicial de 8B reutilizaba cuatro helpers exportados desde ahí
 * (timingSafeEqual, safeServerError, isStaleProcessing,
 * STALE_PROCESSING_MS); eso creaba un acoplamiento en tiempo de
 * compilación entre dos integraciones que deben poder evolucionar y
 * fallar de forma independiente -- un cambio en el umbral de staleness de
 * Calendar, por ejemplo, habría alterado silenciosamente el
 * comportamiento de la cola de Drive. Ahora Drive tiene sus propias
 * implementaciones equivalentes, con sus propios tests.
 *
 * Esto NO es un refactor de Calendar: google-calendar.server.ts queda
 * exactamente igual, conservando sus exports (que sus propios tests
 * verifican). La duplicación resultante es deliberada y está documentada
 * como deuda técnica: un futuro "extraer primitivas OAuth compartidas"
 * podría unificarlas DESPUÉS del release, siempre verificando que los
 * tests de Calendar sigan intactos.
 *
 * OAuth client completamente separado de Calendar (GOOGLE_DRIVE_CLIENT_ID/
 * SECRET/REDIRECT_URI) -- nunca hace fallback a GOOGLE_CLIENT_ID/SECRET si
 * faltan las variables de Drive. Drive es opcional: su ausencia nunca
 * impide que el CRM arranque (ninguna de estas funciones lee env en el
 * nivel superior del módulo, solo dentro de cada función, al invocarse).
 *
 * REVOCACIÓN REMOTA: este módulo nunca llama al endpoint de revoke de
 * Google. Revocar un token OAuth revoca los grants a nivel de PROYECTO de
 * Google Cloud, no solo los del OAuth client que lo emitió -- mientras
 * Calendar y Drive compartan proyecto, revocar Drive podría invalidar los
 * tokens de Calendar y romper una integración productiva. La desconexión
 * es exclusivamente local (destruye el ciphertext del refresh token, ver
 * disconnectGoogleDrive). La revocación remota solo se reintroducirá
 * cuando Drive tenga su propio proyecto de Google Cloud dedicado, tal como
 * documenta server-release/docs/GOOGLE_DRIVE_CONFIGURATION.md.
 */

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

// Scope completo (Fase 8A Sección S): drive.file no cubre detectar archivos
// que un abogado añade directamente en Drive fuera del CRM, requisito
// central del diseño. Centralizado aquí, en una sola constante.
export const GOOGLE_DRIVE_SCOPES = "openid email https://www.googleapis.com/auth/drive";

const textEncoder = new TextEncoder();

export type DriveConnection = {
  id: string;
  connected_by: string;
  google_account_email: string | null;
  // Nullable: al desconectar se destruye el ciphertext (Fase 8B.1).
  encrypted_refresh_token: string | null;
  granted_scopes: string | null;
  root_folder_id: string | null;
  root_folder_name: string | null;
  /** null => Mi unidad. Con valor => Unidad compartida (Fase 8C Sección 6). */
  shared_drive_id: string | null;
  status: string;
  last_synced_at: string | null;
  last_error: string | null;
  /** Cursor durable del change feed (Fase 8F). NULL = tracking sin inicializar. */
  changes_page_token: string | null;
  changes_initialized_at: string | null;
  last_changes_polled_at: string | null;
  last_reconciled_at: string | null;
  reconciliation_claimed_at: string | null;
};

function serverSecret(name: string) {
  const value = readServerRuntimeEnv(name);
  if (!value) throw new Error(`Falta la configuración de servidor ${name}.`);
  return value;
}

function optionalServerSecret(name: string) {
  return readServerRuntimeEnv(name);
}

/** true solo si las 3 variables del OAuth client de Drive están presentes. */
export function isGoogleDriveConfigured() {
  return Boolean(
    optionalServerSecret("GOOGLE_DRIVE_CLIENT_ID") &&
    optionalServerSecret("GOOGLE_DRIVE_CLIENT_SECRET") &&
    optionalServerSecret("GOOGLE_DRIVE_REDIRECT_URI"),
  );
}

function requireGoogleDriveConfigured() {
  if (!isGoogleDriveConfigured()) {
    throw new Error("Google Drive no está configurado en este servidor.");
  }
}

export function adminClient() {
  return createClient(serverSecret("SUPABASE_URL"), serverSecret("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function randomToken(bytes = 32) {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256(value: string) {
  return base64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(value))),
  );
}

// Reutiliza GOOGLE_OAUTH_STATE_SECRET (Sección 3 del pedido: mismo secreto
// genérico que ya usa Calendar para firmar su propio state, no un secreto
// nuevo por servicio).
async function hmac(value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(serverSecret("GOOGLE_OAUTH_STATE_SECRET")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(
    new Uint8Array(await crypto.subtle.sign("HMAC", key, textEncoder.encode(value))),
  );
}

// Reutiliza GOOGLE_TOKEN_ENCRYPTION_KEY (misma razón que arriba).
async function encryptionKey() {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(serverSecret("GOOGLE_TOKEN_ENCRYPTION_KEY")),
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

// Exportadas únicamente para testabilidad directa (Fase 8B Sección 42),
// mismo criterio que ya usa google-calendar.server.ts al exportar
// timingSafeEqual/eventStart/isStaleProcessing pese a no ser "API pública"
// en sentido de UI -- son primitivas puras sin efectos secundarios más allá
// del cómputo, cifrar/descifrar en aislamiento es exactamente lo que la
// fase pide poder probar sin montar todo el flujo OAuth.
export async function encryptToken(token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await encryptionKey(),
      textEncoder.encode(token),
    ),
  );
  const packed = new Uint8Array(iv.length + encrypted.length);
  packed.set(iv);
  packed.set(encrypted, iv.length);
  return base64Url(packed);
}

export async function decryptToken(value: string) {
  const packed = fromBase64Url(value);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: packed.slice(0, 12) },
    await encryptionKey(),
    packed.slice(12),
  );
  return new TextDecoder().decode(decrypted);
}

/**
 * Comparación en tiempo constante. Implementación propia de Drive (Fase
 * 8B.1): idéntica en semántica a la de Calendar, pero sin importarla, para
 * que las dos integraciones no compartan superficie de código.
 */
export async function timingSafeEqual(left: string, right: string) {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

/**
 * Umbral para considerar "abandonada" una operación de la cola de Drive en
 * estado 'processing' (p. ej. el proceso Node murió a mitad de un job).
 * Propio de Drive, independiente del de Calendar: las operaciones de Drive
 * (subir/descargar archivos) pueden tardar considerablemente más que un
 * poll de eventos de calendario, así que su umbral debe poder ajustarse sin
 * tocar Calendar.
 */
export const GOOGLE_DRIVE_STALE_PROCESSING_MS = 15 * 60 * 1000;

/**
 * Determina si una operación 'processing' debe reclamarse de vuelta a
 * 'pending'. Usa `claimed_at` (fijado por el propio claim atómico), NUNCA
 * `created_at` -- created_at solo refleja cuándo se encoló la operación, no
 * cuándo un worker empezó a procesarla; una operación puede esperar en
 * 'pending' un tiempo arbitrario antes de reclamarse, y usar created_at
 * marcaría como abandonado un job que acaba de empezar, permitiendo que dos
 * workers lo procesen a la vez. (Mismo bug real que ya se corrigió en la
 * cola de Calendar; aquí la semántica correcta está desde el principio.)
 *
 * `claimedAt` null se trata como "no abandonado": más seguro no reclamar
 * por falta de evidencia que reclamar por error.
 */
export function isGoogleDriveStaleProcessing(
  claimedAt: string | null,
  now: Date = new Date(),
): boolean {
  if (!claimedAt) return false;
  return now.getTime() - new Date(claimedAt).getTime() > GOOGLE_DRIVE_STALE_PROCESSING_MS;
}

/**
 * Traduce un error interno a una respuesta HTTP segura: nunca stack traces,
 * nunca el cuerpo crudo de la respuesta de Google, nunca secretos.
 * Implementación propia de Drive (Fase 8B.1), equivalente a la de Calendar.
 */
export function safeServerError(cause: unknown) {
  // Fase 8C: los errores tipados de Drive llevan su propio código estable y
  // su propio status. Se devuelve el `code` para que la UI pueda reaccionar
  // (p. ej. ofrecer "revisar coincidencias" cuando falta la raíz) sin tener
  // que interpretar el texto del mensaje.
  if (isDriveError(cause)) {
    return Response.json({ error: cause.message, code: cause.code }, { status: cause.status });
  }
  const message = cause instanceof Error ? cause.message : "Solicitud no válida.";
  // Status explícito cuando quien lanza el error ya sabe cuál corresponde,
  // en vez de depender de que el texto case con la heurística de abajo.
  const explicitStatus =
    cause instanceof Error ? (cause as unknown as { httpStatus?: unknown }).httpStatus : undefined;
  const explicit = typeof explicitStatus === "number" ? explicitStatus : null;
  const status =
    explicit ??
    (/sesión|permiso/i.test(message)
      ? 403
      : /falta|indica|inválid|expir|configurad/i.test(message)
        ? 400
        : 500);
  return Response.json({ error: message }, { status });
}

/** Error de validación de entrada: 400 explícito, sin depender del texto. */
function badRequest(message: string) {
  const error = new Error(message);
  Object.assign(error, { httpStatus: 400 });
  return error;
}

function bearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

async function requireAdmin(request: Request) {
  const accessToken = bearerToken(request);
  if (!accessToken) throw new Error("Falta la sesión autenticada.");
  const user = await requireUser(accessToken);
  const db = adminClient();
  const { data: profile, error } = await db
    .from("profiles")
    .select("role, status")
    .eq("id", user.id)
    .single();
  if (error || !profile || profile.status !== "Activo" || profile.role !== "Administrador") {
    throw new Error("No tienes permiso para administrar esta integración.");
  }
  return { user, db };
}

/**
 * Fase 8D: resuelve al usuario autenticado y su rol SIN exigir que sea
 * Administrador. Los productores de sincronización (subir un documento,
 * crear un cliente) los usa también Personal, así que cada endpoint aplica
 * el permiso real de la operación del CRM que está reflejando -- vía los
 * resolvers de src/lib/permissions.ts, nunca comparando el string del rol.
 */
export async function requireActiveActor(request: Request) {
  const accessToken = bearerToken(request);
  if (!accessToken) throw new Error("Falta la sesión autenticada.");
  const user = await requireUser(accessToken);
  const db = adminClient();
  const { data: profile, error } = await db
    .from("profiles")
    .select("role, status")
    .eq("id", user.id)
    .single();
  if (error || !profile || profile.status !== "Activo") {
    throw new Error("No tienes permiso para realizar esta acción.");
  }
  return { user, db, role: profile.role as string };
}

async function googleFetch<T>(
  url: string,
  options: RequestInit & { accessToken?: string } = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.accessToken) headers.set("authorization", `Bearer ${options.accessToken}`);
  if (options.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`Google Drive respondió ${response.status}.`);
    Object.assign(error, { status: response.status, safeBody: body.slice(0, 500) });
    throw error;
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export async function activeDriveConnection() {
  const db = adminClient();
  const { data, error } = await db
    .from("google_drive_connections")
    .select("*")
    .eq("status", "connected")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as DriveConnection | null;
}

/**
 * Access token bajo demanda -- nunca se persiste, solo se pide al vuelo.
 *
 * Rechaza explícitamente cualquier conexión que no esté 'connected' o que
 * ya no conserve token (Fase 8B.1): tras una desconexión local el
 * ciphertext se destruye, así que una conexión vieja nunca puede volver a
 * obtener acceso aunque alguien recupere su fila.
 */
export async function accessTokenForDrive(connection: DriveConnection) {
  if (connection.status !== "connected" || !connection.encrypted_refresh_token) {
    throw new Error("La conexión de Google Drive está desconectada.");
  }
  const refreshToken = await decryptToken(connection.encrypted_refresh_token);
  const body = new URLSearchParams({
    client_id: serverSecret("GOOGLE_DRIVE_CLIENT_ID"),
    client_secret: serverSecret("GOOGLE_DRIVE_CLIENT_SECRET"),
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`Google OAuth respondió ${response.status}.`);
  const token = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!token.access_token) throw new Error("Google no devolvió un access token.");
  const expiresAt = new Date(Date.now() + (token.expires_in ?? 3600) * 1000).toISOString();
  await adminClient()
    .from("google_drive_connections")
    .update({ access_token_expires_at: expiresAt })
    .eq("id", connection.id);
  return token.access_token;
}

// Deliberadamente NO existe ninguna función de revocación remota en este
// módulo -- ver la nota de REVOCACIÓN REMOTA en la cabecera del archivo.

// ── OAuth: connect ─────────────────────────────────────────────────────
export async function beginGoogleDriveOAuth(request: Request) {
  requireGoogleDriveConfigured();
  const { user, db } = await requireAdmin(request);

  const nonce = randomToken();
  const expiresAt = Date.now() + 10 * 60 * 1000;
  const unsignedState = `${nonce}.${expiresAt}`;
  const state = `${unsignedState}.${await hmac(unsignedState)}`;
  const verifier = randomToken(64);
  const challenge = await sha256(verifier);

  const { error: stateError } = await db.from("google_drive_oauth_states").insert({
    state_hash: await sha256(state),
    requested_by: user.id,
    code_verifier: verifier,
    expires_at: new Date(expiresAt).toISOString(),
  });
  if (stateError) throw new Error("No se pudo iniciar la autorización de Google Drive.");

  const params = new URLSearchParams({
    client_id: serverSecret("GOOGLE_DRIVE_CLIENT_ID"),
    redirect_uri: serverSecret("GOOGLE_DRIVE_REDIRECT_URI"),
    response_type: "code",
    scope: GOOGLE_DRIVE_SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return { authorizationUrl: `${GOOGLE_AUTH_URL}?${params}` };
}

// ── OAuth: callback ─────────────────────────────────────────────────────
export async function completeGoogleDriveOAuth(request: Request) {
  requireGoogleDriveConfigured();
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const [nonce, expiration, signature] = state.split(".");
  if (!code || !nonce || !expiration || !signature) throw new Error("Respuesta OAuth incompleta.");
  const unsignedState = `${nonce}.${expiration}`;
  if (
    !(await timingSafeEqual(signature, await hmac(unsignedState))) ||
    Number(expiration) < Date.now()
  ) {
    throw new Error("El estado OAuth es inválido o expiró.");
  }

  const db = adminClient();
  const stateHash = await sha256(state);
  // Consumo de un solo uso: DELETE...RETURNING en la misma operación --
  // reutilizar el mismo state dos veces (ej. doble clic, replay) siempre
  // falla en el segundo intento porque la fila ya no existe.
  const { data: oauthState, error } = await db
    .from("google_drive_oauth_states")
    .delete()
    .eq("state_hash", stateHash)
    .gt("expires_at", new Date().toISOString())
    .select()
    .single();
  if (error || !oauthState) throw new Error("La autorización ya fue utilizada o expiró.");

  const { data: requester, error: requesterError } = await db
    .from("profiles")
    .select("role, status")
    .eq("id", oauthState.requested_by)
    .single();
  if (
    requesterError ||
    !requester ||
    requester.status !== "Activo" ||
    requester.role !== "Administrador"
  ) {
    throw new Error("La persona que inició la autorización ya no tiene permiso.");
  }

  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: serverSecret("GOOGLE_DRIVE_CLIENT_ID"),
      client_secret: serverSecret("GOOGLE_DRIVE_CLIENT_SECRET"),
      redirect_uri: serverSecret("GOOGLE_DRIVE_REDIRECT_URI"),
      grant_type: "authorization_code",
      code_verifier: oauthState.code_verifier,
    }),
  });
  if (!tokenResponse.ok) throw new Error(`Google OAuth respondió ${tokenResponse.status}.`);
  const tokens = (await tokenResponse.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("Google no entregó acceso offline; vuelve a autorizar la cuenta.");
  }
  const grantedScopes = tokens.scope ?? "";
  if (!grantedScopes.split(" ").includes("https://www.googleapis.com/auth/drive")) {
    // Falla de forma segura y explicable: nunca persistir una conexión sin
    // el scope que el resto del diseño asume que existe. No se revoca el
    // token recién emitido -- revocar afectaría a los grants de todo el
    // proyecto de Google Cloud (ver cabecera del archivo); simplemente no
    // se guarda, y expira por su cuenta sin haberse usado nunca.
    throw new Error(
      "Google no concedió el permiso de Drive requerido. Vuelve a intentar y acepta el acceso completo.",
    );
  }

  const userInfo = await googleFetch<{ email?: string }>(
    "https://openidconnect.googleapis.com/v1/userinfo",
    { accessToken: tokens.access_token },
  ).catch(() => ({ email: undefined }));

  // Sustitución ATÓMICA de la conexión activa (Fase 8B.1): un único RPC
  // desactiva la anterior (destruyendo su ciphertext) e inserta la nueva
  // dentro de la misma transacción de Postgres. La versión anterior hacía
  // SELECT -> DELETE -> INSERT desde el cliente, en pasos separados: dos
  // callbacks concurrentes podían borrar la conexión válida y competir por
  // el INSERT, pudiendo dejar el sistema sin ninguna conexión activa.
  const { data: connection, error: connectionError } = await db.rpc(
    "replace_google_drive_connection",
    {
      p_connected_by: oauthState.requested_by,
      p_google_account_email: userInfo.email ?? null,
      p_encrypted_refresh_token: await encryptToken(tokens.refresh_token),
      p_access_token_expires_at: new Date(
        Date.now() + (tokens.expires_in ?? 3600) * 1000,
      ).toISOString(),
      p_granted_scopes: grantedScopes,
    },
  );
  if (connectionError || !connection) {
    throw new Error(connectionError?.message ?? "No se guardó la conexión de Drive.");
  }

  // Fase 8B es solo fundación: NO se lista Drive, NO se crea watch channel,
  // NO se toca root_folder_id aquí (Sección 49). Eso es 8C+.
  return { connectionId: connection.id };
}

// ── status ──────────────────────────────────────────────────────────────
/**
 * Fase 8F Sección 50/51: extensión MÍNIMA del status -- no es un dashboard,
 * solo lo suficiente para que un Administrador vea si el tracking automático
 * está inicializado, si hay un webhook activo, cuándo corrió el último poll/
 * reconciliation, y cuántos conflictos hay pendientes (solo el número: nunca
 * se listan documentos completos aquí).
 */
async function googleDriveAutomaticSyncStatus(connectionId: string) {
  const db = adminClient();
  const [{ data: channel }, { count: documentConflicts }, { count: folderConflicts }] =
    await Promise.all([
      db
        .from("google_drive_channels")
        .select("expires_at, stopped_at, superseded_at")
        .eq("connection_id", connectionId)
        .is("superseded_at", null)
        .maybeSingle(),
      db
        .from("google_drive_document_files")
        .select("id", { count: "exact", head: true })
        .eq("connection_id", connectionId)
        .eq("sync_status", "conflict"),
      db
        .from("google_drive_client_folders")
        .select("id", { count: "exact", head: true })
        .eq("connection_id", connectionId)
        .eq("sync_status", "conflict"),
    ]);
  const webhookActive = Boolean(channel && !channel.stopped_at);
  return {
    webhookActive,
    watchExpiresAt: webhookActive ? channel!.expires_at : null,
    conflictCount: (documentConflicts ?? 0) + (folderConflicts ?? 0),
  };
}

export async function googleDriveConnectionStatus(request: Request) {
  await requireAdmin(request);
  if (!isGoogleDriveConfigured()) {
    return { configured: false, connected: false } as const;
  }
  const connection = await activeDriveConnection();
  if (!connection) return { configured: true, connected: false } as const;
  const automaticSync = await googleDriveAutomaticSyncStatus(connection.id);
  return {
    configured: true,
    connected: true,
    accountEmail: connection.google_account_email,
    rootFolderConfigured: Boolean(connection.root_folder_id),
    // El nombre es lo que se muestra; el ID viaja solo porque el navegador
    // de carpetas necesita saber en qué carpeta abrirse para re-seleccionar
    // la raíz. La UI nunca lo imprime en pantalla (Fase 8C Sección 15).
    rootFolderName: connection.root_folder_name,
    rootFolderId: connection.root_folder_id,
    status: connection.status,
    lastSyncedAt: connection.last_synced_at,
    // Nunca el mensaje crudo de Google ni ningún dato técnico -- solo lo
    // que ya se saneó/generó desde este propio módulo.
    lastError: connection.last_error,
    // Fase 8F: sincronización automática. `changeTrackingInitialized` en
    // `false` significa que ningún poll_changes puede correr todavía --
    // el maintenance lo inicializa (bootstrap), nunca esta ruta de status.
    changeTrackingInitialized: Boolean(connection.changes_page_token),
    lastChangesPolledAt: connection.last_changes_polled_at,
    lastReconciledAt: connection.last_reconciled_at,
    ...automaticSync,
  } as const;
}

// ── disconnect ──────────────────────────────────────────────────────────
/**
 * Desconexión EXCLUSIVAMENTE LOCAL (Fase 8B.1).
 *
 * No llama a Google en ningún momento: revocar el token revocaría los
 * grants de todo el proyecto de Google Cloud, lo que mientras Calendar y
 * Drive compartan proyecto podría invalidar los tokens de Calendar y
 * romper una integración productiva ajena a esta acción.
 *
 * La fila NO se borra: se marca 'disconnected' y se destruye su
 * `encrypted_refresh_token` (a NULL) dentro de una única sentencia SQL, de
 * modo que una conexión desconectada nunca conserva material reutilizable.
 * Conservar la fila deja rastro auditable de quién conectó y cuándo.
 *
 * Nunca borra Clientes, Documentos ni ninguna fila de Calendar.
 */
export async function disconnectGoogleDrive(request: Request) {
  await requireAdmin(request);
  const db = adminClient();
  const { error } = await db.rpc("disconnect_google_drive_connection");
  if (error) throw new Error(error.message);
  return { disconnected: true };
}

// ── Queue helpers (solo infraestructura -- sin procesamiento real de
// archivos en 8B, ver Sección 37) ────────────────────────────────────────

export type GoogleDriveQueueOperation =
  | "poll_changes"
  | "ensure_client_folder"
  | "upload_document"
  | "update_document"
  | "rename_document"
  | "trash_document"
  | "import_drive_file";

export interface EnqueueGoogleDriveOperationInput {
  connectionId: string;
  operation: GoogleDriveQueueOperation;
  dedupeKey: string;
  clientId?: string | null;
  documentId?: string | null;
  driveFileId?: string | null;
  payload?: Record<string, unknown>;
  availableAt?: Date;
}

/**
 * Encola una operación. La garantía real contra duplicados es el índice
 * único parcial de la migración (dedupe_key, WHERE status IN
 * (pending,processing)) -- este insert puede fallar con una violación de
 * unicidad si ya existe una operación lógica equivalente activa, y eso es
 * el comportamiento correcto (nunca "buscar antes de insertar").
 */
export async function enqueueGoogleDriveOperation(input: EnqueueGoogleDriveOperationInput) {
  const db = adminClient();
  const { data, error } = await db
    .from("google_drive_sync_queue")
    .insert({
      connection_id: input.connectionId,
      operation: input.operation,
      dedupe_key: input.dedupeKey,
      client_id: input.clientId ?? null,
      document_id: input.documentId ?? null,
      drive_file_id: input.driveFileId ?? null,
      payload: input.payload ?? {},
      available_at: (input.availableAt ?? new Date()).toISOString(),
    })
    .select("id")
    .maybeSingle();
  if (error) {
    // Violación del índice único parcial de dedupe: ya existe una
    // operación equivalente pending/processing -- no es un error real, es
    // el mecanismo de dedupe funcionando.
    if (error.code === "23505") return { deduplicated: true as const };
    throw new Error(error.message);
  }
  return { deduplicated: false as const, id: data?.id ?? null };
}

/**
 * Claim atómico vía la función SQL claim_google_drive_sync_operations
 * (SELECT...FOR UPDATE SKIP LOCKED + UPDATE + RETURNING, ver la migración).
 * Ningún otro worker concurrente puede reclamar las mismas filas.
 */
export async function claimGoogleDriveOperations(limit = 10) {
  const db = adminClient();
  const { data, error } = await db.rpc("claim_google_drive_sync_operations", { p_limit: limit });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function markGoogleDriveOperationCompleted(id: number) {
  const db = adminClient();
  await db
    .from("google_drive_sync_queue")
    .update({ status: "completed", processed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "processing");
}

/** last_error se sanea antes de llegar aquí -- nunca la respuesta cruda de Google. */
export async function markGoogleDriveOperationFailed(id: number, sanitizedError: string) {
  const db = adminClient();
  await db
    .from("google_drive_sync_queue")
    .update({
      status: "failed",
      last_error: sanitizedError.slice(0, 500),
      processed_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "processing");
}

/**
 * Recupera operaciones "processing" abandonadas usando claimed_at, NUNCA
 * created_at (ver isGoogleDriveStaleProcessing para el razonamiento y el
 * bug real que esa distinción evita). Usa el umbral propio de Drive, no el
 * de Calendar.
 */
export async function requeueStaleGoogleDriveOperations() {
  const db = adminClient();
  const staleCutoff = new Date(Date.now() - GOOGLE_DRIVE_STALE_PROCESSING_MS).toISOString();
  const { data, error } = await db
    .from("google_drive_sync_queue")
    .update({ status: "pending", claimed_at: null })
    .eq("status", "processing")
    .lt("claimed_at", staleCutoff)
    .select("id");
  if (error) throw new Error(error.message);
  return { requeued: data?.length ?? 0 };
}

// ── appProperties (Sección 36 -- diseño puro, sin files.create todavía) ──
/**
 * Metadata privada de aplicación para archivos que el CRM cree en Drive
 * (Fase 8D+). Minimización de datos deliberada: nunca DNI, nombre del
 * cliente, materia ni ningún dato jurídico -- solo los dos IDs internos
 * necesarios para reconciliar el mapping si se perdiera (defensa
 * adicional, nunca reemplazo del mapping persistido en
 * google_drive_document_files, ver Fase 8A Sección 13).
 */
export function buildDriveAppProperties(documentId: string, clientId: string) {
  return {
    crm_document_id: documentId,
    crm_client_id: clientId,
  };
}

// ── Fase 8C: navegación de carpetas, carpeta raíz y onboarding ───────────
//
// NO se usa Google Picker. Picker exige entregar al navegador un access
// token de Drive (y además una API key de browser), y en esta arquitectura
// la conexión representa a TODO el estudio, no al usuario que tiene el
// navegador abierto: filtrar ese token al front daría acceso directo a todo
// el Drive del estudio desde la consola del navegador, fuera de las
// restricciones que aplican estos endpoints. Por eso el navegador de
// carpetas es propio y 100% server-side; el token nunca sale del servidor.
// Documentado en server-release/docs/GOOGLE_DRIVE_CONFIGURATION.md.

/** Alias de Drive para la raíz de "Mi unidad": no es un folderId real. */
const MY_DRIVE_ROOT_ALIAS = "root";
const MY_DRIVE_ROOT_LABEL = "Mi unidad";

/** Tope de vinculaciones por lote: evita un apply gigante que agote la cuota. */
const MAX_ONBOARDING_MAPPINGS = 500;

const APPLICABLE_MATCH_TYPES = ["exact", "normalized", "manual"] as const;
export type ApplicableMatchType = (typeof APPLICABLE_MATCH_TYPES)[number];

/**
 * Valida un identificador de carpeta recibido del cliente. No comprueba que
 * exista (eso lo hace Google), solo que sea un valor plausible: sin saltos
 * de línea (que permitirían romper la query o inyectar cabeceras), sin
 * espacios en los bordes y de longitud razonable.
 */
export function assertValidDriveFolderId(value: unknown): string {
  if (typeof value !== "string") throw badRequest("Falta el identificador de la carpeta.");
  // Se comprueba el valor CRUDO, antes de recortar: un "F_ANA\r\n" recortado
  // pasaría inadvertido, y aceptar en silencio un valor con saltos de línea
  // -- aunque aquí acabe siendo inofensivo -- normaliza justo lo que no se
  // debe normalizar.
  if (/[\r\n\t]/.test(value)) throw badRequest("El identificador de la carpeta no es válido.");
  const folderId = value.trim();
  if (!folderId) throw badRequest("Falta el identificador de la carpeta.");
  if (folderId.length > 256) throw badRequest("El identificador de la carpeta no es válido.");
  return folderId;
}

async function requireConnectedDrive(request: Request) {
  await requireAdmin(request);
  if (!isGoogleDriveConfigured()) throw new DriveError("DRIVE_NOT_CONFIGURED");
  const connection = await activeDriveConnection();
  if (!connection) throw new DriveError("DRIVE_NOT_CONNECTED");
  const accessToken = await accessTokenForDrive(connection);
  return { connection, accessToken, db: adminClient() };
}

function folderDto(folder: DriveFolder) {
  // DTO explícito: nunca se reenvía la respuesta cruda de Google (que podría
  // traer campos que no pedimos si la API cambia).
  return { id: folder.id, name: folder.name, driveId: folder.driveId ?? null };
}

// ── navegador de carpetas ────────────────────────────────────────────────
/**
 * Lista las subcarpetas directas de `parentId` (o de "Mi unidad" si no se
 * indica). Solo carpetas: este endpoint NO es un proxy genérico a Drive --
 * el cliente no puede enviar `q`, `fields` ni ninguna URL; el servidor
 * construye la consulta entera.
 *
 * `current.parentId` viene de la metadata real de Google y es la única
 * autoridad para el botón "subir un nivel": nunca se acepta como autoridad
 * un parentId enviado por el navegador (Fase 8C Sección 11).
 */
export async function browseGoogleDriveFolders(request: Request, rawParentId?: string | null) {
  const { connection, accessToken } = await requireConnectedDrive(request);
  const sharedDriveId = connection.shared_drive_id;
  const parentId = rawParentId ? assertValidDriveFolderId(rawParentId) : MY_DRIVE_ROOT_ALIAS;

  if (parentId === MY_DRIVE_ROOT_ALIAS) {
    const folders = await listChildDriveFolders(accessToken, MY_DRIVE_ROOT_ALIAS, {
      sharedDriveId,
    });
    return {
      current: { id: MY_DRIVE_ROOT_ALIAS, name: MY_DRIVE_ROOT_LABEL, parentId: null },
      folders: folders.map(folderDto),
    };
  }

  const current = await getDriveFolder(accessToken, parentId, { sharedDriveId });
  const folders = await listChildDriveFolders(accessToken, parentId, { sharedDriveId });
  return {
    current: {
      id: current.id,
      name: current.name,
      parentId: current.parents?.[0] ?? null,
    },
    folders: folders.map(folderDto),
  };
}

// ── carpeta raíz ─────────────────────────────────────────────────────────
/**
 * Fija la carpeta raíz de Clientes. El nombre SIEMPRE se toma de la
 * metadata real de Google, nunca de lo que envíe el frontend: si se
 * aceptara un nombre del cliente, la UI podría mostrar "Clientes" mientras
 * la raíz real apunta a otra carpeta.
 *
 * Cambiar la raíz cuando ya existen vinculaciones queda bloqueado: esos
 * clientes apuntan a carpetas que probablemente quedarían fuera del nuevo
 * árbol, y resolver eso requiere una operación explícita de desvinculación
 * o re-onboarding que esta fase no implementa.
 *
 * NO crea carpetas, NO importa documentos y NO arranca el changes feed.
 *
 * Fase 8C.1: la escritura ya no se hace con un UPDATE suelto desde aquí,
 * sino con la RPC set_google_drive_root_folder, que toma FOR UPDATE sobre la
 * fila de la conexión. Entre que se lee la conexión y se valida la carpeta
 * en Google pasa una llamada de red entera; en esa ventana otra petición
 * podía cambiar la raíz o insertar vinculaciones. Se envía la raíz que se
 * leyó al empezar (expectedCurrentRootFolderId) para que la RPC rechace la
 * operación si el estado se movió mientras tanto, en vez de pisarlo.
 */
export async function setGoogleDriveRootFolder(request: Request, rawFolderId: unknown) {
  const folderId = assertValidDriveFolderId(rawFolderId);
  const { connection, accessToken, db } = await requireConnectedDrive(request);

  // Valida existencia, que sea carpeta y que no esté en la papelera.
  const folder = await getDriveFolder(accessToken, folderId, {
    sharedDriveId: connection.shared_drive_id,
  });

  const { data, error } = await db.rpc("set_google_drive_root_folder", {
    p_connection_id: connection.id,
    p_expected_current_root_folder_id: connection.root_folder_id,
    p_new_root_folder_id: folder.id,
    p_new_root_folder_name: folder.name,
    // Si la carpeta vive en una Unidad compartida, Drive devuelve driveId;
    // se persiste para que las llamadas siguientes usen los parámetros
    // correctos. En Mi unidad no viene y se conserva null.
    p_new_shared_drive_id: folder.driveId ?? null,
  });
  if (error) {
    const driveError = driveErrorFromPostgres(error.message);
    if (driveError) throw driveError;
    throw new Error("No se pudo guardar la carpeta raíz.");
  }

  const result = (data ?? {}) as { unchanged?: boolean };
  return {
    rootFolderName: folder.name,
    rootFolderId: folder.id,
    unchanged: Boolean(result.unchanged),
  };
}

// ── onboarding: preview (solo lectura) ───────────────────────────────────
export interface OnboardingPreviewDto {
  rootFolderName: string;
  linked: Array<{ clientId: string; clientName: string; folderId: string; folderName: string }>;
  suggested: Array<{
    clientId: string;
    clientName: string;
    folderId: string;
    folderName: string;
    matchType: ApplicableMatchType;
  }>;
  ambiguous: Array<{
    clientId: string;
    clientName: string;
    candidates: Array<{ id: string; name: string }>;
  }>;
  clientsWithoutFolder: Array<{ clientId: string; clientName: string }>;
  foldersWithoutClient: Array<{ id: string; name: string }>;
  /** Carpetas aún libres, para poblar el selector de los ambiguos. */
  availableFolders: Array<{ id: string; name: string }>;
}

/**
 * Vista previa Cliente <-> Carpeta. Estrictamente de solo lectura: no
 * escribe en Supabase ni en Drive.
 *
 * Reutiliza `computeOnboardingPreview` de Fase 8A sin reimplementar nada del
 * matching. Un matiz importante: esa función mete en `linked` tanto los
 * mappings YA persistidos como las coincidencias EXACTAS recién detectadas,
 * porque en 8A ambas eran "el cliente tiene carpeta". Aquí no pueden
 * mezclarse: mostrar una coincidencia exacta bajo "Ya vinculados" haría
 * creer al Administrador que ya está guardada cuando no lo está, y esta
 * fase exige que toda vinculación se confirme explícitamente. Se separan
 * usando la única fuente fiable de lo que está persistido -- el conjunto de
 * mappings leído de la base de datos -- sin tocar la lógica de matching.
 */
export async function googleDriveOnboardingPreview(
  request: Request,
): Promise<OnboardingPreviewDto> {
  const { connection, accessToken, db } = await requireConnectedDrive(request);
  if (!connection.root_folder_id) throw new DriveError("DRIVE_ROOT_NOT_CONFIGURED");

  const folders = await listChildDriveFolders(accessToken, connection.root_folder_id, {
    sharedDriveId: connection.shared_drive_id,
  });

  // Minimización de datos: al matching solo llegan id y nombre. Ni
  // teléfonos, ni correos, ni documentos.
  const { data: clientRows, error: clientsError } = await db
    .from("clients")
    .select("id, name")
    .order("name");
  if (clientsError) throw new Error(clientsError.message);

  const { data: mappingRows, error: mappingsError } = await db
    .from("google_drive_client_folders")
    .select("client_id, drive_folder_id")
    .eq("connection_id", connection.id);
  if (mappingsError) throw new Error(mappingsError.message);

  const persistedByClient = new Map<string, string>();
  for (const row of mappingRows ?? []) {
    persistedByClient.set(row.client_id, row.drive_folder_id);
  }

  const preview = computeOnboardingPreview(
    (clientRows ?? []).map((client) => ({
      id: client.id,
      name: client.name,
      driveFolderId: persistedByClient.get(client.id) ?? null,
    })),
    folders.map((folder) => ({ id: folder.id, name: folder.name })),
  );

  const linked: OnboardingPreviewDto["linked"] = [];
  const suggested: OnboardingPreviewDto["suggested"] = [];
  for (const entry of preview.linked) {
    const target = {
      clientId: entry.clientId,
      clientName: entry.clientName,
      folderId: entry.folder.id,
      folderName: entry.folder.name,
    };
    if (persistedByClient.has(entry.clientId)) linked.push(target);
    else suggested.push({ ...target, matchType: "exact" });
  }
  for (const entry of preview.suggested) {
    suggested.push({
      clientId: entry.clientId,
      clientName: entry.clientName,
      folderId: entry.folder.id,
      folderName: entry.folder.name,
      matchType: "normalized",
    });
  }

  const takenFolderIds = new Set<string>([
    ...linked.map((entry) => entry.folderId),
    ...suggested.map((entry) => entry.folderId),
  ]);

  // `unclaimedFolders` de 8A solo descuenta las carpetas que esa función metió
  // en `linked`; una carpeta que coincidió por nombre normalizado sigue
  // apareciendo ahí. Presentada tal cual, la misma carpeta saldría a la vez
  // como "coincidencia sugerida" y como "carpeta sin cliente", que es
  // contradictorio para quien revisa. Aquí se descuentan también las
  // sugeridas y las candidatas de un caso ambiguo: "sin cliente" debe
  // significar que no coincidió con ningún cliente, no que aún no se ha
  // confirmado.
  const matchedFolderIds = new Set<string>([
    ...takenFolderIds,
    ...preview.ambiguous.flatMap((entry) => entry.candidates.map((candidate) => candidate.id)),
  ]);

  return {
    rootFolderName: connection.root_folder_name ?? "",
    linked,
    suggested,
    ambiguous: preview.ambiguous.map((entry) => ({
      clientId: entry.clientId,
      clientName: entry.clientName,
      candidates: entry.candidates.map((candidate) => ({
        id: candidate.id,
        name: candidate.name,
      })),
    })),
    clientsWithoutFolder: preview.withoutFolder,
    foldersWithoutClient: preview.unclaimedFolders
      .filter((folder) => !matchedFolderIds.has(folder.id))
      .map((folder) => ({ id: folder.id, name: folder.name })),
    availableFolders: folders
      .filter((folder) => !takenFolderIds.has(folder.id))
      .map((folder) => ({ id: folder.id, name: folder.name })),
  };
}

// ── onboarding: apply (escritura atómica) ────────────────────────────────
export interface OnboardingMappingInput {
  clientId: string;
  driveFolderId: string;
  matchType: ApplicableMatchType;
}

export function parseOnboardingMappings(value: unknown): OnboardingMappingInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw badRequest("Indica al menos una vinculación.");
  }
  if (value.length > MAX_ONBOARDING_MAPPINGS) {
    throw badRequest("Se enviaron demasiadas vinculaciones en una sola operación.");
  }
  const seenClients = new Set<string>();
  const seenFolders = new Set<string>();
  return value.map((raw) => {
    const entry = (raw ?? {}) as Record<string, unknown>;
    const clientId = typeof entry.clientId === "string" ? entry.clientId.trim() : "";
    if (!clientId) throw badRequest("Falta el cliente de una de las vinculaciones.");
    const driveFolderId = assertValidDriveFolderId(entry.driveFolderId);
    const matchType = entry.matchType;
    if (!APPLICABLE_MATCH_TYPES.includes(matchType as ApplicableMatchType)) {
      // El tipo 'created' del schema se rechaza a propósito: esta fase nunca
      // crea carpetas, así que ningún mapping puede declararse como creado.
      throw badRequest("El tipo de coincidencia indicado no es válido.");
    }
    // Una carpeta no puede asignarse dos veces en la misma operación, ni un
    // cliente recibir dos carpetas. La BD lo garantiza igualmente, pero
    // detectarlo aquí da un mensaje entendible en vez de una violación de
    // unicidad cruda.
    if (seenClients.has(clientId)) {
      throw badRequest("Hay un cliente repetido en la lista de vinculaciones.");
    }
    if (seenFolders.has(driveFolderId)) {
      throw badRequest("Hay una carpeta repetida en la lista de vinculaciones.");
    }
    seenClients.add(clientId);
    seenFolders.add(driveFolderId);
    return { clientId, driveFolderId, matchType: matchType as ApplicableMatchType };
  });
}

/**
 * Determina el `match_type` que se va a PERSISTIR (Fase 8C.1).
 *
 * El valor que manda el navegador no se guarda tal cual. Se interpreta como
 * intención:
 *
 *   - "manual": el Administrador eligió esa carpeta a mano. Es válido aunque
 *     los nombres no se parezcan en nada -- pero no exime de ninguna
 *     comprobación de integridad (cliente real, carpeta real, no en
 *     papelera, hija directa de la raíz, ninguna de las dos ya vinculada).
 *     Manual significa "lo decidió una persona", no "sáltate las reglas".
 *
 *   - "exact" / "normalized": está confirmando una sugerencia. La
 *     clasificación se recalcula AHORA contra los datos actuales, con el
 *     mismo clasificador puro de Fase 8A (no una tercera normalización). Si
 *     sigue siendo una coincidencia segura, se guarda la categoría REAL
 *     derivada -- que puede no ser la que decía el navegador, por ejemplo si
 *     la carpeta se renombró de "Ana Torres" a "ana torres" entre la vista
 *     previa y el guardado: ahí se guarda "normalized", nunca un "exact"
 *     falso. Si dejó de ser segura (ahora es ambigua, o ya no coincide, o la
 *     coincidencia apunta a otra carpeta), se rechaza con
 *     MATCH_CHANGED_REVIEW para que el Administrador vuelva a mirarlo, en
 *     vez de degradarlo a "manual" en silencio: él confirmó una sugerencia
 *     concreta, no una decisión propia.
 */
function deriveMatchType(
  mapping: OnboardingMappingInput,
  clientName: string,
  rootFolders: Array<{ id: string; name: string }>,
): ApplicableMatchType {
  if (mapping.matchType === "manual") return "manual";

  const match = matchClientToFolders(clientName, rootFolders);
  const isSafe = match.type === "EXACT_MATCH" || match.type === "NORMALIZED_MATCH";
  if (!isSafe || match.candidates[0]?.id !== mapping.driveFolderId) {
    throw new DriveError("MATCH_CHANGED_REVIEW");
  }
  return match.type === "EXACT_MATCH" ? "exact" : "normalized";
}

/**
 * Persiste un lote de vinculaciones Cliente <-> Carpeta.
 *
 * Nada de lo que envía el frontend se toma como verdad: cada carpeta se
 * vuelve a consultar en Google en este mismo instante (existe, es carpeta,
 * no está en la papelera, y su padre es exactamente la raíz configurada) y
 * el nombre que se guarda es el que devuelve Google, no el que envió el
 * navegador. Que una carpeta apareciera en el preview hace cinco minutos no
 * prueba nada: pudo borrarse, moverse fuera de la raíz o renombrarse.
 *
 * LIMITACIÓN INHERENTE, asumida a propósito: Drive es un sistema externo y
 * no existe atomicidad distribuida entre Google y PostgreSQL. Entre la
 * última validación contra Drive y el COMMIT de esta transacción queda una
 * ventana en la que alguien puede mover la carpeta fuera de la raíz desde
 * el propio Drive. Intentar cerrarla con una transacción distribuida sería
 * peor que el problema. La respuesta correcta es detectarlo después: la
 * sincronización de Fase 8F comparará el padre real con el esperado y
 * marcará DRIVE_PARENT_MISMATCH como conflicto a resolver por una persona,
 * sin reasignar nunca client_id automáticamente. Aquí no se implementa.
 *
 * La escritura va por una RPC que corre en UNA transacción de PostgreSQL:
 * si cualquier vinculación del lote choca con una constraint, no se
 * persiste ninguna. Esa misma RPC toma FOR UPDATE sobre la conexión y
 * verifica que la raíz siga siendo la que se usó para validar (Fase 8C.1).
 *
 * El `matchType` que llega del navegador se trata como DECLARACIÓN DE
 * INTENCIÓN, no como dato: "manual" significa que el Administrador eligió la
 * carpeta a mano; "exact"/"normalized" significan que está confirmando una
 * sugerencia. En el segundo caso la clasificación se vuelve a derivar aquí,
 * con los datos actuales -- nunca se guarda un "exact" solo porque el
 * navegador lo dijera.
 */
export async function applyGoogleDriveClientFolderMappings(request: Request, rawMappings: unknown) {
  const mappings = parseOnboardingMappings(rawMappings);
  const { user } = await requireAdmin(request);
  const { connection, accessToken, db } = await requireConnectedDrive(request);
  const rootFolderId = connection.root_folder_id;
  if (!rootFolderId) throw new DriveError("DRIVE_ROOT_NOT_CONFIGURED");

  // Los clientes deben existir todavía. Se comprueba antes de gastar
  // llamadas a Google. Se pide `name` porque la clasificación se vuelve a
  // derivar aquí; sigue siendo el mínimo (ni teléfono, ni correo).
  const { data: clientRows, error: clientsError } = await db
    .from("clients")
    .select("id, name")
    .in(
      "id",
      mappings.map((mapping) => mapping.clientId),
    );
  if (clientsError) throw new Error(clientsError.message);
  const clientNameById = new Map<string, string>(
    (clientRows ?? []).map((row) => [row.id, row.name]),
  );
  for (const mapping of mappings) {
    if (!clientNameById.has(mapping.clientId)) {
      throw badRequest("Uno de los clientes indicados ya no existe.");
    }
  }

  // Para reclasificar una sugerencia hace falta el conjunto completo de
  // carpetas hijas de la raíz: la ambigüedad solo es visible en el conjunto
  // (dos carpetas que normalizan igual). Si el lote es todo manual no se
  // pide -- ahí la clasificación no se deriva de los nombres.
  const needsDerivation = mappings.some((mapping) => mapping.matchType !== "manual");
  const rootFolders = needsDerivation
    ? await listChildDriveFolders(accessToken, rootFolderId, {
        sharedDriveId: connection.shared_drive_id,
      })
    : [];

  const validated: Array<{
    client_id: string;
    drive_folder_id: string;
    drive_folder_name_snapshot: string;
    match_type: ApplicableMatchType;
  }> = [];
  for (const mapping of mappings) {
    const folder = await getDriveFolder(accessToken, mapping.driveFolderId, {
      sharedDriveId: connection.shared_drive_id,
    });
    if (!folder.parents?.includes(rootFolderId)) {
      throw new DriveError("DRIVE_FOLDER_OUTSIDE_ROOT");
    }
    validated.push({
      client_id: mapping.clientId,
      drive_folder_id: folder.id,
      drive_folder_name_snapshot: folder.name,
      match_type: deriveMatchType(
        mapping,
        clientNameById.get(mapping.clientId) ?? "",
        rootFolders.map((candidate) => ({ id: candidate.id, name: candidate.name })),
      ),
    });
  }

  const { data, error } = await db.rpc("apply_google_drive_client_folder_mappings", {
    p_connection_id: connection.id,
    p_linked_by: user.id,
    p_expected_root_folder_id: rootFolderId,
    p_mappings: validated,
  });
  if (error) {
    const driveError = driveErrorFromPostgres(error.message);
    if (driveError) throw driveError;
    // Nunca se propaga el texto crudo de PostgreSQL al cliente.
    throw new Error("No se pudieron guardar las vinculaciones.");
  }

  const summary = (data ?? {}) as { created?: number; unchanged?: number };
  return { created: summary.created ?? 0, unchanged: summary.unchanged ?? 0 };
}
