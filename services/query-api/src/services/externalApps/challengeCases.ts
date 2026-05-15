import { normalizeHash32Hex } from "./chainRegistryDigest";

export type ExternalAppChallengeCaseClass = "machine_verifiable" | "subjective";
export type ExternalAppChallengeProjectionStatus =
  | "normal"
  | "projection_disputed"
  | "manual_freeze"
  | "status_sync_pending";

export interface ExternalAppChallengeCaseProjectionInput {
  externalAppId: string;
  appIdHash: string;
  caseId: string;
  challengerPubkey: string;
  challengeType: string;
  evidenceHash: string;
  mint: string;
  amountRaw: string;
  policyEpochId: string;
  governanceRequestId?: string | null;
}

export interface ExternalAppChallengeSettlementInput {
  caseClass: ExternalAppChallengeCaseClass;
  evidenceTier: 1 | 2 | 3 | 4;
  machineVerifiable?: boolean;
  governanceReceiptId?: string | null;
  arbitrationReceiptId?: string | null;
  projectionStatus?: ExternalAppChallengeProjectionStatus;
}

export function buildExternalAppChallengeCaseProjection(
  input: ExternalAppChallengeCaseProjectionInput,
) {
  const appIdHash = normalizeHash32Hex(input.appIdHash, "external_app_challenge_app_id_hash");
  const caseId = normalizeHash32Hex(input.caseId, "external_app_challenge_case_id");
  const amountRaw = normalizePositiveRawAmount(input.amountRaw);

  return {
    id: `v3b:challenge:${input.externalAppId}:${caseId}`,
    externalAppId: input.externalAppId,
    appIdHash,
    caseId,
    challengerPubkey: input.challengerPubkey,
    challengeType: input.challengeType,
    evidenceHash: input.evidenceHash,
    mint: input.mint,
    challengeBondRaw: amountRaw,
    status: "open" as const,
    governanceRequestId: input.governanceRequestId ?? null,
    policyEpochId: input.policyEpochId,
  };
}

export function assertExternalAppChallengeSettlementAllowed(
  input: ExternalAppChallengeSettlementInput,
): void {
  if (input.projectionStatus === "projection_disputed") {
    throw new Error("external_app_challenge_projection_disputed");
  }
  if (input.evidenceTier >= 4) {
    throw new Error("external_app_challenge_evidence_too_weak_for_settlement");
  }
  if (input.caseClass === "machine_verifiable" && input.machineVerifiable === true) {
    if (input.evidenceTier > 1) {
      throw new Error("external_app_challenge_machine_verifiable_requires_tier1");
    }
    return;
  }
  if (!input.governanceReceiptId && !input.arbitrationReceiptId) {
    throw new Error("external_app_challenge_subjective_settlement_requires_receipt");
  }
}

function normalizePositiveRawAmount(value: string): string {
  const normalized = String(value || "").trim();
  if (!/^[0-9]+$/.test(normalized) || BigInt(normalized) <= 0n) {
    throw new Error("invalid_external_app_challenge_amount_raw");
  }
  return normalized;
}
