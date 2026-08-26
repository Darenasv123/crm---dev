import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 8D — CRM -> Drive: productores, workers y cola.
 *
 * Supabase y Google están simulados en memoria. Estas pruebas nunca salen a
 * internet, nunca tocan una cuenta de Drive real y nunca escriben en una
 * base de datos.
 */

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), createClient: vi.fn() }));
vi.mock("@/lib/auth-server", () => ({ requireUser: mocks.requireUser }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

import { setServerRuntimeEnv } from "@/lib/server-runtime-env";
import { encryptToken } from "@/lib/google-drive/google-drive.server";
import {
  driveDedupeKey,
  driveRetryDelayMs,
  GOOGLE_DRIVE_MAX_ATTEMPTS,
  GOOGLE_DRIVE_TRASH_GRACE_MS,
  prepareDocumentTrash,
  processGoogleDriveSyncQueue,
  requestClientFolderSync,
  requestDocumentSync,
} from "@/lib/google-drive/drive-sync.server";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const ROOT_ID = "ROOT_CLIENTES";
const CONNECTION_ID = "11111111-1111-1111-1111-111111111111";
const ADMIN_ID = "22222222-2222-2222-2222-222222222222";
const CLIENT_ID = "33333333-3333-3333-3333-333333333333";
const DOCUMENT_ID = "44444444-4444-4444-4444-444444444444";

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

// ── Drive falso ──────────────────────────────────────────────────────────
type FakeFile = {
  id: string;
  name: string;
  mimeType?: string;
  parents?: string[];
  trashed?: boolean;
  appProperties?: Record<string, string>;
  content?: Uint8Array;
};

let driveFiles: FakeFile[];
let driveCalls: Array<{ url: string; method: string; body?: unknown }>;
let generatedIds: string[];
let nextGeneratedId: number;
/** Fuerza un status HTTP en la siguiente operación indicada. */
let forceStatus: Record<string, number>;

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function fileResource(file: FakeFile) {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType ?? FOLDER_MIME,
    parents: file.parents ?? [],
    trashed: file.trashed ?? false,
    appProperties: file.appProperties ?? {},
    modifiedTime: "2026-08-25T10:00:00.000Z",
    version: "7",
    md5Checksum: "abc123",
    webViewLink: `https://drive.example/${file.id}`,
  };
}

function fakeFetch(url: string, init?: RequestInit) {
  const method = (init?.method ?? "GET").toUpperCase();
  const body = init?.body;
  driveCalls.push({ url, method, body });

  if (url.startsWith("https://oauth2.googleapis.com/token")) {
    return jsonResponse({ access_token: "fresh-token", expires_in: 3600 });
  }

  if (url.includes("/files/generateIds")) {
    const count = Number(new URL(url).searchParams.get("count") ?? "1");
    const ids = Array.from({ length: count }, () => `GEN_${++nextGeneratedId}`);
    generatedIds.push(...ids);
    return jsonResponse({ ids });
  }

  // Subida (multipart o resumable init)
  if (url.startsWith("https://www.googleapis.com/upload/drive/v3/files")) {
    if (forceStatus.upload) {
      const status = forceStatus.upload;
      delete forceStatus.upload;
      return jsonResponse({ error: { message: "upload-fail" } }, status);
    }
    if (url.includes("uploadType=resumable")) {
      return jsonResponse({}, 200, { location: "https://upload.example/session" });
    }
    const metadata = parseMultipartMetadata(body);
    const created: FakeFile = {
      id: String(metadata.id),
      name: String(metadata.name),
      mimeType: String(metadata.mimeType ?? "application/pdf"),
      parents: metadata.parents as string[],
      appProperties: metadata.appProperties as Record<string, string>,
    };
    driveFiles.push(created);
    return jsonResponse(fileResource(created));
  }
  if (url.startsWith("https://upload.example/session")) {
    const created: FakeFile = { id: "RESUMABLE", name: "grande.pdf", mimeType: "application/pdf" };
    driveFiles.push(created);
    return jsonResponse(fileResource(created));
  }

  // files/{id}
  const single = /\/drive\/v3\/files\/([^?]+)/.exec(url);
  if (single) {
    const id = decodeURIComponent(single[1]);
    const file = driveFiles.find((f) => f.id === id);
    if (method === "PATCH") {
      if (!file) return jsonResponse({}, 404);
      const patch = JSON.parse(String(body)) as { name?: string; trashed?: boolean };
      if (patch.name !== undefined) file.name = patch.name;
      if (patch.trashed !== undefined) file.trashed = patch.trashed;
      return jsonResponse(fileResource(file));
    }
    if (!file) return jsonResponse({ error: { message: "not found" } }, 404);
    return jsonResponse(fileResource(file));
  }

  // files (create folder o list)
  if (method === "POST") {
    if (forceStatus.createFolder) {
      const status = forceStatus.createFolder;
      delete forceStatus.createFolder;
      return jsonResponse({ error: { message: "conflict" } }, status);
    }
    const metadata = JSON.parse(String(body)) as Record<string, unknown>;
    const created: FakeFile = {
      id: String(metadata.id),
      name: String(metadata.name),
      mimeType: FOLDER_MIME,
      parents: metadata.parents as string[],
      appProperties: metadata.appProperties as Record<string, string>,
    };
    driveFiles.push(created);
    return jsonResponse(fileResource(created));
  }

  const query = new URL(url).searchParams.get("q") ?? "";
  const parentId = /^'(.*?)' in parents/.exec(query)?.[1] ?? "";
  const children = driveFiles.filter(
    (f) =>
      (f.parents ?? []).includes(parentId) &&
      (f.mimeType ?? FOLDER_MIME) === FOLDER_MIME &&
      !f.trashed,
  );
  return jsonResponse({ files: children.map(fileResource) });
}

function parseMultipartMetadata(body: unknown): Record<string, unknown> {
  const text = new TextDecoder().decode(body as Uint8Array);
  const start = text.indexOf("{");
  const end = text.indexOf("}\r\n--");
  return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
}

// ── Supabase falso ───────────────────────────────────────────────────────
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
let storageBytes: Uint8Array;
let storageError: string | null;

function makeFakeSupabase() {
  return {
    from(table: string) {
      const filters: Array<[string, unknown, "eq" | "neq"]> = [];
      let op: "select" | "insert" | "update" | "delete" = "select";
      let payload: Row | null = null;
      const builder: Record<string, unknown> = {};
      const rows = () =>
        (tables[table] ?? []).filter((row) =>
          filters.every(([col, val, kind]) =>
            kind === "neq" ? row[col] !== val : row[col] === val,
          ),
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
          const inserted = { id: list.length + 1, status: "pending", attempt_count: 0, ...payload };
          list.push(inserted);
          return { data: inserted, error: null };
        }
        if (op === "update") {
          for (const row of rows()) Object.assign(row, payload);
          return { data: null, error: null };
        }
        if (op === "delete") {
          tables[table] = (tables[table] ?? []).filter((row) => !rows().includes(row));
          return { data: null, error: null };
        }
        return { data: rows(), error: null };
      }

      Object.assign(builder, {
        select: () => builder,
        order: () => builder,
        eq: (col: string, val: unknown) => {
          filters.push([col, val, "eq"]);
          return builder;
        },
        neq: (col: string, val: unknown) => {
          filters.push([col, val, "neq"]);
          return builder;
        },
        in: () => builder,
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
        delete: () => {
          op = "delete";
          return builder;
        },
        single: async () => {
          const result = run();
          const data = Array.isArray(result.data) ? (result.data[0] ?? null) : result.data;
          return { data, error: data ? null : { message: "not found" } };
        },
        maybeSingle: async () => {
          const result = run();
          const data = Array.isArray(result.data) ? (result.data[0] ?? null) : result.data;
          return { data, error: null };
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
        download: async (_path: string) =>
          storageError
            ? { data: null, error: { message: storageError } }
            : {
                data: {
                  arrayBuffer: async () =>
                    storageBytes.buffer.slice(
                      storageBytes.byteOffset,
                      storageBytes.byteOffset + storageBytes.byteLength,
                    ),
                } as unknown as Blob,
                error: null,
              },
      }),
    },
  };
}

/** Simula las RPC de PostgreSQL; su semántica real se valida contra Postgres. */
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

  if (name === "reserve_google_drive_created_client_folder") {
    const list = (tables.google_drive_client_folders ??= []);
    const existing = list.find((row) => row.client_id === args.p_client_id);
    if (existing) {
      return {
        data: { driveFolderId: existing.drive_folder_id, reserved: false },
        error: null,
      };
    }
    list.push({
      connection_id: args.p_connection_id,
      client_id: args.p_client_id,
      drive_folder_id: args.p_reserved_folder_id,
      drive_folder_name_snapshot: args.p_folder_name,
      match_type: "created",
      sync_status: "pending",
    });
    return { data: { driveFolderId: args.p_reserved_folder_id, reserved: true }, error: null };
  }

  if (name === "finalize_google_drive_client_folder") {
    const row = (tables.google_drive_client_folders ?? []).find(
      (r) => r.client_id === args.p_client_id && r.drive_folder_id === args.p_drive_folder_id,
    );
    if (!row) return { data: null, error: { message: "CLIENT_FOLDER_MAPPING_NOT_FOUND" } };
    row.sync_status = args.p_sync_error ? "error" : "synced";
    row.sync_error = args.p_sync_error ?? null;
    if (args.p_folder_name) row.drive_folder_name_snapshot = args.p_folder_name;
    return { data: { updated: 1 }, error: null };
  }

  if (name === "reserve_google_drive_document_file") {
    const list = (tables.google_drive_document_files ??= []);
    const existing = list.find((row) => row.document_id === args.p_document_id);
    if (existing)
      return { data: { driveFileId: existing.drive_file_id, reserved: false }, error: null };
    list.push({
      document_id: args.p_document_id,
      connection_id: args.p_connection_id,
      drive_file_id: args.p_reserved_file_id,
      drive_parent_id: args.p_expected_parent_id,
      sync_status: "pending",
    });
    return { data: { driveFileId: args.p_reserved_file_id, reserved: true }, error: null };
  }

  if (name === "finalize_google_drive_document_file") {
    const row = (tables.google_drive_document_files ?? []).find(
      (r) => r.document_id === args.p_document_id && r.drive_file_id === args.p_drive_file_id,
    );
    if (!row) return { data: null, error: { message: "DOCUMENT_FILE_MAPPING_NOT_FOUND" } };
    row.sync_status = args.p_sync_error ? "error" : "synced";
    row.last_synced_file_name = args.p_file_name ?? row.last_synced_file_name;
    row.last_synced_content_hash = args.p_content_hash ?? row.last_synced_content_hash;
    row.last_synced_drive_md5_checksum = args.p_drive_md5 ?? null;
    return { data: { updated: 1 }, error: null };
  }

  return { data: null, error: { message: `unknown rpc ${name}` } };
}

