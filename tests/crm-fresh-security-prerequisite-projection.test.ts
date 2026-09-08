/**
 * crm-fresh-security-prerequisite-projection.test.ts
 *
 * Pruebas de scripts/build-crm-fresh-security-prerequisite-projection.mjs
 * (Fase 8I-B2B-0B2B-I2-E2C). Local únicamente: nunca abre una conexión de
 * base de datos, nunca modifica supabase/self-hosted/ ni
 * supabase/migrations/.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ACL_PROVENANCE_FILE_RELATIVE_PATH,
  EXPECTED_ACL_PROVENANCE_BLANKET_REVOKE_LINE,
  EXPECTED_ACL_PROVENANCE_FILE_SHA256,
  EXPECTED_ACL_PROVENANCE_GRANT_LINES,
  EXPECTED_ADMIN_FRAGMENT_SHA256,
  EXPECTED_SOURCE_FILE_SHA256,
  EXPECTED_STAFF_FRAGMENT_SHA256,
  ProjectionError,
  SOURCE_FILE_RELATIVE_PATH,
  TARGET_FUNCTIONS,
  buildProjection,
  extractAndAssemble,
  extractFunctionFragment,
  verifyAclProvenanceContent,
  writeProjectionToTempFile,
} from "../scripts/build-crm-fresh-security-prerequisite-projection.mjs";

const REAL_SOURCE_TEXT = readFileSync(SOURCE_FILE_RELATIVE_PATH, "utf8");
const REAL_ACL_PROVENANCE_TEXT = readFileSync(ACL_PROVENANCE_FILE_RELATIVE_PATH, "utf8");
const HEX64 = /^[0-9a-f]{64}$/i;

const tempRoots: string[] = [];
afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

/** Builds a throwaway repo root with both source files, so buildProjection()'s
 * whole-file hash gates can be exercised against mutated content without
 * touching the real repository. */
function fakeRepoRoot({
  sourceText = REAL_SOURCE_TEXT,
  aclText = REAL_ACL_PROVENANCE_TEXT,
}: {
  sourceText?: string;
  aclText?: string;
} = {}): string {
  const root = mkdtempSync(join(tmpdir(), "crm-security-prereq-test-"));
  tempRoots.push(root);
  const sourcePath = join(root, SOURCE_FILE_RELATIVE_PATH);
  const aclPath = join(root, ACL_PROVENANCE_FILE_RELATIVE_PATH);
  mkdirSync(dirname(sourcePath), { recursive: true });
  mkdirSync(dirname(aclPath), { recursive: true });
  writeFileSync(sourcePath, sourceText, "utf8");
  writeFileSync(aclPath, aclText, "utf8");
  return root;
}

describe("buildProjection() — fuente real congelada", () => {
  it("hash del archivo fuente completo coincide con el valor congelado (64 hex)", () => {
    const result = buildProjection();
    expect(result.sourceSha256).toBe(EXPECTED_SOURCE_FILE_SHA256);
    expect(HEX64.test(result.sourceSha256)).toBe(true);
  });

  it("extrae exactamente dos funciones, ningún tercero", () => {
    const result = buildProjection();
    expect(result.fragments).toHaveLength(2);
    expect(TARGET_FUNCTIONS).toHaveLength(2);
    const names = result.fragments.map((f) => f.name).sort();
    expect(names).toEqual(["crm_is_active_admin", "crm_is_active_staff"]);
  });

  it("cada hash de fragmento es exactamente 64 hex y coincide con el valor congelado", () => {
    const result = buildProjection();
    const staff = result.fragments.find((f) => f.name === "crm_is_active_staff")!;
    const admin = result.fragments.find((f) => f.name === "crm_is_active_admin")!;
    expect(HEX64.test(staff.sha256)).toBe(true);
    expect(HEX64.test(admin.sha256)).toBe(true);
    expect(staff.sha256).toBe(EXPECTED_STAFF_FRAGMENT_SHA256);
    expect(admin.sha256).toBe(EXPECTED_ADMIN_FRAGMENT_SHA256);
  });

  it("el proyectado empieza con begin; y termina con commit;", () => {
    const result = buildProjection();
    const trimmed = result.projectedText.trim();
    expect(trimmed.startsWith("begin;")).toBe(true);
    expect(trimmed.endsWith("commit;")).toBe(true);
  });

  it("el proyectado contiene ambas definiciones verbatim y ningún tercer CREATE FUNCTION", () => {
    const result = buildProjection();
    const createFunctionCount = (result.projectedText.match(/create function public\./g) ?? [])
      .length;
    expect(createFunctionCount).toBe(2);
    expect(result.projectedText).toContain("create function public.crm_is_active_staff()");
    expect(result.projectedText).toContain("create function public.crm_is_active_admin()");
  });

  it("nunca modifica los archivos fuente en disco", () => {
    buildProjection();
    expect(readFileSync(SOURCE_FILE_RELATIVE_PATH, "utf8")).toBe(REAL_SOURCE_TEXT);
    expect(readFileSync(ACL_PROVENANCE_FILE_RELATIVE_PATH, "utf8")).toBe(REAL_ACL_PROVENANCE_TEXT);
  });

  it("hash del archivo de provenance de ACL (0006) coincide con el valor congelado (64 hex)", () => {
    const result = buildProjection();
    expect(result.aclProvenanceSha256).toBe(EXPECTED_ACL_PROVENANCE_FILE_SHA256);
    expect(HEX64.test(result.aclProvenanceSha256)).toBe(true);
  });
});

