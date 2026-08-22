import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn(),
  createTransport: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: mocks.createTransport },
}));

import { setServerRuntimeEnv } from "@/lib/server-runtime-env";
import {
  getEmailConfigStatus,
  isValidEmail,
  sendEmail,
  sendReportEmail,
  sendTestEmail,
} from "@/lib/email.server";

const SMTP_KEYS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "SMTP_FROM_EMAIL",
  "SMTP_FROM_NAME",
];

function clearEnv() {
  setServerRuntimeEnv({});
  for (const key of SMTP_KEYS) delete process.env[key];
}

const CONFIGURED_ENV = {
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: "587",
  SMTP_USER: "user@example.com",
  SMTP_PASSWORD: "supersecret",
  SMTP_FROM_EMAIL: "notificaciones@estudio.pe",
  SMTP_FROM_NAME: "Estudio Jurídico",
};

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("getEmailConfigStatus — Config", () => {
  beforeEach(() => {
    clearEnv();
    vi.clearAllMocks();
  });
  afterEach(() => clearEnv());

  it("reporta no configurado cuando faltan variables requeridas", () => {
    const status = getEmailConfigStatus();
    expect(status.configured).toBe(false);
    expect(status.missingVars).toContain("SMTP_HOST");
    expect(status.missingVars).toContain("SMTP_USER");
    expect(status.missingVars).toContain("SMTP_PASSWORD");
    expect(status.missingVars).toContain("SMTP_FROM_EMAIL");
  });

  it("reporta incompleto si falta solo una variable requerida", () => {
    setServerRuntimeEnv({ ...CONFIGURED_ENV, SMTP_PASSWORD: "" });
    const status = getEmailConfigStatus();
    expect(status.configured).toBe(false);
    expect(status.missingVars).toEqual(["SMTP_PASSWORD"]);
  });

  it("nunca incluye password, usuario ni host en el estado devuelto (secretos no retornados)", () => {
    setServerRuntimeEnv(CONFIGURED_ENV);
    const status = getEmailConfigStatus();
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain("supersecret");
    expect(serialized).not.toContain("user@example.com");
    expect(serialized).not.toContain("smtp.example.com");
  });

  it("reporta configurado y expone solo remitente/seguridad cuando están todas las variables", () => {
    setServerRuntimeEnv(CONFIGURED_ENV);
    const status = getEmailConfigStatus();
    expect(status.configured).toBe(true);
    expect(status.fromEmail).toBe("notificaciones@estudio.pe");
    expect(status.fromName).toBe("Estudio Jurídico");
    expect(status.missingVars).toEqual([]);
  });

  it("infiere secure=true solo para el puerto 465 sin SMTP_SECURE explícito", () => {
    setServerRuntimeEnv({ ...CONFIGURED_ENV, SMTP_PORT: "465" });
    expect(getEmailConfigStatus().secure).toBe(true);
    setServerRuntimeEnv({ ...CONFIGURED_ENV, SMTP_PORT: "587" });
    expect(getEmailConfigStatus().secure).toBe(false);
  });

  it("SMTP_SECURE explícito tiene prioridad sobre la inferencia por puerto", () => {
    setServerRuntimeEnv({ ...CONFIGURED_ENV, SMTP_PORT: "587", SMTP_SECURE: "true" });
    expect(getEmailConfigStatus().secure).toBe(true);
  });
});

describe("isValidEmail — validación y prevención de header injection", () => {
  it("acepta correos bien formados", () => {
    expect(isValidEmail("cliente@estudio.pe")).toBe(true);
  });

  it("rechaza formatos inválidos", () => {
    expect(isValidEmail("no-es-correo")).toBe(false);
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("   ")).toBe(false);
  });

  it("rechaza intentos de header injection vía CR/LF", () => {
    expect(isValidEmail("a@b.com\r\nBcc: x@evil.com")).toBe(false);
    expect(isValidEmail("a@b.com\nX-Injected: 1")).toBe(false);
  });
});

