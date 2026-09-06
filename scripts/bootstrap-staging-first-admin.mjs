#!/usr/bin/env node
/**
 * bootstrap-staging-first-admin.mjs
 *
 * Fase 8I-B2B-0B2B-I2-I3. Local code only — this file is created and
 * unit-tested (against a fully mocked Supabase Admin client) in I3, but is
 * NOT executed against any real target during I3. It is intended for a
 * single, explicit, human-authorized run against CRM Drive Staging once a
 * future phase approves it.
 *
 * Purpose: bootstrap the very first `Administrador` profile on a fresh,
 * userless CRM Drive Staging database — the only way to satisfy the
 * precheck in supabase/migrations/20260822120000_prevent_last_admin_removal.sql
 * (requires >= 1 active Administrador before that migration executes).
 *
 * ── Why this exact mechanism (Fase I2-R3 Section I) ─────────────────────
 * This reuses, outside its own caller-gate, the EXACT technique already
 * used by src/lib/profiles.functions.ts::registerStaffFn for every other
 * staff creation in this codebase:
 *
 *   1. Supabase Auth Admin API (service_role) creates the auth.users row.
 *   2. The hardened, UNMODIFIED handle_new_user() trigger (see
 *      supabase/migrations/20260713120000_crm_application_baseline.sql)
 *      creates the matching public.profiles row — hardcoded
 *      role='Personal', status='Activo'. It never reads role/status from
 *      user_metadata; this script never sends either field in metadata.
 *   3. A single, narrowly-scoped service_role UPDATE promotes that EXACT
 *      profile id to role='Administrador', status='Activo'.
 *
 * registerStaffFn itself cannot be reused directly for the FIRST admin: it
 * requires its caller to already be an authenticated Administrador
 * (src/lib/profiles.functions.ts lines 40-58), which is structurally
 * impossible before any admin exists. This script performs steps 1-3
 * directly via a service_role client, never bypassing or weakening that
 * gate in the application code itself.
 *
 * ── Never ─────────────────────────────────────────────────────────────
 *   - never INSERTs/UPDATEs auth.users directly (only via the Admin API);
 *   - never sends role/status/"Administrador" inside user_metadata;
 *   - never modifies handle_new_user() or its trigger;
 *   - never accepts the password as a CLI argument (env var only);
 *   - never logs/prints/persists the password;
 *   - never targets any project other than the one staging ref below —
 *     there is no override flag, "force" or otherwise.
 *
 * ── Compensation design (Fase I2-R3 Section 12, resolved in I3) ─────────
 * Auth-user creation and profile promotion are NOT one database
 * transaction — a failure between them can leave a partially-bootstrapped
 * auth user. Automatic cleanup (deleting that auth user) is used here
 * because it has been PROVEN safe by inspecting the actual schema, not
 * assumed:
 *   - public.profiles.id is declared
 *       `references auth.users(id) on delete cascade`
 *     (supabase/migrations/20260713120000_crm_application_baseline.sql,
 *     line 110) — deleting the auth user always cleanly removes any
 *     partially-created profile row, with no orphan possible.
 *   - Every other FK referencing public.profiles(id) across all 35
 *     migrations is ON DELETE SET NULL, ON DELETE CASCADE, or (for
 *     google_calendar_connections.connected_by /
 *     google_drive_connections.connected_by) ON DELETE RESTRICT — but
 *     this script's own prestate guard requires `profiles` to be
 *     completely empty (count = 0) before it creates anything, and the
 *     UUID it operates on is generated fresh by createUser() at call
 *     time, so nothing in the database can possibly reference it yet.
 *     The RESTRICT case cannot fire.
 *   Compensation is therefore attempted once on any failure between
 *   createUser() succeeding and promotion being confirmed. If the
 *   compensating delete itself fails, this script does NOT guess further
 *   — it fails closed and returns a BOOTSTRAP_PARTIAL_USER_CREATED result
 *   with the created user id and explicit manual recovery instructions,
 *   never a password or secret.
 *
 * ── Idempotency (Fase I2-R3 Section 13) ─────────────────────────────────
 * If public.profiles already has any row, this script aborts before
 * calling the Admin API at all — it is for first-bootstrap only, never a
 * general staff-creation tool, and never creates a second admin
 * automatically.
 *
 * ── Execution confirmation gate (Fase I2-I3H Section 4) ──────────────────
 * A default invocation (or any invocation missing the exact confirmation
 * value below) MUST NOT perform any remote call at all — not even a read
 * — except when STAGING_BOOTSTRAP_DRY_RUN="true" (see below), which is
 * itself a read-only mode by construction. There is no CLI-argument path
 * for this confirmation and no production override. The confirmation
 * value is not a secret and may appear in sanitized logs/output.
 *
 * ── Dry-run mode (Fase I2-I3H Section 5) ─────────────────────────────────
 * STAGING_BOOTSTRAP_DRY_RUN="true" runs every guard and every read (target
 * guard, migration-window attestation, profiles/active-admin counts,
 * orphan-Auth-user search) but never calls createUser, the profiles
 * UPDATE, or deleteUser. Deliberately does NOT require the execution
 * confirmation value — a dry run cannot write regardless, so gating it
 * behind the same confirmation would only add friction without adding
 * safety (kept intentionally simple per the explicit instruction not to
 * add complexity just to support dry-run).
 *
 * ── Orphan Auth user detection (Fase I2-I3H Section 6) ───────────────────
 * `profiles` being empty does not prove no Auth user exists yet for the
 * target email — an earlier run could have created the Auth user and then
 * failed/crashed before the profile row existed or before this script's
 * own compensation ran. Before creating anything, this script searches
 * existing Auth users by exact (normalized) email via paginated
 * `listUsers()` — the only enumeration primitive the Admin API exposes;
 * there is no direct "getUserByEmail". If a match is found, this script
 * ABORTS with BOOTSTRAP_PARTIAL_AUTH_USER_EXISTS and never auto-deletes
 * it — unlike a user created BY THIS RUN (see the compensation note
 * above), a pre-existing user's provenance is unknown, so only a human
 * can decide whether it is safe to remove. If the search cannot
 * conclusively rule out a match within a bounded number of pages, this
 * script also aborts rather than assume absence.
 */

