/**
 * folder-utils.ts
 * Utilities for document folder management: normalization, breadcrumbs, cycle detection.
 */

import type { Database } from "@/lib/database.types";

export type DocumentFolder = Database["public"]["Tables"]["document_folders"]["Row"];
export type DocumentFolderInsert = Database["public"]["Tables"]["document_folders"]["Insert"];
export type DocumentFolderUpdate = Database["public"]["Tables"]["document_folders"]["Update"];

// ─── Normalization ────────────────────────────────────────────────────────────

/**
 * Normalizes a folder name for uniqueness checks:
 * - Trims leading/trailing whitespace
 * - Collapses internal whitespace to single space
 * - Lowercases
 * - Strips accents
 */
export function normalizeFolderName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Validates a folder name before creation or rename.
 * Returns an error string or null if valid.
 */
export function validateFolderName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "El nombre no puede estar vacío.";
  if (trimmed.length > 120) return "El nombre no puede superar 120 caracteres.";
  if (trimmed.includes("/")) return 'El nombre no puede contener el carácter "/".';
  return null;
}

// ─── Breadcrumbs ──────────────────────────────────────────────────────────────

export interface Breadcrumb {
  id: string | null; // null = raíz
  name: string;
}

/**
 * Builds a breadcrumb trail from root to the given folder.
 * Returns [{ id: null, name: 'Documentos' }, ...ancestors, { id: folder.id, name: folder.name }]
 */
export function buildBreadcrumbs(
  folderId: string | null,
  allFolders: DocumentFolder[],
): Breadcrumb[] {
  const crumbs: Breadcrumb[] = [{ id: null, name: "Documentos" }];
  if (!folderId) return crumbs;

  const map = new Map<string, DocumentFolder>(allFolders.map((f) => [f.id, f]));
  const chain: DocumentFolder[] = [];

  let current = map.get(folderId);
  const visited = new Set<string>();

  while (current) {
    if (visited.has(current.id)) break; // cycle guard
    visited.add(current.id);
    chain.unshift(current);
    current = current.parent_id ? map.get(current.parent_id) : undefined;
  }

  for (const folder of chain) {
    crumbs.push({ id: folder.id, name: folder.name });
  }

  return crumbs;
}

// ─── Cycle detection ──────────────────────────────────────────────────────────

/**
 * Returns true if making `folderId` a child of `proposedParentId` would create a cycle.
 * A folder cannot be its own ancestor.
 */
export function wouldCreateCycle(
  folderId: string,
  proposedParentId: string,
  allFolders: DocumentFolder[],
): boolean {
  if (folderId === proposedParentId) return true;
  const map = new Map<string, DocumentFolder>(allFolders.map((f) => [f.id, f]));
  const visited = new Set<string>();
  let current = map.get(proposedParentId);
  while (current) {
    if (visited.has(current.id)) return false; // already hit a cycle elsewhere, not ours
    visited.add(current.id);
    if (current.id === folderId) return true;
    current = current.parent_id ? map.get(current.parent_id) : undefined;
  }
  return false;
}

// ─── Folder tree ──────────────────────────────────────────────────────────────

export interface FolderNode extends DocumentFolder {
  children: FolderNode[];
}

/**
 * Builds a tree of FolderNode objects from a flat list of folders.
 * Only includes folders for the given clientId.
 */
export function buildFolderTree(folders: DocumentFolder[], clientId: string): FolderNode[] {
  const clientFolders = folders.filter((f) => f.client_id === clientId);
  const map = new Map<string, FolderNode>(clientFolders.map((f) => [f.id, { ...f, children: [] }]));
  const roots: FolderNode[] = [];

  for (const node of map.values()) {
    if (!node.parent_id) {
      roots.push(node);
    } else {
      const parent = map.get(node.parent_id);
      if (parent) {
        parent.children.push(node);
      } else {
        // orphaned folder — treat as root
        roots.push(node);
      }
    }
  }

  // Sort children alphabetically
  function sortChildren(node: FolderNode) {
    node.children.sort((a, b) => a.name.localeCompare(b.name, "es"));
    node.children.forEach(sortChildren);
  }
  roots.sort((a, b) => a.name.localeCompare(b.name, "es"));
  roots.forEach(sortChildren);

  return roots;
}

/**
 * Returns all descendant folder IDs (not including the folder itself).
 */
export function getDescendantIds(folderId: string, allFolders: DocumentFolder[]): string[] {
  const result: string[] = [];
  const queue = allFolders.filter((f) => f.parent_id === folderId);
  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current.id);
    queue.push(...allFolders.filter((f) => f.parent_id === current.id));
  }
  return result;
}
