import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { useClient, useClients, useUpdateClient, useDeleteClient } from "@/hooks/use-clients";
import { useCases } from "@/hooks/use-cases";
import { usePayments } from "@/hooks/use-payments";
import { useDocuments, useUploadDocument, useDeleteDocument } from "@/hooks/use-documents";
import { useAuth } from "@/hooks/use-auth";
import { useProfiles } from "@/hooks/use-profiles";
import { useClientReports } from "@/hooks/use-reports";
import { useAgendaEvents } from "@/hooks/use-agenda";
import { useCaseEvents, useCaseTasks } from "@/hooks/legal/use-case-management";
import { supabase } from "@/lib/supabase";
import {
  buildClientInitials,
  CLIENT_STATUS_OPTIONS,
  DOCUMENT_TYPE_OPTIONS,
  findClientDuplicates,
  normalizeDigits,
  validateClientForm,
} from "@/lib/client-validation";
import {
  ArrowLeft,
  Edit3,
  CreditCard,
  FileUp,
  Briefcase,
  Phone,
  Mail,
  IdCard,
  FileText,
  Download,
  X,
  Loader2,
  Trash2,
  Save,
  History,
  CheckSquare,
  AlertTriangle,
  CalendarClock,
  Plus,
} from "lucide-react";
import { useState, useRef } from "react";

export const Route = createFileRoute("/_app/clientes/$id")({
  component: ClientDetail,
});

const TABS = ["Resumen", "Expedientes", "Documentos", "Pagos", "Agenda", "Historial"] as const;
type Tab = (typeof TABS)[number];

const DOC_TYPES = ["DNI", "Demanda", "Resolución", "Sentencia", "Poder", "Contrato", "Otros"];

function currency(n: number) {
  return new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency: "PEN",
    maximumFractionDigits: 0,
  }).format(n);
}

function ClientDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();

  const { data: client, isLoading: loadingClient } = useClient(id);
  const { data: allClients = [] } = useClients();
  const { data: allCases = [] } = useCases();
  const { data: allPayments = [] } = usePayments();
  const { data: allDocs = [] } = useDocuments();
  const { data: allReports = [] } = useClientReports();
  const { data: allAgendaEvents = [] } = useAgendaEvents();
  const { data: profiles = [] } = useProfiles();
  const clientCaseIds = allCases.filter((item) => item.client_id === id).map((item) => item.id);
  const { data: clientTasks = [] } = useCaseTasks({ clientId: id });
  const { data: clientEvents = [] } = useCaseEvents(clientCaseIds);
  const { profile } = useAuth();
  const updateClient = useUpdateClient();
  const uploadDoc = useUploadDocument();
  const deleteDoc = useDeleteDocument();
  const deleteClient = useDeleteClient();

  const [tab, setTab] = useState<Tab>("Resumen");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [duplicatesAcknowledged, setDuplicatesAcknowledged] = useState(false);

  // Upload doc state
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadType, setUploadType] = useState("Otros");
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  if (loadingClient) {
    return (
      <AppLayout title="Cargando..." subtitle="">
        <div className="flex items-center justify-center py-32">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  if (!client) {
    return (
      <AppLayout title="Cliente no encontrado" subtitle="">
        <div className="text-center py-32">
          <p className="text-muted-foreground mb-4">El cliente no existe o fue eliminado.</p>
          <Link
            to={"/clientes" as never}
            className="text-primary hover:underline text-sm font-semibold"
          >
            Volver a clientes
          </Link>
        </div>
      </AppLayout>
    );
  }

  const loadedClient = client;
  const clientCases = allCases.filter((c) => c.client_id === id);
  const clientPayments = allPayments.filter((p) => p.client_id === id);
  const clientDocs = allDocs.filter((d) => d.client_id === id);
  const unclassifiedClientDocs = clientDocs.filter((d) => !d.case_id);
  const clientReports = allReports.filter((report) => report.client_id === id);
  const clientAgendaEvents = allAgendaEvents.filter(
    (event) => event.client_id === id || clientCaseIds.includes(event.case_id ?? ""),
  );
  const isAdmin = profile?.role === "Administrador";
  const profilesById = new Map(profiles.map((item) => [item.id, item.full_name] as const));
  const responsibleId =
    clientCases.find((item) => item.responsible_user_id)?.responsible_user_id ??
    loadedClient.created_by;
  const responsibleName = responsibleId
    ? (profilesById.get(responsibleId) ?? "Asignado")
    : "Sin asignar";
  const latestDocument = [...clientDocs].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  )[0];
  const nextAgendaEvent = [...clientAgendaEvents]
    .filter(
      (event) =>
        event.event_date >= new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" }),
    )
    .sort((a, b) =>
      `${a.event_date} ${a.event_time}`.localeCompare(`${b.event_date} ${b.event_time}`),
    )[0];
  const editDuplicateMatches = editing
    ? findClientDuplicates(
        {
          name: editForm.name ?? "",
          document_type: editForm.document_type ?? "DNI",
          document_number: editForm.document_number ?? "",
          phone: editForm.phone ?? "",
          whatsapp: editForm.whatsapp ?? "",
          email: editForm.email ?? "",
          occupation: editForm.occupation ?? "",
          process_type: editForm.process_type ?? "",
          status: editForm.status ?? "Activo",
          address: editForm.address ?? "",
          notes: editForm.notes ?? "",
        },
        allClients,
        id,
      )
    : [];
  const pendingTasks = clientTasks.filter(
    (task) => !["completed", "cancelled"].includes(task.status),
  );
  const nextTask = [...pendingTasks]
    .filter((task) => task.due_date)
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))[0];
  const lastEvent = [...clientEvents].sort((a, b) => b.event_date.localeCompare(a.event_date))[0];
  const pendingBalance = clientPayments.reduce(
    (sum, payment) => sum + Math.max(0, Number(payment.fees) - Number(payment.paid)),
    0,
  );
  const overdueTasks = pendingTasks.filter(
    (task) => !!task.due_date && new Date(task.due_date) < new Date(),
  );
  const historyItems = [
    ...clientCases.map((item) => ({
      id: `case-${item.id}`,
      date: item.created_at,
      title: `Expediente registrado: ${item.expediente}`,
      detail: item.process_type,
    })),
    ...clientDocs.map((item) => ({
      id: `doc-${item.id}`,
      date: item.created_at,
      title: `Documento incorporado: ${item.name}`,
      detail: item.type,
    })),
    ...clientReports.map((item) => ({
      id: `report-${item.id}`,
      date: item.created_at,
      title: `Reporte publicado: ${item.title}`,
      detail: item.category,
    })),
    ...clientEvents.map((item) => ({
      id: `event-${item.id}`,
      date: `${item.event_date}T00:00:00-05:00`,
      title: item.title,
      detail: item.event_type,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  function startEdit() {
    setEditForm({
      name: loadedClient.name,
      dni: loadedClient.dni,
      phone: loadedClient.phone,
      email: loadedClient.email ?? "",
      process_type: loadedClient.process_type,
      status: loadedClient.status,
      document_type: loadedClient.document_type || "DNI",
      document_number: loadedClient.document_number ?? loadedClient.dni,
      whatsapp: loadedClient.whatsapp ?? loadedClient.phone,
      occupation: loadedClient.occupation ?? "",
      address: loadedClient.address ?? "",
      notes: loadedClient.notes ?? "",
    });
    setEditing(true);
    setEditError(null);
    setDuplicatesAcknowledged(false);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    setEditError(null);

    let normalized;
    try {
      normalized = validateClientForm({
        name: editForm.name ?? "",
        document_type: editForm.document_type ?? "DNI",
        document_number: editForm.document_number ?? "",
        phone: editForm.phone ?? "",
        whatsapp: editForm.whatsapp ?? "",
        email: editForm.email ?? "",
        occupation: editForm.occupation ?? "",
        process_type: editForm.process_type ?? "",
        status: editForm.status ?? "Activo",
        address: editForm.address ?? "",
        notes: editForm.notes ?? "",
      });
      if (editDuplicateMatches.length > 0 && !duplicatesAcknowledged) {
        setEditError("Revisa los posibles duplicados y confirma si deseas continuar.");
        return;
      }
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Datos incompletos o invalidos.");
      return;
    }

    setSaving(true);
    try {
      await updateClient.mutateAsync({
        id,
        updates: {
          name: normalized.name,
          initials: buildClientInitials(normalized.name),
          dni: normalized.document_number,
          phone: normalized.phone,
          email: normalized.email || null,
          process_type: normalized.process_type,
          status: normalized.status,
          document_type: normalized.document_type,
          document_number: normalized.document_number,
          whatsapp: normalized.whatsapp || normalized.phone,
          occupation: normalized.occupation || null,
          address: normalized.address || null,
          notes: normalized.notes || null,
        },
      });
      setEditing(false);
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : "Error al guardar.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadFile) return;
    setUploading(true);
    try {
      await uploadDoc.mutateAsync({ file: uploadFile, type: uploadType, clientId: id });
      setShowUpload(false);
      setUploadFile(null);
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(doc: (typeof clientDocs)[0]) {
    const { data } = await supabase.storage.from("documents").createSignedUrl(doc.storage_path, 60);
    if (data?.signedUrl) {
      const a = document.createElement("a");
      a.href = data.signedUrl;
      a.download = doc.name;
      a.click();
    }
  }

  return (
    <AppLayout
      title={client.name}
      subtitle={`Cliente desde ${new Date(client.registered_at).toLocaleDateString("es-PE", { month: "long", year: "numeric" })}`}
      actions={
        <>
          <Link
            to={"/clientes" as never}
            className="inline-flex items-center gap-2 h-10 px-3 rounded-lg border border-border text-sm font-medium hover:bg-muted/60"
          >
            <ArrowLeft className="h-4 w-4" /> Volver
          </Link>
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex items-center gap-2 h-10 px-3 rounded-lg border border-border text-sm font-medium hover:bg-muted/60"
          >
            <Edit3 className="h-4 w-4" /> Editar cliente
          </button>
          <Link
            to={"/casos" as never}
            className="inline-flex items-center gap-2 h-10 px-3 rounded-lg border border-border text-sm font-medium hover:bg-muted/60"
          >
            <Plus className="h-4 w-4" /> Nuevo expediente
          </Link>
          <button
            type="button"
            onClick={() => setShowUpload(true)}
            className="inline-flex items-center gap-2 h-10 px-3 rounded-lg border border-border text-sm font-medium hover:bg-muted/60"
          >
            <FileUp className="h-4 w-4" /> Subir documento
          </button>
          {isAdmin && (
            <Link
              to={"/pagos" as never}
              className="inline-flex items-center gap-2 h-10 px-3 rounded-lg border border-border text-sm font-medium hover:bg-muted/60"
            >
              <CreditCard className="h-4 w-4" /> Registrar pago
            </Link>
          )}
          <Link
            to={"/agenda" as never}
            className="inline-flex items-center gap-2 h-10 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110"
          >
            <CalendarClock className="h-4 w-4" /> Agendar actividad
          </Link>
        </>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
        {/* Profile card */}
        <div className="space-y-4">
          <Card className="p-6 text-center">
            <div
              className="grid h-20 w-20 mx-auto place-items-center rounded-full text-2xl font-bold text-white shadow-card"
              style={{ background: client.color }}
            >
              {client.initials}
            </div>
            <h2 className="mt-4 text-lg font-bold">{client.name}</h2>
            <p className="text-xs text-muted-foreground">{client.process_type}</p>
            <div className="mt-3 flex justify-center">
              <StatusBadge
                tone={
                  client.status === "Activo"
                    ? "success"
                    : client.status === "En espera"
                      ? "warning"
                      : "default"
                }
              >
                {client.status}
              </StatusBadge>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                onClick={startEdit}
                className="inline-flex items-center justify-center gap-1.5 h-9 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:brightness-110"
              >
                <Edit3 className="h-3.5 w-3.5" /> Editar
              </button>
              <button
                onClick={() => {
                  setTab("Pagos");
                }}
                className="inline-flex items-center justify-center gap-1.5 h-9 rounded-lg bg-gold text-gold-foreground text-xs font-semibold hover:brightness-105"
              >
                <CreditCard className="h-3.5 w-3.5" /> Pagos
              </button>
              <button
                onClick={() => {
                  setShowUpload(true);
                }}
                className="inline-flex items-center justify-center gap-1.5 h-9 rounded-lg border border-border text-xs font-semibold hover:bg-muted/60"
              >
                <FileUp className="h-3.5 w-3.5" /> Documento
              </button>
              <button
                onClick={() => navigate({ to: "/casos" as never })}
                className="inline-flex items-center justify-center gap-1.5 h-9 rounded-lg border border-border text-xs font-semibold hover:bg-muted/60"
              >
                <Briefcase className="h-3.5 w-3.5" /> Expedientes
              </button>
              {isAdmin && (
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        `¿Eliminar al cliente "${loadedClient.name}"? Esta acción eliminará permanentemente la ficha del cliente.`,
                      )
                    ) {
                      deleteClient.mutate(id, {
                        onSuccess: () => navigate({ to: "/clientes" as never }),
                      });
                    }
                  }}
                  className="col-span-2 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg border border-red-200 bg-red-50/50 text-red-600 text-xs font-semibold hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Eliminar cliente
                </button>
              )}
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Contacto
            </h3>
            <ul className="space-y-3 text-sm">
              <InfoRow icon={Phone} label="Telefono principal" value={client.phone} />
              <InfoRow icon={Phone} label="Telefono alternativo" value={client.whatsapp ?? "—"} />
              <InfoRow icon={Mail} label="Correo" value={client.email ?? "—"} />
              <InfoRow
                icon={IdCard}
                label={client.document_type || "DNI/RUC"}
                value={client.document_number || client.dni}
              />
            </ul>
          </Card>
        </div>

        {/* Tabs */}
        <div>
          <div className="flex items-center gap-1 border-b border-border mb-6 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`relative px-4 py-3 text-sm font-semibold whitespace-nowrap transition ${tab === t ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                {t}
                {tab === t && (
                  <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gold" />
                )}
              </button>
            ))}
          </div>

          {tab === "Resumen" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="p-5">
                <h4 className="text-sm font-semibold mb-3">Datos generales</h4>
                <dl className="space-y-0">
                  <DataRow k="Nombre completo" v={client.name} />
                  <DataRow k="Responsable" v={responsibleName} />
                  <DataRow k="Tipo de documento" v={client.document_type || "DNI"} />
                  <DataRow k="N.º de documento" v={client.document_number || client.dni || "—"} />
                  <DataRow k="Teléfono" v={client.phone} />
                  <DataRow k="WhatsApp" v={client.whatsapp || client.phone || "—"} />
                  <DataRow k="Correo" v={client.email ?? "—"} />
                  <DataRow k="Dirección" v={client.address || "—"} />
                  <DataRow k="Ocupación" v={client.occupation || "—"} />
                  <DataRow k="Materia principal" v={client.process_type} />
                  <DataRow k="Estado" v={client.status} />
                  <DataRow
                    k="Registrado"
                    v={new Date(client.registered_at).toLocaleDateString("es-PE")}
                  />
                  <DataRow k="Observaciones" v={client.notes || "—"} />
                </dl>
              </Card>
              <Card className="p-5">
                <h4 className="text-sm font-semibold mb-4">Resumen jurídico</h4>
                <div className="grid grid-cols-2 gap-3 text-center">
                  <Stat n={clientCases.length} l="Expedientes" />
                  <Stat
                    n={clientCases.filter((item) => item.status !== "Archivado").length}
                    l="Activos"
                  />
                  <Stat n={unclassifiedClientDocs.length} l="Docs sin clasificar" />
                  <Stat n={currency(pendingBalance)} l="Saldo pendiente" />
                </div>
              </Card>
              <Card className="p-5">
                <h4 className="flex items-center gap-2 text-sm font-semibold">
                  <CalendarClock className="h-4 w-4 text-primary" /> Seguimiento inmediato
                </h4>
                <dl className="mt-4 space-y-3">
                  <DataRow
                    k="Próxima actividad"
                    v={
                      nextAgendaEvent
                        ? `${nextAgendaEvent.event_date} · ${nextAgendaEvent.title}`
                        : nextTask?.title ||
                          clientCases.find((item) => item.next_action)?.next_action ||
                          "Sin actividad definida"
                    }
                  />
                  <DataRow
                    k="Próxima acción procesal"
                    v={
                      nextTask?.title ||
                      clientCases.find((item) => item.next_action)?.next_action ||
                      "Sin acción definida"
                    }
                  />
                  <DataRow
                    k="Último documento"
                    v={
                      latestDocument
                        ? `${latestDocument.name} · ${new Date(latestDocument.created_at).toLocaleDateString("es-PE")}`
                        : "Sin documentos"
                    }
                  />
                  <DataRow
                    k="Última actuación"
                    v={
                      lastEvent
                        ? `${lastEvent.event_date} · ${lastEvent.title}`
                        : "Sin actuaciones registradas"
                    }
                  />
                </dl>
              </Card>
              <Card className="p-5">
                <h4 className="flex items-center gap-2 text-sm font-semibold">
                  <AlertTriangle className="h-4 w-4 text-amber-600" /> Alertas
                </h4>
                {overdueTasks.length === 0 ? (
                  <p className="mt-4 text-sm text-muted-foreground">
                    No hay tareas vencidas para este cliente.
                  </p>
                ) : (
                  <div className="mt-4 space-y-2">
                    {overdueTasks.map((task) => (
                      <div
                        key={task.id}
                        className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                      >
                        {task.title}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          )}

          {tab === "Expedientes" && (
            <Card className="overflow-hidden">
              {clientCases.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No hay expedientes registrados para este cliente.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                      <th className="py-3 px-4">Expediente</th>
                      <th className="py-3 px-4">Materia</th>
                      <th className="py-3 px-4">Estado</th>
                      <th className="py-3 px-4">Prioridad</th>
                      <th className="py-3 px-4">Próx. audiencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clientCases.map((c) => (
                      <tr key={c.id} className="border-t border-border hover:bg-muted/30">
                        <td className="py-3 px-4 font-mono text-xs text-muted-foreground">
                          <Link
                            to={"/casos/$id" as never}
                            params={{ id: c.id } as never}
                            className="font-semibold text-primary hover:underline"
                          >
                            {c.expediente}
                          </Link>
                        </td>
                        <td className="py-3 px-4">{c.process_type}</td>
                        <td className="py-3 px-4">
                          <StatusBadge tone="navy">{c.status}</StatusBadge>
                        </td>
                        <td className="py-3 px-4">
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
                        </td>
                        <td className="py-3 px-4 text-xs text-muted-foreground">
                          {c.next_hearing
                            ? new Date(c.next_hearing).toLocaleDateString("es-PE", {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                              })
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          )}

          {tab === "Pagos" && (
            <Card className="overflow-hidden">
              {clientPayments.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No hay pagos registrados para este cliente.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                      <th className="py-3 px-4">Servicio</th>
                      <th className="py-3 px-4">Honorarios</th>
                      <th className="py-3 px-4">Pagado</th>
                      <th className="py-3 px-4">Cuotas</th>
                      <th className="py-3 px-4">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clientPayments.map((p) => {
                      const pct = Math.round((Number(p.paid) / Number(p.fees)) * 100);
                      return (
                        <tr key={p.id} className="border-t border-border hover:bg-muted/30">
                          <td className="py-3 px-4">{p.service}</td>
                          <td className="py-3 px-4 font-semibold tabular-nums">
                            {currency(Number(p.fees))}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-primary"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className="text-xs tabular-nums">
                                {currency(Number(p.paid))}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-xs text-muted-foreground">
                            {p.paid_installments}/{p.total_installments}
                          </td>
                          <td className="py-3 px-4">
                            <StatusBadge
                              tone={
                                p.status === "Pagado"
                                  ? "success"
                                  : p.status === "Vencido"
                                    ? "danger"
                                    : "warning"
                              }
                            >
                              {p.status}
                            </StatusBadge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </Card>
          )}

          {tab === "Documentos" && (
            <div>
              <div className="flex justify-end mb-3">
                <button
                  onClick={() => setShowUpload(true)}
                  className="inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:brightness-110"
                >
                  <FileUp className="h-3.5 w-3.5" /> Subir documento
                </button>
              </div>
              {clientDocs.length === 0 ? (
                <Card className="py-12 text-center text-sm text-muted-foreground">
                  No hay documentos registrados para este cliente.
                </Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {clientDocs.map((d) => {
                    const caseItem = clientCases.find((item) => item.id === d.case_id);
                    return (
                      <Card key={d.id} className="p-4 flex items-center gap-3 group">
                        <div className="grid h-10 w-10 place-items-center rounded-lg bg-red-50 text-red-600 shrink-0">
                          <FileText className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold truncate">{d.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {d.type} · {d.size} ·{" "}
                            {new Date(d.uploaded_at).toLocaleDateString("es-PE")}
                          </div>
                          <div className="mt-1 text-[10px] text-muted-foreground">
                            {caseItem
                              ? `Expediente: ${caseItem.expediente}`
                              : "Sin expediente asignado"}
                          </div>
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                          <button
                            onClick={() => handleDownload(d)}
                            className="h-8 w-8 grid place-items-center rounded-md hover:bg-muted/60"
                          >
                            <Download className="h-4 w-4 text-muted-foreground" />
                          </button>
                          {isAdmin && (
                            <button
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `¿Eliminar "${d.name}"? Esta acción no se puede deshacer.`,
                                  )
                                ) {
                                  deleteDoc.mutate({ id: d.id, storagePath: d.storage_path });
                                }
                              }}
                              className="h-8 w-8 grid place-items-center rounded-md hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 className="h-4 w-4 text-muted-foreground" />
                            </button>
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === "Agenda" && (
            <Card className="overflow-hidden">
              {clientAgendaEvents.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No hay actividades de agenda vinculadas a este cliente.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                      <th className="py-3 px-4">Fecha</th>
                      <th className="py-3 px-4">Hora</th>
                      <th className="py-3 px-4">Actividad</th>
                      <th className="py-3 px-4">Tipo</th>
                      <th className="py-3 px-4">Lugar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...clientAgendaEvents]
                      .sort((a, b) =>
                        `${a.event_date} ${a.event_time}`.localeCompare(
                          `${b.event_date} ${b.event_time}`,
                        ),
                      )
                      .map((event) => (
                        <tr key={event.id} className="border-t border-border hover:bg-muted/30">
                          <td className="py-3 px-4 text-xs text-muted-foreground">
                            {new Date(`${event.event_date}T00:00:00-05:00`).toLocaleDateString(
                              "es-PE",
                            )}
                          </td>
                          <td className="py-3 px-4 font-mono text-xs text-muted-foreground">
                            {String(event.event_time).slice(0, 5)}
                          </td>
                          <td className="py-3 px-4 font-semibold">{event.title}</td>
                          <td className="py-3 px-4">
                            <StatusBadge tone="info">{event.type}</StatusBadge>
                          </td>
                          <td className="py-3 px-4 text-xs text-muted-foreground">
                            {event.location || "-"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </Card>
          )}

          {tab === "Historial" && (
            <Card className="p-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <History className="h-4 w-4 text-primary" /> Historial del cliente
              </h3>
              {historyItems.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Todavía no hay actividad registrada.
                </p>
              ) : (
                <div className="mt-4 space-y-2">
                  {historyItems.map((item) => (
                    <div key={item.id} className="flex gap-3 rounded-lg border border-border p-3">
                      <CheckSquare className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase text-muted-foreground">
                          {new Date(item.date).toLocaleDateString("es-PE")}
                        </div>
                        <div className="mt-0.5 text-sm font-semibold">{item.title}</div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          {item.detail}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <Card className="w-full max-w-lg p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold">Editar cliente</h3>
              <button
                onClick={() => setEditing(false)}
                className="h-8 w-8 grid place-items-center rounded-lg hover:bg-muted/60"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={saveEdit} className="space-y-4">
              <EF
                label="Nombre completo *"
                v={editForm.name}
                set={(v) => setEditForm((f) => ({ ...f, name: v }))}
                required
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <ES
                  label="Tipo de documento *"
                  v={editForm.document_type}
                  set={(v) =>
                    setEditForm((f) => ({
                      ...f,
                      document_type: v,
                      document_number: normalizeDigits(f.document_number).slice(
                        0,
                        v === "RUC" ? 11 : v === "DNI" ? 8 : 15,
                      ),
                    }))
                  }
                  options={[...DOCUMENT_TYPE_OPTIONS]}
                />
                <EF
                  label="DNI/RUC *"
                  v={editForm.document_number}
                  set={(v) =>
                    setEditForm((f) => ({
                      ...f,
                      document_number: normalizeDigits(v).slice(
                        0,
                        f.document_type === "RUC" ? 11 : f.document_type === "DNI" ? 8 : 15,
                      ),
                    }))
                  }
                  required
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <EF
                  label="Teléfono principal *"
                  v={editForm.phone}
                  set={(v) => setEditForm((f) => ({ ...f, phone: normalizeDigits(v).slice(0, 9) }))}
                  required
                />
                <EF
                  label="Teléfono alternativo"
                  v={editForm.whatsapp}
                  set={(v) =>
                    setEditForm((f) => ({ ...f, whatsapp: normalizeDigits(v).slice(0, 9) }))
                  }
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <EF
                  label="Correo"
                  v={editForm.email}
                  set={(v) => setEditForm((f) => ({ ...f, email: v }))}
                  type="email"
                />
                <EF
                  label="Ocupación"
                  v={editForm.occupation}
                  set={(v) => setEditForm((f) => ({ ...f, occupation: v }))}
                />
              </div>
              <EF
                label="Dirección"
                v={editForm.address}
                set={(v) => setEditForm((f) => ({ ...f, address: v }))}
              />
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Materia o proceso principal *
                </label>
                <input
                  type="text"
                  value={editForm.process_type}
                  onChange={(e) => setEditForm((f) => ({ ...f, process_type: e.target.value }))}
                  required
                  placeholder="Ej: Defensa penal por robo agravado"
                  className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Observaciones
                </label>
                <textarea
                  value={editForm.notes}
                  onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
                />
              </div>
              <ES
                label="Estado *"
                v={editForm.status}
                set={(v) => setEditForm((f) => ({ ...f, status: v }))}
                options={[...CLIENT_STATUS_OPTIONS]}
              />
              {editDuplicateMatches.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <p className="text-sm font-semibold text-amber-900">Posibles duplicados</p>
                  <div className="mt-2 space-y-1">
                    {editDuplicateMatches.slice(0, 4).map((match) => (
                      <div key={match.clientId} className="text-xs text-amber-800">
                        <span className="font-semibold">{match.clientName}</span> · {match.reason}
                        {match.strength === "approximate" && " (aproximado)"}
                      </div>
                    ))}
                  </div>
                  <label className="mt-3 flex items-start gap-2 text-xs text-amber-900">
                    <input
                      type="checkbox"
                      checked={duplicatesAcknowledged}
                      onChange={(event) => setDuplicatesAcknowledged(event.target.checked)}
                      className="mt-0.5"
                    />
                    Confirmo que revise estos clientes y deseo continuar sin sobrescribir datos
                    existentes.
                  </label>
                </div>
              )}
              {editError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {editError}
                </p>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="flex-1 h-10 rounded-lg border border-border text-sm font-medium hover:bg-muted/60"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Guardando...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" />
                      Guardar cambios
                    </>
                  )}
                </button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Upload doc modal */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md p-6 shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold">Subir documento</h3>
              <button
                onClick={() => setShowUpload(false)}
                className="h-8 w-8 grid place-items-center rounded-lg hover:bg-muted/60"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleUpload} className="space-y-4">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Archivo *
                </label>
                <div
                  onClick={() => fileRef.current?.click()}
                  className={`mt-1.5 flex flex-col items-center justify-center gap-2 h-20 rounded-lg border-2 border-dashed cursor-pointer transition ${uploadFile ? "border-primary/40 bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/30"}`}
                >
                  {uploadFile ? (
                    <>
                      <FileText className="h-5 w-5 text-primary" />
                      <span className="text-xs font-medium text-primary truncate max-w-[260px]">
                        {uploadFile.name}
                      </span>
                    </>
                  ) : (
                    <>
                      <FileUp className="h-5 w-5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">
                        Haz clic para seleccionar
                      </span>
                    </>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                  onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Tipo
                </label>
                <select
                  value={uploadType}
                  onChange={(e) => setUploadType(e.target.value)}
                  className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none text-sm"
                >
                  {DOC_TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowUpload(false)}
                  className="flex-1 h-10 rounded-lg border border-border text-sm font-medium hover:bg-muted/60"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!uploadFile || uploading}
                  className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Subiendo...
                    </>
                  ) : (
                    <>
                      <FileUp className="h-4 w-4" />
                      Subir
                    </>
                  )}
                </button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </AppLayout>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Phone;
  label: string;
  value: string;
}) {
  return (
    <li className="flex items-start gap-3">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted/60">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <div className="text-sm font-medium break-all">{value}</div>
      </div>
    </li>
  );
}
function DataRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-0">
      <dt className="text-xs text-muted-foreground shrink-0">{k}</dt>
      <dd className="text-sm font-medium text-right">{v}</dd>
    </div>
  );
}
function Stat({ n, l }: { n: number | string; l: string }) {
  return (
    <div className="rounded-lg bg-muted/40 py-3">
      <div className="text-2xl font-bold text-primary">{n}</div>
      <div className="text-[11px] text-muted-foreground">{l}</div>
    </div>
  );
}
function EF({
  label,
  v,
  set,
  required,
  type = "text",
}: {
  label: string;
  v: string;
  set: (s: string) => void;
  required?: boolean;
  type?: string;
}) {
  return (
    <div>
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <input
        type={type}
        value={v}
        onChange={(e) => set(e.target.value)}
        required={required}
        className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-sm"
      />
    </div>
  );
}
function ES({
  label,
  v,
  set,
  options,
}: {
  label: string;
  v: string;
  set: (s: string) => void;
  options: string[];
}) {
  return (
    <div>
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <select
        value={v}
        onChange={(e) => set(e.target.value)}
        className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none text-sm"
      >
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </div>
  );
}
