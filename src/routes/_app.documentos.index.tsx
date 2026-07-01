import { createFileRoute } from "@tanstack/react-router";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { useDocuments, useUploadDocument, useDeleteDocument } from "@/hooks/use-documents";
import type { DocumentWithClient } from "@/hooks/use-documents";
import { useClients } from "@/hooks/use-clients";
import { supabase } from "@/lib/supabase";
import {
  FileText, Folder, Search, Upload, Download, Eye,
  X, Loader2, Trash2, ChevronDown, ExternalLink,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";

export const Route = createFileRoute("/_app/documentos/")({
  head: () => ({ meta: [{ title: "Documentos — CRM Jurídico" }] }),
  component: DocsPage,
});

const DOC_TYPES = ["DNI", "Demanda", "Resolución", "Sentencia", "Poder", "Contrato", "Otros"];

const typeColor: Record<string, string> = {
  DNI:        "oklch(0.55 0.13 235)",
  Demanda:    "oklch(0.34 0.09 255)",
  Resolución: "oklch(0.74 0.12 80)",
  Sentencia:  "oklch(0.62 0.14 155)",
  Poder:      "oklch(0.62 0.18 25)",
  Contrato:   "oklch(0.55 0.13 290)",
  Otros:      "oklch(0.55 0.02 255)",
};

function DocsPage() {
  const [activeType, setActiveType] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: docs = [], isLoading } = useDocuments(activeType);
  const { data: clients = [] } = useClients();
  const uploadDoc = useUploadDocument();
  const deleteDoc = useDeleteDocument();

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadForm, setUploadForm] = useState({ type: "Otros", clientId: "" });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const filtered = docs.filter(d =>
    !search ||
    d.name.toLowerCase().includes(search.toLowerCase()) ||
    (d.clients?.name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const selected = filtered.find(d => d.id === selectedId) ?? filtered[0] ?? null;

  // Count docs per type
  const countByType = DOC_TYPES.reduce<Record<string, number>>((acc, t) => {
    acc[t] = docs.filter(d => d.type === t).length;
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
      });
      setShowUpload(false);
      setUploadFile(null);
      setUploadForm({ type: "Otros", clientId: "" });
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : "Error al subir. Intenta de nuevo.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(doc: typeof filtered[0]) {
    const { data } = await supabase.storage
      .from("documents")
      .createSignedUrl(doc.storage_path, 60);
    if (data?.signedUrl) {
      const a = document.createElement("a");
      a.href = data.signedUrl;
      a.download = doc.name;
      a.click();
    }
  }

  async function handleOpen(doc: typeof filtered[0]) {
    const { data } = await supabase.storage
      .from("documents")
      .createSignedUrl(doc.storage_path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  return (
    <AppLayout
      title="Documentos"
      subtitle="Explorador de archivos del estudio"
      actions={
        <button
          onClick={() => { setShowUpload(true); setUploadError(null); }}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 shadow-soft"
        >
          <Upload className="h-4 w-4" /> Subir archivo
        </button>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr_280px] gap-4">
        {/* Categories panel */}
        <Card className="p-3 h-fit">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">Categorías</div>
          <div className="space-y-0.5">
            <button
              onClick={() => setActiveType("all")}
              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm transition ${activeType === "all" ? "bg-primary/10 text-primary font-semibold" : "hover:bg-muted/50"}`}
            >
              <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-left">Todos</span>
              <span className="text-[11px] text-muted-foreground">{docs.length}</span>
            </button>
            {DOC_TYPES.map(t => (
              <button
                key={t}
                onClick={() => setActiveType(t)}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm transition ${activeType === t ? "bg-primary/10 text-primary font-semibold" : "hover:bg-muted/50"}`}
              >
                <Folder className="h-4 w-4 shrink-0" style={{ color: typeColor[t] }} />
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
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar archivo o cliente..."
                className="w-full h-8 pl-9 pr-3 rounded-lg bg-muted/40 border border-transparent focus:bg-card focus:border-primary focus:outline-none text-sm"
              />
            </div>
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
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground bg-muted/30">
                  <th className="py-2 pl-4">Nombre</th>
                  <th className="py-2 px-3">Tipo</th>
                  <th className="py-2 px-3">Cliente</th>
                  <th className="py-2 px-3">Tamaño</th>
                  <th className="py-2 pr-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(d => (
                  <tr
                    key={d.id}
                    onClick={() => setSelectedId(d.id)}
                    className={`border-t border-border cursor-pointer transition ${selected?.id === d.id ? "bg-primary/5" : "hover:bg-muted/30"}`}
                  >
                    <td className="py-2.5 pl-4">
                      <div className="flex items-center gap-2.5">
                        <div className="grid h-8 w-8 place-items-center rounded-lg bg-red-50 text-red-500 shrink-0">
                          <FileText className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate max-w-[200px]">{d.name}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {new Date(d.uploaded_at).toLocaleDateString("es-PE")}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-3"><StatusBadge tone="navy">{d.type}</StatusBadge></td>
                    <td className="py-2.5 px-3 text-xs text-muted-foreground">{d.clients?.name ?? "—"}</td>
                    <td className="py-2.5 px-3 text-xs text-muted-foreground">{d.size}</td>
                    <td className="py-2.5 pr-4 text-right">
                      <div className="inline-flex items-center gap-0.5">
                        <button
                          onClick={e => { e.stopPropagation(); handleOpen(d); }}
                          className="h-7 w-7 grid place-items-center rounded hover:bg-muted"
                          title="Abrir"
                        >
                          <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); handleDownload(d); }}
                          className="h-7 w-7 grid place-items-center rounded hover:bg-muted"
                          title="Descargar"
                        >
                          <Download className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            if (window.confirm(`¿Eliminar "${d.name}"? Esta acción no se puede deshacer.`)) {
                              deleteDoc.mutate({ id: d.id, storagePath: d.storage_path });
                            }
                          }}
                          className="h-7 w-7 grid place-items-center rounded hover:bg-red-50 hover:text-red-600"
                          title="Eliminar"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {!isLoading && filtered.length > 0 && (
            <div className="px-4 py-2.5 border-t border-border text-xs text-muted-foreground">
              {filtered.length} archivo{filtered.length !== 1 ? "s" : ""}
            </div>
          )}
        </Card>

        {/* Preview panel */}
        <PreviewPanel
          selected={selected}
          onOpen={handleOpen}
          onDownload={handleDownload}
        />
      </div>

      {/* Upload Modal */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md p-6 shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-base font-semibold">Subir archivo</h3>
                <p className="text-xs text-muted-foreground">Sube un documento al estudio</p>
              </div>
              <button onClick={() => setShowUpload(false)} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-muted/60">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleUpload} className="space-y-4">
              {/* File picker */}
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Archivo *</label>
                <div
                  onClick={() => fileRef.current?.click()}
                  className={`mt-1.5 flex flex-col items-center justify-center gap-2 h-24 rounded-lg border-2 border-dashed cursor-pointer transition
                    ${uploadFile ? "border-primary/40 bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/30"}`}
                >
                  {uploadFile ? (
                    <>
                      <FileText className="h-6 w-6 text-primary" />
                      <span className="text-sm font-medium text-primary truncate max-w-[280px]">{uploadFile.name}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {uploadFile.size < 1024 * 1024
                          ? `${Math.round(uploadFile.size / 1024)} KB`
                          : `${(uploadFile.size / (1024 * 1024)).toFixed(1)} MB`}
                      </span>
                    </>
                  ) : (
                    <>
                      <Upload className="h-6 w-6 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Haz clic para seleccionar archivo</span>
                      <span className="text-[11px] text-muted-foreground">PDF, DOCX, JPG, PNG (máx. 10 MB)</span>
                    </>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xlsx,.xls"
                  onChange={e => setUploadFile(e.target.files?.[0] ?? null)}
                />
              </div>

              {/* Type */}
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tipo de documento</label>
                <div className="relative mt-1.5">
                  <select
                    value={uploadForm.type}
                    onChange={e => setUploadForm(f => ({ ...f, type: e.target.value }))}
                    className="w-full h-10 pl-3 pr-9 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/15 text-sm appearance-none"
                  >
                    {DOC_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                </div>
              </div>

              {/* Client */}
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Cliente (opcional)</label>
                <div className="relative mt-1.5">
                  <select
                    value={uploadForm.clientId}
                    onChange={e => setUploadForm(f => ({ ...f, clientId: e.target.value }))}
                    className="w-full h-10 pl-3 pr-9 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/15 text-sm appearance-none"
                  >
                    <option value="">Sin cliente</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                </div>
              </div>

              {uploadError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{uploadError}</p>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowUpload(false)} className="flex-1 h-10 rounded-lg border border-border text-sm font-medium hover:bg-muted/60">
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!uploadFile || uploading}
                  className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {uploading ? <><Loader2 className="h-4 w-4 animate-spin" /> Subiendo...</> : <><Upload className="h-4 w-4" /> Subir</>}
                </button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </AppLayout>
  );
}

// ── PreviewPanel ────────────────────────────────────────────────────────────
// Shows a real signed-URL preview for images; for other file types shows
// metadata + open/download buttons. Falls back gracefully if the URL can't
// be fetched.
function PreviewPanel({
  selected,
  onOpen,
  onDownload,
}: {
  selected: DocumentWithClient | null;
  onOpen: (doc: DocumentWithClient) => void;
  onDownload: (doc: DocumentWithClient) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const isImage = (name: string) =>
    /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(name);

  // Fetch a short-lived signed URL whenever selection changes
  useEffect(() => {
    if (!selected) { setPreviewUrl(null); return; }
    if (!isImage(selected.name)) { setPreviewUrl(null); return; }

    let cancelled = false;
    setLoadingPreview(true);
    supabase.storage
      .from("documents")
      .createSignedUrl(selected.storage_path, 120)
      .then(({ data }) => {
        if (!cancelled) setPreviewUrl(data?.signedUrl ?? null);
      })
      .catch(() => { if (!cancelled) setPreviewUrl(null); })
      .finally(() => { if (!cancelled) setLoadingPreview(false); });

    return () => { cancelled = true; };
  }, [selected?.id]);

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
              <img
                src={previewUrl}
                alt={selected.name}
                className="w-full h-full object-contain"
              />
            ) : (
              /* Non-image: show an icon + file extension badge */
              <div className="flex flex-col items-center gap-3 p-4">
                <div className="grid h-16 w-16 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <FileText className="h-8 w-8" />
                </div>
                <div className="text-center">
                  <div className="text-xs font-semibold text-foreground truncate max-w-[200px]">
                    {selected.name}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5 uppercase tracking-wider">
                    {selected.name.split(".").pop()} · {selected.size}
                  </div>
                </div>
                <button
                  onClick={() => onOpen(selected)}
                  className="mt-1 h-8 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:brightness-110 inline-flex items-center gap-1.5"
                >
                  <ExternalLink className="h-3 w-3" /> Abrir archivo
                </button>
              </div>
            )}
          </div>

          {/* Metadata */}
          <div className="mt-3 space-y-1">
            <div className="text-sm font-semibold truncate">{selected.name}</div>
            <div className="text-xs text-muted-foreground">{selected.type} · {selected.size}</div>
            {selected.clients && (
              <div className="text-xs text-muted-foreground">Cliente: {selected.clients.name}</div>
            )}
            <div className="text-xs text-muted-foreground">
              Subido: {new Date(selected.uploaded_at).toLocaleDateString("es-PE")}
            </div>
          </div>

          {/* Actions */}
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => onOpen(selected)}
              className="flex-1 h-8 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:brightness-110 inline-flex items-center justify-center gap-1"
            >
              <Eye className="h-3 w-3" /> Abrir
            </button>
            <button
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
