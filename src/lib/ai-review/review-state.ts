import { z } from "zod";
import { verificationStatusSchema } from "@/lib/legal/domain";

export const reviewDecisionSchema = z.object({
  findingId: z.string().min(1),
  status: verificationStatusSchema,
  editedValue: z.string().trim().min(1).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;

export function applyReviewDecision<T extends { id: string; value: string; status: string }>(
  findings: T[],
  decision: ReviewDecision,
) {
  const parsed = reviewDecisionSchema.parse(decision);
  return findings.map((finding) =>
    finding.id === parsed.findingId
      ? {
          ...finding,
          value: parsed.editedValue ?? finding.value,
          status: parsed.status,
          reviewNotes: parsed.notes ?? null,
        }
      : finding,
  );
}
