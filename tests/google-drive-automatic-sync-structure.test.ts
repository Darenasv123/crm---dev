import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Fase 8F — garantías estructurales de la sincronización automática:
 * migración incremental (grants/atomicidad/invariantes), separación de
 * responsabilidades, ausencia de comportamiento no pedido (auto-resolve,
 * hard-delete, reasignación de Cliente, inferencia de expediente,
 * exportación de Workspace), y que el webhook nunca dependa de la sesión
 * de Administrador ni del secreto de mantenimiento.
 */

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260826100000_google_drive_automatic_sync.sql");
const sync = read("src/lib/google-drive/drive-sync.server.ts");
const changes = read("src/lib/google-drive/drive-changes.ts");
const files = read("src/lib/google-drive/drive-files.ts");
const storage = read("src/lib/google-drive/drive-storage.server.ts");
const webhookRoute = read("src/routes/api.google-drive.webhook.ts");
const maintenanceRoute = read("src/routes/api.google-drive.maintenance.ts");
const doc = read("server-release/docs/GOOGLE_DRIVE_CONFIGURATION.md");

// ── migración ────────────────────────────────────────────────────────────
describe("Fase 8F — migración incremental", () => {
  it("no crea ni elimina ninguna tabla: solo ALTER TABLE/columnas/índices y funciones nuevas", () => {
    expect(migration).not.toMatch(/create table/i);
    expect(migration).not.toMatch(/drop table/i);
  });

  it("las columnas nuevas de google_drive_connections existen y tienen comentario documentando su propósito", () => {
    for (const column of [
      "changes_initialized_at",
      "last_changes_polled_at",
      "last_reconciled_at",
      "reconciliation_claimed_at",
    ]) {
      expect(migration).toContain(column);
      expect(migration).toContain(`comment on column public.google_drive_connections.${column}`);
    }
  });

  it("amplía el CHECK de sync_status de google_drive_client_folders para admitir conflict/missing", () => {
    expect(migration).toContain(
      "check (sync_status in ('pending', 'synced', 'missing', 'conflict', 'error'))",
    );
  });

  it("google_drive_channels: superseded_at nuevo, el índice único pasa a basarse en él (no en stopped_at)", () => {
    expect(migration).toContain("add column if not exists superseded_at");
    expect(migration).toContain("drop index if exists public.google_drive_channels_one_active_idx");
    expect(migration).toMatch(
      /create unique index[\s\S]{0,60}google_drive_channels_one_current_idx/,
    );
    expect(migration).toContain("where superseded_at is null");
  });

  it("crea exactamente las 6 funciones nuevas, todas server-only, sin SECURITY DEFINER y con search_path fijo", () => {
    const functionNames = [
      "initialize_google_drive_change_token",
      "advance_google_drive_change_token",
      "claim_google_drive_reconciliation",
      "complete_google_drive_reconciliation",
      "rotate_google_drive_channel",
      "repair_google_drive_document_mapping",
    ];
    for (const name of functionNames) {
      expect(migration).toContain(`create or replace function public.${name}`);
      expect(migration).toMatch(
        new RegExp(
          `revoke all on function public\\.${name}[\\s\\S]{0,300}from public, anon, authenticated;`,
        ),
      );
      expect(migration).toMatch(
        new RegExp(`grant execute on function public\\.${name}[\\s\\S]{0,300}to service_role;`),
      );
    }
    expect(migration).not.toMatch(/security definer/i);
    // 6 funciones nuevas -> 6 apariciones de "set search_path = public".
    expect(migration.match(/set search_path = public/g)?.length).toBe(6);
  });

  it("initialize/advance/claim/rotate/repair serializan sobre la conexión (FOR UPDATE)", () => {
    const lockCount =
      migration.match(/where id = p_connection_id\s*\n\s*for update;/g)?.length ?? 0;
    expect(lockCount).toBeGreaterThanOrEqual(5); // complete_* no necesita lock (solo limpia el claim)
  });

  it("advance_google_drive_change_token es un CAS real: compara con IS DISTINCT FROM antes de escribir", () => {
    const start = migration.indexOf("function public.advance_google_drive_change_token");
    const body = migration.slice(start, migration.indexOf("$$;", start));
    expect(body).toContain("is distinct from p_expected_current_token");
    expect(body).toContain("DRIVE_CHANGE_TOKEN_CHANGED_RETRY");
  });

  it("rotate_google_drive_channel supersede el viejo ANTES de insertar el nuevo, en la misma transacción", () => {
    const start = migration.indexOf("function public.rotate_google_drive_channel");
    const body = migration.slice(start, migration.indexOf("$$;", start));
    const supersedeIdx = body.indexOf("superseded_at = now()");
    const insertIdx = body.indexOf("insert into public.google_drive_channels");
    expect(supersedeIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(supersedeIdx);
  });

  it("rotate_google_drive_channel nunca llama a Google (channels.stop vive en TypeScript)", () => {
    const start = migration.indexOf("function public.rotate_google_drive_channel");
    const body = migration.slice(start, migration.indexOf("$$;", start));
    expect(body).not.toMatch(/http|googleapis/i);
  });

  it("repair_google_drive_document_mapping nunca inserta en documents -- solo en google_drive_document_files", () => {
    const start = migration.indexOf("function public.repair_google_drive_document_mapping");
    const body = migration.slice(start, migration.indexOf("$$;", start));
    expect(body).not.toMatch(/insert into public\.documents/);
    expect(body).toContain("insert into public.google_drive_document_files");
    expect(body).toContain("DOCUMENT_NOT_FOUND");
    expect(body).toContain("DOCUMENT_CLIENT_MISMATCH");
    expect(body).toContain("DOCUMENT_ALREADY_MAPPED");
  });

  it("no llama a Google ni a Storage desde PostgreSQL", () => {
    // "llamada HTTP" sí aparece como texto -- es la propia documentación de
    // por qué channels.stop NO ocurre aquí; se busca una URL/host real, no
    // la prosa que explica esta misma garantía.
    expect(migration).not.toMatch(/googleapis\.com/i);
    expect(migration).not.toMatch(/storage\.(upload|download|from|remove)/i);
  });
});

// ── separación de responsabilidades (change feed aislado) ────────────────
describe("Fase 8F — drive-changes.ts: módulo puro, sin Supabase ni sesión", () => {
  it("no importa Supabase ni auth-server", () => {
    expect(changes).not.toMatch(/@supabase\/supabase-js/);
    expect(changes).not.toContain("auth-server");
  });

  it("minimiza campos: nunca owners/permissions completas en las consultas de change feed", () => {
    expect(changes).not.toMatch(/DRIVE_CHANGE_FILE_FIELDS[\s\S]{0,200}owners/);
    expect(changes).not.toMatch(/DRIVE_CHANGE_FILE_FIELDS[\s\S]{0,200}permissions/);
  });

  it("Fase 8F.1 Sección 3: getGoogleDriveStartPageToken usa su propio builder de params, NUNCA scopeParams (ese añade includeItemsFromAllDrives, inexistente en este endpoint)", () => {
    const start = changes.indexOf("export async function getGoogleDriveStartPageToken");
    const body = changes.slice(start, changes.indexOf("\n}", start) + 2);
    expect(body).toContain("startPageTokenParams");
    expect(body).not.toContain("scopeParams(");
  });

  it("Fase 8F.1: startPageTokenParams nunca añade includeItemsFromAllDrives, ni siquiera con Unidad compartida", () => {
    const start = changes.indexOf("function startPageTokenParams");
    const body = changes.slice(start, changes.indexOf("\n}", start) + 2);
    expect(body).not.toContain("includeItemsFromAllDrives");
  });

  it("channels.watch envía type=web_hook, token, address y expiration; nunca guarda el token en claro", () => {
    expect(changes).toContain('type: "web_hook"');
    expect(changes).toContain("hashGoogleDriveChannelToken");
    const start = changes.indexOf("export async function watchGoogleDriveChanges");
    const body = changes.slice(start, changes.indexOf("\n}", start) + 2);
    expect(body).not.toMatch(/channel_token_hash/); // el hash se calcula fuera, aquí solo se envía el plano a Google
  });

  it("nunca excede el máximo real de Google para la duración del watch (7 días)", async () => {
    const { GOOGLE_DRIVE_WATCH_MAX_DURATION_MS } = await import("@/lib/google-drive/drive-changes");
    const value = GOOGLE_DRIVE_WATCH_MAX_DURATION_MS;
    expect(value).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);
  });

  it("la búsqueda de archivos gestionados usa appProperties privadas, nunca el nombre del archivo", () => {
    const start = changes.indexOf("export async function searchGoogleDriveManagedFiles");
    const body = changes.slice(start, changes.indexOf("\n}", start) + 2);
    expect(body).toContain("appProperties has");
    expect(body).not.toMatch(/name\s*contains/i);
  });

  it("toda paginación (changes list de reconciliación) tiene un tope defensivo de páginas", () => {
    expect(changes).toContain("MAX_DRIVE_RECONCILIATION_PAGES");
  });
});

