import { createFileRoute, Link } from "@tanstack/react-router";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { useAgendaEvents } from "@/hooks/use-agenda";
import { useCases } from "@/hooks/use-cases";
import { useClients } from "@/hooks/use-clients";
import { useDocuments } from "@/hooks/use-documents";
import {
  REPORT_CATEGORIES,
  reportCategoryLabel,
  useClientReports,
  useCreateClientReport,
  type ClientReportWithRelations,
  type ReportCategory,
} from "@/hooks/use-reports";
import {
  AlertTriangle,
  Briefcase,
  CalendarDays,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Loader2,
  Mail,
  MessageSquareText,
  Phone,
  Search,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { Database } from "@/lib/database.types";
import { formatPeruDate, formatPeruDateTime, formatPeruTime } from "@/lib/peru-time";
import { ClientReportForm, type ClientReportFormData } from "@/components/client-report-form";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

export const Route = createFileRoute("/_app/reportes/")({
  head: () => ({ meta: [{ title: "Reportes — CRM Jurídico" }] }),
  component: ReportsPage,
});

type CaseRow = Database["public"]["Tables"]["cases"]["Row"];
type ClientRow = Database["public"]["Tables"]["clients"]["Row"];

type ReportExportData = {
  clientName: string;
  phone: string | null;
  email: string | null;
  category: string;
  title: string;
  body: string;
  createdAt: string;
  caseExpediente: string;
  caseProcess: string | null;
  caseStatus: string | null;
};

const caseStatusTone: Record<
  CaseRow["status"],
  "default" | "info" | "warning" | "navy" | "gold" | "danger" | "success"
> = {
  Consulta: "default",
  Documentación: "info",
  "Demanda presentada": "gold",
  "En proceso": "navy",
  Audiencia: "warning",
  Sentencia: "success",
  Archivado: "default",
};

const categoryTone: Record<
  ReportCategory,
  "default" | "info" | "warning" | "danger" | "success" | "gold" | "navy"
> = {
  Reporte: "navy",
  Noticia: "info",
  Seguimiento: "success",
  Alerta: "danger",
  Estado: "gold",
  Observacion: "warning",
};

function formatDate(date?: string | null) {
  if (!date) return "—";
  return formatPeruDate(date, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function sanitizeFileName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildPublishedReportData(
  client: ClientRow,
  cases: CaseRow[],
  report: ClientReportWithRelations,
): ReportExportData {
  const relatedCase = cases.find((item) => item.id === report.case_id) ?? null;
  return {
    clientName: client.name,
    phone: client.phone,
    email: client.email ?? "—",
    category: reportCategoryLabel(report.category as ReportCategory),
    title: report.title.trim(),
    body: report.body.trim(),
    createdAt: formatPeruDateTime(report.created_at, {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
    caseExpediente: relatedCase?.expediente ?? report.cases?.expediente ?? "General del cliente",
    caseProcess: relatedCase?.process_type ?? report.cases?.process_type ?? null,
    caseStatus: relatedCase?.status ?? report.cases?.status ?? "—",
  };
}

function reportFileName(data: ReportExportData, extension: "jpg" | "docx") {
  const client = sanitizeFileName(data.clientName) || "cliente";
  const title = sanitizeFileName(data.title) || "reporte";
  return `${client}-${title}.${extension}`;
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
) {
  const paragraphs = text.split(/\r?\n/);
  let cursorY = y;

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      cursorY += lineHeight;
      continue;
    }

    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > maxWidth && line) {
        ctx.fillText(line, x, cursorY);
        line = word;
        cursorY += lineHeight;
      } else {
        line = next;
      }
    }
    if (line) {
      ctx.fillText(line, x, cursorY);
      cursorY += lineHeight;
    }
    cursorY += lineHeight * 0.35;
  }

  return cursorY;
}

async function createReportJpg(data: ReportExportData) {
  const canvas = document.createElement("canvas");
  canvas.width = 1240;
  canvas.height = 1754;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo generar la imagen del reporte.");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0f172a";
  ctx.font = "700 44px Arial";
  ctx.fillText("REPORTE PARA CLIENTE", 96, 120);

  ctx.fillStyle = "#475569";
  ctx.font = "400 24px Arial";
  ctx.fillText("Estudio Jurídico Arenas", 96, 158);
  ctx.fillText(data.createdAt, 96, 192);

  ctx.strokeStyle = "#d8dee8";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(96, 232);
  ctx.lineTo(1144, 232);
  ctx.stroke();

  const fields: [string, string][] = [
    ["Cliente", data.clientName],
    ["Teléfono", data.phone ?? "—"],
    ["Correo", data.email ?? "—"],
    ["Expediente", data.caseExpediente],
    ["Estado del expediente", data.caseStatus ?? "—"],
    ["Tipo de reporte", data.category],
  ];

  let y = 292;
  ctx.font = "700 19px Arial";
  fields.forEach(([label, value], index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = col === 0 ? 96 : 620;
    const yy = y + row * 76;
    ctx.fillStyle = "#64748b";
    ctx.fillText(label.toUpperCase(), x, yy);
    ctx.fillStyle = "#0f172a";
    ctx.font = "500 25px Arial";
    drawWrappedText(ctx, value, x, yy + 32, 430, 30);
    ctx.font = "700 19px Arial";
  });

  y = 650;
  ctx.fillStyle = "#0f172a";
  ctx.font = "700 34px Arial";
  y = drawWrappedText(ctx, data.title, 96, y, 1048, 42) + 18;

  ctx.fillStyle = "#1f2937";
  ctx.font = "400 27px Arial";
  drawWrappedText(ctx, data.body, 96, y, 1048, 38);

  ctx.fillStyle = "#64748b";
  ctx.font = "400 18px Arial";
  ctx.fillText("Documento generado desde el CRM Jurídico.", 96, 1660);

  return canvas.toDataURL("image/jpeg", 0.94);
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.click();
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(value: number) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32(value: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function concatBytes(parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function makeZip(files: Array<{ path: string; content: string }>) {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.path);
    const content = encoder.encode(file.content);
    const checksum = crc32(content);
    const local = concatBytes([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(checksum),
      u32(content.length),
      u32(content.length),
      u16(name.length),
      u16(0),
      name,
      content,
    ]);
    locals.push(local);

    centrals.push(
      concatBytes([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(checksum),
        u32(content.length),
        u32(content.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    );
    offset += local.length;
  }

  const central = concatBytes(centrals);
  const local = concatBytes(locals);
  const end = concatBytes([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.length),
    u32(local.length),
    u16(0),
  ]);

  return new Blob([local, central, end], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

function docxParagraph(text: string, style?: "title" | "heading") {
  const size = style === "title" ? "36" : style === "heading" ? "26" : "22";
  const bold = style ? "<w:b/>" : "";
  return `<w:p><w:r><w:rPr>${bold}<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${escapeXml(
    text,
  )}</w:t></w:r></w:p>`;
}

function createReportDocx(data: ReportExportData) {
  const bodyParagraphs = data.body
    .split(/\r?\n/)
    .flatMap((line) => [docxParagraph(line || " "), docxParagraph("")])
    .join("");
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
${docxParagraph("REPORTE PARA CLIENTE", "title")}
${docxParagraph("Estudio Jurídico Arenas")}
${docxParagraph(data.createdAt)}
${docxParagraph("Datos del cliente", "heading")}
${docxParagraph(`Cliente: ${data.clientName}`)}
${docxParagraph(`Teléfono: ${data.phone ?? "—"}`)}
${docxParagraph(`Correo: ${data.email ?? "—"}`)}
${docxParagraph("Expediente relacionado", "heading")}
${docxParagraph(`Expediente: ${data.caseExpediente}`)}
${docxParagraph(`Materia: ${data.caseProcess ?? "—"}`)}
${docxParagraph(`Estado: ${data.caseStatus ?? "—"}`)}
${docxParagraph("Reporte", "heading")}
${docxParagraph(`Tipo: ${data.category}`)}
${docxParagraph(data.title, "heading")}
${bodyParagraphs}
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
</w:body></w:document>`;

  return makeZip([
    {
      path: "[Content_Types].xml",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    },
    {
      path: "_rels/.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    },
    { path: "word/document.xml", content: documentXml },
  ]);
}

function ReportsPage() {
  const { data: clients = [], isLoading: loadingClients } = useClients();
  const { data: cases = [], isLoading: loadingCases } = useCases();
  const { data: documents = [] } = useDocuments();
  const { data: events = [] } = useAgendaEvents();
  const { data: reports = [], isLoading: loadingReports } = useClientReports();
  const createReport = useCreateClientReport();

  const [search, setSearch] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [reportFilter, setReportFilter] = useState<ReportCategory | "Todos">("Todos");
  const [preview, setPreview] = useState<{ src: string; data: ReportExportData } | null>(null);

  const filteredClients = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return clients;
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        (c.phone ?? "").includes(term) ||
        (c.email ?? "").toLowerCase().includes(term),
    );
  }, [clients, search]);

  const selectedClient =
    clients.find((c) => c.id === selectedClientId) ?? filteredClients[0] ?? clients[0] ?? null;

  const clientCases = selectedClient ? cases.filter((c) => c.client_id === selectedClient.id) : [];
  const clientDocuments = selectedClient
    ? documents.filter((d) => d.client_id === selectedClient.id)
    : [];
  const clientEvents = selectedClient
    ? events.filter((e) => e.client_id === selectedClient.id)
    : [];
  const clientReports = selectedClient
    ? reports.filter((r) => r.client_id === selectedClient.id)
    : [];

  const activeCases = clientCases.filter((c) => c.status !== "Archivado");
  const selectedCase = clientCases.find((c) => c.id === selectedCaseId) ?? clientCases[0] ?? null;
  const loading = loadingClients || loadingCases || loadingReports;
  const [newReportError, setNewReportError] = useState<string | null>(null);

  async function handlePreviewPublishedReport(report: ClientReportWithRelations) {
    if (!selectedClient) return;
    const data = buildPublishedReportData(selectedClient, clientCases, report);
    const src = await createReportJpg(data);
    setPreview({ src, data });
  }

  function handleDownloadPublishedReport(report: ClientReportWithRelations) {
    if (!selectedClient) return;
    const data = buildPublishedReportData(selectedClient, clientCases, report);
    downloadBlob(createReportDocx(data), reportFileName(data, "docx"));
  }

  async function handleNewReportSubmit(data: ClientReportFormData, finalText: string) {
    setNewReportError(null);
    try {
      await createReport.mutateAsync({
        client_id: data.client_id,
        case_id: data.case_id || null,
        category: "Reporte",
        title: `Reporte de ${data.materia} - ${new Date(data.status_date).toLocaleDateString("es-PE")}`,
        body: data.informative_message,
        materia: data.materia || null,
        status_date: data.status_date,
        current_status: data.current_status,
        informative_message: data.informative_message,
        reminder_days: data.reminder_days,
        final_text: finalText,
      });
    } catch (err: unknown) {
      setNewReportError(err instanceof Error ? err.message : "No se pudo guardar el reporte.");
      throw err;
    }
  }

  return (
    <AppLayout
      title="Reportes"
      subtitle="Ficha integral del cliente, expedientes y bitácora compartida del estudio"
    >
      <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-4">
        <Card className="p-4 h-fit xl:sticky xl:top-24">
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre, teléfono o correo..."
              aria-label="Buscar cliente para reportes"
              className="pl-9"
            />
          </div>

          <div className="space-y-2 max-h-[calc(100vh-190px)] overflow-y-auto pr-1">
            {loadingClients ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : filteredClients.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No se encontraron clientes.
              </p>
            ) : (
              filteredClients.map((client) => (
                <button
                  key={client.id}
                  onClick={() => {
                    setSelectedClientId(client.id);
                    setSelectedCaseId("");
                  }}
                  className={[
                    "w-full flex items-center gap-3 rounded-lg border px-3 py-3 text-left transition",
                    selectedClient?.id === client.id
                      ? "border-primary/30 bg-primary/5"
                      : "border-border hover:bg-muted/40",
                  ].join(" ")}
                >
                  <ClientAvatar client={client} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate">{client.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {client.phone || client.email || "Sin contacto registrado"}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
              ))
            )}
          </div>
        </Card>

        {loading ? (
          <Card className="p-10">
            <div className="flex items-center justify-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              Cargando información del cliente...
            </div>
          </Card>
        ) : !selectedClient ? (
          <Card className="p-10 text-center text-sm text-muted-foreground">
            Aún no hay clientes registrados.
          </Card>
        ) : (
          <div className="space-y-4">
            <Card className="p-5">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                <div className="flex items-start gap-4 min-w-0">
                  <ClientAvatar client={selectedClient} size="lg" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-bold tracking-tight truncate">
                        {selectedClient.name}
                      </h2>
                      <StatusBadge
                        tone={
                          selectedClient.status === "Activo"
                            ? "success"
                            : selectedClient.status === "En espera"
                              ? "warning"
                              : "default"
                        }
                      >
                        {selectedClient.status}
                      </StatusBadge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {selectedClient.phone || selectedClient.email || "Sin contacto registrado"}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 lg:min-w-[320px]">
                  <MiniStat label="Expedientes" value={clientCases.length} />
                  <MiniStat label="Activos" value={activeCases.length} />
                  <MiniStat label="Reportes" value={clientReports.length} />
                </div>
              </div>
            </Card>

            <div className="grid grid-cols-1 2xl:grid-cols-[minmax(360px,0.92fr)_minmax(0,1.08fr)] gap-4">
              <div className="space-y-4 min-w-0">
                <ClientReportForm
                  clients={clients}
                  cases={cases}
                  onSubmit={handleNewReportSubmit}
                  saving={createReport.isPending}
                  error={newReportError}
                />
                <ReportsFeed
                  reports={clientReports}
                  filter={reportFilter}
                  onFilterChange={setReportFilter}
                  onPreview={handlePreviewPublishedReport}
                  onDownload={handleDownloadPublishedReport}
                />
              </div>

              <div className="space-y-4 min-w-0">
                <ClientInfo client={selectedClient} />
                <CasesBlock
                  cases={clientCases}
                  selectedCase={selectedCase}
                  selectedCaseId={selectedCase?.id ?? ""}
                  onSelectCase={setSelectedCaseId}
                />
                <DocumentsBlock documents={clientDocuments} />
                <AgendaBlock events={clientEvents} />
              </div>
            </div>
          </div>
        )}
      </div>
      {preview && (
        <ReportPreviewModal
          preview={preview}
          onClose={() => setPreview(null)}
          onDownloadJpg={() => downloadDataUrl(preview.src, reportFileName(preview.data, "jpg"))}
          onDownloadDocx={() =>
            downloadBlob(createReportDocx(preview.data), reportFileName(preview.data, "docx"))
          }
        />
      )}
    </AppLayout>
  );
}

function ClientAvatar({ client, size = "md" }: { client: ClientRow; size?: "md" | "lg" }) {
  return (
    <div
      className={`${size === "lg" ? "h-14 w-14 text-sm" : "h-10 w-10 text-xs"} grid place-items-center rounded-full font-bold text-white shrink-0`}
      style={{ background: client.color }}
    >
      {client.initials}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </div>
      <div className="text-sm font-bold mt-0.5 truncate">{value}</div>
    </div>
  );
}

function ReportPreviewModal({
  preview,
  onClose,
  onDownloadJpg,
  onDownloadDocx,
}: {
  preview: { src: string; data: ReportExportData };
  onClose: () => void;
  onDownloadJpg: () => void;
  onDownloadDocx: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <Card className="max-h-[92vh] w-full max-w-4xl overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-base font-semibold truncate">{preview.data.title}</h3>
            <p className="text-xs text-muted-foreground truncate">{preview.data.clientName}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onDownloadJpg}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-muted/50"
            >
              <Download className="h-3.5 w-3.5" />
              JPG
            </button>
            <button
              type="button"
              onClick={onDownloadDocx}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-muted/50"
            >
              <Download className="h-3.5 w-3.5" />
              DOCX
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-muted/50"
            >
              Cerrar
            </button>
          </div>
        </div>
        <div className="max-h-[calc(92vh-82px)] overflow-auto bg-muted/40 p-4">
          <img
            src={preview.src}
            alt="Vista previa del reporte"
            className="mx-auto w-full max-w-[760px] rounded border border-border bg-white shadow-sm"
          />
        </div>
      </Card>
    </div>
  );
}

function ClientInfo({ client }: { client: ClientRow }) {
  const rows = [
    { icon: Phone, label: "Teléfono", value: client.phone },
    { icon: Mail, label: "Correo", value: client.email },
    { icon: FileText, label: "Registro", value: formatDate(client.registered_at) },
  ].filter((row) => Boolean(row.value));

  return (
    <Card className="p-5">
      <SectionHeader icon={Phone} title="Información del cliente" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <div key={row.label} className="flex items-start gap-3 rounded-lg bg-muted/30 p-3">
              <Icon className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  {row.label}
                </div>
                <div className="text-sm font-medium truncate">{row.value}</div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function CasesBlock({
  cases,
  selectedCase,
  selectedCaseId,
  onSelectCase,
}: {
  cases: CaseRow[];
  selectedCase: CaseRow | null;
  selectedCaseId: string;
  onSelectCase: (id: string) => void;
}) {
  return (
    <Card className="p-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <SectionHeader icon={Briefcase} title="Expedientes del Cliente" />
        {cases.length > 1 && (
          <NativeSelect
            value={selectedCaseId}
            onChange={(e) => onSelectCase(e.target.value)}
            aria-label="Seleccionar expediente"
            className="h-9 min-w-[220px]"
          >
            {cases.map((item) => (
              <option key={item.id} value={item.id}>
                {item.expediente}
              </option>
            ))}
          </NativeSelect>
        )}
      </div>
      <div className="space-y-3 mt-4">
        {cases.length === 0 ? (
          <EmptyText text="Este cliente no tiene expedientes registrados." />
        ) : !selectedCase ? (
          <EmptyText text="Selecciona un expediente para ver el detalle." />
        ) : (
          <div className="rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono text-xs text-muted-foreground truncate">
                  {selectedCase.expediente}
                </div>
                <div className="text-sm font-semibold mt-1">{selectedCase.process_type}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusBadge
                  tone={
                    selectedCase.priority === "Alta"
                      ? "danger"
                      : selectedCase.priority === "Media"
                        ? "warning"
                        : "info"
                  }
                >
                  {selectedCase.priority === "Alta" && <AlertTriangle className="h-2.5 w-2.5" />}
                  {selectedCase.priority}
                </StatusBadge>
                <StatusBadge tone={caseStatusTone[selectedCase.status]}>
                  {selectedCase.status}
                </StatusBadge>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 text-sm">
              <InfoLine label="Materia" value={selectedCase.process_type || "—"} />
              <InfoLine label="Próxima audiencia" value={formatDate(selectedCase.next_hearing)} />
            </div>
            {selectedCase.current_summary && (
              <div className="mt-3 rounded-lg bg-muted/30 p-3 text-sm whitespace-pre-wrap">
                {selectedCase.current_summary}
              </div>
            )}
            <Link
              to={"/casos/$id" as never}
              params={{ id: selectedCase.id } as never}
              className="inline-flex mt-3 text-xs font-semibold text-primary hover:underline"
            >
              Abrir expediente completo
            </Link>
          </div>
        )}
      </div>
    </Card>
  );
}

function ReportsFeed({
  reports,
  filter,
  onFilterChange,
  onPreview,
  onDownload,
}: {
  reports: ClientReportWithRelations[];
  filter: ReportCategory | "Todos";
  onFilterChange: (filter: ReportCategory | "Todos") => void;
  onPreview: (report: ClientReportWithRelations) => void;
  onDownload: (report: ClientReportWithRelations) => void;
}) {
  const visibleReports =
    filter === "Todos" ? reports : reports.filter((report) => report.category === filter);

  return (
    <Card className="p-5">
      <div className="flex flex-col gap-3">
        <SectionHeader icon={MessageSquareText} title="Reportes" />
        <div className="flex flex-wrap gap-2">
          {(["Todos", ...REPORT_CATEGORIES] as Array<ReportCategory | "Todos">).map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => onFilterChange(category)}
              className={[
                "h-8 rounded-lg border px-3 text-xs font-semibold transition",
                filter === category
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted/50",
              ].join(" ")}
            >
              {category === "Todos" ? "Todos" : reportCategoryLabel(category)}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {visibleReports.length === 0 ? (
          <div className="sm:col-span-2">
            <EmptyText text="Todavía no hay reportes para este cliente." />
          </div>
        ) : (
          visibleReports.map((report) => (
            <article key={report.id} className="min-w-0 rounded-lg border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <StatusBadge tone={categoryTone[report.category as ReportCategory] || "default"}>
                  {reportCategoryLabel(report.category as ReportCategory)}
                </StatusBadge>
                <div className="shrink-0 text-right text-[10px] leading-4 text-muted-foreground">
                  <div>{formatDate(report.created_at)}</div>
                  <div>
                    {formatPeruTime(report.created_at, { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              </div>
              <div className="mt-2 min-w-0">
                <h3 className="truncate text-sm font-semibold" title={report.title}>
                  {report.title}
                </h3>
                <p className="mt-1 line-clamp-2 min-h-10 text-xs leading-5 text-foreground/75">
                  {report.body}
                </p>
              </div>
              <div className="mt-2 flex items-end justify-between gap-2 border-t border-border pt-2">
                <div className="min-w-0 text-[10px] leading-4 text-muted-foreground">
                  <div className="truncate">
                    {report.profiles?.full_name ?? "Usuario del estudio"}
                  </div>
                  <div className="truncate font-mono">
                    {report.cases?.expediente ?? "Reporte general"}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => onPreview(report)}
                    title="Visualizar reporte"
                    aria-label={`Visualizar reporte ${report.title}`}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDownload(report)}
                    title="Descargar reporte editable en DOCX"
                    aria-label={`Descargar reporte ${report.title} en DOCX`}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </article>
          ))
        )}
      </div>
    </Card>
  );
}

function DocumentsBlock({
  documents,
}: {
  documents: Database["public"]["Tables"]["documents"]["Row"][];
}) {
  return (
    <Card className="p-5">
      <SectionHeader icon={FileText} title="Documentos" />
      <div className="space-y-2 mt-4">
        {documents.length === 0 ? (
          <EmptyText text="Sin documentos asociados al cliente." />
        ) : (
          documents.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{doc.name}</div>
                <div className="text-xs text-muted-foreground">
                  {doc.type} · {doc.size} · {formatDate(doc.uploaded_at)}
                </div>
              </div>
              <StatusBadge tone="default">{doc.type}</StatusBadge>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function AgendaBlock({
  events,
}: {
  events: Database["public"]["Tables"]["agenda_events"]["Row"][];
}) {
  const sorted = [...events].sort((a, b) =>
    `${a.event_date} ${a.event_time}`.localeCompare(`${b.event_date} ${b.event_time}`),
  );

  return (
    <Card className="p-5">
      <SectionHeader icon={CalendarDays} title="Agenda relacionada" />
      <div className="space-y-2 mt-4">
        {sorted.length === 0 ? (
          <EmptyText text="Sin eventos de agenda asociados." />
        ) : (
          sorted.map((event) => (
            <div key={event.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold truncate">{event.title}</span>
                <StatusBadge tone={event.type === "Audiencia" ? "warning" : "info"}>
                  {event.type}
                </StatusBadge>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {formatDate(event.event_date)} · {event.event_time}
                {event.location ? ` · ${event.location}` : ""}
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function SectionHeader({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <h3 className="text-sm font-semibold">{title}</h3>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </div>
      <div className="font-medium mt-0.5">{value}</div>
    </div>
  );
}

function EmptyText({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground py-3">{text}</p>;
}
