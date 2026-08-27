import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getGoogleDriveStartPageToken,
  listGoogleDriveChangesPage,
  watchGoogleDriveChanges,
} from "@/lib/google-drive/drive-changes";

/**
 * Fase 8F.1 — auditoría exacta de los parámetros REST de la Change API de
 * Drive. Cada endpoint de Drive documenta un conjunto DISTINTO de query
 * params válidos -- copiar ciegamente los de uno a otro produce peticiones
 * con parámetros inventados que Google puede (o no) tolerar hoy, pero que
 * no forman parte del contrato real de la API.
 *
 * Todo el HTTP está mockeado: estas pruebas nunca salen a internet.
 */

const TOKEN = "test-access-token";

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function mockSequence(...responses: Response[]) {
  const queue = [...responses];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const next = queue.shift();
      if (!next) throw new Error("fetch inesperado: sin respuestas mockeadas");
      return next;
    }),
  );
}

function paramsOf(url: string) {
  return new URLSearchParams(url.split("?")[1] ?? "");
}

beforeEach(() => {
  calls = [];
});
afterEach(() => vi.unstubAllGlobals());

// ── changes/startPageToken (Fase 8F.1 Sección 3) ──────────────────────────
describe("Fase 8F.1 — getGoogleDriveStartPageToken: params exactos", () => {
  it("Mi unidad: supportsAllDrives=true, SIN driveId, SIN includeItemsFromAllDrives", async () => {
    mockSequence(response({ startPageToken: "T0" }));
    await getGoogleDriveStartPageToken(TOKEN);
    const params = paramsOf(calls[0].url);
    expect(calls[0].url).toContain("/drive/v3/changes/startPageToken");
    expect(params.get("supportsAllDrives")).toBe("true");
    expect(params.has("driveId")).toBe(false);
    expect(params.has("includeItemsFromAllDrives")).toBe(false);
  });

  it("Unidad compartida: supportsAllDrives=true + driveId, SIN includeItemsFromAllDrives", async () => {
    mockSequence(response({ startPageToken: "T0" }));
    await getGoogleDriveStartPageToken(TOKEN, { sharedDriveId: "SHARED_1" });
    const params = paramsOf(calls[0].url);
    expect(params.get("supportsAllDrives")).toBe("true");
    expect(params.get("driveId")).toBe("SHARED_1");
    // Negativo, OBLIGATORIO (Fase 8F.1 Sección 25): este parámetro no existe
    // en changes/startPageToken -- nunca debe reaparecer aquí.
    expect(params.has("includeItemsFromAllDrives")).toBe(false);
    expect(calls[0].url).not.toContain("includeItemsFromAllDrives");
  });

  it("nunca pide pageToken/includeRemoved/fields -- eso es de changes.list, no de startPageToken", async () => {
    mockSequence(response({ startPageToken: "T0" }));
    await getGoogleDriveStartPageToken(TOKEN, { sharedDriveId: "SHARED_1" });
    const params = paramsOf(calls[0].url);
    expect(params.has("pageToken")).toBe(false);
    expect(params.has("includeRemoved")).toBe(false);
    expect(params.has("fields")).toBe(false);
  });
});

