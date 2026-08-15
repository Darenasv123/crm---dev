/**
 * zip-importer.tsx
 *
 * Orquestador del flujo completo de importación ZIP.
 * Maneja las 8 etapas: selector de archivo → análisis → vista previa →
 * dry-run → confirmación → importación → resultado.
 *
 * La operación privilegiada (crear clientes, subir archivos) se ejecuta
 * exclusivamente via executeZipImportFn (server function).
 */

import { useState, useCallback } from "react";
import { FolderArchive, AlertTriangle, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ZipFilePicker } from "./zip-file-picker";
import { ZipAnalysisProgress } from "./zip-analysis-progress";
import { ZipPreviewTable } from "./zip-preview-table";
import { ZipDryRunPanel } from "./zip-dry-run-panel";
import { ZipImportProgress } from "./zip-import-progress";
import { ZipImportResult } from "./zip-import-result";
import { ZipImportErrorBoundary } from "./zip-import-error-boundary";
import { readZipFile } from "@/lib/zip-import/zip-reader";
import { analyzeZipEntries } from "@/lib/zip-import/analyzer";
import { findClientMatch } from "@/lib/zip-import/client-normalizer";
import { executeZipImportFn } from "@/lib/zip-import/import-engine.server";
import { describeCaughtError } from "@/lib/zip-import/describe-caught-error";
import { supabase } from "@/lib/supabase";
import type {
  ZipAnalysisSummary,
  ClientPreviewItem,
  DryRunResult,
  ImportJobResult,
} from "@/lib/zip-import/types";

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer el archivo ZIP."));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("No se pudo codificar el archivo ZIP."));
        return;
      }
      const separator = result.indexOf(",");
      resolve(separator >= 0 ? result.slice(separator + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

export type ZipImportStage =
  "pick" | "analyzing" | "preview" | "dryrun" | "confirming" | "importing" | "result" | "error";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** Clientes existentes de la DB para deduplicación */
  existingClients: Array<{ id: string; name: string }>;
}

export function ZipImporter({ open, onClose, onSuccess, existingClients }: Props) {
  const [stage, setStage] = useState<ZipImportStage>("pick");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<ZipAnalysisSummary | null>(null);
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);
  const [importResult, setImportResult] = useState<ImportJobResult | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState("");

  const handleClose = useCallback(() => {
    setStage("pick");
    setSelectedFile(null);
    setAnalysis(null);
    setDryRunResult(null);
    setImportResult(null);
    setFatalError(null);
    onClose();
  }, [onClose]);

  // ─── Etapa 2 → 3: Analizar ZIP ───────────────────────────────────────────
  const handleFileSelected = useCallback(
    async (file: File) => {
      setSelectedFile(file);
      setStage("analyzing");
      setFatalError(null);

      try {
        setAnalysisProgress("Leyendo archivo ZIP…");
        const { entries, fatalError: readError, warnings: readWarnings } = await readZipFile(file);

        if (readError) {
          setFatalError(readError);
          setStage("error");
          return;
        }

        setAnalysisProgress("Detectando estructura de carpetas…");
        const result = analyzeZipEntries(entries);

        if (result.securityViolations.length > 0) {
          setFatalError(
            `Violaciones de seguridad detectadas:\n${result.securityViolations.slice(0, 5).join("\n")}`,
          );
          setStage("error");
          return;
        }

        setAnalysisProgress("Buscando clientes duplicados…");
        // Construir vista previa con deduplicación contra DB
        const previewClients: ClientPreviewItem[] = result.clients.map((c, i) => {
          const existingMatch = findClientMatch(c.originalName, existingClients) ?? null;
          const defaultAction =
            existingMatch?.strength === "exact"
              ? ("link" as const)
              : existingMatch?.strength === "probable"
                ? ("review" as const)
                : ("create" as const);

          return {
            index: i,
            originalName: c.originalName,
            normalizedName: c.normalizedName,
            folderPath: c.folderPath,
            allowedFileCount: c.documents.filter((d) => d.allowed).length,
            ignoredFileCount: c.documents.filter((d) => !d.allowed).length,
            subfolderCount: c.subfolderCount,
            totalSize: c.totalSize,
            existingMatch,
            action: defaultAction,
            linkToClientId: existingMatch?.strength === "exact" ? existingMatch.clientId : null,
            warnings: c.warnings,
          };
        });

        const summary: ZipAnalysisSummary = {
          fileName: file.name,
          fileSize: file.size,
          totalEntries: result.totalEntries,
          hasOuterContainer: result.hasOuterContainer,
          containerName: result.containerName,
          clients: previewClients,
          warnings: [...readWarnings, ...result.warnings],
          securityViolations: result.securityViolations,
          ignoredCount: result.ignored.length,
        };

        setAnalysis(summary);
        setStage("preview");
      } catch (err) {
        setFatalError(describeCaughtError(err, "Error al analizar el ZIP."));
        setStage("error");
      }
    },
    [existingClients],
  );

  // ─── Etapa 4: Dry-run ─────────────────────────────────────────────────────
  const handleRunDryRun = useCallback(
    async (updatedClients: ClientPreviewItem[]) => {
      if (!selectedFile || !analysis) return;
      setStage("dryrun");

      try {
        const session = await supabase.auth.getSession();
        const accessToken = session.data.session?.access_token ?? "";

        // Leer el ZIP como base64 para enviarlo al servidor
        const base64 = await readFileAsBase64(selectedFile);

        const result = await executeZipImportFn({
          data: {
            accessToken,
            zipFileName: analysis.fileName,
            zipBase64: base64,
            clients: updatedClients.map((c) => ({
              originalName: c.originalName,
              normalizedName: c.normalizedName,
              folderPath: c.folderPath,
              action: c.action,
              linkToClientId: c.linkToClientId,
            })),
            dryRun: true,
          },
        });

        setDryRunResult(result as DryRunResult);
        // Actualizar analysis con las decisiones del usuario
        setAnalysis({ ...analysis, clients: updatedClients });
      } catch (err) {
        setFatalError(describeCaughtError(err, "Error en el dry-run."));
        setStage("error");
      }
    },
    [selectedFile, analysis],
  );

  // ─── Etapa 6: Importación real ────────────────────────────────────────────
  const handleConfirmImport = useCallback(async () => {
    if (!selectedFile || !analysis) return;
    setStage("importing");

    try {
      const session = await supabase.auth.getSession();
      const accessToken = session.data.session?.access_token ?? "";

      const base64 = await readFileAsBase64(selectedFile);

      const result = await executeZipImportFn({
        data: {
          accessToken,
          zipFileName: analysis.fileName,
          zipBase64: base64,
          clients: analysis.clients.map((c) => ({
            originalName: c.originalName,
            normalizedName: c.normalizedName,
            folderPath: c.folderPath,
            action: c.action,
            linkToClientId: c.linkToClientId,
          })),
          dryRun: false,
        },
      });

      setImportResult(result as ImportJobResult);
      setStage("result");
      onSuccess();
    } catch (err) {
      setFatalError(describeCaughtError(err, "Error durante la importación."));
      setStage("error");
    }
  }, [selectedFile, analysis, onSuccess]);

  const updateClientAction = useCallback((index: number, updates: Partial<ClientPreviewItem>) => {
    setAnalysis((prev) => {
      if (!prev) return prev;
      const clients = prev.clients.map((c) => (c.index === index ? { ...c, ...updates } : c));
      return { ...prev, clients };
    });
  }, []);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && stage !== "importing" && handleClose()}>
      <DialogContent size="xl" className="max-h-[90vh]">
        <DialogHeader icon={FolderArchive}>
          <DialogTitle>Importar desde ZIP</DialogTitle>
          <DialogDescription>
            {stage === "pick" && "Selecciona un archivo ZIP con carpetas de clientes."}
            {stage === "analyzing" && "Analizando la estructura del archivo…"}
            {stage === "preview" &&
              `${analysis?.clients.length ?? 0} clientes detectados. Revisa y ajusta las acciones.`}
            {stage === "dryrun" && "Simulación completada. Revisa el resultado antes de confirmar."}
            {stage === "confirming" && "Confirma para iniciar la importación."}
            {stage === "importing" && "Importando clientes y documentos…"}
            {stage === "result" && "Importación completada."}
            {stage === "error" && "Se encontró un problema que impide continuar."}
          </DialogDescription>
        </DialogHeader>

        {/*
         * Boundary local: si el render de cualquier etapa revienta (p.ej. un
         * valor inesperado en la respuesta del servidor), esto evita que el
         * error suba hasta el boundary global de la app (src/routes/__root.tsx)
         * y reemplace toda la pantalla. Ver zip-import-error-boundary.tsx.
         */}
        <ZipImportErrorBoundary onReset={handleClose}>
          {/* ── Error fatal (controlado, capturado por try/catch) ── */}
          {stage === "error" && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 shrink-0 text-red-600 mt-0.5" />
                <div>
                  <p className="font-semibold text-red-700 text-sm">No se puede continuar</p>
                  <pre className="mt-2 text-xs text-red-600 whitespace-pre-wrap break-words">
                    {fatalError}
                  </pre>
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <Button variant="outline" onClick={handleClose}>
                  <X className="h-4 w-4 mr-1" />
                  Cerrar
                </Button>
              </div>
            </div>
          )}

          {/* ── Etapa 2: Selección archivo ── */}
          {stage === "pick" && (
            <ZipFilePicker onFileSelected={handleFileSelected} onCancel={handleClose} />
          )}

          {/* ── Etapa 3: Análisis en progreso ── */}
          {stage === "analyzing" && (
            <ZipAnalysisProgress message={analysisProgress} fileName={selectedFile?.name ?? ""} />
          )}

          {/* ── Etapa 4: Vista previa ── */}
          {stage === "preview" && analysis && (
            <ZipPreviewTable
              summary={analysis}
              existingClients={existingClients}
              onUpdateAction={updateClientAction}
              onRunDryRun={handleRunDryRun}
              onCancel={handleClose}
            />
          )}

          {/* ── Etapa 5: Dry-run resultado ── */}
          {stage === "dryrun" && dryRunResult && analysis && (
            <ZipDryRunPanel
              dryRunResult={dryRunResult}
              onConfirm={() => setStage("confirming")}
              onBack={() => setStage("preview")}
              onCancel={handleClose}
            />
          )}

          {/* ── Etapa 5.5: Confirmación explícita ── */}
          {stage === "confirming" && dryRunResult && (
            <ConfirmationPanel
              dryRunResult={dryRunResult}
              onConfirm={handleConfirmImport}
              onBack={() => setStage("dryrun")}
              onCancel={handleClose}
            />
          )}

          {/* ── Etapa 6: Progreso de importación ── */}
          {stage === "importing" && <ZipImportProgress />}

          {/* ── Etapa 7: Resultado final ── */}
          {stage === "result" && importResult && (
            <ZipImportResult result={importResult} onClose={handleClose} />
          )}
        </ZipImportErrorBoundary>
      </DialogContent>
    </Dialog>
  );
}

