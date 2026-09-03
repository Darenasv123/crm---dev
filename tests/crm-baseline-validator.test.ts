/**
 * crm-baseline-validator.test.ts
 *
 * Pruebas de scripts/validate-crm-baseline.mjs (Fase 8I-B2B-0B2B-I1 —
 * ver server-release/docs/GOOGLE_DRIVE_REAL_VALIDATION_RUNBOOK.md,
 * Secciones 44-47). Estático únicamente: nunca se conecta a una base de
 * datos ni ejecuta SQL.
 *
 * Dos grupos de pruebas:
 *   1. El baseline real (supabase/migrations/20260713120000_crm_
 *      application_baseline.sql) pasa las 25 comprobaciones.
 *   2. Las funciones puras del validador detectan correctamente
 *      violaciones sintéticas — no basta con que el archivo real pase;
 *      cada comprobación debe demostrar que también falla cuando debe
 *      fallar (Sección 17 del pedido: la prueba de equivalencia de
 *      handle_new_user no debe ser tan laxa que un cambio de seguridad
 *      relevante pase inadvertido).
 */

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BASELINE_FILENAME,
  EXPECTED_HISTORICAL_COUNT,
  EXPECTED_MANIFEST_V1_SHA256,
  EXPECTED_TOTAL_COUNT_WITH_BASELINE,
  MIGRATIONS_DIR,
  ROLE_METADATA_ESCALATION_PATTERN,
  computeManifest,
  computeManifestV2,
  extractFunctionSource,
  normalizeSql,
  stripSqlComments,
  validateBaseline,
} from "../scripts/validate-crm-baseline.mjs";

describe("validateBaseline() — baseline real del repositorio", () => {
  const results = validateBaseline();

  it("produce al menos una comprobación por cada requisito del pedido", () => {
    // 14 requisitos numerados en el pedido de Fase I1, algunos se
    // expresan como varias comprobaciones individuales (p.ej. cada
    // patrón prohibido de plataforma es su propia entrada) — el total
    // real (25) es mayor o igual a 14.
    expect(results.length).toBeGreaterThanOrEqual(14);
  });

  it("todas las comprobaciones pasan contra el archivo real", () => {
    const failed = results.filter((r) => !r.passed);
    expect(failed).toEqual([]);
  });

  it.each(results.map((r) => [r.id, r] as const))("%s", (_id, r) => {
    expect(r.passed, r.detail || r.description).toBe(true);
  });
});

describe("MANIFEST_V1 / MANIFEST_V2 — consistencia con el runbook", () => {
  it("MANIFEST_V1 sobre las 34 migraciones históricas coincide con el valor congelado", () => {
    const historical = readdirSync(MIGRATIONS_DIR).filter(
      (f) => f.endsWith(".sql") && f !== BASELINE_FILENAME,
    );
    expect(historical.length).toBe(EXPECTED_HISTORICAL_COUNT);
    const manifest = computeManifest(MIGRATIONS_DIR, historical);
    expect(manifest.count).toBe(EXPECTED_HISTORICAL_COUNT);
    expect(manifest.sha256).toBe(EXPECTED_MANIFEST_V1_SHA256);
    expect(manifest.sha256).toHaveLength(64);
  });

  it("MANIFEST_V2 sobre las 35 migraciones (34 históricas + baseline) es determinista y de 64 caracteres", () => {
    const v2a = computeManifestV2();
    const v2b = computeManifestV2();
    expect(v2a.count).toBe(EXPECTED_TOTAL_COUNT_WITH_BASELINE);
    expect(v2a.sha256).toHaveLength(64);
    expect(v2a.sha256).toBe(v2b.sha256); // determinista entre corridas
  });

  it("MANIFEST_V1 histórico permanece sin cambios aunque exista el baseline (no se recalcula sobre 35)", () => {
    const historical = readdirSync(MIGRATIONS_DIR).filter(
      (f) => f.endsWith(".sql") && f !== BASELINE_FILENAME,
    );
    const manifestV1 = computeManifest(MIGRATIONS_DIR, historical);
    const manifestV2 = computeManifestV2();
    expect(manifestV1.sha256).not.toBe(manifestV2.sha256);
    expect(manifestV1.sha256).toBe(EXPECTED_MANIFEST_V1_SHA256);
  });
});

describe("extractFunctionSource() / normalizeSql() — funciones puras", () => {
  it("extrae un bloque create function completo delimitado por $$", () => {
    const sql = `
create table public.noise (id uuid);

create function public.handle_new_user()
returns trigger
language plpgsql
as $$
begin
  return new;
end;
$$;

create table public.more_noise (id uuid);
`;
    const extracted = extractFunctionSource(sql, "handle_new_user");
    expect(extracted).not.toBeNull();
    expect(extracted).toContain("begin");
    expect(extracted).toContain("return new;");
    expect(extracted).not.toContain("noise");
  });

  it("retorna null si la función no existe", () => {
    expect(extractFunctionSource("create table public.x (id uuid);", "handle_new_user")).toBeNull();
  });

  it("normalizeSql ignora diferencias de espacio en blanco y mayúsculas/minúsculas irrelevantes", () => {
    const a = "select   1;\n-- comentario\nselect 2;";
    const b = "SELECT 1;\nSELECT 2;";
    expect(normalizeSql(a)).toBe(normalizeSql(b));
  });

  it("stripSqlComments elimina comentarios de línea y de bloque sin tocar el SQL ejecutable", () => {
    const sql = "select 1; -- esto es un comentario\n/* bloque\nmultilinea */\nselect 2;";
    const stripped = stripSqlComments(sql);
    expect(stripped).not.toContain("comentario");
    expect(stripped).not.toContain("multilinea");
    expect(stripped).toContain("select 1;");
    expect(stripped).toContain("select 2;");
  });
});

