import crypto from "node:crypto";

import {
  buildCredentialEnvelope,
  buildOfflineVerificationBundleDigest,
} from "../appTrustRoot/credentialEnvelope";
import type { AppTrustRootCredentialEnvelope } from "../appTrustRoot/types";
import {
  buildPublicJwks,
  digestJwkSet,
  signCredentialJws,
} from "../appTrustRoot/credentialJws";
import type { HostedAppProductionCredentialContext } from "./credentialRegistry";
import { validateCredentialPayloadForSchema } from "./credentialSchemas";
import { digestJson, stableStringify } from "./digest";
import { assertCredentialAllowedByVerifierPolicy } from "./verifierPolicies";

export interface HostedAppCredentialIssuer {
  issuerId: string;
  issuerKeyVersion: string;
  algorithm: "hmac-sha256-dev";
  secret: string;
}

export function createDevCredentialIssuer(
  secret: string,
  options: { nodeEnv?: string } = {},
): HostedAppCredentialIssuer {
  const nodeEnv = String(options.nodeEnv ?? process.env.NODE_ENV ?? "")
    .trim()
    .toLowerCase();
  if (nodeEnv === "production") {
    throw new Error(
      "hosted_app_dev_credential_issuer_not_allowed_in_production",
    );
  }
  return {
    issuerId: "alcheme-dev-hosted-app-issuer",
    issuerKeyVersion: "dev-v1",
    algorithm: "hmac-sha256-dev",
    secret,
  };
}

export function signPayload(
  issuer: HostedAppCredentialIssuer,
  payload: unknown,
): string {
  return `sha256:${crypto
    .createHmac("sha256", issuer.secret)
    .update(stableStringify(payload))
    .digest("hex")}`;
}

export function verifyHostedAppCredential(
  issuer: HostedAppCredentialIssuer,
  credential: { signature: string; [key: string]: unknown },
): { ok: boolean; reason?: string } {
  const { signature, ...unsigned } = credential;
  const expected = signPayload(issuer, unsigned);
  return signature === expected
    ? { ok: true }
    : { ok: false, reason: "signature_mismatch" };
}

export function issueRuntimeAttestation(
  issuer: HostedAppCredentialIssuer,
  payload: {
    appId: string;
    releaseId: string;
    manifestHash: string;
    bundleHash: string;
    circleId: number;
    userPubkey: string;
    capabilitySetDigest: string;
    sandboxOrigin: string;
    runtimeVersion: string;
    sessionId: string;
    nonce: string;
  },
) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60_000);
  const envelope = buildCredentialEnvelope({
    credentialType: "runtime_attestation",
    issuerRef: `${issuer.issuerId}:${issuer.issuerKeyVersion}`,
    subjectRef: `${payload.appId}:${payload.releaseId}:${payload.sessionId}`,
    audienceRef: payload.sandboxOrigin,
    scopeRef: `circle:${payload.circleId}`,
    replayDomain: "alcheme-hosted-app-runtime",
    nonce: payload.nonce,
    payloadDigest: digestJson(payload),
    schemaRef: "runtime_attestation.v1",
    verifierPolicyRef: "hosted-app-runtime.v1",
    validFrom: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    revocationRef: null,
  });
  const unsigned = {
    ...envelope,
    issuerId: issuer.issuerId,
    issuerKeyVersion: issuer.issuerKeyVersion,
  };
  return { ...unsigned, signature: signPayload(issuer, unsigned) };
}

export interface RuntimeAttestationPayload {
  appId: string;
  releaseId: string;
  manifestHash: string;
  bundleHash: string;
  circleId: number;
  userPubkey: string;
  capabilitySetDigest: string;
  sandboxOrigin: string;
  runtimeVersion: string;
  sessionId: string;
  nonce: string;
}

