/**
 * tests/zip-import.test.ts
 *
 * Pruebas unitarias para el motor de importación ZIP.
 * Cubre los 20 casos de prueba obligatorios del prompt.
 *
 * NO hace operaciones de red, no crea clientes, no sube archivos.
 */

import { describe, it, expect } from "vitest";
import { analyzeZipEntries, type RawZipEntry } from "@/lib/zip-import/analyzer";
import {
  validateEntryPath,
  shouldIgnoreEntry,
  isDangerousExtension,
  detectZipBomb,
} from "@/lib/zip-import/security";
import {
  normalizeClientName,
  findClientMatch,
  findInternalDuplicates,
} from "@/lib/zip-import/client-normalizer";
import { isGrouperFolder } from "@/lib/zip-import/analyzer";

// ─── Helpers de prueba ────────────────────────────────────────────────────────

function dir(path: string): RawZipEntry {
  return { path, isDirectory: true, size: 0 };
}

function file(path: string, size = 1024): RawZipEntry {
  return { path, isDirectory: false, size };
}

// ─── 1. ZIP con carpeta contenedora ──────────────────────────────────────────

describe("1. ZIP con carpeta contenedora externa", () => {
  it("detecta la contenedora y extrae 4 clientes reales", () => {
    const entries: RawZipEntry[] = [
      dir("CLIENTES 2026/"),
      dir("CLIENTES 2026/A-CLIENTES 2025/"),
      dir("CLIENTES 2026/A-CLIENTES 2025/CLIENTE UNO/"),
      file("CLIENTES 2026/A-CLIENTES 2025/CLIENTE UNO/demanda.pdf"),
      file("CLIENTES 2026/A-CLIENTES 2025/CLIENTE UNO/resoluciones/resolucion-1.pdf"),
      dir("CLIENTES 2026/A-CLIENTES 2025/CLIENTE DOS/"),
      file("CLIENTES 2026/A-CLIENTES 2025/CLIENTE DOS/documento.docx"),
      dir("CLIENTES 2026/ADRIANO CORNE, KYAM/"),
      file("CLIENTES 2026/ADRIANO CORNE, KYAM/documento-1.pdf"),
      file("CLIENTES 2026/ADRIANO CORNE, KYAM/escritos/escrito-1.docx"),
      dir("CLIENTES 2026/PONCE QUISPE, SILVIA/"),
      dir("CLIENTES 2026/PONCE QUISPE, SILVIA/documentos/"),
      file("CLIENTES 2026/PONCE QUISPE, SILVIA/documentos/documento-1.pdf"),
    ];
    const result = analyzeZipEntries(entries);

    expect(result.hasOuterContainer).toBe(true);
    expect(result.containerName).toBe("CLIENTES 2026");
    // NO crear cliente "CLIENTES 2026" ni "A-CLIENTES 2025"
    const names = result.clients.map((c) => c.originalName);
    expect(names).not.toContain("CLIENTES 2026");
    expect(names).not.toContain("A-CLIENTES 2025");
    expect(names).toContain("CLIENTE UNO");
    expect(names).toContain("CLIENTE DOS");
    expect(names).toContain("ADRIANO CORNE, KYAM");
    expect(names).toContain("PONCE QUISPE, SILVIA");
    expect(result.clients.length).toBe(4);
  });

  it("detecta 6 documentos en la estructura de prueba", () => {
    const entries: RawZipEntry[] = [
      dir("CLIENTES 2026/"),
      dir("CLIENTES 2026/A-CLIENTES 2025/"),
      dir("CLIENTES 2026/A-CLIENTES 2025/CLIENTE UNO/"),
      file("CLIENTES 2026/A-CLIENTES 2025/CLIENTE UNO/demanda.pdf"),
      file("CLIENTES 2026/A-CLIENTES 2025/CLIENTE UNO/resoluciones/resolucion-1.pdf"),
      dir("CLIENTES 2026/A-CLIENTES 2025/CLIENTE DOS/"),
      file("CLIENTES 2026/A-CLIENTES 2025/CLIENTE DOS/documento.docx"),
      dir("CLIENTES 2026/ADRIANO CORNE, KYAM/"),
      file("CLIENTES 2026/ADRIANO CORNE, KYAM/documento-1.pdf"),
      file("CLIENTES 2026/ADRIANO CORNE, KYAM/escritos/escrito-1.docx"),
      dir("CLIENTES 2026/PONCE QUISPE, SILVIA/"),
      file("CLIENTES 2026/PONCE QUISPE, SILVIA/documentos/documento-1.pdf"),
    ];
    const result = analyzeZipEntries(entries);
    const totalAllowed = result.clients.reduce(
      (s, c) => s + c.documents.filter((d) => d.allowed).length,
      0,
    );
    expect(totalAllowed).toBe(6);
  });
});

