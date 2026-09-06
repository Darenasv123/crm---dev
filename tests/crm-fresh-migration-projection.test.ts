/**
 * crm-fresh-migration-projection.test.ts
 *
 * Pruebas de scripts/build-crm-fresh-migration-projection.mjs (Fase
 * 8I-B2B-0B2B-I2-I3). Local únicamente: nunca abre una conexión de base de
 * datos, nunca modifica supabase/migrations/. Todas las pruebas que
 * necesitan una fuente distinta a la real construyen su propio repoRoot
 * temporal en el sistema de archivos, para no depender de mutar el
 * repositorio real.
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BLOCK_END_ANCHOR,
  BLOCK_START_ANCHOR,
  EXPECTED_PROJECTED_SHA256,
  EXPECTED_SOURCE_SHA256,
  NEXT_STATEMENT_ANCHOR,
  PROJECTION_ALGORITHM_VERSION,
  ProjectionError,
  REQUIRED_REMOVED_BLOCK_SUBSTRINGS,
  SOURCE_MIGRATION_RELATIVE_PATH,
  buildProjection,
  extractProjection,
  writeProjectionToTempFile,
} from "../scripts/build-crm-fresh-migration-projection.mjs";

const REAL_SOURCE_TEXT = readFileSync(SOURCE_MIGRATION_RELATIVE_PATH, "utf8");

/** Builds a throwaway repo root containing only supabase/migrations/<file> with the given text. */
function makeFakeRepoRoot(sourceText: string): string {
  const root = mkdtempSync(join(tmpdir(), "crm-projection-test-"));
  const migrationsDir = join(root, "supabase", "migrations");
  mkdirSync(migrationsDir, { recursive: true });
  writeFileSync(
    join(migrationsDir, "20260806120000_crm_daily_tasks_and_document_integrity.sql"),
    sourceText,
    "utf8",
  );
  return root;
}

const tempRoots: string[] = [];
afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

function fakeRoot(sourceText: string): string {
  const root = makeFakeRepoRoot(sourceText);
  tempRoots.push(root);
  return root;
}

describe("buildProjection() — fuente real congelada", () => {
  it("construye correctamente contra el archivo real del repositorio", () => {
    const result = buildProjection();
    expect(result.sourceSha256).toBe(EXPECTED_SOURCE_SHA256);
    expect(result.sourceSha256).toHaveLength(64);
    expect(result.projectedSha256).toHaveLength(64);
    expect(result.projectedSha256).not.toBe(result.sourceSha256);
  });

  it("el SHA256 proyectado congelado (identidad canónica) es determinista entre corridas independientes", () => {
    const hexRe = /^[0-9a-f]{64}$/i;
    const r1 = buildProjection();
    const r2 = buildProjection();
    expect(hexRe.test(r1.projectedSha256)).toBe(true);
    expect(hexRe.test(r2.projectedSha256)).toBe(true);
    expect(r1.projectedSha256).toBe(r2.projectedSha256);
    expect(r1.projectedSha256).toBe(EXPECTED_PROJECTED_SHA256);
    expect(r1.sourceBytes).toBe(13403);
    expect(r1.projectedBytes).toBe(12427);
    expect(r1.bytesRemoved).toBe(976);
    // Identidad canónica: (sourceSha256, versión de algoritmo, projectedSha256).
    const canonicalIdentity = `${r1.sourceSha256}+${PROJECTION_ALGORITHM_VERSION}+${r1.projectedSha256}`;
    expect(canonicalIdentity).toBe(
      `${EXPECTED_SOURCE_SHA256}+${PROJECTION_ALGORITHM_VERSION}+${EXPECTED_PROJECTED_SHA256}`,
    );
  });

  it("el proyectado es exactamente prefijo-antes-del-bloque + sufijo-después-del-bloque (comparación a nivel de bytes)", () => {
    const result = buildProjection();
    const startIdx = REAL_SOURCE_TEXT.indexOf(BLOCK_START_ANCHOR);
    expect(startIdx).toBeGreaterThan(-1);
    const endIdx = REAL_SOURCE_TEXT.indexOf(BLOCK_END_ANCHOR, startIdx + BLOCK_START_ANCHOR.length);
    expect(endIdx).toBeGreaterThan(-1);
    const blockEnd = endIdx + BLOCK_END_ANCHOR.length;

    const expectedPrefix = REAL_SOURCE_TEXT.slice(0, startIdx);
    const expectedSuffix = REAL_SOURCE_TEXT.slice(blockEnd);
    const expectedProjected = expectedPrefix + expectedSuffix;

    expect(result.projectedText).toBe(expectedProjected);
    expect(Buffer.byteLength(result.projectedText, "utf8")).toBe(result.projectedBytes);
  });

  it("preserva la statement 41 (verificación de triggers) verbatim", () => {
    const result = buildProjection();
    expect(result.projectedText).toContain(NEXT_STATEMENT_ANCHOR.trim());
    expect(result.projectedText).toContain("tgenabled <> 'O'");
  });

  it("excluye ÚNICAMENTE la statement 40 — ninguna otra ocurrencia de case_tasks desaparece", () => {
    const result = buildProjection();
    for (const needle of REQUIRED_REMOVED_BLOCK_SUBSTRINGS) {
      expect(result.projectedText).not.toContain(needle);
      expect(REAL_SOURCE_TEXT).toContain(needle); // confirma que sí estaba en la fuente
    }
    // El resto del contenido relacionado con case_tasks (columnas, índices,
    // funciones, statement 41) debe seguir presente.
    expect(result.projectedText).toContain("scheduled_for");
    expect(result.projectedText).toContain("case_task_history");
    expect(result.projectedText).toContain("document_change_history");
  });

  it("conserva exactamente una línea 'begin;' y una línea 'commit;'", () => {
    const result = buildProjection();
    const beginMatches = result.projectedText.match(/^begin;$/gm) ?? [];
    const commitMatches = result.projectedText.match(/^commit;$/gm) ?? [];
    expect(beginMatches).toHaveLength(1);
    expect(commitMatches).toHaveLength(1);
  });

  it("nunca modifica el archivo fuente real en disco", () => {
    buildProjection();
    const after = readFileSync(SOURCE_MIGRATION_RELATIVE_PATH, "utf8");
    expect(after).toBe(REAL_SOURCE_TEXT);
  });
});

