import { createFileRoute, Link } from "@tanstack/react-router";
import { Briefcase, FolderPlus, MoreHorizontal, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
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
import { useCases, useCreateCase } from "@/hooks/use-cases";
import { useClients } from "@/hooks/use-clients";
import {
  CASE_STATUS_OPTIONS,
  MATERIA_OPTIONS,
  validateCaseForm,
  type CaseFormValues,
} from "@/lib/case-validation";

export const Route = createFileRoute("/_app/casos/")({
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
  const { data: cases = [], isLoading } = useCases();
  const { data: clients = [] } = useClients();
  const createCase = useCreateCase();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CaseFormValues>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return cases;
    return cases.filter(
      (item) =>
        item.expediente.toLowerCase().includes(term) ||
        (item.case_number ?? "").toLowerCase().includes(term) ||
        item.process_type.toLowerCase().includes(term) ||
        (item.materia ?? "").toLowerCase().includes(term) ||
        (item.clients?.name ?? "").toLowerCase().includes(term),
    );
  }, [cases, search]);

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
        <Button type="button" onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4" /> Nuevo expediente
        </Button>
      }
    >
      <Card className="mb-5 p-4">
        <label className="relative block max-w-xl">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por expediente, cliente, materia o proceso"
            className="pl-9"
            aria-label="Buscar expedientes"
          />
        </label>
      </Card>

      <Card className="overflow-hidden">
        <div className="hidden grid-cols-[minmax(180px,1.4fr)_minmax(190px,1.4fr)_minmax(130px,1fr)_130px_minmax(180px,1.2fr)_48px] gap-4 border-b bg-muted/35 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid">
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
              !search ? (
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
              className="border-b p-4 last:border-b-0 md:grid md:grid-cols-[minmax(180px,1.4fr)_minmax(190px,1.4fr)_minmax(130px,1fr)_130px_minmax(180px,1.2fr)_48px] md:items-center md:gap-4 md:px-5"
            >
              <Link
                to={"/casos/$id" as never}
                params={{ id: item.id } as never}
                className="font-semibold hover:text-primary"
              >
                {item.case_number || item.expediente}
              </Link>
              <p className="mt-2 truncate text-sm md:mt-0">{item.clients?.name || "Sin cliente"}</p>
              <p className="mt-2 text-sm text-muted-foreground md:mt-0">
                {item.materia || item.process_type}
              </p>
              <div className="mt-3 md:mt-0">
                <StatusBadge tone={item.status === "Archivado" ? "default" : "info"}>
                  {item.status}
                </StatusBadge>
              </div>
              <p className="mt-3 truncate text-sm text-muted-foreground md:mt-0">
                {item.next_action || "Sin acción registrada"}
              </p>
              <Link
                to={"/casos/$id" as never}
                params={{ id: item.id } as never}
                aria-label={`Abrir ${item.expediente}`}
                className="mt-3 grid h-9 w-9 place-items-center rounded-lg border hover:bg-muted md:mt-0"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Link>
            </div>
          ))
        )}
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
    </AppLayout>
  );
}
