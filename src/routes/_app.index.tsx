import { createFileRoute, Link } from "@tanstack/react-router";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { useClients } from "@/hooks/use-clients";
import { useCases } from "@/hooks/use-cases";
import { useAgendaEvents } from "@/hooks/use-agenda";
import { useAuth } from "@/hooks/use-auth";
import { usePayments } from "@/hooks/use-payments";
import { useClientReports } from "@/hooks/use-reports";
import { formatPeruDate, getPeruHour, getPeruTodayISO } from "@/lib/peru-time";
import {
  Users,
  Briefcase,
  CheckCircle2,
  CalendarClock,
  FileText,
  CreditCard,
  UserPlus,
  ScrollText,
  Gavel,
  ChevronRight,
  AlertTriangle,
  ClipboardList,
} from "lucide-react";

export const Route = createFileRoute("/_app/")({
  head: () => ({
    meta: [{ title: "Dashboard — Abogados a tu Servicio" }],
  }),
  component: Dashboard,
});

function activityIcon(t: string) {
  switch (t) {
    case "hearing":
      return Gavel;
    case "payment":
      return CreditCard;
    case "document":
      return FileText;
    case "client":
      return UserPlus;
    default:
      return ScrollText;
  }
}

function Dashboard() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "Administrador";
  const { data: clients = [] } = useClients();
  const { data: cases = [] } = useCases();
  const { data: events = [] } = useAgendaEvents();
  const { data: payments = [] } = usePayments({ enabled: isAdmin });
  const { data: reports = [] } = useClientReports();

  const today = getPeruTodayISO();
  const activeCases = cases.filter((c) => c.status !== "Archivado");
  const finishedCases = cases.filter((c) => c.status === "Archivado" || c.status === "Sentencia");
  const todayEvents = events.filter((e) => e.event_date === today).slice(0, 5);
  const urgentCases = activeCases.filter((c) => c.priority === "Alta").slice(0, 5);
  const waitingClients = clients.filter((c) => c.status === "En espera").slice(0, 5);
  const overduePayments = payments.filter((p) => p.status === "Vencido").slice(0, 5);
  const recentReports = reports.slice(0, 4);

  const upcomingHearings = events
    .filter((e) => e.type === "Audiencia" && e.event_date >= today)
    .slice(0, 4);

  const expiringCases = activeCases
    .filter((c) => c.next_hearing)
    .sort((a, b) => (a.next_hearing ?? "").localeCompare(b.next_hearing ?? ""))
    .slice(0, 4);

  const greeting = (() => {
    const h = getPeruHour();
    if (h < 12) return "Buenos días";
    if (h < 18) return "Buenas tardes";
    return "Buenas noches";
  })();

  const displayName = profile?.full_name ?? "equipo";

  return (
    <AppLayout
      title={`${greeting}, ${displayName}`}
      subtitle={`Resumen del estudio jurídico — ${formatPeruDate(new Date().toISOString(), { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`}
    >
      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard icon={Users} label="Clientes registrados" value={clients.length} tone="navy" />
        <KpiCard icon={Briefcase} label="Casos activos" value={activeCases.length} tone="gold" />
        <KpiCard
          icon={CheckCircle2}
          label="Casos finalizados"
          value={finishedCases.length}
          tone="success"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-4 mt-6">
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold">Bandeja de trabajo</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Prioridades del día en horario Perú
              </p>
            </div>
            <StatusBadge tone={todayEvents.length > 0 ? "warning" : "success"}>
              {todayEvents.length} hoy
            </StatusBadge>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <WorkBucket
              icon={CalendarClock}
              label="Agenda de hoy"
              empty="Sin eventos para hoy."
              items={todayEvents.map((e) => ({
                title: e.title,
                meta: `${String(e.event_time).slice(0, 5)} · ${e.clients?.name ?? "Sin cliente"}`,
              }))}
            />
            <WorkBucket
              icon={AlertTriangle}
              label="Casos urgentes"
              empty="Sin casos de prioridad alta."
              items={urgentCases.map((c) => ({
                title: c.clients?.name ?? "Cliente",
                meta: `${c.expediente} · ${c.status}`,
              }))}
            />
            <WorkBucket
              icon={Users}
              label="Clientes en espera"
              empty="Sin clientes en espera."
              items={waitingClients.map((c) => ({
                title: c.name,
                meta: c.process_type,
              }))}
            />
            <WorkBucket
              icon={CreditCard}
              label="Pagos vencidos"
              empty="Sin pagos vencidos."
              items={overduePayments.map((p) => ({
                title: p.clients?.name ?? "Cliente",
                meta: p.service,
              }))}
            />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-primary" /> Reportes recientes
            </h3>
            <Link
              to={"/reportes" as never}
              className="text-xs font-semibold text-primary hover:underline"
            >
              Ver todos
            </Link>
          </div>
          <div className="space-y-3">
            {recentReports.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aún no hay reportes compartidos.</p>
            ) : (
              recentReports.map((report) => (
                <div key={report.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold truncate">{report.title}</div>
                    <StatusBadge tone={report.category === "Alerta" ? "danger" : "navy"}>
                      {report.category === "Observacion" ? "Observación" : report.category}
                    </StatusBadge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 truncate">
                    {report.clients?.name ?? "Cliente"} · {formatPeruDate(report.created_at)}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
        {/* Upcoming hearings */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold">Próximas audiencias</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Calendario judicial</p>
            </div>
            <Link
              to={"/agenda" as never}
              className="text-xs font-semibold text-primary hover:underline"
            >
              Ver todo
            </Link>
          </div>
          <div className="space-y-3">
            {upcomingHearings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay audiencias próximas.</p>
            ) : (
              upcomingHearings.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/30 hover:bg-muted/30 transition cursor-pointer"
                >
                  <div className="grid place-items-center h-12 w-12 rounded-lg bg-primary/5 text-primary border border-primary/10">
                    <div className="text-center leading-tight">
                      <div className="text-[10px] font-semibold uppercase">
                        {formatPeruDate(e.event_date, {
                          month: "short",
                        })}
                      </div>
                      <div className="text-base font-bold">{Number(e.event_date.slice(8, 10))}</div>
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate">
                      {e.clients?.name ?? e.title}
                    </div>
                    <div className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
                      <CalendarClock className="h-3 w-3" /> {e.event_time}{" "}
                      {e.location ? `· ${e.location}` : ""}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Recent cases */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold">Casos recientes</h3>
            <Link
              to={"/casos" as never}
              className="text-xs font-semibold text-primary hover:underline"
            >
              Ver todos
            </Link>
          </div>
          <div className="space-y-3">
            {cases.slice(0, 5).length === 0 ? (
              <p className="text-sm text-muted-foreground">Aún no hay casos.</p>
            ) : (
              cases.slice(0, 5).map((c) => (
                <div key={c.id} className="flex items-center gap-3">
                  <div
                    className="grid h-8 w-8 place-items-center rounded-full text-[10px] font-bold text-white shrink-0"
                    style={{ background: c.clients?.color ?? "oklch(0.55 0.13 235)" }}
                  >
                    {c.clients?.initials ?? "??"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate">{c.clients?.name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground truncate">{c.process_type}</div>
                  </div>
                  <StatusBadge
                    tone={
                      c.priority === "Alta" ? "danger" : c.priority === "Media" ? "warning" : "info"
                    }
                  >
                    {c.priority}
                  </StatusBadge>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Cases about to have hearings */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold">Casos próximos a audiencia</h3>
          </div>
          <div className="space-y-3">
            {expiringCases.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay casos con audiencias próximas.</p>
            ) : (
              expiringCases.map((c) => (
                <div key={c.id} className="p-3 rounded-lg border border-border bg-amber-50/40">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold truncate">{c.clients?.name ?? "—"}</div>
                    <StatusBadge
                      tone={
                        c.priority === "Alta"
                          ? "danger"
                          : c.priority === "Media"
                            ? "warning"
                            : "info"
                      }
                    >
                      {c.priority}
                    </StatusBadge>
                  </div>
                  <div className="text-[11px] text-muted-foreground font-mono mt-1 truncate">
                    {c.expediente}
                  </div>
                  <div className="flex items-center justify-between mt-2 text-xs">
                    <span className="text-muted-foreground">{c.process_type}</span>
                    <span className="font-semibold text-primary">
                      {c.next_hearing
                        ? formatPeruDate(c.next_hearing, {
                            day: "2-digit",
                            month: "short",
                          })
                        : "—"}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </AppLayout>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  tone: "navy" | "gold" | "success";
}) {
  const tones: Record<string, string> = {
    navy: "bg-primary/10 text-primary",
    gold: "bg-[oklch(0.96_0.05_85)] text-[oklch(0.5_0.13_75)]",
    success: "bg-emerald-50 text-emerald-700",
  };
  return (
    <Card className="p-5 hover:shadow-card transition-shadow">
      <div className="flex items-center gap-4">
        <div className={`grid h-12 w-12 place-items-center rounded-xl ${tones[tone]}`}>
          <Icon className="h-6 w-6" />
        </div>
        <div>
          <div className="text-2xl font-bold tracking-tight">{value}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
        </div>
      </div>
    </Card>
  );
}

function WorkBucket({
  icon: Icon,
  label,
  items,
  empty,
}: {
  icon: typeof Users;
  label: string;
  items: Array<{ title: string; meta: string }>;
  empty: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        <Icon className="h-3.5 w-3.5 text-primary" />
        {label}
      </div>
      <div className="space-y-2">
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">{empty}</p>
        ) : (
          items.map((item, index) => (
            <div key={`${item.title}-${index}`} className="min-w-0">
              <div className="text-sm font-semibold truncate">{item.title}</div>
              <div className="text-xs text-muted-foreground truncate">{item.meta}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
