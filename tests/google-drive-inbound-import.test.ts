import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 8E — Drive -> CRM: importación de archivos añadidos manualmente en
 * carpetas de Cliente ya vinculadas.
 *
 * Drive, Supabase y Storage están simulados en memoria. Estas pruebas nunca
 * salen a internet, nunca tocan una cuenta de Drive real y nunca escriben en
 * una base de datos.
 *
 * Esta fase NO implementa descubrimiento automático: nada aquí produce el
 * trabajo `import_drive_file` salvo `enqueueGoogleDriveImportFile`, llamada
 * directamente por los tests -- exactamente el mismo helper que usará la
 * Fase 8F.
 */

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), createClient: vi.fn() }));
vi.mock("@/lib/auth-server", () => ({ requireUser: mocks.requireUser }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

import { createHash } from "node:crypto";
import { setServerRuntimeEnv } from "@/lib/server-runtime-env";
import { encryptToken } from "@/lib/google-drive/google-drive.server";
import {
  enqueueGoogleDriveImportFile,
  processGoogleDriveSyncQueue,
} from "@/lib/google-drive/drive-sync.server";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const SHORTCUT_MIME = "application/vnd.google-apps.shortcut";
const ROOT_ID = "ROOT_CLIENTES";
const CONNECTION_ID = "11111111-1111-1111-1111-111111111111";
const ADMIN_ID = "22222222-2222-2222-2222-222222222222";
const CLIENT_ID = "33333333-3333-3333-3333-333333333333";
const CLIENT_B_ID = "55555555-5555-5555-5555-555555555555";
const FOLDER_ID = "F_ANA";
const FOLDER_B_ID = "F_MARIA";
const FILE_ID = "DRIVE_FILE_1";

const ENV = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  SUPABASE_ANON_KEY: "anon-key",
  GOOGLE_DRIVE_CLIENT_ID: "drive-client-id",
  GOOGLE_DRIVE_CLIENT_SECRET: "drive-client-secret",
  GOOGLE_DRIVE_REDIRECT_URI: "https://crm.example/api/google-drive/callback",
  GOOGLE_TOKEN_ENCRYPTION_KEY: "clave-de-cifrado-de-pruebas-32-bytes",
  GOOGLE_OAUTH_STATE_SECRET: "secreto-de-state-de-pruebas",
  GOOGLE_DRIVE_MAINTENANCE_SECRET: "maintenance-secret",
};

function md5(bytes: Uint8Array): string {
  return createHash("md5").update(bytes).digest("hex");
}

// ── Drive falso ──────────────────────────────────────────────────────────
type FakeDriveFile = {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  trashed?: boolean;
  size?: string;
  md5Checksum?: string;
  modifiedTime?: string;
  version?: string;
  webViewLink?: string;
  appProperties?: Record<string, string>;
  capabilities?: { canDownload?: boolean };
  content?: Uint8Array;
  /** Tras la N-ésima lectura de metadata, aplica este parche (simula que
   *  Drive cambió entre M1 y M2). */
  driftAfterMetadataFetch?: number;
  driftPatch?: Partial<FakeDriveFile>;
};

let driveFiles: Map<string, FakeDriveFile>;
let metadataFetchCounts: Map<string, number>;
let driveCalls: Array<{ url: string; method: string }>;

function driveResourceBody(file: FakeDriveFile) {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    parents: file.parents,
    trashed: file.trashed ?? false,
    size: file.size,
    md5Checksum: file.md5Checksum,
    modifiedTime: file.modifiedTime ?? "2026-08-25T10:00:00.000Z",
    version: file.version ?? "1",
    webViewLink: file.webViewLink ?? `https://drive.example/${file.id}`,
    appProperties: file.appProperties ?? {},
    driveId: undefined,
    capabilities: file.capabilities ?? { canDownload: true },
  };
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function fakeDriveFetch(url: string, init?: RequestInit) {
  const method = (init?.method ?? "GET").toUpperCase();
  driveCalls.push({ url, method });

  if (url.startsWith("https://oauth2.googleapis.com/token")) {
    return jsonResponse({ access_token: "fresh-token", expires_in: 3600 });
  }

  const single = /\/drive\/v3\/files\/([^?]+)\?(.*)$/.exec(url);
  if (single) {
    const id = decodeURIComponent(single[1]);
    const query = single[2];
    const file = driveFiles.get(id);
    if (!file) return jsonResponse({ error: { message: "not found" } }, 404);

    if (query.includes("alt=media")) {
      if (file.content === undefined)
        return jsonResponse({ error: { message: "no content" } }, 404);
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: {
          getReader: () => {
            let sent = false;
            return {
              read: async () => {
                if (sent) return { done: true, value: undefined };
                sent = true;
                return { done: false, value: file.content };
              },
              cancel: async () => undefined,
            };
          },
        },
        json: async () => ({}),
        text: async () => "",
      } as unknown as Response;
    }

    // Lectura de metadata (con o sin campos inbound). Cuenta las lecturas
    // para poder simular una deriva entre M1 y M2 dentro de un mismo run.
    const count = (metadataFetchCounts.get(id) ?? 0) + 1;
    metadataFetchCounts.set(id, count);
    const body = driveResourceBody(file);
    if (file.driftAfterMetadataFetch === count && file.driftPatch) {
      Object.assign(file, file.driftPatch);
    }
    return jsonResponse(body);
  }

  return jsonResponse({ error: { message: `unhandled ${url}` } }, 404);
}

// ── Supabase + Storage falsos ────────────────────────────────────────────
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let storageObjects: Map<string, Uint8Array>;
let storageRemoveCalls: string[];
let rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
/** Hace que la PRÓXIMA llamada a finalize_google_drive_import falle una
 *  sola vez con este mensaje, simulando un problema ambiental transitorio
 *  (p. ej. un crash del proceso justo tras subir a Storage). Se limpia
 *  automáticamente tras usarse. */
let forceFinalizeErrorOnce: string | null;

