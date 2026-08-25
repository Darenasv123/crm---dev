import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth-server";
import { readServerRuntimeEnv } from "@/lib/server-runtime-env";

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

type DriveConnection = {
  id: string;
  connected_by: string;
  google_account_email: string | null;
  // Nullable: al desconectar se destruye el ciphertext (Fase 8B.1).
  encrypted_refresh_token: string | null;
  granted_scopes: string | null;
  root_folder_id: string | null;
  root_folder_name: string | null;
  status: string;
  last_synced_at: string | null;
  last_error: string | null;
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

function adminClient() {
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
  const message = cause instanceof Error ? cause.message : "Solicitud no válida.";
  const status = /sesión|permiso/i.test(message)
    ? 403
    : /falta|indica|inválid|expir|configurad/i.test(message)
      ? 400
      : 500;
  return Response.json({ error: message }, { status });
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

async function activeDriveConnection() {
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
async function accessTokenForDrive(connection: DriveConnection) {
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
export async function googleDriveConnectionStatus(request: Request) {
  await requireAdmin(request);
  if (!isGoogleDriveConfigured()) {
    return { configured: false, connected: false } as const;
  }
  const connection = await activeDriveConnection();
  if (!connection) return { configured: true, connected: false } as const;
  return {
    configured: true,
    connected: true,
    accountEmail: connection.google_account_email,
    rootFolderConfigured: Boolean(connection.root_folder_id),
    status: connection.status,
    lastSyncedAt: connection.last_synced_at,
    // Nunca el mensaje crudo de Google ni ningún dato técnico -- solo lo
    // que ya se saneó/generó desde este propio módulo.
    lastError: connection.last_error,
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
