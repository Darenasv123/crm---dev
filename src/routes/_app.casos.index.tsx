import { createFileRoute, Link } from "@tanstack/react-router";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { useCases, useCreateCase } from "@/hooks/use-cases";
import { useClients } from "@/hooks/use-clients";
import { useUploadDocument } from "@/hooks/use-documents";
import { supabase } from "@/lib/supabase";
import { Plus, Filter, CalendarClock, AlertTriangle, Search, ChevronDown, X, Loader2, FileUp, FileText } from "lucide-react";
import { useState, useRef, useMemo } from "react";

export const Route = createFileRoute("/_app/casos/")({
  head: () => ({ meta: [{ title: "Casos — CRM Jurídico" }] }),
  component: CasesPage,
});

const CASE_STATUSES = ["Consulta","Documentación","Demanda presentada","En proceso","Audiencia","Sentencia","Archivado"] as const;
type CaseStatus = typeof CASE_STATUSES[number];

const statusTone: Record<CaseStatus, "default" | "info" | "warning" | "navy" | "gold" | "danger" | "success"> = {
  "Consulta": "default",
  "Documentación": "info",
  "Demanda presentada": "gold",
  "En proceso": "navy",
  "Audiencia": "warning",
  "Sentencia": "success",
  "Archivado": "default",
};

