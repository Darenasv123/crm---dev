import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DOCUMENT_TYPES, inferDocumentType, normalizeDocumentType } from "@/lib/document-types";
import { shiftIsoDate } from "@/lib/tasks";

describe("tipos documentales centralizados", () => {
  it("normaliza tildes, plural y valores desconocidos", () => {
    expect(normalizeDocumentType("resolucion")).toBe("Resolución");
    expect(normalizeDocumentType("SENTENCIAS")).toBe("Sentencia");
    expect(normalizeDocumentType("PDF")).toBe("Otros");
    expect(new Set(DOCUMENT_TYPES).size).toBe(DOCUMENT_TYPES.length);
  });

  it("infiere el tipo desde rutas importadas", () => {
    expect(inferDocumentType("Cliente/Resoluciones/Resolución 01.pdf")).toBe("Resolución");
    expect(inferDocumentType("Cliente/archivo.pdf")).toBe("Otros");
  });
});

describe("historial diario", () => {
  it("navega por fechas ISO sin alterar la fecha original", () => {
    expect(shiftIsoDate("2026-08-01", -1)).toBe("2026-07-31");
    expect(shiftIsoDate("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("mantiene la normalización en modo simulación por defecto", () => {
    const migration = readFileSync(
      "supabase/migrations/20260806120000_crm_daily_tasks_and_document_integrity.sql",
      "utf8",
    );
    expect(migration).toContain("normalize_document_types(p_apply boolean default false)");
    expect(migration).toContain("scheduled_for");
    expect(migration).toContain("case_task_history");
    expect(migration).toContain("document_change_history");
  });

  it("protege el backfill histórico y reactiva el único trigger suspendido", () => {
    const migration = readFileSync(
      "supabase/migrations/20260806120000_crm_daily_tasks_and_document_integrity.sql",
      "utf8",
    );
    const addColumn = migration.indexOf("add column if not exists scheduled_for date");
    const disableGuard = migration.indexOf("disable trigger case_tasks_20_guard_update");
    const backfill = migration.indexOf("(due_date at time zone 'America/Lima')::date");
    const enableGuard = migration.indexOf("enable trigger case_tasks_20_guard_update");

    expect(addColumn).toBeGreaterThan(-1);
    expect(disableGuard).toBeGreaterThan(addColumn);
    expect(backfill).toBeGreaterThan(disableGuard);
    expect(enableGuard).toBeGreaterThan(backfill);
    expect(migration.match(/disable trigger/gi)).toHaveLength(1);
    expect(migration).not.toContain("drop trigger if exists case_tasks_10_apply_completion");
    expect(migration).toContain("create or replace function public.apply_case_task_completion()");
    expect(migration).toContain("scheduled_for = date '2026-08-05'");
    expect(migration).toContain("status = 'ready_to_file'");
    expect(migration).toContain("tgenabled <> 'O'");
    expect(migration.trim().startsWith("-- Mejoras CRM")).toBe(true);
    expect(migration.trim().endsWith("commit;")).toBe(true);
  });
});

describe("subrutas exclusivas del cliente", () => {
  it("conserva la URL pública sin anidarlas bajo la ficha del cliente", () => {
    const routeTree = readFileSync("src/routeTree.gen.ts", "utf8");

    for (const section of ["documentos", "expedientes", "reportes", "tareas"]) {
      expect(routeTree).toContain(`id: '/clientes/$id_/${section}'`);
      expect(routeTree).toContain(`path: '/clientes/$id/${section}'`);
    }

    expect(routeTree.match(/getParentRoute: \(\) => AppRoute,/g)?.length).toBeGreaterThanOrEqual(4);
    expect(routeTree).not.toContain("getParentRoute: () => AppClientesIdRoute");
  });
});
