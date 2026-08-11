import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const client = readFileSync("src/lib/supabase.ts", "utf8");
const request = readFileSync("src/routes/recuperar-contrasena.tsx", "utf8");
const reset = readFileSync("src/routes/restablecer-contrasena.tsx", "utf8");
const authProvider = readFileSync("src/hooks/use-auth.tsx", "utf8");
const appGuard = readFileSync("src/routes/_app.tsx", "utf8");

describe("recuperación de contraseña", () => {
  it("habilita el procesamiento nativo de callbacks sin cambiar persistencia", () => {
    expect(client).toContain("detectSessionInUrl: true");
    expect(client).toContain("autoRefreshToken: true");
    expect(client).toContain("persistSession: true");
    expect(client).not.toMatch(/flowType\s*:\s*["']pkce["']/);
  });

  it("envía el correo con la ruta de restablecimiento sobre el origen actual", () => {
    expect(request).toContain("supabase.auth.resetPasswordForEmail(email.trim(), {");
    expect(request).toContain("redirectTo: `${window.location.origin}/restablecer-contrasena`");
  });

  it("mantiene el mensaje de éxito anti-enumeración", () => {
    expect(request).toContain("Si el correo corresponde a una cuenta");
    expect(request).not.toMatch(/correo (?:no existe|existe)/i);
  });

  it("maneja errores devueltos y excepciones sin exponer mensajes internos", () => {
    expect(request).toContain("const { error: resetError }");
    expect(request).toMatch(/if \(resetError\)[\s\S]*No pudimos enviar el enlace/);
    expect(request).toMatch(/catch \{[\s\S]*No pudimos enviar el enlace/);
    expect(request).not.toContain("resetError.message");
  });

  it("siempre limpia sending mediante finally", () => {
    expect(request).toMatch(/finally \{\s*setSending\(false\);\s*\}/);
  });

  it("PASSWORD_RECOVERY habilita el formulario con su sesión", () => {
    expect(reset).toContain('event !== "PASSWORD_RECOVERY"');
    expect(reset).toContain('setPhase(session ? "ready" : "invalid")');
  });

  it("registra el listener antes del fallback getSession", () => {
    expect(reset.indexOf("onAuthStateChange")).toBeLessThan(reset.indexOf(".getSession()"));
    expect(reset).toContain("recoveryEventHandled");
    expect(reset).toContain("subscription.unsubscribe()");
  });

  it("getSession habilita el formulario si el callback ya fue procesado", () => {
    expect(reset).toContain('setPhase(!sessionError && data.session ? "ready" : "invalid")');
  });

  it("sin sesión muestra que el enlace venció o fue utilizado", () => {
    expect(reset).toContain("El enlace venció o ya fue utilizado. Solicita uno nuevo.");
    expect(reset).toContain('phase === "invalid"');
  });

  it("rechaza contraseña débil y confirmación diferente", () => {
    expect(reset).toContain("password.length < 12");
    expect(reset).toContain("!/[A-Z]/.test(password)");
    expect(reset).toContain("!/[a-z]/.test(password)");
    expect(reset).toContain("!/\\d/.test(password)");
    expect(reset).toContain("password !== confirmation");
  });

  it("actualiza explícitamente al usuario sólo después de comprobar sesión", () => {
    const sessionCheck = reset.indexOf("sessionError || !sessionData.session");
    const update = reset.indexOf("supabase.auth.updateUser({ password })");
    expect(sessionCheck).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(sessionCheck);
    expect(reset).toContain("data: updateData, error: updateError");
  });

  it("muestra un error genérico cuando updateUser falla", () => {
    expect(reset).toMatch(/updateError \|\| !updateData\.user/);
    expect(reset).toContain("No se pudo actualizar la contraseña. Solicita un enlace nuevo.");
    expect(reset).not.toContain("updateError.message");
  });

  it("tras el éxito cierra sesiones globales y navega al login", () => {
    expect(reset).toContain('supabase.auth.signOut({ scope: "global" })');
    expect(reset).toContain('navigate({ to: "/login" })');
    expect(reset.indexOf("signOut")).toBeLessThan(reset.indexOf('navigate({ to: "/login" })'));
  });

  it("no registra ni muestra tokens Auth", () => {
    const recoverySources = `${request}\n${reset}`;
    expect(recoverySources).not.toMatch(/console\.(?:log|error|warn)/);
    expect(recoverySources).not.toMatch(/access_token|refresh_token/i);
  });

  it("mantiene públicas ambas rutas fuera del guard _app", () => {
    expect(request).toContain('createFileRoute("/recuperar-contrasena")');
    expect(reset).toContain('createFileRoute("/restablecer-contrasena")');
    expect(appGuard).toContain('navigate({ to: "/login", replace: true })');
    expect(authProvider).not.toContain('navigate({ to: "/login"');
  });
});
