import { describe, expect, it } from "vitest";
import { persistZipCandidate } from "@/lib/imports/zip-persistence";
import type { ReviewCandidate, ZipFileEntry } from "@/lib/imports/zip-import";

function buffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

function makeFile(overrides: Partial<ZipFileEntry> = {}): ZipFileEntry {
  return {
    path: "CLIENTE/EXP 01234-2024-0-JR-FC-01/DEMANDA.txt",
    zipPath: "CLIENTE/EXP 01234-2024-0-JR-FC-01/DEMANDA.txt",
    folderPath: "CLIENTE/EXP 01234-2024-0-JR-FC-01",
    name: "DEMANDA.txt",
    ext: ".txt",
    size: 7,
    data: buffer("demanda"),
    docType: "DEMANDA",
    extractionStatus: "extracted",
    checksum: "abc123",
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<ReviewCandidate> = {}): ReviewCandidate {
  const file = makeFile();
  return {
    folderName: "CLIENTE PRUEBA",
    proposedName: "CLIENTE PRUEBA",
    folderPath: "CLIENTE PRUEBA",
    detected: { expedientes: ["01234-2024-0-JR-FC-01"], relevantDates: [], fullNameCandidates: [] },
    files: [file],
    warnings: [],
    excluded: false,
    duplicates: [],
    edits: {},
    excludedFiles: new Set<string>(),
    excludedFolders: new Set<string>(),
    documentCaseMap: { [file.zipPath]: "exp-01234" },
    caseCandidates: [
      {
        id: "exp-01234",
        title: "Expediente 01234-2024-0-JR-FC-01",
        caseNumber: "01234-2024-0-JR-FC-01",
        processType: "Alimentos",
        matter: "Alimentos",
        specialty: "Familia",
        juzgado: "1 JUZGADO DE PAZ LETRADO",
        status: "Consulta",
        origin: "importacion_zip_individual",
        originPath: "CLIENTE PRUEBA/EXP 01234-2024-0-JR-FC-01",
        confidence: 0.9,
        warnings: [],
        documentPaths: [file.zipPath],
        isProvisional: false,
      },
    ],
    ...overrides,
  };
}

type FakeChain = {
  table: string;
  payload: Record<string, unknown> | null;
  insert: (payload: Record<string, unknown>) => FakeChain;
  update: (payload: Record<string, unknown>) => FakeChain;
  select: () => FakeChain;
  eq: (column: string, value: unknown) => FakeChain;
  single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }>;
  maybeSingle: () => Promise<{ data: { id: string } | null; error: { message: string } | null }>;
  then: (
    resolve: (value: { data: { id: string } | null; error: { message: string } | null }) => void,
  ) => void;
};
type FakeOptions = {
  clientError?: string;
  caseError?: string;
  documentError?: string;
  duplicate?: boolean;
};

function makeDb(options: FakeOptions = {}) {
  const inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const filters: Array<{ table: string; column: string; value: unknown }> = [];

  function builder(table: string) {
    const chain: FakeChain = {
      table,
      payload: null,
      insert(payload: Record<string, unknown>) {
        this.payload = payload;
        inserts.push({ table, payload });
        return this;
      },
      update(payload: Record<string, unknown>) {
        this.payload = payload;
        updates.push({ table, payload });
        return this;
      },
      select() {
        return this;
      },
      eq(column: string, value: unknown) {
        filters.push({ table, column, value });
        return this;
      },
      single: async () => {
        if (table === "clients" && options.clientError)
          return { data: null, error: { message: options.clientError } };
        if (table === "documents" && options.documentError)
          return { data: null, error: { message: options.documentError } };
        if (table === "cases" && options.caseError)
          return { data: null, error: { message: options.caseError } };
        if (table === "clients") return { data: { id: "client-1" }, error: null };
        if (table === "cases") return { data: { id: "case-1" }, error: null };
        return { data: { id: "row-1" }, error: null };
      },
      maybeSingle: async () => {
        if (options.duplicate) return { data: { id: "doc-existing" }, error: null };
        return { data: null, error: null };
      },
      then(
        resolve: (value: {
          data: { id: string } | null;
          error: { message: string } | null;
        }) => void,
      ) {
        if (table === "documents" && options.documentError) {
          resolve({ data: null, error: { message: options.documentError } });
          return;
        }
        resolve({ data: { id: "doc-1" }, error: null });
      },
    };
    return chain;
  }

  return {
    db: { from: (table: string) => builder(table) },
    inserts,
    updates,
    filters,
  };
}

function makeStorage(options: { uploadError?: string; removeError?: string } = {}) {
  const uploads: string[] = [];
  const removals: string[] = [];
  return {
    bucket: {
      upload: async (path: string) => {
        uploads.push(path);
        return { error: options.uploadError ? { message: options.uploadError } : null };
      },
      remove: async (paths: string[]) => {
        removals.push(...paths);
        return { error: options.removeError ? { message: options.removeError } : null };
      },
    },
    uploads,
    removals,
  };
}

