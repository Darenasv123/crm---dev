/**
 * Pure ZIP import analysis for folders exported from Google Drive.
 * This module does not talk to React or Supabase, so the import can be
 * reviewed before any CRM data is persisted.
 */
import JSZip from "jszip";
import mammoth from "mammoth";

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

const IGNORED_PREFIXES = [".", "__MACOSX", "Thumbs.db", "desktop.ini"];
const DRIVE_SUFFIXES = /\s*\(\d+\)$/;

const DOC_TYPE_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /DEMANDA/i, type: "DEMANDA" },
  { pattern: /CONTESTACI/i, type: "CONTESTACIÓN" },
  { pattern: /ANEXO/i, type: "ANEXOS" },
  { pattern: /CARGO/i, type: "CARGO" },
  { pattern: /SENTENCIA/i, type: "SENTENCIA" },
  { pattern: /RESOLUCI/i, type: "RESOLUCIÓN" },
  { pattern: /AUDIENCIA/i, type: "AUDIENCIA" },
  { pattern: /LIQUIDACI/i, type: "LIQUIDACIÓN" },
  { pattern: /ESCRITO/i, type: "ESCRITO" },
  { pattern: /NOTIFICACI/i, type: "NOTIFICACIÓN" },
];

const PATTERNS = {
  dni: /\b(?:DNI|D\.N\.I\.?)[\s.:N°º#-]*([0-9]{8})\b/gi,
  phone: /(?:(?:cel(?:ular)?|tel(?:e|é)fono|telf?\.?|movil|móvil)[\s.:]*)?(\b9[0-9]{8}\b)/gi,
  email: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/gi,
  expediente: /\b(?:EXP(?:EDIENTE)?\.?|N[°º]\.?)\s*([0-9]{4,5}-[0-9]{4}(?:-[A-Z0-9]+){0,8})\b/gi,
  expedienteAlt: /\b([0-9]{4,5}-[0-9]{4}(?:-[A-Z0-9]+){1,8})\b/g,
  court:
    /\b((?:\d+\s*(?:ER|DO|RO|TO)?\s*)?(?:JUZGADO|SALA|CORTE|FISCALIA|FISCALÍA)(?:[^\n,;]){3,90})/gi,
  demandante:
    /(?:DEMANDANTE|ACTOR|ACTORA|PARTE\s+DEMANDANTE)\s*:?\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑa-záéíóúñ\s]{4,80})/gi,
  demandado:
    /(?:DEMANDADO|EMPLAZADO|PARTE\s+DEMANDADA)\s*:?\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑa-záéíóúñ\s]{4,80})/gi,
  fullName: /\b([A-ZÁÉÍÓÚÑ]{2,}(?:\s+[A-ZÁÉÍÓÚÑ]{2,}){1,4})\b/g,
  processType:
    /(?:MATERIA|PROCESO|TIPO DE PROCESO|VIA PROCEDIMENTAL|VÍA PROCEDIMENTAL)\s*:?\s*([^\n.;]{3,80})/gi,
  stage:
    /(?:ETAPA|ESTADO\s+PROCESAL|ESTADO)\s*:?\s*(INICIAL|EN\s+TRAMITACION|EN\s+TRAMITACIÓN|AUDIENCIA|SENTENCIA|APELACION|APELACIÓN|EJECUCION|EJECUCIÓN|LIQUIDACION|LIQUIDACIÓN|ARCHIVADO)/gi,
  dates: /\b(\d{1,2})\s+(?:de\s+)?([A-Za-záéíóúñ]+)\s+(?:de\s+|del?\s+)?(\d{4})\b/gi,
};

