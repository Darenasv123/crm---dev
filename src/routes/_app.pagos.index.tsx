import { createFileRoute } from "@tanstack/react-router";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { currency, paymentHistory, payments } from "@/lib/mock-data";
import { Plus, Download, Receipt, CreditCard, Banknote, Smartphone, FileText } from "lucide-react";

export const Route = createFileRoute("/_app/pagos/")({
  head: () => ({ meta: [{ title: "Pagos — CRM Jurídico" }] }),
  component: PaymentsPage,
});

function PaymentsPage() {
  const total = payments.reduce((s, p) => s + p.fees, 0);
  const collected = payments.reduce((s, p) => s + p.paid, 0);
  const pending = total - collected;

  return (
    <AppLayout
      title="Módulo de Pagos"
      subtitle="Honorarios, cobranzas y vencimientos"
      actions={
        <>
          <button className="inline-flex items-center gap-2 h-10 px-3 rounded-lg border border-border text-sm font-medium hover:bg-muted/60">
            <Download className="h-4 w-4" /> Exportar
          </button>
          <button className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 shadow-soft">
            <Plus className="h-4 w-4" /> Registrar pago
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <KPI icon={Receipt} label="Honorarios totales" value={currency(total)} tone="navy" />
        <KPI icon={CreditCard} label="Cobrado" value={currency(collected)} tone="success" />
        <KPI icon={Banknote} label="Por cobrar" value={currency(pending)} tone="warning" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h3 className="text-base font-semibold">Estado de cuentas por cliente</h3>
            <span className="text-xs text-muted-foreground">{payments.length} registros</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-3 pl-5 pr-3 font-semibold">Cliente</th>
                  <th className="py-3 px-3 font-semibold">Servicio</th>
                  <th className="py-3 px-3 font-semibold">Honorarios</th>
                  <th className="py-3 px-3 font-semibold">Progreso</th>
                  <th className="py-3 px-3 font-semibold">Saldo</th>
                  <th className="py-3 px-3 font-semibold">Estado</th>
                  <th className="py-3 pr-5 font-semibold">Vencimiento</th>
                </tr>
              </thead>
              <tbody>
                {payments.map(p => {
                  const pct = Math.round((p.paid / p.fees) * 100);
                  const balance = p.fees - p.paid;
                  return (
                    <tr key={p.id} className="border-t border-border hover:bg-muted/30">
                      <td className="py-3 pl-5 pr-3 font-semibold">{p.client}</td>
                      <td className="py-3 px-3 text-muted-foreground">{p.service}</td>
                      <td className="py-3 px-3 font-semibold">{currency(p.fees)}</td>
                      <td className="py-3 px-3 w-[180px]">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full bg-gradient-to-r from-primary to-[oklch(0.5_0.14_255)]" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-[11px] font-semibold tabular-nums w-9 text-right">{pct}%</span>
                        </div>
                      </td>
                      <td className="py-3 px-3 font-semibold tabular-nums">{currency(balance)}</td>
                      <td className="py-3 px-3">
                        <StatusBadge tone={p.status === "Pagado" ? "success" : p.status === "Parcial" ? "warning" : p.status === "Vencido" ? "danger" : "info"}>
                          {p.status}
                        </StatusBadge>
                      </td>
                      <td className="py-3 pr-5 text-xs text-muted-foreground">{new Date(p.dueDate).toLocaleDateString("es-PE", { day: "2-digit", month: "short" })}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold">Historial de pagos</h3>
            <span className="text-xs text-muted-foreground">M. F. López</span>
          </div>
          <div className="rounded-xl bg-gradient-to-br from-primary to-[oklch(0.28_0.07_255)] text-white p-5">
            <div className="text-xs text-white/70">Honorarios del caso</div>
            <div className="text-2xl font-bold mt-1">{currency(8500)}</div>
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-white/80">Pagado {currency(5500)}</span>
                <span className="font-semibold">65%</span>
              </div>
              <div className="h-2 rounded-full bg-white/15 overflow-hidden">
                <div className="h-full rounded-full bg-gold" style={{ width: "65%" }} />
              </div>
              <div className="mt-1.5 text-[11px] text-white/70">Saldo pendiente: {currency(3000)}</div>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {paymentHistory.map(h => {
              const Icon = h.method.includes("Yape") ? Smartphone : h.method.includes("Efectivo") ? Banknote : CreditCard;
              return (
                <div key={h.id} className="flex items-center gap-3 p-3 rounded-lg border border-border">
                  <div className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-50 text-emerald-600"><Icon className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{currency(h.amount)}</div>
                    <div className="text-[11px] text-muted-foreground">{h.method} · {new Date(h.date).toLocaleDateString("es-PE")}</div>
                  </div>
                  <button className="h-8 px-2 rounded-md text-[11px] font-semibold text-primary hover:bg-primary/10 flex items-center gap-1">
                    <FileText className="h-3 w-3" /> {h.receipt}
                  </button>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </AppLayout>
  );
}

function KPI({ icon: Icon, label, value, tone }: { icon: typeof Receipt; label: string; value: string; tone: "navy" | "success" | "warning" }) {
  const tones = {
    navy: "bg-primary/10 text-primary",
    success: "bg-emerald-50 text-emerald-700",
    warning: "bg-amber-50 text-amber-700",
  };
  return (
    <Card className="p-5 flex items-center gap-4">
      <div className={`grid h-12 w-12 place-items-center rounded-xl ${tones[tone]}`}><Icon className="h-6 w-6" /></div>
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold tracking-tight">{value}</div>
      </div>
    </Card>
  );
}
