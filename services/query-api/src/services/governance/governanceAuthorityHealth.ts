import { hashCanonicalGovernanceValue } from './canonicalCodec';
import {
  hasGovernanceCommitteeOperator,
  isGovernanceCommitteeOperator,
  listCommitteeEligibleActors,
} from './circleCommitteeActors';
import { resolveActiveCircleGovernanceBinding } from './circleGovernanceBindings';
import { createGovernanceCaseIntake } from './governanceCase';
import { GOVERNANCE_AUTHORITY_HEALTH_ACTION_TYPE } from './actionRegistry';
import {
  projectGovernanceAuthorityHealthReadback,
  type GovernanceAuthorityHealthReadback,
} from './governanceAuthorityHealthReadback';
import {
  resolveCommitteeMemberApprovalThreshold,
  resolveCommitteeMemberThresholdConfig,
} from './strategies/committeeMemberThreshold';

export { GOVERNANCE_AUTHORITY_HEALTH_ACTION_TYPE } from './actionRegistry';
export {
  assertFreshGovernanceAuthorityHealthForHighRisk,
  projectGovernanceAuthorityHealthReadback,
  type GovernanceAuthorityHealthReadback,
} from './governanceAuthorityHealthReadback';
export const GOVERNANCE_AUTHORITY_HEALTH_TTL_SECONDS = 300;
export const GOVERNANCE_EMERGENCY_FREEZE_MIN_SECONDS = 300;
export const GOVERNANCE_EMERGENCY_FREEZE_MAX_SECONDS = 86_400;
export const GOVERNANCE_AUTHORITY_HEALTH_KIND = 'governance_authority_health_check';
export type GovernanceInternalAuthorityFaultClass =
  | 'electorate_inactivity'
  | 'lost_key'
  | 'compromised_key';

const SNAPSHOT_DOMAIN = 'alcheme.governance.authority-health-snapshot';
const EVIDENCE_DOMAIN = 'alcheme.governance.authority-health-evidence';

function isSupportedWalletSignalEnvelope(signal: any): boolean {
  if (signal?.envelopeDomain !== 'alcheme.governance.signal') return false;
  if (signal.envelopeVersion === 1) {
    return signal.envelopeNetwork === 'solana:localnet';
  }
  if (signal.envelopeVersion === 2) {
    return signal.envelopeNetwork === 'solana:localnet'
      || signal.envelopeNetwork === 'solana:devnet';
  }
  return false;
}

