import type { JWK } from "jose";
import crypto from "node:crypto";

import {
  buildOfflineVerificationBundleDigest,
} from "../appTrustRoot/credentialEnvelope";
import type { AppTrustRootCredentialEnvelope } from "../appTrustRoot/types";
import {
  digestJwkSet,
  verifyCredentialJws,
  type AppTrustRootPublicJwks,
} from "../appTrustRoot/credentialJws";
import { assertRevocationFreshness } from "./credentialGovernance";
import { digestJson, stableStringify } from "./digest";
import { assertCredentialAllowedByVerifierPolicy } from "./verifierPolicies";

export async function verifyProductionOfflineVerificationBundle(input: {
  offlineBundle: Record<string, unknown>;
  trustedIssuerKeySetDigest: string;
  expectedIssuerRef: string;
  now: string;
}): Promise<Record<string, unknown>> {
  const verified = await verifyOfflineBundle(input.offlineBundle, {
    trustedIssuerKeySetDigest: input.trustedIssuerKeySetDigest,
    expectedIssuerRef: input.expectedIssuerRef,
    now: input.now,
  });
  return verified.bundle;
}

export async function verifyProductionCredentialWithOfflineBundle(input: {
  credentialJws: string;
  offlineBundle: Record<string, unknown>;
  trustedIssuerKeySetDigest: string;
  expectedIssuerRef: string;
  expectedCredentialType: string;
  expectedAudienceRef: string;
  expectedScopeRef: string;
  expectedReplayDomain: string;
  now: string;
}): Promise<{
  protectedHeader: Record<string, unknown>;
  payload: Record<string, unknown>;
  envelope: AppTrustRootCredentialEnvelope;
}> {
  const bundle = await verifyOfflineBundle(input.offlineBundle, {
    trustedIssuerKeySetDigest: input.trustedIssuerKeySetDigest,
    expectedIssuerRef: input.expectedIssuerRef,
    now: input.now,
  });
  const verified = await verifyCredentialJws({
    jws: input.credentialJws,
    jwks: bundle.jwks,
    expectedIssuerRef: input.expectedIssuerRef,
    expectedCredentialType: input.expectedCredentialType,
  });
  const protectedHeader = verified.protectedHeader;
  if (protectedHeader.typ !== "alcheme-app-trust-root+jws") {
    throw new Error("hosted_app_offline_verifier_jws_type_invalid");
  }
  const payload = asRecord(verified.payload, "hosted_app_offline_verifier_payload_invalid");
  if (payload.issuerKeySetDigest !== input.trustedIssuerKeySetDigest) {
    throw new Error("hosted_app_offline_verifier_issuer_key_set_mismatch");
  }
  if (payload.revocationSnapshotDigest !== bundle.revocationSnapshotDigest) {
    throw new Error("hosted_app_offline_verifier_revocation_digest_mismatch");
  }
  const envelope = asRecord(
    payload.envelope,
    "hosted_app_offline_verifier_envelope_invalid",
  ) as unknown as AppTrustRootCredentialEnvelope;

  if (payload.envelopeDigest !== envelope.envelopeDigest) {
    throw new Error("hosted_app_offline_verifier_envelope_digest_mismatch");
  }
  if (digestEnvelope(envelope) !== envelope.envelopeDigest) {
    throw new Error("hosted_app_offline_verifier_envelope_digest_mismatch");
  }
  if (envelope.credentialType !== input.expectedCredentialType) {
    throw new Error("hosted_app_offline_verifier_credential_type_mismatch");
  }
  if (envelope.issuerRef !== input.expectedIssuerRef) {
    throw new Error("hosted_app_offline_verifier_issuer_mismatch");
  }
  if (envelope.audienceRef !== input.expectedAudienceRef) {
    throw new Error("hosted_app_offline_verifier_audience_mismatch");
  }
  if (envelope.scopeRef !== input.expectedScopeRef) {
    throw new Error("hosted_app_offline_verifier_scope_mismatch");
  }
  if (envelope.replayDomain !== input.expectedReplayDomain) {
    throw new Error("hosted_app_offline_verifier_replay_domain_mismatch");
  }
  if (envelope.revocationRef !== bundle.revocationSnapshot.feedRef) {
    throw new Error("hosted_app_offline_verifier_revocation_ref_mismatch");
  }
  const nowMs = Date.parse(input.now);
  if (Number.isNaN(nowMs)) throw new Error("hosted_app_offline_verifier_time_invalid");
  if (Date.parse(envelope.validFrom) > nowMs) {
    throw new Error("hosted_app_offline_verifier_not_yet_valid");
  }
  if (Date.parse(envelope.expiresAt) <= nowMs) {
    throw new Error("hosted_app_offline_verifier_expired");
  }

  const schemaDocument = bundle.schemaDocuments[envelope.schemaRef];
  if (!schemaDocument) throw new Error("hosted_app_offline_verifier_schema_missing");
  const schemaDigest = digestJson(schemaDocument);
  if (!bundle.credentialSchemaDigests.includes(schemaDigest) || payload.schemaDigest !== schemaDigest) {
    throw new Error("hosted_app_offline_verifier_schema_digest_mismatch");
  }
  const policyDocument = bundle.policyDocuments[envelope.verifierPolicyRef];
  if (!policyDocument) throw new Error("hosted_app_offline_verifier_policy_missing");
  const policyDigest = digestJson(policyDocument);
  if (!bundle.verifierPolicyDigests.includes(policyDigest) || payload.verifierPolicyDigest !== policyDigest) {
    throw new Error("hosted_app_offline_verifier_policy_digest_mismatch");
  }
  assertCredentialAllowedByVerifierPolicy(policyDocument, {
    credentialType: input.expectedCredentialType,
    algorithm: String(protectedHeader.alg || ""),
    issuerActive: true,
    schemaActive: true,
    revocationFresh: true,
  });

  assertRevocationFreshness({
    credentialType: input.expectedCredentialType,
    revocationSnapshotIssuedAt: String(bundle.revocationSnapshotIssuedAt),
    now: input.now,
    maxRevocationFeedAgeMs: Number(bundle.maxRevocationFeedAgeMs),
    staleFeedFailureMode: "fail_closed",
  });
  assertCredentialNotRevoked(bundle.revocationSnapshot, envelope);

  return { protectedHeader, payload, envelope };
}

