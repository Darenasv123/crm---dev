import { useState } from "react";
import { AlertCircle, FileSearch, Loader2 } from "lucide-react";
import { Card } from "@/components/app-layout";
import { getAuthClient } from "@/lib/supabase";
import {
  buildMassImportDryRunPlan,
  type MassImportDryRunPlan,
} from "@/lib/imports/mass-import-dry-run";

export function MassImportDryRun() {
  const [plan, setPlan] = useState<MassImportDryRunPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadPlan() {
    setLoading(true);
    setError(null);
    try {
      const db = await getAuthClient();
      const { data: clientsRaw, error: clientsError } = await db
        .from("clients")
        .select("id, name, created_at, notes, process_type")
        .ilike("notes", "Importado desde Google Drive ZIP:%")
        .order("created_at", { ascending: false });
      if (clientsError) throw clientsError;

      const clientIds = (clientsRaw ?? []).map((client) => client.id);
      let casesRaw: unknown[] = [];
      let documentsRaw: unknown[] = [];

      if (clientIds.length > 0) {
        const { data: caseData, error: casesError } = await db
          .from("cases")
          .select("id, client_id, expediente, case_number, case_name")
          .in("client_id", clientIds);
        if (casesError) throw casesError;
        casesRaw = caseData ?? [];

        const { data: documentData, error: documentsError } = await db
          .from("documents")
          .select(
            "id, client_id, case_id, name, storage_path, checksum, source_provider, source_type, external_file_id, external_folder_id, external_url, created_at",
          )
          .in("client_id", clientIds);
        if (documentsError) throw documentsError;
        documentsRaw = documentData ?? [];
      }

      setPlan(
        buildMassImportDryRunPlan({
          clients: clientsRaw ?? [],
          cases: casesRaw as never,
          documents: documentsRaw as never,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo generar el diagnostico.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="mt-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">Diagnostico de importacion masiva anterior</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Vista dry-run: identifica registros creados por el importador ZIP masivo anterior y los
            objetos de Storage asociados. No elimina registros.
          </p>
        </div>
        <button
          type="button"
          onClick={loadPlan}
          disabled={loading}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold hover:bg-muted/60 disabled:opacity-60"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FileSearch className="h-4 w-4" />
          )}
          Generar dry-run
        </button>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {plan && (
        <div className="mt-4 space-y-3">
          <div className="grid gap-2 text-xs sm:grid-cols-4">
            <Metric label="Clientes" value={plan.totals.clients} />
            <Metric label="Expedientes" value={plan.totals.cases} />
            <Metric label="Documentos" value={plan.totals.documents} />
            <Metric label="Storage" value={plan.totals.storageObjects} />
          </div>
          {plan.items.length === 0 ? (
            <p className="rounded-lg bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              No se encontraron clientes con origen de importacion ZIP masiva anterior.
            </p>
          ) : (
            <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
              {plan.items.map((item) => (
                <details
                  key={item.client.id}
                  className="rounded-lg border border-border bg-background p-3"
                >
                  <summary className="cursor-pointer text-sm font-semibold">
                    {item.client.name} · {item.documents.length} docs · {item.cases.length}{" "}
                    expedientes
                  </summary>
                  <div className="mt-3 grid gap-3 text-xs text-muted-foreground lg:grid-cols-2">
                    <InfoBlock
                      title="Cliente"
                      values={[item.client.id, item.client.created_at ?? "Sin fecha", item.origin]}
                    />
                    <InfoBlock title="Rutas ZIP" values={item.zipPaths} />
                    <InfoBlock title="Hashes" values={item.hashes.slice(0, 20)} />
                    <InfoBlock
                      title="Storage que se incluiria en limpieza"
                      values={item.storagePaths}
                    />
                    <InfoBlock
                      title="Expedientes que se incluirian"
                      values={item.cases.map(
                        (caseRow) =>
                          `${caseRow.id} · ${caseRow.case_number ?? caseRow.expediente ?? caseRow.case_name ?? "Sin numero"}`,
                      )}
                    />
                    <InfoBlock
                      title="Documentos que se incluirian"
                      values={item.documents.map((doc) => `${doc.id} · ${doc.name}`)}
                    />
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</p>
      <p className="text-lg font-bold text-foreground">{value}</p>
    </div>
  );
}

function InfoBlock({ title, values }: { title: string; values: string[] }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase text-foreground">{title}</p>
      {values.length === 0 ? (
        <p>Sin datos</p>
      ) : (
        <ul className="space-y-1">
          {values.map((value) => (
            <li key={value} className="break-all rounded bg-muted/30 px-2 py-1">
              {value}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
