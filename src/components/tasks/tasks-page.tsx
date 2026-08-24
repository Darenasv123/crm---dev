import { Link, useRouterState } from "@tanstack/react-router";
import {
  AlertCircle,
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Edit3,
  Filter,
  Hand,
  Loader2,
  MessageSquareText,
  Plus,
  RotateCcw,
  Search,
  UserX,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppLayout, Card } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/data-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import {
  useClaimDailyTask,
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
  limaToday,
  normalizeTaskPriority,
  normalizeTaskStatus,
  shiftIsoDate,
  type TaskStatus,
} from "@/lib/tasks";
import { usePermissions } from "@/lib/permissions";
import { getTaskVisualState } from "@/lib/task-visual";
import { TaskPriorityBadge } from "@/components/tasks/TaskPriorityBadge";
import { TaskFormDialog } from "@/components/tasks/task-form-dialog";

type PageMode = "available" | "assigned" | "all" | "board";
/** Alcance de fecha de la vista. "all" solo tiene sentido con mode="all": muestra
 * todas las fechas para que el conteo "Total" sea coherente con lo que el tab promete. */
type DateScope = "day" | "upcoming" | "overdue" | "all";

export function TasksPage({
  mode,
  initialTaskId,
  onTaskUrlChange,
}: {
  mode: PageMode;
  /** ID de tarea a abrir automáticamente (deep-link), si la ruta lo soporta. */
  initialTaskId?: string;
  /** Notifica cambios de selección para que la ruta pueda reflejarlos en la URL. */
  onTaskUrlChange?: (taskId: string | null) => void;
}) {
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
  const [selectedDate, setSelectedDate] = useState(limaToday());
  // "Todas" promete ver todo el universo de tareas: no debe heredar el filtro
  // de "hoy" que sí tiene sentido en Disponibles/Mis tareas/Tablero (QA-008).
  const [dateScope, setDateScope] = useState<DateScope>(mode === "all" ? "all" : "day");
  const [showForm, setShowForm] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);

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

  const [selectedTask, setSelectedTask] = useState<DailyTask | null>(null);
  const [observationDraft, setObservationDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [claimedId, setClaimedId] = useState<string | null>(null);
  const [deepLinkTried, setDeepLinkTried] = useState<string | null>(null);

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
    scheduledDate: dateScope === "day" ? selectedDate : undefined,
    scheduledBefore: dateScope === "overdue" ? limaToday() : undefined,
    scheduledAfter: dateScope === "upcoming" ? limaToday() : undefined,
    enabled: !!profile && (view !== "mine" || !!user?.id),
  });
  const { data: clients = [] } = useTaskClients();
  const { data: cases = [] } = useTaskCases();
  const { data: profiles = [] } = useProfiles();
  const claimTask = useClaimDailyTask();
  const returnTask = useReturnDailyTask();
  const updateTask = useUpdateDailyTask();
  const deleteTask = useDeleteDailyTask();
  const { data: accumulatedTasks = [] } = useDailyTasks({
    view,
    userId: user?.id,
    clientId: clientId || undefined,
    caseId: caseId || undefined,
    assignedTo: isAdmin ? assignedTo || undefined : undefined,
    scheduledBefore: limaToday(),
    showCompleted: false,
    enabled: !!profile && dateScope === "day" && selectedDate >= limaToday(),
  });

  const visibleTasks = useMemo(() => {
    // Administrador y Personal ven el mismo universo de tareas.
    // No se filtra por rol en el tablero; el servidor ya aplica RLS correctamente.
    return [...tasks].sort(compareTasks);
  }, [tasks]);

  const metrics = {
    total: visibleTasks.length,
    pending: visibleTasks.filter((task) => normalizeTaskStatus(task.status) === "pending").length,
    running: visibleTasks.filter((task) => normalizeTaskStatus(task.status) === "in_progress")
      .length,
    blocked: visibleTasks.filter((task) => normalizeTaskStatus(task.status) === "blocked").length,
    completed: visibleTasks.filter((task) => normalizeTaskStatus(task.status) === "completed")
      .length,
    overdue: accumulatedTasks.length,
  };

  // Deep-link: abre automáticamente la tarea de ?tarea=<id> cuando llega en la URL.
  // Solo lo intenta una vez por ID (deepLinkTried) para no reabrir el detalle
  // si el usuario lo cierra manualmente después.
  useEffect(() => {
    if (!initialTaskId || initialTaskId === deepLinkTried) return;
    const match = tasks.find((item) => item.id === initialTaskId);
    if (match) {
      setSelectedTask(match);
      setObservationDraft(match.description ?? "");
      setDeepLinkTried(initialTaskId);
    } else if (!isLoading) {
      // La tarea no existe en esta vista (fue eliminada, o queda fuera de los
      // filtros activos). No rompemos la página: solo lo comunicamos.
      setError("La tarea enlazada ya no está disponible en esta vista.");
      setDeepLinkTried(initialTaskId);
    }
  }, [initialTaskId, deepLinkTried, tasks, isLoading]);

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
        { to: "/tareas/todas", label: "Todas" },
        { to: "/tareas/tablero", label: "Tablero" },
      ];

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

  async function handleClaim(task: DailyTask) {
    setBusyId(task.id);
    setError(null);
    try {
      await claimTask.mutateAsync(task.id);
      setClaimedId(task.id);
      setTimeout(() => setClaimedId(null), 700);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo tomar la tarea.");
    } finally {
      setBusyId(null);
    }
  }

  function openTaskDetail(task: DailyTask) {
    setSelectedTask(task);
    setObservationDraft(task.description ?? "");
    onTaskUrlChange?.(task.id);
  }

  function closeTaskDetail() {
    setSelectedTask(null);
    onTaskUrlChange?.(null);
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

      <Card className="mb-5 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Día anterior"
            onClick={() => {
              setSelectedDate((date) => shiftIsoDate(date, -1));
              setDateScope("day");
            }}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input
            type="date"
            value={selectedDate}
            onChange={(event) => {
              setSelectedDate(event.target.value);
              setDateScope("day");
            }}
            className="w-auto"
            aria-label="Fecha de trabajo"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Día siguiente"
            onClick={() => {
              setSelectedDate((date) => shiftIsoDate(date, 1));
              setDateScope("day");
            }}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant={dateScope === "day" && selectedDate === limaToday() ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setSelectedDate(limaToday());
              setDateScope("day");
            }}
          >
            Hoy
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setSelectedDate(shiftIsoDate(limaToday(), -1));
              setDateScope("day");
            }}
          >
            Ayer
          </Button>
          <Button
            type="button"
            variant={dateScope === "upcoming" ? "default" : "outline"}
            size="sm"
            onClick={() => setDateScope("upcoming")}
          >
            Próximas
          </Button>
          <Button
            type="button"
            variant={dateScope === "overdue" ? "default" : "outline"}
            size="sm"
            onClick={() => setDateScope("overdue")}
          >
            <AlertTriangle className="h-4 w-4" /> Atrasadas
          </Button>
          <Button
            type="button"
            variant={dateScope === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setDateScope("all")}
          >
            Todas las fechas
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          La fecha de trabajo se conserva aunque la tarea se complete después.
        </p>
      </Card>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Metric
          label="Total"
          value={metrics.total}
          hint={
            dateScope === "all"
              ? "Todas las fechas"
              : dateScope === "day"
                ? `Fecha: ${selectedDate}`
                : dateScope === "upcoming"
                  ? "Próximas"
                  : "Atrasadas"
          }
        />
        <Metric label="Pendientes" value={metrics.pending} />
        <Metric label="En desarrollo" value={metrics.running} />
        <Metric label="Completadas" value={metrics.completed} />
        <Metric label="Bloqueadas" value={metrics.blocked} />
        <Metric label="Atrasadas" value={metrics.overdue} />
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

      {dateScope === "day" && accumulatedTasks.length > 0 && (
        <section className="mb-5" aria-labelledby="accumulated-tasks-title">
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <h2 id="accumulated-tasks-title" className="font-semibold">
              Pendientes acumuladas
            </h2>
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning-foreground">
              {accumulatedTasks.length}
            </span>
          </div>
          <TaskList
            tasks={[...accumulatedTasks].sort(compareTasks)}
            isAdmin={isAdmin}
            userId={user?.id}
            profiles={profiles}
            busyId={busyId}
            claimedId={claimedId}
            onClaim={handleClaim}
            onReturn={(task) => runAction(task, () => returnTask.mutateAsync(task.id))}
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
                    : { assigned_to: null, claimed_by: null, claimed_at: null, status: "pending" },
                }),
              )
            }
            onDelete={(task) =>
              runAction(task, async () => {
                if (window.confirm(`¿Eliminar la tarea "${task.title}"?`))
                  await deleteTask.mutateAsync(task);
              })
            }
            onOpen={openTaskDetail}
          />
        </section>
      )}

      {mode === "board" ? (
        <TaskBoard tasks={visibleTasks} userId={user?.id} />
      ) : (
        <TaskList
          tasks={visibleTasks}
          isAdmin={isAdmin}
          userId={user?.id}
          profiles={profiles}
          busyId={busyId}
          claimedId={claimedId}
          onClaim={handleClaim}
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

      <TaskFormDialog
        mode="create"
        open={showForm}
        onOpenChange={setShowForm}
        clients={clients}
        cases={cases}
      />

      {selectedTask && (
        <TaskFormDialog
          mode="edit"
          open={showEditDialog}
          onOpenChange={setShowEditDialog}
          task={selectedTask}
          clients={clients}
          cases={cases}
          onSaved={setSelectedTask}
        />
      )}

      <Sheet
        open={!!selectedTask}
        onOpenChange={(open) => {
          if (!open) closeTaskDetail();
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {selectedTask && (
            <>
              <SheetHeader className="pr-8">
                <div className="flex items-start justify-between gap-3">
                  <SheetTitle>{selectedTask.title}</SheetTitle>
                  {isAdmin && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowEditDialog(true)}
                    >
                      <Edit3 className="h-4 w-4" /> Editar tarea
                    </Button>
                  )}
                </div>
                <SheetDescription>
                  Detalle operativo de la tarea y sus observaciones.
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {(() => {
                  const resolvedClientId = selectedTask.client_id ?? selectedTask.cases?.client_id;
                  const resolvedClientName =
                    selectedTask.cases?.clients?.name ||
                    selectedTask.clients?.name ||
                    "Tarea general";
                  return resolvedClientId ? (
                    <DetailLink
                      label="Cliente"
                      value={resolvedClientName}
                      to="/clientes/$id"
                      params={{ id: resolvedClientId }}
                    />
                  ) : (
                    <DetailValue label="Cliente" value={resolvedClientName} />
                  );
                })()}
                {selectedTask.case_id && selectedTask.cases ? (
                  <DetailLink
                    label="Expediente"
                    value={selectedTask.cases.case_number || selectedTask.cases.expediente}
                    to="/casos/$id"
                    params={{ id: selectedTask.case_id }}
                  />
                ) : (
                  <DetailValue label="Expediente" value="Sin expediente" />
                )}
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
                <DetailValue label="Fecha de trabajo" value={selectedTask.scheduled_for} />
                <DetailValue
                  label="Completada"
                  value={
                    selectedTask.completed_at
                      ? `${new Date(selectedTask.completed_at).toLocaleString("es-PE")} · ${selectedTask.completer?.full_name || "Usuario registrado"}`
                      : "Aún no completada"
                  }
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
  claimedId,
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
  claimedId: string | null;
  onClaim: (task: DailyTask) => void;
  onReturn: (task: DailyTask) => void;
  onStatus: (task: DailyTask, status: TaskStatus) => void;
  onAssign: (task: DailyTask, assignee: string) => void;
  onDelete: (task: DailyTask) => void;
  onOpen: (task: DailyTask) => void;
}) {
  return (
    <Card className="overflow-hidden">
      {/* Fase 7D: el grid xl: exige ~1122px de contenido (suma de los
          minmax de cada columna) + 32px de padding. Entre el breakpoint
          xl (1280px) y ~1470px, el área de contenido (viewport - sidebar
          256px - padding de página) puede ser menor a eso. Antes esto
          vivía dentro de un Card con overflow-hidden: las columnas
          Responsable/Acción principal quedaban recortadas sin forma de
          alcanzarlas. Ahora el desbordamiento es un scroll horizontal
          contenido en este wrapper, nunca en la página. */}
      <div className="overflow-x-auto">
        <div className="xl:min-w-[1160px]">
          <div className="hidden grid-cols-[minmax(220px,2fr)_minmax(130px,1fr)_minmax(130px,1fr)_140px_100px_minmax(150px,1fr)_minmax(180px,1.2fr)] gap-3 border-b bg-primary/5 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground xl:grid">
            <span>Tarea</span>
            <span>Cliente</span>
            <span>Expediente</span>
            <span>Estado</span>
            <span>Prioridad</span>
            <span>Responsable</span>
            <span>Acción principal</span>
          </div>
          {tasks.map((task) => {
            const vs = getTaskVisualState(task, userId);
            const available = vs.canClaim;
            const own = task.assigned_to === userId;
            const isBusy = busyId === task.id;
            const Icon = vs.icon;
            return (
              <article
                key={task.id}
                aria-label={`${task.title} — ${vs.ariaDescription}`}
                className={`grid gap-3 border-b border-l-2 p-4 transition-colors last:border-b-0 xl:grid-cols-[minmax(220px,2fr)_minmax(130px,1fr)_minmax(130px,1fr)_140px_100px_minmax(150px,1fr)_minmax(180px,1.2fr)] xl:items-center ${vs.rowBg} ${vs.accentBorder} ${claimedId === task.id ? "animate-task-claimed" : ""}`}
              >
                {/* Título + descripción */}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Icon
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <h3 className="truncate font-semibold" title={task.title}>
                      {task.title}
                    </h3>
                  </div>
                  {task.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {task.description}
                    </p>
                  )}
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <CalendarDays className="h-3 w-3" /> {task.scheduled_for}
                    {task.due_date && (
                      <> · vence {new Date(task.due_date).toLocaleString("es-PE")}</>
                    )}
                  </p>
                </div>

                {/* Cliente */}
                {(() => {
                  const resolvedClientId = task.client_id ?? task.cases?.client_id;
                  const resolvedClientName = task.cases?.clients?.name || task.clients?.name;
                  return resolvedClientId ? (
                    <Link
                      to={"/clientes/$id" as never}
                      params={{ id: resolvedClientId } as never}
                      className="truncate text-sm hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:rounded-sm"
                      title={resolvedClientName ?? undefined}
                    >
                      {resolvedClientName}
                    </Link>
                  ) : (
                    <span className="truncate text-sm text-muted-foreground">General</span>
                  );
                })()}

                {/* Expediente — lleva a la ficha del expediente, no al cliente:
                el número identifica precisamente al expediente, y desde su
                ficha ya hay acceso directo al cliente. */}
                {task.case_id && task.cases ? (
                  <Link
                    to={"/casos/$id" as never}
                    params={{ id: task.case_id } as never}
                    className="truncate text-sm font-mono text-xs hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:rounded-sm"
                    title={task.cases.case_number || task.cases.expediente}
                  >
                    {task.cases.case_number || task.cases.expediente}
                  </Link>
                ) : (
                  <span className="truncate text-sm font-mono text-xs text-muted-foreground">
                    Sin expediente
                  </span>
                )}

                {/* Estado — una tarea disponible (sin tomar) nunca muestra un
                select interactivo: parecía un control roto (QA-007). Debe
                tomarse primero para poder cambiar su estado. */}
                {available ? (
                  <span
                    className="inline-flex w-fit items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary"
                    title="Primero debes tomar la tarea para cambiar su estado."
                  >
                    <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
                    Disponible — tómala primero
                  </span>
                ) : isAdmin || own ? (
                  <NativeSelect
                    value={normalizeTaskStatus(task.status)}
                    onChange={(event) => onStatus(task, event.target.value as TaskStatus)}
                    disabled={isBusy}
                    className="min-h-11 rounded-lg border bg-background pl-2 pr-8 text-xs"
                    aria-label="Cambiar estado de tarea"
                  >
                    {TASK_STATUSES.map((item) => (
                      <option key={item} value={item}>
                        {TASK_STATUS_LABELS[item]}
                      </option>
                    ))}
                  </NativeSelect>
                ) : (
                  <span
                    className={`inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${vs.badgeClasses}`}
                  >
                    <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
                    {vs.label}
                  </span>
                )}

                {/* Prioridad */}
                <TaskPriorityBadge priority={task.priority} />

                {/* Responsable — el select solo asigna a una persona; "liberar" es
                un botón aparte con su propio target táctil, en vez de una
                opción de texto largo dentro del select (chocaba con la
                flecha nativa al perder el padding derecho reservado). */}
                {isAdmin ? (
                  <div className="flex min-w-0 items-center gap-1.5">
                    <NativeSelect
                      value={task.assigned_to ?? ""}
                      onChange={(event) => onAssign(task, event.target.value)}
                      disabled={isBusy}
                      className="min-h-11 min-w-0 flex-1 rounded-lg border bg-background pl-2 pr-8 text-xs"
                      aria-label="Asignar responsable"
                    >
                      <option value="">Sin asignar</option>
                      {profiles
                        .filter((item) => item.status === "Activo")
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.full_name}
                          </option>
                        ))}
                    </NativeSelect>
                    {task.assigned_to && (
                      <button
                        type="button"
                        onClick={() => onAssign(task, "")}
                        disabled={isBusy}
                        title="Liberar a Disponibles"
                        aria-label={`Liberar a Disponibles: ${task.title}`}
                        className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-lg border transition-colors hover:bg-muted/50 disabled:opacity-50"
                      >
                        <UserX className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                ) : (
                  <span className="truncate text-sm" title={task.assignee?.full_name ?? undefined}>
                    {task.assignee?.full_name || (
                      <span className="text-muted-foreground">Sin asignar</span>
                    )}
                  </span>
                )}

                {/* Acciones */}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onOpen(task)}
                    className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    <MessageSquareText className="h-4 w-4" aria-hidden="true" />
                    Ver detalle
                  </button>

                  {available && (
                    <button
                      type="button"
                      onClick={() => onClaim(task)}
                      disabled={isBusy}
                      aria-label={`Tomar tarea: ${task.title}`}
                      className="inline-flex h-9 min-w-[120px] items-center justify-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition-shadow hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
                    >
                      {isBusy ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          <span>Tomando…</span>
                        </>
                      ) : (
                        <>
                          <Hand className="h-4 w-4" aria-hidden="true" />
                          <span>Tomar tarea</span>
                        </>
                      )}
                    </button>
                  )}

                  {own && !isAdmin && normalizeTaskStatus(task.status) !== "completed" && (
                    <button
                      type="button"
                      onClick={() => onReturn(task)}
                      disabled={isBusy}
                      className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors hover:bg-muted/50 disabled:opacity-50"
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                      Devolver tarea
                    </button>
                  )}

                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => onDelete(task)}
                      disabled={isBusy}
                      className="grid min-h-11 min-w-11 place-items-center rounded-lg border border-destructive/30 text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                      aria-label={`Eliminar tarea: ${task.title}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
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

/** Variante de DetailValue que navega a la ficha relacionada (Cliente/Expediente). */
function DetailLink({
  label,
  value,
  to,
  params,
  className = "",
}: {
  label: string;
  value: string;
  to: string;
  params: Record<string, string>;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <Link
        to={to as never}
        params={params as never}
        className="mt-1 inline-block text-sm font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:rounded-sm"
      >
        {value}
      </Link>
    </div>
  );
}

function TaskBoard({ tasks, userId }: { tasks: DailyTask[]; userId?: string }) {
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      {TASK_STATUSES.map((status) => {
        const rows = tasks.filter((task) => normalizeTaskStatus(task.status) === status);
        const columnAccent: Record<string, string> = {
          pending: "border-t-primary/40",
          in_progress: "border-t-[var(--task-progress)]/60",
          ready_to_file: "border-t-success/60",
          blocked: "border-t-destructive/60",
          completed: "border-t-muted-foreground/30",
        };
        return (
          <section key={status} aria-label={`Columna: ${TASK_STATUS_LABELS[status]}`}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">{TASK_STATUS_LABELS[status]}</h2>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{rows.length}</span>
            </div>
            <div
              className={`min-h-28 space-y-2 rounded-xl border-t-2 bg-muted/35 p-2 ${columnAccent[status] ?? ""}`}
            >
              {rows.map((task) => {
                const vs = getTaskVisualState(task, userId);
                return (
                  <Card key={task.id} className={`border-l-2 p-3 ${vs.accentBorder}`}>
                    <p className="text-sm font-semibold line-clamp-2" title={task.title}>
                      {task.title}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <TaskPriorityBadge priority={task.priority} iconOnly />
                      <span
                        className="text-xs text-muted-foreground truncate"
                        title={task.assignee?.full_name ?? undefined}
                      >
                        {task.assignee?.full_name || "Sin asignar"}
                      </span>
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TaskChip({ status, userId }: { status: string; userId?: string }) {
  const vs = getTaskVisualState({ status, assigned_to: null }, userId);
  const Icon = vs.icon;
  return (
    <span
      className={`inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${vs.badgeClasses}`}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      {TASK_STATUS_LABELS[normalizeTaskStatus(status)]}
    </span>
  );
}

function Metric({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
      {hint && <p className="mt-0.5 text-[10px] text-muted-foreground/80">{hint}</p>}
    </Card>
  );
}
