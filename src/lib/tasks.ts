import { PERU_UTC_OFFSET, getPeruTodayISO } from "@/lib/peru-time";

export const TASK_STATUSES = [
  "pending",
  "in_progress",
  "ready_to_file",
  "blocked",
  "completed",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "Pendiente",
  in_progress: "En proceso",
  ready_to_file: "Listo para ingresar",
  blocked: "Bloqueado",
  completed: "Terminado",
};

export const TASK_PRIORITIES = ["Baja", "Normal", "Alta", "Urgente"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export type TaskFormValues = {
  title: string;
  description: string;
  assigned_to: string;
  client_id: string;
  case_id: string;
  due_date: string;
  due_time: string;
  is_all_day: boolean;
  status: TaskStatus;
  priority: TaskPriority;
};

export type TaskLike = {
  id: string;
  title: string;
  due_date: string | null;
  is_all_day: boolean;
  priority: string;
  status: string;
  completed_at: string | null;
};

export function normalizeTaskStatus(status: string): TaskStatus {
  if (status === "overdue") return "pending";
  if (status === "cancelled") return "blocked";
  return TASK_STATUSES.includes(status as TaskStatus) ? (status as TaskStatus) : "pending";
}

export function normalizeTaskPriority(priority: string): TaskPriority {
  if (priority === "Media") return "Normal";
  return TASK_PRIORITIES.includes(priority as TaskPriority) ? (priority as TaskPriority) : "Normal";
}

export function buildTaskDueISO(date: string, time: string, isAllDay: boolean) {
  if (!date) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("La fecha de vencimiento no es válida.");
  const safeTime = isAllDay ? "23:59:59" : `${time || "18:00"}:00`;
  const parsed = new Date(`${date}T${safeTime}${PERU_UTC_OFFSET}`);
  if (Number.isNaN(parsed.getTime())) throw new Error("La fecha de vencimiento no es válida.");
  return parsed.toISOString();
}

export function toTaskFormDue(value?: string | null, isAllDay = false) {
  if (!value) return { date: "", time: "" };
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(value)).map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: isAllDay ? "" : `${parts.hour}:${parts.minute}`,
  };
}

export function validateTaskForm(
  values: TaskFormValues,
  cases: Array<{ id: string; client_id: string }>,
) {
  const title = values.title.trim();
  if (title.length < 2) throw new Error("Escribe una tarea de al menos 2 caracteres.");
  if (!values.assigned_to) throw new Error("Selecciona una persona responsable.");

  const relatedCase = values.case_id ? cases.find((item) => item.id === values.case_id) : undefined;
  if (values.case_id && !relatedCase) throw new Error("El expediente seleccionado no existe.");
  if (relatedCase && values.client_id && relatedCase.client_id !== values.client_id) {
    throw new Error("El expediente no corresponde al cliente seleccionado.");
  }

  return {
    title,
    description: values.description.trim() || null,
    assigned_to: values.assigned_to,
    case_id: values.case_id || null,
    client_id: values.case_id ? null : values.client_id || null,
    due_date: buildTaskDueISO(values.due_date, values.due_time, values.is_all_day),
    is_all_day: values.is_all_day,
    status: values.status,
    priority: values.priority,
  };
}

function peruDateISO(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export function classifyTask(
  task: Pick<TaskLike, "due_date" | "status" | "completed_at">,
  selectedDate = getPeruTodayISO(),
  now = new Date(),
) {
  const status = normalizeTaskStatus(task.status);
  if (status === "completed") {
    return task.completed_at && peruDateISO(task.completed_at) === selectedDate
      ? "completed_today"
      : "completed";
  }
  if (!task.due_date) return "unscheduled";
  if (new Date(task.due_date).getTime() < now.getTime()) return "overdue";
  const dueDate = peruDateISO(task.due_date);
  if (dueDate === selectedDate) return "today";
  return dueDate > selectedDate ? "upcoming" : "overdue";
}

const priorityOrder: Record<string, number> = {
  Urgente: 0,
  Alta: 1,
  Normal: 2,
  Media: 2,
  Baja: 3,
};

export function compareTasks(a: TaskLike, b: TaskLike, now = new Date()) {
  const aCompleted = normalizeTaskStatus(a.status) === "completed";
  const bCompleted = normalizeTaskStatus(b.status) === "completed";
  if (aCompleted !== bCompleted) return aCompleted ? 1 : -1;

  const aOverdue = !!a.due_date && new Date(a.due_date) < now && !aCompleted;
  const bOverdue = !!b.due_date && new Date(b.due_date) < now && !bCompleted;
  if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;

  const priority = (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2);
  if (priority !== 0) return priority;

  if (a.is_all_day !== b.is_all_day) return a.is_all_day ? 1 : -1;
  return (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999");
}

export function canManageTask(
  role: string | null | undefined,
  userId: string | null | undefined,
  assignedTo: string | null,
) {
  const isAdmin = role === "Administrador";
  return {
    canCreate: role === "Administrador" || role === "Personal",
    canEditAll: isAdmin,
    canUpdateStatus: isAdmin || (!!userId && assignedTo === userId),
    canReassign: isAdmin,
    canDelete: isAdmin,
  };
}