describe("provenance de ACL (Fase I2-E2CH Sección 3) — fallo cerrado, hash de archivo completo", () => {
  it("acepta la fuente de provenance real sin mutar", () => {
    expect(() => verifyAclProvenanceContent(REAL_ACL_PROVENANCE_TEXT)).not.toThrow();
  });

  it("buildProjection() rechaza un 0006 cuyo hash de archivo completo no coincide", () => {
    const root = fakeRepoRoot({ aclText: REAL_ACL_PROVENANCE_TEXT.replace("staff", "staffX") });
    expect(() => buildProjection({ repoRoot: root })).toThrow(ProjectionError);
    expect(() => buildProjection({ repoRoot: root })).toThrow(
      /ACL provenance whole-file hash mismatch/,
    );
  });

  it("falla si desaparece el GRANT esperado para crm_is_active_staff", () => {
    const mutated = REAL_ACL_PROVENANCE_TEXT.replace(
      "grant execute on function public.crm_is_active_staff() to authenticated;",
      "-- removed",
    );
    expect(() => verifyAclProvenanceContent(mutated)).toThrow(ProjectionError);
    expect(() => verifyAclProvenanceContent(mutated)).toThrow(/crm_is_active_staff/);
  });

  it("falla si desaparece el GRANT esperado para crm_is_active_admin", () => {
    const mutated = REAL_ACL_PROVENANCE_TEXT.replace(
      "grant execute on function public.crm_is_active_admin() to authenticated;",
      "-- removed",
    );
    expect(() => verifyAclProvenanceContent(mutated)).toThrow(ProjectionError);
    expect(() => verifyAclProvenanceContent(mutated)).toThrow(/crm_is_active_admin/);
  });

  it("falla si desaparece la línea de REVOKE masivo de la que se derivó el diseño", () => {
    const mutated = REAL_ACL_PROVENANCE_TEXT.replace(
      EXPECTED_ACL_PROVENANCE_BLANKET_REVOKE_LINE,
      "-- removed",
    );
    expect(() => verifyAclProvenanceContent(mutated)).toThrow(ProjectionError);
    expect(() => verifyAclProvenanceContent(mutated)).toThrow(/blanket hardening statement/);
  });

  it("confirma que las 2 líneas de GRANT y la línea de REVOKE masivo existen literalmente en el archivo real", () => {
    for (const line of EXPECTED_ACL_PROVENANCE_GRANT_LINES) {
      expect(REAL_ACL_PROVENANCE_TEXT).toContain(line);
    }
    expect(REAL_ACL_PROVENANCE_TEXT).toContain(EXPECTED_ACL_PROVENANCE_BLANKET_REVOKE_LINE);
  });

  it("NO exige que el ACL generado sea idéntico byte a byte a 0006 (es una proyección más angosta a propósito)", () => {
    const result = buildProjection();
    // 0006 usa "revoke all on all functions in schema public from public, anon, authenticated"
    // en una sola sentencia masiva; el proyectado usa 4 sentencias por función, dirigidas.
    expect(result.projectedText).not.toBe(REAL_ACL_PROVENANCE_TEXT);
    expect(result.projectedText.toLowerCase()).not.toContain("all functions in schema public");
  });
});

