#!/usr/bin/env node
/**
 * validate-production-env.mjs
 * Validates that all required runtime environment variables are set before
 * starting the production server.
 *
 * Usage:
 *   node scripts/validate-production-env.mjs
 *
 * Exit codes:
 *   0 — all required variables present
 *   1 — one or more required variables missing
 */

const REQUIRED = [
  { name: "SUPABASE_URL", description: "URL del proyecto Supabase (ej: https://xxx.supabase.co)" },
  {
    name: "SUPABASE_ANON_KEY",
    description: "Clave anon/publishable de Supabase para validar sesiones",
  },
  { name: "SUPABASE_SERVICE_ROLE_KEY", description: "Clave service_role de Supabase (secreta)" },
  { name: "GOOGLE_CLIENT_ID", description: "Client ID de Google OAuth 2.0" },
  { name: "GOOGLE_CLIENT_SECRET", description: "Client Secret de Google OAuth 2.0 (secreto)" },
  {
    name: "GOOGLE_OAUTH_REDIRECT_URI",
    description:
      "URI de redirección OAuth: https://abogado.consoldi.com/api/google-calendar/callback",
  },
  {
    name: "GOOGLE_OAUTH_STATE_SECRET",
    description: "Secreto HMAC para firmar estados OAuth (mín. 32 chars aleatorios)",
  },
  {
    name: "GOOGLE_TOKEN_ENCRYPTION_KEY",
    description: "Clave AES para cifrar refresh tokens (mín. 32 chars aleatorios)",
  },
  {
    name: "GOOGLE_CALENDAR_WEBHOOK_URL",
    description:
      "URL HTTPS pública del webhook: https://abogado.consoldi.com/api/google-calendar/webhook",
  },
  // Requerida al mismo nivel que el resto de variables de Google Calendar de
  // arriba: este script valida el target Node/Virtualmin, donde no existe
  // scheduled() de Cloudflare Workers. Sin este secreto, nada puede disparar
  // /api/google-calendar/maintenance — el canal nunca se renueva y la cola
  // de sincronización nunca se procesa, degradando Google→CRM en silencio
  // hasta que expira el canal (~6 días). Si Google Calendar ya es una
  // integración requerida en este release (como indican las variables
  // GOOGLE_CLIENT_ID/SECRET de arriba, también obligatorias), su
  // mantenimiento programado lo es igual.
  {
    name: "GOOGLE_CALENDAR_MAINTENANCE_SECRET",
    description:
      "Secreto para /api/google-calendar/maintenance (cron del SO en el target Node, " +
      "sustituye a scheduled() de Cloudflare Workers). Genera un valor aleatorio largo " +
      "(ej. openssl rand -hex 32) y configura un cron/systemd timer que lo envíe en el " +
      "header X-Maintenance-Secret.",
  },
];

const OPTIONAL = [
  { name: "NODE_ENV", description: "Entorno (recomendado: production)", default: "production" },
  { name: "HOST", description: "IP de escucha del servidor", default: "127.0.0.1" },
  { name: "PORT", description: "Puerto HTTP del servidor", default: "3000" },
  { name: "GROQ_API_KEY", description: "Clave API de Groq para el chatbot Lex" },
  {
    name: "GOOGLE_SHARED_CALENDAR_ID",
    description: "ID del calendario compartido (puede configurarse en la UI)",
  },
];

// Variables that must NEVER appear in this process for safety
const FORBIDDEN_IN_BUNDLE = ["SUPABASE_SERVICE_ROLE_KEY"];

let hasErrors = false;

console.log("╔════════════════════════════════════════════════════════════╗");
console.log("║  advocate-nest — Validación de variables de producción     ║");
console.log("╚════════════════════════════════════════════════════════════╝\n");

console.log("── Variables requeridas ────────────────────────────────────");
for (const { name, description } of REQUIRED) {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    console.error(`  ✗ FALTA: ${name}`);
    console.error(`          ${description}`);
    hasErrors = true;
  } else {
    // Show only first 6 chars to confirm presence without leaking
    const preview = value.length > 6 ? `${value.slice(0, 6)}…` : "***";
    console.log(`  ✓ ${name} = ${preview}`);
  }
}

console.log("\n── Variables opcionales ────────────────────────────────────");
for (const { name, description, default: def } of OPTIONAL) {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    console.warn(`  ○ ${name} no definida. ${def ? `(default: ${def})` : ""}`);
    console.warn(`    ${description}`);
  } else {
    const preview = value.length > 6 ? `${value.slice(0, 6)}…` : "***";
    console.log(`  ✓ ${name} = ${preview}`);
  }
}

console.log("\n── Verificaciones de seguridad ─────────────────────────────");
// Ensure VITE_* vars don't contain sensitive values
const viteSrk = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
if (viteSrk && viteSrk.trim()) {
  console.error(
    "  ✗ CRÍTICO: VITE_SUPABASE_SERVICE_ROLE_KEY está definida — esta clave NO debe tener prefijo VITE_ ya que se incrusta en el bundle del cliente.",
  );
  hasErrors = true;
} else {
  console.log("  ✓ VITE_SUPABASE_SERVICE_ROLE_KEY no definida (correcto)");
}

if (hasErrors) {
  console.error(
    "\n✗ Validación FALLIDA. Configura las variables faltantes en el archivo .env.production y vuelve a ejecutar.\n",
  );
  process.exit(1);
} else {
  console.log("\n✓ Todas las variables requeridas están presentes. El servidor puede iniciarse.\n");
  process.exit(0);
}
