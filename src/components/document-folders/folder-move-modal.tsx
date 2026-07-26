/**
 * folder-move-modal.tsx
 * Modal para mover uno o varios documentos a una carpeta o a la raíz.
 */
import { useState } from "react";
import { Loader2, MoveRight, FolderOpen, X, Home } from "lucide-react";
import { Card } from "@/components/app-layout";
import { useMoveDocuments } from "@/hooks/use-document-folders";
import { buildFolderTree } from "@/lib/folder-utils";
import type { DocumentFolder, FolderNode } from "@/lib/folder-utils";

interface Props {
  clientId: string;
  documentIds: string[];
  documentNames: string[];
  allFolders: DocumentFolder[];
  currentFolderId: string | null;
  onClose: () => void;
  onMoved?: () => void;
}

function FolderOption({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: FolderNode;
  depth: number;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition ${
          selected === node.id
            ? "bg-primary/10 text-primary font-semibold"
            : "hover:bg-muted/60 text-foreground"
        }`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" />
        <span className="truncate">{node.name}</span>
      </button>
      {node.children.map((child) => (
        <FolderOption
          key={child.id}
          node={child}
          depth={depth + 1}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

export function FolderMoveModal({
  clientId,
  documentIds,
  documentNames,
  allFolders,
  currentFolderId,
  onClose,
  onMoved,
}: Props) {
  const [targetFolderId, setTargetFolderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const moveDocs = useMoveDocuments();

  const tree = buildFolderTree(allFolders, clientId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await moveDocs.mutateAsync({ documentIds, targetFolderId, clientId });
      onMoved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al mover documentos.");
    }
  }

  const isRootSelected = targetFolderId === null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <Card className="w-full max-w-sm p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <MoveRight className="h-4 w-4 text-primary" />
            <h3 className="text-base font-semibold">
              Mover {documentIds.length === 1 ? "documento" : `${documentIds.length} documentos`}
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

        {documentNames.length > 0 && (
          <div className="mb-3 text-xs text-muted-foreground">
            {documentNames.length <= 3
              ? documentNames.join(", ")
              : `${documentNames.slice(0, 3).join(", ")} y ${documentNames.length - 3} más`}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Destino
            </p>
            <div className="border border-border rounded-lg max-h-52 overflow-y-auto p-1">
              {/* Root option */}
              <button
                type="button"
                onClick={() => setTargetFolderId(null)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition ${
                  isRootSelected
                    ? "bg-primary/10 text-primary font-semibold"
                    : "hover:bg-muted/60 text-foreground"
                }`}
              >
                <Home className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span>Documentos (raíz)</span>
              </button>
              {tree.map((node) => (
                <FolderOption
                  key={node.id}
                  node={node}
                  depth={0}
                  selected={targetFolderId}
                  onSelect={setTargetFolderId}
                />
              ))}
              {tree.length === 0 && (
                <p className="px-3 py-4 text-xs text-muted-foreground text-center">
                  No hay carpetas creadas.
                </p>
              )}
            </div>
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
              disabled={moveDocs.isPending || targetFolderId === currentFolderId}
              className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {moveDocs.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Moviendo…
                </>
              ) : (
                <>
                  <MoveRight className="h-4 w-4" />
                  Mover aquí
                </>
              )}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
