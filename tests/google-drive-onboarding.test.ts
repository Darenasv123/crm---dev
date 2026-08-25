import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fase 8C — carpeta raíz y onboarding Cliente <-> Carpeta.
 *
 * Todo Google está mockeado con un "Drive falso" en memoria y Supabase con
 * un cliente falso: estas pruebas nunca salen a internet, nunca tocan una
 * cuenta real y nunca escriben en una base de datos.
 */

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/auth-server", () => ({ requireUser: mocks.requireUser }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

import { setServerRuntimeEnv } from "@/lib/server-runtime-env";
import {
  applyGoogleDriveClientFolderMappings,
  assertValidDriveFolderId,
  browseGoogleDriveFolders,
  encryptToken,
  googleDriveOnboardingPreview,
  parseOnboardingMappings,
  setGoogleDriveRootFolder,
} from "@/lib/google-drive/google-drive.server";

const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
const ROOT_ID = "ROOT_CLIENTES";
const CONNECTION_ID = "conn-1";
const ADMIN_ID = "admin-1";

const ENV = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  SUPABASE_ANON_KEY: "anon-key",
  GOOGLE_DRIVE_CLIENT_ID: "drive-client-id",
  GOOGLE_DRIVE_CLIENT_SECRET: "drive-client-secret",
  GOOGLE_DRIVE_REDIRECT_URI: "https://crm.example/api/google-drive/callback",
  GOOGLE_TOKEN_ENCRYPTION_KEY: "clave-de-cifrado-de-pruebas-32-bytes",
  GOOGLE_OAUTH_STATE_SECRET: "secreto-de-state-de-pruebas",
};

// ── Drive falso en memoria ───────────────────────────────────────────────
type FakeFile = {
  id: string;
  name: string;
  mimeType?: string;
  parents?: string[];
  trashed?: boolean;
  driveId?: string;
};

let driveFiles: FakeFile[] = [];
let driveRequests: string[] = [];

function fakeDriveFetch(url: string) {
  driveRequests.push(url);
  if (url.startsWith("https://oauth2.googleapis.com/token")) {
    return jsonOk({ access_token: "fresh-access-token", expires_in: 3600 });
  }
  const filesMatch = /\/drive\/v3\/files\/([^?]+)/.exec(url);
  if (filesMatch) {
    const id = decodeURIComponent(filesMatch[1]);
    const file = driveFiles.find((candidate) => candidate.id === id);
    if (!file) return jsonOk({ error: { message: "not found" } }, 404);
    return jsonOk({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType ?? DRIVE_FOLDER_MIME,
      parents: file.parents ?? [],
      trashed: file.trashed ?? false,
      ...(file.driveId ? { driveId: file.driveId } : {}),
    });
  }
  const query = new URL(url).searchParams.get("q") ?? "";
  const parentMatch = /^'(.*?)' in parents/.exec(query);
  const parentId = parentMatch ? parentMatch[1] : "";
  const children = driveFiles.filter(
    (file) =>
      (file.parents ?? []).includes(parentId) &&
      (file.mimeType ?? DRIVE_FOLDER_MIME) === DRIVE_FOLDER_MIME &&
      !file.trashed,
  );
  return jsonOk({
    files: children.map((file) => ({
      id: file.id,
      name: file.name,
      mimeType: DRIVE_FOLDER_MIME,
      parents: file.parents,
      trashed: false,
    })),
  });
}

function jsonOk(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

// ── Supabase falso ───────────────────────────────────────────────────────
type DbState = {
  profile: { role: string; status: string } | null;
  connection: Record<string, unknown> | null;
  mappings: Array<{ client_id: string; drive_folder_id: string }>;
  clients: Array<{ id: string; name: string }>;
  rpcResult: { data?: unknown; error?: { message: string } | null };
};

let db: DbState;
let updates: Array<{ table: string; values: Record<string, unknown> }>;
let rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;

function makeFakeSupabase() {
  return {
    from(table: string) {
      const ctx: { op: string; values?: Record<string, unknown> } = { op: "select" };
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      Object.assign(builder, {
        select: () => chain(),
        order: () => chain(),
        eq: () => chain(),
        in: () => chain(),
        gt: () => chain(),
        update(values: Record<string, unknown>) {
          ctx.op = "update";
          ctx.values = values;
          updates.push({ table, values });
          return chain();
        },
        single: async () => resolve(table, ctx.op, "single"),
        maybeSingle: async () => resolve(table, ctx.op, "maybeSingle"),
        then: (onFulfilled: (value: unknown) => unknown, onRejected?: (r: unknown) => unknown) =>
          Promise.resolve(resolve(table, ctx.op, "many")).then(onFulfilled, onRejected),
      });
      return builder;
    },
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      return Promise.resolve(db.rpcResult);
    },
  };
}

