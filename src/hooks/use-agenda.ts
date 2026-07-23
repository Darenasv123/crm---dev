import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAuthClient } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";
import {
  isGoogleCalendarConnected,
  createGCalEvent,
  updateGCalEvent,
  deleteGCalEvent,
  fetchGCalEvents,
  parseGCalStart,
} from "@/lib/google-calendar";
import { invalidateCrmQueries } from "@/lib/query-invalidation";

type AgendaEvent = Database["public"]["Tables"]["agenda_events"]["Row"];
type AgendaEventInsert = Database["public"]["Tables"]["agenda_events"]["Insert"];
type AgendaEventUpdate = Database["public"]["Tables"]["agenda_events"]["Update"];
type QueryOptions = { enabled?: boolean };

export interface AgendaEventWithClient extends AgendaEvent {
  clients: { name: string } | null;
  cases: { expediente: string; process_type: string } | null;
}

export async function saveAgendaGoogleIds(gcalIds: Record<string, string>) {
  const entries = Object.entries(gcalIds);
  if (entries.length === 0) return;

  const db = await getAuthClient();
  const results = await Promise.all(
    entries.map(([id, gcal_event_id]) =>
      db.from("agenda_events").update({ gcal_event_id }).eq("id", id),
    ),
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(failed.error.message);
}

// ─── Lectura ──────────────────────────────────────────────────────────────────

export function useAgendaEvents(options: QueryOptions = {}) {
  return useQuery({
    queryKey: ["agenda_events"],
    queryFn: async () => {
      const db = await getAuthClient();
      const { data, error } = await db
        .from("agenda_events")
        .select("*, clients(name), cases(expediente, process_type)")
        .order("event_date", { ascending: true })
        .order("event_time", { ascending: true });
      if (error) throw new Error(error.message);
      return data as AgendaEventWithClient[];
    },
    enabled: options.enabled ?? true,
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
        .select("*, clients(name), cases(expediente, process_type)")
        .single();
      if (error) throw new Error(error.message);
      const row = data as unknown as AgendaEventWithClient;

      // 2. Si Google Calendar está conectado, crear allá también y guardar gcal_event_id
      if (isGoogleCalendarConnected()) {
        try {
          const gcalId = await createGCalEvent({
            id: row.id,
            title: row.title,
            type: row.type,
            event_date: row.event_date,
            event_time: String(row.event_time),
            location: row.location,
            client: row.clients?.name ?? null,
            case: row.cases?.expediente ?? null,
          });
          // Guardar el ID de Google Calendar en Supabase
          await db.from("agenda_events").update({ gcal_event_id: gcalId }).eq("id", row.id);
          return { ...row, gcal_event_id: gcalId };
        } catch {
          // No bloquear si Google falla — el evento ya quedó en el CRM
        }
      }
      return row;
    },
    onSuccess: (data) =>
      invalidateCrmQueries(qc, { clientId: data.client_id, caseId: data.case_id }),
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
      id: string;
      updates: AgendaEventUpdate;
      gcalId?: string | null;
      clientName?: string | null;
    }) => {
      const db = await getAuthClient();
      const { data, error } = await db
        .from("agenda_events")
        .update(updates)
        .eq("id", id)
        .select("*, clients(name), cases(expediente, process_type)")
        .single();
      if (error) throw new Error(error.message);
      const row = data as unknown as AgendaEventWithClient;

      // Espejo en Google Calendar
      if (isGoogleCalendarConnected() && gcalId) {
        try {
          await updateGCalEvent(gcalId, {
            id,
            gcalId,
            title: row.title,
            type: row.type,
            event_date: row.event_date,
            event_time: String(row.event_time),
            location: row.location,
            client: clientName ?? null,
            case: row.cases?.expediente ?? null,
          });
        } catch {
          /* silencioso */
        }
      }
      return row;
    },
    onSuccess: (data) =>
      invalidateCrmQueries(qc, { clientId: data.client_id, caseId: data.case_id }),
  });
}

// ─── Eliminar ─────────────────────────────────────────────────────────────────

export function useDeleteAgendaEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, gcalId }: { id: string; gcalId?: string | null }) => {
      const db = await getAuthClient();
      const { error } = await db.from("agenda_events").delete().eq("id", id);
      if (error) throw new Error(error.message);

      // Eliminar de Google Calendar también
      if (isGoogleCalendarConnected() && gcalId) {
        try {
          await deleteGCalEvent(gcalId);
        } catch {
          /* silencioso */
        }
      }
    },
    onSuccess: () => invalidateCrmQueries(qc),
  });
}

// ─── Google → CRM : sincronización conservadora (importar + recuperar + actualizar) ──

