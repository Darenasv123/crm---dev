import { createFileRoute, Link } from "@tanstack/react-router";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { CASE_STATUSES, cases } from "@/lib/mock-data";
import { Plus, Filter, CalendarClock, MoreHorizontal, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/_app/casos/")({
  head: () => ({ meta: [{ title: "Casos — CRM Jurídico" }] }),
  component: CasesKanban,
});

const columnColor: Record<string, string> = {
  "Consulta": "oklch(0.55 0.02 255)",
  "Documentación": "oklch(0.55 0.13 235)",
  "Demanda presentada": "oklch(0.74 0.12 80)",
  "En proceso": "oklch(0.34 0.09 255)",
  "Audiencia": "oklch(0.62 0.18 25)",
  "Sentencia": "oklch(0.62 0.14 155)",
  "Archivado": "oklch(0.65 0.02 250)",
};

function CasesKanban() {
  return (
    <AppLayout
      title="Gestión de Casos"
      subtitle={`${cases.length} expedientes activos · Vista Kanban`}
      actions={
        <>
          <button className="inline-flex items-center gap-2 h-10 px-3 rounded-lg bg-card border border-border text-sm font-medium hover:bg-muted/60">
            <Filter className="h-4 w-4" /> Filtros
          </button>
          <button className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 shadow-soft">
            <Plus className="h-4 w-4" /> Nuevo Caso
          </button>
        </>
      }
    >
      <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 lg:-mx-8 lg:px-8">
        {CASE_STATUSES.map((status) => {
          const items = cases.filter(c => c.status === status);
          const color = columnColor[status];
          return (
            <div key={status} className="w-[300px] shrink-0">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                  <h3 className="text-sm font-semibold">{status}</h3>
                  <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{items.length}</span>
                </div>
                <button className="h-7 w-7 grid place-items-center rounded-md hover:bg-muted/60"><Plus className="h-4 w-4 text-muted-foreground" /></button>
              </div>
              <div className="space-y-3">
                {items.map(c => (
                  <Link key={c.id} to={"/casos/$id" as never} params={{ id: c.id } as never}>
                    <Card className="p-4 hover:shadow-card hover:border-primary/30 transition-all cursor-pointer group">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-[10px] font-mono text-muted-foreground truncate">{c.expediente}</div>
                        <button className="opacity-0 group-hover:opacity-100 transition"><MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" /></button>
                      </div>
                      <div className="mt-2 text-sm font-semibold leading-snug">{c.client}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{c.processType}</div>

                      <div className="mt-3 flex items-center justify-between">
                        <StatusBadge tone={c.priority === "Alta" ? "danger" : c.priority === "Media" ? "warning" : "info"}>
                          {c.priority === "Alta" && <AlertTriangle className="h-2.5 w-2.5" />} {c.priority}
                        </StatusBadge>
                        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <CalendarClock className="h-3 w-3" />
                          <span>{c.nextHearing === "—" ? "Sin audiencia" : c.nextHearing.split(" ")[0].slice(5)}</span>
                        </div>
                      </div>
                      <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
                        <div className="flex -space-x-1.5">
                          <div className="h-6 w-6 rounded-full bg-primary text-white text-[10px] grid place-items-center font-bold border-2 border-card">{c.initials}</div>
                          <div className="h-6 w-6 rounded-full bg-gold text-gold-foreground text-[10px] grid place-items-center font-bold border-2 border-card">CR</div>
                        </div>
                        <span className="text-[10px] text-muted-foreground">3 actuaciones</span>
                      </div>
                    </Card>
                  </Link>
                ))}
                {items.length === 0 && (
                  <div className="rounded-xl border-2 border-dashed border-border text-center text-xs text-muted-foreground py-6">Sin casos</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </AppLayout>
  );
}
