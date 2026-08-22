import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Edit3,
  Eye,
  FileSpreadsheet,
  Filter,
  Mail,
  MoreHorizontal,
  Phone,
  Plus,
  Search,
  UserPlus,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { CSVImport } from "@/components/csv-import";
import { ImportMethodSelector } from "@/components/zip-import/import-method-selector";
import { ZipImporter } from "@/components/zip-import/zip-importer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState, LoadingState } from "@/components/ui/data-state";
import { FormActions, FormErrorSummary, FormField, FormSection } from "@/components/ui/form-layout";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuth } from "@/hooks/use-auth";
import { useCases } from "@/hooks/use-cases";
import { useClients, useCreateClient, useUpdateClient } from "@/hooks/use-clients";
import { useDailyTasks } from "@/hooks/use-daily-tasks";
import {
  buildClientInitials,
  CLIENT_STATUS_OPTIONS,
  findClientDuplicates,
  validateClientForm,
  type ClientFormValues,
} from "@/lib/client-validation";
import { usePermissions } from "@/lib/permissions";

export const Route = createFileRoute("/_app/clientes/")({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" ? search.q : "",
    estado: typeof search.estado === "string" ? search.estado : "",
    desde: typeof search.desde === "string" ? search.desde : "",
    hasta: typeof search.hasta === "string" ? search.hasta : "",
    expedientes: typeof search.expedientes === "string" ? search.expedientes : "",
    tareas: typeof search.tareas === "string" ? search.tareas : "",
    ordenar: typeof search.ordenar === "string" ? search.ordenar : "nombre",
    // Dispara la apertura del alta desde accesos externos (Dashboard QA-003).
    // Se consume una sola vez: no debe reabrirse solo por refrescar la página.
    nuevo: search.nuevo === "1" ? ("1" as const) : undefined,
  }),
  component: ClientsPage,
});

const EMPTY_FORM: ClientFormValues = {
  name: "",
  phone: "",
  email: "",
  status: "Activo",
};

function ClientsPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const routeSearch = Route.useSearch();
  const { data: clients = [], isLoading } = useClients();
  const { data: cases = [] } = useCases();
  const { data: activeTasks = [] } = useDailyTasks({ view: "all", showCompleted: false });
  const createClient = useCreateClient();
  const updateClient = useUpdateClient();
  const [search, setSearch] = useState(routeSearch.q);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({
    status: routeSearch.estado,
    from: routeSearch.desde,
    to: routeSearch.hasta,
    cases: routeSearch.expedientes,
    tasks: routeSearch.tareas,
    sort: routeSearch.ordenar,
  });
  const [draftFilters, setDraftFilters] = useState(filters);
  const [showForm, setShowForm] = useState(false);
  const [showMethodSelector, setShowMethodSelector] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showZipImport, setShowZipImport] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [form, setForm] = useState<ClientFormValues>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [duplicatesAcknowledged, setDuplicatesAcknowledged] = useState(false);

  const permissions = usePermissions(profile);
  const canCreate = permissions.canCreateClients;
  const canEdit = permissions.canEditClients;
  const canImportZip = profile?.role === "Administrador" && profile.status === "Activo";
  const editingClient = editingClientId ? clients.find((c) => c.id === editingClientId) : null;

  useEffect(() => {
    if (routeSearch.nuevo !== "1") return;
    if (canCreate) setShowForm(true);
    navigate({
      search: ((prev: Record<string, unknown>) => ({ ...prev, nuevo: undefined })) as never,
      replace: true,
    });
    // Solo debe dispararse con el valor recibido al cargar la ruta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSearch.nuevo]);

  const caseCounts = useMemo(
    () =>
      cases.reduce<Record<string, number>>((counts, item) => {
        counts[item.client_id] = (counts[item.client_id] ?? 0) + 1;
        return counts;
      }, {}),
    [cases],
  );
  const activeTaskCounts = useMemo(
    () =>
      activeTasks.reduce<Record<string, number>>((counts, task) => {
        if (task.client_id) counts[task.client_id] = (counts[task.client_id] ?? 0) + 1;
        return counts;
      }, {}),
    [activeTasks],
  );
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = clients.filter(
      (client) =>
        (!term ||
          client.name.toLowerCase().includes(term) ||
          (client.phone ?? "").includes(term) ||
          (client.email ?? "").toLowerCase().includes(term)) &&
        (!filters.status || client.status === filters.status) &&
        (!filters.from || client.registered_at >= filters.from) &&
        (!filters.to || client.registered_at <= filters.to) &&
        (!filters.cases ||
          (filters.cases === "with"
            ? (caseCounts[client.id] ?? 0) > 0
            : (caseCounts[client.id] ?? 0) === 0)) &&
        (!filters.tasks ||
          (filters.tasks === "with"
            ? (activeTaskCounts[client.id] ?? 0) > 0
            : (activeTaskCounts[client.id] ?? 0) === 0)),
    );
    return rows.sort((a, b) => {
      if (filters.sort === "recent") return b.registered_at.localeCompare(a.registered_at);
      if (filters.sort === "oldest") return a.registered_at.localeCompare(b.registered_at);
      return a.name.localeCompare(b.name, "es");
    });
  }, [activeTaskCounts, caseCounts, clients, filters, search]);
  const activeFilterCount = [
    filters.status,
    filters.from,
    filters.to,
    filters.cases,
    filters.tasks,
    filters.sort !== "nombre",
  ].filter(Boolean).length;

  function persistSearch(nextFilters = filters, nextSearch = search) {
    void navigate({
      to: "/clientes" as never,
      search: {
        q: nextSearch || undefined,
        estado: nextFilters.status || undefined,
        desde: nextFilters.from || undefined,
        hasta: nextFilters.to || undefined,
        expedientes: nextFilters.cases || undefined,
        tareas: nextFilters.tasks || undefined,
        ordenar: nextFilters.sort === "nombre" ? undefined : nextFilters.sort,
      } as never,
      replace: true,
    });
  }
  const duplicateMatches = showForm ? findClientDuplicates(form, clients) : [];
  const editDuplicates =
    showEditDialog && editingClient
      ? findClientDuplicates(form, clients, editingClientId ?? undefined)
      : [];

  function closeForm() {
    setShowForm(false);
    setForm(EMPTY_FORM);
    setError(null);
    setDuplicatesAcknowledged(false);
  }

  function openEdit(clientId: string) {
    const client = clients.find((c) => c.id === clientId);
    if (!client) return;

    setEditingClientId(clientId);
    setForm({
      name: client.name,
      phone: client.phone ?? "",
      email: client.email ?? "",
      status: client.status,
    });
    setError(null);
    setDuplicatesAcknowledged(false);
    setShowEditDialog(true);
  }

  function closeEdit() {
    setShowEditDialog(false);
    setEditingClientId(null);
    setForm(EMPTY_FORM);
    setError(null);
    setDuplicatesAcknowledged(false);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const values = validateClientForm(form);
      if (duplicateMatches.length > 0 && !duplicatesAcknowledged) {
        setError("Revisa las coincidencias y confirma antes de guardar.");
        return;
      }
      await createClient.mutateAsync({
        name: values.name,
        phone: values.phone || null,
        email: values.email || null,
        status: values.status,
        initials: "CL",
      });
      closeForm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo crear el cliente.");
    }
  }

  async function saveEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editingClientId) return;

    setError(null);
    try {
      const values = validateClientForm(form);
      if (editDuplicates.length > 0 && !duplicatesAcknowledged) {
        setError("Confirma las posibles coincidencias antes de guardar.");
        return;
      }
      await updateClient.mutateAsync({
        id: editingClientId,
        updates: {
          name: values.name,
          initials: buildClientInitials(values.name),
          phone: values.phone || null,
          email: values.email || null,
          status: values.status,
        },
      });
      closeEdit();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo actualizar el cliente.");
    }
  }

  return (
    <AppLayout
      title="Clientes"
      subtitle="Directorio operativo de clientes"
      actions={
        canCreate ? (
          <>
            <Button type="button" variant="outline" onClick={() => setShowMethodSelector(true)}>
              <FileSpreadsheet className="h-4 w-4" /> Importar
            </Button>
            <Button type="button" onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4" /> Nuevo cliente
            </Button>
          </>
        ) : undefined
      }
    >
      <Card className="mb-5 flex flex-col gap-3 p-4 sm:flex-row">
        <label className="relative block flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              persistSearch(filters, event.target.value);
            }}
            placeholder="Buscar por nombre, teléfono o correo"
            className="pl-9"
            aria-label="Buscar clientes"
          />
        </label>
        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setDraftFilters(filters);
              setFiltersOpen(true);
            }}
          >
            <Filter className="h-4 w-4" /> Filtros
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </Button>
          <SheetContent className="w-full overflow-y-auto sm:max-w-md">
            <SheetHeader>
              <SheetTitle>Filtros de clientes</SheetTitle>
              <SheetDescription>
                Los filtros se conservan en la URL al volver de una ficha.
              </SheetDescription>
            </SheetHeader>
            <div className="mt-6 grid gap-4">
              <div>
                <Label htmlFor="client-filter-status">Estado</Label>
                <NativeSelect
                  id="client-filter-status"
                  className="mt-2"
                  value={draftFilters.status}
                  onChange={(event) =>
                    setDraftFilters({ ...draftFilters, status: event.target.value })
                  }
                >
                  <option value="">Todos</option>
                  {CLIENT_STATUS_OPTIONS.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="client-filter-from">Registrado desde</Label>
                  <Input
                    id="client-filter-from"
                    className="mt-2"
                    type="date"
                    value={draftFilters.from}
                    onChange={(event) =>
                      setDraftFilters({ ...draftFilters, from: event.target.value })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="client-filter-to">Hasta</Label>
                  <Input
                    id="client-filter-to"
                    className="mt-2"
                    type="date"
                    value={draftFilters.to}
                    onChange={(event) =>
                      setDraftFilters({ ...draftFilters, to: event.target.value })
                    }
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="client-filter-cases">Expedientes</Label>
                <NativeSelect
                  id="client-filter-cases"
                  className="mt-2"
                  value={draftFilters.cases}
                  onChange={(event) =>
                    setDraftFilters({ ...draftFilters, cases: event.target.value })
                  }
                >
                  <option value="">Todos</option>
                  <option value="with">Con expedientes</option>
                  <option value="without">Sin expedientes</option>
                </NativeSelect>
              </div>
              <div>
                <Label htmlFor="client-filter-tasks">Tareas activas</Label>
                <NativeSelect
                  id="client-filter-tasks"
                  className="mt-2"
                  value={draftFilters.tasks}
                  onChange={(event) =>
                    setDraftFilters({ ...draftFilters, tasks: event.target.value })
                  }
                >
                  <option value="">Todos</option>
                  <option value="with">Con tareas activas</option>
                  <option value="without">Sin tareas activas</option>
                </NativeSelect>
              </div>
              <div>
                <Label htmlFor="client-filter-sort">Ordenar</Label>
                <NativeSelect
                  id="client-filter-sort"
                  className="mt-2"
                  value={draftFilters.sort}
                  onChange={(event) =>
                    setDraftFilters({ ...draftFilters, sort: event.target.value })
                  }
                >
                  <option value="nombre">Nombre</option>
                  <option value="recent">Más recientes</option>
                  <option value="oldest">Más antiguos</option>
                </NativeSelect>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setDraftFilters({
                      status: "",
                      from: "",
                      to: "",
                      cases: "",
                      tasks: "",
                      sort: "nombre",
                    })
                  }
                >
                  Limpiar filtros
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    setFilters(draftFilters);
                    persistSearch(draftFilters);
                    setFiltersOpen(false);
                  }}
                >
                  Aplicar filtros
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <div className="hidden min-w-[880px] grid-cols-[minmax(190px,1.8fr)_95px_minmax(150px,1.4fr)_85px_95px_85px_44px] items-center gap-4 border-b bg-primary/5 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground lg:grid">
            <span>Cliente</span>
            <span>Teléfono</span>
            <span>Correo</span>
            <span>Expedientes</span>
            <span>Estado</span>
            <span>Registro</span>
            <span className="sr-only">Acciones</span>
          </div>
          {isLoading ? (
            <LoadingState rows={5} className="rounded-none border-0 shadow-none" />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Users}
              title={search ? "No encontramos clientes" : "Todavía no hay clientes"}
              description={
                search
                  ? "Prueba con otro nombre, teléfono o correo."
                  : "Crea el primer registro para comenzar a organizar el directorio."
              }
              action={
                !search && canCreate ? (
                  <Button type="button" onClick={() => setShowForm(true)}>
                    <UserPlus /> Nuevo cliente
                  </Button>
                ) : undefined
              }
              className="rounded-none border-0 shadow-none"
            />
          ) : (
            filtered.map((client) => (
              <div
                key={client.id}
                className={[
                  "border-b border-l-2 p-4 transition-colors last:border-b-0",
                  "lg:grid lg:min-w-[880px] lg:grid-cols-[minmax(190px,1.8fr)_95px_minmax(150px,1.4fr)_85px_95px_85px_44px] lg:items-center lg:gap-4 lg:px-5",
                  "hover:bg-primary/5",
                  client.status === "Activo" ? "border-l-primary" : "border-l-transparent",
                ].join(" ")}
              >
                <Link
                  to={"/clientes/$id" as never}
                  params={{ id: client.id } as never}
                  className="flex min-w-0 items-center gap-3 font-semibold hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:rounded-sm"
                >
                  <span
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold text-white ring-2 ring-white/20"
                    style={{ background: client.color }}
                    aria-hidden="true"
                  >
                    {client.initials}
                  </span>
                  <span className="truncate" title={client.name}>
                    {client.name}
                  </span>
                </Link>
                <div className="mt-3 flex items-center gap-2 text-sm lg:mt-0">
                  <Phone className="h-4 w-4 text-info-foreground lg:hidden" aria-hidden="true" />
                  {client.phone || <span className="text-muted-foreground">Sin teléfono</span>}
                </div>
                <div className="mt-2 flex min-w-0 items-center gap-2 text-sm text-muted-foreground lg:mt-0">
                  <Mail
                    className="h-4 w-4 shrink-0 text-success-foreground lg:hidden"
                    aria-hidden="true"
                  />
                  <span className="truncate" title={client.email ?? undefined}>
                    {client.email || <span className="text-muted-foreground">Sin correo</span>}
                  </span>
                </div>
                <div className="mt-3 text-sm lg:mt-0">{caseCounts[client.id] ?? 0}</div>
                <div className="mt-3 lg:mt-0">
                  <StatusBadge tone={client.status === "Activo" ? "success" : "default"}>
                    {client.status}
                  </StatusBadge>
                </div>
                <div className="mt-3 text-xs text-muted-foreground lg:mt-0">
                  {new Date(client.registered_at).toLocaleDateString("es-PE")}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-3 h-9 w-9 p-0 lg:mt-0 hover:bg-primary/10"
                      aria-label={`Abrir acciones para ${client.name}`}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem
                      onClick={() =>
                        navigate({
                          to: "/clientes/$id" as never,
                          params: { id: client.id } as never,
                        })
                      }
                    >
                      <Eye className="h-4 w-4" />
                      Ver ficha
                    </DropdownMenuItem>
                    {canEdit && (
                      <DropdownMenuItem onClick={() => openEdit(client.id)}>
                        <Edit3 className="h-4 w-4" />
                        Editar
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))
          )}
        </div>
      </Card>

      <Dialog open={showForm} onOpenChange={(open) => !open && closeForm()}>
        <DialogContent size="md">
          <DialogHeader>
            <div className="mb-1 grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <UserPlus className="h-5 w-5" aria-hidden="true" />
            </div>
            <DialogTitle>Nuevo cliente</DialogTitle>
            <DialogDescription>
              Registra solo la información necesaria para trabajar.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="grid gap-5">
            <FormSection title="Información principal">
              <FormField id="client-name" label="Nombre completo" className="sm:col-span-2">
                <Input
                  id="client-name"
                  required
                  autoFocus
                  autoComplete="name"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </FormField>
              <FormField id="client-phone" label="Teléfono principal">
                <Input
                  id="client-phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={(event) => setForm({ ...form, phone: event.target.value })}
                />
              </FormField>
              <FormField id="client-email" label="Correo" optional>
                <Input
                  id="client-email"
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                />
              </FormField>
              <FormField id="client-status" label="Estado" className="sm:col-span-2">
                <NativeSelect
                  id="client-status"
                  value={form.status}
                  onChange={(event) => setForm({ ...form, status: event.target.value })}
                >
                  {CLIENT_STATUS_OPTIONS.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </NativeSelect>
              </FormField>
            </FormSection>
            {duplicateMatches.length > 0 && (
              <div className="rounded-lg border border-warning/35 bg-warning/10 p-3 text-sm">
                <p className="font-semibold">Posibles coincidencias</p>
                {duplicateMatches.map((match) => (
                  <p key={match.clientId}>
                    {match.clientName}: {match.reason}
                  </p>
                ))}
                <label className="mt-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={duplicatesAcknowledged}
                    onChange={(event) => setDuplicatesAcknowledged(event.target.checked)}
                  />
                  Confirmo que es un cliente distinto.
                </label>
              </div>
            )}
            <FormErrorSummary>{error}</FormErrorSummary>
            <FormActions>
              <Button type="button" variant="outline" onClick={closeForm}>
                Cancelar
              </Button>
              <Button type="submit" loading={createClient.isPending}>
                Guardar cliente
              </Button>
            </FormActions>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditDialog} onOpenChange={(open) => !open && closeEdit()}>
        <DialogContent size="md">
          <DialogHeader>
            <div className="mb-1 grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <Edit3 className="h-5 w-5" aria-hidden="true" />
            </div>
            <DialogTitle>Editar cliente</DialogTitle>
            <DialogDescription>Actualiza la información operativa del cliente.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveEdit} className="grid gap-5">
            <FormSection title="Información principal">
              <FormField id="edit-client-name" label="Nombre completo" className="sm:col-span-2">
                <Input
                  id="edit-client-name"
                  required
                  autoFocus
                  autoComplete="name"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </FormField>
              <FormField id="edit-client-phone" label="Teléfono principal">
                <Input
                  id="edit-client-phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={(event) => setForm({ ...form, phone: event.target.value })}
                />
              </FormField>
              <FormField id="edit-client-email" label="Correo" optional>
                <Input
                  id="edit-client-email"
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                />
              </FormField>
              <FormField id="edit-client-status" label="Estado" className="sm:col-span-2">
                <NativeSelect
                  id="edit-client-status"
                  value={form.status}
                  onChange={(event) => setForm({ ...form, status: event.target.value })}
                >
                  {CLIENT_STATUS_OPTIONS.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </NativeSelect>
              </FormField>
            </FormSection>
            {editDuplicates.length > 0 && (
              <div className="rounded-lg border border-warning/35 bg-warning/10 p-3 text-sm">
                <p className="font-semibold">Posibles coincidencias</p>
                {editDuplicates.map((match) => (
                  <p key={match.clientId}>
                    {match.clientName}: {match.reason}
                  </p>
                ))}
                <label className="mt-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={duplicatesAcknowledged}
                    onChange={(event) => setDuplicatesAcknowledged(event.target.checked)}
                  />
                  Confirmo que es un cliente distinto.
                </label>
              </div>
            )}
            <FormErrorSummary>{error}</FormErrorSummary>
            <FormActions>
              <Button type="button" variant="outline" onClick={closeEdit}>
                Cancelar
              </Button>
              <Button type="submit" loading={updateClient.isPending}>
                Guardar cambios
              </Button>
            </FormActions>
          </form>
        </DialogContent>
      </Dialog>

      {showImport && (
        <CSVImport
          onClose={() => setShowImport(false)}
          onSuccess={() => {
            setShowImport(false);
            window.location.reload();
          }}
        />
      )}

      {/* Selector de método de importación */}
      <ImportMethodSelector
        open={showMethodSelector}
        zipAllowed={canImportZip}
        onClose={() => setShowMethodSelector(false)}
        onSelect={(method) => {
          setShowMethodSelector(false);
          if (method === "csv") {
            setShowImport(true);
          } else if (canImportZip) {
            setShowZipImport(true);
          }
        }}
      />

      {/* Importador ZIP — solo visible para Administrador */}
      {canImportZip && (
        <ZipImporter
          open={showZipImport}
          onClose={() => setShowZipImport(false)}
          onSuccess={() => {
            setShowZipImport(false);
            window.location.reload();
          }}
          existingClients={clients.map((c) => ({ id: c.id, name: c.name }))}
        />
      )}
    </AppLayout>
  );
}