// ── setup ────────────────────────────────────────────────────────────────
const req = () =>
  new Request("https://crm.example/api/google-drive/sync-document", {
    headers: { authorization: "Bearer session" },
  });

// El ciphertext debe ser real: accessTokenForDrive lo descifra de verdad
// con AES-GCM, igual que en produccion.
let encryptedRefreshToken: string;

function connectionRow(overrides: Row = {}): Row {
  return {
    id: CONNECTION_ID,
    connected_by: ADMIN_ID,
    google_account_email: "estudio@example.com",
    encrypted_refresh_token: encryptedRefreshToken,
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

beforeEach(async () => {
  setServerRuntimeEnv(ENV);
  encryptedRefreshToken = await encryptToken("refresh-token-de-pruebas");
  driveCalls = [];
  generatedIds = [];
  nextGeneratedId = 0;
  forceStatus = {};
  rpcCalls = [];
  storageError = null;
  storageBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xfe]);
  driveFiles = [{ id: ROOT_ID, name: "Clientes", parents: ["root"] }];
  tables = {
    profiles: [{ id: ADMIN_ID, role: "Administrador", status: "Activo" }],
    clients: [{ id: CLIENT_ID, name: "Ana Torres" }],
    documents: [
      {
        id: DOCUMENT_ID,
        name: "contrato.pdf",
        client_id: CLIENT_ID,
        storage_path: "1_contrato.pdf",
        mime_type: "application/pdf",
        file_size: 7,
      },
    ],
    google_drive_connections: [connectionRow()],
    google_drive_client_folders: [],
    google_drive_document_files: [],
    google_drive_sync_queue: [],
  };
  mocks.requireUser.mockResolvedValue({ id: ADMIN_ID });
  mocks.createClient.mockImplementation(() => makeFakeSupabase());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => fakeFetch(String(url), init)),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  setServerRuntimeEnv({});
});

