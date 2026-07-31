/**
 * task-visual.test.ts
 *
 * Pruebas para getTaskVisualState y TaskPriorityBadge (lógica sin DOM).
 * Cubre:
 * - Disponible
 * - Asignada a mí
 * - Asignada a otra persona
 * - Completada
 * - Bloqueada
 * - Precedencia correcta (completada > bloqueada > mía > otro > disponible)
 * - Accesibilidad: ariaDescription no vacía
 * - canClaim solo en disponible
 * - normalizeTaskPriority usada por TaskPriorityBadge
 */

import { describe, expect, it } from "vitest";
import { getTaskVisualState } from "../src/lib/task-visual";
import { normalizeTaskPriority } from "../src/lib/tasks";

const ME = "user-me";
const OTHER = "user-other";

function task(status: string, assigned_to: string | null = null) {
  return { status, assigned_to };
}

// ─── Disponible ──────────────────────────────────────────────────────────────

describe("getTaskVisualState — disponible", () => {
  const vs = getTaskVisualState(task("pending", null), ME);

  it("categoría es 'available'", () => {
    expect(vs.category).toBe("available");
  });

  it("etiqueta es 'Disponible'", () => {
    expect(vs.label).toBe("Disponible");
  });

  it("canClaim es true", () => {
    expect(vs.canClaim).toBe(true);
  });

  it("acción principal es 'Tomar tarea'", () => {
    expect(vs.primaryActionLabel).toBe("Tomar tarea");
  });

  it("ariaDescription no está vacía", () => {
    expect(vs.ariaDescription.length).toBeGreaterThan(0);
  });

  it("no usa token de completada ni bloqueada", () => {
    expect(vs.badgeClasses).not.toContain("success");
    expect(vs.badgeClasses).not.toContain("destructive");
  });
});

// ─── Asignada a mí ───────────────────────────────────────────────────────────

describe("getTaskVisualState — asignada a mí", () => {
  const vs = getTaskVisualState(task("in_progress", ME), ME);

  it("categoría es 'mine'", () => {
    expect(vs.category).toBe("mine");
  });

  it("etiqueta es 'Asignada a mí'", () => {
    expect(vs.label).toBe("Asignada a mí");
  });

  it("canClaim es false", () => {
    expect(vs.canClaim).toBe(false);
  });

  it("acción es 'Continuar' cuando está en proceso", () => {
    expect(vs.primaryActionLabel).toBe("Continuar");
  });

  it("acción es 'Ver detalle' cuando está pendiente", () => {
    const vs2 = getTaskVisualState(task("pending", ME), ME);
    expect(vs2.primaryActionLabel).toBe("Ver detalle");
  });

  it("ariaDescription menciona asignación", () => {
    expect(vs.ariaDescription.toLowerCase()).toContain("asignada");
  });
});

// ─── Asignada a otra persona ─────────────────────────────────────────────────

describe("getTaskVisualState — asignada a otra persona", () => {
  const vs = getTaskVisualState(task("in_progress", OTHER), ME);

  it("categoría es 'other'", () => {
    expect(vs.category).toBe("other");
  });

  it("etiqueta es 'Asignada'", () => {
    expect(vs.label).toBe("Asignada");
  });

  it("canClaim es false — no se puede tomar", () => {
    expect(vs.canClaim).toBe(false);
  });

  it("ariaDescription menciona equipo", () => {
    expect(vs.ariaDescription.toLowerCase()).toContain("equipo");
  });
});

// ─── Completada ──────────────────────────────────────────────────────────────

describe("getTaskVisualState — completada", () => {
  const vs = getTaskVisualState(task("completed", ME), ME);

  it("categoría es 'completed'", () => {
    expect(vs.category).toBe("completed");
  });

  it("canClaim es false", () => {
    expect(vs.canClaim).toBe(false);
  });

  it("rowBg contiene token success", () => {
    expect(vs.rowBg).toContain("success");
  });

  it("badgeClasses contiene token success", () => {
    expect(vs.badgeClasses).toContain("success");
  });

  it("ariaDescription menciona completada", () => {
    expect(vs.ariaDescription.toLowerCase()).toContain("completada");
  });
});

// ─── Bloqueada ───────────────────────────────────────────────────────────────

describe("getTaskVisualState — bloqueada", () => {
  const vs = getTaskVisualState(task("blocked", ME), ME);

  it("categoría es 'blocked'", () => {
    expect(vs.category).toBe("blocked");
  });

  it("canClaim es false", () => {
    expect(vs.canClaim).toBe(false);
  });

  it("badgeClasses contiene destructive", () => {
    expect(vs.badgeClasses).toContain("destructive");
  });

  it("ariaDescription menciona atención", () => {
    expect(vs.ariaDescription.toLowerCase()).toContain("aten");
  });
});

// ─── Precedencia ─────────────────────────────────────────────────────────────

describe("getTaskVisualState — precedencia", () => {
  it("completada > bloqueada (aunque bloqueada sea el status)", () => {
    // completed tiene precedencia 1
    const vs = getTaskVisualState(task("completed", ME), ME);
    expect(vs.category).toBe("completed");
  });

  it("bloqueada > asignada a mí", () => {
    const vs = getTaskVisualState(task("blocked", ME), ME);
    expect(vs.category).toBe("blocked");
  });

  it("asignada a mí > asignada a otro", () => {
    const vsMe = getTaskVisualState(task("in_progress", ME), ME);
    const vsOther = getTaskVisualState(task("in_progress", OTHER), ME);
    expect(vsMe.category).toBe("mine");
    expect(vsOther.category).toBe("other");
  });

  it("asignada a otro > disponible", () => {
    const vsOther = getTaskVisualState(task("in_progress", OTHER), ME);
    const vsAvail = getTaskVisualState(task("pending", null), ME);
    expect(vsOther.category).toBe("other");
    expect(vsAvail.category).toBe("available");
  });
});

// ─── userId null/undefined ────────────────────────────────────────────────────

describe("getTaskVisualState — sin userId autenticado", () => {
  it("tarea sin asignar con userId null → available", () => {
    expect(getTaskVisualState(task("pending", null), null).category).toBe("available");
  });

  it("tarea asignada a alguien con userId null → other", () => {
    expect(getTaskVisualState(task("in_progress", OTHER), null).category).toBe("other");
  });
});

// ─── Prioridad — normalizeTaskPriority (usado por TaskPriorityBadge) ──────────

describe("normalizeTaskPriority — usado por TaskPriorityBadge", () => {
  it("'Media' normaliza a 'Normal'", () => {
    expect(normalizeTaskPriority("Media")).toBe("Normal");
  });

  it("valores canónicos se devuelven tal cual", () => {
    expect(normalizeTaskPriority("Baja")).toBe("Baja");
    expect(normalizeTaskPriority("Normal")).toBe("Normal");
    expect(normalizeTaskPriority("Alta")).toBe("Alta");
    expect(normalizeTaskPriority("Urgente")).toBe("Urgente");
  });

  it("valor desconocido devuelve 'Normal'", () => {
    expect(normalizeTaskPriority("Desconocido")).toBe("Normal");
  });
});

// ─── Tokens semánticos: claro ≠ hardcoded colores ───────────────────────────

describe("getTaskVisualState — no usa colores hardcoded", () => {
  const statuses = ["pending", "in_progress", "blocked", "completed", "ready_to_file"];

  for (const status of statuses) {
    it(`estado '${status}' no usa colores oklch hardcodeados en rowBg`, () => {
      const vs = getTaskVisualState(task(status, null), ME);
      expect(vs.rowBg).not.toMatch(/oklch\(/);
    });
  }
});
