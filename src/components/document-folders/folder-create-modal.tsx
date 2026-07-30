/**
 * folder-create-modal.tsx
 * Modal para crear una carpeta raíz o subcarpeta.
 */
import { useState } from "react";
import { Loader2, FolderPlus, X } from "lucide-react";
import { Card } from "@/components/app-layout";
import { useCreateFolder } from "@/hooks/use-document-folders";
import { validateFolderName } from "@/lib/folder-utils";
import { Input } from "@/components/ui/input";

interface Props {
  clientId: string;
  parentId: string | null;
  parentName?: string;
  onClose: () => void;
  onCreated?: (folderId: string, folderName: string) => void;
}

export function FolderCreateModal({ clientId, parentId, parentName, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const createFolder = useCreateFolder();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const validationError = validateFolderName(name);
    if (validationError) {
      setError(validationError);
      return;
    }
    try {
      const folder = await createFolder.mutateAsync({ clientId, parentId, name });
      onCreated?.(folder.id, folder.name);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear carpeta.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <Card className="w-full max-w-sm p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <FolderPlus className="h-4 w-4 text-primary" />
            <h3 className="text-base font-semibold">
              {parentId ? "Nueva subcarpeta" : "Nueva carpeta"}
            </h3>
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

        {parentName && (
          <p className="text-xs text-muted-foreground mb-3">
            Dentro de: <span className="font-medium">{parentName}</span>
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="new-folder-name"
              className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              Nombre de la carpeta *
            </label>
            <Input
              id="new-folder-name"
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Resoluciones"
              maxLength={120}
              className="mt-1.5"
            />
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
              disabled={!name.trim() || createFolder.isPending}
              className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {createFolder.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creando…
                </>
              ) : (
                <>
                  <FolderPlus className="h-4 w-4" />
                  Crear carpeta
                </>
              )}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
