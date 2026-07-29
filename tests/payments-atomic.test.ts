import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildRegisterPaymentRpcArgs,
  executeRegisterPaymentAtomic,
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

  it("only grants execution to authenticated users", () => {
    expect(migration).toContain("revoke all on function");
    expect(migration).toContain("from public");
    expect(migration).toContain("from anon");
    expect(migration).toContain("grant execute on function");
    expect(migration).toContain("to authenticated");
  });
});