export async function openGovernanceAuthorityHealthCase(
  prisma: any,
  input: {
    circleId: number;
    bindingId: string;
    actorPubkey: string;
    actorRole: string;
    idempotencyKey: string;
    faultAssessment?: {
      faultClass: GovernanceInternalAuthorityFaultClass;
      affectedActorPubkey: string;
      evidenceRef: string;
      maximumDurationSeconds: number;
    } | null;
    now?: Date;
  },
): Promise<{ governanceCase: any; replayed: boolean }> {
  const now = input.now ?? new Date();
  const run = async (tx: any) => {
    const binding = await tx.circleGovernanceBinding.findUnique({ where: { id: input.bindingId } });
    if (!binding || binding.targetCircleId !== input.circleId || binding.status !== 'active') {
      throw new Error('governance_authority_health_binding_unavailable');
    }
    const [actors, authorityResolution, recoveryPolicy] = await Promise.all([
      listCommitteeEligibleActors(tx, { committeeCircleId: binding.committeeCircleId }),
      resolveActiveCircleGovernanceBinding(tx, {
        targetCircleId: input.circleId,
        actionType: GOVERNANCE_AUTHORITY_HEALTH_ACTION_TYPE,
        purpose: 'collective_decision',
        authorityBindingId: binding.id,
        subjectType: 'circle_governance_binding',
        subjectRef: binding.id,
        now,
      }),
      tx.governanceRecoveryPolicy.findFirst({
        where: { OR: [{ bindingId: binding.id }, { targetBindingId: binding.id }] },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    if (!authorityResolution || authorityResolution.binding.id !== binding.id) {
      throw new Error('governance_authority_health_current_authority_required');
    }
    if (actors.length === 0 || !hasGovernanceCommitteeOperator(actors)) {
      throw new Error('governance_authority_health_committee_unreachable');
    }
    const recoveryActors = recoveryPolicy && Array.isArray(recoveryPolicy.actorSnapshot)
      ? recoveryPolicy.actorSnapshot
      : [];
    if (recoveryPolicy && (
      recoveryActors.length < 2
      || hashCanonicalGovernanceValue(
        'alcheme.governance.recovery-actor-snapshot',
        recoveryActors,
      ) !== recoveryPolicy.actorSnapshotDigest
    )) throw new Error('governance_authority_health_recovery_panel_drift');
    const actorSnapshot = actors
      .map((actor) => ({
        pubkey: String(actor.pubkey),
        role: actor.role == null ? null : String(actor.role),
        weight: String(actor.weight ?? '1'),
        source: String(actor.source ?? 'committee_member'),
      }))
      .sort((left, right) => left.pubkey.localeCompare(right.pubkey));
    const actorSnapshotDigest = hashCanonicalGovernanceValue(SNAPSHOT_DOMAIN, actorSnapshot);
    const policyConfig = resolveCommitteeMemberThresholdConfig(
      authorityResolution.policyVersion.rules,
      binding.ruleId,
    );
    const approvalThreshold = resolveCommitteeMemberApprovalThreshold(
      policyConfig,
      actorSnapshot.length,
    );
    const decisionAuthority = {
      actorSnapshotDigest,
      eligibleActorCount: actorSnapshot.length,
      approvalThreshold,
      decisionMechanismKind: 'equal_weight_threshold' as const,
      operatorSignatureRequired: true as const,
    };
    const faultAssessment = normalizeFaultAssessment(
      input.faultAssessment,
      actorSnapshot,
      decisionAuthority,
    );
    const currentHealth = projectGovernanceAuthorityHealthReadback(binding, now);
    if (!faultAssessment && currentHealth.faultAssessment && currentHealth.evidenceIntegrity !== 'verified') {
      throw new Error('governance_authority_health_recovery_evidence_drift');
    }
    const currentEvidence = record(binding.authorityHealthEvidence);
    const recoveryReview = !faultAssessment && currentHealth.faultAssessment
      ? {
          status: 'mandatory' as const,
          previousEvidenceDigest: binding.authorityHealthEvidenceDigest,
          previousSourceRequestId: currentEvidence.sourceRequestId,
          previousFaultClass: currentHealth.faultAssessment.faultClass,
          release: 'new_accepted_wallet_signed_health_case_without_fault' as const,
        }
      : null;
    const proposal = {
      kind: GOVERNANCE_AUTHORITY_HEALTH_KIND,
      schemaVersion: 1,
      bindingId: binding.id,
      targetCircleId: binding.targetCircleId,
      committeeCircleId: binding.committeeCircleId,
      policyVersionId: binding.policyVersionId,
      authorityHealthVersion: Number(binding.authorityHealthVersion ?? 0),
      actorSnapshot,
      actorSnapshotDigest,
      decisionAuthority,
      targetManagerProof: {
        actorPubkey: input.actorPubkey,
        actorRole: input.actorRole,
        source: 'authenticated_wallet_session',
      },
      recoveryPanel: recoveryPolicy
        ? {
            status: 'proof_required',
            policyId: recoveryPolicy.id,
            recoveryCircleId: recoveryPolicy.recoveryCircleId,
            actorSnapshot: recoveryActors,
            actorSnapshotDigest: recoveryPolicy.actorSnapshotDigest,
          }
        : { status: 'not_configured' },
      externalAuthority: {
        status: 'p06_provider_readback_required',
        authoritative: false,
        ownerPackage: 'P06',
      },
      ...(faultAssessment ? { faultAssessment } : {}),
      ...(recoveryReview ? { recoveryReview } : {}),
      validForSeconds: GOVERNANCE_AUTHORITY_HEALTH_TTL_SECONDS,
      openedAt: now.toISOString(),
    };
    return createGovernanceCaseIntake(tx, {
      circleId: input.circleId,
      title: 'Verify governance authority health',
      requestedDecision: 'Do the current governance electorate and operator prove current wallet control and reachability for this binding?',
      requestedActionPayload: { governanceAuthorityHealthCheck: proposal },
      caseType: 'policy',
      templateId: 'basic-community',
      actionType: GOVERNANCE_AUTHORITY_HEALTH_ACTION_TYPE,
      subjectType: 'circle_governance_binding',
      subjectRef: binding.id,
      authorityBindingId: binding.id,
      authorityResolution,
      decisionMechanismKind: 'equal_weight_threshold',
      originKind: 'manual_item',
      sourceMessageIds: [],
      idempotencyKey: `${input.idempotencyKey}:v${Number(binding.authorityHealthVersion ?? 0)}`,
      openedByPubkey: input.actorPubkey,
      actorRole: input.actorRole,
      openedAt: now,
    });
  };
  return typeof prisma.$transaction === 'function'
    ? prisma.$transaction((tx: any) => run(tx))
    : run(prisma);
}

export async function applyAcceptedGovernanceAuthorityHealth(
  prisma: any,
  input: { requestId: string; bindingId: string; actorPubkey: string; now?: Date },
): Promise<GovernanceAuthorityHealthReadback> {
  const now = input.now ?? new Date();
  const run = async (tx: any) => {
    const [request, decision, binding, signals] = await Promise.all([
      tx.governanceRequest.findUnique({ where: { id: input.requestId }, include: { snapshot: true } }),
      tx.governanceDecision.findUnique({ where: { requestId: input.requestId } }),
      tx.circleGovernanceBinding.findUnique({ where: { id: input.bindingId } }),
      tx.governanceSignal.findMany({ where: { requestId: input.requestId }, orderBy: { createdAt: 'asc' } }),
    ]);
    if (
      !request
      || request.actionType !== GOVERNANCE_AUTHORITY_HEALTH_ACTION_TYPE
      || request.targetType !== 'circle_governance_binding'
      || request.targetRef !== input.bindingId
      || request.state !== 'accepted'
      || !decision
      || decision.decision !== 'accepted'
      || !binding
      || binding.status !== 'active'
    ) throw new Error('governance_authority_health_accepted_decision_required');
    const proposal = record(record(request.payload).governanceAuthorityHealthCheck);
    const frozenActors = Array.isArray(proposal.actorSnapshot)
      ? proposal.actorSnapshot.map(record)
      : [];
    if (
      proposal.kind !== GOVERNANCE_AUTHORITY_HEALTH_KIND
      || proposal.bindingId !== binding.id
      || proposal.targetCircleId !== binding.targetCircleId
      || proposal.committeeCircleId !== binding.committeeCircleId
      || proposal.policyVersionId !== binding.policyVersionId
      || proposal.authorityHealthVersion !== Number(binding.authorityHealthVersion ?? 0)
      || proposal.validForSeconds !== GOVERNANCE_AUTHORITY_HEALTH_TTL_SECONDS
      || hashCanonicalGovernanceValue(SNAPSHOT_DOMAIN, frozenActors) !== proposal.actorSnapshotDigest
    ) throw new Error('governance_authority_health_proposal_drift');
    const decisionAuthority = record(proposal.decisionAuthority);
    const decisionTally = record(decision.tally);
    const approvalThreshold = Number(decisionAuthority.approvalThreshold);
    if (
      decisionAuthority.actorSnapshotDigest !== proposal.actorSnapshotDigest
      || decisionAuthority.eligibleActorCount !== frozenActors.length
      || !Number.isSafeInteger(approvalThreshold)
      || approvalThreshold <= 0
      || approvalThreshold > frozenActors.length
      || decisionAuthority.decisionMechanismKind !== 'equal_weight_threshold'
      || decisionAuthority.operatorSignatureRequired !== true
      || Number(decisionTally.eligible) !== frozenActors.length
      || Number(decisionTally.approvalThreshold) !== approvalThreshold
      || Number(decisionTally.approved) < approvalThreshold
      || record(decisionTally.quorum).met !== true
    ) throw new Error('governance_authority_health_decision_quorum_drift');
    const eligibleByPubkey = new Map(frozenActors.map((actor) => [String(actor.pubkey), actor]));
    const signedSignals = signals.filter((signal: any) => (
      signal.actorPubkey
      && eligibleByPubkey.has(String(signal.actorPubkey))
      && signal.signature
      && signal.signedMessage
      && isSupportedWalletSignalEnvelope(signal)
      && signal.envelopeExpiresAt
      && new Date(signal.envelopeExpiresAt).getTime() >= new Date(decision.decidedAt).getTime()
      && signal.payloadDigest
      && signal.policyDigest
      && signal.snapshotDigest
      && signal.envelopeDigest
    ));
    const signedPubkeys = new Set(signedSignals.map((signal: any) => String(signal.actorPubkey)));
    const operatorSigned = frozenActors.some((actor) => (
      signedPubkeys.has(String(actor.pubkey))
      && isGovernanceCommitteeOperator({ role: actor.role == null ? null : String(actor.role) })
    ));
    if (signedPubkeys.size < approvalThreshold || !operatorSigned) {
      throw new Error('governance_authority_health_wallet_proof_required');
    }
    const checkedAt = new Date(decision.decidedAt);
    const recoveryPanelProposal = record(proposal.recoveryPanel);
    const faultProposal = record(proposal.faultAssessment);
    const faultAssessment = Object.keys(faultProposal).length > 0
      ? normalizeFaultAssessment({
          faultClass: faultProposal.faultClass,
          affectedActorPubkey: faultProposal.affectedActorPubkey,
          evidenceRef: faultProposal.evidenceRef,
          maximumDurationSeconds: record(faultProposal.emergencyFreeze).maximumDurationSeconds,
        } as any, frozenActors, decisionAuthority as any)
      : null;
    if (
      faultAssessment
      && hashCanonicalGovernanceValue('alcheme.governance.emergency-freeze', faultAssessment)
        !== hashCanonicalGovernanceValue('alcheme.governance.emergency-freeze', faultProposal)
    ) {
      throw new Error('governance_authority_health_fault_assessment_drift');
    }
    const recoveryReviewProposal = record(proposal.recoveryReview);
    const currentEvidence = record(binding.authorityHealthEvidence);
    const currentFault = record(currentEvidence.faultAssessment);
    if (!faultAssessment && Object.keys(currentFault).length > 0 && (
      recoveryReviewProposal.status !== 'mandatory'
      || recoveryReviewProposal.previousEvidenceDigest !== binding.authorityHealthEvidenceDigest
      || recoveryReviewProposal.previousSourceRequestId !== currentEvidence.sourceRequestId
      || recoveryReviewProposal.previousFaultClass !== currentFault.faultClass
      || recoveryReviewProposal.release !== 'new_accepted_wallet_signed_health_case_without_fault'
    )) throw new Error('governance_authority_health_mandatory_review_required');
    const recoveryActors = Array.isArray(recoveryPanelProposal.actorSnapshot)
      ? recoveryPanelProposal.actorSnapshot.map(record)
      : [];
    if (recoveryPanelProposal.status === 'proof_required' && (
      recoveryActors.length < 2
      || hashCanonicalGovernanceValue(
        'alcheme.governance.recovery-actor-snapshot',
        recoveryActors,
      ) !== recoveryPanelProposal.actorSnapshotDigest
    )) throw new Error('governance_authority_health_recovery_panel_drift');
    const recoverySignals = recoveryActors.length > 0
      ? await tx.governanceSignal.findMany({
          where: {
            actorPubkey: { in: recoveryActors.map((actor) => String(actor.pubkey)) },
            createdAt: {
              gte: new Date(checkedAt.getTime() - GOVERNANCE_AUTHORITY_HEALTH_TTL_SECONDS * 1000),
              lte: checkedAt,
            },
          },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    const recoverySignedPubkeys = new Set(recoverySignals.filter((signal: any) => (
      signal.actorPubkey
      && signal.signature
      && signal.signedMessage
      && isSupportedWalletSignalEnvelope(signal)
      && signal.envelopeExpiresAt
      && new Date(signal.envelopeExpiresAt).getTime() >= checkedAt.getTime()
      && signal.payloadDigest
      && signal.policyDigest
      && signal.snapshotDigest
      && signal.envelopeDigest
    )).map((signal: any) => String(signal.actorPubkey)));
    const recoveryPanelHealthy = recoveryActors.length === 0
      || recoveryActors.every((actor) => recoverySignedPubkeys.has(String(actor.pubkey)));
    const staleAt = new Date(checkedAt.getTime() + GOVERNANCE_AUTHORITY_HEALTH_TTL_SECONDS * 1000);
    const appliedFaultAssessment = faultAssessment
      ? {
          ...faultAssessment,
          emergencyFreeze: {
            ...faultAssessment.emergencyFreeze,
            activatedAt: checkedAt.toISOString(),
            freezeEndsAt: new Date(
              checkedAt.getTime() + faultAssessment.emergencyFreeze.maximumDurationSeconds * 1000,
            ).toISOString(),
            reviewDueAt: new Date(
              checkedAt.getTime() + faultAssessment.emergencyFreeze.maximumDurationSeconds * 1000,
            ).toISOString(),
          },
        }
      : null;
    const evidence = {
      kind: 'governance_authority_health_evidence',
      schemaVersion: 1,
      bindingId: binding.id,
      targetCircleId: binding.targetCircleId,
      committeeCircleId: binding.committeeCircleId,
      policyVersionId: binding.policyVersionId,
      sourceRequestId: request.id,
      sourceDecisionDigest: decision.decisionDigest,
      targetManagerProof: proposal.targetManagerProof,
      committee: {
        actorSnapshotDigest: proposal.actorSnapshotDigest,
        eligibleCount: frozenActors.length,
        approvalThreshold,
        walletSignedCount: signedPubkeys.size,
        walletSignedPubkeys: [...signedPubkeys].sort(),
        operatorProof: 'wallet_signed_signal',
      },
      recoveryPanel: recoveryActors.length === 0
        ? { status: 'not_configured' }
        : {
            status: recoveryPanelHealthy
              ? 'wallet_signed_signal'
              : 'degraded_missing_wallet_proof',
            policyId: recoveryPanelProposal.policyId,
            recoveryCircleId: recoveryPanelProposal.recoveryCircleId,
            actorSnapshotDigest: recoveryPanelProposal.actorSnapshotDigest,
            eligibleCount: recoveryActors.length,
            walletSignedCount: recoverySignedPubkeys.size,
            walletSignedPubkeys: [...recoverySignedPubkeys].sort(),
          },
      externalAuthority: proposal.externalAuthority,
      ...(appliedFaultAssessment ? { faultAssessment: appliedFaultAssessment } : {}),
      ...(Object.keys(recoveryReviewProposal).length > 0
        ? { recoveryReview: recoveryReviewProposal }
        : {}),
      checkedAt: checkedAt.toISOString(),
      staleAt: staleAt.toISOString(),
      staleEffect: 'block_new_high_and_critical_plans_without_revoking_existing_authority',
      refreshedByPubkey: input.actorPubkey,
    };
    const evidenceDigest = hashCanonicalGovernanceValue(EVIDENCE_DOMAIN, evidence);
    const version = Number(binding.authorityHealthVersion ?? 0);
    const updated = await tx.circleGovernanceBinding.updateMany({
      where: {
        id: binding.id,
        status: 'active',
        policyVersionId: binding.policyVersionId,
        authorityHealthVersion: version,
      },
      data: {
        authorityHealthStatus: recoveryPanelHealthy && !faultAssessment ? 'fresh' : 'degraded',
        authorityHealthVersion: version + 1,
        authorityHealthEvidence: evidence,
        authorityHealthEvidenceDigest: evidenceDigest,
        authorityHealthCheckedAt: checkedAt,
        authorityHealthStaleAt: staleAt,
      },
    });
    if (updated.count !== 1) throw new Error('governance_authority_health_stale_write');
    return projectGovernanceAuthorityHealthReadback({
      ...binding,
      authorityHealthStatus: recoveryPanelHealthy && !faultAssessment ? 'fresh' : 'degraded',
      authorityHealthVersion: version + 1,
      authorityHealthEvidence: evidence,
      authorityHealthEvidenceDigest: evidenceDigest,
      authorityHealthCheckedAt: checkedAt,
      authorityHealthStaleAt: staleAt,
    }, now);
  };
  return typeof prisma.$transaction === 'function'
    ? prisma.$transaction((tx: any) => run(tx))
    : run(prisma);
}

function normalizeFaultAssessment(
  value: {
    faultClass: GovernanceInternalAuthorityFaultClass;
    affectedActorPubkey: string;
    evidenceRef: string;
    maximumDurationSeconds: number;
  } | null | undefined,
  actors: Array<Record<string, any>>,
  decisionAuthority: {
    actorSnapshotDigest: string;
    eligibleActorCount: number;
    approvalThreshold: number;
    decisionMechanismKind: 'equal_weight_threshold';
    operatorSignatureRequired: true;
  },
) {
  if (value == null) return null;
  if (
    !['electorate_inactivity', 'lost_key', 'compromised_key'].includes(value.faultClass)
    || typeof value.affectedActorPubkey !== 'string'
    || !actors.some((actor) => actor.pubkey === value.affectedActorPubkey)
    || typeof value.evidenceRef !== 'string'
    || !value.evidenceRef.trim()
    || value.evidenceRef.trim().length > 512
    || !Number.isSafeInteger(value.maximumDurationSeconds)
    || value.maximumDurationSeconds < GOVERNANCE_EMERGENCY_FREEZE_MIN_SECONDS
    || value.maximumDurationSeconds > GOVERNANCE_EMERGENCY_FREEZE_MAX_SECONDS
  ) throw new Error('governance_authority_health_fault_assessment_invalid');
  return {
    faultClass: value.faultClass,
    affectedActorPubkey: value.affectedActorPubkey,
    evidenceRef: value.evidenceRef.trim(),
    emergencyFreeze: {
      trigger: `ratified_${value.faultClass}`,
      actorQuorum: decisionAuthority,
      scope: 'new_high_and_critical_plans' as const,
      maximumDurationSeconds: value.maximumDurationSeconds,
      recovery: 'new_accepted_wallet_signed_health_case_without_fault' as const,
      mandatoryReview: 'required_before_release' as const,
      payloadMutation: 'forbidden' as const,
      authorityMutation: 'forbidden' as const,
      decisionOverride: 'forbidden' as const,
      notification: 'circle_managers_and_frozen_committee' as const,
      resourcePause: 'not_claimed_p06_authority_required' as const,
    },
  };
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}
