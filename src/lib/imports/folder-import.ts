/**
 * folder-import.ts
 * Pure analysis module for bulk folder imports (webkitdirectory).
 * No React, no Supabase calls — only in-memory processing.
 */
import { normalizeText, findClientDuplicates, buildClientInitials } from "@/lib/client-validation";
import { shouldIgnorePath } from "@/lib/imports/zip-import";
import type { ClientRow } from "@/lib/client-validation";

// ─── Constants ────────────────────────────────────────────────────────────────

export const BULK_IMPORT_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "jpg",
  "jpeg",
  "png",
  "webp",
  "txt",
]);

export const MAX_IMPORT_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// ─── Types ────────────────────────────────────────────────────────────────────

export type ClientEntryStatus =
  "new" | "duplicate_exact" | "duplicate_approximate" | "empty" | "excluded" | "failed" | "done";

export type DuplicateResolution = "use_existing" | "create_new" | "skip";

export type DocumentEntryStatus =
  | "pending"
  | "duplicate_skipped"
  | "invalid_format"
  | "invalid_empty"
  | "invalid_size"
  | "uploading"
  | "done"
  | "failed";

export interface DocumentEntry {
  /** The File object from the browser */
  file: File;
  /**
   * Relative path from the root folder, e.g.
   * "CLIENTES/JUAN PÉREZ/Resoluciones/res01.pdf"
   * We keep this full path; the storage path strips the root segment.
   */
  relativePath: string;
  /** Original filename without sanitizing */
  originalName: string;
  status: DocumentEntryStatus;
  errorMessage?: string;
  /** SHA-256 hex string, computed lazily */
  checksum?: string;
  /** The constructed Storage path once the upload starts */
  storagePath?: string;
}

export interface ClientEntry {
  /** Original folder name — used for display and stored in DB */
  folderName: string;
  /** normalizeText(folderName) — used only for comparison */
  normalizedName: string;
  status: ClientEntryStatus;
  /** UUID of the matching existing client when duplicate_exact */
  existingClientId?: string;
  existingClientName?: string;
  /** UUID assigned after the client is created during import */
  createdClientId?: string;
  documents: DocumentEntry[];
  errorMessage?: string;
  /** User's resolution choice for duplicate_exact */
  duplicateResolution?: DuplicateResolution;
}

export interface FolderAnalysisResult {
  rootName: string;
  clients: ClientEntry[];
  ignoredFiles: string[];
}

export interface ImportStats {
  totalClients: number;
  totalDocuments: number;
  clientsCreated: number;
  clientsAssociated: number;
  clientsSkipped: number;
  clientsFailed: number;
  documentsUploaded: number;
  documentsDuplicateSkipped: number;
  documentsInvalid: number;
  documentsFailed: number;
  currentClientName: string;
  processed: number;
}

// ─── FolderAnalyzer ───────────────────────────────────────────────────────────

/**
 * Validates a document file against bulk-import rules.
 * Returns null if valid, or a DocumentEntryStatus explaining the problem.
 */
export function validateBulkFile(
  file: File,
): "invalid_format" | "invalid_empty" | "invalid_size" | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!BULK_IMPORT_EXTENSIONS.has(ext)) return "invalid_format";
  if (file.size === 0) return "invalid_empty";
  if (file.size > MAX_IMPORT_FILE_SIZE) return "invalid_size";
  return null;
}

/**
 * Sanitizes a relative path for use in Supabase Storage.
 * Replaces characters outside [a-zA-Z0-9._\-/] with underscores.
 * Collapses multiple consecutive underscores.
 * Preserves directory separators /.
 */
export function sanitizeStoragePath(relativePath: string): string {
  return relativePath
    .replace(/[^a-zA-Z0-9._\-/]/g, "_")
    .replace(/_+/g, "_")
    .replace(/\/_/g, "/")
    .replace(/_\//g, "/");
}

/**
 * Analyzes a FileList/array produced by a webkitdirectory input.
 * Builds ClientEntries from first-level subdirectories.
 * Does NOT query Supabase — pure in-memory processing.
 */
export function analyzeFiles(files: File[]): FolderAnalysisResult {
  const clientMap = new Map<string, ClientEntry>();
  const ignoredFiles: string[] = [];
  let rootName = "";

  for (const file of files) {
    const rawPath: string =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? file.name;
    const segments = rawPath.split("/");

    // Root segment
    if (!rootName && segments.length > 0) rootName = segments[0];

    // Files directly in root (depth 1) — ignored
    if (segments.length < 3) {
      ignoredFiles.push(rawPath);
      continue;
    }

    const firstLevel = segments[1]; // client folder name

    // Skip system folders/files
    if (shouldIgnorePath(file.name) || shouldIgnorePath(firstLevel)) {
      ignoredFiles.push(rawPath);
      continue;
    }

    // Create ClientEntry if not yet seen
    if (!clientMap.has(firstLevel)) {
      clientMap.set(firstLevel, {
        folderName: firstLevel,
        normalizedName: normalizeText(firstLevel),
        status: "new",
        documents: [],
      });
    }

    const entry = clientMap.get(firstLevel)!;

    // relativePath keeps the full path from root for context, but
    // storage path will be built as: clientId / segments[1..].join('/')
    const docRelativePath = segments.slice(1).join("/");

    const validationResult = validateBulkFile(file);
    const docEntry: DocumentEntry = {
      file,
      relativePath: docRelativePath,
      originalName: file.name,
      status: validationResult ?? "pending",
    };

    entry.documents.push(docEntry);
  }

  // Mark empty clients
  const clients = Array.from(clientMap.values()).map((client) => {
    const hasPending = client.documents.some((d) => d.status === "pending");
    if (!hasPending && client.status === "new") {
      return { ...client, status: "empty" as ClientEntryStatus };
    }
    return client;
  });

  return { rootName, clients, ignoredFiles };
}

/**
 * Compares ClientEntries against existing DB clients to detect duplicates.
 * Mutates status in-place and returns the updated array.
 */
export function detectDuplicatesForClients(
  clients: ClientEntry[],
  existingClients: ClientRow[],
): ClientEntry[] {
  return clients.map((entry) => {
    if (entry.status !== "new") return entry;

    // Build a minimal form object for findClientDuplicates
    const fakeForm = {
      name: entry.folderName,
      document_type: "Otro",
      document_number: "",
      phone: "",
      whatsapp: "",
      email: "",
      occupation: "",
      process_type: "",
      status: "Activo",
      address: "",
      notes: "",
    };

    const matches = findClientDuplicates(fakeForm, existingClients);

    const exact = matches.find((m) => m.strength === "exact");
    const approx = matches.find((m) => m.strength === "approximate");

    if (exact) {
      return {
        ...entry,
        status: "duplicate_exact" as ClientEntryStatus,
        existingClientId: exact.clientId,
        existingClientName: exact.clientName,
        // Pre-select "use existing" as the safe default — staff can override in the preview.
        duplicateResolution: "use_existing" as DuplicateResolution,
      };
    }
    if (approx) {
      return {
        ...entry,
        status: "duplicate_approximate" as ClientEntryStatus,
        existingClientName: approx.clientName,
      };
    }
    return entry;
  });
}

// Re-export buildClientInitials so consumers only need this module
export { buildClientInitials };
