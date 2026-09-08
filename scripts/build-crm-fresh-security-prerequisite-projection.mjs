#!/usr/bin/env node
/**
 * build-crm-fresh-security-prerequisite-projection.mjs
 *
 * Fase 8I-B2B-0B2B-I2-E2C. Deterministic, local-only, read-only-on-the-repo
 * builder for controlled fresh-bootstrap exception #4 (see
 * server-release/docs/GOOGLE_DRIVE_REAL_VALIDATION_RUNBOOK.md — E2B
 * findings). Extracts the exact authoritative definitions of two
 * PRODUCTION-VALID, FRESH-BOOTSTRAP-MISSING functions —
 *
 *   public.crm_is_active_staff()
 *   public.crm_is_active_admin()
 *
 * — from the frozen, tracked, untouched file
 *   supabase/self-hosted/0004_functions_and_rpc.sql
 * and assembles a temporary, single-transaction SQL artifact that: checks
 * an exact ABSENT/ABSENT precondition, creates both functions verbatim
 * (never rewritten), applies a minimal targeted ACL (not the blanket
 * self-hosted revoke-all), and checks an exact postcondition — all before
 * COMMIT.
 *
 * ── Why this exists (Fase I2-E2B) ────────────────────────────────────────
 * Dependency-closure audit of all 35 tracked migrations found exactly two
 * `public.*` function names that are CALLED but never CREATED anywhere in
 * tracked history: crm_is_active_staff() and crm_is_active_admin(). Both
 * are valid, real functions in production (out-of-band historical
 * objects — introduced into Cloud's live schema without ever being
 * captured as a tracked migration file), which is why
 * 20260811103000_align_cloud_task_claim_contract.sql applied cleanly on
 * fresh staging (its three references live inside plpgsql function
 * bodies, which Postgres does not validate against the catalog at CREATE
 * time — see runbook Section 48.L) while
 * 20260822110000_add_templates.sql failed immediately with SQLSTATE 42883
 * (its three references live inside CREATE POLICY ... WITH CHECK/USING
 * expressions, which ARE validated eagerly).
 *
 * This is intentionally NOT a generic function-extraction tool. It knows
 * about exactly one source file and exactly two function names — a future
 * exception for a different function requires a new, equally narrow tool,
 * not a generalization of this one (same discipline already established
 * for scripts/build-crm-fresh-migration-projection.mjs).
 *
 * Never touches supabase/migrations/. Never touches
 * supabase/self-hosted/. Never opens a database connection. Never reads a
 * credential. Writes its output only under the OS temp directory
 * (os.tmpdir()), never inside the repository.
 *
 * ── ACL design (Fase I2-E2C Section 4) ───────────────────────────────────
 * supabase/self-hosted/0006_rls_and_grants.sql applies a BLANKET
 * `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon,
 * authenticated` before selectively re-granting — appropriate for a
 * from-scratch self-hosted bootstrap, but wrong here: executing that
 * blanket revoke against a partially-bootstrapped Hosted staging (28/35
 * migrations already applied, each with its own already-correct grants)
 * would silently strip privileges from unrelated, already-deployed
 * functions. The ACL block generated here is therefore a hand-authored,
 * MINIMAL, function-scoped equivalent — targeting only
 * crm_is_active_staff() and crm_is_active_admin() — documented as a
 * minimal projection of the security model in
 * supabase/self-hosted/0006_rls_and_grants.sql, not extracted/hash-pinned
 * from it (its own statements are entangled with the blanket revoke and
 * cannot be lifted verbatim without that context).
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const SOURCE_FILE_RELATIVE_PATH = "supabase/self-hosted/0004_functions_and_rpc.sql";

// ACL provenance source. The generated ACL text itself is NEVER
// extracted/hash-pinned verbatim from this file (see file header "ACL
// design") — its own statements are entangled with a blanket revoke that
// doesn't apply here. What IS read and fail-closed-verified (Fase I2-E2CH
// Section 3) is that this file still exists, still whole-file-hashes to
// the frozen expectation, and still contains the exact two GRANT
// statements and the blanket REVOKE statement this design was derived
// from — proof of provenance, not a copy-paste source.
export const ACL_PROVENANCE_FILE_RELATIVE_PATH = "supabase/self-hosted/0006_rls_and_grants.sql";

// Frozen at Fase 8I-B2B-0B2B-I2-E2C. Whole-file hash of the extraction
// source — any change to this file must be treated as a shape change and
// rejected, not silently re-extracted.
export const EXPECTED_SOURCE_FILE_SHA256 =
  "b7c501ae2d2579ab08ad6f3d3897710629ecd84f8d261535281152e2e43dcd23";

// Frozen at Fase 8I-B2B-0B2B-I2-E2CH. Whole-file hash of the ACL
// provenance source (see ACL_PROVENANCE_FILE_RELATIVE_PATH above).
export const EXPECTED_ACL_PROVENANCE_FILE_SHA256 =
  "42f16e8c6907c10934b96e38f704eeff0fd8269edba95f950bb191505eeb5b80";

// Exact literal lines that must still be present in the ACL provenance
// file for the targeted ACL design to remain justified. Not regexes:
// deliberately literal, so any reformatting of these specific statements
// is treated as "provenance changed" rather than silently tolerated.
export const EXPECTED_ACL_PROVENANCE_GRANT_LINES = [
  "grant execute on function public.crm_is_active_staff() to authenticated;",
  "grant execute on function public.crm_is_active_admin() to authenticated;",
];
export const EXPECTED_ACL_PROVENANCE_BLANKET_REVOKE_LINE =
  "revoke all on all functions in schema public from public, anon, authenticated;";

// Frozen exact fragment hashes (verbatim `create function ... $$;` block
// text, byte-for-byte from the source file — see extractFunctionFragment).
export const EXPECTED_STAFF_FRAGMENT_SHA256 =
  "e696e72b05f33ee30306ea5dbe81afa282238c5d998d88a0254e5c82a24128ed";
export const EXPECTED_ADMIN_FRAGMENT_SHA256 =
  "65d7c37bcd04fe5fab18937fee962c5f9704ba5481a6dacff711b8be1c958a54";

export const TARGET_FUNCTIONS = [
  { name: "crm_is_active_staff", expectedFragmentSha256: EXPECTED_STAFF_FRAGMENT_SHA256 },
  { name: "crm_is_active_admin", expectedFragmentSha256: EXPECTED_ADMIN_FRAGMENT_SHA256 },
];

export class ProjectionError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProjectionError";
  }
}

const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * Extracts a `create function public.<name>(...) ... $$ ... $$;` block
 * verbatim from source text. Deliberately the same shape as
 * extractFunctionSource() in scripts/validate-crm-baseline.mjs, but kept
 * as an independent, self-contained implementation here — this tool must
 * not depend on another script's internals, matching the "narrow, not
 * generic" discipline in the file header.
 *
 * @param {string} text
 * @param {string} functionName
 * @returns {string | null}
 */
