/**
 * analyze-relative-paths.ts
 *
 * Análisis PURO de relative_path → carpetas lógicas.
 * No realiza ninguna consulta a Supabase.
 * Estas funciones son 100% testables sin mocks.
 *
 * Usado por el dry-run de la herramienta de migración documental.
 */

import { normalizeFolderName, validateFolderName } from "@/lib/folder-utils";

// ─── Tipos ────────────────────────────────────────────────────────────────────

/** Estado de un ítem del plan de migración. */
export type MigrationAction =
  | "migrate" // se migrará: tiene segmentos de carpeta válidos
  | "skip_already_migrated" // ya tiene folder_id
  | "skip_no_path" // relative_path nulo o vacío
  | "skip_root" // solo nombre de archivo, sin segmentos de carpeta
  | "invalid"; // ruta con errores (../, caracteres prohibidos, etc.)

/** Caracteres prohibidos en un segmento de carpeta. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[<>:"|?*\x00-\x1f]/;
const MAX_SEGMENT_LENGTH = 120;
const MAX_SEGMENTS = 10;

/** Resultado del análisis de una ruta individual. */
export interface PathAnalysisItem {
  documentId: string;
  clientId: string;
  originalRelativePath: string | null;
  /** Ruta normalizada: separadores unificados, segmentos vacíos eliminados. */
  normalizedPath: string;
  /** Segmentos de carpeta (todos excepto el último = nombre de archivo). */
  folderSegments: string[];
  /** Nombre normalizado de cada segmento (para comparar con normalized_name en BD). */
  normalizedSegments: string[];
  /** Ruta lógica destino: segmentos de carpeta separados por ` / `. */
  targetFolderPath: string;
  action: MigrationAction;
  warnings: string[];
  errors: string[];
}

/** Resultado completo del dry-run para un conjunto de documentos. */
export interface DryRunPlan {
  clientId: string;
  /** Timestamp del análisis. */
  analyzedAt: string;
  documentsAnalyzed: number;
  documentsAlreadyMigrated: number;
  documentsWithoutPath: number;
  documentsAtRoot: number;
  documentsPendingMigration: number;
  documentsInvalid: number;
  /** Carpetas únicas que se crearían (rutas lógicas). */
  foldersToCreate: string[];
  /** Total de carpetas únicas detectadas como objetivo (pendientes y que requerirían creación). */
  totalUniqueFolderPaths: number;
  items: PathAnalysisItem[];
  totalWarnings: number;
  totalErrors: number;
}

// ─── Análisis de una ruta individual ─────────────────────────────────────────

/**
 * Normaliza una ruta relative_path:
 * - Sustituye separadores `\` por `/`
 * - Elimina segmentos vacíos y puntos simples `.`
 * - Detecta y rechaza segmentos `..`
 */
export function normalizeRelativePath(rawPath: string): {
  normalized: string;
  segments: string[];
  error: string | null;
} {
  // Unify separators
  const unified = rawPath.replace(/\\/g, "/");
  const rawSegments = unified.split("/").filter((s) => s.length > 0);

  // Detect traversal
  if (rawSegments.some((s) => s === "..")) {
    return {
      normalized: unified,
      segments: [],
      error: 'Ruta inválida: contiene segmentos ".." de traversal.',
    };
  }

  // Filter out single dots
  const segments = rawSegments.filter((s) => s !== ".");

  if (segments.length === 0) {
    return { normalized: "", segments: [], error: "Ruta vacía después de normalizar." };
  }

  return { normalized: segments.join("/"), segments, error: null };
}

/**
 * Valida un segmento individual de ruta de carpeta.
 * Retorna error string o null.
 */
export function validatePathSegment(segment: string): string | null {
  const trimmed = segment.trim();
  if (!trimmed) return "Segmento vacío.";
  if (trimmed.length > MAX_SEGMENT_LENGTH) {
    return `Segmento demasiado largo (>${MAX_SEGMENT_LENGTH} caracteres): "${trimmed.slice(0, 30)}…"`;
  }
  if (FORBIDDEN_CHARS.test(trimmed)) {
    return `Segmento contiene caracteres prohibidos: "${trimmed}"`;
  }
  // Re-use folder name validator for the rest of the checks
  const nameErr = validateFolderName(trimmed);
  if (nameErr) return nameErr;
  return null;
}

/**
 * Analiza un solo documento y produce un PathAnalysisItem.
 * Función pura — no consulta Supabase.
 */
