import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260824100000_google_drive_sync_foundation.sql",
  "utf8",
);

/**
 * Fase 8B — cobertura estructural de la migración de fundación Drive. No
 * hay Postgres real en `npm test` (entorno Node puro) -- estas pruebas
 * verifican que el mecanismo exacto descrito en el diseño de 8A/8B sigue
 * presente en el archivo que se compromete, igual que
 * last-admin-concurrency.test.ts hace para su propia migración.
 */
describe("Fase 8B — no se aplica remotamente y no toca Calendar/documents/clients", () => {
  it("declara explícitamente que no se aplica remotamente en esta fase", () => {
    expect(migration).toMatch(/NO se aplica remotamente/);
  });

  it("no contiene ningún ALTER TABLE sobre google_calendar_*, agenda_events, documents o clients", () => {
    expect(migration).not.toMatch(/alter table public\.google_calendar_/i);
    expect(migration).not.toMatch(/alter table public\.agenda_events/i);
    expect(migration).not.toMatch(/alter table public\.documents\b/i);
    expect(migration).not.toMatch(/alter table public\.clients\b/i);
  });

  it("las tablas nuevas referencian documents/clients solo por FK, nunca las modifican", () => {
    expect(migration).toContain("references public.clients(id)");
    expect(migration).toContain("references public.documents(id)");
  });
});

describe("Fase 8B — las 6 tablas existen", () => {
  const tables = [
    "google_drive_oauth_states",
    "google_drive_connections",
    "google_drive_client_folders",
    "google_drive_document_files",
    "google_drive_channels",
    "google_drive_sync_queue",
  ];

  for (const table of tables) {
    it(`crea public.${table}`, () => {
      expect(migration).toMatch(new RegExp(`create table if not exists public\\.${table}\\s*\\(`));
    });

    it(`habilita RLS en public.${table}`, () => {
      expect(migration).toMatch(
        new RegExp(`alter table public\\.${table} enable row level security`),
      );
    });

    it(`revoca acceso de public/anon/authenticated en public.${table}`, () => {
      const revokeLine = migration
        .split("\n")
        .find((line) => line.includes(`revoke all on public.${table}`));
      expect(revokeLine).toBeDefined();
      expect(revokeLine).toContain("public, anon, authenticated");
    });
  }

  it("ninguna de las 6 tablas recibe un GRANT a authenticated (postura más estricta que Calendar, a propósito)", () => {
    expect(migration).not.toMatch(/grant .+ on public\.google_drive_.+ to authenticated/i);
  });
});

describe("Fase 8B — identidad canónica de sincronización (no documents.external_file_id)", () => {
  it("documenta explícitamente la corrección de arquitectura de 8A", () => {
    expect(migration).toMatch(/NO se usan/);
    expect(migration).toContain("documents.source_provider/external_file_id/external_folder_id");
  });

  it("no crea una séptima tabla google_drive_sync_state", () => {
    expect(migration).not.toContain("create table if not exists public.google_drive_sync_state");
  });
});

describe("Fase 8B — google_drive_client_folders: unicidad de mapping", () => {
  it("UNIQUE(client_id): un Cliente no puede tener dos carpetas activas", () => {
    expect(migration).toContain(
      "constraint google_drive_client_folders_client_unique unique (client_id)",
    );
  });

  it("UNIQUE(connection_id, drive_folder_id): una carpeta no puede vincularse a dos Clientes en la misma conexión", () => {
    expect(migration).toContain(
      "constraint google_drive_client_folders_folder_unique unique (connection_id, drive_folder_id)",
    );
  });

  it("match_type solo admite los 4 valores sin fuzzy matching", () => {
    const idx = migration.indexOf("check (match_type in (");
    expect(idx).toBeGreaterThan(-1);
    const block = migration.slice(idx, idx + 80);
    expect(block).toContain("'exact', 'normalized', 'manual', 'created'");
  });
});

describe("Fase 8B — google_drive_document_files: identidad canónica + baseline", () => {
  it("UNIQUE(document_id): un documento CRM solo puede mapear a un archivo Drive", () => {
    expect(migration).toContain(
      "constraint google_drive_document_files_document_unique unique (document_id)",
    );
  });

  it("UNIQUE(connection_id, drive_file_id): la misma identidad Drive nunca mapea dos documentos", () => {
    expect(migration).toContain(
      "constraint google_drive_document_files_file_unique unique (connection_id, drive_file_id)",
    );
  });

  it("conserva las columnas de baseline del último sync exitoso (last_synced_*)", () => {
    for (const column of [
      "last_synced_drive_modified_time",
      "last_synced_drive_version",
      "last_synced_drive_md5_checksum",
      "last_synced_content_hash",
      "last_synced_file_name",
      "last_synced_drive_parent_id",
    ]) {
      expect(migration).toContain(column);
    }
  });

  it("sync_status incluye 'missing' (archivo borrado en Drive, documento CRM se conserva) y 'conflict'", () => {
    const idx = migration.indexOf(
      "check (sync_status in ('pending', 'synced', 'missing', 'conflict', 'error'))",
    );
    expect(idx).toBeGreaterThan(-1);
  });
});

