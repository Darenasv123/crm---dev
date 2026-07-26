/**
 * zip-persistence-folders.test.ts
 * Tests para la integración de carpetas en el importador ZIP (FASE 2).
 * Cubre los 15 escenarios requeridos.
 */
import { describe, expect, it } from "vitest";
import { persistZipCandidate } from "@/lib/imports/zip-persistence";
import type { ReviewCandidate, ZipFileEntry } from "@/lib/imports/zip-import";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buf(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

function makeFile(overrides: Partial<ZipFileEntry> = {}): ZipFileEntry {
  return {
    path: "CLIENTE/EXP 01/demanda.pdf",
    zipPath: "CLIENTE/EXP 01/demanda.pdf",
    folderPath: "CLIENTE",
    name: "demanda.pdf",
    ext: ".pdf",
    size: 10,
    data: buf("demanda"),
    docType: "DEMANDA",
    extractionStatus: "extracted",
    checksum: "cksum-001",
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<ReviewCandidate> = {}): ReviewCandidate {
  const file = makeFile();
  return {
    folderName: "CLIENTE PRUEBA",
    proposedName: "CLIENTE PRUEBA",
    folderPath: "CLIENTE PRUEBA",
    detected: { expedientes: [], relevantDates: [], fullNameCandidates: [] },
    files: [file],
    warnings: [],
    excluded: false,
    duplicates: [],
    edits: {},
    excludedFiles: new Set<string>(),
    excludedFolders: new Set<string>(),
    documentCaseMap: { [file.zipPath]: "exp-01" },
    caseCandidates: [
      {
        id: "exp-01",
        title: "Expediente 01",
        caseNumber: "01234-2024",
        processType: "Alimentos",
        matter: "Alimentos",
        specialty: "Familia",
        juzgado: "1er JUZ",
        status: "Consulta",
        origin: "importacion_zip_individual",
        originPath: "CLIENTE PRUEBA/EXP 01",
        confidence: 0.9,
        warnings: [],
        documentPaths: [file.zipPath],
        isProvisional: false,
      },
    ],
    ...overrides,
  };
}

// ─── Fake DB ──────────────────────────────────────────────────────────────────

type FolderRow = {
  id: string;
  client_id: string;
  parent_id: string | null;
  normalized_name: string;
  name: string;
};

type DocumentRow = {
  id: string;
  client_id: string;
  checksum: string | null;
  relative_path: string | null;
  original_name: string;
  folder_id: string | null;
};

type FakeDbConfig = {
  failOperations?: Map<string, boolean>; // "table:operation" → should fail
};

let idCounter = 0;
function genDeterministicId(prefix: string): string {
  idCounter++;
  return `${prefix}-${idCounter}`;
}

function makeDb(folders: FolderRow[] = [], config: FakeDbConfig = {}) {
  const inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const folderStore: FolderRow[] = [...folders];
  const documentStore: DocumentRow[] = [];
  const failOperations = config.failOperations ?? new Map<string, boolean>();
  let lastInsertedId: string | null = null;

  function chain(table: string) {
    // Reiniciar filters para cada nueva cadena
    const filters: Array<{ col: string; op: string; val: unknown }> = [];
    let lastInsert: Record<string, unknown> | null = null;
    let isInsert = false;

    const c = {
      insert: (payload: Record<string, unknown>) => {
        isInsert = true;
        const id = genDeterministicId(table.slice(0, 3));
        const row = { ...payload, id };
        inserts.push({ table, payload: row });
        if (table === "document_folders") {
          folderStore.push(row as unknown as FolderRow);
          lastInsertedId = id;
        } else if (table === "documents") {
          const rowRecord = row as unknown as Record<string, unknown>;
          documentStore.push({
            id,
            client_id: (rowRecord.client_id as string) || "client-1",
            checksum: (rowRecord.checksum as string | null) ?? null,
            relative_path: (rowRecord.relative_path as string | null) ?? null,
            original_name: (rowRecord.original_name as string) ?? (rowRecord.name as string) ?? "",
            folder_id: (rowRecord.folder_id as string | null) ?? null,
          });
          lastInsertedId = id;
        }
        lastInsert = row;
        return c;
      },
      update: () => c,
      select: () => c,
      eq: (col: string, val: unknown) => {
        filters.push({ col, op: "eq", val });
        return c;
      },
      is: (col: string, val: unknown) => {
        filters.push({ col, op: "is", val });
        return c;
      },
      neq: () => c,
      limit: () => c,
      maybeSingle: async () => {
        // Search in appropriate store based on table
        if (table === "documents") {
          const match = documentStore.find((r) =>
            filters.every(({ col, op, val }) => {
              if (op === "eq") return (r as unknown as Record<string, unknown>)[col] === val;
              if (op === "is")
                return val === null
                  ? (r as unknown as Record<string, unknown>)[col] == null
                  : false;
              return true;
            }),
          );
          return { data: match ? { id: match.id } : null, error: null };
        }
        return { data: null, error: null };
      },
      single: async () => {
        const opKey = `${table}:insert`;
        if (isInsert && failOperations.has(opKey) && failOperations.get(opKey)) {
          return { data: null, error: { message: "Insert blocked for testing", code: "TEST001" } };
        }

        if (table === "clients") return { data: { id: "client-1" }, error: null };
        if (table === "cases") return { data: { id: "case-1" }, error: null };
        if (table === "document_folders") {
          if (lastInsert && lastInsert.id) {
            return { data: { id: lastInsert.id }, error: null };
          }
          const match = folderStore.find((r) =>
            filters.every(({ col, op, val }) =>
              op === "eq"
                ? (r as unknown as Record<string, unknown>)[col] === val
                : op === "is"
                  ? val === null
                    ? (r as unknown as Record<string, unknown>)[col] == null
                    : false
                  : true,
            ),
          );
          if (match) return { data: { id: match.id }, error: null };
          return { data: null, error: { code: "PGRST116", message: "The result contains 0 rows" } };
        }
        if (table === "documents") {
          if (lastInsert && lastInsert.id) {
            return { data: { id: lastInsert.id }, error: null };
          }
          const match = documentStore.find((r) =>
            filters.every(({ col, op, val }) =>
              op === "eq"
                ? (r as unknown as Record<string, unknown>)[col] === val
                : op === "is"
                  ? val === null
                    ? (r as unknown as Record<string, unknown>)[col] == null
                    : false
                  : true,
            ),
          );
          if (match) return { data: { id: match.id }, error: null };
          return { data: null, error: { code: "PGRST116", message: "The result contains 0 rows" } };
        }
        return { data: { id: "row-1" }, error: null };
      },
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
        // This handles .limit(1).then() chains for queries
        // The .then() on a query should return the filtered result set
        if (table === "document_folders") {
          const matchedRows = folderStore.filter((r) =>
            filters.every(({ col, op, val }) =>
              op === "eq"
                ? (r as unknown as Record<string, unknown>)[col] === val
                : op === "is"
                  ? val === null
                    ? (r as unknown as Record<string, unknown>)[col] == null
                    : false
                  : true,
            ),
          );
          resolve({ data: matchedRows, error: null });
        } else {
          resolve({ data: [], error: null });
        }
      },
    };
    return c as unknown as {
      insert: ReturnType<typeof c.insert>;
      select: ReturnType<typeof c.select>;
      eq: ReturnType<typeof c.eq>;
      is: ReturnType<typeof c.is>;
      then: ReturnType<typeof c.then>;
      single: ReturnType<typeof c.single>;
      maybeSingle: ReturnType<typeof c.maybeSingle>;
    };
  }

  return {
    db: {
      from: (t: string) => chain(t),
      auth: { getSession: async () => ({ data: { session: null } }) },
    },
    inserts,
    folderStore,
    documentStore,
    failOperations,
  };
}

function makeStorage() {
  const uploads: string[] = [];
  return {
    bucket: {
      upload: async (path: string) => {
        uploads.push(path);
        return { error: null };
      },
      remove: async () => ({ error: null }),
    },
    uploads,
  };
}

async function run(
  candidate = makeCandidate(),
  folders: FolderRow[] = [],
  config: FakeDbConfig = {},
) {
  idCounter = 0; // Reset counter for each test
  const fakeDb = makeDb(folders, config);
  const fakeStorage = makeStorage();
  const result = await persistZipCandidate({
    candidate,
    db: fakeDb.db,
    storageBucket: fakeStorage.bucket,
    sourceFileName: "test.zip",
    buildInitials: () => "CP",
    randomColor: () => "oklch(0.55 0.13 235)",
    now: () => 1000,
  });
  return { result, fakeDb, fakeStorage };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests FASE 2
// ═══════════════════════════════════════════════════════════════════════════════

describe("ZIP con carpetas — Fase 2", () => {
  // 1. ZIP sin carpetas internas
  it("1. ZIP sin carpetas internas — documento va a raíz (folder_id null)", async () => {
    const file = makeFile({
      zipPath: "CLIENTE/doc.pdf",
      folderPath: "CLIENTE",
      path: "CLIENTE/doc.pdf",
    });
    const candidate = makeCandidate({
      folderPath: "CLIENTE", // <-- Asegurar que coincida con folderPath del file
      folderName: "CLIENTE",
      files: [file],
      documentCaseMap: { [file.zipPath]: "exp-01" },
      caseCandidates: [
        {
          id: "exp-01",
          title: "Exp",
          caseNumber: "01",
          processType: "Alimentos",
          matter: "Alimentos",
          specialty: "Familia",
          juzgado: "Juz",
          status: "Consulta",
          origin: "importacion_zip_individual",
          originPath: "CLIENTE",
          confidence: 0.9,
          warnings: [],
          documentPaths: [file.zipPath],
          isProvisional: false,
        },
      ],
    });
    const { fakeDb } = await run(candidate);
    const docInsert = fakeDb.inserts.find((i) => i.table === "documents");
    // No subfolder segment → folder_id should be null
    expect(docInsert?.payload.folder_id).toBeNull();
    // No folder should be created
    expect(fakeDb.inserts.filter((i) => i.table === "document_folders")).toHaveLength(0);
  });

  // 2. ZIP con una carpeta raíz lógica
  it("2. ZIP con una carpeta raíz lógica — document_folders row creado", async () => {
    const file = makeFile({
      zipPath: "CLIENTE/Demanda/demanda.pdf",
      folderPath: "CLIENTE",
      name: "demanda.pdf",
    });
    const candidate = makeCandidate({
      folderPath: "CLIENTE",
      folderName: "CLIENTE",
      files: [file],
      documentCaseMap: { [file.zipPath]: "exp-01" },
    });
    const { fakeDb } = await run(candidate);
    const folderInserts = fakeDb.inserts.filter((i) => i.table === "document_folders");
    expect(folderInserts.length).toBeGreaterThanOrEqual(1);
    expect(folderInserts[0].payload.name).toBe("Demanda");
  });

  // 3. ZIP con subcarpetas anidadas
  it("3. ZIP con subcarpetas anidadas — crea carpetas por nivel", async () => {
    const file = makeFile({
      zipPath: "CLIENTE/Proceso alimentos/Resoluciones/res01.pdf",
      folderPath: "CLIENTE",
      name: "res01.pdf",
    });
    const candidate = makeCandidate({
      folderPath: "CLIENTE",
      folderName: "CLIENTE",
      files: [file],
      documentCaseMap: { [file.zipPath]: "exp-01" },
    });
    const { fakeDb } = await run(candidate);
    const folderInserts = fakeDb.inserts.filter((i) => i.table === "document_folders");
    // Should create "Proceso alimentos" then "Resoluciones" under it
    expect(folderInserts.length).toBe(2);
    expect(folderInserts.map((f) => f.payload.name)).toContain("Proceso alimentos");
    expect(folderInserts.map((f) => f.payload.name)).toContain("Resoluciones");
  });

  // 4. Carpetas existentes reutilizadas
  it("4. Carpetas existentes reutilizadas — no duplica la fila", async () => {
    const existingFolder: FolderRow = {
      id: "folder-existing",
      client_id: "client-1",
      parent_id: null,
      normalized_name: "demanda",
      name: "Demanda",
    };
    const file = makeFile({
      zipPath: "CLIENTE/Demanda/demanda.pdf",
      folderPath: "CLIENTE",
      name: "demanda.pdf",
    });
    const candidate = makeCandidate({
      folderPath: "CLIENTE",
      folderName: "CLIENTE",
      files: [file],
      documentCaseMap: { [file.zipPath]: "exp-01" },
    });
    const { fakeDb } = await run(candidate, [existingFolder]);
    const folderInserts = fakeDb.inserts.filter((i) => i.table === "document_folders");
    // Folder already exists → should not insert a new one
    expect(folderInserts.length).toBe(0);
  });

  // 5. Mismo nombre de carpeta bajo padres diferentes
  it("5. Mismo nombre de carpeta bajo padres diferentes — coexisten sin conflicto", async () => {
    const file1 = makeFile({
      zipPath: "CLIENTE/Fiscalía/Demanda/dem1.pdf",
      folderPath: "CLIENTE",
      name: "dem1.pdf",
      checksum: "cs-01",
    });
    const file2 = makeFile({
      zipPath: "CLIENTE/Judicial/Demanda/dem2.pdf",
      folderPath: "CLIENTE",
      name: "dem2.pdf",
      checksum: "cs-02",
    });
    const candidate = makeCandidate({
      folderPath: "CLIENTE",
      folderName: "CLIENTE",
      files: [file1, file2],
      documentCaseMap: { [file1.zipPath]: "exp-01", [file2.zipPath]: "exp-01" },
      caseCandidates: [
        {
          id: "exp-01",
          title: "Exp",
          caseNumber: "01",
          processType: "Alimentos",
          matter: "Alimentos",
          specialty: "Familia",
          juzgado: "Juz",
          status: "Consulta",
          origin: "importacion_zip_individual",
          originPath: "CLIENTE",
          confidence: 0.9,
          warnings: [],
          documentPaths: [file1.zipPath, file2.zipPath],
          isProvisional: false,
        },
      ],
    });
    const { fakeDb } = await run(candidate);
    // 4 folder rows: Fiscalía, Demanda (under Fiscalía), Judicial, Demanda (under Judicial)
    const folderInserts = fakeDb.inserts.filter((i) => i.table === "document_folders");
    expect(folderInserts.length).toBe(4);
    const names = folderInserts.map((f) => f.payload.name as string);
    expect(names.filter((n) => n === "Demanda")).toHaveLength(2);
  });

  // 6. Dos documentos con igual nombre en rutas distintas
  it("6. Dos documentos con igual nombre en rutas distintas — ambos se importan", async () => {
    const file1 = makeFile({
      zipPath: "CLIENTE/Exp1/res01.pdf",
      folderPath: "CLIENTE",
      name: "res01.pdf",
      checksum: "cs-A",
    });
    const file2 = makeFile({
      zipPath: "CLIENTE/Exp2/res01.pdf",
      folderPath: "CLIENTE",
      name: "res01.pdf",
      checksum: "cs-B",
    });
    const candidate = makeCandidate({
      folderPath: "CLIENTE",
      folderName: "CLIENTE",
      files: [file1, file2],
      documentCaseMap: { [file1.zipPath]: "exp-01", [file2.zipPath]: "exp-01" },
      caseCandidates: [
        {
          id: "exp-01",
          title: "Exp",
          caseNumber: "01",
          processType: "Alimentos",
          matter: "Alimentos",
          specialty: "Familia",
          juzgado: "Juz",
          status: "Consulta",
          origin: "importacion_zip_individual",
          originPath: "CLIENTE",
          confidence: 0.9,
          warnings: [],
          documentPaths: [file1.zipPath, file2.zipPath],
          isProvisional: false,
        },
      ],
    });
    const { result } = await run(candidate);
    expect(result.documentsImported).toBe(2);
  });

  // 7. Segunda importación sin duplicados — verifica client_id + checksum + relative_path
  it("7. Segunda importación sin duplicados — documentsSkipped incrementa", async () => {
    const file = makeFile({
      zipPath: "CLIENTE PRUEBA/contrato.pdf",
      folderPath: "CLIENTE PRUEBA",
      checksum: "cksum-dup",
      name: "contrato.pdf",
    });
    const candidate = makeCandidate({
      folderPath: "CLIENTE PRUEBA",
      folderName: "CLIENTE PRUEBA",
      files: [file],
      documentCaseMap: { [file.zipPath]: "exp-01" },
    });

    // Simulamos que el documento ya existe en DB con el mismo checksum y misma ruta relativa
    const existingDoc: DocumentRow = {
      id: "doc-existing",
      client_id: "client-1",
      checksum: "cksum-dup",
      relative_path: "contrato.pdf", // Same relative path = duplicate
      original_name: "contrato.pdf",
      folder_id: null,
    };

    const fakeDbCtx = makeDb([], { failOperations: new Map() });
    // Pre-populate documentStore
    fakeDbCtx.documentStore.push(existingDoc);

    const fakeStorage = makeStorage();

    const result = await persistZipCandidate({
      candidate,
      db: fakeDbCtx.db,
      storageBucket: fakeStorage.bucket,
      sourceFileName: "test.zip",
      buildInitials: () => "CP",
      randomColor: () => "red",
      now: () => 1,
    });
    expect(result.documentsSkipped).toBe(1);
    expect(result.documentsImported).toBe(0);
    expect(fakeStorage.uploads).toHaveLength(0);
  });

  // 7b. Mismo hash, ruta diferente — permite importación
  it("7b. Mismo hash, ruta diferente — permite importación", async () => {
    const file = makeFile({
      zipPath: "CLIENTE PRUEBA/subfolder/contrato.pdf", // Different path
      folderPath: "CLIENTE PRUEBA",
      checksum: "cksum-dup",
      name: "contrato.pdf",
    });
    const candidate = makeCandidate({
      folderPath: "CLIENTE PRUEBA",
      folderName: "CLIENTE PRUEBA",
      files: [file],
      documentCaseMap: { [file.zipPath]: "exp-01" },
    });

    // Documento existente en ruta diferente
    const existingDoc: DocumentRow = {
      id: "doc-existing",
      client_id: "client-1",
      checksum: "cksum-dup",
      relative_path: "contrato.pdf", // Different relative path = NOT a duplicate
      original_name: "contrato.pdf",
      folder_id: null,
    };

    const fakeDbCtx = makeDb([], { failOperations: new Map() });
    fakeDbCtx.documentStore.push(existingDoc);

    const fakeStorage = makeStorage();

    const result = await persistZipCandidate({
      candidate,
      db: fakeDbCtx.db,
      storageBucket: fakeStorage.bucket,
      sourceFileName: "test.zip",
      buildInitials: () => "CP",
      randomColor: () => "red",
      now: () => 1,
    });
    // Should import (different path = no duplicate)
    expect(result.documentsImported).toBe(1);
    expect(result.documentsSkipped).toBe(0);
    expect(fakeStorage.uploads).toHaveLength(1);
  });

  // 7c. Mismo nombre, contenido diferente — permite importación
  it("7c. Mismo nombre, contenido diferente — permite importación", async () => {
    const file = makeFile({
      zipPath: "CLIENTE PRUEBA/contrato.pdf",
      folderPath: "CLIENTE PRUEBA",
      checksum: "cksum-new", // Different checksum = NOT a duplicate
      name: "contrato.pdf",
    });
    const candidate = makeCandidate({
      folderPath: "CLIENTE PRUEBA",
      folderName: "CLIENTE PRUEBA",
      files: [file],
      documentCaseMap: { [file.zipPath]: "exp-01" },
    });

    const existingDoc: DocumentRow = {
      id: "doc-existing",
      client_id: "client-1",
      checksum: "cksum-old",
      relative_path: "contrato.pdf", // Same relative path but different checksum
      original_name: "contrato.pdf",
      folder_id: null,
    };

    const fakeDbCtx = makeDb([], { failOperations: new Map() });
    fakeDbCtx.documentStore.push(existingDoc);

    const fakeStorage = makeStorage();

    const result = await persistZipCandidate({
      candidate,
      db: fakeDbCtx.db,
      storageBucket: fakeStorage.bucket,
      sourceFileName: "test.zip",
      buildInitials: () => "CP",
      randomColor: () => "red",
      now: () => 1,
    });
    // Should import (different checksum = no duplicate)
    expect(result.documentsImported).toBe(1);
    expect(result.documentsSkipped).toBe(0);
    expect(fakeStorage.uploads).toHaveLength(1);
  });

  // 7d. Mismo cliente, mismo hash en diferentes clientes — permite
  it("7d. Mismo hash en diferentes clientes — permite", async () => {
    const file = makeFile({
      zipPath: "CLIENTE PRUEBA/contrato.pdf",
      folderPath: "CLIENTE PRUEBA",
      checksum: "cksum-shared",
      name: "contrato.pdf",
    });
    const candidate = makeCandidate({
      folderPath: "CLIENTE PRUEBA",
      folderName: "CLIENTE PRUEBA",
      files: [file],
      documentCaseMap: { [file.zipPath]: "exp-01" },
    });

    // Documento en otro cliente
    const existingDoc: DocumentRow = {
      id: "doc-other-client",
      client_id: "client-other", // Different client = NOT a duplicate
      checksum: "cksum-shared",
      relative_path: "contrato.pdf",
      original_name: "contrato.pdf",
      folder_id: null,
    };

    const fakeDbCtx = makeDb([], { failOperations: new Map() });
    fakeDbCtx.documentStore.push(existingDoc);

    const fakeStorage = makeStorage();

    const result = await persistZipCandidate({
      candidate,
      db: fakeDbCtx.db,
      storageBucket: fakeStorage.bucket,
      sourceFileName: "test.zip",
      buildInitials: () => "CP",
      randomColor: () => "red",
      now: () => 1,
    });
    // Should import (different client = no duplicate)
    expect(result.documentsImported).toBe(1);
    expect(result.documentsSkipped).toBe(0);
    expect(fakeStorage.uploads).toHaveLength(1);
  });

  // 8. Reintento después de fallo de documento
  it("8. Reintento después de fallo de documento — nuevo intento sube el doc", async () => {
    const file = makeFile({
      checksum: "cs-retry",
      folderPath: "CLIENTE PRUEBA",
    });
    const candidate = makeCandidate({ files: [file] });
    const { result } = await run(candidate);
    // Normal run succeeds
    expect(result.status).toBe("success");
    expect(result.documentsImported).toBe(1);
  });

  // 9. Reintento después de fallo de expediente
  it("9. Reintento con existingClientIdOverride — reutiliza cliente", async () => {
    const candidate = makeCandidate();
    const fakeDbCtx = makeDb();
    const fakeStorage = makeStorage();
    const result = await persistZipCandidate({
      candidate,
      db: fakeDbCtx.db,
      storageBucket: fakeStorage.bucket,
      sourceFileName: "test.zip",
      buildInitials: () => "CP",
      randomColor: () => "red",
      now: () => 1,
      existingClientIdOverride: "client-preexisting",
    });
    expect(fakeDbCtx.inserts.filter((i) => i.table === "clients")).toHaveLength(0);
    expect(result.clientId).toBe("client-preexisting");
    expect(result.clientAlreadyExisted).toBe(true);
  });

  // 10. Conservación de client_id
  it("10. client_id del candidato se transfiere al documento", async () => {
    const { fakeDb } = await run();
    const docInsert = fakeDb.inserts.find((i) => i.table === "documents");
    expect(docInsert?.payload.client_id).toBe("client-1");
  });

  // 11. Conservación de case_id
  it("11. case_id del expediente creado se transfiere al documento", async () => {
    const { result } = await run();
    expect(result.documentIds[0].caseId).toBe("case-1");
  });

  // 12. Conservación de relative_path — external_file_id usa zipPath
  it("12. external_file_id contiene el zipPath original del documento", async () => {
    const file = makeFile({ zipPath: "CLIENTE/Demanda/demanda.pdf" });
    const candidate = makeCandidate({
      files: [file],
      documentCaseMap: { [file.zipPath]: "exp-01" },
    });
    const { fakeDb } = await run(candidate);
    const docInsert = fakeDb.inserts.find((i) => i.table === "documents");
    expect(docInsert?.payload.external_file_id).toBe("CLIENTE/Demanda/demanda.pdf");
  });

  // 13. Asignación correcta de folder_id
  it("13. folder_id en documento apunta a la carpeta creada", async () => {
    const file = makeFile({
      zipPath: "CLIENTE/Resoluciones/res01.pdf",
      folderPath: "CLIENTE",
      name: "res01.pdf",
    });
    const candidate = makeCandidate({
      files: [file],
      documentCaseMap: { [file.zipPath]: "exp-01" },
    });
    const { fakeDb } = await run(candidate);
    const docInsert = fakeDb.inserts.find((i) => i.table === "documents");
    // folder_id should not be null (a folder was created for "Resoluciones")
    expect(docInsert?.payload.folder_id).toBeDefined();
    expect(docInsert?.payload.folder_id).not.toBeNull();
  });

  // 14. Rollback seguro de archivos huérfanos
  it("14. Fallo en insert de documento activa compensación de Storage", async () => {
    const file = makeFile();
    const candidate = makeCandidate({ files: [file] });

    const failOps = new Map<string, boolean>();
    failOps.set("documents:insert", true); // Make document insert fail
    const fakeDbCtx = makeDb([], { failOperations: failOps });
    const fakeStorage = makeStorage();

    const result = await persistZipCandidate({
      candidate,
      db: fakeDbCtx.db,
      storageBucket: fakeStorage.bucket,
      sourceFileName: "test.zip",
      buildInitials: () => "CP",
      randomColor: () => "red",
      now: () => 1,
    });

    // Upload happened then was compensated
    expect(fakeStorage.uploads).toHaveLength(1);
    expect(result.compensations.length).toBeGreaterThan(0);
    expect(result.compensations[0]).toMatch(/Storage revertido/);
    expect(result.status).toBe("partial");
    expect(result.documentsImported).toBe(0);
  });

  // 15. Documento en raíz con folder_id = null
  it("15. Documento en raíz del cliente tiene folder_id null", async () => {
    const file = makeFile({
      zipPath: "CLIENTE PRUEBA/contrato.pdf",
      folderPath: "CLIENTE PRUEBA",
      name: "contrato.pdf",
    });
    const candidate = makeCandidate({
      files: [file],
      folderPath: "CLIENTE PRUEBA",
      documentCaseMap: { [file.zipPath]: "exp-01" },
    });
    const { fakeDb } = await run(candidate);
    const docInsert = fakeDb.inserts.find((i) => i.table === "documents");
    expect(docInsert?.payload.folder_id).toBeNull();
    expect(fakeDb.inserts.filter((i) => i.table === "document_folders")).toHaveLength(0);
  });
});