import { pathToFileURL } from "node:url";

export const STAGING_PROJECT_REF = "ccnvrslhnzdqwanhceqx";
export const STAGING_HOST = `${STAGING_PROJECT_REF}.supabase.co`;

export const DENYLIST_HOST_SUBSTRINGS = ["supabase.consoldi.com"];
export const DENYLIST_REF_SUBSTRINGS = ["pnqdgwpxcxngeueosmnh"];

export const MIN_PASSWORD_LENGTH = 12;

// "Clearly staging-only" (Fase I3 Section 8) is enforced as a concrete,
// testable rule rather than prose: the email must contain this substring
// (case-insensitive), in the local part or the domain. This deliberately
// rejects a real person's email being passed in by mistake or by habit.
export const EMAIL_MUST_CONTAIN_SUBSTRING = "staging";

const EMAIL_FORMAT_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Exact required value of STAGING_BOOTSTRAP_CONFIRM (Fase I3H Section 4).
// Not a secret — safe to appear in logs.
export const EXECUTION_CONFIRMATION_VALUE = "CREATE_FIRST_ADMIN_ON_CRM_DRIVE_STAGING";

// Exact required value of STAGING_BOOTSTRAP_MIGRATION_WINDOW (Fase I3H
// Section 8). This script has no database credential and talks to
// Supabase only through the Admin/PostgREST API, which does not expose
// the `supabase_migrations` schema — there is no safe way for this
// script to verify migration history itself without either weakening
// security (embedding a Postgres credential) or guessing. The migration
// window is therefore a required human/orchestration attestation, not a
// value this script verifies independently. Not a secret.
export const MIGRATION_WINDOW_CONFIRMATION_VALUE =
  "20260806120000_APPLIED_AND_20260822120000_NOT_APPLIED";