async function verifyOfflineBundle(
  offlineBundle: Record<string, unknown>,
  input: {
    trustedIssuerKeySetDigest: string;
    expectedIssuerRef: string;
    now: string;
  },
) {
  const jwks = asJwks(offlineBundle.jwks);
  const issuerKeySetDigest = digestJwkSet(jwks);
  if (
    issuerKeySetDigest !== input.trustedIssuerKeySetDigest ||
    offlineBundle.issuerKeySetDigest !== input.trustedIssuerKeySetDigest
  ) {
    throw new Error("hosted_app_offline_verifier_issuer_key_set_mismatch");
  }
  const bundleJws = requireString(offlineBundle.bundleJws, "hosted_app_offline_verifier_bundle_jws_missing");
  const verifiedBundle = await verifyCredentialJws({
    jws: bundleJws,
    jwks,
    expectedIssuerRef: input.expectedIssuerRef,
    expectedCredentialType: "OfflineVerificationBundle",
  });
  const bundlePayload = asRecord(
    verifiedBundle.payload,
    "hosted_app_offline_verifier_bundle_payload_invalid",
  );
  const signedJwks = asJwks(bundlePayload.jwks);
  if (
    digestJwkSet(signedJwks) !== issuerKeySetDigest ||
    bundlePayload.issuerKeySetDigest !== input.trustedIssuerKeySetDigest ||
    bundlePayload.issuerKeySetRef !== input.expectedIssuerRef
  ) {
    throw new Error("hosted_app_offline_verifier_issuer_key_set_mismatch");
  }
  if (bundlePayload.bundleDigest !== offlineBundle.bundleDigest) {
    throw new Error("hosted_app_offline_verifier_bundle_digest_mismatch");
  }
  const schemaDocuments = asRecord(
    bundlePayload.schemaDocuments,
    "hosted_app_offline_verifier_schema_missing",
  );
  const policyDocuments = asRecord(
    bundlePayload.policyDocuments,
    "hosted_app_offline_verifier_policy_missing",
  );
  const revocationSnapshot = asRecord(
    bundlePayload.revocationSnapshot,
    "hosted_app_offline_verifier_revocation_missing",
  );
  const revocationFeedPublicJwk = asRecord(
    bundlePayload.revocationFeedPublicJwk,
    "hosted_app_offline_verifier_revocation_key_missing",
  ) as unknown as JWK;
  const credentialSchemaDigests = stringArray(bundlePayload.credentialSchemaDigests);
  const verifierPolicyDigests = stringArray(bundlePayload.verifierPolicyDigests);
  const revocationSnapshotDigest = requireString(
    bundlePayload.revocationSnapshotDigest,
    "hosted_app_offline_verifier_revocation_missing",
  );
  if (revocationSnapshot.snapshotDigest !== revocationSnapshotDigest) {
    throw new Error("hosted_app_offline_verifier_revocation_digest_mismatch");
  }
  if (digestRevocationSnapshot(revocationSnapshot) !== revocationSnapshotDigest) {
    throw new Error("hosted_app_offline_verifier_revocation_digest_mismatch");
  }
  assertRevocationFeedProof(revocationSnapshot, revocationFeedPublicJwk);
  const revocationSnapshotIssuedAt = requireString(
    bundlePayload.revocationSnapshotIssuedAt,
    "hosted_app_offline_verifier_revocation_missing",
  );
  if (String(revocationSnapshot.issuedAt || "") !== revocationSnapshotIssuedAt) {
    throw new Error("hosted_app_offline_verifier_revocation_freshness_mismatch");
  }
  const snapshotMaxAgeMs = revocationSnapshot.maxAgeMs;
  if (
    snapshotMaxAgeMs != null &&
    Number(bundlePayload.maxRevocationFeedAgeMs) > Number(snapshotMaxAgeMs)
  ) {
    throw new Error("hosted_app_offline_verifier_revocation_freshness_mismatch");
  }
  const snapshotValidUntilMs = revocationSnapshot.validUntil == null
    ? null
    : Date.parse(String(revocationSnapshot.validUntil));
  if (snapshotValidUntilMs !== null && Number.isNaN(snapshotValidUntilMs)) {
    throw new Error("hosted_app_offline_verifier_time_invalid");
  }
  const expectedBundleDigest = buildOfflineVerificationBundleDigest({
    issuerKeySetDigest,
    schemaDigestSet: credentialSchemaDigests,
    revocationSnapshotDigest,
    verifierPolicyDigestSet: verifierPolicyDigests,
    chainAnchorRefs: stringArray(bundlePayload.chainAnchorRefs),
    validUntil: requireString(bundlePayload.expiresAt, "hosted_app_offline_verifier_expiry_missing"),
  });
  if (expectedBundleDigest !== bundlePayload.bundleDigest) {
    throw new Error("hosted_app_offline_verifier_bundle_digest_mismatch");
  }
  const expiresAtMs = Date.parse(String(bundlePayload.expiresAt));
  const nowMs = Date.parse(input.now);
  if (Number.isNaN(expiresAtMs) || Number.isNaN(nowMs)) {
    throw new Error("hosted_app_offline_verifier_time_invalid");
  }
  if (expiresAtMs <= nowMs) {
    throw new Error("hosted_app_offline_verifier_bundle_expired");
  }
  if (snapshotValidUntilMs !== null && expiresAtMs > snapshotValidUntilMs) {
    throw new Error("hosted_app_offline_verifier_revocation_freshness_mismatch");
  }
  const chainAnchorRefs = stringArray(bundlePayload.chainAnchorRefs);
  if (chainAnchorRefs.length === 0) {
    throw new Error("hosted_app_offline_verifier_chain_anchor_required");
  }
  const bundle = {
    ...bundlePayload,
    bundleId: requireString(bundlePayload.bundleId, "hosted_app_offline_verifier_bundle_id_missing"),
    credentialType: "OfflineVerificationBundle",
    issuerKeySetDigest,
    issuerKeySetRef: input.expectedIssuerRef,
    jwks,
    credentialSchemaDigests,
    schemaDocuments,
    verifierPolicyDigests,
    policyDocuments,
    revocationSnapshot,
    revocationFeedPublicJwk,
    revocationSnapshotDigest,
    revocationSnapshotIssuedAt,
    maxRevocationFeedAgeMs: Number(bundlePayload.maxRevocationFeedAgeMs),
    chainAnchorRefs,
    validityWindow: String(bundlePayload.validityWindow || ""),
    redactionPolicyRef: String(bundlePayload.redactionPolicyRef || ""),
    expiresAt: requireString(bundlePayload.expiresAt, "hosted_app_offline_verifier_expiry_missing"),
    bundleDigest: requireString(bundlePayload.bundleDigest, "hosted_app_offline_verifier_bundle_digest_missing"),
    bundleJws,
    bundleSignature: bundleJws,
  };
  return {
    ...bundle,
    bundle,
  };
}