function makeFakeSupabase() {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const inFilters: Array<[string, unknown[]]> = [];
      let op: "select" | "insert" | "update" = "select";
      let payload: Row | null = null;
      const builder: Record<string, unknown> = {};
      const rows = () =>
        (tables[table] ?? []).filter(
          (row) =>
            filters.every(([col, val]) => row[col] === val) &&
            inFilters.every(([col, vals]) => vals.includes(row[col])),
        );

      function run() {
        if (op === "insert") {
          const list = (tables[table] ??= []);
          const dedupe = payload?.dedupe_key;
          if (
            table === "google_drive_sync_queue" &&
            dedupe &&
            list.some(
              (r) =>
                r.dedupe_key === dedupe && ["pending", "processing"].includes(String(r.status)),
            )
          ) {
            return { data: null, error: { code: "23505", message: "duplicate" } };
          }
          const inserted = {
            id: list.length + 1,
            status: "pending",
            attempt_count: 0,
            payload: {},
            client_id: null,
            document_id: null,
            drive_file_id: null,
            ...payload,
          };
          list.push(inserted);
          return { data: inserted, error: null };
        }
        if (op === "update") {
          for (const row of rows()) Object.assign(row, payload);
          return { data: null, error: null };
        }
        return { data: rows(), error: null };
      }

      Object.assign(builder, {
        select: () => builder,
        order: () => builder,
        eq: (col: string, val: unknown) => {
          filters.push([col, val]);
          return builder;
        },
        in: (col: string, vals: unknown[]) => {
          inFilters.push([col, vals]);
          return builder;
        },
        gt: () => builder,
        insert: (values: Row) => {
          op = "insert";
          payload = values;
          return builder;
        },
        update: (values: Row) => {
          op = "update";
          payload = values;
          return builder;
        },
        maybeSingle: async () => {
          const result = run();
          const data = Array.isArray(result.data) ? (result.data[0] ?? null) : result.data;
          return { data, error: (result as { error?: unknown }).error ?? null };
        },
        then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) =>
          Promise.resolve(run()).then(resolve, reject),
      });
      return builder;
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      return Promise.resolve(fakeRpc(name, args));
    },
    storage: {
      from: () => ({
        upload: async (path: string, bytes: Uint8Array) => {
          if (storageObjects.has(path)) {
            return { data: null, error: { message: "The resource already exists" } };
          }
          storageObjects.set(path, bytes);
          return { data: { path }, error: null };
        },
        download: async (path: string) => {
          const bytes = storageObjects.get(path);
          if (!bytes) return { data: null, error: { message: "not found" } };
          return {
            data: { arrayBuffer: async () => bytes.buffer.slice(0) } as unknown as Blob,
            error: null,
          };
        },
        remove: async (paths: string[]) => {
          for (const path of paths) {
            storageObjects.delete(path);
            storageRemoveCalls.push(path);
          }
          return { data: null, error: null };
        },
      }),
    },
  };
}

function fakeRpc(name: string, args: Record<string, unknown>) {
  if (name === "claim_google_drive_sync_operations") {
    const now = Date.now();
    const claimable = (tables.google_drive_sync_queue ?? []).filter(
      (row) => row.status === "pending" && new Date(String(row.available_at ?? 0)).getTime() <= now,
    );
    const limit = Number(args.p_limit ?? 10);
    const claimed = claimable.slice(0, limit);
    for (const row of claimed) {
      row.status = "processing";
      row.claimed_at = new Date().toISOString();
      row.attempt_count = Number(row.attempt_count ?? 0) + 1;
    }
    return { data: claimed.map((row) => ({ ...row })), error: null };
  }

  if (name === "finalize_google_drive_import") {
    if (forceFinalizeErrorOnce) {
      const message = forceFinalizeErrorOnce;
      forceFinalizeErrorOnce = null;
      return { data: null, error: { message } };
    }
    const connection = (tables.google_drive_connections ?? []).find(
      (row) => row.id === args.p_connection_id,
    );
    if (!connection || connection.status !== "connected") {
      return { data: null, error: { message: "DRIVE_NOT_CONNECTED" } };
    }
    if (connection.root_folder_id !== args.p_expected_root_folder_id) {
      return { data: null, error: { message: "DRIVE_ROOT_CHANGED_RETRY" } };
    }
    const folder = (tables.google_drive_client_folders ?? []).find(
      (row) => row.connection_id === args.p_connection_id && row.client_id === args.p_client_id,
    );
    if (
      !folder ||
      folder.drive_folder_id !== args.p_drive_parent_id ||
      folder.sync_status !== "synced"
    ) {
      return { data: null, error: { message: "CLIENT_FOLDER_CHANGED_RETRY" } };
    }
    const existingByFile = (tables.google_drive_document_files ?? []).find(
      (row) =>
        row.connection_id === args.p_connection_id && row.drive_file_id === args.p_drive_file_id,
    );
    if (existingByFile) {
      if (existingByFile.document_id === args.p_target_document_id) {
        return { data: { created: false, unchanged: true }, error: null };
      }
      return { data: null, error: { message: "DRIVE_FILE_ALREADY_IMPORTED" } };
    }
    const existingDocument = (tables.documents ?? []).find(
      (row) => row.id === args.p_target_document_id,
    );
    if (existingDocument) {
      return { data: null, error: { message: "IMPORT_IDENTITY_CONFLICT" } };
    }
    (tables.documents ??= []).push({
      id: args.p_target_document_id,
      name: args.p_name,
      type: "Otros",
      document_type: "Otros",
      mime_type: args.p_mime_type,
      size: args.p_size_label,
      file_size: args.p_file_size,
      storage_path: args.p_storage_path,
      client_id: args.p_client_id,
      case_id: null,
      source_type: "google_drive",
      source_provider: "google_drive",
      external_file_id: args.p_drive_file_id,
      external_folder_id: args.p_drive_parent_id,
      external_url: args.p_web_view_link,
      content_hash: args.p_content_hash,
      checksum: args.p_content_hash,
      created_by: null,
    });
    (tables.google_drive_document_files ??= []).push({
      document_id: args.p_target_document_id,
      connection_id: args.p_connection_id,
      drive_file_id: args.p_drive_file_id,
      drive_parent_id: args.p_drive_parent_id,
      sync_status: "synced",
      last_synced_file_name: args.p_name,
      last_synced_content_hash: args.p_content_hash,
    });
    return { data: { created: true, unchanged: false }, error: null };
  }

  return { data: null, error: { message: `unknown rpc ${name}` } };
}

