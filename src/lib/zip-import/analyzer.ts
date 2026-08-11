/**
 * zip-import/analyzer.ts
 *
 * Análisis de la estructura de un archivo ZIP para detectar:
 *  - Carpeta contenedora externa (raíz única)
 *  - Carpetas agrupadoras (no son clientes)
 *  - Carpetas de clientes reales
 *  - Subcarpetas documentales dentro de cada cliente
 *  - Documentos por cliente
 *
 * NO hace ninguna operación de red ni de base de datos.
 * Recibe la lista de entradas JSZip y devuelve un resultado tipado.
 */

import { shouldIgnoreEntry, validateEntryPath, isDangerousExtension } from "./security";
import { normalizeClientName } from "./client-normalizer";

/** Extensiones aceptadas para documentos */
export const ALLOWED_DOC_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "jpg",
  "jpeg",
  "png",
  "txt",
]);

/** Nombres que identifican carpetas agrupadoras (no clientes) */
const GROUPER_PATTERNS = [
  /^clientes(?:\s+\d+)?$/i,
  /^expedientes?$/i,
  /^archivos?$/i,
  /^documentos?$/i,
  /^nuevos?$/i,
  /^antiguos?$/i,
  /^[a-z]\s*-\s*clientes?(\s|$)/i,
];

/**
 * Detecta si un nombre de carpeta corresponde a un agrupador (no a un cliente real).
 */
export function isGrouperFolder(name: string): boolean {
  const trimmed = name.trim();
  for (const pattern of GROUPER_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  return false;
}

/** Entrada sin procesar del ZIP */
export interface RawZipEntry {
  /** Ruta completa dentro del ZIP, separadores "/" */
  path: string;
  /** Es directorio */
  isDirectory: boolean;
  /** Tamaño descomprimido en bytes */
  size: number;
  /** Función para leer el contenido como ArrayBuffer (solo para archivos) */
  getData?: () => Promise<ArrayBuffer>;
}

/** Documento detectado dentro de un cliente */
export interface DetectedDocument {
  originalName: string;
  relativePath: string;
  fullZipPath: string;
  size: number;
  extension: string;
  mimeType: string;
  allowed: boolean;
  getData?: () => Promise<ArrayBuffer>;
}

/** Candidato a cliente detectado en el ZIP */
export interface DetectedClient {
  originalName: string;
  normalizedName: string;
  folderPath: string;
  documents: DetectedDocument[];
  totalFiles: number;
  subfolderCount: number;
  totalSize: number;
  warnings: string[];
}

/** Entrada ignorada durante el análisis */
export interface IgnoredEntry {
  path: string;
  reason:
    | "system_file"
    | "dangerous_extension"
    | "security_violation"
    | "empty_folder"
    | "disallowed_extension";
}

/** Resultado completo del análisis del ZIP */
export interface ZipAnalysisResult {
  clients: DetectedClient[];
  ignored: IgnoredEntry[];
  warnings: string[];
  securityViolations: string[];
  totalEntries: number;
  hasOuterContainer: boolean;
  containerName: string | null;
}

// ─── MIME types ───────────────────────────────────────────────────────────────

const MIME_MAP: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  txt: "text/plain",
};

function mimeForExtension(ext: string): string {
  return MIME_MAP[ext.toLowerCase()] ?? "application/octet-stream";
}

// ─── Helpers de ruta ──────────────────────────────────────────────────────────

/** Normaliza separadores a "/" y elimina trailing slash */
function normPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** Segmentos no vacíos */
function segs(p: string): string[] {
  return normPath(p).split("/").filter(Boolean);
}

/** ¿path está directamente dentro de parentPath? */
function isDirectChild(path: string, parentPath: string): boolean {
  const ps = segs(path);
  const pp = parentPath === "" ? [] : segs(parentPath);
  return ps.length === pp.length + 1 && ps.slice(0, pp.length).join("/") === pp.join("/");
}