export const DRY_RUN_TRUE_VALUE = "true";

// Bounded pagination for the orphan-Auth-user-by-email search (Fase I3H
// Section 6). If more than this many pages exist without conclusively
// finding or ruling out a match, the search aborts rather than guess.
export const AUTH_LOOKUP_PAGE_SIZE = 1000;
export const AUTH_LOOKUP_MAX_PAGES = 50;

export class BootstrapGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = "BootstrapGuardError";
  }
}

function hostOf(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function containsDenylisted(value) {
  const needles = [...DENYLIST_HOST_SUBSTRINGS, ...DENYLIST_REF_SUBSTRINGS];
  return needles.some((needle) => value.includes(needle));
}

/**
 * Target guard (Fase I3 Section 6). Pure function over an env-shaped
 * object — never reads process.env directly, so it is fully unit
 * testable. Returns { ok, errors }. Never accepts an override: there is
 * no "force" parameter anywhere in this function's signature.
 *
 * @param {Record<string, string | undefined>} env
 */
export function validateTargetGuard(env) {
  const errors = [];

  const url = env.SUPABASE_URL;
  if (typeof url !== "string" || url.trim() === "") {
    errors.push("SUPABASE_URL: missing.");
  } else if (containsDenylisted(url)) {
    errors.push("SUPABASE_URL: matches a denylisted production/legacy identifier.");
  } else {
    const host = hostOf(url.trim());
    if (host !== STAGING_HOST) {
      errors.push(
        `SUPABASE_URL: resolves to host "${host}", expected exactly "${STAGING_HOST}". ` +
          `This tool targets CRM Drive Staging only — there is no override.`,
      );
    }
  }

  const ref = env.EXPECTED_STAGING_SUPABASE_PROJECT_REF;
  if (typeof ref !== "string" || ref.trim() === "") {
    errors.push(
      "EXPECTED_STAGING_SUPABASE_PROJECT_REF: missing — required (Fase I3H Section 4), not optional.",
    );
  } else if (containsDenylisted(ref)) {
    errors.push("EXPECTED_STAGING_SUPABASE_PROJECT_REF: matches a denylisted identifier.");
  } else if (ref.trim() !== STAGING_PROJECT_REF) {
    errors.push(
      `EXPECTED_STAGING_SUPABASE_PROJECT_REF: "${ref.trim()}" does not match the pinned ` +
        `staging ref "${STAGING_PROJECT_REF}".`,
    );
  }

  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (typeof serviceKey !== "string" || serviceKey.trim() === "") {
    errors.push("SUPABASE_SERVICE_ROLE_KEY: missing.");
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Validates the transient bootstrap password without ever returning or
 * embedding it in any error message.
 *
 * @param {string | undefined} password
 */
export function validatePassword(password) {
  if (typeof password !== "string" || password.length === 0) {
    throw new BootstrapGuardError(
      "STAGING_BOOTSTRAP_ADMIN_PASSWORD is missing. Set it in the environment before running " +
        "this script; it is never accepted as a CLI argument.",
    );
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new BootstrapGuardError(
      `STAGING_BOOTSTRAP_ADMIN_PASSWORD is shorter than the minimum length (${MIN_PASSWORD_LENGTH}).`,
    );
  }
}

/**
 * Validates the synthetic staging admin email: syntactically valid, and
 * carrying an explicit staging marker so a real person's address can't be
 * used by accident. Never a production credential.
 *
 * @param {string | undefined} email
 */
export function validateEmail(email) {
  if (typeof email !== "string" || email.trim() === "") {
    throw new BootstrapGuardError("STAGING_BOOTSTRAP_ADMIN_EMAIL is missing.");
  }
  const trimmed = email.trim();
  if (!EMAIL_FORMAT_PATTERN.test(trimmed)) {
    throw new BootstrapGuardError(
      "STAGING_BOOTSTRAP_ADMIN_EMAIL is not a syntactically valid email.",
    );
  }
  if (!trimmed.toLowerCase().includes(EMAIL_MUST_CONTAIN_SUBSTRING)) {
    throw new BootstrapGuardError(
      `STAGING_BOOTSTRAP_ADMIN_EMAIL must clearly identify itself as staging-only ` +
        `(must contain "${EMAIL_MUST_CONTAIN_SUBSTRING}"). Refusing to use what looks like a real ` +
        `person's email for a synthetic bootstrap account.`,
    );
  }
  return trimmed;
}

/**
 * Execution confirmation gate (Fase I3H Section 4). Pure, no I/O. Must be
 * checked before ANY remote call in a non-dry-run invocation.
 *
 * @param {Record<string, string | undefined>} env
 */
export function validateExecutionConfirmation(env) {
  const value = env.STAGING_BOOTSTRAP_CONFIRM;
  if (value !== EXECUTION_CONFIRMATION_VALUE) {
    return {
      ok: false,
      errors: [
        `STAGING_BOOTSTRAP_CONFIRM must be exactly "${EXECUTION_CONFIRMATION_VALUE}" to proceed ` +
          `(got: ${value === undefined ? "(missing)" : JSON.stringify(value)}). This value is not ` +
          `a secret and may appear in sanitized logs. Never accepted via CLI argument.`,
      ],
    };
  }
  return { ok: true, errors: [] };
}

/**
 * Migration-window attestation gate (Fase I3H Section 8). This script has
 * no Postgres credential and only talks to Supabase via the Admin/
 * PostgREST API, which does not expose `supabase_migrations` — so it
 * cannot verify migration history itself without weakening security.
 * This is therefore a required human/orchestration attestation string,
 * not a value this function checks against any live state. Pure, no I/O.
 *
 * @param {Record<string, string | undefined>} env
 */
export function validateMigrationWindowConfirmation(env) {
  const value = env.STAGING_BOOTSTRAP_MIGRATION_WINDOW;
  if (value !== MIGRATION_WINDOW_CONFIRMATION_VALUE) {
    return {
      ok: false,
      errors: [
        `STAGING_BOOTSTRAP_MIGRATION_WINDOW must be exactly "${MIGRATION_WINDOW_CONFIRMATION_VALUE}" ` +
          `(got: ${value === undefined ? "(missing)" : JSON.stringify(value)}). This tool cannot read ` +
          `supabase_migrations itself (not exposed via the PostgREST API this client uses) — the ` +
          `orchestrating human/process must confirm 20260806120000 is already applied and ` +
          `20260822120000 is not yet applied before this script may run.`,
      ],
    };
  }
  return { ok: true, errors: [] };
}

/**
 * Searches existing Auth users for an exact (normalized) email match via
 * paginated listUsers() — the only enumeration primitive the Admin API
 * exposes. Returns the matching user or null if the full user list was
 * exhausted without a match. Throws BootstrapGuardError (fail-closed,
 * never a guess) if more than maxPages are needed to reach the end.
 *
 * @param {{ auth: { admin: { listUsers: (opts: { page: number, perPage: number }) => Promise<{ data: { users: Array<{ id: string, email?: string }> } | null, error: { message: string } | null }> } } }} adminClient
 * @param {string} email
 * @param {{ perPage?: number, maxPages?: number }} [options]
 */
export async function findExistingAuthUserByEmail(
  adminClient,
  email,
  { perPage = AUTH_LOOKUP_PAGE_SIZE, maxPages = AUTH_LOOKUP_MAX_PAGES } = {},
) {
  const normalized = email.trim().toLowerCase();
  for (let page = 1; page <= maxPages; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new BootstrapGuardError(
        `Could not enumerate existing Auth users while searching for a pre-existing bootstrap ` +
          `account (page ${page}): ${error.message}`,
      );
    }
    const users = data?.users ?? [];
    const match = users.find(
      (u) => typeof u?.email === "string" && u.email.trim().toLowerCase() === normalized,
    );
    if (match) return match;
    if (users.length < perPage) return null; // last page reached, no match
  }
  throw new BootstrapGuardError(
    `Exceeded ${maxPages} page(s) (perPage=${perPage}) while searching for an existing Auth user ` +
      `by email — cannot conclusively determine absence. Aborting rather than guessing.`,
  );
}

/**
 * Pure builder for the exact Admin API createUser() payload. Exported so
 * tests can assert, by construction, that no role/status/"Administrador"
 * field is ever present — never derived from a broader object that might
 * accidentally carry one.
 *
 * @param {{ email: string, password: string, fullName: string, phone?: string }} input
 */
export function buildCreateUserPayload({ email, password, fullName, phone }) {
  const words = fullName.trim().split(/\s+/);
  const initials =
    words.length >= 2
      ? (words[0][0] + words[1][0]).toUpperCase()
      : words[0].slice(0, 2).toUpperCase();

  return {
    email,
    password,
    email_confirm: true, // marks email confirmed — no invitation/confirmation mail is ever sent
    user_metadata: {
      full_name: fullName,
      initials,
      phone: phone ?? "",
      // Deliberately absent: role, status, or any privileged-role string.
      // handle_new_user() never reads these even if present (see baseline
      // migration), but this payload is built to never carry them in the
      // first place — belt and suspenders.
    },
  };
}

/**
 * Confirms the hardened trigger produced the expected initial profile
 * shape for the exact created user id.
 *
 * @param {{ id: string, role: string, status: string } | null} profileRow
 * @param {string} expectedId
 */
export function verifyInitialProfileShape(profileRow, expectedId) {
  if (!profileRow) {
    throw new BootstrapGuardError(
      `No public.profiles row found for id ${expectedId} after createUser() — the auth trigger ` +
        `did not fire as expected. Not promoting anything.`,
    );
  }
  if (profileRow.id !== expectedId) {
    throw new BootstrapGuardError("Profile row id does not match the created auth user id.");
  }
  if (profileRow.role !== "Personal" || profileRow.status !== "Activo") {
    throw new BootstrapGuardError(
      `Initial profile shape unexpected: role=${profileRow.role}, status=${profileRow.status} ` +
        `(expected Personal/Activo). Not promoting anything.`,
    );
  }
}

/**
 * Orchestrates the full bootstrap flow against an INJECTED Supabase Admin
 * client (never constructed internally from real credentials here — the
 * caller/CLI wiring does that, and tests inject a full mock). This keeps
 * the flow itself free of any live network dependency, so it is testable
 * with zero real calls.
 *
 * @param {{
 *   adminClient: {
 *     auth: { admin: {
 *       createUser: (payload: object) => Promise<{ data: { user: { id: string } | null }, error: { message: string } | null }>,
 *       deleteUser: (id: string) => Promise<{ error: { message: string } | null }>,
 *     } },
 *     from: (table: string) => any,
 *   },
 *   env: Record<string, string | undefined>,
 *   password: string,
 *   email: string,
 *   fullName: string,
 *   phone?: string,
 * }} args
 */
export async function bootstrapFirstAdmin({ adminClient, env, password, email, fullName, phone }) {
  const guard = validateTargetGuard(env);
  if (!guard.ok) {
    return { outcome: "ABORTED_TARGET_GUARD", errors: guard.errors };
  }

  const isDryRun = env.STAGING_BOOTSTRAP_DRY_RUN === DRY_RUN_TRUE_VALUE;

  // ── Execution confirmation gate (Fase I3H Section 4) ───────────────────
  // Skipped only in dry-run mode, which cannot write regardless — gating
  // it behind the same confirmation would add friction without adding
  // safety (explicitly not required by Fase I3H Section 5).
  if (!isDryRun) {
    const confirmation = validateExecutionConfirmation(env);
    if (!confirmation.ok) {
      return { outcome: "ABORTED_EXECUTION_NOT_CONFIRMED", errors: confirmation.errors };
    }
  }

  validatePassword(password);
  const validatedEmail = validateEmail(email);

  const migrationWindow = validateMigrationWindowConfirmation(env);
  if (!migrationWindow.ok) {
    return { outcome: "ABORTED_MIGRATION_WINDOW_NOT_CONFIRMED", errors: migrationWindow.errors };
  }

  // ── Prestate (Fase I3 Section 7 / Section 13 idempotency, hardened in
  //    I3H Section 8 with an explicit, separate active-admin check) ──────
  const { count: profileCount, error: countError } = await adminClient
    .from("profiles")
    .select("id", { count: "exact", head: true });
  if (countError) {
    throw new BootstrapGuardError(`Could not read public.profiles count: ${countError.message}`);
  }
  if ((profileCount ?? 0) > 0) {
    return {
      outcome: "ABORTED_PRESTATE_NOT_EMPTY",
      reason:
        `public.profiles already has ${profileCount} row(s). This tool is for first-bootstrap ` +
        `only and never creates a second admin automatically.`,
    };
  }

  const { count: activeAdminPrecount, error: activeAdminPrecountError } = await adminClient
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "Administrador")
    .eq("status", "Activo");
  if (activeAdminPrecountError) {
    throw new BootstrapGuardError(
      `Could not read the pre-existing active-admin count: ${activeAdminPrecountError.message}`,
    );
  }
  if ((activeAdminPrecount ?? 0) > 0) {
    return {
      outcome: "ABORTED_PRESTATE_ADMIN_EXISTS",
      reason:
        `An active Administrador already exists (count=${activeAdminPrecount}) even though ` +
        `profiles otherwise reported empty above — refusing to proceed on an inconsistent prestate.`,
    };
  }

  // ── Orphan Auth user detection (Fase I3H Section 6) ────────────────────
  // profiles being empty does not prove no Auth user exists yet for this
  // email — a prior run could have created it and failed before the
  // profile existed or before compensation ran. Never auto-deleted here.
  const existingAuthUser = await findExistingAuthUserByEmail(adminClient, validatedEmail);
  if (existingAuthUser) {
    return {
      outcome: "BOOTSTRAP_PARTIAL_AUTH_USER_EXISTS",
      userId: existingAuthUser.id,
      email: validatedEmail,
      reason:
        `An Auth user already exists for this email while public.profiles is empty. Provenance is ` +
        `unknown (could be a prior partial run) — this script never auto-deletes a pre-existing ` +
        `Auth user. A human must inspect and decide via the Supabase Dashboard before retrying.`,
    };
  }

  if (isDryRun) {
    return {
      outcome: "DRY_RUN_OK",
      wouldCreateEmail: validatedEmail,
      reason:
        "All guards and reads passed (target, migration window, prestate, orphan search). " +
        "No createUser/UPDATE/deleteUser was called because STAGING_BOOTSTRAP_DRY_RUN=true.",
    };
  }

  // ── Create the auth user (Fase I3 Section 9) ───────────────────────────
  const payload = buildCreateUserPayload({ email: validatedEmail, password, fullName, phone });
  const { data: created, error: createError } = await adminClient.auth.admin.createUser(payload);
  if (createError || !created?.user) {
    return {
      outcome: "ABORTED_CREATE_USER_FAILED",
      reason: createError?.message ?? "createUser() returned no user",
    };
  }
  const userId = created.user.id;

  // ── Verify the hardened trigger's result (Fase I3 Section 10) ──────────
  try {
    const { data: profileRow, error: profileError } = await adminClient
      .from("profiles")
      .select("id, role, status")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) {
      throw new BootstrapGuardError(`Could not read the created profile: ${profileError.message}`);
    }
    verifyInitialProfileShape(profileRow, userId);

    // ── Promotion (Fase I3 Section 11) ────────────────────────────────
    const { data: updated, error: updateError } = await adminClient
      .from("profiles")
      .update({ role: "Administrador", status: "Activo" })
      .eq("id", userId)
      .select("id, role, status");
    if (updateError) {
      throw new BootstrapGuardError(`Promotion UPDATE failed: ${updateError.message}`);
    }
    if (!Array.isArray(updated) || updated.length !== 1) {
      throw new BootstrapGuardError(
        `Promotion UPDATE affected ${updated?.length ?? 0} row(s), expected exactly 1.`,
      );
    }
    const finalRow = updated[0];
    if (finalRow.role !== "Administrador" || finalRow.status !== "Activo") {
      throw new BootstrapGuardError("Promotion did not result in the expected final shape.");
    }

    const { count: activeAdmins, error: activeAdminsError } = await adminClient
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "Administrador")
      .eq("status", "Activo");
    if (activeAdminsError) {
      throw new BootstrapGuardError(
        `Could not verify the global active-admin predicate: ${activeAdminsError.message}`,
      );
    }
    if (activeAdmins !== 1) {
      throw new BootstrapGuardError(
        `Expected exactly 1 active Administrador after bootstrap, found ${activeAdmins}.`,
      );
    }

    return { outcome: "CREATED", userId, email: validatedEmail };
  } catch (err) {
    // ── Compensation (Fase I2-R3 Section 12 — see file header for the
    //    proof this is safe: profiles.id → auth.users(id) ON DELETE
    //    CASCADE, and the prestate guard above guarantees nothing else
    //    can yet reference this fresh id). `scope: "CURRENT_RUN"` marks
    //    this explicitly as compensation for a user THIS invocation just
    //    created (never for the pre-existing-Auth-user case above, which
    //    returns before createUser() is ever called and is never
    //    auto-deleted — Fase I3H Section 7).
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteError) {
      return {
        outcome: "BOOTSTRAP_PARTIAL_USER_CREATED",
        scope: "CURRENT_RUN",
        userId,
        reason: err instanceof Error ? err.message : String(err),
        compensationError: deleteError.message,
        manualRecoverySteps: [
          `A staging auth user (id: ${userId}) was created but bootstrap did not complete, and the ` +
            `automatic cleanup delete itself failed.`,
          `Inspect auth.users and public.profiles for id ${userId} via the Supabase Dashboard.`,
          `If the profile is missing or not Personal/Activo, delete the auth user manually via the ` +
            `Dashboard (Authentication > Users) — this cascades to public.profiles by design ` +
            `(id references auth.users(id) on delete cascade).`,
          `Do not reuse this id or the same email for a retry until cleanup is confirmed.`,
        ],
      };
    }
    return {
      outcome: "COMPENSATED",
      scope: "CURRENT_RUN",
      reason: err instanceof Error ? err.message : String(err),
      deletedUserId: userId,
    };
  }
}

