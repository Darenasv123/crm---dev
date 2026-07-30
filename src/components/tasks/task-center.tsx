import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Filter,
  List,
  Plus,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { Card } from "@/components/app-layout";
import {
  countActiveTaskFilters,
  type TaskAdvancedFilters,
} from "@/components/tasks/task-filter-utils";
import { TaskFiltersSheet } from "@/components/tasks/task-filters-sheet";
import { TaskFormSheet } from "@/components/tasks/task-form-sheet";
import { TaskBoard, TaskDetailSheet, TaskError, TaskList } from "@/components/tasks/task-views";
import { useAuth } from "@/hooks/use-auth";
import {
  useCreateDailyTask,
  useDailyTasks,
  useDeleteDailyTask,
  useTaskCases,
  useTaskClients,
  useUpdateDailyTask,
  type DailyTask,
} from "@/hooks/use-daily-tasks";
import { useProfiles } from "@/hooks/use-profiles";
import { addDaysToISO, formatPeruDate, getPeruTodayISO } from "@/lib/peru-time";
import {
  canManageTask,
  classifyTask,
  compareTasks,
  validateTaskForm,
  type TaskFormValues,
  type TaskStatus,
} from "@/lib/tasks";

type TaskCenterMode = "today" | "upcoming";
type LayoutMode = "list" | "board";