/** ¿path está dentro de parentPath (a cualquier profundidad)? */
function isDescendant(path: string, parentPath: string): boolean {
  if (parentPath === "") return true;
  const np = normPath(path);
  const npp = normPath(parentPath);
  return np === npp || np.startsWith(npp + "/");
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Analiza la lista de entradas de un ZIP y devuelve los clientes detectados.
 *
 * Algoritmo en 5 pasos:
 *  1. Filtrar entradas por seguridad.
 *  2. Construir un inventario de carpetas implícitas (inferidas de los paths de archivos).
 *  3. Detectar carpeta contenedora externa.
 *  4. Identificar carpetas de clientes vs agrupadoras de forma recursiva.
 *  5. Construir DetectedClient con sus documentos y rutas relativas.
 */
export function analyzeZipEntries(entries: RawZipEntry[]): ZipAnalysisResult {
  const ignored: IgnoredEntry[] = [];
  const securityViolations: string[] = [];
  const warnings: string[] = [];

  // ── Paso 1: filtrar entradas seguras ──────────────────────────────────────
  const safeEntries: RawZipEntry[] = [];
  for (const entry of entries) {
    if (shouldIgnoreEntry(entry.path)) {
      ignored.push({ path: entry.path, reason: "system_file" });
      continue;
    }
    const check = validateEntryPath(entry.path);
    if (!check.safe) {
      securityViolations.push(check.reason);
      ignored.push({ path: entry.path, reason: "security_violation" });
      continue;
    }
    safeEntries.push({ ...entry, path: normPath(entry.path) });
  }

  const fileEntries = safeEntries.filter((e) => !e.isDirectory);

  if (fileEntries.length === 0) {
    return {
      clients: [],
      ignored,
      warnings: ["El ZIP no contiene archivos válidos."],
      securityViolations,
      totalEntries: entries.length,
      hasOuterContainer: false,
      containerName: null,
    };
  }

  // ── Paso 2: construir inventario de carpetas implícitas ───────────────────
  // Incluye TODAS las carpetas ancestras de cualquier archivo, incluso si no
  // existe una entrada de directorio explícita en el ZIP.
  const folderSet = new Set<string>();
  for (const f of fileEntries) {
    const parts = segs(f.path);
    // Agregar todas las carpetas ancestras (no el archivo mismo)
    for (let i = 1; i < parts.length; i++) {
      folderSet.add(parts.slice(0, i).join("/"));
    }
  }
  const allFolders = Array.from(folderSet);

  // ── Paso 3: detectar carpeta contenedora externa ──────────────────────────
  // Hay contenedora si todos los archivos tienen el mismo primer segmento de ruta
  // y no hay archivos directamente en la raíz (depth == 1).
  let containerName: string | null = null;
  let hasOuterContainer = false;

  const rootPrefixes = new Set(fileEntries.map((f) => segs(f.path)[0] ?? "").filter(Boolean));
  const filesAtRoot = fileEntries.filter((f) => segs(f.path).length === 1);

  const onlyRootPrefix = rootPrefixes.size === 1 ? [...rootPrefixes][0] : null;
  if (onlyRootPrefix && filesAtRoot.length === 0 && isGrouperFolder(onlyRootPrefix)) {
    containerName = onlyRootPrefix;
    hasOuterContainer = true;
  }

  // ── Paso 4: identificar carpetas de clientes ──────────────────────────────
  const rootContext = hasOuterContainer ? (containerName ?? "") : "";

  /**
   * Recorre la jerarquía de carpetas bajo `parentPath` para encontrar
   * carpetas de clientes (no agrupadoras, con al menos un archivo descendiente).
   */
  function collectClientPaths(parentPath: string): string[] {
    const directChildren = allFolders.filter((f) => isDirectChild(f, parentPath));
    const result: string[] = [];

    for (const child of directChildren) {
      const name = segs(child).pop() ?? "";
      const hasFiles = fileEntries.some((f) => isDescendant(f.path, child));
      if (!hasFiles) continue; // carpeta vacía — ignorar

      if (isGrouperFolder(name)) {
        // Descender transparentemente dentro del agrupador
        result.push(...collectClientPaths(child));
      } else {
        // Es una carpeta de cliente
        result.push(child);
      }
    }
    return result;
  }

  // ── Paso 5: construir DetectedClient ─────────────────────────────────────
  const clientPaths = collectClientPaths(rootContext);
  const clients: DetectedClient[] = [];

  for (const clientPath of clientPaths) {
    const originalName = segs(clientPath).pop() ?? clientPath;
    const normalizedName = normalizeClientName(originalName);
    const clientWarnings: string[] = [];
    const documents: DetectedDocument[] = [];
    let totalFiles = 0;

    // Subcarpetas directas del cliente
    const directSubFolders = allFolders.filter((f) => isDirectChild(f, clientPath));

    // Todos los archivos bajo este cliente
    for (const file of fileEntries) {
      if (!isDescendant(file.path, clientPath)) continue;

      totalFiles++;
      const fileName = segs(file.path).pop() ?? file.path;
      const ext = fileName.split(".").pop()?.toLowerCase() ?? "";

      if (isDangerousExtension(fileName)) {
        ignored.push({ path: file.path, reason: "dangerous_extension" });
        clientWarnings.push(`Archivo omitido (extensión peligrosa): ${fileName}`);
        continue;
      }

      const allowed = ALLOWED_DOC_EXTENSIONS.has(ext);
      if (!allowed) {
        ignored.push({ path: file.path, reason: "disallowed_extension" });
        clientWarnings.push(`Archivo omitido (formato no admitido): ${fileName}`);
      }

      // Ruta relativa desde la raíz del cliente
      const clientDepth = segs(clientPath).length;
      const relativeSegs = segs(file.path).slice(clientDepth);
      const relativePath = relativeSegs.join("/");

      documents.push({
        originalName: fileName,
        relativePath,
        fullZipPath: file.path,
        size: file.size,
        extension: ext,
        mimeType: mimeForExtension(ext),
        allowed,
        getData: allowed ? file.getData : undefined,
      });
    }

    if (originalName.length > 250) {
      clientWarnings.push(
        `Nombre muy largo (${originalName.length} chars). Verifique el límite de la base de datos.`,
      );
    }

    const allowedDocs = documents.filter((d) => d.allowed);
    const totalSize = allowedDocs.reduce((s, d) => s + d.size, 0);

    clients.push({
      originalName,
      normalizedName,
      folderPath: clientPath,
      documents,
      totalFiles,
      subfolderCount: directSubFolders.length,
      totalSize,
      warnings: clientWarnings,
    });
  }

  if (clients.length === 0 && fileEntries.length > 0) {
    warnings.push("No se detectaron carpetas de clientes válidas en el ZIP.");
  }

  return {
    clients,
    ignored,
    warnings,
    securityViolations,
    totalEntries: entries.length,
    hasOuterContainer,
    containerName,
  };
}
