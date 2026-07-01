import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAuthClient } from "@/lib/supabase";
import type { Database } from "@/lib/database.types";

type Payment = Database["public"]["Tables"]["payments"]["Row"];
type PaymentInsert = Database["public"]["Tables"]["payments"]["Insert"];
type PaymentRecord = Database["public"]["Tables"]["payment_records"]["Row"];
type PaymentRecordInsert = Database["public"]["Tables"]["payment_records"]["Insert"];

export interface PaymentWithClient extends Payment {
  clients: { name: string } | null;
}

export function usePayments() {
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
      const db = await getAuthClient();
      const { data, error } = await db
        .from("payments")
        .insert(input)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payments"] }),
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
    onSuccess: (_data, { paymentId }) => {
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["payment_records", paymentId] });
    },
  });
}