export function extractFunctionFragment(text, functionName) {
  const re = new RegExp(
    `create\\s+(or\\s+replace\\s+)?function\\s+public\\.${functionName}\\s*\\([\\s\\S]*?\\$\\$[\\s\\S]*?\\$\\$\\s*;`,
    "i",
  );
  return text.match(re)?.[0] ?? null;
}

/**
 * Pure, hash-independent verification that the ACL provenance text still
 * contains the exact literal lines the targeted ACL design in this tool
 * was derived from (Fase I2-E2CH Section 3). Does NOT extract or reuse
 * any of this text in the generated projection — see the file header
 * "ACL design" for why the targeted ACL is hand-authored, not lifted
 * verbatim. Throws ProjectionError if either expected GRANT line or the
 * blanket REVOKE line has disappeared or changed.
 *
 * @param {string} aclProvenanceText
 */
export function verifyAclProvenanceContent(aclProvenanceText) {
  for (const line of EXPECTED_ACL_PROVENANCE_GRANT_LINES) {
    if (!aclProvenanceText.includes(line)) {
      throw new ProjectionError(
        `ACL provenance check failed: expected GRANT line no longer present in ` +
          `${ACL_PROVENANCE_FILE_RELATIVE_PATH}: ${JSON.stringify(line)}`,
      );
    }
  }
  if (!aclProvenanceText.includes(EXPECTED_ACL_PROVENANCE_BLANKET_REVOKE_LINE)) {
    throw new ProjectionError(
      `ACL provenance check failed: the blanket hardening statement this targeted ACL was ` +
        `intentionally derived from is no longer present in ${ACL_PROVENANCE_FILE_RELATIVE_PATH}: ` +
        `${JSON.stringify(EXPECTED_ACL_PROVENANCE_BLANKET_REVOKE_LINE)}`,
    );
  }
}

