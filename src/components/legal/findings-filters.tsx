import { Filter, Search } from "lucide-react";
import type { FindingFilterOptions, VerificationStatus } from "@/lib/ai-review/findings-service";

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
        <select
          value={filters.status ?? "all"}
          onChange={(e) =>
            onChange({
              ...filters,
              status: e.target.value as VerificationStatus | "all",
              page: 1,
            })
          }
          className="h-9 rounded-md border border-border bg-background px-3 text-xs outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="all">Todos los estados</option>
          <option value="pending">Pendientes</option>
          <option value="approved">Aprobados</option>
          <option value="edited">Editados</option>
          <option value="rejected">Rechazados</option>
          <option value="conflict">Conflicto</option>
        </select>

        {/* Importación */}
        {!isDemoMode && importJobs.length > 0 && (
          <select
            value={filters.importJobId ?? "all"}
            onChange={(e) =>
              onChange({
                ...filters,
                importJobId: e.target.value,
                page: 1,
              })
            }
            className="h-9 rounded-md border border-border bg-background px-3 text-xs outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">Todas las importaciones</option>
            {importJobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.name}
              </option>
            ))}
          </select>
        )}

        {/* Nivel de confianza */}
        <select
          value={filters.minConfidence ?? 0}
          onChange={(e) =>
            onChange({
              ...filters,
              minConfidence: Number(e.target.value),
              page: 1,
            })
          }
          className="h-9 rounded-md border border-border bg-background px-3 text-xs outline-none focus:ring-1 focus:ring-primary"
        >
          <option value={0}>Cualquier confianza</option>
          <option value={0.7}>Confianza ≥ 70%</option>
          <option value={0.85}>Confianza ≥ 85%</option>
          <option value={0.95}>Confianza ≥ 95%</option>
        </select>
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
