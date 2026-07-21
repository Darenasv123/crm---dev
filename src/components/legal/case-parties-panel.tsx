import { useState } from "react";
import { Loader2, Plus, Trash2, Users, X } from "lucide-react";
import { Card, StatusBadge } from "@/components/app-layout";
import {
  useCaseParties,
  useCreateCaseParty,
  useDeleteCaseParty,
} from "@/hooks/legal/use-case-management";
import { useAuth } from "@/hooks/use-auth";

const PARTY_ROLES = [
  "Demandante",
  "Demandado",
  "Denunciante",
  "Denunciado",
  "Agraviado",
  "Investigado",
  "Menor alimentista",
  "Representante legal",
  "Testigo",
  "Abogado",
  "Tercero",
  "Otro",
];

export function CasePartiesPanel({ caseId, clientId }: { caseId: string; clientId: string }) {
  const { data: parties = [], isLoading, error } = useCaseParties(caseId);
  const createParty = useCreateCaseParty();
  const deleteParty = useDeleteCaseParty();
  const { profile } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    full_name: "",
    role: "Demandante",
    relationship: "",
    document_type: "DNI",
    document_number: "",
    phone: "",
    email: "",
    is_minor: false,
  });

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    try {
      await createParty.mutateAsync({
        case_id: caseId,
        client_id: clientId,
        full_name: form.full_name.trim(),
        role: form.role.trim(),
        relationship: form.relationship.trim() || null,
        document_type: form.document_type.trim() || null,
        document_number: form.document_number.replace(/\s/g, "") || null,
        phone: form.phone.replace(/\s/g, "") || null,
        email: form.email.trim() || null,
        is_minor: form.is_minor,
      });
      setForm({
        full_name: "",
        role: "Demandante",
        relationship: "",
        document_type: "DNI",
        document_number: "",
        phone: "",
        email: "",
        is_minor: false,
      });
      setShowForm(false);
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "No se pudo registrar la persona.");
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Users className="h-4 w-4 text-primary" /> Partes involucradas
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Personas y roles vinculados a este expediente.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((value) => !value)}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground"
        >
          {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {showForm ? "Cerrar" : "Agregar persona"}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mt-4 rounded-lg border border-border bg-muted/20 p-4"
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Input
              label="Nombre completo"
              value={form.full_name}
              onChange={(value) => setForm((current) => ({ ...current, full_name: value }))}
              required
            />
            <div>
              <label className="text-[10px] font-semibold uppercase text-muted-foreground">
                Rol
              </label>
              <input
                list="party-roles"
                value={form.role}
                onChange={(event) =>
                  setForm((current) => ({ ...current, role: event.target.value }))
                }
                className="mt-1.5 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none"
                required
              />
              <datalist id="party-roles">
                {PARTY_ROLES.map((role) => (
                  <option key={role} value={role} />
                ))}
              </datalist>
            </div>
            <Input
              label="Vínculo o parentesco"
              value={form.relationship}
              onChange={(value) => setForm((current) => ({ ...current, relationship: value }))}
            />
            <Input
              label="Documento"
              value={form.document_number}
              onChange={(value) => setForm((current) => ({ ...current, document_number: value }))}
            />
            <Input
              label="Teléfono"
              value={form.phone}
              onChange={(value) => setForm((current) => ({ ...current, phone: value }))}
            />
            <Input
              label="Correo"
              value={form.email}
              onChange={(value) => setForm((current) => ({ ...current, email: value }))}
              type="email"
            />
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.is_minor}
              onChange={(event) =>
                setForm((current) => ({ ...current, is_minor: event.target.checked }))
              }
            />
            Es menor de edad
          </label>
          {formError && (
            <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {formError}
            </p>
          )}
          <button
            type="submit"
            disabled={createParty.isPending}
            className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-60"
          >
            {createParty.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Guardar persona
          </button>
        </form>
      )}

      {isLoading ? (
        <div className="grid place-items-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : error ? (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
          El módulo de partes todavía no está habilitado en la base de datos.
        </p>
      ) : parties.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No hay personas registradas en este expediente.
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {parties.map((party) => (
            <article key={party.id} className="rounded-lg border border-border p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold">{party.full_name}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {party.relationship || "Sin vínculo indicado"}
                  </p>
                </div>
                <StatusBadge tone={party.is_minor ? "warning" : "navy"}>{party.role}</StatusBadge>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <Detail label="Documento" value={party.document_number || "—"} />
                <Detail label="Teléfono" value={party.phone || "—"} />
              </div>
              {profile?.role === "Administrador" && (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`¿Eliminar a ${party.full_name} del expediente?`))
                      deleteParty.mutate({ id: party.id, caseId });
                  }}
                  className="mt-3 grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-red-50 hover:text-red-600"
                  title="Eliminar persona"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </Card>
  );
}

function Input({
  label,
  value,
  onChange,
  required,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
}) {
  return (
    <div>
      <label className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        className="mt-1.5 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none"
      />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate font-medium">{value}</div>
    </div>
  );
}
