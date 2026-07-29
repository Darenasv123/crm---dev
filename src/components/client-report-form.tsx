import { useState, useEffect, useMemo } from "react";
import { Send, Loader2, Copy, MessageCircle, Check } from "lucide-react";
import { Card } from "@/components/app-layout";
import type { Database } from "@/lib/database.types";
import {
  buildClientReportMessage,
  buildWhatsAppUrl,
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

interface ClientReportFormProps {
  clients: ClientRow[];
  cases: CaseWithMateria[];
  onSubmit: (data: ClientReportFormData, finalText: string) => Promise<void>;
  saving?: boolean;
  error?: string | null;
}

export function ClientReportForm({
  clients,
  cases,
  onSubmit,
  saving = false,
  error = null,
}: ClientReportFormProps) {
  const today = new Date().toISOString().split("T")[0];

  const [formData, setFormData] = useState<ClientReportFormData>({
    client_id: "",
    case_id: "",
    materia: "",
    status_date: today,
    current_status: "",
    informative_message: "",
    reminder_days: 25,
  });

  const [clientSearch, setClientSearch] = useState("");
  const [copied, setCopied] = useState(false);
  const [whatsappError, setWhatsappError] = useState<string | null>(null);

  const filteredClients = useMemo(() => {
    const term = clientSearch.trim().toLowerCase();
    if (!term) return clients;
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        (c.dni ?? "").includes(term) ||
        (c.phone ?? "").includes(term),
    );
  }, [clients, clientSearch]);

  const selectedClient = clients.find((c) => c.id === formData.client_id);
  const clientCases = cases.filter((c) => c.client_id === formData.client_id);
  const selectedCase = clientCases.find((c) => c.id === formData.case_id);

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

  const canSubmit =
    selectedClient &&
    formData.materia &&
    formData.status_date &&
    formData.current_status.trim() &&
    formData.informative_message.trim() &&
    !saving;

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

  function handleOpenWhatsApp() {
    setWhatsappError(null);

    if (!selectedClient?.phone) {
      setWhatsappError("El cliente no tiene un teléfono registrado.");
      return;
    }

    if (!reportPreview) {
      setWhatsappError("Completa todos los campos obligatorios antes de enviar.");
      return;
    }

    const url = buildWhatsAppUrl(selectedClient.phone, reportPreview);

    if (!url) {
      setWhatsappError("El teléfono del cliente no es válido.");
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !reportPreview) return;

    await onSubmit(formData, reportPreview);
  }

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
          <Send className="h-4 w-4" />
        </div>
        <h3 className="text-sm font-semibold">Crear reporte para el cliente</h3>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Cliente */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Cliente *
          </label>
          {clients.length > 10 ? (
            <>
              <input
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                placeholder="Buscar por nombre, DNI o teléfono..."
                className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/15"
              />
              <select
                value={formData.client_id}
                onChange={(e) => {
                  setFormData((prev) => ({
                    ...prev,
                    client_id: e.target.value,
                    case_id: "",
                    materia: "",
                  }));
                  setClientSearch("");
                }}
                required
                className="mt-2 w-full h-10 px-3 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/15"
              >
                <option value="">Selecciona un cliente</option>
                {filteredClients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name} {client.dni ? `(DNI: ${client.dni})` : ""}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <select
              value={formData.client_id}
              onChange={(e) => {
                setFormData((prev) => ({
                  ...prev,
                  client_id: e.target.value,
                  case_id: "",
                  materia: "",
                }));
              }}
              required
              className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/15"
            >
              <option value="">Selecciona un cliente</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name} {client.dni ? `(DNI: ${client.dni})` : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Expediente */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Expediente (opcional)
          </label>
          <select
            value={formData.case_id}
            onChange={(e) => {
              setFormData((prev) => ({ ...prev, case_id: e.target.value }));
            }}
            disabled={!formData.client_id}
            className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/15 disabled:opacity-50"
          >
            <option value="">Sin expediente específico</option>
            {clientCases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.expediente} {c.materia ? `— ${c.materia}` : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Materia */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Materia *
          </label>
          <select
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
          </select>
        </div>

        {/* Fecha del estado y Estado actual */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Fecha del estado *
            </label>
            <input
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
            <input
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
          <textarea
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
          <textarea
            value={formData.informative_message}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, informative_message: e.target.value }))
            }
            required
            rows={6}
            placeholder="Escribe el mensaje detallado para el cliente. Puedes usar saltos de línea, asteriscos de WhatsApp (*negrita*), y formatear libremente..."
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
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {whatsappError && (
          <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            {whatsappError}
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
            Guardar reporte
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
                Copiar reporte
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleOpenWhatsApp}
            disabled={!reportPreview || !selectedClient?.phone}
            className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg border border-green-600 bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            title={
              !selectedClient?.phone
                ? "El cliente no tiene un teléfono registrado"
                : "Abrir WhatsApp con el reporte"
            }
          >
            <MessageCircle className="h-4 w-4" />
            Enviar al cliente
          </button>
        </div>

        {!selectedClient?.phone && formData.client_id && (
          <p className="text-xs text-muted-foreground">
            ⚠️ El cliente no tiene un teléfono registrado. Actualiza sus datos para poder enviar por
            WhatsApp.
          </p>
        )}
      </form>
    </Card>
  );
}