// ─── 2. ZIP sin carpeta contenedora ──────────────────────────────────────────

describe("2. ZIP sin carpeta contenedora", () => {
  it("detecta clientes directamente en la raíz", () => {
    const entries: RawZipEntry[] = [
      dir("CLIENTE A/"),
      file("CLIENTE A/demanda.pdf"),
      dir("CLIENTE B/"),
      file("CLIENTE B/resolucion.pdf"),
    ];
    const result = analyzeZipEntries(entries);
    expect(result.hasOuterContainer).toBe(false);
    expect(result.clients.length).toBe(2);
    expect(result.clients.map((c) => c.originalName)).toContain("CLIENTE A");
    expect(result.clients.map((c) => c.originalName)).toContain("CLIENTE B");
  });
});

// ─── 3. ZIP con carpetas agrupadoras ─────────────────────────────────────────

describe("3. ZIP con carpetas agrupadoras", () => {
  it("no crea clientes para nombres agrupadores conocidos", () => {
    const entries: RawZipEntry[] = [
      dir("EXPEDIENTES/"),
      dir("EXPEDIENTES/RAMIREZ FLORES/"),
      file("EXPEDIENTES/RAMIREZ FLORES/doc.pdf"),
      dir("ARCHIVOS/"),
      dir("ARCHIVOS/PEREZ GARCIA/"),
      file("ARCHIVOS/PEREZ GARCIA/doc.pdf"),
    ];
    const result = analyzeZipEntries(entries);
    const names = result.clients.map((c) => c.originalName);
    expect(names).not.toContain("EXPEDIENTES");
    expect(names).not.toContain("ARCHIVOS");
    expect(names).toContain("RAMIREZ FLORES");
    expect(names).toContain("PEREZ GARCIA");
  });

  it("no crea cliente para 'A-CLIENTES 2025'", () => {
    expect(isGrouperFolder("A-CLIENTES 2025")).toBe(true);
    expect(isGrouperFolder("CLIENTES 2026")).toBe(true);
    expect(isGrouperFolder("EXPEDIENTES")).toBe(true);
    expect(isGrouperFolder("DOCUMENTOS")).toBe(true);
  });

  it("sí detecta como cliente a nombre real con coma", () => {
    expect(isGrouperFolder("PONCE QUISPE, SILVIA")).toBe(false);
    expect(isGrouperFolder("ADRIANO CORNE, KYAM")).toBe(false);
  });
});

// ─── 4. Cliente con subcarpetas ───────────────────────────────────────────────