function assembleAclBlock(functionName) {
  const signature = `public.${functionName}()`;
  return [
    `revoke all on function ${signature} from public;`,
    `revoke all on function ${signature} from anon;`,
    `revoke all on function ${signature} from authenticated;`,
    `grant execute on function ${signature} to authenticated;`,
  ].join("\n");
}

function assemblePreconditionBlock() {
  return `-- Precondition: this artifact is only for the exact verified
-- ABSENT/ABSENT staging prestate. Any other state (both present, or one
-- present and one absent) is a partial/unexpected state this artifact
-- deliberately refuses to handle -- a separate, explicitly designed
-- recovery path is required for that, never a silent fallback here.
do $$
declare
  v_staff_exists boolean := to_regprocedure('public.crm_is_active_staff()') is not null;
  v_admin_exists boolean := to_regprocedure('public.crm_is_active_admin()') is not null;
begin
  if v_staff_exists and v_admin_exists then
    raise exception 'FAIL[PRE1]: both target functions already exist -- nothing to project. This artifact must not run against this state.';
  end if;
  if v_staff_exists <> v_admin_exists then
    raise exception 'FAIL[PRE2]: partial prerequisite state detected (crm_is_active_staff exists=%, crm_is_active_admin exists=%) -- refusing to guess. A separate recovery path is required.',
      v_staff_exists, v_admin_exists;
  end if;

  if to_regclass('public.profiles') is null then
    raise exception 'FAIL[PRE3]: public.profiles does not exist -- this staging is not at the expected bootstrap point';
  end if;
  if to_regprocedure('auth.uid()') is null then
    raise exception 'FAIL[PRE4]: auth.uid() does not exist -- this does not look like a real Supabase project';
  end if;

  raise notice 'OK[PRE]: both target functions absent, public.profiles and auth.uid() present';
end;
$$;`;
}

function assemblePostconditionBlock() {
  return `do $$
declare
  v_missing text;
  v_bad_shape text;
begin
  select string_agg(f, ', ') into v_missing
  from unnest(array['crm_is_active_staff', 'crm_is_active_admin']) as f
  where to_regprocedure('public.' || f || '()') is null;
  if v_missing is not null then
    raise exception 'FAIL[POST1]: function(s) missing after creation: %', v_missing;
  end if;

  select string_agg(p.proname, ', ') into v_bad_shape
  from pg_proc p
  join pg_language l on l.oid = p.prolang
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('crm_is_active_staff', 'crm_is_active_admin')
    and not (
      l.lanname = 'sql'
      and p.provolatile = 's'
      and p.prosecdef is true
      and coalesce(p.proconfig, array[]::text[]) @> array['search_path=']::text[]
      and p.proowner = (select oid from pg_roles where rolname = current_user)
    );
  if v_bad_shape is not null then
    raise exception 'FAIL[POST2]: function(s) do not match the expected shape (language sql, stable, security definer, search_path='''', owned by the executing role): %', v_bad_shape;
  end if;

  if not has_function_privilege('authenticated', 'public.crm_is_active_staff()', 'execute') then
    raise exception 'FAIL[POST3]: authenticated lacks EXECUTE on crm_is_active_staff()';
  end if;
  if not has_function_privilege('authenticated', 'public.crm_is_active_admin()', 'execute') then
    raise exception 'FAIL[POST3]: authenticated lacks EXECUTE on crm_is_active_admin()';
  end if;
  if has_function_privilege('anon', 'public.crm_is_active_staff()', 'execute') then
    raise exception 'FAIL[POST4]: anon unexpectedly has EXECUTE on crm_is_active_staff()';
  end if;
  if has_function_privilege('anon', 'public.crm_is_active_admin()', 'execute') then
    raise exception 'FAIL[POST4]: anon unexpectedly has EXECUTE on crm_is_active_admin()';
  end if;
  if exists (
    select 1 from information_schema.role_routine_grants
     where routine_name in ('crm_is_active_staff', 'crm_is_active_admin')
       and grantee = 'PUBLIC'
  ) then
    raise exception 'FAIL[POST5]: PUBLIC unexpectedly has a grant record on one of the target functions';
  end if;

  raise notice 'OK[POST]: both functions exist with the expected shape and ACL';
  raise notice 'CRM_SECURITY_PREREQUISITE_PROJECTION_APPLIED = CONFIRMED';
end;
$$;`;
}