function resolve(table: string, op: string, shape: string) {
  if (op === "update") return { data: null, error: null };
  if (table === "profiles")
    return { data: db.profile, error: db.profile ? null : { message: "x" } };
  if (table === "google_drive_connections") {
    return { data: db.connection, error: null };
  }
  if (table === "google_drive_client_folders") {
    // head+count para el chequeo de "¿hay mappings?"; lista para el preview.
    if (shape === "many") {
      return { data: db.mappings, count: db.mappings.length, error: null };
    }
    return { data: null, count: db.mappings.length, error: null };
  }
  if (table === "clients") return { data: db.clients, error: null };
  return { data: null, error: null };
}

// ── setup ────────────────────────────────────────────────────────────────
const adminRequest = () =>
  new Request("https://crm.example/api/google-drive/folders", {
    headers: { authorization: "Bearer session-token" },
  });

async function connectedConnection(overrides: Record<string, unknown> = {}) {
  return {
    id: CONNECTION_ID,
    connected_by: ADMIN_ID,
    google_account_email: "estudio@example.com",
    encrypted_refresh_token: await encryptToken("refresh-token-de-pruebas"),
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
  driveRequests = [];
  updates = [];
  rpcCalls = [];
  driveFiles = [
    { id: ROOT_ID, name: "Clientes", parents: ["root"] },
    { id: "F_ANA", name: "Ana Torres", parents: [ROOT_ID] },
    { id: "F_MARIA", name: "maria lopez", parents: [ROOT_ID] },
    { id: "F_HUERFANA", name: "Documentación interna", parents: [ROOT_ID] },
    // Nieta de la raíz: NO es candidata a cliente.
    { id: "F_SUB", name: "Expediente", parents: ["F_ANA"] },
  ];
  db = {
    profile: { role: "Administrador", status: "Activo" },
    connection: await connectedConnection(),
    mappings: [],
    clients: [],
    rpcResult: { data: { created: 0, unchanged: 0 }, error: null },
  };
  mocks.requireUser.mockResolvedValue({ id: ADMIN_ID });
  mocks.createClient.mockImplementation(() => makeFakeSupabase());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => fakeDriveFetch(String(url))),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  setServerRuntimeEnv({});
});

// ── validación de folderId ───────────────────────────────────────────────
describe("Fase 8C — validación del identificador de carpeta", () => {
  it("acepta un id normal y recorta espacios", () => {
    expect(assertValidDriveFolderId("  F_ANA  ")).toBe("F_ANA");
  });

  it("rechaza vacío, no-string, demasiado largo y con saltos de línea", () => {
    expect(() => assertValidDriveFolderId("")).toThrow();
    expect(() => assertValidDriveFolderId(undefined)).toThrow();
    expect(() => assertValidDriveFolderId("a".repeat(257))).toThrow();
    expect(() => assertValidDriveFolderId("F_ANA\nX-Injected: 1")).toThrow();
    expect(() => assertValidDriveFolderId("F_ANA\r\n")).toThrow();
  });
});

