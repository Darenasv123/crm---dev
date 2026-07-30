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
} from "lucide-react";
import { useMemo, useState } from "react";
import { AppLayout, Card } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/data-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormActions, FormErrorSummary, FormField, FormSection } from "@/components/ui/form-layout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
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
import { usePermissions } from "@/lib/permissions";

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
  const permissions = usePermissions(profile);
  const isAdmin = permissions.canManageAllTasks;
  const canCreateTasks = permissions.canCreateTasks;
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

  // Filter panel state
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [draftSearch, setDraftSearch] = useState("");
  const [draftStatus, setDraftStatus] = useState("");
  const [draftPriority, setDraftPriority] = useState("");
  const [draftClientId, setDraftClientId] = useState("");
  const [draftCaseId, setDraftCaseId] = useState("");
  const [draftAssignedTo, setDraftAssignedTo] = useState("");
  const [draftWithoutClient, setDraftWithoutClient] = useState(false);
  const [draftWithoutCase, setDraftWithoutCase] = useState(false);
  const [draftShowCompleted, setDraftShowCompleted] = useState(mode === "all");

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

  // Count active filters (excluding defaults)
  const activeFilterCount = [
    search,
    status,
    priority,
    clientId,
    caseId,
    isAdmin ? assignedTo : null,
    withoutClient,
    withoutCase,
  ].filter(Boolean).length;

  function openFilterPanel() {
    setDraftSearch(search);
    setDraftStatus(status);
    setDraftPriority(priority);
    setDraftClientId(clientId);
    setDraftCaseId(caseId);
    setDraftAssignedTo(assignedTo);
    setDraftWithoutClient(withoutClient);
    setDraftWithoutCase(withoutCase);
    setDraftShowCompleted(showCompleted);
    setFilterPanelOpen(true);
  }

  function applyFilters() {
    setSearch(draftSearch);
    setStatus(draftStatus);
    setPriority(draftPriority);
    setClientId(draftClientId);
    setCaseId(draftCaseId);
    setAssignedTo(draftAssignedTo);
    setWithoutClient(draftWithoutClient);
    setWithoutCase(draftWithoutCase);
    setShowCompleted(draftShowCompleted);
    setFilterPanelOpen(false);
  }

  function clearFilters() {
    setDraftSearch("");
    setDraftStatus("");
    setDraftPriority("");
    setDraftClientId("");
    setDraftCaseId("");
    setDraftAssignedTo("");
    setDraftWithoutClient(false);
    setDraftWithoutCase(false);
    setDraftShowCompleted(mode === "all");
  }

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
    <AppLayout title="Tareas" subtitle="Cola compartida de trabajo y seguimiento">
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

      <div className="mb-5 flex items-center justify-between">
        <Sheet open={filterPanelOpen} onOpenChange={setFilterPanelOpen}>
          <Button variant="outline" onClick={openFilterPanel} className="gap-2">
            <Filter className="h-4 w-4" />
            Filtros
            {activeFilterCount > 0 && (
              <span className="ml-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </Button>

          <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
            <SheetHeader>
              <SheetTitle>Filtros de tareas</SheetTitle>
              <SheetDescription>Configura los criterios de búsqueda y filtrado</SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-5">
              <div className="space-y-2">
                <Label htmlFor="filter-search">Buscar por tarea, cliente o expediente</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="filter-search"
                    value={draftSearch}
                    onChange={(event) => setDraftSearch(event.target.value)}
                    placeholder="Buscar..."
                    className="pl-9"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="filter-status">Estado</Label>
                <NativeSelect
                  id="filter-status"
                  value={draftStatus}
                  onChange={(event) => setDraftStatus(event.target.value)}
                >
                  <option value="">Todos los estados</option>
                  {TASK_STATUSES.map((item) => (
                    <option key={item} value={item}>
                      {TASK_STATUS_LABELS[item]}
                    </option>
                  ))}
                </NativeSelect>
              </div>

              <div className="space-y-2">
                <Label htmlFor="filter-priority">Prioridad</Label>
                <NativeSelect
                  id="filter-priority"
                  value={draftPriority}
                  onChange={(event) => setDraftPriority(event.target.value)}
                >
                  <option value="">Toda prioridad</option>
                  {TASK_PRIORITIES.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </NativeSelect>
              </div>

              {isAdmin && (
                <div className="space-y-2">
                  <Label htmlFor="filter-assigned">Responsable</Label>
                  <NativeSelect
                    id="filter-assigned"
                    value={draftAssignedTo}
                    onChange={(event) => setDraftAssignedTo(event.target.value)}
                  >
                    <option value="">Todos los responsables</option>
                    {profiles.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.full_name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="filter-client">Cliente</Label>
                <NativeSelect
                  id="filter-client"
                  value={draftClientId}
                  disabled={draftWithoutClient}
                  onChange={(event) => {
                    setDraftClientId(event.target.value);
                    setDraftCaseId("");
                  }}
                >
                  <option value="">Todos los clientes</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>

              <div className="space-y-2">
                <Label htmlFor="filter-case">Expediente</Label>
                <NativeSelect
                  id="filter-case"
                  value={draftCaseId}
                  disabled={draftWithoutCase || draftWithoutClient}
                  onChange={(event) => setDraftCaseId(event.target.value)}
                >
                  <option value="">Todos los expedientes</option>
                  {cases
                    .filter((item) => !draftClientId || item.client_id === draftClientId)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.expediente}
                      </option>
                    ))}
                </NativeSelect>
              </div>

              <div className="space-y-3 border-t pt-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draftWithoutClient}
                    onChange={(event) => {
                      setDraftWithoutClient(event.target.checked);
                      if (event.target.checked) {
                        setDraftClientId("");
                        setDraftCaseId("");
                        setDraftWithoutCase(false);
                      }
                    }}
                  />
                  Sin cliente
                </label>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draftWithoutCase}
                    disabled={draftWithoutClient}
                    onChange={(event) => {
                      setDraftWithoutCase(event.target.checked);
                      if (event.target.checked) setDraftCaseId("");
                    }}
                  />
                  Sin expediente
                </label>

                {mode === "all" && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draftShowCompleted}
                      onChange={(event) => setDraftShowCompleted(event.target.checked)}
                    />
                    Mostrar terminadas
                  </label>
                )}
              </div>
            </div>

            <div className="sticky bottom-0 -mx-5 -mb-5 mt-6 flex flex-col-reverse gap-2 border-t bg-card px-5 py-4 sm:-mx-6 sm:-mb-6 sm:flex-row sm:justify-between sm:px-6">
              <Button type="button" variant="outline" onClick={clearFilters}>
                Limpiar filtros
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setFilterPanelOpen(false)}>
                  Cancelar
                </Button>
                <Button type="button" onClick={applyFilters}>
                  Aplicar filtros
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>

        {canCreateTasks && (
          <Button type="button" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4" /> Nueva tarea
          </Button>
        )}
      </div>

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
        <EmptyState
          icon={CheckCircle2}
          title="No hay tareas en esta vista"
          description="La lista se actualizará al cambiar la cola o los filtros."
          action={
            isAdmin ? (
              <Button type="button" variant="outline" onClick={() => setShowForm(true)}>
                <Plus className="h-4 w-4" /> Crear tarea
              </Button>
            ) : undefined
          }
        />
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent size="lg">
          <DialogHeader icon={Plus}>
            <DialogTitle>Nueva tarea disponible</DialogTitle>
            <DialogDescription>
              Se crea pendiente y sin responsable para que el equipo pueda tomarla.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={create}>
            <FormSection title="Información de la tarea">
              <FormField id="task-title" label="Tarea" required className="sm:col-span-2">
                <Input
                  id="task-title"
                  autoFocus
                  required
                  value={form.title}
                  onChange={(event) => setForm({ ...form, title: event.target.value })}
                />
              </FormField>
              <FormField id="task-client" label="Cliente" optional>
                <NativeSelect
                  id="task-client"
                  value={form.client_id}
                  onChange={(event) =>
                    setForm({ ...form, client_id: event.target.value, case_id: "" })
                  }
                >
                  <option value="">Tarea general</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField id="task-case" label="Expediente" optional>
                <NativeSelect
                  id="task-case"
                  value={form.case_id}
                  onChange={(event) => {
                    const selected = cases.find((item) => item.id === event.target.value);
                    setForm({
                      ...form,
                      case_id: event.target.value,
                      client_id: selected?.client_id ?? form.client_id,
                    });
                  }}
                >
                  <option value="">Sin expediente</option>
                  {cases
                    .filter((item) => !form.client_id || item.client_id === form.client_id)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.case_number || item.expediente || item.process_type}
                      </option>
                    ))}
                </NativeSelect>
              </FormField>
              <FormField id="task-priority" label="Prioridad" className="sm:col-span-2">
                <NativeSelect
                  id="task-priority"
                  value={form.priority}
                  onChange={(event) =>
                    setForm({ ...form, priority: event.target.value as TaskFormValues["priority"] })
                  }
                >
                  {TASK_PRIORITIES.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField
                id="task-description"
                label="Observaciones"
                optional
                className="sm:col-span-2"
              >
                <Textarea
                  id="task-description"
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                />
              </FormField>
              {error && <FormErrorSummary className="sm:col-span-2">{error}</FormErrorSummary>}
            </FormSection>
            <FormActions>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Cancelar
              </Button>
              <Button type="submit" loading={createTask.isPending}>
                Crear tarea
              </Button>
            </FormActions>
          </form>
        </DialogContent>
      </Dialog>

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
                  <Textarea
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
              <NativeSelect
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
              </NativeSelect>
            ) : (
              <TaskChip status={task.status} />
            )}
            <span className="text-sm">{normalizeTaskPriority(task.priority)}</span>
            {isAdmin ? (
              <NativeSelect
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
              </NativeSelect>
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
