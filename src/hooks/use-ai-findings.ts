import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchFindings,
  fetchImportJobsForFilter,
  fetchSourceReferenceForFinding,
  persistFindingDecision,
  type AiFindingRow,
  type FindingFilterOptions,
  type PaginatedFindingsResult,
  type UpdateFindingDecisionInput,
} from "@/lib/ai-review/findings-service";

export function useAiFindings(filters: FindingFilterOptions = {}) {
  return useQuery<PaginatedFindingsResult, Error>({
    queryKey: ["ai-findings", filters],
    queryFn: () => fetchFindings(filters),
    staleTime: 1000 * 30,
  });
}

export function useFindingSourceReference(findingId?: string | null) {
  return useQuery({
    queryKey: ["ai-finding-source-reference", findingId],
    queryFn: () => (findingId ? fetchSourceReferenceForFinding(findingId) : null),
    enabled: Boolean(findingId),
  });
}

export function useImportJobsFilter() {
  return useQuery({
    queryKey: ["import-jobs-filter"],
    queryFn: fetchImportJobsForFilter,
    staleTime: 1000 * 60 * 5,
  });
}

export function useUpdateFindingDecision() {
  const queryClient = useQueryClient();

  return useMutation<
    AiFindingRow,
    Error,
    UpdateFindingDecisionInput,
    { previousQueries: [readonly unknown[], PaginatedFindingsResult | undefined][] }
  >({
    mutationFn: (input) => persistFindingDecision(input),

    // Optimistic Update with rollback on error
    onMutate: async (newDecision) => {
      // Cancel refetches
      await queryClient.cancelQueries({ queryKey: ["ai-findings"] });

      // Snapshot previous state
      const matchingQueries = queryClient.getQueriesData<PaginatedFindingsResult>({
        queryKey: ["ai-findings"],
      });

      // Optimistically update all matching queries in cache
      matchingQueries.forEach(([queryKey, oldData]) => {
        if (!oldData) return;
        queryClient.setQueryData<PaginatedFindingsResult>(queryKey, {
          ...oldData,
          data: oldData.data.map((item) =>
            item.id === newDecision.findingId
              ? {
                  ...item,
                  verification_status: newDecision.status,
                  reviewed_at: new Date().toISOString(),
                  reviewed_by: newDecision.userId,
                  review_notes: newDecision.reviewNotes ?? item.review_notes,
                  normalized_value:
                    newDecision.status === "edited" && newDecision.editedValue !== undefined
                      ? newDecision.editedValue
                      : item.normalized_value,
                }
              : item,
          ),
        });
      });

      return { previousQueries: matchingQueries };
    },

    onError: (_err, _newDecision, context) => {
      // Rollback optimistic updates on error
      if (context?.previousQueries) {
        context.previousQueries.forEach(([queryKey, oldData]) => {
          queryClient.setQueryData(queryKey, oldData);
        });
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-findings"] });
    },
  });
}
