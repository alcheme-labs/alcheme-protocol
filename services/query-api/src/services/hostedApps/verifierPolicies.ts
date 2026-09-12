import { digestJson } from "./digest";

const verifierPolicies: Record<string, Record<string, unknown>> = {
  "hosted-app-runtime.v1": {
    policyRef: "hosted-app-runtime.v1",
    allowedCredentialTypes: ["runtime_attestation"],
    allowedAlgorithms: ["ES256", "EdDSA", "RS256"],
    maxRevocationFeedAgeMs: 60_000,
    staleRevocationFailureMode: "fail_closed",
  },
  "hosted-app-governance.v1": {
    policyRef: "hosted-app-governance.v1",
    allowedCredentialTypes: ["GovernanceDecisionReceipt"],
    allowedAlgorithms: ["ES256", "EdDSA", "RS256"],
    maxRevocationFeedAgeMs: 60_000,
    staleRevocationFailureMode: "fail_closed",
    requiredBindings: [
      "operationId",
      "payloadDigest",
      "executionTargetRef",
      "executionNonce",
      "statePreconditionDigest",
    ],
  },
  "hosted-app-grants.v1": {
    policyRef: "hosted-app-grants.v1",
    allowedCredentialTypes: [
      "StorageGrant",
      "ForkGrant",
      "PaymentAuthorization",
      "PublishGrant",
      "PublishConfirmation",
    ],
    allowedAlgorithms: ["ES256", "EdDSA", "RS256"],
    maxRevocationFeedAgeMs: 60_000,
    staleRevocationFailureMode: "fail_closed",
  },
};

export function getHostedAppVerifierPolicyDocument(policyRef: string): Record<string, unknown> {
  const policy = verifierPolicies[policyRef];
  if (!policy) throw new Error("hosted_app_verifier_policy_unregistered");
  return policy;
}

export function getHostedAppVerifierPolicyDigest(policyRef: string): string {
  return digestJson(getHostedAppVerifierPolicyDocument(policyRef));
}

export function assertCredentialAllowedByVerifierPolicy(
  policyDocument: unknown,
  state: {
    credentialType: string;
    algorithm: string;
    issuerActive: boolean;
    schemaActive: boolean;
    revocationFresh: boolean;
  },
): void {
  const policy = policyDocument as {
    allowedCredentialTypes?: unknown;
    allowedAlgorithms?: unknown;
    staleRevocationFailureMode?: unknown;
  };
  const allowedCredentialTypes = Array.isArray(policy.allowedCredentialTypes)
    ? policy.allowedCredentialTypes.map(String)
    : [];
  const allowedAlgorithms = Array.isArray(policy.allowedAlgorithms)
    ? policy.allowedAlgorithms.map(String)
    : [];
  if (!allowedCredentialTypes.includes(state.credentialType)) {
    throw new Error("hosted_app_verifier_policy_credential_type_denied");
  }
  if (!state.algorithm || !allowedAlgorithms.includes(state.algorithm)) {
    throw new Error("hosted_app_verifier_policy_algorithm_denied");
  }
  if (!state.issuerActive) throw new Error("hosted_app_verifier_policy_issuer_inactive");
  if (!state.schemaActive) throw new Error("hosted_app_verifier_policy_schema_inactive");
  if (!state.revocationFresh && policy.staleRevocationFailureMode === "fail_closed") {
    throw new Error("hosted_app_verifier_policy_revocation_required");
  }
}
