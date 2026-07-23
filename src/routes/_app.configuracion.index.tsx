import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { useProfiles, useRegisterStaff, useUpdateProfile } from "@/hooks/use-profiles";
import { useClients } from "@/hooks/use-clients";
import { useCases } from "@/hooks/use-cases";
import { usePayments } from "@/hooks/use-payments";
import { saveAgendaGoogleIds, useAgendaEvents } from "@/hooks/use-agenda";
import { useImportJobsFilter } from "@/hooks/use-ai-findings";
import { MassImportDryRun } from "@/components/mass-import-dry-run";
import {
  exportFullBackup,
  exportClientsExcel,
  exportCasesExcel,
  exportPaymentsExcel,
  exportAgendaExcel,
} from "@/lib/export-excel";
import {
  initiateGoogleOAuth,
  isGoogleCalendarConnected,
  disconnectGoogleCalendar,
  syncAllEventsToGoogle,
} from "@/lib/google-calendar";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  Plus,
  Bell,
  MessageCircle,
  Mail,
  FileText,
  Shield,
  ChevronRight,
  X,
  Eye,
  EyeOff,
  Loader2,
  Download,
  Database,
  Calendar,
  CheckCircle,
  Users,
  Briefcase,
  CreditCard,
  CalendarDays,
  FolderArchive,
  History,
  Wrench,
  Trash2,
} from "lucide-react";

export const Route = createFileRoute("/_app/configuracion/")({
  head: () => ({ meta: [{ title: "Configuración — CRM Jurídico" }] }),
  component: SettingsPage,
});