export function analyzeDocumentPath(params: {
  documentId: string;
  clientId: string;
  relativePath: string | null;
  folderId: string | null;
}): PathAnalysisItem {
  const { documentId, clientId, relativePath, folderId } = params;
  const warnings: string[] = [];
  const errors: string[] = [];

  // Ya migrado
  if (folderId !== null) {
    return {
      documentId,
      clientId,
      originalRelativePath: relativePath,
      normalizedPath: relativePath ?? "",
      folderSegments: [],
      normalizedSegments: [],
      targetFolderPath: "",
      action: "skip_already_migrated",
      warnings,
      errors,
    };
  }

  // Sin ruta
  if (!relativePath || relativePath.trim() === "") {
    return {
      documentId,
      clientId,
      originalRelativePath: relativePath,
      normalizedPath: "",
      folderSegments: [],
      normalizedSegments: [],
      targetFolderPath: "",
      action: "skip_no_path",
      warnings,
      errors,
    };
  }

  const { normalized, segments, error: normError } = normalizeRelativePath(relativePath);

  if (normError) {
    errors.push(normError);
    return {
      documentId,
      clientId,
      originalRelativePath: relativePath,
      normalizedPath: normalized,
      folderSegments: [],
      normalizedSegments: [],
      targetFolderPath: "",
      action: "invalid",
      warnings,
      errors,
    };
  }

  // Solo nombre de archivo (sin carpeta)
  if (segments.length <= 1) {
    return {
      documentId,
      clientId,
      originalRelativePath: relativePath,
      normalizedPath: normalized,
      folderSegments: [],
      normalizedSegments: [],
      targetFolderPath: "",
      action: "skip_root",
      warnings,
      errors,
    };
  }

  // Extraer segmentos de carpeta (todos excepto el último = nombre de archivo)
  const folderSegments = segments.slice(0, -1);

  if (folderSegments.length > MAX_SEGMENTS) {
    warnings.push(
      `Ruta con ${folderSegments.length} niveles de profundidad (máximo recomendado: ${MAX_SEGMENTS}).`,
    );
  }

  // Validar cada segmento
  const validatedSegments: string[] = [];
  let hasInvalidSegment = false;

  for (const seg of folderSegments) {
    const segError = validatePathSegment(seg);
    if (segError) {
      errors.push(`Segmento inválido "${seg}": ${segError}`);
      hasInvalidSegment = true;
    } else {
      validatedSegments.push(seg);
    }
  }

  if (hasInvalidSegment) {
    return {
      documentId,
      clientId,
      originalRelativePath: relativePath,
      normalizedPath: normalized,
      folderSegments,
      normalizedSegments: folderSegments.map(normalizeFolderName),
      targetFolderPath: folderSegments.join(" / "),
      action: "invalid",
      warnings,
      errors,
    };
  }

  const normalizedSegments = validatedSegments.map(normalizeFolderName);

  // Detectar segmentos repetidos vacíos (ya filtrados, pero asegurar)
  if (normalizedSegments.some((s) => s === "")) {
    errors.push("Segmento normalizado vacío.");
    return {
      documentId,
      clientId,
      originalRelativePath: relativePath,
      normalizedPath: normalized,
      folderSegments,
      normalizedSegments,
      targetFolderPath: folderSegments.join(" / "),
      action: "invalid",
      warnings,
      errors,
    };
  }

  return {
    documentId,
    clientId,
    originalRelativePath: relativePath,
    normalizedPath: normalized,
    folderSegments,
    normalizedSegments,
    targetFolderPath: folderSegments.join(" / "),
    action: "migrate",
    warnings,
    errors,
  };
}

// ─── Dry-run plan builder ─────────────────────────────────────────────────────

/** Input: lista plana de documentos a analizar. */
export interface DocumentInput {
  id: string;
  client_id: string;
  relative_path: string | null;
  folder_id: string | null;
}

/**
 * Construye un plan completo de migración sin tocar Supabase.
 * Función pura — devuelve un DryRunPlan.
 */
export function buildDryRunPlan(clientId: string, documents: DocumentInput[]): DryRunPlan {
  const items = documents.map((doc) =>
    analyzeDocumentPath({
      documentId: doc.id,
      clientId: doc.client_id,
      relativePath: doc.relative_path,
      folderId: doc.folder_id,
    }),
  );

  const pendingItems = items.filter((i) => i.action === "migrate");
  const uniqueFolderPaths = new Set<string>();
  for (const item of pendingItems) {
    // Register all intermediate paths
    for (let i = 1; i <= item.folderSegments.length; i++) {
      uniqueFolderPaths.add(item.folderSegments.slice(0, i).join(" / "));
    }
  }

  return {
    clientId,
    analyzedAt: new Date().toISOString(),
    documentsAnalyzed: items.length,
    documentsAlreadyMigrated: items.filter((i) => i.action === "skip_already_migrated").length,
    documentsWithoutPath: items.filter((i) => i.action === "skip_no_path").length,
    documentsAtRoot: items.filter((i) => i.action === "skip_root").length,
    documentsPendingMigration: pendingItems.length,
    documentsInvalid: items.filter((i) => i.action === "invalid").length,
    foldersToCreate: Array.from(uniqueFolderPaths).sort(),
    totalUniqueFolderPaths: uniqueFolderPaths.size,
    items,
    totalWarnings: items.reduce((acc, i) => acc + i.warnings.length, 0),
    totalErrors: items.reduce((acc, i) => acc + i.errors.length, 0),
  };
}
