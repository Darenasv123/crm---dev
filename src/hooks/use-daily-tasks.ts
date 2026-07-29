import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { getAuthClient } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";
import { addDaysToISO, getPeruTodayISO, PERU_UTC_OFFSET } from "@/lib/peru-time";
import {
  classifyTask,
  normalizeTaskStatus,
  type TaskFormValues,
  validateTaskForm,
} from "@/lib/tasks";

type CaseTask = Database["public"]["Tables"]["case_tasks"]["Row"];
type CaseTaskInsert = Database["public"]["Tables"]["case_tasks"]["Insert"];
type CaseTaskUpdate = Database["public"]["Tables"]["case_tasks"]["Update"];

export interface DailyTask extends CaseTask {
  assignee: {
    id: string;
    full_name: string;
    initials: string;
    role: string;
    status: string;
  } | null;
  creator: { id: string; full_name: string; initials: string } | null;
  completer: { id: string; full_name: string; initials: string } | null;
  cases: {
    id: string;
    client_id: string;
    expediente: string;
    case_number: string | null;
    process_type: string;
    clients: { id: string; name: string; initials: string } | null;
  } | null;
  clients: { id: string; name: string; initials: string } | null;
}

export type DailyTaskView = "today" | "upcoming" | "calendar";

export type DailyTaskFilters = {
  view: DailyTaskView;
  selectedDate: string;
  endDate?: string;
  assignedTo?: string;
  status?: string;
  priority?: string;
  clientId?: string;
  caseId?: string;
  search?: string;
  showCompleted?: boolean;
  overdueOnly?: boolean;
  withoutClient?: boolean;
  withoutCase?: boolean;
  limit?: number;
  enabled?: boolean;
};

export const dailyTaskKeys = {
  all: ["daily-tasks"] as const,
  list: (filters: DailyTaskFilters) => ["daily-tasks", "list", filters] as const,
  clients: ["daily-tasks", "lookups", "clients"] as const,
  cases: (clientId?: string) => ["daily-tasks", "lookups", "cases", clientId ?? "all"] as const,
};

const taskSelect = `
  *,
  assignee:profiles!case_tasks_assigned_to_fkey(id, full_name, initials, role, status),
  creator:profiles!case_tasks_created_by_fkey(id, full_name, initials),
  completer:profiles!case_tasks_completed_by_fkey(id, full_name, initials),
  cases(id, client_id, expediente, case_number, process_type, clients(id, name, initials)),
  clients(id, name, initials)
`;

function dayBounds(date: string) {
  return {
    start: new Date(`${date}T00:00:00${PERU_UTC_OFFSET}`).toISOString(),
    end: new Date(`${date}T23:59:59${PERU_UTC_OFFSET}`).toISOString(),
  };
}

