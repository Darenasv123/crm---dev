import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  List,
  Plus,
  RotateCcw,
  Search,
} from "lucide-react";
import { Card } from "@/components/app-layout";
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
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  canManageTask,
  classifyTask,
  compareTasks,
  validateTaskForm,
  type TaskFormValues,
  type TaskStatus,
} from "@/lib/tasks";

type TaskCenterMode = "today" | "upcoming";
type LayoutMode = "list" | "board";

export function TaskCenter({ mode }: { mode: TaskCenterMode }) {
  const today = getPeruTodayISO();
  const [selectedDate, setSelectedDate] = useState(today);
  const [layout, setLayout] = useState<LayoutMode>("list");
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

  function resetFilters() {
    setMineOnly(personalDefault);
    setAssignee("");
    setStatus("");
    setPriority("");
    setClientId("");
    setCaseId("");
    setSearch("");
    setShowCompleted(mode === "today");
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
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div>
          <h1 className="font-display text-2xl font-bold">
            {mode === "today" ? "Mi día" : "Próximas tareas"}
          </h1>
          <p className="mt-1 text-sm capitalize text-muted-foreground">
            {formatPeruDate(`${selectedDate}T12:00:00-05:00`, {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {[
            ["overdue", "Atrasadas", counts.overdue],
            ["today", "Para hoy", counts.today],
            ["in_progress", "En proceso", counts.inProgress],
            ["ready_to_file", "Listas para ingresar", counts.ready],
            ["completed_today", "Terminadas hoy", counts.completed],
          ].map(([key, label, value]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                if (key === "completed_today") setShowCompleted(true);
                setIndicator(indicator === key ? "all" : String(key));
              }}
              className={`rounded-xl border p-4 text-left transition ${
                indicator === key
                  ? "border-primary bg-primary/5"
                  : "border-border bg-card hover:border-primary/40"
              }`}
            >
              <span className="block text-2xl font-bold">{value}</span>
              <span className="text-xs text-muted-foreground">{label}</span>
            </button>
          ))}
        </div>
      )}

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="relative xl:col-span-2">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <span className="sr-only">Buscar tarea</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por título"
              className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm"
            />
          </label>
          <FilterSelect
            label="Responsable"
            value={effectiveMineOnly ? "mine" : assignee}
            onChange={(value) => {
              setMineOnly(value === "mine");
              setAssignee(value === "mine" ? "" : value);
            }}
          >
            <option value="">Todos los responsables</option>
            <option value="mine">Mis tareas</option>
            {profiles
              .filter((item) => item.status === "Activo")
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.full_name}
                </option>
              ))}
          </FilterSelect>
          <FilterSelect label="Estado" value={status} onChange={setStatus}>
            <option value="">Todos los estados</option>
            {TASK_STATUSES.map((item) => (
              <option key={item} value={item}>
                {TASK_STATUS_LABELS[item]}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Prioridad" value={priority} onChange={setPriority}>
            <option value="">Todas las prioridades</option>
            {TASK_PRIORITIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Cliente"
            value={clientId}
            onChange={(value) => {
              setClientId(value);
              if (caseId && cases.find((item) => item.id === caseId)?.client_id !== value) {
                setCaseId("");
              }
            }}
          >
            <option value="">Todos los clientes</option>
            {clients.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Expediente" value={caseId} onChange={setCaseId}>
            <option value="">Todos los expedientes</option>
            {cases
              .filter((item) => !clientId || item.client_id === clientId)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.case_number || item.expediente || item.process_type}
                </option>
              ))}
          </FilterSelect>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showCompleted}
                onChange={(event) => setShowCompleted(event.target.checked)}
              />
              Mostrar terminadas
            </label>
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Limpiar
            </button>
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {tasks.length} tarea{tasks.length === 1 ? "" : "s"}
        </p>
        <div className="inline-flex rounded-lg border border-border p-1">
          <LayoutButton active={layout === "list"} label="Lista" onClick={() => setLayout("list")}>
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

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label>
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
      >
        {children}
      </select>
    </label>
  );
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