export function useImportFromGoogleCalendar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!isGoogleCalendarConnected()) return { imported: 0, restored: 0, deleted: 0, updated: 0 };

      const db = await getAuthClient();

      // 1. Obtener todos los eventos de agenda y separar los que ya tienen gcal_event_id.
      const { data: supabaseAgenda } = await db
        .from("agenda_events")
        .select("id, gcal_event_id, title, event_date, event_time, location");

      const agendaRows = (supabaseAgenda ?? []) as {
        id: string;
        gcal_event_id: string | null;
        title: string;
        event_date: string;
        event_time: string;
        location: string | null;
      }[];
      const linkedRows = agendaRows.filter((row) => row.gcal_event_id) as Array<
        Omit<(typeof agendaRows)[number], "gcal_event_id"> & { gcal_event_id: string }
      >;
      const existingGcalIds = new Set(linkedRows.map((e) => e.gcal_event_id));
      const existingCrmIds = new Set(agendaRows.map((e) => e.id));

      // Mapa gcal_event_id → fila de Supabase (para comparar campos)
      const gcalIdToRow = new Map(linkedRows.map((r) => [r.gcal_event_id, r]));

      // 2. Obtener lista completa de Google Calendar (una sola llamada a la API, reutilizada)
      const timeMin = new Date(Date.now() - 10 * 365 * 24 * 60 * 60 * 1000);
      const timeMax = new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000);
      const allGCalEvents = await fetchGCalEvents(timeMin, timeMax);

      // 3. Nunca borramos eventos del CRM por una lectura de Google.
      //    Si Google no devuelve eventos por permisos, token o rango, el CRM conserva su agenda.
      const deleted = 0;

      // 4. Detectar ediciones por gcal_event_id, no solo por crmEventId.
      //    Esto corrige también eventos creados originalmente en Google e importados al CRM.
      const updatePromises: Promise<unknown>[] = [];
      for (const gcalEv of allGCalEvents) {
        const row = gcalIdToRow.get(gcalEv.id);
        if (!row) continue;

        const rawStart = gcalEv.start?.dateTime ?? gcalEv.start?.date ?? "";
        const { event_date, event_time } = parseGCalStart(rawStart);

        // Normalizar event_time a HH:MM para comparar (Supabase puede devolver HH:MM:SS)
        const supabaseTime = String(row.event_time).slice(0, 5);
        const changed =
          (gcalEv.summary ?? "Evento sin título") !== row.title ||
          event_date !== row.event_date ||
          event_time !== supabaseTime ||
          (gcalEv.location ?? null) !== (row.location ?? null);
        if (changed) {
          updatePromises.push(
            Promise.resolve(
              db
                .from("agenda_events")
                .update({
                  title: gcalEv.summary ?? "Evento sin título",
                  event_date,
                  event_time,
                  location: gcalEv.location,
                })
                .eq("id", row.id),
            ),
          );
        }
      }
      let updated = 0;
      if (updatePromises.length > 0) {
        await Promise.all(updatePromises);
        updated = updatePromises.length;
      }

      // 5. Importar eventos nuevos de Google y recuperar eventos del CRM que quedaron
      //    huérfanos en Google si su fila de Supabase fue eliminada accidentalmente.
      const newEvents = allGCalEvents
        .filter((e) => !e.extendedProperties?.private?.crmEventId)
        .filter((e) => !existingGcalIds.has(e.id));
      const recoverableCrmEvents = allGCalEvents.filter((e) => {
        const crmId = e.extendedProperties?.private?.crmEventId;
        return !!crmId && !existingCrmIds.has(crmId) && !existingGcalIds.has(e.id);
      });

      let imported = 0;
      let restored = 0;
      if (newEvents.length > 0 || recoverableCrmEvents.length > 0) {
        // Parsear fechas usando la misma lógica de zona horaria Lima
        const toAgendaRow = (
          e: (typeof allGCalEvents)[number],
          options: { id?: string } = {},
        ): AgendaEventInsert => {
          const rawStart = e.start?.dateTime ?? e.start?.date ?? "";
          const { event_date, event_time } = parseGCalStart(rawStart);
          return {
            id: options.id,
            title: e.summary ?? "Evento sin título",
            type: "Cita" as const,
            event_date,
            event_time,
            location: e.location ?? null,
            gcal_event_id: e.id,
          };
        };
        const rows: AgendaEventInsert[] = [
          ...newEvents.map((e) => toAgendaRow(e)),
          ...recoverableCrmEvents.map((e) =>
            toAgendaRow(e, { id: e.extendedProperties?.private?.crmEventId }),
          ),
        ];
        const { error } = await db.from("agenda_events").insert(rows);
        if (!error) {
          imported = newEvents.length;
          restored = recoverableCrmEvents.length;
        }
      }

      return { imported, restored, deleted, updated };
    },
    onSuccess: () => invalidateCrmQueries(qc),
  });
}