export function useDailyTasks(filters: DailyTaskFilters) {
  return useQuery({
    queryKey: dailyTaskKeys.list(filters),
    queryFn: async () => {
      const db = await getAuthClient();
      const bounds = dayBounds(filters.selectedDate);
      let clientCaseIds: string[] = [];
      if (filters.clientId && !filters.caseId) {
        const { data: relatedCases, error: caseError } = await db
          .from("cases")
          .select("id")
          .eq("client_id", filters.clientId)
          .limit(200);
        if (caseError) throw new Error(caseError.message);
        clientCaseIds = (relatedCases ?? []).map((item) => item.id);
      }
      let query = db
        .from("case_tasks")
        .select(taskSelect)
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(filters.limit ?? (filters.view === "upcoming" ? 100 : 200));

      if (filters.overdueOnly) {
        query = query.lt("due_date", new Date().toISOString()).neq("status", "completed");
      } else if (filters.view === "today") {
        query = query.or(
          `and(due_date.lte.${bounds.end},status.neq.completed),and(completed_at.gte.${bounds.start},completed_at.lte.${bounds.end})`,
        );
      } else if (filters.view === "upcoming") {
        const endDate = filters.endDate ?? addDaysToISO(filters.selectedDate, 90);
        query = query
          .gt("due_date", bounds.end)
          .lte("due_date", dayBounds(endDate).end)
          .neq("status", "completed");
      } else {
        const endDate = filters.endDate ?? addDaysToISO(filters.selectedDate, 42);
        query = query.gte("due_date", bounds.start).lte("due_date", dayBounds(endDate).end);
      }

      if (filters.assignedTo) query = query.eq("assigned_to", filters.assignedTo);
      if (filters.status) query = query.eq("status", filters.status);
      if (filters.priority) {
        query =
          filters.priority === "Normal"
            ? query.in("priority", ["Normal", "Media"])
            : query.eq("priority", filters.priority);
      }
      if (filters.clientId) {
        query =
          clientCaseIds.length > 0
            ? query.or(`client_id.eq.${filters.clientId},case_id.in.(${clientCaseIds.join(",")})`)
            : query.eq("client_id", filters.clientId);
      }
      if (filters.caseId) query = query.eq("case_id", filters.caseId);
      if (filters.withoutClient) {
        query = query.is("client_id", null).is("case_id", null);
      }
      if (filters.withoutCase) query = query.is("case_id", null);
      if (filters.search?.trim()) {
        query = query.ilike("title", `%${filters.search.trim()}%`);
      }
      if (!filters.showCompleted && filters.view !== "today") {
        query = query.neq("status", "completed");
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return data as unknown as DailyTask[];
    },
    enabled: filters.enabled ?? true,
  });
}

export function useTodayTaskSummary() {
  const { user, profile } = useAuth();
  const selectedDate = getPeruTodayISO();
  const query = useDailyTasks({
    view: "today",
    selectedDate,
    assignedTo: profile?.role === "Personal" ? user?.id : undefined,
    showCompleted: true,
    limit: 200,
    enabled: !!profile && (profile.role !== "Personal" || !!user?.id),
  });
  const rows = query.data ?? [];
  const overdue = rows.filter((task) => classifyTask(task, selectedDate) === "overdue").length;
  const pendingToday = rows.filter(
    (task) =>
      normalizeTaskStatus(task.status) !== "completed" &&
      classifyTask(task, selectedDate) === "today",
  ).length;
  return {
    ...query,
    tasks: rows,
    overdue,
    pendingToday,
    attentionCount: overdue + pendingToday,
  };
}

export function useTaskClients() {
  return useQuery({
    queryKey: dailyTaskKeys.clients,
    queryFn: async () => {
      const db = await getAuthClient();
      const { data, error } = await db
        .from("clients")
        .select("id, name, initials")
        .eq("status", "Activo")
        .order("name")
        .limit(100);
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

export function useTaskCases(clientId?: string) {
  return useQuery({
    queryKey: dailyTaskKeys.cases(clientId),
    queryFn: async () => {
      const db = await getAuthClient();
      let query = db
        .from("cases")
        .select("id, client_id, expediente, case_number, process_type")
        .order("updated_at", { ascending: false })
        .limit(100);
      if (clientId) query = query.eq("client_id", clientId);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

function invalidateTaskConsumers(
  queryClient: QueryClient,
  task?:
    | (Pick<CaseTask, "case_id" | "client_id"> & {
        cases?: { client_id: string } | null;
      })
    | null,
) {
  void queryClient.invalidateQueries({ queryKey: dailyTaskKeys.all });
  void queryClient.invalidateQueries({ queryKey: ["case_tasks"] });
  void queryClient.invalidateQueries({ queryKey: ["case_events"] });
  if (task?.case_id) {
    void queryClient.invalidateQueries({ queryKey: ["cases", task.case_id] });
  }
  const clientId = task?.client_id ?? task?.cases?.client_id;
  if (clientId) {
    void queryClient.invalidateQueries({ queryKey: ["clients", clientId] });
  }
}

export function useCreateDailyTask() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      values,
      cases,
    }: {
      values: TaskFormValues;
      cases: Array<{ id: string; client_id: string }>;
    }) => {
      const payload = validateTaskForm(values, cases) as CaseTaskInsert;
      const db = await getAuthClient();
      const { data, error } = await db
        .from("case_tasks")
        .insert({
          ...payload,
          created_by: user?.id ?? null,
          source: "manual",
          verification_status: "approved",
        })
        .select(taskSelect)
        .single();
      if (error) throw new Error(error.message);
      return data as unknown as DailyTask;
    },
    onSuccess: (task) => invalidateTaskConsumers(queryClient, task),
  });
}

type TaskUpdateInput = {
  id: string;
  updates: CaseTaskUpdate;
  current: DailyTask;
};

type OptimisticContext = {
  snapshots: Array<[QueryKey, unknown]>;
};

export function useUpdateDailyTask() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation<DailyTask, Error, TaskUpdateInput, OptimisticContext>({
    mutationFn: async ({ id, updates }) => {
      const normalized: CaseTaskUpdate = { ...updates };
      if (updates.status) {
        const status = normalizeTaskStatus(updates.status);
        normalized.status = status;
        normalized.completed_at = status === "completed" ? new Date().toISOString() : null;
        normalized.completed_by = status === "completed" ? (user?.id ?? null) : null;
      }

      const db = await getAuthClient();
      const { data, error } = await db
        .from("case_tasks")
        .update(normalized)
        .eq("id", id)
        .select(taskSelect)
        .single();
      if (error) throw new Error(error.message);
      return data as unknown as DailyTask;
    },
    onMutate: async ({ id, updates }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: dailyTaskKeys.all }),
        queryClient.cancelQueries({ queryKey: ["case_tasks"] }),
      ]);
      const snapshots = queryClient.getQueriesData({ queryKey: dailyTaskKeys.all });
      queryClient.setQueriesData<DailyTask[]>(
        { queryKey: dailyTaskKeys.all },
        (rows) =>
          rows?.map((task) =>
            task.id === id
              ? {
                  ...task,
                  ...updates,
                  completed_at:
                    updates.status === "completed"
                      ? new Date().toISOString()
                      : updates.status
                        ? null
                        : task.completed_at,
                  completed_by:
                    updates.status === "completed"
                      ? (user?.id ?? null)
                      : updates.status
                        ? null
                        : task.completed_by,
                }
              : task,
          ) ?? rows,
      );
      return { snapshots };
    },
    onError: (_error, _variables, context) => {
      for (const [key, data] of context?.snapshots ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSuccess: (task) => invalidateTaskConsumers(queryClient, task),
  });
}

export function useDeleteDailyTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (task: DailyTask) => {
      const db = await getAuthClient();
      const { error } = await db.from("case_tasks").delete().eq("id", task.id);
      if (error) throw new Error(error.message);
      return task;
    },
    onSuccess: (task) => invalidateTaskConsumers(queryClient, task),
  });
}
