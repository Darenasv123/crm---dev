import { createFileRoute, Link } from "@tanstack/react-router";
import { FileSpreadsheet, Mail, MoreHorizontal, Phone, Plus, Search, Users, X } from "lucide-react";
import { useMemo, useState } from "react";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { CSVImport } from "@/components/csv-import";
import { useCases } from "@/hooks/use-cases";
import { useClients, useCreateClient } from "@/hooks/use-clients";
import {
  CLIENT_STATUS_OPTIONS,
  findClientDuplicates,
  validateClientForm,
  type ClientFormValues,
} from "@/lib/client-validation";

export const Route = createFileRoute("/_app/clientes/")({
  component: ClientsPage,
});

const EMPTY_FORM: ClientFormValues = {
  name: "",
  phone: "",
  email: "",
  status: "Activo",
};

function ClientsPage() {
  const { data: clients = [], isLoading } = useClients();
  const { data: cases = [] } = useCases();
  const createClient = useCreateClient();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [form, setForm] = useState<ClientFormValues>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [duplicatesAcknowledged, setDuplicatesAcknowledged] = useState(false);

  const caseCounts = useMemo(
    () =>
      cases.reduce<Record<string, number>>((counts, item) => {
        counts[item.client_id] = (counts[item.client_id] ?? 0) + 1;
        return counts;
      }, {}),
    [cases],
  );
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return clients;
    return clients.filter(
      (client) =>
        client.name.toLowerCase().includes(term) ||
        (client.phone ?? "").includes(term) ||
        (client.email ?? "").toLowerCase().includes(term),
    );
  }, [clients, search]);
  const duplicateMatches = showForm ? findClientDuplicates(form, clients) : [];

  function closeForm() {
    setShowForm(false);
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

  return (
    <AppLayout
      title="Clientes"
      subtitle="Directorio operativo de clientes"
      actions={
        <>
          <button
            type="button"
            onClick={() => setShowImport(true)}
            className="inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-sm font-semibold"
          >
            <FileSpreadsheet className="h-4 w-4" /> Importar
          </button>
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
          >
            <Plus className="h-4 w-4" /> Nuevo cliente
          </button>
        </>
      }
    >
      <Card className="mb-5 p-4">
        <label className="relative block max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nombre, teléfono o correo"
            className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
        </label>
      </Card>

      <Card className="overflow-hidden">
        <div className="hidden grid-cols-[minmax(220px,2fr)_minmax(130px,1fr)_minmax(180px,1.4fr)_100px_110px_120px_48px] items-center gap-4 border-b border-border bg-muted/35 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid">
          <span>Cliente</span>
          <span>Teléfono</span>
          <span>Correo</span>
          <span>Expedientes</span>
          <span>Estado</span>
          <span>Registro</span>
          <span className="sr-only">Acciones</span>
        </div>
        {isLoading ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Cargando clientes…</p>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <Users className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">No hay clientes para mostrar.</p>
          </div>
        ) : (
          filtered.map((client) => (
            <div
              key={client.id}
              className="border-b border-border p-4 last:border-b-0 md:grid md:grid-cols-[minmax(220px,2fr)_minmax(130px,1fr)_minmax(180px,1.4fr)_100px_110px_120px_48px] md:items-center md:gap-4 md:px-5"
            >
              <Link
                to={"/clientes/$id" as never}
                params={{ id: client.id } as never}
                className="flex min-w-0 items-center gap-3 font-semibold hover:text-primary"
              >
                <span
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold text-white"
                  style={{ background: client.color }}
                >
                  {client.initials}
                </span>
                <span className="truncate">{client.name}</span>
              </Link>
              <div className="mt-3 flex items-center gap-2 text-sm md:mt-0">
                <Phone className="h-4 w-4 text-muted-foreground md:hidden" />
                {client.phone || "Sin teléfono"}
              </div>
              <div className="mt-2 flex min-w-0 items-center gap-2 text-sm text-muted-foreground md:mt-0">
                <Mail className="h-4 w-4 shrink-0 md:hidden" />
                <span className="truncate" title={client.email ?? undefined}>
                  {client.email || "Sin correo"}
                </span>
              </div>
              <div className="mt-3 text-sm md:mt-0">{caseCounts[client.id] ?? 0}</div>
              <div className="mt-3 md:mt-0">
                <StatusBadge tone={client.status === "Activo" ? "success" : "default"}>
                  {client.status}
                </StatusBadge>
              </div>
              <div className="mt-3 text-xs text-muted-foreground md:mt-0">
                {new Date(client.registered_at).toLocaleDateString("es-PE")}
              </div>
              <Link
                to={"/clientes/$id" as never}
                params={{ id: client.id } as never}
                aria-label={`Abrir ${client.name}`}
                className="mt-3 grid h-9 w-9 place-items-center rounded-lg border border-border hover:bg-muted md:mt-0"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Link>
            </div>
          ))
        )}
      </Card>

      {showForm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4">
          <Card className="w-full max-w-xl p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold">Nuevo cliente</h2>
                <p className="text-sm text-muted-foreground">
                  Registra solo la información necesaria para trabajar.
                </p>
              </div>
              <button
                type="button"
                onClick={closeForm}
                className="grid h-9 w-9 place-items-center rounded-lg hover:bg-muted"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={submit} className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Nombre completo" className="sm:col-span-2">
                <input
                  required
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  className="field"
                />
              </Field>
              <Field label="Teléfono principal">
                <input
                  inputMode="numeric"
                  value={form.phone}
                  onChange={(event) => setForm({ ...form, phone: event.target.value })}
                  className="field"
                />
              </Field>
              <Field label="Correo (opcional)">
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                  className="field"
                />
              </Field>
              <Field label="Estado" className="sm:col-span-2">
                <select
                  value={form.status}
                  onChange={(event) => setForm({ ...form, status: event.target.value })}
                  className="field"
                >
                  {CLIENT_STATUS_OPTIONS.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              </Field>
              {duplicateMatches.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm sm:col-span-2">
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
              {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
              <div className="flex justify-end gap-2 sm:col-span-2">
                <button type="button" onClick={closeForm} className="h-10 rounded-lg border px-4">
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={createClient.isPending}
                  className="h-10 rounded-lg bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {createClient.isPending ? "Guardando…" : "Guardar cliente"}
                </button>
              </div>
            </form>
          </Card>
        </div>
      )}
      {showImport && (
        <CSVImport
          onClose={() => setShowImport(false)}
          onSuccess={() => {
            setShowImport(false);
            window.location.reload();
          }}
        />
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
