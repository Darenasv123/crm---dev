/**
 * schema-check.test.ts
 *
 * Pruebas de checkMigrationSchemaAvailable():
 * Verifica que cada tipo de error SQL produce el mensaje correcto
 * y que un error 42501 (permisos) NO se confunde con tabla inexistente.
 *
 * 100% local — sin conexión a Supabase remoto.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Tipos de error simulados ─────────────────────────────────────────────────

type SupabaseError = { code?: string; message: string };

let folderError: SupabaseError | null = null;
let docError: SupabaseError | null = null;
let sessionError: boolean = false;

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn() } },
  getAuthClient: vi.fn(async () => buildDbMock()),
}));

function buildDbMock() {
  return {
    auth: {
      getSession: vi
        .fn()
        .mockResolvedValue(
          sessionError
            ? { data: { session: null }, error: { message: "Session expired" } }
            : { data: { session: { user: { id: "u1" }, access_token: "tok" } }, error: null },
        ),
    },
    from: (table: string) => ({
      select: () => ({
        limit: () => ({
          then: (resolve: (v: unknown) => void) => {
            if (table === "document_folders") {
              return resolve({ data: null, error: folderError });
            }
            if (table === "documents") {
              return resolve({ data: null, error: docError });
            }
            return resolve({ data: null, error: null });
          },
        }),
      }),
    }),
  };
}

beforeEach(() => {
  folderError = null;
  docError = null;
  sessionError = false;
});

import { checkMigrationSchemaAvailable } from "@/lib/migrate-relative-paths";

// ─────────────────────────────────────────────────────────────────────────────

describe("checkMigrationSchemaAvailable — clasificación de errores", () => {
  // ── Esquema disponible ────────────────────────────────────────────────────

  it("retorna null cuando el esquema está completo", async () => {
    folderError = null;
    docError = null;
    expect(await checkMigrationSchemaAvailable()).toBeNull();
  });

  // ── Tabla inexistente (42P01) ─────────────────────────────────────────────

  it("detecta tabla inexistente con code 42P01", async () => {
    folderError = { code: "42P01", message: 'relation "public.document_folders" does not exist' };
    const result = await checkMigrationSchemaAvailable();
    expect(result).not.toBeNull();
    expect(result).toContain("migración");
    expect(result).not.toContain("permisos");
  });

  it("detecta tabla inexistente con code PGRST200", async () => {
    folderError = { code: "PGRST200", message: "undefined_table document_folders" };
    const result = await checkMigrationSchemaAvailable();
    expect(result).not.toBeNull();
    expect(result).toContain("migración");
  });

  it("detecta tabla inexistente por mensaje 'does not exist'", async () => {
    folderError = { message: 'relation "document_folders" does not exist' };
    const result = await checkMigrationSchemaAvailable();
    expect(result).not.toBeNull();
    expect(result).toContain("migración");
  });

  // ── Permiso denegado (42501) — NO debe confundirse con tabla ausente ──────

  it("detecta permiso denegado con code 42501 — NO lo clasifica como tabla inexistente", async () => {
    folderError = { code: "42501", message: "permission denied for table document_folders" };
    const result = await checkMigrationSchemaAvailable();
    expect(result).not.toBeNull();
    expect(result).toContain("permisos");
    // Crítico: no debe decir que la migración no fue aplicada
    expect(result).not.toContain("no ha sido aplicada");
    expect(result).not.toContain("Ejecuta supabase/migrations");
  });

  it("detecta permiso denegado por mensaje 'permission denied'", async () => {
    folderError = { message: "permission denied" };
    const result = await checkMigrationSchemaAvailable();
    expect(result).not.toBeNull();
    expect(result).toContain("permisos");
    expect(result).not.toContain("no ha sido aplicada");
  });

  it("detecta insufficient privilege — NO lo clasifica como tabla inexistente", async () => {
    folderError = { code: "42501", message: "insufficient privilege to access document_folders" };
    const result = await checkMigrationSchemaAvailable();
    expect(result).not.toBeNull();
    expect(result).toContain("permisos");
    expect(result).not.toContain("no ha sido aplicada");
  });

  // ── Columna inexistente (42703) ───────────────────────────────────────────

  it("detecta columna folder_id inexistente con code 42703", async () => {
    folderError = null; // tabla existe
    docError = { code: "42703", message: 'column "folder_id" does not exist' };
    const result = await checkMigrationSchemaAvailable();
    expect(result).not.toBeNull();
    expect(result?.toLowerCase()).toContain("folder_id");
  });

  it("detecta columna inexistente por mensaje", async () => {
    docError = { message: "column folder_id does not exist" };
    const result = await checkMigrationSchemaAvailable();
    expect(result).not.toBeNull();
    // Debe distinguir columna ausente de tabla ausente
    expect(result).not.toContain("no ha sido aplicada");
    // Debe mencionar folder_id
    expect(result?.toLowerCase()).toContain("folder_id");
  });

  // ── Sesión vencida ────────────────────────────────────────────────────────

  it("detecta sesión vencida cuando auth.getSession falla", async () => {
    sessionError = true;
    const result = await checkMigrationSchemaAvailable();
    expect(result).not.toBeNull();
    expect(result?.toLowerCase()).toMatch(/sesión|session|venció/);
  });

  it("detecta sesión vencida por error PGRST301", async () => {
    folderError = { code: "PGRST301", message: "JWT expired" };
    const result = await checkMigrationSchemaAvailable();
    expect(result).not.toBeNull();
    expect(result?.toLowerCase()).toMatch(/sesión|venció|recarga/);
  });

  // ── Error desconocido ─────────────────────────────────────────────────────

  it("retorna mensaje genérico para error desconocido", async () => {
    folderError = { code: "99999", message: "Unexpected server error" };
    const result = await checkMigrationSchemaAvailable();
    expect(result).not.toBeNull();
    expect(typeof result).toBe("string");
  });
});
