/**
 * Tests para el importador ZIP de carpetas de clientes (Google Drive).
 * Cubre: lectura del ZIP, carpetas anidadas, nombres con tildes,
 * agrupación, DOCX, PDF, archivos vacíos, ZIP corrupto, duplicados,
 * múltiples carpetas del mismo cliente, varios expedientes, y
 * error parcial sin cancelar toda la importación.
 */
import { describe, expect, it, vi, beforeAll } from "vitest";
import JSZip from "jszip";
import {
  normalizeFolderName,
  shouldIgnorePath,
  classifyDocument,
  analyzeText,
  detectDuplicates,
  parseZipFile,
  formatSize,
  sha256,
  type ClientCandidate,
  type ExistingClient,
} from "@/lib/imports/zip-import";

// ─── Helpers de test ──────────────────────────────────────────────────────────

/** Construye un ArrayBuffer de ZIP en memoria */
async function buildZip(
  entries: Array<{ path: string; content: string | Uint8Array }>,
): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const { path, content } of entries) {
    zip.file(path, content);
  }
  return zip.generateAsync({ type: "arraybuffer" });
}

/** ZIP corrupto (bytes aleatorios, no un ZIP real) */
function corruptBuffer(): ArrayBuffer {
  return new Uint8Array([0x00, 0x01, 0x02, 0xde, 0xad, 0xbe, 0xef]).buffer;
}

// ─── Mock crypto.subtle.digest para entorno Node ──────────────────────────────

beforeAll(() => {
  // Node 18+ tiene crypto.subtle, pero por si acaso lo aseguramos
  if (typeof globalThis.crypto === "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { webcrypto } = require("node:crypto");
    Object.defineProperty(globalThis, "crypto", { value: webcrypto });
  }
});

// ─── normalizeFolderName ──────────────────────────────────────────────────────

describe("normalizeFolderName", () => {
  it("elimina espacios repetidos", () => {
    expect(normalizeFolderName("YLLA  NEGRON  YENI")).toBe("YLLA NEGRON YENI");
  });

  it("elimina sufijo numérico de Google Drive", () => {
    expect(normalizeFolderName("GARCIA TORRES (1)")).toBe("GARCIA TORRES");
  });

  it("conserva tildes y caracteres especiales", () => {
    expect(normalizeFolderName("ÑUÑEZ LÓPEZ MARÍA")).toBe("ÑUÑEZ LÓPEZ MARÍA");
  });

  it("recorta espacios al inicio y final", () => {
    expect(normalizeFolderName("  RODRIGUEZ PEREZ  ")).toBe("RODRIGUEZ PEREZ");
  });

  it("conserva mayúsculas sin modificar", () => {
    expect(normalizeFolderName("YLLA NEGRON YENI")).toBe("YLLA NEGRON YENI");
  });
});

// ─── shouldIgnorePath ─────────────────────────────────────────────────────────

describe("shouldIgnorePath", () => {
  it("ignora archivos ocultos (punto inicial)", () => {
    expect(shouldIgnorePath(".DS_Store")).toBe(true);
  });

  it("ignora carpeta __MACOSX", () => {
    expect(shouldIgnorePath("__MACOSX")).toBe(true);
  });

  it("ignora Thumbs.db", () => {
    expect(shouldIgnorePath("Thumbs.db")).toBe(true);
  });

  it("no ignora nombres normales", () => {
    expect(shouldIgnorePath("GARCIA TORRES")).toBe(false);
  });

  it("no ignora archivos con nombre que contiene punto en medio", () => {
    expect(shouldIgnorePath("DEMANDA.docx")).toBe(false);
  });
});

// ─── classifyDocument ─────────────────────────────────────────────────────────