// ── webhook: sin sesión de Administrador ni secreto de mantenimiento ─────
describe("Fase 8F — webhook: modelo de confianza propio, nunca mezclado con maintenance", () => {
  it("la ruta del webhook nunca usa GOOGLE_DRIVE_MAINTENANCE_SECRET ni requireAdmin/requireActiveActor", () => {
    expect(webhookRoute).not.toContain("GOOGLE_DRIVE_MAINTENANCE_SECRET");
    expect(webhookRoute).not.toContain("requireAdmin");
    expect(webhookRoute).not.toContain("requireActiveActor");
    expect(webhookRoute).not.toContain("x-maintenance-secret");
  });

  it("nunca llama a Google directamente desde la ruta", () => {
    expect(webhookRoute).not.toMatch(/googleapis\.com/);
  });

  it("ignora el body de la petición: solo lee cabeceras X-Goog-*", () => {
    expect(webhookRoute).not.toMatch(/request\.(json|text|formData)\(\)/);
    for (const header of [
      "x-goog-channel-id",
      "x-goog-channel-token",
      "x-goog-resource-id",
      "x-goog-resource-state",
    ]) {
      expect(webhookRoute).toContain(header);
    }
  });

  it("valida el token del canal en tiempo constante (reutiliza timingSafeEqual, no === )", () => {
    const start = sync.indexOf("export async function handleGoogleDriveWebhookNotification");
    const body = sync.slice(start, sync.indexOf("\n// ── reconciliación", start));
    expect(body).toContain("timingSafeEqual(providedHash");
    expect(body).not.toMatch(/providedHash\s*===\s*channel\.channel_token_hash/);
  });

  it("solo resourceState='change' encola poll_changes -- 'sync' y cualquier estado desconocido se ignoran", () => {
    const start = sync.indexOf("export async function handleGoogleDriveWebhookNotification");
    const body = sync.slice(start, sync.indexOf("\n// ── reconciliación", start));
    expect(body).toMatch(/resourceState === "change"/);
    expect(body).toContain("enqueueGoogleDrivePollChanges");
  });
});

