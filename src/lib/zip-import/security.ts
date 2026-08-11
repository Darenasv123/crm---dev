/**
 * zip-import/security.ts
 *
 * Validaciones de seguridad para archivos ZIP antes de procesar su contenido.
 * Protege contra: Zip Slip, path traversal, ZIP bombs, profundidad excesiva,
 * archivos ocultos/ejecutables/simbólicos, nombres maliciosos y entradas excesivas.
 */

/** Tamaño máximo del archivo ZIP comprimido: 1 GiB exacto. */
export const MAX_ZIP_SIZE_BYTES = 1024 * 1024 * 1024;

export const ZIP_SECURITY_LIMITS = {
  /** Máximo tamaño del ZIP comprimido (1 GiB). */
  MAX_COMPRESSED_BYTES: MAX_ZIP_SIZE_BYTES,
  /** Máximo tamaño descomprimido total (500 MB) */
  MAX_UNCOMPRESSED_BYTES: 500 * 1024 * 1024,
  /** Máximo número de entradas en el ZIP */
  MAX_ENTRIES: 5_000,
  /** Máxima profundidad de directorio */
  MAX_DEPTH: 15,
  /** Máxima longitud de un segmento de nombre */
  MAX_NAME_SEGMENT_LENGTH: 255,
  /** Máxima longitud de la ruta completa */
  MAX_PATH_LENGTH: 1024,
  /** Ratio máximo de compresión (indicio de ZIP bomb) */
  MAX_COMPRESSION_RATIO: 100,
  /** Mínimo tamaño comprimido para aplicar ratio check */
  RATIO_MIN_COMPRESSED_SIZE: 512,
};

/** Extensiones de archivo ejecutables o peligrosas que se rechazan */
const DANGEROUS_EXTENSIONS = new Set([
  "exe",
  "bat",
  "cmd",
  "com",
  "msi",
  "dll",
  "so",
  "dylib",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  "psm1",
  "psd1",
  "vbs",
  "vba",
  "js",
  "ts",
  "jsx",
  "tsx",
  "mjs",
  "cjs",
  "py",
  "rb",
  "pl",
  "php",
  "java",
  "class",
  "jar",
  "war",
  "app",
  "dmg",
  "pkg",
  "deb",
  "rpm",
  "snap",
  "lnk",
  "url",
  "scf",
  "inf",
  "reg",
  "html",
  "htm",
  "svg", // potencial XSS si se sirven directamente
]);

/** Entradas a ignorar silenciosamente (metadatos del sistema) */
const IGNORED_NAMES = new Set([
  ".ds_store",
  "thumbs.db",
  "desktop.ini",
  ".dropbox",
  ".spotlight-v100",
  ".fseventsd",
  ".trashes",
  ".localized",
  "icon\r",
]);

const IGNORED_PREFIXES = ["__macosx/", "."];

/**
 * Determina si una entrada del ZIP debe ignorarse silenciosamente.
 */
export function shouldIgnoreEntry(relativePath: string): boolean {
  const normalized = relativePath.toLowerCase().replace(/\\/g, "/");

  // Carpeta __MACOSX y todo lo que esté dentro
  if (normalized.startsWith("__macosx/") || normalized === "__macosx") return true;

  // Archivos que empiezan con ._  (metadatos macOS)
  const baseName = normalized.split("/").pop() ?? "";
  if (baseName.startsWith("._")) return true;
  if (IGNORED_NAMES.has(baseName)) return true;

  // Carpeta oculta en cualquier nivel
  for (const segment of normalized.split("/")) {
    if (segment !== "" && segment.startsWith(".")) return true;
  }

  return false;
}

export type PathSafetyResult = { safe: true } | { safe: false; reason: string };

/**
 * Valida que una ruta de entrada del ZIP sea segura.
 * Protege contra Zip Slip, rutas absolutas, path traversal y nombres maliciosos.
 */
export function validateEntryPath(entryPath: string): PathSafetyResult {
  // Sin nombre
  if (!entryPath || entryPath.trim() === "") {
    return { safe: false, reason: "Entrada con nombre vacío." };
  }

  // Ruta absoluta (Windows o Unix)
  if (/^[a-z]:[/\\]/i.test(entryPath) || entryPath.startsWith("/")) {
    return { safe: false, reason: `Ruta absoluta no permitida: "${entryPath}".` };
  }

  // Path traversal
  const normalized = entryPath.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  for (const seg of segments) {
    if (seg === ".." || seg === ".") {
      return { safe: false, reason: `Segmento peligroso "${seg}" en ruta: "${entryPath}".` };
    }
  }

  // Longitud de segmento
  for (const seg of segments) {
    if (seg.length > ZIP_SECURITY_LIMITS.MAX_NAME_SEGMENT_LENGTH) {
      return {
        safe: false,
        reason: `Nombre demasiado largo (${seg.length} chars): "${seg.slice(0, 40)}…"`,
      };
    }
  }

  // Longitud total
  if (entryPath.length > ZIP_SECURITY_LIMITS.MAX_PATH_LENGTH) {
    return { safe: false, reason: `Ruta demasiado larga (${entryPath.length} chars).` };
  }

  // Profundidad
  if (segments.length > ZIP_SECURITY_LIMITS.MAX_DEPTH) {
    return {
      safe: false,
      reason: `Profundidad excesiva (${segments.length} niveles). Máximo: ${ZIP_SECURITY_LIMITS.MAX_DEPTH}.`,
    };
  }

  // Null bytes
  if (entryPath.includes("\0")) {
    return { safe: false, reason: "Ruta con carácter nulo." };
  }

  return { safe: true };
}

/**
 * Determina si una extensión de archivo es peligrosa (ejecutable/script).
 */
export function isDangerousExtension(fileName: string): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return DANGEROUS_EXTENSIONS.has(ext);
}

export interface ZipBombCheckInput {
  compressedSize: number;
  uncompressedSize: number;
}

/**
 * Detecta posible ZIP bomb basándose en el ratio de compresión.
 */
export function detectZipBomb(input: ZipBombCheckInput): boolean {
  if (input.compressedSize < ZIP_SECURITY_LIMITS.RATIO_MIN_COMPRESSED_SIZE) return false;
  if (input.uncompressedSize <= 0) return false;
  const ratio = input.uncompressedSize / input.compressedSize;
  return ratio > ZIP_SECURITY_LIMITS.MAX_COMPRESSION_RATIO;
}
