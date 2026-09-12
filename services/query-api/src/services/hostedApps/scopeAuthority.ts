import { randomUUID } from "node:crypto";

import { digestJson } from "./digest";
import {
  assertScopeAuthorityHighRiskPolicy,
  assertScopeAuthorityLifecyclePolicyDigestFresh,
  assertScopeAuthorityPolicyCanApprove,
  isHighRiskOperation,
  type HostedAppOperationRiskLevel,
  type HostedAppScopeAuthorityLifecyclePolicy,
} from "./scopeAuthorityLifecycle";

export function assertScopeAuthorityCanApproveOperation(input: {
  operationId: string;
  runtimeAllowedScopes: string[];
  governanceAuthorityRefs: string[];
  approvingScopeRef: string;
  operationRiskLevel?: HostedAppOperationRiskLevel;
  credentialType?: string;
  expectedLifecyclePolicyDigest?: string | null;
  resolvedLifecyclePolicyDigest?: string | null;
  lifecyclePolicy?: HostedAppScopeAuthorityLifecyclePolicy;
}): void {
  void input.operationId;
  void input.runtimeAllowedScopes;
  const isHighRisk = isHighRiskOperation(input.operationRiskLevel);
  if (isHighRisk) {
    assertScopeAuthorityLifecyclePolicyDigestFresh({
      expectedLifecyclePolicyDigest: input.expectedLifecyclePolicyDigest,
      resolvedLifecyclePolicyDigest: input.resolvedLifecyclePolicyDigest,
    });
  }
  if (input.lifecyclePolicy) {
    assertScopeAuthorityPolicyCanApprove({
      operationId: input.operationId,
      approvingScopeRef: input.approvingScopeRef,
      policy: input.lifecyclePolicy,
    });
    if (isHighRisk) {
      assertScopeAuthorityHighRiskPolicy({
        policy: input.lifecyclePolicy,
        credentialType: input.credentialType,
      });
    }
    return;
  }
  if (!input.governanceAuthorityRefs.includes(input.approvingScopeRef)) {
    throw new Error("hosted_app_governance_authority_denied");
  }
}

export function buildScopeAuthorityChangeReceipt(input: {
  policyId: string;
  previousPolicyVersion: string;
  nextPolicyVersion: string;
  changeType: "fork_rebind" | "authority_rotation" | "emergency_freeze" | "emergency_revoke" | "outage_fallback";
  affectedScopes: string[];
  affectedOperations: string[];
  oldAuthorityRefs: string[];
  newAuthorityRefs: string[];
  effectiveAt: string;
  oldAuthorityValidUntil?: string | null;
  approvalReceiptRef: string;
  chainAnchorRef?: string | null;
}) {
  const base = { receiptId: randomUUID(), ...input };
  return { ...base, receiptDigest: digestJson(base) };
}
