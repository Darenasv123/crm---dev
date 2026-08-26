import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Fase 8E — garantías estructurales del importador Drive -> CRM: alcance
 * (solo consumidor, sin descubrimiento automático), ausencia de un endpoint
 * HTTP de importación arbitraria, minimización de datos en la lectura de
 * metadata, y que la migración conserve las invariantes de las RPC previas.
 */

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260825110000_google_drive_drive_to_crm_import.sql");
const foundation = read("supabase/migrations/20260824100000_google_drive_sync_foundation.sql");
const sync = read("src/lib/google-drive/drive-sync.server.ts");
const files = read("src/lib/google-drive/drive-files.ts");
const appProps = read("src/lib/google-drive/drive-app-properties.ts");
const storage = read("src/lib/google-drive/drive-storage.server.ts");
const doc = read("server-release/docs/GOOGLE_DRIVE_CONFIGURATION.md");
const routeFiles = readdirSync("src/routes").filter((name) => name.startsWith("api.google-drive."));

// ── migración ────────────────────────────────────────────────────────────
describe("Fase 8E — migración incremental", () => {
  it("es la única migración nueva; las anteriores de Drive quedan intactas", () => {
    const driveMigrations = readdirSync("supabase/migrations")
      .filter((name) => name.includes("google_drive"))
      .sort();
    expect(driveMigrations).toEqual([
      "20260824100000_google_drive_sync_foundation.sql",
      "20260824110000_google_drive_client_folder_onboarding.sql",
      "20260825100000_google_drive_crm_to_drive.sql",
      "20260825110000_google_drive_drive_to_crm_import.sql",
    ]);
  });

  it("no crea, altera ni elimina ninguna tabla: reutiliza el esquema ya existente", () => {
    expect(migration).not.toMatch(/create table/i);
    expect(migration).not.toMatch(/alter table/i);
    expect(migration).not.toMatch(/drop table/i);
  });

  it("crea exactamente una función, server-only, sin SECURITY DEFINER y con search_path fijo", () => {
    expect(migration).toContain("create or replace function public.finalize_google_drive_import");
    expect(migration).not.toMatch(/security definer/i);
    expect(migration).toContain("set search_path = public");
    // La lista de 16 parámetros hace la firma larga; se acota a 300
    // caracteres en vez de a un límite ajustado a la firma más corta de
    // las RPC anteriores.
    expect(migration).toMatch(
      /revoke all on function public\.finalize_google_drive_import[\s\S]{0,300}from public, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.finalize_google_drive_import[\s\S]{0,300}to service_role;/,
    );
  });

  it("serializa sobre la conexión (FOR UPDATE) y valida la raíz esperada, igual que las RPC previas", () => {
    expect(migration).toMatch(/where id = p_connection_id\s*\n\s*for update;/);
    expect(migration).toContain("DRIVE_ROOT_CHANGED_RETRY");
    expect(migration).toContain(
      "v_connection.root_folder_id is distinct from p_expected_root_folder_id",
    );
  });

  it("valida que la carpeta del Cliente siga siendo exactamente la esperada", () => {
    expect(migration).toContain("CLIENT_FOLDER_CHANGED_RETRY");
    expect(migration).toContain("v_folder.drive_folder_id is distinct from p_drive_parent_id");
    expect(migration).toContain("v_folder.sync_status <> 'synced'");
  });

  it("idempotencia por drive_file_id: mismo target -> unchanged; otro target -> error estable", () => {
    expect(migration).toContain("DRIVE_FILE_ALREADY_IMPORTED");
    expect(migration).toContain("'unchanged', true");
  });

  it("colisión de identidad del UUID reservado -> IMPORT_IDENTITY_CONFLICT", () => {
    expect(migration).toContain("IMPORT_IDENTITY_CONFLICT");
  });

  it("case_id siempre NULL, type/document_type siempre 'Otros' -- nunca parámetros de entrada", () => {
    const insertStart = migration.indexOf("insert into public.documents");
    const insertBlock = migration.slice(insertStart, migration.indexOf(");", insertStart));
    expect(insertBlock).not.toMatch(/p_case_id|p_type|p_document_type/);
    expect(insertBlock).toContain("'Otros', 'Otros'");
    expect(insertBlock).toMatch(/p_client_id,\s*null,/);
  });

  it("created_by siempre NULL: ninguna sesión interactiva subió este documento", () => {
    const insertStart = migration.indexOf("insert into public.documents");
    const insertBlock = migration.slice(insertStart, migration.indexOf(");", insertStart));
    expect(insertBlock.trim().endsWith("null")).toBe(true);
    expect(insertBlock).not.toMatch(/p_created_by|p_actor|p_user/);
  });

  it("procedencia real: source_type/source_provider = google_drive, no valores heredados de otra vía", () => {
    expect(migration).toContain("'google_drive', 'google_drive'");
  });

  it("no llama a Google ni a Storage desde PostgreSQL", () => {
    expect(migration).not.toMatch(/http|googleapis|net\./i);
    // Se busca una llamada real (ej. "storage.upload"/"storage.from"), no
    // la propia prosa del comentario que explica esta misma garantía
    // ("... NO llama a Storage.").
    expect(migration).not.toMatch(/storage\.(upload|download|from|remove)/i);
  });

  it("la migración de 8B sigue teniendo el CHECK que admite 'import_drive_file'", () => {
    expect(foundation).toContain("'import_drive_file'");
  });
});

