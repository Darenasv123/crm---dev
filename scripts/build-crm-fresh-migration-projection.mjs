#!/usr/bin/env node
/**
 * build-crm-fresh-migration-projection.mjs
 *
 * Fase 8I-B2B-0B2B-I2-I3. Deterministic, local-only, read-only-on-the-repo
 * builder for the SINGLE approved fresh-bootstrap exception #24 (see
 * server-release/docs/GOOGLE_DRIVE_REAL_VALIDATION_RUNBOOK.md — R2/R3
 * findings). It derives, from the frozen and untouched migration
 *   supabase/migrations/20260806120000_crm_daily_tasks_and_document_integrity.sql
 * a temporary projection that preserves every statement EXCEPT the one
 * legacy-history assertion (statement 40 — "Verificación del único
 * registro histórico confirmado antes de la migración") proven in R2 to be
 * LEGACY_DATA_PROTECTION_ONLY, not required for schema correctness on a
 * genuinely fresh database.
 *
 * This is intentionally NOT a generic SQL stripper. It knows about exactly
 * one migration, one block, and one set of exact textual anchors — anyone
 * approving a future exception for a different migration must write a new,
 * equally narrow tool, not generalize this one, per the explicit
 * instruction in Fase I3 Section 2 ("Do not build a generic arbitrary-SQL
 * stripper").
 *
 * Never touches supabase/migrations/. Never opens a database connection.
 * Never reads a credential. Writes its output only under the OS temp
 * directory (os.tmpdir()), never inside the repository.
 *
 * Fail-closed: any anchor missing, duplicated, or in the wrong shape
 * aborts with a descriptive ProjectionError instead of guessing.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const SOURCE_MIGRATION_RELATIVE_PATH =
  "supabase/migrations/20260806120000_crm_daily_tasks_and_document_integrity.sql";

// Frozen at Fase 8I-B2B-0B2B-I2-R2/R3. Must never be updated silently —
// any change to the source migration is exactly what this guard exists to
// reject.
export const EXPECTED_SOURCE_SHA256 =
  "2c3ef16da63d6db53106737d870ce11abfefeda90645e76ea09f4b2f9e5c34ef";

// Bumped only if the anchor/extraction algorithm itself changes (never for
// a change to the source migration, which is rejected by the hash gate
// instead). The canonical identity of a given projection artifact is the
// triple (sourceSha256, algorithm version, projectedSha256) — never the
// projected file's name, which is timestamp-based and disposable.
export const PROJECTION_ALGORITHM_VERSION = "v1";

// Frozen at Fase 8I-B2B-0B2B-I2-I3H by running buildProjection() twice
// independently against the frozen source above and confirming identical
// output both times (13403 source bytes, 976 bytes removed, 12427
// projected bytes). Not enforced as a hard gate by buildProjection() —
// it is a recorded fact for drift detection (tests assert against it),
// not a second copy of the hash gate that already guards the source.
export const EXPECTED_PROJECTED_SHA256 =
  "d997d7a62da7eba753dca34d216fef4c5ec85ea4e724ea7d5dd2ee00f4cc1513";

// Exact byte-for-byte anchors confirmed against the frozen source in Fase
// I2-R3 Section D. These are not regexes — deliberately literal strings,
// so a single stray whitespace change in the source is treated as "shape
// changed" rather than silently tolerated.
export const BLOCK_START_ANCHOR =
  "-- Verificación del único registro histórico confirmado antes de la migración.\n" +
  "-- Además de la fecha, se protege expresamente su estado operativo.\n" +
  "do $$\n";

export const BLOCK_END_ANCHOR = "\nend;\n$$;\n";

// Note the leading "\n": a blank line separates statement 40's closing
// "$$;" from the comment introducing statement 41 in the frozen source.
export const NEXT_STATEMENT_ANCHOR =
  "\n-- Todos los triggers de case_tasks, incluido el guard temporalmente\n";

// The removed block must contain BOTH — proves we removed the intended
// legacy-row assertion, not some other DO block that happens to share the
// generic "do $$ ... end; $$;" shape.
export const REQUIRED_REMOVED_BLOCK_SUBSTRINGS = [
  "v_historical_task_count <> 1",
  "2026-08-06 02:02:30.149561+00",
];

export class ProjectionError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProjectionError";
  }
}

const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");

function countOccurrences(haystack, needle) {
  if (needle === "") return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

function countLineMatches(text, exactLine) {
  const re = new RegExp(`^${exactLine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "gm");
  return (text.match(re) ?? []).length;
}

/**
 * Pure, hash-independent anchor extraction. Exported separately from
 * buildProjection() so every individual fail-closed anchor path (missing
 * anchor, duplicated anchor, wrong next-statement, tampered assertion
 * content) can be unit-tested directly against synthetic text, without
 * needing to forge a file whose bytes collide with EXPECTED_SOURCE_SHA256
 * (which is only possible with the one real, frozen source). Throws
 * ProjectionError on any unexpected shape; never touches the filesystem.
 *
 * @param {string} text
 * @returns {{
 *   projectedText: string,
 *   projectedBytes: number,
 *   projectedSha256: string,
 *   bytesRemoved: number,
 *   removedBlock: string,
 * }}
 */
