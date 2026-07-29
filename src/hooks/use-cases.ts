import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAuthClient } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";
import { invalidateCrmQueries } from "@/lib/query-invalidation";

type Case = Database["public"]["Tables"]["cases"]["Row"];
type CaseInsert = Database["public"]["Tables"]["cases"]["Insert"];
type CaseUpdate = Database["public"]["Tables"]["cases"]["Update"];
type QueryOptions = { enabled?: boolean };

export interface CaseWithClient extends Case {
  clients: { name: string; initials: string; color: string } | null;
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
        .select("*, clients(name, initials, color, phone, email, process_type, status)")
        .eq("id", id)
        .single();
      if (error) throw new Error(error.message);
      return data as CaseWithClient;
    },
    enabled: !!id,
  });
}

export function useCreateCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CaseInsert) => {
      // Construir payload limpio con campos vigentes únicamente
      const payload: CaseInsert = {
        client_id: input.client_id,
        expediente: input.expediente,
        materia: input.materia,
        process_type: input.process_type,
        status: input.status,
        juzgado: input.juzgado,
        ...(input.case_name && { case_name: input.case_name }),
        ...(input.case_type && { case_type: input.case_type }),
        ...(input.case_stage && { case_stage: input.case_stage }),
        ...(input.case_number && { case_number: input.case_number }),
        ...(input.court && { court: input.court }),
        ...(input.demandante && { demandante: input.demandante }),
        ...(input.demandado && { demandado: input.demandado }),
        ...(input.judicial_district && { judicial_district: input.judicial_district }),
        ...(input.judge_or_prosecutor && { judge_or_prosecutor: input.judge_or_prosecutor }),
        ...(input.current_summary && { current_summary: input.current_summary }),
        ...(input.current_status_description && {
          current_status_description: input.current_status_description,
        }),
        ...(input.next_action && { next_action: input.next_action }),
        ...(input.next_hearing && { next_hearing: input.next_hearing }),
      };

      const db = await getAuthClient();
      const { data, error } = await db.from("cases").insert(payload).select().single();

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (data) => invalidateCrmQueries(qc, { caseId: data?.id, clientId: data?.client_id }),
  });
}

export function useUpdateCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: CaseUpdate }) => {
      // Construir payload limpio con campos vigentes únicamente
      const payload: CaseUpdate = {};
      if (updates.client_id !== undefined) payload.client_id = updates.client_id;
      if (updates.expediente !== undefined) payload.expediente = updates.expediente;
      if (updates.materia !== undefined) payload.materia = updates.materia;
      if (updates.process_type !== undefined) payload.process_type = updates.process_type;
      if (updates.status !== undefined) payload.status = updates.status;
      if (updates.juzgado !== undefined) payload.juzgado = updates.juzgado;
      if (updates.case_name !== undefined) payload.case_name = updates.case_name;
      if (updates.case_type !== undefined) payload.case_type = updates.case_type;
      if (updates.case_stage !== undefined) payload.case_stage = updates.case_stage;
      if (updates.case_number !== undefined) payload.case_number = updates.case_number;
      if (updates.court !== undefined) payload.court = updates.court;
      if (updates.demandante !== undefined) payload.demandante = updates.demandante;
      if (updates.demandado !== undefined) payload.demandado = updates.demandado;
      if (updates.judicial_district !== undefined)
        payload.judicial_district = updates.judicial_district;
      if (updates.judge_or_prosecutor !== undefined)
        payload.judge_or_prosecutor = updates.judge_or_prosecutor;
      if (updates.current_summary !== undefined) payload.current_summary = updates.current_summary;
      if (updates.current_status_description !== undefined)
        payload.current_status_description = updates.current_status_description;
      if (updates.next_action !== undefined) payload.next_action = updates.next_action;
      if (updates.next_hearing !== undefined) payload.next_hearing = updates.next_hearing;

      const db = await getAuthClient();
      const { data, error } = await db.from("cases").update(payload).eq("id", id).select().single();

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (data, { id }) =>
      invalidateCrmQueries(qc, { caseId: id, clientId: data?.client_id }),
  });
}
