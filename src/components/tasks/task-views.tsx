import { Link } from "@tanstack/react-router";
import {
  AlertCircle,
  Ban,
  CalendarClock,
  CheckCircle2,
  Circle,
  Clock3,
  ExternalLink,
  History,
  Pencil,
  Trash2,
  UserRound,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { DailyTask } from "@/hooks/use-daily-tasks";
import { formatPeruDate, formatPeruDateTime } from "@/lib/peru-time";
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  canManageTask,
  normalizeTaskPriority,
  normalizeTaskStatus,
  type TaskStatus,
} from "@/lib/tasks";

const statusStyles: Record<TaskStatus, string> = {
  pending: "border-slate-200 bg-slate-50 text-slate-700",
  in_progress: "border-sky-200 bg-sky-50 text-sky-700",
  ready_to_file: "border-violet-200 bg-violet-50 text-violet-700",
  blocked: "border-red-200 bg-red-50 text-red-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

function StatusIcon({ status }: { status: TaskStatus }) {
  if (status === "completed") return <CheckCircle2 className="h-3.5 w-3.5" />;
  if (status === "blocked") return <Ban className="h-3.5 w-3.5" />;
  if (status === "in_progress") return <Clock3 className="h-3.5 w-3.5" />;
  if (status === "ready_to_file") return <ExternalLink className="h-3.5 w-3.5" />;
  return <Circle className="h-3.5 w-3.5" />;
}

export function TaskStatusChip({ status: rawStatus }: { status: string }) {
  const status = normalizeTaskStatus(rawStatus);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold ${statusStyles[status]}`}
    >
      <StatusIcon status={status} />
      {TASK_STATUS_LABELS[status]}
    </span>
  );
}

function taskClient(task: DailyTask) {
  return task.cases?.clients ?? task.clients;
}

function taskCaseNumber(task: DailyTask) {
  return task.cases?.case_number || task.cases?.expediente || null;
}

function DueLabel({ task }: { task: DailyTask }) {
  if (!task.due_date) return <span className="text-muted-foreground">Sin fecha</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <CalendarClock className="h-3.5 w-3.5" />
      {task.is_all_day
        ? formatPeruDate(task.due_date, { day: "2-digit", month: "short", year: "numeric" })
        : formatPeruDateTime(task.due_date, {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
    </span>
  );
}

export function TaskList({
  tasks,
  role,
  userId,
  onOpen,
  onEdit,
  onStatus,
  onDelete,
}: {
  tasks: DailyTask[];
  role?: string | null;
  userId?: string | null;
  onOpen: (task: DailyTask) => void;
  onEdit: (task: DailyTask) => void;
  onStatus: (task: DailyTask, status: TaskStatus) => void;
  onDelete: (task: DailyTask) => void;
}) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-xl border border-border md:block">
        <table className="w-full table-fixed border-collapse text-left text-sm">
          <thead className="sticky top-14 z-10 bg-muted/95 text-[11px] uppercase tracking-wide text-muted-foreground backdrop-blur">
            <tr>
              {[
                "N.°",
                "Responsable",
                "Cliente",
                "N.° de expediente",
                "Tarea",
                "Vencimiento",
                "Estado",
                "Observaciones",
                "Acciones",
              ].map((label) => (
                <th
                  key={label}
                  className={`border-b border-border px-2 py-2.5 font-semibold ${
                    label === "Observaciones"
                      ? "hidden xl:table-cell"
                      : label === "Tarea"
                        ? "w-[25%]"
                        : ""
                  }`}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tasks.map((task, index) => {
              const permissions = canManageTask(role, userId, task.assigned_to);
              const client = taskClient(task);
              return (
                <tr
                  key={task.id}
                  className={`border-b border-border/70 last:border-0 ${
                    normalizeTaskPriority(task.priority) === "Urgente"
                      ? "border-l-2 border-l-red-500"
                      : "border-l-2 border-l-transparent"
                  }`}
                >
                  <td className="px-2 py-2.5 font-mono text-xs text-muted-foreground">
                    {index + 1}
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="truncate font-medium">
                      {task.assignee?.full_name ?? "Sin responsable"}
                    </div>
                  </td>
                  <td className="px-2 py-2.5">
                    {client ? (
                      <Link
                        to={"/clientes/$id" as never}
                        params={{ id: client.id } as never}
                        className="block truncate font-medium text-primary hover:underline"
                      >
                        {client.name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">General</span>
                    )}
                  </td>
                  <td className="px-2 py-2.5 font-mono text-xs">
                    {task.case_id ? (
                      <Link
                        to={"/casos/$id" as never}
                        params={{ id: task.case_id } as never}
                        className="hover:text-primary hover:underline"
                      >
                        {taskCaseNumber(task) ?? "Abrir expediente"}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2.5">
                    <button
                      type="button"
                      onClick={() => onOpen(task)}
                      className="block max-w-full text-left font-semibold leading-snug hover:text-primary"
                    >
                      {task.title}
                    </button>
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      Prioridad {normalizeTaskPriority(task.priority)}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-xs">
                    <DueLabel task={task} />
                  </td>
                  <td className="px-2 py-2.5">
                    {permissions.canUpdateStatus ? (
                      <select
                        aria-label={`Estado de ${task.title}`}
                        value={normalizeTaskStatus(task.status)}
                        onChange={(event) => onStatus(task, event.target.value as TaskStatus)}
                        className="h-9 w-full rounded-lg border border-input bg-background px-2 text-xs font-semibold"
                      >
                        {TASK_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {TASK_STATUS_LABELS[status]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <TaskStatusChip status={task.status} />
                    )}
                  </td>
                  <td className="hidden px-2 py-2.5 xl:table-cell">
                    <span
                      title={task.description ?? ""}
                      className="block truncate text-xs text-muted-foreground"
                    >
                      {task.description || "—"}
                    </span>
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex items-center gap-1">
                      {(permissions.canEditAll || permissions.canUpdateStatus) && (
                        <button
                          type="button"
                          onClick={() => onEdit(task)}
                          aria-label={`Editar ${task.title}`}
                          className="grid h-9 w-9 place-items-center rounded-lg hover:bg-muted"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                      {permissions.canDelete && (
                        <button
                          type="button"
                          onClick={() => onDelete(task)}
                          aria-label={`Eliminar ${task.title}`}
                          className="grid h-9 w-9 place-items-center rounded-lg text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 md:hidden">
        {tasks.map((task) => {
          const client = taskClient(task);
          return (
            <button
              key={task.id}
              type="button"
              onClick={() => onOpen(task)}
              className="w-full rounded-xl border border-border bg-card p-4 text-left shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{task.title}</div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {client?.name ?? "Tarea general"} · {taskCaseNumber(task) ?? "Sin expediente"}
                  </div>
                </div>
                <TaskStatusChip status={task.status} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <DueLabel task={task} />
                <span className="inline-flex items-center gap-1">
                  <UserRound className="h-3.5 w-3.5" />
                  {task.assignee?.full_name ?? "Sin responsable"}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

export function TaskBoard({
  tasks,
  role,
  userId,
  onOpen,
  onStatus,
}: {
  tasks: DailyTask[];
  role?: string | null;
  userId?: string | null;
  onOpen: (task: DailyTask) => void;
  onStatus: (task: DailyTask, status: TaskStatus) => void;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      {TASK_STATUSES.map((status) => {
        const rows = tasks.filter((task) => normalizeTaskStatus(task.status) === status);
        return (
          <section key={status} aria-labelledby={`column-${status}`} className="min-w-0">
            <div className="mb-2 flex items-center justify-between">
              <h3 id={`column-${status}`} className="text-sm font-semibold">
                {TASK_STATUS_LABELS[status]}
              </h3>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{rows.length}</span>
            </div>
            <div className="space-y-2 rounded-xl bg-muted/30 p-2">
              {rows.length === 0 && (
                <p className="p-3 text-center text-xs text-muted-foreground">Sin tareas</p>
              )}
              {rows.map((task) => {
                const permissions = canManageTask(role, userId, task.assigned_to);
                return (
                  <article
                    key={task.id}
                    className="rounded-lg border border-border bg-card p-3 shadow-sm"
                  >
                    <button type="button" onClick={() => onOpen(task)} className="w-full text-left">
                      <div className="line-clamp-2 text-sm font-semibold">{task.title}</div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        {taskClient(task)?.name ?? "General"}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        <DueLabel task={task} />
                      </div>
                    </button>
                    {permissions.canUpdateStatus && (
                      <select
                        aria-label={`Mover ${task.title}`}
                        value={status}
                        onChange={(event) => onStatus(task, event.target.value as TaskStatus)}
                        className="mt-3 h-9 w-full rounded-lg border border-input bg-background px-2 text-xs"
                      >
                        {TASK_STATUSES.map((option) => (
                          <option key={option} value={option}>
                            {TASK_STATUS_LABELS[option]}
                          </option>
                        ))}
                      </select>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function TaskDetailSheet({
  task,
  role,
  userId,
  onClose,
  onEdit,
  onStatus,
  onDelete,
}: {
  task: DailyTask | null;
  role?: string | null;
  userId?: string | null;
  onClose: () => void;
  onEdit: (task: DailyTask) => void;
  onStatus: (task: DailyTask, status: TaskStatus) => void;
  onDelete: (task: DailyTask) => void;
}) {
  const permissions = task ? canManageTask(role, userId, task.assigned_to) : null;
  const client = task ? taskClient(task) : null;

  return (
    <Sheet open={!!task} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-[500px]">
        {task && (
          <>
            <SheetHeader>
              <div className="pr-8">
                <TaskStatusChip status={task.status} />
              </div>
              <SheetTitle className="pt-2">{task.title}</SheetTitle>
              <SheetDescription>Prioridad {normalizeTaskPriority(task.priority)}</SheetDescription>
            </SheetHeader>

            <dl className="mt-6 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <Detail label="Responsable" value={task.assignee?.full_name ?? "Sin responsable"} />
              <Detail label="Vencimiento">
                <DueLabel task={task} />
              </Detail>
              <Detail label="Cliente" value={client?.name ?? "Tarea general"} />
              <Detail label="Expediente" value={taskCaseNumber(task) ?? "Sin expediente"} />
              <Detail label="Autor" value={task.creator?.full_name ?? "No disponible"} />
              <Detail label="Creada" value={formatPeruDateTime(task.created_at)} />
              <Detail label="Actualizada" value={formatPeruDateTime(task.updated_at)} />
              <Detail
                label="Finalización"
                value={
                  task.completed_at
                    ? `${formatPeruDateTime(task.completed_at)} · ${task.completer?.full_name ?? "Usuario"}`
                    : "Pendiente"
                }
              />
            </dl>

            <div className="mt-6">
              <h3 className="text-sm font-semibold">Observaciones</h3>
              <p className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/40 p-4 text-sm text-muted-foreground">
                {task.description || "Sin observaciones."}
              </p>
            </div>

            <div className="mt-6">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <History className="h-4 w-4" /> Historial
              </h3>
              <ol className="mt-3 space-y-3 border-l border-border pl-4 text-xs">
                <li>
                  <div className="font-semibold">Tarea creada</div>
                  <div className="text-muted-foreground">
                    {formatPeruDateTime(task.created_at)} · {task.creator?.full_name ?? "Usuario"}
                  </div>
                </li>
                {task.updated_at !== task.created_at && (
                  <li>
                    <div className="font-semibold">Última actualización</div>
                    <div className="text-muted-foreground">
                      {formatPeruDateTime(task.updated_at)}
                    </div>
                  </li>
                )}
                {task.completed_at && (
                  <li>
                    <div className="font-semibold">Tarea terminada</div>
                    <div className="text-muted-foreground">
                      {formatPeruDateTime(task.completed_at)} ·{" "}
                      {task.completer?.full_name ?? "Usuario"}
                    </div>
                  </li>
                )}
              </ol>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              {(permissions?.canEditAll || permissions?.canUpdateStatus) && (
                <button
                  type="button"
                  onClick={() => onEdit(task)}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold"
                >
                  <Pencil className="h-4 w-4" /> Editar
                </button>
              )}
              {permissions?.canUpdateStatus && normalizeTaskStatus(task.status) !== "completed" && (
                <button
                  type="button"
                  onClick={() => onStatus(task, "completed")}
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white"
                >
                  <CheckCircle2 className="h-4 w-4" /> Marcar terminado
                </button>
              )}
              {permissions?.canUpdateStatus && normalizeTaskStatus(task.status) === "completed" && (
                <button
                  type="button"
                  onClick={() => onStatus(task, "pending")}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold"
                >
                  <Circle className="h-4 w-4" /> Reabrir
                </button>
              )}
              {client && (
                <Link
                  to={"/clientes/$id" as never}
                  params={{ id: client.id } as never}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold"
                >
                  Abrir cliente
                </Link>
              )}
              {task.case_id && (
                <Link
                  to={"/casos/$id" as never}
                  params={{ id: task.case_id } as never}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold"
                >
                  Abrir expediente
                </Link>
              )}
              {permissions?.canDelete && (
                <button
                  type="button"
                  onClick={() => onDelete(task)}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-red-200 px-4 text-sm font-semibold text-red-600"
                >
                  <Trash2 className="h-4 w-4" /> Eliminar
                </button>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Detail({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 font-medium">{children ?? value}</dd>
    </div>
  );
}

export function TaskError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
