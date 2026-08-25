import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { useClients } from "@/hooks/use-clients";
import { useCases } from "@/hooks/use-cases";
import { usePayments } from "@/hooks/use-payments";
import { useAgendaEvents } from "@/hooks/use-agenda";
import { useImportJobsFilter } from "@/hooks/use-ai-findings";
import { importJobStatusTone } from "@/lib/import-jobs-status";
import {
  exportFullBackup,
  exportClientsExcel,
  exportCasesExcel,
  exportPaymentsExcel,
  exportAgendaExcel,
} from "@/lib/export-excel";
import {
  beginGoogleCalendarConnection,
  getGoogleCalendarStatus,
  runGoogleCalendarAction,
  type GoogleCalendarStatus,
} from "@/lib/google-calendar-client";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Input } from "@/components/ui/input";
import { EmailSettings } from "@/components/settings/email-settings";
import { TemplatesSettings } from "@/components/settings/templates-settings";
import { UsersSettings } from "@/components/settings/users-settings";
import { GoogleDriveSettings } from "@/components/settings/google-drive-settings";
import { DEFAULT_SECTION, isValidSection, type Section } from "@/lib/settings-sections";
import {
  Bell,
  Mail,
  FileText,
  Shield,
  ChevronRight,
  Loader2,
  Download,
  Database,
  Calendar,
  HardDrive,
  CheckCircle,
  Users,
  Briefcase,
  CreditCard,
  CalendarDays,
  FolderArchive,
  History,
  Trash2,
} from "lucide-react";

export const Route = createFileRoute("/_app/configuracion/")({
  // QA-006: la sección activa vive en la URL (?seccion=...), no solo en
  // estado interno -- así refresh/Back/Forward/enlaces directos funcionan
  // correctamente. Una sección inválida o ausente cae al valor por defecto
  // seguro ("usuarios"), nunca a una pantalla en blanco o rota.
  validateSearch: (search: Record<string, unknown>): { seccion: Section } => ({
    seccion: isValidSection(search.seccion) ? search.seccion : DEFAULT_SECTION,
  }),
  head: () => ({ meta: [{ title: "Configuración — CRM Jurídico" }] }),
  component: SettingsPage,
});

const TABS: { id: Section; label: string; icon: typeof Shield }[] = [
  { id: "usuarios", label: "Usuarios y roles", icon: Shield },
  { id: "backup", label: "Backup / Exportar", icon: Database },
  { id: "herramientas", label: "Herramientas administrativas", icon: FolderArchive },
  { id: "google-calendar", label: "Google Calendar", icon: Calendar },
  { id: "google-drive", label: "Google Drive", icon: HardDrive },
  { id: "notificaciones", label: "Notificaciones", icon: Bell },
  { id: "correo", label: "Correo", icon: Mail },
  { id: "plantillas", label: "Plantillas", icon: FileText },
];

