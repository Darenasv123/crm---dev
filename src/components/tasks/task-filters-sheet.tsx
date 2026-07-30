import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { TaskAdvancedFilters } from "@/components/tasks/task-filter-utils";
import { TASK_PRIORITIES, TASK_STATUSES, TASK_STATUS_LABELS } from "@/lib/tasks";

type ClientOption = { id: string; name: string };
type CaseOption = {
  id: string;
  client_id: string;
  expediente: string;
  case_number: string | null;
  process_type: string;
};
type ProfileOption = {
  id: string;
  full_name: string;
  status: string;
};

export function TaskFiltersSheet({
  open,
  filters,
  clients,
  cases,
  profiles,
  hasActiveFilters,
  onOpenChange,
  onChange,
  onClear,
}: {
  open: boolean;
  filters: TaskAdvancedFilters;
  clients: ClientOption[];
  cases: CaseOption[];
  profiles: ProfileOption[];
  hasActiveFilters: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (updates: Partial<TaskAdvancedFilters>) => void;
  onClear: () => void;
}) {
  const visibleCases = filters.clientId
    ? cases.filter((item) => item.client_id === filters.clientId)
    : cases;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[88vh] overflow-y-auto rounded-t-2xl sm:inset-x-auto sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:max-h-none sm:w-[420px] sm:rounded-none sm:border-l sm:border-t-0"
      >
        <SheetHeader>
          <SheetTitle>Filtros de tareas</SheetTitle>
          <SheetDescription>
            Combina criterios y ciérralos con Escape cuando termines.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 grid gap-4">
          <FilterSelect
            label="Responsable"
            value={filters.assignee}
            onChange={(assignee) => onChange({ assignee })}
          >
            <option value="">Todos los responsables</option>
            {profiles
              .filter((item) => item.status === "Activo")
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.full_name}
                </option>
              ))}
          </FilterSelect>

          <FilterSelect
            label="Estado"
            value={filters.status}
            onChange={(status) => onChange({ status })}
          >
            <option value="">Todos los estados</option>
            {TASK_STATUSES.map((item) => (
              <option key={item} value={item}>
                {TASK_STATUS_LABELS[item]}
              </option>
            ))}
          </FilterSelect>

          <FilterSelect
            label="Prioridad"
            value={filters.priority}
            onChange={(priority) => onChange({ priority })}
          >
            <option value="">Todas las prioridades</option>
            {TASK_PRIORITIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </FilterSelect>

          <FilterSelect
            label="Cliente"
            value={filters.clientId}
            onChange={(clientId) => {
              const selectedCase = cases.find((item) => item.id === filters.caseId);
              onChange({
                clientId,
                caseId: selectedCase && selectedCase.client_id !== clientId ? "" : filters.caseId,
              });
            }}
          >
            <option value="">Todos los clientes</option>
            {clients.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </FilterSelect>

          <FilterSelect
            label="Expediente"
            value={filters.caseId}
            onChange={(caseId) => onChange({ caseId })}
          >
            <option value="">Todos los expedientes</option>
            {visibleCases.map((item) => (
              <option key={item.id} value={item.id}>
                {item.case_number || item.expediente || item.process_type}
              </option>
            ))}
          </FilterSelect>

          <fieldset className="grid gap-2 rounded-xl border border-border p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Condiciones
            </legend>
            <FilterCheckbox
              label="Solo vencidas"
              checked={filters.overdueOnly}
              onChange={(overdueOnly) => onChange({ overdueOnly })}
            />
            <FilterCheckbox
              label="Mostrar terminadas"
              checked={filters.showCompleted}
              onChange={(showCompleted) => onChange({ showCompleted })}
            />
            <FilterCheckbox
              label="Sin cliente"
              checked={filters.withoutClient}
              onChange={(withoutClient) => onChange({ withoutClient })}
            />
            <FilterCheckbox
              label="Sin expediente"
              checked={filters.withoutCase}
              onChange={(withoutCase) => onChange({ withoutCase })}
            />
          </fieldset>
        </div>

        <SheetFooter className="sticky bottom-0 -mx-6 mt-6 gap-2 border-t border-border bg-background px-6 pb-1 pt-4">
          {hasActiveFilters && (
            <button
              type="button"
              onClick={onClear}
              className="h-11 rounded-lg border border-border px-4 text-sm font-semibold"
            >
              Limpiar todo
            </button>
          )}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-11 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground"
          >
            Ver resultados
          </button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
      >
        {children}
      </select>
    </label>
  );
}

function FilterCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm hover:bg-muted/50">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}
