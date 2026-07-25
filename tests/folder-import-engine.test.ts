/**
 * folder-import-engine.test.ts
 * Integration-level tests for ImportEngine using mocked Supabase.
 * No real Supabase connection is made.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── vi.hoisted ensures these run before vi.mock factories ───────────────────
const { mockStorageUpload, mockStorageRemove, mockGetSession, inserted } = vi.hoisted(() => {
  const mockStorageUpload = vi.fn().mockResolvedValue({ error: null });
  const mockStorageRemove = vi.fn().mockResolvedValue({ error: null });
  const mockGetSession = vi.fn().mockResolvedValue({
    data: { session: { user: { id: "user-test-uuid" }, access_token: "tok" } },
  });
  const inserted: Record<string, unknown[]> = { clients: [], documents: [], import_jobs: [] };
  return { mockStorageUpload, mockStorageRemove, mockGetSession, inserted };
});

// ─── Mock overrides (changed per-test via mockResolvedValue) ──────────────────
let clientsInsertError: { code?: string; message?: string; details?: string } | null = null;
let documentsInsertError: { code?: string; message?: string; details?: string } | null = null;
let existingDocsOverride: Array<{
  relative_path: string | null;
  original_name: string | null;
  content_hash: string | null;
  storage_path: string;
}> | null = null;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getSession: mockGetSession },
    storage: {
      from: () => ({
        upload: mockStorageUpload,
        remove: mockStorageRemove,
      }),
    },
  },
  getAuthClient: vi.fn(() =>
    Promise.resolve({
      from: (table: string) => {
        return {
          insert: (payload: unknown) => {
            if (table === "clients") {
              if (clientsInsertError)
                return {
                  select: () => ({
                    single: async () => ({ data: null, error: clientsInsertError }),
                  }),
                };
              inserted.clients.push(payload);
              return {
                select: () => ({
                  single: async () => ({ data: { id: "new-client-uuid" }, error: null }),
                }),
              };
            }
            if (table === "documents") {
              if (documentsInsertError) {
                // Simulate awaitable insert that returns the error
                const errObj = documentsInsertError;
                return {
                  then: (resolve: (v: { error: typeof errObj }) => void) =>
                    resolve({ error: errObj }),
                  select: () => ({ single: async () => ({ data: null, error: errObj }) }),
                };
              }
              inserted.documents.push(payload);
              return {
                then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
                select: () => ({ single: async () => ({ data: { id: "doc-uuid" }, error: null }) }),
              };
            }
            if (table === "import_jobs") {
              inserted.import_jobs.push(payload);
              return {
                select: () => ({ single: async () => ({ data: { id: "job-uuid" }, error: null }) }),
              };
            }
            return { select: () => ({ single: async () => ({ data: null, error: null }) }) };
          },
          select: (_cols: string) => ({
            eq: (_field: string, _value: string) => ({
              then: (resolve: (v: { data: unknown[]; error: null }) => void) => {
                if (table === "documents" && existingDocsOverride) {
                  return resolve({ data: existingDocsOverride, error: null });
                }
                return resolve({ data: [], error: null });
              },
            }),
          }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      },
    }),
  ),
}));

vi.mock("@/lib/supabase-errors", () => ({
  isMissingSchemaFieldError: (e: { code?: string } | null) => e?.code === "PGRST204",
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────
import { getAuthClient } from "@/lib/supabase";
import { runImport } from "@/lib/imports/folder-import-engine";
import type { ClientEntry } from "@/lib/imports/folder-import";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFile(relativePath: string, size = 1024): File & { webkitRelativePath: string } {
  const name = relativePath.split("/").pop() ?? "file.pdf";
  const blob = new Blob([new Uint8Array(size).fill(1)], { type: "application/pdf" });
  const f = new File([blob], name) as File & { webkitRelativePath: string };
  Object.defineProperty(f, "webkitRelativePath", { value: relativePath, writable: false });
  return f;
}

function makeClientEntry(
  folderName: string,
  docs: Array<{ name: string; size?: number }>,
  overrides: Partial<ClientEntry> = {},
): ClientEntry {
  return {
    folderName,
    normalizedName: folderName.toLowerCase(),
    status: "new",
    documents: docs.map((d) => ({
      file: makeFile(`CLIENTES/${folderName}/${d.name}`, d.size ?? 1024),
      relativePath: `${folderName}/${d.name}`,
      originalName: d.name,
      status: "pending" as const,
    })),
    ...overrides,
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  inserted.clients = [];
  inserted.documents = [];
  inserted.import_jobs = [];
  clientsInsertError = null;
  documentsInsertError = null;
  existingDocsOverride = null;
  mockStorageUpload.mockClear().mockResolvedValue({ error: null });
  mockStorageRemove.mockClear().mockResolvedValue({ error: null });
});

// ─── Tests: client creation ───────────────────────────────────────────────────

describe("ImportEngine — client creation", () => {
  it("creates a new client and reports clientsCreated = 1", async () => {
    const clients = [makeClientEntry("Cliente Prueba Uno", [{ name: "doc1.pdf" }])];
    const result = await runImport({ rootName: "CLIENTES", clients, onProgress: vi.fn() });
    expect(result.stats.clientsCreated).toBe(1);
    expect(result.stats.clientsFailed).toBe(0);
  });

  it("stores null for dni, phone, process_type — no fake sentinel values", async () => {
    const clients = [makeClientEntry("Cliente Valores Nulos", [{ name: "doc.pdf" }])];
    await runImport({ rootName: "CLIENTES", clients, onProgress: vi.fn() });
    const row = inserted.clients[0] as Record<string, unknown>;
    expect(row.dni).toBeNull();
    expect(row.phone).toBeNull();
    expect(row.process_type).toBeNull();
  });

  it("notes field contains import origin marker", async () => {
    const clients = [makeClientEntry("Cliente Notas", [{ name: "doc.pdf" }])];
    await runImport({ rootName: "CLIENTES", clients, onProgress: vi.fn() });
    const row = inserted.clients[0] as Record<string, unknown>;
    expect(typeof row.notes).toBe("string");
    expect((row.notes as string).toLowerCase()).toContain("import");
  });

  it("associates documents to existing client (use_existing) without creating a new row", async () => {
    const clients = [
      makeClientEntry("Cliente Existente", [{ name: "nuevo.pdf" }], {
        status: "duplicate_exact",
        existingClientId: "existing-uuid",
        duplicateResolution: "use_existing",
      }),
    ];
    const result = await runImport({ rootName: "CLIENTES", clients, onProgress: vi.fn() });
    expect(result.stats.clientsAssociated).toBe(1);
    expect(result.stats.clientsCreated).toBe(0);
    expect(inserted.clients).toHaveLength(0);
  });

  it("surfaces migration-not-applied error and marks client as failed", async () => {
    clientsInsertError = { code: "PGRST204", message: "schema cache miss" };
    const clients = [makeClientEntry("Cliente Migración", [{ name: "doc.pdf" }])];
    const result = await runImport({ rootName: "CLIENTES", clients, onProgress: vi.fn() });
    expect(result.stats.clientsFailed).toBe(1);
    expect(result.stats.clientsCreated).toBe(0);
    expect(result.clients[0].errorMessage).toMatch(/migración/i);
  });
});

// ─── Tests: document upload ───────────────────────────────────────────────────

describe("ImportEngine — document upload", () => {
  it("uploads document and registers it in documents table", async () => {
    const clients = [makeClientEntry("Cliente Dos", [{ name: "sentencia.pdf" }])];
    const result = await runImport({ rootName: "CLIENTES", clients, onProgress: vi.fn() });
    expect(result.stats.documentsUploaded).toBe(1);
    expect(result.stats.documentsFailed).toBe(0);
  });

  it("storage path starts with client UUID, not client name", async () => {
    const uploadedPaths: string[] = [];
    mockStorageUpload.mockImplementation((path: string) => {
      uploadedPaths.push(path);
      return Promise.resolve({ error: null });
    });
    const clients = [makeClientEntry("Cliente Ruta", [{ name: "doc.pdf" }])];
    await runImport({ rootName: "CLIENTES", clients, onProgress: vi.fn() });
    expect(uploadedPaths[0]).toMatch(/^new-client-uuid\//);
    expect(uploadedPaths[0]).not.toContain("Cliente Ruta");
  });

  it("removes orphaned Storage file when DB insert fails", async () => {
    documentsInsertError = { code: "42P01", message: "relation does not exist" };
    const clients = [makeClientEntry("Cliente Orphan", [{ name: "orphan.pdf" }])];
    const result = await runImport({ rootName: "CLIENTES", clients, onProgress: vi.fn() });
    expect(result.stats.documentsFailed).toBe(1);
    expect(mockStorageRemove).toHaveBeenCalled();
  });
});

// ─── Tests: idempotency ───────────────────────────────────────────────────────

describe("ImportEngine — idempotency", () => {
  it("skips document already in DB (duplicate by relative_path)", async () => {
    // relative_path is the correct dedup key — same client + same path = same doc.
    // This correctly handles "Resoluciones/Documento.pdf" vs "Anexos/Documento.pdf"
    // as different documents even though original_name is the same.
    existingDocsOverride = [
      {
        relative_path: "demanda.pdf",
        original_name: "demanda.pdf",
        content_hash: null,
        storage_path: "uuid/demanda.pdf",
      },
    ];
    const clients = [makeClientEntry("Cliente Idem", [{ name: "demanda.pdf" }])];
    const result = await runImport({ rootName: "CLIENTES", clients, onProgress: vi.fn() });
    expect(result.stats.documentsDuplicateSkipped).toBe(1);
    expect(result.stats.documentsUploaded).toBe(0);
    expect(mockStorageUpload).not.toHaveBeenCalled();
  });

  it("treats 23505 unique-violation on insert as duplicate_skipped and cleans Storage", async () => {
    documentsInsertError = { code: "23505", message: "duplicate key value" };
    const clients = [makeClientEntry("Cliente UniqueViolation", [{ name: "dup.pdf" }])];
    const result = await runImport({ rootName: "CLIENTES", clients, onProgress: vi.fn() });
    expect(result.stats.documentsDuplicateSkipped).toBe(1);
    expect(result.stats.documentsFailed).toBe(0);
    expect(mockStorageRemove).toHaveBeenCalled();
  });

  it("does not upload documents already marked as done in retry mode", async () => {
    const clients: ClientEntry[] = [
      {
        folderName: "Cliente Retry",
        normalizedName: "cliente retry",
        status: "done",
        createdClientId: "retry-uuid",
        existingClientId: "retry-uuid",
        duplicateResolution: "use_existing",
        documents: [
          {
            file: makeFile("CLIENTES/Cliente Retry/ok.pdf"),
            relativePath: "Cliente Retry/ok.pdf",
            originalName: "ok.pdf",
            status: "done", // already done — must NOT be re-uploaded
          },
          {
            file: makeFile("CLIENTES/Cliente Retry/failed.pdf"),
            relativePath: "Cliente Retry/failed.pdf",
            originalName: "failed.pdf",
            status: "pending", // reset from "failed" by retryFailedDocuments
            errorMessage: "Network error",
          },
        ],
      },
    ];

    const result = await runImport({ rootName: "reintento", clients, onProgress: vi.fn() });

    // Only the pending doc should count
    expect(result.stats.documentsUploaded).toBeLessThanOrEqual(1);
  });
});

// ─── Tests: rollback safety ───────────────────────────────────────────────────

describe("ImportEngine — rollback does not delete pre-existing Storage files", () => {
  it("on DB insert failure for a new upload, removes the just-uploaded file only", async () => {
    // Arrange: one document fails DB insert. The engine should call remove()
    // for the file it just uploaded — but only that file, not any pre-existing ones.
    documentsInsertError = { code: "42P01", message: "relation does not exist" };

    const clients = [makeClientEntry("Cliente Rollback", [{ name: "new-upload.pdf" }])];
    const result = await runImport({ rootName: "CLIENTES", clients, onProgress: vi.fn() });

    expect(result.stats.documentsFailed).toBe(1);
    // remove() is called once — for the newly uploaded orphan
    expect(mockStorageRemove).toHaveBeenCalledTimes(1);
    // The path passed to remove should include the client UUID, not a pre-existing path
    const removedPath = (mockStorageRemove.mock.calls[0] as string[][])[0][0];
    expect(removedPath).toMatch(/^new-client-uuid\//);
  });

  it("on DB insert failure, does NOT remove files that were already in Storage before import", async () => {
    // Simulate that a previous doc (already existing) is not touched.
    // We verify remove() is only called once even when existingDocs are present.
    documentsInsertError = { code: "42P01", message: "relation does not exist" };
    existingDocsOverride = [
      {
        relative_path: "pre-existing.pdf",
        original_name: "pre-existing.pdf",
        content_hash: null,
        storage_path: "existing-uuid/pre-existing.pdf",
      },
    ];

    const clients = [
      makeClientEntry("Cliente Safe Rollback", [
        { name: "new-doc.pdf" }, // this is new and will fail DB insert
      ]),
    ];
    const result = await runImport({ rootName: "CLIENTES", clients, onProgress: vi.fn() });

    expect(result.stats.documentsFailed).toBe(1);
    // Only the new upload (not the pre-existing one) should be removed
    expect(mockStorageRemove).toHaveBeenCalledTimes(1);
    const removedPaths: string[] = (mockStorageRemove.mock.calls[0] as string[][])[0];
    // Pre-existing storage path must not appear in any remove() call
    expect(removedPaths.every((p) => !p.includes("existing-uuid/pre-existing.pdf"))).toBe(true);
  });

  it("a partial error in one client does not stop subsequent clients from being processed", async () => {
    // First client's upload succeeds, second client's DB insert fails.
    // Both clients should be processed — error in #2 must not block #1 completion.
    let callCount = 0;
    documentsInsertError = null;
    mockStorageUpload.mockImplementation(() => {
      callCount++;
      return Promise.resolve({ error: null });
    });

    const clients = [
      makeClientEntry("Cliente OK", [{ name: "doc-ok.pdf" }]),
      makeClientEntry("Cliente Falla", [{ name: "doc-fail.pdf" }]),
    ];

    // Make second client's document insert fail
    const originalGetAuthClient = vi.mocked(getAuthClient);
    let insertCallsForClients = 0;
    originalGetAuthClient.mockImplementation(async () => {
      const mockDb = {
        from: (table: string) => ({
          insert: (payload: unknown) => {
            if (table === "clients") {
              inserted.clients.push(payload);
              return {
                select: () => ({
                  single: async () => ({ data: { id: "new-client-uuid" }, error: null }),
                }),
              };
            }
            if (table === "documents") {
              insertCallsForClients++;
              // Second insert fails
              if (insertCallsForClients === 2) {
                const err = { code: "42P01", message: "DB error" };
                return {
                  then: (resolve: (v: { error: typeof err }) => void) => resolve({ error: err }),
                };
              }
              inserted.documents.push(payload);
              return {
                then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
              };
            }
            if (table === "import_jobs") {
              inserted.import_jobs.push(payload);
              return {
                select: () => ({
                  single: async () => ({ data: { id: "job-uuid" }, error: null }),
                }),
              };
            }
            return { select: () => ({ single: async () => ({ data: null, error: null }) }) };
          },
          select: (_cols: string) => ({
            eq: (_f: string, _v: string) => ({
              then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
                resolve({ data: [], error: null }),
            }),
          }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        }),
      };
      return mockDb as unknown as Awaited<ReturnType<typeof getAuthClient>>;
    });

    const result = await runImport({ rootName: "CLIENTES", clients, onProgress: vi.fn() });

    // Both clients should have been attempted
    expect(result.stats.clientsCreated).toBe(2);
    // One doc uploaded, one failed — but import didn't abort
    expect(result.stats.documentsUploaded + result.stats.documentsFailed).toBe(2);
  });
});