// ── setup ────────────────────────────────────────────────────────────────
function connectionRow(overrides: Row = {}): Row {
  return {
    id: CONNECTION_ID,
    connected_by: ADMIN_ID,
    google_account_email: "estudio@example.com",
    encrypted_refresh_token: "will-be-set-in-beforeEach",
    granted_scopes: "https://www.googleapis.com/auth/drive",
    root_folder_id: ROOT_ID,
    root_folder_name: "Clientes",
    shared_drive_id: null,
    status: "connected",
    last_synced_at: null,
    last_error: null,
    ...overrides,
  };
}

const queue = () => tables.google_drive_sync_queue;
const documents = () => tables.documents ?? [];
const documentMappings = () => tables.google_drive_document_files ?? [];

function enqueueImport(driveFileId: string) {
  return enqueueGoogleDriveImportFile({ connectionId: CONNECTION_ID, driveFileId });
}

async function run() {
  return processGoogleDriveSyncQueue();
}

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0xff, 0xfe]);

beforeEach(async () => {
  setServerRuntimeEnv(ENV);
  driveCalls = [];
  driveFiles = new Map();
  metadataFetchCounts = new Map();
  storageObjects = new Map();
  storageRemoveCalls = [];
  rpcCalls = [];
  forceFinalizeErrorOnce = null;

  driveFiles.set(FOLDER_ID, {
    id: FOLDER_ID,
    name: "Ana Torres",
    mimeType: FOLDER_MIME,
    parents: [ROOT_ID],
  });
  driveFiles.set(FOLDER_B_ID, {
    id: FOLDER_B_ID,
    name: "Maria Lopez",
    mimeType: FOLDER_MIME,
    parents: [ROOT_ID],
  });
  driveFiles.set(FILE_ID, {
    id: FILE_ID,
    name: "contrato.pdf",
    mimeType: "application/pdf",
    parents: [FOLDER_ID],
    size: String(PDF_BYTES.length),
    md5Checksum: md5(PDF_BYTES),
    content: PDF_BYTES,
  });

  const encryptedToken = await encryptToken("refresh-token-de-pruebas");
  tables = {
    profiles: [{ id: ADMIN_ID, role: "Administrador", status: "Activo" }],
    clients: [
      { id: CLIENT_ID, name: "Ana Torres" },
      { id: CLIENT_B_ID, name: "Maria Lopez" },
    ],
    google_drive_connections: [connectionRow({ encrypted_refresh_token: encryptedToken })],
    google_drive_client_folders: [
      {
        connection_id: CONNECTION_ID,
        client_id: CLIENT_ID,
        drive_folder_id: FOLDER_ID,
        sync_status: "synced",
      },
      {
        connection_id: CONNECTION_ID,
        client_id: CLIENT_B_ID,
        drive_folder_id: FOLDER_B_ID,
        sync_status: "synced",
      },
    ],
    documents: [],
    google_drive_document_files: [],
    google_drive_sync_queue: [],
  };
  mocks.requireUser.mockResolvedValue({ id: ADMIN_ID });
  mocks.createClient.mockImplementation(() => makeFakeSupabase());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => fakeDriveFetch(String(url), init)),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  setServerRuntimeEnv({});
});

// ── encolado ─────────────────────────────────────────────────────────────
describe("Fase 8E — enqueueGoogleDriveImportFile: server-only, sin clientId", () => {
  it("encola sin necesitar clientId; el worker lo resuelve él mismo", async () => {
    await enqueueImport(FILE_ID);
    expect(queue()).toHaveLength(1);
    expect(queue()[0]).toMatchObject({ operation: "import_drive_file", drive_file_id: FILE_ID });
    expect(queue()[0].client_id).toBeNull();
  });

  it("dos encolados del mismo archivo deduplican", async () => {
    await enqueueImport(FILE_ID);
    await enqueueImport(FILE_ID);
    expect(queue()).toHaveLength(1);
  });

  it("nunca llama a Google al encolar", async () => {
    await enqueueImport(FILE_ID);
    expect(driveCalls).toEqual([]);
  });
});

// ── caso feliz ───────────────────────────────────────────────────────────
describe("Fase 8E — importación exitosa de un blob válido", () => {
  it("descarga, verifica, sube a Storage y finaliza documento + mapping", async () => {
    await enqueueImport(FILE_ID);
    const summary = await run();
    expect(summary.completed).toBe(1);
    expect(documents()).toHaveLength(1);
    expect(documents()[0]).toMatchObject({
      client_id: CLIENT_ID,
      case_id: null,
      type: "Otros",
      source_type: "google_drive",
      source_provider: "google_drive",
      external_file_id: FILE_ID,
      created_by: null,
    });
    expect(documentMappings()).toHaveLength(1);
    expect(documentMappings()[0]).toMatchObject({
      drive_file_id: FILE_ID,
      drive_parent_id: FOLDER_ID,
      sync_status: "synced",
    });
    expect(storageObjects.size).toBe(1);
  });

  it("nunca usa webContentLink ni una URL firmada de Google", async () => {
    await enqueueImport(FILE_ID);
    await run();
    for (const call of driveCalls) {
      expect(call.url).not.toContain("webContentLink");
    }
  });
});

