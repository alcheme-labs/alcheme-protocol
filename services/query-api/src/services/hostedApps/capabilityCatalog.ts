import type { HostedAppCapabilityKind } from "./types";

export type HostedAppCapabilityRiskLevel = "low" | "medium" | "high" | "critical";
export type HostedAppCapabilityDataClass =
  | "public"
  | "circle_shared"
  | "personal"
  | "sensitive"
  | "payment"
  | "signing";
export type HostedAppCapabilityDefaultState =
  | "disabled"
  | "internal"
  | "circle_requestable"
  | "deprecated"
  | "emergency_disabled";
export type HostedAppCapabilityCirclePolicy =
  | "none"
  | "circle_trust_required"
  | "governance_required";
export type HostedAppCapabilityUserConsent = "none" | "personal_scope";
export type HostedAppCapabilityChangeType =
  | "add"
  | "enable"
  | "disable"
  | "limit"
  | "expand_scope"
  | "change_data_shape"
  | "risk_reclassify"
  | "deprecate"
  | "emergency_disable";

export interface HostedAppCapabilityDefinition {
  id: string;
  implementationVersion: string;
  policyEpoch: number;
  kind: HostedAppCapabilityKind;
  riskLevel: HostedAppCapabilityRiskLevel;
  dataClass: HostedAppCapabilityDataClass;
  defaultState: HostedAppCapabilityDefaultState;
  requiredCirclePolicy: HostedAppCapabilityCirclePolicy;
  requiredUserConsent: HostedAppCapabilityUserConsent;
  returnedDataShape: string[];
  parameterSchema: Record<string, string>;
  dataReleaseProfileId?: string;
}

export const HOSTED_APP_CAPABILITIES: HostedAppCapabilityDefinition[] = [
  {
    id: "read_app_session",
    implementationVersion: "v1",
    policyEpoch: 1,
    kind: "read",
    riskLevel: "low",
    dataClass: "public",
    defaultState: "circle_requestable",
    requiredCirclePolicy: "circle_trust_required",
    requiredUserConsent: "none",
    returnedDataShape: ["appId", "releaseId", "circleId", "userPubkey"],
    parameterSchema: {},
    dataReleaseProfileId: "app-session-minimized-v1",
  },
  {
    id: "read_current_circle_public_profile",
    implementationVersion: "v1",
    policyEpoch: 1,
    kind: "read",
    riskLevel: "low",
    dataClass: "circle_shared",
    defaultState: "circle_requestable",
    requiredCirclePolicy: "circle_trust_required",
    requiredUserConsent: "none",
    returnedDataShape: ["circleId", "name", "description", "memberCount"],
    parameterSchema: { circleId: "number" },
    dataReleaseProfileId: "circle-public-profile-minimized-v1",
  },
  {
    id: "read_my_circle_membership_status",
    implementationVersion: "v1",
    policyEpoch: 1,
    kind: "read",
    riskLevel: "medium",
    dataClass: "personal",
    defaultState: "circle_requestable",
    requiredCirclePolicy: "circle_trust_required",
    requiredUserConsent: "personal_scope",
    returnedDataShape: ["circleId", "userPubkey", "membershipStatus", "role"],
    parameterSchema: { circleId: "number" },
    dataReleaseProfileId: "membership-minimized-v1",
  },
  {
    id: "read_approved_circle_summary",
    implementationVersion: "v1",
    policyEpoch: 1,
    kind: "read",
    riskLevel: "medium",
    dataClass: "circle_shared",
    defaultState: "circle_requestable",
    requiredCirclePolicy: "circle_trust_required",
    requiredUserConsent: "none",
    returnedDataShape: ["circleId", "summaryDigest", "summaryText", "approvalReceiptRef"],
    parameterSchema: { circleId: "number" },
    dataReleaseProfileId: "approved-circle-summary-minimized-v1",
  },
  {
    id: "read_approved_knowledge_context",
    implementationVersion: "v1",
    policyEpoch: 1,
    kind: "read",
    riskLevel: "medium",
    dataClass: "circle_shared",
    defaultState: "circle_requestable",
    requiredCirclePolicy: "circle_trust_required",
    requiredUserConsent: "none",
    returnedDataShape: ["sourceMaterialId", "digest", "approvedSummary", "visibility", "traceId"],
    parameterSchema: { circleId: "number", timeRange: "optional_string", limit: "optional_number" },
    dataReleaseProfileId: "approved-context-watermarked-v1",
  },
  {
    id: "create_draft_intent",
    implementationVersion: "v1",
    policyEpoch: 1,
    kind: "action",
    riskLevel: "medium",
    dataClass: "circle_shared",
    defaultState: "circle_requestable",
    requiredCirclePolicy: "circle_trust_required",
    requiredUserConsent: "none",
    returnedDataShape: ["actionReceiptId", "decision", "payloadDigest"],
    parameterSchema: { title: "string", body: "string" },
  },
  {
    id: "request_governance_proposal_intent",
    implementationVersion: "v1",
    policyEpoch: 1,
    kind: "action",
    riskLevel: "high",
    dataClass: "circle_shared",
    defaultState: "circle_requestable",
    // This capability submits an item into the Circle's governance owner. It
    // does not execute the governed effect, so requiring a prior approval for
    // the exact proposal payload would make proposal creation circular.
    requiredCirclePolicy: "circle_trust_required",
    requiredUserConsent: "none",
    returnedDataShape: ["actionReceiptId", "decision", "payloadDigest"],
    parameterSchema: { operationId: "string", operationVersion: "string" },
  },
  {
    id: "request_signature_intent",
    implementationVersion: "v1",
    policyEpoch: 1,
    kind: "signature",
    riskLevel: "critical",
    dataClass: "signing",
    defaultState: "circle_requestable",
    requiredCirclePolicy: "governance_required",
    requiredUserConsent: "none",
    returnedDataShape: ["actionReceiptId", "decision", "signatureDigest"],
    parameterSchema: { purpose: "string", payloadDigest: "string", previewDigest: "string" },
  },
];

export const HOSTED_APP_AI_REVIEW_AUTHORITY = {
  runtimeAuthority: false,
  authorizationDecision: false,
} as const;

export function getHostedAppCapabilityDefinition(
  id: string,
): HostedAppCapabilityDefinition | null {
  return HOSTED_APP_CAPABILITIES.find((capability) => capability.id === id) ?? null;
}

export function validateCapabilityChange(input: {
  changeType: HostedAppCapabilityChangeType;
  previous: HostedAppCapabilityDefinition;
  next: HostedAppCapabilityDefinition;
}): void {
  if (input.changeType !== "emergency_disable") {
    return;
  }

  const previousFields = new Set(input.previous.returnedDataShape);
  const expanded = input.next.returnedDataShape.some((field) => !previousFields.has(field));
  if (expanded) {
    throw new Error("hosted_app_capability_emergency_change_must_shrink");
  }
}
