import { useMutation, useQuery } from "@tanstack/react-query";
import {
  getEmailConfigStatus,
  sendReportEmail,
  sendTestEmail,
  type EmailConfigStatus,
} from "@/lib/email-client";

export function useEmailConfigStatus(options: { enabled?: boolean } = {}) {
  return useQuery<EmailConfigStatus>({
    queryKey: ["email-config-status"],
    queryFn: getEmailConfigStatus,
    enabled: options.enabled ?? true,
    staleTime: 30_000,
  });
}

export function useSendTestEmail() {
  return useMutation({
    mutationFn: (to: string) => sendTestEmail(to),
  });
}

export function useSendReportEmail() {
  return useMutation({
    mutationFn: (reportId: string) => sendReportEmail(reportId),
  });
}
