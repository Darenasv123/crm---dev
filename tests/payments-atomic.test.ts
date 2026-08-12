import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildRegisterPaymentRpcArgs,
  executeRegisterPaymentAtomic,
  outstandingBalanceMessage,
  paymentRegistrationErrorMessage,
  validateRegisterPaymentAmount,
  type AtomicPaymentResult,
} from "../src/hooks/use-payments";

const successfulResult = {
  payment: {
    case_id: null,
    client_id: "client-1",
    created_at: "2026-07-29T12:00:00Z",
    fees: 1_000,
    id: "payment-1",
    paid: 250,
    paid_installments: 1,
    service: "Asesoría",
    status: "Parcial",
    total_installments: 4,
  },
  record: {
    amount: 250,
    created_at: "2026-07-29T12:00:00Z",
    id: "record-1",
    method: "Transferencia",
    notes: null,
    payment_date: "2026-07-29",
    payment_id: "payment-1",
    receipt: null,
  },
} satisfies AtomicPaymentResult;

describe("atomic payment registration", () => {
  it("permite pagar exactamente el saldo pendiente", () => {
    expect(() => validateRegisterPaymentAmount(700, 700)).not.toThrow();
  });

  it("rechaza S/ 701 cuando el saldo es S/ 700 sin alterar el importe", () => {
    expect(() => validateRegisterPaymentAmount(701, 700)).toThrow(
      "El monto supera el saldo pendiente de S/ 700.00.",
    );
  });

  it.each([0, -1, Number.NaN])("rechaza importes no positivos o inválidos: %s", (amount) => {
    expect(() => validateRegisterPaymentAmount(amount, 700)).toThrow(
      "El monto debe ser mayor a 0.",
    );
  });

  it("normaliza el error de sobrepago de la RPC sin exponer detalles internos", () => {
    expect(
      paymentRegistrationErrorMessage(
        new Error("Payment amount exceeds the outstanding balance"),
        700,
      ),
    ).toBe(outstandingBalanceMessage(700));
  });

  it("no llama la RPC cuando la defensa frontend detecta el sobrepago", async () => {
    const rpc = vi.fn();
    await expect(
      executeRegisterPaymentAtomic(
        { rpc },
        {
          paymentId: "payment-1",
          remaining: 700,
          record: { amount: 701, method: "Transferencia" },
        },
      ),
    ).rejects.toThrow("S/ 700.00");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("builds RPC arguments without client-computed totals or status", () => {
    expect(
      buildRegisterPaymentRpcArgs({
        paymentId: "payment-1",
        record: {
          amount: 250,
          method: " Transferencia ",
          notes: "Cuota 1",
        },
      }),
    ).toEqual({
      p_amount: 250,
      p_method: "Transferencia",
      p_notes: "Cuota 1",
      p_payment_date: null,
      p_payment_id: "payment-1",
      p_receipt: null,
    });
  });

  it.each([
    [{ paymentId: "", record: { amount: 10, method: "Efectivo" } }, "plan"],
    [{ paymentId: "payment-1", record: { amount: 0, method: "Efectivo" } }, "monto"],
    [{ paymentId: "payment-1", record: { amount: -1, method: "Efectivo" } }, "monto"],
    [{ paymentId: "payment-1", record: { amount: 10, method: " " } }, "método"],
  ])("rejects invalid input before Supabase: %j", (input, message) => {
    expect(() => buildRegisterPaymentRpcArgs(input)).toThrow(message);
  });

  it("returns the payment and record confirmed by the RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: successfulResult,
      error: null,
    });

    await expect(
      executeRegisterPaymentAtomic(
        { rpc },
        {
          paymentId: "payment-1",
          record: { amount: 250, method: "Transferencia" },
        },
      ),
    ).resolves.toEqual(successfulResult);

    expect(rpc).toHaveBeenCalledWith(
      "register_payment_record_atomic",
      expect.objectContaining({
        p_amount: 250,
        p_payment_id: "payment-1",
      }),
    );
  });

  it("propagates database failures and rejects incomplete confirmations", async () => {
    await expect(
      executeRegisterPaymentAtomic(
        {
          rpc: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "Payment amount exceeds the outstanding balance" },
          }),
        },
        {
          paymentId: "payment-1",
          record: { amount: 1_001, method: "Transferencia" },
        },
      ),
    ).rejects.toThrow("exceeds");

    await expect(
      executeRegisterPaymentAtomic(
        {
          rpc: vi.fn().mockResolvedValue({
            data: { payment: successfulResult.payment },
            error: null,
          }),
        },
        {
          paymentId: "payment-1",
          record: { amount: 250, method: "Transferencia" },
        },
      ),
    ).rejects.toThrow("no confirmó");
  });

  it("la UI no recorta el importe y solo cierra después de una confirmación", () => {
    const route = readFileSync(resolve(process.cwd(), "src/routes/_app.pagos.index.tsx"), "utf8");
    const submitStart = route.indexOf("async function handleRegisterPayment");
    const submit = route.slice(submitStart, route.indexOf("  return (", submitStart));

    expect(route).not.toContain("String(max)");
    expect(route).not.toContain("Clamp to max");
    expect(submit.indexOf("await registerPayment.mutateAsync")).toBeLessThan(
      submit.indexOf("setModal(null)"),
    );
    expect(submit).toContain("setFormError(paymentRegistrationErrorMessage(err, remaining))");
  });

  it("no aplica paid/status de forma optimista y refresca pagos y registros tras éxito", () => {
    const hook = readFileSync(resolve(process.cwd(), "src/hooks/use-payments.ts"), "utf8");
    const registerHook = hook.slice(hook.indexOf("export function useRegisterPayment"));

    expect(registerHook).not.toMatch(/onMutate|setQueryData/);
    expect(registerHook).toContain('invalidateQueries({ queryKey: ["payments"] })');
    expect(registerHook).toContain(
      'invalidateQueries({ queryKey: ["payment_records", paymentId] })',
    );
  });
});

describe("atomic payment migration contract", () => {
  const migration = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20260729120000_atomic_payment_records.sql"),
    "utf8",
  ).toLowerCase();

  it("locks and updates the payment in one database function", () => {
    expect(migration).toContain("for update");
    expect(migration).toContain("insert into public.payment_records");
    expect(migration).toContain("update public.payments");
    expect(migration).toContain("begin;");
    expect(migration).toContain("commit;");
  });

  it("enforces authentication, administrator role, and amount invariants", () => {
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain("role = 'administrador'");
    expect(migration).toContain("status = 'activo'");
    expect(migration).toContain("p_amount <= 0");
    expect(migration).toContain("v_new_paid > v_payment.fees");
  });

  it("rechaza el sobrepago antes de crear payment_records", () => {
    expect(migration.indexOf("v_new_paid > v_payment.fees")).toBeLessThan(
      migration.indexOf("insert into public.payment_records"),
    );
  });

  it("el backend calcula Pagado para cancelación exacta y Parcial para abonos", () => {
    expect(migration).toContain("when v_new_paid = v_payment.fees then 'pagado'");
    expect(migration).toContain("else 'parcial'");
    expect(migration).toContain("paid = v_new_paid");
  });

  it("only grants execution to authenticated users", () => {
    expect(migration).toContain("revoke all on function");
    expect(migration).toContain("from public");
    expect(migration).toContain("from anon");
    expect(migration).toContain("grant execute on function");
    expect(migration).toContain("to authenticated");
  });
});
