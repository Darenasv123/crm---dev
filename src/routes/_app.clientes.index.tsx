import { createFileRoute, Link } from "@tanstack/react-router";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { clients } from "@/lib/mock-data";
import { Search, Filter, Download, Plus, ChevronDown, Eye } from "lucide-react";

export const Route = createFileRoute("/_app/clientes/")({
  head: () => ({
    meta: [
      { title: "Clientes — CRM Jurídico" },
      { name: "description", content: "Gestión de clientes del estudio: registro, estado y casos asociados." },
    ],
  }),
  component: ClientsPage,
});

function ClientsPage() {
  return (
    <AppLayout
      title="Gestión de Clientes"
      subtitle={`${clients.length} clientes registrados · 6 activos esta semana`}
      actions={
        <>
          <button className="inline-flex items-center gap-2 h-10 px-3 rounded-lg bg-card border border-border text-sm font-medium hover:bg-muted/60 transition">
            <Download className="h-4 w-4" /> Exportar
          </button>
          <button className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 transition shadow-soft">
            <Plus className="h-4 w-4" /> Nuevo Cliente
          </button>
        </>
      }
    >
      {/* Filters */}
      <Card className="p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              placeholder="Buscar por nombre, DNI o correo..."
              className="w-full h-10 pl-10 pr-3 rounded-lg bg-muted/40 border border-border focus:bg-card focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 text-sm"
            />
          </div>
          <FilterSelect label="Estado" options={["Todos", "Activo", "En espera", "Cerrado"]} />
          <FilterSelect label="Tipo de caso" options={["Todos", "Familia", "Civil", "Penal", "Laboral", "Comercial"]} />
          <FilterSelect label="Fecha" options={["Cualquier fecha", "Últimos 30 días", "Este año"]} />
          <button className="inline-flex items-center gap-2 h-10 px-3 rounded-lg border border-border text-sm hover:bg-muted/60 transition">
            <Filter className="h-4 w-4" /> Más filtros
          </button>
        </div>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="py-3 pl-5 pr-3 font-semibold">Cliente</th>
                <th className="py-3 px-3 font-semibold">DNI / RUC</th>
                <th className="py-3 px-3 font-semibold">Teléfono</th>
                <th className="py-3 px-3 font-semibold">Tipo de proceso</th>
                <th className="py-3 px-3 font-semibold">Estado</th>
                <th className="py-3 px-3 font-semibold">Fecha de registro</th>
                <th className="py-3 px-3 font-semibold">Abogado asignado</th>
                <th className="py-3 pr-5 font-semibold text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id} className="border-t border-border hover:bg-muted/30 transition">
                  <td className="py-3 pl-5 pr-3">
                    <div className="flex items-center gap-3">
                      <div className="grid h-9 w-9 place-items-center rounded-full text-xs font-bold text-white shrink-0" style={{ background: c.color }}>{c.initials}</div>
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{c.name}</div>
                        <div className="text-xs text-muted-foreground truncate">{c.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-3 font-mono text-xs">{c.dni}</td>
                  <td className="py-3 px-3 text-muted-foreground">{c.phone}</td>
                  <td className="py-3 px-3">{c.processType}</td>
                  <td className="py-3 px-3">
                    <StatusBadge tone={c.status === "Activo" ? "success" : c.status === "En espera" ? "warning" : "default"}>
                      <span className={`h-1.5 w-1.5 rounded-full ${c.status === "Activo" ? "bg-emerald-500" : c.status === "En espera" ? "bg-amber-500" : "bg-muted-foreground"}`} />
                      {c.status}
                    </StatusBadge>
                  </td>
                  <td className="py-3 px-3 text-muted-foreground">{new Date(c.registeredAt).toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" })}</td>
                  <td className="py-3 px-3">{c.lawyer}</td>
                  <td className="py-3 pr-5 text-right">
                    <Link to={"/clientes/$id" as never} params={{ id: c.id } as never} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary/10 text-primary text-xs font-semibold hover:bg-primary hover:text-primary-foreground transition">
                      <Eye className="h-3.5 w-3.5" /> Ver ficha
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-t border-border text-xs text-muted-foreground">
          <span>Mostrando 1–{clients.length} de 248 clientes</span>
          <div className="flex items-center gap-1">
            <button className="h-8 px-3 rounded-md border border-border hover:bg-muted/60">Anterior</button>
            <button className="h-8 w-8 rounded-md bg-primary text-primary-foreground font-semibold">1</button>
            <button className="h-8 w-8 rounded-md border border-border hover:bg-muted/60">2</button>
            <button className="h-8 w-8 rounded-md border border-border hover:bg-muted/60">3</button>
            <button className="h-8 px-3 rounded-md border border-border hover:bg-muted/60">Siguiente</button>
          </div>
        </div>
      </Card>
    </AppLayout>
  );
}

function FilterSelect({ label, options }: { label: string; options: string[] }) {
  return (
    <div className="relative">
      <select className="h-10 pl-3 pr-9 rounded-lg bg-card border border-border text-sm font-medium appearance-none focus:outline-none focus:ring-2 focus:ring-primary/20 cursor-pointer hover:border-primary/40 transition">
        {options.map(o => <option key={o}>{label === "Estado" ? o : `${label}: ${o}`}</option>)}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
    </div>
  );
}
