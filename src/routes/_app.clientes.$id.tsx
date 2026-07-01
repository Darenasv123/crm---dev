import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { useClient, useUpdateClient } from "@/hooks/use-clients";
import { useCases } from "@/hooks/use-cases";
import { usePayments } from "@/hooks/use-payments";
import { useDocuments, useUploadDocument, useDeleteDocument } from "@/hooks/use-documents";
import { supabase } from "@/lib/supabase";
import {
  ArrowLeft, Edit3, CreditCard, FileUp, Briefcase, Phone, Mail,
  IdCard, FileText, Download,
  X, Loader2, Trash2, Save,
} from "lucide-react";
import { useState, useRef } from "react";

export const Route = createFileRoute("/_app/clientes/$id")({
  component: ClientDetail,
});

const TABS = ["Información", "Casos", "Pagos", "Documentos"] as const;
type Tab = typeof TABS[number];

const STATUS_OPTIONS = ["Activo","En espera","Cerrado"] as const;
const DOC_TYPES = ["DNI","Demanda","Resolución","Sentencia","Poder","Contrato","Otros"];

function currency(n: number) {
  return new Intl.NumberFormat("es-PE",{style:"currency",currency:"PEN",maximumFractionDigits:0}).format(n);
}

function ClientDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();

  const { data: client, isLoading: loadingClient } = useClient(id);
  const { data: allCases = [] } = useCases();
  const { data: allPayments = [] } = usePayments();
  const { data: allDocs = [] } = useDocuments();
  const updateClient = useUpdateClient();
  const uploadDoc = useUploadDocument();
  const deleteDoc = useDeleteDocument();

  const [tab, setTab] = useState<Tab>("Información");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string,string>>({});

  // Upload doc state
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadType, setUploadType] = useState("Otros");
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  if (loadingClient) {
    return (
      <AppLayout title="Cargando..." subtitle="">
        <div className="flex items-center justify-center py-32">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  if (!client) {
    return (
      <AppLayout title="Cliente no encontrado" subtitle="">
        <div className="text-center py-32">
          <p className="text-muted-foreground mb-4">El cliente no existe o fue eliminado.</p>
          <Link to={"/clientes" as never} className="text-primary hover:underline text-sm font-semibold">Volver a clientes</Link>
        </div>
      </AppLayout>
    );
  }

  const clientCases    = allCases.filter(c => c.client_id === id);
  const clientPayments = allPayments.filter(p => p.client_id === id);
  const clientDocs     = allDocs.filter(d => d.client_id === id);

  function startEdit() {
    setEditForm({
      name: client.name,
      dni: client.dni,
      phone: client.phone,
      email: client.email ?? "",
      process_type: client.process_type,
      status: client.status,
    });
    setEditing(true);
    setEditError(null);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setEditError(null);
    try {
      await updateClient.mutateAsync({
        id,
        updates: {
          name: editForm.name,
          dni: editForm.dni,
          phone: editForm.phone,
          email: editForm.email || null,
          process_type: editForm.process_type,
          status: editForm.status as typeof client.status,
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
    if (!uploadFile) return;
    setUploading(true);
    try {
      await uploadDoc.mutateAsync({ file: uploadFile, type: uploadType, clientId: id });
      setShowUpload(false);
      setUploadFile(null);
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(doc: typeof clientDocs[0]) {
    const { data } = await supabase.storage.from("documents").createSignedUrl(doc.storage_path, 60);
    if (data?.signedUrl) { const a = document.createElement("a"); a.href = data.signedUrl; a.download = doc.name; a.click(); }
  }

  return (
    <AppLayout
      title={client.name}
      subtitle={`Cliente desde ${new Date(client.registered_at).toLocaleDateString("es-PE",{month:"long",year:"numeric"})}`}
      actions={
        <Link to={"/clientes" as never} className="inline-flex items-center gap-2 h-10 px-3 rounded-lg border border-border text-sm font-medium hover:bg-muted/60">
          <ArrowLeft className="h-4 w-4" /> Volver
        </Link>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
        {/* Profile card */}
        <div className="space-y-4">
          <Card className="p-6 text-center">
            <div className="grid h-20 w-20 mx-auto place-items-center rounded-full text-2xl font-bold text-white shadow-card" style={{ background: client.color }}>
              {client.initials}
            </div>
            <h2 className="mt-4 text-lg font-bold">{client.name}</h2>
            <p className="text-xs text-muted-foreground">{client.process_type}</p>
            <div className="mt-3 flex justify-center">
              <StatusBadge tone={client.status==="Activo"?"success":client.status==="En espera"?"warning":"default"}>
                {client.status}
              </StatusBadge>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button onClick={startEdit} className="inline-flex items-center justify-center gap-1.5 h-9 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:brightness-110">
                <Edit3 className="h-3.5 w-3.5" /> Editar
              </button>
              <button onClick={()=>{setTab("Pagos")}} className="inline-flex items-center justify-center gap-1.5 h-9 rounded-lg bg-gold text-gold-foreground text-xs font-semibold hover:brightness-105">
                <CreditCard className="h-3.5 w-3.5" /> Pagos
              </button>
              <button onClick={()=>{setShowUpload(true)}} className="inline-flex items-center justify-center gap-1.5 h-9 rounded-lg border border-border text-xs font-semibold hover:bg-muted/60">
                <FileUp className="h-3.5 w-3.5" /> Documento
              </button>
              <button onClick={()=>navigate({to:"/casos" as never})} className="inline-flex items-center justify-center gap-1.5 h-9 rounded-lg border border-border text-xs font-semibold hover:bg-muted/60">
                <Briefcase className="h-3.5 w-3.5" /> Casos
              </button>
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Contacto</h3>
            <ul className="space-y-3 text-sm">
              <InfoRow icon={Phone} label="Teléfono" value={client.phone} />
              <InfoRow icon={Mail} label="Correo" value={client.email ?? "—"} />
              <InfoRow icon={IdCard} label="DNI" value={client.dni} />
            </ul>
          </Card>
        </div>

        {/* Tabs */}
        <div>
          <div className="flex items-center gap-1 border-b border-border mb-6 overflow-x-auto">
            {TABS.map(t => (
              <button key={t} onClick={()=>setTab(t)}
                className={`relative px-4 py-3 text-sm font-semibold whitespace-nowrap transition ${tab===t?"text-primary":"text-muted-foreground hover:text-foreground"}`}
              >
                {t}
                {tab===t && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gold"/>}
              </button>
            ))}
          </div>

          {tab === "Información" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="p-5">
                <h4 className="text-sm font-semibold mb-3">Datos generales</h4>
                <dl className="space-y-0">
                  <DataRow k="Nombre completo" v={client.name} />
                  <DataRow k="DNI" v={client.dni} />
                  <DataRow k="Teléfono" v={client.phone} />
                  <DataRow k="Correo" v={client.email ?? "—"} />
                  <DataRow k="Tipo de proceso" v={client.process_type} />
                  <DataRow k="Estado" v={client.status} />
                  <DataRow k="Registrado" v={new Date(client.registered_at).toLocaleDateString("es-PE")} />
                </dl>
              </Card>
              <Card className="p-5">
                <h4 className="text-sm font-semibold mb-4">Resumen jurídico</h4>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <Stat n={clientCases.length} l="Casos" />
                  <Stat n={clientPayments.length} l="Pagos" />
                  <Stat n={clientDocs.length} l="Documentos" />
                </div>
              </Card>
            </div>
          )}

          {tab === "Casos" && (
            <Card className="overflow-hidden">
              {clientCases.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">No hay casos registrados para este cliente.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                    <th className="py-3 px-4">Expediente</th>
                    <th className="py-3 px-4">Proceso</th>
                    <th className="py-3 px-4">Estado</th>
                    <th className="py-3 px-4">Prioridad</th>
                    <th className="py-3 px-4">Próx. audiencia</th>
                  </tr></thead>
                  <tbody>
                    {clientCases.map(c => (
                      <tr key={c.id} className="border-t border-border hover:bg-muted/30">
                        <td className="py-3 px-4 font-mono text-xs text-muted-foreground">{c.expediente}</td>
                        <td className="py-3 px-4">{c.process_type}</td>
                        <td className="py-3 px-4"><StatusBadge tone="navy">{c.status}</StatusBadge></td>
                        <td className="py-3 px-4">
                          <StatusBadge tone={c.priority==="Alta"?"danger":c.priority==="Media"?"warning":"info"}>{c.priority}</StatusBadge>
                        </td>
                        <td className="py-3 px-4 text-xs text-muted-foreground">
                          {c.next_hearing ? new Date(c.next_hearing).toLocaleDateString("es-PE",{day:"2-digit",month:"short",year:"numeric"}) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          )}

          {tab === "Pagos" && (
            <Card className="overflow-hidden">
              {clientPayments.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">No hay pagos registrados para este cliente.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                    <th className="py-3 px-4">Servicio</th>
                    <th className="py-3 px-4">Honorarios</th>
                    <th className="py-3 px-4">Pagado</th>
                    <th className="py-3 px-4">Cuotas</th>
                    <th className="py-3 px-4">Estado</th>
                  </tr></thead>
                  <tbody>
                    {clientPayments.map(p => {
                      const pct = Math.round((Number(p.paid)/Number(p.fees))*100);
                      return (
                        <tr key={p.id} className="border-t border-border hover:bg-muted/30">
                          <td className="py-3 px-4">{p.service}</td>
                          <td className="py-3 px-4 font-semibold tabular-nums">{currency(Number(p.fees))}</td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                                <div className="h-full rounded-full bg-primary" style={{width:`${pct}%`}}/>
                              </div>
                              <span className="text-xs tabular-nums">{currency(Number(p.paid))}</span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-xs text-muted-foreground">{p.paid_installments}/{p.total_installments}</td>
                          <td className="py-3 px-4">
                            <StatusBadge tone={p.status==="Pagado"?"success":p.status==="Vencido"?"danger":"warning"}>{p.status}</StatusBadge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </Card>
          )}

          {tab === "Documentos" && (
            <div>
              <div className="flex justify-end mb-3">
                <button onClick={()=>setShowUpload(true)}
                  className="inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:brightness-110">
                  <FileUp className="h-3.5 w-3.5"/> Subir documento
                </button>
              </div>
              {clientDocs.length === 0 ? (
                <Card className="py-12 text-center text-sm text-muted-foreground">No hay documentos para este cliente.</Card>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {clientDocs.map(d => (
                    <Card key={d.id} className="p-4 flex items-center gap-3 group">
                      <div className="grid h-10 w-10 place-items-center rounded-lg bg-red-50 text-red-600 shrink-0">
                        <FileText className="h-5 w-5"/>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold truncate">{d.name}</div>
                        <div className="text-xs text-muted-foreground">{d.type} · {d.size} · {new Date(d.uploaded_at).toLocaleDateString("es-PE")}</div>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                        <button onClick={()=>handleDownload(d)} className="h-8 w-8 grid place-items-center rounded-md hover:bg-muted/60">
                          <Download className="h-4 w-4 text-muted-foreground"/>
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm(`¿Eliminar "${d.name}"? Esta acción no se puede deshacer.`)) {
                              deleteDoc.mutate({ id: d.id, storagePath: d.storage_path });
                            }
                          }}
                          className="h-8 w-8 grid place-items-center rounded-md hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground"/>
                        </button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <Card className="w-full max-w-lg p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold">Editar cliente</h3>
              <button onClick={()=>setEditing(false)} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-muted/60"><X className="h-4 w-4"/></button>
            </div>
            <form onSubmit={saveEdit} className="space-y-4">
              <EF label="Nombre completo *" v={editForm.name} set={v=>setEditForm(f=>({...f,name:v}))} required/>
              <div className="grid grid-cols-2 gap-4">
                <EF label="DNI *" v={editForm.dni} set={v=>setEditForm(f=>({...f,dni:v}))} required/>
                <EF label="Teléfono *" v={editForm.phone} set={v=>setEditForm(f=>({...f,phone:v}))} required/>
              </div>
              <EF label="Correo" v={editForm.email} set={v=>setEditForm(f=>({...f,email:v}))} type="email"/>
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Proceso *</label>
                <input
                  type="text"
                  value={editForm.process_type}
                  onChange={e=>setEditForm(f=>({...f,process_type:e.target.value}))}
                  required
                  placeholder="Ej: Defensa penal por robo agravado"
                  className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-sm"
                />
              </div>
              <ES label="Estado *" v={editForm.status} set={v=>setEditForm(f=>({...f,status:v}))} options={[...STATUS_OPTIONS]}/>
              {editError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{editError}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={()=>setEditing(false)} className="flex-1 h-10 rounded-lg border border-border text-sm font-medium hover:bg-muted/60">Cancelar</button>
                <button type="submit" disabled={saving} className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 disabled:opacity-60 flex items-center justify-center gap-2">
                  {saving ? <><Loader2 className="h-4 w-4 animate-spin"/>Guardando...</> : <><Save className="h-4 w-4"/>Guardar cambios</>}
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
              <h3 className="text-base font-semibold">Subir documento</h3>
              <button onClick={()=>setShowUpload(false)} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-muted/60"><X className="h-4 w-4"/></button>
            </div>
            <form onSubmit={handleUpload} className="space-y-4">
              <div>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Archivo *</label>
                <div onClick={()=>fileRef.current?.click()} className={`mt-1.5 flex flex-col items-center justify-center gap-2 h-20 rounded-lg border-2 border-dashed cursor-pointer transition ${uploadFile?"border-primary/40 bg-primary/5":"border-border hover:border-primary/40 hover:bg-muted/30"}`}>
                  {uploadFile ? (
                    <><FileText className="h-5 w-5 text-primary"/><span className="text-xs font-medium text-primary truncate max-w-[260px]">{uploadFile.name}</span></>
                  ) : (
                    <><FileUp className="h-5 w-5 text-muted-foreground"/><span className="text-xs text-muted-foreground">Haz clic para seleccionar</span></>
                  )}
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

function InfoRow({icon:Icon,label,value}:{icon:typeof Phone;label:string;value:string}) {
  return (
    <li className="flex items-start gap-3">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted/60"><Icon className="h-4 w-4 text-muted-foreground"/></div>
      <div className="min-w-0"><div className="text-[11px] text-muted-foreground">{label}</div><div className="text-sm font-medium break-all">{value}</div></div>
    </li>
  );
}
function DataRow({k,v}:{k:string;v:string}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-0">
      <dt className="text-xs text-muted-foreground shrink-0">{k}</dt>
      <dd className="text-sm font-medium text-right">{v}</dd>
    </div>
  );
}
function Stat({n,l}:{n:number;l:string}) {
  return (
    <div className="rounded-lg bg-muted/40 py-3">
      <div className="text-2xl font-bold text-primary">{n}</div>
      <div className="text-[11px] text-muted-foreground">{l}</div>
    </div>
  );
}
function EF({label,v,set,required,type="text"}:{label:string;v:string;set:(s:string)=>void;required?:boolean;type?:string}) {
  return (
    <div>
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
      <input type={type} value={v} onChange={e=>set(e.target.value)} required={required} className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-sm"/>
    </div>
  );
}
function ES({label,v,set,options}:{label:string;v:string;set:(s:string)=>void;options:string[]}) {
  return (
    <div>
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
      <select value={v} onChange={e=>set(e.target.value)} className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none text-sm">
        {options.map(o=><option key={o}>{o}</option>)}
      </select>
    </div>
  );
}
