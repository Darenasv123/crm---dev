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
  single: () => Promise<{
    data: { id: string } | null;
    error: { message: string; code?: string } | null;
  }>;
  maybeSingle: () => Promise<{
    data: { id: string } | null;
    error: { message: string; code?: string } | null;
  }>;
  then: (
    resolve: (value: {
      data: { id: string } | null;
      error: { message: string; code?: string } | null;
    }) => void,
  ) => void;
};
type FakeOptions = {
  clientError?: string;
  caseError?: string;
  /** PostgreSQL/Supabase error code to attach to caseError */
  caseErrorCode?: string;
  /** When true, case INSERT returns data:null, error:null (RLS silent block) */
  caseNullData?: boolean;
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
          return {
            data: null,
            error: {
              message: options.caseError,
              code: options.caseErrorCode,
            },
          };
        if (table === "cases" && options.caseNullData) return { data: null, error: null };
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

  it("no sube documentos si falla la creación de expediente", async () => {
    const { result, fakeStorage } = await run(makeCandidate(), { caseError: "case denied" });
    // Client was created but case failed → partial (not failed).
    // Previously this returned "failed" which was the bug: 0 clientes importados.
    expect(result.status).toBe("partial");
    expect(fakeStorage.uploads).toHaveLength(0);
  });

  it("marca parcial si falla Storage upload (cliente creado)", async () => {
    const { result, fakeDb } = await run(makeCandidate(), {}, { uploadError: "bucket denied" });
    // Client and case were created, only the storage upload failed → partial.
    expect(result.status).toBe("partial");
    expect(fakeDb.inserts.filter((i) => i.table === "documents")).toHaveLength(0);
  });

  it("compensa Storage si falla el insert de documento (marca parcial)", async () => {
    const { result, fakeStorage } = await run(makeCandidate(), {
      documentError: "documents denied",
    });
    // Client and case were created; document DB insert failed → partial.
    expect(result.status).toBe("partial");
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

  it("deja sin expediente los documentos marcados como sin clasificar", async () => {
    const file = makeFile({ zipPath: "CLIENTE/doc.txt", path: "CLIENTE/doc.txt" });
    const candidate = makeCandidate({
      files: [file],
      documentCaseMap: { [file.zipPath]: "__unclassified" },
      caseCandidates: [],
    });
    const { result, fakeDb } = await run(candidate);
    expect(result.status).toBe("success");
    expect(fakeDb.inserts.some((item) => item.table === "cases")).toBe(false);
    const documentInsert = fakeDb.inserts.find((item) => item.table === "documents");
    expect(documentInsert?.payload.case_id).toBeNull();
    expect(result.documentIds[0].caseId).toBeNull();
  });

  // ── Tests para la corrección del bug de importación parcial ──────────────

  it("1. cliente creado y expediente fallido → status parcial, no fallido", async () => {
    const { result } = await run(makeCandidate(), { caseError: "some db error" });
    // Client was created (no clientError), but the case failed.
    // The result must be "partial", NOT "failed".
    expect(result.status).toBe("partial");
    // clientId must be present so the UI can show "Abrir cliente".
    expect(result.clientId).toBeDefined();
    // No documents should be uploaded (case was never created).
    expect(result.documentsImported).toBe(0);
    // The error must be captured.
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("2. reintento reutiliza el cliente ya creado sin duplicarlo", async () => {
    const candidate = makeCandidate();
    const fakeDbCtx = makeDb();
    const fakeStorage = makeStorage();

    // Simulate a retry: existingClientIdOverride is provided.
    const result = await persistZipCandidate({
      candidate,
      db: fakeDbCtx.db,
      storageBucket: fakeStorage.bucket,
      sourceFileName: "clientes.zip",
      buildInitials: () => "CP",
      randomColor: () => "oklch(0.55 0.13 235)",
      now: () => 1000,
      existingClientIdOverride: "client-already-exists",
    });

    // No new client should have been inserted.
    expect(fakeDbCtx.inserts.filter((i) => i.table === "clients")).toHaveLength(0);
    // The returned clientId must be the override value.
    expect(result.clientId).toBe("client-already-exists");
    // clientAlreadyExisted flag must be set.
    expect(result.clientAlreadyExisted).toBe(true);
    // The case and documents should proceed normally.
    expect(result.status).toBe("success");
  });

  it("3. violación UNIQUE 23505 en expediente → error estructurado, no mensaje truncado", async () => {
    const { result } = await run(makeCandidate(), {
      caseError: 'duplicate key value violates unique constraint "cases_expediente_key"',
      caseErrorCode: "23505",
    });
    expect(result.status).toBe("partial");
    // errorDetail must be set with the structured information.
    expect(result.errorDetail).toBeDefined();
    expect(result.errorDetail?.code).toBe("23505");
    expect(result.errorDetail?.stage).toBe("case");
    // The summary must NOT start with "Crear expediente" (the old truncated message).
    expect(result.errorDetail?.summary).not.toMatch(/^Crear expediente/);
    // Must mention the case number.
    expect(result.errorDetail?.summary).toMatch(/01234-2024-0-JR-FC-01/);
  });

  it("4. violación NOT NULL 23502 en expediente → error estructurado con acción recomendada", async () => {
    const { result } = await run(makeCandidate(), {
      caseError: 'null value in column "expediente" violates not-null constraint',
      caseErrorCode: "23502",
    });
    expect(result.status).toBe("partial");
    expect(result.errorDetail?.code).toBe("23502");
    expect(result.errorDetail?.action).toBeTruthy();
  });

  it("5. error RLS 42501 en expediente → error estructurado con acción de sesión", async () => {
    const { result } = await run(makeCandidate(), {
      caseError: "insufficient privilege",
      caseErrorCode: "42501",
    });
    expect(result.status).toBe("partial");
    expect(result.errorDetail?.code).toBe("42501");
    expect(result.errorDetail?.summary).toMatch(/permisos/i);
  });

  it("6. error UNIQUE 23505 en expediente → summary no empieza con «Crear expediente»", async () => {
    const { result } = await run(makeCandidate(), {
      caseError: "duplicate key",
      caseErrorCode: "23505",
    });
    // This is the core regression test for the reported bug:
    // the old code reached ensureSupabaseData and produced "Crear expediente
    // Expediente 070…" as the visible error message.
    expect(result.error).not.toMatch(/^Crear expediente/);
  });

  it("7. documentos ya subidos (checksum duplicate) no se repiten en reintento", async () => {
    const { result, fakeStorage } = await run(makeCandidate(), { duplicate: true });
    expect(result.documentsSkipped).toBe(1);
    expect(fakeStorage.uploads).toHaveLength(0);
    expect(result.documentsImported).toBe(0);
  });

  it("8. importación parcial reportada correctamente: clientId presente, status partial", async () => {
    const { result } = await run(makeCandidate(), { caseError: "any error" });
    expect(result.status).toBe("partial");
    expect(result.clientId).toBeDefined();
    // failedFiles should list the documents that could not be uploaded because
    // the case was never created.
    expect(result.failedFiles.length).toBeGreaterThan(0);
  });

  it("9. data null sin error → error estructurado PGRST000, no throw genérico de ensureSupabaseData", async () => {
    // Simulate the exact failure mode: INSERT succeeds silently (RLS) returning
    // data: null and error: null.
    const fakeDbCtx = makeDb({ caseNullData: true });
    const fakeStorage = makeStorage();
    const result = await persistZipCandidate({
      candidate: makeCandidate(),
      db: fakeDbCtx.db,
      storageBucket: fakeStorage.bucket,
      sourceFileName: "clientes.zip",
      buildInitials: () => "CP",
      randomColor: () => "oklch(0.55 0.13 235)",
      now: () => 1000,
    });
    expect(result.status).toBe("partial");
    // The error must NOT be the raw ensureSupabaseData message.
    expect(result.error).not.toMatch(/^Crear expediente.*Supabase no devolvió datos/);
    expect(result.errorDetail?.code).toBe("PGRST000");
  });

  it("10. segundo reintento no duplica cliente ni documentos ya completados", async () => {
    // Simulate a second retry: client already exists, document already in DB.
    const candidate = makeCandidate();
    const fakeDbCtx = makeDb({ duplicate: true });
    const fakeStorage = makeStorage();

    const result = await persistZipCandidate({
      candidate,
      db: fakeDbCtx.db,
      storageBucket: fakeStorage.bucket,
      sourceFileName: "clientes.zip",
      buildInitials: () => "CP",
      randomColor: () => "oklch(0.55 0.13 235)",
      now: () => 1000,
      existingClientIdOverride: "client-already-exists",
    });

    // No new client insert.
    expect(fakeDbCtx.inserts.filter((i) => i.table === "clients")).toHaveLength(0);
    // Document was skipped (checksum match).
    expect(result.documentsSkipped).toBe(1);
    expect(fakeStorage.uploads).toHaveLength(0);
    // Overall status is success (case created, doc skipped — not an error).
    expect(result.status).toBe("success");
  });
});
