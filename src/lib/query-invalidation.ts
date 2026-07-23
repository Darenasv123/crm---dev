import type { QueryClient, QueryKey } from "@tanstack/react-query";

const CORE_CRM_QUERY_KEYS: QueryKey[] = [
  ["clients"],
  ["cases"],
  ["documents"],
  ["agenda_events"],
  ["payments"],
  ["client_reports"],
  ["import-jobs-filter"],
  ["ai-findings"],
];

export function invalidateCrmQueries(
  queryClient: QueryClient,
  options: {
    clientId?: string | null;
    caseId?: string | null;
    paymentId?: string | null;
    includeCore?: boolean;
  } = {},
) {
  if (options.includeCore ?? true) {
    for (const queryKey of CORE_CRM_QUERY_KEYS) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }

  if (options.clientId) {
    void queryClient.invalidateQueries({ queryKey: ["clients", options.clientId] });
  }
  if (options.caseId) {
    void queryClient.invalidateQueries({ queryKey: ["cases", options.caseId] });
    void queryClient.invalidateQueries({ queryKey: ["case_parties", options.caseId] });
    void queryClient.invalidateQueries({ queryKey: ["case_events"] });
    void queryClient.invalidateQueries({ queryKey: ["case_tasks", options.caseId] });
  }
  if (options.paymentId) {
    void queryClient.invalidateQueries({ queryKey: ["payment_records", options.paymentId] });
  }
}
