import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  countActiveTaskFilters,
  type TaskAdvancedFilters,
} from "@/components/tasks/task-filter-utils";
import {
  buildTaskDueISO,
  canManageTask,
  classifyTask,
  compareTasks,
  normalizeTaskPriority,
  normalizeTaskStatus,
  toTaskFormDue,
  validateTaskForm,
  type TaskFormValues,
  type TaskLike,
} from "@/lib/tasks";

const assigneeId = "11111111-1111-4111-8111-111111111111";
const caseId = "22222222-2222-4222-8222-222222222222";
const clientId = "33333333-3333-4333-8333-333333333333";

function values(overrides: Partial<TaskFormValues> = {}): TaskFormValues {
  return {
    title: "Preparar escrito",
    description: "Revisar anexos",
    assigned_to: assigneeId,
    client_id: clientId,
    case_id: caseId,
    due_date: "2026-07-29",
    due_time: "09:30",
    is_all_day: false,
    status: "pending",
    priority: "Normal",
    ...overrides,
  };
}

function task(overrides: Partial<TaskLike> = {}): TaskLike {
  return {
    id: crypto.randomUUID(),
    title: "Tarea",
    due_date: "2026-07-29T14:30:00.000Z",
    is_all_day: false,
    priority: "Normal",
    status: "pending",
    completed_at: null,
    ...overrides,
  };
}

describe("contrato temporal de tareas", () => {
  it("convierte una hora de Lima a UTC", () => {
    expect(buildTaskDueISO("2026-07-29", "09:30", false)).toBe("2026-07-29T14:30:00.000Z");
  });

  it("representa una tarea de día completo al final del día de Lima", () => {
    expect(buildTaskDueISO("2026-07-29", "", true)).toBe("2026-07-30T04:59:59.000Z");
  });

  it("mantiene ida y vuelta de fecha y hora en America/Lima", () => {
    expect(toTaskFormDue("2026-07-29T14:30:00.000Z", false)).toEqual({
      date: "2026-07-29",
      time: "09:30",
    });
  });

  it("permite tareas sin vencimiento", () => {
    expect(buildTaskDueISO("", "", false)).toBeNull();
  });

  it("rechaza fechas inválidas", () => {
    expect(() => buildTaskDueISO("29/07/2026", "09:30", false)).toThrow("fecha de vencimiento");
  });
});

describe("validación del formulario", () => {
  it("conserva el expediente como fuente de la relación con cliente", () => {
    const payload = validateTaskForm(values(), [{ id: caseId, client_id: clientId }]);
    expect(payload.case_id).toBe(caseId);
    expect(payload.client_id).toBeNull();
  });

  it("guarda el cliente directamente cuando no hay expediente", () => {
    const payload = validateTaskForm(values({ case_id: "" }), []);
    expect(payload.case_id).toBeNull();
    expect(payload.client_id).toBe(clientId);
  });

  it("rechaza una relación incoherente entre cliente y expediente", () => {
    expect(() =>
      validateTaskForm(values(), [
        { id: caseId, client_id: "44444444-4444-4444-8444-444444444444" },
      ]),
    ).toThrow("no corresponde");
  });

  it("exige título y responsable", () => {
    expect(() => validateTaskForm(values({ title: " " }), [])).toThrow("tarea");
    expect(() => validateTaskForm(values({ assigned_to: "" }), [])).toThrow("responsable");
  });
});

describe("clasificación, compatibilidad y orden", () => {
  const now = new Date("2026-07-29T17:00:00.000Z");

  it("clasifica tareas atrasadas, del día y próximas", () => {
    expect(classifyTask(task({ due_date: "2026-07-29T15:00:00.000Z" }), "2026-07-29", now)).toBe(
      "overdue",
    );
    expect(classifyTask(task({ due_date: "2026-07-29T20:00:00.000Z" }), "2026-07-29", now)).toBe(
      "today",
    );
    expect(classifyTask(task({ due_date: "2026-07-30T15:00:00.000Z" }), "2026-07-29", now)).toBe(
      "upcoming",
    );
  });

  it("separa terminadas hoy de terminadas históricas", () => {
    expect(
      classifyTask(
        task({
          status: "completed",
          completed_at: "2026-07-29T19:00:00.000Z",
        }),
        "2026-07-29",
        now,
      ),
    ).toBe("completed_today");
    expect(
      classifyTask(
        task({
          status: "completed",
          completed_at: "2026-07-28T19:00:00.000Z",
        }),
        "2026-07-29",
        now,
      ),
    ).toBe("completed");
  });

  it("normaliza valores heredados sin reescribir datos", () => {
    expect(normalizeTaskPriority("Media")).toBe("Normal");
    expect(normalizeTaskStatus("overdue")).toBe("pending");
    expect(normalizeTaskStatus("cancelled")).toBe("blocked");
  });

  it("ordena atrasadas antes que urgentes futuras y terminadas", () => {
    const rows = [
      task({ id: "done", status: "completed" }),
      task({ id: "urgent", priority: "Urgente", due_date: "2026-07-30T15:00:00.000Z" }),
      task({ id: "late", priority: "Baja", due_date: "2026-07-29T15:00:00.000Z" }),
    ].sort((left, right) => compareTasks(left, right, now));
    expect(rows.map((row) => row.id)).toEqual(["late", "urgent", "done"]);
  });
});

