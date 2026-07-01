import { createFileRoute, Link } from "@tanstack/react-router";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { useCase, useUpdateCase } from "@/hooks/use-cases";
import { useDocuments, useUploadDocument, useDeleteDocument } from "@/hooks/use-documents";
import { supabase } from "@/lib/supabase";
import {
  ArrowLeft, FileText, Download, Gavel, CalendarClock,
  StickyNote, CheckCircle2, Clock, X, Loader2, Save,
  Edit3, FileUp, Trash2, ChevronDown, Eye,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";

export const Route = createFileRoute("/_app/casos/$id")({
  component: CaseDetail,
});

const CASE_STATUSES = ["Consulta","Documentación","Demanda presentada","En proceso","Audiencia","Sentencia","Archivado"] as const;
type CaseStatus = typeof CASE_STATUSES[number];
const DOC_TYPES = ["DNI","Demanda","Resolución","Sentencia","Poder","Contrato","Otros"];

function CaseDetail() {
  const { id } = Route.useParams();
  const { data: item, isLoading } = useCase(id);
  const { data: allDocs = [] } = useDocuments();
  const updateCase = useUpdateCase();
  const uploadDoc = useUploadDocument();
  const deleteDoc = useDeleteDocument();

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string,string>>({});

  const [showUpload, setShowUpload] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadType, setUploadType] = useState("Otros");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Notes state
  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);

  // Sync notes from DB when item loads
  useEffect(() => {
    if (item) setNotes(item.notes ?? "");
  }, [item?.id]);
  if (isLoading) {
    return (
      <AppLayout title="Cargando..." subtitle="">
        <div className="flex items-center justify-center py-32"><Loader2 className="h-8 w-8 animate-spin text-primary"/></div>
      </AppLayout>
    );
  }

  if (!item) {
    return (
      <AppLayout title="Caso no encontrado" subtitle="">
        <div className="text-center py-32">
          <p className="text-muted-foreground mb-4">El caso no existe o fue eliminado.</p>
          <Link to={"/casos" as never} className="text-primary hover:underline text-sm font-semibold">Volver a casos</Link>
        </div>
      </AppLayout>
    );
  }

  const caseDocs = allDocs.filter(d => d.case_id === id || d.client_id === item.client_id);
  // Separate the main expediente file (type "Expediente") from the rest
  const expedienteDoc = caseDocs.find(d => d.type === "Expediente");
  const otherDocs = caseDocs.filter(d => d.type !== "Expediente");

  // Build status timeline
  const statusOrder: CaseStatus[] = ["Consulta","Documentación","Demanda presentada","En proceso","Audiencia","Sentencia","Archivado"];
  const currentIdx = statusOrder.indexOf(item.status as CaseStatus);

  function startEdit() {
    if (!item) return;
    setEditForm({
      expediente: item.expediente,
      process_type: item.process_type,
      priority: item.priority,
      status: item.status,
      juzgado: item.juzgado,
      next_hearing: item.next_hearing ? new Date(item.next_hearing).toISOString().slice(0,16) : "",
    });
    setEditing(true);
    setEditError(null);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setEditError(null);
    try {
      await updateCase.mutateAsync({
        id,
        updates: {
          expediente: editForm.expediente,
          process_type: editForm.process_type,
          priority: editForm.priority as "Alta"|"Media"|"Baja",
          status: editForm.status as CaseStatus,
          juzgado: editForm.juzgado,
          next_hearing: editForm.next_hearing ? new Date(editForm.next_hearing).toISOString() : null,
        },
      });
      setEditing(false);
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : "Error al guardar.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadFile || !item) return;
    setUploading(true);
    try {
      await uploadDoc.mutateAsync({ file: uploadFile, type: uploadType, caseId: id, clientId: item.client_id });
      setShowUpload(false);
      setUploadFile(null);
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(doc: typeof caseDocs[0]) {
    const { data } = await supabase.storage.from("documents").createSignedUrl(doc.storage_path, 60);
    if (data?.signedUrl) { const a = document.createElement("a"); a.href = data.signedUrl; a.download = doc.name; a.click(); }
  }

  async function handleOpen(doc: typeof caseDocs[0]) {
    const { data } = await supabase.storage.from("documents").createSignedUrl(doc.storage_path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  async function saveNotes() {
    if (!item) return;
    setSavingNotes(true);
    try {
      await updateCase.mutateAsync({ id, updates: { notes } });
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 2000);
    } finally {
      setSavingNotes(false);
    }
  }

  function confirmDeleteDoc(docId: string, storagePath: string) {
    if (window.confirm("¿Eliminar este documento? Esta acción no se puede deshacer.")) {
      deleteDoc.mutate({ id: docId, storagePath });
    }
  }

  return (
    <AppLayout
      title={item.process_type}
      subtitle={item.expediente}
      actions={
        <>
          <Link to={"/casos" as never} className="inline-flex items-center gap-2 h-10 px-3 rounded-lg border border-border text-sm font-medium hover:bg-muted/60">
            <ArrowLeft className="h-4 w-4"/> Volver
          </Link>
          <button onClick={startEdit} className="inline-flex items-center gap-2 h-10 px-3 rounded-lg border border-border text-sm font-medium hover:bg-muted/60">
            <Edit3 className="h-4 w-4"/> Editar caso
          </button>
          <button onClick={()=>setShowUpload(true)} className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 shadow-soft">
            <FileUp className="h-4 w-4"/> Subir documento
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Expediente file — shown at the very top for quick access */}
          {expedienteDoc && (
            <Card className="p-4 border-primary/30 bg-primary/5">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary shrink-0">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-0.5">Expediente adjunto</div>
                  <div className="text-sm font-semibold truncate">{expedienteDoc.name}</div>
                  <div className="text-[11px] text-muted-foreground">{expedienteDoc.size} · Subido {new Date(expedienteDoc.uploaded_at).toLocaleDateString("es-PE")}</div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => handleOpen(expedienteDoc)} title="Ver expediente" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:brightness-110 transition">
                    <Eye className="h-3.5 w-3.5" /> Abrir
                  </button>
                  <button onClick={() => handleDownload(expedienteDoc)} title="Descargar" className="h-8 w-8 grid place-items-center rounded-lg border border-border hover:bg-muted/60 transition">
                    <Download className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </div>
              </div>
            </Card>
          )}
          {/* General info */}
          <Card className="p-6">
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-base font-semibold">Información general</h3>
              <StatusBadge tone="navy">{item.status}</StatusBadge>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
              <Field k="Expediente" v={item.expediente} mono/>
              <Field k="Juzgado" v={item.juzgado}/>
              <Field k="Proceso" v={item.process_type}/>
              <Field k="Prioridad" v={item.priority}/>
              <Field k="Cliente" v={item.clients?.name ?? "—"}/>
              <Field k="Registrado" v={new Date(item.created_at).toLocaleDateString("es-PE")}/>
            </div>
          </Card>

          {/* Status timeline */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold flex items-center gap-2"><Gavel className="h-4 w-4 text-primary"/> Progreso del proceso</h3>
              <span className="text-xs text-muted-foreground">{currentIdx + 1} de {statusOrder.length} etapas</span>
            </div>
            <ol className="relative space-y-4">
              {statusOrder.map((s, i) => {
                const done = i <= currentIdx;
                const current = i === currentIdx;
                return (
                  <li key={s} className="relative pl-10">
                    {i !== statusOrder.length - 1 && (
                      <span className={`absolute left-3 top-7 bottom-[-1rem] w-px ${done ? "bg-primary/40" : "bg-border"}`}/>
                    )}
                    <div className={`absolute left-0 top-0.5 grid h-6 w-6 place-items-center rounded-full border-2 transition-colors
                      ${done ? "bg-primary text-white border-primary" : "bg-card border-border text-muted-foreground"}
                      ${current ? "ring-2 ring-primary/30" : ""}`}>
                      {done ? <CheckCircle2 className="h-3 w-3"/> : <Clock className="h-3 w-3"/>}
                    </div>
                    <div className={`text-sm font-semibold ${current ? "text-primary" : done ? "text-foreground" : "text-muted-foreground"}`}>{s}</div>
                    {current && <p className="text-xs text-muted-foreground">Estado actual del expediente</p>}
                  </li>
                );
              })}
            </ol>
          </Card>

          {/* Documents */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold flex items-center gap-2"><FileText className="h-4 w-4 text-primary"/> Documentos del caso</h3>
              <button onClick={()=>setShowUpload(true)} className="text-xs font-semibold text-primary hover:underline">Subir documento</button>
            </div>
            {otherDocs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay documentos adicionales asociados a este caso.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {otherDocs.map(d => (
                  <div key={d.id} className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/30 hover:bg-muted/30 transition group">
                    <div className="grid h-10 w-10 place-items-center rounded-lg bg-red-50 text-red-600 shrink-0"><FileText className="h-5 w-5"/></div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold truncate">{d.name}</div>
                      <div className="text-[11px] text-muted-foreground">{d.type} · {d.size}</div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                      <button onClick={()=>handleOpen(d)} className="h-8 w-8 grid place-items-center rounded-md hover:bg-muted/60" title="Abrir"><Eye className="h-4 w-4 text-muted-foreground"/></button>
                      <button onClick={()=>handleDownload(d)} className="h-8 w-8 grid place-items-center rounded-md hover:bg-muted/60"><Download className="h-4 w-4 text-muted-foreground"/></button>
                      <button onClick={()=>confirmDeleteDoc(d.id, d.storage_path)} className="h-8 w-8 grid place-items-center rounded-md hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4 text-muted-foreground"/></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Next hearing card */}
          <Card className="p-6 bg-gradient-to-br from-primary to-[oklch(0.28_0.07_255)] text-white">
            <div className="flex items-center gap-2 text-xs text-white/70 uppercase tracking-wider">
              <CalendarClock className="h-4 w-4 text-gold"/> Próxima audiencia
            </div>
            {item.next_hearing ? (
              <>
                <div className="mt-3 text-2xl font-bold">
                  {new Date(item.next_hearing).toLocaleDateString("es-PE",{day:"2-digit",month:"long"})}
                </div>
                <div className="text-sm text-white/80">
                  {new Date(item.next_hearing).toLocaleTimeString("es-PE",{hour:"2-digit",minute:"2-digit"})} hrs
                </div>
              </>
            ) : (
              <div className="mt-3 text-xl font-bold text-white/70">Sin programar</div>
            )}
            <div className="mt-4 pt-4 border-t border-white/10 text-xs text-white/70 truncate">{item.juzgado}</div>
            <Link to={"/agenda" as never} className="mt-4 w-full h-9 rounded-lg bg-gold text-gold-foreground text-xs font-semibold hover:brightness-105 transition flex items-center justify-center">
              Ver en agenda
            </Link>
          </Card>

          {/* Client card */}
          {item.clients && (
            <Card className="p-5">
              <h3 className="text-sm font-semibold mb-3">Cliente</h3>
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-full text-xs font-bold text-white shrink-0"
                  style={{background: item.clients.color}}>
                  {item.clients.initials}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{item.clients.name}</div>
                </div>
              </div>
              <Link to={"/clientes/$id" as never} params={{id:item.client_id} as never}
                className="mt-3 w-full h-8 rounded-lg border border-border text-xs font-semibold hover:bg-muted/60 flex items-center justify-center">
                Ver ficha completa
              </Link>
            </Card>
          )}

          {/* Notes */}
          <Card className="p-5">
            <h3 className="text-base font-semibold flex items-center gap-2 mb-3">
              <StickyNote className="h-4 w-4 text-gold"/> Notas internas
            </h3>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Agregar nota interna..."
              className="w-full text-xs rounded-lg border border-border bg-card p-3 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
              rows={4}
            />
            <button
              onClick={saveNotes}
              disabled={savingNotes}
              className="mt-2 w-full h-8 rounded-lg bg-primary/10 text-primary text-xs font-semibold hover:bg-primary hover:text-primary-foreground transition disabled:opacity-60 flex items-center justify-center gap-1.5"
            >
              {savingNotes ? (
                <><Loader2 className="h-3 w-3 animate-spin"/> Guardando...</>
              ) : notesSaved ? (
                <><CheckCircle2 className="h-3 w-3"/> Guardado</>
              ) : (
                <><Save className="h-3 w-3"/> Guardar nota</>
              )}
            </button>
          </Card>
        </div>
      </div>

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <Card className="w-full max-w-lg p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold">Editar caso</h3>
              <button onClick={()=>setEditing(false)} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-muted/60"><X className="h-4 w-4"/></button>
            </div>
            <form onSubmit={saveEdit} className="space-y-4">
              <CF label="N° Expediente *" v={editForm.expediente} set={v=>setEditForm(f=>({...f,expediente:v}))} required/>
              <CF label="Proceso *" v={editForm.process_type} set={v=>setEditForm(f=>({...f,process_type:v}))} required placeholder="Ej: Defensa penal por robo agravado"/>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Prioridad</label>
                  <div className="relative mt-1.5">
                    <select value={editForm.priority} onChange={e=>setEditForm(f=>({...f,priority:e.target.value}))} className="w-full h-10 pl-3 pr-8 rounded-lg border border-border bg-card focus:outline-none text-sm appearance-none">
                      <option>Alta</option><option>Media</option><option>Baja</option>
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"/>
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Estado</label>
                  <div className="relative mt-1.5">
                    <select value={editForm.status} onChange={e=>setEditForm(f=>({...f,status:e.target.value}))} className="w-full h-10 pl-3 pr-8 rounded-lg border border-border bg-card focus:outline-none text-sm appearance-none">
                      {CASE_STATUSES.map(s=><option key={s}>{s}</option>)}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"/>
                  </div>
                </div>
              </div>
              <CF label="Juzgado *" v={editForm.juzgado} set={v=>setEditForm(f=>({...f,juzgado:v}))} required/>
              <div>
                <CF label="Próxima audiencia (opcional)" v={editForm.next_hearing} set={v=>setEditForm(f=>({...f,next_hearing:v}))} type="datetime-local"/>
                <p className="text-[11px] text-muted-foreground mt-1">Dejar en blanco si aún no está programada.</p>
              </div>
              {editError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{editError}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={()=>setEditing(false)} className="flex-1 h-10 rounded-lg border border-border text-sm font-medium hover:bg-muted/60">Cancelar</button>
                <button type="submit" disabled={saving} className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 disabled:opacity-60 flex items-center justify-center gap-2">
                  {saving?<><Loader2 className="h-4 w-4 animate-spin"/>Guardando...</>:<><Save className="h-4 w-4"/>Guardar</>}
                </button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Upload doc modal */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md p-6 shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold">Subir documento al caso</h3>
              <button onClick={()=>setShowUpload(false)} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-muted/60"><X className="h-4 w-4"/></button>
            </div>
            <form onSubmit={handleUpload} className="space-y-4">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Archivo *</label>
                <div onClick={()=>fileRef.current?.click()} className={`mt-1.5 flex flex-col items-center justify-center gap-2 h-20 rounded-lg border-2 border-dashed cursor-pointer transition ${uploadFile?"border-primary/40 bg-primary/5":"border-border hover:border-primary/40 hover:bg-muted/30"}`}>
                  {uploadFile?(<><FileText className="h-5 w-5 text-primary"/><span className="text-xs font-medium text-primary truncate max-w-[260px]">{uploadFile.name}</span></>):(<><FileUp className="h-5 w-5 text-muted-foreground"/><span className="text-xs text-muted-foreground">Haz clic para seleccionar</span></>)}
                </div>
                <input ref={fileRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={e=>setUploadFile(e.target.files?.[0]??null)}/>
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tipo</label>
                <select value={uploadType} onChange={e=>setUploadType(e.target.value)} className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none text-sm">
                  {DOC_TYPES.map(t=><option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={()=>setShowUpload(false)} className="flex-1 h-10 rounded-lg border border-border text-sm font-medium hover:bg-muted/60">Cancelar</button>
                <button type="submit" disabled={!uploadFile||uploading} className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 disabled:opacity-60 flex items-center justify-center gap-2">
                  {uploading?<><Loader2 className="h-4 w-4 animate-spin"/>Subiendo...</>:<><FileUp className="h-4 w-4"/>Subir</>}
                </button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </AppLayout>
  );
}

function Field({k,v,mono}:{k:string;v:string;mono?:boolean}) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground uppercase tracking-wider mb-0.5">{k}</div>
      <div className={`text-sm font-medium ${mono?"font-mono text-xs":""}`}>{v}</div>
    </div>
  );
}
function CF({label,v,set,required,type="text",placeholder}:{label:string;v:string;set:(s:string)=>void;required?:boolean;type?:string;placeholder?:string}) {
  return (
    <div>
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
      <input type={type} value={v} onChange={e=>set(e.target.value)} required={required} placeholder={placeholder} className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-sm"/>
    </div>
  );
}