// ── CLI wiring — NOT executed as part of Fase I3. Guarded exactly like
// every other script in this repo (isDirectRun); constructs a real
// service_role client only when a human runs this file directly in a
// future, explicitly authorized phase. Never imported or invoked by any
// test in this repo, and never invoked by this agent during I3.
async function runCli() {
  const { createClient } = await import("@supabase/supabase-js");

  const env = process.env;
  const password = env.STAGING_BOOTSTRAP_ADMIN_PASSWORD;
  const email = env.STAGING_BOOTSTRAP_ADMIN_EMAIL;
  const fullName = env.STAGING_BOOTSTRAP_ADMIN_FULL_NAME ?? "Staging Bootstrap Admin";
  const phone = env.STAGING_BOOTSTRAP_ADMIN_PHONE;

  const guard = validateTargetGuard(env);
  if (!guard.ok) {
    console.error("✗ Target guard failed:");
    for (const e of guard.errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  try {
    validatePassword(password);
    validateEmail(email);
  } catch (err) {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const adminClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const result = await bootstrapFirstAdmin({ adminClient, env, password, email, fullName, phone });

  // Never print the password. Only ever print outcome/userId/email/reason.
  console.log(JSON.stringify({ ...result }, null, 2));
  process.exit(result.outcome === "CREATED" ? 0 : 1);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  await runCli();
}
