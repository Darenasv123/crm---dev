import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAuthClient } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";
import { invalidateCrmQueries } from "@/lib/query-invalidation";

type Payment = Database["public"]["Tables"]["payments"]["Row"];
type PaymentInsert = Database["public"]["Tables"]["payments"]["Insert"];
type PaymentRecord = Database["public"]["Tables"]["payment_records"]["Row"];
type PaymentRecordInsert = Database["public"]["Tables"]["payment_records"]["Insert"];
type QueryOptions = { enabled?: boolean };

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
    mutationFn: async ({
      paymentId,
      record,
      newPaid,
      newPaidInstallments,
      newStatus,
    }: {
      paymentId: string;
      record: Omit<PaymentRecordInsert, "payment_id">;
      newPaid: number;
      newPaidInstallments: number;
      newStatus: Payment["status"];
    }) => {
      const db = await getAuthClient();
      const { error: recError } = await db
        .from("payment_records")
        .insert({ ...record, payment_id: paymentId });
      if (recError) throw new Error(recError.message);

      const { error: updError } = await db
        .from("payments")
        .update({ paid: newPaid, paid_installments: newPaidInstallments, status: newStatus })
        .eq("id", paymentId);
      if (updError) throw new Error(updError.message);
    },
    onSuccess: (_data, { paymentId }) => invalidateCrmQueries(qc, { paymentId }),
  });
}
