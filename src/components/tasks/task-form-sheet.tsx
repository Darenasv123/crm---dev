import { useEffect, useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { DailyTask } from "@/hooks/use-daily-tasks";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  normalizeTaskPriority,
  normalizeTaskStatus,
  toTaskFormDue,
  type TaskFormValues,
} from "@/lib/tasks";

type ClientOption = { id: string; name: string; initials: string };
type CaseOption = {
  id: string;
  client_id: string;
  expediente: string;
  case_number: string | null;
  process_type: string;
};
type ProfileOption = {
  id: string;
  full_name: string;
  role: string;
  status: string;
};

function emptyValues(defaultAssignee = "", initialDate = ""): TaskFormValues {
  return {
    title: "",
    description: "",
    assigned_to: defaultAssignee,
    client_id: "",
    case_id: "",
    due_date: initialDate,
    due_time: "18:00",
    is_all_day: true,
    status: "pending",
    priority: "Normal",
  };
}

function valuesForTask(task: DailyTask): TaskFormValues {
  const due = toTaskFormDue(task.due_date, task.is_all_day);
  return {
    title: task.title,
    description: task.description ?? "",
    assigned_to: task.assigned_to ?? "",
    client_id: task.cases?.client_id ?? task.client_id ?? "",
    case_id: task.case_id ?? "",
    due_date: due.date,
    due_time: due.time || "18:00",
    is_all_day: task.is_all_day,
    status: normalizeTaskStatus(task.status),
    priority: normalizeTaskPriority(task.priority),
  };
}

export function TaskFormSheet({
  open,
  task,
  defaultAssignee,
  initialDate,
  clients,
  cases,
  profiles,
  saving,
  externalError,
  canReassign,
  canEditAll,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  task: DailyTask | null;
  defaultAssignee?: string;
  initialDate?: string;
  clients: ClientOption[];
  cases: CaseOption[];
  profiles: ProfileOption[];
  saving: boolean;
  externalError?: string | null;
  canReassign: boolean;
  canEditAll: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: TaskFormValues) => Promise<void>;
}) {
  const initial = useMemo(
    () => (task ? valuesForTask(task) : emptyValues(defaultAssignee, initialDate)),
    [defaultAssignee, initialDate, task],
  );
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValues(initial);
      setError(null);
    }
  }, [initial, open]);

  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const visibleCases = values.client_id
    ? cases.filter((item) => item.client_id === values.client_id)
    : cases;
  const activeProfiles = profiles.filter((profile) => profile.status === "Activo");

  function requestClose(nextOpen: boolean) {
    if (
      !nextOpen &&
      dirty &&
      !saving &&
      !window.confirm("Hay cambios sin guardar. ¿Deseas descartarlos?")
    ) {
      return;
    }
    onOpenChange(nextOpen);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await onSubmit(values);
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar la tarea.");
    }
  }

  return (
    <Sheet open={open} onOpenChange={requestClose}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{task ? "Editar tarea" : "Nueva tarea"}</SheetTitle>
          <SheetDescription>
            Las tareas viven en el CRM y no se duplican en el calendario.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={submit} className="mt-6 space-y-5">
          <Field label="Tarea" htmlFor="task-title" required>
            <input
              id="task-title"
              autoFocus
              disabled={!!task && !canEditAll}
              value={values.title}
              onChange={(event) =>
                setValues((current) => ({ ...current, title: event.target.value }))
              }
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm disabled:opacity-60"
              placeholder="Ej. Preparar escrito para presentación"
              required
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Cliente (opcional)" htmlFor="task-client">
              <select
                id="task-client"
                disabled={!!task && !canEditAll}
                value={values.client_id}
                onChange={(event) => {
                  const clientId = event.target.value;
                  setValues((current) => ({
                    ...current,
                    client_id: clientId,
                    case_id:
                      current.case_id &&
                      cases.find((item) => item.id === current.case_id)?.client_id !== clientId
                        ? ""
                        : current.case_id,
                  }));
                }}
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm disabled:opacity-60"
              >
                <option value="">Tarea general</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Expediente (opcional)" htmlFor="task-case">
              <select
                id="task-case"
                disabled={!!task && !canEditAll}
                value={values.case_id}
                onChange={(event) => {
                  const caseId = event.target.value;
                  const related = cases.find((item) => item.id === caseId);
                  setValues((current) => ({
                    ...current,
                    case_id: caseId,
                    client_id: related?.client_id ?? current.client_id,
                  }));
                }}
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm disabled:opacity-60"
              >
                <option value="">Sin expediente</option>
                {visibleCases.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.case_number || item.expediente || item.process_type}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Responsable" htmlFor="task-assignee" required>
            <select
              id="task-assignee"
              value={values.assigned_to}
              disabled={!canReassign}
              onChange={(event) =>
                setValues((current) => ({ ...current, assigned_to: event.target.value }))
              }
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm disabled:opacity-60"
              required
            >
              <option value="">Seleccionar responsable</option>
              {activeProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.full_name} · {profile.role}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Fecha" htmlFor="task-date">
              <input
                id="task-date"
                type="date"
                disabled={!!task && !canEditAll}
                value={values.due_date}
                onChange={(event) =>
                  setValues((current) => ({ ...current, due_date: event.target.value }))
                }
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm disabled:opacity-60"
              />
            </Field>
            <Field label="Hora" htmlFor="task-time">
              <input
                id="task-time"
                type="time"
                value={values.due_time}
                disabled={(!!task && !canEditAll) || values.is_all_day || !values.due_date}
                onChange={(event) =>
                  setValues((current) => ({ ...current, due_time: event.target.value }))
                }
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm disabled:opacity-60"
              />
            </Field>
            <div className="flex items-end">
              <label className="flex h-10 w-full items-center gap-2 rounded-lg border border-input px-3 text-sm">
                <input
                  type="checkbox"
                  checked={values.is_all_day}
                  disabled={!!task && !canEditAll}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, is_all_day: event.target.checked }))
                  }
                />
                Todo el día
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Estado" htmlFor="task-status">
              <select
                id="task-status"
                value={values.status}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    status: event.target.value as TaskFormValues["status"],
                  }))
                }
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
              >
                {TASK_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {TASK_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Prioridad" htmlFor="task-priority">
              <select
                id="task-priority"
                value={values.priority}
                disabled={!!task && !canEditAll}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    priority: event.target.value as TaskFormValues["priority"],
                  }))
                }
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm disabled:opacity-60"
              >
                {TASK_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Observaciones" htmlFor="task-description">
            <textarea
              id="task-description"
              value={values.description}
              onChange={(event) =>
                setValues((current) => ({ ...current, description: event.target.value }))
              }
              className="min-h-28 w-full rounded-lg border border-input bg-background p-3 text-sm"
              placeholder="Contexto, documentos pendientes o indicaciones para la tarea"
            />
          </Field>

          {(error || externalError) && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            >
              {error || externalError}
            </div>
          )}

          <SheetFooter>
            <button
              type="button"
              onClick={() => requestClose(false)}
              className="h-10 rounded-lg border border-border px-4 text-sm font-semibold"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="h-10 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {saving ? "Guardando…" : task ? "Guardar cambios" : "Crear tarea"}
            </button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function Field({
  label,
  htmlFor,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label} {required && <span aria-hidden="true">*</span>}
      </label>
      {children}
    </div>
  );
}
