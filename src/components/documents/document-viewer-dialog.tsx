import { useEffect, useRef } from "react";
import { Download, FileText, X } from "lucide-react";
import { Card } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import type { DocumentPreview } from "@/lib/document-actions";

/**
 * Visor modal reutilizable para vista previa segura de documentos.
 * Usado por el explorador general y por los contextos relacionados
 * (Cliente, Expediente) para evitar visores duplicados.
 */
export function DocumentViewerDialog({
  preview,
  onClose,
  onDownload,
}: {
  preview: DocumentPreview;
  onClose: () => void;
  onDownload: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Escape cierra el visor; el foco inicial va al botón de cerrar.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    closeButtonRef.current?.focus();
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Evita que el fondo se desplace mientras el visor está abierto.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

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
            ref={closeButtonRef}
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
