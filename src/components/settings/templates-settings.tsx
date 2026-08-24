import { useRef, useState } from "react";
import { Download, Eye, FileText, Loader2, Plus, Trash2, X } from "lucide-react";
import { Card } from "@/components/app-layout";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DocumentViewerDialog } from "@/components/documents/document-viewer-dialog";
import {
  documentFileName,
  previewDocument,
  releaseDocumentPreview,
  type DocumentPreview,
} from "@/lib/document-actions";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/lib/permissions";
import {
  useCreateTemplate,
  useDeleteTemplate,
  useTemplates,
  type Template,
} from "@/hooks/use-templates";
import { downloadDocument } from "@/lib/document-actions";

function templateAsStoredDocument(template: Template) {
  return {
    name: template.file_name,
    original_name: template.file_name,
    mime_type: template.mime_type,
    storage_path: template.storage_path,
  };
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function TemplatesSettings() {
  const { profile } = useAuth();
  const permissions = usePermissions(profile);
  const { data: templates = [], isLoading } = useTemplates();
  const deleteTemplate = useDeleteTemplate();

  const [showCreate, setShowCreate] = useState(false);
  const [preview, setPreview] = useState<DocumentPreview | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handlePreview(template: Template) {
    setActionError(null);
    setPreviewingId(template.id);
    try {
      setPreview(await previewDocument(templateAsStoredDocument(template)));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "No se pudo abrir la vista previa.");
    } finally {
      setPreviewingId(null);
    }
  }

  async function handleDownload(template: Template) {
    setActionError(null);
    try {
      await downloadDocument(templateAsStoredDocument(template));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "No se pudo descargar la plantilla.");
    }
  }

  async function handleDelete(template: Template) {
    if (
      !window.confirm(
        `¿Eliminar la plantilla "${template.name}"? Esta acción no se puede deshacer.`,
      )
    ) {
      return;
    }
    setActionError(null);
    setDeletingId(template.id);
    try {
      await deleteTemplate.mutateAsync({ id: template.id, storagePath: template.storage_path });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "No se pudo eliminar la plantilla.");
    } finally {
      setDeletingId(null);
    }
  }

  function closePreview() {
    releaseDocumentPreview(preview);
    setPreview(null);
  }

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-1">
          <div>
            <h3 className="text-base font-semibold">Plantillas de documentos</h3>
            <p className="text-xs text-muted-foreground">
              Biblioteca reutilizable de plantillas (DOCX/PDF/DOC) del estudio.
            </p>
          </div>
          {permissions.canCreateTemplates && (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:brightness-110"
            >
              <Plus className="h-3.5 w-3.5" />
              Nueva plantilla
            </button>
          )}
        </div>

        {actionError && (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600"
          >
            {actionError}
          </p>
        )}

        <div className="mt-5">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Cargando plantillas...
            </div>
          ) : templates.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Todavía no hay plantillas registradas.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {templates.map((template) => (
                <div
                  key={template.id}
                  className="flex items-start gap-3 rounded-lg border border-border p-4 transition hover:border-primary/30 hover:bg-muted/30"
                >
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold" title={template.name}>
                      {template.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {template.file_name.split(".").pop()?.toUpperCase()} ·{" "}
                      {formatSize(template.size)}
                    </div>
                    {template.description && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {template.description}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => handlePreview(template)}
                        disabled={previewingId === template.id}
                        aria-label={`Visualizar ${template.name}`}
                        className="inline-flex min-h-11 items-center gap-1 rounded-md border border-border px-2 text-[11px] font-semibold hover:bg-muted/60 disabled:opacity-50"
                      >
                        {previewingId === template.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Eye className="h-3 w-3" />
                        )}
                        Ver
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownload(template)}
                        aria-label={`Descargar ${template.name}`}
                        className="inline-flex min-h-11 items-center gap-1 rounded-md border border-border px-2 text-[11px] font-semibold hover:bg-muted/60"
                      >
                        <Download className="h-3 w-3" />
                        Descargar
                      </button>
                      {permissions.canDeleteTemplates && (
                        <button
                          type="button"
                          onClick={() => handleDelete(template)}
                          disabled={deletingId === template.id}
                          aria-label={`Eliminar ${template.name}`}
                          className="inline-flex min-h-11 items-center gap-1 rounded-md border border-red-200 px-2 text-[11px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          {deletingId === template.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                          Eliminar
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {preview && (
        <DocumentViewerDialog
          preview={preview}
          onClose={closePreview}
          onDownload={() => {
            const template = templates.find(
              (t) => documentFileName(templateAsStoredDocument(t)) === preview.name,
            );
            if (template) void handleDownload(template);
          }}
        />
      )}

      {showCreate && <CreateTemplateDialog onClose={() => setShowCreate(false)} />}
    </div>
  );
}

function CreateTemplateDialog({ onClose }: { onClose: () => void }) {
  const createTemplate = useCreateTemplate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = Boolean(name.trim() && file && !createTemplate.isPending);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !file) return;
    setError(null);
    try {
      await createTemplate.mutateAsync({ file, name, description });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la plantilla.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <Card className="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold">Nueva plantilla</h3>
            <p className="text-xs text-muted-foreground">
              Nombre, descripción y archivo (PDF/DOC/DOCX)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="grid min-h-11 min-w-11 place-items-center rounded-lg hover:bg-muted/60"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="template-name"
              className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Nombre *
            </label>
            <Input
              id="template-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="mt-1.5"
              placeholder="Ejemplo: Demanda de divorcio"
            />
          </div>
          <div>
            <label
              htmlFor="template-description"
              className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Descripción (opcional)
            </label>
            <Textarea
              id="template-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="mt-1.5"
            />
          </div>
          <div>
            <label
              htmlFor="template-file"
              className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Archivo *
            </label>
            <input
              ref={fileInputRef}
              id="template-file"
              type="file"
              accept=".pdf,.doc,.docx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
              className="mt-1.5 w-full text-sm file:mr-3 file:h-9 file:rounded-lg file:border-0 file:bg-primary/10 file:px-3 file:text-xs file:font-semibold file:text-primary"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              PDF, DOC o DOCX · máximo 10 MB.
            </p>
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600"
            >
              {error}
            </p>
          )}
          <div className="mt-2 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="h-10 flex-1 rounded-lg border border-border text-sm font-medium hover:bg-muted/60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:brightness-110 disabled:opacity-60"
            >
              {createTemplate.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {createTemplate.isPending ? "Subiendo..." : "Crear plantilla"}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
