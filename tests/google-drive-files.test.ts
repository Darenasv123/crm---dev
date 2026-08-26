import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMultipartBody,
  classifyDriveFailure,
  createDriveFileWithContent,
  createDriveFolder,
  downloadDriveFileBounded,
  DRIVE_RESUMABLE_THRESHOLD_BYTES,
  DriveDownloadSizeMismatchError,
  DriveDownloadStreamUnavailableError,
  DriveDownloadTooLargeError,
  DriveHttpError,
  generateDriveIds,
  getDriveFile,
  isRetryableDriveFailure,
  parseDriveDeclaredSize,
  queryResumableUploadStatus,
  renameDriveFile,
  trashDriveFile,
} from "@/lib/google-drive/drive-files";
import {
  buildDriveClientFolderAppProperties,
  buildDriveDocumentAppProperties,
  matchesClientFolderIdentity,
  matchesDocumentIdentity,
} from "@/lib/google-drive/drive-app-properties";

/**
 * Fase 8D — primitivas REST de escritura en Drive. Todo el HTTP de Google
 * está mockeado: estas pruebas nunca salen a internet ni tocan una cuenta
 * real.
 */

const TOKEN = "test-access-token";

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];

function response(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
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
      // Fase 8D.1: un elemento de la cola puede ser un Error (simula un
      // fallo de red real, donde fetch rechaza en vez de resolver).
      if (next instanceof Error) throw next;
      return next;
    }),
  );
}

beforeEach(() => {
  calls = [];
});
afterEach(() => vi.unstubAllGlobals());

// ── appProperties ────────────────────────────────────────────────────────
describe("Fase 8D — appProperties: solo IDs internos", () => {
  it("carpeta de cliente lleva la entidad y el id de cliente, nada más", () => {
    expect(buildDriveClientFolderAppProperties("client-1")).toEqual({
      crm_entity: "client_folder",
      crm_client_id: "client-1",
    });
  });

  it("documento lleva entidad, documento y cliente, nada más", () => {
    expect(buildDriveDocumentAppProperties("doc-1", "client-1")).toEqual({
      crm_entity: "document",
      crm_document_id: "doc-1",
      crm_client_id: "client-1",
    });
  });

  it("nunca incluye nombre, DNI, teléfono, correo, materia ni expediente", () => {
    const values = [
      ...Object.keys(buildDriveClientFolderAppProperties("c")),
      ...Object.keys(buildDriveDocumentAppProperties("d", "c")),
    ].join(" ");
    for (const forbidden of ["name", "nombre", "dni", "phone", "email", "materia", "expediente"]) {
      expect(values).not.toContain(forbidden);
    }
  });

  it("la comprobación de identidad rechaza una carpeta de otro cliente", () => {
    const props = buildDriveClientFolderAppProperties("client-1");
    expect(matchesClientFolderIdentity(props, "client-1")).toBe(true);
    expect(matchesClientFolderIdentity(props, "client-2")).toBe(false);
    expect(matchesClientFolderIdentity(undefined, "client-1")).toBe(false);
  });

  it("la comprobación de identidad de documento exige documento Y cliente", () => {
    const props = buildDriveDocumentAppProperties("doc-1", "client-1");
    expect(matchesDocumentIdentity(props, "doc-1", "client-1")).toBe(true);
    expect(matchesDocumentIdentity(props, "doc-2", "client-1")).toBe(false);
    expect(matchesDocumentIdentity(props, "doc-1", "client-2")).toBe(false);
  });

  it("un documento no puede hacerse pasar por carpeta ni al revés", () => {
    expect(matchesClientFolderIdentity(buildDriveDocumentAppProperties("d", "c"), "c")).toBe(false);
    expect(matchesDocumentIdentity(buildDriveClientFolderAppProperties("c"), "d", "c")).toBe(false);
  });
});

