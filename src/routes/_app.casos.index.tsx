import { createFileRoute, Link } from "@tanstack/react-router";
import { Briefcase, MoreHorizontal, Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
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
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
        >
          <Plus className="h-4 w-4" /> Nuevo expediente
        </button>
      }
    >
      <Card className="mb-5 p-4">
        <label className="relative block max-w-xl">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por expediente, cliente, materia o proceso"
            className="h-9 w-full rounded-lg border bg-background pl-9 pr-3 text-sm"
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
          <p className="p-8 text-center text-sm text-muted-foreground">Cargando expedientes…</p>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <Briefcase className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">No hay expedientes para mostrar.</p>
          </div>
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

      {showForm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4">
          <Card className="max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6" role="dialog">
            <div className="flex justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold">Nuevo expediente</h2>
                <p className="text-sm text-muted-foreground">Información operativa esencial.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="grid h-9 w-9 place-items-center rounded-lg hover:bg-muted"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={submit} className="mt-6 grid gap-4 sm:grid-cols-2">
              <Field label="Cliente" className="sm:col-span-2">
                <select
                  required
                  value={form.client_id}
                  onChange={(event) => setForm({ ...form, client_id: event.target.value })}
                  className="field"
                >
                  <option value="">Selecciona un cliente</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Número de expediente">
                <input
                  value={form.expediente}
                  onChange={(event) => setForm({ ...form, expediente: event.target.value })}
                  className="field"
                />
              </Field>
              <Field label="Materia">
                <select
                  value={form.materia}
                  onChange={(event) => setForm({ ...form, materia: event.target.value })}
                  className="field"
                >
                  {MATERIA_OPTIONS.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              </Field>
              <Field label="Tipo de proceso">
                <input
                  required
                  value={form.process_type}
                  onChange={(event) => setForm({ ...form, process_type: event.target.value })}
                  className="field"
                />
              </Field>
              <Field label="Estado">
                <select
                  value={form.status}
                  onChange={(event) => setForm({ ...form, status: event.target.value })}
                  className="field"
                >
                  {CASE_STATUS_OPTIONS.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              </Field>
              <Field label="Próxima acción" className="sm:col-span-2">
                <textarea
                  value={form.next_action}
                  onChange={(event) => setForm({ ...form, next_action: event.target.value })}
                  className="field min-h-20"
                />
              </Field>
              {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
              <div className="flex justify-end gap-2 sm:col-span-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="h-10 rounded-lg border px-4"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={createCase.isPending}
                  className="h-10 rounded-lg bg-primary px-4 font-semibold text-primary-foreground"
                >
                  {createCase.isPending ? "Guardando…" : "Guardar expediente"}
                </button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </AppLayout>
  );
}

function Field({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`grid gap-1.5 text-sm font-medium ${className}`}>
      {label}
      {children}
    </label>
  );
}
