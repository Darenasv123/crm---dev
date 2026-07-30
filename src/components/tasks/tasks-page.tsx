import { Link, useRouterState } from "@tanstack/react-router";
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  ExternalLink,
  Filter,
  Hand,
  MessageSquareText,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { AppLayout, Card } from "@/components/app-layout";
import { useAuth } from "@/hooks/use-auth";
import {
  useClaimDailyTask,
  useCreateDailyTask,
  useDailyTasks,
  useDeleteDailyTask,
  useReturnDailyTask,
  useTaskCases,
  useTaskClients,
  useUpdateDailyTask,
  type DailyTask,
  type DailyTaskView,
} from "@/hooks/use-daily-tasks";
import { useProfiles } from "@/hooks/use-profiles";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  compareTasks,
  isAvailableTask,
  normalizeTaskPriority,
  normalizeTaskStatus,
  type TaskFormValues,
  type TaskStatus,
} from "@/lib/tasks";

type PageMode = "available" | "assigned" | "all" | "board";

const EMPTY_FORM: TaskFormValues = {
  title: "",
  description: "",
  client_id: "",
  case_id: "",
  priority: "Normal",
};

export function TasksPage({ mode }: { mode: PageMode }) {
  const { user, profile } = useAuth();
  const isAdmin = profile?.role === "Administrador";
  const view: DailyTaskView =
    mode === "assigned" ? (isAdmin ? "running" : "mine") : mode === "board" ? "all" : mode;
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [clientId, setClientId] = useState("");
  const [caseId, setCaseId] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [withoutClient, setWithoutClient] = useState(false);
  const [withoutCase, setWithoutCase] = useState(false);
  const [showCompleted, setShowCompleted] = useState(mode === "all");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<TaskFormValues>(EMPTY_FORM);
  const [selectedTask, setSelectedTask] = useState<DailyTask | null>(null);
  const [observationDraft, setObservationDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: tasks = [], isLoading } = useDailyTasks({
    view,
    userId: user?.id,
    status: status || undefined,
    priority: priority || undefined,
    clientId: withoutClient ? undefined : clientId || undefined,
    caseId: withoutCase ? undefined : caseId || undefined,
    assignedTo: isAdmin ? assignedTo || undefined : undefined,
    withoutClient,
    withoutCase,
    search: search || undefined,
    showCompleted,
    enabled: !!profile && (view !== "mine" || !!user?.id),
  });
  const { data: clients = [] } = useTaskClients();
  const { data: cases = [] } = useTaskCases();
  const { data: profiles = [] } = useProfiles();
  const createTask = useCreateDailyTask();
  const claimTask = useClaimDailyTask();
  const returnTask = useReturnDailyTask();
  const updateTask = useUpdateDailyTask();
  const deleteTask = useDeleteDailyTask();

  const visibleTasks = useMemo(() => {
    const roleRows =
      mode === "board" && !isAdmin
        ? tasks.filter((task) => isAvailableTask(task) || task.assigned_to === user?.id)
        : tasks;
    return [...roleRows].sort(compareTasks);
  }, [isAdmin, mode, tasks, user?.id]);

  const metrics = {
    available: visibleTasks.filter(isAvailableTask).length,
    mine: visibleTasks.filter((task) => task.assigned_to === user?.id).length,
    running: visibleTasks.filter((task) => normalizeTaskStatus(task.status) === "in_progress")
      .length,
    ready: visibleTasks.filter((task) => normalizeTaskStatus(task.status) === "ready_to_file")
      .length,
    blocked: visibleTasks.filter((task) => normalizeTaskStatus(task.status) === "blocked").length,
    completed: visibleTasks.filter((task) => normalizeTaskStatus(task.status) === "completed")
      .length,
  };

  const tabs = isAdmin
    ? [
        { to: "/tareas", label: "Disponibles" },
        { to: "/tareas/mias", label: "En ejecución" },
        { to: "/tareas/todas", label: "Todas" },
        { to: "/tareas/tablero", label: "Tablero" },
      ]
    : [
        { to: "/tareas", label: "Disponibles" },
        { to: "/tareas/mias", label: "Mis tareas" },
        { to: "/tareas/tablero", label: "Tablero" },
      ];

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await createTask.mutateAsync({ values: form, cases });
      setForm(EMPTY_FORM);
      setShowForm(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo crear la tarea.");
    }
  }

  async function runAction(task: DailyTask, action: () => Promise<unknown>) {
    setBusyId(task.id);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo actualizar la tarea.");
    } finally {
      setBusyId(null);
    }
  }

  function openTaskDetail(task: DailyTask) {
    setSelectedTask(task);
    setObservationDraft(task.description ?? "");
  }

  async function saveObservation() {
    if (!selectedTask) return;
    setBusyId(selectedTask.id);
    setError(null);
    try {
      const updated = await updateTask.mutateAsync({
        id: selectedTask.id,
        current: selectedTask,
        updates: { description: observationDraft.trim() || null },
      });
      setSelectedTask(updated);
      setObservationDraft(updated.description ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar la observación.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AppLayout
      title="Tareas"
      subtitle="Cola compartida de trabajo y seguimiento"
      actions={
        isAdmin ? (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
          >
            <Plus className="h-4 w-4" /> Nueva tarea
          </button>
        ) : undefined
      }
    >
      <nav aria-label="Vistas de tareas" className="mb-5 flex gap-1 overflow-x-auto border-b">
        {tabs.map((tab) => {
          const active = pathname === tab.to;
          return (
            <Link
              key={tab.to}
              to={tab.to as never}
              aria-current={active ? "page" : undefined}
              className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold ${
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Metric label="Disponibles" value={metrics.available} />
        <Metric label="Mis tareas activas" value={metrics.mine} />
        <Metric label="En proceso" value={metrics.running} />
        <Metric label="Listas para ingresar" value={metrics.ready} />
        <Metric label="Bloqueadas" value={metrics.blocked} />
        <Metric label="Terminadas" value={metrics.completed} />
      </div>

      <Card className="mb-5 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar tarea"
              className="h-9 w-full rounded-lg border bg-background pl-9 pr-3 text-sm"
            />
          </label>
          <label className="relative">
            <Filter className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="h-9 w-full rounded-lg border bg-background pl-9 pr-3 text-sm"
            >
              <option value="">Todos los estados</option>
              {TASK_STATUSES.map((item) => (
                <option key={item} value={item}>
                  {TASK_STATUS_LABELS[item]}
                </option>
              ))}
            </select>
          </label>
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
            className="h-9 rounded-lg border bg-background px-3 text-sm"
          >
            <option value="">Toda prioridad</option>
            {TASK_PRIORITIES.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <label className="flex h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={(event) => setShowCompleted(event.target.checked)}
            />
            Mostrar terminadas
          </label>
          <select
            value={clientId}
            disabled={withoutClient}
            onChange={(event) => {
              setClientId(event.target.value);
              setCaseId("");
            }}
            className="h-9 rounded-lg border bg-background px-3 text-sm disabled:opacity-50"
          >
            <option value="">Todos los clientes</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
          <select
            value={caseId}
            disabled={withoutCase || withoutClient}
            onChange={(event) => setCaseId(event.target.value)}
            className="h-9 rounded-lg border bg-background px-3 text-sm disabled:opacity-50"
          >
            <option value="">Todos los expedientes</option>
            {cases
              .filter((item) => !clientId || item.client_id === clientId)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.expediente}
                </option>
              ))}
          </select>
          {isAdmin && (
            <select
              value={assignedTo}
              onChange={(event) => setAssignedTo(event.target.value)}
              className="h-9 rounded-lg border bg-background px-3 text-sm"
            >
              <option value="">Todos los responsables</option>
              {profiles.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.full_name}
                </option>
              ))}
            </select>
          )}
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={withoutClient}
                onChange={(event) => {
                  setWithoutClient(event.target.checked);
                  if (event.target.checked) {
                    setClientId("");
                    setCaseId("");
                    setWithoutCase(false);
                  }
                }}
              />
              Sin cliente
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={withoutCase}
                disabled={withoutClient}
                onChange={(event) => {
                  setWithoutCase(event.target.checked);
                  if (event.target.checked) setCaseId("");
                }}
              />
              Sin expediente
            </label>
          </div>
        </div>
      </Card>

      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          <AlertCircle className="mt-0.5 h-4 w-4" /> {error}
        </div>
      )}

      {mode === "board" ? (
        <TaskBoard tasks={visibleTasks} />
      ) : (
        <TaskList
          tasks={visibleTasks}
          isAdmin={isAdmin}
          userId={user?.id}
          profiles={profiles}
          busyId={busyId}
          onClaim={(task) => runAction(task, () => claimTask.mutateAsync(task.id))}
          onReturn={(task) =>
            runAction(task, async () => {
              if (!window.confirm("¿Devolver esta tarea a Disponibles?")) return;
              await returnTask.mutateAsync(task.id);
            })
          }
          onStatus={(task, nextStatus) =>
            runAction(task, () =>
              updateTask.mutateAsync({
                id: task.id,
                updates: { status: nextStatus },
                current: task,
              }),
            )
          }
          onAssign={(task, assignee) =>
            runAction(task, () =>
              updateTask.mutateAsync({
                id: task.id,
                current: task,
                updates: assignee
                  ? {
                      assigned_to: assignee,
                      claimed_by: assignee,
                      claimed_at: task.claimed_at ?? new Date().toISOString(),
                      status: "in_progress",
                    }
                  : {
                      assigned_to: null,
                      claimed_by: null,
                      claimed_at: null,
                      status: "pending",
                    },
              }),
            )
          }
          onDelete={(task) =>
            runAction(task, async () => {
              if (!window.confirm(`¿Eliminar la tarea "${task.title}"?`)) return;
              await deleteTask.mutateAsync(task);
            })
          }
          onOpen={openTaskDetail}
        />
      )}

      {!isLoading && visibleTasks.length === 0 && (
        <Card className="p-10 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-semibold">No hay tareas en esta vista.</p>
          <p className="text-sm text-muted-foreground">
            La lista se actualizará al cambiar la cola.
          </p>
        </Card>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4">
          <Card className="max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6" role="dialog">
            <div className="flex justify-between">
              <div>
                <h2 className="text-lg font-bold">Nueva tarea disponible</h2>
                <p className="text-sm text-muted-foreground">
                  Se crea pendiente y sin responsable para que el equipo pueda tomarla.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="grid h-9 w-9 place-items-center rounded-lg hover:bg-muted"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={create} className="mt-6 grid gap-4 sm:grid-cols-2">
              <Field label="Tarea" className="sm:col-span-2">
                <input
                  autoFocus
                  required
                  value={form.title}
                  onChange={(event) => setForm({ ...form, title: event.target.value })}
                  className="field"
                />
              </Field>
              <Field label="Cliente (opcional)">
                <select
                  value={form.client_id}
                  onChange={(event) =>
                    setForm({ ...form, client_id: event.target.value, case_id: "" })
                  }
                  className="field"
                >
                  <option value="">Tarea general</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Expediente (opcional)">
                <select
                  value={form.case_id}
                  onChange={(event) => {
                    const selected = cases.find((item) => item.id === event.target.value);
                    setForm({
                      ...form,
                      case_id: event.target.value,
                      client_id: selected?.client_id ?? form.client_id,
                    });
                  }}
                  className="field"
                >
                  <option value="">Sin expediente</option>
                  {cases
                    .filter((item) => !form.client_id || item.client_id === form.client_id)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.case_number || item.expediente || item.process_type}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Prioridad" className="sm:col-span-2">
                <select
                  value={form.priority}
                  onChange={(event) =>
                    setForm({ ...form, priority: event.target.value as TaskFormValues["priority"] })
                  }
                  className="field"
                >
                  {TASK_PRIORITIES.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </Field>
              <Field label="Observaciones" className="sm:col-span-2">
                <textarea
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  className="field min-h-28"
                />
              </Field>
              {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
              <div className="flex justify-end gap-2 sm:col-span-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="h-10 rounded-lg border px-4"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={createTask.isPending}
                  className="h-10 rounded-lg bg-primary px-4 font-semibold text-primary-foreground"
                >
                  Crear tarea
                </button>
              </div>
            </form>
          </Card>
        </div>
      )}

      <Sheet
        open={!!selectedTask}
        onOpenChange={(open) => {
          if (!open) setSelectedTask(null);
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {selectedTask && (
            <>
              <SheetHeader className="pr-8">
                <SheetTitle>{selectedTask.title}</SheetTitle>
                <SheetDescription>
                  Detalle operativo de la tarea y sus observaciones.
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <DetailValue
                  label="Cliente"
                  value={
                    selectedTask.cases?.clients?.name ||
                    selectedTask.clients?.name ||
                    "Tarea general"
                  }
                />
                <DetailValue
                  label="Expediente"
                  value={
                    selectedTask.cases?.case_number ||
                    selectedTask.cases?.expediente ||
                    "Sin expediente"
                  }
                />
                <DetailValue
                  label="Estado"
                  value={TASK_STATUS_LABELS[normalizeTaskStatus(selectedTask.status)]}
                />
                <DetailValue
                  label="Prioridad"
                  value={normalizeTaskPriority(selectedTask.priority)}
                />
                <DetailValue
                  label="Responsable"
                  value={selectedTask.assignee?.full_name || "Disponible"}
                  className="sm:col-span-2"
                />
              </div>

              <div className="mt-6">
                <label className="grid gap-2 text-sm font-medium">
                  Observaciones
                  <textarea
                    value={observationDraft}
                    onChange={(event) => setObservationDraft(event.target.value)}
                    readOnly={!isAdmin && selectedTask.assigned_to !== user?.id}
                    className="field min-h-36 resize-y read-only:bg-muted/40"
                    placeholder="Sin observaciones"
                  />
                </label>
                {(isAdmin || selectedTask.assigned_to === user?.id) && (
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={saveObservation}
                      disabled={
                        busyId === selectedTask.id ||
                        observationDraft.trim() === (selectedTask.description ?? "").trim()
                      }
                      className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                    >
                      Guardar observación
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </AppLayout>
  );
}

function TaskList({
  tasks,
  isAdmin,
  userId,
  profiles,
  busyId,
  onClaim,
  onReturn,
  onStatus,
  onAssign,
  onDelete,
  onOpen,
}: {
  tasks: DailyTask[];
  isAdmin: boolean;
  userId?: string;
  profiles: Array<{ id: string; full_name: string; role: string; status: string }>;
  busyId: string | null;
  onClaim: (task: DailyTask) => void;
  onReturn: (task: DailyTask) => void;
  onStatus: (task: DailyTask, status: TaskStatus) => void;
  onAssign: (task: DailyTask, assignee: string) => void;
  onDelete: (task: DailyTask) => void;
  onOpen: (task: DailyTask) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="hidden grid-cols-[minmax(220px,2fr)_minmax(130px,1fr)_minmax(130px,1fr)_140px_110px_minmax(150px,1fr)_minmax(180px,1.2fr)] gap-3 border-b bg-muted/35 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground xl:grid">
        <span>Tarea</span>
        <span>Cliente</span>
        <span>Expediente</span>
        <span>Estado</span>
        <span>Prioridad</span>
        <span>Responsable</span>
        <span>Acción principal</span>
      </div>
      {tasks.map((task) => {
        const available = isAvailableTask(task);
        const own = task.assigned_to === userId;
        return (
          <article
            key={task.id}
            className="grid gap-3 border-b p-4 last:border-b-0 xl:grid-cols-[minmax(220px,2fr)_minmax(130px,1fr)_minmax(130px,1fr)_140px_110px_minmax(150px,1fr)_minmax(180px,1.2fr)] xl:items-center"
          >
            <div className="min-w-0">
              <h3 className="font-semibold">{task.title}</h3>
              {task.description && (
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {task.description}
                </p>
              )}
            </div>
            <span className="truncate text-sm">
              {task.cases?.clients?.name || task.clients?.name || "General"}
            </span>
            <span className="truncate text-sm">
              {task.cases?.case_number || task.cases?.expediente || "Sin expediente"}
            </span>
            {isAdmin || own ? (
              <select
                value={normalizeTaskStatus(task.status)}
                onChange={(event) => onStatus(task, event.target.value as TaskStatus)}
                disabled={busyId === task.id || available}
                className="h-9 rounded-lg border bg-background px-2 text-xs"
              >
                {TASK_STATUSES.map((item) => (
                  <option key={item} value={item}>
                    {TASK_STATUS_LABELS[item]}
                  </option>
                ))}
              </select>
            ) : (
              <TaskChip status={task.status} />
            )}
            <span className="text-sm">{normalizeTaskPriority(task.priority)}</span>
            {isAdmin ? (
              <select
                value={task.assigned_to ?? ""}
                onChange={(event) => onAssign(task, event.target.value)}
                disabled={busyId === task.id}
                className="h-9 min-w-0 rounded-lg border bg-background px-2 text-xs"
              >
                <option value="">Liberar a Disponibles</option>
                {profiles
                  .filter((item) => item.status === "Activo")
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.full_name}
                    </option>
                  ))}
              </select>
            ) : (
              <span className="truncate text-sm">{task.assignee?.full_name || "Disponible"}</span>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onOpen(task)}
                className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold"
              >
                <MessageSquareText className="h-4 w-4" /> Ver detalle
              </button>
              {available && (
                <button
                  type="button"
                  onClick={() => onClaim(task)}
                  disabled={busyId === task.id}
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                >
                  <Hand className="h-4 w-4" /> Tomar tarea
                </button>
              )}
              {own && !isAdmin && normalizeTaskStatus(task.status) !== "completed" && (
                <button
                  type="button"
                  onClick={() => onReturn(task)}
                  disabled={busyId === task.id}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold"
                >
                  <RotateCcw className="h-4 w-4" /> Devolver tarea
                </button>
              )}
              {task.case_id && (
                <Link
                  to={"/casos/$id" as never}
                  params={{ id: task.case_id } as never}
                  className="grid h-9 w-9 place-items-center rounded-lg border"
                  aria-label="Abrir expediente"
                >
                  <ExternalLink className="h-4 w-4" />
                </Link>
              )}
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => onDelete(task)}
                  disabled={busyId === task.id}
                  className="grid h-9 w-9 place-items-center rounded-lg border border-red-200 text-red-600"
                  aria-label="Eliminar tarea"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </article>
        );
      })}
    </Card>
  );
}

function DetailValue({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm">{value}</p>
    </div>
  );
}

function TaskBoard({ tasks }: { tasks: DailyTask[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      {TASK_STATUSES.map((status) => {
        const rows = tasks.filter((task) => normalizeTaskStatus(task.status) === status);
        return (
          <section key={status}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">{TASK_STATUS_LABELS[status]}</h2>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{rows.length}</span>
            </div>
            <div className="min-h-28 space-y-2 rounded-xl bg-muted/35 p-2">
              {rows.map((task) => (
                <Card key={task.id} className="p-3">
                  <p className="text-sm font-semibold">{task.title}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {task.assignee?.full_name || "Disponible"} ·{" "}
                    {normalizeTaskPriority(task.priority)}
                  </p>
                </Card>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TaskChip({ status }: { status: string }) {
  const normalized = normalizeTaskStatus(status);
  return (
    <span className="inline-flex w-fit items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold">
      {normalized === "completed" ? (
        <CheckCircle2 className="h-3.5 w-3.5" />
      ) : (
        <Circle className="h-3.5 w-3.5" />
      )}
      {TASK_STATUS_LABELS[normalized]}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </Card>
  );
}

function Field({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`grid gap-1.5 text-sm font-medium ${className}`}>
      {label}
      {children}
    </label>
  );
}