function assertCredentialNotRevoked(
  revocationSnapshot: Record<string, unknown>,
  envelope: AppTrustRootCredentialEnvelope,
): void {
  if (stringArray(revocationSnapshot.revokedCredentialIds).includes(envelope.credentialId)) {
    throw new Error("hosted_app_offline_verifier_credential_revoked");
  }
  if (stringArray(revocationSnapshot.revokedIssuerRefs).includes(envelope.issuerRef)) {
    throw new Error("hosted_app_offline_verifier_issuer_revoked");
  }
  if (stringArray(revocationSnapshot.revokedSchemaRefs).includes(envelope.schemaRef)) {
    throw new Error("hosted_app_offline_verifier_schema_revoked");
  }
}

function digestEnvelope(envelope: AppTrustRootCredentialEnvelope): string {
  return digestJson({
    credentialId: envelope.credentialId,
    credentialType: envelope.credentialType,
    issuerRef: envelope.issuerRef,
    subjectRef: envelope.subjectRef,
    audienceRef: envelope.audienceRef,
    scopeRef: envelope.scopeRef,
    replayDomain: envelope.replayDomain,
    nonce: envelope.nonce,
    payloadDigest: envelope.payloadDigest,
    schemaRef: envelope.schemaRef,
    verifierPolicyRef: envelope.verifierPolicyRef,
    validFrom: envelope.validFrom,
    expiresAt: envelope.expiresAt,
    revocationRef: envelope.revocationRef,
    chainAnchorRef: envelope.chainAnchorRef,
  });
}

