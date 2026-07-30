import { z } from "zod";

const verificationStatusSchema = z.enum(["pending", "approved", "edited", "rejected", "conflict"]);

export const reviewDecisionSchema = z.object({
  findingId: z.string().min(1),
  status: verificationStatusSchema,
  editedValue: z.string().trim().min(1).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;

export function applyReviewDecision<
  S extends string,
  T extends { id: string; value: string; status: S },
>(findings: T[], decision: ReviewDecision): T[] {
  const parsed = reviewDecisionSchema.parse(decision);
  return findings.map((finding) =>
    finding.id === parsed.findingId
      ? {
          ...finding,
          value: parsed.editedValue ?? finding.value,
          status: parsed.status as S,
          reviewNotes: parsed.notes ?? null,
        }
      : finding,
  );
}
