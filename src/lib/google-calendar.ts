/**
 * Google Calendar — sincronización bidireccional
 *
 * CRM → Google : crear / actualizar / eliminar eventos vía API
 * Google → CRM : importar eventos que existan en Google pero no en el CRM
 *
 * Mapeo: agenda_events.gcal_event_id ↔ Google Calendar event.id
 * Los eventos del CRM llevan extendedProperties.private.crmEventId = agenda_events.id
 */

const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const SCOPES =
  "https://www.googleapis.com/auth/calendar.events";
const STORAGE_KEY  = "gcal_access_token";
const EXPIRY_KEY   = "gcal_token_expiry";
const CALENDAR_ID  = "primary";
const TIMEZONE     = "America/Lima";

// ─── Token helpers ────────────────────────────────────────────────────────────

function getRedirectUri(): string {
  return `${window.location.origin}/google-calendar-callback`;
}

export function isGoogleCalendarConnected(): boolean {
  if (typeof window === "undefined") return false;
  const token  = localStorage.getItem(STORAGE_KEY);
  const expiry = localStorage.getItem(EXPIRY_KEY);
  if (!token || !expiry) return false;
  return Date.now() < Number(expiry);
}

export function getGoogleAccessToken(): string | null {
  if (!isGoogleCalendarConnected()) return null;
  return localStorage.getItem(STORAGE_KEY);
}

export function disconnectGoogleCalendar(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(EXPIRY_KEY);
}

export function initiateGoogleOAuth(): void {
  if (!GOOGLE_CLIENT_ID) {
    alert(
      "Configura VITE_GOOGLE_CLIENT_ID en .env\n" +
      "URI de redirección: " + getRedirectUri()
    );
    return;
  }
  const params = new URLSearchParams({
    client_id:     GOOGLE_CLIENT_ID,
    redirect_uri:  getRedirectUri(),
    response_type: "token",
    scope:         SCOPES,
    prompt:        "select_account",
  });
  window.location.href =
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export function handleGoogleOAuthCallback(): boolean {
  if (typeof window === "undefined") return false;
  const hash = window.location.hash.substring(1);
  if (!hash) return false;
  const params    = new URLSearchParams(hash);
  const token     = params.get("access_token");
  const expiresIn = params.get("expires_in");
  if (!token) return false;
  localStorage.setItem(STORAGE_KEY, token);
  localStorage.setItem(
    EXPIRY_KEY,
    String(Date.now() + (Number(expiresIn ?? 3600) - 60) * 1000)
  );
  window.history.replaceState(null, "", window.location.pathname);
  return true;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GCalEvent {
  id:           string;       // CRM uuid
  gcalId?:      string | null; // Google Calendar event id (si ya existe)
  title:        string;
  type:         string;
  event_date:   string;       // YYYY-MM-DD
  event_time:   string;       // HH:MM
  location:     string | null;
  client?:      string | null;
}

/** Evento importado desde Google que no existe aún en el CRM */
export interface GCalImportedEvent {
  gcalId:     string;
  title:      string;
  event_date: string;
  event_time: string;
  location:   string | null;
}

// ─── Helpers de formato ───────────────────────────────────────────────────────

function pad(n: number) { return String(n).padStart(2, "0"); }

function toDateTimeParts(date: string, time: string) {
  const [y, m, d]   = date.split("-").map(Number);
  const [hh, mm]    = time.split(":").map(Number);
  const start = `${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00`;
  const endDt = new Date(y, m - 1, d, hh + 1, mm);
  const end   = `${endDt.getFullYear()}-${pad(endDt.getMonth()+1)}-${pad(endDt.getDate())}T${pad(endDt.getHours())}:${pad(endDt.getMinutes())}:00`;
  return { start, end };
}

function toGCalBody(ev: GCalEvent): object {
  const { start, end } = toDateTimeParts(ev.event_date, ev.event_time);
  return {
    summary:  ev.title,
    location: ev.location ?? undefined,
    description: ev.client
      ? `Cliente: ${ev.client}\nTipo: ${ev.type}`
      : `Tipo: ${ev.type}`,
    start: { dateTime: start, timeZone: TIMEZONE },
    end:   { dateTime: end,   timeZone: TIMEZONE },
    extendedProperties: { private: { crmEventId: ev.id } },
  };
}

// ─── Error handler ────────────────────────────────────────────────────────────

async function gcalFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = getGoogleAccessToken();
  if (!token) throw new Error("Token de Google expirado. Reconecta en Configuración.");
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (res.status === 401) {
    disconnectGoogleCalendar();
    throw new Error("Sesión de Google expirada. Reconecta en Configuración → Google Calendar.");
  }
  return res;
}

// ─── CRM → Google : crear ─────────────────────────────────────────────────────

/** Crea un evento en Google Calendar. Devuelve el Google event ID. */
export async function createGCalEvent(ev: GCalEvent): Promise<string> {
  const res = await gcalFetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events`,
    { method: "POST", body: JSON.stringify(toGCalBody(ev)) }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(`Google Calendar: ${err?.error?.message ?? res.statusText}`);
  }
  const data = await res.json() as { id: string };
  return data.id;
}

// ─── CRM → Google : actualizar ───────────────────────────────────────────────

/** Actualiza un evento existente en Google Calendar. */
export async function updateGCalEvent(gcalId: string, ev: GCalEvent): Promise<void> {
  const res = await gcalFetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${encodeURIComponent(gcalId)}`,
    { method: "PUT", body: JSON.stringify(toGCalBody(ev)) }
  );
  if (!res.ok && res.status !== 404) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(`Google Calendar (update): ${err?.error?.message ?? res.statusText}`);
  }
}

