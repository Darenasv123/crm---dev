import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle, FolderSearch, HardDrive, Loader2 } from "lucide-react";
import { Card, StatusBadge } from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import {
  beginGoogleDriveConnection,
  disconnectGoogleDrive,
  getGoogleDriveStatus,
  setGoogleDriveRootFolder,
  type GoogleDriveStatus,
} from "@/lib/google-drive-client";
import { DriveFolderBrowserDialog } from "./drive-folder-browser-dialog";
import { DriveOnboardingDialog } from "./drive-onboarding-dialog";

/**
 * Configuración → Google Drive. Solo Administrador (la página entera de
 * Configuración ya es admin-only; este componente no abre ninguna superficie
 * nueva para Personal).
 *
 * Tres estados posibles y honestos:
 *   - No configurado: faltan las variables del servidor. No se ofrece
 *     "Conectar", porque pulsarlo solo daría un error.
 *   - Configurado pero no conectado: se ofrece "Conectar".
 *   - Conectado: se ofrece seleccionar la carpeta raíz y, una vez elegida,
 *     revisar coincidencias.
 *
 * Nunca se muestra un botón que todavía no funciona: la sincronización de
 * documentos llega en fases posteriores y aquí no aparece.
 */
export function GoogleDriveSettings() {
  const [status, setStatus] = useState<GoogleDriveStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [savingRoot, setSavingRoot] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await getGoogleDriveStatus());
      setError(null);
    } catch (cause) {
      setStatus(null);
      setError(cause instanceof Error ? cause.message : "No se pudo consultar la conexión.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleConnect() {
    setBusy(true);
    setError(null);
    try {
      await beginGoogleDriveConnection();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo iniciar la autorización.");
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await disconnectGoogleDrive();
      setMessage("Google Drive quedó desconectado en este CRM.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo desconectar.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSelectRoot(folderId: string) {
    setSavingRoot(true);
    setError(null);
    setMessage(null);
    try {
      const result = await setGoogleDriveRootFolder(folderId);
      setMessage(
        result.unchanged
          ? `La carpeta raíz sigue siendo "${result.rootFolderName}".`
          : `Carpeta raíz configurada: "${result.rootFolderName}".`,
      );
      setBrowserOpen(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar la carpeta raíz.");
    } finally {
      setSavingRoot(false);
    }
  }

  const configured = status?.configured ?? false;
  const connected = status?.connected ?? false;
  const rootConfigured = status?.rootFolderConfigured ?? false;

  return (
    <Card className="p-6">
      <div className="mb-5 flex items-center gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
          <HardDrive className="h-6 w-6" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold">Google Drive</h3>
          <p className="text-xs text-muted-foreground">
            Vincula cada cliente del CRM con su carpeta de Google Drive. Todavía no se sincronizan
            documentos.
          </p>
        </div>
        <StatusBadge tone={connected ? "success" : configured ? "default" : "warning"}>
          {loading
            ? "Consultando…"
            : connected
              ? "Conectada"
              : configured
                ? "No conectada"
                : "No configurado"}
        </StatusBadge>
      </div>

      {loading ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Consultando el estado de Google Drive…
        </p>
      ) : (
        <div className="space-y-4">
          {/* Resumen del estado, siempre con etiqueta textual además del color. */}
          <dl className="grid gap-3 rounded-lg border border-border bg-muted/30 p-4 text-sm sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-xs font-medium text-muted-foreground">Configuración</dt>
              <dd className="truncate">
                {configured ? "Variables disponibles" : "Variables del servidor pendientes"}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs font-medium text-muted-foreground">Cuenta</dt>
              <dd className="truncate" title={status?.accountEmail ?? undefined}>
                {status?.accountEmail || "Sin cuenta conectada"}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs font-medium text-muted-foreground">Carpeta raíz</dt>
              <dd className="truncate" title={status?.rootFolderName ?? undefined}>
                {rootConfigured ? status?.rootFolderName : "No seleccionada"}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs font-medium text-muted-foreground">Última sincronización</dt>
              <dd className="truncate">
                {status?.lastSyncedAt
                  ? new Date(status.lastSyncedAt).toLocaleString("es-PE")
                  : "Todavía no ejecutada"}
              </dd>
            </div>
          </dl>

          {!configured && (
            <p className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
              El servidor todavía no tiene las credenciales de Google Drive. Configúralas antes de
              intentar conectar; hasta entonces esta sección solo informa del estado.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {configured && !connected && (
              <Button type="button" onClick={handleConnect} loading={busy} disabled={busy}>
                <HardDrive className="h-4 w-4" aria-hidden="true" /> Conectar Google Drive
              </Button>
            )}
            {connected && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setBrowserOpen(true)}
                  disabled={busy}
                >
                  {rootConfigured ? "Cambiar carpeta raíz" : "Seleccionar carpeta raíz"}
                </Button>
                {rootConfigured && (
                  <Button type="button" variant="outline" onClick={() => setOnboardingOpen(true)}>
                    <FolderSearch className="h-4 w-4" aria-hidden="true" /> Revisar coincidencias
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleDisconnect}
                  loading={busy}
                  disabled={busy}
                >
                  Desconectar
                </Button>
              </>
            )}
          </div>

          {message && (
            <p
              role="status"
              className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm"
            >
              <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
              {message}
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {error}
            </p>
          )}
        </div>
      )}

      {connected && (
        <>
          <DriveFolderBrowserDialog
            open={browserOpen}
            onOpenChange={setBrowserOpen}
            onSelect={handleSelectRoot}
            saving={savingRoot}
            initialFolderId={status?.rootFolderId ?? null}
          />
          <DriveOnboardingDialog open={onboardingOpen} onOpenChange={setOnboardingOpen} />
        </>
      )}
    </Card>
  );
}
