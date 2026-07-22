import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAuthClient } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";
import { isMissingSchemaFieldError } from "@/lib/supabase-errors";

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
      const payload: CaseInsert = {
        ...input,
        demandante: input.demandante ?? null,
        demandado: input.demandado ?? null,
        next_hearing: input.next_hearing ?? null,
      };
      const db = await getAuthClient();
      let { data, error } = await db.from("cases").insert(payload).select().single();

      if (isMissingSchemaFieldError(error)) {
        const legacyPayload: CaseInsert = {
          client_id: payload.client_id,
          expediente: payload.expediente,
          process_type: payload.process_type,
          priority: payload.priority,
          next_hearing: payload.next_hearing,
          status: payload.status,
          juzgado: payload.juzgado,
          demandante: payload.demandante,
          demandado: payload.demandado,
        };
        if ("notes" in payload) {
          (legacyPayload as Record<string, unknown>).notes = (
            payload as Record<string, unknown>
          ).notes;
        }
        ({ data, error } = await db.from("cases").insert(legacyPayload).select().single());
      }

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
      let { data, error } = await db.from("cases").update(updates).eq("id", id).select().single();

      if (isMissingSchemaFieldError(error)) {
        const legacyUpdates: CaseUpdate = {
          ...(updates.expediente !== undefined && { expediente: updates.expediente }),
          ...(updates.process_type !== undefined && { process_type: updates.process_type }),
          ...(updates.priority !== undefined && { priority: updates.priority }),
          ...(updates.next_hearing !== undefined && { next_hearing: updates.next_hearing }),
          ...(updates.status !== undefined && { status: updates.status }),
          ...(updates.juzgado !== undefined && { juzgado: updates.juzgado }),
          ...(updates.demandante !== undefined && { demandante: updates.demandante }),
          ...(updates.demandado !== undefined && { demandado: updates.demandado }),
        };
        if ("notes" in updates) {
          (legacyUpdates as Record<string, unknown>).notes = (
            updates as Record<string, unknown>
          ).notes;
        }
        ({ data, error } = await db
          .from("cases")
          .update(legacyUpdates)
          .eq("id", id)
          .select()
          .single());
      }

      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ["cases"] });
      qc.invalidateQueries({ queryKey: ["cases", id] });
    },
  });
}
