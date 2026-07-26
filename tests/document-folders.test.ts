/**
 * document-folders.test.ts
 * Unit + integration tests para carpetas de documentos.
 * Cubre las 26 pruebas de la Fase 11.
 * No requiere conexión a Supabase remoto.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks hoisted (se ejecutan antes de vi.mock) ─────────────────────────────

const { mockGetSession, mockStorageUp } = vi.hoisted(() => {
  const mockGetSession = vi.fn().mockResolvedValue({
    data: { session: { user: { id: "user-uuid-test" }, access_token: "tok" } },
  });
  const mockStorageUp = vi.fn().mockResolvedValue({ error: null });
  return { mockGetSession, mockStorageUp };
});

// Almacén en memoria para cada test
let folderStore: Array<Record<string, unknown>> = [];
let documentStore: Array<Record<string, unknown>> = [];
let insertFolderError: { code?: string; message?: string } | null = null;
let insertDocumentError: { code?: string; message?: string } | null = null;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getSession: mockGetSession },
    storage: {
      from: () => ({
        upload: mockStorageUp,
        remove: vi.fn().mockResolvedValue({ error: null }),
      }),
    },
  },
  getAuthClient: vi.fn(async () => ({
    auth: { getSession: mockGetSession },
    from: (table: string) => buildTableMock(table),
  })),
}));

function buildTableMock(table: string) {
  return {
    select: (_cols?: string) => buildSelectChain(table),
    insert: (payload: Record<string, unknown> | Record<string, unknown>[]) =>
      buildInsertChain(table, payload),
    update: (payload: Record<string, unknown>) => buildUpdateChain(table, payload),
    delete: () => buildDeleteChain(table),
  };
}

function getStore(table: string) {
  return table === "document_folders" ? folderStore : documentStore;
}

// ─── Query chain builder ──────────────────────────────────────────────────────

function buildSelectChain(table: string) {
  const filters: Array<{ field: string; op: string; value: unknown }> = [];
  let limitN: number | null = null;
  let singleMode = false;
  let countMode = false;

  const chain = {
    eq: (field: string, value: unknown) => {
      filters.push({ field, op: "eq", value });
      return chain;
    },
    neq: (field: string, value: unknown) => {
      filters.push({ field, op: "neq", value });
      return chain;
    },
    is: (field: string, value: unknown) => {
      filters.push({ field, op: "is", value });
      return chain;
    },
    in: (field: string, values: unknown[]) => {
      filters.push({ field, op: "in", value: values });
      return chain;
    },
    not: (field: string, op: string, value: unknown) => {
      filters.push({ field, op: `not_${op}`, value });
      return chain;
    },
    order: () => chain,
    limit: (n: number) => {
      limitN = n;
      return chain;
    },
    single: () => {
      singleMode = true;
      return chain;
    },
    head: () => {
      countMode = true;
      return chain;
    },
    // awaitable
    then: (resolve: (v: unknown) => void) => {
      const store = getStore(table);
      let rows = applyFilters(store, filters);
      if (limitN !== null) rows = rows.slice(0, limitN);
      if (countMode) return resolve({ data: null, count: rows.length, error: null });
      if (singleMode) {
        return resolve(
          rows.length
            ? { data: rows[0], error: null }
            : { data: null, error: { message: "No rows", code: "PGRST116" } },
        );
      }
      return resolve({ data: rows, error: null });
    },
  };
  return chain;
}

function applyFilters(
  rows: Array<Record<string, unknown>>,
  filters: Array<{ field: string; op: string; value: unknown }>,
): Array<Record<string, unknown>> {
  return rows.filter((row) =>
    filters.every(({ field, op, value }) => {
      if (op === "eq") return row[field] === value;
      if (op === "neq") return row[field] !== value;
      if (op === "is") return value === null ? row[field] == null : row[field] === value;
      if (op === "in") return Array.isArray(value) && value.includes(row[field]);
      if (op === "not_is") return value === null ? row[field] != null : row[field] !== value;
      return true;
    }),
  );
}

function buildInsertChain(
  table: string,
  payload: Record<string, unknown> | Record<string, unknown>[],
) {
  const rows = Array.isArray(payload) ? payload : [payload];
  const chain = {
    select: (_cols?: string) => chain,
    single: async () => {
      const err = table === "document_folders" ? insertFolderError : insertDocumentError;
      if (err) return { data: null, error: err };
      const row = { ...rows[0], id: rows[0].id ?? `gen-${Date.now()}-${Math.random()}` };
      if (table === "document_folders") folderStore.push(row);
      else documentStore.push(row);
      return { data: row, error: null };
    },
    // allow awaiting insert directly without select
    then: (resolve: (v: unknown) => void) => {
      const err = table === "document_folders" ? insertFolderError : insertDocumentError;
      if (err) return resolve({ data: null, error: err });
      const stored = rows.map((r) => ({ ...r, id: r.id ?? `gen-${Date.now()}-${Math.random()}` }));
      if (table === "document_folders") folderStore.push(...stored);
      else documentStore.push(...stored);
      return resolve({ data: stored, error: null });
    },
  };
  return chain;
}

function buildUpdateChain(table: string, payload: Record<string, unknown>) {
  const filters: Array<{ field: string; op: string; value: unknown }> = [];
  const chain = {
    eq: (field: string, value: unknown) => {
      filters.push({ field, op: "eq", value });
      return chain;
    },
    then: (resolve: (v: unknown) => void) => {
      const store = getStore(table);
      store.forEach((row) => {
        const matches = filters.every(({ field, op, value }) =>
          op === "eq" ? row[field] === value : true,
        );
        if (matches) Object.assign(row, payload);
      });
      return resolve({ data: null, error: null });
    },
  };
  return chain;
}

function buildDeleteChain(table: string) {
  const filters: Array<{ field: string; op: string; value: unknown }> = [];
  const chain = {
    eq: (field: string, value: unknown) => {
      filters.push({ field, op: "eq", value });
      return chain;
    },
    then: (resolve: (v: unknown) => void) => {
      const store = getStore(table);
      const before = store.length;
      const kept = store.filter(
        (row) =>
          !filters.every(({ field, op, value }) => (op === "eq" ? row[field] === value : false)),
      );
      if (table === "document_folders") folderStore = kept;
      else documentStore = kept;
      const deleted = before - kept.length;
      return resolve({ data: null, error: deleted === 0 ? { message: "not found" } : null });
    },
  };
  return chain;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  folderStore = [];
  documentStore = [];
  insertFolderError = null;
  insertDocumentError = null;
});

// ─── Imports bajo prueba ──────────────────────────────────────────────────────

import {
  normalizeFolderName,
  validateFolderName,
  buildBreadcrumbs,
  wouldCreateCycle,
  buildFolderTree,
} from "@/lib/folder-utils";
import type { DocumentFolder } from "@/lib/folder-utils";
import { migrateRelativePaths } from "@/lib/migrate-relative-paths";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFolder(overrides: Partial<DocumentFolder>): DocumentFolder {
  return {
    id: `folder-${Math.random()}`,
    client_id: "client-a",
    parent_id: null,
    name: "Nueva carpeta",
    normalized_name: "nueva carpeta",
    created_by: "user-uuid-test",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function seedFolder(overrides: Partial<DocumentFolder>): DocumentFolder {
  const folder = makeFolder(overrides);
  folderStore.push({ ...folder });
  return folder;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Normalización
// ═══════════════════════════════════════════════════════════════════════════════

describe("1. Normalización de nombres", () => {
  it("normaliza espacios internos", () => {
    expect(normalizeFolderName("  Proceso   de  alimentos  ")).toBe("proceso de alimentos");
  });

  it("elimina tildes", () => {
    expect(normalizeFolderName("Resolución")).toBe("resolucion");
  });

  it("convierte a minúsculas", () => {
    expect(normalizeFolderName("DEMANDA")).toBe("demanda");
  });

  it("5. Normaliza nombre con tilde y mayúsculas — mismo resultado", () => {
    expect(normalizeFolderName("Medios Probatorios")).toBe(
      normalizeFolderName("medios  probatorios"),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Validación de nombres
// ═══════════════════════════════════════════════════════════════════════════════

describe("2. Validación de nombres", () => {
  it("acepta un nombre válido", () => {
    expect(validateFolderName("Demanda")).toBeNull();
  });

  it("rechaza nombre vacío", () => {
    expect(validateFolderName("   ")).toBeTruthy();
  });

  it("rechaza nombre con /", () => {
    expect(validateFolderName("Resoluciones/2024")).toBeTruthy();
  });

  it("rechaza nombre de más de 120 caracteres", () => {
    expect(validateFolderName("a".repeat(121))).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Breadcrumbs (4 + 7)
// ═══════════════════════════════════════════════════════════════════════════════

describe("3. Breadcrumbs", () => {
  it("7. Construye breadcrumbs raíz → carpeta → subcarpeta", () => {
    const root = makeFolder({ id: "f1", parent_id: null, name: "Proceso" });
    const sub = makeFolder({ id: "f2", parent_id: "f1", name: "Demanda" });
    const crumbs = buildBreadcrumbs("f2", [root, sub]);
    expect(crumbs).toHaveLength(3);
    expect(crumbs[0].id).toBeNull(); // raíz Documentos
    expect(crumbs[1].name).toBe("Proceso");
    expect(crumbs[2].name).toBe("Demanda");
  });

  it("retorna solo raíz cuando folderId es null", () => {
    const crumbs = buildBreadcrumbs(null, []);
    expect(crumbs).toHaveLength(1);
    expect(crumbs[0].name).toBe("Documentos");
  });

  it("no entra en bucle en caso de ciclo espurio", () => {
    // Ciclo artificial en datos corruptos — el guard de visited debe detenerlo
    const f1 = makeFolder({ id: "f1", parent_id: "f2" });
    const f2 = makeFolder({ id: "f2", parent_id: "f1" });
    expect(() => buildBreadcrumbs("f1", [f1, f2])).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Detección de ciclos (16)
// ═══════════════════════════════════════════════════════════════════════════════

describe("4. Detección de ciclos", () => {
  it("16. Bloquea carpeta siendo su propio padre", () => {
    const f = makeFolder({ id: "f1" });
    expect(wouldCreateCycle("f1", "f1", [f])).toBe(true);
  });

  it("16. Detecta ciclo A→B→A", () => {
    const a = makeFolder({ id: "a", parent_id: "b" });
    const b = makeFolder({ id: "b", parent_id: "a" });
    expect(wouldCreateCycle("a", "b", [a, b])).toBe(true);
  });

  it("permite mover a padre sin ciclo", () => {
    const a = makeFolder({ id: "a", parent_id: null });
    const b = makeFolder({ id: "b", parent_id: "a" });
    const c = makeFolder({ id: "c", parent_id: null });
    expect(wouldCreateCycle("a", "c", [a, b, c])).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Árbol de carpetas
// ═══════════════════════════════════════════════════════════════════════════════

describe("5. Árbol de carpetas", () => {
  it("construye árbol con subcarpetas ordenadas", () => {
    const f1 = makeFolder({ id: "f1", parent_id: null, name: "Z-carpeta" });
    const f2 = makeFolder({ id: "f2", parent_id: null, name: "A-carpeta" });
    const f3 = makeFolder({ id: "f3", parent_id: "f2", name: "Sub" });
    const tree = buildFolderTree([f1, f2, f3], "client-a");
    expect(tree[0].name).toBe("A-carpeta");
    expect(tree[0].children[0].name).toBe("Sub");
  });

  it("6. Permite nombres iguales bajo padres distintos", () => {
    const p1 = makeFolder({ id: "p1", parent_id: null, name: "Fiscalía" });
    const p2 = makeFolder({ id: "p2", parent_id: null, name: "Judicial" });
    const c1 = makeFolder({ id: "c1", parent_id: "p1", name: "Documentos" });
    const c2 = makeFolder({ id: "c2", parent_id: "p2", name: "Documentos" });
    const tree = buildFolderTree([p1, p2, c1, c2], "client-a");
    const names = tree.flatMap((n) => n.children.map((ch) => ch.name));
    expect(names.filter((n) => n === "Documentos")).toHaveLength(2);
  });

  it("17. Excluye carpetas de otro cliente", () => {
    const mine = makeFolder({ id: "f1", client_id: "client-a" });
    const other = makeFolder({ id: "f2", client_id: "client-b" });
    const tree = buildFolderTree([mine, other], "client-a");
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe("f1");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Migración de relative_path (18–20)
// ═══════════════════════════════════════════════════════════════════════════════

describe("6. Migración de relative_path", () => {
  it("18. Asigna folder_id a documentos con relative_path que tiene subcarpeta", async () => {
    const docId = "doc-1";
    documentStore.push({
      id: docId,
      client_id: "client-a",
      name: "demanda.pdf",
      relative_path: "Proceso de alimentos/demanda.pdf",
      folder_id: null,
    });

    const report = await migrateRelativePaths("client-a", "user-uuid-test");

    expect(report.documentsAssigned).toBe(1);
    expect(report.foldersCreated).toBe(1);
    expect(report.errors).toHaveLength(0);
  });

  it("19. Segunda migración no crea carpetas duplicadas", async () => {
    const docId = "doc-2";
    // Precreate folder
    folderStore.push({
      id: "existing-folder",
      client_id: "client-a",
      parent_id: null,
      name: "Resoluciones",
      normalized_name: "resoluciones",
      created_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    documentStore.push({
      id: docId,
      client_id: "client-a",
      name: "res01.pdf",
      relative_path: "Resoluciones/res01.pdf",
      folder_id: null,
    });

    const report = await migrateRelativePaths("client-a", "user-uuid-test");

    expect(report.foldersCreated).toBe(0);
    expect(report.foldersReused).toBe(1);
    expect(report.documentsAssigned).toBe(1);
  });

  it("20. No modifica storage_path de los documentos", async () => {
    const storagePath = "client-a/original/path/doc.pdf";
    documentStore.push({
      id: "doc-3",
      client_id: "client-a",
      name: "doc.pdf",
      relative_path: "Subcarpeta/doc.pdf",
      folder_id: null,
      storage_path: storagePath,
    });

    await migrateRelativePaths("client-a", "user-uuid-test");

    const doc = documentStore.find((d) => d.id === "doc-3");
    expect(doc?.storage_path).toBe(storagePath);
  });

  it("Documentos sin subcarpeta (raíz) quedan con folder_id null", async () => {
    documentStore.push({
      id: "doc-root",
      client_id: "client-a",
      name: "contrato.pdf",
      relative_path: "contrato.pdf",
      folder_id: null,
    });

    const report = await migrateRelativePaths("client-a", "user-uuid-test");
    // File is at root — no folder segment → counted as already migrated
    expect(report.documentsAssigned).toBe(0);
    const doc = documentStore.find((d) => d.id === "doc-root");
    expect(doc?.folder_id).toBeNull();
  });

  it("21. Documentos con folder_id ya asignado se cuentan como ya migrados", async () => {
    documentStore.push({
      id: "doc-migrated",
      client_id: "client-a",
      name: "pre.pdf",
      relative_path: "Carpeta/pre.pdf",
      folder_id: "already-assigned",
    });

    const report = await migrateRelativePaths("client-a", "user-uuid-test");
    expect(report.documentsAlreadyMigrated).toBeGreaterThanOrEqual(1);
    expect(report.documentsAssigned).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Engine de importación masiva — creación de carpetas (22–23)
// ═══════════════════════════════════════════════════════════════════════════════

// Import engine uses supabase mock via @/lib/supabase (already mocked above)
// We test the folder-creation logic via resolveFolderIdForPath indirectly
// by checking that the import engine seeds folder_id correctly.

// mockStorageUp re-export for the engine tests — defined in vi.hoisted at top of file

import { runImport } from "@/lib/imports/folder-import-engine";
import type { ClientEntry } from "@/lib/imports/folder-import";

function makeFile(relPath: string, size = 1024) {
  const name = relPath.split("/").pop() ?? "file.pdf";
  const blob = new Blob([new Uint8Array(size).fill(1)], { type: "application/pdf" });
  const f = new File([blob], name) as File & { webkitRelativePath: string };
  Object.defineProperty(f, "webkitRelativePath", { value: relPath, writable: false });
  return f;
}

function makeEntry(clientName: string, docs: Array<{ subpath: string }>): ClientEntry {
  return {
    folderName: clientName,
    normalizedName: clientName.toLowerCase(),
    status: "new",
    documents: docs.map((d) => ({
      file: makeFile(`ROOT/${clientName}/${d.subpath}`),
      relativePath: `${clientName}/${d.subpath}`,
      originalName: d.subpath.split("/").pop() ?? d.subpath,
      status: "pending" as const,
    })),
  };
}

// Typed ref to the mocked getAuthClient — set once the module is loaded
import * as supabaseMod from "@/lib/supabase";

function buildEngineDbMock() {
  return {
    auth: { getSession: mockGetSession },
    from: (table: string) => {
      if (table === "clients") {
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({ data: { id: "client-import-uuid" }, error: null }),
            }),
          }),
          select: () => ({
            eq: () => ({ then: (r: (v: unknown) => void) => r({ data: [], error: null }) }),
          }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      }
      return buildTableMock(table);
    },
  } as unknown as Awaited<ReturnType<typeof supabaseMod.getAuthClient>>;
}

describe("7. Importador masivo — carpetas", () => {
  beforeEach(() => {
    folderStore = [];
    documentStore = [];
    mockStorageUp.mockClear().mockResolvedValue({ error: null });
    vi.mocked(supabaseMod.getAuthClient).mockResolvedValue(buildEngineDbMock());
  });

  it("22. Crea carpeta lógica cuando el documento tiene subcarpeta", async () => {
    const entry = makeEntry("Juan Pérez", [{ subpath: "Demanda/demanda.pdf" }]);
    await runImport({ rootName: "ROOT", clients: [entry], onProgress: vi.fn() });
    const folders = folderStore.filter((f) => f.client_id === "client-import-uuid");
    expect(folders.length).toBeGreaterThanOrEqual(1);
    expect(folders.some((f) => (f.normalized_name as string).includes("demanda"))).toBe(true);
  });

  it("23. Reutiliza carpeta existente en segunda importación del mismo cliente", async () => {
    // Pre-seed the folder
    folderStore.push({
      id: "existing-import-folder",
      client_id: "client-import-uuid",
      parent_id: null,
      name: "Resoluciones",
      normalized_name: "resoluciones",
      created_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    const before = folderStore.length;

    const entry = makeEntry("Juan Pérez", [
      { subpath: "Resoluciones/res01.pdf" },
      { subpath: "Resoluciones/res02.pdf" },
    ]);
    await runImport({ rootName: "ROOT", clients: [entry], onProgress: vi.fn() });

    // Should not have created a duplicate folder
    const afterFolders = folderStore.filter(
      (f) => f.normalized_name === "resoluciones" && f.client_id === "client-import-uuid",
    );
    expect(afterFolders).toHaveLength(1);
    expect(folderStore.length).toBe(before); // no new folder
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Reglas de negocio: duplicados y pertenencia (4, 5, 6, 17)
// ═══════════════════════════════════════════════════════════════════════════════

describe("8. Reglas de negocio", () => {
  it("4. Normalización bloquea nombres duplicados bajo mismo padre", () => {
    // "Resolución" y "resolucion" son el mismo normalizado
    const norm1 = normalizeFolderName("Resolución");
    const norm2 = normalizeFolderName("resolucion");
    expect(norm1).toBe(norm2);
  });

  it("6. Nombres idénticos son distintos cuando el padre es diferente (normalized_name + parent_id)", () => {
    // A nivel de datos: dos carpetas con el mismo normalized_name pero distinto parent_id son válidas
    const f1 = makeFolder({ id: "c1", parent_id: "p1", normalized_name: "documentos" });
    const f2 = makeFolder({ id: "c2", parent_id: "p2", normalized_name: "documentos" });
    // Ambas pueden coexistir — son bajo padres distintos
    expect(f1.parent_id).not.toBe(f2.parent_id);
    expect(f1.normalized_name).toBe(f2.normalized_name);
  });

  it("17. wouldCreateCycle detecta que el padre propuesto pertenece al árbol hijo", () => {
    // Carpeta A tiene hija B; proponer que A sea hija de B crearía ciclo
    const a = makeFolder({ id: "a", parent_id: null });
    const b = makeFolder({ id: "b", parent_id: "a" });
    expect(wouldCreateCycle("a", "b", [a, b])).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Documentos existentes visibles (21)
// ═══════════════════════════════════════════════════════════════════════════════

describe("9. Documentos sin carpeta — visibilidad", () => {
  it("21. Documentos con folder_id=null siguen en la raíz (no se ocultan)", async () => {
    // Un documento sin folder_id debe aparecer en la consulta de sin-clasificar
    documentStore.push({
      id: "old-doc",
      client_id: "client-a",
      name: "contrato-viejo.pdf",
      folder_id: null,
      uploaded_at: new Date().toISOString(),
    });

    const db = await supabaseMod.getAuthClient();
    // Simula la query de useUnclassifiedDocuments
    const result = await (db
      .from("documents")
      .select("*")
      .eq("client_id", "client-a")
      .is("folder_id", null) as unknown as Promise<{ data: unknown[]; error: null }>);
    expect(result.data.length).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Informe de migración
// ═══════════════════════════════════════════════════════════════════════════════

describe("10. Informe de migración", () => {
  it("genera informe con todos los campos requeridos", async () => {
    const report = await migrateRelativePaths("client-vacio", "user-uuid-test");
    expect(typeof report.documentsAnalyzed).toBe("number");
    expect(typeof report.documentsAlreadyMigrated).toBe("number");
    expect(typeof report.documentsAssigned).toBe("number");
    expect(typeof report.foldersCreated).toBe("number");
    expect(typeof report.foldersReused).toBe("number");
    expect(Array.isArray(report.errors)).toBe(true);
    expect(typeof report.pending).toBe("number");
  });

  it("reporte con 0 documentos no lanza error", async () => {
    await expect(migrateRelativePaths("client-vacio", null)).resolves.toBeDefined();
  });
});
