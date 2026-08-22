import { createFileRoute, Link } from "@tanstack/react-router";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { useClients } from "@/hooks/use-clients";
import { useCases } from "@/hooks/use-cases";
import { useAgendaEvents } from "@/hooks/use-agenda";
import { useAuth } from "@/hooks/use-auth";
import { usePendingTaskSummary } from "@/hooks/use-daily-tasks";
import { usePayments } from "@/hooks/use-payments";
import { useClientReports } from "@/hooks/use-reports";
import { useDocuments } from "@/hooks/use-documents";
import { usePermissions } from "@/lib/permissions";
import { displayCaseNumber, normalizeCaseStatus } from "@/lib/case-validation";
import { formatPeruDate, getPeruHour, getPeruTodayISO } from "@/lib/peru-time";
import { compareTasks, normalizeTaskStatus, TASK_STATUS_LABELS } from "@/lib/tasks";
import { getTaskVisualState } from "@/lib/task-visual";
import { TaskPriorityBadge } from "@/components/tasks/TaskPriorityBadge";
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
  ClipboardList,
  CalendarPlus,
  FolderPlus,
  Landmark,
  ListTodo,
  FolderArchive,
  BarChart3,
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
  const { canViewPayments, canViewFinancialMetrics } = usePermissions(profile);
  const { data: clients = [] } = useClients();
  const { data: cases = [] } = useCases();
  const { data: events = [] } = useAgendaEvents();
  const { data: payments = [] } = usePayments({ enabled: canViewPayments });
  const { data: reports = [] } = useClientReports();
  const { data: documents = [] } = useDocuments();
  const today = getPeruTodayISO();
  const {
    tasks: dailyTasks,
    isLoading: tasksLoading,
    available: availableTaskCount,
    mine: myTaskCount,
    running: runningTaskCount,
  } = usePendingTaskSummary();
  const dashboardTasks = [...dailyTasks]
    .sort((left, right) => compareTasks(left, right))
    .slice(0, 6);
  const activeClients = clients.filter((c) => c.status === "Activo");
  const activeCases = cases.filter(
    (c) => !["Archivado", "Concluido"].includes(normalizeCaseStatus(c.status)),
  );
  const todayEvents = events.filter((e) => e.event_date === today);
  const upcomingEvents = events
    .filter((e) => e.event_date >= today)
    .sort((a, b) =>
      `${a.event_date} ${a.event_time}`.localeCompare(`${b.event_date} ${b.event_time}`),
    );
  const urgentCases = activeCases.filter((c) => c.priority === "Alta").slice(0, 5);
  const pendingPayments = payments.filter(
    (p) => p.status !== "Pagado" && Number(p.fees) > Number(p.paid),
  );
  const overduePayments = pendingPayments.filter((p) => p.status === "Vencido").slice(0, 5);
  const documentsWithoutCase = documents.filter((doc) => !doc.case_id);
  const documentsPendingReview = documents.filter(
    (doc) =>
      !doc.case_id || doc.processing_status === "pending" || doc.verification_status === "pending",
  );
  const clientsWithoutContact = clients.filter((c) => !c.phone && !c.email).slice(0, 5);
  const recentReports = reports.slice(0, 3);
  const recentActivity = [
    ...clients.slice(0, 8).map((client) => ({
      date: client.created_at,
      type: "client",
      title: client.name,
      meta: "Cliente registrado",
    })),
    ...cases.slice(0, 8).map((item) => ({
      date: item.updated_at || item.created_at,
      type: "case",
      title: item.clients?.name ?? item.process_type,
      meta: displayCaseNumber(item.expediente, item.case_number),
    })),
    ...documents.slice(0, 8).map((doc) => ({
      date: doc.uploaded_at,
      type: "document",
      title: doc.name,
      meta: doc.clients?.name ?? "Documento sin cliente",
    })),
    // Solo incluir actividad de pagos si el rol tiene permiso (no ejecuta la query para Personal)
    ...(canViewPayments
      ? payments.slice(0, 8).map((payment) => ({
          date: payment.created_at,
          type: "payment",
          title: payment.clients?.name ?? payment.service,
          meta: payment.status,
        }))
      : []),
  ]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8);

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
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
        <KpiCard
          icon={Users}
          label="Clientes activos"
          value={activeClients.length}
          tone="clients"
          to="/clientes"
        />
        <KpiCard
          icon={Briefcase}
          label="Expedientes activos"
          value={activeCases.length}
          tone="cases"
          to="/casos"
        />
        <KpiCard
          icon={CalendarClock}
          label="Actividades próximas"
          value={upcomingEvents.length}
          tone="agenda"
          to="/agenda"
        />
        {canViewFinancialMetrics && (
          <KpiCard
            icon={CreditCard}
            label="Pagos pendientes"
            value={pendingPayments.length}
            tone="danger"
            to="/pagos"
          />
        )}
        <KpiCard
          icon={FileText}
          label="Docs. sin expediente"
          value={documentsWithoutCase.length}
          tone="documents"
          to="/documentos"
        />
      </div>

      <Card className="mt-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {/* Estas cuatro sí inician la acción real (abren su formulario de alta),
              reutilizando el mismo diálogo que la lista respectiva ya tiene. */}
          <QuickAction
            icon={UserPlus}
            label="Nuevo cliente"
            to="/clientes"
            search={{ nuevo: "1" }}
          />
          <QuickAction
            icon={FolderPlus}
            label="Nuevo expediente"
            to="/casos"
            search={{ nuevo: "1" }}
          />
          <QuickAction
            icon={FileText}
            label="Subir documento"
            to="/documentos"
            search={{ subir: "1" }}
          />
          {/* Pagos y Agenda quedan fuera de alcance de esta fase (sección R):
              el texto describe honestamente el destino real (una lista), en
              vez de prometer silenciosamente el inicio de un alta. */}
          {canViewPayments && <QuickAction icon={Landmark} label="Ver pagos" to="/pagos" />}
          <QuickAction icon={CalendarPlus} label="Ver agenda" to="/agenda" />
        </div>
      </Card>

      <Card className="mt-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold">
              <ClipboardList className="h-4 w-4 text-primary" /> Trabajo pendiente
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {isAdmin
                ? `${availableTaskCount} disponibles · ${runningTaskCount} en ejecución`
                : `${myTaskCount} propias · ${availableTaskCount} disponibles`}
            </p>
          </div>
          <Link
            to={"/tareas" as never}
            className="text-xs font-semibold text-primary hover:underline"
          >
            Abrir tareas
          </Link>
        </div>
        {tasksLoading ? (
          <div className="mt-4 h-16 animate-pulse rounded-lg bg-muted/50" />
        ) : dashboardTasks.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No hay trabajo pendiente.</p>
        ) : (
          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {dashboardTasks.map((task) => {
              const vs = getTaskVisualState(task, profile?.id);
              const Icon = vs.icon;
              return (
                <Link
                  key={task.id}
                  to={"/tareas/todas" as never}
                  search={{ tarea: task.id } as never}
                  className={`rounded-lg border-l-2 border border-border p-3 transition hover:shadow-sm ${vs.accentBorder} ${vs.rowBg}`}
                  aria-label={`${task.title} — ${vs.ariaDescription}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="line-clamp-2 text-sm font-semibold">{task.title}</span>
                    <span
                      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${vs.badgeClasses}`}
                    >
                      <Icon className="h-2.5 w-2.5" aria-hidden="true" />
                      {vs.label}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <TaskPriorityBadge priority={task.priority} iconOnly />
                    <span className="truncate text-xs text-muted-foreground">
                      {task.assignee?.full_name ?? "Sin responsable"} ·{" "}
                      {task.cases?.clients?.name ?? task.clients?.name ?? "Tarea general"}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold">Requiere atención</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">Prioridades reales del CRM</p>
            </div>
            <StatusBadge tone={todayEvents.length > 0 ? "warning" : "success"}>
              {todayEvents.length} hoy
            </StatusBadge>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <WorkBucket
              icon={CreditCard}
              label="Pagos vencidos"
              empty={
                canViewFinancialMetrics ? "Sin pagos vencidos." : "Visible para administradores."
              }
              items={
                canViewFinancialMetrics
                  ? overduePayments.map((p) => ({
                      title: p.clients?.name ?? "Cliente",
                      meta: p.service,
                    }))
                  : []
              }
            />
            <WorkBucket
              icon={CalendarClock}
              label="Actividades de hoy"
              empty="Sin eventos para hoy."
              items={todayEvents.slice(0, 5).map((e) => ({
                title: e.title,
                meta: `${String(e.event_time ?? "").slice(0, 5)} · ${e.clients?.name ?? "Sin cliente"}`,
              }))}
            />
            <WorkBucket
              icon={FileText}
              label="Documentos sin expediente"
              empty="No hay documentos sueltos."
              items={documentsWithoutCase.slice(0, 5).map((doc) => ({
                title: doc.name,
                meta: doc.clients?.name ?? "Sin cliente",
              }))}
            />
            <WorkBucket
              icon={Users}
              label="Clientes sin contacto"
              empty="Todos tienen teléfono o correo."
              items={clientsWithoutContact.map((client) => ({
                title: client.name,
                meta: "Revisar teléfono o correo",
              }))}
            />
          </div>
        </Card>

        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold">Próximas actividades</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">Audiencias, plazos y reuniones</p>
            </div>
            <Link
              to={"/agenda" as never}
              className="text-xs font-semibold text-primary hover:underline"
            >
              Ver agenda
            </Link>
          </div>
          <div className="space-y-3">
            {upcomingEvents.slice(0, 7).length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay actividades próximas.</p>
            ) : (
              upcomingEvents.slice(0, 7).map((event) => (
                <div
                  key={event.id}
                  className="flex items-center gap-3 rounded-lg border border-border p-3"
                >
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-primary/10 bg-primary/5 text-primary">
                    <div className="text-center leading-tight">
                      <div className="text-[10px] font-semibold uppercase">
                        {formatPeruDate(event.event_date, { month: "short" })}
                      </div>
                      <div className="text-base font-bold">
                        {Number(event.event_date.slice(8, 10))}
                      </div>
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{event.title}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {String(event.event_time ?? "").slice(0, 5)} · {event.type} ·{" "}
                      {event.clients?.name ?? event.cases?.process_type ?? "Sin cliente"}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold">Expedientes en revisión</h3>
            <Link
              to={"/casos" as never}
              className="text-xs font-semibold text-primary hover:underline"
            >
              Ver todos
            </Link>
          </div>
          <div className="space-y-3">
            {urgentCases.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay expedientes urgentes.</p>
            ) : (
              urgentCases.map((item) => (
                <Link
                  key={item.id}
                  to={"/casos/$id" as never}
                  params={{ id: item.id } as never}
                  className="block rounded-lg border border-border p-3 hover:bg-muted/30"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate text-sm font-semibold">
                      {item.clients?.name ?? item.process_type}
                    </div>
                    <StatusBadge tone="danger">Alta</StatusBadge>
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {displayCaseNumber(item.expediente, item.case_number)} ·{" "}
                    {normalizeCaseStatus(item.status)}
                  </div>
                </Link>
              ))
            )}
          </div>
        </Card>

        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold">Documentos pendientes</h3>
            <Link
              to={"/documentos" as never}
              className="text-xs font-semibold text-primary hover:underline"
            >
              Ver todos
            </Link>
          </div>
          <div className="space-y-3">
            {documentsPendingReview.slice(0, 5).length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay documentos pendientes.</p>
            ) : (
              documentsPendingReview.slice(0, 5).map((doc) => (
                <div key={doc.id} className="rounded-lg border border-border p-3">
                  <div className="truncate text-sm font-semibold">{doc.name}</div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {doc.document_type || doc.type} · {doc.clients?.name ?? "Sin cliente"}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold">Actividad reciente</h3>
            <Link
              to={"/reportes" as never}
              className="text-xs font-semibold text-primary hover:underline"
            >
              Reportes
            </Link>
          </div>
          <div className="space-y-3">
            {recentActivity.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aun no hay actividad registrada.</p>
            ) : (
              recentActivity.map((item, index) => {
                const Icon = activityIcon(item.type);
                return (
                  <div key={`${item.type}-${index}`} className="flex gap-3">
                    <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{item.title}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {item.meta} · {formatPeruDate(item.date)}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {recentReports.length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <div className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">
                Reportes recientes
              </div>
              <div className="space-y-2">
                {recentReports.map((report) => (
                  <div key={report.id} className="truncate text-xs text-muted-foreground">
                    {report.title} · {report.clients?.name ?? "Cliente"}
                  </div>
                ))}
              </div>
            </div>
          )}
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
  to,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  tone:
    | "clients"
    | "cases"
    | "agenda"
    | "documents"
    | "reports"
    | "tasks-available"
    | "tasks-mine"
    | "danger";
  to: string;
}) {
  const tones: Record<string, string> = {
    clients: "bg-[var(--kpi-clients)]/15 text-[var(--kpi-clients)]",
    cases: "bg-[var(--kpi-cases)]/15 text-[var(--kpi-cases)]",
    "tasks-available":
      "bg-[var(--kpi-tasks-available)]/20 text-[var(--kpi-tasks-available-foreground)]",
    "tasks-mine": "bg-[var(--kpi-tasks-mine)]/20 text-[var(--kpi-tasks-mine)]",
    agenda: "bg-[var(--kpi-agenda)]/15 text-[var(--kpi-agenda)]",
    documents: "bg-[var(--kpi-documents)]/15 text-[var(--kpi-documents)]",
    reports: "bg-[var(--kpi-reports)]/15 text-[var(--kpi-reports)]",
    danger: "bg-destructive/10 text-destructive",
  };
  return (
    <Link to={to as never} className="block col-span-1">
      <Card className="card-hover p-5">
        <div className="flex items-center gap-4">
          <div
            className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${tones[tone] ?? tones.clients}`}
            aria-hidden="true"
          >
            <Icon className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <div className="text-2xl font-bold tracking-tight">{value}</div>
            <div className="mt-0.5 text-xs text-muted-foreground truncate">{label}</div>
          </div>
        </div>
      </Card>
    </Link>
  );
}

function QuickAction({
  icon: Icon,
  label,
  to,
  search,
  onClick,
}: {
  icon: typeof Users;
  label: string;
  to?: string;
  search?: Record<string, string>;
  onClick?: () => void;
}) {
  const className =
    "inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-muted/60";
  if (to) {
    return (
      <Link to={to as never} search={search as never} className={className}>
        <Icon className="h-3.5 w-3.5" />
        {label}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
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
        <div className="grid h-6 w-6 place-items-center rounded-md bg-primary/10">
          <Icon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
        </div>
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