function CasesPage() {
  const { data: cases = [], isLoading } = useCases();
  const { data: clients = [] } = useClients();
  const createCase = useCreateCase();
  const uploadDoc = useUploadDocument();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [expedienteFile, setExpedienteFile] = useState<File | null>(null);
  const expedienteRef = useRef<HTMLInputElement>(null);
  // Client search state for the modal
  const [clientSearch, setClientSearch] = useState("");
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false);
  const clientSearchRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    client_id: "",
    expediente: "",
    process_type: "",
    priority: "Media" as "Alta" | "Media" | "Baja",
    status: "Consulta" as CaseStatus,
    juzgado: "",
    next_hearing: "",
  });

  // Filtered clients for the search dropdown
  const filteredClients = useMemo(() =>
    clientSearch.trim()
      ? clients.filter(c => c.name.toLowerCase().includes(clientSearch.toLowerCase()))
      : clients,
    [clients, clientSearch]
  );

  const selectedClientName = clients.find(c => c.id === form.client_id)?.name ?? "";

  const filtered = cases.filter(c => {
    const matchSearch = !search ||
      (c.clients?.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      c.expediente.toLowerCase().includes(search.toLowerCase());
    const matchStatus = !statusFilter || c.status === statusFilter;
    const matchPriority = !priorityFilter || c.priority === priorityFilter;
    return matchSearch && matchStatus && matchPriority;
  });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      const newCase = await createCase.mutateAsync({
        ...form,
        demandante: "",
        demandado: "",
        next_hearing: form.next_hearing ? new Date(form.next_hearing).toISOString() : null,
      });

      // Upload expediente file if provided
      if (expedienteFile && newCase?.id) {
        await uploadDoc.mutateAsync({
          file: expedienteFile,
          type: "Expediente",
          caseId: newCase.id,
          clientId: form.client_id,
        });
      }

      setShowModal(false);
      setExpedienteFile(null);
      setClientSearch("");
      setClientDropdownOpen(false);
      setForm({ client_id: "", expediente: "", process_type: "", priority: "Media", status: "Consulta", juzgado: "", next_hearing: "" });
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Error al guardar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppLayout
      title="Gestión de Casos"
      subtitle={`${cases.length} expedientes`}
      actions={
        <>
          <button className="inline-flex items-center gap-2 h-10 px-3 rounded-lg bg-card border border-border text-sm font-medium hover:bg-muted/60">
            <Filter className="h-4 w-4" /> Filtros
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 shadow-soft"
          >
            <Plus className="h-4 w-4" /> Nuevo Caso
          </button>
        </>
      }
    >
      {/* Filters bar */}
      <Card className="p-3 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar expediente, cliente..."
              className="w-full h-9 pl-9 pr-3 rounded-lg bg-muted/40 border border-border focus:bg-card focus:border-primary focus:outline-none text-sm"
            />
          </div>
          <div className="relative">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="h-9 pl-3 pr-8 rounded-lg bg-card border border-border text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer">
              <option value="">Todos los estados</option>
              {CASE_STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
          <div className="relative">
            <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}
              className="h-9 pl-3 pr-8 rounded-lg bg-card border border-border text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer">
              <option value="">Todas las prioridades</option>
              <option>Alta</option>
              <option>Media</option>
              <option>Baja</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-3 pl-5 pr-3 font-semibold">Expediente</th>
                  <th className="py-3 px-3 font-semibold">Cliente</th>
                  <th className="py-3 px-3 font-semibold">Proceso</th>
                  <th className="py-3 px-3 font-semibold">Juzgado</th>
                  <th className="py-3 px-3 font-semibold">Prioridad</th>
                  <th className="py-3 px-3 font-semibold">Estado</th>
                  <th className="py-3 px-3 font-semibold">Próx. audiencia</th>
                  <th className="py-3 pr-5 font-semibold text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={8} className="py-12 text-center text-sm text-muted-foreground">
                    {search ? "No se encontraron casos." : "Aún no hay casos registrados."}
                  </td></tr>
                ) : filtered.map((c) => (
                  <tr key={c.id} className="border-t border-border hover:bg-muted/30 transition">
                    <td className="py-3 pl-5 pr-3 font-mono text-xs text-muted-foreground">{c.expediente}</td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        <div className="grid h-7 w-7 place-items-center rounded-full text-[10px] font-bold text-white shrink-0"
                          style={{ background: c.clients?.color ?? "oklch(0.55 0.13 235)" }}>
                          {c.clients?.initials ?? "??"}
                        </div>
                        <span className="font-semibold truncate">{c.clients?.name ?? "—"}</span>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-muted-foreground">{c.process_type}</td>
                    <td className="py-3 px-3 text-xs text-muted-foreground max-w-[160px] truncate">{c.juzgado}</td>
                    <td className="py-3 px-3">
                      <StatusBadge tone={c.priority === "Alta" ? "danger" : c.priority === "Media" ? "warning" : "info"}>
                        {c.priority === "Alta" && <AlertTriangle className="h-2.5 w-2.5" />}
                        {c.priority}
                      </StatusBadge>
                    </td>
                    <td className="py-3 px-3">
                      <StatusBadge tone={statusTone[c.status as CaseStatus]}>{c.status}</StatusBadge>
                    </td>
                    <td className="py-3 px-3">
                      {!c.next_hearing ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <div className="flex items-center gap-1 text-xs">
                          <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>{new Date(c.next_hearing).toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" })}</span>
                        </div>
                      )}
                    </td>
                    <td className="py-3 pr-5 text-right">
                      <Link to={"/casos/$id" as never} params={{ id: c.id } as never}
                        className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-primary/10 text-primary text-xs font-semibold hover:bg-primary hover:text-primary-foreground transition">
                        Ver caso
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {!isLoading && (
          <div className="px-5 py-3 border-t border-border text-xs text-muted-foreground">
            Mostrando {filtered.length} de {cases.length} expedientes
          </div>
        )}
      </Card>

      {/* New Case Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <Card className="w-full max-w-lg p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold">Nuevo caso</h3>
              <button onClick={() => { setShowModal(false); setExpedienteFile(null); setClientSearch(""); setClientDropdownOpen(false); }} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-muted/60"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              {/* Cliente con buscador */}
              <div className="relative">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Cliente *</label>
                <div className="mt-1.5 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <input
                    ref={clientSearchRef}
                    type="text"
                    value={form.client_id ? selectedClientName : clientSearch}
                    onChange={e => {
                      setClientSearch(e.target.value);
                      setForm(f => ({ ...f, client_id: "" }));
                      setClientDropdownOpen(true);
                    }}
                    onFocus={() => {
                      if (!form.client_id) setClientDropdownOpen(true);
                    }}
                    placeholder="Buscar cliente por nombre..."
                    required={!form.client_id}
                    className="w-full h-10 pl-9 pr-3 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-sm"
                    autoComplete="off"
                  />
                  {form.client_id && (
                    <button
                      type="button"
                      onClick={() => { setForm(f => ({ ...f, client_id: "" })); setClientSearch(""); setClientDropdownOpen(false); setTimeout(() => clientSearchRef.current?.focus(), 0); }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 h-5 w-5 grid place-items-center rounded hover:bg-muted/60 text-muted-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
                {/* Dropdown */}
                {clientDropdownOpen && !form.client_id && (
                  <div className="absolute z-50 mt-1 w-full bg-card border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {filteredClients.length === 0 ? (
                      <div className="px-3 py-3 text-sm text-muted-foreground text-center">Sin resultados</div>
                    ) : filteredClients.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onMouseDown={() => {
                          setForm(f => ({ ...f, client_id: c.id }));
                          setClientSearch("");
                          setClientDropdownOpen(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted/50 text-left text-sm transition"
                      >
                        <div className="grid h-7 w-7 place-items-center rounded-full text-[10px] font-bold text-white shrink-0"
                          style={{ background: c.color ?? "oklch(0.55 0.13 235)" }}>
                          {c.initials}
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{c.name}</div>
                          <div className="text-[10px] text-muted-foreground truncate">{c.process_type}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {/* Hidden input for form validation */}
                <input type="text" value={form.client_id} required readOnly className="sr-only" tabIndex={-1} aria-hidden />
              </div>

              {/* Expediente number + file attachment */}
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">N° Expediente *</label>
                <input
                  type="text"
                  value={form.expediente}
                  onChange={e => setForm(f => ({ ...f, expediente: e.target.value }))}
                  required
                  placeholder="Ej: 01234-2024-0-1801-JR-PE-01"
                  className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-sm font-mono"
                />
                {/* Expediente file */}
                <div
                  onClick={() => expedienteRef.current?.click()}
                  className={`mt-2 flex items-center gap-2 h-9 px-3 rounded-lg border border-dashed cursor-pointer transition text-xs
                    ${expedienteFile ? "border-primary/50 bg-primary/5 text-primary" : "border-border hover:border-primary/40 hover:bg-muted/30 text-muted-foreground"}`}
                >
                  {expedienteFile ? (
                    <>
                      <FileText className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate font-medium">{expedienteFile.name}</span>
                      <button type="button" onClick={ev => { ev.stopPropagation(); setExpedienteFile(null); }} className="ml-auto h-5 w-5 grid place-items-center rounded hover:bg-primary/20"><X className="h-3 w-3" /></button>
                    </>
                  ) : (
                    <>
                      <FileUp className="h-3.5 w-3.5 shrink-0" />
                      <span>Adjuntar archivo del expediente (opcional)</span>
                    </>
                  )}
                </div>
                <input ref={expedienteRef} type="file" className="hidden" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar" onChange={e => setExpedienteFile(e.target.files?.[0] ?? null)} />
              </div>

              {/* Proceso — free text */}
              <CaseField label="Proceso *" value={form.process_type} onChange={v => setForm(f => ({ ...f, process_type: v }))} required placeholder="Ej: Defensa penal por robo agravado" />

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Prioridad</label>
                  <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value as typeof form.priority }))}
                    className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none text-sm">
                    <option>Alta</option><option>Media</option><option>Baja</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Estado</label>
                  <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as CaseStatus }))}
                    className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none text-sm">
                    {CASE_STATUSES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <CaseField label="Juzgado (opcional)" value={form.juzgado} onChange={v => setForm(f => ({ ...f, juzgado: v }))} placeholder="Ej: 1° Juzgado Penal de Lima" />
              <div>
                <CaseField label="Próxima audiencia (opcional)" value={form.next_hearing} onChange={v => setForm(f => ({ ...f, next_hearing: v }))} type="datetime-local" />
                <p className="text-[11px] text-muted-foreground mt-1">Puedes dejarla en blanco y asignarla más adelante.</p>
              </div>
              {formError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowModal(false); setExpedienteFile(null); setClientSearch(""); setClientDropdownOpen(false); }} className="flex-1 h-10 rounded-lg border border-border text-sm font-medium hover:bg-muted/60">Cancelar</button>
                <button type="submit" disabled={saving} className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 disabled:opacity-60 flex items-center justify-center gap-2">
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {saving ? "Guardando..." : "Guardar caso"}
                </button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </AppLayout>
  );
}

function CaseField({ label, value, onChange, required, type = "text", placeholder }: {
  label: string; value: string; onChange: (v: string) => void; required?: boolean; type?: string; placeholder?: string;
}) {
  return (
    <div>
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} required={required} placeholder={placeholder}
        className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-sm" />
    </div>
  );
}
