import { createFileRoute, Link } from "@tanstack/react-router";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { useCases, useCreateCase, useUpdateCase } from "@/hooks/use-cases";
import { useClients } from "@/hooks/use-clients";
import { useCaseDocumentCounts, useUploadDocument } from "@/hooks/use-documents";
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
  "Pendiente de clasificación": "default",
  "En preparación": "info",
  Presentado: "gold",
  "En trámite": "navy",
  "En audiencia": "warning",
  "En ejecución": "danger",
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
  const { data: allTasks = [] } = useCaseTasks();
  const createCase = useCreateCase();
  const updateCase = useUpdateCase();
  const uploadDoc = useUploadDocument();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [specialtyFilter, setSpecialtyFilter] = useState("");
  const [materiaFilter, setMateriaFilter] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [workflowFilter, setWorkflowFilter] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [sortBy, setSortBy] = useState("recent");
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
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
    materia: "" as "" | "Familia" | "Penal",
    process_type: "",
    status: "Pendiente de clasificación" as CaseStatus,
    juzgado: "",
    next_hearing: "",
    case_stage: "",
    next_action: "",
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
  const materias = ["Familia", "Penal"];
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
    const matchSpecialty = !specialtyFilter || c.legal_area === specialtyFilter;
    const matchMateria = !materiaFilter || c.materia === materiaFilter;
    const matchClient = !clientFilter || c.client_id === clientFilter;
    const matchWorkflow =
      !workflowFilter ||
      (workflowFilter === "with_next_action" && hasNextAction) ||
      (workflowFilter === "without_number" && !hasNumber) ||
      (workflowFilter === "pending_classification" && status === "Pendiente de clasificación") ||
      (workflowFilter === "archived" && status === "Archivado");
    const matchOverdue = !overdueOnly || overdueCaseIds.has(c.id);
    return (
      matchSearch &&
      matchStatus &&
      matchSpecialty &&
      matchMateria &&
      matchClient &&
      matchWorkflow &&
      matchOverdue
    );
  });
  const sorted = [...filtered].sort((a, b) => {
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
    !!specialtyFilter ||
    !!materiaFilter ||
    !!clientFilter ||
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
      setFormError(`Ya existe un expediente con el número ${form.expediente}.`);
      return;
    }
    setSaving(true);
    try {
      const newCase = await createCase.mutateAsync({
        client_id: values.client_id,
        expediente: expediente,
        materia: values.materia,
        case_number: expediente || undefined,
        case_name: values.process_type,
        case_type: values.process_type,
        process_type: values.process_type,
        status: values.status,
        court: values.juzgado || undefined,
        juzgado: values.juzgado || "Por determinar",
        demandante: "",
        demandado: "",
        next_hearing: peruDateTimeToISO(values.next_hearing || ""),
        case_stage: values.case_stage || undefined,
        next_action: values.next_action || undefined,
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
        materia: "",
        process_type: "",
        status: "Pendiente de clasificación",
        juzgado: "",
        next_hearing: "",
        case_stage: "",
        next_action: "",
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
    setSpecialtyFilter("");
    setMateriaFilter("");
    setClientFilter("");
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
            <button
              type="button"
              onClick={() => setShowFilters(!showFilters)}
              className="inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-card border border-border text-sm font-medium hover:bg-muted/60"
            >
              <Filter className="h-4 w-4" />
              Filtros
              {hasActiveFilters && <span className="h-2 w-2 rounded-full bg-primary" />}
              <ChevronDown className="h-4 w-4" />
            </button>
            {showFilters && (
              <div className="absolute right-0 mt-2 z-50 w-80 bg-card border border-border rounded-lg shadow-lg p-4 space-y-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                    Estado
                  </label>
                  <select
                    value={statusFilter}
                    onChange={(e) => {
                      setStatusFilter(e.target.value);
                      setPage(1);
                    }}
                    className="w-full h-9 px-3 rounded-lg bg-card border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">Todos los estados</option>
                    {CASE_STATUS_OPTIONS.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                    Materia
                  </label>
                  <select
                    value={materiaFilter}
                    onChange={(e) => {
                      setMateriaFilter(e.target.value);
                      setPage(1);
                    }}
                    className="w-full h-9 px-3 rounded-lg bg-card border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">Todas las materias</option>
                    {materias.map((materia) => (
                      <option key={materia} value={materia}>
                        {materia}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                    Especialidad
                  </label>
                  <select
                    value={specialtyFilter}
                    onChange={(e) => {
                      setSpecialtyFilter(e.target.value);
                      setPage(1);
                    }}
                    className="w-full h-9 px-3 rounded-lg bg-card border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">Todas las especialidades</option>
                    {specialties.map((specialty) => (
                      <option key={specialty} value={specialty}>
                        {specialty}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                    Cliente
                  </label>
                  <select
                    value={clientFilter}
                    onChange={(e) => {
                      setClientFilter(e.target.value);
                      setPage(1);
                    }}
                    className="w-full h-9 px-3 rounded-lg bg-card border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">Todos los clientes</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                    Flujo de trabajo
                  </label>
                  <select
                    value={workflowFilter}
                    onChange={(e) => {
                      setWorkflowFilter(e.target.value);
                      setPage(1);
                    }}
                    className="w-full h-9 px-3 rounded-lg bg-card border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">Todos los flujos</option>
                    <option value="with_next_action">Con próxima acción</option>
                    <option value="without_number">Sin número</option>
                    <option value="pending_classification">Pendientes de clasificación</option>
                    <option value="archived">Archivados</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={overdueOnly}
                    onChange={(e) => {
                      setOverdueOnly(e.target.checked);
                      setPage(1);
                    }}
                  />
                  Tareas vencidas
                </label>
              </div>
            )}
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="h-9 rounded-lg border border-border bg-card px-3 text-sm outline-none"
          >
            <option value="recent">Más recientes</option>
            <option value="hearing">Próxima audiencia</option>
            <option value="client">Por cliente</option>
          </select>
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
                  <th className="py-3 px-3 font-semibold">Proceso</th>
                  <th className="py-3 px-3 font-semibold">Juzgado</th>
                  <th className="py-3 px-3 font-semibold">Estado</th>
                  <th className="py-3 px-3 font-semibold">Próxima acción</th>
                  <th className="py-3 px-3 font-semibold">Documentos</th>
                  <th className="py-3 px-3 font-semibold">Actualizado</th>
                  <th className="py-3 pr-5 font-semibold text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-sm text-muted-foreground">
                      {search
                        ? "No se encontraron expedientes."
                        : "Aún no hay expedientes registrados."}
                    </td>
                  </tr>
                ) : (
                  paginated.map((c) => {
                    const status = normalizeCaseStatus(c.status);
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
                        <td className="py-3 px-3 text-muted-foreground">{c.materia ?? "—"}</td>
                        <td className="py-3 px-3 text-xs text-muted-foreground max-w-[180px] truncate">
                          {c.process_type}
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
                              Ver ficha
                            </Link>
                            <Link
                              to={"/casos/$id" as never}
                              params={{ id: c.id } as never}
                              search={{ edit: "true" } as never}
                              className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-semibold hover:bg-muted/60"
                              aria-label={`Editar expediente ${displayCaseNumber(c.expediente, c.case_number)}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Editar
                            </Link>
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
                  placeholder="Puede quedar vacío si aún no existe número judicial"
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

              {/* Materia — select con Familia y Penal */}
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Materia *
                </label>
                <select
                  value={form.materia}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, materia: e.target.value as typeof form.materia }))
                  }
                  required
                  className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none text-sm"
                >
                  <option value="" disabled>
                    Seleccionar materia
                  </option>
                  <option value="Familia">Familia</option>
                  <option value="Penal">Penal</option>
                </select>
              </div>

              {/* Proceso — free text */}
              <CaseField
                label="Proceso *"
                value={form.process_type}
                onChange={(v) => setForm((f) => ({ ...f, process_type: v }))}
                required
                placeholder="Ej: Defensa penal por robo agravado"
              />
              <CaseField
                label="Etapa procesal"
                value={form.case_stage}
                onChange={(v) => setForm((f) => ({ ...f, case_stage: v }))}
                placeholder="Ej: Ejecución de sentencia"
              />

              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Estado
                </label>
                <select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as CaseStatus }))}
                  className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none text-sm"
                >
                  {CASE_STATUS_OPTIONS.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
              <CaseField
                label="Juzgado (opcional)"
                value={form.juzgado}
                onChange={(v) => setForm((f) => ({ ...f, juzgado: v }))}
                placeholder="Ej: 1° Juzgado Penal de Lima"
              />
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
