import { describe, expect, it } from "vitest";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { invalidateCrmQueries } from "../src/lib/query-invalidation";

function makeQueryClientSpy() {
  const calls: QueryKey[] = [];
  const queryClient = {
    invalidateQueries: ({ queryKey }: { queryKey: QueryKey }) => {
      calls.push(queryKey);
      return Promise.resolve();
    },
  } as unknown as QueryClient;
  return { calls, queryClient };
}

describe("shared CRM query invalidation", () => {
  it("invalidates core CRM modules and related entity details", () => {
    const { calls, queryClient } = makeQueryClientSpy();

    invalidateCrmQueries(queryClient, {
      clientId: "client-1",
      caseId: "case-1",
      paymentId: "payment-1",
    });

    expect(calls).toEqual(
      expect.arrayContaining([
        ["clients"],
        ["cases"],
        ["documents"],
        ["agenda_events"],
        ["payments"],
        ["client_reports"],
        ["import-jobs-filter"],
        ["ai-findings"],
        ["clients", "client-1"],
        ["cases", "case-1"],
        ["case_parties", "case-1"],
        ["case_events"],
        ["case_tasks", "case-1"],
        ["payment_records", "payment-1"],
      ]),
    );
  });

  it("can skip broad invalidation when only detail queries are needed", () => {
    const { calls, queryClient } = makeQueryClientSpy();

    invalidateCrmQueries(queryClient, {
      caseId: "case-2",
      includeCore: false,
    });

    expect(calls).toEqual([
      ["cases", "case-2"],
      ["case_parties", "case-2"],
      ["case_events"],
      ["case_tasks", "case-2"],
    ]);
  });
});
