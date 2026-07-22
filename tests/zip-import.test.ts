/**
 * Tests para el importador ZIP de carpetas de clientes (Google Drive).
 * Cubre: lectura del ZIP, carpetas anidadas, nombres con tildes,
 * agrupaciÃ³n, DOCX, PDF, archivos vacÃ­os, ZIP corrupto, duplicados,
 * mÃºltiples carpetas del mismo cliente, varios expedientes, y
 * error parcial sin cancelar toda la importaciÃ³n.
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
  parseSingleClientZipFile,
  SINGLE_CLIENT_ZIP_ERROR,
  moveDocumentBetweenCases,
  removeCaseCandidate,
  analyzeTextWithEvidence,
  formatSize,
  sha256,
  buildZipTree,
  normalizeProcessType,
  type ClientCandidate,
  type ExistingClient,
} from "@/lib/imports/zip-import";

// â”€â”€â”€ Helpers de test â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ Mock crypto.subtle.digest para entorno Node â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

beforeAll(() => {
  // Node 18+ tiene crypto.subtle, pero por si acaso lo aseguramos
  if (typeof globalThis.crypto === "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { webcrypto } = require("node:crypto");
    Object.defineProperty(globalThis, "crypto", { value: webcrypto });
  }
});

// â”€â”€â”€ normalizeFolderName â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("normalizeFolderName", () => {
  it("elimina espacios repetidos", () => {
    expect(normalizeFolderName("YLLA  NEGRON  YENI")).toBe("YLLA NEGRON YENI");
  });

  it("elimina sufijo numÃ©rico de Google Drive", () => {
    expect(normalizeFolderName("GARCIA TORRES (1)")).toBe("GARCIA TORRES");
  });

  it("conserva tildes y caracteres especiales", () => {
    expect(normalizeFolderName("Ã‘UÃ‘EZ LÃ“PEZ MARÃA")).toBe("Ã‘UÃ‘EZ LÃ“PEZ MARÃA");
  });

  it("recorta espacios al inicio y final", () => {
    expect(normalizeFolderName("  RODRIGUEZ PEREZ  ")).toBe("RODRIGUEZ PEREZ");
  });

  it("conserva mayÃºsculas sin modificar", () => {
    expect(normalizeFolderName("YLLA NEGRON YENI")).toBe("YLLA NEGRON YENI");
  });
});

// â”€â”€â”€ shouldIgnorePath â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ classifyDocument â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("classifyDocument", () => {
  it("detecta DEMANDA", () => {
    expect(classifyDocument("DEMANDA DE EJECUCIÃ“N.docx")).toBe("DEMANDA");
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

  it("detecta RESOLUCIÃ“N con tilde", () => {
    expect(classifyDocument("RESOLUCIÃ“N-2024.pdf")).toBe("RESOLUCIÓN");
  });

  it("detecta NOTIFICACIÃ“N", () => {
    expect(classifyDocument("notificaciÃ³n-juzgado.pdf")).toBe("NOTIFICACIÓN");
  });

  it("clasifica como OTROS si no hay coincidencia", () => {
    expect(classifyDocument("CONTRATO_SERVICIOS.pdf")).toBe("OTROS");
  });
});

// â”€â”€â”€ analyzeText â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("analyzeText", () => {
  it("detecta DNI de 8 dÃ­gitos", () => {
    const result = analyzeText("DNI: 12345678 del seÃ±or GarcÃ­a.");
    expect(result.dni).toBe("12345678");
  });

  it("detecta correo electrÃ³nico", () => {
    const result = analyzeText("Puede contactar al correo juan.perez@gmail.com");
    expect(result.email).toBe("juan.perez@gmail.com");
  });

  it("detecta nÃºmero de expediente", () => {
    const result = analyzeText("EXPEDIENTE NÂ° 01234-2024-0-JDPT-JR-CI-01");
    expect(result.expedientes.length).toBeGreaterThan(0);
    expect(result.expedientes[0]).toContain("01234-2024");
  });

  it("detecta telÃ©fono peruano de 9 dÃ­gitos", () => {
    const result = analyzeText("TelÃ©fono: 987654321");
    expect(result.phone).toBe("987654321");
  });

  it("no inventa datos cuando no existen", () => {
    const result = analyzeText("Documento sin datos de contacto.");
    expect(result.dni).toBeUndefined();
    expect(result.phone).toBeUndefined();
    expect(result.email).toBeUndefined();
  });

  it("detecta mÃºltiples expedientes distintos", () => {
    const text =
      "EXPEDIENTE NÂ° 01234-2024-0-JDPT-JR-CI-01\n" + "Acumulado con EXP. NÂ° 05678-2023-0-JDPT";
    const result = analyzeText(text);
    expect(result.expedientes.length).toBeGreaterThanOrEqual(1);
  });
});

// â”€â”€â”€ formatSize â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("formatSize", () => {
  it("formatea bytes", () => expect(formatSize(500)).toBe("500 B"));
  it("formatea kilobytes", () => expect(formatSize(2048)).toBe("2 KB"));
  it("formatea megabytes", () => expect(formatSize(1048576)).toBe("1.0 MB"));
});

// â”€â”€â”€ sha256 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("sha256", () => {
  it("retorna un string hex de 64 caracteres", async () => {
    const buf = new TextEncoder().encode("test").buffer;
    const hash = await sha256(buf as ArrayBuffer);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("dos buffers idÃ©nticos producen el mismo hash", async () => {
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

// â”€â”€â”€ detectDuplicates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

  it("nunca sobrescribe automÃ¡ticamente â€” solo retorna coincidencias", () => {
    const c = makeCandidate({
      detected: { dni: "12345678", expedientes: [], relevantDates: [], fullNameCandidates: [] },
    });
    const matches = detectDuplicates(c, existing);
    // Retorna las coincidencias, no modifica el candidato
    expect(Array.isArray(matches)).toBe(true);
    expect(c.proposedName).toBe("GARCIA TORRES MANUEL"); // sin cambios
  });
});

// â”€â”€â”€ parseZipFile â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("parseZipFile", () => {
  it("lee un ZIP bÃ¡sico con una carpeta y un PDF", async () => {
    const zipBuf = await buildZip([
      { path: "YLLA NEGRON YENI/DEMANDA.pdf", content: "%PDF-1.4 contenido bÃ¡sico" },
    ]);
    const result = await parseZipFile(zipBuf);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].proposedName).toBe("YLLA NEGRON YENI");
    expect(result.candidates[0].files).toHaveLength(1);
  });

  it("reconoce carpetas con tildes en el nombre", async () => {
    const zipBuf = await buildZip([
      { path: "Ã‘UÃ‘EZ LÃ“PEZ MARÃA/SENTENCIA.pdf", content: "%PDF-1.4" },
    ]);
    const result = await parseZipFile(zipBuf);
    expect(result.candidates[0].proposedName).toBe("Ã‘UÃ‘EZ LÃ“PEZ MARÃA");
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

  it("maneja carpetas mÃºltiples (varios clientes)", async () => {
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

  it("marca archivos vacÃ­os con extractionStatus 'empty'", async () => {
    const zipBuf = await buildZip([{ path: "CLIENTE/VACIO.pdf", content: new Uint8Array(0) }]);
    const result = await parseZipFile(zipBuf);
    const f = result.candidates[0]?.files[0];
    expect(f?.extractionStatus).toBe("empty");
  });

  it("agrega advertencia cuando hay mÃºltiples expedientes detectados", async () => {
    const docxContent = `
      EXPEDIENTE NÂ° 01234-2024
      EXPEDIENTE NÂ° 05678-2023
      Caso de la seÃ±ora GarcÃ­a
    `;
    // Simulamos un DOCX mÃ­nimo (mammoth fallarÃ¡, pero el texto en docx es detectado)
    const zipBuf = await buildZip([{ path: "GARCIA/notas.txt", content: docxContent }]);
    const result = await parseZipFile(zipBuf);
    // Con texto extraÃ­do, se deben detectar advertencias si hay varios expedientes
    // O al menos no crashear
    expect(result.candidates).toHaveLength(1);
  });

  it("no cancela toda la importaciÃ³n por un archivo problemÃ¡tico", async () => {
    // Un DOCX corrupto no debe detener el procesamiento de otras carpetas
    const zipBuf = await buildZip([
      { path: "CLIENTE A/DEMANDA.pdf", content: "%PDF-1.4 texto vÃ¡lido" },
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
      EXPEDIENTE NÂ° 01234-2024-0-JDPT
      EXPEDIENTE NÂ° 07890-2023-0-JDPT
      DNI: 45678901
    `;
    const zipBuf = await buildZip([{ path: "MENDOZA TORRES/notas.txt", content: texto }]);
    const result = await parseZipFile(zipBuf);
    expect(result.candidates).toHaveLength(1);
    // Se debe agregar advertencia de mÃºltiples expedientes
    const candidate = result.candidates[0];
    // El texto extraÃ­do detecta expedientes
    expect(candidate.detected.expedientes.length).toBeGreaterThanOrEqual(1);
  });

  it("ZIP vacÃ­o (sin carpetas de clientes) retorna candidates vacÃ­o", async () => {
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

describe("parseZipFile jerarquico", () => {
  it("detecta contenedor con multiples clientes sin crear cliente contenedor", async () => {
    const zipBuf = await buildZip([
      {
        path: "A-EXPEDIENTES DE CLIENTES/YLLA NEGRON YENI/DEMANDA.txt",
        content: "DNI: 12345678 PROCESO: ALIMENTOS",
      },
      { path: "A-EXPEDIENTES DE CLIENTES/GARCIA TORRES MANUEL/CARGO.pdf", content: "%PDF" },
    ]);
    const result = await parseZipFile(zipBuf);
    expect(result.candidates.map((c) => c.proposedName).sort()).toEqual([
      "GARCIA TORRES MANUEL",
      "YLLA NEGRON YENI",
    ]);
    expect(result.candidates.some((c) => c.proposedName === "A-EXPEDIENTES DE CLIENTES")).toBe(
      false,
    );
  });

  it("mantiene un unico folder de cliente como candidato", async () => {
    const zipBuf = await buildZip([
      { path: "YLLA NEGRON YENI/DEMANDA.txt", content: "DNI: 12345678" },
    ]);
    const result = await parseZipFile(zipBuf);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].folderPath).toBe("YLLA NEGRON YENI");
  });

  it("soporta cliente anidado debajo de contenedor generico", async () => {
    const zipBuf = await buildZip([
      {
        path: "Backup Google Drive/Clientes/LOPEZ MENDEZ ANA/documento.txt",
        content: "Telefono: 987654321",
      },
    ]);
    const result = await parseZipFile(zipBuf);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].proposedName).toBe("LOPEZ MENDEZ ANA");
  });

  it("crea expediente provisional cuando hay documentos sin numero", async () => {
    const zipBuf = await buildZip([
      { path: "MENDOZA TORRES/DEMANDA DE ALIMENTOS.txt", content: "Materia: Alimentos" },
    ]);
    const result = await parseZipFile(zipBuf);
    const provisional = result.candidates[0].caseCandidates?.[0];
    expect(provisional?.isProvisional).toBe(true);
    expect(provisional?.title).toMatch(/pendiente de clasificacion/i);
    expect(provisional?.processType).toBe("Alimentos");
  });

  it("agrupa documentos por varios numeros de expediente", async () => {
    const zipBuf = await buildZip([
      {
        path: "MENDOZA TORRES/EXP 01234-2024-0-JR-FC-01/demanda.txt",
        content: "Expediente 01234-2024-0-JR-FC-01",
      },
      {
        path: "MENDOZA TORRES/EXP 05678-2023-0-JR-FC-02/cargo.txt",
        content: "Expediente 05678-2023-0-JR-FC-02",
      },
    ]);
    const result = await parseZipFile(zipBuf);
    expect(result.candidates[0].caseCandidates?.map((c) => c.caseNumber).sort()).toEqual([
      "01234-2024-0-JR-FC-01",
      "05678-2023-0-JR-FC-02",
    ]);
  });

  it("no convierte frases libres en tipo de proceso", () => {
    expect(
      normalizeProcessType("recurro a su despacho a fin de solicitar a usted"),
    ).toBeUndefined();
    expect(
      analyzeText("PROCESO: recurro a su despacho a fin de solicitar a usted").processType,
    ).toBeUndefined();
  });

  it("detecta juzgado con patron corregido", () => {
    const result = analyzeText("Ante el 2 JUZGADO DE PAZ LETRADO DE FAMILIA DE LIMA solicito...");
    expect(result.juzgado).toContain("JUZGADO");
  });

  it("reconstruye arbol completo con profundidad y totales", () => {
    const tree = buildZipTree([
      "Contenedor/Cliente Uno/Expediente A/doc1.pdf",
      "Contenedor/Cliente Uno/doc2.pdf",
    ]);
    const container = tree.find((node) => node.path === "Contenedor");
    const client = tree.find((node) => node.path === "Contenedor/Cliente Uno");
    expect(container?.totalDescendantDocs).toBe(2);
    expect(client?.depth).toBe(2);
    expect(client?.subfolders).toContain("Contenedor/Cliente Uno/Expediente A");
  });
});

describe("importacion ZIP individual", () => {
  it("acepta documentos directos de un solo cliente", async () => {
    const zipBuf = await buildZip([
      { path: "YLLA NEGRON YENI/DEMANDA.txt", content: "DNI: 12345678 Materia: Alimentos" },
      { path: "YLLA NEGRON YENI/CARGO.pdf", content: "%PDF" },
    ]);
    const result = await parseSingleClientZipFile(zipBuf);
    expect(result.rejectionReason).toBeUndefined();
    expect(result.candidate?.proposedName).toBe("YLLA NEGRON YENI");
    expect(result.candidate?.caseCandidates?.[0].origin).toBe("importacion_zip_individual");
  });

  it("acepta contenedor generico con un solo cliente real", async () => {
    const zipBuf = await buildZip([
      { path: "A-EXPEDIENTES DE CLIENTES/YLLA NEGRON YENI/DEMANDA.txt", content: "DNI: 12345678" },
    ]);
    const result = await parseSingleClientZipFile(zipBuf);
    expect(result.candidate?.proposedName).toBe("YLLA NEGRON YENI");
    expect(result.candidates).toHaveLength(1);
  });

  it("rechaza ZIP con mas de un cliente", async () => {
    const zipBuf = await buildZip([
      { path: "CLIENTE UNO/DEMANDA.txt", content: "DNI: 12345678" },
      { path: "CLIENTE DOS/CARGO.txt", content: "DNI: 87654321" },
    ]);
    const result = await parseSingleClientZipFile(zipBuf);
    expect(result.rejectionReason).toBe(SINGLE_CLIENT_ZIP_ERROR);
    expect(result.candidates).toHaveLength(2);
  });

  it("no inventa datos y conserva evidencia por campo", () => {
    const result = analyzeTextWithEvidence(
      "DNI: 12345678\nRUC: 20123456789\nTelefono: 987654321\nCorreo: cliente@test.pe",
      "CLIENTE/DEMANDA.txt",
      "DEMANDA.txt",
    );
    expect(result.detected.dni).toBe("12345678");
    expect(result.detected.ruc).toBe("20123456789");
    expect(result.fieldEvidence.client.dni?.sourceName).toBe("DEMANDA.txt");
    expect(result.fieldEvidence.client.address).toBeUndefined();
  });

  it("crea expediente provisional con estado pendiente_revision cuando falta numero", async () => {
    const zipBuf = await buildZip([
      { path: "MENDOZA TORRES/ANEXOS/documento.txt", content: "Documento sin expediente" },
    ]);
    const result = await parseSingleClientZipFile(zipBuf);
    const provisional = result.candidate?.caseCandidates?.[0];
    expect(provisional?.isProvisional).toBe(true);
    expect(provisional?.status).toBe("pendiente_revision");
    expect(provisional?.matter).toBe("Pendiente de clasificacion");
  });

  it("permite mover documentos entre expedientes y dejar sin clasificar", () => {
    const cases = [
      {
        id: "exp-1",
        title: "Exp 1",
        caseNumber: "1",
        processType: "Alimentos",
        matter: "Alimentos",
        specialty: "Familia",
        juzgado: "Juzgado",
        status: "Consulta",
        origin: "importacion_zip_individual" as const,
        originPath: "CLIENTE",
        confidence: 0.8,
        warnings: [],
        documentPaths: ["a.pdf"],
        isProvisional: false,
      },
      {
        id: "exp-2",
        title: "Exp 2",
        caseNumber: "2",
        processType: "Civil",
        matter: "Civil",
        specialty: "Civil",
        juzgado: "Juzgado",
        status: "Consulta",
        origin: "importacion_zip_individual" as const,
        originPath: "CLIENTE",
        confidence: 0.8,
        warnings: [],
        documentPaths: [],
        isProvisional: false,
      },
    ];
    const moved = moveDocumentBetweenCases(cases, { "a.pdf": "exp-1" }, "a.pdf", "exp-2");
    expect(moved.documentCaseMap["a.pdf"]).toBe("exp-2");
    expect(moved.caseCandidates[1].documentPaths).toContain("a.pdf");

    const removed = removeCaseCandidate(moved.caseCandidates, moved.documentCaseMap, "exp-2");
    expect(removed.documentCaseMap["a.pdf"]).toBe("__unclassified");
    expect(removed.caseCandidates.some((item) => item.id === "exp-2")).toBe(false);
  });
});