const queue = () => tables.google_drive_sync_queue;
const folderMapping = () => tables.google_drive_client_folders[0];
const documentMapping = () => tables.google_drive_document_files[0];

// ── productores: no bloquean nunca ───────────────────────────────────────
describe("Fase 8D — los productores nunca convierten Drive en obligatorio", () => {
  it("Drive sin configurar: no-op honesto, sin encolar ni fallar", async () => {
    setServerRuntimeEnv({ ...ENV, GOOGLE_DRIVE_CLIENT_ID: "" });
    const result = await requestDocumentSync(req(), DOCUMENT_ID);
    expect(result).toEqual({ queued: false, reason: "not_configured" });
    expect(queue()).toEqual([]);
  });

  it("Drive desconectado: no-op honesto", async () => {
    tables.google_drive_connections = [connectionRow({ status: "disconnected" })];
    expect(await requestDocumentSync(req(), DOCUMENT_ID)).toEqual({
      queued: false,
      reason: "not_connected",
    });
  });

  it("sin carpeta raíz configurada: no-op honesto", async () => {
    tables.google_drive_connections = [connectionRow({ root_folder_id: null })];
    expect(await requestClientFolderSync(req(), CLIENT_ID)).toEqual({
      queued: false,
      reason: "root_not_configured",
    });
  });

  it("un documento sin cliente no se sincroniza, pero no es un error", async () => {
    tables.documents[0].client_id = null;
    expect(await requestDocumentSync(req(), DOCUMENT_ID)).toEqual({
      queued: false,
      reason: "no_client",
    });
  });

  it("ningún productor llama a Google", async () => {
    await requestClientFolderSync(req(), CLIENT_ID);
    await requestDocumentSync(req(), DOCUMENT_ID);
    await prepareDocumentTrash(req(), DOCUMENT_ID);
    const googleCalls = driveCalls.filter((c) => c.url.includes("googleapis.com"));
    expect(googleCalls).toEqual([]);
  });
});

describe("Fase 8D — permisos reales de cada productor", () => {
  it("Personal puede pedir sincronizar un documento (puede subirlos)", async () => {
    tables.profiles[0].role = "Personal";
    const result = await requestDocumentSync(req(), DOCUMENT_ID);
    expect(result.queued).toBe(true);
  });

  it("Personal NO puede preparar la papelera: no puede eliminar documentos", async () => {
    tables.profiles[0].role = "Personal";
    tables.google_drive_document_files = [
      { document_id: DOCUMENT_ID, drive_file_id: "F_DOC", sync_status: "synced" },
    ];
    await expect(prepareDocumentTrash(req(), DOCUMENT_ID)).rejects.toThrow(/permiso/i);
  });

  it("un perfil inactivo es rechazado", async () => {
    tables.profiles[0].status = "Inactivo";
    await expect(requestDocumentSync(req(), DOCUMENT_ID)).rejects.toThrow(/permiso/i);
  });
});

describe("Fase 8D — encolado y dedupe", () => {
  it("crear un cliente encola ensure_client_folder", async () => {
    const result = await requestClientFolderSync(req(), CLIENT_ID);
    expect(result).toEqual({ queued: true, operation: "ensure_client_folder" });
    expect(queue()[0]).toMatchObject({
      operation: "ensure_client_folder",
      client_id: CLIENT_ID,
      dedupe_key: driveDedupeKey("ensure_client_folder", CONNECTION_ID, CLIENT_ID),
    });
  });

  it("pedirlo dos veces no crea trabajo duplicado", async () => {
    await requestClientFolderSync(req(), CLIENT_ID);
    await requestClientFolderSync(req(), CLIENT_ID);
    expect(queue()).toHaveLength(1);
  });

  it("un documento nuevo sin carpeta encola ensure + upload", async () => {
    await requestDocumentSync(req(), DOCUMENT_ID);
    expect(queue().map((j) => j.operation)).toEqual(["ensure_client_folder", "upload_document"]);
  });

  it("si la carpeta ya está lista solo encola el upload", async () => {
    tables.google_drive_client_folders = [
      { client_id: CLIENT_ID, drive_folder_id: "F_ANA", sync_status: "synced" },
    ];
    await requestDocumentSync(req(), DOCUMENT_ID);
    expect(queue().map((j) => j.operation)).toEqual(["upload_document"]);
  });

  it("el retraso de reintento crece de forma acotada", () => {
    expect(driveRetryDelayMs(1)).toBe(30_000);
    expect(driveRetryDelayMs(2)).toBe(120_000);
    expect(driveRetryDelayMs(99)).toBe(1_800_000);
  });
});

