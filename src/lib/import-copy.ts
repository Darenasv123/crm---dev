import { formatCount } from "@/lib/text-utils";

export const ZIP_IMPORT_COPY = {
  title: "Importar un cliente desde ZIP",
  uploadSubtitle: "Sube un archivo ZIP que contenga una sola carpeta de cliente.",
  dropTitle: "Arrastra el archivo ZIP aquí",
  dropHintPrefix: "o haz clic para seleccionar un archivo",
  helper: "Selecciona una sola carpeta de cliente en Google Drive y descárgala como archivo ZIP.",
  structureTitle: "Estructura esperada del ZIP:",
  exampleLines: [
    "YLLA NEGRON YENI/",
    "DEMANDA DE EJECUCIÓN.docx",
    "CARGO - YLLA NEGRON.pdf",
    "EXP. 01234-2024/",
    "RESOLUCIÓN.pdf",
  ],
  multipleClientsWarning:
    "Si el archivo ZIP contiene más de un cliente, la importación se bloqueará.",
  backButton: "Atrás",
  confirmButton: "Confirmar importación",
};

export function formatZipReviewSelection(count: number): string {
  return `${formatCount(count, "cliente seleccionado", "clientes seleccionados")} para revisión`;
}

export function formatDuplicateWarning(count: number): string {
  if (count === 1) {
    return "Esta carpeta tiene un posible duplicado. Selecciona una acción antes de importar.";
  }
  return `${formatCount(count, "carpeta", "carpetas")} tienen posibles duplicados. Selecciona una acción para cada una antes de importar.`;
}

export function formatZipReviewStats(input: {
  folders: number;
  activeFolders: number;
  duplicates: number;
}): string {
  return [
    formatCount(input.folders, "carpeta", "carpetas"),
    formatCount(input.activeFolders, "carpeta activa", "carpetas activas"),
    formatCount(input.duplicates, "posible duplicado", "posibles duplicados"),
  ].join(" · ");
}
