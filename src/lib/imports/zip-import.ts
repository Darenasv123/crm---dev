/**
 * zip-import.ts
 * Lógica pura para importar carpetas de clientes desde un ZIP descargado
 * de Google Drive. Sin dependencias de React ni Supabase — 100% testeable.
 */

// JSZip está disponible como dependencia transitiva de ExcelJS
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — no hay @types/jszip separado; se importa desde jszip
import JSZip from "jszip";

// mammoth para extracción de texto DOCX
import mammoth from "mammoth";

// ─── Constantes ───────────────────────────────────────────────────────────────

/** Extensiones de archivo aceptadas por el módulo Documentos */
export const ALLOWED_EXTENSIONS = new Set([
  ".pdf",
  ".docx",
  ".doc",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".heic",
  ".txt",
  ".odt",
  ".rtf",
]);

/** Prefijos de carpeta/archivo que se deben ignorar (ocultos, sistema, Google Drive) */
const IGNORED_PREFIXES = [".", "__MACOSX", "Thumbs.db", "desktop.ini"];

/** Sufijos generados por Google Drive al comprimir carpetas */
const DRIVE_SUFFIXES = /\s*\(\d+\)$/;

/** Tipos de documento detectables por nombre de archivo */
const DOC_TYPE_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /DEMANDA/i, type: "DEMANDA" },
  { pattern: /CONTESTACI[OÓ]N/i, type: "CONTESTACIÓN" },
  { pattern: /ANEXO/i, type: "ANEXOS" },
  { pattern: /CARGO/i, type: "CARGO" },
  { pattern: /SENTENCIA/i, type: "SENTENCIA" },
  { pattern: /RESOLUCI[OÓ]N/i, type: "RESOLUCIÓN" },
  { pattern: /AUDIENCIA/i, type: "AUDIENCIA" },
  { pattern: /LIQUIDACI[OÓ]N/i, type: "LIQUIDACIÓN" },
  { pattern: /ESCRITO/i, type: "ESCRITO" },
  { pattern: /NOTIFICACI[OÓ]N/i, type: "NOTIFICACIÓN" },
];

// ─── Patrones de extracción de datos ──────────────────────────────────────────

const PATTERNS = {
  dni: /\bDNI[\s.:N°#]*([0-9]{8})\b/gi,
  phone: /(?:(?:cel(?:ular)?|tel(?:éfono)?|telf?\.?|móvil)[\s.:]*)?(\b9[0-9]{8}\b)/gi,
  email: /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/gi, // eslint-disable-line no-useless-escape
  expediente: /\b(?:EXP(?:EDIENTE)?\.?|N[°º]\.?\s*)([0-9]{4,5}-[0-9]{4}(?:-[A-Z0-9]+)*)\b/gi,
  expedienteAlt: /\b([0-9]{4,5}-[0-9]{4}-[A-Z0-9-]+)\b/g,
  juzgado:
    /(?:JUZGADO|SALA|CORTE)\s+(?:ESPECIALIZADO\s+)?(?:DE\s+)?(?:PAZ\s+LETRADO\s+)?(?:[A-ZÁÉÍÓÚÑ]+\s+){0,4}N[°º]?\s*\d+/gi,
  court: /(?:JUZGADO|SALA|CORTE)[^\n,;]{3,60}/gi,
  demandante:
    /(?:DEMANDANTE|ACTOR|ACTORA|PARTE\s+DEMANDANTE)\s*:?\s*([A-ZÁÉÍÓÚÑ][a-záéíóúñ\s]+(?:[A-ZÁÉÍÓÚÑ][a-záéíóúñ\s]+)*)/gi,
  demandado:
    /(?:DEMANDADO|EMPLAZADO|PARTE\s+DEMANDADA)\s*:?\s*([A-ZÁÉÍÓÚÑ][a-záéíóúñ\s]+(?:[A-ZÁÉÍÓÚÑ][a-záéíóúñ\s]+)*)/gi,
  fullName: /\b([A-ZÁÉÍÓÚÑ]{2,}(?:\s+[A-ZÁÉÍÓÚÑ]{2,}){1,4})\b/g,
  processType:
    /(?:MATERIA|PROCESO|TIPO DE PROCESO|VÍA PROCEDIMENTAL)\s*:?\s*([A-ZÁÉÍÓÚÑA-Za-záéíóúñ\s]+(?:DE\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ\s]+)?)/gi,
  stage:
    /(?:ETAPA|ESTADO\s+PROCESAL|ESTADO)\s*:?\s*(INICIAL|EN\s+TRAMITACIÓN|AUDIENCIA|SENTENCIA|APELACIÓN|EJECUCIÓN|LIQUIDACIÓN|ARCHIVADO)/gi,
  dates: /\b(\d{1,2})\s+(?:de\s+)?([A-Za-záéíóúñ]+)\s+(?:de\s+|del?\s+)?(\d{4})\b/gi,
};

