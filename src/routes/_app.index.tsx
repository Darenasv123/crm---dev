import { createFileRoute, Link } from "@tanstack/react-router";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { activities, cases, currency, monthlyIncome } from "@/lib/mock-data";
import {
  Users, Briefcase, CheckCircle2, AlertCircle, TrendingUp, ArrowUpRight, ArrowDownRight,
  CalendarClock, FileText, CreditCard, UserPlus, ScrollText, Gavel, Plus, ChevronRight,
} from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";

export const Route = createFileRoute("/_app/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Abogados a tu Servicio" },
      { name: "description", content: "Panel principal del CRM jurídico: KPIs, audiencias, ingresos y actividad reciente." },
    ],
  }),
  component: Dashboard,
});

const kpis = [
  { label: "Clientes registrados", value: "248", delta: "+12%", up: true, icon: Users, tone: "navy" as const },
  { label: "Casos activos", value: "64", delta: "+5%", up: true, icon: Briefcase, tone: "gold" as const },
  { label: "Casos finalizados", value: "182", delta: "+8%", up: true, icon: CheckCircle2, tone: "success" as const },
  { label: "Pagos pendientes", value: currency(18450), delta: "-3%", up: false, icon: AlertCircle, tone: "warning" as const },
  { label: "Ingresos del mes", value: currency(32400), delta: "+18%", up: true, icon: TrendingUp, tone: "info" as const },
];

const toneStyles: Record<string, string> = {
  navy: "bg-primary/10 text-primary",
  gold: "bg-[oklch(0.96_0.05_85)] text-[oklch(0.5_0.13_75)]",
  success: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  info: "bg-sky-50 text-sky-700",
};

function activityIcon(t: string) {
  switch (t) {
    case "hearing": return Gavel;
    case "payment": return CreditCard;
    case "document": return FileText;
    case "client": return UserPlus;
    case "case": return ScrollText;
    default: return ScrollText;
  }
}

function Dashboard() {
  const upcoming = cases.filter(c => c.nextHearing !== "—").slice(0, 4);
  const expiring = cases.filter(c => c.status !== "Archivado" && c.nextHearing !== "—").slice(0, 4);

  return (
    <AppLayout
      title="Buenos días, Dr. Carlos"
      subtitle="Resumen del estudio jurídico — Lunes, 29 de Junio 2026"
      actions={
        <button className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 transition shadow-soft">
          <Plus className="h-4 w-4" /> Nuevo Cliente
        </button>
      }
    >
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <Card key={k.label} className="p-5 hover:shadow-card transition-shadow">
              <div className="flex items-start justify-between">
                <div className={`grid h-10 w-10 place-items-center rounded-lg ${toneStyles[k.tone]}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${k.up ? "text-emerald-600" : "text-red-600"}`}>
                  {k.up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                  {k.delta}
                </span>
              </div>
              <div className="mt-4 text-2xl font-bold tracking-tight">{k.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{k.label}</div>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
        {/* Income chart */}
        <Card className="lg:col-span-2 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold">Ingresos mensuales</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Comparativa de ingresos vs pagos pendientes</p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary" /> Ingresos</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-gold" /> Pendiente</span>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthlyIncome} margin={{ top: 10, right: 8, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="gIn" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.34 0.09 255)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="oklch(0.34 0.09 255)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gPe" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.74 0.12 80)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="oklch(0.74 0.12 80)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.008 250)" vertical={false} />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "oklch(0.55 0.02 255)" }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "oklch(0.55 0.02 255)" }} tickFormatter={(v) => `S/${v / 1000}k`} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid oklch(0.92 0.008 250)", fontSize: 12 }} />
                <Area type="monotone" dataKey="income" stroke="oklch(0.34 0.09 255)" strokeWidth={2.5} fill="url(#gIn)" />
                <Area type="monotone" dataKey="pending" stroke="oklch(0.74 0.12 80)" strokeWidth={2} fill="url(#gPe)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Upcoming hearings */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold">Próximas audiencias</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Calendario judicial</p>
            </div>
            <Link to={"/agenda" as never} className="text-xs font-semibold text-primary hover:underline">Ver todo</Link>
          </div>
          <div className="space-y-3">
            {upcoming.map((c) => (
              <div key={c.id} className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/30 hover:bg-muted/30 transition cursor-pointer">
                <div className="grid place-items-center h-12 w-12 rounded-lg bg-primary/5 text-primary border border-primary/10">
                  <div className="text-center leading-tight">
                    <div className="text-[10px] font-semibold uppercase">{new Date(c.nextHearing).toLocaleDateString("es-PE", { month: "short" })}</div>
                    <div className="text-base font-bold">{new Date(c.nextHearing).getDate()}</div>
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate">{c.client}</div>
                  <div className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
                    <CalendarClock className="h-3 w-3" /> {c.nextHearing.split(" ")[1]} · {c.processType}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
        {/* Activities */}
        <Card className="lg:col-span-2 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold">Actividad reciente</h3>
            <button className="text-xs font-semibold text-primary hover:underline">Ver historial</button>
          </div>
          <ol className="relative space-y-4 ml-2">
            {activities.map((a, i) => {
              const Icon = activityIcon(a.type);
              return (
                <li key={a.id} className="relative pl-9">
                  {i !== activities.length - 1 && <span className="absolute left-3 top-8 bottom-[-1rem] w-px bg-border" />}
                  <div className="absolute left-0 top-0.5 grid h-6 w-6 place-items-center rounded-full bg-primary/10 text-primary border border-primary/20">
                    <Icon className="h-3 w-3" />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold">{a.title}</div>
                    <div className="text-[11px] text-muted-foreground shrink-0">{a.time}</div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{a.description}</p>
                </li>
              );
            })}
          </ol>
        </Card>

        {/* Cases about to expire */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold">Casos próximos a vencer</h3>
          </div>
          <div className="space-y-3">
            {expiring.map((c) => (
              <div key={c.id} className="p-3 rounded-lg border border-border bg-amber-50/40">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold truncate">{c.client}</div>
                  <StatusBadge tone={c.priority === "Alta" ? "danger" : c.priority === "Media" ? "warning" : "info"}>
                    {c.priority}
                  </StatusBadge>
                </div>
                <div className="text-[11px] text-muted-foreground font-mono mt-1 truncate">{c.expediente}</div>
                <div className="flex items-center justify-between mt-2 text-xs">
                  <span className="text-muted-foreground">{c.processType}</span>
                  <span className="font-semibold text-primary">{c.nextHearing}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </AppLayout>
  );
}