// ── permisos ─────────────────────────────────────────────────────────────
describe("Fase 8C — permisos: solo Administrador activo", () => {
  it("Personal recibe un rechazo al navegar carpetas", async () => {
    db.profile = { role: "Personal", status: "Activo" };
    await expect(browseGoogleDriveFolders(adminRequest())).rejects.toThrow(/permiso/i);
  });

  it("un Administrador desactivado recibe un rechazo", async () => {
    db.profile = { role: "Administrador", status: "Inactivo" };
    await expect(browseGoogleDriveFolders(adminRequest())).rejects.toThrow(/permiso/i);
  });

  it("Personal no puede fijar la carpeta raíz", async () => {
    db.profile = { role: "Personal", status: "Activo" };
    await expect(setGoogleDriveRootFolder(adminRequest(), ROOT_ID)).rejects.toThrow(/permiso/i);
  });

  it("Personal no puede aplicar vinculaciones", async () => {
    db.profile = { role: "Personal", status: "Activo" };
    await expect(
      applyGoogleDriveClientFolderMappings(adminRequest(), [
        { clientId: "c1", driveFolderId: "F_ANA", matchType: "manual" },
      ]),
    ).rejects.toThrow(/permiso/i);
  });

  it("sin conexión activa devuelve DRIVE_NOT_CONNECTED", async () => {
    db.connection = null;
    await expect(browseGoogleDriveFolders(adminRequest())).rejects.toMatchObject({
      code: "DRIVE_NOT_CONNECTED",
    });
  });

  it("sin variables de servidor devuelve DRIVE_NOT_CONFIGURED", async () => {
    setServerRuntimeEnv({ ...ENV, GOOGLE_DRIVE_CLIENT_ID: "" });
    await expect(browseGoogleDriveFolders(adminRequest())).rejects.toMatchObject({
      code: "DRIVE_NOT_CONFIGURED",
    });
  });
});

// ── navegador de carpetas ────────────────────────────────────────────────
describe("Fase 8C — navegador de carpetas", () => {
  it("sin parentId abre Mi unidad y no expone un id real como raíz", async () => {
    const listing = await browseGoogleDriveFolders(adminRequest());
    expect(listing.current).toEqual({ id: "root", name: "Mi unidad", parentId: null });
    expect(listing.folders.map((f) => f.name)).toEqual(["Clientes"]);
  });

  it("con parentId devuelve el padre REAL de Google para poder subir un nivel", async () => {
    const listing = await browseGoogleDriveFolders(adminRequest(), "F_ANA");
    expect(listing.current).toMatchObject({ id: "F_ANA", name: "Ana Torres", parentId: ROOT_ID });
    expect(listing.folders.map((f) => f.id)).toEqual(["F_SUB"]);
  });

  it("nunca devuelve el access token ni campos crudos de Google", async () => {
    const listing = await browseGoogleDriveFolders(adminRequest(), ROOT_ID);
    const serialized = JSON.stringify(listing);
    expect(serialized).not.toContain("fresh-access-token");
    expect(serialized).not.toContain("mimeType");
    expect(serialized).not.toContain("trashed");
    expect(Object.keys(listing.folders[0]).sort()).toEqual(["driveId", "id", "name"]);
  });
});