const PROCESS_TYPE_RULES: Array<{ label: string; terms: string[] }> = [
  { label: "Alimentos", terms: ["ALIMENTO", "PRORRATEO", "PENSION"] },
  { label: "Aumento de alimentos", terms: ["AUMENTO DE ALIMENTO"] },
  { label: "Tenencia", terms: ["TENENCIA"] },
  { label: "Regimen de visitas", terms: ["REGIMEN DE VISIT", "REGIMEN VISIT", "VISITAS"] },
  { label: "Filiacion", terms: ["FILIACION"] },
  { label: "Divorcio", terms: ["DIVORCIO", "DIV"] },
  { label: "Violencia familiar", terms: ["VIOLENCIA FAMILIAR", "VIOLENCIA CONTRA"] },
  { label: "Ejecucion de acta", terms: ["EJECUCION DE ACTA", "ACTA DE CONCILIACION"] },
  { label: "Civil", terms: ["CIVIL"] },
  { label: "Penal", terms: ["PENAL", "FISCALIA", "FISCALÍA"] },
  { label: "Laboral", terms: ["LABORAL"] },
  { label: "Constitucional", terms: ["CONSTITUCIONAL", "AMPARO", "HABEAS"] },
  { label: "Administrativo", terms: ["ADMINISTRATIVO"] },
  { label: "Familia", terms: ["FAMILIA"] },
];

const GENERIC_CONTAINER_TERMS = [
  "EXPEDIENTE",
  "EXPEDIENTES",
  "EXPEDIENTES DE CLIENTES",
  "CLIENTE",
  "CLIENTES",
  "ARCHIVO",
  "ARCHIVOS",
  "DOCUMENTO",
  "DOCUMENTOS",
  "CASO",
  "CASOS",
  "PROCESO",
  "PROCESOS",
  "ESTUDIO JURIDICO",
  "ESTUDIO JURÍDICO",
  "BACKUP",
  "RESPALDO",
  "GOOGLE DRIVE",
];

const EXPEDIENTE_FOLDER_TERMS = [
  "EXP",
  "EXPEDIENTE",
  "CASO",
  "PROCESO",
  "DEMANDA",
  "ALIMENTOS",
  "TENENCIA",
  "DIVORCIO",
  "FILIACION",
  "FILIACIÓN",
  "VIOLENCIA",
];

