import { createFileRoute, Link } from "@tanstack/react-router";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { useClients, useCreateClient, useUpdateClient } from "@/hooks/use-clients";
import { useCases } from "@/hooks/use-cases";
import { usePayments } from "@/hooks/use-payments";
import { useAgendaEvents } from "@/hooks/use-agenda";
import { useProfiles } from "@/hooks/use-profiles";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/lib/permissions";
import { exportClientsExcel } from "@/lib/export-excel";
import { CSVImport } from "@/components/csv-import";
import { ZipImport } from "@/components/zip-import";
import { FolderImport } from "@/components/folder-import";
import {
  Search,
  Download,
  Plus,
  Eye,
  X,
  Loader2,
  FolderArchive,
  FolderOpen,
  FileSpreadsheet,
  Pencil,
  AlertTriangle,
  ChevronDown,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildClientInitials,
  CLIENT_STATUS_OPTIONS,
  DOCUMENT_TYPE_OPTIONS,
  findClientDuplicates,
  normalizeDigits,
  validateClientForm,
  type ClientDuplicateMatch,
  type ClientFormValues,
  type ClientRow,
} from "@/lib/client-validation";
import { normalizeCaseStatus } from "@/lib/case-validation";

export const Route = createFileRoute("/_app/clientes/")({
  head: () => ({
    meta: [{ title: "Clientes - Estudio Juridico" }],
  }),
  component: ClientsPage,
});

const EMPTY_FORM: ClientFormValues = {
  name: "",
  document_type: "DNI",
  document_number: "",
  phone: "",
  whatsapp: "",
  email: "",
  occupation: "",
  process_type: "",
  status: "Activo",
  address: "",
  notes: "",
};

const PAGE_SIZE = 10;
const CLIENT_FILTER_STORAGE_KEY = "advocate-nest.clients.filters";

type ClientListFilters = {
  searchInput: string;
  statusFilter: string;
  caseFilter: string;
  specialtyFilter: string;
  responsibleFilter: string;
  page: number;
};

const DEFAULT_CLIENT_FILTERS: ClientListFilters = {
  searchInput: "",
  statusFilter: "Todos",
  caseFilter: "Todos",
  specialtyFilter: "Todos",
  responsibleFilter: "Todos",
  page: 1,
};

function readClientListFilters(): ClientListFilters {
  if (typeof window === "undefined") return DEFAULT_CLIENT_FILTERS;
  try {
    const raw = window.localStorage.getItem(CLIENT_FILTER_STORAGE_KEY);
    if (!raw) return DEFAULT_CLIENT_FILTERS;
    const parsed = JSON.parse(raw) as Partial<ClientListFilters>;
    const caseFilter =
      parsed.caseFilter === "Con expedientes" ? "Con expedientes activos" : parsed.caseFilter;
    return {
      ...DEFAULT_CLIENT_FILTERS,
      ...parsed,
      caseFilter: caseFilter ?? DEFAULT_CLIENT_FILTERS.caseFilter,
      page: Math.max(1, Number(parsed.page) || 1),
    };
  } catch {
    return DEFAULT_CLIENT_FILTERS;
  }
}

function normalizeClientStatus(status: string) {
  return status.trim().toLowerCase();
}

function isArchivedClientStatus(status: string) {
  return ["archivado", "cerrado"].includes(normalizeClientStatus(status));
}

function isInactiveClientStatus(status: string) {
  const normalized = normalizeClientStatus(status);
  return normalized !== "activo" && !isArchivedClientStatus(status);
}

function isActiveCaseStatus(status: string) {
  return !["Archivado", "Concluido"].includes(normalizeCaseStatus(status));
}

