import { describe, expect, it } from "vitest";
import { applyReviewDecision } from "@/lib/ai-review/review-state";
import { demoFindings } from "@/lib/legal/demo-data";

describe("revisión humana de hallazgos", () => {
  const findings = demoFindings.map((finding) => ({ ...finding, status: String(finding.status) }));

  it("aprueba un dato propuesto", () => {
    const reviewed = applyReviewDecision(findings, {
      findingId: "finding-client-name",
      status: "approved",
    });
    expect(reviewed.find((item) => item.id === "finding-client-name")?.status).toBe("approved");
  });

  it("edita un dato y conserva el nuevo valor", () => {
    const reviewed = applyReviewDecision(findings, {
      findingId: "finding-client-name",
      status: "edited",
      editedValue: "Cliente corregido",
    });
    expect(reviewed.find((item) => item.id === "finding-client-name")?.value).toBe(
      "Cliente corregido",
    );
  });

  it("rechaza un hallazgo sin alterar los demás", () => {
    const reviewed = applyReviewDecision(findings, {
      findingId: "finding-next-action",
      status: "rejected",
    });
    expect(reviewed.find((item) => item.id === "finding-next-action")?.status).toBe("rejected");
    expect(reviewed.find((item) => item.id === "finding-case")?.value).toBe(
      demoFindings.find((item) => item.id === "finding-case")?.value,
    );
  });
});
