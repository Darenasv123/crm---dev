import { createFileRoute, Link } from "@tanstack/react-router";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { useCases, useCreateCase, useUpdateCase } from "@/hooks/use-cases";
import { useClients } from "@/hooks/use-clients";
import { useCaseDocumentCounts, useUploadDocument } from "@/hooks/use-documents";
import { useProfiles } from "@/hooks/use-profiles";
import { useAuth } from "@/hooks/use-auth";
import { useCaseTasks } from "@/hooks/legal/use-case-management";
import {
  CASE_STATUS_OPTIONS,
  displayCaseNumber,
  normalizeCaseStatus,
  validateCaseForm,
  type CaseStatus,
} from "@/lib/case-validation";
import { formatPeruDate, peruDateTimeToISO } from "@/lib/peru-time";
import {
  Plus,
  Filter,
  CalendarClock,
  Search,
  ChevronDown,
  X,
  Loader2,
  FileUp,
  FileText,
  Eye,
  Pencil,
  CreditCard,
  CalendarPlus,
  AlertTriangle,
} from "lucide-react";
import { useState, useRef, useMemo } from "react";

export const Route = createFileRoute("/_app/casos/")({
  head: () => ({ meta: [{ title: "Expedientes — CRM Jurídico" }] }),
  component: CasesPage,
});

const statusTone: Record<
  CaseStatus,
  "default" | "info" | "warning" | "navy" | "gold" | "danger" | "success"
> = {
  "Pendiente de clasificacion": "default",
  "En preparacion": "info",
  Presentado: "gold",
  "En tramite": "navy",
  "En audiencia": "warning",
  "En ejecucion": "danger",
  Concluido: "success",
  Archivado: "default",
};

function isNonEmptyString(value: string | null | undefined): value is string {
  return !!value?.trim();
}

function CasesPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "Administrador";
  const { data: cases = [], isLoading, isError, error } = useCases();
  const { data: clients = [] } = useClients();
  const { data: profiles = [] } = useProfiles();
  const { data: allTasks = [] } = useCaseTasks();
  const createCase = useCreateCase();
  const updateCase = useUpdateCase();
  const uploadDoc = useUploadDocument();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [specialtyFilter, setSpecialtyFilter] = useState("");
  const [matterFilter, setMatterFilter] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [responsibleFilter, setResponsibleFilter] = useState("");
  const [workflowFilter, setWorkflowFilter] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [sortBy, setSortBy] = useState("recent");
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [tableError, setTableError] = useState<string | null>(null);
  const [changingStatusId, setChangingStatusId] = useState<string | null>(null);
  const [expedienteFile, setExpedienteFile] = useState<File | null>(null);
  const expedienteRef = useRef<HTMLInputElement>(null);
  // Client search state for the modal
  const [clientSearch, setClientSearch] = useState("");
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false);
  const clientSearchRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    client_id: "",
    expediente: "",
    process_type: "",
    priority: "Media" as "Alta" | "Media" | "Baja",
    status: "Pendiente de clasificacion" as CaseStatus,
    juzgado: "",
    next_hearing: "",
    internal_code: "",
    legal_area: "",
    case_stage: "",
    responsible_user_id: "",
    next_action: "",
    filing_date: "",
  });

  // Filtered clients for the search dropdown
  const filteredClients = useMemo(
    () =>
      clientSearch.trim()
        ? clients.filter((c) => c.name.toLowerCase().includes(clientSearch.toLowerCase()))
        : clients,
    [clients, clientSearch],
  );

  const selectedClientName = clients.find((c) => c.id === form.client_id)?.name ?? "";

  const overdueCaseIds = new Set(
    allTasks
      .filter(
        (task) =>
          !!task.due_date &&
          new Date(task.due_date) < new Date() &&
          !["completed", "cancelled"].includes(task.status),
      )
      .map((task) => task.case_id),
  );
  const specialties = Array.from(
    new Set(cases.map((item) => item.legal_area).filter(isNonEmptyString)),
  ).sort();
  const matters = Array.from(
    new Set(cases.map((item) => item.process_type || item.case_type).filter(isNonEmptyString)),
  ).sort();
  const filtered = cases.filter((c) => {
    const status = normalizeCaseStatus(c.status);
    const hasNumber = !!(c.expediente.trim() || c.case_number?.trim());
    const hasNextAction = !!(c.next_action?.trim() || c.next_hearing);
    const matchSearch =
      !search ||
      (c.clients?.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      c.expediente.toLowerCase().includes(search.toLowerCase()) ||
      (c.internal_code ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (c.next_action ?? "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = !statusFilter || status === statusFilter;
    const matchPriority = !priorityFilter || c.priority === priorityFilter;
    const matchSpecialty = !specialtyFilter || c.legal_area === specialtyFilter;
    const matchMatter = !matterFilter || (c.process_type || c.case_type) === matterFilter;
    const matchClient = !clientFilter || c.client_id === clientFilter;
    const matchResponsible =
      !responsibleFilter ||
      (responsibleFilter === "__unassigned" && !c.responsible_user_id) ||
      c.responsible_user_id === responsibleFilter;
    const matchWorkflow =
      !workflowFilter ||
      (workflowFilter === "with_next_action" && hasNextAction) ||
      (workflowFilter === "without_number" && !hasNumber) ||
      (workflowFilter === "pending_classification" && status === "Pendiente de clasificacion") ||
      (workflowFilter === "archived" && status === "Archivado");
    const matchOverdue = !overdueOnly || overdueCaseIds.has(c.id);
    return (
      matchSearch &&
      matchStatus &&
      matchPriority &&
      matchSpecialty &&
      matchMatter &&
      matchClient &&
      matchResponsible &&
      matchWorkflow &&
      matchOverdue
    );
  });
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "priority")
      return (
        ({ Alta: 0, Media: 1, Baja: 2 }[a.priority] ?? 3) -
        ({ Alta: 0, Media: 1, Baja: 2 }[b.priority] ?? 3)
      );
    if (sortBy === "hearing")
      return (a.next_hearing ?? "9999").localeCompare(b.next_hearing ?? "9999");
    if (sortBy === "client")
      return (a.clients?.name ?? "").localeCompare(b.clients?.name ?? "", "es");
    return (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at);
  });
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginated = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const { data: documentCounts = {} } = useCaseDocumentCounts(paginated.map((item) => item.id));
  const hasActiveFilters =
    !!search ||
    !!statusFilter ||
    !!priorityFilter ||
    !!specialtyFilter ||
    !!matterFilter ||
    !!clientFilter ||
    !!responsibleFilter ||
    !!workflowFilter ||
    overdueOnly;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    let values: ReturnType<typeof validateCaseForm>;
    try {
      values = validateCaseForm(form);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Revisa los datos del expediente.");
      return;
    }
    const expediente = values.expediente;
    const duplicate =
      expediente &&
      cases.find((item) => item.expediente.trim().toLowerCase() === expediente.toLowerCase());
    if (duplicate) {
      setFormError(`Ya existe un expediente con el numero ${form.expediente}.`);
      return;
    }
    setSaving(true);
    try {
      const newCase = await createCase.mutateAsync({
        ...values,
        expediente,
        internal_code: values.internal_code || expediente || null,
        case_number: expediente || null,
        case_name: values.process_type,
        case_type: values.process_type,
        court: values.juzgado || null,
        juzgado: values.juzgado || "Por determinar",
        responsible_user_id: values.responsible_user_id || null,
        demandante: "",
        demandado: "",
        next_hearing: peruDateTimeToISO(values.next_hearing || ""),
      });

      // Upload expediente file if provided
      if (expedienteFile && newCase?.id) {
        await uploadDoc.mutateAsync({
          file: expedienteFile,
          type: "Expediente",
          caseId: newCase.id,
          clientId: values.client_id,
        });
      }

      setShowModal(false);
      setExpedienteFile(null);
      setClientSearch("");
      setClientDropdownOpen(false);
      setForm({
        client_id: "",
        expediente: "",
        process_type: "",
        priority: "Media",
        status: "Pendiente de clasificacion",
        juzgado: "",
        next_hearing: "",
        internal_code: "",
        legal_area: "",
        case_stage: "",
        responsible_user_id: "",
        next_action: "",
        filing_date: "",
      });
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Error al guardar.");
    } finally {
      setSaving(false);
    }
  }

  function clearFilters() {
    setSearch("");
    setStatusFilter("");
    setPriorityFilter("");
    setSpecialtyFilter("");
    setMatterFilter("");
    setClientFilter("");
    setResponsibleFilter("");
    setWorkflowFilter("");
    setOverdueOnly(false);
    setPage(1);
  }

  async function handleStatusChange(id: string, status: CaseStatus) {
    setTableError(null);
    setChangingStatusId(id);
    try {
      await updateCase.mutateAsync({ id, updates: { status } });
    } catch (err: unknown) {
      setTableError(
        err instanceof Error
          ? `No se pudo cambiar el estado: ${err.message}`
          : "No se pudo cambiar el estado del expediente.",
      );
    } finally {
      setChangingStatusId(null);
    }
  }

  return (
    <AppLayout
      title="Expedientes"
      subtitle={`${cases.length} expedientes`}
      actions={
        <>
          <button
            type="button"
            onClick={clearFilters}
            disabled={!hasActiveFilters}
            className="inline-flex items-center gap-2 h-10 px-3 rounded-lg bg-card border border-border text-sm font-medium hover:bg-muted/60 disabled:opacity-50"
          >
            <Filter className="h-4 w-4" /> Limpiar filtros
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 shadow-soft"
          >
            <Plus className="h-4 w-4" /> Nuevo expediente
          </button>
        </>
      }
    >
      {/* Filters bar */}
      <Card className="p-3 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Buscar expediente, cliente..."
              className="w-full h-9 pl-9 pr-3 rounded-lg bg-muted/40 border border-border focus:bg-card focus:border-primary focus:outline-none text-sm"
            />
          </div>
          <div className="relative">
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="h-9 pl-3 pr-8 rounded-lg bg-card border border-border text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
            >
              <option value="">Todos los estados</option>
              {CASE_STATUS_OPTIONS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
          <div className="relative">
            <select
              value={priorityFilter}
              onChange={(e) => {
                setPriorityFilter(e.target.value);
                setPage(1);
              }}
              className="h-9 pl-3 pr-8 rounded-lg bg-card border border-border text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
            >
              <option value="">Todas las prioridades</option>
              <option>Alta</option>
              <option>Media</option>
              <option>Baja</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
          <select
            value={specialtyFilter}
            onChange={(e) => {
              setSpecialtyFilter(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-lg border border-border bg-card px-3 text-sm outline-none"
          >
            <option value="">Todas las especialidades</option>
            {specialties.map((specialty) => (
              <option key={specialty} value={specialty}>
                {specialty}
              </option>
            ))}
          </select>
          <select
            value={matterFilter}
            onChange={(e) => {
              setMatterFilter(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-lg border border-border bg-card px-3 text-sm outline-none"
          >
            <option value="">Todas las materias</option>
            {matters.map((matter) => (
              <option key={matter} value={matter}>
                {matter}
              </option>
            ))}
          </select>
          <select
            value={clientFilter}
            onChange={(e) => {
              setClientFilter(e.target.value);
              setPage(1);
            }}
            className="h-9 max-w-[220px] rounded-lg border border-border bg-card px-3 text-sm outline-none"
          >
            <option value="">Todos los clientes</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
          <select
            value={responsibleFilter}
            onChange={(e) => {
              setResponsibleFilter(e.target.value);
              setPage(1);
            }}
            className="h-9 max-w-[220px] rounded-lg border border-border bg-card px-3 text-sm outline-none"
          >
            <option value="">Todos los responsables</option>
            <option value="__unassigned">Sin asignar</option>
            {profiles
              .filter((item) => item.status === "Activo")
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.full_name}
                </option>
              ))}
          </select>
          <select
            value={workflowFilter}
            onChange={(e) => {
              setWorkflowFilter(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-lg border border-border bg-card px-3 text-sm outline-none"
          >
            <option value="">Todos los flujos</option>
            <option value="with_next_action">Con proxima accion</option>
            <option value="without_number">Sin numero</option>
            <option value="pending_classification">Pendientes de clasificacion</option>
            <option value="archived">Archivados</option>
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="h-9 rounded-lg border border-border bg-card px-3 text-sm outline-none"
          >
            <option value="recent">Más recientes</option>
            <option value="priority">Por prioridad</option>
            <option value="hearing">Próxima audiencia</option>
            <option value="client">Por cliente</option>
          </select>
          <label className="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm">
            <input
              type="checkbox"
              checked={overdueOnly}
              onChange={(e) => {
                setOverdueOnly(e.target.checked);
                setPage(1);
              }}
            />{" "}
            Tareas vencidas
          </label>
        </div>
      </Card>

      {tableError && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4" />
          {tableError}
        </div>
      )}

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : isError ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-red-600">
              <AlertTriangle className="h-4 w-4" />
              {error instanceof Error ? error.message : "No se pudieron cargar los expedientes."}
            </div>
          ) : (
            <table className="min-w-[1380px] w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-3 pl-5 pr-3 font-semibold">Numero/ref.</th>
                  <th className="py-3 px-3 font-semibold">Cliente</th>
                  <th className="py-3 px-3 font-semibold">Materia</th>
                  <th className="py-3 px-3 font-semibold">Responsable</th>
                  <th className="py-3 px-3 font-semibold">Contraparte</th>
                  <th className="py-3 px-3 font-semibold">Juzgado</th>
                  <th className="py-3 px-3 font-semibold">Estado</th>
                  <th className="py-3 px-3 font-semibold">Proxima accion</th>
                  <th className="py-3 px-3 font-semibold">Documentos</th>
                  <th className="py-3 px-3 font-semibold">Actualizado</th>
                  <th className="py-3 pr-5 font-semibold text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-12 text-center text-sm text-muted-foreground">
                      {search
                        ? "No se encontraron expedientes."
                        : "Aún no hay expedientes registrados."}
                    </td>
                  </tr>
                ) : (
                  paginated.map((c) => {
                    const status = normalizeCaseStatus(c.status);
                    const opposingParty = c.demandado || c.demandante || "—";
                    return (
                      <tr
                        key={c.id}
                        className="border-t border-border hover:bg-muted/30 transition"
                      >
                        <td className="py-3 pl-5 pr-3 font-mono text-xs text-muted-foreground">
                          {displayCaseNumber(c.expediente, c.case_number)}
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2">
                            <div
                              className="grid h-7 w-7 place-items-center rounded-full text-[10px] font-bold text-white shrink-0"
                              style={{ background: c.clients?.color ?? "oklch(0.55 0.13 235)" }}
                            >
                              {c.clients?.initials ?? "??"}
                            </div>
                            <span className="font-semibold truncate">{c.clients?.name ?? "—"}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-muted-foreground">{c.process_type}</td>
                        <td className="py-3 px-3 text-xs text-muted-foreground">
                          {profiles.find((profile) => profile.id === c.responsible_user_id)
                            ?.full_name ?? "—"}
                        </td>
                        <td className="py-3 px-3 text-xs text-muted-foreground max-w-[150px] truncate">
                          {opposingParty}
                        </td>
                        <td className="py-3 px-3 text-xs text-muted-foreground max-w-[160px] truncate">
                          {c.juzgado}
                        </td>
                        <td className="py-3 px-3">
                          <StatusBadge tone={statusTone[status]}>{status}</StatusBadge>
                        </td>
                        <td className="py-3 px-3">
                          {c.next_action ? (
                            <span className="line-clamp-2 text-xs text-muted-foreground">
                              {c.next_action}
                            </span>
                          ) : c.next_hearing ? (
                            <div className="flex items-center gap-1 text-xs">
                              <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                              <span>
                                {formatPeruDate(c.next_hearing, {
                                  day: "2-digit",
                                  month: "short",
                                  year: "numeric",
                                })}
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-3 px-3">
                          <span className="inline-flex h-7 min-w-8 items-center justify-center rounded-md border border-border px-2 text-xs font-semibold">
                            {documentCounts[c.id] ?? 0}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-xs text-muted-foreground">
                          {formatPeruDate(c.updated_at || c.created_at, {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </td>
                        <td className="py-3 pr-5">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <Link
                              to={"/casos/$id" as never}
                              params={{ id: c.id } as never}
                              className="inline-flex h-8 items-center gap-1 rounded-md bg-primary/10 px-2.5 text-xs font-semibold text-primary transition hover:bg-primary hover:text-primary-foreground"
                              aria-label={`Ver expediente ${displayCaseNumber(c.expediente, c.case_number)}`}
                            >
                              <Eye className="h-3.5 w-3.5" />
                              Ver
                            </Link>
                            <Link
                              to={"/casos/$id" as never}
                              params={{ id: c.id } as never}
                              className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-semibold hover:bg-muted/60"
                              aria-label={`Editar expediente ${displayCaseNumber(c.expediente, c.case_number)}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Editar
                            </Link>
                            <Link
                              to={"/documentos" as never}
                              className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-semibold hover:bg-muted/60"
                              aria-label={`Subir documento al expediente ${displayCaseNumber(c.expediente, c.case_number)}`}
                            >
                              <FileUp className="h-3.5 w-3.5" />
                              Documento
                            </Link>
                            <Link
                              to={"/agenda" as never}
                              className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-semibold hover:bg-muted/60"
                              aria-label={`Agendar actividad del expediente ${displayCaseNumber(c.expediente, c.case_number)}`}
                            >
                              <CalendarPlus className="h-3.5 w-3.5" />
                              Agenda
                            </Link>
                            {isAdmin && (
                              <Link
                                to={"/pagos" as never}
                                className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-semibold hover:bg-muted/60"
                                aria-label={`Registrar pago del expediente ${displayCaseNumber(c.expediente, c.case_number)}`}
                              >
                                <CreditCard className="h-3.5 w-3.5" />
                                Pago
                              </Link>
                            )}
                            <select
                              value={status}
                              onChange={(event) =>
                                handleStatusChange(c.id, event.target.value as CaseStatus)
                              }
                              disabled={changingStatusId === c.id}
                              aria-label={`Cambiar estado del expediente ${displayCaseNumber(c.expediente, c.case_number)}`}
                              className="h-8 rounded-md border border-border bg-card px-2 text-xs font-semibold outline-none disabled:opacity-50"
                            >
                              {CASE_STATUS_OPTIONS.map((option) => (
                                <option key={option}>{option}</option>
                              ))}
                            </select>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
        {!isLoading && !isError && (
          <div className="px-5 py-3 border-t border-border text-xs text-muted-foreground">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                Mostrando {paginated.length} de {filtered.length} resultados · {cases.length}{" "}
                expedientes
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  className="h-8 rounded-lg border border-border px-3 disabled:opacity-40"
                >
                  Anterior
                </button>
                <span>
                  Página {currentPage} de {totalPages}
                </span>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                  className="h-8 rounded-lg border border-border px-3 disabled:opacity-40"
                >
                  Siguiente
                </button>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* New Case Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <Card className="w-full max-w-lg p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold">Nuevo expediente</h3>
              <button
                onClick={() => {
                  setShowModal(false);
                  setExpedienteFile(null);
                  setClientSearch("");
                  setClientDropdownOpen(false);
                }}
                className="h-8 w-8 grid place-items-center rounded-lg hover:bg-muted/60"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              {/* Cliente con buscador */}
              <div className="relative">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Cliente *
                </label>
                <div className="mt-1.5 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <input
                    ref={clientSearchRef}
                    type="text"
                    value={form.client_id ? selectedClientName : clientSearch}
                    onChange={(e) => {
                      setClientSearch(e.target.value);
                      setForm((f) => ({ ...f, client_id: "" }));
                      setClientDropdownOpen(true);
                    }}
                    onFocus={() => {
                      if (!form.client_id) setClientDropdownOpen(true);
                    }}
                    placeholder="Buscar cliente por nombre..."
                    required={!form.client_id}
                    className="w-full h-10 pl-9 pr-3 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-sm"
                    autoComplete="off"
                  />
                  {form.client_id && (
                    <button
                      type="button"
                      onClick={() => {
                        setForm((f) => ({ ...f, client_id: "" }));
                        setClientSearch("");
                        setClientDropdownOpen(false);
                        setTimeout(() => clientSearchRef.current?.focus(), 0);
                      }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 h-5 w-5 grid place-items-center rounded hover:bg-muted/60 text-muted-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
                {/* Dropdown */}
                {clientDropdownOpen && !form.client_id && (
                  <div className="absolute z-50 mt-1 w-full bg-card border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {filteredClients.length === 0 ? (
                      <div className="px-3 py-3 text-sm text-muted-foreground text-center">
                        Sin resultados
                      </div>
                    ) : (
                      filteredClients.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onMouseDown={() => {
                            setForm((f) => ({ ...f, client_id: c.id }));
                            setClientSearch("");
                            setClientDropdownOpen(false);
                          }}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted/50 text-left text-sm transition"
                        >
                          <div
                            className="grid h-7 w-7 place-items-center rounded-full text-[10px] font-bold text-white shrink-0"
                            style={{ background: c.color ?? "oklch(0.55 0.13 235)" }}
                          >
                            {c.initials}
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold truncate">{c.name}</div>
                            <div className="text-[10px] text-muted-foreground truncate">
                              {c.process_type}
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
                {/* Hidden input for form validation */}
                <input
                  type="text"
                  value={form.client_id}
                  required
                  readOnly
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden
                />
              </div>

              {/* Expediente number + file attachment */}
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  N° Expediente
                </label>
                <input
                  type="text"
                  value={form.expediente}
                  onChange={(e) => setForm((f) => ({ ...f, expediente: e.target.value }))}
                  placeholder="Puede quedar vacio si aun no existe numero judicial"
                  className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-sm font-mono"
                />
                {/* Expediente file */}
                <div
                  onClick={() => expedienteRef.current?.click()}
                  className={`mt-2 flex items-center gap-2 h-9 px-3 rounded-lg border border-dashed cursor-pointer transition text-xs
                    ${expedienteFile ? "border-primary/50 bg-primary/5 text-primary" : "border-border hover:border-primary/40 hover:bg-muted/30 text-muted-foreground"}`}
                >
                  {expedienteFile ? (
                    <>
                      <FileText className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate font-medium">{expedienteFile.name}</span>
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setExpedienteFile(null);
                        }}
                        className="ml-auto h-5 w-5 grid place-items-center rounded hover:bg-primary/20"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </>
                  ) : (
                    <>
                      <FileUp className="h-3.5 w-3.5 shrink-0" />
                      <span>Adjuntar archivo del expediente (opcional)</span>
                    </>
                  )}
                </div>
                <input
                  ref={expedienteRef}
                  type="file"
                  className="hidden"
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar"
                  onChange={(e) => setExpedienteFile(e.target.files?.[0] ?? null)}
                />
              </div>

              {/* Proceso — free text */}
              <CaseField
                label="Proceso *"
                value={form.process_type}
                onChange={(v) => setForm((f) => ({ ...f, process_type: v }))}
                required
                placeholder="Ej: Defensa penal por robo agravado"
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <CaseField
                  label="Código interno"
                  value={form.internal_code}
                  onChange={(v) => setForm((f) => ({ ...f, internal_code: v }))}
                  placeholder="Ej: FAM-2026-014"
                />
                <CaseField
                  label="Área legal"
                  value={form.legal_area}
                  onChange={(v) => setForm((f) => ({ ...f, legal_area: v }))}
                  placeholder="Ej: Derecho de Familia"
                />
              </div>
              <CaseField
                label="Etapa procesal"
                value={form.case_stage}
                onChange={(v) => setForm((f) => ({ ...f, case_stage: v }))}
                placeholder="Ej: Ejecución de sentencia"
              />

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Prioridad
                  </label>
                  <select
                    value={form.priority}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, priority: e.target.value as typeof form.priority }))
                    }
                    className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none text-sm"
                  >
                    <option>Alta</option>
                    <option>Media</option>
                    <option>Baja</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Estado
                  </label>
                  <select
                    value={form.status}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, status: e.target.value as CaseStatus }))
                    }
                    className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none text-sm"
                  >
                    {CASE_STATUS_OPTIONS.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
              <CaseField
                label="Juzgado (opcional)"
                value={form.juzgado}
                onChange={(v) => setForm((f) => ({ ...f, juzgado: v }))}
                placeholder="Ej: 1° Juzgado Penal de Lima"
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <CaseField
                  label="Fecha de presentación"
                  value={form.filing_date}
                  onChange={(v) => setForm((f) => ({ ...f, filing_date: v }))}
                  type="date"
                />
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Responsable
                  </label>
                  <select
                    value={form.responsible_user_id}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, responsible_user_id: e.target.value }))
                    }
                    className="mt-1.5 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none"
                  >
                    <option value="">Sin asignar</option>
                    {profiles
                      .filter((item) => item.status === "Activo")
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.full_name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
              <CaseField
                label="Próxima acción"
                value={form.next_action}
                onChange={(v) => setForm((f) => ({ ...f, next_action: v }))}
                placeholder="Ej: Presentar escrito de liquidación"
              />
              <div>
                <CaseField
                  label="Próxima audiencia (opcional)"
                  value={form.next_hearing}
                  onChange={(v) => setForm((f) => ({ ...f, next_hearing: v }))}
                  type="datetime-local"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Puedes dejarla en blanco y asignarla más adelante.
                </p>
              </div>
              {formError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {formError}
                </p>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setExpedienteFile(null);
                    setClientSearch("");
                    setClientDropdownOpen(false);
                  }}
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
                  {saving ? "Guardando..." : "Guardar expediente"}
                </button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </AppLayout>
  );
}

function CaseField({
  label,
  value,
  onChange,
  required,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-sm"
      />
    </div>
  );
}
