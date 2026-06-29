import { createFileRoute } from "@tanstack/react-router";
import { AppLayout, Card } from "@/components/app-layout";
import { agendaEvents } from "@/lib/mock-data";
import { Plus, ChevronLeft, ChevronRight, CalendarDays, Clock, MapPin } from "lucide-react";

export const Route = createFileRoute("/_app/agenda/")({
  head: () => ({ meta: [{ title: "Agenda — CRM Jurídico" }] }),
  component: AgendaPage,
});

const typeColor: Record<string, { bg: string; dot: string; text: string }> = {
  "Audiencia": { bg: "bg-primary/10 border-primary/30", dot: "bg-primary", text: "text-primary" },
  "Cita": { bg: "bg-sky-50 border-sky-200", dot: "bg-sky-500", text: "text-sky-700" },
  "Recordatorio": { bg: "bg-emerald-50 border-emerald-200", dot: "bg-emerald-500", text: "text-emerald-700" },
  "Vencimiento": { bg: "bg-amber-50 border-amber-200", dot: "bg-amber-500", text: "text-amber-700" },
  "Plazo legal": { bg: "bg-red-50 border-red-200", dot: "bg-red-500", text: "text-red-700" },
};

// Build a 6-week grid for July 2026
function buildMonth(year: number, month: number) {
  const first = new Date(year, month, 1);
  const startDay = (first.getDay() + 6) % 7; // start Monday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: { date: Date; inMonth: boolean }[] = [];
  for (let i = 0; i < startDay; i++) {
    const d = new Date(year, month, 1 - (startDay - i));
    cells.push({ date: d, inMonth: false });
  }
  for (let i = 1; i <= daysInMonth; i++) cells.push({ date: new Date(year, month, i), inMonth: true });
  while (cells.length % 7 !== 0 || cells.length < 42) cells.push({ date: new Date(year, month, daysInMonth + (cells.length - daysInMonth - startDay) + 1), inMonth: false });
  return cells.slice(0, 42);
}

function AgendaPage() {
  const cells = buildMonth(2026, 6); // July (0-indexed)
  const eventsByDay = new Map<string, typeof agendaEvents>();
  agendaEvents.forEach(e => {
    const k = e.date;
    if (!eventsByDay.has(k)) eventsByDay.set(k, []);
    eventsByDay.get(k)!.push(e);
  });

  return (
    <AppLayout
      title="Agenda Jurídica"
      subtitle="Audiencias, citas, recordatorios y plazos legales"
      actions={
        <button className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 shadow-soft">
          <Plus className="h-4 w-4" /> Nuevo evento
        </button>
      }
    >
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <button className="h-9 w-9 grid place-items-center rounded-lg border border-border hover:bg-muted/60"><ChevronLeft className="h-4 w-4" /></button>
              <h3 className="text-lg font-bold">Julio 2026</h3>
              <button className="h-9 w-9 grid place-items-center rounded-lg border border-border hover:bg-muted/60"><ChevronRight className="h-4 w-4" /></button>
              <button className="ml-2 h-9 px-3 rounded-lg border border-border text-xs font-semibold hover:bg-muted/60">Hoy</button>
            </div>
            <div className="flex bg-muted/50 rounded-lg p-1 text-xs font-semibold">
              {["Mes", "Semana", "Día"].map((v, i) => (
                <button key={v} className={`px-3 py-1.5 rounded-md ${i === 0 ? "bg-card shadow-soft text-primary" : "text-muted-foreground"}`}>{v}</button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-7 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30">
            {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map(d => (
              <div key={d} className="px-3 py-2 text-center">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((c, i) => {
              const iso = c.date.toISOString().slice(0, 10);
              const evts = eventsByDay.get(iso) || [];
              const isToday = iso === "2026-06-29";
              return (
                <div key={i} className={`min-h-[110px] border-t border-r border-border last:border-r-0 p-2 ${!c.inMonth ? "bg-muted/20" : "bg-card"} ${(i + 1) % 7 === 0 ? "border-r-0" : ""}`}>
                  <div className={`text-xs font-semibold mb-1 flex items-center justify-center h-6 w-6 rounded-full ${isToday ? "bg-gold text-gold-foreground" : c.inMonth ? "text-foreground" : "text-muted-foreground/50"}`}>
                    {c.date.getDate()}
                  </div>
                  <div className="space-y-1">
                    {evts.slice(0, 3).map(e => {
                      const tc = typeColor[e.type];
                      return (
                        <div key={e.id} className={`text-[10px] px-1.5 py-1 rounded border ${tc.bg} ${tc.text} truncate font-semibold flex items-center gap-1`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${tc.dot} shrink-0`} />
                          <span className="truncate">{e.time} {e.title}</span>
                        </div>
                      );
                    })}
                    {evts.length > 3 && <div className="text-[10px] text-muted-foreground">+{evts.length - 3} más</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="text-sm font-semibold mb-3">Leyenda</h3>
            <div className="space-y-2">
              {Object.entries(typeColor).map(([k, v]) => (
                <div key={k} className="flex items-center gap-2 text-xs">
                  <span className={`h-2.5 w-2.5 rounded-full ${v.dot}`} />
                  <span className="text-foreground/80">{k}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary" /> Próximos eventos</h3>
            <div className="space-y-3">
              {agendaEvents.slice(0, 5).map(e => {
                const tc = typeColor[e.type];
                return (
                  <div key={e.id} className="flex gap-3">
                    <div className={`w-1 rounded-full ${tc.dot} shrink-0`} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold truncate">{e.title}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{e.client}</div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-1">
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {e.date.slice(5)} · {e.time}</span>
                        {e.location !== "—" && <span className="flex items-center gap-1 truncate"><MapPin className="h-3 w-3" /> {e.location}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