// ── carpeta raíz ─────────────────────────────────────────────────────────
describe("Fase 8C — selección de carpeta raíz", () => {
  it("persiste el nombre REAL de Google, ignorando cualquier nombre del frontend", async () => {
    db.connection = await connectedConnection({ root_folder_id: null, root_folder_name: null });
    const result = await setGoogleDriveRootFolder(adminRequest(), ROOT_ID);
    expect(result.rootFolderName).toBe("Clientes");
    expect(rpcCalls[0].name).toBe("set_google_drive_root_folder");
    expect(rpcCalls[0].args).toMatchObject({
      p_new_root_folder_id: ROOT_ID,
      p_new_root_folder_name: "Clientes",
    });
  });

  // Fase 8C.1: la escritura ya no puede hacerse con un UPDATE suelto, porque
  // eso deja abierta la ventana entre validar en Google y escribir.
  it("escribe por la RPC serializada, nunca con un UPDATE directo a la conexión", async () => {
    db.connection = await connectedConnection({ root_folder_id: null });
    await setGoogleDriveRootFolder(adminRequest(), ROOT_ID);
    const rootWrites = updates.filter(
      (u) => u.table === "google_drive_connections" && "root_folder_id" in u.values,
    );
    expect(rootWrites).toEqual([]);
    expect(rpcCalls.map((call) => call.name)).toContain("set_google_drive_root_folder");
  });

  it("envía la raíz que leyó al empezar, para que la RPC detecte si cambió entre medias", async () => {
    await setGoogleDriveRootFolder(adminRequest(), ROOT_ID);
    expect(rpcCalls[0].args.p_expected_current_root_folder_id).toBe(ROOT_ID);
  });

  it("traduce DRIVE_ROOT_CHANGED_RETRY de la RPC a su código estable", async () => {
    db.rpcResult = { error: { message: "error: DRIVE_ROOT_CHANGED_RETRY (SQLSTATE P0001)" } };
    await expect(setGoogleDriveRootFolder(adminRequest(), ROOT_ID)).rejects.toMatchObject({
      code: "DRIVE_ROOT_CHANGED_RETRY",
    });
  });

  it("rechaza un id que no corresponde a ninguna carpeta", async () => {
    db.connection = await connectedConnection({ root_folder_id: null });
    await expect(setGoogleDriveRootFolder(adminRequest(), "NO_EXISTE")).rejects.toMatchObject({
      code: "DRIVE_FOLDER_NOT_FOUND",
    });
  });

  it("rechaza un archivo que no es carpeta", async () => {
    db.connection = await connectedConnection({ root_folder_id: null });
    driveFiles.push({ id: "ARCHIVO", name: "Contrato.pdf", mimeType: "application/pdf" });
    await expect(setGoogleDriveRootFolder(adminRequest(), "ARCHIVO")).rejects.toMatchObject({
      code: "DRIVE_FOLDER_NOT_FOUND",
    });
  });

  it("rechaza una carpeta en la papelera", async () => {
    db.connection = await connectedConnection({ root_folder_id: null });
    driveFiles.push({ id: "PAPELERA", name: "Antiguo", trashed: true });
    await expect(setGoogleDriveRootFolder(adminRequest(), "PAPELERA")).rejects.toMatchObject({
      code: "DRIVE_FOLDER_TRASHED",
    });
  });

  // El bloqueo real lo aplica la RPC bajo FOR UPDATE (verificado contra
  // PostgreSQL); aquí se comprueba que la ruta propaga su código sin
  // convertirlo en un 500 genérico.
  it("propaga ROOT_FOLDER_HAS_EXISTING_MAPPINGS cuando la RPC lo rechaza", async () => {
    db.rpcResult = {
      error: { message: "error: ROOT_FOLDER_HAS_EXISTING_MAPPINGS (SQLSTATE P0001)" },
    };
    driveFiles.push({ id: "OTRA_RAIZ", name: "Otra", parents: ["root"] });
    await expect(setGoogleDriveRootFolder(adminRequest(), "OTRA_RAIZ")).rejects.toMatchObject({
      code: "ROOT_FOLDER_HAS_EXISTING_MAPPINGS",
    });
  });

  it("volver a elegir la MISMA raíz se reporta como sin cambios", async () => {
    db.rpcResult = {
      data: { rootFolderId: ROOT_ID, rootFolderName: "Clientes", unchanged: true },
      error: null,
    };
    const result = await setGoogleDriveRootFolder(adminRequest(), ROOT_ID);
    expect(result.unchanged).toBe(true);
    expect(result.rootFolderName).toBe("Clientes");
  });

  it("nunca crea carpetas ni sube archivos al fijar la raíz", async () => {
    db.connection = await connectedConnection({ root_folder_id: null });
    await setGoogleDriveRootFolder(adminRequest(), ROOT_ID);
    const fetchMock = globalThis.fetch as unknown as { mock: { calls: unknown[][] } };
    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit | undefined;
      const method = (init?.method ?? "GET").toUpperCase();
      const url = String(call[0]);
      // La única petición no-GET permitida es el refresco del access token.
      if (method !== "GET") expect(url).toContain("oauth2.googleapis.com/token");
    }
  });
});