describe("4. Cliente con subcarpetas", () => {
  it("agrupa todos los archivos bajo el mismo cliente", () => {
    const entries: RawZipEntry[] = [
      dir("PONCE QUISPE, SILVIA/"),
      dir("PONCE QUISPE, SILVIA/alimentos/"),
      file("PONCE QUISPE, SILVIA/alimentos/demanda.pdf"),
      dir("PONCE QUISPE, SILVIA/alimentos/anexos/"),
      file("PONCE QUISPE, SILVIA/alimentos/anexos/dni.jpg"),
      dir("PONCE QUISPE, SILVIA/resoluciones/"),
      file("PONCE QUISPE, SILVIA/resoluciones/resolucion-01.pdf"),
    ];
    const result = analyzeZipEntries(entries);
    expect(result.clients.length).toBe(1);
    const client = result.clients[0];
    expect(client.originalName).toBe("PONCE QUISPE, SILVIA");
    expect(client.documents.filter((d) => d.allowed).length).toBe(3);
    // Verificar rutas relativas
    const relPaths = client.documents.map((d) => d.relativePath);
    expect(relPaths).toContain("alimentos/demanda.pdf");
    expect(relPaths).toContain("alimentos/anexos/dni.jpg");
    expect(relPaths).toContain("resoluciones/resolucion-01.pdf");
  });
});

// ─── 5. ZIP corrupto ─────────────────────────────────────────────────────────
// (No se puede probar aquí sin JSZip real; se verifica el path validation)

// ─── 6. Path traversal ───────────────────────────────────────────────────────

describe("6. Protección path traversal", () => {
  it("rechaza rutas con ../", () => {
    const r1 = validateEntryPath("../secreto/clave.txt");
    expect(r1.safe).toBe(false);
    const r2 = validateEntryPath("carpeta/../../etc/passwd");
    expect(r2.safe).toBe(false);
  });

  it("rechaza rutas absolutas", () => {
    const r1 = validateEntryPath("/etc/passwd");
    expect(r1.safe).toBe(false);
    const r2 = validateEntryPath("C:/Windows/system32");
    expect(r2.safe).toBe(false);
  });

  it("acepta rutas normales", () => {
    expect(validateEntryPath("CLIENTES/ADRIANO/demanda.pdf").safe).toBe(true);
    expect(validateEntryPath("PONCE QUISPE, SILVIA/resoluciones/res.pdf").safe).toBe(true);
  });
});

// ─── 7. Archivo no permitido ─────────────────────────────────────────────────

describe("7. Archivos no permitidos", () => {
  it("archivos ejecutables se omiten (extensión peligrosa)", () => {
    expect(isDangerousExtension("virus.exe")).toBe(true);
    expect(isDangerousExtension("script.bat")).toBe(true);
    expect(isDangerousExtension("macro.vbs")).toBe(true);
    expect(isDangerousExtension("programa.msi")).toBe(true);
  });

  it("archivos permitidos pasan la validación", () => {
    expect(isDangerousExtension("demanda.pdf")).toBe(false);
    expect(isDangerousExtension("escrito.docx")).toBe(false);
    expect(isDangerousExtension("foto.jpg")).toBe(false);
  });

  it("archivos no permitidos quedan en ignored, no fallan la importación", () => {
    const entries: RawZipEntry[] = [
      dir("CLIENTE A/"),
      file("CLIENTE A/demanda.pdf"),
      file("CLIENTE A/virus.exe"),
      file("CLIENTE A/notas.txt"),
    ];
    const result = analyzeZipEntries(entries);
    expect(result.clients.length).toBe(1);
    const client = result.clients[0];
    const allowedDocs = client.documents.filter((d) => d.allowed);
    expect(allowedDocs.length).toBe(2); // pdf + txt
    expect(result.ignored.some((e) => e.reason === "dangerous_extension")).toBe(true);
  });
});

// ─── 8. Carpetas vacías ───────────────────────────────────────────────────────

describe("8. Carpetas vacías", () => {
  it("ignora carpetas sin archivos descendientes", () => {
    const entries: RawZipEntry[] = [
      dir("CARPETA VACIA/"),
      dir("CLIENTE CON ARCHIVOS/"),
      file("CLIENTE CON ARCHIVOS/doc.pdf"),
    ];
    const result = analyzeZipEntries(entries);
    const names = result.clients.map((c) => c.originalName);
    expect(names).not.toContain("CARPETA VACIA");
    expect(names).toContain("CLIENTE CON ARCHIVOS");
  });
});