// ── Sección 38: ya mapeado ───────────────────────────────────────────────
describe("Fase 8E — archivo ya mapeado: no-op", () => {
  it("si drive_file_id ya está en google_drive_document_files, no se hace nada", async () => {
    tables.google_drive_document_files = [
      { connection_id: CONNECTION_ID, drive_file_id: FILE_ID, document_id: "existing-doc" },
    ];
    await enqueueImport(FILE_ID);
    const summary = await run();
    expect(summary.completed).toBe(1);
    expect(documents()).toEqual([]);
    // No se ni siquiera pidió metadata: 0 llamadas a archivos de Drive (el
    // refresco del access token sí ocurre siempre, por cada lote procesado).
    expect(driveCalls.filter((c) => c.url.includes("/drive/v3/files"))).toEqual([]);
  });
});

// ── tipos no soportados (Sección 10/42) ───────────────────────────────────
describe("Fase 8E — Google Workspace y entradas no importables", () => {
  const cases: Array<[string, string]> = [
    ["application/vnd.google-apps.document", "GOOGLE_WORKSPACE_FILE_UNSUPPORTED"],
    ["application/vnd.google-apps.spreadsheet", "GOOGLE_WORKSPACE_FILE_UNSUPPORTED"],
    ["application/vnd.google-apps.presentation", "GOOGLE_WORKSPACE_FILE_UNSUPPORTED"],
    [FOLDER_MIME, "DRIVE_ENTRY_NOT_IMPORTABLE"],
    [SHORTCUT_MIME, "DRIVE_ENTRY_NOT_IMPORTABLE"],
  ];

  for (const [mimeType, expectedReason] of cases) {
    it(`${mimeType} -> ${expectedReason}, sin alt=media ni Storage`, async () => {
      driveFiles.get(FILE_ID)!.mimeType = mimeType;
      await enqueueImport(FILE_ID);
      const summary = await run();
      expect(summary.failed).toBe(1);
      expect(queue()[0].last_error).toBe(expectedReason);
      expect(driveCalls.some((c) => c.url.includes("alt=media"))).toBe(false);
      expect(storageObjects.size).toBe(0);
      expect(documents()).toEqual([]);
    });
  }
});

// ── appProperties: propiedad ajena (Sección 12/39) ───────────────────────
describe("Fase 8E — un archivo con identidad CRM nunca es un import nuevo", () => {
  it("Caso A: gestionado y coincide -> no-op, sin Storage ni documento nuevo", async () => {
    tables.documents = [{ id: "doc-existente", client_id: CLIENT_ID }];
    tables.google_drive_document_files = [
      { document_id: "doc-existente", drive_file_id: FILE_ID, connection_id: "otra-conexion" },
    ];
    driveFiles.get(FILE_ID)!.appProperties = {
      crm_entity: "document",
      crm_document_id: "doc-existente",
      crm_client_id: CLIENT_ID,
    };
    await enqueueImport(FILE_ID);
    const summary = await run();
    expect(summary.completed).toBe(1);
    expect(documents()).toHaveLength(1); // el mismo de antes, ninguno nuevo
    expect(storageObjects.size).toBe(0);
  });

  it("Caso B: el documento existe pero el mapping no coincide -> OUTBOUND_MAPPING_REPAIR_REQUIRED", async () => {
    tables.documents = [{ id: "doc-existente", client_id: CLIENT_ID }];
    tables.google_drive_document_files = [];
    driveFiles.get(FILE_ID)!.appProperties = {
      crm_entity: "document",
      crm_document_id: "doc-existente",
      crm_client_id: CLIENT_ID,
    };
    await enqueueImport(FILE_ID);
    const summary = await run();
    expect(summary.failed).toBe(1);
    expect(queue()[0].last_error).toBe("OUTBOUND_MAPPING_REPAIR_REQUIRED");
    expect(storageObjects.size).toBe(0);
  });

  it("Caso C (OBLIGATORIO, Sección 39): el documento NO existe -> OUTBOUND_ORPHAN_REVIEW_REQUIRED, nunca se resucita", async () => {
    // Exactamente el escenario de un prepare-trash perdido + documento
    // borrado del CRM: el documento referenciado ya no existe.
    driveFiles.get(FILE_ID)!.appProperties = {
      crm_entity: "document",
      crm_document_id: "11111111-0000-0000-0000-000000000000",
      crm_client_id: CLIENT_ID,
    };
    await enqueueImport(FILE_ID);
    const summary = await run();
    expect(summary.failed).toBe(1);
    expect(queue()[0].last_error).toBe("OUTBOUND_ORPHAN_REVIEW_REQUIRED");
    expect(storageObjects.size).toBe(0);
    expect(documents()).toEqual([]);
    expect(documentMappings()).toEqual([]);
  });

  it("appProperties con crm_entity mal formado (sin ids) -> DRIVE_APP_PROPERTY_CONFLICT, nunca se ignora", async () => {
    driveFiles.get(FILE_ID)!.appProperties = { crm_entity: "document" };
    await enqueueImport(FILE_ID);
    const summary = await run();
    expect(summary.failed).toBe(1);
    expect(queue()[0].last_error).toBe("DRIVE_APP_PROPERTY_CONFLICT");
    expect(storageObjects.size).toBe(0);
  });

  it("appProperties con crm_entity desconocido (ej. client_folder en un archivo) -> DRIVE_APP_PROPERTY_CONFLICT", async () => {
    driveFiles.get(FILE_ID)!.appProperties = {
      crm_entity: "client_folder",
      crm_client_id: CLIENT_ID,
    };
    await enqueueImport(FILE_ID);
    const summary = await run();
    expect(queue()[0].last_error).toBe("DRIVE_APP_PROPERTY_CONFLICT");
  });

  it("un archivo manual (sin crm_entity) SÍ es candidato normal", async () => {
    // Ya es el caso por defecto en el fixture (appProperties: {}).
    await enqueueImport(FILE_ID);
    const summary = await run();
    expect(summary.completed).toBe(1);
  });
});