/**
 * Pure, hash-independent assembly. Exported separately from
 * buildProjection() so it can be unit-tested against synthetic source
 * text without needing to forge a file colliding with
 * EXPECTED_SOURCE_FILE_SHA256.
 *
 * @param {string} sourceText
 * @returns {{
 *   fragments: { name: string, text: string, sha256: string }[],
 *   projectedText: string,
 * }}
 */
export function extractAndAssemble(sourceText) {
  const fragments = [];
  for (const { name, expectedFragmentSha256 } of TARGET_FUNCTIONS) {
    const fragment = extractFunctionFragment(sourceText, name);
    if (!fragment) {
      throw new ProjectionError(`function fragment not found in source: ${name}`);
    }
    const sha256 = sha256Hex(Buffer.from(fragment, "utf8"));
    if (sha256 !== expectedFragmentSha256) {
      throw new ProjectionError(
        `fragment hash mismatch for ${name}: expected ${expectedFragmentSha256}, got ${sha256}. ` +
          `The source file may have changed -- refusing to project an unexpected definition.`,
      );
    }
    fragments.push({ name, text: fragment, sha256 });
  }

  // Exactly two fragments, no third function ever included -- enforced
  // structurally by TARGET_FUNCTIONS having exactly two entries, asserted
  // here as an explicit invariant rather than trusted implicitly.
  if (fragments.length !== 2) {
    throw new ProjectionError(`expected exactly 2 function fragments, got ${fragments.length}`);
  }

  const parts = [
    "begin;",
    "",
    assemblePreconditionBlock(),
    "",
    "-- Authoritative definitions, extracted verbatim (see EXPECTED_*_FRAGMENT_SHA256).",
    ...fragments.map((f) => f.text),
    "",
    '-- Minimal targeted ACL (see file header "ACL design") -- NOT the',
    "-- blanket self-hosted revoke-all; scoped to exactly these two functions.",
    ...fragments.map((f) => assembleAclBlock(f.name)),
    "",
    assemblePostconditionBlock(),
    "",
    "commit;",
    "",
  ];

  return { fragments, projectedText: parts.join("\n") };
}

/**
 * Reads the source file from disk, enforces the frozen whole-file hash
 * gate, then derives the projection via extractAndAssemble(). Also
 * fail-closed verifies the ACL provenance file (Fase I2-E2CH Section 3)
 * — whole-file hash pinned, plus the exact GRANT/blanket-REVOKE lines the
 * targeted ACL design was derived from must still be present. Never
 * writes to disk. Throws ProjectionError on any unexpected shape.
 *
 * @param {{ repoRoot?: string }} [options]
 */
