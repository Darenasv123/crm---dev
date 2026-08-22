import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  eventStart,
  googleEventPayload,
  isStaleProcessing,
  shouldFlagSyncConflict,
  STALE_PROCESSING_MS,
} from "@/lib/google-calendar.server";

const read = (path: string) => readFileSync(path, "utf8");
const server = read("src/lib/google-calendar.server.ts");
const useAgenda = read("src/hooks/use-agenda.ts");
const agendaRoute = read("src/routes/_app.agenda.index.tsx");
const maintenanceRoute = read("src/routes/api.google-calendar.maintenance.ts");
const validateEnv = read("scripts/validate-production-env.mjs");

// ── CRM → Google: identidad e idempotencia ──────────────────────────────────

describe("CRM → Google: payload y propagación de campos", () => {
  const baseEvent = {
    id: "evt-1",
    title: "Audiencia inicial",
    type: "Audiencia",
    event_date: "2026-09-01",
    event_time: "10:30",
    location: "Sala 3",
  };

  it("propaga título, ubicación, fecha/hora de inicio y fin", () => {
    const payload = googleEventPayload(baseEvent);
    expect(payload.summary).toBe("Audiencia inicial");
    expect(payload.location).toBe("Sala 3");
    expect(payload.start.dateTime).toContain("2026-09-01T10:30:00");
    expect(payload.end.dateTime).toBeTruthy();
    expect(new Date(payload.end.dateTime).getTime()).toBeGreaterThan(
      new Date(payload.start.dateTime).getTime(),
    );
  });

  it("incluye la identidad estable crmEventId — nunca título/fecha como identificador", () => {
    const payload = googleEventPayload(baseEvent);
    expect(payload.extendedProperties.private.crmEventId).toBe("evt-1");
    expect(payload.extendedProperties.private.syncOrigin).toBe("crm");
  });

  it("es determinista/idempotente: mismos datos de entrada producen el mismo payload", () => {
    const first = googleEventPayload(baseEvent);
    const second = googleEventPayload({ ...baseEvent });
    expect(first).toEqual(second);
  });

  it("omite location cuando el evento no tiene lugar", () => {
    const payload = googleEventPayload({ ...baseEvent, location: null });
    expect(payload.location).toBeUndefined();
  });

  it("editar (mismo google_event_id) usa PATCH; crear usa POST — reutiliza el ID existente", () => {
    expect(server).toContain('method: event.google_event_id ? "PATCH" : "POST"');
  });

  it("eliminar respeta el soft-delete existente (deleted_at) y es idempotente si ya no hay google_event_id", () => {
    expect(server).toContain("if (event.deleted_at && event.google_event_id)");
    expect(server).toContain('method: "DELETE"');
  });
});

// ── Google → CRM: conversión de fecha/hora ──────────────────────────────────

