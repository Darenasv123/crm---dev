import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { cases } from "@/lib/mock-data";
import { ArrowLeft, Plus, FileText, Download, Gavel, CalendarClock, StickyNote, CheckCircle2, Clock } from "lucide-react";

export const Route = createFileRoute("/_app/casos/$id")({
  loader: ({ params }) => {
    const item = cases.find(c => c.id === params.id);
    if (!item) throw notFound();
    return { item };
  },
  head: ({ loaderData }) => ({ meta: [{ title: `${loaderData?.item.expediente ?? "Caso"} — CRM` }] }),
  component: CaseDetail,
});

const timeline = [
  { date: "12 Feb 2025", title: "Apertura del expediente", desc: "Registro inicial del caso en el estudio.", done: true },
  { date: "03 Mar 2025", title: "Documentación recibida", desc: "DNI, partidas y antecedentes incorporados.", done: true },
  { date: "18 Abr 2025", title: "Demanda presentada", desc: "Ingresada al juzgado correspondiente.", done: true },
  { date: "22 May 2025", title: "Auto admisorio", desc: "Resolución N° 01 — Admite la demanda.", done: true },
  { date: "08 Jul 2026", title: "Audiencia única", desc: "Próxima audiencia programada.", done: false },
  { date: "—", title: "Sentencia", desc: "Pendiente.", done: false },
];

function CaseDetail() {
  const { item } = Route.useLoaderData();
  return (
    <AppLayout
      title={item.processType}
      subtitle={item.expediente}
      actions={
        <>
          <Link to={"/casos" as never} className="inline-flex items-center gap-2 h-10 px-3 rounded-lg border border-border text-sm font-medium hover:bg-muted/60">
            <ArrowLeft className="h-4 w-4" /> Volver
          </Link>
          <button className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 shadow-soft">
            <Plus className="h-4 w-4" /> Agregar actuación
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-6">
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-base font-semibold">Información general</h3>
              <StatusBadge tone="navy">{item.status}</StatusBadge>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
              <Field k="Expediente" v={item.expediente} mono />
              <Field k="Juzgado" v={item.juzgado} />
              <Field k="Demandante" v={item.demandante} />
              <Field k="Demandado" v={item.demandado} />
              <Field k="Tipo de proceso" v={item.processType} />
              <Field k="Prioridad" v={item.priority} />
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold flex items-center gap-2"><Gavel className="h-4 w-4 text-primary" /> Línea de tiempo del proceso</h3>
              <span className="text-xs text-muted-foreground">4 de 6 etapas completadas</span>
            </div>
            <ol className="relative space-y-5">
              {timeline.map((t, i) => (
                <li key={i} className="relative pl-10">
                  {i !== timeline.length - 1 && <span className={`absolute left-3 top-7 bottom-[-1.5rem] w-px ${t.done ? "bg-primary/40" : "bg-border"}`} />}
                  <div className={`absolute left-0 top-0.5 grid h-6 w-6 place-items-center rounded-full border-2 ${t.done ? "bg-primary text-white border-primary" : "bg-card border-border text-muted-foreground"}`}>
                    {t.done ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold">{t.title}</div>
                    <div className="text-[11px] text-muted-foreground shrink-0">{t.date}</div>
                  </div>
                  <p className="text-xs text-muted-foreground">{t.desc}</p>
                </li>
              ))}
            </ol>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /> Archivos PDF</h3>
              <button className="text-xs font-semibold text-primary hover:underline">Subir documento</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {["Demanda inicial.pdf", "Resolución N° 01.pdf", "Contestación.pdf", "Escrito ofrecimiento.pdf"].map((d, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/30 hover:bg-muted/30 transition">
                  <div className="grid h-10 w-10 place-items-center rounded-lg bg-red-50 text-red-600"><FileText className="h-5 w-5" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate">{d}</div>
                    <div className="text-[11px] text-muted-foreground">{(Math.random() * 3 + 0.4).toFixed(1)} MB · hace {i + 1} días</div>
                  </div>
                  <button className="h-8 w-8 grid place-items-center rounded-md hover:bg-muted/60"><Download className="h-4 w-4 text-muted-foreground" /></button>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-6 bg-gradient-to-br from-primary to-[oklch(0.28_0.07_255)] text-white">
            <div className="flex items-center gap-2 text-xs text-white/70 uppercase tracking-wider"><CalendarClock className="h-4 w-4 text-gold" /> Próxima audiencia</div>
            <div className="mt-3 text-2xl font-bold">{item.nextHearing === "—" ? "Sin programar" : item.nextHearing.split(" ")[0]}</div>
            <div className="text-sm text-white/80">{item.nextHearing.split(" ")[1] ?? ""}</div>
            <div className="mt-4 pt-4 border-t border-white/10 text-xs text-white/70">{item.juzgado}</div>
            <button className="mt-4 w-full h-9 rounded-lg bg-gold text-gold-foreground text-xs font-semibold hover:brightness-105 transition">Ver en agenda</button>
          </Card>

          <Card className="p-6">
            <h3 className="text-base font-semibold flex items-center gap-2 mb-3"><StickyNote className="h-4 w-4 text-gold" /> Notas internas</h3>
            <div className="space-y-3">
              {[
                { a: "CR", n: "Dr. Ramírez", t: "Coordinar con cliente los testigos para la próxima audiencia.", d: "hace 2 h" },
                { a: "LM", n: "Dra. Mendoza", t: "Revisar última resolución, observación procesal pendiente.", d: "ayer" },
              ].map((n, i) => (
                <div key={i} className="p-3 rounded-lg bg-muted/40 border border-border">
                  <div className="flex items-center gap-2">
                    <div className="grid h-6 w-6 place-items-center rounded-full bg-primary text-white text-[10px] font-bold">{n.a}</div>
                    <div className="text-xs font-semibold">{n.n}</div>
                    <div className="text-[10px] text-muted-foreground ml-auto">{n.d}</div>
                  </div>
                  <p className="text-xs text-foreground/80 mt-2">{n.t}</p>
                </div>
              ))}
              <textarea placeholder="Agregar nota interna..." className="w-full text-xs rounded-lg border border-border bg-card p-3 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none" rows={2} />
            </div>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}

function Field({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground uppercase tracking-wider">{k}</div>
      <div className={`text-sm font-medium ${mono ? "font-mono" : ""}`}>{v}</div>
    </div>
  );
}