// ─── Tipos públicos ────────────────────────────────────────────────────────────

export interface ZipFileEntry {
  /** Ruta completa dentro del ZIP */
  path: string;
  /** Nombre del archivo sin ruta */
  name: string;
  /** Extensión en minúsculas incluyendo el punto */
  ext: string;
  /** Tamaño en bytes */
  size: number;
  /** Contenido como ArrayBuffer */
  data: ArrayBuffer;
  /** Tipo de documento detectado */
  docType: string;
  /** Texto extraído (si aplica) */
  extractedText?: string;
  /** Estado de extracción */
  extractionStatus: "extracted" | "ocr_required" | "binary" | "empty" | "error";
  /** Hash SHA-256 para deduplicación */
  checksum: string;
  /** Ruta de origen dentro del ZIP (para registro) */
  zipPath: string;
}

export interface DetectedData {
  dni?: string;
  phone?: string;
  email?: string;
  expedientes: string[];
  processType?: string;
  juzgado?: string;
  demandante?: string;
  demandado?: string;
  stage?: string;
  relevantDates: string[];
  fullNameCandidates: string[];
}

export interface ClientCandidate {
  /** Nombre de la carpeta normalizado */
  folderName: string;
  /** Nombre propuesto del cliente */
  proposedName: string;
  /** Datos detectados en los documentos */
  detected: DetectedData;
  /** Archivos de esta carpeta */
  files: ZipFileEntry[];
  /** Advertencias */
  warnings: string[];
  /** Ruta de la carpeta dentro del ZIP */
  folderPath: string;
  /** Si fue excluido manualmente */
  excluded: boolean;
}

export type DuplicateAction = "create_new" | "update_existing" | "attach_docs" | "skip";

export interface DuplicateMatch {
  clientId: string;
  clientName: string;
  matchReason: string;
  matchStrength: "exact_dni" | "exact_name" | "name_phone" | "approximate";
}

export interface ReviewCandidate extends ClientCandidate {
  /** Duplicados encontrados en Supabase */
  duplicates: DuplicateMatch[];
  /** Acción seleccionada para el duplicado */
  duplicateAction?: DuplicateAction;
  /** ID del cliente existente si se eligió actualizar/adjuntar */
  existingClientId?: string;
  /** Ediciones manuales del usuario sobre los datos detectados */
  edits: Partial<{
    proposedName: string;
    dni: string;
    phone: string;
    email: string;
    processType: string;
    juzgado: string;
  }>;
  /** Archivos excluidos manualmente */
  excludedFiles: Set<string>;
}

export interface ZipParseResult {
  candidates: ClientCandidate[];
  /** Carpetas ignoradas (ocultas, sistema, etc.) */
  ignoredPaths: string[];
  /** Errores no fatales durante el parsing */
  parseErrors: Array<{ path: string; error: string }>;
}

// ─── Utilidades ───────────────────────────────────────────────────────────────

/** Computa SHA-256 de un ArrayBuffer y retorna hex string */
export async function sha256(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Normaliza un nombre de carpeta Google Drive */
export function normalizeFolderName(raw: string): string {
  return raw
    .replace(DRIVE_SUFFIXES, "") // "YLLA NEGRON (1)" → "YLLA NEGRON"
    .replace(/\s+/g, " ") // espacios múltiples → uno
    .trim();
}

/** Detecta si una ruta debe ignorarse */
export function shouldIgnorePath(pathSegment: string): boolean {
  return IGNORED_PREFIXES.some((p) => pathSegment.startsWith(p) || pathSegment === p);
}

/** Clasifica el tipo de documento por nombre de archivo */
export function classifyDocument(fileName: string): string {
  for (const { pattern, type } of DOC_TYPE_PATTERNS) {
    if (pattern.test(fileName)) return type;
  }
  return "OTROS";
}

/** Formatea bytes a string legible */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Extrae la primera coincidencia de un patrón con captura de grupo 1 */
function firstMatch(text: string, pattern: RegExp): string | undefined {
  pattern.lastIndex = 0;
  const m = pattern.exec(text);
  return m?.[1]?.trim();
}

/** Extrae todas las coincidencias únicas de un patrón con captura de grupo 1 */
function allMatches(text: string, pattern: RegExp): string[] {
  pattern.lastIndex = 0;
  const results = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    const val = m[1]?.trim();
    if (val && val.length > 2) results.add(val);
  }
  return Array.from(results);
}

