import { useNotifications } from "@/hooks/use-notifications";
import { Link } from "@tanstack/react-router";
import { Bell, CalendarDays, Clock, MapPin, X, Gavel, Users, MessageSquare } from "lucide-react";
import { useEffect, useRef } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
}

const typeIcon = {
  audiencia: Gavel,
  cita: Users,
  recordatorio: MessageSquare,
};

const typeColor = {
  audiencia: "bg-primary/10 text-primary",
  cita: "bg-sky-50 text-sky-600",
  recordatorio: "bg-emerald-50 text-emerald-600",
};

export function NotificationsPanel({ open, onClose }: Props) {
  const { data: notifications = [] } = useNotifications();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, onClose]);

  const today = new Date().toISOString().slice(0, 10);
  const todayEvents = notifications.filter(n => n.date === today);
  const upcomingEvents = notifications.filter(n => n.date > today);

  if (!open) return null;

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-2 w-80 rounded-xl border border-border bg-card shadow-xl z-50 overflow-hidden"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Notificaciones</span>
          {notifications.length > 0 && (
            <span className="bg-primary text-primary-foreground text-[10px] font-bold rounded-full px-1.5 py-0.5">
              {notifications.length}
            </span>
          )}
        </div>
        <button onClick={onClose} className="h-7 w-7 grid place-items-center rounded-lg hover:bg-muted/60">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="max-h-96 overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center px-4">
            <CalendarDays className="h-8 w-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">Sin eventos en los próximos 3 días</p>
          </div>
        ) : (
          <>
            {todayEvents.length > 0 && (
              <div>
                <div className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30">
                  Hoy
                </div>
                {todayEvents.map(n => (
                  <NotifItem key={n.id} n={n} urgent />
                ))}
              </div>
            )}
            {upcomingEvents.length > 0 && (
              <div>
                <div className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30">
                  Próximos días
                </div>
                {upcomingEvents.map(n => (
                  <NotifItem key={n.id} n={n} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="px-4 py-3 border-t border-border">
        <Link
          to={"/agenda" as never}
          onClick={onClose}
          className="block w-full text-center text-xs font-semibold text-primary hover:underline"
        >
          Ver agenda completa →
        </Link>
      </div>
    </div>
  );
}

function NotifItem({ n, urgent }: { n: ReturnType<typeof useNotifications>["data"][0]; urgent?: boolean }) {
  const Icon = typeIcon[n.type as keyof typeof typeIcon] ?? Bell;
  const color = typeColor[n.type as keyof typeof typeColor] ?? "bg-muted text-foreground";

  return (
    <div className={`flex items-start gap-3 px-4 py-3 border-b border-border last:border-0 hover:bg-muted/20 transition ${urgent ? "bg-amber-50/50" : ""}`}>
      <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${color}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <div className="text-sm font-semibold truncate">{n.title}</div>
          {urgent && <span className="text-[9px] font-bold text-amber-700 bg-amber-100 rounded px-1 shrink-0">HOY</span>}
        </div>
        {n.description && <div className="text-xs text-muted-foreground truncate">{n.description}</div>}
        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-0.5"><Clock className="h-3 w-3" /> {n.time}</span>
          {!urgent && <span className="flex items-center gap-0.5"><CalendarDays className="h-3 w-3" /> {new Date(n.date + "T00:00:00").toLocaleDateString("es-PE", { day: "2-digit", month: "short" })}</span>}
        </div>
      </div>
    </div>
  );
}

export function NotificationsBell() {
  const { data: notifications = [] } = useNotifications();
  const urgentCount = notifications.filter(n => n.urgent).length;
  const totalCount = notifications.length;

  return { urgentCount, totalCount };
}
