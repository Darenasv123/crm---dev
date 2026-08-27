import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Fase 8D — garantías estructurales: que Drive no pueda convertirse en
 * bloqueante de una operación del CRM, que nada haga hard-delete, y que la
 * migración conserve las propiedades que el flujo de borrado necesita.
 */

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260825100000_google_drive_crm_to_drive.sql");
const foundation = read("supabase/migrations/20260824100000_google_drive_sync_foundation.sql");
const sync = read("src/lib/google-drive/drive-sync.server.ts");
const files = read("src/lib/google-drive/drive-files.ts");
const storage = read("src/lib/google-drive/drive-storage.server.ts");
const syncClient = read("src/lib/google-drive-sync-client.ts");
const useClients = read("src/hooks/use-clients.ts");
const useDocuments = read("src/hooks/use-documents.ts");
const maintenanceRoute = read("src/routes/api.google-drive.maintenance.ts");
const envExample = read(".env.example");
const validateEnv = read("scripts/validate-production-env.mjs");
const doc = read("server-release/docs/GOOGLE_DRIVE_CONFIGURATION.md");

// ── migración ────────────────────────────────────────────────────────────
describe("Fase 8D — migración incremental", () => {
  // Fase 8E añadió su propia migración incremental (20260825110000); las
  // tres anteriores siguen intactas -- este test protege eso, no un
  // recuento cerrado que nunca pueda crecer.
  it("las migraciones de Drive ya commiteadas no se tocan", () => {
    // Fase 8F añadió una quinta migración incremental (ver
    // tests/google-drive-automatic-sync-structure.test.ts); este test
    // protege que ninguna de las CUATRO anteriores se recree/destruya, no
    // un conteo cerrado.
    const driveMigrations = readdirSync("supabase/migrations")
      .filter((name) => name.includes("google_drive"))
      .sort();
    expect(driveMigrations).toEqual([
      "20260824100000_google_drive_sync_foundation.sql",
      "20260824110000_google_drive_client_folder_onboarding.sql",
      "20260825100000_google_drive_crm_to_drive.sql",
      "20260825110000_google_drive_drive_to_crm_import.sql",
      "20260826100000_google_drive_automatic_sync.sql",
    ]);
  });

  it("cambia la FK de la cola a ON DELETE SET NULL para que el trabajo sobreviva al borrado", () => {
    expect(foundation).toContain(
      "document_id uuid references public.documents(id) on delete cascade",
    );
    expect(migration).toContain(
      "drop constraint if exists google_drive_sync_queue_document_id_fkey",
    );
    expect(migration).toMatch(
      /foreign key \(document_id\) references public\.documents\(id\) on delete set null/,
    );
  });

  it("crea las cuatro RPC de reserva y finalización", () => {
    for (const fn of [
      "reserve_google_drive_created_client_folder",
      "finalize_google_drive_client_folder",
      "reserve_google_drive_document_file",
      "finalize_google_drive_document_file",
    ]) {
      expect(migration).toContain(`create or replace function public.${fn}`);
    }
  });

  it("todas son server-only, sin SECURITY DEFINER y con search_path fijo", () => {
    const revokes = migration.match(/revoke all on function public\.\w+/g) ?? [];
    const grants = migration.match(/grant execute on function public\.\w+/g) ?? [];
    expect(revokes).toHaveLength(4);
    expect(grants).toHaveLength(4);
    expect(migration).not.toMatch(/security definer/i);
    expect(migration.match(/set search_path = public/g)).toHaveLength(4);
    expect(migration).not.toMatch(/to (anon|authenticated)\s*;/);
  });

  it("las reservas de carpeta serializan sobre la conexión y validan la raíz", () => {
    const start = migration.indexOf("function public.reserve_google_drive_created_client_folder");
    const body = migration.slice(start, migration.indexOf("\n$$;", start));
    expect(body).toMatch(/where id = p_connection_id\s*\n\s*for update;/);
    expect(body).toContain("DRIVE_ROOT_CHANGED_RETRY");
    expect(body).toContain("'created'");
  });

  it("la reserva de documento exige que la carpeta del cliente sea la esperada", () => {
    const start = migration.indexOf("function public.reserve_google_drive_document_file");
    const body = migration.slice(start, migration.indexOf("\n$$;", start));
    expect(body).toContain("CLIENT_FOLDER_NOT_LINKED");
    expect(body).toContain("CLIENT_FOLDER_CHANGED_RETRY");
    expect(body).toContain("DOCUMENT_WITHOUT_CLIENT");
  });

  it("no llama a Google desde PostgreSQL", () => {
    expect(migration).not.toMatch(/http|googleapis|net\./i);
  });
});

