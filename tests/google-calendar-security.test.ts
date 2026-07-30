import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const server = readFileSync("src/lib/google-calendar.server.ts", "utf8");
const client = readFileSync("src/lib/google-calendar-client.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260729212000_google_calendar_sync.sql",
  "utf8",
);
const serverEntry = readFileSync("src/server.ts", "utf8");
const workerConfig = readFileSync("wrangler.toml", "utf8");

describe("seguridad de Google Calendar", () => {
  it("mantiene credenciales y OAuth en el servidor", () => {
    expect(server).toContain("GOOGLE_CLIENT_SECRET");
    expect(server).toContain("GOOGLE_TOKEN_ENCRYPTION_KEY");
    expect(server).toContain("AES-GCM");
    expect(server).toContain('code_challenge_method: "S256"');
    expect(server).toContain("GOOGLE_OAUTH_STATE_SECRET");
    expect(server).toContain("if (stateError)");
    expect(server).toContain('requester.role !== "Administrador"');
    expect(server).toContain('requester.status !== "Activo"');
    expect(client).not.toContain("GOOGLE_CLIENT_SECRET");
    expect(client).not.toContain("encrypted_refresh_token");
    expect(client).not.toContain("localStorage");
    expect(client).not.toContain("sessionStorage");
    expect(client).not.toContain("VITE_");
  });

  it("implementa sincronización incremental, resync y tombstones", () => {
    expect(server).toContain('params.set("syncToken", connection.sync_token)');
    expect(server).toContain("response.nextSyncToken");
    expect(server).toContain("status?: number }).status === 410");
    expect(server).toContain('event.status === "cancelled"');
    expect(server).toContain('sync_status: "conflict"');
    expect(migration).toContain("agenda_events_google_identity_idx");
    expect(migration).toContain("deleted_at");
  });

  it("valida el canal y deduplica notificaciones", () => {
    expect(server).toContain('request.headers.get("x-goog-channel-id")');
    expect(server).toContain('request.headers.get("x-goog-resource-id")');
    expect(server).toContain('request.headers.get("x-goog-channel-token")');
    expect(server).toContain("timingSafeEqual");
    expect(migration).toContain("google_calendar_webhook_dedup_idx");
  });

  it("prepara mantenimiento programado y renovación anticipada", () => {
    expect(serverEntry).toContain("scheduled(");
    expect(serverEntry).toContain("runGoogleCalendarScheduledMaintenance");
    expect(workerConfig).toContain("[triggers]");
    expect(workerConfig).toContain("crons =");
    expect(server).toContain("renewalCutoff");
    expect(server).toContain("renewGoogleChannel(connection.id)");
  });

  it("protege tablas de integración con RLS", () => {
    expect(migration).toContain(
      "alter table public.google_calendar_connections enable row level security",
    );
    expect(migration).toContain("google_connections_admin_select");
    expect(migration).toContain(
      "revoke all on public.google_calendar_oauth_states from public, anon, authenticated",
    );
    expect(migration).toContain(
      "revoke all on public.google_calendar_sync_requests from public, anon, authenticated",
    );
  });
});
