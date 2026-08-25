import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GOOGLE_DRIVE_STALE_PROCESSING_MS,
  isGoogleDriveStaleProcessing,
  safeServerError,
  timingSafeEqual,
} from "@/lib/google-drive/google-drive.server";

const read = (path: string) => readFileSync(path, "utf8");
const server = read("src/lib/google-drive/google-drive.server.ts");
const migration = read("supabase/migrations/20260824100000_google_drive_sync_foundation.sql");
const driveDoc = read("server-release/docs/GOOGLE_DRIVE_CONFIGURATION.md");

/** Todos los archivos fuente que componen la integración Drive. */
function driveSourceFiles(): string[] {
  const files: string[] = [];
  const libDir = "src/lib/google-drive";
  for (const entry of readdirSync(libDir)) {
    const full = join(libDir, entry);
    if (statSync(full).isFile() && entry.endsWith(".ts")) files.push(full);
  }
  for (const entry of readdirSync("src/routes")) {
    if (entry.startsWith("api.google-drive.") && entry.endsWith(".ts")) {
      files.push(join("src/routes", entry));
    }
  }
  return files;
}

// ── Sección 9: independencia técnica Drive <-> Calendar ──────────────────
describe("Fase 8B.1 — la integración Drive no importa nada de Calendar", () => {
  const files = driveSourceFiles();

  it("encuentra los archivos de la integración Drive (guard del propio test)", () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
    expect(files).toContain(join("src/lib/google-drive", "google-drive.server.ts"));
  });

  for (const file of files) {
    it(`${file} no importa google-calendar.server / google-calendar-client / use-agenda`, () => {
      const source = readFileSync(file, "utf8");
      // Solo sentencias import/export-from reales -- las menciones en
      // comentarios explicando POR QUÉ no se importa son legítimas.
      const importLines = source
        .split("\n")
        .filter((line) => /^\s*(import|export)\b[^;]*\bfrom\s+["']/.test(line));
      for (const line of importLines) {
        expect(line).not.toMatch(/google-calendar\.server/);
        expect(line).not.toMatch(/google-calendar-client/);
        expect(line).not.toMatch(/use-agenda/);
      }
    });
  }

  it("no queda ningún import dinámico de Calendar dentro de Drive", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/import\(\s*["'][^"']*google-calendar/);
    }
  });
});

// ── Sección 7: helper de staleness propio de Drive ───────────────────────
describe("Fase 8B.1 — isGoogleDriveStaleProcessing: implementación propia, semántica probada", () => {
  it("claimed_at null se trata como NO abandonado (no reclamar por falta de evidencia)", () => {
    expect(isGoogleDriveStaleProcessing(null)).toBe(false);
  });

  it("un claim reciente no está abandonado", () => {
    const now = new Date("2026-08-24T12:00:00Z");
    const claimedAt = new Date(now.getTime() - 60 * 1000).toISOString();
    expect(isGoogleDriveStaleProcessing(claimedAt, now)).toBe(false);
  });

  it("un claim más antiguo que el umbral está abandonado", () => {
    const now = new Date("2026-08-24T12:00:00Z");
    const claimedAt = new Date(
      now.getTime() - GOOGLE_DRIVE_STALE_PROCESSING_MS - 1000,
    ).toISOString();
    expect(isGoogleDriveStaleProcessing(claimedAt, now)).toBe(true);
  });

  it("justo en el umbral todavía no se considera abandonado (estrictamente mayor)", () => {
    const now = new Date("2026-08-24T12:00:00Z");
    const claimedAt = new Date(now.getTime() - GOOGLE_DRIVE_STALE_PROCESSING_MS).toISOString();
    expect(isGoogleDriveStaleProcessing(claimedAt, now)).toBe(false);
  });

  it("requeueStaleGoogleDriveOperations usa el umbral de Drive, no el de Calendar", () => {
    const idx = server.indexOf("export async function requeueStaleGoogleDriveOperations");
    const block = server.slice(idx, idx + 700);
    expect(block).toContain("GOOGLE_DRIVE_STALE_PROCESSING_MS");
    // La constante de Calendar es STALE_PROCESSING_MS "pelada"; el
    // lookbehind evita que GOOGLE_DRIVE_STALE_PROCESSING_MS cuente como
    // coincidencia por ser superstring de aquella.
    expect(block).not.toMatch(/(?<!GOOGLE_DRIVE_)STALE_PROCESSING_MS/);
    expect(block).toContain("claimed_at");
    expect(block).not.toContain("created_at");
  });
});

describe("Fase 8B.1 — timingSafeEqual y safeServerError propios de Drive", () => {
  it("timingSafeEqual: cadenas iguales", async () => {
    expect(await timingSafeEqual("abc123", "abc123")).toBe(true);
  });

  it("timingSafeEqual: cadenas distintas de igual longitud", async () => {
    expect(await timingSafeEqual("abc123", "abc124")).toBe(false);
  });

  it("timingSafeEqual: longitudes distintas", async () => {
    expect(await timingSafeEqual("abc", "abcd")).toBe(false);
  });

  it("safeServerError: permisos -> 403", () => {
    expect(
      safeServerError(new Error("No tienes permiso para administrar esta integración.")).status,
    ).toBe(403);
  });

  it("safeServerError: configuración faltante -> 400", () => {
    expect(
      safeServerError(new Error("Google Drive no está configurado en este servidor.")).status,
    ).toBe(400);
  });

  it("safeServerError: error desconocido -> 500 y mensaje genérico, sin stack", async () => {
    const response = safeServerError({ weird: true });
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Solicitud no válida.");
  });
});

// ── Secciones 2/3/16: disconnect local-only, sin revocación remota ───────
describe("Fase 8B.1 — disconnect: exclusivamente local, nunca revoca contra Google", () => {
  it("el módulo Drive no contiene NINGUNA referencia al endpoint de revoke de Google", () => {
    expect(server).not.toContain("oauth2.googleapis.com/revoke");
    expect(server).not.toContain("GOOGLE_REVOKE_URL");
    expect(server).not.toMatch(/function revokeToken/);
  });

  it("disconnectGoogleDrive no hace ningún fetch: delega en un RPC local", () => {
    const idx = server.indexOf("export async function disconnectGoogleDrive");
    const end = server.indexOf("\n// ──", idx);
    const block = server.slice(idx, end > -1 ? end : idx + 900);
    expect(block).toContain('db.rpc("disconnect_google_drive_connection")');
    expect(block).not.toContain("fetch(");
  });

  it("disconnect es admin-only", () => {
    const idx = server.indexOf("export async function disconnectGoogleDrive");
    const block = server.slice(idx, idx + 400);
    expect(block).toContain("await requireAdmin(request)");
  });

  it("requireAdmin exige rol Administrador y estado Activo (Personal queda rechazado)", () => {
    const idx = server.indexOf("async function requireAdmin");
    const block = server.slice(idx, idx + 700);
    expect(block).toContain('profile.role !== "Administrador"');
    expect(block).toContain('profile.status !== "Activo"');
  });

  it("la función SQL de disconnect destruye el refresh token y marca disconnected, sin borrar la fila", () => {
    const idx = migration.indexOf(
      "create or replace function public.disconnect_google_drive_connection",
    );
    expect(idx).toBeGreaterThan(-1);
    const block = migration.slice(idx, migration.indexOf("$$;", idx));
    expect(block).toContain("status = 'disconnected'");
    expect(block).toContain("encrypted_refresh_token = null");
    expect(block).not.toMatch(/\bdelete\s+from\b/i);
  });

  it("el disconnect SQL no toca Clientes, Documentos ni Calendar", () => {
    const idx = migration.indexOf(
      "create or replace function public.disconnect_google_drive_connection",
    );
    const block = migration.slice(idx, migration.indexOf("$$;", idx));
    expect(block).not.toContain("public.clients");
    expect(block).not.toContain("public.documents");
    expect(block).not.toContain("google_calendar");
  });

  it("accessTokenForDrive rechaza una conexión desconectada o sin token", () => {
    const idx = server.indexOf("async function accessTokenForDrive");
    const block = server.slice(idx, idx + 600);
    expect(block).toContain('connection.status !== "connected"');
    expect(block).toContain("!connection.encrypted_refresh_token");
  });

  it("googleDriveConnectionStatus solo considera conexiones 'connected' -> tras disconnect informa connected:false", () => {
    const idx = server.indexOf("async function activeDriveConnection");
    const block = server.slice(idx, idx + 400);
    expect(block).toContain('.eq("status", "connected")');
  });
});

// ── Sección 4: schema permite destruir el token ──────────────────────────
describe("Fase 8B.1 — schema: encrypted_refresh_token nullable + invariante por estado", () => {
  it("la columna es nullable (permite destruir el ciphertext al desconectar)", () => {
    expect(migration).toMatch(/encrypted_refresh_token text,\s*\n/);
    expect(migration).not.toMatch(/encrypted_refresh_token text not null/);
  });

  it("un CHECK garantiza que 'connected' siempre tiene token y 'disconnected' nunca lo conserva", () => {
    const idx = migration.indexOf("google_drive_connections_token_by_status_check");
    expect(idx).toBeGreaterThan(-1);
    const block = migration.slice(idx, idx + 400);
    expect(block).toContain("status = 'connected' and encrypted_refresh_token is not null");
    expect(block).toContain("status = 'disconnected' and encrypted_refresh_token is null");
  });

  it("se corrigió la MISMA migración de 8B (sin aplicar), sin crear una segunda", () => {
    const driveMigrations = readdirSync("supabase/migrations").filter((file) =>
      file.includes("google_drive"),
    );
    expect(driveMigrations).toEqual(["20260824100000_google_drive_sync_foundation.sql"]);
  });
});

// ── Secciones 15/17: sustitución atómica + reconexión ────────────────────
describe("Fase 8B.1 — callback: sustitución atómica de conexión (concurrencia)", () => {
  it("el callback usa un único RPC transaccional, no SELECT+DELETE+INSERT desde el cliente", () => {
    expect(server).toContain('db.rpc(\n    "replace_google_drive_connection"');
    const callbackIdx = server.indexOf("export async function completeGoogleDriveOAuth");
    const callbackBlock = server.slice(callbackIdx, server.indexOf("\n// ── status", callbackIdx));
    expect(callbackBlock).not.toMatch(
      /\.from\("google_drive_connections"\)[\s\S]{0,80}\.delete\(\)/,
    );
  });

  it("la función SQL desactiva la anterior e inserta la nueva en la misma transacción", () => {
    const idx = migration.indexOf(
      "create or replace function public.replace_google_drive_connection",
    );
    expect(idx).toBeGreaterThan(-1);
    const block = migration.slice(idx, migration.indexOf("$$;", idx));
    expect(block).toContain("update public.google_drive_connections");
    expect(block).toContain("insert into public.google_drive_connections");
    expect(block).toContain("status = 'disconnected'");
  });

  it("la conexión anterior queda sin token utilizable (no hereda ni conserva el antiguo)", () => {
    const idx = migration.indexOf(
      "create or replace function public.replace_google_drive_connection",
    );
    const block = migration.slice(idx, migration.indexOf("$$;", idx));
    expect(block).toContain("encrypted_refresh_token = null");
  });

  it("la anterior NO se borra: queda como rastro auditable", () => {
    const idx = migration.indexOf(
      "create or replace function public.replace_google_drive_connection",
    );
    const block = migration.slice(idx, migration.indexOf("$$;", idx));
    expect(block).not.toMatch(/\bdelete\s+from\b/i);
  });

  it("el índice único parcial sigue garantizando una sola conexión 'connected' tras reconectar", () => {
    const idx = migration.indexOf(
      "create unique index if not exists google_drive_one_active_connection_idx",
    );
    expect(idx).toBeGreaterThan(-1);
    expect(migration.slice(idx, idx + 200)).toContain("where status = 'connected'");
  });

  it("la sustitución tampoco revoca contra Google (mismo riesgo de proyecto compartido)", () => {
    const idx = migration.indexOf(
      "create or replace function public.replace_google_drive_connection",
    );
    const block = migration.slice(idx, migration.indexOf("$$;", idx));
    expect(block).not.toContain("http");
  });
});

// ── Sección 14: binding del Administrador que inició el flujo ────────────
describe("Fase 8B.1 — callback: el solicitante debe seguir siendo Administrador activo", () => {
  it("el state persiste requested_by y el callback lo relee desde profiles", () => {
    expect(migration).toContain("requested_by uuid not null references public.profiles(id)");
    const idx = server.indexOf("export async function completeGoogleDriveOAuth");
    const block = server.slice(idx, server.indexOf("\n// ── status", idx));
    expect(block).toContain('.eq("id", oauthState.requested_by)');
  });

  it("rechaza si el solicitante ya no existe, fue desactivado o dejó de ser Administrador", () => {
    const idx = server.indexOf("export async function completeGoogleDriveOAuth");
    const block = server.slice(idx, server.indexOf("\n// ── status", idx));
    expect(block).toContain("requesterError ||");
    expect(block).toContain("!requester ||");
    expect(block).toContain('requester.status !== "Activo"');
    expect(block).toContain('requester.role !== "Administrador"');
    expect(block).toContain("La persona que inició la autorización ya no tiene permiso.");
  });

  it("esa comprobación ocurre ANTES de persistir la conexión", () => {
    const requesterCheckIdx = server.indexOf(
      "La persona que inició la autorización ya no tiene permiso.",
    );
    const persistIdx = server.indexOf('"replace_google_drive_connection"');
    expect(requesterCheckIdx).toBeGreaterThan(-1);
    expect(persistIdx).toBeGreaterThan(requesterCheckIdx);
  });

  it("el callback no depende de la sesión del navegador: la autoridad viene del state firmado + requested_by", () => {
    const idx = server.indexOf("export async function completeGoogleDriveOAuth");
    const block = server.slice(idx, server.indexOf("\n// ── status", idx));
    // No hay requireAdmin(request) en el callback -- Google redirige al
    // navegador sin la cabecera Authorization del CRM; la autorización se
    // ata criptográficamente al state y se revalida contra profiles.
    expect(block).not.toContain("requireAdmin(request)");
    expect(block).toContain("timingSafeEqual(signature, await hmac(unsignedState))");
  });
});

// ── Secciones 10/11/12/18: grants explícitos ─────────────────────────────
describe("Fase 8B.1 — grants de tablas: revoke explícito + service_role explícito", () => {
  const tables = [
    "google_drive_oauth_states",
    "google_drive_connections",
    "google_drive_client_folders",
    "google_drive_document_files",
    "google_drive_channels",
    "google_drive_sync_queue",
  ];

  for (const table of tables) {
    it(`${table}: revoke explícito de public/anon/authenticated`, () => {
      expect(migration).toContain(
        `revoke all on public.${table} from public, anon, authenticated;`,
      );
    });

    it(`${table}: RLS habilitado`, () => {
      expect(migration).toContain(`alter table public.${table} enable row level security;`);
    });
  }

  it("service_role recibe grant explícito sobre las 6 tablas (una migración incremental no hereda el grant masivo del bootstrap)", () => {
    const idx = migration.indexOf("grant select, insert, update, delete on");
    expect(idx).toBeGreaterThan(-1);
    const block = migration.slice(idx, migration.indexOf("to service_role;", idx) + 20);
    for (const table of tables) {
      expect(block).toContain(`public.${table}`);
    }
  });

  it("la secuencia de la cola también queda restringida y otorgada solo a service_role", () => {
    expect(migration).toContain(
      "grant usage, select on sequence public.google_drive_sync_queue_id_seq to service_role;",
    );
    expect(migration).toContain(
      "revoke all on sequence public.google_drive_sync_queue_id_seq from public, anon, authenticated;",
    );
  });

  it("no se crean policies para authenticated ni para service_role", () => {
    expect(migration).not.toMatch(/create policy[\s\S]{0,200}google_drive/i);
  });
});

describe("Fase 8B.1 — grants de funciones: ninguna queda ejecutable por PUBLIC", () => {
  // Extrae TODAS las funciones creadas por la migración, no solo la de claim.
  const created = [...migration.matchAll(/create or replace function (public\.\w+)\(([^)]*)\)/g)];

  it("la migración crea exactamente las 3 funciones esperadas", () => {
    const names = created.map((match) => match[1]).sort();
    expect(names).toEqual([
      "public.claim_google_drive_sync_operations",
      "public.disconnect_google_drive_connection",
      "public.replace_google_drive_connection",
    ]);
  });

  for (const match of created) {
    const name = match[1];
    it(`${name}: revoke all from public, anon, authenticated`, () => {
      const revokePattern = new RegExp(
        `revoke all on function ${name.replace(".", "\\.")}\\([^)]*\\)\\s*\\n?\\s*from public, anon, authenticated;`,
      );
      expect(migration).toMatch(revokePattern);
    });

    it(`${name}: grant execute únicamente a service_role`, () => {
      const grantPattern = new RegExp(
        `grant execute on function ${name.replace(".", "\\.")}\\([^)]*\\)\\s*\\n?\\s*to service_role;`,
      );
      expect(migration).toMatch(grantPattern);
    });

    it(`${name}: no concede execute a authenticated ni anon`, () => {
      const badGrant = new RegExp(
        `grant execute on function ${name.replace(".", "\\.")}\\([^)]*\\)[\\s\\S]{0,40}to (authenticated|anon)`,
      );
      expect(migration).not.toMatch(badGrant);
    });
  }

  it("ninguna función nueva usa SECURITY DEFINER (no se escala privilegio sin necesidad)", () => {
    const fnBlocks = migration.split("create or replace function").slice(1);
    for (const block of fnBlocks) {
      const signature = block.slice(0, block.indexOf("as $$"));
      expect(signature).not.toMatch(/security definer/i);
    }
  });

  it("todas las funciones fijan search_path explícito y usan referencias calificadas public.*", () => {
    const fnBlocks = migration.split("create or replace function").slice(1);
    for (const block of fnBlocks) {
      const body = block.slice(0, block.indexOf("$$;"));
      expect(body).toContain("set search_path = public");
      expect(body).toMatch(/public\.google_drive_/);
    }
  });
});

// ── Sección 5: documentación del proyecto dedicado ───────────────────────
describe("Fase 8B.1 — documentación: proyecto Google Cloud dedicado para Drive", () => {
  it("documenta que Drive debe usar un proyecto de Google Cloud propio, separado de Calendar", () => {
    expect(driveDoc).toMatch(/proyecto de Google Cloud (propio|NUEVO y dedicado)/i);
    expect(driveDoc).toMatch(
      /no basta con crear un OAuth client distinto dentro del mismo proyecto/i,
    );
  });

  it("explica el motivo técnico: revocar afecta a los grants de todo el proyecto", () => {
    expect(driveDoc).toMatch(/revoca los grants a nivel de \*\*proyecto\*\*/);
  });

  it("documenta que la desconexión es local y no llama a Google", () => {
    expect(driveDoc).toMatch(/no llama a Google/i);
    expect(driveDoc).toContain("destruye");
  });

  it("sigue marcando que Google Cloud Console NO está configurada todavía", () => {
    expect(driveDoc).toContain("GOOGLE CLOUD CONSOLE NO CONFIGURADA TODAVÍA");
  });
});
