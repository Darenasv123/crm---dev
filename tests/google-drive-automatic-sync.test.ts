import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 8F — Google Drive: sincronización automática (change feed, watch/
 * webhook, reconciliación, detección de conflictos).
 *
 * Drive, Supabase y Storage están simulados en memoria. Estas pruebas nunca
 * salen a internet, nunca tocan una cuenta de Drive real y nunca escriben en
 * una base de datos real.
 */

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), createClient: vi.fn() }));
vi.mock("@/lib/auth-server", () => ({ requireUser: mocks.requireUser }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

import { setServerRuntimeEnv } from "@/lib/server-runtime-env";
import { encryptToken } from "@/lib/google-drive/google-drive.server";
import { hashGoogleDriveChannelToken } from "@/lib/google-drive/drive-changes";
import {
  enqueueGoogleDrivePollChanges,
  evaluateKnownDriveDocumentState,
  handleGoogleDriveWebhookNotification,
  processGoogleDriveSyncQueue,
  runGoogleDriveMaintenance,
  runGoogleDriveReconciliation,
} from "@/lib/google-drive/drive-sync.server";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const ROOT_ID = "ROOT_CLIENTES";
const CONNECTION_ID = "11111111-1111-1111-1111-111111111111";
const ADMIN_ID = "22222222-2222-2222-2222-222222222222";
const CLIENT_ID = "33333333-3333-3333-3333-333333333333";
const FOLDER_ID = "F_ANA";
const DOC_ID = "44444444-4444-4444-4444-444444444444";
const FILE_ID = "DRIVE_FILE_1";
const WEBHOOK_URL = "https://crm.example/api/google-drive/webhook";

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
};

let driveFiles: Map<string, FakeDriveFile>;
let driveCalls: Array<{ url: string; method: string; body?: string }>;
let changeQueue: Array<{ fileId: string; removed: boolean; changeType?: string }>;
let startPageTokenValue: string;
/** Cuántas páginas debe simular changes.list antes de la página final
 *  (que trae newStartPageToken). Por defecto 1: una sola página. */
let changesTotalPages: number;
let changesCallCount: number;
let stopChannelCalls: Array<{ channelId: string; resourceId: string }>;
let stopChannelShouldFail: boolean;

function driveResourceBody(file: FakeDriveFile) {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    parents: file.parents,
    trashed: file.trashed ?? false,
    size: file.size,
    md5Checksum: file.md5Checksum,
    modifiedTime: file.modifiedTime ?? "2026-08-26T10:00:00.000Z",
    version: file.version ?? "1",
    webViewLink: file.webViewLink ?? `https://drive.example/${file.id}`,
    appProperties: file.appProperties ?? {},
    driveId: undefined,
    capabilities: file.capabilities ?? { canDownload: true },
  };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function fakeDriveFetch(url: string, init?: RequestInit) {
  const method = (init?.method ?? "GET").toUpperCase();
  const body = typeof init?.body === "string" ? init.body : undefined;
  driveCalls.push({ url, method, body });

  if (url.startsWith("https://oauth2.googleapis.com/token")) {
    return jsonResponse({ access_token: "fresh-token", expires_in: 3600 });
  }

  if (url.includes("/changes/startPageToken")) {
    return jsonResponse({ startPageToken: startPageTokenValue });
  }

  if (url.includes("/changes/watch")) {
    return jsonResponse({ resourceId: "RES_" + JSON.parse(body ?? "{}").id, expiration: null });
  }

  if (url === "https://www.googleapis.com/drive/v3/channels/stop") {
    if (stopChannelShouldFail) return jsonResponse({ error: { message: "boom" } }, 500);
    const parsed = JSON.parse(body ?? "{}");
    stopChannelCalls.push({ channelId: parsed.id, resourceId: parsed.resourceId });
    return jsonResponse({}, 204);
  }

  if (url.startsWith("https://www.googleapis.com/drive/v3/changes?")) {
    changesCallCount += 1;
    const isFinalPage = changesCallCount >= changesTotalPages;
    // NO destructivo a propósito (Fase 8F.1 Sección 11): Drive real devuelve
    // el MISMO tramo de cambios si se vuelve a pedir con el MISMO
    // pageToken/cursor persistido -- un poll que falla y se reintenta debe
    // poder releer exactamente los mismos changes, no encontrarlos ya
    // consumidos por el intento anterior.
    const pending = isFinalPage ? [...changeQueue] : [];
    return jsonResponse({
      ...(isFinalPage
        ? { newStartPageToken: "T_NEXT" }
        : { nextPageToken: `PAGE_${changesCallCount}` }),
      changes: pending.map((c) => {
        const file = driveFiles.get(c.fileId);
        return {
          fileId: c.fileId,
          removed: c.removed,
          changeType: c.changeType ?? "file",
          ...(file && !c.removed ? { file: driveResourceBody(file) } : {}),
        };
      }),
    });
  }

  const listMatch = /\/drive\/v3\/files\?(.*)$/.exec(url);
  if (listMatch) {
    // application/x-www-form-urlencoded codifica espacios como "+", que
    // decodeURIComponent NO revierte -- hay que dejar que URLSearchParams
    // parsee la query string real, igual que haría un servidor de verdad.
    const query = new URLSearchParams(listMatch[1]).get("q") ?? "";
    const files = [...driveFiles.values()];
    let matched: FakeDriveFile[];
    if (query.includes("crm_entity")) {
      matched = files.filter((f) => f.appProperties?.crm_entity === "document" && !f.trashed);
    } else {
      const parentId = query.match(/'([^']+)' in parents/)?.[1];
      matched = files.filter((f) => parentId && f.parents.includes(parentId) && !f.trashed);
    }
    return jsonResponse({ files: matched.map(driveResourceBody) });
  }

  const single = /\/drive\/v3\/files\/([^?]+)\?(.*)$/.exec(url);
  if (single) {
    const id = decodeURIComponent(single[1]);
    const file = driveFiles.get(id);
    if (!file) return jsonResponse({ error: { message: "not found" } }, 404);
    return jsonResponse(driveResourceBody(file));
  }

  return jsonResponse({ error: { message: `unhandled ${url}` } }, 404);
}

// ── Supabase + Storage falsos ────────────────────────────────────────────
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
let queueIdCounter: number;
/** Simula que OTRO poller ya avanzó el cursor justo antes de que este
 *  worker llame a advance_google_drive_change_token (Sección 10). Se
 *  autolimpia tras usarse una vez. */
let forceChangeTokenRaceOnce: boolean;

type FilterOp = "eq" | "neq" | "in" | "is" | "notIs";
interface Filter {
  col: string;
  op: FilterOp;
  val: unknown;
}

/**
 * Fuerza que la PRÓXIMA operación que coincida con `table`+`op` (y,
 * opcionalmente, `matches`) falle una sola vez con `message` -- simula un
 * fallo TRANSITORIO real de Postgres/Supabase en medio del procesamiento
 * de un change (Fase 8F.1 Sección 6-13). Se autolimpia tras usarse.
 */
let forceDbErrorOnce: {
  table: string;
  op: "select" | "insert" | "update";
  message: string;
  matches?: (payload: Row, filters: Filter[]) => boolean;
} | null;

/** Simula que rotate_google_drive_channel falla UNA vez (Fase 8F.1 Sección
 *  20) -- la rotación pasa por `db.rpc(...)`, no por el builder genérico
 *  `.from()`, así que necesita su propio flag de fallo forzado. */
let forceRotateChannelErrorOnce: string | null;

function rowMatches(row: Row, filters: Filter[]): boolean {
  return filters.every((f) => {
    const value = row[f.col];
    if (f.op === "eq") return value === f.val;
    if (f.op === "neq") return value !== f.val;
    if (f.op === "in") return (f.val as unknown[]).includes(value);
    if (f.op === "is") return value === f.val;
    return value !== f.val; // notIs
  });
}