function ClientsPage() {
  const { data: clients = [], isLoading, isError, error, refetch } = useClients();
  const { data: cases = [] } = useCases();
  const { profile } = useAuth();
  const { canViewPayments, canExportPayments } = usePermissions(profile);
  const isAdmin = canExportPayments; // retrocompatibilidad: solo admins pueden exportar
  // Payments solo se cargan para poder filtrar "Con pagos pendientes" cuando el rol tiene acceso
  const { data: payments = [] } = usePayments({ enabled: canViewPayments });
  const { data: agendaEvents = [] } = useAgendaEvents();
  const { data: profiles = [] } = useProfiles();
  const createClient = useCreateClient();
  const updateClient = useUpdateClient();

  const [initialFilters] = useState<ClientListFilters>(() => readClientListFilters());
  const [searchInput, setSearchInput] = useState(initialFilters.searchInput);
  const [search, setSearch] = useState(initialFilters.searchInput.trim());
  const [statusFilter, setStatusFilter] = useState(initialFilters.statusFilter);
  const [caseFilter, setCaseFilter] = useState(initialFilters.caseFilter);
  const [specialtyFilter, setSpecialtyFilter] = useState(initialFilters.specialtyFilter);
  const [responsibleFilter, setResponsibleFilter] = useState(initialFilters.responsibleFilter);
  const [page, setPage] = useState(initialFilters.page);
  const [showModal, setShowModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showZipImportModal, setShowZipImportModal] = useState(false);
  const [showFolderImportModal, setShowFolderImportModal] = useState(false);
  const [editingClient, setEditingClient] = useState<ClientRow | null>(null);
  const [form, setForm] = useState<ClientFormValues>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicatesAcknowledged, setDuplicatesAcknowledged] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    window.localStorage.setItem(
      CLIENT_FILTER_STORAGE_KEY,
      JSON.stringify({
        searchInput,
        statusFilter,
        caseFilter,
        specialtyFilter,
        responsibleFilter,
        page,
      }),
    );
  }, [caseFilter, page, responsibleFilter, searchInput, specialtyFilter, statusFilter]);

  const profilesById = useMemo(
    () => new Map(profiles.map((item) => [item.id, item.full_name] as const)),
    [profiles],
  );

  const casesByClient = useMemo(() => {
    const map = new Map<string, typeof cases>();
    for (const item of cases) {
      const current = map.get(item.client_id) ?? [];
      current.push(item);
      map.set(item.client_id, current);
    }
    return map;
  }, [cases]);

  const paymentsByClient = useMemo(() => {
    const map = new Map<string, typeof payments>();
    for (const payment of payments) {
      const current = map.get(payment.client_id) ?? [];
      current.push(payment);
      map.set(payment.client_id, current);
    }
    return map;
  }, [payments]);

  const specialtyOptions = useMemo(() => {
    const types = new Set<string>();
    for (const item of cases) {
      const base = (item.legal_area || item.process_type || item.case_type || "")
        .split(/\s*[—-]\s*/)[0]
        .trim();
      if (base && base !== "Pendiente de clasificación") types.add(base);
    }
    return ["Todos", ...Array.from(types).sort()];
  }, [cases]);

  const responsibleOptions = useMemo(
    () => [
      "Todos",
      "Sin asignar",
      ...profiles
        .filter((item) => item.status === "Activo")
        .map((item) => item.full_name)
        .sort(),
    ],
    [profiles],
  );

  const duplicateMatches = useMemo(
    () => findClientDuplicates(form, clients, editingClient?.id),
    [clients, editingClient?.id, form],
  );

  const getNextActivity = useCallback(
    (clientId: string, clientCases = casesByClient.get(clientId) ?? []) => {
      const caseIds = new Set(clientCases.map((item) => item.id));
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" });
      return agendaEvents
        .filter((event) => event.client_id === clientId || caseIds.has(event.case_id ?? ""))
        .filter((event) => event.event_date >= today)
        .sort((a, b) =>
          `${a.event_date} ${a.event_time}`.localeCompare(`${b.event_date} ${b.event_time}`),
        )[0];
    },
    [agendaEvents, casesByClient],
  );

  const getResponsibleLabel = useCallback(
    (client: ClientRow, clientCases = casesByClient.get(client.id) ?? []) => {
      const responsibleId =
        clientCases.find((item) => item.responsible_user_id)?.responsible_user_id ??
        client.created_by;
      return responsibleId ? (profilesById.get(responsibleId) ?? "Asignado") : "Sin asignar";
    },
    [casesByClient, profilesById],
  );

  const filtered = useMemo(() => {
    return clients.filter((client) => {
      const documentNumber = normalizeDigits(client.document_number || client.dni);
      const clientCases = casesByClient.get(client.id) ?? [];
      const activeClientCases = clientCases.filter((item) => isActiveCaseStatus(item.status));
      const clientPayments = paymentsByClient.get(client.id) ?? [];
      const nextActivity = getNextActivity(client.id, clientCases);
      const responsible = getResponsibleLabel(client, clientCases);
      const pendingBalance = clientPayments.reduce(
        (sum, payment) => sum + Math.max(0, Number(payment.fees) - Number(payment.paid)),
        0,
      );

      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        client.name.toLowerCase().includes(q) ||
        documentNumber.includes(q) ||
        (client.phone ?? "").includes(q) ||
        (client.whatsapp ?? "").includes(q) ||
        (client.email ?? "").toLowerCase().includes(q);
      const matchStatus =
        statusFilter === "Todos" ||
        (statusFilter === "Activos" && normalizeClientStatus(client.status) === "activo") ||
        (statusFilter === "Inactivos" && isInactiveClientStatus(client.status)) ||
        (statusFilter === "Archivados" && isArchivedClientStatus(client.status)) ||
        client.status === statusFilter;
      const matchSpecialty =
        specialtyFilter === "Todos" ||
        clientCases.some((item) =>
          (item.legal_area || item.process_type || item.case_type || "")
            .toLowerCase()
            .includes(specialtyFilter.toLowerCase()),
        );
      const matchResponsible =
        responsibleFilter === "Todos" ||
        (responsibleFilter === "Sin asignar" && responsible === "Sin asignar") ||
        responsible === responsibleFilter;
      const matchCaseFilter =
        caseFilter === "Todos" ||
        (caseFilter === "Con expedientes activos" && activeClientCases.length > 0) ||
        (caseFilter === "Sin expediente" && clientCases.length === 0) ||
        (caseFilter === "Con pagos pendientes" && pendingBalance > 0) ||
        (caseFilter === "Con próxima actividad" && !!nextActivity);

      return matchSearch && matchStatus && matchSpecialty && matchResponsible && matchCaseFilter;
    });
  }, [
    caseFilter,
    casesByClient,
    clients,
    getNextActivity,
    getResponsibleLabel,
    paymentsByClient,
    responsibleFilter,
    search,
    specialtyFilter,
    statusFilter,
  ]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const hasActiveFilters =
    searchInput.trim() !== "" ||
    statusFilter !== DEFAULT_CLIENT_FILTERS.statusFilter ||
    caseFilter !== DEFAULT_CLIENT_FILTERS.caseFilter ||
    specialtyFilter !== DEFAULT_CLIENT_FILTERS.specialtyFilter ||
    responsibleFilter !== DEFAULT_CLIENT_FILTERS.responsibleFilter;

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingClient(null);
    setFormError(null);
    setDuplicatesAcknowledged(false);
  }

  function openCreate() {
    resetForm();
    setShowModal(true);
  }

  function openEdit(client: ClientRow) {
    setEditingClient(client);
    setForm({
      name: client.name,
      document_type: client.document_type || "DNI",
      document_number: (client.document_number || client.dni) ?? "",
      phone: client.phone ?? "",
      whatsapp: client.whatsapp ?? "",
      email: client.email ?? "",
      occupation: client.occupation ?? "",
      process_type: client.process_type ?? "",
      status: client.status,
      address: client.address ?? "",
      notes: client.notes ?? "",
    });
    setFormError(null);
    setDuplicatesAcknowledged(false);
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    resetForm();
  }

  function clearFilters() {
    setSearchInput(DEFAULT_CLIENT_FILTERS.searchInput);
    setSearch(DEFAULT_CLIENT_FILTERS.searchInput);
    setStatusFilter(DEFAULT_CLIENT_FILTERS.statusFilter);
    setCaseFilter(DEFAULT_CLIENT_FILTERS.caseFilter);
    setSpecialtyFilter(DEFAULT_CLIENT_FILTERS.specialtyFilter);
    setResponsibleFilter(DEFAULT_CLIENT_FILTERS.responsibleFilter);
    setPage(DEFAULT_CLIENT_FILTERS.page);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    let normalized: ClientFormValues;
    try {
      normalized = validateClientForm(form);
      if (duplicateMatches.length > 0 && !duplicatesAcknowledged) {
        setFormError("Revisa los posibles duplicados y confirma si deseas continuar.");
        return;
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Datos incompletos o inválidos.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: normalized.name,
        initials: buildClientInitials(normalized.name),
        dni: normalized.document_number,
        document_type: normalized.document_type,
        document_number: normalized.document_number,
        phone: normalized.phone,
        whatsapp: normalized.whatsapp || normalized.phone,
        email: normalized.email || null,
        occupation: normalized.occupation || null,
        address: normalized.address || null,
        notes: normalized.notes || null,
        process_type: normalized.process_type,
        status: normalized.status,
      };

      if (editingClient) {
        await updateClient.mutateAsync({ id: editingClient.id, updates: payload });
      } else {
        await createClient.mutateAsync(payload);
      }
      closeModal();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Error al guardar. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppLayout
      title="Clientes"
      subtitle={`${clients.length} clientes registrados · Penal & Familia`}
      actions={
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => exportClientsExcel(clients)}
              className="inline-flex items-center gap-2 h-10 px-3 rounded-lg bg-card border border-border text-sm font-medium hover:bg-muted/60 transition"
            >
              <Download className="h-4 w-4" /> Excel
            </button>
          )}
          <button
            onClick={() => setShowFolderImportModal(true)}
            className="inline-flex items-center gap-2 h-10 px-3 rounded-lg bg-card border border-border text-sm font-medium hover:bg-muted/60 transition"
          >
            <FolderOpen className="h-4 w-4" /> Importar carpeta
          </button>
          <button
            onClick={() => setShowZipImportModal(true)}
            className="inline-flex items-center gap-2 h-10 px-3 rounded-lg bg-card border border-border text-sm font-medium hover:bg-muted/60 transition"
          >
            <FolderArchive className="h-4 w-4" /> Importar cliente desde ZIP
          </button>
          <button
            onClick={() => setShowImportModal(true)}
            className="inline-flex items-center gap-2 h-10 px-3 rounded-lg bg-card border border-border text-sm font-medium hover:bg-muted/60 transition"
          >
            <FileSpreadsheet className="h-4 w-4" /> Importar lista CSV/XLSX
          </button>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 transition shadow-soft"
          >
            <Plus className="h-4 w-4" /> Nuevo cliente
          </button>
        </div>
      }
    >
      <Card className="p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar cliente, DNI/RUC, teléfono o correo..."
              className="w-full h-10 pl-10 pr-3 rounded-lg bg-muted/40 border border-border focus:bg-card focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 text-sm"
            />
          </div>
          <FilterSelect
            value={caseFilter}
            onChange={(value) => {
              setCaseFilter(value);
              setPage(1);
            }}
            options={[
              "Todos",
              "Con expedientes activos",
              "Sin expediente",
              ...(canViewPayments ? ["Con pagos pendientes"] : []),
              "Con próxima actividad",
            ]}
          />
          <FilterSelect
            value={specialtyFilter}
            onChange={(value) => {
              setSpecialtyFilter(value);
              setPage(1);
            }}
            options={specialtyOptions}
          />
          <FilterSelect
            value={responsibleFilter}
            onChange={(value) => {
              setResponsibleFilter(value);
              setPage(1);
            }}
            options={responsibleOptions}
          />
          <FilterSelect
            value={statusFilter}
            onChange={(value) => {
              setStatusFilter(value);
              setPage(1);
            }}
            options={[
              "Todos",
              "Activos",
              "Inactivos",
              "Archivados",
              ...CLIENT_STATUS_OPTIONS.filter((status) => status !== "Activo"),
            ]}
          />
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="h-10 rounded-lg border border-border px-3 text-sm font-semibold hover:bg-muted/60"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : isError ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-red-600">
              <AlertTriangle className="h-4 w-4" />
              {error instanceof Error ? error.message : "No se pudieron cargar los clientes."}
            </div>
          ) : (
            <table className="min-w-[1120px] w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-3 pl-5 pr-3 font-semibold">Cliente</th>
                  <th className="py-3 px-3 font-semibold">DNI/RUC</th>
                  <th className="py-3 px-3 font-semibold">Contacto</th>
                  <th className="py-3 px-3 font-semibold">Expedientes</th>
                  <th className="py-3 px-3 font-semibold">Estado</th>
                  <th className="py-3 px-3 font-semibold">Responsable</th>
                  <th className="py-3 px-3 font-semibold">Proxima actividad</th>
                  <th className="py-3 pr-5 font-semibold text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center">
                      <div className="mx-auto max-w-md">
                        <p className="text-sm font-semibold text-foreground">
                          {hasActiveFilters
                            ? "No se encontraron clientes con esos filtros."
                            : "Aun no hay clientes registrados."}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {hasActiveFilters
                            ? "Puedes limpiar los filtros persistidos o registrar un cliente nuevo."
                            : "Registra el primer cliente o importa su expediente documental."}
                        </p>
                        <div className="mt-4 flex justify-center gap-2">
                          {hasActiveFilters && (
                            <button
                              type="button"
                              onClick={clearFilters}
                              className="h-9 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-muted/60"
                            >
                              Limpiar filtros
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={openCreate}
                            className="h-9 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:brightness-110"
                          >
                            Nuevo cliente
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginated.map((client) => {
                    const clientCases = casesByClient.get(client.id) ?? [];
                    const activeCases = clientCases.filter((item) =>
                      isActiveCaseStatus(item.status),
                    );
                    const nextActivity = getNextActivity(client.id, clientCases);
                    const responsible = getResponsibleLabel(client, clientCases);
                    return (
                      <tr
                        key={client.id}
                        className="border-t border-border hover:bg-muted/30 transition"
                      >
                        <td className="py-3 pl-5 pr-3">
                          <div className="flex items-center gap-3">
                            <div
                              className="grid h-9 w-9 place-items-center rounded-full text-xs font-bold text-white shrink-0"
                              style={{ background: client.color }}
                            >
                              {client.initials}
                            </div>
                            <div className="min-w-0">
                              <div className="font-semibold truncate">{client.name}</div>
                              <div className="text-xs text-muted-foreground truncate">
                                {client.email ?? "Sin correo"}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-mono text-xs">
                            {client.document_number || client.dni}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {client.document_type || "DNI"}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-mono text-xs">{client.phone ?? "—"}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {client.whatsapp ? `Alt. ${client.whatsapp}` : "Sin alternativo"}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-semibold">{clientCases.length}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {activeCases.length} activos
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <StatusBadge tone={statusTone(client.status)}>
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${client.status === "Activo" ? "bg-emerald-500" : client.status === "En espera" ? "bg-amber-500" : "bg-muted-foreground"}`}
                            />
                            {client.status}
                          </StatusBadge>
                        </td>
                        <td className="py-3 px-3 text-xs text-muted-foreground">{responsible}</td>
                        <td className="py-3 px-3 text-xs text-muted-foreground">
                          {nextActivity ? (
                            <>
                              <div className="font-semibold text-foreground">
                                {nextActivity.title}
                              </div>
                              <div>
                                {new Date(
                                  `${nextActivity.event_date}T00:00:00-05:00`,
                                ).toLocaleDateString("es-PE", {
                                  day: "2-digit",
                                  month: "short",
                                })}{" "}
                                · {String(nextActivity.event_time).slice(0, 5)}
                              </div>
                            </>
                          ) : (
                            "Sin actividad"
                          )}
                        </td>
                        <td className="py-3 pr-5">
                          <div className="flex items-center justify-end gap-2">
                            <Link
                              to={"/clientes/$id" as never}
                              params={{ id: client.id } as never}
                              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary/10 text-primary text-xs font-semibold hover:bg-primary hover:text-primary-foreground transition"
                              aria-label={`Ver ficha de ${client.name}`}
                            >
                              <Eye className="h-3.5 w-3.5" /> Ver ficha
                            </Link>
                            <button
                              type="button"
                              onClick={() => openEdit(client)}
                              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-xs font-semibold hover:bg-muted/60 transition"
                              aria-label={`Editar cliente ${client.name}`}
                              title="Editar datos del cliente"
                            >
                              <Pencil className="h-3.5 w-3.5" /> Editar
                            </button>
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
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-border text-xs text-muted-foreground">
            <span>
              Mostrando {paginated.length} de {filtered.length} resultados · {clients.length}{" "}
              clientes
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
                Pagina {currentPage} de {totalPages}
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
        )}
      </Card>

      {showModal && (
        <ClientFormModal
          form={form}
          setForm={setForm}
          isEditing={!!editingClient}
          onSubmit={handleSubmit}
          onClose={closeModal}
          saving={saving}
          error={formError}
          duplicateMatches={duplicateMatches}
          duplicatesAcknowledged={duplicatesAcknowledged}
          setDuplicatesAcknowledged={setDuplicatesAcknowledged}
        />
      )}

      {showImportModal && (
        <CSVImport
          onClose={() => setShowImportModal(false)}
          onSuccess={() => {
            refetch();
          }}
        />
      )}

      {showZipImportModal && (
        <ZipImport
          onClose={() => setShowZipImportModal(false)}
          onSuccess={() => {
            refetch();
          }}
        />
      )}

      {showFolderImportModal && (
        <FolderImport
          onClose={() => setShowFolderImportModal(false)}
          onSuccess={() => {
            setShowFolderImportModal(false);
            refetch();
          }}
        />
      )}
    </AppLayout>
  );
}

function statusTone(status: string): "default" | "success" | "warning" {
  if (status === "Activo") return "success";
  if (status === "En espera") return "warning";
  return "default";
}

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 pl-3 pr-9 rounded-lg bg-card border border-border text-sm font-medium appearance-none focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer"
      >
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
    </div>
  );
}

function ClientFormModal({
  form,
  setForm,
  isEditing,
  onSubmit,
  onClose,
  saving,
  error,
  duplicateMatches,
  duplicatesAcknowledged,
  setDuplicatesAcknowledged,
}: {
  form: ClientFormValues;
  setForm: React.Dispatch<React.SetStateAction<ClientFormValues>>;
  isEditing: boolean;
  onSubmit: (event: React.FormEvent) => void;
  onClose: () => void;
  saving: boolean;
  error: string | null;
  duplicateMatches: ClientDuplicateMatch[];
  duplicatesAcknowledged: boolean;
  setDuplicatesAcknowledged: (value: boolean) => void;
}) {
  const documentType = form.document_type.toUpperCase();
  const documentMaxLength = documentType === "RUC" ? 11 : documentType === "DNI" ? 8 : 15;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <Card className="w-full max-w-2xl p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-base font-semibold">
              {isEditing ? "Editar cliente" : "Nuevo cliente"}
            </h3>
            <p className="text-xs text-muted-foreground">
              Datos reales sincronizados con Clientes y Expedientes
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 grid place-items-center rounded-lg hover:bg-muted/60"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <InputField
            label="Nombre completo o razón social *"
            value={form.name}
            onChange={(value) => setForm((current) => ({ ...current, name: value }))}
            required
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SelectField
              label="Tipo de documento *"
              value={form.document_type}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  document_type: value,
                  document_number: normalizeDigits(current.document_number).slice(
                    0,
                    value === "RUC" ? 11 : value === "DNI" ? 8 : 15,
                  ),
                }))
              }
              options={[...DOCUMENT_TYPE_OPTIONS]}
            />
            <div className="sm:col-span-2">
              <InputField
                label="DNI/RUC *"
                value={form.document_number}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    document_number: normalizeDigits(value).slice(0, documentMaxLength),
                  }))
                }
                inputMode="numeric"
                required
              />
              {form.document_number.length > 0 &&
                ((documentType === "DNI" && form.document_number.length < 8) ||
                  (documentType === "RUC" && form.document_number.length < 11)) && (
                  <p className="mt-1 text-[11px] text-amber-600">
                    Faltan {(documentType === "RUC" ? 11 : 8) - form.document_number.length}{" "}
                    dígitos.
                  </p>
                )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <InputField
              label="Teléfono principal *"
              value={form.phone}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  phone: normalizeDigits(value).slice(0, 9),
                }))
              }
              inputMode="numeric"
              required
            />
            <InputField
              label="Teléfono alternativo"
              value={form.whatsapp}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  whatsapp: normalizeDigits(value).slice(0, 9),
                }))
              }
              inputMode="numeric"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <InputField
              label="Correo"
              value={form.email}
              onChange={(value) => setForm((current) => ({ ...current, email: value }))}
              type="email"
            />
            <InputField
              label="Ocupación"
              value={form.occupation}
              onChange={(value) => setForm((current) => ({ ...current, occupation: value }))}
            />
          </div>

          <InputField
            label="Dirección"
            value={form.address}
            onChange={(value) => setForm((current) => ({ ...current, address: value }))}
          />

          <InputField
            label="Materia o proceso principal *"
            value={form.process_type}
            onChange={(value) => setForm((current) => ({ ...current, process_type: value }))}
            required
            placeholder="Ej: Defensa penal por robo agravado"
          />

          <TextAreaField
            label="Observaciones"
            value={form.notes}
            onChange={(value) => setForm((current) => ({ ...current, notes: value }))}
          />

          <SelectField
            label="Estado *"
            value={form.status}
            onChange={(value) => setForm((current) => ({ ...current, status: value }))}
            options={[...CLIENT_STATUS_OPTIONS]}
          />

          {duplicateMatches.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <p className="text-sm font-semibold text-amber-900">Posibles duplicados</p>
              <div className="mt-2 space-y-1">
                {duplicateMatches.slice(0, 4).map((match) => (
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

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
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
              {saving ? "Guardando..." : isEditing ? "Guardar cambios" : "Guardar cliente"}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function InputField({
  label,
  value,
  onChange,
  required,
  type = "text",
  inputMode,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-sm"
      />
    </div>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="mt-1.5 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary"
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div>
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none text-sm"
      >
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </div>
  );
}
