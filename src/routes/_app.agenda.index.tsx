import { createFileRoute } from "@tanstack/react-router";
import { AppLayout, Card } from "@/components/app-layout";
import {
  useAgendaEvents,
  useCreateAgendaEvent,
  useDeleteAgendaEvent,
  useImportFromGoogleCalendar,
} from "@/hooks/use-agenda";
import { useClients } from "@/hooks/use-clients";
import { exportAgendaICS, openEventInGoogleCalendar } from "@/lib/export-ics";
import { isGoogleCalendarConnected, syncAllEventsToGoogle } from "@/lib/google-calendar";
import {
  Plus, ChevronLeft, ChevronRight, CalendarDays, Clock, MapPin,
  X, Loader2, Trash2, Download, ExternalLink,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";

export const Route = createFileRoute("/_app/agenda/")({
  head: () => ({ meta: [{ title: "Agenda — CRM Jurídico" }] }),
  component: AgendaPage,
});

type EventType = "Audiencia" | "Cita" | "Recordatorio";

const typeColor: Record<EventType, { bg: string; dot: string; text: string }> = {
  Audiencia:    { bg: "bg-primary/10 border-primary/30",   dot: "bg-primary",     text: "text-primary"     },
  Cita:         { bg: "bg-sky-50 border-sky-200",           dot: "bg-sky-500",     text: "text-sky-700"     },
  Recordatorio: { bg: "bg-emerald-50 border-emerald-200",   dot: "bg-emerald-500", text: "text-emerald-700" },
};

function buildMonth(year: number, month: number) {
  const first    = new Date(year, month, 1);
  const startDay = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: { date: Date; inMonth: boolean }[] = [];
  for (let i = 0; i < startDay; i++)
    cells.push({ date: new Date(year, month, 1 - (startDay - i)), inMonth: false });
  for (let i = 1; i <= daysInMonth; i++)
    cells.push({ date: new Date(year, month, i), inMonth: true });
  while (cells.length % 7 !== 0 || cells.length < 42)
    cells.push({ date: new Date(year, month, daysInMonth + (cells.length - daysInMonth - startDay) + 1), inMonth: false });
  return cells.slice(0, 42);
}

function AgendaPage() {
  const today = new Date();
  const [viewYear,  setViewYear]  = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const { data: events = [], isLoading } = useAgendaEvents();
  const { data: clients = [] } = useClients();
  const createEvent = useCreateAgendaEvent();
  const deleteEvent = useDeleteAgendaEvent();
  const importGCal  = useImportFromGoogleCalendar();

  const [showModal, setShowModal] = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "", type: "Audiencia" as EventType,
    event_date: "", event_time: "", location: "", client_id: "",
  });
  // Día seleccionado para ver sus eventos
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // ── Auto-sync al abrir la agenda ──────────────────────────────────────────
  const syncedRef  = useRef(false);
  const pushDoneRef = useRef(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  useEffect(() => {
    if (syncedRef.current) return;
    if (!isGoogleCalendarConnected()) {
      setSyncStatus(null);
      return;
    }
    syncedRef.current = true;
    setSyncStatus("Sincronizando con Google Calendar...");

    importGCal.mutateAsync()
      .then(r => {
        const msg = r.imported > 0
          ? `✓ ${r.imported} evento${r.imported !== 1 ? "s" : ""} importado${r.imported !== 1 ? "s" : ""} de Google Calendar`
          : null;
        setSyncStatus(msg);
        if (msg) setTimeout(() => setSyncStatus(null), 4000);
      })
      .catch(err => {
        setSyncStatus(`⚠ ${err instanceof Error ? err.message : "Error al sincronizar"}`);
        setTimeout(() => setSyncStatus(null), 6000);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (pushDoneRef.current) return;
    if (!isGoogleCalendarConnected()) return;
    if (isLoading || events.length === 0) return;
    pushDoneRef.current = true;

    const unsynced = events
      .filter(e => !e.gcal_event_id)
      .map(e => ({
        id:         e.id,
        gcalId:     e.gcal_event_id,
        title:      e.title,
        type:       e.type,
        event_date: e.event_date,
        event_time: String(e.event_time),
        location:   e.location,
        client:     (e as { clients?: { name: string } | null }).clients?.name ?? null,
      }));

    if (unsynced.length > 0) {
      syncAllEventsToGoogle(unsynced).catch(() => {/* silencioso */});
    }
  }, [isLoading, events]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Helpers ───────────────────────────────────────────────────────────────
  const cells    = buildMonth(viewYear, viewMonth);
  const todayISO = today.toISOString().slice(0, 10);

  const eventsByDay = new Map<string, typeof events>();
  events.forEach(e => {
    if (!eventsByDay.has(e.event_date)) eventsByDay.set(e.event_date, []);
    eventsByDay.get(e.event_date)!.push(e);
  });

  const monthNames = [
    "Enero","Febrero","Marzo","Abril","Mayo","Junio",
    "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
  ];

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      await createEvent.mutateAsync({
        title:      form.title,
        type:       form.type,
        event_date: form.event_date,
        event_time: form.event_time,
        location:   form.location || null,
        client_id:  form.client_id || null,
      });
      setShowModal(false);
      setForm({ title: "", type: "Audiencia", event_date: "", event_time: "", location: "", client_id: "" });
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Error al guardar.");
    } finally {
      setSaving(false);
    }
  }

  const upcomingEvents = events
    .filter(e => e.event_date >= todayISO)
    .slice(0, 6);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <AppLayout
      title="Agenda Jurídica"
      subtitle="Audiencias, citas y recordatorios"
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportAgendaICS(events.map(e => ({
              id:         e.id,
              title:      e.title,
              type:       e.type,
              event_date: e.event_date,
              event_time: e.event_time,
              location:   e.location,
              client:     (e as { clients?: { name: string } | null }).clients?.name,
            })))}
            title="Exportar todos los eventos al calendario"
            className="inline-flex items-center gap-2 h-10 px-3 rounded-lg border border-border text-sm font-medium hover:bg-muted/60 transition"
          >
            <Download className="h-4 w-4" /> Exportar .ics
          </button>
          <button
            onClick={() => { setShowModal(true); setFormError(null); }}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 shadow-soft"
          >
            <Plus className="h-4 w-4" /> Nuevo evento
          </button>        </div>
      }
    >
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">
        {/* Sync status banner */}
        {syncStatus && (
          <div className="xl:col-span-2 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-sky-50 border border-sky-200 text-sm text-sky-800">
            {syncStatus.startsWith("Sincronizando") && <Loader2 className="h-4 w-4 animate-spin shrink-0" />}
            <span>{syncStatus}</span>
          </div>
        )}

        {/* ── Calendario ── */}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <button onClick={prevMonth} className="h-9 w-9 grid place-items-center rounded-lg border border-border hover:bg-muted/60">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <h3 className="text-lg font-bold">{monthNames[viewMonth]} {viewYear}</h3>
              <button onClick={nextMonth} className="h-9 w-9 grid place-items-center rounded-lg border border-border hover:bg-muted/60">
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                onClick={() => { setViewYear(today.getFullYear()); setViewMonth(today.getMonth()); }}
                className="ml-2 h-9 px-3 rounded-lg border border-border text-xs font-semibold hover:bg-muted/60"
              >
                Hoy
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30">
            {["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"].map(d => (
              <div key={d} className="px-3 py-2 text-center">{d}</div>
            ))}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="grid grid-cols-7">
              {cells.map((c, i) => {
                const iso  = c.date.toISOString().slice(0, 10);
                const evts = eventsByDay.get(iso) || [];
                const isToday   = iso === todayISO;
                const isSelected = iso === selectedDay;
                return (
                  <div
                    key={i}
                    onClick={() => c.inMonth && setSelectedDay(iso === selectedDay ? null : iso)}
                    className={`min-h-[100px] border-t border-r border-border p-1.5 transition-colors
                      ${!c.inMonth ? "bg-muted/20" : isSelected ? "bg-primary/5 ring-1 ring-inset ring-primary/30" : "bg-card hover:bg-muted/20 cursor-pointer"}
                      ${(i + 1) % 7 === 0 ? "border-r-0" : ""}`}
                  >
                    <div className={`text-xs font-semibold mb-1 flex items-center justify-center h-6 w-6 rounded-full mx-auto
                      ${isToday ? "bg-gold text-gold-foreground" : isSelected ? "bg-primary text-primary-foreground" : c.inMonth ? "text-foreground" : "text-muted-foreground/40"}`}>
                      {c.date.getDate()}
                    </div>
                    <div className="space-y-0.5">
                      {evts.slice(0, 3).map(e => {
                        // Eventos importados de Google (gcal_event_id pero sin tipo manual) usan color neutro
                        const fromGoogle = !!e.gcal_event_id;
                        const tc = fromGoogle
                          ? { bg: "bg-muted/60 border-border", dot: "bg-muted-foreground/60", text: "text-foreground/70" }
                          : typeColor[e.type as EventType] ?? typeColor["Cita"];
                        return (
                          <div key={e.id} className={`text-[9px] px-1 py-0.5 rounded border ${tc.bg} ${tc.text} truncate font-medium flex items-center gap-0.5`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${tc.dot} shrink-0`} />
                            <span className="truncate">{String(e.event_time).slice(0,5)} {e.title}</span>
                          </div>
                        );
                      })}
                      {evts.length > 3 && (
                        <div className="text-[9px] text-primary font-semibold pl-1">+{evts.length - 3} más</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* ── Sidebar ── */}
        <div className="space-y-4">
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3">Leyenda</h3>
            <div className="space-y-2">
              {Object.entries(typeColor).map(([k, v]) => (
                <div key={k} className="flex items-center gap-2 text-xs">
                  <span className={`h-2.5 w-2.5 rounded-full ${v.dot}`} />
                  <span className="text-foreground/80">{k}</span>
                </div>
              ))}
              <div className="flex items-center gap-2 text-xs">
                <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/60" />
                <span className="text-foreground/80">Importado de Google</span>
              </div>
            </div>
          </Card>

          {/* Panel día seleccionado */}
          {selectedDay ? (
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-primary" />
                  {new Date(selectedDay + "T00:00:00").toLocaleDateString("es-PE", {
                    weekday: "long", day: "numeric", month: "long",
                  })}
                </h3>
                <button
                  onClick={() => setSelectedDay(null)}
                  className="h-6 w-6 grid place-items-center rounded hover:bg-muted/60 text-muted-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {(eventsByDay.get(selectedDay) ?? []).length === 0 ? (
                <div className="py-4 text-center">
                  <p className="text-xs text-muted-foreground mb-3">Sin eventos este día.</p>
                  <button
                    onClick={() => {
                      setForm(f => ({ ...f, event_date: selectedDay }));
                      setShowModal(true);
                      setFormError(null);
                    }}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20"
                  >
                    <Plus className="h-3.5 w-3.5" /> Agregar evento
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {(eventsByDay.get(selectedDay) ?? [])
                    .sort((a, b) => String(a.event_time).localeCompare(String(b.event_time)))
                    .map(e => {
                      const fromGoogle = !!e.gcal_event_id;
                      const tc = fromGoogle
                        ? { dot: "bg-muted-foreground/60" }
                        : typeColor[e.type as EventType] ?? typeColor["Cita"];
                      return (
                        <div key={e.id} className="p-3 rounded-lg border border-border bg-muted/20 group">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`h-2 w-2 rounded-full shrink-0 mt-0.5 ${tc.dot}`} />
                              <span className="text-sm font-semibold leading-tight">{e.title}</span>
                            </div>
                            <div className="flex gap-0.5 shrink-0">
                              <button
                                onClick={() => openEventInGoogleCalendar({
                                  id: e.id, title: e.title, type: e.type,
                                  event_date: e.event_date, event_time: e.event_time,
                                  location: e.location,
                                  client: (e as { clients?: { name: string } | null }).clients?.name,
                                })}
                                className="h-6 w-6 grid place-items-center rounded text-muted-foreground hover:text-sky-600 hover:bg-sky-50"
                                title="Ver en Google Calendar"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => {
                                  if (window.confirm(`¿Eliminar "${e.title}"?`)) {
                                    deleteEvent.mutate({ id: e.id, gcalId: e.gcal_event_id });
                                  }
                                }}
                                className="h-6 w-6 grid place-items-center rounded text-muted-foreground hover:text-red-600 hover:bg-red-50"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                          <div className="ml-4 mt-1.5 space-y-0.5">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3 shrink-0" />
                              <span>{String(e.event_time).slice(0,5)}</span>
                              {!fromGoogle && (
                                <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-muted text-muted-foreground">
                                  {e.type}
                                </span>
                              )}
                            </div>
                            {e.clients && (
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <span className="h-3 w-3 shrink-0">👤</span>
                                <span>{e.clients.name}</span>
                              </div>
                            )}
                            {e.location && (
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <MapPin className="h-3 w-3 shrink-0" />
                                <span className="break-words">{e.location}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  <button
                    onClick={() => {
                      setForm(f => ({ ...f, event_date: selectedDay }));
                      setShowModal(true);
                      setFormError(null);
                    }}
                    className="w-full h-8 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition flex items-center justify-center gap-1.5"
                  >
                    <Plus className="h-3.5 w-3.5" /> Agregar evento este día
                  </button>
                </div>
              )}
            </Card>
          ) : (
            <Card className="p-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-primary" /> Próximos eventos
              </h3>
              {isLoading ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
              ) : upcomingEvents.length === 0 ? (
                <p className="text-xs text-muted-foreground">No hay eventos próximos.</p>
              ) : (
                <div className="space-y-2">
                  {upcomingEvents.map(e => {
                    const fromGoogle = !!e.gcal_event_id;
                    const tc = fromGoogle
                      ? { dot: "bg-muted-foreground/60" }
                      : typeColor[e.type as EventType] ?? typeColor["Cita"];
                    return (
                      <div key={e.id} className="flex gap-2 p-2 rounded-lg border border-border hover:bg-muted/30 transition group">
                        <div className={`w-1 rounded-full ${tc.dot} shrink-0`} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold truncate">{e.title}</div>
                          {e.clients && (
                            <div className="text-[11px] text-muted-foreground truncate">{e.clients.name}</div>
                          )}
                          <div className="flex flex-wrap items-center gap-x-2 text-[10px] text-muted-foreground mt-0.5">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" /> {e.event_date.slice(5)} · {String(e.event_time).slice(0,5)}
                            </span>
                            {e.location && (
                              <span className="flex items-center gap-1 truncate">
                                <MapPin className="h-3 w-3" /> {e.location}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition shrink-0">
                          <button
                            onClick={() => openEventInGoogleCalendar({
                              id: e.id, title: e.title, type: e.type,
                              event_date: e.event_date, event_time: e.event_time,
                              location: e.location,
                              client: (e as { clients?: { name: string } | null }).clients?.name,
                            })}
                            title="Ver en Google Calendar"
                            className="h-6 w-6 grid place-items-center rounded text-muted-foreground hover:text-sky-600 hover:bg-sky-50 transition"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              if (window.confirm(`¿Eliminar el evento "${e.title}"?`)) {
                                deleteEvent.mutate({ id: e.id, gcalId: e.gcal_event_id });
                              }
                            }}
                            className="h-6 w-6 grid place-items-center rounded text-muted-foreground hover:text-red-600 hover:bg-red-50 transition"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>

      {/* ── Modal nuevo evento ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md p-6 shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold">Nuevo evento</h3>
              <button onClick={() => setShowModal(false)} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-muted/60">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <AF label="Título *" value={form.title} onChange={v => setForm(f => ({ ...f, title: v }))} required />
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tipo</label>
                <select
                  value={form.type}
                  onChange={e => setForm(f => ({ ...f, type: e.target.value as EventType }))}
                  className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none text-sm"
                >
                  <option>Audiencia</option>
                  <option>Cita</option>
                  <option>Recordatorio</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <AF label="Fecha *"  value={form.event_date} onChange={v => setForm(f => ({ ...f, event_date: v }))} type="date" required />
                <AF label="Hora *"   value={form.event_time} onChange={v => setForm(f => ({ ...f, event_time: v }))} type="time" required />
              </div>
              <AF label="Lugar" value={form.location} onChange={v => setForm(f => ({ ...f, location: v }))} />
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Cliente (opcional)</label>
                <select
                  value={form.client_id}
                  onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}
                  className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none text-sm"
                >
                  <option value="">Sin cliente</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              {formError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</p>
              )}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 h-10 rounded-lg border border-border text-sm font-medium hover:bg-muted/60">
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {saving ? "Guardando..." : "Guardar evento"}
                </button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </AppLayout>
  );
}

function AF({ label, value, onChange, required, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; required?: boolean; type?: string;
}) {
  return (
    <div>
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
        className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-sm"
      />
    </div>
  );
}
