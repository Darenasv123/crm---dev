/**
 * Fase 8D — lectura server-side del contenido de un documento.
 *
 * El worker de subida necesita los bytes reales del archivo. Los obtiene con
 * el service role directamente desde Supabase Storage: nunca genera una
 * signed URL (sería una credencial temporal innecesaria que podría acabar en
 * un log) y nunca pasa el contenido al navegador.
 *
 * Reaplica las MISMAS restricciones documentales que la subida manual
 * (extensiones permitidas y límite de 10 MB, reutilizando
 * validateDocumentFile). Un documento que entró por una ruta secundaria y no
 * las cumple no se sube a Drive: la integración no puede ser un atajo para
 * saltarse las reglas del CRM.
 */
import { validateDocumentFile } from "@/hooks/use-documents";

export const DOCUMENTS_STORAGE_BUCKET = "documents";

export interface DocumentContent {
  bytes: Uint8Array;
  contentType: string;
  /** SHA-256 en hexadecimal de los bytes tal cual se suben. */
  contentHash: string;
}

/**
 * Hash local del contenido. Se calcula sobre los bytes que realmente se
 * envían, no sobre lo que Drive diga después: `md5Checksum` de Drive no
 * existe para todos los tipos de archivo y, aunque existiera, confiar solo
 * en el checksum del otro lado dejaría el baseline a merced de un sistema
 * externo.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

interface StorageClientLike {
  storage: {
    from: (bucket: string) => {
      download: (path: string) => Promise<{ data: Blob | null; error: { message: string } | null }>;
    };
  };
}

/**
 * Descarga el contenido de un documento y valida que siga cumpliendo las
 * reglas documentales del CRM.
 */
export async function readDocumentContent(
  db: StorageClientLike,
  document: {
    name: string;
    storage_path: string;
    file_size?: number | null;
    mime_type?: string | null;
  },
): Promise<DocumentContent> {
  if (!document.storage_path) {
    throw new Error("El documento no tiene un archivo asociado en el almacenamiento.");
  }

  const { data, error } = await db.storage
    .from(DOCUMENTS_STORAGE_BUCKET)
    .download(document.storage_path);
  if (error || !data) {
    throw new Error("No se pudo leer el archivo del documento desde el almacenamiento.");
  }

  const bytes = new Uint8Array(await data.arrayBuffer());

  // Mismas reglas que la subida manual, aplicadas sobre el tamaño REAL
  // descargado y no sobre el que dijera la fila de la base de datos.
  validateDocumentFile({
    name: document.name,
    size: bytes.length,
    type: document.mime_type ?? "",
  });

  return {
    bytes,
    contentType: document.mime_type || "application/octet-stream",
    contentHash: await sha256Hex(bytes),
  };
}
