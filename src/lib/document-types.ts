export const DOCUMENT_TYPES = [
  "Demanda",
  "Resolución",
  "Sentencia",
  "Poder",
  "Contrato",
  "Otros",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

const DOCUMENT_TYPE_ALIASES: Record<string, DocumentType> = {
  demanda: "Demanda",
  demandas: "Demanda",
  resolucion: "Resolución",
  resoluciones: "Resolución",
  sentencia: "Sentencia",
  sentencias: "Sentencia",
  poder: "Poder",
  poderes: "Poder",
  contrato: "Contrato",
  contratos: "Contrato",
  otro: "Otros",
  otros: "Otros",
};

export function normalizeDocumentType(value: string | null | undefined): DocumentType {
  const key = (value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return DOCUMENT_TYPE_ALIASES[key] ?? "Otros";
}

export function inferDocumentType(fileName: string): DocumentType {
  const normalized = fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  for (const [alias, type] of Object.entries(DOCUMENT_TYPE_ALIASES)) {
    if (alias !== "otro" && alias !== "otros" && normalized.includes(alias)) return type;
  }
  return "Otros";
}