export interface ProductionSignedCredential {
  credentialType: string;
  envelope: AppTrustRootCredentialEnvelope;
  jws: string;
  issuerKeySetDigest: string;
  schemaDigest: string;
  verifierPolicyDigest: string;
  revocationSnapshotDigest: string;
  chainAnchorRefs: string[];
}

export async function issueProductionRuntimeAttestation(
  context: HostedAppProductionCredentialContext,
  payload: RuntimeAttestationPayload,
  options: { now?: Date } = {},
): Promise<
  ProductionSignedCredential & { payload: RuntimeAttestationPayload }
> {
  assertCredentialContextMatches(context, {
    credentialType: "runtime_attestation",
    schemaRef: "runtime_attestation.v1",
    verifierPolicyRef: "hosted-app-runtime.v1",
  });
  const validation = validateCredentialPayloadForSchema(
    context.schemaDocument,
    payload,
  );
  if (!validation.ok) throw new Error(validation.reason);

  const now = options.now ?? new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60_000);
  const envelope = buildCredentialEnvelope({
    credentialType: "runtime_attestation",
    issuerRef: context.issuerRef,
    subjectRef: `${payload.appId}:${payload.releaseId}:${payload.sessionId}`,
    audienceRef: payload.sandboxOrigin,
    scopeRef: `circle:${payload.circleId}`,
    replayDomain: "alcheme-hosted-app-runtime",
    nonce: payload.nonce,
    payloadDigest: digestJson(payload),
    schemaRef: context.schemaRef,
    verifierPolicyRef: context.verifierPolicyRef,
    validFrom: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    revocationRef: context.revocationRef,
  });
  const signed = await signProductionCredentialEnvelope(context, envelope);
  return { ...signed, payload };
}

export function issueHostedAppGrantCredential(
  issuer: HostedAppCredentialIssuer,
  payload: {
    credentialType:
      | "StorageGrant"
      | "ForkGrant"
      | "PaymentAuthorization"
      | "PublishGrant"
      | "PublishConfirmation";
    subjectRef: string;
    audienceRef: string;
    scopeRef: string;
    payloadDigest: string;
    schemaRef: string;
    verifierPolicyRef: string;
    nonce: string;
    expiresAt: string;
  },
) {
  const envelope = buildCredentialEnvelope({
    credentialType: payload.credentialType,
    issuerRef: `${issuer.issuerId}:${issuer.issuerKeyVersion}`,
    subjectRef: payload.subjectRef,
    audienceRef: payload.audienceRef,
    scopeRef: payload.scopeRef,
    replayDomain: "alcheme-hosted-app-grants",
    nonce: payload.nonce,
    payloadDigest: payload.payloadDigest,
    schemaRef: payload.schemaRef,
    verifierPolicyRef: payload.verifierPolicyRef,
    validFrom: new Date().toISOString(),
    expiresAt: payload.expiresAt,
    revocationRef: null,
  });
  const unsigned = {
    ...envelope,
    issuerId: issuer.issuerId,
    issuerKeyVersion: issuer.issuerKeyVersion,
  };
  return { ...unsigned, signature: signPayload(issuer, unsigned) };
}

export async function issueProductionHostedAppGrantCredential(
  context: HostedAppProductionCredentialContext,
  payload: {
    credentialType:
      | "StorageGrant"
      | "ForkGrant"
      | "PaymentAuthorization"
      | "PublishGrant"
      | "PublishConfirmation";
    subjectRef: string;
    audienceRef: string;
    scopeRef: string;
    payloadDigest: string;
    schemaRef: string;
    verifierPolicyRef: string;
    nonce: string;
    expiresAt: string;
  },
  options: { now?: Date } = {},
): Promise<ProductionSignedCredential> {
  assertCredentialContextMatches(context, {
    credentialType: payload.credentialType,
    schemaRef: payload.schemaRef,
    verifierPolicyRef: payload.verifierPolicyRef,
  });
  const now = options.now ?? new Date();
  const envelope = buildCredentialEnvelope({
    credentialType: payload.credentialType,
    issuerRef: context.issuerRef,
    subjectRef: payload.subjectRef,
    audienceRef: payload.audienceRef,
    scopeRef: payload.scopeRef,
    replayDomain: "alcheme-hosted-app-grants",
    nonce: payload.nonce,
    payloadDigest: payload.payloadDigest,
    schemaRef: payload.schemaRef,
    verifierPolicyRef: payload.verifierPolicyRef,
    validFrom: now.toISOString(),
    expiresAt: payload.expiresAt,
    revocationRef: context.revocationRef,
  });
  return signProductionCredentialEnvelope(context, envelope);
}