describe("permisos operativos", () => {
  it("permite control completo al administrador", () => {
    expect(canManageTask("Administrador", assigneeId, null)).toEqual({
      canCreate: true,
      canEditAll: true,
      canUpdateStatus: true,
      canReassign: true,
      canDelete: true,
    });
  });

  it("limita a Personal al estado de sus propias tareas", () => {
    expect(canManageTask("Personal", assigneeId, assigneeId)).toMatchObject({
      canCreate: true,
      canEditAll: false,
      canUpdateStatus: true,
      canReassign: false,
      canDelete: false,
    });
    expect(
      canManageTask("Personal", assigneeId, "55555555-5555-4555-8555-555555555555").canUpdateStatus,
    ).toBe(false);
  });
});

describe("contrato SQL de la migración", () => {
  const sql = readFileSync(
    resolve("supabase/migrations/20260729130000_daily_task_center.sql"),
    "utf8",
  );

  it("no crea daily_tasks ni copia tareas a agenda_events", () => {
    expect(sql).not.toMatch(/create\s+table\s+(?:public\.)?daily_tasks/i);
    expect(sql).not.toMatch(/insert\s+into\s+public\.agenda_events/i);
  });

  it("aplica índices, coherencia, auditoría y políticas por rol", () => {
    expect(sql).toContain("case_tasks_due_date_idx");
    expect(sql).toContain("validate_case_task_relationship");
    expect(sql).toContain("apply_case_task_completion");
    expect(sql).toContain("guard_case_task_update");
    expect(sql).toContain("public.is_admin()");
    expect(sql).toContain("assigned_to = auth.uid()");
  });
});

describe("contratos de integración de la interfaz", () => {
  const hook = readFileSync(resolve("src/hooks/use-daily-tasks.ts"), "utf8");
  const center = readFileSync(resolve("src/components/tasks/task-center.tsx"), "utf8");
  const form = readFileSync(resolve("src/components/tasks/task-form-sheet.tsx"), "utf8");
  const views = readFileSync(resolve("src/components/tasks/task-views.tsx"), "utf8");
  const agenda = readFileSync(resolve("src/routes/_app.agenda.index.tsx"), "utf8");
  const dashboard = readFileSync(resolve("src/routes/_app.index.tsx"), "utf8");

  it("filtra en servidor por responsable y estado con límites explícitos", () => {
    expect(hook).toContain('.eq("assigned_to", filters.assignedTo)');
    expect(hook).toContain('.eq("status", filters.status)');
    expect(hook).toContain(".limit(");
    expect(hook).toContain("clientCaseIds");
  });

  it("implementa actualización optimista y rollback", () => {
    expect(hook).toContain("onMutate:");
    expect(hook).toContain("setQueriesData<DailyTask[]>");
    expect(hook).toContain("onError:");
    expect(hook).toContain("queryClient.setQueryData(key, data)");
  });

  it("expone estados de carga, vacío y error", () => {
    expect(center).toContain("TaskSkeleton");
    expect(center).toContain("No hay tareas en esta vista");
    expect(center).toContain("<TaskError");
  });

  it("ofrece formulario y panel accesibles", () => {
    expect(form).toContain("<Sheet");
    expect(form).toContain("<SheetDescription>");
    expect(form).toContain('role="alert"');
    expect(views).toContain("export function TaskDetailSheet");
    expect(views).toContain("aria-label={`Estado de");
  });

  it("incluye tabla de escritorio, tarjetas móviles y tablero", () => {
    expect(views).toContain("hidden rounded-xl border border-border xl:block");
    expect(views).toContain("table-fixed");
    expect(views).toContain("xl:hidden");
    expect(views).toContain("lg:grid-cols-5");
  });

  it("compone calendario y tareas sin una mutación de agenda", () => {
    expect(agenda).toContain('view: "calendar"');
    expect(agenda).toContain("tasksByDay");
    expect(agenda).toContain("useAgendaEvents");
    expect(hook).not.toContain('.from("agenda_events")');
  });

  it("incorpora el widget de tareas del dashboard", () => {
    expect(dashboard).toContain("Tareas de hoy");
    expect(dashboard).toContain("useTodayTaskSummary");
    expect(dashboard).toContain("overdueTaskCount");
  });
});

describe("filtros unificados", () => {
  const empty: TaskAdvancedFilters = {
    assignee: "",
    status: "",
    priority: "",
    clientId: "",
    caseId: "",
    overdueOnly: false,
    showCompleted: true,
    withoutClient: false,
    withoutCase: false,
  };

  it("no cuenta los valores predeterminados de Mi día", () => {
    expect(countActiveTaskFilters(empty, true)).toBe(0);
  });

  it("cuenta filtros combinados y la métrica activa", () => {
    expect(
      countActiveTaskFilters(
        {
          ...empty,
          status: "blocked",
          priority: "Urgente",
          withoutCase: true,
        },
        true,
        "overdue",
      ),
    ).toBe(4);
  });

  it("cuenta el cambio de visibilidad de terminadas respecto de la vista", () => {
    expect(countActiveTaskFilters({ ...empty, showCompleted: false }, true)).toBe(1);
    expect(countActiveTaskFilters({ ...empty, showCompleted: true }, false)).toBe(1);
  });
});
