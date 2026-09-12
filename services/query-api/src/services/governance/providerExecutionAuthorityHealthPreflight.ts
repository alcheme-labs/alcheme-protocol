import type { PrismaClient } from '@prisma/client';

import { hashCanonicalGovernanceValue } from './canonicalCodec';
import { projectGovernanceAuthorityHealthReadback } from './governanceAuthorityHealthReadback';
import type { GovernanceExecutableRequest } from './requestExecution';

export interface ProviderExecutionAuthorityHealthPreflight {
  schemaVersion: 1;
  authority: 'p05_authority_health_binding_live_readback';
  domainBindingId: string;
  mandateId: string | null;
  authoritySnapshotId: string;
  authoritySnapshotDigest: string;
  stateVersion: number;
  status: 'fresh';
  highRiskPlanGate: 'allowed';
  emergencyFreeze: 'clear';
  evidenceDigest: string;
  checkedAt: string;
  staleAt: string;
  observedAt: string;
  digest: string;
}

export async function resolveProviderExecutionAuthorityHealthPreflight(
  prisma: PrismaClient | Record<string, unknown>,
  request: GovernanceExecutableRequest,
  now: Date,
): Promise<ProviderExecutionAuthorityHealthPreflight> {
  if (!request.invocationId || request.executionMode !== 'provider_bound_action') {
    throw new Error('provider_execution_authority_health_invocation_required');
  }
  const client = prisma as any;
  if (
    typeof client.governedActionInvocation?.findUnique !== 'function'
    || typeof client.circleGovernanceBinding?.findUnique !== 'function'
  ) throw new Error('provider_execution_authority_health_readback_unavailable');
  const invocation = await client.governedActionInvocation.findUnique({
    where: { id: request.invocationId },
    include: { authoritySnapshot: { include: { binding: true } } },
  });
  const snapshot = invocation?.authoritySnapshot;
  const authorityBinding = snapshot?.binding;
  const limits = record(authorityBinding?.limits);
  const domainBindingId = text(limits.domainBindingId);
  const mandateId = text(limits.mandateId);
  const mandateLineage = authorityBinding?.sourceType === 'governance_mandate'
    && authorityBinding.sourceRef === mandateId
    && Boolean(mandateId);
  const selfGovernedLineage = authorityBinding?.sourceType === 'circle_governance_binding'
    && authorityBinding.sourceRef === domainBindingId
    && mandateId === null;
  if (
    !invocation
    || !snapshot
    || !authorityBinding
    || invocation.id !== request.invocationId
    || snapshot.invocationId !== invocation.id
    || snapshot.bindingId !== authorityBinding.id
    || !domainBindingId
    || (!mandateLineage && !selfGovernedLineage)
    || !digest(snapshot.snapshotDigest)
  ) throw new Error('provider_execution_authority_health_lineage_invalid');
  const binding = await client.circleGovernanceBinding.findUnique({
    where: { id: domainBindingId },
    select: {
      id: true,
      targetCircleId: true,
      status: true,
      mandateId: true,
      authorityHealthStatus: true,
      authorityHealthVersion: true,
      authorityHealthEvidence: true,
      authorityHealthEvidenceDigest: true,
      authorityHealthCheckedAt: true,
      authorityHealthStaleAt: true,
    },
  });
  if (
    !binding
    || binding.id !== domainBindingId
    || binding.status !== 'active'
    || (mandateLineage && binding.mandateId !== mandateId)
    || (selfGovernedLineage && binding.mandateId !== null)
    || Number(binding.targetCircleId) !== Number(request.targetRef)
  ) throw new Error('provider_execution_authority_health_binding_invalid');
  const readback = projectGovernanceAuthorityHealthReadback(binding, now);
  const checkedAt = readback.checkedAt ? new Date(readback.checkedAt) : null;
  const staleAt = readback.staleAt ? new Date(readback.staleAt) : null;
  if (
    readback.status !== 'fresh'
    || readback.evidenceIntegrity !== 'verified'
    || readback.highRiskPlanGate !== 'allowed'
    || readback.faultAssessment !== null
    || !digest(readback.evidenceDigest)
    || !checkedAt
    || Number.isNaN(checkedAt.getTime())
    || !staleAt
    || Number.isNaN(staleAt.getTime())
    || checkedAt.getTime() > now.getTime()
    || staleAt.getTime() <= now.getTime()
    || !Number.isSafeInteger(readback.stateVersion)
    || readback.stateVersion <= 0
  ) {
    throw new Error(`provider_execution_authority_health_${readback.highRiskPlanGate}`);
  }
  const facts = {
    schemaVersion: 1 as const,
    authority: 'p05_authority_health_binding_live_readback' as const,
    domainBindingId,
    mandateId,
    authoritySnapshotId: String(snapshot.id),
    authoritySnapshotDigest: String(snapshot.snapshotDigest),
    stateVersion: readback.stateVersion,
    status: 'fresh' as const,
    highRiskPlanGate: 'allowed' as const,
    emergencyFreeze: 'clear' as const,
    evidenceDigest: String(readback.evidenceDigest),
    checkedAt: checkedAt.toISOString(),
    staleAt: staleAt.toISOString(),
    observedAt: now.toISOString(),
  };
  return {
    ...facts,
    digest: hashCanonicalGovernanceValue(
      'alcheme.governance.provider-execution-authority-health-preflight-v1',
      facts,
    ),
  };
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function digest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
