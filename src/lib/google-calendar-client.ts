import { supabase } from "@/lib/supabase";

export type GoogleCalendarStatus = {
  connected: boolean;
  accountEmail?: string | null;
  calendarId?: string;
  calendarName?: string | null;
  lastSyncedAt?: string | null;
  lastError?: string | null;
  status?: string;
  channelExpiresAt?: string | null;
  webhookActive?: boolean;
};

async function authenticatedHeaders() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Inicia sesión para continuar.");
  return {
    authorization: `Bearer ${session.access_token}`,
    "content-type": "application/json",
  };
}

async function apiRequest<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(await authenticatedHeaders()), ...options.headers },
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `La solicitud falló (${response.status}).`);
  return body;
}

export function getGoogleCalendarStatus() {
  return apiRequest<GoogleCalendarStatus>("/api/google-calendar/status");
}

export async function beginGoogleCalendarConnection(calendarId: string) {
  const query = new URLSearchParams({ calendarId });
  const result = await apiRequest<{ authorizationUrl: string }>(
    `/api/google-calendar/connect?${query}`,
  );
  window.location.assign(result.authorizationUrl);
}

export function runGoogleCalendarAction(action: "sync" | "renew" | "disconnect") {
  return apiRequest<Record<string, unknown>>("/api/google-calendar/actions", {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}

export function syncAgendaEvent(eventId: string) {
  return apiRequest<{ status: string }>("/api/google-calendar/sync-event", {
    method: "POST",
    body: JSON.stringify({ eventId }),
  });
}

export function resolveAgendaConflict(eventId: string, resolution: "crm" | "google") {
  return apiRequest<{ status: string }>("/api/google-calendar/sync-event", {
    method: "POST",
    body: JSON.stringify({ eventId, resolution }),
  });
}
