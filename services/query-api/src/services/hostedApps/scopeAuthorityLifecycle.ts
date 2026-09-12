import { digestJson } from "./digest";

export type HostedAppOperationRiskLevel = "normal" | "high" | "critical";

export interface HostedAppScopeAuthorityLifecyclePolicy {
  authorityScopeRefs: string[];
  forkPolicy: { onProjectFork: string };
  projectForkState?: string;
  rotationPolicy?: { requiredQuorum?: number; requiredThreshold?: number };
  compromisePolicy?: { failClosedCredentialTypes?: string[] };
  outageFallbackPolicy?: { newHighRiskCredentialPolicy?: string };
}

export function buildScopeAuthorityLifecyclePolicyDigest(policy: unknown): string {
  return digestJson(policy);
}

export function assertScopeAuthorityPolicyCanApprove(input: {
  operationId: string;
  approvingScopeRef: string;
  policy: HostedAppScopeAuthorityLifecyclePolicy;
}): void {
  void input.operationId;
  if (!input.policy.authorityScopeRefs.includes(input.approvingScopeRef)) {
    throw new Error("hosted_app_governance_authority_denied");
  }
  if (
    input.policy.forkPolicy.onProjectFork === "freeze_until_rebind" &&
    input.policy.projectForkState === "forked_unbound"
  ) {
    throw new Error("hosted_app_scope_authority_frozen_until_rebind");
  }
}

export function assertScopeAuthorityPolicyTransitionAllowed(input: {
  previous: {
    rotationPolicy?: { requiredQuorum?: number };
    outageFallbackPolicy?: { newHighRiskCredentialPolicy?: string };
  };
  next: {
    rotationPolicy?: { requiredQuorum?: number };
    outageFallbackPolicy?: { newHighRiskCredentialPolicy?: string };
  };
  approvalReceiptRiskLevel: HostedAppOperationRiskLevel | "meta_governance";
}): void {
  const quorumReduced =
    Number(input.next.rotationPolicy?.requiredQuorum ?? Infinity) <
    Number(input.previous.rotationPolicy?.requiredQuorum ?? Infinity);
  const outageSafetyReduced = outageFallbackRank(
    input.next.outageFallbackPolicy?.newHighRiskCredentialPolicy,
  ) < outageFallbackRank(input.previous.outageFallbackPolicy?.newHighRiskCredentialPolicy);

  if (
    (quorumReduced || outageSafetyReduced) &&
    input.approvalReceiptRiskLevel !== "high" &&
    input.approvalReceiptRiskLevel !== "critical" &&
    input.approvalReceiptRiskLevel !== "meta_governance"
  ) {
    throw new Error("hosted_app_scope_authority_meta_governance_required");
  }
}

export function assertScopeAuthorityLifecyclePolicyDigestFresh(input: {
  expectedLifecyclePolicyDigest?: string | null;
  resolvedLifecyclePolicyDigest?: string | null;
}): void {
  if (!input.expectedLifecyclePolicyDigest || !input.resolvedLifecyclePolicyDigest) {
    throw new Error("hosted_app_scope_authority_policy_digest_required");
  }
  if (input.expectedLifecyclePolicyDigest !== input.resolvedLifecyclePolicyDigest) {
    throw new Error("hosted_app_scope_authority_policy_digest_stale");
  }
}

export function assertScopeAuthorityHighRiskPolicy(input: {
  policy: HostedAppScopeAuthorityLifecyclePolicy;
  credentialType?: string | null;
}): void {
  if (
    input.credentialType &&
    input.policy.compromisePolicy?.failClosedCredentialTypes?.includes(input.credentialType)
  ) {
    throw new Error("hosted_app_scope_authority_credential_fail_closed");
  }
  if (input.policy.outageFallbackPolicy?.newHighRiskCredentialPolicy === "disabled") {
    throw new Error("hosted_app_scope_authority_high_risk_disabled");
  }
}

export function isHighRiskOperation(riskLevel?: HostedAppOperationRiskLevel | null): boolean {
  return riskLevel === "high" || riskLevel === "critical";
}

function outageFallbackRank(policy?: string): number {
  if (policy === "disabled") return 3;
  if (policy === "multisig_only") return 2;
  if (policy) return 1;
  return 0;
}
