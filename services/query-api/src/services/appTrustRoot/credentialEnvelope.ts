import crypto from "node:crypto";

import { digestJson } from "./digest";
import type { AppTrustRootCredentialEnvelope } from "./types";

export function buildCredentialEnvelope(
  input: Omit<AppTrustRootCredentialEnvelope, "credentialId" | "chainAnchorRef" | "envelopeDigest"> & {
    credentialId?: string;
    chainAnchorRef?: string | null;
  },
): AppTrustRootCredentialEnvelope {
  const unsigned = {
    credentialId: input.credentialId || crypto.randomUUID(),
    credentialType: input.credentialType,
    issuerRef: input.issuerRef,
    subjectRef: input.subjectRef,
    audienceRef: input.audienceRef,
    scopeRef: input.scopeRef,
    replayDomain: input.replayDomain,
    nonce: input.nonce,
    payloadDigest: input.payloadDigest,
    schemaRef: input.schemaRef,
    verifierPolicyRef: input.verifierPolicyRef,
    validFrom: input.validFrom,
    expiresAt: input.expiresAt,
    revocationRef: input.revocationRef,
    chainAnchorRef: input.chainAnchorRef || null,
  };

  return {
    ...unsigned,
    envelopeDigest: digestJson(unsigned),
  };
}

export function buildOfflineVerificationBundleDigest(input: {
  issuerKeySetDigest: string;
  schemaDigestSet: string[];
  revocationSnapshotDigest: string;
  verifierPolicyDigestSet: string[];
  chainAnchorRefs: string[];
  validUntil: string;
}): string {
  return digestJson({
    issuerKeySetDigest: input.issuerKeySetDigest,
    schemaDigestSet: [...input.schemaDigestSet].sort(),
    revocationSnapshotDigest: input.revocationSnapshotDigest,
    verifierPolicyDigestSet: [...input.verifierPolicyDigestSet].sort(),
    chainAnchorRefs: [...input.chainAnchorRefs].sort(),
    validUntil: input.validUntil,
  });
}
