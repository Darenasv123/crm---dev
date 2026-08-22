import { useEffect, useId, useMemo, useState } from "react";
import { Send, Loader2, Copy, Check, Search, X, FileText, Briefcase } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/app-layout";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { Database } from "@/lib/database.types";
import {
  buildClientReportMessage,
  casesForClient,
  isCaseOwnedByClient,
  searchClients,
  type ClientReportData,
} from "@/lib/client-reports";
import type { ReportMateria } from "@/hooks/use-reports";

type ClientRow = Database["public"]["Tables"]["clients"]["Row"];
type CaseWithMateria = Database["public"]["Tables"]["cases"]["Row"] & {
  materia: string | null;
};

export interface ClientReportFormData {
  client_id: string;
  case_id: string;
  materia: ReportMateria | "";
  status_date: string;
  current_status: string;
  informative_message: string;
  reminder_days: number;
}

const EMPTY_FORM = (today: string): ClientReportFormData => ({
  client_id: "",
  case_id: "",
  materia: "",
  status_date: today,
  current_status: "",
  informative_message: "",
  reminder_days: 25,
});

interface ClientReportFormProps {
  clients: ClientRow[];
  cases: CaseWithMateria[];
  clientsLoading?: boolean;
  casesLoading?: boolean;
  onSubmit: (data: ClientReportFormData, finalText: string) => Promise<void>;
  saving?: boolean;
  error?: string | null;
}