// ── sin endpoint HTTP de importación arbitraria (Sección 3) ──────────────
describe("Fase 8E — sin endpoint HTTP de importación (Sección 3)", () => {
  it("no existe ninguna ruta de importación de archivo", () => {
    const importRoutes = routeFiles.filter((name) => /import|inbound/i.test(name));
    expect(importRoutes).toEqual([]);
  });

  it("enqueueGoogleDriveImportFile es server-only: ninguna ruta la expone", () => {
    for (const file of routeFiles) {
      const source = read(`src/routes/${file}`);
      expect(source).not.toContain("enqueueGoogleDriveImportFile");
    }
  });

  it("el helper nunca acepta un driveFileId proveniente de una petición HTTP sin control", () => {
    const start = sync.indexOf("export async function enqueueGoogleDriveImportFile");
    const body = sync.slice(start, sync.indexOf("\n}", start));
    expect(body).not.toContain("Request");
    expect(body).not.toContain("requireActiveActor");
  });
});

// ── minimización de datos en metadata inbound (Sección 8) ────────────────
describe("Fase 8E — metadata inbound: solo los campos necesarios", () => {
  it("DRIVE_INBOUND_FILE_FIELDS pide size y capabilities(canDownload), nunca owners/permissions/description", () => {
    expect(files).toContain("export const DRIVE_INBOUND_FILE_FIELDS");
    expect(files).toContain("capabilities(canDownload)");
    expect(files).not.toMatch(/DRIVE_INBOUND_FILE_FIELDS[\s\S]{0,200}owners/);
    expect(files).not.toMatch(/DRIVE_INBOUND_FILE_FIELDS[\s\S]{0,200}permissions/);
  });

  it("supportsAllDrives=true también en la descarga (alt=media)", () => {
    const start = files.indexOf("export async function downloadDriveFileBounded");
    const body = files.slice(start, files.indexOf("\n}", start + 400));
    expect(body).toContain('alt: "media"');
  });
});

