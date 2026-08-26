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
import { createHash } from "node:crypto";
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
      upload: (
        path: string,
        body: Uint8Array,
        options: { contentType: string; upsert: boolean },
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
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

// ── Fase 8E: verificación e idempotencia de escritura (Drive -> CRM) ──────

/**
 * MD5 de los bytes descargados, para verificar contra `md5Checksum` de
 * Drive cuando lo devuelve (Fase 8E Sección 21). El Web Crypto estándar
 * (`crypto.subtle`) no implementa MD5 -- solo SHA-1/256/384/512 --, así que
 * aquí se usa `node:crypto`, ya habilitado en este proyecto vía
 * `nodejs_compat` (ver wrangler.toml). Es un uso puntual y aislado, exigido
 * por el propio contrato de la API de Drive, no una migración general del
 * proyecto a Node crypto.
 *
 * Este MD5 es EXCLUSIVAMENTE para verificar la integridad de la descarga
 * contra lo que reporta Google. El baseline propio del CRM sigue siendo
 * `sha256Hex` -- nunca se sustituye uno por otro (Sección 21 del pedido).
 */
export function md5Hex(bytes: Uint8Array): string {
  return createHash("md5").update(bytes).digest("hex");
}

/** "123 KB" / "4.5 MB" -- mismo formato que ya usa la subida manual del CRM. */
export function formatDocumentSizeLabel(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type StorageWriteOutcome =
  | { kind: "written"; path: string; contentHash: string }
  | { kind: "reused"; path: string; contentHash: string }
  | { kind: "conflict"; path: string };

/**
 * Escribe el blob descargado de Drive en Storage de forma segura ante
 * reintentos (Fase 8E Sección 24-25).
 *
 * `upsert: false` siempre: nunca se sobrescribe en silencio. Si el path
 * reservado YA tiene un objeto -- porque un intento anterior subió los
 * bytes y el proceso murió antes de finalizar el documento en la base de
 * datos -- se lee ese objeto existente y se compara su SHA-256 contra
 * `expectedContentHash`:
 *
 *   - coincide: el objeto es exactamente el que este intento iba a subir.
 *     Se reutiliza tal cual, sin volver a escribir nada
 *     (`{ kind: "reused" }`), y el llamador puede seguir directo a
 *     finalizar el documento en la base de datos.
 *   - no coincide: alguien más ocupa ese path con contenido distinto.
 *     `{ kind: "conflict" }` -- el llamador lo traduce a
 *     `STORAGE_IMPORT_IDENTITY_CONFLICT` y NUNCA sobrescribe.
 *
 * El resultado siempre incluye `path` y (salvo conflicto) `contentHash`: si
 * más adelante la finalización en base de datos pierde una carrera de forma
 * PERMANENTE, quien llama necesita saber exactamente qué objeto quedó
 * reservado para decidir si compensarlo (Fase 8E.1 Sección 9) -- nunca debe
 * inferirlo de nuevo ni asumirlo a partir de variables externas a este
 * resultado.
 */
export async function writeDocumentToStorageIdempotent(
  db: StorageClientLike,
  storagePath: string,
  bytes: Uint8Array,
  contentType: string,
  expectedContentHash: string,
): Promise<StorageWriteOutcome> {
  const { error } = await db.storage
    .from(DOCUMENTS_STORAGE_BUCKET)
    .upload(storagePath, bytes, { contentType, upsert: false });
  if (!error) return { kind: "written", path: storagePath, contentHash: expectedContentHash };

  // Supabase Storage no expone un código de error tipado y estable para
  // "ya existe" en todas sus versiones; se detecta por el texto del
  // mensaje, que es lo único disponible de forma consistente.
  if (!/already exists|duplicate/i.test(error.message)) throw new Error(error.message);

  const { data: existing, error: downloadError } = await db.storage
    .from(DOCUMENTS_STORAGE_BUCKET)
    .download(storagePath);
  if (downloadError || !existing) {
    // El upload dijo "ya existe" pero no se puede leer: no hay forma segura
    // de decidir, así que se trata como conflicto -- nunca se asume éxito.
    return { kind: "conflict", path: storagePath };
  }
  const existingBytes = new Uint8Array(await existing.arrayBuffer());
  const existingHash = await sha256Hex(existingBytes);
  return existingHash === expectedContentHash
    ? { kind: "reused", path: storagePath, contentHash: existingHash }
    : { kind: "conflict", path: storagePath };
}