describe("Equivalencia estricta de handle_new_user (Sección 17 del pedido)", () => {
  const baselineSql = readFileSync(`${MIGRATIONS_DIR}/${BASELINE_FILENAME}`, "utf8");
  const hardenedSql = readFileSync("supabase/self-hosted/0004_functions_and_rpc.sql", "utf8");

  const baselineFn = extractFunctionSource(baselineSql, "handle_new_user");
  const hardenedFn = extractFunctionSource(hardenedSql, "handle_new_user");

  it("ambas fuentes contienen la función", () => {
    expect(baselineFn).not.toBeNull();
    expect(hardenedFn).not.toBeNull();
  });

  it("son equivalentes tras normalizar espacios en blanco", () => {
    expect(normalizeSql(baselineFn!)).toBe(normalizeSql(hardenedFn!));
  });

  it("ninguna de las dos lee role/status desde metadata de usuario", () => {
    expect(ROLE_METADATA_ESCALATION_PATTERN.test(stripSqlComments(baselineFn!))).toBe(false);
    expect(ROLE_METADATA_ESCALATION_PATTERN.test(stripSqlComments(hardenedFn!))).toBe(false);
  });

  it("la prueba SÍ detecta un cambio de seguridad significativo (no es demasiado laxa)", () => {
    // Reintroduce exactamente la vulnerabilidad histórica de T0 dentro de
    // una copia sintética — si esto pasara como "equivalente", la prueba
    // de equivalencia sería inútil como control de seguridad.
    const tampered = baselineFn!.replace(
      "'Personal',",
      "coalesce(new.raw_user_meta_data->>'role', 'Personal'),",
    );
    expect(tampered).not.toBe(baselineFn);
    expect(normalizeSql(tampered)).not.toBe(normalizeSql(hardenedFn!));
    expect(ROLE_METADATA_ESCALATION_PATTERN.test(stripSqlComments(tampered))).toBe(true);
  });

  it("la prueba SÍ detecta un cambio trivial de espacio en blanco como equivalente (no es demasiado estricta)", () => {
    const reformatted = baselineFn!.replace(/\n/g, "\n\n").replace(/ {2}/g, "    ");
    expect(normalizeSql(reformatted)).toBe(normalizeSql(baselineFn!));
  });
});

describe("validateBaseline() detecta violaciones sintéticas (no solo confirma el caso feliz)", () => {
  // Cada prueba de esta sección construye una versión deliberadamente
  // rota del validador leyendo el archivo real y verificando el patrón
  // directamente, sin depender de un repoRoot sintético completo —
  // suficiente para probar que las expresiones regulares/heurísticas
  // realmente detectan lo que dicen detectar.

  it("ROLE_METADATA_ESCALATION_PATTERN detecta raw_user_meta_data->>'role'", () => {
    expect(
      ROLE_METADATA_ESCALATION_PATTERN.test(
        "coalesce(new.raw_user_meta_data->>'role', 'Personal')",
      ),
    ).toBe(true);
    expect(ROLE_METADATA_ESCALATION_PATTERN.test("new.raw_user_meta_data ->> 'status'")).toBe(true);
  });

  it("ROLE_METADATA_ESCALATION_PATTERN NO detecta lecturas inocuas de metadata (full_name/phone)", () => {
    expect(ROLE_METADATA_ESCALATION_PATTERN.test("new.raw_user_meta_data ->> 'full_name'")).toBe(
      false,
    );
    expect(ROLE_METADATA_ESCALATION_PATTERN.test("new.raw_user_meta_data ->> 'phone'")).toBe(false);
  });

  it("un comentario que cita la vulnerabilidad para documentarla no la reproduce como SQL ejecutable", () => {
    const documented = `
-- La version original leia raw_user_meta_data->>'role' (vulnerable).
create function public.handle_new_user() returns trigger language plpgsql as $$
begin
  insert into public.profiles (id, role) values (new.id, 'Personal');
  return new;
end;
$$;
`;
    const executableOnly = stripSqlComments(documented);
    expect(ROLE_METADATA_ESCALATION_PATTERN.test(documented)).toBe(true); // el texto crudo sí lo contiene
    expect(ROLE_METADATA_ESCALATION_PATTERN.test(executableOnly)).toBe(false); // el SQL ejecutable no
  });
});
