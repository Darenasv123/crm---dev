import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildChildFoldersQuery,
  buildFolderListSearchParams,
  DRIVE_FOLDER_MIME_TYPE,
  escapeDriveQueryValue,
  getDriveFolder,
  listChildDriveFolders,
  MAX_DRIVE_FOLDER_PAGES,
} from "@/lib/google-drive/drive-folders";
import { DriveError } from "@/lib/google-drive/drive-errors";

/**
 * Fase 8C — capa REST de carpetas de Drive. Todo el HTTP de Google está
 * mockeado: estas pruebas jamás salen a internet ni tocan una cuenta real.
 */

const ACCESS_TOKEN = "test-access-token";

type FetchCall = { url: string; init?: RequestInit };
let calls: FetchCall[] = [];

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Encola respuestas en orden; cada fetch consume la siguiente. */
function mockResponses(...responses: Response[]) {
  const queue = [...responses];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const next = queue.shift();
      if (!next) throw new Error("fetch inesperado: no quedan respuestas mockeadas.");
      return next;
    }),
  );
}

function folderResource(id: string, name: string, extra: Record<string, unknown> = {}) {
  return { id, name, mimeType: DRIVE_FOLDER_MIME_TYPE, trashed: false, ...extra };
}

beforeEach(() => {
  calls = [];
});
afterEach(() => vi.unstubAllGlobals());

describe("Fase 8C — construcción de la query de carpetas", () => {
  it("pide solo hijos directos, solo carpetas y solo no borradas", () => {
    const query = buildChildFoldersQuery("PARENT_1");
    expect(query).toContain("'PARENT_1' in parents");
    expect(query).toContain(`mimeType = '${DRIVE_FOLDER_MIME_TYPE}'`);
    expect(query).toContain("trashed = false");
  });

  it("escapa comillas simples y barras invertidas para que un id no pueda inyectar cláusulas", () => {
    const hostile = "abc' or name contains 'x";
    const escaped = escapeDriveQueryValue(hostile);
    // La comilla que cerraría la cadena queda escapada.
    expect(escaped).not.toBe(hostile);
    expect(escaped.includes("\\'")).toBe(true);
    const query = buildChildFoldersQuery(hostile);
    // La query resultante conserva exactamente una apertura y un cierre de
    // cadena alrededor del id, sin comillas libres en medio.
    expect(query.startsWith("'abc\\' or name contains \\'x' in parents")).toBe(true);
  });

  it("escapa también la barra invertida antes que la comilla", () => {
    expect(escapeDriveQueryValue("a\\b")).toBe("a\\\\b");
  });

  it("en Mi unidad no envía corpora/driveId, pero sí supportsAllDrives", () => {
    const params = buildFolderListSearchParams({ parentId: "P" });
    expect(params.get("supportsAllDrives")).toBe("true");
    expect(params.get("corpora")).toBeNull();
    expect(params.get("driveId")).toBeNull();
    expect(params.get("includeItemsFromAllDrives")).toBeNull();
    expect(params.get("orderBy")).toBe("name");
  });

  it("con Unidad compartida añade corpora=drive, driveId e includeItemsFromAllDrives", () => {
    const params = buildFolderListSearchParams({ parentId: "P", sharedDriveId: "SHARED_1" });
    expect(params.get("corpora")).toBe("drive");
    expect(params.get("driveId")).toBe("SHARED_1");
    expect(params.get("includeItemsFromAllDrives")).toBe("true");
    expect(params.get("supportsAllDrives")).toBe("true");
  });

  it("pide únicamente los campos mínimos: ni permissions, ni owners, ni description", () => {
    const fields = buildFolderListSearchParams({ parentId: "P" }).get("fields") ?? "";
    expect(fields).toContain("id");
    expect(fields).toContain("name");
    expect(fields).toContain("parents");
    expect(fields).not.toContain("permissions");
    expect(fields).not.toContain("owners");
    expect(fields).not.toContain("description");
  });
});