export function ClientReportForm({
  clients,
  cases,
  clientsLoading = false,
  casesLoading = false,
  onSubmit,
  saving = false,
  error = null,
}: ClientReportFormProps) {
  const today = new Date().toISOString().split("T")[0];

  const [formData, setFormData] = useState<ClientReportFormData>(() => EMPTY_FORM(today));
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [caseMismatchError, setCaseMismatchError] = useState<string | null>(null);

  const selectedClient = clients.find((c) => c.id === formData.client_id) ?? null;
  const clientCases = useMemo(
    () => casesForClient(cases, formData.client_id),
    [cases, formData.client_id],
  );
  const selectedCase = clientCases.find((c) => c.id === formData.case_id);

  function selectClient(client: ClientRow) {
    setFormData((prev) => ({
      ...prev,
      client_id: client.id,
      case_id: "",
      materia: "",
    }));
    setCaseMismatchError(null);
  }

  function changeClient() {
    setFormData((prev) => ({ ...prev, client_id: "", case_id: "", materia: "" }));
    setCaseMismatchError(null);
  }

  // Autocompletar materia desde expediente
  useEffect(() => {
    if (selectedCase?.materia && !formData.materia) {
      setFormData((prev) => ({
        ...prev,
        materia: selectedCase.materia as ReportMateria,
      }));
    }
  }, [selectedCase, formData.materia]);

  // Construir preview
  const reportPreview = useMemo(() => {
    if (
      !selectedClient ||
      !formData.materia ||
      !formData.status_date ||
      !formData.current_status.trim() ||
      !formData.informative_message.trim()
    ) {
      return null;
    }

    const data: ClientReportData = {
      clientName: selectedClient.name,
      materia: formData.materia as "Familia" | "Penal",
      statusDate: formData.status_date,
      currentStatus: formData.current_status,
      informativeMessage: formData.informative_message,
      reminderDays: formData.reminder_days,
    };

    return buildClientReportMessage(data);
  }, [selectedClient, formData]);

  const canSubmit = Boolean(
    selectedClient &&
    formData.materia &&
    formData.status_date &&
    formData.current_status.trim() &&
    formData.informative_message.trim() &&
    !saving,
  );

  async function handleCopyReport() {
    if (!reportPreview) return;

    try {
      await navigator.clipboard.writeText(reportPreview);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Error al copiar:", err);
      alert("No se pudo copiar el reporte. Verifica los permisos del navegador.");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !reportPreview) return;

    if (!isCaseOwnedByClient(clientCases, formData.case_id, formData.client_id)) {
      setCaseMismatchError(
        "El expediente seleccionado no pertenece a este cliente. Selecciónalo de nuevo.",
      );
      setFormData((prev) => ({ ...prev, case_id: "" }));
      return;
    }
    setCaseMismatchError(null);

    try {
      await onSubmit(formData, reportPreview);
      setFormData(EMPTY_FORM(today));
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } catch {
      // El error real de la mutation se muestra vía la prop `error` del padre.
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
          <Send className="h-4 w-4" />
        </div>
        <h3 className="text-sm font-semibold">Crear reporte</h3>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Cliente — única fuente de verdad de selección */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Cliente *
          </label>
          {selectedClient ? (
            <SelectedClientSummary
              client={selectedClient}
              caseCount={clientCases.length}
              onChange={changeClient}
            />
          ) : (
            <ClientCombobox clients={clients} loading={clientsLoading} onSelect={selectClient} />
          )}
        </div>

        {/* Expediente — acotado estrictamente al cliente seleccionado */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Expediente (opcional)
          </label>
          <NativeSelect
            value={formData.case_id}
            onChange={(e) => {
              setFormData((prev) => ({ ...prev, case_id: e.target.value }));
              setCaseMismatchError(null);
            }}
            disabled={!formData.client_id || casesLoading}
            aria-label="Seleccionar expediente"
            className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/15 disabled:opacity-50"
          >
            <option value="">Sin expediente específico</option>
            {clientCases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.expediente} {c.materia ? `— ${c.materia}` : ""}
              </option>
            ))}
          </NativeSelect>
          {formData.client_id && !casesLoading && clientCases.length === 0 && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Este cliente no tiene expedientes registrados.
            </p>
          )}
          {caseMismatchError && <p className="mt-1.5 text-xs text-red-600">{caseMismatchError}</p>}
        </div>

        {/* Materia */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Materia *
          </label>
          <NativeSelect
            value={formData.materia}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, materia: e.target.value as ReportMateria | "" }))
            }
            required
            className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/15"
          >
            <option value="">Selecciona materia</option>
            <option value="Familia">Familia</option>
            <option value="Penal">Penal</option>
          </NativeSelect>
        </div>

        {/* Fecha del estado y Estado actual */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Fecha del estado *
            </label>
            <Input
              type="date"
              value={formData.status_date}
              onChange={(e) => setFormData((prev) => ({ ...prev, status_date: e.target.value }))}
              required
              className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/15"
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Recordatorio (días) *
            </label>
            <Input
              type="number"
              min="1"
              value={formData.reminder_days}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, reminder_days: Number(e.target.value) }))
              }
              required
              className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/15"
            />
          </div>
        </div>

        {/* Estado actual del proceso */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Estado actual del proceso *
          </label>
          <Textarea
            value={formData.current_status}
            onChange={(e) => setFormData((prev) => ({ ...prev, current_status: e.target.value }))}
            required
            rows={2}
            placeholder="Ejemplo: Expediente en trámite de notificación"
            className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/15 resize-y"
          />
        </div>

        {/* Mensaje informativo */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Mensaje informativo *
          </label>
          <Textarea
            value={formData.informative_message}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, informative_message: e.target.value }))
            }
            required
            rows={6}
            placeholder="Escribe el mensaje detallado para el cliente. Puedes usar saltos de línea, asteriscos (*negrita*), y formatear libremente..."
            className="mt-1.5 w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/15 resize-y"
          />
        </div>

        {/* Vista previa */}
        {reportPreview && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-primary mb-2">
              Vista previa del mensaje
            </div>
            <div className="text-sm whitespace-pre-wrap text-foreground/90 max-h-64 overflow-y-auto">
              {reportPreview}
            </div>
          </div>
        )}

        {/* Errores */}
        {error && (
          <p
            role="alert"
            className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2"
          >
            {error}
          </p>
        )}

        {/* Confirmación de guardado */}
        {saved && (
          <p
            role="status"
            className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2"
          >
            <Check className="h-4 w-4" />
            Reporte guardado correctamente.
          </p>
        )}

        {/* Botones de acción */}
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {saving ? "Guardando..." : "Guardar reporte"}
          </button>

          <button
            type="button"
            onClick={handleCopyReport}
            disabled={!reportPreview}
            className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg border border-border bg-card text-sm font-semibold hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {copied ? (
              <>
                <Check className="h-4 w-4 text-green-600" />
                Copiado
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" />
                Copiar
              </>
            )}
          </button>
        </div>
      </form>
    </Card>
  );
}

