import { describe, expect, it } from "vitest";
import {
  canManageTask,
  compareTasks,
  isAvailableTask,
  normalizeTaskPriority,
  normalizeTaskStatus,
  toDatetimeLocalValue,
  validateTaskEditForm,
  validateTaskForm,
  type TaskLike,
} from "@/lib/tasks";

function task(overrides: Partial<TaskLike> = {}): TaskLike {
  return {
    id: "task-1",
    title: "Revisar escrito",
    assigned_to: null,
    priority: "Normal",
    status: "pending",
    created_at: "2026-07-29T10:00:00Z",
    ...overrides,
  };
}

describe("cola voluntaria de tareas", () => {
  it("crea una tarea pendiente y sin responsable", () => {
    expect(
      validateTaskForm(
        {
          title: " Revisar escrito ",
          description: " Antes de presentar ",
          client_id: "client-1",
          case_id: "",
          priority: "Alta",
          scheduled_for: "2026-08-06",
          due_date: "",
        },
        [],
      ),
    ).toEqual({
      title: "Revisar escrito",
      description: "Antes de presentar",
      assigned_to: null,
      case_id: null,
      client_id: "client-1",
      status: "pending",
      priority: "Alta",
      scheduled_for: "2026-08-06",
      due_date: null,
    });
  });

  it("identifica disponibilidad y normaliza valores históricos", () => {
    expect(isAvailableTask(task())).toBe(true);
    expect(isAvailableTask(task({ assigned_to: "user-1" }))).toBe(false);
    expect(normalizeTaskStatus("overdue")).toBe("pending");
    expect(normalizeTaskPriority("Media")).toBe("Normal");
  });

  it("ordena por prioridad y luego por creación", () => {
    const ordered = [
      task({ id: "normal", priority: "Normal" }),
      task({ id: "urgent", priority: "Urgente" }),
    ].sort(compareTasks);
    expect(ordered.map((item) => item.id)).toEqual(["urgent", "normal"]);
  });

  it("aplica permisos de administrador y propietario", () => {
    expect(canManageTask("Administrador", "admin", null)).toMatchObject({
      canCreate: true,
      canReassign: true,
      canDelete: true,
    });
    expect(canManageTask("Personal", "user-1", "user-1")).toMatchObject({
      canCreate: false,
      canUpdateStatus: true,
      canReturn: true,
      canReassign: false,
    });
    expect(canManageTask("Personal", "user-2", "user-1").canUpdateStatus).toBe(false);
  });
});

describe("edición de tareas (validateTaskEditForm)", () => {
  it("valida y normaliza los mismos campos editables que la creación", () => {
    expect(
      validateTaskEditForm(
        {
          title: " Revisar escrito ",
          description: " Antes de presentar ",
          client_id: "client-1",
          case_id: "",
          priority: "Alta",
          scheduled_for: "2026-08-06",
          due_date: "",
        },
        [],
      ),
    ).toEqual({
      title: "Revisar escrito",
      description: "Antes de presentar",
      case_id: null,
      client_id: "client-1",
      priority: "Alta",
      scheduled_for: "2026-08-06",
      due_date: null,
    });
  });

  it("nunca incluye status ni assigned_to en el payload: editar no es tomar/liberar", () => {
    const payload = validateTaskEditForm(
      {
        title: "Tarea existente",
        description: "",
        client_id: "",
        case_id: "",
        priority: "Normal",
        scheduled_for: "2026-08-06",
        due_date: "",
      },
      [],
    );
    expect(payload).not.toHaveProperty("status");
    expect(payload).not.toHaveProperty("assigned_to");
  });

  it("rechaza un expediente que no existe o que no corresponde al cliente", () => {
    expect(() =>
      validateTaskEditForm(
        {
          title: "Tarea",
          description: "",
          client_id: "",
          case_id: "case-x",
          priority: "Normal",
          scheduled_for: "2026-08-06",
          due_date: "",
        },
        [],
      ),
    ).toThrow("El expediente seleccionado no existe.");

    expect(() =>
      validateTaskEditForm(
        {
          title: "Tarea",
          description: "",
          client_id: "client-b",
          case_id: "case-a",
          priority: "Normal",
          scheduled_for: "2026-08-06",
          due_date: "",
        },
        [{ id: "case-a", client_id: "client-a" }],
      ),
    ).toThrow("El expediente no corresponde al cliente seleccionado.");
  });

  it("no altera título/prioridad/fecha cuando el formulario reenvía los mismos valores", () => {
    const original = {
      title: "Notificar a la parte",
      description: "Detalle",
      client_id: "client-1",
      case_id: "",
      priority: "Urgente" as const,
      scheduled_for: "2026-08-10",
      due_date: "",
    };
    expect(validateTaskEditForm(original, [])).toEqual({
      title: original.title,
      description: original.description,
      case_id: null,
      client_id: original.client_id,
      priority: original.priority,
      scheduled_for: original.scheduled_for,
      due_date: null,
    });
  });
});

describe("deep-link de tareas (toDatetimeLocalValue)", () => {
  it("convierte un ISO a formato datetime-local", () => {
    const local = toDatetimeLocalValue("2026-08-20T15:30:00.000Z");
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it("devuelve cadena vacía para null/undefined/valores inválidos", () => {
    expect(toDatetimeLocalValue(null)).toBe("");
    expect(toDatetimeLocalValue(undefined)).toBe("");
    expect(toDatetimeLocalValue("no-es-una-fecha")).toBe("");
  });
});
