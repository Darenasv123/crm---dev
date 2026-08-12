import { createFileRoute } from "@tanstack/react-router";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import {
  useDocuments,
  useUploadDocument,
  useDeleteDocument,
  useUpdateDocument,
} from "@/hooks/use-documents";
import type { DocumentWithClient } from "@/hooks/use-documents";
import { useClients } from "@/hooks/use-clients";
import { useCases } from "@/hooks/use-cases";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import {
  FileText,
  Folder,
  Search,
  Upload,
  Download,
  Eye,
  X,
  Loader2,
  Trash2,
  ExternalLink,
  Pencil,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { DOCUMENT_TYPES, normalizeDocumentType } from "@/lib/document-types";
import {
  downloadDocument,
  previewDocument,
  releaseDocumentPreview,
  type DocumentPreview,
} from "@/lib/document-actions";

export const Route = createFileRoute("/_app/documentos/")({
  validateSearch: (search: Record<string, unknown>) => ({
    documento: typeof search.documento === "string" ? search.documento : undefined,
  }),
  head: () => ({ meta: [{ title: "Documentos — CRM Jurídico" }] }),
  component: DocsPage,
});

const DOC_TYPES = DOCUMENT_TYPES;

/** Mapea tipo de documento a token CSS semántico */
const typeTokenColor: Record<string, string> = {
  Demanda: "var(--doc-demand)",
  Resolución: "var(--doc-resolution)",
  Sentencia: "var(--doc-sentence)",
  Poder: "var(--doc-power)",
  Contrato: "var(--doc-contract)",
  Otros: "var(--doc-other)",
};

/** Devuelve el color CSS para el tipo de documento dado */
function docTypeColor(type: string): string {
  return typeTokenColor[type] ?? typeTokenColor.Otros;
}

/** Icono por extensión de archivo */
function FileExtIcon({ name, className }: { name: string; className?: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const colorMap: Record<string, string> = {
    pdf: "text-red-500",
    doc: "text-blue-600",
    docx: "text-blue-600",
    xls: "text-green-600",
    xlsx: "text-green-600",
    jpg: "text-amber-500",
    jpeg: "text-amber-500",
    png: "text-amber-500",
    gif: "text-amber-500",
  };
  const colorClass = colorMap[ext] ?? "text-muted-foreground";
  return (
    <div
      className={`grid h-8 w-8 place-items-center rounded-lg bg-muted/50 shrink-0 ${className ?? ""}`}
      aria-hidden="true"
    >
      <FileText className={`h-4 w-4 ${colorClass}`} />
    </div>
  );
}

function displayDocumentType(type: string) {
  return normalizeDocumentType(type);
}

function DocsPage() {
  const { documento: requestedDocumentId } = Route.useSearch();
  const [activeType, setActiveType] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [processingFilter, setProcessingFilter] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingDocument, setEditingDocument] = useState<DocumentWithClient | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    type: "Otros",
    clientId: "",
    caseId: "",
    verificationStatus: "pending",
    documentDate: "",
  });
  const [editError, setEditError] = useState<string | null>(null);

  const { profile } = useAuth();
  const isAdmin = profile?.role === "Administrador";

  const { data: docs = [], isLoading } = useDocuments();
  const { data: clients = [] } = useClients();
  const { data: cases = [] } = useCases();
  const uploadDoc = useUploadDocument();
  const deleteDoc = useDeleteDocument();
  const updateDoc = useUpdateDocument();

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadForm, setUploadForm] = useState({ type: "Otros", clientId: "", caseId: "" });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [documentActionError, setDocumentActionError] = useState<string | null>(null);
  const [activePreview, setActivePreview] = useState<DocumentPreview | null>(null);
  const [activePreviewDocument, setActivePreviewDocument] = useState<DocumentWithClient | null>(
    null,
  );
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  const filtered = docs.filter((d) => {
    const matchesSearch =
      !search ||
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      (d.clients?.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (d.cases?.expediente ?? "").toLowerCase().includes(search.toLowerCase());
    const matchesProcessing = !processingFilter || d.processing_status === processingFilter;
    const matchesType =
      activeType === "all" || normalizeDocumentType(d.document_type || d.type) === activeType;
    return matchesSearch && matchesProcessing && matchesType;
  });

  const selected =
    filtered.find((d) => d.id === (selectedId ?? requestedDocumentId)) ?? filtered[0] ?? null;
  const uploadCases = uploadForm.clientId
    ? cases.filter((item) => item.client_id === uploadForm.clientId)
    : cases;

  // Count docs per type
  const countByType = DOC_TYPES.reduce<Record<string, number>>((acc, t) => {
    acc[t] = docs.filter((d) => normalizeDocumentType(d.document_type || d.type) === t).length;
    return acc;
  }, {});

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadFile) return;
    setUploadError(null);
    setUploading(true);
    try {
      await uploadDoc.mutateAsync({
        file: uploadFile,
        type: uploadForm.type,
        clientId: uploadForm.clientId || undefined,
        caseId: uploadForm.caseId || undefined,
      });
      setShowUpload(false);
      setUploadFile(null);
      setUploadForm({ type: "Otros", clientId: "", caseId: "" });
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : "Error al subir. Intenta de nuevo.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(doc: (typeof filtered)[0]) {
    setDocumentActionError(null);
    try {
      await downloadDocument(doc);
    } catch (cause) {
      setDocumentActionError(
        cause instanceof Error ? cause.message : "No se pudo descargar el documento.",
      );
    }
  }

  async function handlePreview(doc: (typeof filtered)[0]) {
    setDocumentActionError(null);
    setPreviewingId(doc.id);
    try {
      const preview = await previewDocument(doc);
      setActivePreviewDocument(doc);
      setActivePreview(preview);
    } catch (cause) {
      setDocumentActionError(
        cause instanceof Error ? cause.message : "No se pudo visualizar el documento.",
      );
    } finally {
      setPreviewingId(null);
    }
  }

  function closePreview() {
    setActivePreview(null);
    setActivePreviewDocument(null);
  }

  useEffect(
    () => () => {
      releaseDocumentPreview(activePreview);
    },
    [activePreview],
  );

  function openEdit(doc: DocumentWithClient) {
    setEditingDocument(doc);
    setEditError(null);
    setEditForm({
      name: doc.display_name || doc.name,
      type: normalizeDocumentType(doc.document_type || doc.type),
      clientId: doc.client_id || "",
      caseId: doc.case_id || "",
      verificationStatus: doc.verification_status || "pending",
      documentDate: doc.document_date || "",
    });
  }

  async function saveEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editingDocument) return;
    const relatedCase = editForm.caseId
      ? cases.find((item) => item.id === editForm.caseId)
      : undefined;
    if (relatedCase && editForm.clientId && relatedCase.client_id !== editForm.clientId) {
      setEditError("El expediente no corresponde al cliente seleccionado.");
      return;
    }
    if (!editForm.name.trim()) {
      setEditError("El nombre del documento es obligatorio.");
      return;
    }
    try {
      await updateDoc.mutateAsync({
        id: editingDocument.id,
        updates: {
          name: editForm.name.trim(),
          display_name: editForm.name.trim(),
          type: editForm.type,
          document_type: editForm.type,
          client_id: relatedCase?.client_id || editForm.clientId || null,
          case_id: editForm.caseId || null,
          verification_status: editForm.verificationStatus,
          document_date: editForm.documentDate || null,
          updated_at: new Date().toISOString(),
        },
      });
      setEditingDocument(null);
    } catch (cause) {
      setEditError(cause instanceof Error ? cause.message : "No se pudo editar el documento.");
    }
  }

  return (
    <AppLayout
      title="Documentos"
      subtitle="Explorador de archivos del estudio"
      actions={
        <button
          type="button"
          onClick={() => {
            setShowUpload(true);
            setUploadError(null);
          }}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 shadow-soft"
        >
          <Upload className="h-4 w-4" /> Subir archivo
        </button>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr_280px] gap-4">
        {/* Categories panel */}
        <Card className="p-3 h-fit">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
            Categorías
          </div>
          <div className="space-y-0.5">
            <button
              type="button"
              onClick={() => setActiveType("all")}
              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm transition ${activeType === "all" ? "bg-primary/10 text-primary font-semibold" : "hover:bg-muted/50"}`}
            >
              <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-left">Todos</span>
              <span className="text-[11px] text-muted-foreground">{docs.length}</span>
            </button>
            {DOC_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setActiveType(t)}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm transition ${activeType === t ? "bg-primary/10 text-primary font-semibold" : "hover:bg-muted/50"}`}
              >
                <Folder className="h-4 w-4 shrink-0" style={{ color: docTypeColor(t) }} />
                <span className="flex-1 text-left truncate">{t}</span>
                <span className="text-[11px] text-muted-foreground">{countByType[t] ?? 0}</span>
              </button>
            ))}
          </div>
        </Card>

        {/* File list */}
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar archivo o cliente..."
                aria-label="Buscar archivo o cliente"
                className="h-9 pl-9"
              />
            </div>
            <NativeSelect
              value={processingFilter}
              onChange={(e) => setProcessingFilter(e.target.value)}
              aria-label="Filtrar por estado de procesamiento"
              className="h-9 max-w-[190px] text-xs"
            >
              <option value="">Todos los estados</option>
              <option value="pending">Sin analizar</option>
              <option value="ocr_required">Documento escaneado</option>
              <option value="analyzing">Análisis en proceso</option>
              <option value="analysis_completed">Analizado</option>
              <option value="review_required">Pendiente de revisión</option>
              <option value="failed">Con error</option>
            </NativeSelect>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              {search ? "No se encontraron archivos." : "Aún no hay documentos. Sube el primero."}
            </div>
          ) : (
            <div className="max-h-[calc(100vh-19rem)] overflow-auto overscroll-contain">
              <table className="min-w-[1180px] w-full text-sm">
                <thead className="sticky top-0 z-20 bg-card shadow-sm">
                  <tr className="text-left text-xs uppercase text-muted-foreground bg-muted/30">
                    <th className="py-2 pl-4">Nombre</th>
                    <th className="py-2 px-3">Tipo</th>
                    <th className="py-2 px-3">Cliente</th>
                    <th className="py-2 px-3">Expediente</th>
                    <th className="py-2 px-3">Fuente</th>
                    <th className="py-2 px-3">Análisis</th>
                    <th className="py-2 px-3">Verificación</th>
                    <th className="py-2 px-3">Tamaño</th>
                    <th className="sticky right-0 bg-card py-2 pr-4 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((d) => (
                    <tr
                      key={d.id}
                      onClick={() => setSelectedId(d.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedId(d.id);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      className={`border-t border-border cursor-pointer transition ${selected?.id === d.id ? "bg-primary/5" : "hover:bg-muted/30"}`}
                    >
                      <td className="py-2.5 pl-4">
                        <div className="flex items-center gap-2.5">
                          <FileExtIcon name={d.name} />
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate max-w-[200px]">
                              {d.name}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {new Date(d.uploaded_at).toLocaleDateString("es-PE")}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <StatusBadge tone="navy">{displayDocumentType(d.type)}</StatusBadge>
                      </td>
                      <td className="py-2.5 px-3 text-xs text-muted-foreground">
                        {d.clients?.name ?? "—"}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-muted-foreground font-mono">
                        {d.cases?.expediente ?? "—"}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-muted-foreground">
                        {d.source_type === "google_drive" ? "Google Drive" : "Carga manual"}
                      </td>
                      <td className="py-2.5 px-3">
                        <StatusBadge
                          tone={
                            d.processing_status === "analysis_completed"
                              ? "success"
                              : d.processing_status === "failed"
                                ? "danger"
                                : d.processing_status === "review_required" ||
                                    d.processing_status === "ocr_required"
                                  ? "warning"
                                  : "default"
                          }
                        >
                          {documentProcessingLabel(d.processing_status)}
                        </StatusBadge>
                      </td>
                      <td className="py-2.5 px-3 text-xs text-muted-foreground">
                        {documentVerificationLabel(d.verification_status)}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-muted-foreground">{d.size}</td>
                      <td className="sticky right-0 bg-card py-2.5 pr-4 text-right">
                        <div className="inline-flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(d);
                            }}
                            className="h-7 w-7 grid place-items-center rounded hover:bg-muted"
                            title="Editar metadatos"
                            aria-label={`Editar ${d.name}`}
                          >
                            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePreview(d);
                            }}
                            disabled={previewingId === d.id}
                            className="h-7 w-7 grid place-items-center rounded hover:bg-muted"
                            title="Visualizar"
                            aria-label={`Visualizar ${d.name}`}
                          >
                            {previewingId === d.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                            ) : (
                              <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownload(d);
                            }}
                            className="h-7 w-7 grid place-items-center rounded hover:bg-muted"
                            title="Descargar"
                            aria-label={`Descargar ${d.name}`}
                          >
                            <Download className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (
                                  window.confirm(
                                    `¿Eliminar "${d.name}"? Esta acción no se puede deshacer.`,
                                  )
                                ) {
                                  deleteDoc.mutate({ id: d.id, storagePath: d.storage_path });
                                }
                              }}
                              className="h-7 w-7 grid place-items-center rounded hover:bg-red-50 hover:text-red-600"
                              title="Eliminar"
                              aria-label={`Eliminar ${d.name}`}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!isLoading && filtered.length > 0 && (
            <div className="px-4 py-2.5 border-t border-border text-xs text-muted-foreground">
              {filtered.length} archivo{filtered.length !== 1 ? "s" : ""}
            </div>
          )}
        </Card>

        {documentActionError && (
          <div className="lg:col-span-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {documentActionError}
          </div>
        )}

        {/* Preview panel */}
        <PreviewPanel selected={selected} onPreview={handlePreview} onDownload={handleDownload} />
      </div>

      {activePreview && (
        <DocumentPreviewDialog
          preview={activePreview}
          onClose={closePreview}
          onDownload={() => activePreviewDocument && handleDownload(activePreviewDocument)}
        />
      )}

      {/* Upload Modal */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md p-6 shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-base font-semibold">Subir archivo</h3>
                <p className="text-xs text-muted-foreground">Sube un documento al estudio</p>
              </div>
              <button
                type="button"
                onClick={() => setShowUpload(false)}
                className="h-8 w-8 grid place-items-center rounded-lg hover:bg-muted/60"
                aria-label="Cerrar subida de documento"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleUpload} className="space-y-4">
              {/* File picker */}
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Archivo *
                </label>
                <div
                  onClick={() => fileRef.current?.click()}
                  className={`mt-1.5 flex flex-col items-center justify-center gap-2 h-24 rounded-lg border-2 border-dashed cursor-pointer transition
                    ${uploadFile ? "border-primary/40 bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/30"}`}
                >
                  {uploadFile ? (
                    <>
                      <FileText className="h-6 w-6 text-primary" />
                      <span className="text-sm font-medium text-primary truncate max-w-[280px]">
                        {uploadFile.name}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {uploadFile.size < 1024 * 1024
                          ? `${Math.round(uploadFile.size / 1024)} KB`
                          : `${(uploadFile.size / (1024 * 1024)).toFixed(1)} MB`}
                      </span>
                    </>
                  ) : (
                    <>
                      <Upload className="h-6 w-6 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        Haz clic para seleccionar archivo
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        PDF, DOCX, JPG, PNG (máx. 10 MB)
                      </span>
                    </>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xlsx,.xls"
                  onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                />
              </div>

              {/* Type */}
              <div>
                <label
                  htmlFor="document-type"
                  className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Tipo de documento
                </label>
                <div className="mt-1.5">
                  <NativeSelect
                    id="document-type"
                    value={uploadForm.type}
                    onChange={(e) => setUploadForm((f) => ({ ...f, type: e.target.value }))}
                  >
                    {DOC_TYPES.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </NativeSelect>
                </div>
              </div>

              {/* Client */}
              <div>
                <label
                  htmlFor="document-client"
                  className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Cliente (opcional)
                </label>
                <div className="mt-1.5">
                  <NativeSelect
                    id="document-client"
                    value={uploadForm.clientId}
                    onChange={(e) =>
                      setUploadForm((f) => ({ ...f, clientId: e.target.value, caseId: "" }))
                    }
                  >
                    <option value="">Sin cliente</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </div>

              <div>
                <label
                  htmlFor="document-case"
                  className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Expediente (opcional)
                </label>
                <div className="mt-1.5">
                  <NativeSelect
                    id="document-case"
                    value={uploadForm.caseId}
                    onChange={(e) => {
                      const selectedCase = cases.find((item) => item.id === e.target.value);
                      setUploadForm((f) => ({
                        ...f,
                        caseId: e.target.value,
                        clientId: selectedCase?.client_id ?? f.clientId,
                      }));
                    }}
                  >
                    <option value="">Sin expediente específico</option>
                    {uploadCases.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.expediente} · {item.clients?.name ?? "Cliente"}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </div>

              {uploadError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {uploadError}
                </p>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowUpload(false)}
                  className="flex-1 h-10 rounded-lg border border-border text-sm font-medium hover:bg-muted/60"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!uploadFile || uploading}
                  className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Subiendo...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4" /> Subir
                    </>
                  )}
                </button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {editingDocument && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <Card className="w-full max-w-lg p-6 shadow-xl">
            <div className="mb-5 flex items-start justify-between">
              <div>
                <h3 className="font-semibold">Editar documento</h3>
                <p className="text-xs text-muted-foreground">
                  Solo se modifican metadatos; el archivo físico se conserva.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingDocument(null)}
                className="grid h-8 w-8 place-items-center rounded hover:bg-muted"
                aria-label="Cerrar edición"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={saveEdit} className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="edit-document-name" className="text-xs font-semibold">
                  Nombre
                </label>
                <Input
                  id="edit-document-name"
                  className="mt-1.5"
                  value={editForm.name}
                  onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}
                />
              </div>
              <div>
                <label htmlFor="edit-document-type" className="text-xs font-semibold">
                  Tipo
                </label>
                <NativeSelect
                  id="edit-document-type"
                  className="mt-1.5"
                  value={editForm.type}
                  onChange={(event) => setEditForm({ ...editForm, type: event.target.value })}
                >
                  {DOC_TYPES.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </NativeSelect>
              </div>
              <div>
                <label htmlFor="edit-document-verification" className="text-xs font-semibold">
                  Verificación
                </label>
                <NativeSelect
                  id="edit-document-verification"
                  className="mt-1.5"
                  value={editForm.verificationStatus}
                  onChange={(event) =>
                    setEditForm({ ...editForm, verificationStatus: event.target.value })
                  }
                >
                  <option value="pending">Pendiente</option>
                  <option value="approved">Aprobado</option>
                  <option value="edited">Editado</option>
                  <option value="rejected">Rechazado</option>
                  <option value="conflict">Conflicto</option>
                </NativeSelect>
              </div>
              <div>
                <label htmlFor="edit-document-client" className="text-xs font-semibold">
                  Cliente
                </label>
                <NativeSelect
                  id="edit-document-client"
                  className="mt-1.5"
                  value={editForm.clientId}
                  onChange={(event) =>
                    setEditForm({
                      ...editForm,
                      clientId: event.target.value,
                      caseId: cases.some(
                        (item) =>
                          item.id === editForm.caseId && item.client_id === event.target.value,
                      )
                        ? editForm.caseId
                        : "",
                    })
                  }
                >
                  <option value="">Sin cliente</option>
                  {clients.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div>
                <label htmlFor="edit-document-case" className="text-xs font-semibold">
                  Expediente
                </label>
                <NativeSelect
                  id="edit-document-case"
                  className="mt-1.5"
                  value={editForm.caseId}
                  onChange={(event) => {
                    const selectedCase = cases.find((item) => item.id === event.target.value);
                    setEditForm({
                      ...editForm,
                      caseId: event.target.value,
                      clientId: selectedCase?.client_id || editForm.clientId,
                    });
                  }}
                >
                  <option value="">Sin expediente</option>
                  {cases
                    .filter((item) => !editForm.clientId || item.client_id === editForm.clientId)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.case_number || item.expediente}
                      </option>
                    ))}
                </NativeSelect>
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="edit-document-date" className="text-xs font-semibold">
                  Fecha documental
                </label>
                <Input
                  id="edit-document-date"
                  className="mt-1.5"
                  type="date"
                  value={editForm.documentDate}
                  onChange={(event) =>
                    setEditForm({ ...editForm, documentDate: event.target.value })
                  }
                />
              </div>
              {editError && (
                <p className="sm:col-span-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                  {editError}
                </p>
              )}
              <div className="flex justify-end gap-2 sm:col-span-2">
                <Button type="button" variant="outline" onClick={() => setEditingDocument(null)}>
                  Cancelar
                </Button>
                <Button type="submit" loading={updateDoc.isPending}>
                  Guardar cambios
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </AppLayout>
  );
}

