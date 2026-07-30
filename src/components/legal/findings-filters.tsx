import { Filter } from "lucide-react";
import type { FindingFilterOptions, VerificationStatus } from "@/lib/ai-review/findings-service";
import { NativeSelect } from "@/components/ui/native-select";

interface FindingsFiltersProps {
  filters: FindingFilterOptions;
  onChange: (filters: FindingFilterOptions) => void;
  importJobs?: Array<{ id: string; name: string }>;
  isDemoMode: boolean;
  onToggleDemoMode: (demo: boolean) => void;
}

export function FindingsFilters({
  filters,
  onChange,
  importJobs = [],
  isDemoMode,
  onToggleDemoMode,
}: FindingsFiltersProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 font-semibold text-foreground">
          <Filter className="h-4 w-4 text-primary" /> Filtros:
        </div>

        {/* Estado */}
        <NativeSelect
          value={filters.status ?? "all"}
          onChange={(e) =>
            onChange({
              ...filters,
              status: e.target.value as VerificationStatus | "all",
              page: 1,
            })
          }
          aria-label="Filtrar hallazgos por estado"
          className="h-9 text-xs"
        >
          <option value="all">Todos los estados</option>
          <option value="pending">Pendientes</option>
          <option value="approved">Aprobados</option>
          <option value="edited">Editados</option>
          <option value="rejected">Rechazados</option>
          <option value="conflict">Conflicto</option>
        </NativeSelect>

        {/* Importación */}
        {!isDemoMode && importJobs.length > 0 && (
          <NativeSelect
            value={filters.importJobId ?? "all"}
            onChange={(e) =>
              onChange({
                ...filters,
                importJobId: e.target.value,
                page: 1,
              })
            }
            aria-label="Filtrar por importación"
            className="h-9 text-xs"
          >
            <option value="all">Todas las importaciones</option>
            {importJobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.name}
              </option>
            ))}
          </NativeSelect>
        )}

        {/* Nivel de confianza */}
        <NativeSelect
          value={filters.minConfidence ?? 0}
          onChange={(e) =>
            onChange({
              ...filters,
              minConfidence: Number(e.target.value),
              page: 1,
            })
          }
          aria-label="Filtrar por nivel de confianza"
          className="h-9 text-xs"
        >
          <option value={0}>Cualquier confianza</option>
          <option value={0.7}>Confianza ≥ 70%</option>
          <option value={0.85}>Confianza ≥ 85%</option>
          <option value={0.95}>Confianza ≥ 95%</option>
        </NativeSelect>
      </div>

      {/* Selector Modo Real vs Demo */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Fuente de datos:</span>
        <button
          type="button"
          onClick={() => onToggleDemoMode(!isDemoMode)}
          className={`h-8 rounded-full px-3 text-xs font-semibold transition ${
            isDemoMode
              ? "bg-amber-100 text-amber-900 border border-amber-300"
              : "bg-primary text-primary-foreground"
          }`}
        >
          {isDemoMode ? "Modo demostración" : "Supabase (Real)"}
        </button>
      </div>
    </div>
  );
}
