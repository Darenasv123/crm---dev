import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getAuthClient } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";
import { invalidateCrmQueries } from "@/lib/query-invalidation";

type Case = Database["public"]["Tables"]["cases"]["Row"];
type CaseInsert = Database["public"]["Tables"]["cases"]["Insert"];
type CaseUpdate = Database["public"]["Tables"]["cases"]["Update"];
type QueryOptions = { enabled?: boolean };

export interface CaseWithClient extends Case {
  clients: {
    name: string;
    initials: string;
    color: string;
    phone?: string | null;
    email?: string | null;
    status?: string;
  } | null;
}

export function useCases(options: QueryOptions = {}) {
  return useQuery({
    queryKey: ["cases"],
    queryFn: async () => {
      const db = await getAuthClient();
      const { data, error } = await db
        .from("cases")
        .select("*, clients(name, initials, color)")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data as CaseWithClient[];
    },
    enabled: options.enabled ?? true,
  });
}

export function useCase(id: string) {
  return useQuery({
    queryKey: ["cases", id],
    queryFn: async () => {
      const db = await getAuthClient();
      const { data, error } = await db
        .from("cases")
        .select("*, clients(name, initials, color, phone, email, status)")
        .eq("id", id)
        .single();
      if (error) throw new Error(error.message);
      return data as CaseWithClient;
    },
    enabled: !!id,
  });
}

function createPayload(input: CaseInsert): CaseInsert {
  return {
    client_id: input.client_id,
    expediente: input.expediente,
    materia: input.materia,
    process_type: input.process_type,
    status: input.status,
    ...(input.case_name && { case_name: input.case_name }),
    ...(input.case_type && { case_type: input.case_type }),
    ...(input.case_number && { case_number: input.case_number }),
    ...(input.current_summary && { current_summary: input.current_summary }),
    ...(input.current_status_description && {
      current_status_description: input.current_status_description,
    }),
    ...(input.next_action && { next_action: input.next_action }),
    ...(input.next_hearing && { next_hearing: input.next_hearing }),
  };
}

export function useCreateCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CaseInsert) => {
      const db = await getAuthClient();
      const { data, error } = await db.from("cases").insert(createPayload(input)).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (data) =>
      invalidateCrmQueries(queryClient, { caseId: data?.id, clientId: data?.client_id }),
  });
}

export function useUpdateCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: CaseUpdate }) => {
      const allowed = [
        "client_id",
        "expediente",
        "materia",
        "process_type",
        "status",
        "case_name",
        "case_type",
        "case_number",
        "current_summary",
        "current_status_description",
        "next_action",
        "next_hearing",
        "responsible_user_id",
        "priority",
      ] as const;
      const payload: CaseUpdate = {};
      for (const key of allowed) {
        const value = updates[key];
        if (value !== undefined) Object.assign(payload, { [key]: value });
      }
      const db = await getAuthClient();
      const { data, error } = await db.from("cases").update(payload).eq("id", id).select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (data, { id }) =>
      invalidateCrmQueries(queryClient, { caseId: id, clientId: data?.client_id }),
  });
}
