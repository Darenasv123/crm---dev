/**
 * folder-rename-modal.tsx
 * Modal para renombrar una carpeta (no mueve archivos físicos).
 */
import { useState } from "react";
import { Loader2, Pencil, X } from "lucide-react";
import { Card } from "@/components/app-layout";
import { useRenameFolder } from "@/hooks/use-document-folders";
import { validateFolderName } from "@/lib/folder-utils";
import { Input } from "@/components/ui/input";

interface Props {
  folderId: string;
  clientId: string;
  currentName: string;
  parentId: string | null;
  onClose: () => void;
  onRenamed?: (newName: string) => void;
}

export function FolderRenameModal({
  folderId,
  clientId,
  currentName,
  parentId,
  onClose,
  onRenamed,
}: Props) {
  const [name, setName] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const renameFolder = useRenameFolder();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (name.trim() === currentName.trim()) {
      onClose();
      return;
    }
    const validationError = validateFolderName(name);
    if (validationError) {
      setError(validationError);
      return;
    }
    try {
      await renameFolder.mutateAsync({
        folderId,
        clientId,
        newName: name,
        currentParentId: parentId,
      });
      onRenamed?.(name.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al renombrar.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <Card className="w-full max-w-sm p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-primary" />
            <h3 className="text-base font-semibold">Renombrar carpeta</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 grid place-items-center rounded-lg hover:bg-muted/60"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="rename-folder-name"
              className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Nuevo nombre *
            </label>
            <Input
              id="rename-folder-name"
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              className="mt-1.5"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Renombrar no mueve los archivos físicos en el almacenamiento.
            </p>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-10 rounded-lg border border-border text-sm font-medium hover:bg-muted/60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!name.trim() || renameFolder.isPending}
              className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {renameFolder.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Guardando…
                </>
              ) : (
                <>
                  <Pencil className="h-4 w-4" />
                  Guardar
                </>
              )}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
