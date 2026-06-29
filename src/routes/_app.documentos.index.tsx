import { createFileRoute } from "@tanstack/react-router";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { documents } from "@/lib/mock-data";
import { FileText, Folder, Search, Upload, Download, Eye, MoreVertical, Filter } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/_app/documentos/")({
  head: () => ({ meta: [{ title: "Documentos — CRM Jurídico" }] }),
  component: DocsPage,
});

const folders = [
  { name: "DNI", count: 32, color: "oklch(0.55 0.13 235)" },
  { name: "Demandas", count: 24, color: "oklch(0.34 0.09 255)" },
  { name: "Resoluciones", count: 41, color: "oklch(0.74 0.12 80)" },
  { name: "Sentencias", count: 18, color: "oklch(0.62 0.14 155)" },
  { name: "Poderes", count: 14, color: "oklch(0.62 0.18 25)" },
  { name: "Contratos", count: 22, color: "oklch(0.55 0.13 290)" },
  { name: "Otros PDF", count: 56, color: "oklch(0.55 0.02 255)" },
];

function DocsPage() {
  const [selected, setSelected] = useState(documents[0]);

  return (
    <AppLayout
      title="Documentos"
      subtitle="Explorador de archivos del estudio"
      actions={
        <button className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 shadow-soft">
          <Upload className="h-4 w-4" /> Subir archivo
        </button>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_360px] gap-4">
        {/* Folders */}
        <Card className="p-4 h-fit">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Categorías</div>
          <div className="space-y-1">
            {folders.map((f, i) => (
              <button key={f.name} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition ${i === 0 ? "bg-primary/10 text-primary font-semibold" : "hover:bg-muted/50"}`}>
                <Folder className="h-4 w-4" style={{ color: f.color }} />
                <span className="flex-1 text-left">{f.name}</span>
                <span className="text-[11px] text-muted-foreground">{f.count}</span>
              </button>
            ))}
          </div>
        </Card>

        {/* File list */}
        <Card className="overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input placeholder="Buscar archivo..." className="w-full h-9 pl-9 pr-3 rounded-lg bg-muted/40 border border-transparent focus:bg-card focus:border-primary focus:outline-none text-sm" />
            </div>
            <button className="h-9 px-3 rounded-lg border border-border text-xs font-medium hover:bg-muted/60 inline-flex items-center gap-1.5"><Filter className="h-3.5 w-3.5" /> Filtros</button>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-muted-foreground bg-muted/30"><th className="py-2.5 pl-4">Nombre</th><th className="py-2.5 px-3">Tipo</th><th className="py-2.5 px-3">Cliente</th><th className="py-2.5 px-3">Tamaño</th><th className="py-2.5 pr-4 text-right">Acciones</th></tr></thead>
            <tbody>
              {documents.map(d => (
                <tr key={d.id} onClick={() => setSelected(d)} className={`border-t border-border cursor-pointer transition ${selected.id === d.id ? "bg-primary/5" : "hover:bg-muted/30"}`}>
                  <td className="py-3 pl-4">
                    <div className="flex items-center gap-3">
                      <div className="grid h-9 w-9 place-items-center rounded-lg bg-red-50 text-red-600"><FileText className="h-4 w-4" /></div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{d.name}</div>
                        <div className="text-[11px] text-muted-foreground">{new Date(d.uploadedAt).toLocaleDateString("es-PE")}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-3"><StatusBadge tone="navy">{d.type}</StatusBadge></td>
                  <td className="py-3 px-3 text-muted-foreground">{d.client}</td>
                  <td className="py-3 px-3 text-muted-foreground">{d.size}</td>
                  <td className="py-3 pr-4 text-right">
                    <button className="h-8 w-8 grid place-items-center rounded-md hover:bg-muted inline-flex"><Eye className="h-4 w-4 text-muted-foreground" /></button>
                    <button className="h-8 w-8 grid place-items-center rounded-md hover:bg-muted inline-flex"><Download className="h-4 w-4 text-muted-foreground" /></button>
                    <button className="h-8 w-8 grid place-items-center rounded-md hover:bg-muted inline-flex"><MoreVertical className="h-4 w-4 text-muted-foreground" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* Preview */}
        <Card className="p-5 h-fit">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">Vista previa</div>
          <div className="aspect-[3/4] rounded-lg border border-border bg-gradient-to-b from-muted/40 to-muted/10 grid place-items-center relative overflow-hidden">
            <div className="absolute inset-4 bg-card rounded shadow-soft p-4 text-[8px] leading-relaxed text-muted-foreground space-y-1.5 overflow-hidden">
              <div className="text-center font-bold text-primary text-[10px]">PODER JUDICIAL DEL PERÚ</div>
              <div className="text-center text-[7px]">Corte Superior de Justicia de Lima</div>
              <div className="h-px bg-border my-2" />
              <div><strong>Expediente:</strong> 00231-2025</div>
              <div><strong>Juzgado:</strong> 3° de Familia</div>
              <div><strong>Materia:</strong> Divorcio</div>
              <div className="h-px bg-border my-2" />
              <div className="space-y-1">{Array.from({ length: 14 }).map((_, i) => <div key={i} className="h-1 rounded bg-muted/60" style={{ width: `${60 + Math.random() * 35}%` }} />)}</div>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <div className="text-sm font-semibold truncate">{selected.name}</div>
            <div className="text-xs text-muted-foreground">{selected.type} · {selected.size}</div>
            <div className="text-xs text-muted-foreground">Cliente: {selected.client}</div>
            <div className="text-xs text-muted-foreground">Subido: {new Date(selected.uploadedAt).toLocaleDateString("es-PE")}</div>
          </div>
          <div className="mt-4 flex gap-2">
            <button className="flex-1 h-9 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:brightness-110 inline-flex items-center justify-center gap-1.5"><Eye className="h-3.5 w-3.5" /> Abrir</button>
            <button className="h-9 px-3 rounded-lg border border-border text-xs font-semibold hover:bg-muted/60 inline-flex items-center gap-1.5"><Download className="h-3.5 w-3.5" /> Descargar</button>
          </div>
        </Card>
      </div>
    </AppLayout>
  );
}