function documentProcessingLabel(status: string) {
  return (
    {
      pending: "Sin analizar",
      inventory_completed: "Inventariado",
      downloading: "Preparando",
      extracting_text: "Extrayendo texto",
      ocr_required: "Documento escaneado",
      processing_ocr: "Leyendo escaneo",
      analyzing: "Analizando",
      analysis_completed: "Analizado",
      review_required: "Pendiente de revisión",
      approved: "Aprobado",
      failed: "Con error",
    }[status] ?? status
  );
}

function documentVerificationLabel(status: string) {
  return (
    {
      pending: "Pendiente",
      approved: "Aprobado",
      edited: "Editado",
      rejected: "Rechazado",
      conflict: "Conflicto",
    }[status] ?? status
  );
}

function DocumentPreviewDialog({
  preview,
  onClose,
  onDownload,
}: {
  preview: DocumentPreview;
  onClose: () => void;
  onDownload: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Vista previa de ${preview.name}`}
    >
      <Card className="flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold">{preview.name}</h2>
            <p className="text-xs text-muted-foreground">Vista previa segura del documento</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onDownload}>
            <Download className="h-4 w-4" /> Descargar
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Cerrar visor"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 bg-muted/20 p-3">
          {preview.kind === "image" ? (
            <img src={preview.url} alt={preview.name} className="h-full w-full object-contain" />
          ) : preview.kind === "pdf" || preview.kind === "text" ? (
            <iframe
              src={preview.url}
              title={`Vista previa de ${preview.name}`}
              className="h-full w-full rounded border border-border bg-white"
            />
          ) : preview.kind === "docx" ? (
            <iframe
              srcDoc={preview.html}
              sandbox=""
              title={`Vista previa de ${preview.name}`}
              className="h-full w-full rounded border border-border bg-white"
            />
          ) : (
            <div className="grid h-full place-items-center px-6 text-center">
              <div className="max-w-md space-y-3">
                <FileText className="mx-auto h-12 w-12 text-muted-foreground" />
                <p className="font-medium">Vista previa no disponible</p>
                <p className="text-sm text-muted-foreground">{preview.message}</p>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// ── PreviewPanel ────────────────────────────────────────────────────────────
// Shows a real signed-URL preview for images; for other file types shows
// metadata + open/download buttons. Falls back gracefully if the URL can't
// be fetched.
function PreviewPanel({
  selected,
  onPreview,
  onDownload,
}: {
  selected: DocumentWithClient | null;
  onPreview: (doc: DocumentWithClient) => void;
  onDownload: (doc: DocumentWithClient) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const selectedId = selected?.id;
  const selectedName = selected?.name;
  const selectedStoragePath = selected?.storage_path;

  const isImage = (name: string) => /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(name);

  // Fetch a short-lived signed URL whenever selection changes
  useEffect(() => {
    if (!selectedName || !selectedStoragePath) {
      setPreviewUrl(null);
      return;
    }
    if (!isImage(selectedName)) {
      setPreviewUrl(null);
      return;
    }

    let cancelled = false;
    setLoadingPreview(true);
    supabase.storage
      .from("documents")
      .createSignedUrl(selectedStoragePath, 120)
      .then(({ data }) => {
        if (!cancelled) setPreviewUrl(data?.signedUrl ?? null);
      })
      .catch(() => {
        if (!cancelled) setPreviewUrl(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId, selectedName, selectedStoragePath]);

  return (
    <Card className="p-4 h-fit">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        Vista previa
      </div>

      {!selected ? (
        <div className="aspect-[3/4] rounded-lg border border-dashed border-border grid place-items-center text-muted-foreground text-xs text-center px-4">
          Selecciona un archivo para ver la información
        </div>
      ) : (
        <>
          {/* Preview area */}
          <div className="aspect-[3/4] rounded-lg border border-border bg-muted/20 grid place-items-center overflow-hidden relative">
            {loadingPreview ? (
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            ) : previewUrl ? (
              <img src={previewUrl} alt={selected.name} className="w-full h-full object-contain" />
            ) : (
              /* Non-image: show an icon + file extension badge */
              <div className="flex flex-col items-center gap-3 p-4">
                <FileExtIcon name={selected.name} className="h-16 w-16 rounded-2xl" />
                <div className="text-center">
                  <div className="text-xs font-semibold text-foreground truncate max-w-[200px]">
                    {selected.name}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5 uppercase tracking-wider">
                    {selected.name.split(".").pop()} · {selected.size}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onPreview(selected)}
                  className="mt-1 h-8 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:brightness-110 inline-flex items-center gap-1.5"
                >
                  <ExternalLink className="h-3 w-3" /> Visualizar archivo
                </button>
              </div>
            )}
          </div>

          {/* Metadata */}
          <div className="mt-3 space-y-1">
            <div className="text-sm font-semibold truncate">{selected.name}</div>
            <div className="text-xs text-muted-foreground">
              {displayDocumentType(selected.type)} · {selected.size}
            </div>
            {selected.clients && (
              <div className="text-xs text-muted-foreground">Cliente: {selected.clients.name}</div>
            )}
            {selected.cases && (
              <div className="text-xs text-muted-foreground">
                Expediente: <span className="font-mono">{selected.cases.expediente}</span>
              </div>
            )}
            <div className="text-xs text-muted-foreground">
              Subido: {new Date(selected.uploaded_at).toLocaleDateString("es-PE")}
            </div>
            <div className="text-xs text-muted-foreground">
              Fuente: {selected.source_type === "google_drive" ? "Google Drive" : "Carga manual"}
            </div>
            <div className="text-xs text-muted-foreground">
              Análisis: {documentProcessingLabel(selected.processing_status)}
            </div>
            <div className="text-xs text-muted-foreground">
              Verificación: {documentVerificationLabel(selected.verification_status)}
            </div>
          </div>

          {/* Actions */}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => onPreview(selected)}
              className="flex-1 h-8 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:brightness-110 inline-flex items-center justify-center gap-1"
            >
              <Eye className="h-3 w-3" /> Visualizar
            </button>
            <button
              type="button"
              onClick={() => onDownload(selected)}
              className="h-8 px-3 rounded-lg border border-border text-xs font-semibold hover:bg-muted/60 inline-flex items-center gap-1"
            >
              <Download className="h-3 w-3" /> Descargar
            </button>
          </div>
        </>
      )}
    </Card>
  );
}
