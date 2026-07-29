import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAuthClient } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";
import { invalidateCrmQueries } from "@/lib/query-invalidation";

type Payment = Database["public"]["Tables"]["payments"]["Row"];
type PaymentInsert = Database["public"]["Tables"]["payments"]["Insert"];
type PaymentRecord = Database["public"]["Tables"]["payment_records"]["Row"];
type PaymentRecordInsert = Database["public"]["Tables"]["payment_records"]["Insert"];
type QueryOptions = { enabled?: boolean };
type RegisterPaymentRpcArgs =
  Database["public"]["Functions"]["register_payment_record_atomic"]["Args"];

export interface RegisterPaymentInput {
  paymentId: string;
  record: Omit<PaymentRecordInsert, "payment_id">;
}

export interface AtomicPaymentResult {
  payment: Payment;
  record: PaymentRecord;
}

interface PaymentRpcClient {
  rpc: (
    functionName: "register_payment_record_atomic",
    args: RegisterPaymentRpcArgs,
  ) => Promise<{
    data: Database["public"]["Functions"]["register_payment_record_atomic"]["Returns"];
    error: { message: string } | null;
  }>;
}

export function buildRegisterPaymentRpcArgs({
  paymentId,
  record,
}: RegisterPaymentInput): RegisterPaymentRpcArgs {
  if (!paymentId) throw new Error("El plan de pago es obligatorio");
  if (!Number.isFinite(record.amount) || record.amount <= 0) {
    throw new Error("El monto debe ser mayor a cero");
  }
  if (!record.method?.trim()) {
    throw new Error("El método de pago es obligatorio");
  }

  return {
    p_payment_id: paymentId,
    p_amount: record.amount,
    p_method: record.method.trim(),
    p_receipt: record.receipt ?? null,
    p_notes: record.notes ?? null,
    p_payment_date: record.payment_date ?? null,
  };
}

export async function executeRegisterPaymentAtomic(
  db: PaymentRpcClient,
  input: RegisterPaymentInput,
): Promise<AtomicPaymentResult> {
  const { data, error } = await db.rpc(
    "register_payment_record_atomic",
    buildRegisterPaymentRpcArgs(input),
  );
  if (error) throw new Error(error.message);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("La base de datos devolvió una respuesta de pago inválida");
  }

  const result = data as unknown as Partial<AtomicPaymentResult>;
  if (!result.payment?.id || !result.record?.id) {
    throw new Error("La base de datos no confirmó el pago registrado");
  }
  return result as AtomicPaymentResult;
}

export function validatePaymentInput(
  input: Pick<PaymentInsert, "client_id" | "service" | "fees" | "total_installments">,
) {
  const fees = Number(input.fees);
  const installments = Number(input.total_installments ?? 1);
  if (!input.client_id) throw new Error("Selecciona un cliente para registrar el pago.");
  if (!input.service.trim()) throw new Error("Describe el servicio asociado al pago.");
  if (!Number.isFinite(fees) || fees <= 0) throw new Error("Los honorarios deben ser mayores a 0.");
  if (!Number.isInteger(installments) || installments < 1) {
    throw new Error("El número de cuotas debe ser al menos 1.");
  }
}

export interface PaymentWithClient extends Payment {
  clients: { name: string } | null;
}

export function usePayments(options: QueryOptions = {}) {
  return useQuery({
    queryKey: ["payments"],
    queryFn: async () => {
      const db = await getAuthClient();
      const { data, error } = await db
        .from("payments")
        .select("*, clients(name)")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data as PaymentWithClient[];
    },
    enabled: options.enabled ?? true,
  });
}

export function usePaymentRecords(paymentId: string) {
  return useQuery({
    queryKey: ["payment_records", paymentId],
    queryFn: async () => {
      const db = await getAuthClient();
      const { data, error } = await db
        .from("payment_records")
        .select("*")
        .eq("payment_id", paymentId)
        .order("payment_date", { ascending: false });
      if (error) throw new Error(error.message);
      return data as PaymentRecord[];
    },
    enabled: !!paymentId,
  });
}

export function useCreatePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PaymentInsert) => {
      validatePaymentInput(input);
      const db = await getAuthClient();
      const { data, error } = await db
        .from("payments")
        .insert({
          ...input,
          fees: Number(input.fees),
          total_installments: Number(input.total_installments ?? 1),
          paid: input.paid ?? 0,
          paid_installments: input.paid_installments ?? 0,
          status: input.status ?? "Pendiente",
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: (data) =>
      invalidateCrmQueries(qc, { clientId: data?.client_id, caseId: data?.case_id }),
  });
}

export function useRegisterPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RegisterPaymentInput) => {
      const db = await getAuthClient();
      return executeRegisterPaymentAtomic(db as unknown as PaymentRpcClient, input);
    },
    onSuccess: (result, { paymentId }) =>
      invalidateCrmQueries(qc, {
        paymentId,
        clientId: result.payment.client_id,
        caseId: result.payment.case_id,
      }),
  });
}