// ── no bloqueante ────────────────────────────────────────────────────────
describe("Fase 8D — Drive nunca bloquea una operación del CRM", () => {
  it("el cliente de navegador atrapa cualquier fallo y devuelve un resultado", () => {
    // Cada llamada va dentro de un try/catch que nunca relanza.
    expect(syncClient).toContain("} catch {");
    expect(syncClient).toContain("return { queued: false, requestFailed: true }");
    expect(syncClient).not.toMatch(/throw new Error/);
  });

  it("crear un Cliente dispara la sincronización sin await ni propagación", () => {
    expect(useClients).toContain("void requestClientDriveFolderSync(data.id)");
    // La llamada va DESPUÉS de comprobar el error del insert.
    const insertIdx = useClients.indexOf("if (error) throw new Error(error.message)");
    const syncIdx = useClients.indexOf("void requestClientDriveFolderSync");
    expect(syncIdx).toBeGreaterThan(insertIdx);
  });

  it("subir un documento dispara la sincronización solo tras guardarlo con éxito", () => {
    expect(useDocuments).toContain("void requestDocumentDriveSync(data.id)");
    const guardIdx = useDocuments.indexOf(
      'throw new Error("Supabase no devolvió el registro del documento subido.")',
    );
    const syncIdx = useDocuments.indexOf("void requestDocumentDriveSync(data.id)");
    expect(syncIdx).toBeGreaterThan(guardIdx);
  });

  it("renombrar dispara la sincronización solo si cambió el nombre", () => {
    expect(useDocuments).toContain("if (updates.name !== undefined) void requestDocumentDriveSync");
  });

  it("borrar prepara la papelera ANTES del delete, y el delete no depende de ello", () => {
    const prepareIdx = useDocuments.indexOf("await prepareDocumentDriveTrash(id)");
    const deleteIdx = useDocuments.indexOf('db.from("documents").delete()');
    expect(prepareIdx).toBeGreaterThan(-1);
    expect(prepareIdx).toBeLessThan(deleteIdx);
  });

  it("los productores del servidor devuelven un motivo en vez de lanzar cuando Drive no está listo", () => {
    expect(sync).toContain("return { queued: false, reason: resolved.reason }");
    expect(sync).toContain('reason: "not_configured"');
    expect(sync).toContain('reason: "not_connected"');
    expect(sync).toContain('reason: "root_not_configured"');
  });

  it("no se avisa al usuario cuando Drive simplemente no está configurado", () => {
    const start = syncClient.indexOf("export function shouldWarnAboutDriveSync");
    const body = syncClient.slice(start, syncClient.indexOf("\n}", start));
    expect(body).toContain("if (result.queued) return false");
    expect(body).toContain("if (result.requestFailed) return true");
    expect(body).toContain("return false");
  });
});

// ── seguridad de borrado ─────────────────────────────────────────────────
describe("Fase 8D — nunca hard-delete en Drive", () => {
  it("el módulo de archivos no implementa files.delete", () => {
    expect(files).not.toMatch(/method:\s*"DELETE"/);
    expect(files).toContain("trashed: true");
  });

  it("el worker comprueba que el documento realmente desapareció antes de mover a la papelera", () => {
    const start = sync.indexOf("async function handleTrashDocument");
    const body = sync.slice(start, sync.indexOf("\n// ──", start));
    expect(body).toContain("if (job.document_id)");
    expect(body).toContain("DOCUMENT_STILL_EXISTS");
    // La comprobación va antes de cualquier llamada a Drive.
    expect(body.indexOf("DOCUMENT_STILL_EXISTS")).toBeLessThan(body.indexOf("trashDriveFile"));
  });

  it("un archivo ya en la papelera es éxito idempotente", () => {
    const start = sync.indexOf("async function handleTrashDocument");
    const body = sync.slice(start, sync.indexOf("\n// ──", start));
    expect(body).toContain('if (!file || file.trashed) return { status: "completed" }');
  });
});

