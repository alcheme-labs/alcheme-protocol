import { randomUUID } from "node:crypto";

import { digestJson } from "./digest";

export function resolveReleaseForInstallation(input: {
  installation: { updatePolicy: string; currentReleaseId: string; subscribedChannelId?: string | null };
  channel?: { channelId: string; pointsToReleaseId: string } | null;
}): string {
  if (input.installation.updatePolicy === "manual" || input.installation.updatePolicy === "pinned") {
    return input.installation.currentReleaseId;
  }
  if (
    (input.installation.updatePolicy === "auto_patch" || input.installation.updatePolicy === "auto_minor") &&
    input.channel &&
    input.installation.subscribedChannelId === input.channel.channelId
  ) {
    return input.channel.pointsToReleaseId;
  }
  return input.installation.currentReleaseId;
}

export function assertCandidateReleaseAudience(input: {
  releaseKind: "candidate" | "production";
  audienceGrant: { expiresAt: string; dataPolicy: string } | null;
}): void {
  if (input.releaseKind === "production") return;
  if (!input.audienceGrant) {
    throw new Error("hosted_app_candidate_audience_required");
  }
  if (Date.parse(input.audienceGrant.expiresAt) <= Date.now()) {
    throw new Error("hosted_app_candidate_audience_expired");
  }
  if (!input.audienceGrant.dataPolicy) {
    throw new Error("hosted_app_candidate_data_policy_required");
  }
}

export function buildPromotionReceipt(input: {
  appId: string;
  candidateReleaseId: string;
  targetProductionReleaseId: string;
  manifestHash: string;
  bundleHash: string;
  capabilityPolicyDigest: string;
  testReceiptRefs: string[];
  developerSignature: string;
  governanceOrCircleApprovalRef?: string | null;
}) {
  const base = {
    receiptId: randomUUID(),
    receiptType: "hosted_app_release_promotion",
    ...input,
    issuedAt: new Date().toISOString(),
  };
  return { ...base, receiptDigest: digestJson(base) };
}

export function assertGraceReleaseCanRun(input: {
  supportStatus: string;
  graceUntil?: string | null;
  allowedCapabilitiesDuringGrace: string[];
  requestedCapability: string;
}): void {
  if (input.supportStatus !== "grace") return;
  if (!input.graceUntil || Date.parse(input.graceUntil) <= Date.now()) {
    throw new Error("hosted_app_grace_expired");
  }
  if (!input.allowedCapabilitiesDuringGrace.includes(input.requestedCapability)) {
    throw new Error("hosted_app_grace_capability_denied");
  }
}