export async function signProductionCredentialEnvelope(
  context: HostedAppProductionCredentialContext,
  envelope: AppTrustRootCredentialEnvelope,
): Promise<ProductionSignedCredential> {
  const chainAnchorRefs = readContextChainAnchorRefs(context);
  assertRequiredCredentialChainAnchors(context, chainAnchorRefs);
  const signedPayload = {
    credentialType: envelope.credentialType,
    envelopeDigest: envelope.envelopeDigest,
    envelope,
    payloadDigest: envelope.payloadDigest,
    issuerKeySetDigest: context.issuerKeySetDigest,
    schemaDigest: context.schemaDigest,
    verifierPolicyDigest: context.verifierPolicyDigest,
    revocationSnapshotDigest: context.revocationSnapshotDigest,
    chainAnchorRefs,
  };
  const jws = await signCredentialJws({
    payload: signedPayload,
    issuerRef: context.issuerRef,
    privateJwk: context.privateJwk,
    keyId: context.keyId,
    algorithm: context.algorithm,
  });
  return {
    credentialType: envelope.credentialType,
    envelope,
    jws,
    issuerKeySetDigest: context.issuerKeySetDigest,
    schemaDigest: context.schemaDigest,
    verifierPolicyDigest: context.verifierPolicyDigest,
    revocationSnapshotDigest: context.revocationSnapshotDigest,
    chainAnchorRefs,
  };
}

export function buildOfflineVerificationBundle(
  issuer: HostedAppCredentialIssuer,
  input: {
    credentialSchemaDigests: string[];
    verifierPolicyDigests: string[];
    revocationSnapshotDigest: string;
    chainAnchorRefs: string[];
    maxRevocationFeedAgeMs: number;
  },
) {
  const issuerKeySetDigest = digestJson({
    issuerId: issuer.issuerId,
    issuerKeyVersion: issuer.issuerKeyVersion,
    algorithm: issuer.algorithm,
  });
  const validUntil = new Date(
    Date.now() + input.maxRevocationFeedAgeMs,
  ).toISOString();
  const bundleDigest = buildOfflineVerificationBundleDigest({
    issuerKeySetDigest,
    schemaDigestSet: input.credentialSchemaDigests,
    revocationSnapshotDigest: input.revocationSnapshotDigest,
    verifierPolicyDigestSet: input.verifierPolicyDigests,
    chainAnchorRefs: input.chainAnchorRefs,
    validUntil,
  });
  const unsigned = {
    bundleId: crypto.randomUUID(),
    issuerKeySetDigest,
    issuerKeySetRef: issuer.issuerId,
    credentialSchemaDigests: input.credentialSchemaDigests,
    verifierPolicyDigests: input.verifierPolicyDigests,
    revocationSnapshotDigest: input.revocationSnapshotDigest,
    revocationSnapshotIssuedAt: new Date().toISOString(),
    maxRevocationFeedAgeMs: input.maxRevocationFeedAgeMs,
    chainAnchorRefs: input.chainAnchorRefs,
    validityWindow: "PT5M",
    redactionPolicyRef: "hosted-app-redaction.v1",
    bundleDigest,
  };

  return { ...unsigned, bundleSignature: signPayload(issuer, unsigned) };
}

