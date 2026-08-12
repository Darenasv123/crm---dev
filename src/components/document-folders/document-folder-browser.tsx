/**
 * document-folder-browser.tsx
 * Organización documental por carpetas para la ficha de cliente.
 *
 * Muestra primero carpetas, luego documentos.
 * Soporta navegación por breadcrumbs, creación/renombrado/eliminación de carpetas,
 * subida de documentos dentro de carpeta, selección múltiple y mover documentos.
 */
import { useState, useMemo, useCallback } from "react";
import {
  Folder,
  FolderOpen,
  FolderPlus,
  FileText,
  Download,
  MoveRight,
  Pencil,
  Trash2,
  ChevronRight,
  Home,
  Loader2,
  Search,
  FileUp,
  AlertCircle,
  CheckSquare,
  Square,
} from "lucide-react";
import { Card } from "@/components/app-layout";
import {
  useClientFolders,
  useFolderDocuments,
  useUnclassifiedDocuments,
  useDeleteFolder,
  useFolderDocumentCounts,
  useFolderHasContent,
} from "@/hooks/use-document-folders";
import { buildFolderTree, buildBreadcrumbs } from "@/lib/folder-utils";
import type { DocumentFolder } from "@/lib/folder-utils";
import type { Database } from "@/lib/database.types";
import { downloadDocument } from "@/lib/document-actions";
import { FolderCreateModal } from "./folder-create-modal";
import { FolderRenameModal } from "./folder-rename-modal";
import { FolderMoveModal } from "./folder-move-modal";
import { Input } from "@/components/ui/input";

type Document = Database["public"]["Tables"]["documents"]["Row"];

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  clientId: string;
  isAdmin: boolean;
  /** Opens the upload modal pre-filled with folderId */
  onUploadInFolder: (folderId: string | null) => void;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border animate-pulse">
      <div className="h-10 w-10 rounded-lg bg-muted/60 shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 w-40 rounded bg-muted/60" />
        <div className="h-2.5 w-24 rounded bg-muted/40" />
      </div>
    </div>
  );
}

// ─── Folder row ───────────────────────────────────────────────────────────────

