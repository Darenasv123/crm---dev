import * as mammoth from "mammoth";
import type { Database } from "@/lib/database.types";
import { supabase } from "@/lib/supabase";

type StoredDocument = Pick<
  Database["public"]["Tables"]["documents"]["Row"],
  "name" | "original_name" | "mime_type" | "storage_path"
>;

export type DocumentPreview =
  | { kind: "pdf"; name: string; url: string }
  | { kind: "image"; name: string; url: string }
  | { kind: "text"; name: string; url: string }
  | { kind: "docx"; name: string; html: string }
  | { kind: "unsupported"; name: string; message: string };

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"]);

function extensionOf(document: StoredDocument): string {
  return documentFileName(document).split(".").pop()?.toLowerCase() ?? "";
}

export function documentFileName(document: Pick<StoredDocument, "name" | "original_name">) {
  return document.original_name?.trim() || document.name.trim() || "documento";
}

export function documentPreviewKind(document: StoredDocument): DocumentPreview["kind"] {
  const extension = extensionOf(document);
  const mimeType = document.mime_type?.toLowerCase() ?? "";

  if (extension === "pdf") return "pdf";
  if (extension === "docx") return "docx";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (extension === "txt") return "text";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.includes("wordprocessingml.document")) return "docx";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("text/plain")) return "text";
  return "unsupported";
}

async function downloadStoredDocument(document: StoredDocument): Promise<Blob> {
  const { data, error } = await supabase.storage.from("documents").download(document.storage_path);
  if (error || !data) {
    throw new Error("No se pudo obtener el documento. Verifica tu acceso e inténtalo nuevamente.");
  }

  if (!data.type && document.mime_type) {
    return new Blob([data], { type: document.mime_type });
  }
  return data;
}

export async function previewDocument(document: StoredDocument): Promise<DocumentPreview> {
  const name = documentFileName(document);
  const kind = documentPreviewKind(document);

  if (kind === "unsupported") {
    return {
      kind,
      name,
      message: "Este formato no admite vista previa. Puedes descargar el archivo para abrirlo.",
    };
  }

  const blob = await downloadStoredDocument(document);
  if (kind === "docx") {
    try {
      const result = await mammoth.convertToHtml(
        { arrayBuffer: await blob.arrayBuffer() },
        { convertImage: mammoth.images.dataUri },
      );
      return { kind, name, html: result.value };
    } catch {
      throw new Error("No se pudo generar la vista previa del documento DOCX.");
    }
  }

  return { kind, name, url: URL.createObjectURL(blob) };
}

export function releaseDocumentPreview(preview: DocumentPreview | null) {
  if (preview && "url" in preview) URL.revokeObjectURL(preview.url);
}

/**
 * Filtra documentos relacionados con un cliente: los asignados directamente
 * al cliente y los asignados a cualquiera de sus expedientes.
 * Centraliza una lógica que antes estaba duplicada en varias pantallas.
 */
export function filterDocumentsByClient<
  T extends { client_id: string | null; case_id: string | null },
>(documents: T[], clientId: string, clientCaseIds: Iterable<string>): T[] {
  const caseIdSet = clientCaseIds instanceof Set ? clientCaseIds : new Set(clientCaseIds);
  return documents.filter(
    (item) => item.client_id === clientId || (item.case_id ? caseIdSet.has(item.case_id) : false),
  );
}

/** Filtra documentos relacionados con un expediente específico. */
export function filterDocumentsByCase<T extends { case_id: string | null }>(
  documents: T[],
  caseId: string,
): T[] {
  return documents.filter((item) => item.case_id === caseId);
}

export async function downloadDocument(document: StoredDocument): Promise<void> {
  const blob = await downloadStoredDocument(document);
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = documentFileName(document);
  anchor.style.display = "none";
  window.document.body.appendChild(anchor);

  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
}