// ── canDownload (Sección 9/43) ────────────────────────────────────────────
describe("Fase 8E — canDownload", () => {
  it("canDownload=false -> DRIVE_DOWNLOAD_NOT_ALLOWED, nunca intenta alt=media", async () => {
    driveFiles.get(FILE_ID)!.capabilities = { canDownload: false };
    await enqueueImport(FILE_ID);
    const summary = await run();
    expect(summary.failed).toBe(1);
    expect(queue()[0].last_error).toBe("DRIVE_DOWNLOAD_NOT_ALLOWED");
    expect(driveCalls.some((c) => c.url.includes("alt=media"))).toBe(false);
  });
});

// ── tamaño (Sección 19/43, endurecido en 8E.1 Sección 3/7) ─────────────────
describe("Fase 8E.1 — metadata.size: precheck obligatorio antes de alt=media", () => {
  it("A. metadata.size > 10MB -> DOCUMENT_TOO_LARGE, 0 alt=media", async () => {
    driveFiles.get(FILE_ID)!.size = String(11 * 1024 * 1024);
    await enqueueImport(FILE_ID);
    const summary = await run();
    expect(summary.failed).toBe(1);
    expect(queue()[0].last_error).toBe("DOCUMENT_TOO_LARGE");
    expect(driveCalls.some((c) => c.url.includes("alt=media"))).toBe(false);
  });

  it("B. metadata.size ausente -> DRIVE_FILE_SIZE_UNKNOWN, 0 alt=media (nunca se procede a ciegas)", async () => {
    driveFiles.get(FILE_ID)!.size = undefined;
    await enqueueImport(FILE_ID);
    const summary = await run();
    expect(summary.failed).toBe(1);
    expect(queue()[0].last_error).toBe("DRIVE_FILE_SIZE_UNKNOWN");
    expect(driveCalls.some((c) => c.url.includes("alt=media"))).toBe(false);
    expect(storageObjects.size).toBe(0);
  });

  it("metadata.size con formato inválido (no decimal) -> DRIVE_FILE_SIZE_UNKNOWN, 0 alt=media", async () => {
    driveFiles.get(FILE_ID)!.size = "not-a-number";
    await enqueueImport(FILE_ID);
    const summary = await run();
    expect(summary.failed).toBe(1);
    expect(queue()[0].last_error).toBe("DRIVE_FILE_SIZE_UNKNOWN");
    expect(driveCalls.some((c) => c.url.includes("alt=media"))).toBe(false);
  });

  it("E. metadata dice pequeño pero el stream real supera 10MB -> aborta, 0 Storage", async () => {
    const big = new Uint8Array(11 * 1024 * 1024);
    driveFiles.get(FILE_ID)!.size = "100";
    driveFiles.get(FILE_ID)!.content = big;
    await enqueueImport(FILE_ID);
    const summary = await run();
    expect(summary.failed).toBe(1);
    expect(queue()[0].last_error).toBe("DOCUMENT_TOO_LARGE");
    expect(storageObjects.size).toBe(0);
  });

  it("F. el stream termina con un tamaño distinto al declarado -> DRIVE_DOWNLOAD_SIZE_MISMATCH, reintentable, 0 Storage", async () => {
    // El archivo cambió de contenido justo antes de la descarga sin que
    // ninguno de los otros campos comparados en M1/M2 lo delate en este
    // mock puntual -- la comprobación de tamaño real lo detecta igual.
    const shorter = PDF_BYTES.slice(0, PDF_BYTES.length - 2);
    driveFiles.get(FILE_ID)!.content = shorter;
    await enqueueImport(FILE_ID);
    const summary = await run();
    expect(summary.retried).toBe(1);
    expect(queue()[0].last_error).toBe("DRIVE_DOWNLOAD_SIZE_MISMATCH");
    expect(storageObjects.size).toBe(0);
  });

  it("G. archivo válido: tamaño declarado coincide con el stream -> import normal", async () => {
    await enqueueImport(FILE_ID);
    const summary = await run();
    expect(summary.completed).toBe(1);
  });
});

// ── stream obligatorio (Sección 4/7) ────────────────────────────────────────
describe("Fase 8E.1 — descarga inbound: nunca cae a arrayBuffer()", () => {
  it("C. response.body=null -> DRIVE_DOWNLOAD_STREAM_UNAVAILABLE, reintentable, jamás llama a arrayBuffer()", async () => {
    const arrayBufferSpy = vi.fn(() => {
      throw new Error("arrayBuffer() NUNCA debe invocarse en la descarga inbound de Drive.");
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const response = fakeDriveFetch(String(url), init);
        if (String(url).includes("alt=media")) {
          return { ...response, body: null, arrayBuffer: arrayBufferSpy } as unknown as Response;
        }
        return response;
      }),
    );
    await enqueueImport(FILE_ID);
    const summary = await run();
    expect(summary.retried).toBe(1);
    expect(queue()[0].last_error).toBe("DRIVE_DOWNLOAD_STREAM_UNAVAILABLE");
    expect(arrayBufferSpy).not.toHaveBeenCalled();
    expect(storageObjects.size).toBe(0);
  });
});

// ── resolución de padre directo (Sección 7/15) ────────────────────────────
describe("Fase 8E — resolución de Cliente por el padre DIRECTO", () => {
  it("0 mappings coinciden -> DRIVE_PARENT_UNLINKED", async () => {
    driveFiles.get(FILE_ID)!.parents = ["CARPETA_SIN_VINCULAR"];
    await enqueueImport(FILE_ID);
    const summary = await run();
    expect(summary.failed).toBe(1);
    expect(queue()[0].last_error).toBe("DRIVE_PARENT_UNLINKED");
  });

  it(">1 mapping coincide -> DRIVE_PARENT_AMBIGUOUS", async () => {
    driveFiles.get(FILE_ID)!.parents = [FOLDER_ID, FOLDER_B_ID];
    await enqueueImport(FILE_ID);
    const summary = await run();
    expect(summary.failed).toBe(1);
    expect(queue()[0].last_error).toBe("DRIVE_PARENT_AMBIGUOUS");
  });

  it("una subcarpeta interna del Cliente NUNCA se interpreta automáticamente (solo hijos directos)", async () => {
    // "Expediente 2025/demanda.pdf": el archivo cuelga de una subcarpeta,
    // no directamente de la carpeta del Cliente.
    driveFiles.set("SUBCARPETA", {
      id: "SUBCARPETA",
      name: "Expediente 2025",
      mimeType: FOLDER_MIME,
      parents: [FOLDER_ID],
    });
    driveFiles.get(FILE_ID)!.parents = ["SUBCARPETA"];
    await enqueueImport(FILE_ID);
    const summary = await run();
    expect(summary.failed).toBe(1);
    expect(queue()[0].last_error).toBe("DRIVE_PARENT_UNLINKED");
  });
});

