#!/usr/bin/env node
/**
 * validate-crm-baseline.mjs
 *
 * Static, read-only safety/integrity validation for the T0-CANONICAL
 * application baseline migration (Fase 8I-B2B-0B2B-I1 — see
 * server-release/docs/GOOGLE_DRIVE_REAL_VALIDATION_RUNBOOK.md, Sections
 * 44-47). This script never connects to a database, never executes SQL,
 * and never shells out to the Supabase CLI — it only reads files under
 * supabase/migrations/ and supabase/self-hosted/ from disk and checks
 * their text.
 *
 * Every check below traces to a specific requirement approved in the
 * runbook's closing decisions (Section 46.Y) and the instructions for
 * Fase 8I-B2B-0B2B-I1. Do not weaken a check to make it pass — if the
 * baseline migration genuinely violates one of these, the baseline is
 * wrong, not the check.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const MIGRATIONS_DIR = "supabase/migrations";
export const SELF_HOSTED_DIR = "supabase/self-hosted";

export const BASELINE_FILENAME = "20260713120000_crm_application_baseline.sql";
export const FIRST_HISTORICAL_FILENAME = "20260713131000_add_client_reports.sql";

export const EXPECTED_HISTORICAL_COUNT = 34;
export const EXPECTED_TOTAL_COUNT_WITH_BASELINE = 35;
export const EXPECTED_MANIFEST_V1_SHA256 =
  "b3fc4909efbf9a3001249e6fdf354cbe4c35b0a59ba036f6e7257ceedc87b214";

export const CORE_TABLES = [
  "profiles",
  "clients",
  "cases",
  "payments",
  "payment_records",
  "agenda_events",
  "documents",
];

export const FORBIDDEN_PLATFORM_PATTERNS = [
  { name: "CREATE SCHEMA auth", pattern: /create\s+schema\s+.*\bauth\b/i },
  { name: "CREATE SCHEMA storage", pattern: /create\s+schema\s+.*\bstorage\b/i },
  {
    name: "CREATE TABLE auth.users",
    pattern: /create\s+table\s+(if\s+not\s+exists\s+)?"?auth"?\."?users"?/i,
  },
  {
    name: "CREATE TABLE storage.objects",
    pattern: /create\s+table\s+(if\s+not\s+exists\s+)?"?storage"?\."?objects"?/i,
  },
  {
    name: "CREATE TABLE storage.buckets",
    pattern: /create\s+table\s+(if\s+not\s+exists\s+)?"?storage"?\."?buckets"?/i,
  },
  { name: "ALTER TABLE auth.users (structural)", pattern: /alter\s+table\s+"?auth"?\."?users"?/i },
];

export const FORBIDDEN_STORAGE_PROVISIONING_PATTERNS = [
  { name: "INSERT INTO storage.buckets", pattern: /insert\s+into\s+"?storage"?\."?buckets"?/i },
];

export const FORBIDDEN_PRODUCTION_IDENTIFIERS = [
  "supabase.consoldi.com",
  "pnqdgwpxcxngeueosmnh",
  "ccnvrslhnzdqwanhceqx",
];

// Heuristic only — flags things that *look like* embedded secrets so a
// human reviews them; it is not a cryptographic secret scanner.
export const SECRET_LOOK_PATTERNS = [
  { name: "JWT-shaped literal (eyJ...)", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  {
    name: "service_role key literal assignment",
    pattern: /service_role_key\s*[:=]\s*['"][^'"]{16,}['"]/i,
  },
  {
    name: "generic 'anon key' literal assignment",
    pattern: /anon_key\s*[:=]\s*['"][^'"]{16,}['"]/i,
  },
];

// The exact metadata-role escalation pattern the historical T0
// implementation used. Its presence anywhere in the baseline is a hard
// failure, regardless of context.
export const ROLE_METADATA_ESCALATION_PATTERN = /raw_user_meta_data\s*->>?\s*'(role|status)'/i;

const readText = (path) => readFileSync(path, "utf8");

const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Deterministic MANIFEST_V1/V2 algorithm — must match the procedure
 * approved in runbook Section 45.C exactly: bytes sorted by filename,
 * "<hash>  <filename>\n" records, LF only, UTF-8, no BOM. */
export function computeManifest(dir, filenames) {
  const sorted = [...filenames].sort();
  const lines = sorted.map((f) => {
    const bytes = readFileSync(join(dir, f));
    return `${sha256Hex(bytes)}  ${f}`;
  });
  const body = lines.join("\n") + "\n";
  const aggregate = sha256Hex(Buffer.from(body, "utf8"));
  return { count: sorted.length, sha256: aggregate, filenames: sorted };
}

function listMigrationFiles(migrationsDir) {
  return readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
}

/** Strips SQL line/block comments so pattern checks don't match text that
 * only appears inside an explanatory comment (mirrors the convention
 * already used in tests/self-hosted-bootstrap.test.ts). */
