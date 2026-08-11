/**
 * zip-import/types.ts
 *
 * Tipos compartidos entre la UI y el servidor para el flujo de importación ZIP.
 */

import type { DuplicateMatch } from "./client-normalizer";

// ─── Acciones propuestas por el usuario para cada candidato ───────────────────

export type ClientImportAction =
  | "create" // Crear cliente nuevo
  | "link" // Vincular con cliente existente detectado
  | "skip" // Omitir este cliente
  | "review"; // Requiere revisión manual

// ─── Vista previa por cliente ─────────────────────────────────────────────────

export interface ClientPreviewItem {
  /** Índice dentro del array de candidatos */
  index: number;
  /** Nombre original de la carpeta en el ZIP */
  originalName: string;
  /** Nombre normalizado */
  normalizedName: string;
  /** Ruta de la carpeta en el ZIP */
  folderPath: string;
  /** Cantidad de archivos permitidos */
  allowedFileCount: number;
  /** Cantidad de archivos ignorados/no permitidos */
  ignoredFileCount: number;
  /** Cantidad de subcarpetas directas */
  subfolderCount: number;
  /** Tamaño total en bytes de los archivos permitidos */
  totalSize: number;
  /** Coincidencia con cliente existente en DB (null = ninguna) */
  existingMatch: DuplicateMatch | null;
  /** Acción propuesta/elegida por el usuario */
  action: ClientImportAction;
  /** ID del cliente al que vincular (solo si action = "link") */
  linkToClientId: string | null;
  /** Advertencias específicas de este candidato */
  warnings: string[];
}

// ─── Resumen del análisis ─────────────────────────────────────────────────────

export interface ZipAnalysisSummary {
  /** Nombre del archivo ZIP */
  fileName: string;
  /** Tamaño del archivo ZIP en bytes */
  fileSize: number;
  /** Total de entradas en el ZIP */
  totalEntries: number;
  /** ¿Hay carpeta contenedora externa? */
  hasOuterContainer: boolean;
  /** Nombre de la contenedora */
  containerName: string | null;
  /** Vista previa de clientes candidatos */
  clients: ClientPreviewItem[];
  /** Advertencias globales */
  warnings: string[];
  /** Violaciones de seguridad detectadas */
  securityViolations: string[];
  /** Cantidad de entradas ignoradas */
  ignoredCount: number;
}

// ─── Resultado del dry-run ────────────────────────────────────────────────────

export interface DryRunClientResult {
  originalName: string;
  action: ClientImportAction;
  linkToClientId: string | null;
  /** Documentos que se subirían */
  documentsToUpload: Array<{
    relativePath: string;
    originalName: string;
    size: number;
    extension: string;
    mimeType: string;
  }>;
  /** Documentos que se omitirían por duplicado */
  documentsSkipped: number;
  warnings: string[];
}

export interface DryRunResult {
  /** Clientes que se crearían */
  clientsToCreate: number;
  /** Clientes que se vincularían */
  clientsToLink: number;
  /** Clientes omitidos */
  clientsToSkip: number;
  /** Total de archivos que se subirían */
  filesToUpload: number;
  /** Total de archivos que se omitirían */
  filesToSkip: number;
  /** Tamaño total en bytes */
  totalSize: number;
  /** Detalle por cliente */
  clientResults: DryRunClientResult[];
  warnings: string[];
}

// ─── Progreso de importación ──────────────────────────────────────────────────

export interface ImportProgressUpdate {
  stage: "clients" | "documents" | "finalizing";
  /** Nombre del cliente actual */
  currentClient: string;
  /** Nombre del archivo actual */
  currentFile: string;
  /** Clientes completados */
  clientsDone: number;
  /** Total de clientes a procesar */
  clientsTotal: number;
  /** Documentos subidos */
  documentsDone: number;
  /** Total de documentos a subir */
  documentsTotal: number;
  /** Errores acumulados */
  errors: string[];
  /** Porcentaje 0-100 */
  percent: number;
}

// ─── Resultado final de la importación ───────────────────────────────────────

export interface ImportJobResult {
  importJobId: string;
  clientsCreated: number;
  clientsLinked: number;
  clientsSkipped: number;
  documentsUploaded: number;
  documentsSkipped: number;
  documentsWithErrors: number;
  errors: Array<{ client: string; file: string; message: string }>;
  warnings: string[];
  /** Segundos totales de la importación */
  durationSeconds: number;
}

// ─── Payload que se envía al server function ─────────────────────────────────

export interface ZipImportServerPayload {
  /** JWT del usuario (para validar en servidor) */
  accessToken: string;
  /** Nombre del archivo ZIP */
  zipFileName: string;
  /** Contenido del ZIP como base64 (se envía solo en el server function, no en dryRun) */
  zipBase64?: string;
  /** Decisiones del usuario por cada candidato */
  clients: Array<{
    originalName: string;
    normalizedName: string;
    folderPath: string;
    action: ClientImportAction;
    linkToClientId: string | null;
  }>;
  /** Si es true, no crea nada (dry-run) */
  dryRun: boolean;
}
