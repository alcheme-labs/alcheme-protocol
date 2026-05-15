import {
  resolveEvidenceActionEligibility,
  resolveEvidenceLossHandling,
  resolveEvidenceVisibility,
} from "../evidencePolicy";

describe("external app evidence policy", () => {
  it("rejects automatic punishment for screenshot-only, ai-summary-only, unavailable, or retention-missing evidence", () => {
    for (const evidence of [
      { evidenceKind: "screenshot", availabilityStatus: "available", retentionUntil: "2030-01-01T00:00:00.000Z" },
      { evidenceKind: "ai_summary", availabilityStatus: "available", retentionUntil: "2030-01-01T00:00:00.000Z" },
      { evidenceKind: "node_report", availabilityStatus: "unavailable", retentionUntil: "2030-01-01T00:00:00.000Z" },
      { evidenceKind: "node_report", availabilityStatus: "available", retentionUntil: null },
    ]) {
      expect(resolveEvidenceActionEligibility(evidence).automaticPunishmentAllowed).toBe(false);
    }
  });

  it("pauses settlement when evidence is lost during appeal unless tier 1 remains", () => {
    expect(
      resolveEvidenceLossHandling({
        phase: "appeal",
        causedByAlchemeOrOperator: false,
        remainingTier1MachineEvidence: false,
      }),
    ).toMatchObject({ action: "pause_settlement" });
    expect(
      resolveEvidenceLossHandling({
        phase: "settlement_execution",
        causedByAlchemeOrOperator: true,
        remainingTier1MachineEvidence: false,
      }),
    ).toMatchObject({ action: "open_correction_audit", punishTargetApp: false });
  });

  it("keeps redaction display state separate from reviewer access tier", () => {
    expect(
      resolveEvidenceVisibility({
        accessTier: "reviewer_only",
        redactionState: "redacted_public_summary",
        evidenceHash: "sha256:raw",
        sourceEvidenceHash: "sha256:raw",
      }),
    ).toMatchObject({
      accessTier: "reviewer_only",
      redactionState: "redacted_public_summary",
      originalEvidenceHash: "sha256:raw",
    });

    expect(() =>
      resolveEvidenceVisibility({
        accessTier: "public",
        redactionState: "redacted_public_summary",
        evidenceHash: "sha256:summary",
      }),
    ).toThrow("external_app_redacted_evidence_missing_original_hash");
  });
});