// ── preview ──────────────────────────────────────────────────────────────
describe("Fase 8C — vista previa del onboarding", () => {
  beforeEach(() => {
    db.clients = [
      { id: "c-ana", name: "Ana Torres" },
      { id: "c-maria", name: "María López" },
      { id: "c-sin", name: "Carlos Ramos" },
    ];
  });

  it("clasifica exacta, normalizada, sin carpeta y carpeta huérfana", async () => {
    const preview = await googleDriveOnboardingPreview(adminRequest());
    expect(preview.suggested).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ clientId: "c-ana", folderId: "F_ANA", matchType: "exact" }),
        expect.objectContaining({
          clientId: "c-maria",
          folderId: "F_MARIA",
          matchType: "normalized",
        }),
      ]),
    );
    expect(preview.clientsWithoutFolder).toEqual([
      { clientId: "c-sin", clientName: "Carlos Ramos" },
    ]);
    expect(preview.foldersWithoutClient.map((f) => f.id)).toEqual(["F_HUERFANA"]);
  });

  it("una coincidencia exacta NO se muestra como ya vinculada: exige confirmación", async () => {
    const preview = await googleDriveOnboardingPreview(adminRequest());
    expect(preview.linked).toEqual([]);
    expect(preview.suggested.some((entry) => entry.clientId === "c-ana")).toBe(true);
  });

  it("un mapping ya persistido aparece como vinculado y no se reclasifica", async () => {
    db.mappings = [{ client_id: "c-ana", drive_folder_id: "F_ANA" }];
    const preview = await googleDriveOnboardingPreview(adminRequest());
    expect(preview.linked).toEqual([
      { clientId: "c-ana", clientName: "Ana Torres", folderId: "F_ANA", folderName: "Ana Torres" },
    ]);
    expect(preview.suggested.some((entry) => entry.clientId === "c-ana")).toBe(false);
  });

  it("marca como ambiguo cuando dos carpetas normalizan igual", async () => {
    driveFiles.push({ id: "F_DUP1", name: "Pedro Ruiz ", parents: [ROOT_ID] });
    driveFiles.push({ id: "F_DUP2", name: "PEDRO RUIZ", parents: [ROOT_ID] });
    db.clients = [{ id: "c-pedro", name: "Pedro Ruiz" }];
    const preview = await googleDriveOnboardingPreview(adminRequest());
    expect(preview.ambiguous).toHaveLength(1);
    expect(preview.ambiguous[0].candidates.map((c) => c.id).sort()).toEqual(["F_DUP1", "F_DUP2"]);
  });

  it("no considera clientes a las nietas de la raíz", async () => {
    const preview = await googleDriveOnboardingPreview(adminRequest());
    const allFolderIds = [
      ...preview.suggested.map((e) => e.folderId),
      ...preview.foldersWithoutClient.map((f) => f.id),
      ...preview.availableFolders.map((f) => f.id),
    ];
    expect(allFolderIds).not.toContain("F_SUB");
  });

  it("es de solo lectura: no escribe en Supabase ni llama a ninguna RPC", async () => {
    await googleDriveOnboardingPreview(adminRequest());
    // El único update permitido es el de access_token_expires_at al refrescar.
    for (const update of updates) {
      expect(Object.keys(update.values)).toEqual(["access_token_expires_at"]);
    }
    expect(rpcCalls).toEqual([]);
  });

  it("falla con DRIVE_ROOT_NOT_CONFIGURED si todavía no hay raíz", async () => {
    db.connection = await connectedConnection({ root_folder_id: null });
    await expect(googleDriveOnboardingPreview(adminRequest())).rejects.toMatchObject({
      code: "DRIVE_ROOT_NOT_CONFIGURED",
    });
  });
});

// ── validación del lote ──────────────────────────────────────────────────
describe("Fase 8C — validación del lote de vinculaciones", () => {
  it("rechaza un lote vacío", () => {
    expect(() => parseOnboardingMappings([])).toThrow(/al menos una/i);
  });

  it("rechaza matchType 'created': esta fase nunca crea carpetas", () => {
    expect(() =>
      parseOnboardingMappings([{ clientId: "c1", driveFolderId: "F1", matchType: "created" }]),
    ).toThrow(/coincidencia/i);
  });

  it("acepta exact, normalized y manual", () => {
    const parsed = parseOnboardingMappings([
      { clientId: "c1", driveFolderId: "F1", matchType: "exact" },
      { clientId: "c2", driveFolderId: "F2", matchType: "normalized" },
      { clientId: "c3", driveFolderId: "F3", matchType: "manual" },
    ]);
    expect(parsed).toHaveLength(3);
  });

  it("rechaza un cliente repetido en el mismo lote", () => {
    expect(() =>
      parseOnboardingMappings([
        { clientId: "c1", driveFolderId: "F1", matchType: "manual" },
        { clientId: "c1", driveFolderId: "F2", matchType: "manual" },
      ]),
    ).toThrow(/cliente repetido/i);
  });

  it("rechaza asignar la misma carpeta a dos clientes en el mismo lote", () => {
    expect(() =>
      parseOnboardingMappings([
        { clientId: "c1", driveFolderId: "F1", matchType: "manual" },
        { clientId: "c2", driveFolderId: "F1", matchType: "manual" },
      ]),
    ).toThrow(/carpeta repetida/i);
  });
});