function makeFakeSupabase() {
  return {
    from(table: string) {
      const filters: Filter[] = [];
      let opKind: "select" | "insert" | "update" = "select";
      let payload: Row | null = null;
      let rangeBounds: [number, number] | null = null;
      const builder: Record<string, unknown> = {};

      const rows = () => {
        let result = (tables[table] ?? []).filter((row) => rowMatches(row, filters));
        if (rangeBounds) result = result.slice(rangeBounds[0], rangeBounds[1] + 1);
        return result;
      };

      function run() {
        if (
          forceDbErrorOnce &&
          forceDbErrorOnce.table === table &&
          forceDbErrorOnce.op === opKind &&
          (!forceDbErrorOnce.matches || forceDbErrorOnce.matches(payload ?? {}, filters))
        ) {
          const message = forceDbErrorOnce.message;
          forceDbErrorOnce = null;
          return { data: null, error: { message } };
        }
        if (opKind === "insert") {
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
          const defaults: Row =
            table === "google_drive_sync_queue"
              ? {
                  id: (queueIdCounter += 1),
                  status: "pending",
                  attempt_count: 0,
                  payload: {},
                  client_id: null,
                  document_id: null,
                  drive_file_id: null,
                  available_at: new Date(0).toISOString(),
                }
              : { id: crypto.randomUUID(), created_at: new Date().toISOString() };
          const inserted = { ...defaults, ...payload };
          list.push(inserted);
          return { data: inserted, error: null };
        }
        if (opKind === "update") {
          for (const row of rows()) Object.assign(row, payload);
          return { data: null, error: null };
        }
        return { data: rows(), error: null };
      }

      Object.assign(builder, {
        select: () => builder,
        order: () => builder,
        range: (from: number, to: number) => {
          rangeBounds = [from, to];
          return builder;
        },
        eq: (col: string, val: unknown) => {
          filters.push({ col, op: "eq", val });
          return builder;
        },
        neq: (col: string, val: unknown) => {
          filters.push({ col, op: "neq", val });
          return builder;
        },
        in: (col: string, vals: unknown[]) => {
          filters.push({ col, op: "in", val: vals });
          return builder;
        },
        is: (col: string, val: unknown) => {
          filters.push({ col, op: "is", val });
          return builder;
        },
        not: (col: string, _kind: string, val: unknown) => {
          filters.push({ col, op: "notIs", val });
          return builder;
        },
        insert: (values: Row) => {
          opKind = "insert";
          payload = values;
          return builder;
        },
        update: (values: Row) => {
          opKind = "update";
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
        remove: async () => ({ data: null, error: null }),
      }),
    },
  };
}

function fakeRpc(name: string, args: Record<string, unknown>) {
  const connections = () => (tables.google_drive_connections ??= []);
  const connectionRow = () => connections().find((row) => row.id === args.p_connection_id);

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

  if (name === "initialize_google_drive_change_token") {
    const connection = connectionRow();
    if (!connection || connection.status !== "connected") {
      return { data: null, error: { message: "DRIVE_NOT_CONNECTED" } };
    }
    if (connection.changes_page_token) {
      return { data: { initialized: false, token: connection.changes_page_token }, error: null };
    }
    connection.changes_page_token = args.p_start_page_token;
    connection.changes_initialized_at = new Date().toISOString();
    return { data: { initialized: true, token: args.p_start_page_token }, error: null };
  }

  if (name === "advance_google_drive_change_token") {
    if (forceChangeTokenRaceOnce) {
      forceChangeTokenRaceOnce = false;
      return { data: null, error: { message: "DRIVE_CHANGE_TOKEN_CHANGED_RETRY" } };
    }
    const connection = connectionRow();
    if (!connection || connection.status !== "connected") {
      return { data: null, error: { message: "DRIVE_NOT_CONNECTED" } };
    }
    if (connection.changes_page_token !== args.p_expected_current_token) {
      return { data: null, error: { message: "DRIVE_CHANGE_TOKEN_CHANGED_RETRY" } };
    }
    connection.changes_page_token = args.p_new_token;
    connection.last_changes_polled_at = new Date().toISOString();
    return { data: { token: args.p_new_token }, error: null };
  }

  if (name === "claim_google_drive_reconciliation") {
    const connection = connectionRow();
    if (!connection) return { data: null, error: { message: "DRIVE_NOT_CONNECTED" } };
    const staleAfterMs = Number(args.p_stale_after_seconds ?? 3600) * 1000;
    const claimedAt = connection.reconciliation_claimed_at as string | null;
    if (claimedAt && Date.now() - new Date(claimedAt).getTime() < staleAfterMs) {
      return { data: { claimed: false }, error: null };
    }
    connection.reconciliation_claimed_at = new Date().toISOString();
    return { data: { claimed: true }, error: null };
  }

  if (name === "complete_google_drive_reconciliation") {
    const connection = connectionRow();
    if (connection) {
      connection.last_reconciled_at = new Date().toISOString();
      connection.reconciliation_claimed_at = null;
    }
    return { data: null, error: null };
  }

  if (name === "rotate_google_drive_channel") {
    if (forceRotateChannelErrorOnce) {
      const message = forceRotateChannelErrorOnce;
      forceRotateChannelErrorOnce = null;
      // Atómico de verdad, igual que la RPC real: NADA cambia si falla --
      // ni se supersede el viejo ni se inserta el nuevo.
      return { data: null, error: { message } };
    }
    const channels = (tables.google_drive_channels ??= []);
    if (args.p_old_channel_id) {
      const old = channels.find((c) => c.channel_id === args.p_old_channel_id && !c.superseded_at);
      if (old) old.superseded_at = new Date().toISOString();
    }
    const created = {
      id: crypto.randomUUID(),
      connection_id: args.p_connection_id,
      channel_id: args.p_new_channel_id,
      resource_id: args.p_new_resource_id,
      channel_token_hash: args.p_new_channel_token_hash,
      expires_at: args.p_new_expires_at,
      stopped_at: null,
      superseded_at: null,
    };
    channels.push(created);
    return { data: created, error: null };
  }

  if (name === "repair_google_drive_document_mapping") {
    const connection = connectionRow();
    if (!connection || connection.status !== "connected") {
      return { data: null, error: { message: "DRIVE_NOT_CONNECTED" } };
    }
    if (connection.root_folder_id !== args.p_expected_root_folder_id) {
      return { data: null, error: { message: "DRIVE_ROOT_CHANGED_RETRY" } };
    }
    const document = (tables.documents ?? []).find((d) => d.id === args.p_document_id);
    if (!document) return { data: null, error: { message: "DOCUMENT_NOT_FOUND" } };
    if (document.client_id !== args.p_client_id) {
      return { data: null, error: { message: "DOCUMENT_CLIENT_MISMATCH" } };
    }
    const folder = (tables.google_drive_client_folders ?? []).find(
      (f) => f.connection_id === args.p_connection_id && f.client_id === args.p_client_id,
    );
    if (
      !folder ||
      folder.drive_folder_id !== args.p_drive_parent_id ||
      folder.sync_status !== "synced"
    ) {
      return { data: null, error: { message: "CLIENT_FOLDER_CHANGED_RETRY" } };
    }
    const existingByDoc = (tables.google_drive_document_files ?? []).find(
      (m) => m.document_id === args.p_document_id,
    );
    if (existingByDoc) return { data: null, error: { message: "DOCUMENT_ALREADY_MAPPED" } };
    const existingByFile = (tables.google_drive_document_files ?? []).find(
      (m) => m.connection_id === args.p_connection_id && m.drive_file_id === args.p_drive_file_id,
    );
    if (existingByFile) return { data: null, error: { message: "DRIVE_FILE_ALREADY_IMPORTED" } };
    (tables.google_drive_document_files ??= []).push({
      id: crypto.randomUUID(),
      document_id: args.p_document_id,
      connection_id: args.p_connection_id,
      drive_file_id: args.p_drive_file_id,
      drive_parent_id: args.p_drive_parent_id,
      last_synced_file_name: args.p_name,
      last_synced_drive_parent_id: args.p_drive_parent_id,
      last_synced_drive_md5_checksum: args.p_drive_md5,
      last_synced_drive_version: args.p_drive_version,
      sync_status: "synced",
      sync_error: null,
    });
    return { data: { repaired: true, documentId: args.p_document_id }, error: null };
  }

  return { data: null, error: { message: `unknown rpc ${name}` } };
}

// ── setup ────────────────────────────────────────────────────────────────
function connectionRowFixture(overrides: Row = {}): Row {
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
    changes_page_token: null,
    changes_initialized_at: null,
    last_changes_polled_at: null,
    last_reconciled_at: null,
    reconciliation_claimed_at: null,
    ...overrides,
  };
}

const queue = () => tables.google_drive_sync_queue ?? [];
const channels = () => tables.google_drive_channels ?? [];
const documents = () => tables.documents ?? [];
const documentMappings = () => tables.google_drive_document_files ?? [];
const clientFolders = () => tables.google_drive_client_folders ?? [];
const connection = () => tables.google_drive_connections[0];

async function run() {
  return processGoogleDriveSyncQueue();
}