// ── integridad de la carpeta de Cliente (Sección 16/40) ───────────────────
describe("Fase 8E — la carpeta de Cliente se revalida en vivo", () => {
  it("Sección 40: la carpeta fue movida fuera de la raíz -> DRIVE_PARENT_MISMATCH, 0 Storage, 0 documento, sin reasignar Cliente", async () => {
    driveFiles.get(FOLDER_ID)!.parents = ["OTRA_CARPETA_FUERA_DE_ROOT"];
    await enqueueImport(FILE_ID);
    const summary = await run();
    expect(summary.failed).toBe(1);
    expect(queue()[0].last_error).toBe("DRIVE_PARENT_MISMATCH");
    expect(storageObjects.size).toBe(0);
    expect(documents()).toEqual([]);
  });

  it("la carpeta de Cliente está en la papelera -> DRIVE_PARENT_MISMATCH", async () => {
    driveFiles.get(FOLDER_ID)!.trashed = true;
    await enqueueImport(FILE_ID);
    const summary = await run();
    expect(queue()[0].last_error).toBe("DRIVE_PARENT_MISMATCH");
  });
});

// ── integridad de descarga: MD5 (Sección 21/43) ───────────────────────────
describe("Fase 8E — verificación de integridad de la descarga", () => {
  it("MD5 coincide con el de Drive -> continúa normalmente", async () => {
    await enqueueImport(FILE_ID);
    const summary = await run();
    expect(summary.completed).toBe(1);
  });

  it("MD5 no coincide -> DRIVE_DOWNLOAD_CHECKSUM_MISMATCH, reintentable", async () => {
    driveFiles.get(FILE_ID)!.md5Checksum = "0".repeat(32);
    await enqueueImport(FILE_ID);
    const summary = await run();
    expect(summary.retried).toBe(1);
    expect(queue()[0].last_error).toBe("DRIVE_DOWNLOAD_CHECKSUM_MISMATCH");
    expect(storageObjects.size).toBe(0);
  });
});

// ── doble comprobación de metadata: M1 vs M2 (Sección 17/41/44) ───────────
describe("Fase 8E — Drive puede cambiar entre validar y descargar: M1 vs M2", () => {
  it("M1 == M2 -> import permitido", async () => {
    await enqueueImport(FILE_ID);
    const summary = await run();
    expect(summary.completed).toBe(1);
  });

  it("el archivo se renombra durante la descarga -> retry, 0 Storage antes de M2 estable", async () => {
    const file = driveFiles.get(FILE_ID)!;
    file.driftAfterMetadataFetch = 1;
    file.driftPatch = { name: "renombrado.pdf" };
    await enqueueImport(FILE_ID);
    const summary = await run();
    expect(summary.retried).toBe(1);
    expect(queue()[0].last_error).toBe("DRIVE_FILE_CHANGED_RETRY");
    expect(storageObjects.size).toBe(0);
  });

  it("Sección 41: el archivo se mueve de Cliente A a Cliente B durante la descarga -> retry, NO importa a A ni a B", async () => {
    const file = driveFiles.get(FILE_ID)!;
    file.driftAfterMetadataFetch = 1;
    file.driftPatch = { parents: [FOLDER_B_ID] };
    await enqueueImport(FILE_ID);
    const summary = await run();
    expect(summary.retried).toBe(1);
    expect(queue()[0].last_error).toBe("DRIVE_FILE_CHANGED_RETRY");
    expect(documents()).toEqual([]);
    expect(storageObjects.size).toBe(0);
  });

  it("modifiedTime/version cambia -> retry", async () => {
    const file = driveFiles.get(FILE_ID)!;
    file.driftAfterMetadataFetch = 1;
    file.driftPatch = { version: "2", modifiedTime: "2026-08-25T11:00:00.000Z" };
    await enqueueImport(FILE_ID);
    const summary = await run();
    expect(summary.retried).toBe(1);
    expect(queue()[0].last_error).toBe("DRIVE_FILE_CHANGED_RETRY");
  });

  it("el archivo se marca trashed después de M1 -> retry, no se importa", async () => {
    const file = driveFiles.get(FILE_ID)!;
    file.driftAfterMetadataFetch = 1;
    file.driftPatch = { trashed: true };
    await enqueueImport(FILE_ID);
    const summary = await run();
    expect(summary.retried).toBe(1);
    expect(queue()[0].last_error).toBe("DRIVE_FILE_CHANGED_RETRY");
    expect(documents()).toEqual([]);
  });

  it("el md5Checksum reportado cambia entre M1 y M2 -> retry", async () => {
    const file = driveFiles.get(FILE_ID)!;
    file.driftAfterMetadataFetch = 1;
    file.driftPatch = { md5Checksum: "1".repeat(32) };
    await enqueueImport(FILE_ID);
    const summary = await run();
    expect(summary.retried).toBe(1);
    expect(queue()[0].last_error).toBe("DRIVE_FILE_CHANGED_RETRY");
  });
});

