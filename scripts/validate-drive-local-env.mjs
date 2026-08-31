#!/usr/bin/env node
/**
 * validate-drive-local-env.mjs
 *
 * Safety guard for Google Drive validation environments (Fase 8I-B2B-0B1 /
 * 0B1.1 / 0B1H). Fails closed if the EFFECTIVE Supabase identity that
 * RUNTIME code would actually use resolves to production, to the legacy
 * Supabase Cloud project, or to anything outside the allowlist for the
 * selected mode.
 *
 * ── Two modes (Fase 8I-B2B-0B1H) ─────────────────────────────────────
 * Docker/`supabase start` is DEFERRED / OUT OF CRITICAL PATH for this repo
 * (Docker Desktop cannot start reliably on the owner's machine — see
 * runbook Sección 43). This guard therefore supports two independent
 * backends, never a Docker-local Supabase stack:
 *
 *   MODE "drive-local" (default) — effective Supabase URL must resolve to
 *     localhost/127.0.0.1 (a locally-run Postgres/Supabase-shaped backend
 *     that is NOT started via `supabase start`/Docker in this phase).
 *
 *   MODE "drive-hosted-staging" — effective Supabase URL must resolve
 *     EXACTLY to `https://${EXPECTED_STAGING_SUPABASE_PROJECT_REF}.supabase.co`.
 *     Any other `*.supabase.co` project — including a legitimate Hosted
 *     project that simply isn't the expected staging one — FAILS. There is
 *     no "any Supabase Hosted project is fine" allowlist: the project ref
 *     must be pinned explicitly via the `EXPECTED_STAGING_SUPABASE_PROJECT_REF`
 *     env var, which is not itself secret (a project ref is public in the
 *     project's own URL) but MUST be supplied — its absence fails closed
 *     rather than accepting any ref.
 *
 * Select the mode via `--mode=<name>` on the CLI, or leave it unset for
 * "drive-local". The mode never changes RUNTIME_CRITICAL_VARS, the
 * denylist, or the FORBIDDEN_IN_BUNDLE rule — only which host(s) a
 * RUNTIME_CRITICAL URL variable is allowed to resolve to.
 *
 * ── Runtime classification (Fase 8I-B2B-0B1.1 — audited by grep, not by
 * name heuristic) ─────────────────────────────────────────────────────
 * Confirmed by reading every consumer in src/ that touches a Supabase
 * identity variable (src/lib/supabase.ts, src/lib/auth-server.ts,
 * src/lib/profiles.functions.ts, src/lib/email.server.ts,
 * src/lib/google-calendar.server.ts, src/lib/google-drive/google-drive.server.ts,
 * src/lib/zip-import/import-engine.server.ts — all server paths read via
 * either src/lib/env-server.ts::requireServerEnv or
 * src/lib/server-runtime-env.ts::readServerRuntimeEnv, both of which fall
 * back to process.env under the Node preset this local test uses):
 *
 *   RUNTIME_CRITICAL — actually read by app code:
 *     VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (client, import.meta.env)
 *     SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (server)
 *
 *   Confirmed NOT consumed anywhere in src/, scripts/, or tests/ (zero
 *   grep hits) as of this audit: QA_SUPABASE_URL, QA_SUPABASE_ANON_KEY,
 *   QA_ADMIN_*, QA_PERSONAL_* (present only in this machine's
 *   .env.local) and TEST_SUPABASE_URL/_ANON_KEY/_SERVICE_ROLE_KEY (only
 *   consumed by the standalone CI script
 *   scripts/ci/self-hosted-bootstrap/functional-tests.mjs, never by the
 *   CRM app). These are exempted from FAIL — a production/legacy
 *   reference there gets an explicit sanitized WARNING instead, never a
 *   silent pass. Re-audit this list before trusting it if runtime code
 *   is ever changed to read a QA_/TEST_-prefixed variable.
 *
 *   Anything else shaped like a Supabase identity variable that is
 *   neither RUNTIME_CRITICAL nor a known non-runtime prefix is treated
 *   as UNCLASSIFIED and gets the strict (fail-closed) treatment — the
 *   classification never depends on trusting an unaudited name.
 *
 * ── Effective environment (two independent sources) ─────────────────
 *   1. `node --env-file=<file> ...` (standalone Node server) — Node sets
 *      every key from the file directly into process.env, no prefix
 *      filter.
 *   2. `vite dev --mode <mode>` / `vite build --mode <mode>` — Vite's own
 *      env files (.env, .env.local, .env.<mode>, .env.<mode>.local) are
 *      parsed via `loadEnv()`, independent of process.env.
 *
 * process.env always wins over file-based values for ANY runtime
 * critical variable — see `mergeEffectiveEnv`. This means a production
 * value already present in the real process.env is NOT overridden by a
 * safe value in `.env.<mode>.local`; the guard fails on the effective
 * (post-precedence) value, exactly as Node/Vite would resolve it for the
 * real running process.
 *
 * All evaluation logic is exported as pure functions of plain objects so
 * it can be unit-tested deterministically, without depending on this
 * machine's real .env/.env.local files.
 *
 * Usage:
 *   node scripts/validate-drive-local-env.mjs
 *   node scripts/validate-drive-local-env.mjs --mode=drive-hosted-staging
 *
 * Exit codes:
 *   0 — effective Supabase identity is safely confined to the selected
 *       mode's allowlist (warnings may exist)
 *   1 — a RUNTIME_CRITICAL variable resolves outside the allowlist for the
 *       selected mode, is missing, or an unclassified variable is
 *       denylisted (fail closed)
 */