export function TaskCenter({
  mode,
  initialLayout = "list",
  lockLayout = false,
}: {
  mode: TaskCenterMode;
  initialLayout?: LayoutMode;
  lockLayout?: boolean;
}) {
  const today = getPeruTodayISO();
  const [selectedDate, setSelectedDate] = useState(today);
  const [layout, setLayout] = useState<LayoutMode>(initialLayout);
  const { user, profile } = useAuth();
  const personalDefault = profile?.role === "Personal";
  const [mineOnly, setMineOnly] = useState(personalDefault);
  const [scopeInitialized, setScopeInitialized] = useState(false);
  const [assignee, setAssignee] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [clientId, setClientId] = useState("");
  const [caseId, setCaseId] = useState("");
  const [search, setSearch] = useState("");
  const [showCompleted, setShowCompleted] = useState(mode === "today");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [withoutClient, setWithoutClient] = useState(false);
  const [withoutCase, setWithoutCase] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [indicator, setIndicator] = useState<string>("all");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [formOpen, setFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<DailyTask | null>(null);
  const [detailTask, setDetailTask] = useState<DailyTask | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: clients = [] } = useTaskClients();
  const { data: cases = [] } = useTaskCases();
  const { data: profiles = [] } = useProfiles();
  const createTask = useCreateDailyTask();
  const updateTask = useUpdateDailyTask();
  const deleteTask = useDeleteDailyTask();

  useEffect(() => {
    if (!scopeInitialized && profile) {
      setMineOnly(profile.role === "Personal");
      setScopeInitialized(true);
    }
  }, [profile, scopeInitialized]);

  const effectiveMineOnly = profile?.role === "Personal" && !scopeInitialized ? true : mineOnly;

  const filters = {
    view: mode,
    selectedDate,
    assignedTo: effectiveMineOnly ? (user?.id ?? "") : assignee || undefined,
    status: status || undefined,
    priority: priority || undefined,
    clientId: clientId || undefined,
    caseId: caseId || undefined,
    search: search || undefined,
    showCompleted,
    overdueOnly,
    withoutClient,
    withoutCase,
    limit: mode === "today" ? 200 : 100,
    enabled: !effectiveMineOnly || !!user?.id,
  } as const;
  const tasksQuery = useDailyTasks(filters);
  const tasks = useMemo(() => {
    const rows = [...(tasksQuery.data ?? [])]
      .filter((task) => showCompleted || task.status !== "completed")
      .sort((left, right) => compareTasks(left, right));
    if (indicator === "all") return rows;
    if (indicator === "overdue") {
      return rows.filter((task) => classifyTask(task, selectedDate) === "overdue");
    }
    if (indicator === "today") {
      return rows.filter((task) => classifyTask(task, selectedDate) === "today");
    }
    if (indicator === "completed_today") {
      return rows.filter((task) => classifyTask(task, selectedDate) === "completed_today");
    }
    return rows.filter((task) => task.status === indicator);
  }, [indicator, selectedDate, showCompleted, tasksQuery.data]);

  const counts = useMemo(() => {
    const rows = tasksQuery.data ?? [];
    return {
      overdue: rows.filter((task) => classifyTask(task, selectedDate) === "overdue").length,
      today: rows.filter((task) => classifyTask(task, selectedDate) === "today").length,
      inProgress: rows.filter((task) => task.status === "in_progress").length,
      ready: rows.filter((task) => task.status === "ready_to_file").length,
      completed: rows.filter((task) => classifyTask(task, selectedDate) === "completed_today")
        .length,
    };
  }, [selectedDate, tasksQuery.data]);

  const groups = useMemo(() => {
    if (mode === "upcoming") {
      const weekEnd = addDaysToISO(selectedDate, 7);
      return [
        {
          key: "next-week",
          label: "Próximos 7 días",
          rows: tasks.filter((task) => !!task.due_date && formatTaskISO(task.due_date) <= weekEnd),
        },
        {
          key: "later",
          label: "Más adelante",
          rows: tasks.filter((task) => !!task.due_date && formatTaskISO(task.due_date) > weekEnd),
        },
      ];
    }
    return [
      {
        key: "overdue",
        label: "Atrasadas",
        rows: tasks.filter((task) => classifyTask(task, selectedDate) === "overdue"),
      },
      {
        key: "today",
        label: "Para hoy",
        rows: tasks.filter((task) => classifyTask(task, selectedDate) === "today"),
      },
      {
        key: "completed",
        label: "Terminadas hoy",
        rows: tasks.filter((task) => classifyTask(task, selectedDate) === "completed_today"),
      },
    ];
  }, [mode, selectedDate, tasks]);

  const permissions = canManageTask(profile?.role, user?.id, editingTask?.assigned_to ?? null);
  const advancedFilters: TaskAdvancedFilters = {
    assignee,
    status,
    priority,
    clientId,
    caseId,
    overdueOnly,
    showCompleted,
    withoutClient,
    withoutCase,
  };
  const activeChips = [
    assignee
      ? {
          key: "assignee",
          label: profiles.find((item) => item.id === assignee)?.full_name ?? "Responsable",
          clear: () => setAssignee(""),
        }
      : null,
    status
      ? {
          key: "status",
          label: `Estado: ${statusLabel(status)}`,
          clear: () => setStatus(""),
        }
      : null,
    priority
      ? {
          key: "priority",
          label: `Prioridad: ${priority}`,
          clear: () => setPriority(""),
        }
      : null,
    clientId
      ? {
          key: "client",
          label: clients.find((item) => item.id === clientId)?.name ?? "Cliente",
          clear: () => {
            setClientId("");
            setCaseId("");
          },
        }
      : null,
    caseId
      ? {
          key: "case",
          label: caseLabel(cases.find((item) => item.id === caseId)) ?? "Expediente",
          clear: () => setCaseId(""),
        }
      : null,
    overdueOnly
      ? {
          key: "overdue",
          label: "Solo vencidas",
          clear: () => setOverdueOnly(false),
        }
      : null,
    showCompleted !== (mode === "today")
      ? {
          key: "completed",
          label: showCompleted ? "Mostrar terminadas" : "Ocultar terminadas",
          clear: () => setShowCompleted(mode === "today"),
        }
      : null,
    withoutClient
      ? {
          key: "without-client",
          label: "Sin cliente",
          clear: () => setWithoutClient(false),
        }
      : null,
    withoutCase
      ? {
          key: "without-case",
          label: "Sin expediente",
          clear: () => setWithoutCase(false),
        }
      : null,
    indicator !== "all"
      ? {
          key: "indicator",
          label: `Métrica: ${indicatorLabel(indicator)}`,
          clear: () => setIndicator("all"),
        }
      : null,
  ].filter((item): item is { key: string; label: string; clear: () => void } => item !== null);
  const activeFilterCount = countActiveTaskFilters(advancedFilters, mode === "today", indicator);

  function updateAdvancedFilters(updates: Partial<TaskAdvancedFilters>) {
    if (updates.assignee !== undefined) {
      setAssignee(updates.assignee);
      if (updates.assignee) setMineOnly(false);
    }
    if (updates.status !== undefined) setStatus(updates.status);
    if (updates.priority !== undefined) setPriority(updates.priority);
    if (updates.clientId !== undefined) setClientId(updates.clientId);
    if (updates.caseId !== undefined) setCaseId(updates.caseId);
    if (updates.overdueOnly !== undefined) setOverdueOnly(updates.overdueOnly);
    if (updates.showCompleted !== undefined) setShowCompleted(updates.showCompleted);
    if (updates.withoutClient !== undefined) setWithoutClient(updates.withoutClient);
    if (updates.withoutCase !== undefined) setWithoutCase(updates.withoutCase);
  }

  function resetFilters() {
    setMineOnly(personalDefault);
    setAssignee("");
    setStatus("");
    setPriority("");
    setClientId("");
    setCaseId("");
    setSearch("");
    setShowCompleted(mode === "today");
    setOverdueOnly(false);
    setWithoutClient(false);
    setWithoutCase(false);
    setIndicator("all");
  }

  async function submit(values: TaskFormValues) {
    setActionError(null);
    try {
      if (editingTask) {
        const validated = validateTaskForm(values, cases);
        const updates = permissions.canEditAll
          ? validated
          : {
              status: values.status,
              description: values.description.trim() || null,
            };
        const saved = await updateTask.mutateAsync({
          id: editingTask.id,
          updates,
          current: editingTask,
        });
        setDetailTask(saved);
      } else {
        await createTask.mutateAsync({ values, cases });
      }
      setEditingTask(null);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "No se pudo guardar la tarea.";
      setActionError(message);
      throw reason;
    }
  }

  async function changeStatus(task: DailyTask, nextStatus: TaskStatus) {
    setActionError(null);
    try {
      const saved = await updateTask.mutateAsync({
        id: task.id,
        updates: { status: nextStatus },
        current: task,
      });
      if (detailTask?.id === task.id) setDetailTask(saved);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "No se pudo actualizar el estado.");
    }
  }

  async function removeTask(task: DailyTask) {
    if (!window.confirm(`¿Eliminar la tarea “${task.title}”? Esta acción no se puede deshacer.`)) {
      return;
    }
    setActionError(null);
    try {
      await deleteTask.mutateAsync(task);
      setDetailTask(null);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "No se pudo eliminar la tarea.");
    }
  }

  function openEdit(task: DailyTask) {
    setDetailTask(null);
    setEditingTask(task);
    setFormOpen(true);
  }

  const renderRows = (rows: DailyTask[]) =>
    layout === "board" ? (
      <TaskBoard
        tasks={rows}
        role={profile?.role}
        userId={user?.id}
        onOpen={setDetailTask}
        onStatus={changeStatus}
      />
    ) : (
      <TaskList
        tasks={rows}
        role={profile?.role}
        userId={user?.id}
        onOpen={setDetailTask}
        onEdit={openEdit}
        onStatus={changeStatus}
        onDelete={removeTask}
      />
    );

  return (
    <div className="w-full max-w-none space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-40">
          <h2 className="text-base font-bold">{mode === "today" ? "Mi día" : "Próximas tareas"}</h2>
          <p className="text-xs capitalize text-muted-foreground">
            {formatPeruDate(`${selectedDate}T12:00:00-05:00`, {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </p>
        </div>
        <div className="ml-auto flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border p-1">
            <button
              type="button"
              aria-label="Día anterior"
              onClick={() => setSelectedDate(addDaysToISO(selectedDate, -1))}
              className="rounded-md p-2 hover:bg-muted"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setSelectedDate(today)}
              className="px-3 text-sm font-semibold hover:bg-muted"
            >
              Hoy
            </button>
            <button
              type="button"
              aria-label="Día siguiente"
              onClick={() => setSelectedDate(addDaysToISO(selectedDate, 1))}
              className="rounded-md p-2 hover:bg-muted"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <label className="relative min-w-48 flex-1 lg:min-w-72">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <span className="sr-only">Buscar tarea</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por título"
              className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm"
            />
          </label>
          <div
            aria-label="Alcance de tareas"
            className="inline-flex h-10 rounded-lg border border-border p-1"
          >
            <button
              type="button"
              aria-pressed={effectiveMineOnly}
              onClick={() => {
                setMineOnly(true);
                setAssignee("");
              }}
              className={`rounded-md px-3 text-xs font-semibold ${
                effectiveMineOnly ? "bg-muted text-foreground" : "text-muted-foreground"
              }`}
            >
              Mis tareas
            </button>
            <button
              type="button"
              aria-pressed={!effectiveMineOnly && !assignee}
              onClick={() => {
                setMineOnly(false);
                setAssignee("");
              }}
              className={`rounded-md px-3 text-xs font-semibold ${
                !effectiveMineOnly && !assignee
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              Todas
            </button>
          </div>
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-muted/60"
          >
            <Filter className="h-4 w-4" />
            Filtros{activeFilterCount > 0 ? ` ${activeFilterCount}` : ""}
          </button>
          {canManageTask(profile?.role, user?.id, null).canCreate && (
            <button
              type="button"
              onClick={() => {
                setEditingTask(null);
                setFormOpen(true);
              }}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
            >
              <Plus className="h-4 w-4" /> Nueva tarea
            </button>
          )}
        </div>
      </div>

      {mode === "today" && (
        <div
          aria-label="Resumen de tareas"
          className="flex overflow-x-auto rounded-lg border border-border bg-card"
        >
          {[
            ["overdue", "Vencidas", counts.overdue],
            ["today", "Para hoy", counts.today],
            ["in_progress", "En proceso", counts.inProgress],
            ["ready_to_file", "Listas para ingresar", counts.ready],
            ["completed_today", "Terminadas hoy", counts.completed],
          ].map(([key, label, value]) => (
            <button
              key={key}
              type="button"
              aria-pressed={indicator === key}
              onClick={() => {
                if (key === "completed_today") setShowCompleted(true);
                setIndicator(indicator === key ? "all" : String(key));
              }}
              className={`flex min-w-fit flex-1 items-center justify-center gap-2 border-r border-border px-3 py-2 text-xs last:border-r-0 ${
                indicator === key
                  ? "bg-primary/10 font-semibold text-primary"
                  : "text-muted-foreground hover:bg-muted/40"
              }`}
            >
              <span className="font-bold text-foreground">{value}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}

      {activeChips.length > 0 && (
        <div aria-label="Filtros activos" className="flex flex-wrap items-center gap-2">
          {activeChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.clear}
              aria-label={`Quitar filtro ${chip.label}`}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 text-xs font-medium text-primary"
            >
              {chip.label} <X className="h-3.5 w-3.5" />
            </button>
          ))}
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Limpiar todo
          </button>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {tasks.length} tarea{tasks.length === 1 ? "" : "s"}
        </p>
        {!lockLayout && (
          <div className="inline-flex rounded-lg border border-border p-1">
            <LayoutButton
              active={layout === "list"}
              label="Lista"
              onClick={() => setLayout("list")}
            >
              <List className="h-4 w-4" />
            </LayoutButton>
            <LayoutButton
              active={layout === "board"}
              label="Tablero"
              onClick={() => setLayout("board")}
            >
              <Columns3 className="h-4 w-4" />
            </LayoutButton>
          </div>
        )}
      </div>

      {actionError && <TaskError message={actionError} />}
      {tasksQuery.isError && (
        <TaskError
          message={
            tasksQuery.error instanceof Error
              ? tasksQuery.error.message
              : "No se pudieron cargar las tareas."
          }
        />
      )}
      {tasksQuery.isLoading ? (
        <TaskSkeleton />
      ) : tasks.length === 0 ? (
        <Card className="py-14 text-center">
          <CalendarDays className="mx-auto h-9 w-9 text-muted-foreground/60" />
          <h2 className="mt-3 font-semibold">No hay tareas en esta vista</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Ajusta los filtros o crea una nueva tarea.
          </p>
        </Card>
      ) : layout === "board" ? (
        renderRows(tasks)
      ) : (
        <div className="space-y-5">
          {groups
            .filter((group) => group.rows.length > 0)
            .map((group) => (
              <section key={group.key} aria-labelledby={`group-${group.key}`}>
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((current) => ({
                      ...current,
                      [group.key]: !current[group.key],
                    }))
                  }
                  className="mb-2 flex w-full items-center justify-between text-left"
                >
                  <h2 id={`group-${group.key}`} className="font-semibold">
                    {group.label}{" "}
                    <span className="text-sm font-normal text-muted-foreground">
                      ({group.rows.length})
                    </span>
                  </h2>
                  <ChevronDown
                    className={`h-4 w-4 transition ${collapsed[group.key] ? "-rotate-90" : ""}`}
                  />
                </button>
                {!collapsed[group.key] && renderRows(group.rows)}
              </section>
            ))}
        </div>
      )}

      <TaskFiltersSheet
        open={filtersOpen}
        filters={advancedFilters}
        clients={clients}
        cases={cases}
        profiles={profiles}
        hasActiveFilters={activeFilterCount > 0}
        onOpenChange={setFiltersOpen}
        onChange={updateAdvancedFilters}
        onClear={resetFilters}
      />
      <TaskFormSheet
        open={formOpen}
        task={editingTask}
        defaultAssignee={user?.id}
        initialDate={selectedDate}
        clients={clients}
        cases={cases}
        profiles={profiles}
        saving={createTask.isPending || updateTask.isPending}
        externalError={actionError}
        canReassign={permissions.canReassign}
        canEditAll={permissions.canEditAll}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditingTask(null);
        }}
        onSubmit={submit}
      />
      <TaskDetailSheet
        task={detailTask}
        role={profile?.role}
        userId={user?.id}
        onClose={() => setDetailTask(null)}
        onEdit={openEdit}
        onStatus={changeStatus}
        onDelete={removeTask}
      />
    </div>
  );
}

function formatTaskISO(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function statusLabel(status: string) {
  return (
    {
      pending: "Pendiente",
      in_progress: "En proceso",
      ready_to_file: "Listo para ingresar",
      completed: "Terminado",
      blocked: "Bloqueado",
    }[status] ?? status
  );
}

function indicatorLabel(indicator: string) {
  return (
    {
      overdue: "Vencidas",
      today: "Para hoy",
      in_progress: "En proceso",
      ready_to_file: "Listas para ingresar",
      completed_today: "Terminadas hoy",
    }[indicator] ?? indicator
  );
}

function caseLabel(
  item:
    | {
        expediente: string;
        case_number: string | null;
        process_type: string;
      }
    | undefined,
) {
  return item?.case_number || item?.expediente || item?.process_type;
}

function LayoutButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${
        active ? "bg-muted font-semibold" : "text-muted-foreground"
      }`}
    >
      {children} {label}
    </button>
  );
}

function TaskSkeleton() {
  return (
    <div aria-label="Cargando tareas" className="space-y-3">
      {[0, 1, 2, 3].map((item) => (
        <div
          key={item}
          className="h-16 animate-pulse rounded-xl border border-border bg-muted/50"
        />
      ))}
    </div>
  );
}