const TABS = [
  { id: "usuarios", label: "Usuarios y roles", icon: Shield },
  { id: "backup", label: "Backup / Exportar", icon: Database },
  { id: "herramientas", label: "Herramientas administrativas", icon: FolderArchive },
  { id: "google-calendar", label: "Google Calendar", icon: Calendar },
  { id: "notificaciones", label: "Notificaciones", icon: Bell },
  { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { id: "correo", label: "Correo", icon: Mail },
  { id: "plantillas", label: "Plantillas", icon: FileText },
];

const ROLES = ["Administrador", "Personal"] as const;
type Role = (typeof ROLES)[number];

const roleColor: Record<Role, "navy" | "info"> = {
  Administrador: "navy",
  Personal: "info",
};

function SettingsPage() {
  const [tab, setTab] = useState("usuarios");
  const [showRegister, setShowRegister] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    role: "Personal" as Role,
    phone: "",
  });
  const [exporting, setExporting] = useState(false);
  const [exportingType, setExportingType] = useState<string | null>(null);
  const [gcalConnected, setGcalConnected] = useState(isGoogleCalendarConnected);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ success: number; errors: number } | null>(null);

  // Edit staff modal state
  const [editProfile, setEditProfile] = useState<{
    id: string;
    full_name: string;
    phone: string;
    role: Role;
    status: string;
  } | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const { profile: currentProfile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const canLoadAdminData = !authLoading && currentProfile?.role === "Administrador";

  // Redirect non-admins away from this page
  useEffect(() => {
    if (!authLoading && currentProfile && currentProfile.role !== "Administrador") {
      navigate({ to: "/", replace: true });
    }
  }, [currentProfile, authLoading, navigate]);

  const { data: profiles = [], isLoading } = useProfiles({ enabled: canLoadAdminData });
  const { data: clients = [] } = useClients({ enabled: canLoadAdminData });
  const { data: cases = [] } = useCases({ enabled: canLoadAdminData });
  const { data: payments = [] } = usePayments({ enabled: canLoadAdminData });
  const { data: agendaEvents = [] } = useAgendaEvents({ enabled: canLoadAdminData });
  const registerStaff = useRegisterStaff();
  const updateProfile = useUpdateProfile();

  // While auth resolves or if not admin, render nothing
  if (authLoading || !currentProfile || currentProfile.role !== "Administrador") return null;

  async function handleEditProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!editProfile) return;
    setEditSaving(true);
    setEditError(null);
    const words = editProfile.full_name.trim().split(/\s+/);
    const initials =
      words.length >= 2
        ? (words[0][0] + words[1][0]).toUpperCase()
        : words[0].slice(0, 2).toUpperCase();
    try {
      await updateProfile.mutateAsync({
        id: editProfile.id,
        updates: {
          full_name: editProfile.full_name,
          phone: editProfile.phone || null,
          role: editProfile.role,
          status: editProfile.status as "Activo" | "Inactivo",
          initials,
        },
      });
      setEditProfile(null);
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : "Error al actualizar.");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleBackup() {
    setExporting(true);
    setExportingType("completo");
    try {
      await exportFullBackup({
        clients: clients.map((c) => ({
          name: c.name,
          dni: c.dni,
          phone: c.phone,
          email: c.email,
          process_type: c.process_type,
          status: c.status,
          registered_at: c.registered_at,
        })),
        cases: cases.map((c) => ({
          expediente: c.expediente,
          client: (c as { clients?: { name: string } | null }).clients?.name ?? "—",
          process_type: c.process_type,
          status: c.status,
          priority: c.priority,
          juzgado: c.juzgado,
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
            dni: c.dni,
            phone: c.phone,
            email: c.email,
            process_type: c.process_type,
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
            status: c.status,
            priority: c.priority,
            juzgado: c.juzgado,
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
    setSyncResult(null);
    try {
      const events = agendaEvents.map((e) => ({
        id: e.id,
        title: e.title,
        type: e.type,
        event_date: e.event_date,
        event_time: String(e.event_time),
        location: e.location,
        client: (e as { clients?: { name: string } | null }).clients?.name ?? null,
        case: (e as { cases?: { expediente: string } | null }).cases?.expediente ?? null,
      }));
      const result = await syncAllEventsToGoogle(events);
      await saveAgendaGoogleIds(result.gcalIds);
      setSyncResult(result);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Error al sincronizar");
    } finally {
      setSyncing(false);
    }
  }

  function handleGCalConnect() {
    initiateGoogleOAuth();
  }

  function handleGCalDisconnect() {
    if (window.confirm("¿Desconectar Google Calendar?")) {
      disconnectGoogleCalendar();
      setGcalConnected(false);
      setSyncResult(null);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      await registerStaff.mutateAsync({
        email: form.email,
        password: form.password,
        fullName: `${form.firstName} ${form.lastName}`.trim(),
        role: form.role,
        phone: form.phone,
      });
      setShowRegister(false);
      setForm({
        firstName: "",
        lastName: "",
        email: "",
        password: "",
        role: "Personal",
        phone: "",
      });
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Error al registrar. Verifica los datos.");
    } finally {
      setSaving(false);
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
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition ${active ? "bg-primary text-primary-foreground font-semibold shadow-soft" : "hover:bg-muted/50"}`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="flex-1 text-left">{t.label}</span>
                  <ChevronRight
                    className={`h-4 w-4 ${active ? "text-primary-foreground/70" : "text-muted-foreground"}`}
                  />
                </button>
              );
            })}
          </nav>
        </Card>

        <div>
          {tab === "usuarios" && (
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <div>
                  <h3 className="text-base font-semibold">Personal del estudio</h3>
                  <p className="text-xs text-muted-foreground">Roles: Administrador · Personal</p>
                </div>
                <button
                  onClick={() => setShowRegister(true)}
                  className="inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:brightness-110"
                >
                  <Plus className="h-3.5 w-3.5" /> Registrar personal
                </button>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                    <th className="py-3 pl-5">Usuario</th>
                    <th className="py-3 px-3">Rol</th>
                    <th className="py-3 px-3">Estado</th>
                    <th className="py-3 pr-5 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={4} className="py-10 text-center">
                        <Loader2 className="h-5 w-5 animate-spin text-primary mx-auto" />
                      </td>
                    </tr>
                  ) : profiles.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-10 text-center text-sm text-muted-foreground">
                        No hay personal registrado aún.
                      </td>
                    </tr>
                  ) : (
                    profiles.map((u) => (
                      <tr key={u.id} className="border-t border-border hover:bg-muted/30">
                        <td className="py-3 pl-5">
                          <div className="flex items-center gap-3">
                            <div className="grid h-9 w-9 place-items-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
                              {u.initials}
                            </div>
                            <div>
                              <div className="font-semibold">{u.full_name}</div>
                              <div className="text-xs text-muted-foreground">{u.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <StatusBadge
                            tone={roleColor[u.role as keyof typeof roleColor] || "default"}
                          >
                            {u.role}
                          </StatusBadge>
                        </td>
                        <td className="py-3 px-3">
                          <StatusBadge tone={u.status === "Activo" ? "success" : "default"}>
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${u.status === "Activo" ? "bg-emerald-500" : "bg-muted-foreground"}`}
                            />{" "}
                            {u.status}
                          </StatusBadge>
                        </td>
                        <td className="py-3 pr-5 text-right">
                          <button
                            onClick={() =>
                              setEditProfile({
                                id: u.id,
                                full_name: u.full_name,
                                phone: u.phone ?? "",
                                role: u.role as Role,
                                status: u.status,
                              })
                            }
                            className="h-8 px-3 rounded-md text-xs font-semibold text-primary hover:bg-primary/10"
                          >
                            Editar
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </Card>
          )}

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
                    Sincroniza los eventos de la agenda con el Google Calendar del Dr.
                  </p>
                </div>
                <StatusBadge tone={gcalConnected ? "success" : "default"}>
                  {gcalConnected ? "Conectado" : "No conectado"}
                </StatusBadge>
              </div>

              {!gcalConnected ? (
                <div className="space-y-4">
                  <div className="rounded-lg bg-muted/40 border border-border p-4 text-sm text-muted-foreground space-y-2">
                    <p className="font-semibold text-foreground">Pasos para conectar:</p>
                    <ol className="list-decimal list-inside space-y-1.5 text-xs">
                      <li>
                        Ve a{" "}
                        <span className="font-mono bg-muted px-1 rounded">
                          console.cloud.google.com
                        </span>
                      </li>
                      <li>
                        Crea un proyecto → <em>APIs & Services</em> → <em>Credentials</em>
                      </li>
                      <li>
                        Crea un <strong>OAuth 2.0 Client ID</strong> (tipo: Web application)
                      </li>
                      <li>
                        Agrega como URI autorizado:{" "}
                        <span className="font-mono bg-muted px-1 rounded text-[10px] break-all">
                          {typeof window !== "undefined"
                            ? window.location.origin + "/google-calendar-callback"
                            : "/google-calendar-callback"}
                        </span>
                      </li>
                      <li>
                        Copia el Client ID en tu{" "}
                        <span className="font-mono bg-muted px-1 rounded">.env</span> como{" "}
                        <span className="font-mono bg-muted px-1 rounded">
                          VITE_GOOGLE_CLIENT_ID=...
                        </span>
                      </li>
                      <li>
                        Reinicia el servidor y haz clic en <strong>Conectar</strong>
                      </li>
                    </ol>
                  </div>
                  <button
                    onClick={handleGCalConnect}
                    className="h-10 px-5 rounded-lg bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 flex items-center gap-2"
                  >
                    <Calendar className="h-4 w-4" /> Conectar Google Calendar
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 flex items-center gap-3">
                    <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0" />
                    <div className="text-sm">
                      <span className="font-semibold text-emerald-800">
                        Calendario conectado correctamente.
                      </span>
                      <span className="text-emerald-700">
                        {" "}
                        Puedes sincronizar todos los eventos del CRM.
                      </span>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-semibold mb-1">Sincronizar eventos</h4>
                    <p className="text-xs text-muted-foreground mb-3">
                      Envía todos los eventos de la agenda ({agendaEvents.length} eventos) a tu
                      Google Calendar. Los eventos ya sincronizados se omiten automáticamente.
                    </p>
                    <button
                      onClick={handleGCalSync}
                      disabled={syncing}
                      className="h-10 px-5 rounded-lg bg-sky-600 text-white text-sm font-semibold hover:bg-sky-700 disabled:opacity-60 flex items-center gap-2"
                    >
                      {syncing ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> Sincronizando...
                        </>
                      ) : (
                        <>
                          <Calendar className="h-4 w-4" /> Sincronizar {agendaEvents.length} eventos
                        </>
                      )}
                    </button>

                    {syncResult && (
                      <div className="mt-3 rounded-lg border border-border p-3 text-sm">
                        <span className="text-emerald-700 font-semibold">
                          ✓ {syncResult.success} eventos sincronizados
                        </span>
                        {syncResult.errors > 0 && (
                          <span className="text-red-600 font-semibold ml-3">
                            ✗ {syncResult.errors} errores
                          </span>
                        )}
                      </div>
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

          {tab === "whatsapp" && (
            <Card className="p-6">
              <div className="flex items-center gap-3 mb-5">
                <div className="grid h-12 w-12 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
                  <MessageCircle className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-base font-semibold">Integración con WhatsApp Business</h3>
                  <p className="text-xs text-muted-foreground">
                    Envía recordatorios y confirmaciones de audiencia a clientes.
                  </p>
                </div>
                <span className="ml-auto">
                  <StatusBadge tone="info">Próximamente</StatusBadge>
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="Número conectado" value="+51 998 ••• •••" />
                <FormField label="Nombre del remitente" value="Abogados a tu Servicio" />
                <FormField label="Plantilla por defecto" value="Recordatorio audiencia" />
                <FormField label="Idioma" value="Español (Perú)" />
              </div>
              <button
                disabled
                className="mt-5 h-10 px-4 rounded-lg bg-muted text-muted-foreground text-sm font-semibold cursor-not-allowed"
              >
                Disponible próximamente
              </button>
            </Card>
          )}

          {tab === "correo" && (
            <Card className="p-6">
              <div className="flex items-center gap-3 mb-5">
                <div className="grid h-12 w-12 place-items-center rounded-xl bg-sky-50 text-sky-600">
                  <Mail className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-base font-semibold">Configuración de correo</h3>
                  <p className="text-xs text-muted-foreground">
                    Servidor SMTP para envío automático de notificaciones. Próximamente.
                  </p>
                </div>
                <span className="ml-auto">
                  <StatusBadge tone="info">Próximamente</StatusBadge>
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField label="Servidor SMTP" value="smtp.abogados.pe" />
                <FormField label="Puerto" value="587" />
                <FormField label="Usuario" value="notificaciones@abogados.pe" />
                <FormField label="Encriptación" value="TLS" />
              </div>
            </Card>
          )}

          {tab === "plantillas" && (
            <Card className="p-6">
              <h3 className="text-base font-semibold mb-1">Plantillas de documentos</h3>
              <p className="text-xs text-muted-foreground mb-5">
                Documentos preconfigurados para uso rápido. Próximamente.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  "Demanda de divorcio",
                  "Demanda laboral",
                  "Carta notarial",
                  "Poder general",
                  "Contrato de servicios",
                  "Escrito de apelación",
                ].map((t, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 p-4 rounded-lg border border-border hover:border-primary/30 hover:bg-muted/30 transition cursor-pointer"
                  >
                    <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold truncate">{t}</div>
                      <div className="text-[11px] text-muted-foreground">
                        Plantilla DOCX · 12 variables
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Register Staff Modal */}
      {showRegister && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <Card className="w-full max-w-md p-6 shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-base font-semibold">Registrar personal</h3>
                <p className="text-xs text-muted-foreground">Añade un miembro al estudio</p>
              </div>
              <button
                onClick={() => setShowRegister(false)}
                className="h-8 w-8 grid place-items-center rounded-lg hover:bg-muted/60"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  label="Nombre *"
                  value={form.firstName}
                  onChange={(v) => setForm((f) => ({ ...f, firstName: v }))}
                />
                <FormField
                  label="Apellidos *"
                  value={form.lastName}
                  onChange={(v) => setForm((f) => ({ ...f, lastName: v }))}
                />
              </div>
              <FormField
                label="Correo electrónico *"
                value={form.email}
                onChange={(v) => setForm((f) => ({ ...f, email: v }))}
              />
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Contraseña *
                </label>
                <div className="relative mt-1.5">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    placeholder="Mínimo 8 caracteres"
                    required
                    className="w-full h-10 px-3 pr-10 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Rol
                </label>
                <div className="mt-1.5 flex gap-3">
                  {ROLES.map((r) => (
                    <label
                      key={r}
                      className="flex-1 flex items-center gap-2 p-3 rounded-lg border border-border cursor-pointer hover:border-primary/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5 transition"
                    >
                      <input
                        type="radio"
                        name="rol"
                        value={r}
                        checked={form.role === r}
                        onChange={() => setForm((f) => ({ ...f, role: r }))}
                        className="accent-primary"
                      />
                      <span className="text-sm font-medium">{r}</span>
                    </label>
                  ))}
                </div>
              </div>
              <FormField
                label="Teléfono (opcional)"
                value={form.phone}
                onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
              />
              {formError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {formError}
                </p>
              )}
              <div className="flex gap-3 mt-2">
                <button
                  type="button"
                  onClick={() => setShowRegister(false)}
                  className="flex-1 h-10 rounded-lg border border-border text-sm font-medium hover:bg-muted/60"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {saving ? "Registrando..." : "Registrar"}
                </button>
              </div>
            </form>
          </Card>
        </div>
      )}
      {/* Edit Staff Modal */}
      {editProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <Card className="w-full max-w-md p-6 shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-base font-semibold">Editar usuario</h3>
                <p className="text-xs text-muted-foreground">Actualiza los datos del miembro</p>
              </div>
              <button
                onClick={() => setEditProfile(null)}
                className="h-8 w-8 grid place-items-center rounded-lg hover:bg-muted/60"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleEditProfile} className="space-y-4">
              <FormField
                label="Nombre completo *"
                value={editProfile.full_name}
                onChange={(v) => setEditProfile((p) => (p ? { ...p, full_name: v } : p))}
              />
              <FormField
                label="Teléfono"
                value={editProfile.phone}
                onChange={(v) => setEditProfile((p) => (p ? { ...p, phone: v } : p))}
              />
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Rol
                </label>
                <div className="mt-1.5 flex gap-3">
                  {ROLES.map((r) => (
                    <label
                      key={r}
                      className="flex-1 flex items-center gap-2 p-3 rounded-lg border border-border cursor-pointer hover:border-primary/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5 transition"
                    >
                      <input
                        type="radio"
                        name="edit-rol"
                        value={r}
                        checked={editProfile.role === r}
                        onChange={() => setEditProfile((p) => (p ? { ...p, role: r } : p))}
                        className="accent-primary"
                      />
                      <span className="text-sm font-medium">{r}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Estado
                </label>
                <div className="mt-1.5 flex gap-3">
                  {["Activo", "Inactivo"].map((s) => (
                    <label
                      key={s}
                      className="flex-1 flex items-center gap-2 p-3 rounded-lg border border-border cursor-pointer hover:border-primary/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5 transition"
                    >
                      <input
                        type="radio"
                        name="edit-status"
                        value={s}
                        checked={editProfile.status === s}
                        onChange={() => setEditProfile((p) => (p ? { ...p, status: s } : p))}
                        className="accent-primary"
                      />
                      <span className="text-sm font-medium">{s}</span>
                    </label>
                  ))}
                </div>
              </div>
              {editError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {editError}
                </p>
              )}
              <div className="flex gap-3 mt-2">
                <button
                  type="button"
                  onClick={() => setEditProfile(null)}
                  className="flex-1 h-10 rounded-lg border border-border text-sm font-medium hover:bg-muted/60"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={editSaving}
                  className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {editSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {editSaving ? "Guardando..." : "Guardar cambios"}
                </button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </AppLayout>
  );
}

function AdministrativeImportToolsPanel() {
  const { data: importJobs = [], isLoading } = useImportJobsFilter();
  const latestJobs = importJobs.slice(0, 8);

  function statusTone(status: string): "default" | "success" | "warning" | "danger" | "info" {
    const value = status.toLowerCase();
    if (["completed", "success", "done"].includes(value)) return "success";
    if (["failed", "error"].includes(value)) return "danger";
    if (["processing", "running", "pending"].includes(value)) return "warning";
    return "default";
  }

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
                      <StatusBadge tone={statusTone(job.status)}>{job.status}</StatusBadge>
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

      <div>
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Wrench className="h-4 w-4 text-primary" /> Diagnóstico
        </div>
        <MassImportDryRun />
      </div>

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

function FormField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <input
        defaultValue={value}
        onChange={(e) => onChange?.(e.target.value)}
        className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-sm"
      />
    </div>
  );
}
