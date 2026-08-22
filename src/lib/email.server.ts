import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth-server";
import { readServerRuntimeEnv } from "@/lib/server-runtime-env";

/**
 * Capa centralizada de correo saliente (Fase 5). Server-only: nunca debe
 * importarse desde código que corra en el navegador -- las credenciales SMTP
 * son secretos y solo existen aquí, leídas de variables de entorno del
 * servidor (nunca VITE_*, nunca en una tabla accesible por el frontend).
 *
 * Configuración esperada (todas opcionales para que el CRM arranque sin
 * Correo configurado -- ver scripts/validate-production-env.mjs):
 *   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD,
 *   SMTP_FROM_EMAIL, SMTP_FROM_NAME
 */

const REQUIRED_SMTP_VARS = ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM_EMAIL"] as const;

export interface EmailConfigStatus {
  configured: boolean;
  /** Nombres de variables server-side que faltan (nunca sus valores). */
  missingVars: string[];
  /** Datos seguros de mostrar en el panel de Configuración -- nunca password/host/user. */
  fromEmail: string | null;
  fromName: string | null;
  secure: boolean | null;
}

function smtpVar(
  name: (typeof REQUIRED_SMTP_VARS)[number] | "SMTP_PORT" | "SMTP_SECURE" | "SMTP_FROM_NAME",
) {
  return readServerRuntimeEnv(name);
}

/** Estado seguro de la configuración SMTP, apto para exponerse al panel de Configuración. */
export function getEmailConfigStatus(): EmailConfigStatus {
  const missingVars = REQUIRED_SMTP_VARS.filter((name) => !smtpVar(name));
  const configured = missingVars.length === 0;

  if (!configured) {
    return { configured: false, missingVars, fromEmail: null, fromName: null, secure: null };
  }

  return {
    configured: true,
    missingVars: [],
    fromEmail: smtpVar("SMTP_FROM_EMAIL"),
    fromName: smtpVar("SMTP_FROM_NAME") || null,
    secure: resolveSecure(),
  };
}

function resolveSecure(): boolean {
  const raw = smtpVar("SMTP_SECURE");
  if (raw) return raw.toLowerCase() === "true";
  // Sin SMTP_SECURE explícito: el puerto 465 es SMTPS implícito, cualquier
  // otro (587, 25, ...) usa STARTTLS/no seguro por defecto.
  return smtpVar("SMTP_PORT") === "465";
}

function requireEmailConfig() {
  const status = getEmailConfigStatus();
  if (!status.configured) {
    throw new Error(
      `Correo no configurado. Faltan las variables de servidor: ${status.missingVars.join(", ")}.`,
    );
  }
  return status;
}

function buildTransport() {
  requireEmailConfig();
  const port = Number(smtpVar("SMTP_PORT") || "587");
  return nodemailer.createTransport({
    host: smtpVar("SMTP_HOST"),
    port: Number.isFinite(port) ? port : 587,
    secure: resolveSecure(),
    auth: {
      user: smtpVar("SMTP_USER"),
      pass: smtpVar("SMTP_PASSWORD"),
    },
  });
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** Valida un correo simple y rechaza cualquier carácter de control (CR/LF) que permita header injection. */
export function isValidEmail(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) return false;
  return EMAIL_RE.test(trimmed);
}

/** Elimina saltos de línea de un valor que va a un header de correo (asunto), previniendo header injection. */
function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Única función que construye/usa el transporter -- no duplicar en otros módulos. */
export async function sendEmail({ to, subject, text, html }: SendEmailInput) {
  if (!isValidEmail(to)) throw new Error("El correo del destinatario no es válido.");
  const cleanSubject = sanitizeHeaderValue(subject);
  if (!cleanSubject) throw new Error("El correo debe tener un asunto.");

  const status = requireEmailConfig();
  const transport = buildTransport();
  const fromName = status.fromName ? sanitizeHeaderValue(status.fromName) : null;
  const from = fromName ? `"${fromName}" <${status.fromEmail}>` : status.fromEmail!;

  try {
    await transport.sendMail({ from, to, subject: cleanSubject, text, html });
  } catch (cause) {
    throw new Error(
      cause instanceof Error
        ? `Error al enviar el correo: ${cause.message}`
        : "Error al enviar el correo.",
    );
  }
}

/** Envía un correo de prueba controlado (Configuración → Correo). */
export async function sendTestEmail(to: string) {
  await sendEmail({
    to,
    subject: "Correo de prueba — CRM Jurídico",
    text: "Este es un correo de prueba enviado desde la Configuración del CRM Jurídico. Si lo recibiste, la configuración SMTP funciona correctamente.",
  });
}

export interface ReportEmailInput {
  to: string;
  clientName: string;
  reportTitle: string;
  reportBody: string;
  studioName?: string;
}

/** Envía el contenido de un reporte de cliente ya guardado. No adjunta archivos. */
export async function sendReportEmail({
  to,
  clientName,
  reportTitle,
  reportBody,
  studioName = "Estudio Jurídico Arenas",
}: ReportEmailInput) {
  const subject = `${reportTitle} — ${studioName}`;
  const text = `Estimado(a) ${clientName}:\n\n${reportBody}\n\nAtentamente,\n${studioName}`;
  await sendEmail({ to, subject, text });
}

// ---------------------------------------------------------------------------
// Autenticación/autorización de los endpoints de correo (mismo patrón que
// src/lib/google-calendar.server.ts: bearer token -> requireUser -> rol vía
// service_role, sin exponer nunca la service_role key al cliente).
// ---------------------------------------------------------------------------

function serverSecret(name: string) {
  const value = readServerRuntimeEnv(name);
  if (!value) throw new Error(`Falta la configuración de servidor ${name}.`);
  return value;
}

function adminClient() {
  return createClient(serverSecret("SUPABASE_URL"), serverSecret("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function bearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

/** Exige sesión válida y perfil activo con alguno de los roles indicados. */
export async function requireEmailRole(request: Request, roles: string[]) {
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
    throw new Error("No tienes permiso para esta acción.");
  }
  return { user, role: profile.role as string };
}

/** Mapea errores a una respuesta segura, sin stack traces ni secretos (mismo patrón que google-calendar.server.ts). */
export function safeEmailServerError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : "Solicitud no válida.";
  const status = /sesión|permiso/i.test(message)
    ? 403
    : /falta|no configurado|no válido|inválid/i.test(message)
      ? 400
      : 500;
  return Response.json({ error: message }, { status });
}