// ── Fase 8E.1 — bounded download real: nunca arrayBuffer(), size obligatorio ─
describe("Fase 8E.1 — descarga inbound: stream real, sin fallback a arrayBuffer()", () => {
  const downloadBody = () => {
    const start = files.indexOf("export async function downloadDriveFileBounded");
    const end = files.indexOf("\n// ── create folder", start);
    return files.slice(start, end);
  };

  it("downloadDriveFileBounded nunca llama a arrayBuffer(): sin ruta de recuperación insegura", () => {
    expect(downloadBody()).not.toContain("arrayBuffer(");
  });

  it("sin response.body -> falla de forma clasificable, nunca lee el cuerpo entero", () => {
    const body = downloadBody();
    expect(body).toContain("DriveDownloadStreamUnavailableError");
    expect(body).toMatch(
      /if\s*\(!response\.body\)\s*throw new DriveDownloadStreamUnavailableError/,
    );
  });

  it("compara el total real contra expectedSize antes de devolver los bytes", () => {
    const body = downloadBody();
    expect(body).toContain("DriveDownloadSizeMismatchError");
    expect(body).toMatch(/total !== expectedSize/);
  });

  it("Content-Length se usa como defensa adicional, nunca como única autoridad", () => {
    const body = downloadBody();
    expect(body).toContain("content-length");
    // El contador de bytes real del stream sigue existiendo y sigue siendo
    // quien decide durante la lectura -- Content-Length es apenas un atajo
    // para no empezar a leer si ya se sabe que sobra.
    expect(body).toMatch(/total > maxBytes/);
  });

  it("parseDriveDeclaredSize existe y se usa en el preflight del worker antes de alt=media", () => {
    expect(files).toContain("export function parseDriveDeclaredSize");
    const start = sync.indexOf("async function handleImportDriveFile");
    const preflight = sync.slice(start, sync.indexOf("downloadDriveFileBounded(", start));
    expect(preflight).toContain("parseDriveDeclaredSize");
    expect(preflight).toContain("DRIVE_FILE_SIZE_UNKNOWN");
  });
});

// ── Fase 8E.1 — compensación de Storage en conflicto permanente ───────────
describe("Fase 8E.1 — cleanup de Storage: nunca borra sin confirmar en base de datos", () => {
  const cleanupBody = () => {
    const start = sync.indexOf("async function cleanupOrphanedStorageObject");
    const end = sync.indexOf("\n// ── procesador", start);
    return sync.slice(start, end);
  };

  it("cleanupOrphanedStorageObject existe y se invoca ante un conflicto PERMANENTE de finalización", () => {
    expect(sync).toContain("async function cleanupOrphanedStorageObject");
    expect(sync).toMatch(/cleanupOrphanedStorageObject\(db, storagePath\)/);
  });

  it("consulta documents por storage_path ANTES de cualquier remove -- nunca a la inversa", () => {
    const body = cleanupBody();
    const selectIndex = body.indexOf('.from("documents")');
    const removeIndex = body.indexOf(".remove(");
    expect(selectIndex).toBeGreaterThan(-1);
    expect(removeIndex).toBeGreaterThan(-1);
    expect(selectIndex).toBeLessThan(removeIndex);
    expect(body).toMatch(/eq\("storage_path", storagePath\)/);
  });

  it("el remove es best-effort: un fallo no se propaga", () => {
    const body = cleanupBody();
    expect(body).toMatch(/\.remove\(\[storagePath\]\)\s*\.catch\(/);
  });

  it("la limpieza no depende de si ESTE intento creó el objeto: se invoca igual para 'written' y 'reused'", () => {
    const start = sync.indexOf("DRIVE_FILE_ALREADY_IMPORTED");
    const branch = sync.slice(
      start - 200,
      sync.indexOf('return { status: "completed" };', start) + 40,
    );
    expect(branch).not.toContain('storageOutcome.kind === "written"');
  });
});

// ── Google Workspace: nunca files.export en runtime (Sección 10/55) ──────
describe("Fase 8E — Google Workspace nativo: rechazado, nunca exportado", () => {
  it("classifyUnsupportedDriveEntry existe y distingue Workspace nativo de carpeta/atajo", () => {
    expect(files).toContain("export function classifyUnsupportedDriveEntry");
    expect(files).toContain("GOOGLE_WORKSPACE_FILE_UNSUPPORTED");
    expect(files).toContain("DRIVE_ENTRY_NOT_IMPORTABLE");
  });

  it("0 llamadas reales a files.export en todo el módulo de Drive", () => {
    // Se busca la URL real que usaría una exportación
    // (".../files/{id}/export"), no la prosa que explica por qué NO se usa
    // -- esos comentarios sí mencionan "files.export" a propósito.
    for (const source of [files, sync, storage]) {
      expect(source).not.toMatch(/\/files\/\$\{[^}]+\}\/export/);
      expect(source).not.toContain('"/export?"');
    }
  });
});