// ── changes.list (Fase 8F.1 Sección 4) ────────────────────────────────────
describe("Fase 8F.1 — listGoogleDriveChangesPage: params exactos", () => {
  it("Mi unidad: pageToken + includeRemoved=true + supportsAllDrives=true, SIN driveId", async () => {
    mockSequence(response({ changes: [] }));
    await listGoogleDriveChangesPage(TOKEN, "T0");
    const params = paramsOf(calls[0].url);
    expect(calls[0].url).toContain("/drive/v3/changes?");
    expect(params.get("pageToken")).toBe("T0");
    expect(params.get("includeRemoved")).toBe("true");
    expect(params.get("supportsAllDrives")).toBe("true");
    expect(params.has("driveId")).toBe(false);
    expect(params.has("includeItemsFromAllDrives")).toBe(false);
  });

  it("Unidad compartida: además driveId + includeItemsFromAllDrives=true", async () => {
    mockSequence(response({ changes: [] }));
    await listGoogleDriveChangesPage(TOKEN, "T0", { sharedDriveId: "SHARED_1" });
    const params = paramsOf(calls[0].url);
    expect(params.get("driveId")).toBe("SHARED_1");
    expect(params.get("includeItemsFromAllDrives")).toBe("true");
  });

  it("pide fields mínimos, nunca owners/permissions completas", async () => {
    mockSequence(response({ changes: [] }));
    await listGoogleDriveChangesPage(TOKEN, "T0");
    const params = paramsOf(calls[0].url);
    const fields = params.get("fields") ?? "";
    expect(fields).toContain("newStartPageToken");
    expect(fields).not.toMatch(/\bowners\b/);
    expect(fields).not.toMatch(/\bpermissions\b/);
  });

  it("distinto de startPageToken: SÍ lleva pageToken/includeRemoved/fields (a propósito, Sección 4)", async () => {
    mockSequence(response({ startPageToken: "T0" }), response({ changes: [] }));
    await getGoogleDriveStartPageToken(TOKEN);
    await listGoogleDriveChangesPage(TOKEN, "T0");
    const startParams = paramsOf(calls[0].url);
    const listParams = paramsOf(calls[1].url);
    expect(startParams.has("pageToken")).toBe(false);
    expect(listParams.has("pageToken")).toBe(true);
    expect(startParams.has("fields")).toBe(false);
    expect(listParams.has("fields")).toBe(true);
  });
});

// ── changes.watch (Fase 8F.1 Sección 5) ───────────────────────────────────
describe("Fase 8F.1 — watchGoogleDriveChanges: params exactos", () => {
  const baseInput = {
    pageToken: "T0",
    channelId: "CHAN_1",
    channelToken: "token-plano",
    webhookUrl: "https://crm.example/api/google-drive/webhook",
    expiresAtMs: Date.now() + 60_000,
  };

  it("Mi unidad: pageToken + includeRemoved + supportsAllDrives en la query; SIN driveId", async () => {
    mockSequence(response({ resourceId: "RES_1", expiration: null }));
    await watchGoogleDriveChanges(TOKEN, baseInput);
    const params = paramsOf(calls[0].url);
    expect(calls[0].url).toContain("/drive/v3/changes/watch?");
    expect(params.get("pageToken")).toBe("T0");
    expect(params.get("includeRemoved")).toBe("true");
    expect(params.get("supportsAllDrives")).toBe("true");
    expect(params.has("driveId")).toBe(false);
    expect(params.has("includeItemsFromAllDrives")).toBe(false);
  });

  it("Unidad compartida: además driveId + includeItemsFromAllDrives=true", async () => {
    mockSequence(response({ resourceId: "RES_1", expiration: null }));
    await watchGoogleDriveChanges(TOKEN, baseInput, { sharedDriveId: "SHARED_1" });
    const params = paramsOf(calls[0].url);
    expect(params.get("driveId")).toBe("SHARED_1");
    expect(params.get("includeItemsFromAllDrives")).toBe("true");
  });

  it("el body POST lleva id/type=web_hook/address/token/expiration -- nunca en la query", async () => {
    mockSequence(response({ resourceId: "RES_1", expiration: null }));
    await watchGoogleDriveChanges(TOKEN, baseInput);
    const params = paramsOf(calls[0].url);
    expect(params.has("token")).toBe(false);
    expect(params.has("address")).toBe(false);
    const body = JSON.parse(String(calls[0].init?.body ?? "{}"));
    expect(body).toMatchObject({
      id: "CHAN_1",
      type: "web_hook",
      address: baseInput.webhookUrl,
      token: "token-plano",
    });
  });

  it("nunca copia fields/pageSize de changes.list -- watch no lista, solo suscribe", async () => {
    mockSequence(response({ resourceId: "RES_1", expiration: null }));
    await watchGoogleDriveChanges(TOKEN, baseInput);
    const params = paramsOf(calls[0].url);
    expect(params.has("fields")).toBe(false);
    expect(params.has("pageSize")).toBe(false);
  });
});
