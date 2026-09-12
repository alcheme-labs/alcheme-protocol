import { digestJson } from "./digest";

export interface PaymentAuthorizationInput {
  payerRef: string;
  payerType: "user" | "circle_budget" | "sponsor" | "alcheme_subsidy" | "project_budget";
  budgetSourceRef: string;
  quoteId: string;
  quoteDigest: string;
  costCap: string;
  currency: string;
  billingPeriod?: string;
  objectDigest: string;
  objectSize?: number;
  storageClass?: string;
  refundPolicy: string;
  nonPaymentPolicy: string;
  expiresAt: string;
}

export interface PublishGrantInput {
  objectDigest: string;
  objectUri?: string;
  ownerRef: string;
  scopeRef: string;
  visibility: "private" | "circle" | "public";
  publishRightRef: string;
  permanence: "temporary" | "durable" | "permanent";
  retentionPolicy: string;
  providerPolicyRef: string;
  accessPolicyDigest: string;
  deletionSemanticsAcknowledged: boolean;
  moderationStatus: string;
  paymentAuthorizationRef: string;
  expiresAt: string;
}

export function buildPaymentAuthorizationPayload(input: PaymentAuthorizationInput) {
  requireFields(input as unknown as Record<string, unknown>, [
    "payerRef",
    "payerType",
    "budgetSourceRef",
    "quoteId",
    "quoteDigest",
    "costCap",
    "currency",
    "objectDigest",
    "refundPolicy",
    "nonPaymentPolicy",
    "expiresAt",
  ]);
  const payload = { ...input };
  return { payload, payloadDigest: digestJson(payload) };
}

export function buildPublishGrantPayload(input: PublishGrantInput) {
  requireFields(input as unknown as Record<string, unknown>, [
    "objectDigest",
    "ownerRef",
    "scopeRef",
    "visibility",
    "publishRightRef",
    "permanence",
    "retentionPolicy",
    "providerPolicyRef",
    "accessPolicyDigest",
    "moderationStatus",
    "paymentAuthorizationRef",
    "expiresAt",
  ]);
  if (!input.deletionSemanticsAcknowledged) {
    throw new Error("hosted_app_publish_deletion_semantics_ack_required");
  }
  const payload = { ...input };
  return { payload, payloadDigest: digestJson(payload) };
}

function requireFields(input: Record<string, unknown>, fields: string[]) {
  for (const field of fields) {
    if (input[field] === undefined || input[field] === null || input[field] === "") {
      throw new Error(`hosted_app_${field}_required`);
    }
  }
}
