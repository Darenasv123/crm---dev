import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildDriveAppProperties,
  decryptToken,
  encryptToken,
  GOOGLE_DRIVE_SCOPES,
  isGoogleDriveConfigured,
} from "@/lib/google-drive/google-drive.server";

const read = (path: string) => readFileSync(path, "utf8");
const server = read("src/lib/google-drive/google-drive.server.ts");
const migration = read("supabase/migrations/20260824100000_google_drive_sync_foundation.sql");
const validateEnv = read("scripts/validate-production-env.mjs");
const envExample = read(".env.example");

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) previous[key] = process.env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// ── configured=false cuando faltan las variables de Drive (real, no mock) ──
describe("Fase 8B — isGoogleDriveConfigured: Drive es opcional", () => {
  it("false cuando faltan las 3 variables", () => {
    withEnv(
      {
        GOOGLE_DRIVE_CLIENT_ID: undefined,
        GOOGLE_DRIVE_CLIENT_SECRET: undefined,
        GOOGLE_DRIVE_REDIRECT_URI: undefined,
      },
      () => {
        expect(isGoogleDriveConfigured()).toBe(false);
      },
    );
  });

  it("false cuando falta solo una de las 3", () => {
    withEnv(
      {
        GOOGLE_DRIVE_CLIENT_ID: "client-id",
        GOOGLE_DRIVE_CLIENT_SECRET: "client-secret",
        GOOGLE_DRIVE_REDIRECT_URI: undefined,
      },
      () => {
        expect(isGoogleDriveConfigured()).toBe(false);
      },
    );
  });

  it("true cuando las 3 están presentes", () => {
    withEnv(
      {
        GOOGLE_DRIVE_CLIENT_ID: "client-id",
        GOOGLE_DRIVE_CLIENT_SECRET: "client-secret",
        GOOGLE_DRIVE_REDIRECT_URI: "https://example.com/api/google-drive/callback",
      },
      () => {
        expect(isGoogleDriveConfigured()).toBe(true);
      },
    );
  });
});

