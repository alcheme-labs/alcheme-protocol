export type EvidenceReviewPhase =
  | "response_window"
  | "appeal"
  | "settlement_execution"
  | "post_retention";

const TIER_1_KINDS = new Set(["chain_transaction", "signed_receipt", "signed_app_event"]);
const TIER_2_KINDS = new Set(["node_report", "signed_app_log", "server_callback"]);
const TIER_3_KINDS = new Set(["screenshot", "chat_log", "support_ticket", "third_party_record"]);
const TIER_4_KINDS = new Set(["ai_summary", "hash_only", "unverifiable"]);

export function resolveEvidenceActionEligibility(input: {
  evidenceKind: string;
  availabilityStatus: string;
  retentionUntil?: string | Date | null;
}) {
  const tier = evidenceTier(input.evidenceKind);
  const available = input.availabilityStatus === "available";
  const hasRetention = Boolean(input.retentionUntil);
  const automaticPunishmentAllowed = tier === 1 && available && hasRetention;
  return {
    tier,
    automaticPunishmentAllowed,
    reviewAllowed: available && hasRetention && tier <= 3,
    weakRiskSignalOnly: tier >= 4 || !available || !hasRetention,
    reason: automaticPunishmentAllowed
      ? "tier_1_machine_verifiable"
      : "insufficient_for_automatic_punishment",
  };
}

export function resolveEvidenceLossHandling(input: {
  phase: EvidenceReviewPhase;
  causedByAlchemeOrOperator: boolean;
  remainingTier1MachineEvidence: boolean;
}) {
  if (input.causedByAlchemeOrOperator) {
    return {
      action: "open_correction_audit",
      punishTargetApp: false,
      settlementAllowed: input.remainingTier1MachineEvidence,
    };
  }
  if (input.remainingTier1MachineEvidence) {
    return {
      action: "continue_with_tier_1_evidence",
      punishTargetApp: true,
      settlementAllowed: true,
    };
  }
  if (input.phase === "response_window") {
    return { action: "reopen_evidence_collection", punishTargetApp: false, settlementAllowed: false };
  }
  if (input.phase === "appeal") {
    return { action: "pause_settlement", punishTargetApp: false, settlementAllowed: false };
  }
  if (input.phase === "settlement_execution") {
    return { action: "block_settlement", punishTargetApp: false, settlementAllowed: false };
  }
  return { action: "preserve_hash_and_summary", punishTargetApp: false, settlementAllowed: false };
}

export function resolveEvidenceVisibility(input: {
  accessTier: "public" | "reviewer_only" | "sealed";
  redactionState: "none" | "redacted" | "redacted_public_summary";
  evidenceHash: string;
  sourceEvidenceHash?: string | null;
}) {
  if (
    input.redactionState !== "none" &&
    !input.sourceEvidenceHash &&
    input.redactionState === "redacted_public_summary"
  ) {
    throw new Error("external_app_redacted_evidence_missing_original_hash");
  }
  return {
    accessTier: input.accessTier,
    redactionState: input.redactionState,
    evidenceHash: input.evidenceHash,
    originalEvidenceHash: input.sourceEvidenceHash ?? input.evidenceHash,
    reviewerAccessRequired:
      input.accessTier === "reviewer_only" || input.accessTier === "sealed",
  };
}

function evidenceTier(kind: string): 1 | 2 | 3 | 4 {
  if (TIER_1_KINDS.has(kind)) return 1;
  if (TIER_2_KINDS.has(kind)) return 2;
  if (TIER_3_KINDS.has(kind)) return 3;
  if (TIER_4_KINDS.has(kind)) return 4;
  return 4;
}
