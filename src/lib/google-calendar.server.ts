import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth-server";
import { readServerRuntimeEnv } from "@/lib/server-runtime-env";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_SCOPE = "openid email https://www.googleapis.com/auth/calendar.events";
const textEncoder = new TextEncoder();

type Connection = {
  id: string;
  connected_by: string;
  google_account_email: string | null;
  calendar_id: string;
  calendar_name: string | null;
  encrypted_refresh_token: string;
  sync_token: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  status: string;
};

type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  etag?: string;
  updated?: string;
  htmlLink?: string;
  start?: { date?: string; dateTime?: string };
  extendedProperties?: { private?: Record<string, string> };
};

function serverSecret(name: string) {
  const value = readServerRuntimeEnv(name);
  if (!value) throw new Error(`Falta la configuración de servidor ${name}.`);
  return value;
}

function optionalServerSecret(name: string) {
  return readServerRuntimeEnv(name);
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

async function timingSafeEqual(left: string, right: string) {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

async function encryptionKey() {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(serverSecret("GOOGLE_TOKEN_ENCRYPTION_KEY")),
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptToken(token: string) {
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

async function decryptToken(value: string) {
  const packed = fromBase64Url(value);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: packed.slice(0, 12) },
    await encryptionKey(),
    packed.slice(12),
  );
  return new TextDecoder().decode(decrypted);
}

function bearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

async function requireRole(request: Request, roles: string[]) {
  const accessToken = bearerToken(request);
  if (!accessToken) throw new Error("Falta la sesión autenticada.");
  const user = await requireUser(accessToken);
  const db = adminClient();
  const { data: profile, error } = await db
    .from("profiles")
    .select("role, status")
    .eq("id", user.id)
    .single();
  if (error || !profile || profile.status !== "Activo" || !roles.includes(profile.role)) {
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
    const error = new Error(`Google Calendar respondió ${response.status}.`);
    Object.assign(error, { status: response.status, safeBody: body.slice(0, 500) });
    throw error;
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

async function accessTokenFor(connection: Connection) {
  const refreshToken = await decryptToken(connection.encrypted_refresh_token);
  const body = new URLSearchParams({
    client_id: serverSecret("GOOGLE_CLIENT_ID"),
    client_secret: serverSecret("GOOGLE_CLIENT_SECRET"),
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
    .from("google_calendar_connections")
    .update({ access_token_expires_at: expiresAt })
    .eq("id", connection.id);
  return token.access_token;
}

async function revokeToken(token: string) {
  const response = await fetch(GOOGLE_REVOKE_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
  if (!response.ok && response.status !== 400) {
    throw new Error(`Google OAuth respondió ${response.status} al revocar el acceso.`);
  }
}

async function revokeGoogleCredential(connection: Connection) {
  await revokeToken(await decryptToken(connection.encrypted_refresh_token));
}

async function activeConnection() {
  const db = adminClient();
  const { data, error } = await db
    .from("google_calendar_connections")
    .select("*")
    .eq("status", "connected")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as Connection | null;
}

function eventStart(event: GoogleEvent) {
  const value = event.start?.dateTime ?? event.start?.date ?? "";
  if (!value) return { event_date: new Date().toISOString().slice(0, 10), event_time: "09:00" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { event_date: value, event_time: "09:00" };
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    event_date: `${get("year")}-${get("month")}-${get("day")}`,
    event_time: `${get("hour")}:${get("minute")}`,
  };
}

async function recordSync(
  connectionId: string,
  input: {
    direction: string;
    operation: string;
    status: string;
    agenda_event_id?: string | null;
    google_event_id?: string | null;
    error_message?: string | null;
  },
) {
  await adminClient()
    .from("google_calendar_sync_log")
    .insert({
      connection_id: connectionId,
      ...input,
    });
}

async function applyGoogleEvent(connection: Connection, event: GoogleEvent) {
  const db = adminClient();
  const { data: local } = await db
    .from("agenda_events")
    .select("*")
    .eq("google_calendar_id", connection.calendar_id)
    .eq("google_event_id", event.id)
    .maybeSingle();

  if (event.status === "cancelled") {
    if (local) {
      await db
        .from("agenda_events")
        .update({
          deleted_at: new Date().toISOString(),
          sync_status: "deleted",
          sync_origin: "google",
          google_etag: event.etag ?? local.google_etag,
        })
        .eq("id", local.id);
    }
    return;
  }

  if (
    local?.sync_status === "pending" &&
    event.updated &&
    new Date(local.updated_at).getTime() > new Date(event.updated).getTime()
  ) {
    await db
      .from("agenda_events")
      .update({ sync_status: "conflict", sync_error: "Cambios simultáneos en CRM y Google." })
      .eq("id", local.id);
    await recordSync(connection.id, {
      direction: "google_to_local",
      operation: "update",
      status: "conflict",
      agenda_event_id: local.id,
      google_event_id: event.id,
    });
    return;
  }

  const start = eventStart(event);
  const values = {
    title: event.summary?.trim() || "Evento sin título",
    type: "Cita",
    event_date: start.event_date,
    event_time: start.event_time,
    location: event.location ?? null,
    google_event_id: event.id,
    google_calendar_id: connection.calendar_id,
    google_etag: event.etag ?? null,
    google_updated_at: event.updated ?? null,
    google_html_link: event.htmlLink ?? null,
    sync_status: "synced",
    sync_error: null,
    last_synced_at: new Date().toISOString(),
    sync_origin: "google",
    deleted_at: null,
  };
  if (local) {
    await db.from("agenda_events").update(values).eq("id", local.id);
  } else {
    await db.from("agenda_events").insert(values);
  }
}

export async function syncGoogleToCrm(connectionId?: string) {
  const db = adminClient();
  const { data, error } = connectionId
    ? await db.from("google_calendar_connections").select("*").eq("id", connectionId).single()
    : await db.from("google_calendar_connections").select("*").eq("status", "connected").single();
  if (error || !data) throw new Error(error?.message ?? "No existe una conexión activa.");
  const connection = data as Connection;
  const accessToken = await accessTokenFor(connection);
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  let processed = 0;

  try {
    do {
      const params = new URLSearchParams({ showDeleted: "true", singleEvents: "true" });
      if (connection.sync_token) params.set("syncToken", connection.sync_token);
      if (pageToken) params.set("pageToken", pageToken);
      const response = await googleFetch<{
        items?: GoogleEvent[];
        nextPageToken?: string;
        nextSyncToken?: string;
      }>(
        `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(connection.calendar_id)}/events?${params}`,
        { accessToken },
      );
      for (const event of response.items ?? []) {
        await applyGoogleEvent(connection, event);
        processed += 1;
      }
      pageToken = response.nextPageToken;
      nextSyncToken = response.nextSyncToken ?? nextSyncToken;
    } while (pageToken);
  } catch (cause) {
    if ((cause as { status?: number }).status === 410 && connection.sync_token) {
      await db
        .from("google_calendar_connections")
        .update({ sync_token: null })
        .eq("id", connection.id);
      return syncGoogleToCrm(connection.id);
    }
    const message = cause instanceof Error ? cause.message : "Error de sincronización.";
    await db
      .from("google_calendar_connections")
      .update({ last_error: message })
      .eq("id", connection.id);
    throw cause;
  }

  await db
    .from("google_calendar_connections")
    .update({
      sync_token: nextSyncToken ?? connection.sync_token,
      last_synced_at: new Date().toISOString(),
      last_error: null,
      status: "connected",
    })
    .eq("id", connection.id);
  await recordSync(connection.id, {
    direction: "google_to_local",
    operation: connection.sync_token ? "incremental_sync" : "full_sync",
    status: "succeeded",
  });
  return { processed };
}

function googleEventPayload(event: {
  id: string;
  title: string;
  type: string;
  event_date: string;
  event_time: string;
  location: string | null;
}) {
  const start = `${event.event_date}T${String(event.event_time).slice(0, 5)}:00-05:00`;
  const endDate = new Date(new Date(start).getTime() + 60 * 60 * 1000);
  return {
    summary: event.title,
    description: `Tipo: ${event.type}`,
    location: event.location ?? undefined,
    start: { dateTime: start, timeZone: "America/Lima" },
    end: { dateTime: endDate.toISOString(), timeZone: "America/Lima" },
    extendedProperties: { private: { crmEventId: event.id, syncOrigin: "crm" } },
  };
}

export async function syncCrmEventToGoogle(eventId: string) {
  const connection = await activeConnection();
  if (!connection) throw new Error("Google Calendar no está conectado.");
  const db = adminClient();
  const { data: event, error } = await db
    .from("agenda_events")
    .select("*")
    .eq("id", eventId)
    .single();
  if (error || !event) throw new Error(error?.message ?? "El evento no existe.");
  const accessToken = await accessTokenFor(connection);

  try {
    if (event.deleted_at && event.google_event_id) {
      await googleFetch<void>(
        `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(connection.calendar_id)}/events/${encodeURIComponent(event.google_event_id)}`,
        { method: "DELETE", accessToken },
      );
      await db
        .from("agenda_events")
        .update({
          sync_status: "deleted",
          sync_error: null,
          last_synced_at: new Date().toISOString(),
        })
        .eq("id", event.id);
      return { status: "deleted" };
    }

    const url = event.google_event_id
      ? `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(connection.calendar_id)}/events/${encodeURIComponent(event.google_event_id)}`
      : `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(connection.calendar_id)}/events`;
    const googleEvent = await googleFetch<GoogleEvent>(url, {
      method: event.google_event_id ? "PATCH" : "POST",
      accessToken,
      body: JSON.stringify(googleEventPayload(event)),
    });
    await db
      .from("agenda_events")
      .update({
        google_event_id: googleEvent.id,
        google_calendar_id: connection.calendar_id,
        google_etag: googleEvent.etag ?? null,
        google_updated_at: googleEvent.updated ?? null,
        google_html_link: googleEvent.htmlLink ?? null,
        sync_status: "synced",
        sync_error: null,
        sync_origin: "crm",
        last_synced_at: new Date().toISOString(),
      })
      .eq("id", event.id);
    await recordSync(connection.id, {
      direction: "local_to_google",
      operation: event.google_event_id ? "update" : "create",
      status: "succeeded",
      agenda_event_id: event.id,
      google_event_id: googleEvent.id,
    });
    return { status: "synced" };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "No se pudo sincronizar.";
    await db
      .from("agenda_events")
      .update({ sync_status: "error", sync_error: message })
      .eq("id", event.id);
    await recordSync(connection.id, {
      direction: "local_to_google",
      operation: event.google_event_id ? "update" : "create",
      status: "failed",
      agenda_event_id: event.id,
      google_event_id: event.google_event_id,
      error_message: message,
    });
    throw cause;
  }
}

export async function resolveAgendaSyncConflict(
  request: Request,
  eventId: string,
  resolution: "crm" | "google",
) {
  const { db } = await requireRole(request, ["Administrador"]);
  const connection = await activeConnection();
  if (!connection) throw new Error("Google Calendar no está conectado.");
  const { data: event, error } = await db
    .from("agenda_events")
    .select("id, google_event_id, google_calendar_id")
    .eq("id", eventId)
    .single();
  if (error || !event) throw new Error(error?.message ?? "El evento no existe.");

  if (resolution === "crm") {
    await db
      .from("agenda_events")
      .update({ sync_status: "pending", sync_error: null, sync_origin: "crm" })
      .eq("id", eventId);
    return syncCrmEventToGoogle(eventId);
  }

  if (!event.google_event_id || event.google_calendar_id !== connection.calendar_id) {
    throw new Error("El evento no tiene una equivalencia válida en Google.");
  }
  await db
    .from("agenda_events")
    .update({ sync_status: "synced", sync_error: null })
    .eq("id", eventId);
  const remote = await googleFetch<GoogleEvent>(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(connection.calendar_id)}/events/${encodeURIComponent(event.google_event_id)}`,
    { accessToken: await accessTokenFor(connection) },
  );
  await applyGoogleEvent(connection, remote);
  await recordSync(connection.id, {
    direction: "google_to_local",
    operation: "resolve_conflict",
    status: "succeeded",
    agenda_event_id: eventId,
    google_event_id: event.google_event_id,
  });
  return { status: "synced" };
}

async function createWatchChannel(connection: Connection) {
  const db = adminClient();
  const accessToken = await accessTokenFor(connection);
  const channelId = crypto.randomUUID();
  const channelToken = randomToken();
  const expiration = Date.now() + 6 * 24 * 60 * 60 * 1000;
  const response = await googleFetch<{ resourceId: string; expiration?: string }>(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(connection.calendar_id)}/events/watch`,
    {
      method: "POST",
      accessToken,
      body: JSON.stringify({
        id: channelId,
        type: "web_hook",
        address: serverSecret("GOOGLE_CALENDAR_WEBHOOK_URL"),
        token: channelToken,
        expiration: String(expiration),
      }),
    },
  );
  await db.from("google_calendar_channels").insert({
    connection_id: connection.id,
    channel_id: channelId,
    resource_id: response.resourceId,
    channel_token_hash: await sha256(channelToken),
    expires_at: new Date(Number(response.expiration ?? expiration)).toISOString(),
  });
  return channelId;
}

export async function renewGoogleChannel(connectionId?: string) {
  const db = adminClient();
  const connection = connectionId
    ? ((await db.from("google_calendar_connections").select("*").eq("id", connectionId).single())
        .data as Connection | null)
    : await activeConnection();
  if (!connection) throw new Error("No existe una conexión activa.");

  const channelId = await createWatchChannel(connection);
  const { data: oldChannels } = await db
    .from("google_calendar_channels")
    .select("*")
    .eq("connection_id", connection.id)
    .is("stopped_at", null)
    .neq("channel_id", channelId);
  const accessToken = await accessTokenFor(connection);
  for (const channel of oldChannels ?? []) {
    try {
      await googleFetch<void>(`${GOOGLE_CALENDAR_API}/channels/stop`, {
        method: "POST",
        accessToken,
        body: JSON.stringify({ id: channel.channel_id, resourceId: channel.resource_id }),
      });
    } finally {
      await db
        .from("google_calendar_channels")
        .update({ stopped_at: new Date().toISOString() })
        .eq("id", channel.id);
    }
  }
  return { channelId };
}

export async function beginGoogleOAuth(request: Request) {
  const { user, db } = await requireRole(request, ["Administrador"]);
  const requestUrl = new URL(request.url);
  const calendarId =
    requestUrl.searchParams.get("calendarId")?.trim() ||
    optionalServerSecret("GOOGLE_SHARED_CALENDAR_ID");
  if (!calendarId) throw new Error("Indica el ID del calendario compartido.");

  const nonce = randomToken();
  const expiresAt = Date.now() + 10 * 60 * 1000;
  const unsignedState = `${nonce}.${expiresAt}`;
  const state = `${unsignedState}.${await hmac(unsignedState)}`;
  const verifier = randomToken(64);
  const challenge = await sha256(verifier);
  const { error: stateError } = await db.from("google_calendar_oauth_states").insert({
    state_hash: await sha256(state),
    requested_by: user.id,
    calendar_id: calendarId,
    code_verifier: verifier,
    expires_at: new Date(expiresAt).toISOString(),
  });
  if (stateError) throw new Error("No se pudo iniciar la autorización de Google.");

  const params = new URLSearchParams({
    client_id: serverSecret("GOOGLE_CLIENT_ID"),
    redirect_uri: serverSecret("GOOGLE_OAUTH_REDIRECT_URI"),
    response_type: "code",
    scope: GOOGLE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return { authorizationUrl: `${GOOGLE_AUTH_URL}?${params}` };
}

export async function completeGoogleOAuth(request: Request) {
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
  const { data: oauthState, error } = await db
    .from("google_calendar_oauth_states")
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
      client_id: serverSecret("GOOGLE_CLIENT_ID"),
      client_secret: serverSecret("GOOGLE_CLIENT_SECRET"),
      redirect_uri: serverSecret("GOOGLE_OAUTH_REDIRECT_URI"),
      grant_type: "authorization_code",
      code_verifier: oauthState.code_verifier,
    }),
  });
  if (!tokenResponse.ok) throw new Error(`Google OAuth respondió ${tokenResponse.status}.`);
  const tokens = (await tokenResponse.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("Google no entregó acceso offline; vuelve a autorizar la cuenta.");
  }
  const calendar = await googleFetch<{ summary?: string }>(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(oauthState.calendar_id)}`,
    { accessToken: tokens.access_token },
  );
  const userInfo = await googleFetch<{ email?: string }>(
    "https://openidconnect.googleapis.com/v1/userinfo",
    { accessToken: tokens.access_token },
  ).catch(() => ({ email: undefined }));

  const { data: previousConnections } = await db
    .from("google_calendar_connections")
    .select("*")
    .eq("status", "connected");
  for (const previous of (previousConnections ?? []) as Connection[]) {
    try {
      await revokeGoogleCredential(previous);
    } catch (cause) {
      await revokeToken(tokens.refresh_token);
      throw cause;
    }
    await db.from("google_calendar_connections").delete().eq("id", previous.id);
  }
  const { data: connection, error: connectionError } = await db
    .from("google_calendar_connections")
    .insert({
      connected_by: oauthState.requested_by,
      google_account_email: userInfo.email ?? null,
      calendar_id: oauthState.calendar_id,
      calendar_name: calendar.summary ?? oauthState.calendar_id,
      encrypted_refresh_token: await encryptToken(tokens.refresh_token),
      access_token_expires_at: new Date(
        Date.now() + (tokens.expires_in ?? 3600) * 1000,
      ).toISOString(),
      status: "connected",
    })
    .select()
    .single();
  if (connectionError || !connection)
    throw new Error(connectionError?.message ?? "No se guardó la conexión.");

  await syncGoogleToCrm(connection.id);
  await createWatchChannel(connection as Connection);
  return { connectionId: connection.id };
}

export async function googleConnectionStatus(request: Request) {
  await requireRole(request, ["Administrador"]);
  const connection = await activeConnection();
  if (!connection) return { connected: false };
  const db = adminClient();
  const { data: channel } = await db
    .from("google_calendar_channels")
    .select("expires_at, resource_id, stopped_at")
    .eq("connection_id", connection.id)
    .is("stopped_at", null)
    .order("expires_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    connected: true,
    accountEmail: connection.google_account_email,
    calendarId: connection.calendar_id,
    calendarName: connection.calendar_name,
    lastSyncedAt: connection.last_synced_at,
    lastError: connection.last_error,
    status: connection.status,
    channelExpiresAt: channel?.expires_at ?? null,
    webhookActive: !!channel,
  };
}

export async function disconnectGoogleCalendar(request: Request) {
  await requireRole(request, ["Administrador"]);
  const connection = await activeConnection();
  if (!connection) return { disconnected: true };
  await revokeGoogleCredential(connection);
  await adminClient().from("google_calendar_connections").delete().eq("id", connection.id);
  return { disconnected: true };
}

export async function acceptGoogleWebhook(request: Request) {
  const channelId = request.headers.get("x-goog-channel-id") ?? "";
  const resourceId = request.headers.get("x-goog-resource-id") ?? "";
  const channelToken = request.headers.get("x-goog-channel-token") ?? "";
  const messageNumber = Number(request.headers.get("x-goog-message-number") ?? "");
  if (
    !channelId ||
    !resourceId ||
    !channelToken ||
    !Number.isSafeInteger(messageNumber) ||
    messageNumber < 1
  ) {
    return new Response(null, { status: 400 });
  }
  const db = adminClient();
  const { data: channel } = await db
    .from("google_calendar_channels")
    .select("*")
    .eq("channel_id", channelId)
    .eq("resource_id", resourceId)
    .is("stopped_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (
    !channel ||
    !(await timingSafeEqual(channel.channel_token_hash, await sha256(channelToken)))
  ) {
    return new Response(null, { status: 401 });
  }
  const { error } = await db.from("google_calendar_sync_requests").upsert(
    {
      connection_id: channel.connection_id,
      channel_id: channelId,
      message_number: messageNumber,
      status: "pending",
    },
    { onConflict: "channel_id,message_number", ignoreDuplicates: true },
  );
  if (error) return new Response(null, { status: 503 });
  await db
    .from("google_calendar_channels")
    .update({ last_message_number: messageNumber })
    .eq("id", channel.id);
  return new Response(null, { status: 202 });
}

export async function processGoogleSyncQueue() {
  const db = adminClient();
  const { data: requests, error } = await db
    .from("google_calendar_sync_requests")
    .select("*")
    .eq("status", "pending")
    .order("created_at")
    .limit(20);
  if (error) throw new Error(error.message);
  for (const item of requests ?? []) {
    const { data: claimed } = await db
      .from("google_calendar_sync_requests")
      .update({ status: "processing" })
      .eq("id", item.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;
    try {
      await syncGoogleToCrm(item.connection_id);
      await db
        .from("google_calendar_sync_requests")
        .update({ status: "completed", processed_at: new Date().toISOString() })
        .eq("id", item.id);
    } catch (cause) {
      await db
        .from("google_calendar_sync_requests")
        .update({
          status: "failed",
          error_message: cause instanceof Error ? cause.message : "Error de sincronización.",
          processed_at: new Date().toISOString(),
        })
        .eq("id", item.id);
    }
  }
  return { processed: requests?.length ?? 0 };
}

export async function runGoogleCalendarScheduledMaintenance() {
  const db = adminClient();
  const queue = await processGoogleSyncQueue();
  const connection = await activeConnection();
  if (!connection) return { queue: queue.processed, renewed: false };

  const renewalCutoff = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { data: channel } = await db
    .from("google_calendar_channels")
    .select("id, expires_at")
    .eq("connection_id", connection.id)
    .is("stopped_at", null)
    .gt("expires_at", renewalCutoff)
    .limit(1)
    .maybeSingle();
  if (channel) return { queue: queue.processed, renewed: false };

  await renewGoogleChannel(connection.id);
  return { queue: queue.processed, renewed: true };
}

export async function authorizeAgendaSync(request: Request) {
  await requireRole(request, ["Administrador", "Personal"]);
}

export function safeServerError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : "Solicitud no válida.";
  const status = /sesión|permiso/i.test(message)
    ? 403
    : /falta|indica|inválid|expir/i.test(message)
      ? 400
      : 500;
  return Response.json({ error: message }, { status });
}