export async function buildProductionOfflineVerificationBundle(
  contexts: HostedAppProductionCredentialContext[],
  options: {
    now?: Date;
    chainAnchorRefs?: string[];
    requireChainAnchors?: boolean;
    bundleId?: string;
    redactionPolicyRef?: string;
  } = {},
) {
  if (contexts.length === 0) {
    throw new Error("hosted_app_offline_verification_context_required");
  }
  const now = options.now ?? new Date();
  const signerContext = contexts[0];
  const maxRevocationFeedAgeMs = Math.min(
    ...contexts.map((context) => context.maxRevocationFeedAgeMs),
  );
  const validUntilMs = Math.min(
    now.getTime() + maxRevocationFeedAgeMs,
    ...contexts
      .map((context) =>
        readRevocationSnapshotValidUntilMs(context.revocationSnapshot),
      )
      .filter((value): value is number => value !== null),
  );
  if (validUntilMs <= now.getTime()) {
    throw new Error(
      "hosted_app_offline_verification_revocation_snapshot_expired",
    );
  }
  const validUntil = new Date(validUntilMs).toISOString();
  const jwks = {
    keys: uniquePublicJwks(
      contexts.flatMap((context) => context.publicJwks.keys),
    ),
  };
  const revocationSnapshotDigests = uniqueStrings(
    contexts.map((context) => context.revocationSnapshotDigest),
  );
  if (revocationSnapshotDigests.length !== 1) {
    throw new Error(
      "hosted_app_offline_verification_revocation_snapshot_mismatch",
    );
  }
  const revocationFeedPublicJwk = uniqueRevocationFeedPublicJwk(
    contexts.map((context) => context.revocationFeedPublicJwk),
  );
  const schemaDocuments = Object.fromEntries(
    contexts.map((context) => [context.schemaRef, context.schemaDocument]),
  );
  const policyDocuments = Object.fromEntries(
    contexts.map((context) => [
      context.verifierPolicyRef,
      context.verifierPolicyDocument,
    ]),
  );
  const issuerKeySetDigest = digestJwkSet(jwks);
  const credentialSchemaDigests = uniqueStrings(
    contexts.map((context) => context.schemaDigest),
  );
  const verifierPolicyDigests = uniqueStrings(
    contexts.map((context) => context.verifierPolicyDigest),
  );
  const revocationSnapshotDigest = revocationSnapshotDigests[0];
  const contextChainAnchorRefs = uniqueStrings(
    contexts.flatMap(readContextChainAnchorRefs),
  );
  const chainAnchorRefs = options.chainAnchorRefs ?? contextChainAnchorRefs;
  if (options.requireChainAnchors === true && chainAnchorRefs.length === 0) {
    throw new Error("hosted_app_offline_verification_chain_anchor_required");
  }
  const bundleDigest = buildOfflineVerificationBundleDigest({
    issuerKeySetDigest,
    schemaDigestSet: credentialSchemaDigests,
    revocationSnapshotDigest,
    verifierPolicyDigestSet: verifierPolicyDigests,
    chainAnchorRefs,
    validUntil,
  });
  const unsigned = {
    bundleId: options.bundleId ?? crypto.randomUUID(),
    credentialType: "OfflineVerificationBundle",
    issuerKeySetDigest,
    issuerKeySetRef: signerContext.issuerRef,
    jwks,
    credentialSchemaDigests,
    schemaDocuments,
    verifierPolicyDigests,
    policyDocuments,
    revocationSnapshot: {
      ...asRecord(signerContext.revocationSnapshot),
      snapshotDigest: revocationSnapshotDigest,
    },
    revocationFeedPublicJwk,
    revocationSnapshotDigest,
    revocationSnapshotIssuedAt: signerContext.revocationSnapshotIssuedAt,
    maxRevocationFeedAgeMs,
    chainAnchorRefs,
    chainAnchorFreshness: {
      checkedAt: now.toISOString(),
      maxRevocationFeedAgeMs,
      chainAnchorRefs,
    },
    validityWindow: "PT5M",
    redactionPolicyRef:
      options.redactionPolicyRef ?? "hosted-app-redaction.v1",
    expiresAt: validUntil,
    bundleDigest,
  };
  const bundleJws = await signCredentialJws({
    payload: unsigned,
    issuerRef: signerContext.issuerRef,
    privateJwk: signerContext.privateJwk,
    keyId: signerContext.keyId,
    algorithm: signerContext.algorithm,
  });
  return {
    ...unsigned,
    bundleJws,
    bundleSignature: bundleJws,
  };
}