async function run(candidate = makeCandidate(), dbOptions: FakeOptions = {}, storageOptions = {}) {
  const fakeDb = makeDb(dbOptions);
  const fakeStorage = makeStorage(storageOptions);
  const result = await persistZipCandidate({
    candidate,
    db: fakeDb.db,
    storageBucket: fakeStorage.bucket,
    sourceFileName: "clientes.zip",
    buildInitials: () => "CP",
    randomColor: () => "oklch(0.55 0.13 235)",
    now: () => 1000,
  });
  return { result, fakeDb, fakeStorage };
}

describe("persistZipCandidate", () => {
  it("crea cliente, expediente y documento validando cada paso", async () => {
    const { result, fakeDb, fakeStorage } = await run();
    expect(result.status).toBe("success");
    expect(result.documentsImported).toBe(1);
    expect(fakeDb.inserts.map((i) => i.table)).toEqual(["clients", "cases", "documents"]);
    expect(fakeStorage.uploads).toHaveLength(1);
    expect(result.caseIds).toEqual([
      {
        id: "case-1",
        title: "Expediente 01234-2024-0-JR-FC-01",
        caseNumber: "01234-2024-0-JR-FC-01",
      },
    ]);
    expect(result.documentIds[0]).toMatchObject({
      id: "row-1",
      name: "DEMANDA.txt",
      caseId: "case-1",
    });
  });

  it("falla sin subir documentos si no puede crear cliente", async () => {
    const { result, fakeStorage } = await run(makeCandidate(), {
      clientError: "permission denied",
    });
    expect(result.status).toBe("failed");
    expect(fakeStorage.uploads).toHaveLength(0);
  });

  it("no sube documentos si falla la creacion de expediente", async () => {
    const { result, fakeStorage } = await run(makeCandidate(), { caseError: "case denied" });
    expect(result.status).toBe("failed");
    expect(fakeStorage.uploads).toHaveLength(0);
  });

  it("marca fallido si falla Storage upload", async () => {
    const { result, fakeDb } = await run(makeCandidate(), {}, { uploadError: "bucket denied" });
    expect(result.status).toBe("failed");
    expect(fakeDb.inserts.filter((i) => i.table === "documents")).toHaveLength(0);
  });

  it("compensa Storage si falla el insert de documento", async () => {
    const { result, fakeStorage } = await run(makeCandidate(), {
      documentError: "documents denied",
    });
    expect(result.status).toBe("failed");
    expect(fakeStorage.uploads).toHaveLength(1);
    expect(fakeStorage.removals).toEqual(fakeStorage.uploads);
    expect(result.compensations[0]).toMatch(/Storage revertido/);
  });

  it("omite duplicado por checksum del mismo cliente sin subir", async () => {
    const { result, fakeStorage, fakeDb } = await run(makeCandidate(), { duplicate: true });
    expect(result.status).toBe("success");
    expect(result.documentsSkipped).toBe(1);
    expect(fakeStorage.uploads).toHaveLength(0);
    expect(fakeDb.filters).toContainEqual({
      table: "documents",
      column: "client_id",
      value: "client-1",
    });
    expect(fakeDb.filters).toContainEqual({
      table: "documents",
      column: "checksum",
      value: "abc123",
    });
  });
  it("actualiza cliente existente sin crear uno nuevo", async () => {
    const candidate = makeCandidate({
      duplicates: [
        {
          clientId: "client-1",
          clientName: "CLIENTE PRUEBA",
          matchReason: "DNI",
          matchStrength: "exact_dni",
        },
      ],
      duplicateAction: "update_existing",
      existingClientId: "client-1",
      edits: { phone: "999999999" },
    });
    const { result, fakeDb } = await run(candidate);
    expect(result.status).toBe("success");
    expect(fakeDb.inserts.filter((i) => i.table === "clients")).toHaveLength(0);
    expect(fakeDb.updates.filter((i) => i.table === "clients")).toHaveLength(1);
  });

  it("cancelar duplicado no persiste nada", async () => {
    const candidate = makeCandidate({
      duplicates: [
        {
          clientId: "client-1",
          clientName: "CLIENTE PRUEBA",
          matchReason: "DNI",
          matchStrength: "exact_dni",
        },
      ],
      duplicateAction: "skip",
    });
    const { result, fakeDb, fakeStorage } = await run(candidate);
    expect(result.status).toBe("skipped");
    expect(fakeDb.inserts).toHaveLength(0);
    expect(fakeStorage.uploads).toHaveLength(0);
  });

  it("crea expediente provisional para documentos dejados sin clasificar", async () => {
    const file = makeFile({ zipPath: "CLIENTE/doc.txt", path: "CLIENTE/doc.txt" });
    const candidate = makeCandidate({
      files: [file],
      documentCaseMap: { [file.zipPath]: "__unclassified" },
      caseCandidates: [],
    });
    const { result, fakeDb } = await run(candidate);
    expect(result.status).toBe("success");
    const caseInsert = fakeDb.inserts.find((item) => item.table === "cases");
    expect(caseInsert?.payload.case_stage).toBe("pendiente_revision");
    expect(result.caseIds[0].caseNumber).toBeNull();
  });
});
