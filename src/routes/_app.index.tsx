import { createFileRoute, Link } from "@tanstack/react-router";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { useClients } from "@/hooks/use-clients";
import { useCases } from "@/hooks/use-cases";
import { useAgendaEvents } from "@/hooks/use-agenda";
import { useAuth } from "@/hooks/use-auth";
import { usePayments } from "@/hooks/use-payments";
import { useClientReports } from "@/hooks/use-reports";
import { useDocuments } from "@/hooks/use-documents";
import { useImportJobsFilter } from "@/hooks/use-ai-findings";
import { ZipImport } from "@/components/zip-import";
import { displayCaseNumber, normalizeCaseStatus } from "@/lib/case-validation";
import { formatPeruDate, getPeruHour, getPeruTodayISO } from "@/lib/peru-time";
import { useState } from "react";
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
  Upload,
  CalendarPlus,
  FolderPlus,
  Landmark,
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
  const [showZipImport, setShowZipImport] = useState(false);
  const { data: clients = [] } = useClients();
  const { data: cases = [] } = useCases();
  const { data: events = [] } = useAgendaEvents();
  const { data: payments = [] } = usePayments({ enabled: isAdmin });
  const { data: reports = [] } = useClientReports();
  const { data: documents = [] } = useDocuments();
  const { data: importJobs = [] } = useImportJobsFilter({ enabled: isAdmin });

  const today = getPeruTodayISO();
  const activeClients = clients.filter((c) => c.status === "Activo");
  const activeCases = cases.filter(
    (c) => !["Archivado", "Concluido"].includes(normalizeCaseStatus(c.status)),
  );
  const pendingClassificationCases = activeCases.filter(
    (c) =>
      normalizeCaseStatus(c.status) === "Pendiente de clasificacion" ||
      c.case_stage === "pendiente_revision" ||
      !c.expediente.trim(),
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
  const importIssues = isAdmin
    ? importJobs.filter((job) => job.status === "failed" || job.failed_documents > 0).slice(0, 5)
    : [];
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
    ...payments.slice(0, 8).map((payment) => ({
      date: payment.created_at,
      type: "payment",
      title: payment.clients?.name ?? payment.service,
      meta: payment.status,
    })),
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
          tone="navy"
          to="/clientes"
        />
        <KpiCard
          icon={Briefcase}
          label="Expedientes activos"
          value={activeCases.length}
          tone="gold"
          to="/casos"
        />
        <KpiCard
          icon={AlertTriangle}
          label="Pendientes de clasificacion"
          value={pendingClassificationCases.length}
          tone="warning"
          to="/casos"
        />
        <KpiCard
          icon={CalendarClock}
          label="Actividades proximas"
          value={upcomingEvents.length}
          tone="info"
          to="/agenda"
        />
        <KpiCard
          icon={CreditCard}
          label="Pagos pendientes"
          value={pendingPayments.length}
          tone="danger"
          to="/pagos"
        />
        <KpiCard
          icon={FileText}
          label="Docs. sin expediente"
          value={documentsWithoutCase.length}
          tone="success"
          to="/documentos"
        />
      </div>

      <Card className="mt-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <QuickAction icon={UserPlus} label="Nuevo cliente" to="/clientes" />
          <QuickAction
            icon={Upload}
            label="Importar cliente desde ZIP"
            onClick={() => setShowZipImport(true)}
          />
          <QuickAction icon={FolderPlus} label="Nuevo expediente" to="/casos" />
          <QuickAction icon={FileText} label="Subir documento" to="/documentos" />
          {isAdmin && <QuickAction icon={Landmark} label="Registrar pago" to="/pagos" />}
          <QuickAction icon={CalendarPlus} label="Agendar actividad" to="/agenda" />
        </div>
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold">Requiere atencion</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">Prioridades reales del CRM</p>
            </div>
            <StatusBadge tone={todayEvents.length > 0 ? "warning" : "success"}>
              {todayEvents.length} hoy
            </StatusBadge>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <WorkBucket
              icon={AlertTriangle}
              label="Expedientes por clasificar"
              empty="Sin expedientes pendientes."
              items={pendingClassificationCases.slice(0, 5).map((c) => ({
                title: c.clients?.name ?? c.process_type,
                meta: displayCaseNumber(c.expediente, c.case_number),
              }))}
            />
            <WorkBucket
              icon={CreditCard}
              label="Pagos vencidos"
              empty={isAdmin ? "Sin pagos vencidos." : "Visible para administradores."}
              items={overduePayments.map((p) => ({
                title: p.clients?.name ?? "Cliente",
                meta: p.service,
              }))}
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
              empty="Todos tienen telefono o correo."
              items={clientsWithoutContact.map((client) => ({
                title: client.name,
                meta: client.process_type,
              }))}
            />
            <WorkBucket
              icon={ClipboardList}
              label="Importaciones con errores"
              empty={isAdmin ? "Sin errores recientes." : "Visible para administradores."}
              items={importIssues.map((job) => ({
                title: job.name,
                meta: `${job.failed_documents} fallidos de ${job.total_documents}`,
              }))}
            />
          </div>
        </Card>

        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold">Proximas actividades</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Audiencias, plazos, reuniones y tareas
              </p>
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
              <p className="text-sm text-muted-foreground">No hay actividades proximas.</p>
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
            <h3 className="text-base font-semibold">Expedientes en revision</h3>
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

      {showZipImport && (
        <ZipImport
          onClose={() => setShowZipImport(false)}
          onSuccess={() => setShowZipImport(false)}
        />
      )}
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
  tone: "navy" | "gold" | "success" | "warning" | "info" | "danger";
  to: string;
}) {
  const tones: Record<string, string> = {
    navy: "bg-primary/10 text-primary",
    gold: "bg-[oklch(0.96_0.05_85)] text-[oklch(0.5_0.13_75)]",
    success: "bg-emerald-50 text-emerald-700",
    warning: "bg-amber-50 text-amber-700",
    info: "bg-sky-50 text-sky-700",
    danger: "bg-red-50 text-red-700",
  };
  return (
    <Link to={to as never} className="block">
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
    </Link>
  );
}

function QuickAction({
  icon: Icon,
  label,
  to,
  onClick,
}: {
  icon: typeof Users;
  label: string;
  to?: string;
  onClick?: () => void;
}) {
  const className =
    "inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-muted/60";
  if (to) {
    return (
      <Link to={to as never} className={className}>
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
