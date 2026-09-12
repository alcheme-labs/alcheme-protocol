import { hashCanonicalGovernanceValue } from './canonicalCodec';
import { GOVERNANCE_AUTHORITY_HEALTH_ACTION_TYPE } from './actionRegistry';

const EVIDENCE_DOMAIN = 'alcheme.governance.authority-health-evidence';

export interface GovernanceAuthorityHealthReadback {
  status: 'not_checked' | 'fresh' | 'stale' | 'degraded' | 'drifted';
  stateVersion: number;
  checkedAt: string | null;
  staleAt: string | null;
  committeeEligibleCount: number;
  committeeSignedCount: number;
  operatorProof: 'wallet_signed_signal' | 'missing' | 'not_checked';
  targetManagerProof: 'authenticated_wallet_session' | 'not_checked';
  recoveryPanelStatus: 'not_configured' | 'wallet_signed_signal' | 'degraded_missing_wallet_proof' | 'not_checked';
  externalAuthorityStatus: 'p06_provider_readback_required';
  evidenceDigest: string | null;
  evidenceIntegrity: 'verified' | 'not_recorded' | 'drifted';
  highRiskPlanGate:
    | 'allowed'
    | 'blocked_stale'
    | 'blocked_degraded'
    | 'blocked_emergency_freeze'
    | 'blocked_review_overdue'
    | 'not_enforced_until_first_check';
  faultAssessment: {
    faultClass: 'electorate_inactivity' | 'lost_key' | 'compromised_key';
    affectedActorPubkey: string;
    evidenceRef: string;
    emergencyFreeze: {
      trigger: string;
      actorQuorum: {
        actorSnapshotDigest: string;
        eligibleActorCount: number;
        approvalThreshold: number;
        decisionMechanismKind: 'equal_weight_threshold';
        operatorSignatureRequired: true;
      };
      scope: 'new_high_and_critical_plans';
      maximumDurationSeconds: number;
      activatedAt: string;
      freezeEndsAt: string;
      recovery: 'new_accepted_wallet_signed_health_case_without_fault';
      mandatoryReview: 'required_before_release';
      reviewDueAt: string;
      reviewStatus: 'required' | 'overdue';
      payloadMutation: 'forbidden';
      authorityMutation: 'forbidden';
      decisionOverride: 'forbidden';
      notification: 'circle_managers_and_frozen_committee';
      resourcePause: 'not_claimed_p06_authority_required';
    };
  } | null;
  warning: string;
}

export type GovernanceCaseAuthorityHealthReadback = GovernanceAuthorityHealthReadback & {
  authority: 'canonical_circle_governance_binding';
  sourceRequestId: string;
  bindingId: string;
  targetCircleId: number;
};

