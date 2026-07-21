import {
  Download,
  Eye,
  FileText,
  History,
  Landmark,
  Plus,
  Scale,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Card, StatusBadge } from "@/components/app-layout";
import type { Database } from "@/lib/database.types";
import type { ClientReportWithRelations } from "@/hooks/use-reports";
import type { DocumentWithClient } from "@/hooks/use-documents";
import { formatPeruDate } from "@/lib/peru-time";

type PaymentRow = Database["public"]["Tables"]["payments"]["Row"];
type CaseRow = Database["public"]["Tables"]["cases"]["Row"];

export function CaseDocumentsPanel({
  documents,
  canDelete,
  onUpload,
  onOpen,
  onDownload,
  onDelete,
}: {
  documents: DocumentWithClient[];
  canDelete: boolean;
  onUpload: () => void;
  onOpen: (document: DocumentWithClient) => void;
  onDownload: (document: DocumentWithClient) => void;
  onDelete: (id: string, storagePath: string) => void;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <FileText className="h-4 w-4 text-primary" /> Documentos del expediente
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Archivos, fuentes y estado de análisis documental.
          </p>
        </div>
        <button
          type="button"
          onClick={onUpload}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground"
        >
          <Plus className="h-3.5 w-3.5" /> Subir documento
        </button>
      </div>
      {documents.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No hay documentos asociados a este expediente.
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {documents.map((document) => (
            <article key={document.id} className="rounded-lg border border-border p-4">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-red-50 text-red-600">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold">
                    {document.display_name || document.name}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {document.document_type || document.type} · {document.size}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <StatusBadge tone="navy">
                  {document.source_type === "google_drive" ? "Google Drive" : "Carga manual"}
                </StatusBadge>
                <StatusBadge
                  tone={document.processing_status === "analysis_completed" ? "success" : "default"}
                >
                  {document.processing_status === "analysis_completed"
                    ? "Analizado"
                    : "Sin analizar"}
                </StatusBadge>
              </div>
              <div className="mt-3 flex gap-1 border-t border-border pt-3">
                <button
                  type="button"
                  onClick={() => onOpen(document)}
                  title="Abrir documento"
                  className="grid h-8 w-8 place-items-center rounded-lg hover:bg-muted"
                >
                  <Eye className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onDownload(document)}
                  title="Descargar documento"
                  className="grid h-8 w-8 place-items-center rounded-lg hover:bg-muted"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => onDelete(document.id, document.storage_path)}
                    title="Eliminar documento"
                    className="grid h-8 w-8 place-items-center rounded-lg hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </Card>
  );
}

export function CasePaymentsPanel({ payments }: { payments: PaymentRow[] }) {
  const currency = new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN" });
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Landmark className="h-4 w-4 text-primary" /> Pagos vinculados al expediente
      </h2>
      {payments.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No hay pagos vinculados directamente a este expediente.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[620px] w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <th className="px-3 py-2">Servicio</th>
                <th className="px-3 py-2">Honorarios</th>
                <th className="px-3 py-2">Pagado</th>
                <th className="px-3 py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-3 font-medium">{payment.service}</td>
                  <td className="px-3 py-3">{currency.format(Number(payment.fees))}</td>
                  <td className="px-3 py-3">{currency.format(Number(payment.paid))}</td>
                  <td className="px-3 py-3">
                    <StatusBadge
                      tone={
                        payment.status === "Pagado"
                          ? "success"
                          : payment.status === "Vencido"
                            ? "danger"
                            : "warning"
                      }
                    >
                      {payment.status}
                    </StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function CaseAnalysisPanel({ item }: { item: CaseRow }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Scale className="h-4 w-4 text-primary" /> Análisis jurídico
        </h2>
        <dl className="mt-4 space-y-3">
          <AnalysisRow
            label="Resumen actual"
            value={item.current_summary || item.notes || "Sin resumen registrado."}
          />
          <AnalysisRow
            label="Situación actual"
            value={item.current_status_description || item.status}
          />
          <AnalysisRow
            label="Próxima acción"
            value={item.next_action || "Sin próxima acción definida."}
          />
          <AnalysisRow label="Última actuación" value={formatPeruDate(item.last_action_date)} />
        </dl>
      </Card>
      <Card className="p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-amber-600" /> Información asistida
        </h2>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          No se ha ejecutado análisis automático real sobre este expediente. Las futuras propuestas
          deberán mostrar su documento fuente y ser confirmadas por una persona antes de
          incorporarse.
        </p>
        <StatusBadge tone="warning">Revisión humana obligatoria</StatusBadge>
      </Card>
    </div>
  );
}

export function CaseHistoryPanel({
  item,
  reports,
}: {
  item: CaseRow;
  reports: ClientReportWithRelations[];
}) {
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <History className="h-4 w-4 text-primary" /> Historial del expediente
      </h2>
      <div className="mt-4 space-y-3">
        <HistoryItem
          date={item.created_at}
          title="Expediente registrado en el CRM"
          detail={item.internal_code || item.expediente}
        />
        {reports.map((report) => (
          <HistoryItem
            key={report.id}
            date={report.created_at}
            title={report.title}
            detail={`${report.category} · ${report.profiles?.full_name || "Usuario del estudio"}`}
          />
        ))}
      </div>
    </Card>
  );
}

function AnalysisRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <dt className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-sm">{value}</dd>
    </div>
  );
}

function HistoryItem({ date, title, detail }: { date: string; title: string; detail: string }) {
  return (
    <div className="flex gap-3 rounded-lg border border-border p-3">
      <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />
      <div className="min-w-0">
        <div className="text-[10px] uppercase text-muted-foreground">
          {formatPeruDate(date, { day: "2-digit", month: "short", year: "numeric" })}
        </div>
        <div className="mt-0.5 text-sm font-semibold">{title}</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}
