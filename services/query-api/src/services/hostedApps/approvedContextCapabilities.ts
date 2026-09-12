const APPROVED_CONTEXT_CAPABILITIES = new Set([
  "read_my_circle_membership_status",
  "read_approved_circle_summary",
  "read_approved_knowledge_context",
]);

export function assertApprovedContextCapabilityKnown(capabilityId: string): void {
  if (!APPROVED_CONTEXT_CAPABILITIES.has(capabilityId)) {
    throw new Error("hosted_app_approved_context_capability_unknown");
  }
}

export function buildMembershipStatusResult(input: {
  circleId: number;
  userPubkey: string;
  membershipStatus: string;
  role: string;
  internalMemberId?: number;
  joinedAt?: string;
}) {
  return {
    circleId: input.circleId,
    userPubkey: input.userPubkey,
    membershipStatus: input.membershipStatus,
    role: input.role,
  };
}

export function buildApprovedCircleSummaryResult(input: {
  circleId: number;
  summaryDigest: string;
  summaryText: string;
  approvalReceiptRef: string;
  privateNotes?: string;
}) {
  return {
    circleId: input.circleId,
    summaryDigest: input.summaryDigest,
    summaryText: input.summaryText,
    approvalReceiptRef: input.approvalReceiptRef,
  };
}

export function buildApprovedKnowledgeContextResult(input: {
  circleId: number;
  sourceMaterials: Array<{
    id: number;
    digest: string;
    approvedSummary: string;
    visibility: string;
    rawText?: string;
  }>;
  traceId: string;
}) {
  return {
    circleId: input.circleId,
    traceId: input.traceId,
    items: input.sourceMaterials.map((source) => ({
      sourceMaterialId: source.id,
      digest: source.digest,
      approvedSummary: source.approvedSummary,
      visibility: source.visibility,
    })),
  };
}