import { loadEnv } from "vite";
import { pathToFileURL } from "node:url";

export const MODES = ["drive-local", "drive-hosted-staging"];
export const DEFAULT_MODE = "drive-local";

// ── Denylist: known production/legacy identities (checked in EVERY mode) ─
export const DENYLIST_HOST_SUBSTRINGS = ["supabase.consoldi.com"];
export const DENYLIST_REF_SUBSTRINGS = ["pnqdgwpxcxngeueosmnh"];
const DENYLIST_ALL = [...DENYLIST_HOST_SUBSTRINGS, ...DENYLIST_REF_SUBSTRINGS];

// ── Allowlist for mode "drive-local" ────────────────────────────────────
export const ALLOWED_HOSTS = ["localhost", "127.0.0.1"];

// ── Allowlist for mode "drive-hosted-staging" ───────────────────────────
// Not a *.supabase.co suffix allowlist. The effective host must equal
// exactly `${ref}.supabase.co` for the ref pinned in this env var — any
// other Supabase Hosted project fails, and a missing var fails too
// (never silently accept "any" staging-looking project).
export const EXPECTED_STAGING_PROJECT_REF_VAR = "EXPECTED_STAGING_SUPABASE_PROJECT_REF";

export function expectedStagingHost(ref) {
  return `${ref}.supabase.co`;
}

// ── Runtime classification (see file header for the audit trail) ───────
export const RUNTIME_CRITICAL_URL_VARS = ["VITE_SUPABASE_URL", "SUPABASE_URL"];
export const RUNTIME_CRITICAL_SECRET_VARS = [
  "VITE_SUPABASE_ANON_KEY",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];
export const RUNTIME_CRITICAL_VARS = [
  ...RUNTIME_CRITICAL_URL_VARS,
  ...RUNTIME_CRITICAL_SECRET_VARS,
];

// Confirmed by grep audit (Fase 8I-B2B-0B1.1) to have zero consumers in
// src/, scripts/, or tests/ — see file header. Not a trust-by-name
// mechanism for new variables: anything NOT explicitly RUNTIME_CRITICAL
// and NOT matching one of these prefixes still gets the strict path.
const NON_RUNTIME_PREFIXES = ["QA_", "TEST_"];

// Variables that must never carry the VITE_ prefix (same rule already
// enforced for production in scripts/validate-production-env.mjs).
const FORBIDDEN_IN_BUNDLE = ["VITE_SUPABASE_SERVICE_ROLE_KEY"];

