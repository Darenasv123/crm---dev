import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260729211000_task_claim_workflow.sql",
  "utf8",
);

describe("migración de toma atómica de tareas", () => {
  it("bloquea la fila y actualiza sólo si continúa disponible", () => {
    expect(migration).toContain("for update");
    expect(migration).toContain("and assigned_to is null");
    expect(migration).toContain("and status = 'pending'");
    expect(migration).toContain("claimed_at = now()");
    expect(migration).toContain("claimed_by = auth.uid()");
    expect(migration).toContain("status = 'in_progress'");
  });

  it("devuelve un conflicto comprensible", () => {
    expect(migration).toContain("Esta tarea acaba de ser tomada por otro integrante.");
  });

  it("restringe RPC y creación", () => {
    expect(migration).toContain(
      "revoke execute on function public.claim_case_task(uuid) from public, anon",
    );
    expect(migration).toContain("public.is_admin()");
    expect(migration).toContain("and assigned_to is null");
    expect(migration).toContain("and status = 'pending'");
  });

  it("permite devolución propia y conserva auditoría operativa", () => {
    expect(migration).toContain("and assigned_to = auth.uid()");
    expect(migration).toContain("Tarea devuelta:");
    expect(migration).toContain("La tarea volvió a Disponibles.");
    expect(migration).toContain("insert into public.case_events");
  });
});
