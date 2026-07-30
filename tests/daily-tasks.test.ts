import { describe, expect, it } from "vitest";
import {
  canManageTask,
  compareTasks,
  isAvailableTask,
  normalizeTaskPriority,
  normalizeTaskStatus,
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
