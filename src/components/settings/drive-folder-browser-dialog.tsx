import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Folder, FolderOpen, Loader2, AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { listGoogleDriveFolders, type DriveFolderListing } from "@/lib/google-drive-client";

/**
 * Navegador de carpetas de Google Drive.
 *
 * NO usa Google Picker: Picker exigiría entregar al navegador un access
 * token de Drive del estudio entero. Aquí el navegador solo habla con
 * /api/google-drive/folders y nunca ve un token.
 *
 * La navegación hacia arriba usa `listing.current.parentId`, que viene de la
 * metadata real de Google -- no de un valor que este componente haya
 * guardado. El rastro visual (migas) es solo presentación.
 */
export function DriveFolderBrowserDialog({
  open,
  onOpenChange,
  onSelect,
  saving = false,
  initialFolderId = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (folderId: string) => void | Promise<void>;
  saving?: boolean;
  initialFolderId?: string | null;
}) {
  const [listing, setListing] = useState<DriveFolderListing | null>(null);
  const [trail, setTrail] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (targetId: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const result = await listGoogleDriveFolders(targetId);
      setListing(result);
      setTrail((previous) => {
        const existing = previous.findIndex((entry) => entry.id === result.current.id);
        if (existing >= 0) return previous.slice(0, existing + 1);
        return [...previous, { id: result.current.id, name: result.current.name }];
      });
    } catch (cause) {
      setListing(null);
      setError(cause instanceof Error ? cause.message : "No se pudieron cargar las carpetas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setTrail([]);
    void load(initialFolderId);
  }, [open, initialFolderId, load]);

  function navigateTo(targetId: string | null) {
    void load(targetId);
  }

  const canSelect = Boolean(listing && listing.current.id !== "root");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" className="max-h-[calc(100dvh-2rem)]">
        <DialogHeader icon={FolderOpen}>
          <DialogTitle>Seleccionar carpeta raíz</DialogTitle>
          <DialogDescription>
            Elige la carpeta de Google Drive que contiene una subcarpeta por cada cliente. No se
            crea ni se modifica nada al navegar.
          </DialogDescription>
        </DialogHeader>

        {/* Migas: rastro visual navegable. El botón de subir un nivel usa el
            padre que devuelve el servidor, no este rastro. */}
        <nav aria-label="Ruta de carpetas" className="min-w-0">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {trail.map((entry, index) => (
              <li key={entry.id} className="flex min-w-0 items-center gap-1">
                {index > 0 && <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />}
                <button
                  type="button"
                  onClick={() => navigateTo(entry.id === "root" ? null : entry.id)}
                  disabled={loading || index === trail.length - 1}
                  className="min-h-11 max-w-[14rem] truncate rounded px-1 font-medium hover:text-foreground hover:underline disabled:cursor-default disabled:no-underline disabled:opacity-100 disabled:hover:text-muted-foreground"
                  title={entry.name}
                  aria-current={index === trail.length - 1 ? "location" : undefined}
                >
                  {entry.name}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <div
          className="min-h-[12rem] max-h-[45vh] overflow-y-auto rounded-lg border border-border"
          aria-busy={loading}
        >
          {loading ? (
            <p role="status" className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Cargando carpetas…
            </p>
          ) : error ? (
            <p role="alert" className="flex items-start gap-2 p-4 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {error}
            </p>
          ) : !listing || listing.folders.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              Esta carpeta no contiene subcarpetas.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {listing.folders.map((folder) => (
                <li key={folder.id}>
                  <button
                    type="button"
                    onClick={() => navigateTo(folder.id)}
                    className="flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
                  >
                    <Folder className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate" title={folder.name}>
                      {folder.name}
                    </span>
                    <ChevronRight
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => navigateTo(listing?.current.parentId ?? null)}
            disabled={loading || saving || !listing || listing.current.id === "root"}
          >
            Subir un nivel
          </Button>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => canSelect && listing && onSelect(listing.current.id)}
            loading={saving}
            disabled={loading || saving || !canSelect}
          >
            Usar esta carpeta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
