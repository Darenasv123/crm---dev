import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { getAuthClient } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";
import {
  isAvailableTask,
  normalizeTaskStatus,
  validateTaskForm,
  type TaskFormValues,
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

export type DailyTaskView = "available" | "mine" | "running" | "all" | "board";

export type DailyTaskFilters = {
  view: DailyTaskView;
  userId?: string;
  assignedTo?: string;
  status?: string;
  priority?: string;
  clientId?: string;
  caseId?: string;
  search?: string;
  showCompleted?: boolean;
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

export function useDailyTasks(filters: DailyTaskFilters) {
  return useQuery({
    queryKey: dailyTaskKeys.list(filters),
    queryFn: async () => {
      const db = await getAuthClient();
      let query = db
        .from("case_tasks")
        .select(taskSelect)
        .order("created_at", { ascending: false })
        .limit(filters.limit ?? 250);

      if (filters.view === "available") {
        query = query.is("assigned_to", null).eq("status", "pending");
      } else if (filters.view === "mine") {
        if (!filters.userId) return [];
        query = query.eq("assigned_to", filters.userId);
      } else if (filters.view === "running") {
        query = query
          .not("assigned_to", "is", null)
          .in("status", ["in_progress", "ready_to_file", "blocked"]);
      }
      if (filters.assignedTo) query = query.eq("assigned_to", filters.assignedTo);
      if (filters.status) query = query.eq("status", filters.status);
      if (filters.priority) query = query.eq("priority", filters.priority);
      if (filters.clientId) query = query.eq("client_id", filters.clientId);
      if (filters.caseId) query = query.eq("case_id", filters.caseId);
      if (filters.withoutClient) query = query.is("client_id", null).is("case_id", null);
      if (filters.withoutCase) query = query.is("case_id", null);
      if (filters.search?.trim()) query = query.ilike("title", `%${filters.search.trim()}%`);
      if (!filters.showCompleted && !filters.status && filters.view !== "available") {
        query = query.neq("status", "completed").neq("status", "cancelled");
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return data as unknown as DailyTask[];
    },
    enabled: filters.enabled ?? true,
  });
}

export function usePendingTaskSummary() {
  const { user, profile } = useAuth();
  const query = useDailyTasks({
    view: "all",
    showCompleted: false,
    limit: 250,
    enabled: !!profile,
  });
  const tasks = query.data ?? [];
  const available = tasks.filter(isAvailableTask).length;
  const mine = tasks.filter(
    (task) => task.assigned_to === user?.id && normalizeTaskStatus(task.status) !== "completed",
  ).length;
  const running = tasks.filter(
    (task) => task.assigned_to && normalizeTaskStatus(task.status) === "in_progress",
  ).length;
  return {
    ...query,
    tasks,
    available,
    mine,
    running,
    attentionCount: profile?.role === "Administrador" ? available : mine,
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
        .limit(200);
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
        .limit(200);
      if (clientId) query = query.eq("client_id", clientId);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

function invalidateTaskConsumers(queryClient: QueryClient, task?: DailyTask | null) {
  void queryClient.invalidateQueries({ queryKey: dailyTaskKeys.all });
  void queryClient.invalidateQueries({ queryKey: ["case_tasks"] });
  void queryClient.invalidateQueries({ queryKey: ["case_events"] });
  if (task?.case_id) void queryClient.invalidateQueries({ queryKey: ["cases", task.case_id] });
  const clientId = task?.client_id ?? task?.cases?.client_id;
  if (clientId) void queryClient.invalidateQueries({ queryKey: ["clients", clientId] });
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

export function useClaimDailyTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: string) => {
      const db = await getAuthClient();
      const { data, error } = await db.rpc("claim_case_task", { p_task_id: taskId });
      if (error) {
        const conflict = /tomada por otro|assigned|pending/i.test(error.message);
        throw new Error(
          conflict ? "Esta tarea acaba de ser tomada por otro integrante." : error.message,
        );
      }
      return (Array.isArray(data) ? data[0] : data) as unknown as DailyTask;
    },
    onSuccess: (task) => invalidateTaskConsumers(queryClient, task),
    onError: () => void queryClient.invalidateQueries({ queryKey: dailyTaskKeys.all }),
  });
}

export function useReturnDailyTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: string) => {
      const db = await getAuthClient();
      const { data, error } = await db.rpc("return_case_task", { p_task_id: taskId });
      if (error) throw new Error(error.message);
      return (Array.isArray(data) ? data[0] : data) as unknown as DailyTask;
    },
    onSuccess: (task) => invalidateTaskConsumers(queryClient, task),
  });
}

export function useUpdateDailyTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: CaseTaskUpdate;
      current?: DailyTask;
    }) => {
      const db = await getAuthClient();
      const { data, error } = await db
        .from("case_tasks")
        .update(updates)
        .eq("id", id)
        .select(taskSelect)
        .single();
      if (error) throw new Error(error.message);
      return data as unknown as DailyTask;
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
