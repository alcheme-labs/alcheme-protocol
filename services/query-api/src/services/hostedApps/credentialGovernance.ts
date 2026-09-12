import { randomUUID } from "node:crypto";

import { digestJson } from "./digest";

export function buildCredentialIssuerChangeReceipt(input: {
  issuerId: string;
  previousKeyVersion: string;
  nextKeyVersion: string;
  changeType: "rotate_key" | "compromise_revoke" | "emergency_disable";
  affectedCredentialTypes: string[];
  oldKeyValidUntil: string;
  newKeyValidFrom: string;
  overlapWindow: string;
  failClosedCredentialTypes: string[];
  reasonCode: string;
  approvalReceiptRef: string;
  effectiveAt: string;
}) {
  const base = {
    receiptId: randomUUID(),
    receiptType: "hosted_app_credential_issuer_change",
    ...input,
  };
  return { ...base, receiptDigest: digestJson(base) };
}

export function buildCredentialSchemaChangeReceipt(input: {
  schemaId: string;
  previousSchemaVersion: string;
  nextSchemaVersion: string;
  changeType: "add_version" | "emergency_disable" | "deprecate";
  compatibilityClass: "compatible" | "breaking";
  before: unknown;
  after: unknown;
  affectedCredentialTypes: string[];
  verifierPolicyImpact: { minimumVerifierPolicyVersion: string };
  approvalReceiptRef: string;
  effectiveAt: string;
}) {
  const beforeDigest = digestJson(input.before);
  const afterDigest = digestJson(input.after);
  const base = {
    receiptId: randomUUID(),
    receiptType: "hosted_app_credential_schema_change",
    schemaId: input.schemaId,
    previousSchemaVersion: input.previousSchemaVersion,
    nextSchemaVersion: input.nextSchemaVersion,
    changeType: input.changeType,
    compatibilityClass: input.compatibilityClass,
    beforeDigest,
    afterDigest,
    affectedCredentialTypes: input.affectedCredentialTypes,
    verifierPolicyImpact: input.verifierPolicyImpact,
    approvalReceiptRef: input.approvalReceiptRef,
    effectiveAt: input.effectiveAt,
  };
  return { ...base, receiptDigest: digestJson(base) };
}

export function assertRevocationFreshness(input: {
  credentialType: string;
  revocationSnapshotIssuedAt: string;
  now: string;
  maxRevocationFeedAgeMs: number;
  staleFeedFailureMode: "fail_open_with_warning" | "fail_closed";
}): void {
  const nowMs = Date.parse(input.now);
  const issuedAtMs = Date.parse(input.revocationSnapshotIssuedAt);
  if (
    Number.isNaN(nowMs) ||
    Number.isNaN(issuedAtMs) ||
    !Number.isFinite(input.maxRevocationFeedAgeMs) ||
    input.maxRevocationFeedAgeMs <= 0
  ) {
    throw new Error("hosted_app_revocation_feed_time_invalid");
  }
  if (issuedAtMs > nowMs) {
    throw new Error("hosted_app_revocation_feed_issued_in_future");
  }
  const ageMs = nowMs - issuedAtMs;
  if (ageMs > input.maxRevocationFeedAgeMs && input.staleFeedFailureMode === "fail_closed") {
    throw new Error("hosted_app_revocation_feed_stale");
  }
}

export function assertCredentialTypeFailClosedOnCompromise(input: {
  credentialType: string;
  issuerStatus: string;
  failClosedCredentialTypes: string[];
}): void {
  if (
    input.issuerStatus === "compromised" &&
    input.failClosedCredentialTypes.includes(input.credentialType)
  ) {
    throw new Error("hosted_app_credential_issuer_compromised");
  }
}
