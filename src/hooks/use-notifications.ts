import { useQuery } from "@tanstack/react-query";
import { getAuthClient } from "@/lib/supabase";
import { getPeruTodayISO, addDaysToISO } from "@/lib/peru-time";

export interface Notification {
  id: string;
  title: string;
  description?: string;
  type: "audiencia" | "cita" | "recordatorio" | "vencimiento";
  date: string;
  time: string;
  urgent: boolean;
}

/**
 * Retorna los eventos de agenda de hoy y los próximos 3 días
 * como notificaciones. No persiste preferencias de usuario —
 * solo sirve para mostrar alertas contextuales en tiempo real.
 */
export function useNotifications() {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: async () => {
      const today = getPeruTodayISO();
      const in3days = addDaysToISO(today, 3);

      const db = await getAuthClient();
      const { data, error } = await db
        .from("agenda_events")
        .select("id, title, type, event_date, event_time, location, clients(name)")
        .gte("event_date", today)
        .lte("event_date", in3days)
        .order("event_date", { ascending: true })
        .order("event_time", { ascending: true });

      if (error) throw new Error(error.message);

      const rows = data as Array<{
        id: string;
        title: string;
        type: string;
        event_date: string;
        event_time: string;
        location: string | null;
        clients: { name: string } | null;
      }>;

      const notifications: Notification[] = rows.map((row) => {
        const timeStr = String(row.event_time).slice(0, 5); // HH:MM
        const clientName = row.clients?.name;
        const description = clientName
          ? `${clientName}${row.location ? ` · ${row.location}` : ""}`
          : (row.location ?? undefined);

        const rawType = row.type.toLowerCase();
        let type: Notification["type"] = "cita";
        if (rawType.includes("audiencia")) type = "audiencia";
        else if (rawType.includes("recordatorio")) type = "recordatorio";
        else if (rawType.includes("vencimiento") || rawType.includes("plazo")) type = "vencimiento";

        return {
          id: row.id,
          title: row.title,
          description,
          type,
          date: row.event_date,
          time: timeStr,
          urgent: row.event_date === today,
        };
      });

      return notifications;
    },
    // Refetch each 5 minutes so the badge stays current
    refetchInterval: 5 * 60 * 1000,
    staleTime: 2 * 60 * 1000,
  });
}
