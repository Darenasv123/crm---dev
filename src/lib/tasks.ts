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
  client_id: string;
  case_id: string;
  priority: TaskPriority;
  scheduled_for: string;
  due_date: string;
};

export type TaskLike = {
  id: string;
  title: string;
  assigned_to: string | null;
  priority: string;
  status: string;
  created_at: string;
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

export function validateTaskForm(
  values: TaskFormValues,
  cases: Array<{ id: string; client_id: string }>,
) {
  const title = values.title.trim();
  if (title.length < 2) throw new Error("Escribe una tarea de al menos 2 caracteres.");
  const relatedCase = values.case_id ? cases.find((item) => item.id === values.case_id) : undefined;
  if (values.case_id && !relatedCase) throw new Error("El expediente seleccionado no existe.");
  if (relatedCase && values.client_id && relatedCase.client_id !== values.client_id) {
    throw new Error("El expediente no corresponde al cliente seleccionado.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.scheduled_for)) {
    throw new Error("Selecciona una fecha de trabajo válida.");
  }
  if (values.due_date && Number.isNaN(Date.parse(values.due_date))) {
    throw new Error("La fecha de vencimiento no es válida.");
  }
  return {
    title,
    description: values.description.trim() || null,
    assigned_to: null,
    case_id: values.case_id || null,
    client_id: (relatedCase?.client_id ?? values.client_id) || null,
    status: "pending" as const,
    priority: values.priority,
    scheduled_for: values.scheduled_for,
    due_date: values.due_date ? new Date(values.due_date).toISOString() : null,
  };
}

export function limaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function shiftIsoDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

const priorityOrder: Record<string, number> = {
  Urgente: 0,
  Alta: 1,
  Normal: 2,
  Media: 2,
  Baja: 3,
};

export function compareTasks(a: TaskLike, b: TaskLike) {
  const aCompleted = normalizeTaskStatus(a.status) === "completed";
  const bCompleted = normalizeTaskStatus(b.status) === "completed";
  if (aCompleted !== bCompleted) return aCompleted ? 1 : -1;
  const priority = (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2);
  if (priority !== 0) return priority;
  return b.created_at.localeCompare(a.created_at);
}

export function isAvailableTask(task: Pick<TaskLike, "assigned_to" | "status">) {
  return task.assigned_to === null && normalizeTaskStatus(task.status) === "pending";
}

export function canManageTask(
  role: string | null | undefined,
  userId: string | null | undefined,
  assignedTo: string | null,
) {
  const isAdmin = role === "Administrador";
  const ownsTask = !!userId && assignedTo === userId;
  return {
    canCreate: isAdmin,
    canEditAll: isAdmin,
    canUpdateStatus: isAdmin || ownsTask,
    canReassign: isAdmin,
    canDelete: isAdmin,
    canReturn: ownsTask,
  };
}
