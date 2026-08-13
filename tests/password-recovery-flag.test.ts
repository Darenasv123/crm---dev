/**
 * password-recovery-flag.test.ts
 *
 * Cubre el feature flag VITE_PASSWORD_RECOVERY_ENABLED que deshabilita
 * "Olvidé mi contraseña" para el release inicial (SMTP self-hosted no
 * funcional). Debe ser fail-closed: cualquier valor que no sea exactamente
 * "true" deja la función deshabilitada.
 *
 * No se modifica ni se elimina la lógica de recuperación existente
 * (ver tests/password-recovery.test.ts) — solo se audita que quede
 * correctamente controlada por el flag.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isPasswordRecoveryEnabled } from "../src/lib/feature-flags";

const login = readFileSync("src/routes/login.tsx", "utf8");
const request = readFileSync("src/routes/recuperar-contrasena.tsx", "utf8");
const reset = readFileSync("src/routes/restablecer-contrasena.tsx", "utf8");
const envExample = readFileSync(".env.example", "utf8");

describe("isPasswordRecoveryEnabled — fail-closed", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("deshabilitado cuando la variable está ausente", () => {
    vi.stubEnv("VITE_PASSWORD_RECOVERY_ENABLED", undefined as unknown as string);
    expect(isPasswordRecoveryEnabled()).toBe(false);
  });

  it('deshabilitado cuando la variable es "false"', () => {
    vi.stubEnv("VITE_PASSWORD_RECOVERY_ENABLED", "false");
    expect(isPasswordRecoveryEnabled()).toBe(false);
  });

  it("deshabilitado ante valores inesperados (typos, mayúsculas, numéricos)", () => {
    for (const value of ["TRUE", "True", "1", "yes", " true", "true "]) {
      vi.stubEnv("VITE_PASSWORD_RECOVERY_ENABLED", value);
      expect(isPasswordRecoveryEnabled()).toBe(false);
    }
  });

  it('habilitado únicamente cuando el valor es exactamente "true"', () => {
    vi.stubEnv("VITE_PASSWORD_RECOVERY_ENABLED", "true");
    expect(isPasswordRecoveryEnabled()).toBe(true);
  });
});

describe(".env.example documenta el flag", () => {
  it("declara VITE_PASSWORD_RECOVERY_ENABLED=false por defecto", () => {
    expect(envExample).toContain("VITE_PASSWORD_RECOVERY_ENABLED=false");
  });
});

describe("login: enlace oculto cuando el flag está deshabilitado", () => {
  it("el enlace '¿Olvidaste tu contraseña?' está condicionado al flag", () => {
    expect(login).toContain("isPasswordRecoveryEnabled()");
    expect(login.indexOf("isPasswordRecoveryEnabled()")).toBeLessThan(
      login.indexOf("¿Olvidaste tu contraseña?"),
    );
  });
});

describe("/recuperar-contrasena bloqueada cuando el flag está deshabilitado", () => {
  it("no permite ejecutar resetPasswordForEmail sin el flag habilitado", () => {
    expect(request).toContain("const recoveryEnabled = isPasswordRecoveryEnabled();");
    expect(request).toContain("if (!recoveryEnabled) return;");
    const guardIndex = request.indexOf("if (!recoveryEnabled) return;");
    const callIndex = request.indexOf("supabase.auth.resetPasswordForEmail");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(callIndex);
  });

  it("renderiza una vista bloqueada en vez del formulario cuando está deshabilitado", () => {
    expect(request).toContain("if (!recoveryEnabled) {");
    expect(request).toContain("Función no disponible");
    expect(request).toContain('<Link to="/login">Volver al inicio de sesión</Link>');
  });

  it("mantiene el formulario original cuando el flag está habilitado", () => {
    expect(request).toContain("supabase.auth.resetPasswordForEmail(email.trim(), {");
    expect(request).toContain("Enviar enlace seguro");
  });
});

describe("/restablecer-contrasena bloqueada cuando el flag está deshabilitado", () => {
  it("arranca en fase 'invalid' y no procesa recovery si está deshabilitado", () => {
    expect(reset).toContain(
      'const [phase, setPhase] = useState<RecoveryPhase>(recoveryEnabled ? "validating" : "invalid");',
    );
    expect(reset).toContain("if (!recoveryEnabled) return;");
  });

  it("no registra el listener PASSWORD_RECOVERY ni llama getSession si está deshabilitado", () => {
    const effectGuardIndex = reset.indexOf("if (!recoveryEnabled) return;");
    const listenerIndex = reset.indexOf("onAuthStateChange");
    const getSessionIndex = reset.indexOf(".getSession()");
    expect(effectGuardIndex).toBeGreaterThan(-1);
    expect(effectGuardIndex).toBeLessThan(listenerIndex);
    expect(effectGuardIndex).toBeLessThan(getSessionIndex);
  });

  it("no llama updateUser en submit si está deshabilitado", () => {
    const submitStart = reset.indexOf("async function submit(");
    const guardIndex = reset.indexOf("if (!recoveryEnabled) return;", submitStart);
    const updateIndex = reset.indexOf("supabase.auth.updateUser({ password })");
    expect(guardIndex).toBeGreaterThan(submitStart);
    expect(guardIndex).toBeLessThan(updateIndex);
  });

  it("muestra un mensaje de función deshabilitada y redirige a /login", () => {
    expect(reset).toContain(
      "La recuperación de contraseña está deshabilitada temporalmente. Contacta al administrador del estudio.",
    );
    expect(reset).toContain('<Link to="/login">Volver al inicio de sesión</Link>');
  });

  it("mantiene el flujo de recuperación original cuando el flag está habilitado", () => {
    expect(reset).toContain('setPhase(session ? "ready" : "invalid")');
    expect(reset).toContain("supabase.auth.updateUser({ password })");
  });
});