beforeEach(async () => {
  setServerRuntimeEnv(ENV);
  driveCalls = [];
  driveFiles = new Map();
  changeQueue = [];
  startPageTokenValue = "T0";
  changesTotalPages = 1;
  changesCallCount = 0;
  stopChannelCalls = [];
  stopChannelShouldFail = false;
  rpcCalls = [];
  queueIdCounter = 0;
  forceChangeTokenRaceOnce = false;
  forceDbErrorOnce = null;
  forceRotateChannelErrorOnce = null;

  driveFiles.set(FOLDER_ID, {
    id: FOLDER_ID,
    name: "Ana Torres",
    mimeType: FOLDER_MIME,
    parents: [ROOT_ID],
  });

  const encryptedToken = await encryptToken("refresh-token-de-pruebas");
  tables = {
    profiles: [{ id: ADMIN_ID, role: "Administrador", status: "Activo" }],
    clients: [{ id: CLIENT_ID, name: "Ana Torres" }],
    google_drive_connections: [connectionRowFixture({ encrypted_refresh_token: encryptedToken })],
    google_drive_client_folders: [
      {
        id: "folder-mapping-1",
        connection_id: CONNECTION_ID,
        client_id: CLIENT_ID,
        drive_folder_id: FOLDER_ID,
        sync_status: "synced",
      },
    ],
    documents: [],
    google_drive_document_files: [],
    google_drive_channels: [],
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
});

// ── evaluateKnownDriveDocumentState: función pura ─────────────────────────
describe("Fase 8F — evaluateKnownDriveDocumentState (Sección 17-22)", () => {
  const baseline = {
    last_synced_file_name: "contrato.pdf",
    last_synced_drive_parent_id: FOLDER_ID,
    last_synced_drive_md5_checksum: "abc123",
    last_synced_drive_version: 1,
  };

  it("removed=true -> missing/DRIVE_FILE_REMOVED_OR_ACCESS_LOST", () => {
    expect(evaluateKnownDriveDocumentState(baseline, true, undefined)).toEqual({
      kind: "missing",
      reason: "DRIVE_FILE_REMOVED_OR_ACCESS_LOST",
    });
  });

  it("trashed=true -> missing/DRIVE_FILE_TRASHED", () => {
    expect(
      evaluateKnownDriveDocumentState(baseline, false, {
        name: "contrato.pdf",
        parents: [FOLDER_ID],
        trashed: true,
        md5Checksum: "abc123",
        version: "1",
      }),
    ).toEqual({ kind: "missing", reason: "DRIVE_FILE_TRASHED" });
  });

  it("todo igual al baseline -> unchanged (Sección 17: absorbe el eco de nuestras propias operaciones)", () => {
    expect(
      evaluateKnownDriveDocumentState(baseline, false, {
        name: "contrato.pdf",
        parents: [FOLDER_ID],
        md5Checksum: "abc123",
        version: "1",
      }),
    ).toEqual({ kind: "unchanged" });
  });

  it("nombre distinto -> conflict/DRIVE_NAME_CHANGED", () => {
    expect(
      evaluateKnownDriveDocumentState(baseline, false, {
        name: "renombrado.pdf",
        parents: [FOLDER_ID],
        md5Checksum: "abc123",
        version: "1",
      }),
    ).toEqual({ kind: "conflict", reason: "DRIVE_NAME_CHANGED" });
  });

  it("md5 distinto -> conflict/DRIVE_CONTENT_CHANGED", () => {
    expect(
      evaluateKnownDriveDocumentState(baseline, false, {
        name: "contrato.pdf",
        parents: [FOLDER_ID],
        md5Checksum: "distinto",
        version: "1",
      }),
    ).toEqual({ kind: "conflict", reason: "DRIVE_CONTENT_CHANGED" });
  });

  it("version distinta -> conflict/DRIVE_CONTENT_CHANGED", () => {
    expect(
      evaluateKnownDriveDocumentState(baseline, false, {
        name: "contrato.pdf",
        parents: [FOLDER_ID],
        md5Checksum: "abc123",
        version: "2",
      }),
    ).toEqual({ kind: "conflict", reason: "DRIVE_CONTENT_CHANGED" });
  });

  it("padre distinto -> conflict/DRIVE_PARENT_MISMATCH (prioridad sobre contenido/nombre)", () => {
    expect(
      evaluateKnownDriveDocumentState(baseline, false, {
        name: "renombrado.pdf",
        parents: ["OTRA_CARPETA"],
        md5Checksum: "distinto",
        version: "1",
      }),
    ).toEqual({ kind: "conflict", reason: "DRIVE_PARENT_MISMATCH" });
  });
});

// ── bootstrap del cursor (Sección 5) ──────────────────────────────────────
describe("Fase 8F — bootstrap del change token vía mantenimiento", () => {
  it("primera ejecución: pide startPageToken y lo persiste una sola vez", async () => {
    const result = await runGoogleDriveMaintenance();
    expect(result.changeTrackingBootstrapped).toBe(true);
    expect(connection().changes_initialized_at).not.toBeNull();
    expect(driveCalls.some((c) => c.url.includes("startPageToken"))).toBe(true);
    // La misma ejecución de mantenimiento también encola y procesa
    // poll_changes (Sección 37): el cursor avanza más allá de T0 en este
    // mismo ciclo -- eso se prueba por separado en el bloque de
    // poll_changes; aquí solo importa que el BOOTSTRAP en sí ocurrió.
    expect(result.pollEnqueued).toBe(true);
  });

  it("segunda ejecución: no vuelve a pedir startPageToken (ya inicializado)", async () => {
    await runGoogleDriveMaintenance();
    driveCalls = [];
    startPageTokenValue = "T_DIFERENTE";
    const result = await runGoogleDriveMaintenance();
    expect(result.changeTrackingBootstrapped).toBe(false);
    expect(driveCalls.some((c) => c.url.includes("startPageToken"))).toBe(false);
  });
});

// ── poll_changes: paginación y avance del cursor (Sección 8/9) ───────────
describe("Fase 8F — poll_changes: algoritmo de paginación", () => {
  beforeEach(() => {
    connection().changes_page_token = "T0";
  });

  it("sin token inicializado -> retry, nunca inventa uno", async () => {
    connection().changes_page_token = null;
    await enqueueGoogleDrivePollChanges(CONNECTION_ID);
    const summary = await run();
    expect(summary.retried).toBe(1);
    expect(queue()[0].last_error).toBe("DRIVE_CHANGE_TOKEN_NOT_INITIALIZED");
    expect(driveCalls.some((c) => c.url.includes("/drive/v3/changes?"))).toBe(false);
  });

  it("página única con newStartPageToken -> avanza el cursor y completa", async () => {
    await enqueueGoogleDrivePollChanges(CONNECTION_ID);
    const summary = await run();
    expect(summary.completed).toBe(1);
    expect(connection().changes_page_token).toBe("T_NEXT");
    expect(connection().last_changes_polled_at).not.toBeNull();
  });

  it("Sección 8: pagina hasta la página FINAL (con newStartPageToken) antes de avanzar el cursor", async () => {
    changesTotalPages = 3;
    changeQueue.push({ fileId: "IGNORADO", removed: true }); // solo debe aparecer en la página final
    await enqueueGoogleDrivePollChanges(CONNECTION_ID);
    const summary = await run();
    expect(summary.completed).toBe(1);
    expect(connection().changes_page_token).toBe("T_NEXT");
    const pageCalls = driveCalls.filter((c) => c.url.includes("/drive/v3/changes?"));
    expect(pageCalls).toHaveLength(3);
  });

  it("Sección 10: el token cambió justo antes de avanzar -> nunca sobrescribe ni retrocede, se resuelve como completado", async () => {
    // El propio CAS real (advance_google_drive_change_token) ya está
    // probado con dos sesiones PostgreSQL genuinamente concurrentes (ver
    // informe de validación); aquí se prueba la reacción del WORKER ante
    // ese resultado -- forzando que la RPC responda como si otro poller ya
    // hubiera ganado la carrera.
    await enqueueGoogleDrivePollChanges(CONNECTION_ID);
    forceChangeTokenRaceOnce = true;
    const summary = await run();
    expect(summary.completed).toBe(1); // CHANGED_RETRY se resuelve como completed, no como fallo.
    expect(connection().changes_page_token).toBe("T0"); // nunca se sobrescribe ni retrocede desde aquí.
  });
});

// ── seguridad del cursor ante fallos transitorios (Fase 8F.1 Sección 6-13,
// OBLIGATORIO) ──────────────────────────────────────────────────────────
describe("Fase 8F.1 — el cursor NUNCA avanza si algún change de la página falló", () => {
  beforeEach(() => {
    connection().changes_page_token = "T0";
    documents().push({ id: DOC_ID, client_id: CLIENT_ID, name: "contrato.pdf" });
    documentMappings().push({
      id: "map-1",
      document_id: DOC_ID,
      connection_id: CONNECTION_ID,
      drive_file_id: FILE_ID,
      last_synced_file_name: "contrato.pdf",
      last_synced_drive_parent_id: FOLDER_ID,
      last_synced_drive_md5_checksum: "abc123",
      last_synced_drive_version: 1,
      sync_status: "synced",
    });
    // B: archivo mapeado con contenido cambiado -> dispara un UPDATE de
    // conflicto sobre google_drive_document_files.
    driveFiles.set(FILE_ID, {
      id: FILE_ID,
      name: "contrato.pdf",
      mimeType: "application/pdf",
      parents: [FOLDER_ID],
      md5Checksum: "distinto999",
      version: "2",
    });
    // A: archivo nuevo manual -> dispara un INSERT en la cola.
    driveFiles.set("FILE_A", {
      id: "FILE_A",
      name: "nuevo.pdf",
      mimeType: "application/pdf",
      parents: [FOLDER_ID],
    });
  });

  it("G (OBLIGATORIO): un change falla de forma transitoria -> el cursor NO avanza, 0 llamadas a advance, el poll queda en retry", async () => {
    changeQueue.push(
      { fileId: "FILE_A", removed: false }, // éxito
      { fileId: FILE_ID, removed: false }, // falla transitoriamente al marcar el conflicto
      { fileId: "NUNCA_VISTO", removed: true }, // no accionable, no importa el orden
    );
    forceDbErrorOnce = {
      table: "google_drive_document_files",
      op: "update",
      message: "connection reset by peer",
    };
    await enqueueGoogleDrivePollChanges(CONNECTION_ID);
    const summary = await run();

    expect(summary.retried).toBe(1);
    expect(queue().find((j) => j.operation === "poll_changes")?.last_error).toContain(
      "DRIVE_CHANGE_PROCESSING_FAILED",
    );
    expect(connection().changes_page_token).toBe("T0");
    expect(rpcCalls.filter((c) => c.name === "advance_google_drive_change_token")).toEqual([]);
    // El efecto de A, ya durable y dedupeado, no se deshace -- Sección 8
    // categoría B ("enqueue durable dedupeado") es un resultado válido
    // aunque el LOTE completo se marque para reintento.
    expect(
      queue().some((j) => j.operation === "import_drive_file" && j.drive_file_id === "FILE_A"),
    ).toBe(true);
  });

  it("H: reintento tras un fallo parcial -> reprocesa el tramo completo, A tiene éxito la 2da vez, el cursor SÍ avanza", async () => {
    // Dos archivos mapeados distintos -- A y B -- para poder forzar el
    // fallo SOLO en B sin introducir efectos secundarios en cola que
    // contaminen el reintento (import_drive_file de otro test se procesaría
    // también en el mismo lote y complicaría innecesariamente esta prueba).
    const DOC_A_ID = "55555555-5555-5555-5555-555555555555";
    const FILE_A_ID = "DRIVE_FILE_A";
    documents().push({ id: DOC_A_ID, client_id: CLIENT_ID, name: "otro.pdf" });
    documentMappings().push({
      id: "map-A",
      document_id: DOC_A_ID,
      connection_id: CONNECTION_ID,
      drive_file_id: FILE_A_ID,
      last_synced_file_name: "otro.pdf",
      last_synced_drive_parent_id: FOLDER_ID,
      last_synced_drive_md5_checksum: "aaa111",
      last_synced_drive_version: 1,
      sync_status: "synced",
    });
    driveFiles.set(FILE_A_ID, {
      id: FILE_A_ID,
      name: "RENOMBRADO.pdf",
      mimeType: "application/pdf",
      parents: [FOLDER_ID],
      md5Checksum: "aaa111",
      version: "1",
    });

    changeQueue.push({ fileId: FILE_A_ID, removed: false }, { fileId: FILE_ID, removed: false });
    forceDbErrorOnce = {
      table: "google_drive_document_files",
      op: "update",
      message: "connection reset by peer",
      matches: (_payload, filters) => filters.some((f) => f.col === "id" && f.val === "map-1"),
    };
    await enqueueGoogleDrivePollChanges(CONNECTION_ID);
    const first = await run();
    expect(first.retried).toBe(1);
    expect(connection().changes_page_token).toBe("T0");
    // A (map-A) SÍ se procesó con éxito en el primer intento -- el fallo
    // fue específico de B (map-1); A no debería reprocesarse dos veces con
    // efectos distintos, pero marcar el mismo conflicto otra vez es
    // idempotente (fija el mismo sync_status/sync_error).
    expect(documentMappings().find((m) => m.id === "map-A")?.sync_status).toBe("conflict");

    const pollJob = queue().find((j) => j.operation === "poll_changes")!;
    pollJob.status = "pending";
    pollJob.available_at = new Date(0).toISOString();
    await run();

    const pollJobAfter = queue().find((j) => j.operation === "poll_changes")!;
    expect(pollJobAfter.status).toBe("completed");
    expect(connection().changes_page_token).toBe("T_NEXT");
    expect(documentMappings().find((m) => m.id === "map-1")?.sync_status).toBe("conflict");
    expect(documentMappings().find((m) => m.id === "map-1")?.sync_error).toBe(
      "DRIVE_CONTENT_CHANGED",
    );
  });

  it("I: el fallo ocurre en la ÚLTIMA página -> el cursor sigue en T0, NUNCA en el nextPageToken de una página anterior exitosa", async () => {
    changesTotalPages = 2;
    changeQueue.push({ fileId: FILE_ID, removed: false });
    forceDbErrorOnce = {
      table: "google_drive_document_files",
      op: "update",
      message: "boom transitorio en la última página",
    };
    await enqueueGoogleDrivePollChanges(CONNECTION_ID);
    const summary = await run();

    expect(summary.retried).toBe(1);
    expect(connection().changes_page_token).toBe("T0");
    expect(rpcCalls.filter((c) => c.name === "advance_google_drive_change_token")).toEqual([]);
    // Dos páginas SÍ se pidieron -- la primera (vacía) tuvo éxito, mostrando
    // que no basta con que una página anterior haya ido bien.
    expect(driveCalls.filter((c) => c.url.includes("/drive/v3/changes?"))).toHaveLength(2);
  });

  it("J (OBLIGATORIO, Sección 13): fallo específico al persistir un conflict -> nunca se asume 'change procesado'", async () => {
    changeQueue.push({ fileId: FILE_ID, removed: false });
    forceDbErrorOnce = {
      table: "google_drive_document_files",
      op: "update",
      message: "deadlock detected",
    };
    await enqueueGoogleDrivePollChanges(CONNECTION_ID);
    const summary = await run();

    expect(summary.retried).toBe(1);
    expect(connection().changes_page_token).toBe("T0");
    // El mapping NUNCA quedó marcado -- el fallo impidió la escritura, y eso
    // es exactamente lo que se está verificando (no un efecto secundario).
    expect(documentMappings()[0].sync_status).toBe("synced");
    expect(documentMappings()[0].sync_error ?? null).toBeNull();
  });

  it("un fallo transitorio al ENCOLAR import_drive_file también aborta el poll sin avanzar el cursor", async () => {
    changeQueue.push({ fileId: "FILE_A", removed: false });
    // Se encola el propio poll_changes ANTES de forzar el fallo -- el
    // fallo debe aplicar al enqueue de import_drive_file que ocurre DENTRO
    // del procesamiento, nunca al del propio job de poll.
    await enqueueGoogleDrivePollChanges(CONNECTION_ID);
    forceDbErrorOnce = {
      table: "google_drive_sync_queue",
      op: "insert",
      message: "could not serialize access",
    };
    const summary = await run();

    expect(summary.retried).toBe(1);
    expect(connection().changes_page_token).toBe("T0");
    expect(queue().some((j) => j.operation === "import_drive_file")).toBe(false);
  });
});

// ── clasificación de eventos vía poll_changes (Sección 56) ────────────────
describe("Fase 8F — clasificación de cambios detectados por el change feed", () => {
  beforeEach(() => {
    connection().changes_page_token = "T0";
  });

  it("archivo nuevo, manual, dentro de una carpeta de Cliente sincronizada -> encola import_drive_file", async () => {
    driveFiles.set(FILE_ID, {
      id: FILE_ID,
      name: "contrato.pdf",
      mimeType: "application/pdf",
      parents: [FOLDER_ID],
    });
    changeQueue.push({ fileId: FILE_ID, removed: false });
    await enqueueGoogleDrivePollChanges(CONNECTION_ID);
    await run();
    const importJobs = queue().filter((j) => j.operation === "import_drive_file");
    expect(importJobs).toHaveLength(1);
    expect(importJobs[0].drive_file_id).toBe(FILE_ID);
  });

  it("archivo nuevo FUERA de cualquier carpeta de Cliente vinculada -> nunca se importa (no es 'todo My Drive')", async () => {
    driveFiles.set("OTRO_ARCHIVO", {
      id: "OTRO_ARCHIVO",
      name: "personal.pdf",
      mimeType: "application/pdf",
      parents: ["CARPETA_NO_VINCULADA"],
    });
    changeQueue.push({ fileId: "OTRO_ARCHIVO", removed: false });
    await enqueueGoogleDrivePollChanges(CONNECTION_ID);
    await run();
    expect(queue().some((j) => j.operation === "import_drive_file")).toBe(false);
  });

  it("archivo YA mapeado y sin cambios respecto al baseline -> no-op (Sección 17, OBLIGATORIO: absorbe eco de nuestras propias operaciones)", async () => {
    documents().push({ id: DOC_ID, client_id: CLIENT_ID, name: "contrato.pdf" });
    documentMappings().push({
      id: "map-1",
      document_id: DOC_ID,
      connection_id: CONNECTION_ID,
      drive_file_id: FILE_ID,
      last_synced_file_name: "contrato.pdf",
      last_synced_drive_parent_id: FOLDER_ID,
      last_synced_drive_md5_checksum: "abc123",
      last_synced_drive_version: 1,
      sync_status: "synced",
    });
    driveFiles.set(FILE_ID, {
      id: FILE_ID,
      name: "contrato.pdf",
      mimeType: "application/pdf",
      parents: [FOLDER_ID],
      md5Checksum: "abc123",
      version: "1",
    });
    changeQueue.push({ fileId: FILE_ID, removed: false });
    await enqueueGoogleDrivePollChanges(CONNECTION_ID);
    await run();
    expect(documentMappings()[0].sync_status).toBe("synced");
    expect(documentMappings()[0].sync_error ?? null).toBeNull();
    expect(queue().some((j) => j.operation === "import_drive_file")).toBe(false);
  });

  it("archivo mapeado renombrado en Drive -> conflict/DRIVE_NAME_CHANGED, NUNCA renombra el CRM", async () => {
    documents().push({ id: DOC_ID, client_id: CLIENT_ID, name: "contrato.pdf" });
    documentMappings().push({
      id: "map-1",
      document_id: DOC_ID,
      connection_id: CONNECTION_ID,
      drive_file_id: FILE_ID,
      last_synced_file_name: "contrato.pdf",
      last_synced_drive_parent_id: FOLDER_ID,
      last_synced_drive_md5_checksum: "abc123",
      last_synced_drive_version: 1,
      sync_status: "synced",
    });
    driveFiles.set(FILE_ID, {
      id: FILE_ID,
      name: "RENOMBRADO.pdf",
      mimeType: "application/pdf",
      parents: [FOLDER_ID],
      md5Checksum: "abc123",
      version: "1",
    });
    changeQueue.push({ fileId: FILE_ID, removed: false });
    await enqueueGoogleDrivePollChanges(CONNECTION_ID);
    await run();
    expect(documentMappings()[0].sync_status).toBe("conflict");
    expect(documentMappings()[0].sync_error).toBe("DRIVE_NAME_CHANGED");
    expect(documents()[0].name).toBe("contrato.pdf"); // el CRM nunca se renombra solo
  });

  it("archivo mapeado con contenido cambiado en Drive -> conflict/DRIVE_CONTENT_CHANGED, NUNCA sobreescribe Storage", async () => {
    documents().push({ id: DOC_ID, client_id: CLIENT_ID, name: "contrato.pdf" });
    documentMappings().push({
      id: "map-1",
      document_id: DOC_ID,
      connection_id: CONNECTION_ID,
      drive_file_id: FILE_ID,
      last_synced_file_name: "contrato.pdf",
      last_synced_drive_parent_id: FOLDER_ID,
      last_synced_drive_md5_checksum: "abc123",
      last_synced_drive_version: 1,
      sync_status: "synced",
    });
    driveFiles.set(FILE_ID, {
      id: FILE_ID,
      name: "contrato.pdf",
      mimeType: "application/pdf",
      parents: [FOLDER_ID],
      md5Checksum: "distinto999",
      version: "2",
    });
    changeQueue.push({ fileId: FILE_ID, removed: false });
    await enqueueGoogleDrivePollChanges(CONNECTION_ID);
    await run();
    expect(documentMappings()[0].sync_status).toBe("conflict");
    expect(documentMappings()[0].sync_error).toBe("DRIVE_CONTENT_CHANGED");
  });

  it("archivo mapeado MOVIDO a otra carpeta -> conflict/DRIVE_PARENT_MISMATCH, nunca reasigna client_id", async () => {
    documents().push({ id: DOC_ID, client_id: CLIENT_ID, name: "contrato.pdf" });
    documentMappings().push({
      id: "map-1",
      document_id: DOC_ID,
      connection_id: CONNECTION_ID,
      drive_file_id: FILE_ID,
      last_synced_file_name: "contrato.pdf",
      last_synced_drive_parent_id: FOLDER_ID,
      last_synced_drive_md5_checksum: "abc123",
      last_synced_drive_version: 1,
      sync_status: "synced",
    });
    driveFiles.set(FILE_ID, {
      id: FILE_ID,
      name: "contrato.pdf",
      mimeType: "application/pdf",
      parents: ["OTRA_CARPETA_CUALQUIERA"],
      md5Checksum: "abc123",
      version: "1",
    });
    changeQueue.push({ fileId: FILE_ID, removed: false });
    await enqueueGoogleDrivePollChanges(CONNECTION_ID);
    await run();
    expect(documentMappings()[0].sync_status).toBe("conflict");
    expect(documentMappings()[0].sync_error).toBe("DRIVE_PARENT_MISMATCH");
    expect(documents()[0].client_id).toBe(CLIENT_ID); // nunca reasignado
  });

  it("archivo mapeado marcado trashed en Drive -> missing/DRIVE_FILE_TRASHED, el documento del CRM se conserva", async () => {
    documents().push({ id: DOC_ID, client_id: CLIENT_ID, name: "contrato.pdf" });
    documentMappings().push({
      id: "map-1",
      document_id: DOC_ID,
      connection_id: CONNECTION_ID,
      drive_file_id: FILE_ID,
      last_synced_file_name: "contrato.pdf",
      last_synced_drive_parent_id: FOLDER_ID,
      last_synced_drive_md5_checksum: "abc123",
      last_synced_drive_version: 1,
      sync_status: "synced",
    });
    driveFiles.set(FILE_ID, {
      id: FILE_ID,
      name: "contrato.pdf",
      mimeType: "application/pdf",
      parents: [FOLDER_ID],
      trashed: true,
    });
    changeQueue.push({ fileId: FILE_ID, removed: false });
    await enqueueGoogleDrivePollChanges(CONNECTION_ID);
    await run();
    expect(documentMappings()[0].sync_status).toBe("missing");
    expect(documentMappings()[0].sync_error).toBe("DRIVE_FILE_TRASHED");
    expect(documents()).toHaveLength(1); // el documento del CRM NUNCA se borra
  });

  it("removed=true sobre un archivo mapeado -> missing/DRIVE_FILE_REMOVED_OR_ACCESS_LOST, el documento del CRM se conserva", async () => {
    documents().push({ id: DOC_ID, client_id: CLIENT_ID, name: "contrato.pdf" });
    documentMappings().push({
      id: "map-1",
      document_id: DOC_ID,
      connection_id: CONNECTION_ID,
      drive_file_id: FILE_ID,
      last_synced_file_name: "contrato.pdf",
      last_synced_drive_parent_id: FOLDER_ID,
      sync_status: "synced",
    });
    changeQueue.push({ fileId: FILE_ID, removed: true });
    await enqueueGoogleDrivePollChanges(CONNECTION_ID);
    await run();
    expect(documentMappings()[0].sync_status).toBe("missing");
    expect(documentMappings()[0].sync_error).toBe("DRIVE_FILE_REMOVED_OR_ACCESS_LOST");
    expect(documents()).toHaveLength(1);
  });

  it("removed=true sobre algo NUNCA conocido -> no accionable (Sección 22 solo aplica a archivos ya conocidos)", async () => {
    changeQueue.push({ fileId: "NUNCA_VISTO", removed: true });
    await enqueueGoogleDrivePollChanges(CONNECTION_ID);
    const summary = await run();
    expect(summary.completed).toBe(1);
    expect(documentMappings()).toEqual([]);
  });

  it("carpeta de Cliente movida fuera de la raíz -> conflict/DRIVE_PARENT_MISMATCH, nunca reasigna mappings documentales", async () => {
    driveFiles.set(FOLDER_ID, {
      id: FOLDER_ID,
      name: "Ana Torres",
      mimeType: FOLDER_MIME,
      parents: ["FUERA_DE_LA_RAIZ"],
    });
    changeQueue.push({ fileId: FOLDER_ID, removed: false });
    await enqueueGoogleDrivePollChanges(CONNECTION_ID);
    await run();
    expect(clientFolders()[0].sync_status).toBe("conflict");
    expect(clientFolders()[0].sync_error).toBe("DRIVE_PARENT_MISMATCH");
    expect(clientFolders()[0].client_id).toBe(CLIENT_ID); // nunca reasignado
  });

  it("carpeta de Cliente trashed/eliminada -> missing/CLIENT_DRIVE_FOLDER_MISSING", async () => {
    driveFiles.set(FOLDER_ID, {
      id: FOLDER_ID,
      name: "Ana Torres",
      mimeType: FOLDER_MIME,
      parents: [ROOT_ID],
      trashed: true,
    });
    changeQueue.push({ fileId: FOLDER_ID, removed: false });
    await enqueueGoogleDrivePollChanges(CONNECTION_ID);
    await run();
    expect(clientFolders()[0].sync_status).toBe("missing");
    expect(clientFolders()[0].sync_error).toBe("CLIENT_DRIVE_FOLDER_MISSING");
  });

  it("ignora changeType distinto de 'file' (Sección 13)", async () => {
    changeQueue.push({ fileId: "ALGO", removed: false, changeType: "drive" });
    await enqueueGoogleDrivePollChanges(CONNECTION_ID);
    const summary = await run();
    expect(summary.completed).toBe(1);
    expect(queue().some((j) => j.operation === "import_drive_file")).toBe(false);
  });
});

// ── prevención de loop (Sección 57, OBLIGATORIO) ──────────────────────────
describe("Fase 8F — prevención de loop: el eco de nuestras propias operaciones nunca produce trabajo nuevo", () => {
  it("un upload/import outbound YA finalizado, reflejado idéntico en el change feed -> 0 uploads, 0 imports, 0 renames, 0 conflicts", async () => {
    connection().changes_page_token = "T0";
    documents().push({ id: DOC_ID, client_id: CLIENT_ID, name: "contrato.pdf" });
    documentMappings().push({
      id: "map-1",
      document_id: DOC_ID,
      connection_id: CONNECTION_ID,
      drive_file_id: FILE_ID,
      last_synced_file_name: "contrato.pdf",
      last_synced_drive_parent_id: FOLDER_ID,
      last_synced_drive_md5_checksum: "abc123",
      last_synced_drive_version: 1,
      sync_status: "synced",
    });
    driveFiles.set(FILE_ID, {
      id: FILE_ID,
      name: "contrato.pdf",
      mimeType: "application/pdf",
      parents: [FOLDER_ID],
      md5Checksum: "abc123",
      version: "1",
    });
    // El propio change feed reporta EXACTAMENTE el estado que ya
    // dejamos -- exactamente el eco de nuestra subida outbound.
    changeQueue.push({ fileId: FILE_ID, removed: false });
    await enqueueGoogleDrivePollChanges(CONNECTION_ID);
    await run();
    expect(queue().filter((j) => j.operation === "upload_document")).toEqual([]);
    expect(queue().filter((j) => j.operation === "import_drive_file")).toEqual([]);
    expect(queue().filter((j) => j.operation === "rename_document")).toEqual([]);
    expect(documentMappings()[0].sync_status).toBe("synced");
    expect(documentMappings()[0].sync_error ?? null).toBeNull();
  });
});

// ── watch / renovación de canal (Sección 25/34-36/59/60) ─────────────────
describe("Fase 8F — watch: creación y renovación de canal", () => {
  beforeEach(() => {
    setServerRuntimeEnv({ ...ENV, GOOGLE_DRIVE_WEBHOOK_URL: WEBHOOK_URL });
    connection().changes_page_token = "T0";
  });

  it("sin GOOGLE_DRIVE_WEBHOOK_URL configurado -> no crea ningún canal", async () => {
    setServerRuntimeEnv(ENV); // sin webhook URL
    await runGoogleDriveMaintenance();
    expect(channels()).toEqual([]);
  });

  it("crea el primer canal: id único, web_hook, URL configurada, token aleatorio, pageToken presente", async () => {
    await runGoogleDriveMaintenance();
    expect(channels()).toHaveLength(1);
    const watchCall = driveCalls.find((c) => c.url.includes("/changes/watch"));
    expect(watchCall).toBeTruthy();
    expect(watchCall!.url).toContain("pageToken=T0");
    const body = JSON.parse(watchCall!.body ?? "{}");
    expect(body.type).toBe("web_hook");
    expect(body.address).toBe(WEBHOOK_URL);
    expect(typeof body.id).toBe("string");
    expect(body.id.length).toBeGreaterThan(10);
    expect(typeof body.token).toBe("string");
    expect(Number(body.expiration)).toBeLessThanOrEqual(Date.now() + 7 * 24 * 60 * 60 * 1000);
  });

  it("persiste channel_id/resource_id/hash del token/expiration -- NUNCA el token en claro", async () => {
    await runGoogleDriveMaintenance();
    const channel = channels()[0];
    expect(channel.channel_id).toBeTruthy();
    expect(channel.resource_id).toBeTruthy();
    expect(channel.expires_at).toBeTruthy();
    const watchCall = driveCalls.find((c) => c.url.includes("/changes/watch"));
    const plainToken = JSON.parse(watchCall!.body ?? "{}").token as string;
    expect(channel.channel_token_hash).not.toBe(plainToken);
    expect(JSON.stringify(tables)).not.toContain(plainToken);
  });

  it("canal ya vigente (lejos de expirar) -> segunda ejecución NO crea otro canal", async () => {
    await runGoogleDriveMaintenance();
    driveCalls = [];
    await runGoogleDriveMaintenance();
    expect(channels()).toHaveLength(1);
    expect(driveCalls.some((c) => c.url.includes("/changes/watch"))).toBe(false);
  });

  it("Sección 35/60: renovación -- crea el nuevo ANTES de detener el viejo; ambos coexisten un instante; luego intenta stop best-effort", async () => {
    await runGoogleDriveMaintenance();
    const oldChannelId = channels()[0].channel_id;
    // Forzar que el canal existente esté a punto de expirar.
    channels()[0].expires_at = new Date(Date.now() + 60 * 1000).toISOString();
    driveCalls = [];
    await runGoogleDriveMaintenance();

    expect(channels()).toHaveLength(2);
    const oldRow = channels().find((c) => c.channel_id === oldChannelId)!;
    const newRow = channels().find((c) => c.channel_id !== oldChannelId)!;
    expect(oldRow.superseded_at).not.toBeNull(); // el viejo queda superseded, nunca borrado
    expect(newRow.superseded_at).toBeNull();
    expect(stopChannelCalls).toHaveLength(1);
    expect(stopChannelCalls[0].channelId).toBe(oldChannelId);
  });

  it("Sección 35/68: si channels.stop remoto FALLA, el canal nuevo sigue activo (overlap aceptado)", async () => {
    await runGoogleDriveMaintenance();
    channels()[0].expires_at = new Date(Date.now() + 60 * 1000).toISOString();
    stopChannelShouldFail = true;
    const result = await runGoogleDriveMaintenance();
    expect(result.watchEnsured).toBe(true); // el fallo del stop no invalida la renovación
    const current = channels().filter((c) => !c.superseded_at);
    expect(current).toHaveLength(1);
    expect(current[0].channel_id).not.toBe(channels().find((c) => c.superseded_at)?.channel_id);
  });

  // ── recuperación del ciclo de vida del canal (Fase 8F.1 Sección 14-20) ──
  it("L (OBLIGATORIO): canal current YA EXPIRADO (expires_at < now) -> se recupera: crea/supersede/persiste sin unique violation, exactamente 1 current", async () => {
    await runGoogleDriveMaintenance();
    const oldChannelId = channels()[0].channel_id;
    channels()[0].expires_at = new Date(Date.now() - 60 * 1000).toISOString(); // YA expirado, no "próximo a"
    driveCalls = [];
    const result = await runGoogleDriveMaintenance();

    expect(result.watchEnsured).toBe(true);
    const oldRow = channels().find((c) => c.channel_id === oldChannelId)!;
    expect(oldRow.superseded_at).not.toBeNull();
    const current = channels().filter((c) => !c.superseded_at);
    expect(current).toHaveLength(1);
    expect(current[0].channel_id).not.toBe(oldChannelId);
  });

  it("M (OBLIGATORIO): canal current STOPPED pero NO superseded -> se recupera igual, sin esperar a que expire por sí solo", async () => {
    await runGoogleDriveMaintenance();
    const oldChannelId = channels()[0].channel_id;
    // stopped_at fijado (p. ej. lifecycle local futuro) pero superseded_at
    // sigue NULL, y expires_at está MUY lejos -- si "needsNew" dependiera
    // solo de expires_at, esto NUNCA se renovaría.
    channels()[0].stopped_at = new Date().toISOString();
    channels()[0].expires_at = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    driveCalls = [];
    const result = await runGoogleDriveMaintenance();

    expect(result.watchEnsured).toBe(true);
    expect(driveCalls.some((c) => c.url.includes("/changes/watch"))).toBe(true);
    const oldRow = channels().find((c) => c.channel_id === oldChannelId)!;
    expect(oldRow.superseded_at).not.toBeNull();
    const current = channels().filter((c) => !c.superseded_at);
    expect(current).toHaveLength(1);
    expect(current[0].channel_id).not.toBe(oldChannelId);
  });

  it("N: ninguna operación deja nunca más de un canal 'current' lógico (superseded_at IS NULL)", async () => {
    await runGoogleDriveMaintenance();
    channels()[0].expires_at = new Date(Date.now() - 60 * 1000).toISOString();
    await runGoogleDriveMaintenance();
    channels().find((c) => !c.superseded_at)!.expires_at = new Date(
      Date.now() - 60 * 1000,
    ).toISOString();
    await runGoogleDriveMaintenance();

    const currentRows = channels().filter((c) => !c.superseded_at);
    expect(currentRows).toHaveLength(1);
    expect(channels().length).toBeGreaterThanOrEqual(3); // el historial se conserva, nunca se borra
  });

  it("O (OBLIGATORIO, Sección 20): si la rotación en base de datos falla DESPUÉS de que Google ya creó el canal nuevo, A sigue usable -- nunca se detiene", async () => {
    await runGoogleDriveMaintenance();
    const oldChannelId = channels()[0].channel_id;
    const oldResourceId = channels()[0].resource_id;
    channels()[0].expires_at = new Date(Date.now() + 60 * 1000).toISOString();

    forceRotateChannelErrorOnce = "connection reset";
    stopChannelCalls = [];
    const result = await runGoogleDriveMaintenance();

    // El watch se trata como best-effort en runGoogleDriveMaintenance: un
    // fallo aquí nunca debe impedir que el resto del mantenimiento corra.
    expect(result.watchEnsured).toBe(false);
    // A sigue siendo el único canal, intacto: ni superseded ni stopped.
    expect(channels()).toHaveLength(1);
    const stillA = channels()[0];
    expect(stillA.channel_id).toBe(oldChannelId);
    expect(stillA.resource_id).toBe(oldResourceId);
    expect(stillA.superseded_at).toBeNull();
    // NUNCA se intenta detener A -- todavía era el único canal funcional.
    expect(stopChannelCalls).toEqual([]);
  });

  it("O continuación: tras el fallo, el siguiente mantenimiento reintenta la rotación con éxito", async () => {
    await runGoogleDriveMaintenance();
    const oldChannelId = channels()[0].channel_id;
    channels()[0].expires_at = new Date(Date.now() + 60 * 1000).toISOString();
    forceRotateChannelErrorOnce = "connection reset";
    await runGoogleDriveMaintenance();
    expect(channels()).toHaveLength(1); // el fallo no creó nada

    const result = await runGoogleDriveMaintenance();
    expect(result.watchEnsured).toBe(true);
    const current = channels().filter((c) => !c.superseded_at);
    expect(current).toHaveLength(1);
    expect(current[0].channel_id).not.toBe(oldChannelId);
    expect(channels().find((c) => c.channel_id === oldChannelId)?.superseded_at).not.toBeNull();
  });
});

// ── webhook: validación ligera (Sección 28-33/58/61) ──────────────────────
describe("Fase 8F — webhook: validación sin llamar a Google", () => {
  async function seedChannel(overrides: Row = {}) {
    const plainToken = "plaintext-channel-token";
    const hash = await hashGoogleDriveChannelToken(plainToken);
    channels().push({
      id: crypto.randomUUID(),
      connection_id: CONNECTION_ID,
      channel_id: "CHANNEL_1",
      resource_id: "RESOURCE_1",
      channel_token_hash: hash,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      stopped_at: null,
      superseded_at: null,
      ...overrides,
    });
    return plainToken;
  }

  it("Sección 28/61: canal DESCONOCIDO (sync puede llegar antes de que watch persista) -> ignore, nunca error", async () => {
    const action = await handleGoogleDriveWebhookNotification({
      channelId: "NO_EXISTE_TODAVIA",
      channelToken: "cualquiera",
      resourceId: null,
      resourceState: "sync",
    });
    expect(action.kind).toBe("ignore");
  });

  it("Sección 61 completo: sync antes de persistir -> ignore; tras persistir, la siguiente notificación se acepta", async () => {
    const before = await handleGoogleDriveWebhookNotification({
      channelId: "CHANNEL_X",
      channelToken: "t",
      resourceId: null,
      resourceState: "sync",
    });
    expect(before.kind).toBe("ignore");

    const plainToken = await seedChannel({ channel_id: "CHANNEL_X", resource_id: "RESOURCE_X" });
    const after = await handleGoogleDriveWebhookNotification({
      channelId: "CHANNEL_X",
      channelToken: plainToken,
      resourceId: "RESOURCE_X",
      resourceState: "change",
    });
    expect(after.kind).toBe("enqueue_poll");
    expect(queue().some((j) => j.operation === "poll_changes")).toBe(true);
  });

  it("canal válido + token correcto + resource correcto + resourceState=change -> encola poll_changes (deduped)", async () => {
    const plainToken = await seedChannel();
    await handleGoogleDriveWebhookNotification({
      channelId: "CHANNEL_1",
      channelToken: plainToken,
      resourceId: "RESOURCE_1",
      resourceState: "change",
    });
    await handleGoogleDriveWebhookNotification({
      channelId: "CHANNEL_1",
      channelToken: plainToken,
      resourceId: "RESOURCE_1",
      resourceState: "change",
    });
    expect(queue().filter((j) => j.operation === "poll_changes")).toHaveLength(1);
  });

  it("token incorrecto -> reject", async () => {
    await seedChannel();
    const action = await handleGoogleDriveWebhookNotification({
      channelId: "CHANNEL_1",
      channelToken: "token-equivocado",
      resourceId: "RESOURCE_1",
      resourceState: "change",
    });
    expect(action.kind).toBe("reject");
    expect(queue().some((j) => j.operation === "poll_changes")).toBe(false);
  });

  it("resourceId incorrecto -> reject/ignore seguro, nunca encola", async () => {
    const plainToken = await seedChannel();
    const action = await handleGoogleDriveWebhookNotification({
      channelId: "CHANNEL_1",
      channelToken: plainToken,
      resourceId: "RESOURCE_AJENO",
      resourceState: "change",
    });
    expect(action.kind).toBe("reject");
  });

  it("canal stopped -> ignore", async () => {
    const plainToken = await seedChannel({ stopped_at: new Date().toISOString() });
    const action = await handleGoogleDriveWebhookNotification({
      channelId: "CHANNEL_1",
      channelToken: plainToken,
      resourceId: "RESOURCE_1",
      resourceState: "change",
    });
    expect(action.kind).toBe("ignore");
  });

  it("canal expirado -> ignore", async () => {
    const plainToken = await seedChannel({ expires_at: new Date(Date.now() - 1000).toISOString() });
    const action = await handleGoogleDriveWebhookNotification({
      channelId: "CHANNEL_1",
      channelToken: plainToken,
      resourceId: "RESOURCE_1",
      resourceState: "change",
    });
    expect(action.kind).toBe("ignore");
  });

  it("resourceState=sync -> ignore, NUNCA encola (Sección 31/58)", async () => {
    const plainToken = await seedChannel();
    const action = await handleGoogleDriveWebhookNotification({
      channelId: "CHANNEL_1",
      channelToken: plainToken,
      resourceId: "RESOURCE_1",
      resourceState: "sync",
    });
    expect(action.kind).toBe("ignore");
    expect(queue().some((j) => j.operation === "poll_changes")).toBe(false);
  });

  it("resourceState desconocido/futuro -> ignore, nunca error (Sección 31/58)", async () => {
    const plainToken = await seedChannel();
    const action = await handleGoogleDriveWebhookNotification({
      channelId: "CHANNEL_1",
      channelToken: plainToken,
      resourceId: "RESOURCE_1",
      resourceState: "algo-nuevo-que-google-invente-despues",
    });
    expect(action.kind).toBe("ignore");
  });

  it("nunca llama a Google desde la validación del webhook", async () => {
    const plainToken = await seedChannel();
    driveCalls = [];
    await handleGoogleDriveWebhookNotification({
      channelId: "CHANNEL_1",
      channelToken: plainToken,
      resourceId: "RESOURCE_1",
      resourceState: "change",
    });
    expect(driveCalls).toEqual([]);
  });
});

// ── reconciliación (Sección 38-48/62/63) ──────────────────────────────────
describe("Fase 8F — reconciliación: red de seguridad", () => {
  it("Cliente sin carpeta de Drive -> encola ensure_client_folder", async () => {
    clientFolders().length = 0; // este Cliente pierde su mapping
    const summary = await runGoogleDriveReconciliation();
    expect(summary.claimed).toBe(true);
    expect(summary.clientFoldersEnsured).toBe(1);
    expect(
      queue().some((j) => j.operation === "ensure_client_folder" && j.client_id === CLIENT_ID),
    ).toBe(true);
  });

  it("documento con Cliente pero sin mapping, procedencia normal del CRM -> encola upload_document", async () => {
    documents().push({
      id: DOC_ID,
      client_id: CLIENT_ID,
      name: "contrato.pdf",
      source_provider: "supabase_storage",
    });
    const summary = await runGoogleDriveReconciliation();
    expect(summary.documentsUploaded).toBe(1);
    expect(queue().some((j) => j.operation === "upload_document" && j.document_id === DOC_ID)).toBe(
      true,
    );
  });

  it("documento con source_provider=google_drive sin mapping -> NUNCA duplicado outbound", async () => {
    documents().push({
      id: DOC_ID,
      client_id: CLIENT_ID,
      name: "contrato.pdf",
      source_provider: "google_drive",
      external_file_id: null, // sin identidad Drive conocida: nada que reparar
      content_hash: "sha256x",
    });
    const summary = await runGoogleDriveReconciliation();
    expect(summary.documentsUploaded).toBe(0);
    expect(queue().some((j) => j.operation === "upload_document")).toBe(false);
  });

  it("Sección 16: documento google_drive con mapping perdido pero identidad EXACTA -> repara automáticamente", async () => {
    documents().push({
      id: DOC_ID,
      client_id: CLIENT_ID,
      name: "contrato.pdf",
      source_provider: "google_drive",
      external_file_id: FILE_ID,
      content_hash: "sha256x",
    });
    driveFiles.set(FILE_ID, {
      id: FILE_ID,
      name: "contrato.pdf",
      mimeType: "application/pdf",
      parents: [FOLDER_ID],
    });
    const summary = await runGoogleDriveReconciliation();
    expect(summary.mappingsRepaired).toBeGreaterThanOrEqual(1);
    expect(
      documentMappings().some((m) => m.document_id === DOC_ID && m.drive_file_id === FILE_ID),
    ).toBe(true);
    expect(queue().some((j) => j.operation === "upload_document")).toBe(false);
  });

  it("archivo manual (sin appProperties) dentro de una carpeta de Cliente -> encola import_drive_file", async () => {
    driveFiles.set(FILE_ID, {
      id: FILE_ID,
      name: "manual.pdf",
      mimeType: "application/pdf",
      parents: [FOLDER_ID],
    });
    const summary = await runGoogleDriveReconciliation();
    expect(summary.filesImported).toBe(1);
    expect(
      queue().some((j) => j.operation === "import_drive_file" && j.drive_file_id === FILE_ID),
    ).toBe(true);
  });

  it("subcarpeta dentro de la carpeta de Cliente -> NUNCA se importa (sin recursión)", async () => {
    driveFiles.set("SUBCARPETA", {
      id: "SUBCARPETA",
      name: "Expediente 2025",
      mimeType: FOLDER_MIME,
      parents: [FOLDER_ID],
    });
    const summary = await runGoogleDriveReconciliation();
    expect(summary.filesImported).toBe(0);
    expect(queue().some((j) => j.operation === "import_drive_file")).toBe(false);
  });

  it("archivo con appProperties gestionadas cuyo mapping falta, identidad EXACTA -> repara vía el escaneo de la carpeta", async () => {
    documents().push({ id: DOC_ID, client_id: CLIENT_ID, name: "contrato.pdf", content_hash: "h" });
    driveFiles.set(FILE_ID, {
      id: FILE_ID,
      name: "contrato.pdf",
      mimeType: "application/pdf",
      parents: [FOLDER_ID],
      appProperties: { crm_entity: "document", crm_document_id: DOC_ID, crm_client_id: CLIENT_ID },
    });
    const summary = await runGoogleDriveReconciliation();
    expect(summary.mappingsRepaired).toBe(1);
    expect(documentMappings().some((m) => m.document_id === DOC_ID)).toBe(true);
    expect(queue().some((j) => j.operation === "import_drive_file")).toBe(false);
  });

  it("Sección 63 (OBLIGATORIO): documento borrado en el CRM, Drive AÚN tiene appProperties.crm_entity=document -> huérfano reportado, 0 documents, 0 import, 0 auto-trash", async () => {
    const deletedDocId = "99999999-0000-0000-0000-000000000099";
    driveFiles.set(FILE_ID, {
      id: FILE_ID,
      name: "contrato.pdf",
      mimeType: "application/pdf",
      parents: [FOLDER_ID],
      appProperties: {
        crm_entity: "document",
        crm_document_id: deletedDocId,
        crm_client_id: CLIENT_ID,
      },
    });
    const summary = await runGoogleDriveReconciliation();
    expect(summary.orphanDriveFileIds).toContain(FILE_ID);
    expect(documents()).toEqual([]);
    expect(queue().some((j) => j.operation === "import_drive_file")).toBe(false);
    expect(documentMappings()).toEqual([]);
    // Nunca se llama trashDriveFile ni files.delete -- solo lecturas (y el
    // refresco del access token, que no toca ningún archivo).
    expect(
      driveCalls.every(
        (c) => c.method === "GET" || c.url.startsWith("https://oauth2.googleapis.com/"),
      ),
    ).toBe(true);
  });

  it("Sección 42 (OBLIGATORIO): archivo mapeado movido FUERA de toda carpeta de Cliente -> conflict/DRIVE_PARENT_MISMATCH", async () => {
    documents().push({ id: DOC_ID, client_id: CLIENT_ID, name: "contrato.pdf" });
    documentMappings().push({
      id: "map-1",
      document_id: DOC_ID,
      connection_id: CONNECTION_ID,
      drive_file_id: FILE_ID,
      last_synced_file_name: "contrato.pdf",
      last_synced_drive_parent_id: FOLDER_ID,
      last_synced_drive_md5_checksum: "abc123",
      last_synced_drive_version: 1,
      sync_status: "synced",
    });
    driveFiles.set(FILE_ID, {
      id: FILE_ID,
      name: "contrato.pdf",
      mimeType: "application/pdf",
      parents: ["FUERA_DE_TODO"], // ya no cuelga de ninguna carpeta de Cliente
      md5Checksum: "abc123",
      version: "1",
    });
    await runGoogleDriveReconciliation();
    expect(documentMappings()[0].sync_status).toBe("conflict");
    expect(documentMappings()[0].sync_error).toBe("DRIVE_PARENT_MISMATCH");
  });

  it("archivo mapeado que ya NO existe en Drive -> missing/DRIVE_FILE_REMOVED_OR_ACCESS_LOST", async () => {
    documents().push({ id: DOC_ID, client_id: CLIENT_ID, name: "contrato.pdf" });
    documentMappings().push({
      id: "map-1",
      document_id: DOC_ID,
      connection_id: CONNECTION_ID,
      drive_file_id: "FILE_QUE_YA_NO_EXISTE",
      last_synced_file_name: "contrato.pdf",
      last_synced_drive_parent_id: FOLDER_ID,
      sync_status: "synced",
    });
    await runGoogleDriveReconciliation();
    expect(documentMappings()[0].sync_status).toBe("missing");
    expect(documentMappings()[0].sync_error).toBe("DRIVE_FILE_REMOVED_OR_ACCESS_LOST");
  });

  it("un solo reconciliation activo por conexión: la segunda llamada concurrente no repite el trabajo", async () => {
    connection().reconciliation_claimed_at = new Date().toISOString(); // ya reclamado por "otro proceso"
    const summary = await runGoogleDriveReconciliation();
    expect(summary.claimed).toBe(false);
    expect(rpcCalls.some((c) => c.name === "complete_google_drive_reconciliation")).toBe(false);
  });

  it("nunca avanza changes_page_token (Sección 48: mecanismos independientes)", async () => {
    connection().changes_page_token = "T0";
    documents().push({
      id: DOC_ID,
      client_id: CLIENT_ID,
      name: "contrato.pdf",
      source_provider: "supabase_storage",
    });
    await runGoogleDriveReconciliation();
    expect(connection().changes_page_token).toBe("T0");
  });

  it("marca last_reconciled_at al completar con éxito", async () => {
    expect(connection().last_reconciled_at).toBeNull();
    await runGoogleDriveReconciliation();
    expect(connection().last_reconciled_at).not.toBeNull();
  });
});
