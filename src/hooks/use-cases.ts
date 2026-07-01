import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAuthClient } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";

type Case = Database["public"]["Tables"]["cases"]["Row"];
type CaseInsert = Database["public"]["Tables"]["cases"]["Insert"];
type CaseUpdate = Database["public"]["Tables"]["cases"]["Update"];

export interface CaseWithClient extends Case {
  clients: { name: string; initials: string; color: string } | null;
}

export function useCases() {
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
      const payload: CaseInsert = {
        ...input,
        demandante: input.demandante ?? null,
        demandado: input.demandado ?? null,
        next_hearing: input.next_hearing ?? null,
      };
      const db = await getAuthClient();
      const { data, error } = await db
        .from("cases")
        .insert(payload)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cases"] }),
  });
}

export function useUpdateCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: CaseUpdate }) => {
      const db = await getAuthClient();
      const { data, error } = await db
        .from("cases")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ["cases"] });
      qc.invalidateQueries({ queryKey: ["cases", id] });
    },
  });
}
