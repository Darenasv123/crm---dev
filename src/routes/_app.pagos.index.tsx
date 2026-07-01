import { createFileRoute } from "@tanstack/react-router";
import { AppLayout, Card, StatusBadge } from "@/components/app-layout";
import { usePayments, useCreatePayment, useRegisterPayment } from "@/hooks/use-payments";
import { useClients } from "@/hooks/use-clients";
import { supabase } from "@/lib/supabase";
import { exportPaymentsExcel } from "@/lib/export-excel";
import { Plus, Download, Receipt, CreditCard, Banknote, X, CheckCircle2, Loader2, Paperclip, FileText } from "lucide-react";
import { useState, useRef } from "react";

export const Route = createFileRoute("/_app/pagos/")({
  head: () => ({ meta: [{ title: "Pagos — CRM Jurídico" }] }),
  component: PaymentsPage,
});

function currency(n: number) {
  return new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN", maximumFractionDigits: 0 }).format(n);
}

type ModalMode = "new" | "register" | null;

function PaymentsPage() {
  const { data: payments = [], isLoading } = usePayments();
  const { data: clients = [] } = useClients();
  const createPayment = useCreatePayment();
  const registerPayment = useRegisterPayment();

  const [modal, setModal] = useState<ModalMode>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // New payment form
  const [newForm, setNewForm] = useState({ client_id: "", service: "", fees: "", total_installments: "1" });

  // Register payment form
  const [regForm, setRegForm] = useState({ amount: "", method: "Transferencia bancaria", notes: "" });
  const [voucherFile, setVoucherFile] = useState<File | null>(null);
  const voucherRef = useRef<HTMLInputElement>(null);

  const total = payments.reduce((s, p) => s + Number(p.fees), 0);
  const collected = payments.reduce((s, p) => s + Number(p.paid), 0);
  const pending = total - collected;

  const selectedPayment = payments.find(p => p.id === selectedId);

  async function handleNewPayment(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      await createPayment.mutateAsync({
        client_id: newForm.client_id,
        service: newForm.service,
        fees: parseFloat(newForm.fees),
        total_installments: parseInt(newForm.total_installments),
      });
      setModal(null);
      setNewForm({ client_id: "", service: "", fees: "", total_installments: "1" });
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Error al guardar.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRegisterPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPayment) return;
    setFormError(null);
    setSaving(true);

    const amount = parseFloat(regForm.amount);
    const remaining = Number(selectedPayment.fees) - Number(selectedPayment.paid);

    // Hard cap: cannot pay more than the outstanding balance
    if (amount <= 0) {
      setFormError("El monto debe ser mayor a 0.");
      setSaving(false);
      return;
    }
    if (amount > remaining) {
      setFormError(`El monto excede el saldo pendiente (${currency(remaining)}). El máximo permitido es el 100% del saldo.`);
      setSaving(false);
      return;
    }

    const newPaid = Number(selectedPayment.paid) + amount;
    const newPaidInstallments = Math.min(selectedPayment.paid_installments + 1, selectedPayment.total_installments);
    const newStatus = newPaid >= Number(selectedPayment.fees) ? "Pagado" : "Parcial" as const;

    // Upload voucher file if provided
    let voucherPath: string | null = null;
    if (voucherFile) {
      const safeName = voucherFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `vouchers/${Date.now()}_${safeName}`;
      const { error: upErr } = await supabase.storage.from("documents").upload(path, voucherFile, { upsert: false });
      if (upErr) {
        setFormError(`Error al subir el comprobante: ${upErr.message}`);
        setSaving(false);
        return;
      }
      voucherPath = path;
    }

    try {
      await registerPayment.mutateAsync({
        paymentId: selectedPayment.id,
        record: { amount, method: regForm.method, receipt: voucherPath, notes: regForm.notes || null },
        newPaid,
        newPaidInstallments,
        newStatus,
      });
      setModal(null);
      setRegForm({ amount: "", method: "Transferencia bancaria", notes: "" });
      setVoucherFile(null);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Error al registrar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppLayout
      title="Módulo de Pagos"
      subtitle="Honorarios y seguimiento de cuotas"
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportPaymentsExcel(payments.map(p => ({
              client: p.clients?.name ?? "—",
              service: p.service,
              fees: Number(p.fees),
              paid: Number(p.paid),
              pending: Number(p.fees) - Number(p.paid),
              total_installments: p.total_installments,
              paid_installments: p.paid_installments,
              status: p.status,
              created_at: p.created_at,
            })))}
            className="inline-flex items-center gap-2 h-10 px-3 rounded-lg border border-border text-sm font-medium hover:bg-muted/60 transition"
          >
            <Download className="h-4 w-4" /> Excel
          </button>
          <button
            onClick={() => { setModal("new"); setFormError(null); }}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 shadow-soft"
          >
            <Plus className="h-4 w-4" /> Nuevo pago
          </button>
        </div>
      }
    >
      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <KPI icon={Receipt} label="Honorarios totales" value={currency(total)} tone="navy" />
        <KPI icon={CreditCard} label="Cobrado" value={currency(collected)} tone="success" />
        <KPI icon={Banknote} label="Por cobrar" value={currency(pending)} tone="warning" />
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-base font-semibold">Estado de cuentas por cliente</h3>
          <span className="text-xs text-muted-foreground">{payments.length} registros</span>
        </div>
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-3 pl-5 pr-3 font-semibold">Cliente</th>
                  <th className="py-3 px-3 font-semibold">Servicio</th>
                  <th className="py-3 px-3 font-semibold">Honorarios</th>
                  <th className="py-3 px-3 font-semibold">Progreso</th>
                  <th className="py-3 px-3 font-semibold">Cuotas</th>
                  <th className="py-3 px-3 font-semibold">Estado</th>
                  <th className="py-3 pr-5 font-semibold text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {payments.length === 0 ? (
                  <tr><td colSpan={7} className="py-12 text-center text-sm text-muted-foreground">Aún no hay pagos registrados.</td></tr>
                ) : payments.map(p => {
                  const pct = Math.round((Number(p.paid) / Number(p.fees)) * 100);
                  return (
                    <tr key={p.id} className="border-t border-border hover:bg-muted/30">
                      <td className="py-3 pl-5 pr-3 font-semibold">{p.clients?.name ?? "—"}</td>
                      <td className="py-3 px-3 text-muted-foreground">{p.service}</td>
                      <td className="py-3 px-3 font-semibold tabular-nums">{currency(Number(p.fees))}</td>
                      <td className="py-3 px-3 w-[160px]">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                            <div className="h-full rounded-full bg-gradient-to-r from-primary to-[oklch(0.5_0.14_255)]" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-[11px] font-semibold tabular-nums w-9 text-right">{pct}%</span>
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          Pagado: {currency(Number(p.paid))} · Saldo: {currency(Number(p.fees) - Number(p.paid))}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-1 flex-wrap">
                          {Array.from({ length: Math.min(p.total_installments, 12) }).map((_, i) => (
                            <div key={i} className={`h-4 w-4 rounded-sm border text-[9px] grid place-items-center font-bold
                              ${i < p.paid_installments ? "bg-emerald-500 border-emerald-600 text-white" : "bg-muted border-border text-muted-foreground"}`}>
                              {i < p.paid_installments ? <CheckCircle2 className="h-2.5 w-2.5" /> : i + 1}
                            </div>
                          ))}
                          {p.total_installments > 12 && <span className="text-[10px] text-muted-foreground">+{p.total_installments - 12}</span>}
                          <span className="text-[11px] text-muted-foreground ml-1">{p.paid_installments}/{p.total_installments}</span>
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <StatusBadge tone={p.status === "Pagado" ? "success" : p.status === "Parcial" ? "warning" : p.status === "Vencido" ? "danger" : "info"}>
                          {p.status}
                        </StatusBadge>
                      </td>
                      <td className="py-3 pr-5 text-right">
                        {p.status === "Pagado" ? (
                          <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-emerald-50 text-emerald-700 text-xs font-semibold">
                            <CheckCircle2 className="h-3 w-3" /> Saldado
                          </span>
                        ) : (
                          <button
                            onClick={() => { setSelectedId(p.id); setModal("register"); setFormError(null); }}
                            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary/10 text-primary text-xs font-semibold hover:bg-primary hover:text-primary-foreground transition"
                          >
                            <Plus className="h-3 w-3" /> Registrar pago
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* New Payment Modal */}
      {modal === "new" && (
        <ModalWrapper title="Nuevo pago" onClose={() => setModal(null)}>
          <form onSubmit={handleNewPayment} className="space-y-4">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Cliente *</label>
              <select value={newForm.client_id} onChange={e => setNewForm(f => ({ ...f, client_id: e.target.value }))} required
                className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none text-sm">
                <option value="">Seleccionar cliente...</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <PF label="Servicio / descripción *" value={newForm.service} onChange={v => setNewForm(f => ({ ...f, service: v }))} required />
            <div className="grid grid-cols-2 gap-4">
              <PF label="Honorarios totales (S/) *" value={newForm.fees} onChange={v => setNewForm(f => ({ ...f, fees: v }))} type="number" required />
              <PF label="N° de cuotas *" value={newForm.total_installments} onChange={v => setNewForm(f => ({ ...f, total_installments: v }))} type="number" required />
            </div>
            {formError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</p>}
            <ModalActions onCancel={() => setModal(null)} saving={saving} label="Guardar" />
          </form>
        </ModalWrapper>
      )}

      {/* Register Payment Modal */}
      {modal === "register" && selectedPayment && (
        <ModalWrapper title="Registrar pago" onClose={() => { setModal(null); setVoucherFile(null); }}>
          <div className="rounded-lg bg-muted/40 px-4 py-3 text-sm mb-4">
            <div className="font-semibold">{selectedPayment.clients?.name ?? "—"}</div>
            <div className="text-xs text-muted-foreground">
              {selectedPayment.service} · Saldo pendiente: <span className="font-semibold text-foreground">{currency(Number(selectedPayment.fees) - Number(selectedPayment.paid))}</span>
            </div>
          </div>
          <form onSubmit={handleRegisterPayment} className="space-y-4">
            {/* Amount — capped at remaining balance */}
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Monto del abono (S/) *
              </label>
              <input
                type="number"
                value={regForm.amount}
                min="0.01"
                step="0.01"
                max={Number(selectedPayment.fees) - Number(selectedPayment.paid)}
                onChange={e => {
                  const val = parseFloat(e.target.value);
                  const max = Number(selectedPayment.fees) - Number(selectedPayment.paid);
                  // Clamp to max in real-time so the field never exceeds the balance
                  if (!isNaN(val) && val > max) {
                    setRegForm(f => ({ ...f, amount: String(max) }));
                  } else {
                    setRegForm(f => ({ ...f, amount: e.target.value }));
                  }
                }}
                required
                className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-sm"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Máximo: {currency(Number(selectedPayment.fees) - Number(selectedPayment.paid))} (100% del saldo)
              </p>
            </div>

            {/* Payment method */}
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Método de pago</label>
              <select value={regForm.method} onChange={e => setRegForm(f => ({ ...f, method: e.target.value }))}
                className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none text-sm">
                <option>Transferencia bancaria</option>
                <option>Yape / Plin</option>
                <option>Efectivo</option>
                <option>Tarjeta</option>
              </select>
            </div>

            {/* Voucher file attachment */}
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Comprobante (opcional)
              </label>
              <div
                onClick={() => voucherRef.current?.click()}
                className={`mt-1.5 flex items-center gap-3 h-11 px-3 rounded-lg border-2 border-dashed cursor-pointer transition text-sm
                  ${voucherFile ? "border-primary/40 bg-primary/5 text-primary" : "border-border hover:border-primary/40 hover:bg-muted/30 text-muted-foreground"}`}
              >
                {voucherFile ? (
                  <>
                    <FileText className="h-4 w-4 shrink-0" />
                    <span className="truncate font-medium">{voucherFile.name}</span>
                    <button
                      type="button"
                      onClick={ev => { ev.stopPropagation(); setVoucherFile(null); }}
                      className="ml-auto h-5 w-5 grid place-items-center rounded hover:bg-primary/20"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </>
                ) : (
                  <>
                    <Paperclip className="h-4 w-4 shrink-0" />
                    <span>Adjuntar imagen o documento</span>
                  </>
                )}
              </div>
              <input
                ref={voucherRef}
                type="file"
                className="hidden"
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar"
                onChange={e => setVoucherFile(e.target.files?.[0] ?? null)}
              />
            </div>

            {/* Notes */}
            <PF label="Notas (opcional)" value={regForm.notes} onChange={v => setRegForm(f => ({ ...f, notes: v }))} />

            {formError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formError}</p>}
            <ModalActions onCancel={() => { setModal(null); setVoucherFile(null); }} saving={saving} label="Registrar abono" />
          </form>
        </ModalWrapper>
      )}
    </AppLayout>
  );
}

function KPI({ icon: Icon, label, value, tone }: { icon: typeof Receipt; label: string; value: string; tone: "navy" | "success" | "warning" }) {
  const tones = { navy: "bg-primary/10 text-primary", success: "bg-emerald-50 text-emerald-700", warning: "bg-amber-50 text-amber-700" };
  return (
    <Card className="p-5 flex items-center gap-4">
      <div className={`grid h-12 w-12 place-items-center rounded-xl ${tones[tone]}`}><Icon className="h-6 w-6" /></div>
      <div><div className="text-xs text-muted-foreground">{label}</div><div className="text-2xl font-bold tracking-tight">{value}</div></div>
    </Card>
  );
}

function ModalWrapper({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <Card className="w-full max-w-md p-6 shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="h-8 w-8 grid place-items-center rounded-lg hover:bg-muted/60"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </Card>
    </div>
  );
}

function ModalActions({ onCancel, saving, label }: { onCancel: () => void; saving: boolean; label: string }) {
  return (
    <div className="flex gap-3 pt-2">
      <button type="button" onClick={onCancel} className="flex-1 h-10 rounded-lg border border-border text-sm font-medium hover:bg-muted/60">Cancelar</button>
      <button type="submit" disabled={saving} className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:brightness-110 disabled:opacity-60 flex items-center justify-center gap-2">
        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        {saving ? "Guardando..." : label}
      </button>
    </div>
  );
}

function PF({ label, value, onChange, required, type = "text" }: { label: string; value: string; onChange: (v: string) => void; required?: boolean; type?: string }) {
  return (
    <div>
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} required={required}
        className="mt-1.5 w-full h-10 px-3 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary text-sm" />
    </div>
  );
}