export function projectGovernanceAuthorityHealthReadback(
  binding: any,
  now = new Date(),
): GovernanceAuthorityHealthReadback {
  const evidence = record(binding?.authorityHealthEvidence);
  const recordedDigest = text(binding?.authorityHealthEvidenceDigest);
  const calculatedDigest = Object.keys(evidence).length > 0
    ? hashCanonicalGovernanceValue(EVIDENCE_DOMAIN, evidence)
    : null;
  const integrity = !recordedDigest && !calculatedDigest
    ? 'not_recorded' as const
    : recordedDigest === calculatedDigest
      ? 'verified' as const
      : 'drifted' as const;
  const storedStatus = text(binding?.authorityHealthStatus) || 'not_checked';
  const staleAt = binding?.authorityHealthStaleAt
    ? new Date(binding.authorityHealthStaleAt)
    : null;
  const status = integrity === 'drifted'
    ? 'drifted' as const
    : storedStatus === 'fresh' && staleAt && now >= staleAt
      ? 'stale' as const
      : storedStatus === 'fresh' || storedStatus === 'degraded'
        ? storedStatus as 'fresh' | 'degraded'
        : 'not_checked' as const;
  const committee = record(evidence.committee);
  const recovery = record(evidence.recoveryPanel);
  const fault = record(evidence.faultAssessment);
  const emergencyFreeze = record(fault.emergencyFreeze);
  const actorQuorum = record(emergencyFreeze.actorQuorum);
  const freezeEndsAt = date(emergencyFreeze.freezeEndsAt);
  const reviewDueAt = date(emergencyFreeze.reviewDueAt);
  const faultAssessment = (
    (fault.faultClass === 'electorate_inactivity'
      || fault.faultClass === 'lost_key'
      || fault.faultClass === 'compromised_key')
    && typeof fault.affectedActorPubkey === 'string'
    && typeof fault.evidenceRef === 'string'
    && emergencyFreeze.trigger === `ratified_${fault.faultClass}`
    && typeof actorQuorum.actorSnapshotDigest === 'string'
    && Number.isSafeInteger(Number(actorQuorum.eligibleActorCount))
    && Number.isSafeInteger(Number(actorQuorum.approvalThreshold))
    && actorQuorum.decisionMechanismKind === 'equal_weight_threshold'
    && actorQuorum.operatorSignatureRequired === true
    && emergencyFreeze.scope === 'new_high_and_critical_plans'
    && Number.isSafeInteger(Number(emergencyFreeze.maximumDurationSeconds))
    && date(emergencyFreeze.activatedAt)
    && freezeEndsAt
    && emergencyFreeze.recovery === 'new_accepted_wallet_signed_health_case_without_fault'
    && emergencyFreeze.mandatoryReview === 'required_before_release'
    && reviewDueAt
    && emergencyFreeze.payloadMutation === 'forbidden'
    && emergencyFreeze.authorityMutation === 'forbidden'
    && emergencyFreeze.decisionOverride === 'forbidden'
  ) ? {
      faultClass: fault.faultClass,
      affectedActorPubkey: fault.affectedActorPubkey,
      evidenceRef: fault.evidenceRef,
      emergencyFreeze: {
        trigger: String(emergencyFreeze.trigger),
        actorQuorum: {
          actorSnapshotDigest: String(actorQuorum.actorSnapshotDigest),
          eligibleActorCount: Number(actorQuorum.eligibleActorCount),
          approvalThreshold: Number(actorQuorum.approvalThreshold),
          decisionMechanismKind: 'equal_weight_threshold' as const,
          operatorSignatureRequired: true as const,
        },
        scope: 'new_high_and_critical_plans' as const,
        maximumDurationSeconds: Number(emergencyFreeze.maximumDurationSeconds),
        activatedAt: new Date(emergencyFreeze.activatedAt).toISOString(),
        freezeEndsAt: freezeEndsAt.toISOString(),
        recovery: 'new_accepted_wallet_signed_health_case_without_fault' as const,
        mandatoryReview: 'required_before_release' as const,
        reviewDueAt: reviewDueAt.toISOString(),
        reviewStatus: now >= reviewDueAt ? 'overdue' as const : 'required' as const,
        payloadMutation: 'forbidden' as const,
        authorityMutation: 'forbidden' as const,
        decisionOverride: 'forbidden' as const,
        notification: 'circle_managers_and_frozen_committee' as const,
        resourcePause: 'not_claimed_p06_authority_required' as const,
      },
    } : null;
  return {
    status,
    stateVersion: Number(binding?.authorityHealthVersion ?? 0),
    checkedAt: binding?.authorityHealthCheckedAt
      ? new Date(binding.authorityHealthCheckedAt).toISOString()
      : null,
    staleAt: staleAt ? staleAt.toISOString() : null,
    committeeEligibleCount: Number(committee.eligibleCount ?? 0),
    committeeSignedCount: Number(committee.walletSignedCount ?? 0),
    operatorProof: committee.operatorProof === 'wallet_signed_signal'
      ? 'wallet_signed_signal'
      : status === 'not_checked' ? 'not_checked' : 'missing',
    targetManagerProof: record(evidence.targetManagerProof).source === 'authenticated_wallet_session'
      ? 'authenticated_wallet_session'
      : 'not_checked',
    recoveryPanelStatus: recovery.status === 'wallet_signed_signal'
      ? 'wallet_signed_signal'
      : recovery.status === 'degraded_missing_wallet_proof'
        ? 'degraded_missing_wallet_proof'
      : recovery.status === 'not_configured' ? 'not_configured' : 'not_checked',
    externalAuthorityStatus: 'p06_provider_readback_required',
    evidenceDigest: recordedDigest,
    evidenceIntegrity: integrity,
    highRiskPlanGate: status === 'stale' || status === 'drifted'
      ? 'blocked_stale'
      : status === 'degraded' && faultAssessment?.emergencyFreeze.reviewStatus === 'overdue'
        ? 'blocked_review_overdue'
        : status === 'degraded' && faultAssessment
          ? 'blocked_emergency_freeze'
      : status === 'degraded'
        ? 'blocked_degraded'
        : status === 'fresh'
          ? 'allowed'
          : 'not_enforced_until_first_check',
    faultAssessment,
    warning: status === 'fresh'
      ? 'Internal governance authority proof is fresh. External authority remains P06-owned.'
      : status === 'not_checked'
        ? 'Authority health has not been checked. Refresh before relying on high-risk governance.'
        : faultAssessment
          ? faultAssessment.emergencyFreeze.reviewStatus === 'overdue'
            ? `Emergency freeze review is overdue for ${faultAssessment.faultClass}. New high and critical plans remain fail closed until a new accepted wallet-signed health Case completes the mandatory review.`
            : `Governance authority fault ${faultAssessment.faultClass} is ratified. New high and critical plans are frozen until ${faultAssessment.emergencyFreeze.freezeEndsAt}; release requires a new accepted wallet-signed health Case and mandatory review. Resource pause still requires P06 authority.`
          : 'Authority health is stale or degraded. New high and critical plans are blocked until a new wallet-signed health decision is applied.',
  };
}