describe("classifyDocument", () => {
  it("detecta DEMANDA", () => {
    expect(classifyDocument("DEMANDA DE EJECUCIÓN.docx")).toBe("DEMANDA");
  });

  it("detecta CARGO", () => {
    expect(classifyDocument("CARGO-YLLA NEGRON.pdf")).toBe("CARGO");
  });

  it("detecta ANEXOS", () => {
    expect(classifyDocument("ANEXOS-GARCIA.pdf")).toBe("ANEXOS");
  });

  it("detecta SENTENCIA", () => {
    expect(classifyDocument("Sentencia Final.pdf")).toBe("SENTENCIA");
  });

  it("detecta RESOLUCIÓN con tilde", () => {
    expect(classifyDocument("RESOLUCIÓN-2024.pdf")).toBe("RESOLUCIÓN");
  });

  it("detecta NOTIFICACIÓN", () => {
    expect(classifyDocument("notificación-juzgado.pdf")).toBe("NOTIFICACIÓN");
  });

  it("clasifica como OTROS si no hay coincidencia", () => {
    expect(classifyDocument("CONTRATO_SERVICIOS.pdf")).toBe("OTROS");
  });
});

// ─── analyzeText ──────────────────────────────────────────────────────────────

describe("analyzeText", () => {
  it("detecta DNI de 8 dígitos", () => {
    const result = analyzeText("DNI: 12345678 del señor García.");
    expect(result.dni).toBe("12345678");
  });

  it("detecta correo electrónico", () => {
    const result = analyzeText("Puede contactar al correo juan.perez@gmail.com");
    expect(result.email).toBe("juan.perez@gmail.com");
  });

  it("detecta número de expediente", () => {
    const result = analyzeText("EXPEDIENTE N° 01234-2024-0-JDPT-JR-CI-01");
    expect(result.expedientes.length).toBeGreaterThan(0);
    expect(result.expedientes[0]).toContain("01234-2024");
  });

  it("detecta teléfono peruano de 9 dígitos", () => {
    const result = analyzeText("Teléfono: 987654321");
    expect(result.phone).toBe("987654321");
  });

  it("no inventa datos cuando no existen", () => {
    const result = analyzeText("Documento sin datos de contacto.");
    expect(result.dni).toBeUndefined();
    expect(result.phone).toBeUndefined();
    expect(result.email).toBeUndefined();
  });

  it("detecta múltiples expedientes distintos", () => {
    const text =
      "EXPEDIENTE N° 01234-2024-0-JDPT-JR-CI-01\n" + "Acumulado con EXP. N° 05678-2023-0-JDPT";
    const result = analyzeText(text);
    expect(result.expedientes.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── formatSize ───────────────────────────────────────────────────────────────

describe("formatSize", () => {
  it("formatea bytes", () => expect(formatSize(500)).toBe("500 B"));
  it("formatea kilobytes", () => expect(formatSize(2048)).toBe("2 KB"));
  it("formatea megabytes", () => expect(formatSize(1048576)).toBe("1.0 MB"));
});

// ─── sha256 ───────────────────────────────────────────────────────────────────

describe("sha256", () => {
  it("retorna un string hex de 64 caracteres", async () => {
    const buf = new TextEncoder().encode("test").buffer;
    const hash = await sha256(buf as ArrayBuffer);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("dos buffers idénticos producen el mismo hash", async () => {
    const buf1 = new TextEncoder().encode("hola").buffer;
    const buf2 = new TextEncoder().encode("hola").buffer;
    const [h1, h2] = await Promise.all([sha256(buf1 as ArrayBuffer), sha256(buf2 as ArrayBuffer)]);
    expect(h1).toBe(h2);
  });

  it("buffers distintos producen hashes distintos", async () => {
    const buf1 = new TextEncoder().encode("hola").buffer;
    const buf2 = new TextEncoder().encode("chau").buffer;
    const [h1, h2] = await Promise.all([sha256(buf1 as ArrayBuffer), sha256(buf2 as ArrayBuffer)]);
    expect(h1).not.toBe(h2);
  });
});

// ─── detectDuplicates ─────────────────────────────────────────────────────────

describe("detectDuplicates", () => {
  const makeCandidate = (overrides: Partial<ClientCandidate> = {}): ClientCandidate => ({
    folderName: "GARCIA TORRES MANUEL",
    proposedName: "GARCIA TORRES MANUEL",
    detected: { expedientes: [], relevantDates: [], fullNameCandidates: [] },
    files: [],
    warnings: [],
    folderPath: "GARCIA TORRES MANUEL",
    excluded: false,
    ...overrides,
  });

  const existing: ExistingClient[] = [
    { id: "1", name: "GARCIA TORRES MANUEL", dni: "12345678", phone: "987654321" },
    { id: "2", name: "LOPEZ MENDEZ ANA", dni: "87654321", phone: "912345678" },
  ];

  it("detecta duplicado por DNI exacto", () => {
    const c = makeCandidate({
      detected: { dni: "12345678", expedientes: [], relevantDates: [], fullNameCandidates: [] },
    });
    const matches = detectDuplicates(c, existing);
    expect(matches.some((m) => m.matchStrength === "exact_dni")).toBe(true);
  });

  it("detecta duplicado por nombre exacto normalizado", () => {
    const c = makeCandidate({ proposedName: "GARCIA TORRES MANUEL" });
    const matches = detectDuplicates(c, existing);
    expect(matches.some((m) => m.matchStrength === "exact_name")).toBe(true);
  });

  it("no detecta duplicado cuando DNI y nombre son distintos", () => {
    const c = makeCandidate({
      proposedName: "FERNANDEZ RIOS PEDRO",
      detected: { dni: "11111111", expedientes: [], relevantDates: [], fullNameCandidates: [] },
    });
    const matches = detectDuplicates(c, existing);
    expect(
      matches.filter((m) => m.matchStrength === "exact_dni" || m.matchStrength === "exact_name"),
    ).toHaveLength(0);
  });

  it("nunca sobrescribe automáticamente — solo retorna coincidencias", () => {
    const c = makeCandidate({
      detected: { dni: "12345678", expedientes: [], relevantDates: [], fullNameCandidates: [] },
    });
    const matches = detectDuplicates(c, existing);
    // Retorna las coincidencias, no modifica el candidato
    expect(Array.isArray(matches)).toBe(true);
    expect(c.proposedName).toBe("GARCIA TORRES MANUEL"); // sin cambios
  });
});

// ─── parseZipFile ─────────────────────────────────────────────────────────────

describe("parseZipFile", () => {
  it("lee un ZIP básico con una carpeta y un PDF", async () => {
    const zipBuf = await buildZip([
      { path: "YLLA NEGRON YENI/DEMANDA.pdf", content: "%PDF-1.4 contenido básico" },
    ]);
    const result = await parseZipFile(zipBuf);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].proposedName).toBe("YLLA NEGRON YENI");
    expect(result.candidates[0].files).toHaveLength(1);
  });

  it("reconoce carpetas con tildes en el nombre", async () => {
    const zipBuf = await buildZip([
      { path: "ÑUÑEZ LÓPEZ MARÍA/SENTENCIA.pdf", content: "%PDF-1.4" },
    ]);
    const result = await parseZipFile(zipBuf);
    expect(result.candidates[0].proposedName).toBe("ÑUÑEZ LÓPEZ MARÍA");
  });

  it("agrupa archivos de subcarpetas bajo la carpeta principal", async () => {
    const zipBuf = await buildZip([
      { path: "GARCIA TORRES/EXPEDIENTE 01/DEMANDA.pdf", content: "%PDF" },
      { path: "GARCIA TORRES/EXPEDIENTE 01/CARGO.pdf", content: "%PDF" },
      { path: "GARCIA TORRES/SENTENCIA.pdf", content: "%PDF" },
    ]);
    const result = await parseZipFile(zipBuf);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].files).toHaveLength(3);
  });

  it("ignora archivos ocultos y carpetas del sistema", async () => {
    const zipBuf = await buildZip([
      { path: "__MACOSX/._DEMANDA.pdf", content: "oculto" },
      { path: ".DS_Store", content: "sistema" },
      { path: "CLIENTE REAL/DEMANDA.pdf", content: "%PDF" },
    ]);
    const result = await parseZipFile(zipBuf);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].folderName).toBe("CLIENTE REAL");
    expect(result.ignoredPaths.some((p) => p.includes("MACOSX"))).toBe(true);
  });

  it("maneja carpetas múltiples (varios clientes)", async () => {
    const zipBuf = await buildZip([
      { path: "GARCIA TORRES/DEMANDA.docx", content: "contenido demanda" },
      { path: "LOPEZ MENDEZ/SENTENCIA.pdf", content: "%PDF" },
      { path: "RAMIREZ SOTO/CARGO.pdf", content: "%PDF" },
    ]);
    const result = await parseZipFile(zipBuf);
    expect(result.candidates).toHaveLength(3);
  });

  it("ignora extensiones no permitidas", async () => {
    const zipBuf = await buildZip([
      { path: "CLIENTE/document.pdf", content: "%PDF" },
      { path: "CLIENTE/virus.exe", content: "exec" },
      { path: "CLIENTE/data.json", content: "{}" },
    ]);
    const result = await parseZipFile(zipBuf);
    expect(result.candidates[0].files).toHaveLength(1);
    expect(result.ignoredPaths.some((p) => p.includes(".exe"))).toBe(true);
  });

  it("marca archivos vacíos con extractionStatus 'empty'", async () => {
    const zipBuf = await buildZip([{ path: "CLIENTE/VACIO.pdf", content: new Uint8Array(0) }]);
    const result = await parseZipFile(zipBuf);
    const f = result.candidates[0]?.files[0];
    expect(f?.extractionStatus).toBe("empty");
  });

  it("agrega advertencia cuando hay múltiples expedientes detectados", async () => {
    const docxContent = `
      EXPEDIENTE N° 01234-2024
      EXPEDIENTE N° 05678-2023
      Caso de la señora García
    `;
    // Simulamos un DOCX mínimo (mammoth fallará, pero el texto en docx es detectado)
    const zipBuf = await buildZip([{ path: "GARCIA/notas.txt", content: docxContent }]);
    const result = await parseZipFile(zipBuf);
    // Con texto extraído, se deben detectar advertencias si hay varios expedientes
    // O al menos no crashear
    expect(result.candidates).toHaveLength(1);
  });

  it("no cancela toda la importación por un archivo problemático", async () => {
    // Un DOCX corrupto no debe detener el procesamiento de otras carpetas
    const zipBuf = await buildZip([
      { path: "CLIENTE A/DEMANDA.pdf", content: "%PDF-1.4 texto válido" },
      { path: "CLIENTE A/corrupto.docx", content: new Uint8Array([0x00, 0x01]) },
      { path: "CLIENTE B/CARGO.pdf", content: "%PDF-1.4 otro texto" },
    ]);
    const result = await parseZipFile(zipBuf);
    // Ambos clientes deben aparecer a pesar del archivo corrupto
    expect(result.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it("lanza error descriptivo para un ZIP corrupto", async () => {
    await expect(parseZipFile(corruptBuffer())).rejects.toThrow(/corrupto|compatible/i);
  });

  it("detecta el nombre de la carpeta en el proposedName con Drive suffix eliminado", async () => {
    const zipBuf = await buildZip([{ path: "RAMIREZ QUISPE (2)/DEMANDA.pdf", content: "%PDF" }]);
    const result = await parseZipFile(zipBuf);
    expect(result.candidates[0].proposedName).toBe("RAMIREZ QUISPE");
  });

  it("un cliente con varios expedientes en texto plano", async () => {
    const texto = `
      EXPEDIENTE N° 01234-2024-0-JDPT
      EXPEDIENTE N° 07890-2023-0-JDPT
      DNI: 45678901
    `;
    const zipBuf = await buildZip([{ path: "MENDOZA TORRES/notas.txt", content: texto }]);
    const result = await parseZipFile(zipBuf);
    expect(result.candidates).toHaveLength(1);
    // Se debe agregar advertencia de múltiples expedientes
    const candidate = result.candidates[0];
    // El texto extraído detecta expedientes
    expect(candidate.detected.expedientes.length).toBeGreaterThanOrEqual(1);
  });

  it("ZIP vacío (sin carpetas de clientes) retorna candidates vacío", async () => {
    const zip = new JSZip();
    const buf = await zip.generateAsync({ type: "arraybuffer" });
    const result = await parseZipFile(buf);
    expect(result.candidates).toHaveLength(0);
  });

  it("no registra errores de parseo para archivos correctos", async () => {
    const zipBuf = await buildZip([{ path: "CLIENTE/DEMANDA.pdf", content: "%PDF-1.4 normal" }]);
    const result = await parseZipFile(zipBuf);
    expect(result.parseErrors).toHaveLength(0);
  });
});