describe("sendEmail — transporte (mockeado, sin red real)", () => {
  beforeEach(() => {
    clearEnv();
    vi.clearAllMocks();
    mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail });
    mocks.sendMail.mockResolvedValue({ messageId: "abc" });
  });
  afterEach(() => clearEnv());

  it("rechaza sin intentar transporte si Correo no está configurado", async () => {
    await expect(sendEmail({ to: "a@b.com", subject: "Asunto", text: "Hola" })).rejects.toThrow(
      /no configurado/i,
    );
    expect(mocks.createTransport).not.toHaveBeenCalled();
  });

  it("rechaza un destinatario inválido antes de construir el transporte", async () => {
    setServerRuntimeEnv(CONFIGURED_ENV);
    await expect(
      sendEmail({ to: "no-es-correo", subject: "Asunto", text: "Hola" }),
    ).rejects.toThrow(/no es válido/i);
    expect(mocks.createTransport).not.toHaveBeenCalled();
  });

  it("crea el transporte con host/puerto/credenciales correctos y envía (éxito)", async () => {
    setServerRuntimeEnv(CONFIGURED_ENV);
    await sendEmail({ to: "cliente@estudio.pe", subject: "Asunto", text: "Hola" });

    expect(mocks.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.example.com",
        port: 587,
        auth: { user: "user@example.com", pass: "supersecret" },
      }),
    );
    expect(mocks.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "cliente@estudio.pe", subject: "Asunto" }),
    );
  });

  it("elimina saltos de línea del asunto (previene header injection)", async () => {
    setServerRuntimeEnv(CONFIGURED_ENV);
    await sendEmail({
      to: "cliente@estudio.pe",
      subject: "Asunto\r\nBcc: x@evil.com",
      text: "Hola",
    });
    const call = mocks.sendMail.mock.calls[0][0];
    expect(call.subject).not.toMatch(/[\r\n]/);
  });

  it("propaga un fallo de transporte como error controlado (sin stack trace crudo)", async () => {
    setServerRuntimeEnv(CONFIGURED_ENV);
    mocks.sendMail.mockRejectedValue(new Error("Connection refused"));
    await expect(
      sendEmail({ to: "cliente@estudio.pe", subject: "Asunto", text: "Hola" }),
    ).rejects.toThrow(/Connection refused/);
  });

  it("una única función construye/usa el transporter (no hay un segundo createTransport)", () => {
    const lib = source("src/lib/email.server.ts");
    expect(lib.match(/createTransport\(/g)).toHaveLength(1);
  });
});

describe("sendTestEmail / sendReportEmail", () => {
  beforeEach(() => {
    clearEnv();
    vi.clearAllMocks();
    setServerRuntimeEnv(CONFIGURED_ENV);
    mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail });
    mocks.sendMail.mockResolvedValue({ messageId: "abc" });
  });
  afterEach(() => clearEnv());

  it("sendTestEmail envía un mensaje identificable como prueba", async () => {
    await sendTestEmail("destino@ejemplo.com");
    const call = mocks.sendMail.mock.calls[0][0];
    expect(call.to).toBe("destino@ejemplo.com");
    expect(call.subject).toMatch(/prueba/i);
  });

  it("sendReportEmail incluye el nombre del cliente y el cuerpo real del reporte, sin inventar datos", async () => {
    await sendReportEmail({
      to: "cliente@estudio.pe",
      clientName: "Ana Torres",
      reportTitle: "Reporte de Familia",
      reportBody: "El expediente avanza según lo previsto.",
    });
    const call = mocks.sendMail.mock.calls[0][0];
    expect(call.to).toBe("cliente@estudio.pe");
    expect(call.text).toContain("Ana Torres");
    expect(call.text).toContain("El expediente avanza según lo previsto.");
    expect(call.subject).toContain("Reporte de Familia");
  });

  it("sendReportEmail no adjunta archivos", async () => {
    await sendReportEmail({
      to: "cliente@estudio.pe",
      clientName: "Ana Torres",
      reportTitle: "Reporte",
      reportBody: "Cuerpo",
    });
    const call = mocks.sendMail.mock.calls[0][0];
    expect(call.attachments).toBeUndefined();
  });
});

