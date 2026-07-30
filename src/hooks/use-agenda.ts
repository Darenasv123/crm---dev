import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getAuthClient } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";
import { resolveAgendaConflict, syncAgendaEvent } from "@/lib/google-calendar-client";

type AgendaEvent = Database["public"]["Tables"]["agenda_events"]["Row"];
type AgendaEventInsert = Database["public"]["Tables"]["agenda_events"]["Insert"];
type AgendaEventUpdate = Database["public"]["Tables"]["agenda_events"]["Update"];
type QueryOptions = { enabled?: boolean };

export interface AgendaEventWithClient extends AgendaEvent {
  clients: { name: string } | null;
  cases: { expediente: string; process_type: string } | null;
}

const agendaSelect = "*, clients(name), cases(expediente, process_type)";

async function markSyncError(id: string, cause: unknown) {
  const db = await getAuthClient();
  const message = cause instanceof Error ? cause.message : "No se pudo sincronizar con Google.";
  await db.from("agenda_events").update({ sync_status: "error", sync_error: message }).eq("id", id);
}

async function requestSync(id: string) {
  try {
    await syncAgendaEvent(id);
  } catch (cause) {
    await markSyncError(id, cause);
  }
}

export function useAgendaEvents(options: QueryOptions = {}) {
  return useQuery({
    queryKey: ["agenda_events"],
    queryFn: async () => {
      const db = await getAuthClient();
      const { data, error } = await db
        .from("agenda_events")
        .select(agendaSelect)
        .is("deleted_at", null)
        .order("event_date", { ascending: true })
        .order("event_time", { ascending: true });
      if (error) throw new Error(error.message);
      return data as unknown as AgendaEventWithClient[];
    },
    enabled: options.enabled ?? true,
  });
}

export function useCreateAgendaEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AgendaEventInsert) => {
      const db = await getAuthClient();
      const { data, error } = await db
        .from("agenda_events")
        .insert({ ...input, sync_status: "pending", sync_origin: "crm" })
        .select(agendaSelect)
        .single();
      if (error) throw new Error(error.message);
      const row = data as unknown as AgendaEventWithClient;
      await requestSync(row.id);
      return row;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["agenda_events"] }),
  });
}

export function useUpdateAgendaEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: AgendaEventUpdate;
      gcalId?: string | null;
      clientName?: string | null;
    }) => {
      const db = await getAuthClient();
      const { data, error } = await db
        .from("agenda_events")
        .update({
          ...updates,
          sync_status: "pending",
          sync_error: null,
          sync_origin: "crm",
        })
        .eq("id", id)
        .select(agendaSelect)
        .single();
      if (error) throw new Error(error.message);
      const row = data as unknown as AgendaEventWithClient;
      await requestSync(row.id);
      return row;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["agenda_events"] }),
  });
}

export function useDeleteAgendaEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; gcalId?: string | null }) => {
      const db = await getAuthClient();
      const { error } = await db
        .from("agenda_events")
        .update({
          deleted_at: new Date().toISOString(),
          sync_status: "pending",
          sync_error: null,
          sync_origin: "crm",
        })
        .eq("id", id);
      if (error) throw new Error(error.message);
      await requestSync(id);
      return id;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["agenda_events"] }),
  });
}

export function useRetryAgendaSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const db = await getAuthClient();
      await db
        .from("agenda_events")
        .update({ sync_status: "pending", sync_error: null })
        .eq("id", id);
      await syncAgendaEvent(id);
      return id;
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["agenda_events"] }),
  });
}

export function useResolveAgendaConflict() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, resolution }: { id: string; resolution: "crm" | "google" }) =>
      resolveAgendaConflict(id, resolution),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["agenda_events"] }),
  });
}