export function stripSqlComments(text) {
  return text.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

export function normalizeSql(text) {
  return stripSqlComments(text).replace(/\s+/g, " ").trim().toLowerCase();
}

/** Extracts a `create function public.<name>(...) ... $$ ... $$;` block
 * verbatim (including its own comments, so callers can strip separately
 * if desired). Returns null if not found. */
export function extractFunctionSource(text, functionName) {
  const re = new RegExp(
    `create\\s+(or\\s+replace\\s+)?function\\s+public\\.${functionName}\\s*\\([\\s\\S]*?\\$\\$[\\s\\S]*?\\$\\$\\s*;`,
    "i",
  );
  return text.match(re)?.[0] ?? null;
}

export function extractTriggerSource(text, triggerName) {
  const re = new RegExp(
    `create\\s+trigger\\s+${triggerName}[\\s\\S]*?execute\\s+function\\s+[^;]+;`,
    "i",
  );
  return text.match(re)?.[0] ?? null;
}

/**
 * Runs every static check and returns an array of
 * { id, description, passed, detail } — never throws for a failed
 * check (throwing is reserved for genuinely unreadable input, e.g. a
 * missing directory).
 */
export function validateBaseline({ repoRoot = process.cwd() } = {}) {
  const migrationsDir = resolve(repoRoot, MIGRATIONS_DIR);
  const selfHostedDir = resolve(repoRoot, SELF_HOSTED_DIR);
  const results = [];
  const check = (id, description, passed, detail = "") =>
    results.push({ id, description, passed, detail });

  // 1. Baseline exists at the exact approved timestamp/filename.
  const baselinePath = join(migrationsDir, BASELINE_FILENAME);
  const baselineExists = existsSync(baselinePath);
  check(
    "baseline-exists",
    `baseline migration exists at supabase/migrations/${BASELINE_FILENAME}`,
    baselineExists,
    baselineExists ? "" : `not found at ${baselinePath}`,
  );
  if (!baselineExists) {
    // Every remaining check depends on the file existing — stop here
    // rather than throwing spurious failures for a missing file.
    return results;
  }
  const baselineText = readText(baselinePath);
  // Comment-stripped view: used for checks about actual DDL/behavior
  // (platform-object creation, Storage provisioning, role-metadata
  // escalation) so an explanatory comment that legitimately *quotes* a
  // forbidden pattern — to document that it was deliberately NOT
  // reproduced — does not itself fail the check. Identifier and secret
  // checks intentionally scan the raw text instead, so a leak hidden
  // inside a comment still fails.
  const baselineExecutableText = stripSqlComments(baselineText);

  const allFiles = listMigrationFiles(migrationsDir);
  const historicalFiles = allFiles.filter((f) => f !== BASELINE_FILENAME);

  // 2. Historical migration count remains 34.
  check(
    "historical-count",
    `historical migration count is exactly ${EXPECTED_HISTORICAL_COUNT}`,
    historicalFiles.length === EXPECTED_HISTORICAL_COUNT,
    `found ${historicalFiles.length}`,
  );

  // 3. MANIFEST_V1 over the 34 historical files matches the frozen value.
  const manifestV1 = computeManifest(migrationsDir, historicalFiles);
  check(
    "manifest-v1",
    `MANIFEST_V1_SHA256 over the ${EXPECTED_HISTORICAL_COUNT} historical files matches the frozen value`,
    manifestV1.sha256 === EXPECTED_MANIFEST_V1_SHA256,
    `computed ${manifestV1.sha256}`,
  );

  // 4. Total migration count becomes 35.
  check(
    "total-count",
    `total migration count (historical + baseline) is exactly ${EXPECTED_TOTAL_COUNT_WITH_BASELINE}`,
    allFiles.length === EXPECTED_TOTAL_COUNT_WITH_BASELINE,
    `found ${allFiles.length}`,
  );

  // 5. Baseline sorts before the first historical migration.
  check(
    "sorts-before-first-historical",
    `${BASELINE_FILENAME} sorts before ${FIRST_HISTORICAL_FILENAME}`,
    BASELINE_FILENAME < FIRST_HISTORICAL_FILENAME,
  );

  // 6. All seven core tables are represented.
  const missingTables = CORE_TABLES.filter(
    (t) => !new RegExp(`create\\s+table\\s+public\\.${t}\\b`, "i").test(baselineText),
  );
  check(
    "seven-core-tables",
    "all seven core application tables (profiles, clients, cases, payments, payment_records, agenda_events, documents) are created",
    missingTables.length === 0,
    missingTables.length ? `missing: ${missingTables.join(", ")}` : "",
  );

  // 7. Tri-state precondition exists before the first application CREATE TABLE.
  const preconditionIdx = baselineText.search(/raise\s+exception[\s\S]*?55000/i);
  const firstCreateTableIdx = baselineText.search(/create\s+table\s+public\./i);
  const preconditionPresent = preconditionIdx !== -1;
  const preconditionOrdered =
    preconditionPresent && firstCreateTableIdx !== -1 && preconditionIdx < firstCreateTableIdx;
  check(
    "tri-state-precondition-present",
    "a tri-state (FRESH/EXISTING/PARTIAL) fail-closed precondition is present",
    preconditionPresent,
  );
  check(
    "tri-state-precondition-precedes-ddl",
    "the precondition check precedes the first application CREATE TABLE statement",
    preconditionOrdered,
  );

  // 8. Baseline does not create platform-managed objects/schemas.
  for (const { name, pattern } of FORBIDDEN_PLATFORM_PATTERNS) {
    check(
      `no-platform-object:${name}`,
      `baseline does not create/alter platform-managed object: ${name}`,
      !pattern.test(baselineExecutableText),
    );
  }

  // 9. Baseline does not contain production identifiers.
  for (const id of FORBIDDEN_PRODUCTION_IDENTIFIERS) {
    check(
      `no-production-identifier:${id}`,
      `baseline does not contain production identifier "${id}"`,
      !baselineText.includes(id),
    );
  }

  // 10. Baseline does not include secrets/keys (heuristic).
  for (const { name, pattern } of SECRET_LOOK_PATTERNS) {
    check(
      `no-secret-look:${name}`,
      `baseline does not contain a value matching the secret heuristic: ${name}`,
      !pattern.test(baselineText),
    );
  }

  // 11. Hardened handle_new_user is present and matches the approved
  //     self-hosted source (normalized comparison — see Section 17 test
  //     for the strict version of this same check).
  const baselineFn = extractFunctionSource(baselineText, "handle_new_user");
  check(
    "handle-new-user-present",
    "handle_new_user() function is present in the baseline",
    baselineFn !== null,
  );
  let hardenedMatches = false;
  if (baselineFn && existsSync(join(selfHostedDir, "0004_functions_and_rpc.sql"))) {
    const selfHostedFn = extractFunctionSource(
      readText(join(selfHostedDir, "0004_functions_and_rpc.sql")),
      "handle_new_user",
    );
    hardenedMatches =
      selfHostedFn !== null && normalizeSql(baselineFn) === normalizeSql(selfHostedFn);
  }
  check(
    "handle-new-user-matches-hardened-source",
    "baseline handle_new_user() is byte-equivalent (whitespace-normalized) to supabase/self-hosted/0004_functions_and_rpc.sql",
    hardenedMatches,
  );

  // 12. Baseline never reads role/status from user-controlled metadata.
  check(
    "no-role-metadata-escalation",
    "baseline does not assign a privileged role from raw_user_meta_data->>'role' or ->>'status'",
    !ROLE_METADATA_ESCALATION_PATTERN.test(baselineExecutableText),
  );

  // 13. Documents bucket is not provisioned here.
  for (const { name, pattern } of FORBIDDEN_STORAGE_PROVISIONING_PATTERNS) {
    check(
      `no-storage-provisioning:${name}`,
      `baseline does not provision Storage: ${name}`,
      !pattern.test(baselineExecutableText),
    );
  }

  // 14. Historical 34 files are untouched (manifest already proves byte
  //     identity; this check additionally asserts none of the 34 known
  //     historical filenames is itself missing from disk).
  const historicalSet = new Set(historicalFiles);
  check(
    "historical-files-untouched",
    "MANIFEST_V1 over the historical files matches the frozen value (byte-identical, none missing/renamed)",
    manifestV1.sha256 === EXPECTED_MANIFEST_V1_SHA256 &&
      historicalSet.size === EXPECTED_HISTORICAL_COUNT,
  );

  return results;
}

export function computeManifestV2({ repoRoot = process.cwd() } = {}) {
  const migrationsDir = resolve(repoRoot, MIGRATIONS_DIR);
  const allFiles = listMigrationFiles(migrationsDir);
  return computeManifest(migrationsDir, allFiles);
}

function runCli() {
  const results = validateBaseline();
  const failed = results.filter((r) => !r.passed);

  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║  CRM application baseline — static validator                 ║");
  console.log("║  (Fase 8I-B2B-0B2B-I1 — no database connection, no execution) ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  for (const r of results) {
    const mark = r.passed ? "✓" : "✗";
    console.log(`  ${mark} [${r.id}] ${r.description}${r.detail ? ` — ${r.detail}` : ""}`);
  }

  if (existsSync(resolve(process.cwd(), MIGRATIONS_DIR, BASELINE_FILENAME))) {
    const v2 = computeManifestV2();
    console.log(`\nMIGRATION_COUNT_V2 = ${v2.count}`);
    console.log(`MANIFEST_V2_SHA256 = ${v2.sha256}`);
  }

  if (failed.length > 0) {
    console.error(`\n✗ ${failed.length} check(s) failed. Baseline is NOT valid.\n`);
    process.exit(1);
  }
  console.log(`\n✓ All ${results.length} checks passed.\n`);
  process.exit(0);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runCli();
}