// ── apply ────────────────────────────────────────────────────────────────
describe("Fase 8C — aplicar vinculaciones", () => {
  beforeEach(() => {
    db.clients = [
      { id: "c-ana", name: "Ana Torres" },
      { id: "c-maria", name: "María López" },
    ];
  });

  it("revalida contra Google y guarda el nombre que devuelve Google, no el del frontend", async () => {
    db.rpcResult = { data: { created: 1, unchanged: 0 }, error: null };
    await applyGoogleDriveClientFolderMappings(adminRequest(), [
      { clientId: "c-ana", driveFolderId: "F_ANA", matchType: "exact" },
    ]);
    const mappings = rpcCalls[0].args.p_mappings as Array<Record<string, unknown>>;
    expect(mappings[0]).toMatchObject({
      client_id: "c-ana",
      drive_folder_id: "F_ANA",
      drive_folder_name_snapshot: "Ana Torres",
      match_type: "exact",
    });
    expect(rpcCalls[0].args.p_linked_by).toBe(ADMIN_ID);
  });

  it("rechaza una carpeta que ya no está dentro de la raíz configurada", async () => {
    driveFiles = driveFiles.map((file) =>
      file.id === "F_ANA" ? { ...file, parents: ["OTRA_CARPETA"] } : file,
    );
    await expect(
      applyGoogleDriveClientFolderMappings(adminRequest(), [
        { clientId: "c-ana", driveFolderId: "F_ANA", matchType: "exact" },
      ]),
    ).rejects.toMatchObject({ code: "DRIVE_FOLDER_OUTSIDE_ROOT" });
    expect(rpcCalls).toEqual([]);
  });

  it("rechaza una carpeta borrada entre el preview y el apply", async () => {
    driveFiles = driveFiles.filter((file) => file.id !== "F_ANA");
    await expect(
      applyGoogleDriveClientFolderMappings(adminRequest(), [
        { clientId: "c-ana", driveFolderId: "F_ANA", matchType: "exact" },
      ]),
    ).rejects.toMatchObject({ code: "DRIVE_FOLDER_NOT_FOUND" });
    expect(rpcCalls).toEqual([]);
  });

  it("rechaza una carpeta enviada a la papelera entre el preview y el apply", async () => {
    driveFiles = driveFiles.map((file) =>
      file.id === "F_ANA" ? { ...file, trashed: true } : file,
    );
    await expect(
      applyGoogleDriveClientFolderMappings(adminRequest(), [
        { clientId: "c-ana", driveFolderId: "F_ANA", matchType: "exact" },
      ]),
    ).rejects.toMatchObject({ code: "DRIVE_FOLDER_TRASHED" });
  });

  it("rechaza un cliente que ya no existe, sin gastar llamadas a Google", async () => {
    driveRequests = [];
    await expect(
      applyGoogleDriveClientFolderMappings(adminRequest(), [
        { clientId: "c-borrado", driveFolderId: "F_ANA", matchType: "manual" },
      ]),
    ).rejects.toThrow(/ya no existe/i);
    expect(driveRequests.filter((url) => url.includes("/drive/v3/files"))).toEqual([]);
  });

  it("un lote de 3 con uno inválido no persiste ninguna vinculación", async () => {
    driveFiles = driveFiles.map((file) =>
      file.id === "F_MARIA" ? { ...file, parents: ["FUERA"] } : file,
    );
    await expect(
      applyGoogleDriveClientFolderMappings(adminRequest(), [
        { clientId: "c-ana", driveFolderId: "F_ANA", matchType: "exact" },
        { clientId: "c-maria", driveFolderId: "F_MARIA", matchType: "normalized" },
      ]),
    ).rejects.toMatchObject({ code: "DRIVE_FOLDER_OUTSIDE_ROOT" });
    expect(rpcCalls).toEqual([]);
  });

  it("traduce CLIENT_ALREADY_LINKED de la RPC a su código estable", async () => {
    db.rpcResult = { error: { message: "error: CLIENT_ALREADY_LINKED (SQLSTATE P0001)" } };
    await expect(
      applyGoogleDriveClientFolderMappings(adminRequest(), [
        { clientId: "c-ana", driveFolderId: "F_ANA", matchType: "exact" },
      ]),
    ).rejects.toMatchObject({ code: "CLIENT_ALREADY_LINKED" });
  });

  it("traduce DRIVE_FOLDER_ALREADY_LINKED de la RPC a su código estable", async () => {
    db.rpcResult = { error: { message: "error: DRIVE_FOLDER_ALREADY_LINKED (SQLSTATE P0001)" } };
    await expect(
      applyGoogleDriveClientFolderMappings(adminRequest(), [
        { clientId: "c-ana", driveFolderId: "F_ANA", matchType: "exact" },
      ]),
    ).rejects.toMatchObject({ code: "DRIVE_FOLDER_ALREADY_LINKED" });
  });

  it("nunca filtra el texto crudo de PostgreSQL en un error desconocido", async () => {
    db.rpcResult = { error: { message: "PG: relation secreta_interna does not exist" } };
    const failure = await applyGoogleDriveClientFolderMappings(adminRequest(), [
      { clientId: "c-ana", driveFolderId: "F_ANA", matchType: "exact" },
    ]).catch((cause) => cause);
    expect(String(failure.message)).not.toContain("secreta_interna");
  });

  it("repetir exactamente el mismo mapping se reporta como idempotente, no como error", async () => {
    db.rpcResult = { data: { created: 0, unchanged: 1 }, error: null };
    const result = await applyGoogleDriveClientFolderMappings(adminRequest(), [
      { clientId: "c-ana", driveFolderId: "F_ANA", matchType: "exact" },
    ]);
    expect(result).toEqual({ created: 0, unchanged: 1 });
  });
});