describe("Seguridad de los endpoints /api/email/* (verificación estructural)", () => {
  const statusRoute = source("src/routes/api.email.status.ts");
  const testRoute = source("src/routes/api.email.test.ts");
  const sendReportRoute = source("src/routes/api.email.send-report.ts");
  const emailServer = source("src/lib/email.server.ts");

  it("los tres endpoints exigen sesión autenticada y rol antes de cualquier acción", () => {
    for (const route of [statusRoute, testRoute, sendReportRoute]) {
      expect(route).toContain("await requireEmailRole(request,");
    }
  });

  it("enviar correo de prueba está restringido a Administrador (acción de verificación de integración)", () => {
    expect(testRoute).toContain('requireEmailRole(request, ["Administrador"])');
  });

  it("consultar estado y enviar reporte están disponibles para todo el staff (Administrador y Personal)", () => {
    expect(statusRoute).toContain('requireEmailRole(request, ["Administrador", "Personal"])');
    expect(sendReportRoute).toContain('requireEmailRole(request, ["Administrador", "Personal"])');
  });

  it("ningún endpoint acepta configuración SMTP enviada por el cliente", () => {
    expect(testRoute).not.toMatch(/\bsmtp\b|\bhost\b|\bpassword\b|\bport\b/i);
    expect(sendReportRoute).not.toMatch(/\bsmtp\b|\bhost\b|\bpassword\b|\bport\b/i);
    // El único campo aceptado del body es el destino/identificador, no credenciales.
    expect(testRoute).toContain("body.to");
    expect(sendReportRoute).toContain("body.reportId");
  });

  it("valida el email de prueba antes de intentar el envío", () => {
    expect(testRoute).toContain("isValidEmail(to)");
  });

  it("send-report resuelve el correo del cliente en el servidor, no confía en un correo enviado por el cliente", () => {
    expect(sendReportRoute).not.toContain("body.to");
    expect(sendReportRoute).not.toContain("body.email");
    expect(sendReportRoute).toContain("client?.email");
  });

  it("las respuestas de error no exponen stack traces ni secretos (safeEmailServerError)", () => {
    expect(emailServer).toContain("export function safeEmailServerError");
    expect(emailServer).not.toMatch(/cause\.stack/);
    expect(emailServer).toContain("Response.json({ error: message }");
  });

  it("las credenciales SMTP solo se leen server-side, nunca desde variables VITE_*", () => {
    expect(emailServer).not.toMatch(/VITE_SMTP|import\.meta\.env\.SMTP/);
    expect(emailServer).toContain("readServerRuntimeEnv");
  });

  it("POST /api/email/send-report no puede usarse como open relay: ningún destinatario llega desde el body de la petición", () => {
    // El único identificador aceptado es reportId; el destinatario real
    // (client.email) se resuelve en el servidor a partir del reporte, así
    // que un atacante no puede pasar `to: "attacker@example.com"` para
    // reenviar correo arbitrario a través de este endpoint.
    const bodyDestructure = sendReportRoute.match(
      /const body = \(await request\.json\(\)[\s\S]*?as \{[^}]*\};/,
    )?.[0];
    expect(bodyDestructure).toBeDefined();
    expect(bodyDestructure).not.toContain("to?:");
    expect(bodyDestructure).not.toContain("email?:");
    expect(bodyDestructure).toContain("reportId?:");
  });

  it("nodemailer solo se importa en código server-side, nunca en email-client.ts ni en hooks/componentes", () => {
    const emailClient = source("src/lib/email-client.ts");
    const useEmailHook = source("src/hooks/use-email.ts");
    expect(emailClient).not.toContain("nodemailer");
    expect(useEmailHook).not.toContain("nodemailer");
    expect(emailServer.match(/^import nodemailer/m)).not.toBeNull();
  });

  it("no configura TLS inseguro (rejectUnauthorized:false / ignoreTLS)", () => {
    expect(emailServer).not.toMatch(/rejectUnauthorized\s*:\s*false/);
    expect(emailServer).not.toMatch(/ignoreTLS/);
  });
});