// ── Storage: idempotencia ante crash (Sección 24/25/45) ───────────────────
describe("Fase 8E — Storage: escritura idempotente ante reintentos", () => {
  it("primera subida crea el objeto", async () => {
    await enqueueImport(FILE_ID);
    await run();
    expect(storageObjects.size).toBe(1);
  });

  it("Sección 25 (crash scenario): retry tras un crash entre Storage y DB reutiliza el mismo blob, sin segunda copia", async () => {
    await enqueueImport(FILE_ID);

    // Primer intento: la subida a Storage se completa con normalidad, pero
    // simulamos que el proceso murió justo antes de confirmar la
    // finalización en la base de datos (un problema ambiental transitorio
    // -- p. ej. la conexión a PostgreSQL se cortó en ese instante).
    forceFinalizeErrorOnce = "connection reset by peer";
    const first = await run();
    expect(first.retried).toBe(1);
    expect(queue()[0].last_error).toBe("connection reset by peer");
    expect(storageObjects.size).toBe(1); // el blob ya quedó escrito
    expect(documents()).toEqual([]); // pero la finalización NO se aplicó

    // Reintento: reutiliza el MISMO target_document_id/storage_path del
    // payload ya reservado -- por eso Storage no recibe un segundo blob.
    queue()[0].status = "pending";
    queue()[0].available_at = new Date(0).toISOString();
    const second = await run();
    expect(second.completed).toBe(1);
    expect(storageObjects.size).toBe(1); // sigue siendo UN solo blob
    expect(documents()).toHaveLength(1);
  });

  it("objeto ya existe con hash DISTINTO -> STORAGE_IMPORT_IDENTITY_CONFLICT, nunca overwrite", async () => {
    await enqueueImport(FILE_ID);
    const reservedPath = `google-drive/${CLIENT_ID}/aaaaaaaa-1111-1111-1111-111111111111_contrato.pdf`;
    queue()[0].payload = {
      target_document_id: "aaaaaaaa-1111-1111-1111-111111111111",
      storage_path: reservedPath,
    };
    storageObjects.set(reservedPath, new Uint8Array([9, 9, 9]));
    const summary = await run();
    expect(summary.failed).toBe(1);
    expect(queue()[0].last_error).toBe("STORAGE_IMPORT_IDENTITY_CONFLICT");
    // El objeto ajeno no se tocó.
    expect(storageObjects.get(reservedPath)).toEqual(new Uint8Array([9, 9, 9]));
  });

  it("Fase 8E.1 Sección 12 (OBLIGATORIO): un objeto REUTILIZADO de un crash previo también se limpia si pierde la carrera permanentemente", async () => {
    // El worker anterior alcanzó a subir el blob y murió antes de llegar a
    // la RPC. ESTE intento reutiliza el objeto (hash coincide -> "reused",
    // no "written"), pero para cuando llega a finalizar, otro worker YA
    // ganó la carrera de forma permanente. La condición de limpieza no
    // puede depender de si fuimos nosotros quienes creamos el objeto: debe
    // limpiarse igual que un "written" huérfano.
    await enqueueImport(FILE_ID);
    const reservedTarget = "aaaaaaaa-3333-3333-3333-333333333333";
    const reservedPath = `google-drive/${CLIENT_ID}/${reservedTarget}_contrato.pdf`;
    queue()[0].payload = { target_document_id: reservedTarget, storage_path: reservedPath };
    storageObjects.set(reservedPath, PDF_BYTES); // mismo contenido -> hash coincide -> "reused"

    // El target_document_id que este worker reservó ya quedó ocupado por un
    // documento SIN RELACIÓN (colisión de identidad) con un storage_path
    // DISTINTO al nuestro -- la RPC rechaza con IMPORT_IDENTITY_CONFLICT y
    // nuestro storage_path reservado no queda referenciado por nadie.
    tables.documents = [
      { id: reservedTarget, client_id: CLIENT_ID, storage_path: "otros/no-relacionado.pdf" },
    ];

    const summary = await run();
    expect(summary.completed).toBe(1);
    // Nadie en `documents` referencia reservedPath (el ganador tiene otro
    // path): el objeto reutilizado queda huérfano y se limpia.
    expect(storageObjects.has(reservedPath)).toBe(false);
    expect(storageRemoveCalls).toContain(reservedPath);
  });
});

// ── reserva estable (Sección 22/23) ───────────────────────────────────────
describe("Fase 8E — reserva de target_document_id/storage_path", () => {
  it("se persiste en el payload de la cola en el primer intento", async () => {
    await enqueueImport(FILE_ID);
    await run();
    expect(queue()[0].payload).toMatchObject({
      target_document_id: expect.any(String),
      storage_path: expect.stringContaining(CLIENT_ID),
    });
  });
});