// ── Encryption: round-trip real, no mocks (Fase 8B Sección 42) ────────────
describe("Fase 8B — cifrado de refresh tokens (AES-GCM, round-trip real)", () => {
  const KEY_A = "a".repeat(32);
  const KEY_B = "b".repeat(32);

  beforeEach(() => {
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = KEY_A;
  });
  afterEach(() => {
    delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  });

  it("round-trip: encrypt seguido de decrypt devuelve el texto original", async () => {
    const plaintext = "1//0g_a_real_looking_refresh_token_value";
    const ciphertext = await encryptToken(plaintext);
    const decrypted = await decryptToken(ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  it("el ciphertext es distinto del plaintext", async () => {
    const plaintext = "mi-refresh-token-secreto";
    const ciphertext = await encryptToken(plaintext);
    expect(ciphertext).not.toBe(plaintext);
    expect(ciphertext).not.toContain(plaintext);
  });

  it("dos cifrados del mismo valor producen ciphertexts distintos (IV aleatorio por operación)", async () => {
    const plaintext = "mismo-valor";
    const first = await encryptToken(plaintext);
    const second = await encryptToken(plaintext);
    expect(first).not.toBe(second);
    // pero ambos descifran al mismo valor original
    expect(await decryptToken(first)).toBe(plaintext);
    expect(await decryptToken(second)).toBe(plaintext);
  });

  it("un ciphertext manipulado (tamper) falla al descifrar en vez de devolver basura silenciosamente", async () => {
    const ciphertext = await encryptToken("valor-original");
    const tampered = ciphertext.slice(0, -4) + (ciphertext.slice(-4) === "AAAA" ? "BBBB" : "AAAA");
    await expect(decryptToken(tampered)).rejects.toThrow();
  });

  it("descifrar con la clave equivocada falla (no revela contenido con otra clave)", async () => {
    const ciphertext = await encryptToken("valor-original");
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = KEY_B;
    await expect(decryptToken(ciphertext)).rejects.toThrow();
  });
});

// ── Estructura de OAuth/PKCE/state (mismo nivel de rigor que Calendar) ────
describe("Fase 8B — OAuth: PKCE, state firmado, one-time-use (verificación estructural, igual que Calendar)", () => {
  it("usa PKCE S256, nunca plain", () => {
    expect(server).toContain('code_challenge_method: "S256"');
    expect(server).not.toContain('code_challenge_method: "plain"');
  });

  it("el state incluye nonce + expiración + firma HMAC, comparada en tiempo constante", () => {
    expect(server).toContain("timingSafeEqual(signature, await hmac(unsignedState))");
    expect(server).toContain("Number(expiration) < Date.now()");
  });

  it("el state se consume con delete().eq(state_hash)...select().single() -- una sola vez", () => {
    const idx = server.indexOf('.from("google_drive_oauth_states")\n    .delete()');
    expect(idx).toBeGreaterThan(-1);
    const block = server.slice(idx, idx + 250);
    expect(block).toContain("state_hash");
    expect(block).toContain(".single()");
  });

  it("scope centralizado en una sola constante, con drive completo (no drive.file)", () => {
    expect(GOOGLE_DRIVE_SCOPES).toContain("https://www.googleapis.com/auth/drive");
    expect(GOOGLE_DRIVE_SCOPES).not.toContain("drive.file");
  });

  it("el callback rechaza si el grant final no incluye el scope Drive requerido", () => {
    expect(server).toContain(
      'grantedScopes.split(" ").includes("https://www.googleapis.com/auth/drive")',
    );
  });

  it("el callback rechaza si Google no entrega refresh_token", () => {
    expect(server).toContain("!tokens.access_token || !tokens.refresh_token");
  });

  it("solo Administrador activo puede iniciar/gestionar la conexión", () => {
    expect(server).toContain('profile.role !== "Administrador"');
    expect(server).toContain('profile.status !== "Activo"');
  });

  it("refresh token se cifra antes de persistir; access_token nunca se persiste", () => {
    expect(server).toContain("encrypted_refresh_token: await encryptToken(tokens.refresh_token)");
    expect(server).not.toMatch(/\baccess_token:\s*tokens\.access_token\b.*insert/s);
  });

  it("googleDriveConnectionStatus nunca devuelve el refresh token cifrado ni ningún secreto", () => {
    const idx = server.indexOf("export async function googleDriveConnectionStatus");
    // Acota al cuerpo de la propia función: el bloque siguiente es el
    // comentario de disconnect, que sí menciona encrypted_refresh_token al
    // explicar que lo destruye.
    const end = server.indexOf("\n// ── disconnect", idx);
    expect(end).toBeGreaterThan(idx);
    const block = server.slice(idx, end);
    expect(block).not.toContain("encrypted_refresh_token");
    expect(block).not.toContain("channel_token_hash");
    expect(block).not.toContain("GOOGLE_DRIVE_CLIENT_SECRET");
  });
});

describe("Fase 8B — aislamiento de Calendar: OAuth client separado, nunca fallback", () => {
  it("google-drive.server.ts nunca lee GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI (los de Calendar)", () => {
    expect(server).not.toMatch(/serverSecret\("GOOGLE_CLIENT_ID"\)/);
    expect(server).not.toMatch(/serverSecret\("GOOGLE_CLIENT_SECRET"\)/);
    expect(server).not.toMatch(/serverSecret\("GOOGLE_OAUTH_REDIRECT_URI"\)/);
  });

  it("usa exclusivamente GOOGLE_DRIVE_CLIENT_ID/SECRET/REDIRECT_URI propios", () => {
    expect(server).toContain('serverSecret("GOOGLE_DRIVE_CLIENT_ID")');
    expect(server).toContain('serverSecret("GOOGLE_DRIVE_CLIENT_SECRET")');
    expect(server).toContain('serverSecret("GOOGLE_DRIVE_REDIRECT_URI")');
  });

  it("disconnectGoogleDrive opera solo sobre el RPC de Drive, nunca sobre nada de Calendar", () => {
    const idx = server.indexOf("export async function disconnectGoogleDrive");
    const end = server.indexOf("\n// ──", idx);
    const block = server.slice(idx, end > -1 ? end : idx + 800);
    expect(block).toContain('db.rpc("disconnect_google_drive_connection")');
    expect(block).not.toContain("google_calendar");
  });

  it("reutiliza GOOGLE_OAUTH_STATE_SECRET y GOOGLE_TOKEN_ENCRYPTION_KEY (secretos genéricos ya existentes, no uno nuevo por servicio)", () => {
    expect(server).toContain('serverSecret("GOOGLE_OAUTH_STATE_SECRET")');
    expect(server).toContain('serverSecret("GOOGLE_TOKEN_ENCRYPTION_KEY")');
  });

  // Fase 8B.1 invirtió esta expectativa: la versión inicial de 8B
  // importaba cuatro helpers de google-calendar.server.ts. Ese
  // acoplamiento se eliminó -- Drive tiene ahora implementaciones propias
  // y equivalentes. La cobertura exhaustiva de independencia vive en
  // tests/google-drive-hardening.test.ts.
  it("NO importa helpers de Calendar: define los suyos (timingSafeEqual, safeServerError, staleness)", () => {
    expect(server).not.toContain('from "@/lib/google-calendar.server"');
    expect(server).toContain("export async function timingSafeEqual");
    expect(server).toContain("export function safeServerError");
    expect(server).toContain("export function isGoogleDriveStaleProcessing");
    expect(server).toContain("export const GOOGLE_DRIVE_STALE_PROCESSING_MS");
  });

  it("validate-production-env.mjs declara las variables de Drive como OPCIONALES, no requeridas", () => {
    const optionalIdx = validateEnv.indexOf("const OPTIONAL = [");
    const requiredBlock = validateEnv.slice(validateEnv.indexOf("const REQUIRED = ["), optionalIdx);
    const optionalBlock = validateEnv.slice(optionalIdx);
    expect(requiredBlock).not.toContain("GOOGLE_DRIVE_CLIENT_ID");
    expect(optionalBlock).toContain("GOOGLE_DRIVE_CLIENT_ID");
    expect(optionalBlock).toContain("GOOGLE_DRIVE_CLIENT_SECRET");
    expect(optionalBlock).toContain("GOOGLE_DRIVE_REDIRECT_URI");
  });

  it(".env.example tiene las 3 variables de Drive sin valores reales", () => {
    expect(envExample).toMatch(/GOOGLE_DRIVE_CLIENT_ID=\s*\n/);
    expect(envExample).toMatch(/GOOGLE_DRIVE_CLIENT_SECRET=\s*\n/);
    expect(envExample).toMatch(/GOOGLE_DRIVE_REDIRECT_URI=\s*\n/);
  });
});

describe("Fase 8B — ningún test depende de Google real ni de internet", () => {
  it("el archivo de servidor no contiene URLs reales de Google fuera de las constantes documentadas", () => {
    const realUrls =
      server.match(
        /https:\/\/(www\.googleapis\.com|accounts\.google\.com|oauth2\.googleapis\.com|openidconnect\.googleapis\.com)[^"'\s]*/g,
      ) ?? [];
    // Las únicas URLs reales permitidas son las constantes de endpoint --
    // este test no hace ninguna petición, solo confirma que las cadenas
    // usadas son las oficiales documentadas por Google, no una URL de test.
    for (const url of realUrls) {
      expect(
        url.startsWith("https://accounts.google.com/o/oauth2/v2/auth") ||
          url.startsWith("https://oauth2.googleapis.com/token") ||
          url.startsWith("https://oauth2.googleapis.com/revoke") ||
          url.startsWith("https://openidconnect.googleapis.com/v1/userinfo") ||
          url.startsWith("https://www.googleapis.com/auth/drive"),
      ).toBe(true);
    }
  });
});

// ── Queue: enqueue/claim/dedupe/stale (estructural, Fase 8B Sección 43) ───
describe("Fase 8B — cola: dedupe, claim, stale (verificación estructural del código)", () => {
  it("enqueueGoogleDriveOperation trata la violación de unicidad (23505) como deduplicación, no como error", () => {
    expect(server).toContain('error.code === "23505"');
    expect(server).toContain("deduplicated: true");
  });

  it("claimGoogleDriveOperations invoca la función RPC atómica, no un SELECT+UPDATE manual", () => {
    expect(server).toContain('db.rpc("claim_google_drive_sync_operations"');
  });

  it("markGoogleDriveOperationCompleted/Failed solo transicionan filas que siguen en 'processing' (evita pisar un claim de otro worker)", () => {
    const completedIdx = server.indexOf("export async function markGoogleDriveOperationCompleted");
    const completedBlock = server.slice(completedIdx, completedIdx + 400);
    expect(completedBlock).toContain('.eq("status", "processing")');

    const failedIdx = server.indexOf("export async function markGoogleDriveOperationFailed");
    const failedBlock = server.slice(failedIdx, failedIdx + 400);
    expect(failedBlock).toContain('.eq("status", "processing")');
  });

  it("requeueStaleGoogleDriveOperations usa claimed_at, nunca created_at, para detectar abandono", () => {
    const idx = server.indexOf("export async function requeueStaleGoogleDriveOperations");
    const block = server.slice(idx, idx + 700);
    expect(block).toContain("claimed_at");
    expect(block).not.toContain("created_at");
    expect(block).toContain("STALE_PROCESSING_MS");
  });

  it("los errores se sanean (truncados) antes de guardarse, nunca la respuesta cruda de Google", () => {
    expect(server).toContain("sanitizedError.slice(0, 500)");
  });
});

// ── appProperties: minimización de datos (Sección 36, diseño puro) ────────
describe("Fase 8B — buildDriveAppProperties: solo IDs internos, nunca datos jurídicos", () => {
  it("incluye exactamente crm_document_id y crm_client_id", () => {
    const result = buildDriveAppProperties("doc-123", "client-456");
    expect(result).toEqual({ crm_document_id: "doc-123", crm_client_id: "client-456" });
  });

  it("no incluye ningún otro campo (nombre, materia, DNI, etc.)", () => {
    const result = buildDriveAppProperties("doc-123", "client-456");
    expect(Object.keys(result).sort()).toEqual(["crm_client_id", "crm_document_id"]);
  });
});

describe("Fase 8B — la migración sigue coherente con lo que el servidor usa por RPC", () => {
  it("el nombre de la función RPC coincide exactamente entre servidor y migración", () => {
    expect(migration).toContain(
      "create or replace function public.claim_google_drive_sync_operations",
    );
  });
});