function FolderRow({
  folder,
  docCount,
  isAdmin,
  onOpen,
  onRename,
  onDelete,
}: {
  folder: DocumentFolder;
  docCount: number;
  isAdmin: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { data: content } = useFolderHasContent(folder.id);
  const isEmpty = !content?.hasDocuments && !content?.hasSubfolders;

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-amber-300/60 hover:bg-amber-50/30 transition group">
      <button
        type="button"
        onClick={onOpen}
        className="grid h-10 w-10 place-items-center rounded-lg bg-amber-50 text-amber-600 shrink-0"
        aria-label={`Abrir carpeta ${folder.name}`}
      >
        <Folder className="h-5 w-5" />
      </button>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onOpen}
          className="text-sm font-semibold truncate text-left hover:underline block max-w-full"
        >
          {folder.name}
        </button>
        <div className="text-xs text-muted-foreground">
          {docCount > 0 ? `${docCount} documento${docCount !== 1 ? "s" : ""}` : "Carpeta vacía"}
        </div>
      </div>
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
        <button
          type="button"
          onClick={onOpen}
          className="h-8 px-2 rounded-md text-xs font-medium border border-border hover:bg-muted/60 flex items-center gap-1"
          title="Abrir"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          Abrir
        </button>
        <button
          type="button"
          onClick={onRename}
          className="h-8 w-8 grid place-items-center rounded-md hover:bg-muted/60"
          title="Renombrar"
          aria-label={`Renombrar ${folder.name}`}
        >
          <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        {isAdmin && (
          <button
            type="button"
            onClick={onDelete}
            disabled={!isEmpty}
            className="h-8 w-8 grid place-items-center rounded-md hover:bg-red-50 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
            title={
              isEmpty
                ? "Eliminar carpeta vacía"
                : "No se puede eliminar: contiene documentos o subcarpetas"
            }
            aria-label={`Eliminar ${folder.name}`}
          >
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Document row ─────────────────────────────────────────────────────────────

function DocumentRow({
  doc,
  selected,
  onToggleSelect,
  onDownload,
  onMove,
}: {
  doc: Document;
  selected: boolean;
  onToggleSelect: () => void;
  onDownload: (doc: Document) => void;
  onMove: (doc: Document) => void;
}) {
  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-lg border transition group ${
        selected
          ? "border-primary/50 bg-primary/5"
          : "border-border hover:border-primary/20 hover:bg-muted/30"
      }`}
    >
      <button
        type="button"
        onClick={onToggleSelect}
        className="shrink-0 text-muted-foreground hover:text-primary"
        aria-label={selected ? "Deseleccionar" : "Seleccionar"}
      >
        {selected ? (
          <CheckSquare className="h-4 w-4 text-primary" />
        ) : (
          <Square className="h-4 w-4 opacity-0 group-hover:opacity-100" />
        )}
      </button>
      <div className="grid h-10 w-10 place-items-center rounded-lg bg-red-50 text-red-600 shrink-0">
        <FileText className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold truncate">{doc.original_name ?? doc.name}</div>
        <div className="text-xs text-muted-foreground">
          {doc.type} · {doc.size} · {new Date(doc.uploaded_at).toLocaleDateString("es-PE")}
        </div>
      </div>
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
        <button
          type="button"
          onClick={() => onDownload(doc)}
          className="h-8 w-8 grid place-items-center rounded-md hover:bg-muted/60"
          title="Descargar"
          aria-label={`Descargar ${doc.name}`}
        >
          <Download className="h-4 w-4 text-muted-foreground" />
        </button>
        <button
          type="button"
          onClick={() => onMove(doc)}
          className="h-8 w-8 grid place-items-center rounded-md hover:bg-muted/60"
          title="Mover"
          aria-label={`Mover ${doc.name}`}
        >
          <MoveRight className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({
  onUpload,
  onCreateSubfolder,
  isRoot,
}: {
  onUpload: () => void;
  onCreateSubfolder: () => void;
  isRoot: boolean;
}) {
  return (
    <div className="py-10 text-center">
      <FolderOpen className="mx-auto h-10 w-10 text-muted-foreground/40 mb-3" />
      <p className="text-sm font-medium text-muted-foreground mb-1">
        Esta carpeta todavía no contiene documentos.
      </p>
      <div className="flex justify-center gap-2 mt-4">
        <button
          type="button"
          onClick={onUpload}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-xs font-medium hover:bg-muted/60"
        >
          <FileUp className="h-3.5 w-3.5" />
          Subir documentos
        </button>
        {!isRoot && (
          <button
            type="button"
            onClick={onCreateSubfolder}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-xs font-medium hover:bg-muted/60"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            Crear subcarpeta
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function DocumentFolderBrowser({ clientId, isAdmin, onUploadInFolder }: Props) {
  // Navigation state
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Selection
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());

  // Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [renameTarget, setRenameTarget] = useState<DocumentFolder | null>(null);
  const [moveDocuments, setMoveDocuments] = useState<Document[] | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Data
  const { data: allFolders = [], isLoading: foldersLoading } = useClientFolders(clientId);
  const { data: folderDocs = [], isLoading: folderDocsLoading } = useFolderDocuments(
    currentFolderId ?? undefined,
  );
  const { data: unclassifiedDocs = [], isLoading: unclassifiedLoading } =
    useUnclassifiedDocuments(clientId);

  const deleteFolder = useDeleteFolder();

  // Current folder object
  const currentFolder = allFolders.find((f) => f.id === currentFolderId) ?? null;

  // Child folders of current level
  const childFolders = useMemo(() => {
    return allFolders
      .filter((f) => f.parent_id === currentFolderId)
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [allFolders, currentFolderId]);

  // Breadcrumbs
  const breadcrumbs = useMemo(
    () => buildBreadcrumbs(currentFolderId, allFolders),
    [currentFolderId, allFolders],
  );

  // Folder tree (for move modal)
  const folderTree = useMemo(() => buildFolderTree(allFolders, clientId), [allFolders, clientId]);
  void folderTree; // used in FolderMoveModal via allFolders prop

  // Document counts per folder
  const folderIds = childFolders.map((f) => f.id);
  const { data: docCounts = {} } = useFolderDocumentCounts(folderIds);

  // Documents to show (with optional search filter)
  const isRoot = currentFolderId === null;
  const currentDocs = isRoot ? unclassifiedDocs : folderDocs;
  const isLoading = foldersLoading || (isRoot ? unclassifiedLoading : folderDocsLoading);

  const filteredFolders = useMemo(() => {
    if (!search) return childFolders;
    return childFolders.filter((f) => f.name.toLowerCase().includes(search.toLowerCase()));
  }, [childFolders, search]);

  const filteredDocs = useMemo(() => {
    if (!search) return currentDocs;
    return currentDocs.filter((d) =>
      (d.original_name ?? d.name).toLowerCase().includes(search.toLowerCase()),
    );
  }, [currentDocs, search]);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const handleDownload = useCallback(async (doc: Document) => {
    setDeleteError(null);
    try {
      await downloadDocument(doc);
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : "No se pudo descargar el documento.");
    }
  }, []);

  const handleDeleteFolder = useCallback(
    async (folder: DocumentFolder) => {
      setDeleteError(null);
      try {
        await deleteFolder.mutateAsync({ folderId: folder.id, clientId });
      } catch (err) {
        setDeleteError(err instanceof Error ? err.message : "Error al eliminar.");
      }
    },
    [deleteFolder, clientId],
  );

  const handleToggleSelect = useCallback((docId: string) => {
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  }, []);

  const handleMoveSelected = useCallback(() => {
    const docs = currentDocs.filter((d) => selectedDocIds.has(d.id));
    if (docs.length > 0) setMoveDocuments(docs);
  }, [currentDocs, selectedDocIds]);

  const handleMoveSingle = useCallback((doc: Document) => {
    setMoveDocuments([doc]);
  }, []);

  const navigateTo = useCallback((folderId: string | null) => {
    setCurrentFolderId(folderId);
    setSelectedDocIds(new Set());
    setSearch("");
    setDeleteError(null);
  }, []);

  // ─── Render ─────────────────────────────────────────────────────────────────

  const hasContent = filteredFolders.length > 0 || filteredDocs.length > 0;
  const showUnclassifiedSection = isRoot && unclassifiedDocs.length > 0 && !search;

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Breadcrumbs */}
        <nav aria-label="Ubicación" className="flex items-center gap-1 flex-1 min-w-0 flex-wrap">
          {breadcrumbs.map((crumb, i) => (
            <span key={crumb.id ?? "__root"} className="flex items-center gap-1 shrink-0">
              {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
              {i < breadcrumbs.length - 1 ? (
                <button
                  type="button"
                  onClick={() => navigateTo(crumb.id)}
                  className="text-xs text-primary hover:underline font-medium flex items-center gap-0.5"
                >
                  {crumb.id === null && <Home className="h-3 w-3" />}
                  {crumb.name}
                </button>
              ) : (
                <span className="text-xs font-semibold text-foreground flex items-center gap-0.5">
                  {crumb.id === null && <Home className="h-3 w-3" />}
                  {crumb.name}
                </span>
              )}
            </span>
          ))}
        </nav>

        {/* Buscador */}
        <div className="relative w-48">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar…"
            className="h-9 pl-8 text-xs"
            aria-label="Buscar documentos y carpetas"
          />
        </div>

        {/* Acciones */}
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-xs font-medium hover:bg-muted/60"
          aria-label="Crear carpeta"
        >
          <FolderPlus className="h-3.5 w-3.5" />
          Crear carpeta
        </button>
        <button
          type="button"
          onClick={() => onUploadInFolder(currentFolderId)}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:brightness-110"
          aria-label="Subir documentos"
        >
          <FileUp className="h-3.5 w-3.5" />
          Subir documentos
        </button>
        {selectedDocIds.size > 0 && (
          <button
            type="button"
            onClick={handleMoveSelected}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-primary text-primary text-xs font-semibold hover:bg-primary/10"
          >
            <MoveRight className="h-3.5 w-3.5" />
            Mover ({selectedDocIds.size})
          </button>
        )}
      </div>

      {/* ── Delete error ── */}
      {deleteError && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
          <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{deleteError}</p>
          <button
            type="button"
            onClick={() => setDeleteError(null)}
            className="ml-auto h-5 w-5 grid place-items-center text-red-400 hover:text-red-600"
            aria-label="Cerrar error"
          >
            ×
          </button>
        </div>
      )}

      {/* ── Content ── */}
      <Card className="p-4">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <RowSkeleton key={i} />
            ))}
          </div>
        ) : !hasContent && !showUnclassifiedSection ? (
          <EmptyState
            onUpload={() => onUploadInFolder(currentFolderId)}
            onCreateSubfolder={() => setShowCreateModal(true)}
            isRoot={isRoot}
          />
        ) : (
          <div className="space-y-1.5">
            {/* Folders first */}
            {filteredFolders.length > 0 && (
              <div className="space-y-1.5">
                {filteredFolders.map((folder) => (
                  <FolderRow
                    key={folder.id}
                    folder={folder}
                    docCount={docCounts[folder.id] ?? 0}
                    isAdmin={isAdmin}
                    onOpen={() => navigateTo(folder.id)}
                    onRename={() => setRenameTarget(folder)}
                    onDelete={() => handleDeleteFolder(folder)}
                  />
                ))}
              </div>
            )}

            {/* Documents in current folder */}
            {filteredDocs.length > 0 && (
              <>
                {filteredFolders.length > 0 && <div className="border-t border-border my-2" />}
                <div className="space-y-1.5">
                  {filteredDocs.map((doc) => (
                    <DocumentRow
                      key={doc.id}
                      doc={doc}
                      selected={selectedDocIds.has(doc.id)}
                      onToggleSelect={() => handleToggleSelect(doc.id)}
                      onDownload={handleDownload}
                      onMove={handleMoveSingle}
                    />
                  ))}
                </div>
              </>
            )}

            {/* Unclassified section at root */}
            {showUnclassifiedSection &&
              filteredFolders.length === 0 &&
              filteredDocs.length === 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    Documentos sin carpeta
                  </p>
                  <div className="space-y-1.5">
                    {unclassifiedDocs.map((doc) => (
                      <DocumentRow
                        key={doc.id}
                        doc={doc}
                        selected={selectedDocIds.has(doc.id)}
                        onToggleSelect={() => handleToggleSelect(doc.id)}
                        onDownload={handleDownload}
                        onMove={handleMoveSingle}
                      />
                    ))}
                  </div>
                </div>
              )}
          </div>
        )}
      </Card>

      {/* ── Root: unclassified section (shown below folders/docs) ── */}
      {isRoot &&
        !search &&
        unclassifiedDocs.length > 0 &&
        (childFolders.length > 0 || folderDocs.length > 0) && (
          <Card className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Documentos sin carpeta ({unclassifiedDocs.length})
            </p>
            <div className="space-y-1.5">
              {unclassifiedDocs.map((doc) => (
                <DocumentRow
                  key={doc.id}
                  doc={doc}
                  selected={selectedDocIds.has(doc.id)}
                  onToggleSelect={() => handleToggleSelect(doc.id)}
                  onDownload={handleDownload}
                  onMove={handleMoveSingle}
                />
              ))}
            </div>
          </Card>
        )}

      {/* ── Modals ── */}
      {showCreateModal && (
        <FolderCreateModal
          clientId={clientId}
          parentId={currentFolderId}
          parentName={currentFolder?.name}
          onClose={() => setShowCreateModal(false)}
        />
      )}

      {renameTarget && (
        <FolderRenameModal
          folderId={renameTarget.id}
          clientId={clientId}
          currentName={renameTarget.name}
          parentId={renameTarget.parent_id}
          onClose={() => setRenameTarget(null)}
        />
      )}

      {moveDocuments && (
        <FolderMoveModal
          clientId={clientId}
          documentIds={moveDocuments.map((d) => d.id)}
          documentNames={moveDocuments.map((d) => d.original_name ?? d.name)}
          allFolders={allFolders}
          currentFolderId={currentFolderId}
          onClose={() => {
            setMoveDocuments(null);
            setSelectedDocIds(new Set());
          }}
          onMoved={() => setSelectedDocIds(new Set())}
        />
      )}
    </div>
  );
}
