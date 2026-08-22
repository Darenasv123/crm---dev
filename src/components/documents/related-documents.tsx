import { useEffect, useState } from "react";
import { Download, Eye, FileText, Loader2, Trash2 } from "lucide-react";
import { Card, StatusBadge } from "@/components/app-layout";
import { EmptyState, LoadingState } from "@/components/ui/data-state";
import { FileExtIcon } from "@/components/documents/file-icon";
import { DocumentViewerDialog } from "@/components/documents/document-viewer-dialog";
import { useAuth } from "@/hooks/use-auth";
import { useDeleteDocument } from "@/hooks/use-documents";
import type { DocumentWithClient } from "@/hooks/use-documents";
import { usePermissions } from "@/lib/permissions";
import { normalizeDocumentType } from "@/lib/document-types";
import {
  downloadDocument,
  previewDocument,
  releaseDocumentPreview,
  type DocumentPreview,
} from "@/lib/document-actions";

/**
 * Lista documental compacta con acciones (ver/descargar/eliminar), reutilizada
 * en la ficha de Cliente y en la ficha de Expediente. Reutiliza el mismo
 * núcleo (permisos, visor, acciones de storage) que el explorador general
 * de Documentos para evitar un segundo gestor documental.
 */
export function RelatedDocuments({
  documents,
  isLoading = false,
  emptyTitle,
  emptyDescription = "Los documentos que subas o vincules aquí aparecerán en este listado.",
  className,
}: {
  documents: DocumentWithClient[];
  isLoading?: boolean;
  emptyTitle: string;
  emptyDescription?: string;
  className?: string;
}) {
  const { profile } = useAuth();
  const permissions = usePermissions(profile);
  const deleteDoc = useDeleteDocument();

  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [activePreview, setActivePreview] = useState<DocumentPreview | null>(null);
  const [activePreviewDocument, setActivePreviewDocument] = useState<DocumentWithClient | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(
    () => () => {
      releaseDocumentPreview(activePreview);
    },
    [activePreview],
  );

  async function handlePreview(doc: DocumentWithClient) {
    setActionError(null);
    setPreviewingId(doc.id);
    try {
      const preview = await previewDocument(doc);
      setActivePreviewDocument(doc);
      setActivePreview(preview);
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "No se pudo visualizar el documento.",
      );
    } finally {
      setPreviewingId(null);
    }
  }

  async function handleDownload(doc: DocumentWithClient) {
    setActionError(null);
    try {
      await downloadDocument(doc);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "No se pudo descargar el documento.");
    }
  }

  function handleDelete(doc: DocumentWithClient) {
    if (!permissions.canDeleteDocuments) return;
    if (
      window.confirm(
        `¿Eliminar "${doc.display_name || doc.name}"? Esta acción no se puede deshacer.`,
      )
    ) {
      deleteDoc.mutate({ id: doc.id, storagePath: doc.storage_path });
    }
  }

  function closePreview() {
    setActivePreview(null);
    setActivePreviewDocument(null);
  }

  if (isLoading) return <LoadingState rows={3} className={className} />;

  if (documents.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title={emptyTitle}
        description={emptyDescription}
        className={className}
      />
    );
  }

  return (
    <div className={className}>
      <Card className="overflow-hidden">
        <ul className="divide-y divide-border">
          {documents.map((doc) => {
            const displayName = doc.display_name || doc.name;
            return (
              <li key={doc.id} className="flex items-center gap-3 p-4">
                <FileExtIcon name={doc.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold" title={displayName}>
                    {displayName}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <StatusBadge tone="navy">
                      {normalizeDocumentType(doc.document_type || doc.type)}
                    </StatusBadge>
                    <span>{new Date(doc.uploaded_at).toLocaleDateString("es-PE")}</span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => handlePreview(doc)}
                    disabled={previewingId === doc.id}
                    className="h-8 w-8 grid place-items-center rounded hover:bg-muted"
                    title="Visualizar"
                    aria-label={`Visualizar ${displayName}`}
                  >
                    {previewingId === doc.id ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownload(doc)}
                    className="h-8 w-8 grid place-items-center rounded hover:bg-muted"
                    title="Descargar"
                    aria-label={`Descargar ${displayName}`}
                  >
                    <Download className="h-4 w-4 text-muted-foreground" />
                  </button>
                  {permissions.canDeleteDocuments && (
                    <button
                      type="button"
                      onClick={() => handleDelete(doc)}
                      disabled={deleteDoc.isPending}
                      className="h-8 w-8 grid place-items-center rounded hover:bg-red-50 hover:text-red-600"
                      title="Eliminar"
                      aria-label={`Eliminar ${displayName}`}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {actionError && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {activePreview && (
        <DocumentViewerDialog
          preview={activePreview}
          onClose={closePreview}
          onDownload={() => activePreviewDocument && handleDownload(activePreviewDocument)}
        />
      )}
    </div>
  );
}
