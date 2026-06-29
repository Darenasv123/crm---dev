import { createFileRoute } from "@tanstack/react-router";
import { AppLayout, Card } from "@/components/app-layout";
import { casesBySpecialty, clientsByMonth, currency, monthlyIncome } from "@/lib/mock-data";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, Legend, Line, LineChart } from "recharts";
import { Download, TrendingUp, Users, Briefcase, CheckCircle2, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/_app/reportes/")({
  head: () => ({ meta: [{ title: "Reportes — CRM Jurídico" }] }),
  component: ReportsPage,
});

const colors = ["oklch(0.34 0.09 255)", "oklch(0.74 0.12 80)", "oklch(0.55 0.13 235)", "oklch(0.62 0.14 155)", "oklch(0.62 0.18 25)", "oklch(0.55 0.13 290)"];

function ReportsPage() {
  return (
    <AppLayout
      title="Reportes y Analítica"
      subtitle="Indicadores clave del estudio jurídico"
      actions={
        <button className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 shadow-soft">
          <Download className="h-4 w-4" /> Descargar PDF
        </button>
      }
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Mini icon={Users} label="Nuevos clientes" value="43" delta="+22%" tone="navy" />
        <Mini icon={Briefcase} label="Casos activos" value="64" delta="+5%" tone="gold" />
        <Mini icon={CheckCircle2} label="Casos finalizados" value="182" delta="+12%" tone="success" />
        <Mini icon={AlertCircle} label="Pagos pendientes" value={currency(18450)} delta="-3%" tone="warning" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-6">
          <h3 className="text-base font-semibold mb-1">Clientes registrados por mes</h3>
          <p className="text-xs text-muted-foreground mb-4">Crecimiento de cartera 2026</p>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={clientsByMonth}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.008 250)" vertical={false} />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 11 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                <Bar dataKey="value" fill="oklch(0.34 0.09 255)" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="text-base font-semibold mb-1">Casos por especialidad</h3>
          <p className="text-xs text-muted-foreground mb-4">Distribución actual del portafolio</p>
          <div className="h-64">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={casesBySpecialty} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                  {casesBySpecialty.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6 lg:col-span-2">
          <h3 className="text-base font-semibold mb-1">Ingresos mensuales vs pagos pendientes</h3>
          <p className="text-xs text-muted-foreground mb-4">Tendencia financiera</p>
          <div className="h-72">
            <ResponsiveContainer>
              <LineChart data={monthlyIncome}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.008 250)" vertical={false} />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 11 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11 }} tickFormatter={(v) => `S/${v/1000}k`} />
                <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="income" name="Ingresos" stroke="oklch(0.34 0.09 255)" strokeWidth={3} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="pending" name="Pendiente" stroke="oklch(0.74 0.12 80)" strokeWidth={3} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="text-base font-semibold mb-1">Casos finalizados vs activos</h3>
          <p className="text-xs text-muted-foreground mb-4">Comparativa anual</p>
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={[
                { m: "Q1", finalizados: 38, activos: 22 },
                { m: "Q2", finalizados: 52, activos: 28 },
                { m: "Q3", finalizados: 47, activos: 31 },
                { m: "Q4", finalizados: 45, activos: 34 },
              ]}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.008 250)" vertical={false} />
                <XAxis dataKey="m" axisLine={false} tickLine={false} tick={{ fontSize: 11 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="finalizados" fill="oklch(0.62 0.14 155)" radius={[6, 6, 0, 0]} />
                <Bar dataKey="activos" fill="oklch(0.34 0.09 255)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="text-base font-semibold mb-1">Pagos pendientes por antigüedad</h3>
          <p className="text-xs text-muted-foreground mb-4">Aging de cobranza</p>
          <div className="space-y-3 mt-6">
            {[
              { label: "0–30 días", value: 8200, pct: 45, color: "oklch(0.62 0.14 155)" },
              { label: "31–60 días", value: 5400, pct: 30, color: "oklch(0.74 0.12 80)" },
              { label: "61–90 días", value: 3100, pct: 17, color: "oklch(0.62 0.18 60)" },
              { label: "+90 días", value: 1750, pct: 8, color: "oklch(0.62 0.22 27)" },
            ].map(r => (
              <div key={r.label}>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="font-medium">{r.label}</span>
                  <span className="font-semibold tabular-nums">{currency(r.value)}</span>
                </div>
                <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${r.pct}%`, background: r.color }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </AppLayout>
  );
}

function Mini({ icon: Icon, label, value, delta, tone }: { icon: typeof Users; label: string; value: string; delta: string; tone: "navy" | "gold" | "success" | "warning" }) {
  const tones = {
    navy: "bg-primary/10 text-primary",
    gold: "bg-[oklch(0.96_0.05_85)] text-[oklch(0.5_0.13_75)]",
    success: "bg-emerald-50 text-emerald-700",
    warning: "bg-amber-50 text-amber-700",
  };
  const up = delta.startsWith("+");
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div className={`grid h-10 w-10 place-items-center rounded-lg ${tones[tone]}`}><Icon className="h-5 w-5" /></div>
        <span className={`text-xs font-semibold flex items-center gap-0.5 ${up ? "text-emerald-600" : "text-red-600"}`}>
          <TrendingUp className={`h-3.5 w-3.5 ${up ? "" : "rotate-180"}`} /> {delta}
        </span>
      </div>
      <div className="mt-4 text-2xl font-bold tracking-tight">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </Card>
  );
}
