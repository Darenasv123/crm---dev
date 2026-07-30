import { useId, useState } from "react";
import { CalendarDays, FileText, Loader2, Plus, Sparkles, X } from "lucide-react";
import { Card, StatusBadge } from "@/components/app-layout";
import { useCaseEvents, useCreateCaseEvent } from "@/hooks/legal/use-case-management";
import { getPeruTodayISO } from "@/lib/peru-time";
import type { Database } from "@/lib/database.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

type DocumentRow = Database["public"]["Tables"]["documents"]["Row"];

export function CaseTimelinePanel({
  caseId,
  documents,
}: {
  caseId: string;
  documents: DocumentRow[];
}) {
  const { data: events = [], isLoading, error } = useCaseEvents([caseId]);
  const createEvent = useCreateCaseEvent();
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    event_type: "Actuación",
    title: "",
    description: "",
    event_date: getPeruTodayISO(),
    document_id: "",
  });

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    try {
      await createEvent.mutateAsync({
        case_id: caseId,
        document_id: form.document_id || null,
        event_type: form.event_type.trim(),
        title: form.title.trim(),
        description: form.description.trim() || null,
        event_date: form.event_date,
        verification_status: "approved",
        created_by_ai: false,
      });
      setForm({
        event_type: "Actuación",
        title: "",
        description: "",
        event_date: getPeruTodayISO(),
        document_id: "",
      });
      setShowForm(false);
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "No se pudo registrar la actuación.");
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <CalendarDays className="h-4 w-4 text-primary" /> Línea de tiempo procesal
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Actuaciones ordenadas por fecha y vinculadas con su fuente.
          </p>
        </div>
        <Button type="button" onClick={() => setShowForm((value) => !value)} size="sm">
          {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {showForm ? "Cerrar" : "Nueva actuación"}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mt-4 space-y-3 rounded-lg border border-border bg-muted/20 p-4"
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field
              label="Tipo"
              value={form.event_type}
              onChange={(value) => setForm((current) => ({ ...current, event_type: value }))}
              required
            />
            <Field
              label="Fecha"
              value={form.event_date}
              onChange={(value) => setForm((current) => ({ ...current, event_date: value }))}
              type="date"
              required
            />
          </div>
          <Field
            label="Título"
            value={form.title}
            onChange={(value) => setForm((current) => ({ ...current, title: value }))}
            required
          />
          <div>
            <label
              htmlFor="timeline-document"
              className="text-[10px] font-semibold uppercase text-muted-foreground"
            >
              Documento fuente
            </label>
            <NativeSelect
              id="timeline-document"
              value={form.document_id}
              onChange={(event) =>
                setForm((current) => ({ ...current, document_id: event.target.value }))
              }
              className="mt-1.5"
            >
              <option value="">Sin documento vinculado</option>
              {documents.map((document) => (
                <option key={document.id} value={document.id}>
                  {document.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Textarea
            value={form.description}
            onChange={(event) =>
              setForm((current) => ({ ...current, description: event.target.value }))
            }
            placeholder="Descripción de la actuación"
          />
          {formError && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {formError}
            </p>
          )}
          <Button type="submit" size="sm" loading={createEvent.isPending}>
            Guardar actuación
          </Button>
        </form>
      )}

      {isLoading ? (
        <div className="grid place-items-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : error ? (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
          La línea de tiempo todavía no está habilitada en la base de datos.
        </p>
      ) : events.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No hay actuaciones registradas.
        </p>
      ) : (
        <ol className="mt-5 space-y-0">
          {events.map((event, index) => (
            <li key={event.id} className="relative grid grid-cols-[24px_1fr] gap-3 pb-5 last:pb-0">
              {index < events.length - 1 && (
                <span className="absolute bottom-0 left-[11px] top-5 w-px bg-border" />
              )}
              <span
                className={`relative z-10 mt-1 h-6 w-6 rounded-full border-4 border-card ${event.verification_status === "pending" ? "bg-amber-400" : "bg-primary"}`}
              />
              <article className="min-w-0 rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-[10px] font-semibold uppercase text-muted-foreground">
                      {new Date(`${event.event_date}T00:00:00-05:00`).toLocaleDateString("es-PE")}
                    </div>
                    <h3 className="mt-1 text-sm font-semibold">{event.title}</h3>
                  </div>
                  <div className="flex gap-2">
                    <StatusBadge tone="navy">{event.event_type}</StatusBadge>
                    {event.created_by_ai && (
                      <StatusBadge tone="warning">
                        <Sparkles className="h-2.5 w-2.5" /> Propuesto
                      </StatusBadge>
                    )}
                  </div>
                </div>
                {event.description && (
                  <p className="mt-2 text-sm text-foreground/80">{event.description}</p>
                )}
                {event.documents && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <FileText className="h-3.5 w-3.5" />
                    {event.documents.name}
                    {event.source_page ? ` · pág. ${event.source_page}` : ""}
                  </div>
                )}
              </article>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function Field({
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
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-[10px] font-semibold uppercase text-muted-foreground">
        {label}
      </label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        className="mt-1.5"
      />
    </div>
  );
}