// ── ensure_client_folder ─────────────────────────────────────────────────
describe("Fase 8D.1 — Clientes homónimos: auto-crear carpeta no es seguro", () => {
  const CLIENT_B_ID = "55555555-5555-5555-5555-555555555555";

  function enqueueEnsure(clientId: string) {
    tables.google_drive_sync_queue.push({
      id: tables.google_drive_sync_queue.length + 1,
      operation: "ensure_client_folder",
      connection_id: CONNECTION_ID,
      client_id: clientId,
      document_id: null,
      drive_file_id: null,
      status: "pending",
      attempt_count: 0,
      available_at: new Date(0).toISOString(),
    });
  }

  it("A: dos Clientes con el mismo nombre exacto -> revisión requerida, sin generateIds", async () => {
    tables.clients.push({ id: CLIENT_B_ID, name: "Ana Torres" });
    enqueueEnsure(CLIENT_ID);
    const summary = await processGoogleDriveSyncQueue();
    expect(summary.failed).toBe(1);
    expect(queue()[0].last_error).toBe("CLIENT_NAME_REVIEW_REQUIRED");
    expect(generatedIds).toEqual([]);
    expect(tables.google_drive_client_folders).toEqual([]);
  });

  it("B: acentos, mayúsculas y espacios también cuentan como colisión", async () => {
    tables.clients[0].name = "José  Pérez";
    tables.clients.push({ id: CLIENT_B_ID, name: "JOSE PEREZ" });
    enqueueEnsure(CLIENT_ID);
    const summary = await processGoogleDriveSyncQueue();
    expect(summary.failed).toBe(1);
    expect(queue()[0].last_error).toBe("CLIENT_NAME_REVIEW_REQUIRED");
    expect(generatedIds).toEqual([]);
  });

  it("C: un Cliente sin homónimos sigue creando su carpeta automáticamente (sin cambios)", async () => {
    enqueueEnsure(CLIENT_ID);
    const summary = await processGoogleDriveSyncQueue();
    expect(summary.completed).toBe(1);
    expect(folderMapping()?.sync_status).toBe("synced");
  });

  it("D: una reserva/mapping previo se reconcilia igual aunque aparezca un homónimo DESPUÉS", async () => {
    tables.google_drive_client_folders = [
      { client_id: CLIENT_ID, drive_folder_id: "RESERVED_PREV", sync_status: "pending" },
    ];
    driveFiles.push({ id: "RESERVED_PREV", name: "Ana Torres", parents: [ROOT_ID] });
    tables.clients.push({ id: CLIENT_B_ID, name: "Ana Torres" });
    enqueueEnsure(CLIENT_ID);
    const summary = await processGoogleDriveSyncQueue();
    expect(summary.completed).toBe(1);
    expect(folderMapping()?.sync_status).toBe("synced");
    // Nunca se pidió un ID nuevo: la reserva existente se reconcilia, no se
    // abandona por la aparición tardía de un homónimo.
    expect(generatedIds).toEqual([]);
  });

  it("E1: A se procesa antes que B -> ninguno de los dos crea nada", async () => {
    tables.clients.push({ id: CLIENT_B_ID, name: "ana torres" });
    enqueueEnsure(CLIENT_ID);
    enqueueEnsure(CLIENT_B_ID);
    const summary = await processGoogleDriveSyncQueue();
    expect(summary.completed).toBe(0);
    expect(summary.failed).toBe(2);
    expect(queue().every((j) => j.last_error === "CLIENT_NAME_REVIEW_REQUIRED")).toBe(true);
    expect(generatedIds).toEqual([]);
    expect(tables.google_drive_client_folders).toEqual([]);
  });

  it("E2: B se procesa antes que A -> el resultado es el mismo, el orden no importa", async () => {
    tables.clients.push({ id: CLIENT_B_ID, name: "ANA TORRES" });
    enqueueEnsure(CLIENT_B_ID);
    enqueueEnsure(CLIENT_ID);
    const summary = await processGoogleDriveSyncQueue();
    expect(summary.completed).toBe(0);
    expect(summary.failed).toBe(2);
    expect(queue().every((j) => j.last_error === "CLIENT_NAME_REVIEW_REQUIRED")).toBe(true);
    expect(generatedIds).toEqual([]);
    expect(tables.google_drive_client_folders).toEqual([]);
  });

  it("una colisión de nombre no impide luego resolver: quitar al homónimo permite crear", async () => {
    tables.clients.push({ id: CLIENT_B_ID, name: "Ana Torres" });
    enqueueEnsure(CLIENT_ID);
    await processGoogleDriveSyncQueue();
    expect(queue()[0].last_error).toBe("CLIENT_NAME_REVIEW_REQUIRED");

    // El Administrador resuelve la colisión (por ejemplo, corrigiendo el
    // nombre de uno de los dos en el CRM) y el trabajo se reencola.
    tables.clients = tables.clients.filter((c) => c.id !== CLIENT_B_ID);
    queue()[0].status = "pending";
    queue()[0].available_at = new Date(0).toISOString();

    const summary = await processGoogleDriveSyncQueue();
    expect(summary.completed).toBe(1);
    expect(folderMapping()?.sync_status).toBe("synced");
  });
});