// ─── Panel de confirmación explícita ─────────────────────────────────────────

function ConfirmationPanel({
  dryRunResult,
  onConfirm,
  onBack,
  onCancel,
}: {
  dryRunResult: DryRunResult;
  onConfirm: () => void;
  onBack: () => void;
  onCancel: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <p className="font-semibold text-amber-800 text-sm mb-3">Estás a punto de:</p>
        <ul className="text-sm text-amber-700 space-y-1">
          <li>
            • Crear <strong>{dryRunResult.clientsToCreate}</strong> cliente(s) nuevo(s)
          </li>
          <li>
            • Vincular <strong>{dryRunResult.clientsToLink}</strong> cliente(s) existente(s)
          </li>
          <li>
            • Subir <strong>{dryRunResult.filesToUpload}</strong> documento(s) al bucket{" "}
            <code>documents</code>
          </li>
          <li>
            • Omitir <strong>{dryRunResult.clientsToSkip}</strong> cliente(s) y{" "}
            <strong>{dryRunResult.filesToSkip}</strong> archivo(s)
          </li>
        </ul>
        <p className="mt-3 text-xs text-amber-600">
          Esta acción modificará la base de datos y Storage. No se puede deshacer automáticamente.
        </p>
      </div>

      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-border"
        />
        <span className="text-sm">
          Confirmo que he revisado la vista previa y autorizo la importación.
        </span>
      </label>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button variant="outline" onClick={onBack}>
          Atrás
        </Button>
        <Button
          onClick={onConfirm}
          disabled={!confirmed}
          className="bg-primary text-primary-foreground disabled:opacity-50"
        >
          Confirmar importación
        </Button>
      </div>
    </div>
  );
}
