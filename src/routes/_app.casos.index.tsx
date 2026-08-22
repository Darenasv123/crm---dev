import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Briefcase,
  Edit3,
  Eye,
  Filter,
  FolderPlus,
  MoreHorizontal,
  Plus,
  Search,
} from "lucide-react";
import { useMemo, useState } from "react";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState, LoadingState } from "@/components/ui/data-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormActions, FormErrorSummary, FormField, FormSection } from "@/components/ui/form-layout";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuth } from "@/hooks/use-auth";
import { useCases, useCreateCase } from "@/hooks/use-cases";
import { useClients } from "@/hooks/use-clients";
import { useDocuments } from "@/hooks/use-documents";
import { useCaseTasks } from "@/hooks/legal/use-case-management";
import {
  CASE_STATUS_OPTIONS,
  MATERIA_OPTIONS,
  validateCaseForm,
  type CaseFormValues,
} from "@/lib/case-validation";
import { usePermissions } from "@/lib/permissions";
import { CaseEditDialog } from "@/components/cases/case-edit-dialog";

/** Devuelve la clase de borde lateral izquierdo según el estado del expediente */
function caseBorderClass(status: string): string {
  if (status === "Archivado" || status === "Concluido") return "border-l-transparent";
  if (status === "Audiencia") return "border-l-warning";
  if (status === "Bloqueado") return "border-l-destructive";
  return "border-l-primary";
}

/** Devuelve el tono del badge de estado del expediente */
function caseStatusTone(
  status: string,
): "default" | "info" | "warning" | "danger" | "success" | "gold" | "navy" {
  if (status === "Archivado" || status === "Concluido") return "default";
  if (status === "Audiencia") return "warning";
  if (status === "Sentencia") return "success";
  if (status === "En proceso" || status === "Demanda presentada") return "navy";
  if (status === "Documentación") return "info";
  return "info";
}

export const Route = createFileRoute("/_app/casos/")({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" ? search.q : "",
    estado: typeof search.estado === "string" ? search.estado : "",
    materia: typeof search.materia === "string" ? search.materia : "",
    cliente: typeof search.cliente === "string" ? search.cliente : "",
    desde: typeof search.desde === "string" ? search.desde : "",
    hasta: typeof search.hasta === "string" ? search.hasta : "",
    tareas: typeof search.tareas === "string" ? search.tareas : "",
    documentos: typeof search.documentos === "string" ? search.documentos : "",
    ordenar: typeof search.ordenar === "string" ? search.ordenar : "recent",
  }),
  component: CasesPage,
});

const EMPTY_FORM: CaseFormValues = {
  client_id: "",
  expediente: "",
  materia: "Familia",
  process_type: "",
  status: "Pendiente de clasificación",
  next_action: "",
};

function CasesPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const routeSearch = Route.useSearch();
  const { data: cases = [], isLoading } = useCases();
  const { data: clients = [] } = useClients();
  const { data: documents = [] } = useDocuments();
  const { data: tasks = [] } = useCaseTasks();
  const createCase = useCreateCase();
  const [search, setSearch] = useState(routeSearch.q);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({
    status: routeSearch.estado,
    matter: routeSearch.materia,
    client: routeSearch.cliente,
    from: routeSearch.desde,
    to: routeSearch.hasta,
    tasks: routeSearch.tareas,
    documents: routeSearch.documentos,
    sort: routeSearch.ordenar,
  });
  const [draftFilters, setDraftFilters] = useState(filters);
  const [showForm, setShowForm] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingCaseId, setEditingCaseId] = useState<string | null>(null);
  const [form, setForm] = useState<CaseFormValues>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const permissions = usePermissions(profile);
  const canCreate = permissions.canCreateCases;
  const canEdit = permissions.canEditCases;
  const editingCase = editingCaseId ? (cases.find((c) => c.id === editingCaseId) ?? null) : null;

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = cases.filter(
      (item) =>
        (!term ||
          item.expediente.toLowerCase().includes(term) ||
          (item.case_number ?? "").toLowerCase().includes(term) ||
          item.process_type.toLowerCase().includes(term) ||
          (item.materia ?? "").toLowerCase().includes(term) ||
          (item.clients?.name ?? "").toLowerCase().includes(term)) &&
        (!filters.status || item.status === filters.status) &&
        (!filters.matter || item.materia === filters.matter) &&
        (!filters.client || item.client_id === filters.client) &&
        (!filters.from || item.created_at.slice(0, 10) >= filters.from) &&
        (!filters.to || item.created_at.slice(0, 10) <= filters.to) &&
        (!filters.tasks ||
          (filters.tasks === "with"
            ? tasks.some(
                (task) =>
                  task.case_id === item.id && !["completed", "cancelled"].includes(task.status),
              )
            : !tasks.some(
                (task) =>
                  task.case_id === item.id && !["completed", "cancelled"].includes(task.status),
              ))) &&
        (!filters.documents ||
          (filters.documents === "with"
            ? documents.some((doc) => doc.case_id === item.id)
            : !documents.some((doc) => doc.case_id === item.id))),
    );
    return rows.sort((a, b) => {
      if (filters.sort === "client")
        return (a.clients?.name ?? "").localeCompare(b.clients?.name ?? "", "es");
      if (filters.sort === "number")
        return (a.case_number || a.expediente).localeCompare(b.case_number || b.expediente, "es");
      if (filters.sort === "oldest") return a.created_at.localeCompare(b.created_at);
      return b.created_at.localeCompare(a.created_at);
    });
  }, [cases, documents, filters, search, tasks]);
  const activeFilterCount = [
    filters.status,
    filters.matter,
    filters.client,
    filters.from,
    filters.to,
    filters.tasks,
    filters.documents,
    filters.sort !== "recent",
  ].filter(Boolean).length;

  function persistSearch(nextFilters = filters, nextSearch = search) {
    void navigate({
      to: "/casos" as never,
      search: {
        q: nextSearch || undefined,
        estado: nextFilters.status || undefined,
        materia: nextFilters.matter || undefined,
        cliente: nextFilters.client || undefined,
        desde: nextFilters.from || undefined,
        hasta: nextFilters.to || undefined,
        tareas: nextFilters.tasks || undefined,
        documentos: nextFilters.documents || undefined,
        ordenar: nextFilters.sort === "recent" ? undefined : nextFilters.sort,
      } as never,
      replace: true,
    });
  }

  function openEdit(caseId: string) {
    setEditingCaseId(caseId);
    setShowEditDialog(true);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const values = validateCaseForm(form);
      await createCase.mutateAsync({
        client_id: values.client_id,
        expediente: values.expediente || "Sin número",
        materia: values.materia,
        process_type: values.process_type,
        status: values.status,
        next_action: values.next_action || null,
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo crear el expediente.");
    }
  }

  return (
    <AppLayout
      title="Expedientes"
      subtitle="Seguimiento jurídico y próximas acciones"
      actions={
        canCreate ? (
          <Button type="button" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4" /> Nuevo expediente
          </Button>
        ) : undefined
      }
    >
      <Card className="mb-5 flex flex-col gap-3 p-4 sm:flex-row">
        <label className="relative block flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              persistSearch(filters, event.target.value);
            }}
            placeholder="Buscar por expediente, cliente, materia o proceso"
            className="pl-9"
            aria-label="Buscar expedientes"
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
              <SheetTitle>Filtros de expedientes</SheetTitle>
              <SheetDescription>Los criterios se conservan en la URL.</SheetDescription>
            </SheetHeader>
            <div className="mt-6 grid gap-4">
              <div>
                <Label htmlFor="case-filter-status">Estado</Label>
                <NativeSelect
                  id="case-filter-status"
                  className="mt-2"
                  value={draftFilters.status}
                  onChange={(event) =>
                    setDraftFilters({ ...draftFilters, status: event.target.value })
                  }
                >
                  <option value="">Todos</option>
                  {CASE_STATUS_OPTIONS.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </NativeSelect>
              </div>
              <div>
                <Label htmlFor="case-filter-matter">Materia</Label>
                <NativeSelect
                  id="case-filter-matter"
                  className="mt-2"
                  value={draftFilters.matter}
                  onChange={(event) =>
                    setDraftFilters({ ...draftFilters, matter: event.target.value })
                  }
                >
                  <option value="">Todas</option>
                  {MATERIA_OPTIONS.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </NativeSelect>
              </div>
              <div>
                <Label htmlFor="case-filter-client">Cliente</Label>
                <NativeSelect
                  id="case-filter-client"
                  className="mt-2"
                  value={draftFilters.client}
                  onChange={(event) =>
                    setDraftFilters({ ...draftFilters, client: event.target.value })
                  }
                >
                  <option value="">Todos</option>
                  {clients.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="case-filter-from">Creado desde</Label>
                  <Input
                    id="case-filter-from"
                    className="mt-2"
                    type="date"
                    value={draftFilters.from}
                    onChange={(event) =>
                      setDraftFilters({ ...draftFilters, from: event.target.value })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="case-filter-to">Hasta</Label>
                  <Input
                    id="case-filter-to"
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
                <Label htmlFor="case-filter-tasks">Tareas pendientes</Label>
                <NativeSelect
                  id="case-filter-tasks"
                  className="mt-2"
                  value={draftFilters.tasks}
                  onChange={(event) =>
                    setDraftFilters({ ...draftFilters, tasks: event.target.value })
                  }
                >
                  <option value="">Todos</option>
                  <option value="with">Con tareas pendientes</option>
                  <option value="without">Sin tareas pendientes</option>
                </NativeSelect>
              </div>
              <div>
                <Label htmlFor="case-filter-documents">Documentos</Label>
                <NativeSelect
                  id="case-filter-documents"
                  className="mt-2"
                  value={draftFilters.documents}
                  onChange={(event) =>
                    setDraftFilters({ ...draftFilters, documents: event.target.value })
                  }
                >
                  <option value="">Todos</option>
                  <option value="with">Con documentos</option>
                  <option value="without">Sin documentos</option>
                </NativeSelect>
              </div>
              <div>
                <Label htmlFor="case-filter-sort">Ordenar</Label>
                <NativeSelect
                  id="case-filter-sort"
                  className="mt-2"
                  value={draftFilters.sort}
                  onChange={(event) =>
                    setDraftFilters({ ...draftFilters, sort: event.target.value })
                  }
                >
                  <option value="recent">Más recientes</option>
                  <option value="oldest">Más antiguos</option>
                  <option value="client">Cliente</option>
                  <option value="number">Número de expediente</option>
                </NativeSelect>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setDraftFilters({
                      status: "",
                      matter: "",
                      client: "",
                      from: "",
                      to: "",
                      tasks: "",
                      documents: "",
                      sort: "recent",
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
          <div className="hidden min-w-[820px] grid-cols-[130px_170px_110px_120px_minmax(180px,1fr)_44px] gap-4 border-b bg-primary/5 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground lg:grid">
            <span>Expediente</span>
            <span>Cliente</span>
            <span>Materia</span>
            <span>Estado</span>
            <span>Próxima acción</span>
            <span className="sr-only">Acciones</span>
          </div>
          {isLoading ? (
            <LoadingState rows={5} className="rounded-none border-0 shadow-none" />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Briefcase}
              title={search ? "No encontramos expedientes" : "Todavía no hay expedientes"}
              description={
                search
                  ? "Prueba con otro número, cliente, materia o tipo de proceso."
                  : "Crea el primer expediente para comenzar el seguimiento jurídico."
              }
              action={
                !search && canCreate ? (
                  <Button type="button" onClick={() => setShowForm(true)}>
                    <FolderPlus /> Nuevo expediente
                  </Button>
                ) : undefined
              }
              className="rounded-none border-0 shadow-none"
            />
          ) : (
            filtered.map((item) => (
              <div
                key={item.id}
                className={[
                  "border-b border-l-2 p-4 transition-colors last:border-b-0 hover:bg-primary/5",
                  "lg:grid lg:min-w-[820px] lg:grid-cols-[130px_170px_110px_120px_minmax(180px,1fr)_44px] lg:items-center lg:gap-4 lg:px-5",
                  caseBorderClass(item.status),
                ].join(" ")}
              >
                <Link
                  to={"/casos/$id" as never}
                  params={{ id: item.id } as never}
                  className="text-sm font-semibold hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:rounded-sm"
                  title={item.case_number || item.expediente}
                >
                  <span className="font-mono text-xs text-muted-foreground">
                    {item.case_number || item.expediente}
                  </span>
                </Link>
                <p
                  className="mt-2 truncate text-sm lg:mt-0"
                  title={item.clients?.name || undefined}
                >
                  {item.clients?.name || "Sin cliente"}
                </p>
                <p className="mt-2 truncate text-sm text-muted-foreground lg:mt-0">
                  {item.materia || item.process_type}
                </p>
                <div className="mt-3 lg:mt-0">
                  <StatusBadge tone={caseStatusTone(item.status)}>{item.status}</StatusBadge>
                </div>
                <p
                  className="mt-3 truncate text-sm text-muted-foreground lg:mt-0"
                  title={item.next_action || undefined}
                >
                  {item.next_action || (
                    <span className="text-muted-foreground/60 italic">Sin acción registrada</span>
                  )}
                </p>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-3 h-9 w-9 p-0 lg:mt-0"
                      aria-label={`Abrir acciones para ${item.expediente}`}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem
                      onClick={() =>
                        navigate({ to: "/casos/$id" as never, params: { id: item.id } as never })
                      }
                    >
                      <Eye className="h-4 w-4" />
                      Ver ficha
                    </DropdownMenuItem>
                    {canEdit && (
                      <DropdownMenuItem onClick={() => openEdit(item.id)}>
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

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent size="lg">
          <DialogHeader>
            <div className="mb-1 grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <FolderPlus className="h-5 w-5" aria-hidden="true" />
            </div>
            <DialogTitle>Nuevo expediente</DialogTitle>
            <DialogDescription>
              Registra la información operativa esencial para iniciar el seguimiento.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="grid gap-5">
            <FormSection title="Información principal">
              <FormField id="case-client" label="Cliente" className="sm:col-span-2">
                <NativeSelect
                  id="case-client"
                  required
                  autoFocus
                  value={form.client_id}
                  onChange={(event) => setForm({ ...form, client_id: event.target.value })}
                >
                  <option value="">Selecciona un cliente</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField id="case-number" label="Número de expediente">
                <Input
                  id="case-number"
                  value={form.expediente}
                  onChange={(event) => setForm({ ...form, expediente: event.target.value })}
                />
              </FormField>
              <FormField id="case-matter" label="Materia">
                <NativeSelect
                  id="case-matter"
                  value={form.materia}
                  onChange={(event) => setForm({ ...form, materia: event.target.value })}
                >
                  {MATERIA_OPTIONS.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField id="case-process" label="Tipo de proceso">
                <Input
                  id="case-process"
                  required
                  value={form.process_type}
                  onChange={(event) => setForm({ ...form, process_type: event.target.value })}
                />
              </FormField>
              <FormField id="case-status" label="Estado">
                <NativeSelect
                  id="case-status"
                  value={form.status}
                  onChange={(event) => setForm({ ...form, status: event.target.value })}
                >
                  {CASE_STATUS_OPTIONS.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </NativeSelect>
              </FormField>
              <FormField
                id="case-next-action"
                label="Próxima acción"
                optional
                className="sm:col-span-2"
              >
                <Textarea
                  id="case-next-action"
                  value={form.next_action}
                  onChange={(event) => setForm({ ...form, next_action: event.target.value })}
                />
              </FormField>
            </FormSection>
            <FormErrorSummary>{error}</FormErrorSummary>
            <FormActions>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Cancelar
              </Button>
              <Button type="submit" loading={createCase.isPending}>
                Guardar expediente
              </Button>
            </FormActions>
          </form>
        </DialogContent>
      </Dialog>

      <CaseEditDialog
        open={showEditDialog}
        onOpenChange={(open) => {
          setShowEditDialog(open);
          if (!open) setEditingCaseId(null);
        }}
        caseItem={editingCase}
        clients={clients}
      />
    </AppLayout>
  );
}