describe("Fase 8D — carpeta automática de Cliente", () => {
  async function runQueue() {
    return processGoogleDriveSyncQueue();
  }

  it("sin candidatas: reserva un ID, crea la carpeta y queda sincronizada", async () => {
    await requestClientFolderSync(req(), CLIENT_ID);
    const summary = await runQueue();
    expect(summary.completed).toBe(1);
    expect(folderMapping()).toMatchObject({
      client_id: CLIENT_ID,
      match_type: "created",
      sync_status: "synced",
    });
    const created = driveFiles.find((f) => f.id === generatedIds[0]);
    expect(created?.appProperties).toMatchObject({
      crm_entity: "client_folder",
      crm_client_id: CLIENT_ID,
    });
    expect(created?.parents).toEqual([ROOT_ID]);
  });

  it("si ya existe una carpeta con nombre idéntico NO crea otra: pide revisión", async () => {
    driveFiles.push({ id: "F_MANUAL", name: "Ana Torres", parents: [ROOT_ID] });
    await requestClientFolderSync(req(), CLIENT_ID);
    const summary = await runQueue();
    expect(summary.failed).toBe(1);
    expect(queue()[0].last_error).toBe("CLIENT_FOLDER_REVIEW_REQUIRED");
    expect(tables.google_drive_client_folders).toEqual([]);
    expect(generatedIds).toEqual([]);
  });

  it("un nombre equivalente (mayúsculas/acentos) también pide revisión", async () => {
    driveFiles.push({ id: "F_MANUAL", name: "ANA TORRES", parents: [ROOT_ID] });
    await requestClientFolderSync(req(), CLIENT_ID);
    await runQueue();
    expect(queue()[0].last_error).toBe("CLIENT_FOLDER_REVIEW_REQUIRED");
  });

  it("dos carpetas equivalentes (ambiguo) también pide revisión", async () => {
    driveFiles.push({ id: "F_A", name: "ana torres", parents: [ROOT_ID] });
    driveFiles.push({ id: "F_B", name: "ANA TORRES", parents: [ROOT_ID] });
    await requestClientFolderSync(req(), CLIENT_ID);
    await runQueue();
    expect(queue()[0].last_error).toBe("CLIENT_FOLDER_REVIEW_REQUIRED");
  });

  it("el cliente ya vinculado y sincronizado es un no-op", async () => {
    tables.google_drive_client_folders = [
      { client_id: CLIENT_ID, drive_folder_id: "F_ANA", sync_status: "synced" },
    ];
    queue().push({
      id: 1,
      operation: "ensure_client_folder",
      connection_id: CONNECTION_ID,
      client_id: CLIENT_ID,
      document_id: null,
      drive_file_id: null,
      status: "pending",
      attempt_count: 0,
      available_at: new Date(0).toISOString(),
    });
    const summary = await runQueue();
    expect(summary.completed).toBe(1);
    expect(generatedIds).toEqual([]);
  });

  it("un reintento reutiliza el MISMO ID reservado, nunca pide otro", async () => {
    tables.google_drive_client_folders = [
      { client_id: CLIENT_ID, drive_folder_id: "RESERVED_PREV", sync_status: "pending" },
    ];
    queue().push({
      id: 1,
      operation: "ensure_client_folder",
      connection_id: CONNECTION_ID,
      client_id: CLIENT_ID,
      document_id: null,
      drive_file_id: null,
      status: "pending",
      attempt_count: 0,
      available_at: new Date(0).toISOString(),
    });
    await runQueue();
    expect(generatedIds).toEqual([]);
    expect(driveFiles.some((f) => f.id === "RESERVED_PREV")).toBe(true);
  });

  it("un 409 sobre NUESTRA carpeta se reconcilia como éxito, sin duplicar", async () => {
    // La carpeta ya existe en Drive con nuestra identidad: el intento previo
    // sí llegó y perdimos la respuesta.
    tables.google_drive_client_folders = [
      { client_id: CLIENT_ID, drive_folder_id: "RESERVED_PREV", sync_status: "pending" },
    ];
    driveFiles.push({
      id: "RESERVED_PREV",
      name: "Ana Torres",
      parents: [ROOT_ID],
      appProperties: { crm_entity: "client_folder", crm_client_id: CLIENT_ID },
    });
    forceStatus.createFolder = 409;
    queue().push({
      id: 1,
      operation: "ensure_client_folder",
      connection_id: CONNECTION_ID,
      client_id: CLIENT_ID,
      document_id: null,
      drive_file_id: null,
      status: "pending",
      attempt_count: 0,
      available_at: new Date(0).toISOString(),
    });
    const summary = await runQueue();
    expect(summary.completed).toBe(1);
    expect(folderMapping().sync_status).toBe("synced");
    expect(driveFiles.filter((f) => f.id === "RESERVED_PREV")).toHaveLength(1);
  });

  it("un 409 sobre algo AJENO es conflicto de identidad: no crea otra carpeta", async () => {
    tables.google_drive_client_folders = [
      { client_id: CLIENT_ID, drive_folder_id: "RESERVED_PREV", sync_status: "pending" },
    ];
    driveFiles.push({
      id: "RESERVED_PREV",
      name: "Otra cosa",
      parents: [ROOT_ID],
      appProperties: { crm_entity: "client_folder", crm_client_id: "OTRO_CLIENTE" },
    });
    forceStatus.createFolder = 409;
    queue().push({
      id: 1,
      operation: "ensure_client_folder",
      connection_id: CONNECTION_ID,
      client_id: CLIENT_ID,
      document_id: null,
      drive_file_id: null,
      status: "pending",
      attempt_count: 0,
      available_at: new Date(0).toISOString(),
    });
    const summary = await runQueue();
    expect(summary.failed).toBe(1);
    expect(queue()[0].last_error).toBe("DRIVE_IDENTITY_CONFLICT");
    expect(folderMapping().sync_status).toBe("error");
    // La reserva se conserva: es lo que permite reconciliar después.
    expect(folderMapping().drive_folder_id).toBe("RESERVED_PREV");
  });
});