export interface ZipFileEntry {
  path: string;
  name: string;
  ext: string;
  size: number;
  data: ArrayBuffer;
  docType: string;
  extractedText?: string;
  extractionStatus: "extracted" | "ocr_required" | "binary" | "empty" | "error";
  checksum: string;
  zipPath: string;
  folderPath: string;
  detected?: DetectedData;
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

export type FolderClassification =
  "container" | "possible_client" | "possible_expediente" | "documental" | "unknown";

export interface FolderClassificationResult {
  kind: FolderClassification;
  confidence: number;
  evidence: string[];
  warnings: string[];
}

export interface ZipTreeNode {
  name: string;
  path: string;
  depth: number;
  parentPath: string | null;
  subfolders: string[];
  directFiles: string[];
  totalDescendantDocs: number;
  classification: FolderClassificationResult;
}

export interface ZipCaseCandidate {
  id: string;
  title: string;
  caseNumber: string | null;
  processType: string;
  juzgado: string;
  demandante?: string;
  demandado?: string;
  status: string;
  origin: "importacion_zip";
  originPath: string;
  confidence: number;
  warnings: string[];
  documentPaths: string[];
  isProvisional: boolean;
}

export interface ClientCandidate {
  folderName: string;
  proposedName: string;
  detected: DetectedData;
  files: ZipFileEntry[];
  warnings: string[];
  folderPath: string;
  excluded: boolean;
  classification?: FolderClassificationResult;
  evidence?: string[];
  confidence?: number;
  subfolderPaths?: string[];
  caseCandidates?: ZipCaseCandidate[];
}

export type DuplicateAction = "create_new" | "update_existing" | "attach_docs" | "skip";

export interface DuplicateMatch {
  clientId: string;
  clientName: string;
  matchReason: string;
  matchStrength: "exact_dni" | "exact_name" | "name_phone" | "approximate";
}

export interface ReviewCandidate extends ClientCandidate {
  duplicates: DuplicateMatch[];
  duplicateAction?: DuplicateAction;
  existingClientId?: string;
  edits: Partial<{
    proposedName: string;
    dni: string;
    phone: string;
    email: string;
    processType: string;
    juzgado: string;
  }>;
  excludedFiles: Set<string>;
  excludedFolders?: Set<string>;
  documentCaseMap?: Record<string, string>;
}

export interface ZipParseResult {
  candidates: ClientCandidate[];
  ignoredPaths: string[];
  parseErrors: Array<{ path: string; error: string }>;
  tree: ZipTreeNode[];
}

type RawZipFile = {
  zipPath: string;
  name: string;
  ext: string;
  folderPath: string;
  zipFile: JSZip.JSZipObject;
};

function emptyDetected(): DetectedData {
  return { expedientes: [], relevantDates: [], fullNameCandidates: [] };
}

export async function sha256(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function normalizeFolderName(raw: string): string {
  return raw.replace(DRIVE_SUFFIXES, "").replace(/\s+/g, " ").trim();
}

export function shouldIgnorePath(pathSegment: string): boolean {
  return IGNORED_PREFIXES.some((p) => pathSegment.startsWith(p) || pathSegment === p);
}

export function classifyDocument(fileName: string): string {
  for (const { pattern, type } of DOC_TYPE_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(fileName)) return type;
  }
  return "OTROS";
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function firstMatch(text: string, pattern: RegExp): string | undefined {
  pattern.lastIndex = 0;
  const m = pattern.exec(text);
  return (m?.[1] ?? m?.[0])?.trim();
}

function allMatches(text: string, pattern: RegExp): string[] {
  pattern.lastIndex = 0;
  const results = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    const val = (m[1] ?? m[0])?.trim();
    if (val && val.length > 2) results.add(val);
  }
  return Array.from(results);
}

function normalizedText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericContainerName(name: string): boolean {
  const n = normalizedText(normalizeFolderName(name));
  if (!n) return false;
  return GENERIC_CONTAINER_TERMS.some(
    (term) => n === normalizedText(term) || n.includes(normalizedText(term)),
  );
}

function looksLikePersonOrCompanyFolder(name: string): boolean {
  const clean = normalizedText(normalizeFolderName(name));
  if (!clean || isGenericContainerName(clean)) return false;
  const tokens = clean.split(" ").filter((t) => t.length > 1 && !/^\d+$/.test(t));
  if (tokens.length >= 2 && tokens.length <= 6) return true;
  return /(?:SAC|S\.A\.C|EIRL|E\.I\.R\.L|SRL|S\.R\.L|ASOCIACION|EMPRESA)/i.test(name);
}

function looksLikeExpedienteFolder(name: string): boolean {
  const n = normalizedText(name);
  if (allMatches(n, PATTERNS.expedienteAlt).length > 0) return true;
  return EXPEDIENTE_FOLDER_TERMS.some((term) => n.includes(normalizedText(term)));
}

function hasDirectLegalFiles(node: ZipTreeNode): boolean {
  return node.directFiles.some((path) => classifyDocument(path) !== "OTROS");
}

export function classifyFolderNode(
  node: Omit<ZipTreeNode, "classification">,
): FolderClassificationResult {
  const evidence: string[] = [];
  const warnings: string[] = [];
  let kind: FolderClassification = "unknown";
  let confidence = 0.25;
  const childCount = node.subfolders.length;
  const directDocCount = node.directFiles.length;

  if (node.path === "") {
    return { kind: "container", confidence: 1, evidence: ["Raiz del ZIP"], warnings };
  }

  if (isGenericContainerName(node.name) && directDocCount === 0 && childCount > 0) {
    kind = "container";
    confidence = Math.min(0.95, 0.65 + childCount * 0.05);
    evidence.push("Nombre generico de contenedor", `${childCount} subcarpeta(s)`);
  } else if (
    looksLikeExpedienteFolder(node.name) &&
    (directDocCount > 0 || node.totalDescendantDocs > 0)
  ) {
    kind = "possible_expediente";
    confidence = allMatches(node.name, PATTERNS.expedienteAlt).length > 0 ? 0.9 : 0.72;
    evidence.push("Nombre compatible con expediente o materia");
  } else if (looksLikePersonOrCompanyFolder(node.name) && node.totalDescendantDocs > 0) {
    kind = "possible_client";
    confidence = 0.72;
    evidence.push(
      "Nombre compatible con persona o empresa",
      `${node.totalDescendantDocs} documento(s)`,
    );
    if (directDocCount > 0) evidence.push("Contiene documentos directos");
    if (childCount > 0) evidence.push("Contiene subcarpetas revisables");
  } else if (directDocCount > 0 && childCount === 0) {
    kind = "documental";
    confidence = hasDirectLegalFiles(node as ZipTreeNode) ? 0.78 : 0.55;
    evidence.push("Carpeta con documentos directos");
  } else if (node.totalDescendantDocs > 0) {
    kind = "unknown";
    confidence = 0.45;
    evidence.push("Contiene documentos, requiere revision");
  }

  if (kind === "unknown") warnings.push("No se pudo clasificar la carpeta con confianza alta.");
  return { kind, confidence, evidence, warnings };
}

export function normalizeProcessType(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const n = normalizedText(raw);
  if (!n || n.length > 120) return undefined;
  for (const rule of PROCESS_TYPE_RULES) {
    if (rule.terms.some((term) => n.includes(normalizedText(term)))) return rule.label;
  }
  return undefined;
}

export function normalizeCaseStatus(raw?: string | null): string {
  const n = normalizedText(raw ?? "");
  if (!n) return "Consulta";
  if (n.includes("AUDIENCIA")) return "Audiencia";
  if (n.includes("SENTENCIA")) return "Sentencia";
  if (n.includes("ARCHIV")) return "Archivado";
  if (n.includes("DEMANDA")) return "Demanda presentada";
  if (n.includes("DOCUMENT")) return "Documentacion";
  if (n.includes("TRAMIT") || n.includes("PROCES")) return "En proceso";
  return "Consulta";
}

function cleanDetectedName(value?: string): string | undefined {
  if (!value) return undefined;
  return value.replace(/\s+/g, " ").trim().slice(0, 90) || undefined;
}

export function analyzeText(text: string): DetectedData {
  const dni = firstMatch(text, PATTERNS.dni);
  const email = text.match(PATTERNS.email)?.[0];
  const processType = normalizeProcessType(firstMatch(text, PATTERNS.processType));
  const juzgado = cleanDetectedName(firstMatch(text, PATTERNS.court));
  const demandante = cleanDetectedName(firstMatch(text, PATTERNS.demandante));
  const demandado = cleanDetectedName(firstMatch(text, PATTERNS.demandado));
  const stage = firstMatch(text, PATTERNS.stage);
  const phone = text.match(/\b(9[0-9]{8})\b/)?.[1];
  const expedientes = new Set<string>([
    ...allMatches(text, PATTERNS.expediente),
    ...allMatches(text, PATTERNS.expedienteAlt),
  ]);

  const relevantDates: string[] = [];
  PATTERNS.dates.lastIndex = 0;
  let dm: RegExpExecArray | null;
  while ((dm = PATTERNS.dates.exec(text)) !== null) {
    relevantDates.push(`${dm[1]} de ${dm[2]} de ${dm[3]}`);
    if (relevantDates.length >= 5) break;
  }

  const fullNameCandidates = allMatches(text, PATTERNS.fullName).filter((n) => {
    const words = n.split(" ");
    return words.length >= 2 && words.length <= 5 && !isGenericContainerName(n);
  });

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

function mergeDetected(items: DetectedData[]): DetectedData {
  const merged = emptyDetected();
  const expedientes = new Set<string>();
  const dates = new Set<string>();
  const names = new Set<string>();
  for (const item of items) {
    merged.dni ??= item.dni;
    merged.phone ??= item.phone;
    merged.email ??= item.email;
    merged.processType ??= item.processType;
    merged.juzgado ??= item.juzgado;
    merged.demandante ??= item.demandante;
    merged.demandado ??= item.demandado;
    merged.stage ??= item.stage;
    item.expedientes.forEach((v) => expedientes.add(v));
    item.relevantDates.forEach((v) => dates.add(v));
    item.fullNameCandidates.forEach((v) => names.add(v));
  }
  merged.expedientes = Array.from(expedientes);
  merged.relevantDates = Array.from(dates);
  merged.fullNameCandidates = Array.from(names);
  return merged;
}

function pdfHasSelectableText(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer);
  const text = new TextDecoder("latin1").decode(bytes.slice(0, Math.min(bytes.length, 32768)));
  return text.includes("BT") && text.includes("ET") && text.includes("/Font");
}

async function extractPdfText(buffer: ArrayBuffer): Promise<string | null> {
  try {
    if (!pdfHasSelectableText(buffer)) return null;
    const bytes = new Uint8Array(buffer);
    const raw = new TextDecoder("latin1").decode(bytes);
    const textParts: string[] = [];
    const btEtPattern = /BT\s*([\s\S]*?)\s*ET/g;
    let m: RegExpExecArray | null;
    while ((m = btEtPattern.exec(raw)) !== null) {
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

async function extractDocxText(buffer: ArrayBuffer): Promise<string | null> {
  try {
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return result.value?.trim() || null;
  } catch {
    return null;
  }
}

function folderPathFromZipPath(zipPath: string): string {
  const parts = zipPath.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

export function buildZipTree(filePaths: string[]): ZipTreeNode[] {
  const map = new Map<string, Omit<ZipTreeNode, "classification">>();
  map.set("", {
    name: "ZIP",
    path: "",
    depth: 0,
    parentPath: null,
    subfolders: [],
    directFiles: [],
    totalDescendantDocs: 0,
  });

  function ensureFolder(parts: string[]): string {
    let current = "";
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const parent = current;
      current = current ? `${current}/${name}` : name;
      if (!map.has(current)) {
        map.set(current, {
          name,
          path: current,
          depth: i + 1,
          parentPath: parent,
          subfolders: [],
          directFiles: [],
          totalDescendantDocs: 0,
        });
        const parentNode = map.get(parent);
        if (parentNode && !parentNode.subfolders.includes(current))
          parentNode.subfolders.push(current);
      }
    }
    return current;
  }

  for (const filePath of filePaths) {
    const parts = filePath.split("/").filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) continue;
    const folderPath = ensureFolder(parts);
    const folder = map.get(folderPath);
    folder?.directFiles.push(filePath);
  }

  const sorted = Array.from(map.values()).sort((a, b) => b.depth - a.depth);
  for (const node of sorted) {
    node.totalDescendantDocs += node.directFiles.length;
    if (node.parentPath !== null) {
      const parent = map.get(node.parentPath);
      if (parent) parent.totalDescendantDocs += node.totalDescendantDocs;
    }
  }

  return Array.from(map.values())
    .sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path))
    .map((node) => ({ ...node, classification: classifyFolderNode(node) }));
}

function findNode(tree: ZipTreeNode[], path: string): ZipTreeNode | undefined {
  return tree.find((node) => node.path === path);
}

function isAncestorPath(parent: string, child: string): boolean {
  return parent === "" || child === parent || child.startsWith(`${parent}/`);
}

function hasSelectedAncestor(path: string, selected: string[]): boolean {
  return selected.some(
    (candidatePath) => candidatePath !== path && isAncestorPath(candidatePath, path),
  );
}

function selectClientNodes(tree: ZipTreeNode[]): ZipTreeNode[] {
  const candidates: string[] = [];
  for (const node of tree) {
    if (!node.path || node.totalDescendantDocs === 0) continue;
    if (node.classification.kind !== "possible_client") continue;
    const parent = node.parentPath ? findNode(tree, node.parentPath) : undefined;
    const parentIsClient = parent?.classification.kind === "possible_client";
    const parentIsContainer =
      !parent ||
      parent.classification.kind === "container" ||
      parent.classification.kind === "unknown";
    if (!parentIsClient && parentIsContainer && !hasSelectedAncestor(node.path, candidates)) {
      candidates.push(node.path);
    }
  }

  if (candidates.length === 0) {
    for (const node of tree) {
      if (!node.path || node.totalDescendantDocs === 0) continue;
      if (
        node.classification.kind === "container" ||
        node.classification.kind === "possible_expediente"
      )
        continue;
      if (!hasSelectedAncestor(node.path, candidates)) candidates.push(node.path);
    }
  }

  return candidates.map((path) => findNode(tree, path)).filter(Boolean) as ZipTreeNode[];
}

function immediateSubfolderBelow(clientPath: string, filePath: string): string | undefined {
  const fileFolder = folderPathFromZipPath(filePath);
  if (fileFolder === clientPath) return undefined;
  if (!isAncestorPath(clientPath, fileFolder)) return undefined;
  const rest = clientPath ? fileFolder.slice(clientPath.length + 1) : fileFolder;
  const first = rest.split("/").filter(Boolean)[0];
  return first ? `${clientPath}/${first}` : undefined;
}

function extractExpedientesFromPath(path: string): string[] {
  return Array.from(
    new Set([
      ...allMatches(path, PATTERNS.expediente),
      ...allMatches(path, PATTERNS.expedienteAlt),
    ]),
  );
}

function buildCaseCandidates(
  clientNode: ZipTreeNode,
  tree: ZipTreeNode[],
  files: ZipFileEntry[],
  detected: DetectedData,
): ZipCaseCandidate[] {
  const groups = new Map<
    string,
    { originPath: string; files: ZipFileEntry[]; caseNumber: string | null }
  >();

  for (const file of files) {
    const fileExpedientes = file.detected?.expedientes.length
      ? file.detected.expedientes
      : extractExpedientesFromPath(file.zipPath);
    const exp = fileExpedientes[0] ?? detected.expedientes[0] ?? null;
    const subfolder = immediateSubfolderBelow(clientNode.path, file.zipPath);
    const subNode = subfolder ? findNode(tree, subfolder) : undefined;
    const folderIsExpediente = subNode?.classification.kind === "possible_expediente";
    const key = exp ? `exp:${exp}` : folderIsExpediente ? `folder:${subfolder}` : "pending";
    if (!groups.has(key)) {
      groups.set(key, {
        originPath: folderIsExpediente && subfolder ? subfolder : clientNode.path,
        files: [],
        caseNumber: exp,
      });
    }
    groups.get(key)!.files.push(file);
  }

  const cases: ZipCaseCandidate[] = [];
  let pendingCount = 0;
  for (const [key, group] of groups) {
    const perFileDetected = mergeDetected(
      group.files.map((file) => file.detected ?? emptyDetected()),
    );
    const processType =
      perFileDetected.processType ?? detected.processType ?? "Pendiente de clasificacion";
    const juzgado = perFileDetected.juzgado ?? detected.juzgado ?? "Por determinar";
    const isProvisional = !group.caseNumber;
    if (isProvisional) pendingCount++;
    const title = group.caseNumber
      ? `Expediente ${group.caseNumber}`
      : key.startsWith("folder:")
        ? normalizeFolderName(
            group.originPath.split("/").pop() ?? "Expediente pendiente de clasificacion",
          )
        : "Expediente pendiente de clasificacion";
    cases.push({
      id: group.caseNumber ? `exp-${group.caseNumber}` : `pending-${pendingCount}`,
      title,
      caseNumber: group.caseNumber,
      processType,
      juzgado,
      demandante: perFileDetected.demandante ?? detected.demandante,
      demandado: perFileDetected.demandado ?? detected.demandado,
      status: normalizeCaseStatus(perFileDetected.stage ?? detected.stage),
      origin: "importacion_zip",
      originPath: group.originPath,
      confidence: group.caseNumber ? 0.85 : key.startsWith("folder:") ? 0.62 : 0.4,
      warnings: isProvisional
        ? ["No se detecto numero de expediente. Se creara como pendiente de revision."]
        : [],
      documentPaths: group.files.map((file) => file.zipPath),
      isProvisional,
    });
  }

  return cases;
}

async function processRawFile(raw: RawZipFile): Promise<ZipFileEntry> {
  const rawData = await raw.zipFile.async("arraybuffer");
  const base: Omit<ZipFileEntry, "extractionStatus" | "checksum"> = {
    path: raw.zipPath,
    name: raw.name,
    ext: raw.ext,
    size: rawData.byteLength,
    data: rawData,
    docType: classifyDocument(raw.name),
    zipPath: raw.zipPath,
    folderPath: raw.folderPath,
  };

  if (rawData.byteLength === 0) {
    return { ...base, extractionStatus: "empty", checksum: "", detected: emptyDetected() };
  }

  const checksum = await sha256(rawData);
  let extractedText: string | undefined;
  let extractionStatus: ZipFileEntry["extractionStatus"] = "binary";

  if (raw.ext === ".docx" || raw.ext === ".doc") {
    const text = await extractDocxText(rawData);
    if (text) {
      extractedText = text;
      extractionStatus = "extracted";
    } else {
      extractionStatus = "error";
    }
  } else if (raw.ext === ".pdf") {
    const text = await extractPdfText(rawData);
    if (text && text.length > 20) {
      extractedText = text;
      extractionStatus = "extracted";
    } else {
      extractionStatus = "ocr_required";
    }
  } else if ([".txt", ".rtf", ".odt"].includes(raw.ext)) {
    extractedText = new TextDecoder("utf-8", { fatal: false }).decode(rawData);
    extractionStatus = extractedText.trim() ? "extracted" : "empty";
  }

  const detected = mergeDetected([
    analyzeText(`${raw.zipPath}\n${raw.name}`),
    extractedText ? analyzeText(extractedText) : emptyDetected(),
  ]);

  return { ...base, extractedText, extractionStatus, checksum, detected };
}

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
  const rawFiles: RawZipFile[] = [];

