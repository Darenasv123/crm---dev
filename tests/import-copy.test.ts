import { describe, expect, it } from "vitest";
import {
  formatDuplicateWarning,
  formatZipReviewSelection,
  formatZipReviewStats,
  ZIP_IMPORT_COPY,
} from "../src/lib/import-copy";

describe("ZIP import copy", () => {
  it("keeps the upload screen copy in correct Spanish", () => {
    expect(ZIP_IMPORT_COPY.title).toBe("Importar un cliente desde ZIP");
    expect(ZIP_IMPORT_COPY.uploadSubtitle).toBe(
      "Sube un archivo ZIP que contenga una sola carpeta de cliente.",
    );
    expect(ZIP_IMPORT_COPY.dropTitle).toBe("Arrastra el archivo ZIP aquí");
    expect(ZIP_IMPORT_COPY.dropHintPrefix).toBe("o haz clic para seleccionar un archivo");
    expect(ZIP_IMPORT_COPY.helper).toBe(
      "Selecciona una sola carpeta de cliente en Google Drive y descárgala como archivo ZIP.",
    );
    expect(ZIP_IMPORT_COPY.multipleClientsWarning).toBe(
      "Si el archivo ZIP contiene más de un cliente, la importación se bloqueará.",
    );
  });

  it("keeps the expected ZIP example encoded as UTF-8", () => {
    expect(ZIP_IMPORT_COPY.exampleLines).toEqual([
      "YLLA NEGRON YENI/",
      "DEMANDA DE EJECUCIÓN.docx",
      "CARGO - YLLA NEGRON.pdf",
      "EXP. 01234-2024/",
      "RESOLUCIÓN.pdf",
    ]);
  });

  it("formats review copy with natural pluralization", () => {
    expect(formatZipReviewSelection(1)).toBe("1 cliente seleccionado para revisión");
    expect(formatZipReviewSelection(2)).toBe("2 clientes seleccionados para revisión");
    expect(formatZipReviewStats({ folders: 1, activeFolders: 1, duplicates: 1 })).toBe(
      "1 carpeta · 1 carpeta activa · 1 posible duplicado",
    );
    expect(formatZipReviewStats({ folders: 3, activeFolders: 2, duplicates: 4 })).toBe(
      "3 carpetas · 2 carpetas activas · 4 posibles duplicados",
    );
  });

  it("formats duplicate warnings in singular and plural", () => {
    expect(formatDuplicateWarning(1)).toBe(
      "Esta carpeta tiene un posible duplicado. Selecciona una acción antes de importar.",
    );
    expect(formatDuplicateWarning(2)).toBe(
      "2 carpetas tienen posibles duplicados. Selecciona una acción para cada una antes de importar.",
    );
  });
});
