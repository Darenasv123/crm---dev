import { useState } from "react";
import { CheckCircle2, Circle, Clock3, Loader2, Plus, Trash2, X } from "lucide-react";
import { Card, StatusBadge } from "@/components/app-layout";
import { useAuth } from "@/hooks/use-auth";
import { useProfiles } from "@/hooks/use-profiles";
import {
  useCreateCaseTask,
  useDeleteCaseTask,
  useCaseTasks,
  useUpdateCaseTask,
} from "@/hooks/legal/use-case-management";
import { peruDateTimeToISO, formatPeruDateTime } from "@/lib/peru-time";

const taskStatusLabel = {
  pending: "Pendiente",
  in_progress: "En proceso",
  ready_to_file: "Listo para ingresar",
  completed: "Terminado",
  blocked: "Bloqueado",
  cancelled: "Cancelada",
  overdue: "Vencida",
} as const;

export function CaseTasksPanel({ caseId, clientId }: { caseId: string; clientId: string }) {
  const { data: tasks = [], isLoading, error } = useCaseTasks({ caseId });
  const { data: profiles = [] } = useProfiles();
  const createTask = useCreateCaseTask();
  const updateTask = useUpdateCaseTask();
  const deleteTask = useDeleteCaseTask();
  const { profile, user } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    priority: "Normal" as "Baja" | "Normal" | "Alta" | "Urgente",
    due_date: "",
    assigned_to: "",
  });

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    try {
      await createTask.mutateAsync({
        case_id: caseId,
        client_id: clientId,
        title: form.title.trim(),
        description: form.description.trim() || null,
        priority: form.priority,
        due_date: peruDateTimeToISO(form.due_date),
        assigned_to: profile?.role === "Personal" ? (user?.id ?? null) : form.assigned_to || null,
        status: "pending",
        source: "manual",
        created_by_ai: false,
        verification_status: "approved",
      });
      setForm({ title: "", description: "", priority: "Normal", due_date: "", assigned_to: "" });
      setShowForm(false);
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "No se pudo crear la tarea.");
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2 className="h-4 w-4 text-primary" /> Tareas y próximas acciones
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Responsables, vencimientos y seguimiento del expediente.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((value) => !value)}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground"
        >
          {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {showForm ? "Cerrar" : "Nueva tarea"}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mt-4 space-y-3 rounded-lg border border-border bg-muted/20 p-4"
        >
          <input
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            placeholder="Título de la tarea"
            required
            className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none"
          />
          <textarea
            value={form.description}
            onChange={(event) =>
              setForm((current) => ({ ...current, description: event.target.value }))
            }
            placeholder="Detalle o indicaciones"
            rows={3}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
          />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <select
              value={form.priority}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  priority: event.target.value as typeof form.priority,
                }))
              }
              className="h-10 rounded-lg border border-border bg-card px-3 text-sm outline-none"
            >
              <option>Baja</option>
              <option>Normal</option>
              <option>Alta</option>
              <option>Urgente</option>
            </select>
            <input
              type="datetime-local"
              value={form.due_date}
              onChange={(event) =>
                setForm((current) => ({ ...current, due_date: event.target.value }))
              }
              className="h-10 rounded-lg border border-border bg-card px-3 text-sm outline-none"
            />
            <select
              value={profile?.role === "Personal" ? (user?.id ?? "") : form.assigned_to}
              disabled={profile?.role !== "Administrador"}
              onChange={(event) =>
                setForm((current) => ({ ...current, assigned_to: event.target.value }))
              }
              className="h-10 rounded-lg border border-border bg-card px-3 text-sm outline-none disabled:opacity-60"
            >
              <option value="">Sin responsable</option>
              {profiles
                .filter((item) => item.status === "Activo")
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.full_name}
                  </option>
                ))}
            </select>
          </div>
          {formError && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {formError}
            </p>
          )}
          <button
            type="submit"
            disabled={createTask.isPending}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-60"
          >
            {createTask.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Guardar tarea
          </button>
        </form>
      )}

      {isLoading ? (
        <div className="grid place-items-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : error ? (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
          El módulo de tareas todavía no está habilitado en la base de datos.
        </p>
      ) : tasks.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No hay tareas registradas para este expediente.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {tasks.map((task) => {
            const overdue =
              !!task.due_date &&
              new Date(task.due_date) < new Date() &&
              task.status !== "completed" &&
              task.status !== "cancelled";
            return (
              <article
                key={task.id}
                className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-center"
              >
                <button
                  type="button"
                  onClick={() =>
                    updateTask.mutate({
                      id: task.id,
                      updates: { status: task.status === "completed" ? "pending" : "completed" },
                    })
                  }
                  className="shrink-0 text-primary"
                  title={task.status === "completed" ? "Reabrir tarea" : "Completar tarea"}
                >
                  {task.status === "completed" ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    <Circle className="h-5 w-5" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <div
                    className={`text-sm font-semibold ${task.status === "completed" ? "text-muted-foreground line-through" : ""}`}
                  >
                    {task.title}
                  </div>
                  {task.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {task.description}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    {task.due_date && (
                      <span
                        className={`flex items-center gap-1 ${overdue ? "font-semibold text-red-600" : ""}`}
                      >
                        <Clock3 className="h-3 w-3" />
                        {formatPeruDateTime(task.due_date, {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    )}
                    <span>{task.profiles?.full_name ?? "Sin responsable"}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge
                    tone={
                      overdue
                        ? "danger"
                        : task.status === "completed"
                          ? "success"
                          : task.priority === "Alta"
                            ? "warning"
                            : "default"
                    }
                  >
                    {overdue
                      ? "Vencida"
                      : taskStatusLabel[task.status as keyof typeof taskStatusLabel] || task.status}
                  </StatusBadge>
                  {profile?.role === "Administrador" && (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`¿Eliminar la tarea "${task.title}"?`))
                          deleteTask.mutate(task.id);
                      }}
                      title="Eliminar tarea"
                      className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </Card>
  );
}