function hostOf(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

/**
 * Mode-aware host allowlist check. Never derives an identity from a
 * secret key — only from the URL host and (for drive-hosted-staging) the
 * explicitly pinned EXPECTED_STAGING_SUPABASE_PROJECT_REF.
 *
 * @param {string | null} host
 * @param {string} mode
 * @param {Record<string, string | undefined>} env
 */
export function isAllowedHost(host, mode, env) {
  if (host === null) return false;

  if (mode === "drive-hosted-staging") {
    const ref = env[EXPECTED_STAGING_PROJECT_REF_VAR];
    if (typeof ref !== "string" || ref.trim() === "") return false;
    return host === expectedStagingHost(ref.trim());
  }

  // "drive-local" and any unrecognized mode both fall back to the strict
  // local allowlist — fail-closed, never fail-open on an unknown mode.
  return ALLOWED_HOSTS.includes(host);
}

function containsDenylistedString(value) {
  return DENYLIST_ALL.some((needle) => value.includes(needle));
}

function isNonRuntimeKey(key) {
  return NON_RUNTIME_PREFIXES.some((prefix) => key.startsWith(prefix)) && key.includes("SUPABASE");
}

/**
 * Pure evaluation of an effective env object. Never reads process.env or
 * the filesystem directly. Never includes a variable's value in the
 * returned errors/warnings/checks — only the variable name and a
 * sanitized reason.
 *
 * @param {Record<string, string | undefined>} env
 * @param {string} [mode] — "drive-local" (default) or "drive-hosted-staging"
 * @returns {{ ok: boolean, errors: string[], warnings: string[], checks: string[] }}
 */
export function evaluateEffectiveEnv(env, mode = DEFAULT_MODE) {
  const errors = [];
  const warnings = [];
  const checks = [];

  if (!MODES.includes(mode)) {
    errors.push(`MODE: "${mode}" no es un modo reconocido (esperado uno de: ${MODES.join(", ")}).`);
  }

  if (mode === "drive-hosted-staging") {
    const ref = env[EXPECTED_STAGING_PROJECT_REF_VAR];
    if (typeof ref !== "string" || ref.trim() === "") {
      errors.push(
        `${EXPECTED_STAGING_PROJECT_REF_VAR}: falta — requerido en modo drive-hosted-staging ` +
          `para validar la identidad EXACTA del proyecto Supabase Hosted de staging. No se acepta ` +
          `ningún *.supabase.co por sufijo sin este valor pinneado explícitamente.`,
      );
    } else if (containsDenylistedString(ref.trim())) {
      errors.push(
        `${EXPECTED_STAGING_PROJECT_REF_VAR}: coincide con una identidad de producción/legacy prohibida.`,
      );
    } else {
      checks.push(
        `${EXPECTED_STAGING_PROJECT_REF_VAR}: pinneado (${expectedStagingHost(ref.trim())}).`,
      );
    }
  }

  const supabaseShapedKeys = Object.keys(env).filter((key) => key.includes("SUPABASE"));

  for (const key of supabaseShapedKeys) {
    if (key === EXPECTED_STAGING_PROJECT_REF_VAR) continue;
    const value = env[key];
    if (typeof value !== "string" || value.trim() === "") continue;
    const trimmed = value.trim();

    const isRuntimeCritical = RUNTIME_CRITICAL_VARS.includes(key);
    const isUrlVar = RUNTIME_CRITICAL_URL_VARS.includes(key) || key.endsWith("SUPABASE_URL");
    const denylisted = containsDenylistedString(trimmed);

    if (isRuntimeCritical) {
      if (isUrlVar) {
        const host = hostOf(trimmed);
        if (denylisted || !isAllowedHost(host, mode, env)) {
          errors.push(`${key}: resuelve a un host no permitido para el modo "${mode}".`);
        } else {
          checks.push(`${key}: host permitido (runtime, modo "${mode}").`);
        }
      } else {
        if (denylisted) {
          errors.push(`${key}: coincide con una identidad de producción/legacy prohibida.`);
        } else {
          checks.push(`${key}: presente (runtime).`);
        }
      }
    } else if (isNonRuntimeKey(key)) {
      if (denylisted) {
        warnings.push(
          `IGNORED_NON_RUNTIME_PRODUCTION_REFERENCE: ${key} contiene una referencia de ` +
            `producción/legacy, pero no es consumida por ningún runtime de este repositorio ` +
            `(auditado por grep, ver cabecera del script) — se ignora, no bloquea el arranque.`,
        );
      } else {
        const prefix = NON_RUNTIME_PREFIXES.find((p) => key.startsWith(p));
        checks.push(`${key}: no-runtime (${prefix}*), sin problema.`);
      }
    } else {
      // Unclassified: not in RUNTIME_CRITICAL, not a known non-runtime
      // prefix. Fail-closed — never assume a name we haven't audited is
      // safe to ignore.
      if (denylisted) {
        errors.push(`${key}: variable Supabase no clasificada contiene una referencia prohibida.`);
      } else if (isUrlVar) {
        const host = hostOf(trimmed);
        if (!isAllowedHost(host, mode, env)) {
          errors.push(
            `${key}: variable Supabase no clasificada resuelve a un host no permitido para el modo "${mode}".`,
          );
        } else {
          checks.push(`${key}: no clasificada, host permitido.`);
        }
      }
    }
  }

  for (const name of RUNTIME_CRITICAL_VARS) {
    const value = env[name];
    if (typeof value !== "string" || value.trim() === "") {
      errors.push(`${name}: falta — variable RUNTIME_CRITICAL requerida para el arranque.`);
    }
  }

  for (const name of FORBIDDEN_IN_BUNDLE) {
    const value = env[name];
    if (typeof value === "string" && value.trim() !== "") {
      errors.push(`${name}: definida — esta clave NO debe tener prefijo VITE_.`);
    } else {
      checks.push(`${name}: no definida (correcto).`);
    }
  }

  return { ok: errors.length === 0, errors, warnings, checks };
}

/**
 * Merges a file-based env (Vite loadEnv output) with process.env, with
 * process.env winning on conflict — matching real Node/Vite precedence.
 * Exported so the precedence rule itself is unit-testable in isolation.
 *
 * @param {Record<string, string | undefined>} fileEnv
 * @param {Record<string, string | undefined>} processEnv
 */
export function mergeEffectiveEnv(fileEnv, processEnv) {
  return { ...fileEnv, ...processEnv };
}

/** CLI-only: parses `--mode=<name>` from argv, defaulting to DEFAULT_MODE. */
function resolveModeFromArgv(argv) {
  const flag = argv.find((arg) => arg.startsWith("--mode="));
  if (!flag) return DEFAULT_MODE;
  const value = flag.slice("--mode=".length).trim();
  return value === "" ? DEFAULT_MODE : value;
}

/** CLI-only: resolves the real effective env from process.env + Vite's loadEnv. */
function collectEffectiveEnvFromRuntime(mode) {
  let fromVite = {};
  try {
    // Empty prefix ("") is deliberate: this script is never bundled to a
    // client, so it needs every key, not just VITE_-prefixed ones.
    fromVite = loadEnv(mode, process.cwd(), "");
  } catch (err) {
    console.error(`✗ No se pudo resolver el entorno de Vite para mode="${mode}": ${err.message}`);
    process.exit(1);
  }

  return mergeEffectiveEnv(fromVite, { ...process.env });
}

function runCli() {
  const mode = resolveModeFromArgv(process.argv.slice(2));
  const env = collectEffectiveEnvFromRuntime(mode);
  const { ok, errors, warnings, checks } = evaluateEffectiveEnv(env, mode);

  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║  Guard: entorno de validación de Google Drive                ║");
  console.log("║  (Fase 8I-B2B-0B1H — fail-closed, runtime-aware, dual-mode)   ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");
  console.log(`Modo evaluado: "${mode}"\n`);

  for (const line of checks) console.log(`  ✓ ${line}`);
  for (const line of warnings) console.warn(`  ⚠ ${line}`);
  for (const line of errors) console.error(`  ✗ ${line}`);

  if (!ok) {
    console.error(
      `\n✗ Guard FALLIDO. Una variable RUNTIME_CRITICAL (o no clasificada) no está confinada ` +
        `al allowlist del modo "${mode}", o falta. No se inicia la prueba de Drive.\n`,
    );
    process.exit(1);
  }

  console.log(
    `\n✓ Todas las variables RUNTIME_CRITICAL están confinadas al allowlist del modo "${mode}". ` +
      `La prueba de Drive puede continuar.\n`,
  );
  process.exit(0);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  runCli();
}