function SettingsPage() {
  const { seccion: tab } = Route.useSearch();

  const [exporting, setExporting] = useState(false);
  const [exportingType, setExportingType] = useState<string | null>(null);
  const [gcalStatus, setGcalStatus] = useState<GoogleCalendarStatus>({ connected: false });
  const [calendarId, setCalendarId] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const { profile: currentProfile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const canLoadAdminData = !authLoading && currentProfile?.role === "Administrador";

  // Redirect non-admins away from this page. Configuración en su totalidad
  // (incluida la sección Usuarios) sigue siendo exclusiva de Administrador
  // -- sin cambios respecto a fases anteriores. Plantillas para Personal
  // vive en /plantillas, no aquí.
  useEffect(() => {
    if (!authLoading && currentProfile && currentProfile.role !== "Administrador") {
      navigate({ to: "/", replace: true });
    }
  }, [currentProfile, authLoading, navigate]);

  useEffect(() => {
    if (!canLoadAdminData) return;
    getGoogleCalendarStatus()
      .then((status) => {
        setGcalStatus(status);
        if (status.calendarId) setCalendarId(status.calendarId);
      })
      .catch((cause) => {
        setSyncMessage(
          cause instanceof Error ? cause.message : "No se pudo consultar la conexión.",
        );
      });
  }, [canLoadAdminData]);

  const { data: clients = [] } = useClients({ enabled: canLoadAdminData });
  const { data: cases = [] } = useCases({ enabled: canLoadAdminData });
  const { data: payments = [] } = usePayments({ enabled: canLoadAdminData });
  const { data: agendaEvents = [] } = useAgendaEvents({ enabled: canLoadAdminData });

  // While auth resolves or if not admin, render nothing
  if (authLoading || !currentProfile || currentProfile.role !== "Administrador") return null;

  async function handleBackup() {
    setExporting(true);
    setExportingType("completo");
    try {
      await exportFullBackup({
        clients: clients.map((c) => ({
          name: c.name,
          phone: c.phone,
          email: c.email,
          status: c.status,
          registered_at: c.registered_at,
        })),
        cases: cases.map((c) => ({
          expediente: c.expediente,
          client: (c as { clients?: { name: string } | null }).clients?.name ?? "—",
          process_type: c.process_type,
          materia: c.materia,
          status: c.status,
          priority: c.priority,
          next_action: c.next_action,
          next_hearing: c.next_hearing,
          created_at: c.created_at,
        })),
        payments: payments.map((p) => ({
          client: (p as { clients?: { name: string } | null }).clients?.name ?? "—",
          service: p.service,
          fees: Number(p.fees),
          paid: Number(p.paid),
          pending: Number(p.fees) - Number(p.paid),
          total_installments: p.total_installments,
          paid_installments: p.paid_installments,
          status: p.status,
          created_at: p.created_at,
        })),
        agendaEvents: agendaEvents.map((e) => ({
          title: e.title,
          type: e.type,
          event_date: e.event_date,
          event_time: String(e.event_time),
          location: e.location,
          client: (e as { clients?: { name: string } | null }).clients?.name ?? null,
        })),
      });
    } finally {
      setExporting(false);
      setExportingType(null);
    }
  }

  async function handleExportSection(type: string) {
    setExporting(true);
    setExportingType(type);
    try {
      if (type === "clientes") {
        await exportClientsExcel(
          clients.map((c) => ({
            name: c.name,
            phone: c.phone,
            email: c.email,
            status: c.status,
            registered_at: c.registered_at,
          })),
        );
      } else if (type === "casos") {
        await exportCasesExcel(
          cases.map((c) => ({
            expediente: c.expediente,
            client: (c as { clients?: { name: string } | null }).clients?.name ?? "—",
            process_type: c.process_type,
            materia: c.materia,
            status: c.status,
            priority: c.priority,
            next_action: c.next_action,
            next_hearing: c.next_hearing,
            created_at: c.created_at,
          })),
        );
      } else if (type === "pagos") {
        await exportPaymentsExcel(
          payments.map((p) => ({
            client: (p as { clients?: { name: string } | null }).clients?.name ?? "—",
            service: p.service,
            fees: Number(p.fees),
            paid: Number(p.paid),
            pending: Number(p.fees) - Number(p.paid),
            total_installments: p.total_installments,
            paid_installments: p.paid_installments,
            status: p.status,
            created_at: p.created_at,
          })),
        );
      } else if (type === "agenda") {
        await exportAgendaExcel(
          agendaEvents.map((e) => ({
            title: e.title,
            type: e.type,
            event_date: e.event_date,
            event_time: String(e.event_time),
            location: e.location,
            client: (e as { clients?: { name: string } | null }).clients?.name ?? null,
          })),
        );
      }
    } finally {
      setExporting(false);
      setExportingType(null);
    }
  }

  async function handleGCalSync() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      await runGoogleCalendarAction("sync");
      setSyncMessage("Sincronización incremental completada.");
      setGcalStatus(await getGoogleCalendarStatus());
    } catch (cause) {
      setSyncMessage(cause instanceof Error ? cause.message : "Error al sincronizar.");
    } finally {
      setSyncing(false);
    }
  }

  async function handleGCalConnect() {
    setSyncMessage(null);
    try {
      await beginGoogleCalendarConnection(calendarId.trim());
    } catch (cause) {
      setSyncMessage(cause instanceof Error ? cause.message : "No se pudo iniciar la conexión.");
    }
  }

  async function handleGCalDisconnect() {
    if (window.confirm("¿Desconectar Google Calendar y revocar su acceso?")) {
      setSyncing(true);
      try {
        await runGoogleCalendarAction("disconnect");
        setGcalStatus({ connected: false });
        setSyncMessage("Google Calendar fue desconectado.");
      } catch (cause) {
        setSyncMessage(cause instanceof Error ? cause.message : "No se pudo desconectar.");
      } finally {
        setSyncing(false);
      }
    }
  }

  async function handleGCalRenew() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      await runGoogleCalendarAction("renew");
      setGcalStatus(await getGoogleCalendarStatus());
      setSyncMessage("Canal de notificaciones renovado.");
    } catch (cause) {
      setSyncMessage(cause instanceof Error ? cause.message : "No se pudo renovar el canal.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <AppLayout title="Configuración" subtitle="Gestión del estudio y preferencias">
      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6">
        {/* Sidebar nav */}
        <Card className="p-3 h-fit">
          <nav className="space-y-1">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <Link
                  key={t.id}
                  to="/configuracion"
                  search={{ seccion: t.id } as never}
                  aria-current={active ? "page" : undefined}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition ${active ? "bg-primary text-primary-foreground font-semibold shadow-soft" : "hover:bg-muted/50"}`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="flex-1 text-left">{t.label}</span>
                  <ChevronRight
                    className={`h-4 w-4 ${active ? "text-primary-foreground/70" : "text-muted-foreground"}`}
                  />
                </Link>
              );
            })}
          </nav>
        </Card>

        <div>
          {tab === "usuarios" && <UsersSettings />}

          {/* ── BACKUP TAB ── */}
          {tab === "backup" && (
            <div className="space-y-4">
              {/* Full backup card */}
              <Card className="p-6">
                <div className="flex items-start gap-4 mb-5">
                  <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary shrink-0">
                    <Database className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold">Backup completo</h3>
                    <p className="text-xs text-muted-foreground">
                      Descarga un archivo Excel (.xlsx) con todos los datos: clientes, expedientes,
                      pagos y agenda. Guárdalo en un lugar seguro como respaldo.
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleBackup}
                  disabled={exporting}
                  className="h-10 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 disabled:opacity-60 flex items-center gap-2"
                >
                  {exporting && exportingType === "completo" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Generando backup...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" /> Descargar backup completo
                    </>
                  )}
                </button>
              </Card>

              {/* Individual exports */}
              <Card className="p-6">
                <h3 className="text-base font-semibold mb-1">Exportar por sección</h3>
                <p className="text-xs text-muted-foreground mb-4">
                  Descarga cada módulo por separado en formato Excel.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    { key: "clientes", label: "Clientes", icon: Users, count: clients.length },
                    { key: "casos", label: "Expedientes", icon: Briefcase, count: cases.length },
                    { key: "pagos", label: "Pagos", icon: CreditCard, count: payments.length },
                    {
                      key: "agenda",
                      label: "Agenda",
                      icon: CalendarDays,
                      count: agendaEvents.length,
                    },
                  ].map(({ key, label, icon: Icon, count }) => (
                    <button
                      key={key}
                      onClick={() => handleExportSection(key)}
                      disabled={exporting}
                      className="flex items-center gap-3 p-4 rounded-lg border border-border hover:border-primary/30 hover:bg-muted/30 transition disabled:opacity-60 text-left"
                    >
                      <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary shrink-0">
                        {exporting && exportingType === key ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                          <Icon className="h-5 w-5" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">{label}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {count} registro{count !== 1 ? "s" : ""} · .xlsx
                        </div>
                      </div>
                      <Download className="h-4 w-4 text-muted-foreground ml-auto shrink-0" />
                    </button>
                  ))}
                </div>
              </Card>
            </div>
          )}

          {tab === "herramientas" && <AdministrativeImportToolsPanel />}

          {/* ── GOOGLE CALENDAR TAB ── */}
          {tab === "google-calendar" && (
            <Card className="p-6">
              <div className="flex items-center gap-3 mb-5">
                <div className="grid h-12 w-12 place-items-center rounded-xl bg-sky-50 text-sky-600 shrink-0">
                  <Calendar className="h-6 w-6" />
                </div>
                <div className="flex-1">
                  <h3 className="text-base font-semibold">Google Calendar</h3>
                  <p className="text-xs text-muted-foreground">
                    Sincroniza Agenda con el calendario compartido de la organización.
                  </p>
                </div>
                <StatusBadge tone={gcalStatus.connected ? "success" : "default"}>
                  {gcalStatus.connected ? "Conectado" : "No conectado"}
                </StatusBadge>
              </div>

              {!gcalStatus.connected ? (
                <div className="space-y-4">
                  <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-4 text-sm">
                    <p className="font-semibold">Calendario compartido de la organización</p>
                    <p className="text-xs text-muted-foreground">
                      La autorización, los tokens y los secretos se procesan exclusivamente en el
                      servidor. Introduce el ID del calendario compartido autorizado.
                    </p>
                    <label
                      htmlFor="calendar-id-connect"
                      className="grid gap-1.5 text-xs font-medium"
                    >
                      ID del calendario
                      <Input
                        id="calendar-id-connect"
                        value={calendarId}
                        onChange={(event) => setCalendarId(event.target.value)}
                        placeholder="calendario@group.calendar.google.com"
                      />
                    </label>
                  </div>
                  <button
                    onClick={handleGCalConnect}
                    disabled={!calendarId.trim()}
                    className="h-10 px-5 rounded-lg bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 flex items-center gap-2"
                  >
                    <Calendar className="h-4 w-4" /> Conectar Google Calendar
                  </button>
                  {syncMessage && (
                    <p className="rounded-lg border border-border p-3 text-sm">{syncMessage}</p>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 flex items-center gap-3">
                    <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0" />
                    <div className="text-sm">
                      <span className="font-semibold text-emerald-800">
                        {gcalStatus.calendarName || "Calendario compartido conectado"}.
                      </span>
                      <span className="text-emerald-700">
                        {" "}
                        {gcalStatus.accountEmail || gcalStatus.calendarId}
                      </span>
                    </div>
                  </div>

                  <label
                    htmlFor="calendar-id-connected"
                    className="grid gap-1.5 text-xs font-medium"
                  >
                    ID del calendario compartido
                    <Input
                      id="calendar-id-connected"
                      value={calendarId}
                      onChange={(event) => setCalendarId(event.target.value)}
                    />
                  </label>

                  <div>
                    <h4 className="text-sm font-semibold mb-1">Sincronizar eventos</h4>
                    <p className="text-xs text-muted-foreground mb-3">
                      Ejecuta cambios incrementales en ambas direcciones. Última sincronización:{" "}
                      {gcalStatus.lastSyncedAt
                        ? new Date(gcalStatus.lastSyncedAt).toLocaleString("es-PE")
                        : "pendiente"}
                      .
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={handleGCalSync}
                        disabled={syncing}
                        className="h-10 px-5 rounded-lg bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 disabled:opacity-60 flex items-center gap-2"
                      >
                        {syncing ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Calendar className="h-4 w-4" />
                        )}
                        Sincronizar ahora
                      </button>
                      <button
                        onClick={handleGCalRenew}
                        disabled={syncing}
                        className="h-10 rounded-lg border border-border px-4 text-sm font-semibold"
                      >
                        Renovar webhook
                      </button>
                      <button
                        onClick={handleGCalConnect}
                        disabled={syncing || !calendarId.trim()}
                        className="h-10 rounded-lg border border-border px-4 text-sm font-semibold disabled:opacity-60"
                      >
                        Cambiar calendario
                      </button>
                      <button
                        onClick={handleGCalConnect}
                        disabled={syncing || !calendarId.trim()}
                        className="h-10 rounded-lg border border-border px-4 text-sm font-semibold disabled:opacity-60"
                      >
                        Reconectar
                      </button>
                    </div>
                    <dl className="mt-3 grid gap-2 rounded-lg border p-3 text-xs sm:grid-cols-2">
                      <div>
                        <dt className="text-muted-foreground">Webhook</dt>
                        <dd>{gcalStatus.webhookActive ? "Activo" : "Sin canal activo"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Próxima renovación</dt>
                        <dd>
                          {gcalStatus.channelExpiresAt
                            ? new Date(gcalStatus.channelExpiresAt).toLocaleString("es-PE")
                            : "No programada"}
                        </dd>
                      </div>
                    </dl>
                    {(syncMessage || gcalStatus.lastError) && (
                      <p className="mt-3 rounded-lg border border-border p-3 text-sm">
                        {syncMessage || gcalStatus.lastError}
                      </p>
                    )}
                  </div>

                  <div className="pt-3 border-t border-border">
                    <button
                      onClick={handleGCalDisconnect}
                      className="h-9 px-4 rounded-lg border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 transition"
                    >
                      Desconectar Google Calendar
                    </button>
                  </div>
                </div>
              )}
            </Card>
          )}

          {tab === "google-drive" && <GoogleDriveSettings />}

          {tab === "notificaciones" && (
            <Card className="p-6">
              <h3 className="text-base font-semibold mb-1">Notificaciones</h3>
              <p className="text-xs text-muted-foreground mb-5">
                Configura cómo y cuándo recibir avisos.
              </p>
              <div className="space-y-1">
                {[
                  {
                    l: "Audiencias próximas",
                    d: "Recibir alerta 24h antes de cada audiencia.",
                    key: "audiencias",
                  },
                  {
                    l: "Pagos vencidos",
                    d: "Aviso diario de cuentas por cobrar vencidas.",
                    key: "pagos",
                  },
                  {
                    l: "Nuevos documentos",
                    d: "Notificar cuando se cargue un documento al expediente.",
                    key: "documentos",
                  },
                  {
                    l: "Resumen semanal",
                    d: "Reporte ejecutivo cada lunes a las 8 a. m.",
                    key: "resumen",
                  },
                ].map((n) => (
                  <Toggle key={n.key} label={n.l} desc={n.d} storageKey={n.key} />
                ))}
              </div>
            </Card>
          )}

          {tab === "correo" && <EmailSettings />}

          {tab === "plantillas" && <TemplatesSettings />}
        </div>
      </div>
    </AppLayout>
  );
}

function AdministrativeImportToolsPanel() {
  const { data: importJobs = [], isLoading } = useImportJobsFilter();
  const latestJobs = importJobs.slice(0, 8);

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="flex items-start gap-4">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary shrink-0">
            <History className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold">Historial de importaciones</h3>
            <p className="text-xs text-muted-foreground">
              Trabajos administrativos registrados en Supabase para revisar estado, documentos
              procesados y errores.
            </p>
          </div>
        </div>

        <div className="mt-5 overflow-x-auto rounded-lg border border-border">
          <table className="min-w-[760px] w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="py-3 pl-4 pr-3 font-semibold">Importación</th>
                <th className="py-3 px-3 font-semibold">Estado</th>
                <th className="py-3 px-3 font-semibold">Documentos</th>
                <th className="py-3 px-3 font-semibold">Detección</th>
                <th className="py-3 pr-4 font-semibold">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center">
                    <Loader2 className="h-5 w-5 animate-spin text-primary mx-auto" />
                  </td>
                </tr>
              ) : latestJobs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                    No hay trabajos de importación registrados.
                  </td>
                </tr>
              ) : (
                latestJobs.map((job) => (
                  <tr key={job.id} className="border-t border-border hover:bg-muted/30">
                    <td className="py-3 pl-4 pr-3">
                      <div className="font-semibold">{job.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {job.provider} · {job.total_folders} carpeta
                        {job.total_folders !== 1 ? "s" : ""}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <StatusBadge tone={importJobStatusTone(job.status)}>{job.status}</StatusBadge>
                    </td>
                    <td className="py-3 px-3 text-xs text-muted-foreground">
                      {job.processed_documents}/{job.total_documents} procesados
                      {job.failed_documents > 0 && (
                        <span className="ml-1 text-red-600">· {job.failed_documents} fallidos</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-xs text-muted-foreground">
                      {job.detected_clients} clientes · {job.detected_cases} expedientes
                    </td>
                    <td className="py-3 pr-4 text-xs text-muted-foreground">
                      {new Date(job.created_at).toLocaleString("es-PE", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-start gap-4">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-red-50 text-red-600 shrink-0">
            <Trash2 className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold">Limpieza segura</h3>
            <p className="text-xs text-muted-foreground">
              La limpieza de importaciones de prueba se ejecuta fuera de la interfaz para exigir
              revisión previa y evitar borrados accidentales.
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 text-xs md:grid-cols-2">
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="font-semibold text-foreground">Vista previa obligatoria</p>
            <code className="mt-2 block rounded bg-background px-2 py-1 font-mono text-[11px]">
              npm run cleanup:test-imports -- --dry-run
            </code>
          </div>
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="font-semibold text-red-700">Ejecución confirmada</p>
            <code className="mt-2 block rounded bg-background px-2 py-1 font-mono text-[11px] text-red-700">
              npm run cleanup:test-imports -- --execute
            </code>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Toggle({ label, desc, storageKey }: { label: string; desc: string; storageKey: string }) {
  const [on, setOn] = useState(() => {
    // SSR-safe: only access localStorage in the browser
    if (typeof window === "undefined") return true;
    try {
      const saved = localStorage.getItem(`notification_pref_${storageKey}`);
      return saved !== null ? saved === "true" : true;
    } catch {
      return true;
    }
  });

  function toggle() {
    const next = !on;
    setOn(next);
    // SSR-safe: only access localStorage in the browser
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(`notification_pref_${storageKey}`, String(next));
    } catch {
      /* silencioso si localStorage no disponible */
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-border last:border-0">
      <div className="min-w-0">
        <div className="text-sm font-semibold">{label}</div>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <button
        onClick={toggle}
        aria-label={on ? "Desactivar" : "Activar"}
        className={`relative h-6 w-11 rounded-full transition ${on ? "bg-primary" : "bg-muted"}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`}
        />
      </button>
    </div>
  );
}