describe("preconditions embebidas — exigen ABSENT/ABSENT", () => {
  it("el bloque de precondición rechaza 'ambas presentes'", () => {
    const result = buildProjection();
    expect(result.projectedText).toMatch(/FAIL\[PRE1\].*both target functions already exist/i);
  });

  it("el bloque de precondición rechaza estado parcial (uno sí, otro no)", () => {
    const result = buildProjection();
    expect(result.projectedText).toMatch(/FAIL\[PRE2\].*[Pp]artial prerequisite state/);
  });

  it("el bloque de precondición verifica public.profiles y auth.uid()", () => {
    const result = buildProjection();
    expect(result.projectedText).toContain("to_regclass('public.profiles')");
    expect(result.projectedText).toContain("to_regprocedure('auth.uid()')");
  });
});

describe("ACL — mínima y dirigida, nunca el revoke-all masivo", () => {
  it("no contiene el revoke masivo 'ALL FUNCTIONS IN SCHEMA public'", () => {
    const result = buildProjection();
    expect(result.projectedText.toLowerCase()).not.toContain("all functions in schema public");
  });

  it("otorga EXECUTE a authenticated para ambas funciones", () => {
    const result = buildProjection();
    expect(result.projectedText).toContain(
      "grant execute on function public.crm_is_active_staff() to authenticated;",
    );
    expect(result.projectedText).toContain(
      "grant execute on function public.crm_is_active_admin() to authenticated;",
    );
  });

  it("revoca explícitamente de public/anon/authenticated antes de re-otorgar", () => {
    const result = buildProjection();
    for (const fn of ["crm_is_active_staff", "crm_is_active_admin"]) {
      for (const role of ["public", "anon", "authenticated"]) {
        expect(result.projectedText).toContain(
          `revoke all on function public.${fn}() from ${role};`,
        );
      }
    }
  });

  it("no otorga EXECUTE a ninguna función adicional más allá de las 2 objetivo", () => {
    const result = buildProjection();
    const grantLines = result.projectedText
      .split("\n")
      .filter((line: string) => line.trim().startsWith("grant execute on function"));
    expect(grantLines).toHaveLength(2);
    expect(grantLines.every((line: string) => line.includes("authenticated"))).toBe(true);
  });
});

describe("extractAndAssemble() / extractFunctionFragment() — fallos aislados del guard de hash", () => {
  it("falla si falta el fragmento de una función", () => {
    const mutated = REAL_SOURCE_TEXT.replace(
      "create function public.crm_is_active_admin()",
      "create function public.crm_is_active_admin_renamed()",
    );
    expect(() => extractAndAssemble(mutated)).toThrow(ProjectionError);
    expect(() => extractAndAssemble(mutated)).toThrow(/not found in source: crm_is_active_admin/);
  });

  it("falla si el cuerpo de una función fue mutado (hash de fragmento ya no coincide)", () => {
    const mutated = REAL_SOURCE_TEXT.replace("p.role = 'Administrador'", "p.role = 'Personal'");
    expect(() => extractAndAssemble(mutated)).toThrow(/fragment hash mismatch/i);
  });

  it("extractFunctionFragment() aislado extrae el bloque completo create..$$;", () => {
    const fragment = extractFunctionFragment(REAL_SOURCE_TEXT, "crm_is_active_staff");
    expect(fragment).not.toBeNull();
    expect(fragment).toMatch(/^create function public\.crm_is_active_staff\(\)/);
    expect(fragment).toMatch(/\$\$;$/);
  });
});

describe("buildProjection() — guard de hash del archivo completo", () => {
  it("falla si el archivo fuente no existe en el repoRoot dado", () => {
    expect(() => buildProjection({ repoRoot: tmpdir() })).toThrow(ProjectionError);
  });
});

describe("sin acceso a base de datos, escritura solo bajo el directorio temporal del SO", () => {
  it("writeProjectionToTempFile() escribe fuera del repositorio", () => {
    const projection = buildProjection();
    const written = writeProjectionToTempFile(projection);
    try {
      expect(written.path.startsWith(tmpdir())).toBe(true);
      expect(written.path).not.toContain("supabase");
      expect(written.sha256).toBe(projection.projectedSha256);
    } finally {
      rmSync(written.path, { force: true });
    }
  });

  it("el módulo no importa ningún cliente de base de datos", () => {
    const moduleSource = readFileSync(
      "scripts/build-crm-fresh-security-prerequisite-projection.mjs",
      "utf8",
    );
    expect(moduleSource).not.toMatch(/@supabase\/supabase-js|\bpg\b|node-postgres/);
  });
});
