import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { getAuthClient } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";

type CaseParty = Database["public"]["Tables"]["case_parties"]["Row"];
type CasePartyInsert = Database["public"]["Tables"]["case_parties"]["Insert"];
type CaseEvent = Database["public"]["Tables"]["case_events"]["Row"];
type CaseEventInsert = Database["public"]["Tables"]["case_events"]["Insert"];
type CaseTask = Database["public"]["Tables"]["case_tasks"]["Row"];
type CaseTaskInsert = Database["public"]["Tables"]["case_tasks"]["Insert"];
type CaseTaskUpdate = Database["public"]["Tables"]["case_tasks"]["Update"];

export interface CaseEventWithDocument extends CaseEvent {
  documents: { name: string; storage_path: string } | null;
}

export interface CaseTaskWithAssignee extends CaseTask {
  profiles: { full_name: string; initials: string } | null;
}

export function useCaseParties(caseId: string) {
  return useQuery({
    queryKey: ["case_parties", caseId],
    queryFn: async () => {
      const db = await getAuthClient();
      const { data, error } = await db
        .from("case_parties")
        .select("*")
        .eq("case_id", caseId)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return data as CaseParty[];
    },
    enabled: !!caseId,
  });
}

export function useCreateCaseParty() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: CasePartyInsert) => {
      const db = await getAuthClient();
      const { data, error } = await db
        .from("case_parties")
        .insert({ ...input, created_by: user?.id ?? null })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (_data, input) =>
      qc.invalidateQueries({ queryKey: ["case_parties", input.case_id] }),
  });
}

export function useDeleteCaseParty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, caseId }: { id: string; caseId: string }) => {
      const db = await getAuthClient();
      const { error } = await db.from("case_parties").delete().eq("id", id);
      if (error) throw new Error(error.message);
      return caseId;
    },
    onSuccess: (caseId) => qc.invalidateQueries({ queryKey: ["case_parties", caseId] }),
  });
}

export function useCaseEvents(caseIds: string[]) {
  const stableIds = [...caseIds].sort();
  return useQuery({
    queryKey: ["case_events", stableIds],
    queryFn: async () => {
      const db = await getAuthClient();
      const { data, error } = await db
        .from("case_events")
        .select("*, documents(name, storage_path)")
        .in("case_id", stableIds)
        .order("event_date", { ascending: false });
      if (error) throw new Error(error.message);
      return data as CaseEventWithDocument[];
    },
    enabled: stableIds.length > 0,
  });
}

export function useCreateCaseEvent() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: CaseEventInsert) => {
      const db = await getAuthClient();
      const { data, error } = await db
        .from("case_events")
        .insert({ ...input, created_by: user?.id ?? null })
        .select("*, documents(name, storage_path)")
        .single();
      if (error) throw new Error(error.message);
      return data as CaseEventWithDocument;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["case_events"] }),
  });
}

export function useCaseTasks(filters: { caseId?: string; clientId?: string } = {}) {
  return useQuery({
    queryKey: ["case_tasks", filters.caseId ?? "all", filters.clientId ?? "all"],
    queryFn: async () => {
      const db = await getAuthClient();
      let query = db
        .from("case_tasks")
        .select("*, profiles!case_tasks_assigned_to_fkey(full_name, initials)")
        .order("due_date", { ascending: true, nullsFirst: false });
      if (filters.caseId) query = query.eq("case_id", filters.caseId);
      if (filters.clientId) query = query.eq("client_id", filters.clientId);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return data as CaseTaskWithAssignee[];
    },
  });
}

export function useCreateCaseTask() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: CaseTaskInsert) => {
      const db = await getAuthClient();
      const { data, error } = await db
        .from("case_tasks")
        .insert({ ...input, created_by: user?.id ?? null })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["case_tasks"] }),
  });
}

export function useUpdateCaseTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: CaseTaskUpdate }) => {
      const db = await getAuthClient();
      const normalized = {
        ...updates,
        completed_at:
          updates.status === "completed"
            ? (updates.completed_at ?? new Date().toISOString())
            : updates.status
              ? null
              : updates.completed_at,
      };
      const { data, error } = await db
        .from("case_tasks")
        .update(normalized)
        .eq("id", id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["case_tasks"] }),
  });
}

export function useDeleteCaseTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const db = await getAuthClient();
      const { error } = await db.from("case_tasks").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["case_tasks"] }),
  });
}
