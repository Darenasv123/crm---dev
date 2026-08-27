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
  // Google Drive (Fase 8B): OPCIONAL a propósito, a diferencia de las
  // variables de Google Calendar de arriba (que sí son REQUIRED). Drive es
  // una integración adicional que todavía no está conectada a ningún dato
  // real -- el CRM debe poder arrancar en producción sin ella configurada.
  // OAuth client separado de Calendar (nunca comparte GOOGLE_CLIENT_ID/
  // SECRET), ver server-release/docs/GOOGLE_DRIVE_CONFIGURATION.md.
  {
    name: "GOOGLE_DRIVE_CLIENT_ID",
    description: "Client ID de Google OAuth 2.0 para Drive (distinto del de Calendar)",
  },
  {
    name: "GOOGLE_DRIVE_CLIENT_SECRET",
    description: "Client Secret de Google OAuth 2.0 para Drive (secreto, distinto del de Calendar)",
  },
  {
    name: "GOOGLE_DRIVE_REDIRECT_URI",
    description:
      "URI de redirección OAuth de Drive: https://abogado.consoldi.com/api/google-drive/callback",
  },
  {
    name: "GOOGLE_DRIVE_MAINTENANCE_SECRET",
    description:
      "Secreto del cron que procesa la cola CRM -> Drive. Pasa a ser REQUERIDO si Drive está habilitado.",
  },
  {
    name: "GOOGLE_DRIVE_WEBHOOK_URL",
    description:
      "URL HTTPS pública del webhook de Drive (Fase 8F). SIEMPRE opcional, incluso con Drive " +
      "habilitado: sin ella el watch queda deshabilitado y Drive sigue sincronizando por " +
      "polling periódico (page token + mantenimiento ya cubren la durabilidad).",
  },
  // Correo (Fase 5): deliberadamente OPCIONAL, no REQUIRED. El CRM debe
  // poder arrancar en producción sin Correo configurado -- de hecho, el
  // propio SMTP de GoTrue (recuperación de contraseña) ya está deshabilitado
  // hoy en este entorno por no funcionar (ver src/lib/feature-flags.ts).
  // Si Correo se declara requisito productivo en un release futuro, mover
  // este bloque a REQUIRED entonces, no antes.
  {
    name: "SMTP_HOST",
    description: 'Servidor SMTP saliente. Sin esto, Correo permanece "no configurado" en el CRM.',
  },
  { name: "SMTP_PORT", description: "Puerto SMTP (por defecto 587)" },
  {
    name: "SMTP_SECURE",
    description: '"true" para SMTPS implícito (usualmente puerto 465), si no se omite',
  },
  { name: "SMTP_USER", description: "Usuario/cuenta SMTP" },
  { name: "SMTP_PASSWORD", description: "Contraseña SMTP (secreto, nunca se expone al navegador)" },
  { name: "SMTP_FROM_EMAIL", description: "Correo remitente de los envíos del CRM" },
  { name: "SMTP_FROM_NAME", description: "Nombre visible del remitente (opcional)" },
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

// ── Requeridas CONDICIONALMENTE (Fase 8I-A.1 — hardening fail-fast) ────
// Google Drive sigue siendo opcional en su conjunto: el CRM arranca sin él.
// Pero la versión anterior de este bloque solo activaba la comprobación
// cuando CLIENT_ID Y CLIENT_SECRET estaban AMBOS presentes, lo que dejaba
// pasar en silencio combinaciones parciales -- por ejemplo, solo CLIENT_ID
// definida, o CLIENT_ID+SECRET sin REDIRECT_URI -- que arrancarían el
// servidor con Drive a medio configurar, fallando recién en runtime de
// forma opaca en vez de fallar aquí, explícito, al arrancar.
//
// Regla corregida: CUALQUIERA de las tres variables de OAuth propias de
// Drive presente ya se interpreta como una señal deliberada de que el
// estudio empezó a configurarlo -- y en ese caso, las 6 variables núcleo
// son obligatorias, no un subconjunto. Los secretos compartidos con
// Calendar (GOOGLE_OAUTH_STATE_SECRET, GOOGLE_TOKEN_ENCRYPTION_KEY) ya son
// REQUIRED arriba de forma incondicional porque Calendar los exige hoy;
// se re-verifican aquí explícitamente para que la exigencia de Drive no
// dependa silenciosamente de que Calendar siga siendo obligatorio en el
// futuro -- si Calendar alguna vez se vuelve opcional, esta comprobación
// sigue protegiendo a Drive por sí sola.
//
// GOOGLE_DRIVE_WEBHOOK_URL NUNCA se exige aquí, ni siquiera con Drive
// plenamente habilitado: el watch (Fase 8F) es una optimización de
// latencia, no la garantía de durabilidad -- esa la dan el page token
// persistente y este mismo mantenimiento periódico.
console.log("\n── Requeridas si Google Drive está habilitado ───────────────");
const DRIVE_ENABLEMENT_SIGNALS = [
  "GOOGLE_DRIVE_CLIENT_ID",
  "GOOGLE_DRIVE_CLIENT_SECRET",
  "GOOGLE_DRIVE_REDIRECT_URI",
];
const DRIVE_CORE_VARS = [
  "GOOGLE_DRIVE_CLIENT_ID",
  "GOOGLE_DRIVE_CLIENT_SECRET",
  "GOOGLE_DRIVE_REDIRECT_URI",
  "GOOGLE_OAUTH_STATE_SECRET",
  "GOOGLE_TOKEN_ENCRYPTION_KEY",
  "GOOGLE_DRIVE_MAINTENANCE_SECRET",
];
const driveEnabled = DRIVE_ENABLEMENT_SIGNALS.some(
  (name) => (process.env[name] ?? "").trim() !== "",
);
if (!driveEnabled) {
  console.log("  ○ Google Drive no está habilitado; no se exige nada adicional.");
} else {
  const missingDriveVars = DRIVE_CORE_VARS.filter(
    (name) => (process.env[name] ?? "").trim() === "",
  );
  if (missingDriveVars.length > 0) {
    console.error(
      `  ✗ Google Drive configuration is incomplete: missing ${missingDriveVars.join(", ")}`,
    );
    console.error(
      "          Se detectó al menos una variable de OAuth de Drive definida, lo que activa " +
        "la integración -- en ese estado las 6 variables núcleo son obligatorias " +
        "(GOOGLE_DRIVE_WEBHOOK_URL es la única excepción y sigue siendo siempre opcional).",
    );
    hasErrors = true;
  } else {
    console.log("  ✓ Google Drive habilitado: las 6 variables núcleo están presentes");
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