export function projectGovernanceCaseAuthorityHealthReadback(input: {
  request: any;
  binding: any;
  audience: 'public' | 'member' | 'operator';
  now?: Date;
}): GovernanceCaseAuthorityHealthReadback | null {
  if (input.audience !== 'operator') return null;
  const requestId = text(input.request?.id);
  const bindingId = text(input.binding?.id);
  const targetCircleId = Number(input.binding?.targetCircleId);
  const evidence = record(input.binding?.authorityHealthEvidence);
  if (
    !requestId
    || !bindingId
    || !Number.isSafeInteger(targetCircleId)
    || targetCircleId <= 0
    || input.request?.actionType !== GOVERNANCE_AUTHORITY_HEALTH_ACTION_TYPE
    || input.request?.targetType !== 'circle_governance_binding'
    || input.request?.targetRef !== bindingId
    || evidence.sourceRequestId !== requestId
    || evidence.bindingId !== bindingId
    || Number(evidence.targetCircleId) !== targetCircleId
  ) return null;
  const readback = projectGovernanceAuthorityHealthReadback(input.binding, input.now);
  if (
    readback.evidenceIntegrity !== 'verified'
    || !readback.evidenceDigest
    || !/^[a-f0-9]{64}$/.test(readback.evidenceDigest)
  ) return null;
  return {
    ...readback,
    authority: 'canonical_circle_governance_binding',
    sourceRequestId: requestId,
    bindingId,
    targetCircleId,
  };
}

export function assertFreshGovernanceAuthorityHealthForHighRisk(
  binding: any,
  now = new Date(),
): void {
  const readback = projectGovernanceAuthorityHealthReadback(binding, now);
  if (readback.highRiskPlanGate === 'blocked_stale') {
    throw new Error('governance_authority_health_stale_high_risk_blocked');
  }
  if (readback.highRiskPlanGate === 'blocked_degraded') {
    throw new Error('governance_authority_health_degraded_high_risk_blocked');
  }
  if (readback.highRiskPlanGate === 'blocked_emergency_freeze') {
    throw new Error('governance_emergency_freeze_high_risk_blocked');
  }
  if (readback.highRiskPlanGate === 'blocked_review_overdue') {
    throw new Error('governance_emergency_freeze_review_overdue');
  }
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function date(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