describe("Fase 8B — google_drive_sync_queue: operation explícita + dedupe + claim", () => {
  it("operation admite los 7 valores V1, no solo direction", () => {
    const idx = migration.indexOf("operation text not null check (operation in (");
    expect(idx).toBeGreaterThan(-1);
    const block = migration.slice(idx, idx + 300);
    for (const op of [
      "poll_changes",
      "ensure_client_folder",
      "upload_document",
      "update_document",
      "rename_document",
      "trash_document",
      "import_drive_file",
    ]) {
      expect(block).toContain(op);
    }
  });

  it("status admite pending/processing/completed/failed", () => {
    expect(migration).toContain(
      "check (status in ('pending', 'processing', 'completed', 'failed'))",
    );
  });

  it("dedupe_key tiene un índice único parcial sobre pending/processing (no busca-antes-de-insertar)", () => {
    const idx = migration.indexOf(
      "create unique index if not exists google_drive_sync_queue_dedupe_idx",
    );
    expect(idx).toBeGreaterThan(-1);
    const block = migration.slice(idx, idx + 200);
    expect(block).toContain("(dedupe_key)");
    expect(block).toContain("where status in ('pending', 'processing')");
  });

  it("tiene claimed_at y available_at como columnas reales", () => {
    expect(migration).toMatch(/claimed_at timestamptz/);
    expect(migration).toMatch(/available_at timestamptz not null default now\(\)/);
  });

  it("el índice de recuperación de 'processing' abandonado usa claimed_at, nunca created_at", () => {
    const idx = migration.indexOf("google_drive_sync_queue_processing_idx");
    expect(idx).toBeGreaterThan(-1);
    const block = migration.slice(idx, idx + 150);
    expect(block).toContain("(claimed_at)");
    expect(block).not.toContain("(created_at)");
    expect(block).toContain("where status = 'processing'");
  });
});

describe("Fase 8B — claim atómico: SELECT FOR UPDATE SKIP LOCKED + UPDATE + RETURNING", () => {
  const fnBlock = migration.slice(
    migration.indexOf("create or replace function public.claim_google_drive_sync_operations"),
    migration.indexOf(
      "$$;",
      migration.indexOf("create or replace function public.claim_google_drive_sync_operations"),
    ),
  );

  it("la función existe y opera sobre google_drive_sync_queue", () => {
    expect(fnBlock).toContain("update public.google_drive_sync_queue");
  });

  it("usa FOR UPDATE SKIP LOCKED (nunca dos workers reclaman la misma fila)", () => {
    expect(fnBlock.toLowerCase()).toContain("for update skip locked");
  });

  it("filtra por status='pending' y available_at <= now()", () => {
    expect(fnBlock).toContain("status = 'pending'");
    expect(fnBlock).toContain("available_at <= now()");
  });

  it("fija claimed_at = now() e incrementa attempt_count en la misma operación", () => {
    expect(fnBlock).toContain("claimed_at = now()");
    expect(fnBlock).toContain("attempt_count = q.attempt_count + 1");
  });

  it("transiciona a 'processing' y usa RETURNING", () => {
    expect(fnBlock).toContain("status = 'processing'");
    expect(migration).toContain("returning q.*;");
  });

  it("no es SECURITY DEFINER (el único invocador es service_role, que ya tiene privilegios completos)", () => {
    expect(fnBlock).not.toMatch(/security definer/i);
  });

  it("revoca ejecución de public/anon/authenticated y la otorga explícitamente solo a service_role", () => {
    expect(migration).toContain(
      "revoke all on function public.claim_google_drive_sync_operations(integer)\n  from public, anon, authenticated;",
    );
    expect(migration).toContain(
      "grant execute on function public.claim_google_drive_sync_operations(integer)\n  to service_role;",
    );
  });
});

describe("Fase 8B — reutiliza set_updated_at() existente, no redefine la función", () => {
  it("crea triggers para las 5 tablas con updated_at (oauth_states no tiene updated_at, no necesita trigger)", () => {
    const triggerTables = [
      "google_drive_connections",
      "google_drive_client_folders",
      "google_drive_document_files",
      "google_drive_channels",
      "google_drive_sync_queue",
    ];
    for (const table of triggerTables) {
      expect(migration).toContain(`before update on public.${table}`);
    }
  });

  it("no contiene 'create function public.set_updated_at' ni 'create or replace function public.set_updated_at' (reutiliza la existente)", () => {
    expect(migration).not.toMatch(/create (or replace )?function public\.set_updated_at/);
  });
});

describe("Fase 8B — channels: separado de Calendar, un solo canal activo por conexión", () => {
  it("channel_id es UNIQUE y channel_token_hash nunca guarda el token en claro", () => {
    expect(migration).toContain("channel_id text not null unique");
    expect(migration).toContain("channel_token_hash text not null");
    expect(migration).not.toMatch(/channel_token text/);
  });

  it("índice único parcial: un solo canal con stopped_at IS NULL por conexión", () => {
    const idx = migration.indexOf(
      "create unique index if not exists google_drive_channels_one_active_idx",
    );
    expect(idx).toBeGreaterThan(-1);
    const block = migration.slice(idx, idx + 150);
    expect(block).toContain("where stopped_at is null");
  });

  it("no crea, altera ni referencia por FK la tabla google_calendar_channels (solo se la menciona en prosa explicando el aislamiento)", () => {
    expect(migration).not.toMatch(/create table if not exists public\.google_calendar_channels/);
    expect(migration).not.toMatch(/references public\.google_calendar_channels/);
  });
});

describe("Fase 8B — una sola conexión activa (mismo patrón que Calendar)", () => {
  it("índice único parcial sobre status='connected'", () => {
    const idx = migration.indexOf("google_drive_one_active_connection_idx");
    expect(idx).toBeGreaterThan(-1);
    const block = migration.slice(idx, idx + 150);
    expect(block).toContain("where status = 'connected'");
  });

  it("access_token nunca se persiste como columna", () => {
    expect(migration).not.toMatch(/\baccess_token text\b/);
    expect(migration).toContain("access_token_expires_at timestamptz");
  });

  it("shared_drive_id queda reservado (nullable) sin romper nada si no se usa", () => {
    expect(migration).toMatch(/shared_drive_id text,/);
  });
});