// ─── CRM → Google : eliminar ─────────────────────────────────────────────────

/** Elimina un evento de Google Calendar. Silencia 404 (ya fue eliminado allá). */
export async function deleteGCalEvent(gcalId: string): Promise<void> {
  const res = await gcalFetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${encodeURIComponent(gcalId)}`,
    { method: "DELETE" }
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(`Google Calendar (delete): ${err?.error?.message ?? res.statusText}`);
  }
}

// ─── Google → CRM : listar eventos ───────────────────────────────────────────

interface RawGCalEvent {
  id:          string;
  summary?:    string;
  location?:   string;
  start?:      { dateTime?: string; date?: string };
  status?:     string;
  extendedProperties?: { private?: { crmEventId?: string } };
}

/** Lista eventos de Google Calendar en el rango dado.
 *  Maneja paginación automáticamente (nextPageToken). */
export async function fetchGCalEvents(
  timeMin: Date,
  timeMax: Date
): Promise<RawGCalEvent[]> {
  const all: RawGCalEvent[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      timeMin:      timeMin.toISOString(),
      timeMax:      timeMax.toISOString(),
      singleEvents: "true",
      maxResults:   "2500",
      orderBy:      "startTime",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await gcalFetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events?${params}`
    );
    if (!res.ok) break;

    const data = await res.json() as {
      items?: RawGCalEvent[];
      nextPageToken?: string;
    };
    const items = (data.items ?? []).filter(e => e.status !== "cancelled");
    all.push(...items);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return all;
}

// ─── Google → CRM : importar eventos nuevos ──────────────────────────────────

/**
 * Lee Google Calendar y devuelve los eventos que NO tienen crmEventId
 * (es decir, fueron creados directamente en Google, no desde el CRM).
 * El llamador decide si los inserta en Supabase.
 */
export async function getNewGCalEvents(): Promise<GCalImportedEvent[]> {
  // Todo el historial: 10 años atrás hasta 5 años adelante
  const timeMin = new Date(Date.now() - 10 * 365 * 24 * 60 * 60 * 1000);
  const timeMax = new Date(Date.now() +  5 * 365 * 24 * 60 * 60 * 1000);

  const events = await fetchGCalEvents(timeMin, timeMax);

  return events
    .filter(e => !e.extendedProperties?.private?.crmEventId) // solo los que NO vienen del CRM
    .map(e => {
      const rawStart = e.start?.dateTime ?? e.start?.date ?? "";

      let event_date = rawStart.slice(0, 10); // "YYYY-MM-DD"
      let event_time = "09:00";

      if (rawStart.includes("T")) {
        // Convertir a hora local de Lima (America/Lima = UTC-5, sin DST)
        const dt = new Date(rawStart);
        // getHours/getMinutes usa la zona horaria LOCAL del navegador.
        // Forzamos a Lima (UTC-5) sin depender del sistema operativo.
        const limaOffset = -5 * 60; // minutos
        const utcMinutes = dt.getTime() / 60000 - dt.getTimezoneOffset();
        const limaMinutes = utcMinutes + limaOffset;
        const limaDate = new Date(limaMinutes * 60000);
        const hh = String(limaDate.getUTCHours()).padStart(2, "0");
        const mm = String(limaDate.getUTCMinutes()).padStart(2, "0");
        event_time = `${hh}:${mm}`;
        // Recalcular date desde Lima también
        event_date = limaDate.toISOString().slice(0, 10);
      }

      return {
        gcalId:     e.id,
        title:      e.summary ?? "Evento sin título",
        event_date,
        event_time,
        location:   e.location ?? null,
      };
    });
}

// ─── Sync completo CRM → Google (bulk) ───────────────────────────────────────

export async function syncAllEventsToGoogle(
  events: GCalEvent[],
  onProgress?: (done: number, total: number) => void
): Promise<{ success: number; errors: number; gcalIds: Record<string, string> }> {
  let success = 0;
  let errors  = 0;
  const gcalIds: Record<string, string> = {}; // crmId → gcalId

  // Rango completo: 10 años atrás hasta 5 años adelante — cubre todo el historial
  const timeMin = new Date(Date.now() - 10 * 365 * 24 * 60 * 60 * 1000);
  const timeMax = new Date(Date.now() +  5 * 365 * 24 * 60 * 60 * 1000);
  const existing = await fetchGCalEvents(timeMin, timeMax);

  const crmIdToGcalId = new Map<string, string>();
  for (const e of existing) {
    const crmId = e.extendedProperties?.private?.crmEventId;
    if (crmId) crmIdToGcalId.set(crmId, e.id);
  }

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    onProgress?.(i, events.length);
    try {
      const existingGcalId = ev.gcalId ?? crmIdToGcalId.get(ev.id);
      if (existingGcalId) {
        // Ya existe en Google → actualizar
        await updateGCalEvent(existingGcalId, ev);
        gcalIds[ev.id] = existingGcalId;
      } else {
        // No existe → crear
        const newGcalId = await createGCalEvent(ev);
        gcalIds[ev.id] = newGcalId;
      }
      success++;
    } catch {
      errors++;
    }
    await new Promise(r => setTimeout(r, 120)); // rate limit
  }

  onProgress?.(events.length, events.length);
  return { success, errors, gcalIds };
}