/** Detecta si un PDF contiene texto seleccionable (heurística simple) */
function pdfHasSelectableText(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer);
  const text = new TextDecoder("latin1").decode(bytes.slice(0, Math.min(bytes.length, 32768)));
  // Los PDF con texto tienen streams con datos BT/ET (begin/end text)
  return text.includes("BT") && text.includes("ET") && text.includes("/Font");
}

/** Extrae texto de un PDF con texto seleccionable (sin OCR) */
async function extractPdfText(buffer: ArrayBuffer): Promise<string | null> {
  try {
    if (!pdfHasSelectableText(buffer)) return null;

    // Extracción básica de strings de texto de PDF
    const bytes = new Uint8Array(buffer);
    const raw = new TextDecoder("latin1").decode(bytes);

    // Extrae contenido de streams de texto (entre BT y ET)
    const textParts: string[] = [];
    const btEtPattern = /BT\s*([\s\S]*?)\s*ET/g;
    let m: RegExpExecArray | null;
    while ((m = btEtPattern.exec(raw)) !== null) {
      // Extrae strings entre paréntesis
      const streamContent = m[1];
      const stringPattern = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g;
      let sm: RegExpExecArray | null;
      while ((sm = stringPattern.exec(streamContent)) !== null) {
        const decoded = sm[1]
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "\r")
          .replace(/\\t/g, "\t")
          .replace(/\\\(/g, "(")
          .replace(/\\\)/g, ")")
          .replace(/\\\\/g, "\\");
        if (decoded.trim()) textParts.push(decoded);
      }
    }

    return textParts.length > 0 ? textParts.join(" ") : null;
  } catch {
    return null;
  }
}

/** Extrae texto de un DOCX usando mammoth */
async function extractDocxText(buffer: ArrayBuffer): Promise<string | null> {
  try {
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return result.value?.trim() || null;
  } catch {
    return null;
  }
}

/** Analiza el texto extraído y detecta datos del cliente/expediente */
export function analyzeText(text: string): DetectedData {
  const dni = firstMatch(text, PATTERNS.dni);
  const email = text.match(PATTERNS.email)?.[0];
  const processType = firstMatch(text, PATTERNS.processType);
  const juzgado = firstMatch(text, PATTERNS.court);
  const demandante = firstMatch(text, PATTERNS.demandante);
  const demandado = firstMatch(text, PATTERNS.demandado);
  const stage = firstMatch(text, PATTERNS.stage);

  // Teléfono: busca números que empiecen por 9 y tengan 9 dígitos
  const phoneMatch = text.match(/\b(9[0-9]{8})\b/);
  const phone = phoneMatch?.[1];

  // Expedientes
  const expedientes = new Set<string>([
    ...allMatches(text, PATTERNS.expediente),
    ...allMatches(text, PATTERNS.expedienteAlt),
  ]);

  // Fechas
  const relevantDates: string[] = [];
  PATTERNS.dates.lastIndex = 0;
  let dm: RegExpExecArray | null;
  while ((dm = PATTERNS.dates.exec(text)) !== null) {
    relevantDates.push(`${dm[1]} de ${dm[2]} de ${dm[3]}`);
    if (relevantDates.length >= 5) break;
  }

  // Candidatos de nombre completo (palabras en mayúsculas consecutivas)
  const fullNameCandidates = allMatches(text, PATTERNS.fullName).filter(
    (n) => n.split(" ").length >= 2 && n.split(" ").length <= 5,
  );

  return {
    dni,
    phone,
    email,
    expedientes: Array.from(expedientes),
    processType,
    juzgado,
    demandante,
    demandado,
    stage,
    relevantDates,
    fullNameCandidates,
  };
}

// ─── Parser principal del ZIP ─────────────────────────────────────────────────

