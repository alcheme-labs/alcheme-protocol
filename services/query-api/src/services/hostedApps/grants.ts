import { digestJson } from "./digest";
import {
  buildPaymentAuthorizationPayload,
  buildPublishGrantPayload,
  type PaymentAuthorizationInput,
  type PublishGrantInput,
} from "./paymentPublish";

export interface StorageGrantInput {
  objectDigest: string;
  scopeRef: string;
  readRightRef: string;
  writeRightRef: string;
  visibility: "private" | "circle" | "public";
  forkPolicyRef: string;
  expiresAt: string;
}

export interface ForkGrantInput {
  sourceScopeRef: string;
  targetScopeRef: string;
  objectDigest: string;
  inheritedVisibility: "private" | "circle" | "public";
  newVisibility: "private" | "circle" | "public";
  forkDecisionReceiptRef: string;
  expiresAt: string;
}

export interface PublishConfirmationInput {
  paymentAuthorizationDigest: string;
  publishGrantDigest: string;
  userConfirmedPreviewDigest: string;
  nativeCeremonyVersion: string;
}

export function buildStorageGrantPayload(input: StorageGrantInput) {
  requireFields(input as unknown as Record<string, unknown>, [
    "objectDigest",
    "scopeRef",
    "readRightRef",
    "writeRightRef",
    "visibility",
    "forkPolicyRef",
    "expiresAt",
  ]);
  const payload = {
    grantType: "StorageGrant",
    ...input,
    memberDataRelease: "none",
  };
  return { payload, payloadDigest: digestJson(payload) };
}

export function buildForkGrantPayload(input: ForkGrantInput) {
  requireFields(input as unknown as Record<string, unknown>, [
    "sourceScopeRef",
    "targetScopeRef",
    "objectDigest",
    "inheritedVisibility",
    "newVisibility",
    "forkDecisionReceiptRef",
    "expiresAt",
  ]);
  const payload = {
    grantType: "ForkGrant",
    ...input,
  };
  return { payload, payloadDigest: digestJson(payload) };
}

export function buildPublishConfirmationPayload(input: PublishConfirmationInput) {
  requireFields(input as unknown as Record<string, unknown>, [
    "paymentAuthorizationDigest",
    "publishGrantDigest",
    "userConfirmedPreviewDigest",
    "nativeCeremonyVersion",
  ]);
  const payload = {
    grantType: "PublishConfirmation",
    ...input,
  };
  return { payload, payloadDigest: digestJson(payload) };
}

export function buildNativePublishCredentialSet(input: {
  payment: PaymentAuthorizationInput;
  publish: PublishGrantInput;
  confirmation: PublishConfirmationInput;
}) {
  const paymentAuthorization = buildPaymentAuthorizationPayload(input.payment);
  const publishGrant = buildPublishGrantPayload({
    ...input.publish,
    paymentAuthorizationRef: input.publish.paymentAuthorizationRef || paymentAuthorization.payloadDigest,
  });
  const publishConfirmation = buildPublishConfirmationPayload({
    ...input.confirmation,
    paymentAuthorizationDigest: input.confirmation.paymentAuthorizationDigest || paymentAuthorization.payloadDigest,
    publishGrantDigest: input.confirmation.publishGrantDigest || publishGrant.payloadDigest,
  });
  return {
    paymentAuthorization,
    publishGrant,
    publishConfirmation,
  };
}

function requireFields(input: Record<string, unknown>, fields: string[]) {
  for (const field of fields) {
    if (input[field] === undefined || input[field] === null || input[field] === "") {
      throw new Error(`hosted_app_${field}_required`);
    }
  }
}