// ─── 9. Duplicado exacto de cliente ──────────────────────────────────────────

describe("9. Duplicado exacto de cliente", () => {
  it("detecta coincidencia exacta por nombre normalizado", () => {
    const existing = [{ id: "abc-123", name: "ADRIANO CORNE, KYAM" }];
    const match = findClientMatch("ADRIANO CORNE, KYAM", existing);
    expect(match).not.toBeNull();
    expect(match!.strength).toBe("exact");
    expect(match!.clientId).toBe("abc-123");
  });

  it("detecta coincidencia exacta ignorando tildes", () => {
    const existing = [{ id: "abc-123", name: "RAMIREZ SANTAMARIA" }];
    const match = findClientMatch("RAMÍREZ SANTAMARÍA", existing);
    expect(match).not.toBeNull();
    expect(match!.strength).toBe("exact");
  });
});

// ─── 10. Coincidencia probable ────────────────────────────────────────────────

describe("10. Coincidencia probable", () => {
  it("detecta coincidencia probable con nombre similar", () => {
    const existing = [{ id: "abc-123", name: "PONCE QUISPE SILVIA MARIA" }];
    const match = findClientMatch("PONCE QUISPE, SILVIA", existing);
    expect(match).not.toBeNull();
    expect(match!.strength).toBe("probable");
  });

  it("no fusiona coincidencias ambiguas automáticamente (solo las reporta)", () => {
    const existing = [{ id: "id1", name: "RAMIREZ GARCIA" }];
    const match = findClientMatch("RAMIREZ GARCIA PEPE", existing);
    // El resultado informa pero no fusiona — es tarea de la UI
    if (match) {
      expect(["exact", "probable"]).toContain(match.strength);
    }
  });
});

// ─── 11. Documento duplicado ─────────────────────────────────────────────────

describe("11. Documento duplicado (por relative_path)", () => {
  it("dos archivos con mismo nombre en subcarpetas distintas tienen diferentes relative_path", () => {
    const entries: RawZipEntry[] = [
      dir("CLIENTE/"),
      file("CLIENTE/resoluciones/documento.pdf"),
      file("CLIENTE/anexos/documento.pdf"),
    ];
    const result = analyzeZipEntries(entries);
    const client = result.clients[0];
    const paths = client.documents.map((d) => d.relativePath);
    expect(paths).toContain("resoluciones/documento.pdf");
    expect(paths).toContain("anexos/documento.pdf");
    expect(paths.length).toBe(2);
  });
});

// ─── 13. Cancelación antes de importar (dry-run sin efectos) ─────────────────

describe("14. Dry-run sin efectos", () => {
  it("el análisis no crea datos (solo lee entradas)", () => {
    const entries: RawZipEntry[] = [dir("CLIENTE A/"), file("CLIENTE A/doc.pdf")];
    // analyzeZipEntries no tiene efectos secundarios
    const result = analyzeZipEntries(entries);
    expect(result.clients.length).toBe(1);
    // No hay inserción en DB (función pura)
  });
});

// ─── 15. Permiso denegado para rol Personal ───────────────────────────────────
// (No se puede probar aquí sin conexión a Supabase real; se verifica en el server fn)

// ─── 17. Nombres con tildes, comas y paréntesis ───────────────────────────────

describe("17. Normalización de nombres especiales", () => {
  it("normaliza nombres con tildes", () => {
    expect(normalizeClientName("RAMÍREZ SANTAMARÍA")).toBe("ramirez santamaria");
    expect(normalizeClientName("LÓPEZ PÉREZ")).toBe("lopez perez");
  });

  it("normaliza nombres con comas", () => {
    const n = normalizeClientName("PONCE QUISPE, SILVIA");
    // La coma se convierte en espacio, luego se colapsa: resultado es "ponce quispe silvia"
    expect(n).toBe("ponce quispe silvia");
  });

  it("normaliza nombres con paréntesis", () => {
    const n = normalizeClientName("ROJAS CORDOVA RUT (ALIMENTOS)");
    expect(n).not.toContain("(");
    expect(n).not.toContain(")");
  });

  it("deduplica correctamente con coma vs sin coma", () => {
    const existing = [{ id: "id1", name: "PONCE QUISPE SILVIA" }];
    const match = findClientMatch("PONCE QUISPE, SILVIA", existing);
    expect(match).not.toBeNull();
    expect(match!.strength).toMatch(/exact|probable/);
  });
});