function assertCredentialContextMatches(
  context: HostedAppProductionCredentialContext,
  input: {
    credentialType: string;
    schemaRef: string;
    verifierPolicyRef: string;
  },
): void {
  if (context.schemaRef !== input.schemaRef) {
    throw new Error("hosted_app_credential_schema_context_mismatch");
  }
  if (context.verifierPolicyRef !== input.verifierPolicyRef) {
    throw new Error("hosted_app_verifier_policy_context_mismatch");
  }
  const allowedCredentialTypes = Array.isArray(
    (context.verifierPolicyDocument as { allowedCredentialTypes?: unknown })
      .allowedCredentialTypes,
  )
    ? (
        context.verifierPolicyDocument as { allowedCredentialTypes: unknown[] }
      ).allowedCredentialTypes.map(String)
    : [];
  if (!allowedCredentialTypes.includes(input.credentialType)) {
    throw new Error("hosted_app_verifier_policy_credential_type_denied");
  }
  assertCredentialAllowedByVerifierPolicy(context.verifierPolicyDocument, {
    credentialType: input.credentialType,
    algorithm: context.algorithm,
    issuerActive: true,
    schemaActive: true,
    revocationFresh: true,
  });
}

function readContextChainAnchorRefs(
  context: HostedAppProductionCredentialContext,
): string[] {
  const refs = context.chainAnchorRefs || {};
  return uniqueStrings(
    Object.values(refs).filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    ),
  );
}

function assertRequiredCredentialChainAnchors(
  context: HostedAppProductionCredentialContext,
  chainAnchorRefs: string[],
): void {
  if (context.requireChainAnchors === true && chainAnchorRefs.length === 0) {
    throw new Error("hosted_app_credential_chain_anchor_required");
  }
}

function uniquePublicJwks(items: import("jose").JWK[]): import("jose").JWK[] {
  const byKid = new Map<string, import("jose").JWK>();
  for (const item of items) {
    const key = String(item.kid || "");
    if (!key) throw new Error("hosted_app_offline_verification_key_id_missing");
    const existing = byKid.get(key);
    if (!existing) {
      byKid.set(key, item);
      continue;
    }
    if (
      digestJwkSet({ keys: [existing as any] }) !==
      digestJwkSet({ keys: [item as any] })
    ) {
      throw new Error("hosted_app_offline_verification_key_conflict");
    }
  }
  return Array.from(byKid.values());
}

function uniqueRevocationFeedPublicJwk(
  items: import("jose").JWK[],
): import("jose").JWK {
  const publicItems = items.map((item) => buildPublicJwks([item]).keys[0]);
  const digests = uniqueStrings(
    items.map((item) => digestJwkSet(buildPublicJwks([item]))),
  );
  if (digests.length !== 1) {
    throw new Error(
      "hosted_app_offline_verification_revocation_feed_key_mismatch",
    );
  }
  return publicItems[0];
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readRevocationSnapshotValidUntilMs(value: unknown): number | null {
  const record = asRecord(value);
  const validUntil = record.validUntil;
  if (validUntil == null || validUntil === "") return null;
  const parsed = Date.parse(String(validUntil));
  if (Number.isNaN(parsed)) {
    throw new Error(
      "hosted_app_offline_verification_revocation_snapshot_invalid",
    );
  }
  return parsed;
}