export function extractProjection(text) {
  const startOccurrences = countOccurrences(text, BLOCK_START_ANCHOR);
  if (startOccurrences !== 1) {
    throw new ProjectionError(
      `expected BLOCK_START_ANCHOR exactly once, found ${startOccurrences} occurrence(s)`,
    );
  }
  const startIdx = text.indexOf(BLOCK_START_ANCHOR);
  const searchFrom = startIdx + BLOCK_START_ANCHOR.length;

  const endIdx = text.indexOf(BLOCK_END_ANCHOR, searchFrom);
  if (endIdx === -1) {
    throw new ProjectionError("BLOCK_END_ANCHOR not found after BLOCK_START_ANCHOR");
  }
  const blockEnd = endIdx + BLOCK_END_ANCHOR.length;

  const removedBlock = text.slice(startIdx, blockEnd);

  for (const needle of REQUIRED_REMOVED_BLOCK_SUBSTRINGS) {
    if (!removedBlock.includes(needle)) {
      throw new ProjectionError(
        `removed block does not contain required substring: ${JSON.stringify(needle)} — ` +
          `refusing to project, the matched region does not look like the approved statement 40`,
      );
    }
  }

  const immediatelyAfter = text.slice(blockEnd, blockEnd + NEXT_STATEMENT_ANCHOR.length);
  if (immediatelyAfter !== NEXT_STATEMENT_ANCHOR) {
    throw new ProjectionError(
      "NEXT_STATEMENT_ANCHOR does not immediately follow the removed block — " +
        "file structure differs from the approved shape",
    );
  }

  const projectedText = text.slice(0, startIdx) + text.slice(blockEnd);

  if (countLineMatches(projectedText, "begin;") !== 1) {
    throw new ProjectionError(
      "projected text does not contain exactly one standalone 'begin;' transaction-start line",
    );
  }
  if (countLineMatches(projectedText, "commit;") !== 1) {
    throw new ProjectionError(
      "projected text does not contain exactly one standalone 'commit;' transaction-end line",
    );
  }

  const expectedProjectedLength = text.length - removedBlock.length;
  if (projectedText.length !== expectedProjectedLength) {
    // Structurally unreachable given the slice arithmetic above, but kept
    // as an explicit invariant check rather than trusting the arithmetic
    // silently — fail closed rather than ship a miscomputed file.
    throw new ProjectionError("internal invariant violated: projected length mismatch");
  }

  const projectedBytes = Buffer.from(projectedText, "utf8");
  const projectedSha256 = sha256Hex(projectedBytes);

  return {
    projectedText,
    projectedBytes: projectedBytes.length,
    projectedSha256,
    bytesRemoved: Buffer.byteLength(removedBlock, "utf8"),
    removedBlock,
  };
}