  zip.forEach((relativePath, zipFile) => {
    const parts = relativePath.split("/").filter(Boolean);
    if (parts.length === 0) return;

    if (parts.some((part) => shouldIgnorePath(part))) {
      ignoredPaths.push(relativePath);
      return;
    }

    if (zipFile.dir) return;

    const fileName = parts[parts.length - 1];
    const ext = fileName.includes(".") ? `.${fileName.split(".").pop()!.toLowerCase()}` : "";
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      ignoredPaths.push(relativePath);
      return;
    }

    rawFiles.push({
      zipPath: relativePath,
      name: fileName,
      ext,
      folderPath: folderPathFromZipPath(relativePath),
      zipFile,
    });
  });

  const tree = buildZipTree(rawFiles.map((file) => file.zipPath));
  const clientNodes = selectClientNodes(tree);
  const candidates: ClientCandidate[] = [];

  for (const clientNode of clientNodes) {
    log(`Analizando cliente: ${normalizeFolderName(clientNode.name)}`);
    const rawForClient = rawFiles.filter((file) => isAncestorPath(clientNode.path, file.zipPath));
    const processedFiles: ZipFileEntry[] = [];
    const warnings = [...clientNode.classification.warnings];

    for (const raw of rawForClient) {
      try {
        const processed = await processRawFile(raw);
        processedFiles.push(processed);
        if (processed.extractionStatus === "empty")
          warnings.push(`Archivo vacio: ${processed.name}`);
        if (processed.extractionStatus === "error")
          warnings.push(`No se pudo extraer texto de: ${processed.name}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error desconocido";
        parseErrors.push({ path: raw.zipPath, error: msg });
        warnings.push(`Error al leer ${raw.name}: ${msg}`);
      }
    }

    const detected = mergeDetected(processedFiles.map((file) => file.detected ?? emptyDetected()));
    const caseCandidates = buildCaseCandidates(clientNode, tree, processedFiles, detected);

    if (processedFiles.length === 0)
      warnings.push("La carpeta no contiene archivos con formatos reconocidos.");
    if (detected.expedientes.length > 1) {
      warnings.push(
        `Se detectaron ${detected.expedientes.length} expedientes diferentes. Revisa si corresponden a procesos separados.`,
      );
    }
    const ocrPending = processedFiles.filter((f) => f.extractionStatus === "ocr_required").length;
    if (ocrPending > 0) warnings.push(`${ocrPending} archivo(s) requieren OCR para extraer texto.`);
    if (caseCandidates.some((c) => c.isProvisional))
      warnings.push(
        "Hay documentos sin numero de expediente; se agruparon como pendiente de clasificacion.",
      );

    const documentCaseMap = Object.fromEntries(
      caseCandidates.flatMap((caseCandidate) =>
        caseCandidate.documentPaths.map((path) => [path, caseCandidate.id] as const),
      ),
    );

    candidates.push({
      folderName: clientNode.name,
      proposedName: normalizeFolderName(clientNode.name),
      detected,
      files: processedFiles,
      warnings,
      folderPath: clientNode.path,
      excluded: false,
      classification: clientNode.classification,
      evidence: clientNode.classification.evidence,
      confidence: clientNode.classification.confidence,
      subfolderPaths: clientNode.subfolders,
      caseCandidates: caseCandidates.map((caseCandidate) => ({
        ...caseCandidate,
        documentPaths: caseCandidate.documentPaths.filter(
          (path) => documentCaseMap[path] === caseCandidate.id,
        ),
      })),
    });
  }

  return { candidates, ignoredPaths, parseErrors, tree };
}

export interface ExistingClient {
  id: string;
  name: string;
  dni: string;
  phone: string;
}

export function detectDuplicates(
  candidate: ClientCandidate,
  existingClients: ExistingClient[],
): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];
  const detectedDni = candidate.detected.dni;
  const proposedName = normalizeName(candidate.proposedName);
  const detectedPhone = candidate.detected.phone;

  for (const client of existingClients) {
    if (detectedDni && client.dni && detectedDni === client.dni.replace(/\D/g, "")) {
      matches.push({
        clientId: client.id,
        clientName: client.name,
        matchReason: `DNI coincide exactamente: ${detectedDni}`,
        matchStrength: "exact_dni",
      });
      continue;
    }

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

    if (
      detectedPhone &&
      client.phone &&
      detectedPhone === client.phone.replace(/\D/g, "") &&
      nameSimilarity(proposedName, existingNorm) > 0.6
    ) {
      matches.push({
        clientId: client.id,
        clientName: client.name,
        matchReason: `Telefono coincide (${detectedPhone}) y nombres similares`,
        matchStrength: "name_phone",
      });
      continue;
    }

    if (proposedName && nameSimilarity(proposedName, existingNorm) > 0.8) {
      matches.push({
        clientId: client.id,
        clientName: client.name,
        matchReason: "Nombre similar (coincidencia aproximada, solo advertencia)",
        matchStrength: "approximate",
      });
    }
  }

  const order: Record<DuplicateMatch["matchStrength"], number> = {
    exact_dni: 0,
    exact_name: 1,
    name_phone: 2,
    approximate: 3,
  };
  return matches.sort((a, b) => order[a.matchStrength] - order[b.matchStrength]);
}

function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const tokensA = new Set(a.split(" ").filter((t) => t.length > 2));
  const tokensB = new Set(b.split(" ").filter((t) => t.length > 2));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let common = 0;
  for (const t of tokensA) if (tokensB.has(t)) common++;
  return (common * 2) / (tokensA.size + tokensB.size);
}