// ── idempotencia ─────────────────────────────────────────────────────────
describe("Fase 8D — idempotencia por ID pre-reservado", () => {
  it("solo se piden IDs nuevos cuando no hay reserva previa", () => {
    // Carpeta: se reconcilia el ID reservado antes de plantearse crear nada.
    const folderStart = sync.indexOf("async function handleEnsureClientFolder");
    const folderBody = sync.slice(folderStart, sync.indexOf("\n/**", folderStart));
    expect(folderBody.indexOf("mapping?.drive_folder_id")).toBeLessThan(
      folderBody.indexOf("generateDriveIds"),
    );
    // Documento: idem.
    expect(sync).toContain("let fileId = existing?.drive_file_id ?? null");
    expect(sync).toContain("if (!fileId) {");
  });

  it("un 409 se reconcilia comprobando identidad, nunca creando otro objeto", () => {
    expect(sync).toContain("matchesClientFolderIdentity");
    expect(sync).toContain("matchesDocumentIdentity");
    expect(sync.match(/DRIVE_IDENTITY_CONFLICT/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("ante un fallo la reserva NO se borra: se conserva para reconciliar", () => {
    const start = sync.indexOf("async function markClientFolderError");
    const body = sync.slice(start, sync.indexOf("\n// ──", start));
    expect(body).not.toContain(".delete()");
    expect(body).toContain("p_sync_error: reason");
  });
});

// ── storage ──────────────────────────────────────────────────────────────
describe("Fase 8D — lectura del contenido", () => {
  it("no genera signed URLs: descarga directamente con el service role", () => {
    expect(storage).not.toContain("createSignedUrl");
    expect(storage).toContain(".download(");
  });

  it("reaplica las reglas documentales del CRM sobre los bytes reales", () => {
    expect(storage).toContain("validateDocumentFile");
    expect(storage).toContain("size: bytes.length");
  });

  it("el hash del baseline es SHA-256 local, no el checksum de Drive", () => {
    expect(storage).toContain('crypto.subtle.digest("SHA-256"');
    expect(sync).toContain("p_content_hash: content.contentHash");
  });
});

// ── mantenimiento ────────────────────────────────────────────────────────
describe("Fase 8D — endpoint de mantenimiento", () => {
  it("es máquina a máquina: secreto dedicado, nunca sesión de Administrador", () => {
    expect(maintenanceRoute).toContain("GOOGLE_DRIVE_MAINTENANCE_SECRET");
    expect(maintenanceRoute).toContain("x-maintenance-secret");
    expect(maintenanceRoute).toContain("timingSafeEqual");
    expect(maintenanceRoute).not.toContain("requireAdmin");
  });

  it("sin secreto configurado responde 503 en vez de quedar abierto", () => {
    expect(maintenanceRoute).toContain("status: 503");
  });

  it("Fase 8F: delega en el orquestador único de mantenimiento (bootstrap + watch + poll + reconciliación + cola)", () => {
    expect(maintenanceRoute).toContain("runGoogleDriveMaintenance");
    // La ruta en sí sigue sin llamar a Google directamente -- toda esa
    // lógica vive en drive-sync.server.ts (ver
    // tests/google-drive-automatic-sync-structure.test.ts).
    expect(maintenanceRoute).not.toContain("googleapis.com");
  });

  it("el secreto está en .env.example y es requerido solo si Drive está configurado", () => {
    expect(envExample).toContain("GOOGLE_DRIVE_MAINTENANCE_SECRET=");
    expect(validateEnv).toContain("Requeridas si Google Drive está configurado");
    expect(validateEnv).toContain("driveConfigured");
    expect(validateEnv).toContain("GOOGLE_DRIVE_MAINTENANCE_SECRET");
  });
});

// ── alcance ──────────────────────────────────────────────────────────────
describe("Fase 8D — separación de responsabilidades del motor CRM -> Drive", () => {
  it("drive-sync/drive-files/drive-storage nunca contienen las URLs del change feed -- esa lógica vive aislada en drive-changes.ts (Fase 8F)", () => {
    for (const source of [sync, files, storage]) {
      expect(source).not.toContain("changes/startPageToken");
      expect(source).not.toContain("drive/v3/changes");
      expect(source).not.toContain("x-goog-channel-id");
    }
  });

  it("el procesador despacha las operaciones ya implementadas por su nombre exacto", () => {
    expect(sync).toContain("OPERATION_NOT_IMPLEMENTED");
    const start = sync.indexOf("async function dispatch");
    const body = sync.slice(start, sync.indexOf("\nasync function requeue", start));
    expect(body).toContain('case "ensure_client_folder"');
    expect(body).toContain('case "upload_document"');
    expect(body).toContain('case "rename_document"');
    expect(body).toContain('case "trash_document"');
    // Fase 8E implementó el consumidor de import_drive_file; Fase 8F
    // implementó poll_changes, el descubrimiento automático que lo
    // alimenta (ver tests/google-drive-automatic-sync-*.test.ts). Solo
    // update_document sigue sin productor real -- el CRM no ofrece
    // reemplazar el contenido de un documento.
    expect(body).toContain('case "import_drive_file"');
    expect(body).toContain('case "poll_changes"');
  });

  it("update_document no tiene productor porque el CRM no ofrece reemplazar contenido", () => {
    expect(sync).not.toContain('operation: "update_document"');
    expect(files).toContain("export async function updateDriveFileContent");
  });
});

// ── permisos y superficie ────────────────────────────────────────────────
describe("Fase 8D — permisos centralizados y superficie mínima", () => {
  it("usa los resolvers de permisos, no comparaciones de rol sueltas", () => {
    expect(sync).toContain("resolveClientPermissions");
    expect(sync).toContain("resolveDocumentPermissions");
    expect(sync).not.toMatch(/role === "Administrador"/);
  });

  it("preparar la papelera exige el permiso de ELIMINAR documentos", () => {
    const start = sync.indexOf("export async function prepareDocumentTrash");
    const body = sync.slice(start, sync.indexOf("\n}", start));
    expect(body).toContain("canDeleteDocuments");
  });

  it("el navegador nunca envía ni recibe identificadores de Drive", () => {
    expect(syncClient).not.toContain("driveFileId");
    expect(syncClient).not.toContain("driveFolderId");
    // El único access_token que aparece es el de la sesión de Supabase del
    // propio usuario, nunca uno de Google Drive.
    const accessTokenUses = syncClient.match(/access_token/g) ?? [];
    const sessionUses = syncClient.match(/session[?.]*\.access_token/g) ?? [];
    expect(accessTokenUses.length).toBe(sessionUses.length);
  });
});

// ── documentación ────────────────────────────────────────────────────────
describe("Fase 8D — documentación operativa actualizada", () => {
  it("documenta el flujo CRM -> Drive y sus garantías", () => {
    expect(doc).toMatch(/generateIds/);
    expect(doc).toMatch(/multipart/i);
    expect(doc).toMatch(/resumable/i);
    expect(doc).toMatch(/appProperties/);
    expect(doc).toMatch(/papelera/i);
    expect(doc).toMatch(/GOOGLE_DRIVE_MAINTENANCE_SECRET/);
  });

  it("deja claro que sigue sin activarse contra Google real", () => {
    expect(doc).toMatch(/GOOGLE CLOUD CONSOLE NO CONFIGURADA/);
  });
});

// ── Fase 8D.1 ────────────────────────────────────────────────────────────
describe("Fase 8D.1 — recuperación de resumable: documentado y sin persistir la sesión", () => {
  it("el módulo exporta el sondeo de estado y la clasificación de sus respuestas", () => {
    expect(files).toContain("export async function queryResumableUploadStatus");
    expect(files).toContain('"content-range": `bytes */${totalBytes}`');
    expect(files).toContain('"content-length": "0"');
  });

  it("nunca persiste la session URL: no aparece en ninguna llamada a Supabase ni en la cola", () => {
    expect(sync).not.toMatch(/sessionUrl/);
    expect(migration).not.toMatch(/session.?url/i);
  });

  it("acota los reintentos dentro de una misma ejecución del worker", () => {
    expect(files).toContain("export const MAX_RESUMABLE_ATTEMPTS_PER_RUN");
  });

  it("un 409/sesión perdida se reconcilia por identidad, nunca genera un ID nuevo a este nivel", () => {
    expect(files).toContain("onSessionLost");
    // El recorrido de recuperación resumable (uploadResumable en adelante)
    // nunca vuelve a llamar a generateDriveIds -- solo openResumableSession,
    // que reutiliza el mismo id recibido en `metadata`.
    const start = files.indexOf("async function uploadResumable");
    const end = files.indexOf("export async function createDriveFileWithContent");
    const recoveryBody = files.slice(start, end);
    expect(recoveryBody).not.toContain("generateDriveIds");
  });

  it("el worker de subida trata una subida no confirmada como reintentable, no como sincronizada", () => {
    expect(sync).toContain("UPLOAD_NOT_CONFIRMED");
  });

  it("la documentación describe el sondeo, los casos 308/404 y el secreto de la session URL", () => {
    expect(doc).toMatch(/Content-Range: bytes \*\/TOTAL/);
    expect(doc).toMatch(/308/);
    expect(doc).toMatch(/404/);
    expect(doc).toMatch(/capability URL/i);
    expect(doc).toMatch(/nunca.*persiste/i);
  });
});

describe("Fase 8D.1 — Clientes homónimos: la carpeta automática exige nombre único", () => {
  it("el worker compara contra OTROS Clientes con el normalizador de Fase 8A", () => {
    const start = sync.indexOf("async function handleEnsureClientFolder");
    const body = sync.slice(start, sync.indexOf("\n/**", start));
    expect(body).toContain("normalizeClientName(client.name)");
    expect(body).toContain('.neq("id", job.client_id)');
    expect(body).toContain("CLIENT_NAME_REVIEW_REQUIRED");
  });

  it("no reimplementa una tercera normalización: reutiliza la de zip-import", () => {
    expect(sync).toContain(
      'import { normalizeClientName } from "@/lib/zip-import/client-normalizer"',
    );
  });

  it("la comprobación de colisión ocurre DESPUÉS de reconciliar una reserva ya existente", () => {
    const start = sync.indexOf("async function handleEnsureClientFolder");
    const body = sync.slice(start, sync.indexOf("\n/**", start));
    const reconcileIdx = body.indexOf("mapping?.drive_folder_id");
    const collisionIdx = body.indexOf("CLIENT_NAME_REVIEW_REQUIRED");
    expect(reconcileIdx).toBeGreaterThan(-1);
    expect(collisionIdx).toBeGreaterThan(reconcileIdx);
  });

  it("no se añade ninguna constraint UNIQUE sobre el nombre de Cliente: el modelo jurídico no cambia", () => {
    for (const source of [migration, foundation]) {
      expect(source).not.toMatch(/unique[\s\S]{0,40}clients?\.name/i);
      expect(source).not.toMatch(/unique[\s\S]{0,40}normalized/i);
    }
  });

  it("la documentación explica por qué no se prohíben nombres duplicados en el CRM", () => {
    expect(doc).toContain("CLIENT_NAME_REVIEW_REQUIRED");
    expect(doc).toMatch(/dos personas distintas pueden llamarse igual/i);
  });
});

describe("Fase 8D.1 — contrato de reconciliación para 8F: no sobreafirmar", () => {
  it("la documentación distingue creates/uploads (recuperables desde el CRM) de deletes perdidos (requieren Drive-side scan)", () => {
    expect(doc).toMatch(/reconciliables desde el CRM/i);
    expect(doc).toMatch(/NO son visibles desde la base de datos del CRM/i);
    expect(doc).toMatch(/appProperties\.crm_entity/);
    expect(doc).toMatch(/huérfano/i);
  });

  it("Fase 8F implementó el escaneo real (ver tests/google-drive-automatic-sync-*.test.ts); nunca resucita un huérfano detectado", () => {
    expect(sync).toContain("searchGoogleDriveManagedFiles");
    expect(sync).toContain("orphanDriveFileIds");
    const start = sync.indexOf("async function runGoogleDriveReconciliation");
    const body = sync.slice(start, sync.indexOf("\n// ── procesador", start));
    expect(body).not.toMatch(/insert into|\.insert\(\{[\s\S]{0,80}documents/);
    expect(body).not.toContain("trashDriveFile");
  });
});
