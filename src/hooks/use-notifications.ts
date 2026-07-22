import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
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
 * Retorna los eventos de agenda de hoy y los próximos 3 días como
 * notificaciones para la campana del header.
 *
 * Garantías:
 * - No ejecuta ninguna consulta durante SSR (enabled: false en servidor).
 * - No ejecuta si no hay sesión activa en Supabase.
 * - Usa el cliente base `supabase` (no getAuthClient) porque ya maneja
 *   la sesión persistida internamente, evitando crear un cliente nuevo
 *   en cada refetch.
 * - Se refresca cada 5 minutos mientras el tab está activo.
 * - React Query limpia el refetchInterval automáticamente al desmontar.
 */
export function useNotifications() {
  // SSR guard: typeof window check is stable — no hook call conditionally,
  // just control the `enabled` flag.
  const isBrowser = typeof window !== "undefined";

  return useQuery({
    queryKey: ["notifications"],
    queryFn: async () => {
      // Double-check session before querying (avoids 401 noise when logged out)
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return [] as Notification[];

      const today = getPeruTodayISO();
      const in3days = addDaysToISO(today, 3);

      const { data, error } = await supabase
        .from("agenda_events")
        .select("id, title, type, event_date, event_time, location, clients(name)")
        .gte("event_date", today)
        .lte("event_date", in3days)
        .order("event_date", { ascending: true })
        .order("event_time", { ascending: true });

      // If RLS returns an error (e.g. expired token), return empty — don't crash
      if (error) return [] as Notification[];

      type Row = {
        id: string;
        title: string;
        type: string;
        event_date: string;
        event_time: string;
        location: string | null;
        clients: { name: string } | null;
      };

      return (data as Row[]).map((row): Notification => {
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
    },
    // Disable during SSR; enable as soon as we're in a browser context
    enabled: isBrowser,
    // Refetch every 5 minutes while the window is focused
    refetchInterval: 5 * 60 * 1000,
    // Data is considered fresh for 2 minutes — avoids duplicate requests
    // when multiple components read the same query
    staleTime: 2 * 60 * 1000,
    // On error, don't retry aggressively — network issues during notifications
    // shouldn't hammer the DB
    retry: 1,
    // Return [] on error so the UI renders gracefully
    placeholderData: [] as Notification[],
  });
}