// ── upload_document ──────────────────────────────────────────────────────
describe("Fase 8D — subida de documentos", () => {
  function seedSyncedFolder() {
    tables.google_drive_client_folders = [
      { client_id: CLIENT_ID, drive_folder_id: "F_ANA", sync_status: "synced" },
    ];
    driveFiles.push({ id: "F_ANA", name: "Ana Torres", parents: [ROOT_ID] });
  }

  it("sube el documento y deja el mapping sincronizado con su baseline", async () => {
    seedSyncedFolder();
    await requestDocumentSync(req(), DOCUMENT_ID);
    const summary = await processGoogleDriveSyncQueue();
    expect(summary.completed).toBe(1);
    expect(documentMapping()).toMatchObject({
      document_id: DOCUMENT_ID,
      drive_parent_id: "F_ANA",
      sync_status: "synced",
      last_synced_file_name: "contrato.pdf",
    });
    // El hash del baseline es el SHA-256 local, no el checksum de Drive.
    expect(String(documentMapping().last_synced_content_hash)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("marca la identidad del documento en el archivo de Drive", async () => {
    seedSyncedFolder();
    await requestDocumentSync(req(), DOCUMENT_ID);
    await processGoogleDriveSyncQueue();
    const uploaded = driveFiles.find((f) => f.appProperties?.crm_document_id === DOCUMENT_ID);
    expect(uploaded?.appProperties).toMatchObject({
      crm_entity: "document",
      crm_document_id: DOCUMENT_ID,
      crm_client_id: CLIENT_ID,
    });
    expect(uploaded?.parents).toEqual(["F_ANA"]);
  });

  it("sin carpeta lista, el upload se reprograma en vez de fallar", async () => {
    await requestDocumentSync(req(), DOCUMENT_ID);
    // Se procesa solo el upload dejando ensure_client_folder fuera del lote.
    queue()[0].status = "completed";
    const summary = await processGoogleDriveSyncQueue();
    expect(summary.retried).toBe(1);
    expect(queue()[1].status).toBe("pending");
    expect(queue()[1].last_error).toBe("WAITING_CLIENT_FOLDER");
  });

  it("si la carpeta quedó en revisión, el upload falla sin crear nada", async () => {
    tables.google_drive_client_folders = [
      { client_id: CLIENT_ID, drive_folder_id: "F_X", sync_status: "error" },
    ];
    queue().push({
      id: 1,
      operation: "upload_document",
      connection_id: CONNECTION_ID,
      client_id: CLIENT_ID,
      document_id: DOCUMENT_ID,
      drive_file_id: null,
      status: "pending",
      attempt_count: 0,
      available_at: new Date(0).toISOString(),
    });
    const summary = await processGoogleDriveSyncQueue();
    expect(summary.failed).toBe(1);
    expect(queue()[0].last_error).toBe("CLIENT_FOLDER_REVIEW_REQUIRED");
    expect(tables.google_drive_document_files).toEqual([]);
  });

  it("un documento ya sincronizado no se vuelve a subir", async () => {
    seedSyncedFolder();
    tables.google_drive_document_files = [
      { document_id: DOCUMENT_ID, drive_file_id: "F_DOC", sync_status: "synced" },
    ];
    queue().push({
      id: 1,
      operation: "upload_document",
      connection_id: CONNECTION_ID,
      client_id: CLIENT_ID,
      document_id: DOCUMENT_ID,
      drive_file_id: null,
      status: "pending",
      attempt_count: 0,
      available_at: new Date(0).toISOString(),
    });
    const summary = await processGoogleDriveSyncQueue();
    expect(summary.completed).toBe(1);
    expect(generatedIds).toEqual([]);
  });

  it("tras una respuesta perdida, el reintento reutiliza el ID y reconcilia el 409: una sola copia", async () => {
    seedSyncedFolder();
    tables.google_drive_document_files = [
      {
        document_id: DOCUMENT_ID,
        drive_file_id: "RESERVED_DOC",
        drive_parent_id: "F_ANA",
        sync_status: "pending",
      },
    ];
    driveFiles.push({
      id: "RESERVED_DOC",
      name: "contrato.pdf",
      mimeType: "application/pdf",
      parents: ["F_ANA"],
      appProperties: {
        crm_entity: "document",
        crm_document_id: DOCUMENT_ID,
        crm_client_id: CLIENT_ID,
      },
    });
    forceStatus.upload = 409;
    queue().push({
      id: 1,
      operation: "upload_document",
      connection_id: CONNECTION_ID,
      client_id: CLIENT_ID,
      document_id: DOCUMENT_ID,
      drive_file_id: null,
      status: "pending",
      attempt_count: 0,
      available_at: new Date(0).toISOString(),
    });
    const summary = await processGoogleDriveSyncQueue();
    expect(summary.completed).toBe(1);
    expect(generatedIds).toEqual([]);
    expect(driveFiles.filter((f) => f.id === "RESERVED_DOC")).toHaveLength(1);
    expect(documentMapping().sync_status).toBe("synced");
  });

  it("un 409 sobre un archivo ajeno es conflicto de identidad", async () => {
    seedSyncedFolder();
    tables.google_drive_document_files = [
      { document_id: DOCUMENT_ID, drive_file_id: "RESERVED_DOC", sync_status: "pending" },
    ];
    driveFiles.push({
      id: "RESERVED_DOC",
      name: "ajeno.pdf",
      mimeType: "application/pdf",
      parents: ["F_ANA"],
      appProperties: { crm_entity: "document", crm_document_id: "OTRO", crm_client_id: CLIENT_ID },
    });
    forceStatus.upload = 409;
    queue().push({
      id: 1,
      operation: "upload_document",
      connection_id: CONNECTION_ID,
      client_id: CLIENT_ID,
      document_id: DOCUMENT_ID,
      drive_file_id: null,
      status: "pending",
      attempt_count: 0,
      available_at: new Date(0).toISOString(),
    });
    const summary = await processGoogleDriveSyncQueue();
    expect(summary.failed).toBe(1);
    expect(queue()[0].last_error).toBe("DRIVE_IDENTITY_CONFLICT");
  });

  it("un documento por encima del límite documental no se sube", async () => {
    seedSyncedFolder();
    storageBytes = new Uint8Array(11 * 1024 * 1024);
    await requestDocumentSync(req(), DOCUMENT_ID);
    const summary = await processGoogleDriveSyncQueue();
    expect(summary.completed).toBe(0);
    // La carpeta ya estaba lista, asi que el unico trabajo encolado es el upload.
    expect(String(queue()[0].last_error)).toMatch(/10 MB/);
  });

  it("los bytes llegan intactos a Drive (contenido binario no UTF-8)", async () => {
    seedSyncedFolder();
    await requestDocumentSync(req(), DOCUMENT_ID);
    await processGoogleDriveSyncQueue();
    const uploadCall = driveCalls.find((c) => c.url.includes("uploadType=multipart"));
    const raw = uploadCall?.body as Uint8Array;
    let found = false;
    for (let i = 0; i + storageBytes.length <= raw.length; i += 1) {
      if (storageBytes.every((byte, offset) => raw[i + offset] === byte)) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });
});

// ── rename ───────────────────────────────────────────────────────────────
describe("Fase 8D — renombrado (el CRM sí permite cambiar el nombre)", () => {
  function seedSynced() {
    tables.google_drive_client_folders = [
      { client_id: CLIENT_ID, drive_folder_id: "F_ANA", sync_status: "synced" },
    ];
    tables.google_drive_document_files = [
      {
        document_id: DOCUMENT_ID,
        drive_file_id: "F_DOC",
        drive_parent_id: "F_ANA",
        sync_status: "synced",
        last_synced_file_name: "contrato.pdf",
      },
    ];
    driveFiles.push({
      id: "F_DOC",
      name: "contrato.pdf",
      mimeType: "application/pdf",
      parents: ["F_ANA"],
    });
  }

  it("cambiar el nombre en el CRM encola rename_document", async () => {
    seedSynced();
    tables.documents[0].name = "contrato-firmado.pdf";
    const result = await requestDocumentSync(req(), DOCUMENT_ID);
    expect(result).toEqual({ queued: true, operation: "rename_document" });
  });

  it("sin cambio de nombre no encola nada", async () => {
    seedSynced();
    expect(await requestDocumentSync(req(), DOCUMENT_ID)).toEqual({
      queued: false,
      reason: "already_synced",
    });
  });

  it("el worker renombra el MISMO archivo y no cambia su carpeta", async () => {
    seedSynced();
    tables.documents[0].name = "contrato-firmado.pdf";
    await requestDocumentSync(req(), DOCUMENT_ID);
    const summary = await processGoogleDriveSyncQueue();
    expect(summary.completed).toBe(1);
    const file = driveFiles.find((f) => f.id === "F_DOC");
    expect(file?.name).toBe("contrato-firmado.pdf");
    expect(file?.parents).toEqual(["F_ANA"]);
    expect(documentMapping().last_synced_file_name).toBe("contrato-firmado.pdf");
    expect(generatedIds).toEqual([]);
  });

  it("reintentar un renombrado ya aplicado es idempotente", async () => {
    seedSynced();
    queue().push({
      id: 1,
      operation: "rename_document",
      connection_id: CONNECTION_ID,
      client_id: CLIENT_ID,
      document_id: DOCUMENT_ID,
      drive_file_id: "F_DOC",
      status: "pending",
      attempt_count: 0,
      available_at: new Date(0).toISOString(),
    });
    const summary = await processGoogleDriveSyncQueue();
    expect(summary.completed).toBe(1);
    expect(driveCalls.some((c) => c.method === "PATCH")).toBe(false);
  });
});

// ── trash ────────────────────────────────────────────────────────────────
describe("Fase 8D — papelera segura", () => {
  function seedLinkedDocument() {
    tables.google_drive_document_files = [
      { document_id: DOCUMENT_ID, drive_file_id: "F_DOC", sync_status: "synced" },
    ];
    driveFiles.push({
      id: "F_DOC",
      name: "contrato.pdf",
      mimeType: "application/pdf",
      parents: ["F_ANA"],
    });
  }

  it("encola con margen: el trabajo no está disponible de inmediato", async () => {
    seedLinkedDocument();
    const before = Date.now();
    await prepareDocumentTrash(req(), DOCUMENT_ID);
    const availableAt = new Date(String(queue()[0].available_at)).getTime();
    expect(availableAt).toBeGreaterThanOrEqual(before + GOOGLE_DRIVE_TRASH_GRACE_MS - 1000);
  });

  it("CASO A: el borrado del CRM se consumó -> se mueve a la papelera", async () => {
    seedLinkedDocument();
    await prepareDocumentTrash(req(), DOCUMENT_ID);
    // El DELETE del CRM ocurre: la FK ON DELETE SET NULL deja document_id en
    // NULL y el mapping desaparece.
    tables.documents = [];
    tables.google_drive_document_files = [];
    queue()[0].document_id = null;
    queue()[0].available_at = new Date(0).toISOString();

    const summary = await processGoogleDriveSyncQueue();
    expect(summary.completed).toBe(1);
    expect(driveFiles.find((f) => f.id === "F_DOC")?.trashed).toBe(true);
  });

  it("CASO B: el borrado del CRM NO ocurrió -> Drive NO se toca", async () => {
    seedLinkedDocument();
    await prepareDocumentTrash(req(), DOCUMENT_ID);
    // El documento sigue existiendo y el trabajo conserva su document_id.
    queue()[0].available_at = new Date(0).toISOString();

    const summary = await processGoogleDriveSyncQueue();
    expect(summary.retried).toBe(1);
    expect(queue()[0].last_error).toBe("DOCUMENT_STILL_EXISTS");
    expect(driveFiles.find((f) => f.id === "F_DOC")?.trashed).toBeFalsy();
  });

  it("tras agotar reintentos con el documento aún presente, falla SIN mover nada", async () => {
    seedLinkedDocument();
    await prepareDocumentTrash(req(), DOCUMENT_ID);
    queue()[0].available_at = new Date(0).toISOString();
    queue()[0].attempt_count = GOOGLE_DRIVE_MAX_ATTEMPTS;

    const summary = await processGoogleDriveSyncQueue();
    expect(summary.failed).toBe(1);
    expect(queue()[0].last_error).toBe("DOCUMENT_STILL_EXISTS");
    expect(driveFiles.find((f) => f.id === "F_DOC")?.trashed).toBeFalsy();
  });

  it("CASO C: el archivo ya estaba en la papelera -> éxito idempotente", async () => {
    seedLinkedDocument();
    driveFiles.find((f) => f.id === "F_DOC")!.trashed = true;
    await prepareDocumentTrash(req(), DOCUMENT_ID);
    tables.documents = [];
    queue()[0].document_id = null;
    queue()[0].available_at = new Date(0).toISOString();

    expect((await processGoogleDriveSyncQueue()).completed).toBe(1);
  });

  it("CASO E: sin mapping en Drive, preparar la papelera es un no-op", async () => {
    expect(await prepareDocumentTrash(req(), DOCUMENT_ID)).toEqual({
      queued: false,
      reason: "no_mapping",
    });
    expect(queue()).toEqual([]);
  });

  it("nunca se usa DELETE contra la API de Drive", async () => {
    seedLinkedDocument();
    await prepareDocumentTrash(req(), DOCUMENT_ID);
    tables.documents = [];
    queue()[0].document_id = null;
    queue()[0].available_at = new Date(0).toISOString();
    await processGoogleDriveSyncQueue();
    expect(driveCalls.filter((c) => c.method === "DELETE")).toEqual([]);
  });
});

// ── procesador ───────────────────────────────────────────────────────────
describe("Fase 8D — procesador de la cola", () => {
  it("las operaciones de Drive -> CRM todavía no se procesan y no llaman a Google", async () => {
    for (const operation of ["poll_changes", "import_drive_file", "update_document"]) {
      tables.google_drive_sync_queue = [
        {
          id: 1,
          operation,
          connection_id: CONNECTION_ID,
          client_id: null,
          document_id: null,
          drive_file_id: null,
          status: "pending",
          attempt_count: 0,
          available_at: new Date(0).toISOString(),
        },
      ];
      driveCalls = [];
      const summary = await processGoogleDriveSyncQueue();
      expect(summary.failed).toBe(1);
      expect(queue()[0].last_error).toBe("OPERATION_NOT_IMPLEMENTED");
      const fileCalls = driveCalls.filter((c) => c.url.includes("/drive/v3/files"));
      expect(fileCalls).toEqual([]);
    }
  });

  it("no reclama trabajos cuyo available_at está en el futuro", async () => {
    tables.google_drive_sync_queue = [
      {
        id: 1,
        operation: "ensure_client_folder",
        connection_id: CONNECTION_ID,
        client_id: CLIENT_ID,
        document_id: null,
        drive_file_id: null,
        status: "pending",
        attempt_count: 0,
        available_at: new Date(Date.now() + 600_000).toISOString(),
      },
    ];
    expect((await processGoogleDriveSyncQueue()).processed).toBe(0);
  });

  it("si Drive deja de estar disponible, los trabajos vuelven a pending, no fallan", async () => {
    await requestClientFolderSync(req(), CLIENT_ID);
    tables.google_drive_connections = [connectionRow({ status: "disconnected" })];
    const summary = await processGoogleDriveSyncQueue();
    expect(summary.retried).toBe(1);
    expect(summary.failed).toBe(0);
    expect(queue()[0].status).toBe("pending");
  });
});