/**
 * Descomprime un ZIP y construye candidatos de clientes.
 * Cada carpeta de primer nivel = candidato.
 * No guarda nada en Supabase — solo retorna la estructura analizada.
 */
export async function parseZipFile(
  zipBuffer: ArrayBuffer,
  onProgress?: (msg: string) => void,
): Promise<ZipParseResult> {
  const log = (msg: string) => onProgress?.(msg);

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipBuffer);
  } catch {
    throw new Error(
      "No se pudo leer el archivo ZIP. Puede estar corrupto o en un formato no compatible.",
    );
  }

  const ignoredPaths: string[] = [];
  const parseErrors: Array<{ path: string; error: string }> = [];

  // Mapea carpeta de primer nivel → archivos
  const folderMap = new Map<
    string,
    {
      folderPath: string;
      files: Array<{ zipPath: string; name: string; ext: string; zipFile: JSZip.JSZipObject }>;
    }
  >();

  // Recorre todas las entradas del ZIP
  zip.forEach((relativePath, zipFile) => {
    if (zipFile.dir) return; // carpetas se procesan implícitamente

    const parts = relativePath.split("/").filter(Boolean);
    if (parts.length === 0) return;

    // Ignora rutas ocultas/del sistema
    if (parts.some((p) => shouldIgnorePath(p))) {
      ignoredPaths.push(relativePath);
      return;
    }

    // La carpeta de primer nivel es el candidato de cliente
    const topFolder = parts[0];
    const fileName = parts[parts.length - 1];
    const ext = fileName.includes(".") ? "." + fileName.split(".").pop()!.toLowerCase() : "";

    // Solo procesa extensiones permitidas
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      ignoredPaths.push(relativePath);
      return;
    }

    if (!folderMap.has(topFolder)) {
      folderMap.set(topFolder, { folderPath: topFolder, files: [] });
    }

    folderMap.get(topFolder)!.files.push({
      zipPath: relativePath,
      name: fileName,
      ext,
      zipFile,
    });
  });

  // Procesa cada carpeta candidata
  const candidates: ClientCandidate[] = [];

  for (const [topFolder, { files }] of folderMap) {
    log(`Procesando carpeta: ${topFolder}`);

    const processedFiles: ZipFileEntry[] = [];
    const allExtractedText: string[] = [];
    const folderWarnings: string[] = [];

    for (const { zipPath, name, ext, zipFile } of files) {
      try {
        const rawData = await zipFile.async("arraybuffer");

        if (rawData.byteLength === 0) {
          folderWarnings.push(`Archivo vacío: ${name}`);
          processedFiles.push({
            path: zipPath,
            name,
            ext,
            size: 0,
            data: rawData,
            docType: classifyDocument(name),
            extractionStatus: "empty",
            checksum: "",
            zipPath,
          });
          continue;
        }

        const checksum = await sha256(rawData);
        const docType = classifyDocument(name);

        let extractedText: string | undefined;
        let extractionStatus: ZipFileEntry["extractionStatus"] = "binary";

        if (ext === ".docx" || ext === ".doc") {
          try {
            const text = await extractDocxText(rawData);
            if (text) {
              extractedText = text;
              extractionStatus = "extracted";
              allExtractedText.push(text);
            } else {
              extractionStatus = "error";
              folderWarnings.push(`No se pudo extraer texto de: ${name}`);
            }
          } catch (e) {
            extractionStatus = "error";
            folderWarnings.push(`Error al leer DOCX: ${name}`);
          }
        } else if (ext === ".pdf") {
          try {
            const text = await extractPdfText(rawData);
            if (text && text.length > 20) {
              extractedText = text;
              extractionStatus = "extracted";
              allExtractedText.push(text);
            } else {
              extractionStatus = "ocr_required";
            }
          } catch {
            extractionStatus = "ocr_required";
          }
        } else if ([".txt", ".rtf", ".odt"].includes(ext)) {
          try {
            extractedText = new TextDecoder("utf-8", { fatal: false }).decode(rawData);
            if (extractedText.trim()) {
              extractionStatus = "extracted";
              allExtractedText.push(extractedText);
            }
          } catch {
            extractionStatus = "error";
          }
        }

        processedFiles.push({
          path: zipPath,
          name,
          ext,
          size: rawData.byteLength,
          data: rawData,
          docType,
          extractedText,
          extractionStatus,
          checksum,
          zipPath,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error desconocido";
        parseErrors.push({ path: zipPath, error: msg });
        folderWarnings.push(`Error al leer ${name}: ${msg}`);
      }
    }

    // Analiza el texto combinado
    const combinedText = allExtractedText.join("\n\n");
    const detected =
      combinedText.length > 0
        ? analyzeText(combinedText)
        : {
            expedientes: [],
            relevantDates: [],
            fullNameCandidates: [],
          };

    // Si no hay archivos procesados, agrega advertencia
    if (processedFiles.length === 0) {
      folderWarnings.push("La carpeta no contiene archivos con formatos reconocidos.");
    }

    // Detecta si hay múltiples expedientes (posibles varios procesos)
    if (detected.expedientes.length > 1) {
      folderWarnings.push(
        `Se detectaron ${detected.expedientes.length} expedientes diferentes. Revisa si corresponden a procesos separados.`,
      );
    }

    const ocrPending = processedFiles.filter((f) => f.extractionStatus === "ocr_required").length;
    if (ocrPending > 0) {
      folderWarnings.push(
        `${ocrPending} archivo(s) son documentos escaneados y requieren OCR para extraer texto.`,
      );
    }

    candidates.push({
      folderName: topFolder,
      proposedName: normalizeFolderName(topFolder),
      detected,
      files: processedFiles,
      warnings: folderWarnings,
      folderPath: topFolder,
      excluded: false,
    });
  }

  return { candidates, ignoredPaths, parseErrors };
}

// ─── Detección de duplicados ───────────────────────────────────────────────────

export interface ExistingClient {
  id: string;
  name: string;
  dni: string;
  phone: string;
}

/**
 * Detecta duplicados entre un candidato y los clientes existentes.
 * Orden de prioridad: DNI exacto > nombre exacto > nombre+teléfono > aproximado.
 */
export function detectDuplicates(
  candidate: ClientCandidate,
  existingClients: ExistingClient[],
): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];
  const detectedDni = candidate.detected.dni;
  const proposedName = normalizeName(candidate.proposedName);
  const detectedPhone = candidate.detected.phone;

  for (const client of existingClients) {
    // 1. DNI exacto
    if (detectedDni && client.dni && detectedDni === client.dni.replace(/\D/g, "")) {
      matches.push({
        clientId: client.id,
        clientName: client.name,
        matchReason: `DNI coincide exactamente: ${detectedDni}`,
        matchStrength: "exact_dni",
      });
      continue;
    }

    // 2. Nombre completo normalizado exacto
    const existingNorm = normalizeName(client.name);
    if (proposedName && existingNorm === proposedName) {
      matches.push({
        clientId: client.id,
        clientName: client.name,
        matchReason: "Nombre completo coincide exactamente",
        matchStrength: "exact_name",
      });
      continue;
    }

    // 3. Nombre + teléfono
    if (
      detectedPhone &&
      client.phone &&
      detectedPhone === client.phone.replace(/\D/g, "") &&
      nameSimilarity(proposedName, existingNorm) > 0.6
    ) {
      matches.push({
        clientId: client.id,
        clientName: client.name,
        matchReason: `Teléfono coincide (${detectedPhone}) y nombres similares`,
        matchStrength: "name_phone",
      });
      continue;
    }

    // 4. Coincidencia aproximada (solo advertencia)
    if (proposedName && nameSimilarity(proposedName, existingNorm) > 0.8) {
      matches.push({
        clientId: client.id,
        clientName: client.name,
        matchReason: "Nombre similar (coincidencia aproximada — solo advertencia)",
        matchStrength: "approximate",
      });
    }
  }

  // Prioriza: exact_dni > exact_name > name_phone > approximate
  const order: Record<DuplicateMatch["matchStrength"], number> = {
    exact_dni: 0,
    exact_name: 1,
    name_phone: 2,
    approximate: 3,
  };
  return matches.sort((a, b) => order[a.matchStrength] - order[b.matchStrength]);
}

/** Normaliza un nombre para comparación */
function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita tildes
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Similitud de nombres por solapamiento de tokens */
function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const tokensA = new Set(a.split(" ").filter((t) => t.length > 2));
  const tokensB = new Set(b.split(" ").filter((t) => t.length > 2));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let common = 0;
  for (const t of tokensA) if (tokensB.has(t)) common++;
  return (common * 2) / (tokensA.size + tokensB.size);
}
