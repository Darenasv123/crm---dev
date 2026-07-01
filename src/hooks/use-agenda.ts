import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAuthClient } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";
import {
  isGoogleCalendarConnected,
  createGCalEvent,
  updateGCalEvent,
  deleteGCalEvent,
  getNewGCalEvents,
} from "@/lib/google-calendar";

type AgendaEvent       = Database["public"]["Tables"]["agenda_events"]["Row"];
type AgendaEventInsert = Database["public"]["Tables"]["agenda_events"]["Insert"];
type AgendaEventUpdate = Database["public"]["Tables"]["agenda_events"]["Update"];

export interface AgendaEventWithClient extends AgendaEvent {
  clients: { name: string } | null;
}

// ─── Lectura ──────────────────────────────────────────────────────────────────

export function useAgendaEvents() {
  return useQuery({
    queryKey: ["agenda_events"],
    queryFn: async () => {
      const db = await getAuthClient();
      const { data, error } = await db
        .from("agenda_events")
        .select("*, clients(name)")
        .order("event_date", { ascending: true })
        .order("event_time", { ascending: true });
      if (error) throw new Error(error.message);
      return data as AgendaEventWithClient[];
    },
  });
}

// ─── Crear ────────────────────────────────────────────────────────────────────

export function useCreateAgendaEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AgendaEventInsert) => {
      const db = await getAuthClient();
      // 1. Crear en Supabase primero para obtener el id
      const { data, error } = await db
        .from("agenda_events")
        .insert(input)
        .select()
        .single();
      if (error) throw new Error(error.message);

      // 2. Si Google Calendar está conectado, crear allá también y guardar gcal_event_id
      if (isGoogleCalendarConnected()) {
        try {
          const gcalId = await createGCalEvent({
            id:         data.id,
            title:      data.title,
            type:       data.type,
            event_date: data.event_date,
            event_time: String(data.event_time),
            location:   data.location,
          });
          // Guardar el ID de Google Calendar en Supabase
          await db
            .from("agenda_events")
            .update({ gcal_event_id: gcalId })
            .eq("id", data.id);
          return { ...data, gcal_event_id: gcalId };
        } catch {
          // No bloquear si Google falla — el evento ya quedó en el CRM
        }
      }
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agenda_events"] }),
  });
}

// ─── Actualizar ───────────────────────────────────────────────────────────────

export function useUpdateAgendaEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      updates,
      gcalId,
      clientName,
    }: {
      id:          string;
      updates:     AgendaEventUpdate;
      gcalId?:     string | null;
      clientName?: string | null;
    }) => {
      const db = await getAuthClient();
      const { data, error } = await db
        .from("agenda_events")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw new Error(error.message);

      // Espejo en Google Calendar
      if (isGoogleCalendarConnected() && gcalId) {
        try {
          await updateGCalEvent(gcalId, {
            id,
            gcalId,
            title:      data.title,
            type:       data.type,
            event_date: data.event_date,
            event_time: String(data.event_time),
            location:   data.location,
            client:     clientName ?? null,
          });
        } catch { /* silencioso */ }
      }
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agenda_events"] }),
  });
}

// ─── Eliminar ─────────────────────────────────────────────────────────────────

export function useDeleteAgendaEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      gcalId,
    }: {
      id:      string;
      gcalId?: string | null;
    }) => {
      const db = await getAuthClient();
      const { error } = await db.from("agenda_events").delete().eq("id", id);
      if (error) throw new Error(error.message);

      // Eliminar de Google Calendar también
      if (isGoogleCalendarConnected() && gcalId) {
        try {
          await deleteGCalEvent(gcalId);
        } catch { /* silencioso */ }
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agenda_events"] }),
  });
}

// ─── Google → CRM : importar eventos nuevos de Google ────────────────────────

export function useImportFromGoogleCalendar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!isGoogleCalendarConnected()) return { imported: 0 };

      // Obtener eventos de Google que no provienen del CRM
      const newEvents = await getNewGCalEvents();
      if (newEvents.length === 0) return { imported: 0 };

      const db = await getAuthClient();

      // Obtener gcal_event_ids ya registrados para no duplicar
      const { data: existing } = await db
        .from("agenda_events")
        .select("gcal_event_id")
        .not("gcal_event_id", "is", null);

      const existingGcalIds = new Set(
        (existing ?? []).map(e => e.gcal_event_id).filter(Boolean)
      );

      // Filtrar solo los realmente nuevos
      const toInsert = newEvents.filter(e => !existingGcalIds.has(e.gcalId));
      if (toInsert.length === 0) return { imported: 0 };

      const rows: AgendaEventInsert[] = toInsert.map(e => ({
        title:         e.title,
        type:          "Cita" as const,  // default — Google no tiene nuestros tipos
        event_date:    e.event_date,
        event_time:    e.event_time,
        location:      e.location,
        gcal_event_id: e.gcalId,
      }));

      const { error } = await db.from("agenda_events").insert(rows);
      if (error) throw new Error(error.message);
      return { imported: toInsert.length };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agenda_events"] }),
  });
}
