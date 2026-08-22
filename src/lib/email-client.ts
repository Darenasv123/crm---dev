import { supabase } from "@/lib/supabase";

export interface EmailConfigStatus {
  configured: boolean;
  missingVars: string[];
  fromEmail: string | null;
  fromName: string | null;
  secure: boolean | null;
}

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

export function getEmailConfigStatus() {
  return apiRequest<EmailConfigStatus>("/api/email/status");
}

export function sendTestEmail(to: string) {
  return apiRequest<{ sent: boolean }>("/api/email/test", {
    method: "POST",
    body: JSON.stringify({ to }),
  });
}

export function sendReportEmail(reportId: string) {
  return apiRequest<{ sent: boolean }>("/api/email/send-report", {
    method: "POST",
    body: JSON.stringify({ reportId }),
  });
}