// ── mantenimiento: orquestador único ──────────────────────────────────────
describe("Fase 8F — mantenimiento: sigue autenticado por secreto dedicado, nunca por sesión", () => {
  it("la ruta de mantenimiento sigue exigiendo el secreto dedicado en tiempo constante", () => {
    expect(maintenanceRoute).toContain("GOOGLE_DRIVE_MAINTENANCE_SECRET");
    expect(maintenanceRoute).toContain("timingSafeEqual");
    expect(maintenanceRoute).toContain("status: 503");
  });

  it("delega toda la orquestación en runGoogleDriveMaintenance, no llama a Google desde la ruta", () => {
    expect(maintenanceRoute).toContain("runGoogleDriveMaintenance");
    expect(maintenanceRoute).not.toMatch(/googleapis\.com/);
  });

  it("runGoogleDriveMaintenance es best-effort entre pasos: un fallo de watch nunca impide procesar la cola", () => {
    const start = sync.indexOf("export async function runGoogleDriveMaintenance");
    const body = sync.slice(start, sync.indexOf("\n// Se re-exporta", start));
    expect(body).toMatch(/try\s*\{\s*await ensureGoogleDriveWatch/);
    expect(body).toContain("processGoogleDriveSyncQueue()");
  });
});

// ── auditoría negativa: nada fuera de alcance ─────────────────────────────
describe("Fase 8F — auditoría negativa", () => {
  it("nunca usa files.export en ninguno de los módulos tocados", () => {
    for (const source of [sync, changes, files, storage]) {
      expect(source).not.toMatch(/\/files\/\$\{[^}]+\}\/export/);
      expect(source).not.toContain('"/export?"');
    }
  });

  it("nunca reasigna client_id ni case_id automáticamente en respuesta a un cambio de Drive", () => {
    const start = sync.indexOf("async function processDriveChangeEntry");
    const end = sync.indexOf("async function handlePollGoogleDriveChanges", start);
    const body = sync.slice(start, end);
    expect(body).not.toMatch(/client_id:\s*\w+Id/); // ningún update escribe un nuevo client_id calculado
    expect(body).not.toContain("case_id");
  });

  it("nunca hace hard-delete ni auto-trash de un huérfano detectado", () => {
    const start = sync.indexOf("export async function runGoogleDriveReconciliation");
    const body = sync.slice(start, sync.indexOf("\n// ── procesador", start));
    expect(body).not.toContain("trashDriveFile");
    expect(body).not.toMatch(/files\.delete|\.delete\(\)/);
  });

  it("no existe ninguna UI de resolución automática de conflictos (use CRM/use Drive/merge)", () => {
    expect(sync).not.toMatch(/use[_-]?crm|use[_-]?drive|auto[_-]?resolve/i);
  });

  it("no crea una tabla de conflictos separada: reutiliza sync_status/sync_error existentes", () => {
    expect(migration).not.toMatch(/create table[\s\S]{0,40}conflict/i);
  });

  it("Calendar y Agenda: 0 cambios en esta fase", () => {
    for (const source of [migration, sync, changes]) {
      expect(source).not.toMatch(/google_calendar|agenda_events/i);
    }
  });

  it("el webhook de Calendar (ruta y lógica) permanece intacto y separado", () => {
    const calendarWebhook = read("src/routes/api.google-calendar.webhook.ts");
    expect(calendarWebhook).not.toContain("handleGoogleDriveWebhookNotification");
    expect(webhookRoute).not.toContain("google-calendar");
  });
});

// ── documentación ──────────────────────────────────────────────────────────
describe("Fase 8F — documentación operativa actualizada", () => {
  it("documenta la arquitectura de sincronización automática", () => {
    expect(doc).toMatch(/watch/i);
    expect(doc).toMatch(/reconciliaci[oó]n/i);
    expect(doc).toContain("GOOGLE_DRIVE_WEBHOOK_URL");
  });

  it("aclara que el polling periódico es la durabilidad real y el watch solo optimiza latencia", () => {
    expect(doc).toMatch(/durabilidad/i);
    expect(doc).toMatch(/latencia/i);
  });

  it("documenta que el CRM nunca se borra por una eliminación en Drive y que Drive nunca reasigna Cliente", () => {
    expect(doc).toMatch(/nunca (se )?(borra|elimina)/i);
    expect(doc).toMatch(/nunca se reasigna/i);
  });
});