// ── finalize: idempotencia y concurrencia lógica (Sección 28/34/46) ───────
describe("Fase 8E — finalización: idempotencia", () => {
  it("repetir el mismo import (mismo drive_file_id, mismo target) es idempotente", async () => {
    await enqueueImport(FILE_ID);
    await run();
    expect(documents()).toHaveLength(1);

    // Reencolar el mismo archivo. Como ya está mapeado, el paso 0 lo
    // resuelve como no-op sin ni siquiera tocar archivos de Drive de nuevo
    // (el refresco del access token sí ocurre siempre).
    await enqueueImport(FILE_ID);
    driveCalls = [];
    const summary = await run();
    expect(summary.completed).toBe(1);
    expect(documents()).toHaveLength(1);
    expect(driveCalls.filter((c) => c.url.includes("/drive/v3/files"))).toEqual([]);
  });

  it("Sección 34: dos jobs para el MISMO drive_file_id con reservas DISTINTAS -> nunca 2 documentos", async () => {
    // Simula que el dedupe de la cola no evitó dos trabajos lógicos (p. ej.
    // un test que fuerza el escenario): cada uno reserva su propio
    // target_document_id de forma independiente.
    queue().push({
      id: 1,
      operation: "import_drive_file",
      connection_id: CONNECTION_ID,
      client_id: null,
      document_id: null,
      drive_file_id: FILE_ID,
      status: "pending",
      attempt_count: 0,
      payload: {},
      available_at: new Date(0).toISOString(),
    });
    queue().push({
      id: 2,
      operation: "import_drive_file",
      connection_id: CONNECTION_ID,
      client_id: null,
      document_id: null,
      drive_file_id: FILE_ID,
      status: "pending",
      attempt_count: 0,
      payload: {},
      available_at: new Date(0).toISOString(),
    });
    const summary = await run();
    expect(documents()).toHaveLength(1);
    expect(documentMappings()).toHaveLength(1);
    // Una completa, la otra se resuelve como "ya importado" (completed) sin
    // crear un segundo documento. El procesador de la cola es SECUENCIAL
    // (un job se completa del todo antes de que empiece el siguiente), así
    // que el segundo job encuentra el mapping YA insertado por el primero
    // en su propio paso 0 y nunca llega a tocar Storage -- por eso, en ESTE
    // escenario particular, no hay nada que compensar. La prueba de
    // compensación real (Storage escrito por AMBOS antes de que uno pierda
    // en la RPC) está en la Sección 15 más abajo, forzada explícitamente
    // porque este runner no puede reproducir la interleaving genuina de dos
    // procesos concurrentes.
    expect(summary.completed).toBe(2);
    expect(summary.failed).toBe(0);
    expect(storageObjects.size).toBe(1);
    expect(storageRemoveCalls).toEqual([]);
  });

  it("Fase 8E.1 Sección 15 (OBLIGATORIO): ALREADY_IMPORTED tras escribir a Storage -> se compensa el path perdedor, el ganador queda intacto", async () => {
    // El ganador ya existe -- creado por OTRO worker, fuera de esta
    // ejecución. Este worker no lo ve en su propio paso 0 (nada mapea
    // FILE_ID todavía en `google_drive_document_files`): llega a escribir
    // SU PROPIO blob en Storage con normalidad, y solo al finalizar se
    // entera de que perdió la carrera -- exactamente el escenario de dos
    // workers reales llegando a Storage casi al mismo tiempo (Sección 15).
    const winnerPath = `google-drive/${CLIENT_ID}/winner-doc_contrato.pdf`;
    tables.documents = [{ id: "winner-doc", client_id: CLIENT_ID, storage_path: winnerPath }];
    storageObjects.set(winnerPath, PDF_BYTES);

    await enqueueImport(FILE_ID);
    forceFinalizeErrorOnce = "DRIVE_FILE_ALREADY_IMPORTED";
    const summary = await run();

    expect(summary.completed).toBe(1);
    expect(documents()).toHaveLength(1); // solo el ganador preexistente
    expect(documents()[0].id).toBe("winner-doc");
    expect(documentMappings()).toEqual([]); // esta ejecución no creó ningún mapping

    const reservedPayload = queue()[0].payload as { storage_path: string };
    const ourPath = reservedPayload.storage_path;
    expect(ourPath).not.toBe(winnerPath);
    expect(storageObjects.has(winnerPath)).toBe(true); // el ganador, intacto
    expect(storageObjects.has(ourPath)).toBe(false); // nuestra reserva, limpiada
    expect(storageRemoveCalls).toContain(ourPath);
    expect(storageRemoveCalls).not.toContain(winnerPath);
  });

  it("Fase 8E.1 Sección 16 (OBLIGATORIO): si un documento YA referencia el storage_path reservado, el cleanup NUNCA lo borra", async () => {
    // Escenario defensivo: por algún fallo ajeno a esta importación, ya
    // existe un documento cuyo storage_path coincide exactamente con el que
    // este worker reservó. La RPC rechaza la finalización de forma
    // PERMANENTE (identidad ya ocupada); el cleanup debe consultar la base
    // de datos ANTES de borrar, nunca asumir que "esta reserva es huérfana"
    // solo porque perdió la carrera.
    await enqueueImport(FILE_ID);
    const reservedTarget = "aaaaaaaa-2222-2222-2222-222222222222";
    const reservedPath = `google-drive/${CLIENT_ID}/${reservedTarget}_contrato.pdf`;
    queue()[0].payload = { target_document_id: reservedTarget, storage_path: reservedPath };
    tables.documents = [{ id: reservedTarget, client_id: CLIENT_ID, storage_path: reservedPath }];

    const summary = await run();
    expect(summary.completed).toBe(1);
    expect(storageObjects.has(reservedPath)).toBe(true);
    expect(storageRemoveCalls).toEqual([]);
  });
});

// ── provenance (Sección 29/47) ─────────────────────────────────────────────
describe("Fase 8E — procedencia real de un documento inbound", () => {
  it("source_type/source_provider reflejan Drive; external_file_id es el drive_file_id real", async () => {
    await enqueueImport(FILE_ID);
    await run();
    expect(documents()[0]).toMatchObject({
      source_type: "google_drive",
      source_provider: "google_drive",
      external_file_id: FILE_ID,
      external_folder_id: FOLDER_ID,
    });
  });
});

// ── no inferencia de expediente (Sección 6/48) ────────────────────────────
describe("Fase 8E — nunca se infiere expediente ni tipo del nombre o la ruta", () => {
  it('un archivo llamado "EXPEDIENTE 123 DEMANDA.pdf" NO obtiene case_id automáticamente', async () => {
    driveFiles.get(FILE_ID)!.name = "EXPEDIENTE 123 DEMANDA.pdf";
    await enqueueImport(FILE_ID);
    await run();
    expect(documents()[0].case_id).toBeNull();
    expect(documents()[0].type).toBe("Otros");
  });
});

// ── atribución honesta (Sección 5/49) ─────────────────────────────────────
describe("Fase 8E — atribución: nunca un usuario ficticio", () => {
  it("created_by queda NULL: ninguna sesión interactiva subió este documento", async () => {
    await enqueueImport(FILE_ID);
    await run();
    expect(documents()[0].created_by).toBeNull();
  });
});
