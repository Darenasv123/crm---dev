#!/usr/bin/env node
/**
 * verify-release.mjs
 * Verifies the release structure is complete and does not contain secrets.
 *
 * Usage (run from server-release/ directory):
 *   node scripts/verify-release.mjs
 */

import { existsSync, statSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RELEASE_ROOT = join(__dirname, "..");

let errors = 0;
let warnings = 0;

function ok(msg) {
  console.log(`  ✓ ${msg}`);
}
function warn(msg) {
  console.warn(`  ⚠ ${msg}`);
  warnings++;
}
function fail(msg) {
  console.error(`  ✗ ${msg}`);
  errors++;
}

function checkExists(relPath, label) {
  const full = join(RELEASE_ROOT, relPath);
  if (existsSync(full)) {
    ok(`${label || relPath} existe`);
    return true;
  } else {
    fail(`FALTA: ${label || relPath} (${relPath})`);
    return false;
  }
}

// Patterns that indicate secrets — used to scan file contents
const SECRET_PATTERNS = [
  { name: "service_role JWT", regex: /eyJ[A-Za-z0-9+/=]{20,}\.[A-Za-z0-9+/=]{20,}\.[A-Za-z0-9\-_]{20,}/ },
  { name: "SUPABASE_SERVICE_ROLE_KEY=<valor>", regex: /SUPABASE_SERVICE_ROLE_KEY\s*=\s*ey[A-Za-z0-9]/ },
  { name: "GOOGLE_CLIENT_SECRET=<valor>", regex: /GOOGLE_CLIENT_SECRET\s*=\s*[A-Za-z0-9\-_]{20,}/ },
  { name: "GROQ_API_KEY=<valor>", regex: /GROQ_API_KEY\s*=\s*gsk_[A-Za-z0-9]{10,}/ },
  { name: "private key PEM", regex: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/ },
];

// Paths that must NOT exist in the release
const FORBIDDEN_PATHS = [
  "app/src",
  "app/.git",
  "app/node_modules",
  "app/.env",
  "app/.env.local",
  "app/.env.production",
  ".env",
  ".env.local",
  ".env.production",
  "app/.wrangler",
  "app/wrangler.toml",
];

function scanForSecrets(filePath) {
  let content;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return; // Binary file, skip
  }
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.regex.test(content)) {
      fail(`SECRETO detectado (${pattern.name}) en: ${relative(RELEASE_ROOT, filePath)}`);
    }
  }
}

function walkDir(dir, callback) {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, callback);
    } else {
      callback(full);
    }
  }
}

console.log("╔════════════════════════════════════════════════════════════╗");
console.log("║  advocate-nest — Verificación de release                   ║");
console.log("╚════════════════════════════════════════════════════════════╝\n");

// 1. Required structure
console.log("── Estructura requerida ────────────────────────────────────");
checkExists("app/.output/server/index.mjs", "Entrypoint del servidor Node");
checkExists("app/.output/public", "Assets públicos");
checkExists("app/.output/public/assets", "Assets JS/CSS");
checkExists("app/package.json", "package.json de la app");
checkExists("config/.env.production.example", "Plantilla de variables");
checkExists("docs/VIRTUALMIN_DEPLOYMENT.md", "Guía de despliegue Virtualmin");
checkExists("docs/ENVIRONMENT_VARIABLES.md", "Documentación de variables");
checkExists("docs/SUPABASE_PRODUCTION_CONFIGURATION.md", "Guía Supabase");
checkExists("docs/GOOGLE_CALENDAR_CONFIGURATION.md", "Guía Google Calendar");
checkExists("docs/ADMIN_SERVER_MESSAGE.md", "Mensaje para administrador");
checkExists("docs/UPDATE.md", "Guía de actualización");
checkExists("docs/ROLLBACK.md", "Guía de rollback");
checkExists("scripts/verify-release.mjs", "Script de verificación");
checkExists("scripts/smoke-test.mjs", "Smoke test");
checkExists("RELEASE_INFO.txt", "Info del release");

// 2. Verify nitro.json shows node preset
console.log("\n── Preset de Nitro ─────────────────────────────────────────");
const nitroJsonPath = join(RELEASE_ROOT, "app/.output/nitro.json");
if (existsSync(nitroJsonPath)) {
  const nitro = JSON.parse(readFileSync(nitroJsonPath, "utf8"));
  if (nitro.preset === "node-server" || nitro.preset === "node") {
    ok(`Preset Nitro: ${nitro.preset} (correcto para Node.js)`);
  } else {
    fail(`Preset Nitro es "${nitro.preset}" — se esperaba "node" o "node-server"`);
  }
} else {
  fail("No se encontró app/.output/nitro.json");
}

// 3. Forbidden paths
console.log("\n── Rutas prohibidas ────────────────────────────────────────");
for (const forbidden of FORBIDDEN_PATHS) {
  const full = join(RELEASE_ROOT, forbidden);
  if (existsSync(full)) {
    fail(`Ruta prohibida presente: ${forbidden}`);
  } else {
    ok(`${forbidden} no presente (correcto)`);
  }
}

// 4. No node_modules in app/
console.log("\n── node_modules ─────────────────────────────────────────────");
const nmPath = join(RELEASE_ROOT, "app/node_modules");
if (existsSync(nmPath)) {
  warn("app/node_modules existe — el ZIP no debería incluirlos (instalar en el servidor)");
} else {
  ok("app/node_modules no presente en el release (correcto)");
}

// 5. Security scan
console.log("\n── Escaneo de seguridad ────────────────────────────────────");
// Only scan docs, config, scripts, and RELEASE_INFO — not the compiled bundle (it's expected to have Supabase anon key)
const scanDirs = ["docs", "config", "scripts", "RELEASE_INFO.txt"];
let scanned = 0;
for (const scanTarget of scanDirs) {
  const full = join(RELEASE_ROOT, scanTarget);
  if (existsSync(full)) {
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkDir(full, (f) => {
        scanForSecrets(f);
        scanned++;
      });
    } else {
      scanForSecrets(full);
      scanned++;
    }
  }
}
if (errors === 0) {
  ok(`${scanned} archivos escaneados — sin secretos detectados`);
}

// Summary
console.log("\n────────────────────────────────────────────────────────────");
if (errors === 0 && warnings === 0) {
  console.log("✓ Release verificado correctamente. Sin errores ni advertencias.\n");
  process.exit(0);
} else if (errors === 0) {
  console.warn(`⚠ Release con ${warnings} advertencia(s). Revisar antes de distribuir.\n`);
  process.exit(0);
} else {
  console.error(
    `✗ Release con ${errors} error(es) y ${warnings} advertencia(s). No distribuir.\n`,
  );
  process.exit(1);
}
