import { createFileRoute, Link } from "@tanstack/react-router";
import {
  FileSpreadsheet,
  Mail,
  MoreHorizontal,
  Phone,
  Plus,
  Search,
  UserPlus,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { CSVImport } from "@/components/csv-import";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, LoadingState } from "@/components/ui/data-state";
import { FormActions, FormErrorSummary, FormField, FormSection } from "@/components/ui/form-layout";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
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
          <Button type="button" variant="outline" onClick={() => setShowImport(true)}>
            <FileSpreadsheet className="h-4 w-4" /> Importar
          </Button>
          <Button type="button" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4" /> Nuevo cliente
          </Button>
        </>
      }
    >
      <Card className="mb-5 p-4">
        <label className="relative block max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nombre, teléfono o correo"
            className="pl-9"
            aria-label="Buscar clientes"
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
              !search ? (
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
