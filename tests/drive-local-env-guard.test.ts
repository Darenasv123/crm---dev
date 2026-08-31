import { describe, expect, it } from "vitest";
import {
  ALLOWED_HOSTS,
  DENYLIST_HOST_SUBSTRINGS,
  DENYLIST_REF_SUBSTRINGS,
  EXPECTED_STAGING_PROJECT_REF_VAR,
  RUNTIME_CRITICAL_VARS,
  evaluateEffectiveEnv,
  expectedStagingHost,
  mergeEffectiveEnv,
} from "../scripts/validate-drive-local-env.mjs";

const SAFE_RUNTIME_ENV = {
  VITE_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_URL: "http://127.0.0.1:54321",
  VITE_SUPABASE_ANON_KEY: "local-anon-key",
  SUPABASE_ANON_KEY: "local-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "local-service-role-key",
};

describe("validate-drive-local-env guard (Fase 8I-B2B-0B1.1 — runtime-aware)", () => {
  it("A. runtime URL localhost -> PASS", () => {
    const result = evaluateEffectiveEnv({
      ...SAFE_RUNTIME_ENV,
      VITE_SUPABASE_URL: "http://localhost:54321",
      SUPABASE_URL: "http://localhost:54321",
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("B. runtime URL 127.0.0.1 -> PASS", () => {
    const result = evaluateEffectiveEnv(SAFE_RUNTIME_ENV);

    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("C. runtime supabase.consoldi.com -> FAIL", () => {
    const result = evaluateEffectiveEnv({
      ...SAFE_RUNTIME_ENV,
      VITE_SUPABASE_URL: "https://supabase.consoldi.com",
      SUPABASE_URL: "https://supabase.consoldi.com",
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((line) => line.startsWith("VITE_SUPABASE_URL"))).toBe(true);
    expect(result.errors.some((line) => line.startsWith("SUPABASE_URL"))).toBe(true);
  });

  it("D. runtime legacy ref pnqdgwpxcxngeueosmnh -> FAIL", () => {
    const result = evaluateEffectiveEnv({
      ...SAFE_RUNTIME_ENV,
      VITE_SUPABASE_URL: "https://pnqdgwpxcxngeueosmnh.supabase.co",
      SUPABASE_URL: "https://pnqdgwpxcxngeueosmnh.supabase.co",
    });

    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("E. runtime host publico desconocido (ni allow ni denylist) -> FAIL (fail-closed)", () => {
    const result = evaluateEffectiveEnv({
      ...SAFE_RUNTIME_ENV,
      VITE_SUPABASE_URL: "https://some-other-project.supabase.co",
      SUPABASE_URL: "https://some-other-project.supabase.co",
    });

    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("F. runtime required (SUPABASE_URL bare) faltante -> FAIL", () => {
    const { SUPABASE_URL: _omit, ...rest } = SAFE_RUNTIME_ENV;
    const result = evaluateEffectiveEnv(rest);

    expect(result.ok).toBe(false);
    expect(result.errors.some((line) => line.startsWith("SUPABASE_URL"))).toBe(true);
  });

  it("G. un secreto presente nunca aparece en errors/warnings/checks", () => {
    const secretMarker = "sk_live_never_should_leak_9f7a2c";
    const result = evaluateEffectiveEnv({
      ...SAFE_RUNTIME_ENV,
      VITE_SUPABASE_URL: "https://supabase.consoldi.com",
      SUPABASE_URL: "https://supabase.consoldi.com",
      SUPABASE_SERVICE_ROLE_KEY: secretMarker,
      VITE_SUPABASE_SERVICE_ROLE_KEY: secretMarker,
    });

    expect(result.ok).toBe(false);
    for (const line of [...result.errors, ...result.warnings, ...result.checks]) {
      expect(line).not.toContain(secretMarker);
    }
  });

  it("H. runtime secondary Supabase URL de produccion (variable no clasificada) -> FAIL", () => {
    const result = evaluateEffectiveEnv({
      ...SAFE_RUNTIME_ENV,
      SUPABASE_DB_URL:
        "postgresql://postgres.pnqdgwpxcxngeueosmnh@aws-1-us-east-1.pooler.supabase.com:5432/postgres",
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((line) => line.startsWith("SUPABASE_DB_URL"))).toBe(true);
  });

  it("I. QA-only production URL sin consumo runtime -> NO falla, solo warning saneado", () => {
    const result = evaluateEffectiveEnv({
      ...SAFE_RUNTIME_ENV,
      QA_SUPABASE_URL: "https://supabase.consoldi.com",
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(
      result.warnings.some(
        (line) =>
          line.startsWith("IGNORED_NON_RUNTIME_PRODUCTION_REFERENCE") &&
          line.includes("QA_SUPABASE_URL"),
      ),
    ).toBe(true);
  });

  it("I.2 TEST-only production ref sin consumo runtime -> NO falla, solo warning saneado", () => {
    const result = evaluateEffectiveEnv({
      ...SAFE_RUNTIME_ENV,
      TEST_SUPABASE_URL: "https://pnqdgwpxcxngeueosmnh.supabase.co",
    });

    expect(result.ok).toBe(true);
    expect(
      result.warnings.some(
        (line) =>
          line.startsWith("IGNORED_NON_RUNTIME_PRODUCTION_REFERENCE") &&
          line.includes("TEST_SUPABASE_URL"),
      ),
    ).toBe(true);
  });

  it("J. process.env (produccion) prevalece sobre archivo local -> FAIL", () => {
    const fileEnv = {
      VITE_SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_URL: "http://127.0.0.1:54321",
    };
    const processEnvProduction = {
      VITE_SUPABASE_URL: "https://supabase.consoldi.com",
      SUPABASE_URL: "https://supabase.consoldi.com",
    };

    const merged = mergeEffectiveEnv(fileEnv, processEnvProduction);
    expect(merged.VITE_SUPABASE_URL).toBe("https://supabase.consoldi.com");

    const result = evaluateEffectiveEnv({ ...SAFE_RUNTIME_ENV, ...merged });
    expect(result.ok).toBe(false);
  });

  it("nunca permite VITE_SUPABASE_SERVICE_ROLE_KEY (se incrustaria en el bundle del cliente)", () => {
    const result = evaluateEffectiveEnv({
      ...SAFE_RUNTIME_ENV,
      VITE_SUPABASE_SERVICE_ROLE_KEY: "should-never-be-here",
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((line) => line.startsWith("VITE_SUPABASE_SERVICE_ROLE_KEY"))).toBe(
      true,
    );
  });

  it("expone las constantes de clasificacion runtime/denylist/allowlist esperadas", () => {
    expect(DENYLIST_HOST_SUBSTRINGS).toContain("supabase.consoldi.com");
    expect(DENYLIST_REF_SUBSTRINGS).toContain("pnqdgwpxcxngeueosmnh");
    expect(ALLOWED_HOSTS).toEqual(expect.arrayContaining(["localhost", "127.0.0.1"]));
    expect(RUNTIME_CRITICAL_VARS).toEqual(
      expect.arrayContaining([
        "VITE_SUPABASE_URL",
        "VITE_SUPABASE_ANON_KEY",
        "SUPABASE_URL",
        "SUPABASE_ANON_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
      ]),
    );
  });
});

describe("validate-drive-local-env guard — modo drive-hosted-staging (Fase 8I-B2B-0B1H)", () => {
  const STAGING_REF = "abcdefghijklmnopqrst";
  const OTHER_HOSTED_REF = "zzzzzzzzzzzzzzzzzzzz";

  const STAGING_RUNTIME_ENV = {
    [EXPECTED_STAGING_PROJECT_REF_VAR]: STAGING_REF,
    VITE_SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
    SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
    VITE_SUPABASE_ANON_KEY: "staging-anon-key",
    SUPABASE_ANON_KEY: "staging-anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "staging-service-role-key",
  };

  it("A. ref de staging exacto -> PASS", () => {
    const result = evaluateEffectiveEnv(STAGING_RUNTIME_ENV, "drive-hosted-staging");

    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(expectedStagingHost(STAGING_REF)).toBe(`${STAGING_REF}.supabase.co`);
  });

  it("B. otro proyecto Supabase Hosted (no el staging esperado) -> FAIL", () => {
    const result = evaluateEffectiveEnv(
      {
        ...STAGING_RUNTIME_ENV,
        VITE_SUPABASE_URL: `https://${OTHER_HOSTED_REF}.supabase.co`,
        SUPABASE_URL: `https://${OTHER_HOSTED_REF}.supabase.co`,
      },
      "drive-hosted-staging",
    );

    expect(result.ok).toBe(false);
    expect(result.errors.some((line) => line.startsWith("VITE_SUPABASE_URL"))).toBe(true);
    expect(result.errors.some((line) => line.startsWith("SUPABASE_URL"))).toBe(true);
  });

  it("C. produccion self-hosted (supabase.consoldi.com) -> FAIL", () => {
    const result = evaluateEffectiveEnv(
      {
        ...STAGING_RUNTIME_ENV,
        VITE_SUPABASE_URL: "https://supabase.consoldi.com",
        SUPABASE_URL: "https://supabase.consoldi.com",
      },
      "drive-hosted-staging",
    );

    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("D. ref legacy de produccion pnqdgwpxcxngeueosmnh -> FAIL", () => {
    const result = evaluateEffectiveEnv(
      {
        ...STAGING_RUNTIME_ENV,
        VITE_SUPABASE_URL: "https://pnqdgwpxcxngeueosmnh.supabase.co",
        SUPABASE_URL: "https://pnqdgwpxcxngeueosmnh.supabase.co",
      },
      "drive-hosted-staging",
    );

    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("E. EXPECTED_STAGING_SUPABASE_PROJECT_REF ausente -> FAIL (no acepta cualquier *.supabase.co)", () => {
    const { [EXPECTED_STAGING_PROJECT_REF_VAR]: _omit, ...rest } = STAGING_RUNTIME_ENV;
    const result = evaluateEffectiveEnv(rest, "drive-hosted-staging");

    expect(result.ok).toBe(false);
    expect(result.errors.some((line) => line.startsWith(EXPECTED_STAGING_PROJECT_REF_VAR))).toBe(
      true,
    );
    // La URL en si misma tambien debe reportarse como no permitida — sin
    // ref pinneado, ningun *.supabase.co es aceptable.
    expect(result.errors.some((line) => line.startsWith("VITE_SUPABASE_URL"))).toBe(true);
    expect(result.errors.some((line) => line.startsWith("SUPABASE_URL"))).toBe(true);
  });

  it("F. URL de staging correcta pero process.env de produccion la sobrescribe -> FAIL", () => {
    const fileEnv = {
      [EXPECTED_STAGING_PROJECT_REF_VAR]: STAGING_REF,
      VITE_SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
      SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
    };
    const processEnvProduction = {
      VITE_SUPABASE_URL: "https://supabase.consoldi.com",
      SUPABASE_URL: "https://supabase.consoldi.com",
    };

    const merged = mergeEffectiveEnv(fileEnv, processEnvProduction);
    expect(merged.VITE_SUPABASE_URL).toBe("https://supabase.consoldi.com");

    const result = evaluateEffectiveEnv(
      { ...STAGING_RUNTIME_ENV, ...merged },
      "drive-hosted-staging",
    );
    expect(result.ok).toBe(false);
  });

  it("G. secretos (anon key, service role key, ref esperado) nunca aparecen en errors/warnings/checks", () => {
    const secretMarker = "sk_staging_never_should_leak_7b3f1a";
    const result = evaluateEffectiveEnv(
      {
        ...STAGING_RUNTIME_ENV,
        VITE_SUPABASE_URL: `https://${OTHER_HOSTED_REF}.supabase.co`,
        SUPABASE_URL: `https://${OTHER_HOSTED_REF}.supabase.co`,
        SUPABASE_SERVICE_ROLE_KEY: secretMarker,
        SUPABASE_ANON_KEY: secretMarker,
      },
      "drive-hosted-staging",
    );

    expect(result.ok).toBe(false);
    for (const line of [...result.errors, ...result.warnings, ...result.checks]) {
      expect(line).not.toContain(secretMarker);
    }
  });

  it("modo drive-local sigue exigiendo localhost/127.0.0.1 sin cambios (regresion)", () => {
    const result = evaluateEffectiveEnv(
      {
        VITE_SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
        SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
        VITE_SUPABASE_ANON_KEY: "local-anon-key",
        SUPABASE_ANON_KEY: "local-anon-key",
        SUPABASE_SERVICE_ROLE_KEY: "local-service-role-key",
      },
      "drive-local",
    );

    expect(result.ok).toBe(false);
  });
});
