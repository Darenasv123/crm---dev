import { useQuery } from "@tanstack/react-query";
import { getAuthClient } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";
import { addDaysToISO, getPeruTodayISO } from "@/lib/peru-time";

export interface Notification {
  id: string;
  type: "audiencia" | "cita" | "recordatorio";
  title: string;
  description: string;
  date: string;
  time: string;
  urgent: boolean;
}

type NotificationEventRow = Database["public"]["Tables"]["agenda_events"]["Row"] & {
  clients?: { name: string } | null;
};

export function useNotifications() {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: async () => {
      const todayISO = getPeruTodayISO();
      const in3DaysISO = addDaysToISO(todayISO, 3);

      const db = await getAuthClient();
      const { data, error } = await db
        .from("agenda_events")
        .select("*, clients(name)")
        .gte("event_date", todayISO)
        .lte("event_date", in3DaysISO)
        .order("event_date", { ascending: true })
        .order("event_time", { ascending: true });

      if (error) throw new Error(error.message);

      const events = (data ?? []) as NotificationEventRow[];

      return events.map((e) => ({
        id: e.id,
        type: e.type.toLowerCase() as Notification["type"],
        title: e.title,
        description: (e as { clients?: { name: string } | null }).clients?.name
          ? `Cliente: ${(e as { clients?: { name: string } | null }).clients!.name}${e.location ? ` · ${e.location}` : ""}`
          : (e.location ?? ""),
        date: e.event_date,
        time: e.event_time,
        urgent: e.event_date === todayISO,
      })) as Notification[];
    },
    refetchInterval: 5 * 60 * 1000,
  });
}