describe("buildProjection() — falla cerrado ante desviaciones", () => {
  it("falla si el hash de la fuente no coincide", () => {
    const root = fakeRoot(REAL_SOURCE_TEXT.replace("case_tasks", "case_tasksX"));
    expect(() => buildProjection({ repoRoot: root })).toThrow(ProjectionError);
    expect(() => buildProjection({ repoRoot: root })).toThrow(/hash mismatch/i);
  });

  it("falla si falta el archivo fuente", () => {
    const root = mkdtempSync(join(tmpdir(), "crm-projection-test-missing-"));
    tempRoots.push(root);
    expect(() => buildProjection({ repoRoot: root })).toThrow(/not found/i);
  });

  it("el guard de hash es la PRIMERA barrera: una fuente con el ancla de inicio rota también falla por hash antes de llegar a la lógica de anclas", () => {
    // extractProjection() por sí sola sobre este mismo texto mutado se
    // prueba de forma aislada en el describe de abajo ("cada camino de
    // fallo por anclas"); aquí se confirma que buildProjection() nunca
    // llega a evaluar anclas si el hash ya no coincide.
    const mutated = REAL_SOURCE_TEXT.replace(
      "-- Verificación del único registro histórico confirmado antes de la migración.",
      "-- (ancla de inicio eliminada deliberadamente para esta prueba)",
    );
    const root = fakeRoot(mutated);
    expect(() => buildProjection({ repoRoot: root })).toThrow(/hash mismatch/i);
  });

  it("falla con ProjectionError (no una excepción genérica) en cada camino de fallo", () => {
    const root = mkdtempSync(join(tmpdir(), "crm-projection-test-missing2-"));
    tempRoots.push(root);
    try {
      buildProjection({ repoRoot: root });
      throw new Error("expected buildProjection to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ProjectionError);
    }
  });
});

describe("extractProjection() — cada camino de fallo por anclas, aislado de la barrera de hash", () => {
  // extractProjection() es pura y no verifica ningún hash, así que estas
  // pruebas pueden construir texto sintético arbitrario para forzar cada
  // fallo estructural individualmente — algo que buildProjection() por sí
  // solo no permitiría probar sin colisionar EXPECTED_SOURCE_SHA256.

  it("construye correctamente sobre el texto real extraído sin pasar por el guard de hash", () => {
    const result = extractProjection(REAL_SOURCE_TEXT);
    expect(result.projectedSha256).toHaveLength(64);
    expect(result.projectedText).not.toContain("v_historical_task_count <> 1");
  });

  it("falla si falta el ancla de inicio", () => {
    const mutated = REAL_SOURCE_TEXT.replace(BLOCK_START_ANCHOR, "-- ancla de inicio removida\n");
    expect(() => extractProjection(mutated)).toThrow(ProjectionError);
    expect(() => extractProjection(mutated)).toThrow(/BLOCK_START_ANCHOR exactly once, found 0/i);
  });

  it("falla si el ancla de inicio aparece duplicada", () => {
    // Replacer en forma de función: evita que las secuencias "$$"/"$&" del
    // ancla (String.replace las trata como patrones especiales cuando el
    // reemplazo se pasa como string literal) corrompan el texto insertado.
    const duplicated = REAL_SOURCE_TEXT.replace(
      BLOCK_START_ANCHOR,
      () => BLOCK_START_ANCHOR + "end;\n$$;\n" + BLOCK_START_ANCHOR,
    );
    expect(duplicated.split(BLOCK_START_ANCHOR).length - 1).toBe(2); // confirma la mutación en sí
    expect(() => extractProjection(duplicated)).toThrow(ProjectionError);
    expect(() => extractProjection(duplicated)).toThrow(
      /BLOCK_START_ANCHOR exactly once, found 2/i,
    );
  });

  it("falla si no existe ningún ancla de fin alcanzable después del ancla de inicio", () => {
    const startIdx = REAL_SOURCE_TEXT.indexOf(BLOCK_START_ANCHOR);
    // Trunca todo lo posterior al ancla de inicio (incluyendo cualquier
    // "\nend;\n$$;\n" más adelante en el archivo, p.ej. el de statement 41)
    // para que BLOCK_END_ANCHOR sea, sin ambigüedad, inalcanzable.
    const mutated =
      REAL_SOURCE_TEXT.slice(0, startIdx + BLOCK_START_ANCHOR.length) +
      "-- truncado deliberadamente: no hay ningún cierre '$$;' más adelante\n";
    expect(() => extractProjection(mutated)).toThrow(/BLOCK_END_ANCHOR not found/i);
  });

  it("falla si el timestamp histórico dentro del bloque fue mutado", () => {
    // El mismo literal de timestamp aparece también dentro del texto del
    // mensaje de la segunda RAISE EXCEPTION (línea ~348) — replaceAll
    // asegura que NINGUNA ocurrencia sobreviva dentro del bloque removido,
    // de lo contrario el chequeo de substring requerido pasaría de forma
    // falsa por la ocurrencia no mutada.
    const mutated = REAL_SOURCE_TEXT.replaceAll(
      "2026-08-06 02:02:30.149561+00",
      "2099-01-01 00:00:00.000000+00",
    );
    expect(() => extractProjection(mutated)).toThrow(/required substring/i);
  });

  it("falla si la aserción de conteo dentro del bloque fue mutada", () => {
    const mutated = REAL_SOURCE_TEXT.replace(
      "v_historical_task_count <> 1",
      "v_historical_task_count <> 0",
    );
    expect(() => extractProjection(mutated)).toThrow(/required substring/i);
  });

  it("falla si el ancla de la siguiente sentencia no sigue inmediatamente al bloque removido", () => {
    const mutated = REAL_SOURCE_TEXT.replace(
      NEXT_STATEMENT_ANCHOR,
      "\n-- comentario inesperado insertado entre statement 40 y 41\n",
    );
    expect(() => extractProjection(mutated)).toThrow(/does not immediately follow/i);
  });

  it("el ancla de la siguiente sentencia sigue inmediatamente al bloque en la fuente real (invariante estructural)", () => {
    const startIdx = REAL_SOURCE_TEXT.indexOf(BLOCK_START_ANCHOR);
    const endIdx = REAL_SOURCE_TEXT.indexOf(BLOCK_END_ANCHOR, startIdx + BLOCK_START_ANCHOR.length);
    const blockEnd = endIdx + BLOCK_END_ANCHOR.length;
    expect(REAL_SOURCE_TEXT.slice(blockEnd, blockEnd + NEXT_STATEMENT_ANCHOR.length)).toBe(
      NEXT_STATEMENT_ANCHOR,
    );
  });
});

describe("writeProjectionToTempFile()", () => {
  it("escribe fuera del repositorio, bajo el directorio temporal del SO", () => {
    const projection = buildProjection();
    const written = writeProjectionToTempFile(projection);
    try {
      expect(written.path.startsWith(tmpdir())).toBe(true);
      expect(written.path).not.toContain("supabase");
      expect(written.sha256).toBe(projection.projectedSha256);
      const onDisk = readFileSync(written.path, "utf8");
      expect(onDisk).toBe(projection.projectedText);
    } finally {
      rmSync(written.path, { force: true });
    }
  });

  it("nunca escribe dentro de supabase/migrations/", () => {
    const projection = buildProjection();
    const written = writeProjectionToTempFile(projection);
    try {
      expect(written.path.includes(join("supabase", "migrations"))).toBe(false);
    } finally {
      rmSync(written.path, { force: true });
    }
  });
});

describe("build-crm-fresh-migration-projection — no efectos colaterales en manifiestos", () => {
  it("no altera MANIFEST_V1/V2 del baseline (el archivo fuente permanece intacto)", async () => {
    const {
      computeManifestV2,
      EXPECTED_MANIFEST_V1_SHA256,
      computeManifest,
      MIGRATIONS_DIR,
      BASELINE_FILENAME,
    } = await import("../scripts/validate-crm-baseline.mjs");
    buildProjection();
    const v2 = computeManifestV2();
    expect(v2.sha256).toBe("422cd62f34404d0f58eb571f722f1b1aabf2ed224b7619f95130c7e8c1d64029");

    const { readdirSync } = await import("node:fs");
    const historical = readdirSync(MIGRATIONS_DIR).filter(
      (f: string) => f.endsWith(".sql") && f !== BASELINE_FILENAME,
    );
    const v1 = computeManifest(MIGRATIONS_DIR, historical);
    expect(v1.sha256).toBe(EXPECTED_MANIFEST_V1_SHA256);
  });
});