describe("Google → CRM: eventStart", () => {
  it("convierte un dateTime de Google a fecha/hora Lima", () => {
    const result = eventStart({ id: "g1", start: { dateTime: "2026-09-01T15:30:00Z" } });
    expect(result.event_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.event_time).toMatch(/^\d{2}:\d{2}$/);
  });

  it("un evento de día completo (solo date) usa 09:00 por defecto", () => {
    expect(eventStart({ id: "g2", start: { date: "2026-09-01" } })).toEqual({
      event_date: "2026-09-01",
      event_time: "09:00",
    });
  });

  it("un evento sin start no rompe: cae a la fecha actual con hora por defecto", () => {
    const result = eventStart({ id: "g3" });
    expect(result.event_time).toBe("09:00");
    expect(result.event_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ── Identidad y anti-duplicación ─────────────────────────────────────────────

describe("identidad estable y anti-duplicación", () => {
  it("el lookup local usa (google_calendar_id, google_event_id), nunca título/fecha", () => {
    expect(server).toContain('.eq("google_calendar_id", connection.calendar_id)');
    expect(server).toContain('.eq("google_event_id", event.id)');
  });

  it("existe un unique index en BD como segunda capa anti-duplicados", () => {
    const migration = read("supabase/migrations/20260729212000_google_calendar_sync.sql");
    expect(migration).toContain("agenda_events_google_identity_idx");
    expect(migration).toContain("on public.agenda_events (google_calendar_id, google_event_id)");
  });

  it("el webhook deduplica por (channel_id, message_number) antes de encolar", () => {
    expect(server).toContain('onConflict: "channel_id,message_number", ignoreDuplicates: true');
  });
});

// ── Conflictos: política determinista, no last-write-wins ciego ────────────

describe("resolución de conflictos (shouldFlagSyncConflict)", () => {
  it("ninguna modificación local pendiente → Google puede sobreescribir sin conflicto", () => {
    expect(
      shouldFlagSyncConflict(
        { sync_status: "synced", updated_at: "2026-09-01T00:00:00Z" },
        { updated: "2026-09-02T00:00:00Z" },
      ),
    ).toBe(false);
  });

  it("solo Google cambió (local no pending) → sin conflicto, se aplica Google", () => {
    expect(
      shouldFlagSyncConflict(
        { sync_status: null, updated_at: "2026-09-01T00:00:00Z" },
        { updated: "2026-09-05T00:00:00Z" },
      ),
    ).toBe(false);
  });

  it("solo CRM cambió (local pending, más reciente que Google) → conflicto", () => {
    expect(
      shouldFlagSyncConflict(
        { sync_status: "pending", updated_at: "2026-09-05T00:00:00Z" },
        { updated: "2026-09-01T00:00:00Z" },
      ),
    ).toBe(true);
  });

  it("ambos cambiaron pero Google es más reciente que el pending local → sin conflicto (se aplica Google)", () => {
    expect(
      shouldFlagSyncConflict(
        { sync_status: "pending", updated_at: "2026-09-01T00:00:00Z" },
        { updated: "2026-09-05T00:00:00Z" },
      ),
    ).toBe(false);
  });

  it("mismo timestamp exacto (mismo evento/etag efectivo) → sin conflicto", () => {
    expect(
      shouldFlagSyncConflict(
        { sync_status: "pending", updated_at: "2026-09-01T00:00:00.000Z" },
        { updated: "2026-09-01T00:00:00.000Z" },
      ),
    ).toBe(false);
  });

  it("sin registro local (evento nuevo) → nunca es conflicto, es creación", () => {
    expect(shouldFlagSyncConflict(null, { updated: "2026-09-01T00:00:00Z" })).toBe(false);
  });

  it("la resolución manual está gated a Administrador", () => {
    expect(server).toContain('const { db } = await requireRole(request, ["Administrador"]);');
  });
});

// ── Prevención de loops ──────────────────────────────────────────────────────

describe("prevención de loops CRM↔Google", () => {
  it("el webhook nunca trae el evento completo: solo dispara un poll incremental por syncToken", () => {
    // Google Calendar API no incluye el recurso en la notificación webhook;
    // el modelo real es "algo cambió" → poll con syncToken, no "esto cambió".
    expect(server).toContain("acceptGoogleWebhook");
    expect(server).not.toMatch(/acceptGoogleWebhook[\s\S]{0,400}request\.json\(\)/);
    expect(server).toContain('params.set("syncToken", connection.sync_token)');
  });

  it("un push CRM→Google reutiliza el mismo google_event_id (PATCH), no genera un segundo evento", () => {
    expect(server).toContain("google_event_id: googleEvent.id");
  });
});

// ── Cola / reintentos ─────────────────────────────────────────────────────────

describe("cola de sincronización: reclamo de jobs abandonados (claimed_at, no created_at)", () => {
  it("un job creado hace 30 min pero reclamado ahora NO es stale (escenario del hardening)", () => {
    // created_at = hace 30 minutos (por encima del umbral de 15 min), pero
    // claimed_at = ahora mismo — el job recién empezó a procesarse. Si se
    // usara created_at como proxy, esto se marcaría stale incorrectamente
    // y un segundo worker podría reclamarlo de nuevo (doble procesamiento).
    const now = new Date("2026-09-01T12:30:00Z");
    const claimedJustNow = now.toISOString();
    expect(isStaleProcessing(claimedJustNow, now)).toBe(false);
  });

  it("un job cuyo claim real sí supera el umbral SÍ se recupera", () => {
    const now = new Date("2026-09-01T12:30:00Z");
    const claimedLongAgo = new Date(now.getTime() - (STALE_PROCESSING_MS + 1000)).toISOString();
    expect(isStaleProcessing(claimedLongAgo, now)).toBe(true);
  });

  it("respeta el límite exacto del umbral en ambas direcciones", () => {
    const now = new Date("2026-09-01T12:00:00Z");
    const justUnderThreshold = new Date(now.getTime() - (STALE_PROCESSING_MS - 1000)).toISOString();
    const overThreshold = new Date(now.getTime() - (STALE_PROCESSING_MS + 1000)).toISOString();
    expect(isStaleProcessing(justUnderThreshold, now)).toBe(false);
    expect(isStaleProcessing(overThreshold, now)).toBe(true);
  });

  it("claimed_at null (fila sin claim aún) nunca se considera stale", () => {
    expect(isStaleProcessing(null)).toBe(false);
  });

  it("el esquema real de google_calendar_sync_requests no tenía ningún timestamp de claim", () => {
    const originalMigration = read("supabase/migrations/20260729212000_google_calendar_sync.sql");
    const claimMigration = read(
      "supabase/migrations/20260822090000_google_calendar_sync_queue_claim.sql",
    );
    // Aísla la definición de la tabla (hasta el ");" que la cierra) para no
    // confundirla con `updated_at` de OTRAS tablas del mismo archivo
    // (agenda_events, google_calendar_connections sí lo tienen).
    const tableDefinition = originalMigration.slice(
      originalMigration.indexOf("create table if not exists public.google_calendar_sync_requests"),
      originalMigration.indexOf(
        "create unique index if not exists google_calendar_webhook_dedup_idx",
      ),
    );
    expect(tableDefinition).not.toContain("updated_at");
    expect(tableDefinition).not.toContain("claimed_at");
    expect(tableDefinition).not.toContain("processing_started_at");
    expect(tableDefinition).toContain("created_at");
    expect(tableDefinition).toContain("processed_at");
    expect(claimMigration).toContain(
      "alter table public.google_calendar_sync_requests\n  add column if not exists claimed_at timestamptz;",
    );
  });

  it(
    "caso de upgrade: filas 'processing' preexistentes se backfillean una sola vez con " +
      "created_at, para no quedar irrecuperables — sin reintroducir created_at como regla general",
    () => {
      const claimMigration = read(
        "supabase/migrations/20260822090000_google_calendar_sync_queue_claim.sql",
      );
      expect(claimMigration).toContain(
        "update public.google_calendar_sync_requests\n   set claimed_at = created_at\n" +
          " where status = 'processing'\n   and claimed_at is null;",
      );
      // El backfill ocurre ANTES de crear el índice de reclamo, y el ADD
      // COLUMN ocurre antes del backfill (orden correcto de la migración).
      const addColumnIdx = claimMigration.indexOf("add column if not exists claimed_at");
      const backfillIdx = claimMigration.indexOf("set claimed_at = created_at");
      const indexIdx = claimMigration.indexOf("google_calendar_sync_requests_processing_idx");
      expect(addColumnIdx).toBeGreaterThan(-1);
      expect(backfillIdx).toBeGreaterThan(addColumnIdx);
      expect(indexIdx).toBeGreaterThan(backfillIdx);
      // El backfill es una acción puntual de la migración, no una regla
      // permanente: la lógica de producción (google-calendar.server.ts)
      // sigue sin usar created_at para decidir staleness.
      expect(server).not.toMatch(/isStaleProcessing\([^)]*created_at/);
    },
  );

  it("el reclamo de abandonados filtra por claimed_at, nunca por created_at", () => {
    expect(server).toContain('.eq("status", "processing")\n    .lt("claimed_at", staleCutoff);');
    expect(server).not.toMatch(/status", "processing"\)[\s\S]{0,80}created_at/);
  });

  it("el claim de cada job fija claimed_at en el mismo UPDATE condicional que evita doble procesamiento", () => {
    expect(server).toContain(
      '.update({ status: "processing", claimed_at: new Date().toISOString() })',
    );
    expect(server).toContain(
      '.eq("status", "pending")\n      .select("id")\n      .maybeSingle();',
    );
  });

  it("al reclamar un abandonado se limpia claimed_at (no queda un timestamp obsoleto)", () => {
    expect(server).toContain('.update({ status: "pending", claimed_at: null })');
  });

  it("un job fallido registra el error y no queda silencioso", () => {
    expect(server).toContain('status: "failed"');
    expect(server).toContain("error_message:");
  });
});

describe("renovación de canal: dos ejecuciones de mantenimiento casi simultáneas", () => {
  it("la cola ya era segura por claim optimista por fila (sin cambios, se preserva)", () => {
    // Dos llamadas concurrentes a processGoogleSyncQueue() compiten por el
    // mismo UPDATE condicional; solo una gana por fila, la otra recibe
    // maybeSingle() null y continúa — no hay doble procesamiento posible.
    expect(server).toContain("if (!claimed) continue;");
  });

  it("la renovación de canal NO era segura: se añadió un claim optimista sobre la conexión", () => {
    expect(server).toContain("renewal_claimed_at");
    expect(server).toContain("RENEWAL_CLAIM_DEBOUNCE_MS");
    expect(server).toContain(
      ".or(`renewal_claimed_at.is.null,renewal_claimed_at.lt.${claimCutoff}`)",
    );
  });

  it("si el claim de renovación falla (otra ejecución ya lo tomó), se abstiene en vez de renovar igual", () => {
    expect(server).toContain("if (!claimedConnection) {");
    expect(server).toMatch(/if \(!claimedConnection\) \{[\s\S]{0,150}renewed: false/);
  });

  it("la migración añade renewal_claimed_at junto con claimed_at, en el mismo archivo no aplicado", () => {
    const claimMigration = read(
      "supabase/migrations/20260822090000_google_calendar_sync_queue_claim.sql",
    );
    expect(claimMigration).toContain(
      "alter table public.google_calendar_connections\n  add column if not exists renewal_claimed_at timestamptz;",
    );
  });
});

// ── Mantenimiento programado (hallazgo: no corre en el target Node) ────────

describe("mantenimiento programado — target Node/Virtualmin", () => {
  it("el trigger de Cloudflare (scheduled()) se conserva intacto", () => {
    const serverEntry = read("src/server.ts");
    expect(serverEntry).toContain("scheduled(");
    expect(serverEntry).toContain("runGoogleCalendarScheduledMaintenance");
  });

  it("existe un endpoint HTTP equivalente para el target Node, gated por secreto server-only", () => {
    expect(maintenanceRoute).toContain("runGoogleCalendarScheduledMaintenance");
    expect(maintenanceRoute).toContain("GOOGLE_CALENDAR_MAINTENANCE_SECRET");
    expect(maintenanceRoute).toContain("timingSafeEqual");
    expect(maintenanceRoute).not.toContain("requireRole");
  });

  it("sin secreto configurado, el endpoint se niega en vez de ejecutar sin autenticación", () => {
    expect(maintenanceRoute).toContain("if (!configuredSecret)");
    expect(maintenanceRoute).toContain("status: 503");
  });

  it("un secreto incorrecto o ausente se rechaza con 401, nunca ejecuta el mantenimiento", () => {
    expect(maintenanceRoute).toMatch(/!providedSecret \|\| !\(await timingSafeEqual/);
    expect(maintenanceRoute).toContain("status: 401");
  });

  it("solo expone un handler POST — GET (o cualquier otro método) no está definido", () => {
    expect(maintenanceRoute).toMatch(/handlers:\s*\{\s*POST:/);
    expect(maintenanceRoute).not.toMatch(/\bGET:\s*async/);
  });

  it("el secreto se lee de un header, nunca de query string ni body", () => {
    expect(maintenanceRoute).toContain('request.headers.get("x-maintenance-secret")');
    expect(maintenanceRoute).not.toContain("searchParams");
    expect(maintenanceRoute).not.toContain("request.json()");
  });

  it("nunca imprime ni devuelve el secreto — ni el configurado ni el recibido", () => {
    expect(maintenanceRoute).not.toMatch(/console\.(log|error|warn)/);
    // Las únicas dos respuestas del endpoint son fijas (mensajes literales)
    // o el resultado de runGoogleCalendarScheduledMaintenance(): ninguna
    // interpola configuredSecret/providedSecret en un cuerpo de respuesta.
    expect(maintenanceRoute).toContain(
      '{ error: "Mantenimiento programado no configurado en este servidor." }',
    );
    expect(maintenanceRoute).toContain('{ error: "No autorizado." }');
    expect(maintenanceRoute).not.toContain("configuredSecret}");
    expect(maintenanceRoute).not.toContain("providedSecret}");
    expect(maintenanceRoute).not.toContain("${configuredSecret");
    expect(maintenanceRoute).not.toContain("${providedSecret");
  });

  it("no depende de una sesión de usuario: no usa requireRole/bearerToken/Supabase auth", () => {
    expect(maintenanceRoute).not.toContain("requireUser");
    expect(maintenanceRoute).not.toContain("bearerToken");
    expect(maintenanceRoute).not.toContain("getAuthClient");
  });

  it(
    "la variable es requerida en la validación de entorno de producción (Google Calendar ya es " +
      "una integración obligatoria en este release, igual que sus otras variables GOOGLE_*)",
    () => {
      expect(validateEnv).toMatch(/REQUIRED = \[[\s\S]*GOOGLE_CALENDAR_MAINTENANCE_SECRET/);
      expect(validateEnv).not.toMatch(/OPTIONAL = \[[\s\S]*GOOGLE_CALENDAR_MAINTENANCE_SECRET/);
    },
  );

  it("la documentación operativa del target Node explica el endpoint y no sugiere token de sesión en cron", () => {
    const doc = read("server-release/docs/GOOGLE_CALENDAR_CONFIGURATION.md");
    expect(doc).toContain("/api/google-calendar/maintenance");
    expect(doc).toContain("X-Maintenance-Secret");
    expect(doc).not.toContain("TOKEN_ADMIN");
  });
});

// ── Permisos: el gap real de "Reintentar" ───────────────────────────────────

describe("permisos de sincronización manual (Reintentar)", () => {
  it("authorizeAgendaSync ahora exige Administrador — antes aceptaba Personal", () => {
    expect(server).toContain('await requireRole(request, ["Administrador"]);');
    expect(server).not.toContain('await requireRole(request, ["Administrador", "Personal"]);');
  });

  it("el botón Reintentar en la UI está gated por el mismo permiso que editar", () => {
    expect(agendaRoute).toContain("canRetry: boolean");
    expect(agendaRoute).toContain('event.sync_status === "error" && canRetry');
    expect(agendaRoute).toContain("canRetry={canEditEvents}");
  });

  it("la resolución de conflictos sigue exclusiva de Administrador (sin cambios)", () => {
    expect(agendaRoute).toContain('event.sync_status === "conflict" && isAdmin');
  });

  it("useRetryAgendaSync ya no ignora el error de la actualización previa al push", () => {
    expect(useAgenda).toContain("if (error) throw new Error(error.message);");
  });
});

// ── Relaciones Cliente / Expediente ──────────────────────────────────────────

describe("relaciones Cliente/Expediente", () => {
  it("un evento importado de Google nunca asigna cliente/expediente automáticamente", () => {
    // applyGoogleEvent construye `values` sin client_id/case_id: la relación
    // solo existe si ya existía en la fila local (evento editado, no creado).
    expect(server).not.toMatch(/values = \{[\s\S]{0,20}client_id/);
  });

  it("la ficha de cliente/expediente sigue una sola fuente: agenda_events, sin tablas duplicadas", () => {
    const useAgendaHook = useAgenda;
    expect(useAgendaHook).toContain('.from("agenda_events")');
    expect(useAgendaHook).not.toMatch(/from\("client_events"\)|from\("case_events_agenda"\)/);
  });
});