// ── Fase 8C.1: raíz esperada + match_type derivado en servidor ───────────
describe("Fase 8C.1 — apply: la raíz validada viaja a la RPC", () => {
  beforeEach(() => {
    db.clients = [{ id: "c-ana", name: "Ana Torres" }];
  });

  it("envía p_expected_root_folder_id con la raíz contra la que validó las carpetas", async () => {
    await applyGoogleDriveClientFolderMappings(adminRequest(), [
      { clientId: "c-ana", driveFolderId: "F_ANA", matchType: "exact" },
    ]);
    const call = rpcCalls.find((c) => c.name === "apply_google_drive_client_folder_mappings");
    expect(call?.args.p_expected_root_folder_id).toBe(ROOT_ID);
  });

  it("traduce DRIVE_ROOT_CHANGED_RETRY de la RPC a su código estable", async () => {
    db.rpcResult = { error: { message: "error: DRIVE_ROOT_CHANGED_RETRY (SQLSTATE P0001)" } };
    await expect(
      applyGoogleDriveClientFolderMappings(adminRequest(), [
        { clientId: "c-ana", driveFolderId: "F_ANA", matchType: "exact" },
      ]),
    ).rejects.toMatchObject({ code: "DRIVE_ROOT_CHANGED_RETRY" });
  });
});