export function buildProjection({ repoRoot = process.cwd() } = {}) {
  const sourcePath = resolve(repoRoot, SOURCE_FILE_RELATIVE_PATH);

  if (!existsSync(sourcePath)) {
    throw new ProjectionError(`source file not found at ${sourcePath}`);
  }

  const rawBytes = readFileSync(sourcePath);
  const sourceSha256 = sha256Hex(rawBytes);
  if (sourceSha256 !== EXPECTED_SOURCE_FILE_SHA256) {
    throw new ProjectionError(
      `source whole-file hash mismatch: expected ${EXPECTED_SOURCE_FILE_SHA256}, got ${sourceSha256}. ` +
        `supabase/self-hosted/0004_functions_and_rpc.sql must not change -- refusing to extract from an unexpected file.`,
    );
  }

  const aclProvenancePath = resolve(repoRoot, ACL_PROVENANCE_FILE_RELATIVE_PATH);
  if (!existsSync(aclProvenancePath)) {
    throw new ProjectionError(`ACL provenance file not found at ${aclProvenancePath}`);
  }
  const aclProvenanceBytes = readFileSync(aclProvenancePath);
  const aclProvenanceSha256 = sha256Hex(aclProvenanceBytes);
  if (aclProvenanceSha256 !== EXPECTED_ACL_PROVENANCE_FILE_SHA256) {
    throw new ProjectionError(
      `ACL provenance whole-file hash mismatch: expected ${EXPECTED_ACL_PROVENANCE_FILE_SHA256}, ` +
        `got ${aclProvenanceSha256}. ${ACL_PROVENANCE_FILE_RELATIVE_PATH} must not change -- ` +
        `refusing to proceed against an unexpected provenance file.`,
    );
  }
  verifyAclProvenanceContent(aclProvenanceBytes.toString("utf8"));

  const sourceText = rawBytes.toString("utf8");
  const { fragments, projectedText } = extractAndAssemble(sourceText);

  const projectedBytes = Buffer.from(projectedText, "utf8");

  return {
    sourcePath,
    sourceBytes: rawBytes.length,
    sourceSha256,
    aclProvenancePath,
    aclProvenanceBytes: aclProvenanceBytes.length,
    aclProvenanceSha256,
    fragments,
    projectedText,
    projectedBytes: projectedBytes.length,
    projectedSha256: sha256Hex(projectedBytes),
  };
}

/**
 * Writes the projected text to a fresh file under the OS temp directory.
 * Never writes inside the repository.
 *
 * @param {ReturnType<typeof buildProjection>} projection
 * @param {{ tmpDir?: string }} [options]
 */
export function writeProjectionToTempFile(projection, { tmpDir = tmpdir() } = {}) {
  const filename = `crm-security-prerequisite-projection-${Date.now()}.sql`;
  const outPath = join(tmpDir, filename);
  writeFileSync(outPath, projection.projectedText, "utf8");
  const writtenSha256 = sha256Hex(readFileSync(outPath));
  return { path: outPath, sha256: writtenSha256 };
}

function runCli() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║  #4 fresh-bootstrap security-prerequisite projection builder ║");
  console.log("║  (Fase 8I-B2B-0B2B-I2-E2C — local only, no database access)  ║");
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

  console.log(`  source path             : ${projection.sourcePath}`);
  console.log(`  source SHA256           : ${projection.sourceSha256}`);
  console.log(`  source bytes            : ${projection.sourceBytes}`);
  console.log(`  ACL provenance path     : ${projection.aclProvenancePath}`);
  console.log(`  ACL provenance SHA256   : ${projection.aclProvenanceSha256}`);
  console.log(`  ACL provenance bytes    : ${projection.aclProvenanceBytes}`);
  for (const f of projection.fragments) {
    console.log(`  fragment [${f.name}] SHA256: ${f.sha256}`);
  }
  console.log(`  projected SHA256        : ${projection.projectedSha256}`);
  console.log(`  projected bytes         : ${projection.projectedBytes}`);
  console.log(`  temp file written to    : ${written.path}`);
  console.log(`  temp file SHA256        : ${written.sha256}`);
  console.log(`  all hashes 64-hex valid : ${hexRe.test(projection.projectedSha256)}`);
  console.log(
    "\n✓ Projection built. Nothing was written under supabase/migrations/ or " +
      "supabase/self-hosted/. No database connection was made.\n",
  );
  process.exit(0);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runCli();
}