function digestRevocationSnapshot(snapshot: Record<string, unknown>): string {
  return digestJson({
    feedRef: snapshot.feedRef,
    feedClass: snapshot.feedClass,
    revokedCredentialIds: stringArray(snapshot.revokedCredentialIds),
    revokedIssuerRefs: stringArray(snapshot.revokedIssuerRefs),
    revokedSchemaRefs: stringArray(snapshot.revokedSchemaRefs),
    issuedAt: snapshot.issuedAt,
    validUntil: snapshot.validUntil,
    maxAgeMs: snapshot.maxAgeMs ?? null,
    staleFailureMode: snapshot.staleFailureMode,
    feedSequence: snapshot.feedSequence,
    feedPolicyRef: snapshot.feedPolicyRef,
    chainAnchorRef: snapshot.chainAnchorRef ?? null,
  });
}

function assertRevocationFeedProof(
  snapshot: Record<string, unknown>,
  publicJwk: JWK,
): void {
  if (snapshot.staleFailureMode !== "fail_closed") {
    throw new Error("hosted_app_offline_verifier_revocation_not_fail_closed");
  }
  const validUntil = requireString(snapshot.validUntil, "hosted_app_offline_verifier_revocation_missing");
  const validUntilMs = Date.parse(validUntil);
  if (Number.isNaN(validUntilMs)) {
    throw new Error("hosted_app_offline_verifier_time_invalid");
  }
  const feedSequence = Number(snapshot.feedSequence);
  if (!Number.isInteger(feedSequence) || feedSequence <= 0) {
    throw new Error("hosted_app_offline_verifier_revocation_sequence_invalid");
  }
  if (!String(snapshot.feedPolicyRef || "").trim()) {
    throw new Error("hosted_app_offline_verifier_revocation_policy_missing");
  }
  const feedSignature = requireString(
    snapshot.feedSignature,
    "hosted_app_offline_verifier_revocation_signature_missing",
  );
  const [scheme, encodedSignature] = splitSignature(feedSignature);
  if (scheme !== "ed25519" || !encodedSignature) {
    throw new Error("hosted_app_offline_verifier_revocation_signature_invalid");
  }
  try {
    const key = crypto.createPublicKey({ key: publicJwk as any, format: "jwk" });
    const unsignedMaterial = {
      feedRef: snapshot.feedRef,
      feedClass: snapshot.feedClass,
      revokedCredentialIds: stringArray(snapshot.revokedCredentialIds),
      revokedIssuerRefs: stringArray(snapshot.revokedIssuerRefs),
      revokedSchemaRefs: stringArray(snapshot.revokedSchemaRefs),
      issuedAt: snapshot.issuedAt,
      validUntil: snapshot.validUntil,
      maxAgeMs: snapshot.maxAgeMs ?? null,
      staleFailureMode: snapshot.staleFailureMode,
      feedSequence: snapshot.feedSequence,
      feedPolicyRef: snapshot.feedPolicyRef,
      chainAnchorRef: snapshot.chainAnchorRef ?? null,
    };
    const valid = crypto.verify(
      null,
      Buffer.from(stableStringify(unsignedMaterial)),
      key,
      Buffer.from(encodedSignature, "base64url"),
    );
    if (!valid) {
      throw new Error("invalid signature");
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("hosted_app_")) throw error;
    throw new Error("hosted_app_offline_verifier_revocation_signature_invalid");
  }
}

function splitSignature(value: string): [string, string] {
  const index = value.indexOf(":");
  if (index <= 0 || index === value.length - 1) return ["", ""];
  return [value.slice(0, index), value.slice(index + 1)];
}

function asJwks(value: unknown): AppTrustRootPublicJwks {
  const record = asRecord(value, "hosted_app_offline_verifier_jwks_missing");
  if (!Array.isArray(record.keys)) {
    throw new Error("hosted_app_offline_verifier_jwks_missing");
  }
  return { keys: record.keys as JWK[] };
}

function asRecord(value: unknown, errorCode: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(errorCode);
  return value as Record<string, unknown>;
}

function requireString(value: unknown, errorCode: string): string {
  if (typeof value === "string" && value.trim()) return value;
  throw new Error(errorCode);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry)).filter(Boolean);
}