describe("Fase 8C — listChildDriveFolders", () => {
  it("devuelve las carpetas ordenadas por nombre", async () => {
    mockResponses(
      jsonResponse({ files: [folderResource("2", "Zulema"), folderResource("1", "Ana")] }),
    );
    const folders = await listChildDriveFolders(ACCESS_TOKEN, "ROOT");
    expect(folders.map((f) => f.name)).toEqual(["Ana", "Zulema"]);
  });

  it("recorre TODAS las páginas y ordena el conjunto completo, no cada página por separado", async () => {
    mockResponses(
      jsonResponse({ files: [folderResource("1", "Beatriz")], nextPageToken: "page-2" }),
      jsonResponse({ files: [folderResource("2", "Ana")] }),
    );
    const folders = await listChildDriveFolders(ACCESS_TOKEN, "ROOT");
    expect(folders.map((f) => f.name)).toEqual(["Ana", "Beatriz"]);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).not.toContain("pageToken");
    expect(calls[1].url).toContain("pageToken=page-2");
  });

  it("nunca asume un máximo de 100 carpetas: agrega los resultados de varias páginas", async () => {
    const first = Array.from({ length: 120 }, (_, i) =>
      folderResource(`a${i}`, `A-${String(i).padStart(3, "0")}`),
    );
    const second = Array.from({ length: 30 }, (_, i) =>
      folderResource(`b${i}`, `B-${String(i).padStart(3, "0")}`),
    );
    mockResponses(
      jsonResponse({ files: first, nextPageToken: "p2" }),
      jsonResponse({ files: second }),
    );
    const folders = await listChildDriveFolders(ACCESS_TOKEN, "ROOT");
    expect(folders).toHaveLength(150);
  });

  it("falla de forma explícita si Google devuelve tokens de página sin fin, en vez de colgarse o truncar", async () => {
    const endless = Array.from({ length: MAX_DRIVE_FOLDER_PAGES + 1 }, () =>
      jsonResponse({ files: [folderResource("x", "X")], nextPageToken: "siempre" }),
    );
    mockResponses(...endless);
    await expect(listChildDriveFolders(ACCESS_TOKEN, "ROOT")).rejects.toThrow(
      /demasiadas páginas/i,
    );
    expect(calls).toHaveLength(MAX_DRIVE_FOLDER_PAGES);
  });

  it("descarta lo que no sea carpeta o esté en la papelera aunque Google lo devuelva", async () => {
    mockResponses(
      jsonResponse({
        files: [
          folderResource("1", "Carpeta buena"),
          { id: "2", name: "Documento.pdf", mimeType: "application/pdf", trashed: false },
          folderResource("3", "Borrada", { trashed: true }),
        ],
      }),
    );
    const folders = await listChildDriveFolders(ACCESS_TOKEN, "ROOT");
    expect(folders.map((f) => f.id)).toEqual(["1"]);
  });

  it("envía el access token como Bearer y nunca en la URL", async () => {
    mockResponses(jsonResponse({ files: [] }));
    await listChildDriveFolders(ACCESS_TOKEN, "ROOT");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(calls[0].url).not.toContain(ACCESS_TOKEN);
  });
});

describe("Fase 8C — getDriveFolder", () => {
  it("devuelve la carpeta con sus padres cuando es válida", async () => {
    mockResponses(jsonResponse(folderResource("F1", "Clientes", { parents: ["ROOT"] })));
    const folder = await getDriveFolder(ACCESS_TOKEN, "F1");
    expect(folder).toMatchObject({ id: "F1", name: "Clientes", parents: ["ROOT"] });
  });

  it("rechaza un archivo normal que no es carpeta", async () => {
    mockResponses(
      jsonResponse({ id: "F1", name: "Contrato.pdf", mimeType: "application/pdf", trashed: false }),
    );
    await expect(getDriveFolder(ACCESS_TOKEN, "F1")).rejects.toMatchObject({
      code: "DRIVE_FOLDER_NOT_FOUND",
    });
  });

  it("rechaza una carpeta en la papelera con su propio código", async () => {
    mockResponses(jsonResponse(folderResource("F1", "Vieja", { trashed: true })));
    await expect(getDriveFolder(ACCESS_TOKEN, "F1")).rejects.toMatchObject({
      code: "DRIVE_FOLDER_TRASHED",
    });
  });

  it("convierte el 404 de Google en DRIVE_FOLDER_NOT_FOUND, sin filtrar su cuerpo", async () => {
    mockResponses(
      jsonResponse({ error: { message: "File not found: secreto-interno-de-google" } }, 404),
    );
    const failure = await getDriveFolder(ACCESS_TOKEN, "F1").catch((cause) => cause);
    expect(failure).toBeInstanceOf(DriveError);
    expect(failure.code).toBe("DRIVE_FOLDER_NOT_FOUND");
    expect(failure.message).not.toContain("secreto-interno-de-google");
  });

  it("no filtra el cuerpo de Google en un error genérico (500)", async () => {
    mockResponses(jsonResponse({ error: { message: "detalle-interno-del-proyecto" } }, 500));
    const failure = await getDriveFolder(ACCESS_TOKEN, "F1").catch((cause) => cause);
    expect(String(failure.message)).not.toContain("detalle-interno-del-proyecto");
    expect(String(failure.message)).toContain("500");
  });

  it("usa supportsAllDrives también al consultar una carpeta concreta", async () => {
    mockResponses(jsonResponse(folderResource("F1", "Clientes")));
    await getDriveFolder(ACCESS_TOKEN, "F1");
    expect(calls[0].url).toContain("supportsAllDrives=true");
  });
});