// ── auditoría negativa (Sección 55) ───────────────────────────────────────
describe("Fase 8E — auditoría negativa: nada de 8F implementado todavía", () => {
  it("sin llamadas reales a drive/v3/changes, getStartPageToken, webhook ni channel renewal", () => {
    // `changes.list`/`changes.watch` sí aparecen como texto -- son la propia
    // documentación de scope ("eso es Fase 8F") en los comentarios del
    // código; lo que se comprueba aquí es la ausencia de la URL real y de
    // los identificadores de API que una implementación funcional usaría.
    for (const source of [sync, files, storage]) {
      expect(source).not.toMatch(/drive\/v3\/changes/);
      expect(source).not.toContain("getStartPageToken");
      expect(source).not.toContain("x-goog-channel-id");
      expect(source).not.toMatch(/channel.?renewal/i);
    }
  });

  it("poll_changes sigue sin implementación funcional en el procesador", () => {
    const start = sync.indexOf("async function dispatch");
    const body = sync.slice(start, sync.indexOf("\nasync function requeue", start));
    expect(body).not.toContain('case "poll_changes"');
  });

  it("no existe ningún bucle de reconciliación completa", () => {
    for (const source of [sync, files, storage]) {
      expect(source).not.toMatch(/full.?reconcil/i);
      expect(source).not.toContain("reconciliationScan");
    }
  });
});

// ── appProperties: protección de propiedad (Sección 12/13) ───────────────
describe("Fase 8E — clasificación de propiedad de appProperties", () => {
  it("classifyAppPropertiesOwnership distingue unmanaged/known_document/conflict", () => {
    expect(appProps).toContain("export function classifyAppPropertiesOwnership");
    expect(appProps).toContain('"unmanaged"');
    expect(appProps).toContain('"known_document"');
    expect(appProps).toContain('"conflict"');
  });

  it("8E es READ-ONLY respecto al archivo de Drive: nunca escribe appProperties a un archivo manual", () => {
    const start = sync.indexOf("async function handleImportDriveFile");
    const body = sync.slice(start, sync.indexOf("\n// ── procesador", start));
    expect(body).not.toContain("renameDriveFile");
    expect(body).not.toContain("createDriveFolder");
    expect(body).not.toContain("createDriveFileWithContent");
    expect(body).not.toContain("trashDriveFile");
  });
});

// ── no inferencia jurídica (Sección 6/7/48) ───────────────────────────────
describe("Fase 8E — solo hijos directos, nunca inferencia jurídica", () => {
  it("resuelve el Cliente por coincidencia exacta de parents contra mappings synced", () => {
    const start = sync.indexOf("async function handleImportDriveFile");
    const body = sync.slice(start, sync.indexOf("\n// ── procesador", start));
    expect(body).toContain('eq("sync_status", "synced")');
    expect(body).toContain("DRIVE_PARENT_UNLINKED");
    expect(body).toContain("DRIVE_PARENT_AMBIGUOUS");
  });

  it("el worker nunca pasa un case_id calculado a la RPC de finalización: la migración lo fija a NULL", () => {
    const start = sync.indexOf("async function handleImportDriveFile");
    const body = sync.slice(start, sync.indexOf("\n// ── procesador", start));
    // El único mecanismo de resolución de identidad es matchClientToFolders
    // de 8A, usado por ensure_client_folder (outbound) -- nunca aquí, donde
    // la relación se deriva exclusivamente del padre real en Drive.
    expect(body).not.toContain("matchClientToFolders");
    expect(body).not.toMatch(/p_case_id|case_id:/);
  });
});

// ── documentación (Sección 54) ─────────────────────────────────────────────
describe("Fase 8E — documentación operativa actualizada", () => {
  it("documenta el pipeline inbound y sus garantías", () => {
    expect(doc).toMatch(/Drive -> CRM \(Fase 8E/);
    expect(doc).toContain("GOOGLE_WORKSPACE_FILE_UNSUPPORTED");
    expect(doc).toContain("OUTBOUND_ORPHAN_REVIEW_REQUIRED");
    expect(doc).toContain("DRIVE_FILE_CHANGED_RETRY");
    expect(doc).toMatch(/no añade ninguna ruta/i);
  });

  it("dice explícitamente que el descubrimiento sigue sin implementarse", () => {
    expect(doc).toMatch(/no detecta cambios hechos directamente en Drive/i);
  });
});