// ── generateIds ──────────────────────────────────────────────────────────
describe("Fase 8D — generateIds", () => {
  it("pide la cantidad indicada en el espacio drive", async () => {
    mockSequence(response({ ids: ["ID_1", "ID_2"] }));
    const ids = await generateDriveIds(TOKEN, 2);
    expect(ids).toEqual(["ID_1", "ID_2"]);
    expect(calls[0].url).toContain("generateIds");
    expect(calls[0].url).toContain("count=2");
    expect(calls[0].url).toContain("space=drive");
  });

  it("rechaza si Google devuelve menos ids de los pedidos", async () => {
    mockSequence(response({ ids: ["ID_1"] }));
    await expect(generateDriveIds(TOKEN, 2)).rejects.toThrow(/cantidad/i);
  });

  it("rechaza un id vacío", async () => {
    mockSequence(response({ ids: ["  "] }));
    await expect(generateDriveIds(TOKEN, 1)).rejects.toThrow(/vacío/i);
  });

  it("rechaza cantidades absurdas sin llamar a Google", async () => {
    mockSequence();
    await expect(generateDriveIds(TOKEN, 0)).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

// ── crear carpeta ────────────────────────────────────────────────────────
describe("Fase 8D — createDriveFolder con ID reservado", () => {
  it("envía el ID reservado, el padre y las appProperties", async () => {
    mockSequence(response({ id: "RESERVED_1", name: "Ana Torres" }));
    await createDriveFolder(TOKEN, {
      id: "RESERVED_1",
      name: "Ana Torres",
      parentId: "ROOT",
      appProperties: buildDriveClientFolderAppProperties("client-1"),
    });
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body).toMatchObject({
      id: "RESERVED_1",
      name: "Ana Torres",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["ROOT"],
      appProperties: { crm_entity: "client_folder", crm_client_id: "client-1" },
    });
    expect(calls[0].url).toContain("supportsAllDrives=true");
  });

  it("propaga el 409 para que quien llama lo reconcilie, sin filtrar el cuerpo", async () => {
    mockSequence(response({ error: { message: "duplicado-interno-google" } }, 409));
    const failure = await createDriveFolder(TOKEN, {
      id: "RESERVED_1",
      name: "x",
      parentId: "ROOT",
      appProperties: {},
    }).catch((cause) => cause);
    expect(failure).toBeInstanceOf(DriveHttpError);
    expect(failure.status).toBe(409);
    expect(String(failure.message)).not.toContain("duplicado-interno-google");
  });
});

// ── get ──────────────────────────────────────────────────────────────────
describe("Fase 8D — getDriveFile", () => {
  it("devuelve null en 404 en vez de lanzar", async () => {
    mockSequence(response({}, 404));
    expect(await getDriveFile(TOKEN, "X")).toBeNull();
  });

  it("pide appProperties y trashed, pero nunca permissions ni owners", async () => {
    mockSequence(response({ id: "X", name: "x" }));
    await getDriveFile(TOKEN, "X");
    expect(calls[0].url).toContain("appProperties");
    expect(calls[0].url).toContain("trashed");
    expect(calls[0].url).not.toContain("permissions");
    expect(calls[0].url).not.toContain("owners");
  });
});

// ── subida ───────────────────────────────────────────────────────────────
describe("Fase 8D — subida: multipart vs resumable", () => {
  const smallContent = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xfe, 0x80]);

  it("un archivo pequeño usa multipart en una sola petición", async () => {
    mockSequence(response({ id: "F1", name: "a.pdf" }));
    await createDriveFileWithContent(TOKEN, {
      id: "F1",
      name: "a.pdf",
      parentId: "FOLDER",
      mimeType: "application/pdf",
      appProperties: buildDriveDocumentAppProperties("d1", "c1"),
      content: smallContent,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("uploadType=multipart");
    expect(calls[0].url).toContain("supportsAllDrives=true");
  });

  it("un archivo grande usa resumable: init, Location y PUT de los bytes", async () => {
    const big = new Uint8Array(DRIVE_RESUMABLE_THRESHOLD_BYTES + 1);
    big[0] = 0xff;
    mockSequence(
      response({}, 200, { location: "https://upload.example/session-123" }),
      response({ id: "F1", name: "grande.pdf" }),
    );
    await createDriveFileWithContent(TOKEN, {
      id: "F1",
      name: "grande.pdf",
      parentId: "FOLDER",
      mimeType: "application/pdf",
      appProperties: {},
      content: big,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain("uploadType=resumable");
    const initHeaders = calls[0].init?.headers as Record<string, string>;
    expect(initHeaders["x-upload-content-length"]).toBe(String(big.length));
    expect(calls[1].url).toBe("https://upload.example/session-123");
    expect(calls[1].init?.method).toBe("PUT");
  });

  it("si resumable no devuelve Location falla en vez de subir a ciegas", async () => {
    const big = new Uint8Array(DRIVE_RESUMABLE_THRESHOLD_BYTES + 1);
    mockSequence(response({}, 200, {}));
    await expect(
      createDriveFileWithContent(TOKEN, {
        id: "F1",
        name: "g.pdf",
        parentId: "F",
        mimeType: "application/pdf",
        appProperties: {},
        content: big,
      }),
    ).rejects.toThrow(/sesión de subida/i);
  });

  it("el umbral es exactamente 5 MB: justo en el límite sigue siendo multipart", async () => {
    mockSequence(response({ id: "F1", name: "x" }));
    await createDriveFileWithContent(TOKEN, {
      id: "F1",
      name: "x",
      parentId: "F",
      mimeType: "application/pdf",
      appProperties: {},
      content: new Uint8Array(DRIVE_RESUMABLE_THRESHOLD_BYTES),
    });
    expect(calls[0].url).toContain("uploadType=multipart");
  });
});

describe("Fase 8D — integridad binaria del cuerpo multipart", () => {
  it("los bytes no-UTF8 se copian intactos, sin pasar por string", () => {
    // Secuencias que una conversión a string destruiría (0xFF/0xFE no son
    // UTF-8 válido y acabarían como U+FFFD).
    const content = new Uint8Array([0x00, 0xff, 0xfe, 0x80, 0x7f, 0xc3, 0x28]);
    const body = buildMultipartBody({ id: "F1" }, content, "application/pdf", "BOUNDARY");
    // El contenido aparece literal en el cuerpo, byte a byte.
    let found = -1;
    for (let i = 0; i + content.length <= body.length; i += 1) {
      if (content.every((byte, offset) => body[i + offset] === byte)) {
        found = i;
        break;
      }
    }
    expect(found).toBeGreaterThan(-1);
  });

  it("incluye la metadata como JSON y cierra el separador correctamente", () => {
    const body = buildMultipartBody({ id: "F1" }, new Uint8Array([1]), "application/pdf", "BND");
    const text = new TextDecoder().decode(body);
    expect(text).toContain("--BND\r\n");
    expect(text).toContain('{"id":"F1"}');
    expect(text.endsWith("\r\n--BND--\r\n")).toBe(true);
  });
});

// ── rename / trash ───────────────────────────────────────────────────────
describe("Fase 8D — rename y papelera", () => {
  it("renombrar hace PATCH solo del nombre y nunca toca parents", async () => {
    mockSequence(response({ id: "F1", name: "nuevo.pdf" }));
    await renameDriveFile(TOKEN, "F1", "nuevo.pdf");
    expect(calls[0].init?.method).toBe("PATCH");
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body).toEqual({ name: "nuevo.pdf" });
    expect(body.parents).toBeUndefined();
  });

  it("la papelera es un PATCH trashed:true, nunca un DELETE", async () => {
    mockSequence(response({ id: "F1", name: "x", trashed: true }));
    await trashDriveFile(TOKEN, "F1");
    expect(calls[0].init?.method).toBe("PATCH");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ trashed: true });
    expect(calls[0].init?.method).not.toBe("DELETE");
  });

  it("el módulo no expone ninguna operación de borrado definitivo", async () => {
    const module = await import("@/lib/google-drive/drive-files");
    const names = Object.keys(module).join(" ").toLowerCase();
    expect(names).not.toContain("delete");
    expect(names).toContain("trash");
  });
});

// ── clasificación de errores ─────────────────────────────────────────────
describe("Fase 8D — clasificación de fallos de Drive", () => {
  it("clasifica por status, sin mirar el cuerpo", () => {
    expect(classifyDriveFailure(new DriveHttpError(401))).toBe("auth");
    expect(classifyDriveFailure(new DriveHttpError(403))).toBe("permission");
    expect(classifyDriveFailure(new DriveHttpError(404))).toBe("missing");
    expect(classifyDriveFailure(new DriveHttpError(409))).toBe("conflict");
    expect(classifyDriveFailure(new DriveHttpError(429))).toBe("transient");
    expect(classifyDriveFailure(new DriveHttpError(503))).toBe("transient");
    expect(classifyDriveFailure(new DriveHttpError(400))).toBe("fatal");
  });

  it("un fallo de red se trata como transitorio", () => {
    expect(classifyDriveFailure(new TypeError("network"))).toBe("transient");
    expect(isRetryableDriveFailure(new TypeError("network"))).toBe(true);
  });

  it("permisos e identidad NO se reintentan; cuota y 5xx sí", () => {
    expect(isRetryableDriveFailure(new DriveHttpError(403))).toBe(false);
    expect(isRetryableDriveFailure(new DriveHttpError(409))).toBe(false);
    expect(isRetryableDriveFailure(new DriveHttpError(429))).toBe(true);
    expect(isRetryableDriveFailure(new DriveHttpError(500))).toBe(true);
  });
});

// ── Fase 8D.1 — recuperación de subida resumable ─────────────────────────
describe("Fase 8D.1 — queryResumableUploadStatus: sondeo con PUT vacío", () => {
  const SESSION_URL = "https://upload.example/SECRET-SESSION-TOKEN-DO-NOT-LEAK";

  it("200/201: la subida ya se completó", async () => {
    mockSequence(response({ id: "F1", name: "x" }, 200));
    const status = await queryResumableUploadStatus(SESSION_URL, 1000);
    expect(status).toEqual({ kind: "complete", resource: { id: "F1", name: "x" } });
    expect(calls[0].init?.headers).toMatchObject({ "content-range": "bytes */1000" });
    expect(calls[0].init?.headers).toMatchObject({ "content-length": "0" });
    expect(calls[0].init?.method).toBe("PUT");
  });

  it("308 con Range: retoma justo después del último byte confirmado", async () => {
    mockSequence(response({}, 308, { range: "bytes=0-1023" }));
    const status = await queryResumableUploadStatus(SESSION_URL, 5000);
    expect(status).toEqual({ kind: "incomplete", nextOffset: 1024 });
  });

  it("308 sin Range: no se confirmó ningún byte, se retoma desde 0", async () => {
    mockSequence(response({}, 308, {}));
    const status = await queryResumableUploadStatus(SESSION_URL, 5000);
    expect(status).toEqual({ kind: "incomplete", nextOffset: 0 });
  });

  it("404: la sesión caducó", async () => {
    mockSequence(response({}, 404));
    expect(await queryResumableUploadStatus(SESSION_URL, 5000)).toEqual({ kind: "expired" });
  });

  it("429: transitorio, se propaga como DriveHttpError reintentable", async () => {
    mockSequence(response({}, 429));
    const failure = await queryResumableUploadStatus(SESSION_URL, 5000).catch((c) => c);
    expect(failure).toBeInstanceOf(DriveHttpError);
    expect(failure.status).toBe(429);
    expect(isRetryableDriveFailure(failure)).toBe(true);
  });

  it("5xx: transitorio, se propaga como DriveHttpError reintentable", async () => {
    mockSequence(response({}, 503));
    const failure = await queryResumableUploadStatus(SESSION_URL, 5000).catch((c) => c);
    expect(failure.status).toBe(503);
    expect(isRetryableDriveFailure(failure)).toBe(true);
  });

  it("otro 4xx (ej. 403): sesión no reutilizable, pero no es transitorio", async () => {
    mockSequence(response({}, 403));
    expect(await queryResumableUploadStatus(SESSION_URL, 5000)).toEqual({ kind: "unusable" });
  });

  it("nunca envía cuerpo en el sondeo", async () => {
    mockSequence(response({}, 308, {}));
    await queryResumableUploadStatus(SESSION_URL, 5000);
    expect(calls[0].init?.body).toBeUndefined();
  });
});

describe("Fase 8D.1 — recuperación de una subida resumable interrumpida", () => {
  const SESSION_URL_1 = "https://upload.example/SECRET-SESSION-TOKEN-DO-NOT-LEAK-1";
  const SESSION_URL_2 = "https://upload.example/SECRET-SESSION-TOKEN-DO-NOT-LEAK-2";
  const big = new Uint8Array(DRIVE_RESUMABLE_THRESHOLD_BYTES + 2000);
  big.fill(0xab);

  function networkFailure() {
    return new TypeError("fetch failed: network error");
  }

  it("A: el PUT final se pierde por un fallo de red, pero el sondeo confirma éxito -- sin abrir otra sesión", async () => {
    mockSequence(
      response({}, 200, { location: SESSION_URL_1 }), // init
      networkFailure() as unknown as Response, // PUT final: se pierde la respuesta
      response({ id: "RES_ID", name: "grande.pdf" }, 200), // sondeo: ya está completo
    );
    const result = await createDriveFileWithContent(TOKEN, {
      id: "RES_ID",
      name: "grande.pdf",
      parentId: "FOLDER",
      mimeType: "application/pdf",
      appProperties: {},
      content: big,
    });
    expect(result).toEqual({ id: "RES_ID", name: "grande.pdf" });
    expect(calls).toHaveLength(3);
    // Ninguna segunda sesión: solo un POST de init en toda la secuencia.
    expect(calls.filter((c) => c.init?.method === "POST")).toHaveLength(1);
  });

  it("reanudación real: un 503 a mitad de subida retoma exactamente desde el byte confirmado", async () => {
    mockSequence(
      response({}, 200, { location: SESSION_URL_1 }), // init
      response({}, 503), // PUT desde 0: falla
      response({}, 308, { range: "bytes=0-1023" }), // sondeo: confirmó hasta 1023
      response({ id: "RES_ID", name: "grande.pdf" }, 200), // PUT desde 1024: éxito
    );
    await createDriveFileWithContent(TOKEN, {
      id: "RES_ID",
      name: "grande.pdf",
      parentId: "FOLDER",
      mimeType: "application/pdf",
      appProperties: {},
      content: big,
    });
    expect(calls).toHaveLength(4);
    const finalPut = calls[3];
    const headers = finalPut.init?.headers as Record<string, string>;
    expect(headers["content-range"]).toBe(`bytes 1024-${big.length - 1}/${big.length}`);
    expect(headers["content-length"]).toBe(String(big.length - 1024));
    // El cuerpo del PUT final son solo los bytes restantes, no el archivo entero.
    expect((finalPut.init?.body as Uint8Array).length).toBe(big.length - 1024);
  });

  it("D: sesión caducada (404) y el ID reservado NO existe todavía -> abre otra sesión con el MISMO ID", async () => {
    mockSequence(
      response({}, 200, { location: SESSION_URL_1 }), // init #1
      networkFailure() as unknown as Response, // PUT: fallo de red
      response({}, 404), // sondeo: sesión caducada
      response({}, 404), // getDriveFile(RES_ID): todavía no existe
      response({}, 200, { location: SESSION_URL_2 }), // init #2 (nueva sesión)
      response({ id: "RES_ID", name: "grande.pdf" }, 200), // PUT desde 0 en la nueva sesión
    );
    const result = await createDriveFileWithContent(TOKEN, {
      id: "RES_ID",
      name: "grande.pdf",
      parentId: "FOLDER",
      mimeType: "application/pdf",
      appProperties: {},
      content: big,
    });
    expect(result).toEqual({ id: "RES_ID", name: "grande.pdf" });
    const initCalls = calls.filter((c) => c.init?.method === "POST");
    expect(initCalls).toHaveLength(2);
    // El identificador reservado es el mismo en ambas peticiones de init:
    // nunca se pide un generateIds nuevo en este nivel.
    const firstBody = JSON.parse(String(initCalls[0].init?.body));
    const secondBody = JSON.parse(String(initCalls[1].init?.body));
    expect(firstBody.id).toBe("RES_ID");
    expect(secondBody.id).toBe("RES_ID");
    // La segunda subida arranca desde el byte 0 de la sesión nueva.
    const lastPut = calls[calls.length - 1];
    const headers = lastPut.init?.headers as Record<string, string>;
    expect(headers["content-range"]).toBe(`bytes 0-${big.length - 1}/${big.length}`);
  });

  it("E: sesión caducada (404) pero el archivo YA existe con el ID reservado -> éxito, sin segunda sesión", async () => {
    mockSequence(
      response({}, 200, { location: SESSION_URL_1 }), // init
      networkFailure() as unknown as Response, // PUT: fallo de red
      response({}, 404), // sondeo: sesión caducada
      response(
        {
          id: "RES_ID",
          name: "grande.pdf",
          trashed: false,
          appProperties: { crm_entity: "document" },
        },
        200,
      ), // getDriveFile(RES_ID): SÍ existe
    );
    const result = await createDriveFileWithContent(TOKEN, {
      id: "RES_ID",
      name: "grande.pdf",
      parentId: "FOLDER",
      mimeType: "application/pdf",
      appProperties: {},
      content: big,
    });
    expect(result).toMatchObject({ id: "RES_ID" });
    expect(calls).toHaveLength(4);
    // Ninguna segunda sesión: un único POST de init.
    expect(calls.filter((c) => c.init?.method === "POST")).toHaveLength(1);
  });

  it("F1: 5xx persistente en PUT y sondeo -> falla acotada (no bucle infinito), transitoria", async () => {
    mockSequence(
      response({}, 200, { location: SESSION_URL_1 }), // init
      response({}, 503),
      response({}, 308, { range: "bytes=0-99" }),
      response({}, 503),
      response({}, 308, { range: "bytes=0-99" }),
      response({}, 503),
      response({}, 308, { range: "bytes=0-99" }),
    );
    const failure = await createDriveFileWithContent(TOKEN, {
      id: "RES_ID",
      name: "grande.pdf",
      parentId: "FOLDER",
      mimeType: "application/pdf",
      appProperties: {},
      content: big,
    }).catch((cause) => cause);
    expect(failure).toBeInstanceOf(DriveHttpError);
    expect(failure.status).toBe(503);
    expect(isRetryableDriveFailure(failure)).toBe(true);
    // 1 init + 3 intentos * (PUT + sondeo) = 7. Nunca más: el tope acota el bucle.
    expect(calls).toHaveLength(7);
  });

  it("F2: fallo de red persistente incluso en el sondeo -> se propaga de inmediato, sin colgarse", async () => {
    mockSequence(
      response({}, 200, { location: SESSION_URL_1 }), // init
      networkFailure() as unknown as Response, // PUT: falla
      networkFailure() as unknown as Response, // sondeo: también falla
    );
    const failure = await createDriveFileWithContent(TOKEN, {
      id: "RES_ID",
      name: "grande.pdf",
      parentId: "FOLDER",
      mimeType: "application/pdf",
      appProperties: {},
      content: big,
    }).catch((cause) => cause);
    expect(failure).toBeInstanceOf(TypeError);
    expect(calls).toHaveLength(3);
  });

  it("G: la URL de sesión nunca aparece en un mensaje de error visible", async () => {
    mockSequence(
      response({}, 200, { location: SESSION_URL_1 }),
      response({}, 503),
      response({}, 308, { range: "bytes=0-99" }),
      response({}, 503),
      response({}, 308, { range: "bytes=0-99" }),
      response({}, 503),
      response({}, 308, { range: "bytes=0-99" }),
    );
    const failure = await createDriveFileWithContent(TOKEN, {
      id: "RES_ID",
      name: "grande.pdf",
      parentId: "FOLDER",
      mimeType: "application/pdf",
      appProperties: {},
      content: big,
    }).catch((cause) => cause);
    expect(String(failure?.message ?? "")).not.toContain("SECRET-SESSION-TOKEN");
    expect(String(failure?.stack ?? "")).not.toContain("SECRET-SESSION-TOKEN");
  });
});

// ── Fase 8E.1 — metadata.size: parseo seguro ──────────────────────────────
describe("Fase 8E.1 — parseDriveDeclaredSize: nunca Number() a ciegas", () => {
  const MAX = 10 * 1024 * 1024;

  it("ausente -> unknown", () => {
    expect(parseDriveDeclaredSize(undefined, MAX)).toEqual({ kind: "unknown" });
  });

  it("vacío -> unknown", () => {
    expect(parseDriveDeclaredSize("", MAX)).toEqual({ kind: "unknown" });
  });

  it("no numérico -> unknown", () => {
    expect(parseDriveDeclaredSize("not-a-number", MAX)).toEqual({ kind: "unknown" });
  });

  it("negativo -> unknown (nunca se interpreta el signo)", () => {
    expect(parseDriveDeclaredSize("-5", MAX)).toEqual({ kind: "unknown" });
  });

  it("decimal (con punto) -> unknown", () => {
    expect(parseDriveDeclaredSize("12.5", MAX)).toEqual({ kind: "unknown" });
  });

  it("notación científica -> unknown", () => {
    expect(parseDriveDeclaredSize("1e10", MAX)).toEqual({ kind: "unknown" });
  });

  it("desbordamiento de dígitos (19+) -> unknown, nunca se intenta convertir", () => {
    expect(parseDriveDeclaredSize("1".repeat(19), MAX)).toEqual({ kind: "unknown" });
  });

  it("dentro del límite -> ok con el valor exacto", () => {
    expect(parseDriveDeclaredSize("1024", MAX)).toEqual({ kind: "ok", bytes: 1024 });
  });

  it("justo en el límite -> ok", () => {
    expect(parseDriveDeclaredSize(String(MAX), MAX)).toEqual({ kind: "ok", bytes: MAX });
  });

  it("un byte por encima del límite -> too_large, comparado con BigInt (sin perder precisión)", () => {
    expect(parseDriveDeclaredSize(String(MAX + 1), MAX)).toEqual({ kind: "too_large" });
  });

  it("archivo enorme (mucho más allá de Number.MAX_SAFE_INTEGER) -> too_large, no explota", () => {
    expect(parseDriveDeclaredSize("9".repeat(18), MAX)).toEqual({ kind: "too_large" });
  });
});

// ── Fase 8E.1 — downloadDriveFileBounded: stream real, nunca arrayBuffer() ─
describe("Fase 8E.1 — downloadDriveFileBounded: streaming acotado real", () => {
  function streamResponse(
    chunks: Uint8Array[],
    options: { headers?: Record<string, string> } = {},
  ) {
    let index = 0;
    let cancelled = false;
    let reads = 0;
    const arrayBufferSpy = vi.fn(async () => {
      throw new Error("arrayBuffer() NUNCA debe invocarse en la descarga inbound de Drive.");
    });
    const bodyCancel = vi.fn(async () => {
      cancelled = true;
    });
    const resp = {
      ok: true,
      status: 200,
      headers: { get: (name: string) => (options.headers ?? {})[name.toLowerCase()] ?? null },
      body: {
        cancel: bodyCancel,
        getReader: () => ({
          read: async () => {
            reads += 1;
            if (index >= chunks.length) return { done: true, value: undefined };
            const value = chunks[index];
            index += 1;
            return { done: false, value };
          },
          cancel: bodyCancel,
        }),
      },
      arrayBuffer: arrayBufferSpy,
      text: async () => "",
    } as unknown as Response;
    return { resp, arrayBufferSpy, wasCancelled: () => cancelled, readCount: () => reads };
  }

  function streamlessResponse(options: { headers?: Record<string, string> } = {}) {
    const arrayBufferSpy = vi.fn(async () => {
      throw new Error("arrayBuffer() NUNCA debe invocarse en la descarga inbound de Drive.");
    });
    const resp = {
      ok: true,
      status: 200,
      headers: { get: (name: string) => (options.headers ?? {})[name.toLowerCase()] ?? null },
      body: null,
      arrayBuffer: arrayBufferSpy,
      text: async () => "",
    } as unknown as Response;
    return { resp, arrayBufferSpy };
  }

  it("archivo válido: stream normal produce exactamente los bytes esperados", async () => {
    const content = new Uint8Array([1, 2, 3, 4]);
    const { resp, arrayBufferSpy } = streamResponse([content]);
    mockSequence(resp);
    const bytes = await downloadDriveFileBounded(TOKEN, "F1", 1024, {}, content.length);
    expect(bytes).toEqual(content);
    expect(arrayBufferSpy).not.toHaveBeenCalled();
  });

  it("C: response.body=null -> DriveDownloadStreamUnavailableError, jamás arrayBuffer()", async () => {
    const { resp, arrayBufferSpy } = streamlessResponse();
    mockSequence(resp);
    const failure = await downloadDriveFileBounded(TOKEN, "F1", 1024).catch((cause) => cause);
    expect(failure).toBeInstanceOf(DriveDownloadStreamUnavailableError);
    expect(arrayBufferSpy).not.toHaveBeenCalled();
  });

  it("D: un segundo chunk hace que el total supere el máximo -> aborta temprano, cancela, no lee un tercer chunk", async () => {
    const chunkA = new Uint8Array(6);
    const chunkB = new Uint8Array(6); // 6 + 6 = 12 > maxBytes (10)
    const chunkC = new Uint8Array(6); // nunca debería llegar a leerse
    const { resp, wasCancelled, readCount } = streamResponse([chunkA, chunkB, chunkC]);
    mockSequence(resp);
    const failure = await downloadDriveFileBounded(TOKEN, "F1", 10).catch((cause) => cause);
    expect(failure).toBeInstanceOf(DriveDownloadTooLargeError);
    expect(wasCancelled()).toBe(true);
    // 2 lecturas (chunkA que no excede, chunkB que sí) -- nunca una tercera.
    expect(readCount()).toBe(2);
  });

  it("Content-Length ya excede el máximo -> aborta ANTES de pedir el reader, nunca lee el cuerpo", async () => {
    const chunk = new Uint8Array(4);
    const { resp, readCount } = streamResponse([chunk], { headers: { "content-length": "999" } });
    mockSequence(resp);
    const failure = await downloadDriveFileBounded(TOKEN, "F1", 10).catch((cause) => cause);
    expect(failure).toBeInstanceOf(DriveDownloadTooLargeError);
    expect(readCount()).toBe(0);
  });

  it("F: el total descargado no coincide con expectedSize -> DriveDownloadSizeMismatchError", async () => {
    const content = new Uint8Array([1, 2, 3]);
    const { resp } = streamResponse([content]);
    mockSequence(resp);
    const failure = await downloadDriveFileBounded(TOKEN, "F1", 1024, {}, 999).catch(
      (cause) => cause,
    );
    expect(failure).toBeInstanceOf(DriveDownloadSizeMismatchError);
  });

  it("sin expectedSize, no se exige coincidencia de tamaño", async () => {
    const content = new Uint8Array([1, 2, 3]);
    const { resp } = streamResponse([content]);
    mockSequence(resp);
    const bytes = await downloadDriveFileBounded(TOKEN, "F1", 1024);
    expect(bytes).toEqual(content);
  });
});