describe("Fase 8C.1 — match_type: el servidor lo deriva, no confía en el navegador", () => {
  beforeEach(() => {
    db.clients = [{ id: "c-ana", name: "Ana Torres" }];
  });

  function persistedMatchType() {
    const call = rpcCalls.find((c) => c.name === "apply_google_drive_client_folder_mappings");
    const mappings = (call?.args.p_mappings ?? []) as Array<Record<string, unknown>>;
    return mappings[0]?.match_type;
  }

  it("el navegador dice exact pero el nombre real solo coincide normalizado: guarda normalized", async () => {
    // La carpeta se renombró entre el preview y el guardado.
    driveFiles = driveFiles.map((file) =>
      file.id === "F_ANA" ? { ...file, name: "ana torres" } : file,
    );
    await applyGoogleDriveClientFolderMappings(adminRequest(), [
      { clientId: "c-ana", driveFolderId: "F_ANA", matchType: "exact" },
    ]);
    expect(persistedMatchType()).toBe("normalized");
  });

  it("el navegador dice normalized pero el nombre es idéntico: guarda exact", async () => {
    await applyGoogleDriveClientFolderMappings(adminRequest(), [
      { clientId: "c-ana", driveFolderId: "F_ANA", matchType: "normalized" },
    ]);
    expect(persistedMatchType()).toBe("exact");
  });

  it("la sugerencia dejó de coincidir (carpeta renombrada a otra cosa): MATCH_CHANGED_REVIEW", async () => {
    driveFiles = driveFiles.map((file) =>
      file.id === "F_ANA" ? { ...file, name: "Carpeta sin relación" } : file,
    );
    await expect(
      applyGoogleDriveClientFolderMappings(adminRequest(), [
        { clientId: "c-ana", driveFolderId: "F_ANA", matchType: "exact" },
      ]),
    ).rejects.toMatchObject({ code: "MATCH_CHANGED_REVIEW" });
    expect(rpcCalls).toEqual([]);
  });

  it("la sugerencia se volvió ambigua (dos carpetas normalizan igual): MATCH_CHANGED_REVIEW", async () => {
    // Ninguna coincide ya exactamente con "Ana Torres" -- si una lo hiciera,
    // el clasificador de 8A la resolvería sin ambigüedad, que es su regla
    // documentada. Ambas normalizan igual, así que no hay forma de elegir.
    driveFiles = driveFiles.map((file) =>
      file.id === "F_ANA" ? { ...file, name: "ana torres" } : file,
    );
    driveFiles.push({ id: "F_ANA_2", name: "ANA TORRES", parents: [ROOT_ID] });
    await expect(
      applyGoogleDriveClientFolderMappings(adminRequest(), [
        { clientId: "c-ana", driveFolderId: "F_ANA", matchType: "exact" },
      ]),
    ).rejects.toMatchObject({ code: "MATCH_CHANGED_REVIEW" });
  });

  it("la sugerencia apunta ahora a OTRA carpeta que la del navegador: MATCH_CHANGED_REVIEW", async () => {
    driveFiles.push({ id: "F_IMPOSTORA", name: "Ana Torres", parents: [ROOT_ID] });
    driveFiles = driveFiles.map((file) =>
      file.id === "F_ANA" ? { ...file, name: "Otro nombre" } : file,
    );
    await expect(
      applyGoogleDriveClientFolderMappings(adminRequest(), [
        { clientId: "c-ana", driveFolderId: "F_ANA", matchType: "exact" },
      ]),
    ).rejects.toMatchObject({ code: "MATCH_CHANGED_REVIEW" });
  });

  it("manual con nombres totalmente distintos SÍ se permite y se guarda como manual", async () => {
    driveFiles.push({ id: "F_LIBRE", name: "Carpeta cualquiera", parents: [ROOT_ID] });
    await applyGoogleDriveClientFolderMappings(adminRequest(), [
      { clientId: "c-ana", driveFolderId: "F_LIBRE", matchType: "manual" },
    ]);
    expect(persistedMatchType()).toBe("manual");
  });

  it("manual NO exime de integridad: una carpeta fuera de la raíz sigue rechazada", async () => {
    driveFiles.push({ id: "F_FUERA", name: "Fuera", parents: ["OTRA_RAIZ"] });
    await expect(
      applyGoogleDriveClientFolderMappings(adminRequest(), [
        { clientId: "c-ana", driveFolderId: "F_FUERA", matchType: "manual" },
      ]),
    ).rejects.toMatchObject({ code: "DRIVE_FOLDER_OUTSIDE_ROOT" });
  });

  it("manual NO exime de integridad: una carpeta en la papelera sigue rechazada", async () => {
    driveFiles.push({ id: "F_BASURA", name: "Basura", parents: [ROOT_ID], trashed: true });
    await expect(
      applyGoogleDriveClientFolderMappings(adminRequest(), [
        { clientId: "c-ana", driveFolderId: "F_BASURA", matchType: "manual" },
      ]),
    ).rejects.toMatchObject({ code: "DRIVE_FOLDER_TRASHED" });
  });

  it("un lote solo-manual no gasta una llamada extra listando la raíz", async () => {
    driveFiles.push({ id: "F_LIBRE", name: "Carpeta cualquiera", parents: [ROOT_ID] });
    driveRequests = [];
    await applyGoogleDriveClientFolderMappings(adminRequest(), [
      { clientId: "c-ana", driveFolderId: "F_LIBRE", matchType: "manual" },
    ]);
    const listings = driveRequests.filter(
      (url) => url.includes("q=") && url.includes("in+parents"),
    );
    expect(listings).toEqual([]);
  });
});