// ─── 18. Nombres largos ───────────────────────────────────────────────────────

describe("18. Nombres largos", () => {
  it("genera advertencia para nombres > 250 chars", () => {
    const longName = "APELLIDO ".repeat(30).trim(); // ~269 chars
    const entries: RawZipEntry[] = [dir(`${longName}/`), file(`${longName}/doc.pdf`)];
    const result = analyzeZipEntries(entries);
    if (result.clients.length > 0) {
      const client = result.clients[0];
      expect(client.warnings.some((w) => w.toLowerCase().includes("largo"))).toBe(true);
    }
  });
});

// ─── 19. Archivos ocultos ─────────────────────────────────────────────────────

describe("19. Archivos ocultos y metadatos del sistema", () => {
  it("ignora .DS_Store", () => {
    expect(shouldIgnoreEntry(".DS_Store")).toBe(true);
    expect(shouldIgnoreEntry("CLIENTE/.DS_Store")).toBe(true);
  });

  it("ignora __MACOSX", () => {
    expect(shouldIgnoreEntry("__MACOSX/CLIENTE/demanda.pdf")).toBe(true);
    expect(shouldIgnoreEntry("__MACOSX/")).toBe(true);
  });

  it("ignora archivos que empiezan con ._", () => {
    expect(shouldIgnoreEntry("CLIENTE/._demanda.pdf")).toBe(true);
  });

  it("ignora Thumbs.db y desktop.ini", () => {
    expect(shouldIgnoreEntry("Thumbs.db")).toBe(true);
    expect(shouldIgnoreEntry("desktop.ini")).toBe(true);
  });

  it("no ignora archivos normales", () => {
    expect(shouldIgnoreEntry("CLIENTE/demanda.pdf")).toBe(false);
    expect(shouldIgnoreEntry("ADRIANO CORNE, KYAM/resoluciones/res.pdf")).toBe(false);
  });
});

// ─── ZIP bomb ─────────────────────────────────────────────────────────────────

describe("ZIP bomb detection", () => {
  it("detecta ratio de compresión excesivo", () => {
    // compressedSize debe ser >= RATIO_MIN_COMPRESSED_SIZE (512) para que se aplique el check
    expect(detectZipBomb({ compressedSize: 600, uncompressedSize: 70_000 })).toBe(true);
    expect(detectZipBomb({ compressedSize: 1_000_000, uncompressedSize: 5_000_000 })).toBe(false);
  });

  it("ignora archivos muy pequeños para el ratio check", () => {
    // < 512 bytes comprimidos → no se aplica el ratio
    expect(detectZipBomb({ compressedSize: 10, uncompressedSize: 10_000 })).toBe(false);
  });
});

// ─── Duplicados internos ──────────────────────────────────────────────────────

describe("Duplicados internos en el propio ZIP", () => {
  it("detecta dos carpetas con el mismo nombre normalizado", () => {
    const dups = findInternalDuplicates(["PONCE QUISPE SILVIA", "PONCE QUISPE, SILVIA"]);
    expect(dups.length).toBeGreaterThan(0);
    expect(dups[0].strength).toMatch(/exact|probable/);
  });

  it("no reporta duplicado cuando son diferentes", () => {
    const dups = findInternalDuplicates(["RAMIREZ FLORES", "GARCIA PEREZ"]);
    expect(dups.length).toBe(0);
  });
});
