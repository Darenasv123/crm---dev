import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Briefcase,
  CheckSquare,
  Edit3,
  FileText,
  Mail,
  Phone,
  Save,
  UserRoundPen,
} from "lucide-react";
import { useState } from "react";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
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
import { useClientReports } from "@/hooks/use-reports";
import { useDocuments } from "@/hooks/use-documents";
import { useCaseTasks } from "@/hooks/legal/use-case-management";
import { useCases } from "@/hooks/use-cases";
import { useClient, useClients, useUpdateClient } from "@/hooks/use-clients";
import {
  buildClientInitials,
  CLIENT_STATUS_OPTIONS,
  findClientDuplicates,
  validateClientForm,
  type ClientFormValues,
} from "@/lib/client-validation";

export const Route = createFileRoute("/_app/clientes/$id")({
  component: ClientDetail,
});

function ClientDetail() {
  const { id } = Route.useParams();
  const { data: client, isLoading, error: clientError } = useClient(id);
  const { data: allClients = [] } = useClients();
  const { data: cases = [] } = useCases();
  const { data: documents = [] } = useDocuments();
  const { data: reports = [] } = useClientReports();
  const { data: tasks = [] } = useCaseTasks({ clientId: id });
  const updateClient = useUpdateClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ClientFormValues>({
    name: "",
    phone: "",
    email: "",
    status: "Activo",
  });
  const [error, setError] = useState<string | null>(null);
  const [duplicatesAcknowledged, setDuplicatesAcknowledged] = useState(false);

  if (isLoading) {
    return (
      <AppLayout title="Cliente" subtitle="Cargando ficha">
        <Card className="p-8 text-center text-sm text-muted-foreground">Cargando…</Card>
      </AppLayout>
    );
  }

  if (clientError) {
    return (
      <AppLayout title="Error al cargar cliente">
        <Card className="p-8">
          <p className="text-center text-sm text-destructive">
            {clientError instanceof Error ? clientError.message : "Error desconocido"}
          </p>
          <div className="mt-4 text-center">
            <Button asChild variant="outline">
              <Link to={"/clientes" as never}>Volver al directorio</Link>
            </Button>
          </div>
        </Card>
      </AppLayout>
    );
  }

  if (!client) {
    return (
      <AppLayout title="Cliente no encontrado">
        <Link to={"/clientes" as never} className="text-primary hover:underline">
          Volver al directorio
        </Link>
      </AppLayout>
    );
  }

  const clientCases = cases.filter((item) => item.client_id === id);
  const caseIds = new Set(clientCases.map((item) => item.id));
  const clientDocuments = documents.filter(
    (item) => item.client_id === id || (item.case_id ? caseIds.has(item.case_id) : false),
  );
  const clientReports = reports.filter((item) => item.client_id === id);
  const activeTasks = tasks.filter((task) => !["completed", "cancelled"].includes(task.status));
  const duplicates = editing ? findClientDuplicates(form, allClients, id) : [];

  function openEdit() {
    if (!client) return;
    setForm({
      name: client.name,
      phone: client.phone ?? "",
      email: client.email ?? "",
      status: client.status,
    });
    setError(null);
    setDuplicatesAcknowledged(false);
    setEditing(true);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const values = validateClientForm(form);
      if (duplicates.length > 0 && !duplicatesAcknowledged) {
        setError("Confirma las posibles coincidencias antes de guardar.");
        return;
      }
      await updateClient.mutateAsync({
        id,
        updates: {
          name: values.name,
          initials: buildClientInitials(values.name),
          phone: values.phone || null,
          email: values.email || null,
          status: values.status,
        },
      });
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo actualizar el cliente.");
    }
  }

  return (
    <AppLayout
      title={client.name}
      subtitle={`Registrado el ${new Date(client.registered_at).toLocaleDateString("es-PE")}`}
      actions={
        <>
          <Button asChild variant="outline">
            <Link to={"/clientes" as never}>
              <ArrowLeft className="h-4 w-4" /> Volver
            </Link>
          </Button>
          <Button type="button" onClick={openEdit}>
            <Edit3 className="h-4 w-4" /> Editar
          </Button>
        </>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,2fr)]">
        <Card className="p-6">
          <div className="flex items-center gap-4">
            <span
              className="grid h-14 w-14 place-items-center rounded-full text-lg font-bold text-white"
              style={{ background: client.color }}
            >
              {client.initials}
            </span>
            <div className="min-w-0">
              <h2 className="truncate font-bold">{client.name}</h2>
              <StatusBadge tone={client.status === "Activo" ? "success" : "default"}>
                {client.status}
              </StatusBadge>
            </div>
          </div>
          <dl className="mt-6 space-y-4">
            <Contact icon={Phone} label="Teléfono" value={client.phone || "Sin teléfono"} />
            {client.email && <Contact icon={Mail} label="Correo" value={client.email} />}
          </dl>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2">
          <Activity icon={Briefcase} label="Expedientes" value={clientCases.length} href="/casos" />
          <Activity
            icon={CheckSquare}
            label="Tareas activas"
            value={activeTasks.length}
            href="/tareas"
          />
          <Activity
            icon={FileText}
            label="Documentos"
            value={clientDocuments.length}
            href="/documentos"
          />
          <Activity
            icon={FileText}
            label="Reportes"
            value={clientReports.length}
            href="/reportes"
          />
        </div>
      </div>

      <Card className="mt-5 overflow-hidden">
        <div className="border-b p-5">
          <h2 className="font-bold">Expedientes del cliente</h2>
        </div>
        {clientCases.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">Aún no hay expedientes registrados.</p>
        ) : (
          clientCases.map((item) => (
            <Link
              key={item.id}
              to={"/casos/$id" as never}
              params={{ id: item.id } as never}
              className="grid gap-1 border-b px-5 py-4 last:border-b-0 hover:bg-muted/40 sm:grid-cols-[1.2fr_1fr_140px]"
            >
              <span className="font-semibold">{item.case_number || item.expediente}</span>
              <span className="text-sm text-muted-foreground">
                {item.materia || item.process_type}
              </span>
              <span className="text-sm">{item.status}</span>
            </Link>
          ))
        )}
      </Card>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent size="md">
          <DialogHeader>
            <div className="mb-1 grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <UserRoundPen className="h-5 w-5" aria-hidden="true" />
            </div>
            <DialogTitle>Editar cliente</DialogTitle>
            <DialogDescription>
              Actualiza la información operativa principal del cliente.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="grid gap-5">
            <FormSection title="Información principal">
              <FormField id="edit-client-name" label="Nombre completo" className="sm:col-span-2">
                <Input
                  id="edit-client-name"
                  autoFocus
                  required
                  autoComplete="name"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </FormField>
              <FormField id="edit-client-phone" label="Teléfono">
                <Input
                  id="edit-client-phone"
                  type="tel"
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
            {duplicates.length > 0 && (
              <label className="rounded-lg border border-warning/35 bg-warning/10 p-3 text-sm">
                <input
                  type="checkbox"
                  checked={duplicatesAcknowledged}
                  onChange={(event) => setDuplicatesAcknowledged(event.target.checked)}
                  className="mr-2"
                />
                Revisé {duplicates.length} posible(s) coincidencia(s) y confirmo el cambio.
              </label>
            )}
            <FormErrorSummary>{error}</FormErrorSummary>
            <FormActions>
              <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                Cancelar
              </Button>
              <Button type="submit" loading={updateClient.isPending}>
                <Save className="h-4 w-4" /> Guardar cambios
              </Button>
            </FormActions>
          </form>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

function Contact({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Phone;
  label: string;
  value: string;
}) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 h-4 w-4 text-primary" />
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="truncate text-sm font-medium" title={value}>
          {value}
        </dd>
      </div>
    </div>
  );
}

function Activity({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof Briefcase;
  label: string;
  value: number;
  href: string;
}) {
  return (
    <Link to={href as never}>
      <Card className="flex h-full items-center gap-4 p-5 transition hover:border-primary/40">
        <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <p className="text-2xl font-bold">{value}</p>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
      </Card>
    </Link>
  );
}
