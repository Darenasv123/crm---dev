/**
 * zip-import/import-engine.server.ts
 *
 * Motor de importación ZIP — SOLO SERVER.
 * Usa el Supabase service role para operaciones privilegiadas.
 * Nunca se importa en el bundle del cliente.
 *
 * Responsabilidades:
 *  - Validar autorización (solo Administrador)
 *  - Descomprimir y analizar el ZIP en servidor
 *  - Dry-run: simular sin escribir nada
 *  - Importación real:
 *    • Crear import_job
 *    • Crear clientes (o vincular a existentes)
 *    • Subir archivos a bucket "documents"
 *    • Crear registros en documents
 *    • Actualizar import_job al finalizar
 *  - Devolver resultado completo
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import type { Database } from "../database.types";
import { inferDocumentType } from "../document-types";
import { requireServerEnv } from "../env-server";
import { requireUser } from "../auth-server";
import { analyzeZipEntries } from "./analyzer";
import { findClientMatch } from "./client-normalizer";
import { buildClientInitials } from "../client-validation";
import {
  MAX_ZIP_SIZE_BYTES,
  validateEntryPath,
  shouldIgnoreEntry,
  isDangerousExtension,
  ZIP_SECURITY_LIMITS,
  detectZipBomb,
} from "./security";
import { ALLOWED_DOC_EXTENSIONS } from "./analyzer";
import type { ImportJobResult, DryRunResult, DryRunClientResult } from "./types";

// ─── Admin client ─────────────────────────────────────────────────────────────

function getAdminClient() {
  const url = requireServerEnv("SUPABASE_URL");
  const serviceKey = requireServerEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient<Database>(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ─── Colors para clientes ─────────────────────────────────────────────────────

const COLORS = [
  "oklch(0.74 0.12 80)",
  "oklch(0.55 0.13 235)",
  "oklch(0.62 0.14 155)",
  "oklch(0.62 0.18 25)",
  "oklch(0.55 0.13 290)",
  "oklch(0.34 0.09 255)",
];

function randomColor(): string {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

// ─── Schema de validación ─────────────────────────────────────────────────────

const clientDecisionSchema = z.object({
  originalName: z.string().min(1),
  normalizedName: z.string(),
  folderPath: z.string(),
  action: z.enum(["create", "link", "skip", "review"]),
  linkToClientId: z.string().uuid().nullable(),
});

const zipImportSchema = z.object({
  accessToken: z.string().min(1),
  zipFileName: z.string().min(1),
  zipBase64: z.string().min(1),
  clients: z.array(clientDecisionSchema),
  dryRun: z.boolean(),
});

// ─── Server function principal ────────────────────────────────────────────────

export const executeZipImportFn = createServerFn({ method: "POST" })
  .validator(zipImportSchema)
  .handler(async ({ data }): Promise<ImportJobResult | DryRunResult> => {
    // 1. Autenticación
    const user = await requireUser(data.accessToken);

    // 2. Autorización: solo Administrador
    const admin = getAdminClient();
    const { data: profile, error: profileErr } = await admin
      .from("profiles")
      .select("role, status")
      .eq("id", user.id)
      .single();

    if (profileErr || !profile) {
      throw new Error("No se pudo verificar el perfil del usuario.");
    }
    if (profile.role !== "Administrador" || profile.status !== "Activo") {
      throw new Error("Solo los Administradores activos pueden ejecutar importaciones ZIP.");
    }

    // 3. Decodificar ZIP
    if (decodedBase64Size(data.zipBase64) > MAX_ZIP_SIZE_BYTES) {
      throw new Error("El archivo ZIP supera el límite de 1 GB.");
    }
    const zipBuffer = Buffer.from(data.zipBase64, "base64");

    // Verificar límite de tamaño
    if (zipBuffer.byteLength > MAX_ZIP_SIZE_BYTES) {
      throw new Error("El archivo ZIP supera el límite de 1 GB.");
    }

    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(zipBuffer);
    } catch {
      throw new Error("El archivo ZIP está corrupto o no es válido.");
    }

    const allZipFiles = Object.values(zip.files);

    if (allZipFiles.length > ZIP_SECURITY_LIMITS.MAX_ENTRIES) {
      throw new Error(`El ZIP contiene demasiadas entradas (${allZipFiles.length}).`);
    }

    // 4. Construir entradas seguras (sin getData real en server — leemos inline)
    let totalUncompressed = 0;
    const safeEntries: Array<{
      path: string;
      isDirectory: boolean;
      size: number;
      zipObj: JSZip.JSZipObject;
    }> = [];

    for (const zipObj of allZipFiles) {
      const path = zipObj.name.replace(/\\/g, "/");

      if (zipObj.unsafeOriginalName) {
        const originalPathCheck = validateEntryPath(zipObj.unsafeOriginalName);
        if (!originalPathCheck.safe) {
          throw new Error(originalPathCheck.reason);
        }
      }

      if (shouldIgnoreEntry(path)) continue;
      const check = validateEntryPath(path);
      if (!check.safe) {
        throw new Error(check.reason);
      }

      const raw = (
        zipObj as JSZip.JSZipObject & {
          _data?: { compressedSize?: number; uncompressedSize?: number };
        }
      )._data;
      const compressedSize: number = raw?.compressedSize ?? 0;
      const uncompressedSize: number = raw?.uncompressedSize ?? 0;

      const unixPermissions = zipObj.unixPermissions;
      if (typeof unixPermissions === "number" && (unixPermissions & 0xf000) === 0xa000) {
        throw new Error(`Enlace simbólico no permitido: "${path}".`);
      }

      if (detectZipBomb({ compressedSize, uncompressedSize })) {
        throw new Error(`Posible ZIP bomb en "${path}".`);
      }

      totalUncompressed += uncompressedSize;
      if (totalUncompressed > ZIP_SECURITY_LIMITS.MAX_UNCOMPRESSED_BYTES) {
        throw new Error("El contenido descomprimido supera el límite de 500 MB.");
      }

      safeEntries.push({ path, isDirectory: zipObj.dir, size: uncompressedSize, zipObj });
    }

    const serverAnalysis = analyzeZipEntries(
      safeEntries.map(({ path, isDirectory, size }) => ({ path, isDirectory, size })),
    );
    if (serverAnalysis.securityViolations.length > 0) {
      throw new Error(serverAnalysis.securityViolations[0]);
    }
    const detectedByPath = new Map(
      serverAnalysis.clients.map((client) => [client.folderPath, client]),
    );

    // 5. Cargar clientes existentes para deduplicación
    const { data: existingClients, error: clientsErr } = await admin
      .from("clients")
      .select("id, name");
    if (clientsErr) throw new Error(`Error cargando clientes: ${clientsErr.message}`);
    const existingClientList = existingClients ?? [];

    // 6. Revalidar en servidor las decisiones construidas en la vista previa
    const seenFolderPaths = new Set<string>();
    for (const decision of data.clients) {
      const detected = detectedByPath.get(decision.folderPath);
      if (!detected || seenFolderPaths.has(decision.folderPath)) {
        throw new Error(`Decisión de cliente inválida para la ruta "${decision.folderPath}".`);
      }
      if (
        detected.originalName !== decision.originalName ||
        detected.normalizedName !== decision.normalizedName
      ) {
        throw new Error(`Los datos del cliente "${decision.folderPath}" no coinciden con el ZIP.`);
      }
      if (
        decision.action === "link" &&
        !existingClientList.some((client) => client.id === decision.linkToClientId)
      ) {
        throw new Error(`El cliente de destino para "${decision.originalName}" no existe.`);
      }
      seenFolderPaths.add(decision.folderPath);
    }

    // 7. Obtener documentos existentes para detectar duplicados
    const { data: existingDocs, error: existingDocsError } = await admin
      .from("documents")
      .select("client_id, relative_path, original_name, file_size");
    if (existingDocsError) {
      throw new Error(`Error cargando documentos: ${existingDocsError.message}`);
    }
    const existingDocSet = new Set(
      (existingDocs ?? [])
        .filter((d) => d.relative_path && d.client_id)
        .map((d) => `${d.client_id}::${d.relative_path}`),
    );

    // ─── DRY-RUN ───────────────────────────────────────────────────────────────
    if (data.dryRun) {
      return buildDryRunResult(data.clients, safeEntries, existingClientList, existingDocSet);
    }

    // ─── IMPORTACIÓN REAL ──────────────────────────────────────────────────────

    // 8. Crear import_job
    const { data: importJob, error: jobErr } = await admin
      .from("import_jobs")
      .insert({
        name: `ZIP: ${data.zipFileName}`,
        provider: "zip_upload",
        status: "processing",
        total_folders: data.clients.filter((c) => c.action !== "skip").length,
        total_documents: safeEntries.filter((e) => !e.isDirectory).length,
        detected_clients: data.clients.length,
        started_at: new Date().toISOString(),
        created_by: user.id,
        configuration: { zipFileName: data.zipFileName, dryRun: false },
      })
      .select("id")
      .single();

    if (jobErr || !importJob) {
      throw new Error(`No se pudo crear el import_job: ${jobErr?.message}`);
    }
    const importJobId = importJob.id;

    const startTime = Date.now();
    const errors: Array<{ client: string; file: string; message: string }> = [];
    const warnings: string[] = [];
    let clientsCreated = 0;
    let clientsLinked = 0;
    let clientsSkipped = 0;
    let documentsUploaded = 0;
    let documentsSkipped = 0;
    let documentsWithErrors = 0;

    // 9. Procesar cada cliente
    for (const decision of data.clients) {
      if (decision.action === "skip" || decision.action === "review") {
        clientsSkipped++;
        continue;
      }

      let clientId: string;
      let createdForDecision = false;

      try {
        if (decision.action === "create") {
          // Verificar duplicado exacto antes de crear
          const exactMatch = findClientMatch(decision.originalName, existingClientList);
          if (exactMatch?.strength === "exact") {
            // Ya existe — vincular automáticamente y no crear duplicado
            clientId = exactMatch.clientId;
            clientsLinked++;
            warnings.push(`"${decision.originalName}" ya existía. Vinculado automáticamente.`);
          } else {
            // Crear nuevo cliente
            const { data: newClient, error: createErr } = await admin
              .from("clients")
              .insert({
                name: decision.originalName,
                initials: buildClientInitials(decision.originalName),
                color: randomColor(),
                status: "Activo",
                created_by: user.id,
              })
              .select("id")
              .single();

            if (createErr || !newClient) {
              errors.push({
                client: decision.originalName,
                file: "",
                message: createErr?.message ?? "No se pudo crear el cliente.",
              });
              continue;
            }
            clientId = newClient.id;
            clientsCreated++;
            createdForDecision = true;

            // Agregar a la lista local para evitar duplicados en esta misma importación
            existingClientList.push({ id: clientId, name: decision.originalName });
          }
        } else {
          // action === "link"
          if (!decision.linkToClientId) {
            errors.push({
              client: decision.originalName,
              file: "",
              message: "Vincular requiere linkToClientId.",
            });
            continue;
          }
          clientId = decision.linkToClientId;
          clientsLinked++;
        }

        // Registrar import_folder
        const { error: folderError } = await admin.from("import_folders").insert({
          import_job_id: importJobId,
          external_folder_id: decision.folderPath,
          folder_name: decision.originalName,
          folder_path: decision.folderPath,
          detected_client_id: clientId,
          analysis_status: "completed",
        });
        if (folderError) {
          if (createdForDecision) {
            const { error: clientCleanupError } = await admin
              .from("clients")
              .delete()
              .eq("id", clientId);
            if (clientCleanupError) {
              warnings.push(
                `No se pudo revertir el cliente "${decision.originalName}": ${clientCleanupError.message}`,
              );
            } else {
              clientsCreated--;
              const createdIndex = existingClientList.findIndex((client) => client.id === clientId);
              if (createdIndex >= 0) existingClientList.splice(createdIndex, 1);
            }
          }
          throw new Error(`No se pudo registrar la carpeta importada: ${folderError.message}`);
        }

        // Subir documentos de este cliente
        const clientEntries = safeEntries.filter((e) => {
          if (e.isDirectory) return false;
          const p = e.path;
          return p === decision.folderPath || p.startsWith(decision.folderPath + "/");
        });

        for (const entry of clientEntries) {
          const fileName = entry.path.split("/").pop() ?? entry.path;
          const ext = fileName.split(".").pop()?.toLowerCase() ?? "";

          if (isDangerousExtension(fileName)) {
            documentsSkipped++;
            continue;
          }
          if (!ALLOWED_DOC_EXTENSIONS.has(ext)) {
            documentsSkipped++;
            continue;
          }

          // Ruta relativa desde la raíz del cliente
          const clientSegs = decision.folderPath.split("/").filter(Boolean);
          const fileSegs = entry.path.split("/").filter(Boolean);
          const relativePath = fileSegs.slice(clientSegs.length).join("/");

          // Verificar duplicado
          const dupKey = `${clientId}::${relativePath}`;
          if (existingDocSet.has(dupKey)) {
            documentsSkipped++;
            warnings.push(
              `Documento duplicado omitido: "${relativePath}" para cliente "${decision.originalName}".`,
            );
            continue;
          }

          // Leer datos
          let fileBuffer: ArrayBuffer;
          try {
            fileBuffer = await entry.zipObj.async("arraybuffer");
          } catch {
            documentsWithErrors++;
            errors.push({
              client: decision.originalName,
              file: fileName,
              message: "No se pudo leer el archivo del ZIP.",
            });
            continue;
          }

          // Storage path único
          const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
          const storagePath = `${clientId}/${crypto.randomUUID()}_${safeName}`;
          const contentHash = await sha256Hex(fileBuffer);

          // Subir a Storage (con reintento)
          let uploadError: string | null = null;
          for (let attempt = 1; attempt <= 3; attempt++) {
            const { error: uploadErr } = await admin.storage
              .from("documents")
              .upload(storagePath, fileBuffer, {
                contentType: mimeForExt(ext),
                upsert: false,
              });
            if (!uploadErr) {
              uploadError = null;
              break;
            }
            uploadError = uploadErr.message;
            if (attempt < 3) await sleep(500 * attempt);
          }

          if (uploadError) {
            documentsWithErrors++;
            errors.push({
              client: decision.originalName,
              file: fileName,
              message: `Storage error: ${uploadError}`,
            });
            continue;
          }

          // Crear registro en documents
          const documentType = inferDocumentType(relativePath);
          const { error: docErr } = await admin.from("documents").insert({
            client_id: clientId,
            name: fileName,
            original_name: fileName,
            display_name: fileName,
            storage_path: storagePath,
            relative_path: relativePath,
            size: String(entry.size), // legacy field: string
            type: documentType,
            document_type: documentType,
            file_size: entry.size,
            mime_type: mimeForExt(ext),
            source_type: "zip_import",
            source_provider: "zip_upload",
            processing_status: "pending",
            verification_status: "pending",
            created_by: user.id,
            checksum: contentHash,
            content_hash: contentHash,
          });

          if (docErr) {
            documentsWithErrors++;
            errors.push({
              client: decision.originalName,
              file: fileName,
              message: `DB error: ${docErr.message}`,
            });
            const { error: cleanupError } = await admin.storage
              .from("documents")
              .remove([storagePath]);
            if (cleanupError) {
              warnings.push(
                `No se pudo limpiar Storage tras el error de DB para "${fileName}": ${cleanupError.message}`,
              );
            }
            continue;
          }

          existingDocSet.add(dupKey);
          documentsUploaded++;
        }
      } catch (err) {
        errors.push({
          client: decision.originalName,
          file: "",
          message: err instanceof Error ? err.message : "Error inesperado.",
        });
      }
    }

    // 10. Actualizar import_job
    const madeProgress = clientsCreated + clientsLinked + documentsUploaded > 0;
    const finalStatus =
      errors.length === 0 ? "completed" : madeProgress ? "partially_completed" : "failed";

    const { error: finalJobError } = await admin
      .from("import_jobs")
      .update({
        status: finalStatus,
        processed_documents: documentsUploaded,
        failed_documents: documentsWithErrors,
        completed_at: new Date().toISOString(),
        progress_percentage: 100,
        error_message:
          errors.length > 0
            ? errors
                .map((e) => `${e.client}/${e.file}: ${e.message}`)
                .join("; ")
                .slice(0, 2000)
            : null,
      })
      .eq("id", importJobId);
    if (finalJobError) {
      throw new Error(`No se pudo finalizar el import_job: ${finalJobError.message}`);
    }

    return {
      importJobId,
      clientsCreated,
      clientsLinked,
      clientsSkipped,
      documentsUploaded,
      documentsSkipped,
      documentsWithErrors,
      errors,
      warnings,
      durationSeconds: Math.round((Date.now() - startTime) / 1000),
    };
  });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodedBase64Size(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}

const MIME_MAP: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  txt: "text/plain",
};

function mimeForExt(ext: string): string {
  return MIME_MAP[ext.toLowerCase()] ?? "application/octet-stream";
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function buildDryRunResult(
  clients: (typeof zipImportSchema._type)["clients"],
  safeEntries: Array<{ path: string; isDirectory: boolean; size: number }>,
  existingClientList: Array<{ id: string; name: string }>,
  existingDocSet: Set<string>,
): DryRunResult {
  let clientsToCreate = 0;
  let clientsToLink = 0;
  let clientsToSkip = 0;
  let filesToUpload = 0;
  let filesToSkip = 0;
  let totalSize = 0;
  const clientResults: DryRunClientResult[] = [];
  const warnings: string[] = [];

  for (const decision of clients) {
    if (decision.action === "skip" || decision.action === "review") {
      clientsToSkip++;
      clientResults.push({
        originalName: decision.originalName,
        action: decision.action,
        linkToClientId: null,
        documentsToUpload: [],
        documentsSkipped: 0,
        warnings: [],
      });
      continue;
    }

    let clientId =
      decision.action === "link" ? (decision.linkToClientId ?? "preview-id") : "preview-id";

    if (decision.action === "create") {
      const exactMatch = findClientMatch(decision.originalName, existingClientList);
      if (exactMatch?.strength === "exact") {
        clientId = exactMatch.clientId;
        clientsToLink++;
        warnings.push(`"${decision.originalName}" ya existía (dry-run: se vincularía).`);
      } else {
        clientsToCreate++;
      }
    } else {
      clientsToLink++;
    }

    const clientEntries = safeEntries.filter((e) => {
      if (e.isDirectory) return false;
      return e.path === decision.folderPath || e.path.startsWith(decision.folderPath + "/");
    });

    const docsToUpload: DryRunClientResult["documentsToUpload"] = [];
    let skipped = 0;

    for (const entry of clientEntries) {
      const fileName = entry.path.split("/").pop() ?? "";
      const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
      if (!ALLOWED_DOC_EXTENSIONS.has(ext)) {
        skipped++;
        continue;
      }
      if (isDangerousExtension(fileName)) {
        skipped++;
        continue;
      }

      const clientSegs = decision.folderPath.split("/").filter(Boolean);
      const fileSegs = entry.path.split("/").filter(Boolean);
      const relativePath = fileSegs.slice(clientSegs.length).join("/");
      const dupKey = `${clientId}::${relativePath}`;
      if (existingDocSet.has(dupKey)) {
        skipped++;
        continue;
      }

      docsToUpload.push({
        relativePath,
        originalName: fileName,
        size: entry.size,
        extension: ext,
        mimeType: mimeForExt(ext),
      });
      filesToUpload++;
      totalSize += entry.size;
    }

    filesToSkip += skipped;
    clientResults.push({
      originalName: decision.originalName,
      action: decision.action,
      linkToClientId: decision.linkToClientId,
      documentsToUpload: docsToUpload,
      documentsSkipped: skipped,
      warnings: [],
    });
  }

  return {
    clientsToCreate,
    clientsToLink,
    clientsToSkip,
    filesToUpload,
    filesToSkip,
    totalSize,
    clientResults,
    warnings,
  };
}