function SelectedClientSummary({
  client,
  caseCount,
  onChange,
}: {
  client: ClientRow;
  caseCount: number;
  onChange: () => void;
}) {
  return (
    <div className="mt-1.5 flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold truncate">{client.name}</div>
        <div className="text-xs text-muted-foreground truncate">
          {client.phone || "Sin teléfono"} · {client.email || "Sin correo"} · {caseCount}{" "}
          {caseCount === 1 ? "expediente" : "expedientes"}
        </div>
        <div className="mt-2 flex flex-wrap gap-3">
          <Link
            to={"/clientes/$id/documentos" as never}
            params={{ id: client.id } as never}
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
          >
            <FileText className="h-3 w-3" />
            Abrir documentos
          </Link>
          <Link
            to={"/clientes/$id/expedientes" as never}
            params={{ id: client.id } as never}
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
          >
            <Briefcase className="h-3 w-3" />
            Ver expedientes
          </Link>
        </div>
      </div>
      <button
        type="button"
        onClick={onChange}
        className="inline-flex shrink-0 items-center gap-1 h-8 rounded-lg border border-border bg-card px-2.5 text-xs font-semibold hover:bg-muted/50"
      >
        <X className="h-3 w-3" />
        Cambiar
      </button>
    </div>
  );
}

function ClientCombobox({
  clients,
  loading,
  onSelect,
}: {
  clients: ClientRow[];
  loading: boolean;
  onSelect: (client: ClientRow) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputId = useId();
  const listboxId = useId();

  const results = useMemo(() => searchClients(clients, query), [clients, query]);

  function handleSelect(client: ClientRow) {
    onSelect(client);
    setQuery("");
    setOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (activeIndex >= 0 && results[activeIndex]) {
        e.preventDefault();
        handleSelect(results[activeIndex]);
      }
    } else if (e.key === "Escape") {
      setQuery("");
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  const activeOptionId =
    activeIndex >= 0 && results[activeIndex]
      ? `${listboxId}-opt-${results[activeIndex].id}`
      : undefined;

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          id={inputId}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeOptionId}
          aria-label="Buscar cliente por nombre, teléfono o correo"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(-1);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={handleKeyDown}
          placeholder="Buscar por nombre, teléfono o correo"
          className="mt-1.5 pl-9"
        />
      </div>
      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Resultados de clientes"
          className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-lg"
        >
          {loading ? (
            <li className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Cargando clientes...
            </li>
          ) : results.length === 0 ? (
            <li className="px-3 py-3 text-sm text-muted-foreground">No se encontraron clientes.</li>
          ) : (
            results.map((client, index) => (
              <li
                key={client.id}
                id={`${listboxId}-opt-${client.id}`}
                role="option"
                aria-selected={index === activeIndex}
              >
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelect(client)}
                  className={[
                    "flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left",
                    index === activeIndex ? "bg-primary/10" : "hover:bg-muted/50",
                  ].join(" ")}
                >
                  <span className="text-sm font-semibold truncate">{client.name}</span>
                  <span className="text-xs text-muted-foreground truncate">
                    {client.phone || client.email || "Sin contacto registrado"}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
