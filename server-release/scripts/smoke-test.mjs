#!/usr/bin/env node
/**
 * smoke-test.mjs
 * Runs a smoke test against a running instance of advocate-nest.
 *
 * Usage:
 *   node scripts/smoke-test.mjs [--url http://127.0.0.1:3000]
 *
 * The test verifies:
 *   - /api/health returns 200 with correct shape
 *   - / returns 200 HTML
 *   - /login returns 200 HTML
 *   - CSS assets are served
 *   - No critical errors in responses
 */

const args = process.argv.slice(2);
const urlArgIndex = args.indexOf("--url");
const BASE_URL =
  urlArgIndex !== -1 ? args[urlArgIndex + 1] : process.env.SMOKE_URL ?? "http://127.0.0.1:3000";

let passed = 0;
let failed = 0;

async function check(label, fn) {
  try {
    await fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${label}: ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function get(path, expectedStatus = 200) {
  const url = `${BASE_URL}${path}`;
  let res;
  try {
    res = await fetch(url, {
      headers: { Accept: "text/html,application/json,*/*" },
      redirect: "manual",
    });
  } catch (err) {
    throw new Error(`No se pudo conectar a ${url}: ${err.message}`);
  }
  if (res.status !== expectedStatus) {
    throw new Error(`Esperado HTTP ${expectedStatus}, recibido ${res.status} para ${path}`);
  }
  return res;
}

console.log("╔════════════════════════════════════════════════════════════╗");
console.log("║  advocate-nest — Smoke Test                                ║");
console.log("╚════════════════════════════════════════════════════════════╝");
console.log(`\nURL base: ${BASE_URL}\n`);

// Health check
await check("/api/health — responde 200", async () => {
  const res = await get("/api/health");
  const body = await res.json();
  assert(body.status === "ok", `status esperado "ok", recibido "${body.status}"`);
  assert(body.service === "advocate-nest", `service incorrecto: ${body.service}`);
  assert(typeof body.version === "string", "version debe ser string");
});

await check("/api/health — no expone secretos", async () => {
  const res = await get("/api/health");
  const text = await res.text();
  assert(!text.includes("service_role"), "La respuesta contiene 'service_role'");
  assert(!text.includes("SUPABASE_SERVICE_ROLE"), "La respuesta contiene clave privada");
  assert(!text.includes("GOOGLE_CLIENT_SECRET"), "La respuesta contiene Google secret");
});

// Main page
await check("/ — responde 200 HTML", async () => {
  const res = await get("/");
  const ct = res.headers.get("content-type") ?? "";
  assert(ct.includes("text/html"), `Content-Type incorrecto: ${ct}`);
  const body = await res.text();
  assert(body.length > 1000, `HTML demasiado corto (${body.length} chars)`);
  assert(body.includes("<html"), "No contiene tag <html>");
});

// Login page
await check("/login — responde 200 HTML", async () => {
  const res = await get("/login");
  const ct = res.headers.get("content-type") ?? "";
  assert(ct.includes("text/html"), `Content-Type incorrecto: ${ct}`);
});

// CSS assets
await check("/assets/ — CSS sirve correctamente", async () => {
  // Find the CSS file name from the public assets
  const stylesRes = await get("/assets/styles-ZfZVgIsh.css");
  const ct = stylesRes.headers.get("content-type") ?? "";
  assert(ct.includes("text/css"), `Content-Type CSS incorrecto: ${ct}`);
});

// Static files
await check("/manifest.json — sirve correctamente", async () => {
  const res = await get("/manifest.json");
  const body = await res.json();
  assert(typeof body === "object", "manifest.json no es JSON válido");
});

// 404 handling
await check("/ruta-inexistente — manejo correcto (no crash)", async () => {
  const res = await fetch(`${BASE_URL}/ruta-que-no-existe-abc123`, {
    redirect: "manual",
  });
  // Should return 200 (SPA fallback) or 404, but NOT 500
  assert(
    res.status !== 500,
    `Ruta inexistente retornó 500 — posible error de configuración`,
  );
});

// Summary
console.log(`\n────────────────────────────────────────────────────────────`);
console.log(`Pasados: ${passed}  |  Fallidos: ${failed}`);

if (failed === 0) {
  console.log("✓ Todos los smoke tests pasaron.\n");
  process.exit(0);
} else {
  console.error(`✗ ${failed} smoke test(s) fallaron. Revisar la configuración del servidor.\n`);
  process.exit(1);
}