/**
 * Reads the source migration from disk, enforces the frozen-hash gate,
 * then derives the projected text via extractProjection(). Never writes
 * to disk. Throws ProjectionError on any unexpected shape.
 *
 * @param {{ repoRoot?: string }} [options]
 * @returns {{
 *   sourcePath: string,
 *   sourceBytes: number,
 *   sourceSha256: string,
 *   projectedText: string,
 *   projectedBytes: number,
 *   projectedSha256: string,
 *   bytesRemoved: number,
 *   removedBlock: string,
 * }}
 */
export function buildProjection({ repoRoot = process.cwd() } = {}) {
  const sourcePath = resolve(repoRoot, SOURCE_MIGRATION_RELATIVE_PATH);

  if (!existsSync(sourcePath)) {
    throw new ProjectionError(`source migration not found at ${sourcePath}`);
  }

  const rawBytes = readFileSync(sourcePath);
  const sourceSha256 = sha256Hex(rawBytes);
  if (sourceSha256 !== EXPECTED_SOURCE_SHA256) {
    throw new ProjectionError(
      `source hash mismatch: expected ${EXPECTED_SOURCE_SHA256}, got ${sourceSha256}. ` +
        `The frozen migration must not change — refusing to project against an unexpected file.`,
    );
  }

  const text = rawBytes.toString("utf8");
  const extracted = extractProjection(text);

  return {
    sourcePath,
    sourceBytes: rawBytes.length,
    sourceSha256,
    ...extracted,
  };
}

/**
 * Writes the projected text to a fresh file under the OS temp directory.
 * Never writes inside the repository. Returns the written path and its
 * hash (recomputed from the bytes actually written to disk).
 *
 * @param {ReturnType<typeof buildProjection>} projection
 * @param {{ tmpDir?: string }} [options]
 */
export function writeProjectionToTempFile(projection, { tmpDir = tmpdir() } = {}) {
  const filename = `crm-20260806120000-fresh-projection-${Date.now()}.sql`;
  const outPath = join(tmpDir, filename);
  writeFileSync(outPath, projection.projectedText, "utf8");
  const writtenSha256 = sha256Hex(readFileSync(outPath));
  return { path: outPath, sha256: writtenSha256 };
}

function runCli() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║  #24 fresh-bootstrap projection builder                       ║");
  console.log("║  (Fase 8I-B2B-0B2B-I2-I3 — local only, no database access)   ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  let projection;
  try {
    projection = buildProjection();
  } catch (err) {
    console.error(`✗ ${err instanceof ProjectionError ? err.message : String(err)}`);
    process.exit(1);
  }

  const written = writeProjectionToTempFile(projection);

  const hexRe = /^[0-9a-f]{64}$/i;

  console.log(`  source path         : ${projection.sourcePath}`);
  console.log(`  source SHA256       : ${projection.sourceSha256}`);
  console.log(`  source bytes        : ${projection.sourceBytes}`);
  console.log(`  algorithm version   : ${PROJECTION_ALGORITHM_VERSION}`);
  console.log(`  projected SHA256    : ${projection.projectedSha256}`);
  console.log(`  projected bytes     : ${projection.projectedBytes}`);
  console.log(`  bytes removed       : ${projection.bytesRemoved}`);
  console.log(`  temp file written to: ${written.path}`);
  console.log(`  temp file SHA256    : ${written.sha256}`);
  console.log(
    `\n  canonical identity  : ${projection.sourceSha256}+${PROJECTION_ALGORITHM_VERSION}+${projection.projectedSha256}`,
  );
  console.log(
    `  matches frozen expectation: ${projection.projectedSha256 === EXPECTED_PROJECTED_SHA256} ` +
      `(hex format valid: ${hexRe.test(projection.projectedSha256)})`,
  );
  console.log(
    "\n✓ Projection built. Nothing was written under supabase/migrations/. " +
      "No database connection was made.\n",
  );
  process.exit(0);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runCli();
}
