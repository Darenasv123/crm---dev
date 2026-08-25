import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FolderSearch,
  HelpCircle,
  Link2,
  Loader2,
  MinusCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import {
  applyGoogleDriveMappings,
  getGoogleDriveOnboardingPreview,
  type DriveMappingInput,
  type DriveOnboardingPreview,
} from "@/lib/google-drive-client";

/**
 * Revisión de coincidencias Cliente <-> Carpeta.
 *
 * Abrir esta pantalla NO vincula nada: la vista previa es de solo lectura y
 * toda vinculación exige una confirmación explícita del Administrador. Ni
 * siquiera las coincidencias exactas se guardan solas.
 *
 * El estado de cada fila se comunica con texto e icono, nunca solo con
 * color.
 */
type Selection = Record<
  string,
  { driveFolderId: string; matchType: DriveMappingInput["matchType"] }
>;

function SectionHeading({
  icon: Icon,
  title,
  count,
  hint,
}: {
  icon: typeof Link2;
  title: string;
  count: number;
  hint: string;
}) {
  return (
    <div className="flex items-start gap-2 border-b border-border pb-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0">
        <h4 className="text-sm font-semibold">
          {title} <span className="text-muted-foreground">({count})</span>
        </h4>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

function RowCard({ children }: { children: React.ReactNode }) {
  return (
    <li className="rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {children}
      </div>
    </li>
  );
}

export function DriveOnboardingDialog({
  open,
  onOpenChange,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied?: () => void;
}) {
  const [preview, setPreview] = useState<DriveOnboardingPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setSelection({});
    try {
      setPreview(await getGoogleDriveOnboardingPreview());
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : "No se pudo calcular la vista previa.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // Una carpeta no puede asignarse a dos clientes en la misma operación. La
  // BD lo garantiza igualmente (UNIQUE), pero bloquearlo aquí evita que el
  // Administrador construya un lote que va a fallar entero.
  const usedFolderIds = useMemo(() => {
    const used = new Map<string, string>();
    for (const [clientId, entry] of Object.entries(selection)) {
      used.set(entry.driveFolderId, clientId);
    }
    return used;
  }, [selection]);

  function toggleSuggestion(
    clientId: string,
    driveFolderId: string,
    matchType: DriveMappingInput["matchType"],
    checked: boolean,
  ) {
    setSelection((previous) => {
      const next = { ...previous };
      if (checked) next[clientId] = { driveFolderId, matchType };
      else delete next[clientId];
      return next;
    });
  }

  function chooseAmbiguous(clientId: string, driveFolderId: string) {
    setSelection((previous) => {
      const next = { ...previous };
      if (!driveFolderId) delete next[clientId];
      else next[clientId] = { driveFolderId, matchType: "manual" };
      return next;
    });
  }

  function confirmAllSafe() {
    if (!preview) return;
    setSelection((previous) => {
      const next = { ...previous };
      // Solo exactas y normalizadas. Los ambiguos NUNCA entran aquí.
      for (const entry of preview.suggested) {
        next[entry.clientId] = { driveFolderId: entry.folderId, matchType: entry.matchType };
      }
      return next;
    });
  }

  const mappings: DriveMappingInput[] = Object.entries(selection).map(([clientId, entry]) => ({
    clientId,
    driveFolderId: entry.driveFolderId,
    matchType: entry.matchType,
  }));

  async function handleApply() {
    if (mappings.length === 0) return;
    setApplying(true);
    setError(null);
    setResult(null);
    try {
      const summary = await applyGoogleDriveMappings(mappings);
      setResult(
        `Se vincularon ${summary.created} cliente(s).` +
          (summary.unchanged > 0 ? ` ${summary.unchanged} ya estaban vinculados.` : ""),
      );
      onApplied?.();
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "No se pudieron guardar las vinculaciones.",
      );
    } finally {
      setApplying(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[calc(100dvh-2rem)]">
        <DialogHeader icon={FolderSearch}>
          <DialogTitle>Revisar coincidencias de clientes</DialogTitle>
          <DialogDescription>
            Comparación entre los clientes del CRM y las subcarpetas de{" "}
            <strong>{preview?.rootFolderName || "la carpeta raíz"}</strong>. Nada se guarda hasta
            que confirmes.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Calculando coincidencias…
          </p>
        ) : error && !preview ? (
          <p role="alert" className="flex items-start gap-2 py-8 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        ) : preview ? (
          <div className="space-y-6 overflow-y-auto">
            {/* ── Ya vinculados ── */}
            <section className="space-y-2">
              <SectionHeading
                icon={Link2}
                title="Ya vinculados"
                count={preview.linked.length}
                hint="Vinculaciones guardadas anteriormente. No se vuelven a evaluar."
              />
              {preview.linked.length === 0 ? (
                <p className="text-xs text-muted-foreground">Todavía no hay vinculaciones.</p>
              ) : (
                <ul className="space-y-2">
                  {preview.linked.map((entry) => (
                    <RowCard key={entry.clientId}>
                      <span className="min-w-0 truncate font-medium" title={entry.clientName}>
                        {entry.clientName}
                      </span>
                      <span
                        className="min-w-0 truncate text-xs text-muted-foreground"
                        title={entry.folderName}
                      >
                        Carpeta: {entry.folderName}
                      </span>
                    </RowCard>
                  ))}
                </ul>
              )}
            </section>

            {/* ── Coincidencias sugeridas ── */}
            <section className="space-y-2">
              <SectionHeading
                icon={CheckCircle2}
                title="Coincidencias sugeridas"
                count={preview.suggested.length}
                hint="Coinciden por nombre exacto o ignorando mayúsculas y acentos. Requieren tu confirmación."
              />
              {preview.suggested.length === 0 ? (
                <p className="text-xs text-muted-foreground">No hay coincidencias sugeridas.</p>
              ) : (
                <>
                  <Button type="button" variant="outline" size="sm" onClick={confirmAllSafe}>
                    Confirmar todas las sugerencias seguras
                  </Button>
                  <ul className="space-y-2">
                    {preview.suggested.map((entry) => {
                      const owner = usedFolderIds.get(entry.folderId);
                      const takenByOther = Boolean(owner && owner !== entry.clientId);
                      return (
                        <RowCard key={entry.clientId}>
                          <label className="flex min-w-0 items-start gap-2">
                            <input
                              type="checkbox"
                              className="mt-1 h-4 w-4 shrink-0"
                              checked={selection[entry.clientId]?.driveFolderId === entry.folderId}
                              disabled={takenByOther}
                              onChange={(event) =>
                                toggleSuggestion(
                                  entry.clientId,
                                  entry.folderId,
                                  entry.matchType,
                                  event.target.checked,
                                )
                              }
                            />
                            <span className="min-w-0">
                              <span className="block truncate font-medium" title={entry.clientName}>
                                {entry.clientName}
                              </span>
                              <span
                                className="block truncate text-xs text-muted-foreground"
                                title={entry.folderName}
                              >
                                Carpeta sugerida: {entry.folderName}
                              </span>
                            </span>
                          </label>
                          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {entry.matchType === "exact" ? "Nombre idéntico" : "Nombre equivalente"}
                          </span>
                        </RowCard>
                      );
                    })}
                  </ul>
                </>
              )}
            </section>

            {/* ── Ambiguos ── */}
            <section className="space-y-2">
              <SectionHeading
                icon={HelpCircle}
                title="Ambiguos"
                count={preview.ambiguous.length}
                hint="Varias carpetas coinciden. Elige tú cuál corresponde; el sistema nunca adivina."
              />
              {preview.ambiguous.length === 0 ? (
                <p className="text-xs text-muted-foreground">No hay casos ambiguos.</p>
              ) : (
                <ul className="space-y-2">
                  {preview.ambiguous.map((entry) => {
                    const selectId = `drive-ambiguous-${entry.clientId}`;
                    // Las candidatas del matching primero; después el resto de
                    // carpetas libres, por si la correcta no estaba entre
                    // ellas. Sin repetir ninguna.
                    const candidateIds = new Set(entry.candidates.map((c) => c.id));
                    const options = [
                      ...entry.candidates,
                      ...preview.availableFolders.filter((f) => !candidateIds.has(f.id)),
                    ];
                    return (
                      <RowCard key={entry.clientId}>
                        <label
                          htmlFor={selectId}
                          className="min-w-0 truncate font-medium"
                          title={entry.clientName}
                        >
                          {entry.clientName}
                        </label>
                        <NativeSelect
                          id={selectId}
                          className="w-full sm:w-64"
                          value={selection[entry.clientId]?.driveFolderId ?? ""}
                          onChange={(event) => chooseAmbiguous(entry.clientId, event.target.value)}
                        >
                          <option value="">Sin asignar</option>
                          {options.map((folder) => {
                            const owner = usedFolderIds.get(folder.id);
                            return (
                              <option
                                key={folder.id}
                                value={folder.id}
                                disabled={Boolean(owner && owner !== entry.clientId)}
                              >
                                {folder.name}
                              </option>
                            );
                          })}
                        </NativeSelect>
                      </RowCard>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* ── Clientes sin carpeta ── */}
            <section className="space-y-2">
              <SectionHeading
                icon={MinusCircle}
                title="Clientes sin carpeta"
                count={preview.clientsWithoutFolder.length}
                hint="No existe una carpeta con ese nombre dentro de la carpeta raíz."
              />
              {preview.clientsWithoutFolder.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Todos los clientes tienen una carpeta candidata.
                </p>
              ) : (
                <ul className="space-y-2">
                  {preview.clientsWithoutFolder.map((entry) => (
                    <RowCard key={entry.clientId}>
                      <span className="min-w-0 truncate font-medium" title={entry.clientName}>
                        {entry.clientName}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        Sin carpeta encontrada
                      </span>
                    </RowCard>
                  ))}
                </ul>
              )}
            </section>

            {/* ── Carpetas sin Cliente ── */}
            <section className="space-y-2">
              <SectionHeading
                icon={FolderSearch}
                title="Carpetas sin cliente"
                count={preview.foldersWithoutClient.length}
                hint="Carpetas de Drive que no corresponden a ningún cliente del CRM. No se crea ningún cliente a partir de ellas."
              />
              {preview.foldersWithoutClient.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Todas las carpetas corresponden a un cliente.
                </p>
              ) : (
                <ul className="space-y-2">
                  {preview.foldersWithoutClient.map((folder) => (
                    <RowCard key={folder.id}>
                      <span className="min-w-0 truncate font-medium" title={folder.name}>
                        {folder.name}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        Sin cliente en el CRM
                      </span>
                    </RowCard>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}

        {result && (
          <p
            role="status"
            className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            {result}
          </p>
        )}
        {error && preview && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cerrar
          </Button>
          <Button
            type="button"
            onClick={handleApply}
            loading={applying}
            disabled={applying || loading || mappings.length === 0}
          >
            Guardar {mappings.length} vinculación(es)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
