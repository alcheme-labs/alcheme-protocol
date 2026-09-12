import { isDeepStrictEqual } from 'node:util';

import { hashCanonicalGovernanceValue } from './canonicalCodec';
import {
  buildCommitteePolicyRules,
  listCommitteeEligibleActors,
  resolveActiveCircleGovernanceBinding,
} from './circleGovernanceBindings';
import {
  CIRCLE_GOVERNANCE_BINDING_POLICY_VERSION_UPDATE_ACTION_TYPE,
  computeCircleGovernanceBindingControlDigest,
} from './circleGovernanceBindingExecution';
import {
  hasGovernanceCommitteeOperator,
  isGovernanceCommitteeOperator,
} from './circleCommitteeActors';
import {
  normalizeCircleGovernanceCommitteeElectorateTemplate,
} from './circleCommitteeProfiles';
import {
  evaluateCommitteeMemberThreshold,
  resolveCommitteeMemberThresholdConfig,
} from './strategies/committeeMemberThreshold';
import {
  createGovernanceBootstrapBundle,
  evaluateGovernanceBootstrapReadiness,
  type GovernanceBootstrapBundle,
  type GovernanceBootstrapBundleInput,
  type GovernanceBootstrapReadinessChecks,
  type GovernanceBootstrapVersionedRef,
} from './governanceBootstrapContract';
import { createGovernanceCaseIntake } from './governanceCase';
import { projectDecisionOutputArtifact } from './decisionOutputArtifact';
import {
  persistGovernanceConfigurationTransitionTarget,
} from './governanceConfigurationBundleStore';
import { resolveActiveGovernanceProfileForWork } from './governanceProfileLifecycle';
import { computeGovernancePolicyRulesDigest } from './policyEngine';
import {
  enterManualGovernanceRecoveryPending,
  GOVERNANCE_RECOVERY_ACTIVATION_TTL_SECONDS,
  GOVERNANCE_RECOVERY_TRIGGER,
  resumeGovernanceAuthorityContinuityWithVerifiedExistingAuthority,
  resolveGovernanceRecoveryCaseAuthority,
  resolveGovernanceRecoveryReadback,
  type GovernanceAuthorityContinuityReadback,
  type GovernanceRecoveryReadback,
} from './governanceRecoveryPolicy';

const TRANSITION_PLAN_DOMAIN = 'alcheme.governance.configuration-transition-plan';
const TRANSITION_IMPACT_DOMAIN = 'alcheme.governance.configuration-transition-impact';
const TRANSITION_ACTOR_SNAPSHOT_DOMAIN = 'alcheme.governance.configuration-transition-actors';
const TRANSITION_TASK_SNAPSHOT_DOMAIN = 'alcheme.governance.configuration-transition-tasks';
const TRANSITION_AUDIT_DOMAIN = 'alcheme.governance.configuration-transition-audit';
const TRANSITION_MANDATE_SNAPSHOT_DOMAIN = 'alcheme.governance.configuration-transition-mandates';
const TRANSITION_CONTINUITY_DOMAIN = 'alcheme.governance.configuration-transition-continuity';

export interface GovernanceConfigurationTransitionReadback {
  status: 'planned' | 'executed' | 'rolled_back' | 'drifted';
  activeBundle: { id: string; version: number; digest: string } | null;
  targetBundle: { id: string; version: number; digest: string };
  activePolicy: { id: string; versionId: string; version: number } | null;
  bindingId: string;
  sourceRequestId: string | null;
  sourceDecisionDigest: string | null;
  disposition: {
    status: 'pending_cutover' | 'verified' | 'drifted';
    acceptedArtifacts: { total: number; verified: number; immutable: boolean };
    existingOperationEffects: { total: number; verified: number; continueFrozenLifecycle: boolean };
    newInvocations: { total: number; targetPolicy: number; targetBundleOnly: boolean };
    profilePins: { total: number; verified: number; retainedFrozenVersion: boolean };
    appealAccess: 'bound_to_original_receipt';
  };
  recovery: {
    status: 'not_started' | 'governed_rollback_available' | 'rollback_governance_pending' | 'rolled_back' | 'manual_recovery_required';
    irreversibleBoundary: 'not_crossed' | 'unknown_or_crossed';
    oneClickRollback: false;
    canOpenGovernedRollback: boolean;
    sourceBundle: { id: string; version: number; digest: string };
    rollbackCaseId: string | null;
  };
  deadlockRecovery: GovernanceRecoveryReadback & {
    recoveryCaseId: string | null;
    ratificationCaseId: string | null;
  };
  auditRecord: {
    authorized: Record<string, unknown>;
    public: Record<string, unknown>;
  };
}

export async function resolveGovernanceConfigurationTransitionReadback(
  prisma: any,
  governanceCase: any,
): Promise<GovernanceConfigurationTransitionReadback | null> {
  const payload = asRecord(governanceCase?.requestedActionPayload);
  const plan = asRecord(payload.configurationTransitionPlan);
  if (plan.kind !== 'governance_configuration_transition') return null;
  const from = asRecord(plan.fromBundle);
  const to = asRecord(plan.toBundle);
  const bindingId = typeof payload.bindingId === 'string' ? payload.bindingId : '';
  const fromBundleId = typeof from.id === 'string' ? from.id : '';
  const toBundleId = typeof to.id === 'string' ? to.id : '';
  const fromDigest = typeof from.digest === 'string' ? from.digest : '';
  const toDigest = typeof to.digest === 'string' ? to.digest : '';
  const fromVersion = Number(from.version);
  const toVersion = Number(to.version);
  const currentPolicyVersionId = typeof payload.currentPolicyVersionId === 'string'
    ? payload.currentPolicyVersionId
    : '';
  const targetPolicyVersionId = typeof payload.proposedPolicyVersionId === 'string'
    ? payload.proposedPolicyVersionId
    : '';
  if (
    !bindingId
    || !fromBundleId
    || !toBundleId
    || !/^[a-f0-9]{64}$/.test(fromDigest)
    || !/^[a-f0-9]{64}$/.test(toDigest)
    || !Number.isSafeInteger(fromVersion)
    || !Number.isSafeInteger(toVersion)
    || toVersion !== fromVersion + 1
    || !currentPolicyVersionId
    || !targetPolicyVersionId
  ) return null;
  const [binding, fromBundle, targetBundle, currentPolicyVersion, targetPolicyVersion] = await Promise.all([
    prisma.circleGovernanceBinding.findUnique({ where: { id: bindingId } }),
    prisma.governanceConfigurationBundle.findUnique({ where: { id: fromBundleId } }),
    prisma.governanceConfigurationBundle.findUnique({ where: { id: toBundleId } }),
    prisma.governancePolicyVersion.findUnique({ where: { id: currentPolicyVersionId } }),
    prisma.governancePolicyVersion.findUnique({ where: { id: targetPolicyVersionId } }),
  ]);
  const recoveryPolicy = payload.recoveryPolicyId
    ? await prisma.governanceRecoveryPolicy.findUnique({
        where: { id: String(payload.recoveryPolicyId) },
      })
    : null;
  const successorBinding = recoveryPolicy?.targetBindingId
    ? await prisma.circleGovernanceBinding.findUnique({
        where: { id: recoveryPolicy.targetBindingId },
      })
    : null;
  const activeBinding = successorBinding ?? binding;
  const homeIdentityBindingId = fromBundle?.homeIdentityBindingId;
  const [policy, activation] = activeBinding && homeIdentityBindingId
    ? await Promise.all([
        prisma.governancePolicy.findUnique({ where: { id: activeBinding.policyId } }),
        prisma.governanceActivationState.findUnique({ where: { homeIdentityBindingId } }),
      ])
    : [null, null];
  const activeBundle = activation?.bootstrapConfigurationBundleId
    && Number.isSafeInteger(Number(activation.bootstrapBundleVersion))
    && typeof activation.bootstrapBundleDigest === 'string'
    ? {
        id: String(activation.bootstrapConfigurationBundleId),
        version: Number(activation.bootstrapBundleVersion),
        digest: String(activation.bootstrapBundleDigest),
      }
    : null;
  const activePolicy = activeBinding && policy
    ? { id: String(activeBinding.policyId), versionId: String(activeBinding.policyVersionId), version: Number(activeBinding.policyVersion) }
    : null;
  const planned = Boolean(
    binding?.id === bindingId
    && binding.status === 'active'
    && binding.policyVersionId === currentPolicyVersionId
    && binding.policyVersion === Number(payload.currentPolicyVersion)
    && policy?.activeVersion === Number(payload.currentPolicyVersion)
    && currentPolicyVersion?.status === 'active'
    && targetPolicyVersion?.status === 'draft'
    && fromBundle?.version === fromVersion
    && fromBundle?.bundleDigest === fromDigest
    && targetBundle?.version === toVersion
    && targetBundle?.bundleDigest === toDigest
    && targetBundle?.homeIdentityBindingId === homeIdentityBindingId
    && activeBundle?.id === fromBundleId
    && activeBundle?.digest === fromDigest
  );
  const expectedRequestId = governanceCase?.primaryRequest?.id ?? governanceCase?.primaryRequestId ?? null;
  const expectedDecisionDigest = governanceCase?.primaryRequest?.decision?.decisionDigest ?? null;
  const executed = Boolean(
    activeBinding?.id === (recoveryPolicy?.targetBindingId ?? bindingId)
    && activeBinding.status === 'active'
    && activeBinding.policyVersionId === targetPolicyVersionId
    && activeBinding.policyVersion === Number(payload.proposedPolicyVersion)
    && activeBinding.sourceRequestId
    && activeBinding.sourceRequestId === expectedRequestId
    && activeBinding.sourceDecisionDigest
    && activeBinding.sourceDecisionDigest === expectedDecisionDigest
    && policy?.activeVersion === Number(payload.proposedPolicyVersion)
    && currentPolicyVersion?.status === (recoveryPolicy ? 'active' : 'superseded')
    && targetPolicyVersion?.status === 'active'
    && activeBundle?.id === toBundleId
    && activeBundle?.version === toVersion
    && activeBundle?.digest === toDigest
  );
  const relatedRollbackCases = typeof prisma.governanceCase?.findMany === 'function'
    ? await prisma.governanceCase.findMany({
        where: {
          relatedCaseId: governanceCase.id,
          relationshipKind: 'supersedes',
        },
        include: { primaryRequest: { include: { decision: true } } },
        orderBy: [{ openedAt: 'asc' }, { id: 'asc' }],
      })
    : [];
  const rollbackCases = relatedRollbackCases.filter((candidate: any) => {
    const candidatePayload = asRecord(candidate.requestedActionPayload);
    const candidatePlan = asRecord(candidatePayload.configurationTransitionPlan);
    return candidatePayload.rollbackFromCaseId === governanceCase.id
      && candidatePlan.kind === 'governance_configuration_transition';
  });
  const executedRollback = rollbackCases.find((candidate: any) => {
    const candidatePayload = asRecord(candidate.requestedActionPayload);
    const candidatePlan = asRecord(candidatePayload.configurationTransitionPlan);
    const candidateTo = asRecord(candidatePlan.toBundle);
    return candidate.primaryRequest?.decision?.decision === 'accepted'
      && binding?.sourceRequestId === candidate.primaryRequest.id
      && binding?.sourceDecisionDigest === candidate.primaryRequest.decision.decisionDigest
      && activeBundle?.id === candidateTo.id
      && activeBundle?.digest === candidateTo.digest;
  }) ?? null;
  const rolledBack = Boolean(executedRollback);
  const disposition = await resolveConfigurationTransitionDisposition(prisma, {
    planned,
    executed: executed || rolledBack,
    homeIdentityBindingId,
    homeType: 'circle',
    homeRef: String(activeBinding?.targetCircleId ?? ''),
    bindingId: activeBinding?.id ?? bindingId,
    targetPolicyVersionId,
    profileBindingId: String(asRecord(asRecord(plan.institutionalContinuity).profile).bindingId ?? ''),
    profileVersionRef: String(asRecord(asRecord(plan.institutionalContinuity).profile).versionRef ?? ''),
    cutoverAt: targetPolicyVersion?.activatedAt ?? null,
  });
  const boundary = asRecord(plan.irreversibleBoundary);
  const rollbackSource = asRecord(asRecord(plan.rollbackPolicy).sourceBundle);
  const boundaryNotCrossed = boundary.stepId === 'external_authority_or_resource_transfer'
    && boundary.status === 'not_crossed'
    && boundary.oneClickRollback === false;
  const rollbackSourceValid = typeof rollbackSource.id === 'string'
    && Number.isSafeInteger(Number(rollbackSource.version))
    && /^[a-f0-9]{64}$/.test(String(rollbackSource.digest ?? ''));
  const recoverySourceBundle = {
    id: String(rollbackSource.id ?? fromBundleId),
    version: Number(rollbackSource.version ?? fromVersion),
    digest: String(rollbackSource.digest ?? fromDigest),
  };
  const recoveryStatus = !boundaryNotCrossed || !rollbackSourceValid
    ? 'manual_recovery_required' as const
    : rolledBack
    ? 'rolled_back' as const
    : rollbackCases.length > 0
      ? 'rollback_governance_pending' as const
      : executed
        ? 'governed_rollback_available' as const
        : planned
          ? 'not_started' as const
          : 'manual_recovery_required' as const;
  const deadlockRecovery = await resolveGovernanceRecoveryReadback(prisma, {
    circleId: Number(activeBinding?.targetCircleId),
    bindingId: activeBinding?.id ?? bindingId,
  });
  const transitionStatus = !boundaryNotCrossed || !rollbackSourceValid
    ? 'drifted' as const
    : rolledBack ? 'rolled_back' as const : executed ? 'executed' as const : planned ? 'planned' as const : 'drifted' as const;
  const recovery = {
    status: recoveryStatus,
    irreversibleBoundary: boundaryNotCrossed ? 'not_crossed' as const : 'unknown_or_crossed' as const,
    oneClickRollback: false as const,
    canOpenGovernedRollback: recoveryStatus === 'governed_rollback_available',
    sourceBundle: recoverySourceBundle,
    rollbackCaseId: executedRollback?.id ?? rollbackCases[0]?.id ?? null,
  };
  const deadlockRecoveryRecord = {
    ...deadlockRecovery,
    recoveryCaseId: recoveryPolicy?.recoveryCaseId ?? null,
    ratificationCaseId: recoveryPolicy?.ratificationCaseId ?? null,
  };
  const auditRecord = await buildConfigurationTransitionAuditRecord(prisma, {
    governanceCase,
    plan,
    transitionStatus,
    fromBundle: { id: fromBundleId, version: fromVersion, digest: fromDigest },
    toBundle: { id: toBundleId, version: toVersion, digest: toDigest },
    activeBundle,
    activePolicy,
    governingRequestId: expectedRequestId,
    rollbackCases,
    disposition,
    recovery,
    deadlockRecovery: deadlockRecoveryRecord,
  });
  return {
    status: transitionStatus,
    activeBundle,
    targetBundle: { id: toBundleId, version: toVersion, digest: toDigest },
    activePolicy,
    bindingId: activeBinding?.id ?? bindingId,
    sourceRequestId: activeBinding?.sourceRequestId ?? null,
    sourceDecisionDigest: activeBinding?.sourceDecisionDigest ?? null,
    disposition,
    recovery,
    deadlockRecovery: deadlockRecoveryRecord,
    auditRecord,
  };
}

async function resolveConfigurationTransitionDisposition(
  prisma: any,
  input: {
    planned: boolean;
    executed: boolean;
    homeIdentityBindingId: string | null | undefined;
    homeType: 'circle';
    homeRef: string;
    bindingId: string;
    targetPolicyVersionId: string;
    profileBindingId: string;
    profileVersionRef: string;
    cutoverAt: Date | string | null;
  },
): Promise<GovernanceConfigurationTransitionReadback['disposition']> {
  const pending = {
    status: 'pending_cutover' as const,
    acceptedArtifacts: { total: 0, verified: 0, immutable: true },
    existingOperationEffects: { total: 0, verified: 0, continueFrozenLifecycle: true },
    newInvocations: { total: 0, targetPolicy: 0, targetBundleOnly: true },
    profilePins: { total: 0, verified: 0, retainedFrozenVersion: true },
    appealAccess: 'bound_to_original_receipt' as const,
  };
  const cutoverAt = input.cutoverAt ? new Date(input.cutoverAt) : null;
  if (!input.executed) return input.planned ? pending : { ...pending, status: 'drifted' };
  if (!input.homeIdentityBindingId || !cutoverAt || Number.isNaN(cutoverAt.getTime())) {
    return { ...pending, status: 'drifted' };
  }
  if (
    typeof prisma.decisionOutputArtifact?.findMany !== 'function'
    || typeof prisma.operationEffect?.findMany !== 'function'
    || typeof prisma.governedActionInvocation?.findMany !== 'function'
  ) {
    return { ...pending, status: 'drifted' };
  }
  const [artifacts, effects, invocations, pinnedInvocations] = await Promise.all([
    prisma.decisionOutputArtifact.findMany({
      where: {
        governanceCase: { homeIdentityBindingId: input.homeIdentityBindingId },
        createdAt: { lte: cutoverAt },
      },
    }),
    prisma.operationEffect.findMany({
      where: {
        invocation: {
          governanceHomeType: input.homeType,
          governanceHomeRef: input.homeRef,
        },
        activatedAt: { lte: cutoverAt },
      },
      include: {
        initialReceipt: true,
        events: { orderBy: { sequence: 'asc' } },
      },
    }),
    prisma.governedActionInvocation.findMany({
      where: {
        governanceHomeType: input.homeType,
        governanceHomeRef: input.homeRef,
        createdAt: { gt: cutoverAt },
      },
      include: { authoritySnapshot: { include: { binding: true } } },
    }),
    prisma.governedActionInvocation.findMany({
      where: {
        governanceHomeType: input.homeType,
        governanceHomeRef: input.homeRef,
        state: { in: ['requested', 'authorized', 'executing'] },
        createdAt: { lte: cutoverAt },
      },
      include: {
        authoritySnapshot: true,
        profileBinding: { include: { definitionVersion: true } },
      },
    }),
  ]);
  const artifactVerified = artifacts.filter((artifact: any) => (
    projectDecisionOutputArtifact(artifact, { includeSourceRef: false }).integrity === 'verified'
  )).length;
  const effectVerified = effects.filter(operationEffectContinuityVerified).length;
  const affectedInvocations = invocations.filter((invocation: any) => (
    asRecord(invocation.authoritySnapshot?.binding?.limits).domainBindingId === input.bindingId
  ));
  const targetInvocations = affectedInvocations.filter((invocation: any) => (
    asRecord(invocation.authoritySnapshot?.binding?.limits).policyVersionId
      === input.targetPolicyVersionId
  )).length;
  const profilePinsVerified = pinnedInvocations.filter((invocation: any) => (
    invocation.profileBindingId === input.profileBindingId
    && invocation.profileBinding?.definitionVersion?.versionRef === input.profileVersionRef
    && (
      invocation.authoritySnapshot == null
      || (
        invocation.authoritySnapshot.profileBindingId === input.profileBindingId
        && invocation.authoritySnapshot.profileVersionRef === input.profileVersionRef
      )
    )
  )).length;
  const verified = artifactVerified === artifacts.length
    && effectVerified === effects.length
    && targetInvocations === affectedInvocations.length
    && profilePinsVerified === pinnedInvocations.length;
  return {
    status: verified ? 'verified' : 'drifted',
    acceptedArtifacts: {
      total: artifacts.length,
      verified: artifactVerified,
      immutable: artifactVerified === artifacts.length,
    },
    existingOperationEffects: {
      total: effects.length,
      verified: effectVerified,
      continueFrozenLifecycle: effectVerified === effects.length,
    },
    newInvocations: {
      total: affectedInvocations.length,
      targetPolicy: targetInvocations,
      targetBundleOnly: targetInvocations === affectedInvocations.length,
    },
    profilePins: {
      total: pinnedInvocations.length,
      verified: profilePinsVerified,
      retainedFrozenVersion: profilePinsVerified === pinnedInvocations.length,
    },
    appealAccess: 'bound_to_original_receipt',
  };
}

function operationEffectContinuityVerified(effect: any): boolean {
  const events = Array.isArray(effect?.events) ? effect.events : [];
  const initial = events[0];
  const terminal = events[events.length - 1];
  const expectedEffectDigest = effect?.initialReceipt
    ? hashCanonicalGovernanceValue(
        'alcheme.governance.operation-effect',
        {
          invocationId: effect.invocationId,
          initialReceiptId: effect.initialReceiptId,
          initialReceiptDigest: effect.initialReceipt.receiptDigest,
          initialState: 'active',
        },
      )
    : null;
  return Boolean(
    effect?.initialReceipt
    && effect.initialReceipt.id === effect.initialReceiptId
    && effect.initialReceipt.invocationId === effect.invocationId
    && typeof effect.initialReceipt.appealRef === 'string'
    && effect.initialReceipt.appealRef.length > 0
    && effect.effectDigest === expectedEffectDigest
    && initial?.sequence === 0
    && initial?.fromState == null
    && initial?.toState === 'active'
    && initial?.reasonCode === 'initial_execution_succeeded'
    && initial?.sourceReceiptId === effect.initialReceiptId
    && terminal?.sequence === effect.stateVersion
    && terminal?.toState === effect.state
  );
}

export async function openGovernancePolicyConfigurationTransitionCase(
  prisma: any,
  input: {
    circleId: number;
    bindingId: string;
    actorPubkey: string;
    actorRole: string;
    electorateTemplate?: unknown;
    targetCommitteeCircleId?: number | null;
    rollbackFromCaseId?: string | null;
    idempotencyKey: string;
    now?: Date;
  },
): Promise<{
  status: 'requires_governance' | 'manual_recovery_pending';
  governanceCase: any;
  replayed: boolean;
  authorityContinuity?: GovernanceAuthorityContinuityReadback;
}> {
  const now = input.now ?? new Date();
  const execute = async (tx: any) => {
    const existingCase = await tx.governanceCase.findFirst({
      where: {
        idempotencyKey: input.idempotencyKey,
        subjectType: 'circle_governance_binding',
        subjectRef: input.bindingId,
      },
      include: {
        homeIdentityBinding: { select: { homeType: true, homeRef: true } },
        primaryRequest: true,
        responsibilities: true,
        timelineEvents: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
    });
    if (existingCase) {
      const payload = asRecord(existingCase.requestedActionPayload);
      const plan = asRecord(payload.configurationTransitionPlan);
      if (
        existingCase.openedByPubkey !== input.actorPubkey
        || payload.bindingId !== input.bindingId
        || payload.targetCircleId !== input.circleId
        || (payload.rollbackFromCaseId ?? null) !== (input.rollbackFromCaseId ?? null)
        || plan.kind !== 'governance_configuration_transition'
      ) {
        throw new Error('governance_configuration_transition_idempotency_conflict');
      }
      return { status: 'requires_governance' as const, governanceCase: existingCase, replayed: true };
    }

    const binding = await tx.circleGovernanceBinding.findUnique({
      where: { id: input.bindingId },
    });
    if (!binding || binding.targetCircleId !== input.circleId || binding.status !== 'active') {
      throw new Error('circle_governance_binding_not_active');
    }
    const policy = await tx.governancePolicy.findUnique({ where: { id: binding.policyId } });
    const currentPolicyVersion = await tx.governancePolicyVersion.findUnique({
      where: { id: binding.policyVersionId },
    });
    if (
      !policy
      || policy.status !== 'active'
      || policy.activeVersion !== binding.policyVersion
      || !currentPolicyVersion
      || currentPolicyVersion.policyId !== binding.policyId
      || currentPolicyVersion.version !== binding.policyVersion
      || currentPolicyVersion.status !== 'active'
      || computeGovernancePolicyRulesDigest(currentPolicyVersion.rules)
        !== currentPolicyVersion.configDigest
    ) {
      throw new Error('governance_policy_frozen_version_mismatch');
    }
    const currentAuthorityResolution = await resolveActiveCircleGovernanceBinding(tx, {
      targetCircleId: input.circleId,
      actionType: CIRCLE_GOVERNANCE_BINDING_POLICY_VERSION_UPDATE_ACTION_TYPE,
      purpose: 'collective_decision',
      authorityBindingId: input.bindingId,
      subjectType: 'circle_governance_binding',
      subjectRef: input.bindingId,
      now,
    });
    if (
      !currentAuthorityResolution
      || currentAuthorityResolution.binding.id !== input.bindingId
      || currentAuthorityResolution.binding.authoritySourceType !== 'governance_mandate'
      || currentAuthorityResolution.binding.authorityPurpose !== 'collective_decision'
    ) {
      throw new Error('governance_configuration_transition_current_authority_required');
    }

    const eligibleActors = await listCommitteeEligibleActors(tx, {
      committeeCircleId: binding.committeeCircleId,
    });
    const currentThreshold = eligibleActors.length > 0
      ? evaluateCommitteeMemberThreshold({
          config: resolveCommitteeMemberThresholdConfig(
            currentPolicyVersion.rules,
            binding.ruleId,
          ),
          eligibleActors,
          signals: [],
        }).tally?.approvalThreshold
      : null;
    if (
      eligibleActors.length > 0
      && Number.isSafeInteger(Number(currentThreshold))
      && Number(currentThreshold) > eligibleActors.length
    ) {
      const authorityContinuity = await enterManualGovernanceRecoveryPending(tx, {
        bindingId: binding.id,
        actorPubkey: input.actorPubkey,
        now,
        trigger: 'signer_threshold_unreachable',
        eligibleActorCount: eligibleActors.length,
        requiredThreshold: Number(currentThreshold),
      });
      return {
        status: 'manual_recovery_pending' as const,
        governanceCase: null,
        replayed: authorityContinuity.stateVersion > 1,
        authorityContinuity,
      };
    }
    const recoveryPolicy = eligibleActors.length === 0
      ? await tx.governanceRecoveryPolicy.findFirst({
          where: { bindingId: input.bindingId, status: 'available' },
        })
      : null;
    if (binding.authorityContinuityState === 'permanently_blocked_governance_authority') {
      throw new Error('permanently_blocked_governance_authority');
    }
    if (binding.authorityContinuityState === 'manual_recovery_pending' && recoveryPolicy) {
      throw new Error('governance_authority_continuity_recovery_policy_drift');
    }
    if (eligibleActors.length === 0 && !recoveryPolicy) {
      const authorityContinuity = await enterManualGovernanceRecoveryPending(tx, {
        bindingId: binding.id,
        actorPubkey: input.actorPubkey,
        now,
      });
      return {
        status: 'manual_recovery_pending' as const,
        governanceCase: null,
        replayed: authorityContinuity.stateVersion > 1,
        authorityContinuity,
      };
    }
    if (eligibleActors.length > 0 && !hasGovernanceCommitteeOperator(eligibleActors)) {
      throw new Error('governance_committee_operator_required');
    }
    if (eligibleActors.length > 0) {
      await resumeGovernanceAuthorityContinuityWithVerifiedExistingAuthority(tx, {
        bindingId: binding.id,
        actorPubkey: input.actorPubkey,
        eligibleActorCount: eligibleActors.length,
        requiredThreshold: currentThreshold == null ? null : Number(currentThreshold),
        operatorVerified: true,
        now,
      });
    }
    const targetCommitteeCircleId = recoveryPolicy
      ? Number(input.targetCommitteeCircleId)
      : binding.committeeCircleId;
    if (!Number.isSafeInteger(targetCommitteeCircleId) || targetCommitteeCircleId <= 0) {
      throw new Error('governance_recovery_target_committee_required');
    }
    const targetEligibleActors = recoveryPolicy
      ? await listCommitteeEligibleActors(tx, { committeeCircleId: targetCommitteeCircleId })
      : eligibleActors;
    if (targetEligibleActors.length === 0 || !hasGovernanceCommitteeOperator(targetEligibleActors)) {
      throw new Error('governance_recovery_target_electorate_unavailable');
    }
    const actionScope = binding.actionType ?? binding.actionPrefix;
    if (!actionScope) throw new Error('circle_governance_binding_scope_required');
    let electorateTemplate = input.rollbackFromCaseId
      ? null
      : normalizeCircleGovernanceCommitteeElectorateTemplate(
          input.electorateTemplate,
          targetEligibleActors.length,
        );
    let proposedRules: unknown = electorateTemplate
      ? buildCommitteePolicyRules(actionScope, electorateTemplate)
      : null;
    let rollbackOf: Record<string, unknown> | null = null;

    const homes = await tx.governanceHomeIdentityBinding.findMany({
      where: {
        homeType: 'circle',
        homeRef: String(input.circleId),
        supersededAt: null,
      },
      include: { activationState: true },
      orderBy: { identityVersion: 'desc' },
      take: 2,
    });
    if (homes.length !== 1) {
      throw new Error(homes.length === 0
        ? 'governance_configuration_transition_home_required'
        : 'governance_configuration_transition_home_ambiguous');
    }
    const home = homes[0];
    let authorityResolution = currentAuthorityResolution;
    let decisionActors = eligibleActors;
    if (recoveryPolicy) {
      if (
        recoveryPolicy.trigger !== GOVERNANCE_RECOVERY_TRIGGER
        || recoveryPolicy.actionType !== CIRCLE_GOVERNANCE_BINDING_POLICY_VERSION_UPDATE_ACTION_TYPE
        || recoveryPolicy.subjectType !== 'circle_governance_binding'
        || recoveryPolicy.subjectRef !== input.bindingId
        || recoveryPolicy.maxCostMinor !== BigInt(0)
        || recoveryPolicy.activationTtlSeconds !== GOVERNANCE_RECOVERY_ACTIVATION_TTL_SECONDS
      ) throw new Error('governance_recovery_policy_scope_invalid');
      const expectedCaseId = `governance_case:${hashCanonicalGovernanceValue(
        'alcheme.governance.case-intake-id',
        { homeIdentityBindingId: home.id, idempotencyKey: input.idempotencyKey },
      ).slice(0, 56)}`;
      const activationExpiresAt = new Date(
        now.getTime() + GOVERNANCE_RECOVERY_ACTIVATION_TTL_SECONDS * 1000,
      );
      const activated = await tx.governanceRecoveryPolicy.updateMany({
        where: {
          id: recoveryPolicy.id,
          status: 'available',
          stateVersion: recoveryPolicy.stateVersion,
          recoveryCaseId: null,
        },
        data: {
          status: 'activated',
          stateVersion: recoveryPolicy.stateVersion + 1,
          activatedAt: now,
          activationExpiresAt,
          recoveryCaseId: expectedCaseId,
        },
      });
      if (activated.count !== 1) {
        throw new Error('governance_recovery_policy_activation_conflict');
      }
      const recovered = await resolveGovernanceRecoveryCaseAuthority(tx, {
        recoveryPolicyId: recoveryPolicy.id,
        bindingId: input.bindingId,
        targetCircleId: input.circleId,
        subjectType: 'circle_governance_binding',
        subjectRef: input.bindingId,
        openedAt: now,
        now,
      });
      authorityResolution = recovered.authorityResolution;
      decisionActors = recovered.eligibleActors;
    }
    const activeBundleId = home.activationState?.bootstrapConfigurationBundleId;
    if (
      home.status !== 'active'
      || home.activationState?.state !== 'active'
      || !activeBundleId
      || !home.activationState.bootstrapBundleDigest
    ) {
      throw new Error('governance_configuration_transition_active_bundle_required');
    }
    const activeBundleRecord = await tx.governanceConfigurationBundle.findUnique({
      where: { id: activeBundleId },
    });
    if (
      !activeBundleRecord
      || activeBundleRecord.homeIdentityBindingId !== home.id
      || activeBundleRecord.bundleDigest !== home.activationState.bootstrapBundleDigest
    ) {
      throw new Error('governance_configuration_transition_active_bundle_mismatch');
    }
    const activeBundle = activeBundleRecord.bundle as GovernanceBootstrapBundle;
    const activeBundleCanonical = createGovernanceBootstrapBundle(stripBundleMetadata(activeBundle));
    if (activeBundleCanonical.digest !== activeBundleRecord.bundleDigest) {
      throw new Error('governance_configuration_transition_active_bundle_digest_mismatch');
    }
    assertCurrentPolicyDimensions(activeBundle, currentPolicyVersion);

    if (input.rollbackFromCaseId) {
      const rollbackTarget = await resolveGovernedConfigurationRollbackTarget(tx, {
        rollbackFromCaseId: input.rollbackFromCaseId,
        homeIdentityBindingId: home.id,
        binding,
        currentPolicyVersion,
        activeBundleRecord,
        eligibleActorCount: targetEligibleActors.length,
        actionScope,
      });
      electorateTemplate = rollbackTarget.electorateTemplate;
      proposedRules = rollbackTarget.rules;
      rollbackOf = rollbackTarget.rollbackOf;
    }
    if (!electorateTemplate || !proposedRules) {
      throw new Error('governance_configuration_transition_target_policy_invalid');
    }
    const proposedConfigDigest = computeGovernancePolicyRulesDigest(proposedRules);
    if (proposedConfigDigest === currentPolicyVersion.configDigest && !recoveryPolicy) {
      throw new Error('governance_policy_version_no_change');
    }

    const profile = await resolveActiveGovernanceProfileForWork(tx, {
      homeIdentityBindingId: home.id,
      homeType: 'circle',
      actionType: CIRCLE_GOVERNANCE_BINDING_POLICY_VERSION_UPDATE_ACTION_TYPE,
      executionAdapter: 'circle_governance_binding',
    });
    const nextPolicyVersion = recoveryPolicy ? 1 : currentPolicyVersion.version + 1;
    const targetPolicyId = recoveryPolicy
      ? `governance-policy:${hashCanonicalGovernanceValue(
          'alcheme.governance.recovery-target-policy',
          {
            recoveryPolicyId: recoveryPolicy.id,
            sourceBindingId: binding.id,
            targetCommitteeCircleId,
          },
        ).slice(0, 56)}`
      : binding.policyId;
    const nextPolicyVersionId = `${targetPolicyId}:v${nextPolicyVersion}`;
    if (recoveryPolicy) {
      const existingTargetPolicy = await tx.governancePolicy.findUnique({
        where: { id: targetPolicyId },
      });
      if (!existingTargetPolicy) {
        await tx.governancePolicy.create({ data: {
          id: targetPolicyId,
          scopeType: 'circle_governance_committee',
          scopeRef: String(targetCommitteeCircleId),
          status: 'draft',
          activeVersion: null,
          createdByPubkey: input.actorPubkey,
          metadata: {
            recoveryPolicyId: recoveryPolicy.id,
            supersedesPolicyId: binding.policyId,
            targetCircleId: input.circleId,
          },
        } });
      } else if (
        existingTargetPolicy.status !== 'draft'
        || existingTargetPolicy.activeVersion !== null
        || existingTargetPolicy.scopeRef !== String(targetCommitteeCircleId)
      ) {
        throw new Error('governance_recovery_target_policy_conflict');
      }
    }
    await persistDraftPolicyVersion(tx, {
      id: nextPolicyVersionId,
      policyId: targetPolicyId,
      version: nextPolicyVersion,
      rules: proposedRules,
      configDigest: proposedConfigDigest,
      createdByPubkey: input.actorPubkey,
    });

    const targetPolicyRef: GovernanceBootstrapVersionedRef = {
      ref: nextPolicyVersionId,
      version: String(nextPolicyVersion),
      digest: proposedConfigDigest,
    };
    const targetBundleInput = buildTargetBundle(activeBundle, targetPolicyRef);
    const targetCanonical = createGovernanceBootstrapBundle(targetBundleInput);
    const targetBundleId = `governance-config-transition:${targetCanonical.digest.slice(0, 56)}`;
    const targetBundle = await persistGovernanceConfigurationTransitionTarget(tx, {
      id: targetBundleId,
      homeIdentityBindingId: home.id,
      currentBundleId: activeBundleRecord.id,
      currentBundleDigest: activeBundleRecord.bundleDigest,
      version: activeBundleRecord.version + 1,
      bundle: targetBundleInput,
      createdAt: now,
    });

    const circle = await tx.circle.findUnique({
      where: { id: input.circleId },
      select: { circleType: true },
    });
    const planBinding = await tx.circleGovernanceBinding.findUnique({
      where: { id: binding.id },
    });
    if (
      !planBinding
      || planBinding.status !== 'active'
      || planBinding.targetCircleId !== binding.targetCircleId
      || planBinding.committeeCircleId !== binding.committeeCircleId
      || planBinding.policyId !== binding.policyId
      || planBinding.policyVersionId !== binding.policyVersionId
      || planBinding.policyVersion !== binding.policyVersion
    ) {
      throw new Error('governance_configuration_transition_current_authority_drift');
    }
    const targetReadinessChecks = buildPolicyTransitionReadinessChecks({
      bundle: targetBundle.bundle,
      bundleDigest: targetBundle.bundleDigest,
      circleId: input.circleId,
      binding: planBinding,
      bindingControlDigest: computeCircleGovernanceBindingControlDigest(planBinding),
      targetPolicyVersionId: nextPolicyVersionId,
      targetPolicyConfigDigest: proposedConfigDigest,
      targetEligibleActors,
    });
    const bootstrapReadiness = evaluateGovernanceBootstrapReadiness({
      bundle: stripBundleMetadata(targetBundle.bundle),
      checks: targetReadinessChecks,
    });
    const externalAuthorityBlockers = targetBundle.bundle.providerRefs.length > 0
      || targetBundle.bundle.resourceRefs.length > 0
      ? ['target_external_signer_readback_owned_by_P06']
      : [];
    const targetBlockers = [
      ...bootstrapReadiness.blockers.map((blocker) => blocker.code),
      ...externalAuthorityBlockers,
    ];
    const decisionElectorateTemplate = recoveryPolicy
      ? {
          source: 'frozen_recovery_policy_actors',
          weight: { mode: 'equal_one' },
          threshold: { mode: 'unanimity', value: null },
          ballotDisclosure: { mode: 'eligible_only' },
          quadraticVoiceCredits: { budgetPerActor: null },
        }
      : electorateTemplate;
    const authoritySnapshot = {
      bindingId: binding.id,
      bindingControlDigest: computeCircleGovernanceBindingControlDigest(planBinding),
      policyVersionId: currentPolicyVersion.id,
      policyVersion: currentPolicyVersion.version,
      policyConfigDigest: currentPolicyVersion.configDigest,
      electorate: decisionActors.map((actor: any) => ({
        pubkey: actor.pubkey,
        role: actor.role ?? null,
        weight: actor.weight,
        source: actor.source,
      })),
      electorateTemplate: decisionElectorateTemplate,
      mechanism: 'equal_weight_threshold',
      riskFloor: 'critical',
      sourceType: recoveryPolicy ? 'governance_recovery_policy' : 'governance_mandate',
    };
    const transitionImpact = await resolveConfigurationTransitionImpact(tx, {
      homeIdentityBindingId: home.id,
      currentActors: eligibleActors,
      targetActors: targetEligibleActors,
      providerRefs: targetBundle.bundle.providerRefs,
      resourceRefs: targetBundle.bundle.resourceRefs,
      policyChangedRights: resolvePolicyChangedRights(
        currentPolicyVersion.rules,
        proposedRules,
        actionScope,
      ),
    });
    const institutionalContinuity = await resolveConfigurationInstitutionalContinuity(tx, {
      home,
      binding: planBinding,
      profile,
      recoveryPolicyId: recoveryPolicy?.id ?? null,
    });
    const transitionPlanBody = {
      kind: 'governance_configuration_transition' as const,
      currentContract: 'governance_configuration_transition',
      changeLevel: 'policy' as const,
      changeGate: {
        currentProducerLevel: 'policy' as const,
        inheritedPreflightLevels: ['policy'] as const,
        higherLevelChanges: 'unsupported_fail_closed' as const,
      },
      fromBundle: bundleRef(activeBundleRecord),
      toBundle: bundleRef(targetBundle),
      structuredDiff: [
        policyDimensionDiff(
          'policyDimensions.voterEligibility.policy',
          activeBundle.policyDimensions.voterEligibility.policy!,
          targetPolicyRef,
        ),
        policyDimensionDiff(
          'policyDimensions.votingPower.policy',
          activeBundle.policyDimensions.votingPower.policy!,
          targetPolicyRef,
        ),
      ],
      authoritySnapshot,
      targetElectorateTemplate: electorateTemplate,
      targetCommitteeCircleId,
      recoveryAuthorization: recoveryPolicy ? {
        policyId: recoveryPolicy.id,
        trigger: GOVERNANCE_RECOVERY_TRIGGER,
        actorSnapshotDigest: recoveryPolicy.actorSnapshotDigest,
        actionType: recoveryPolicy.actionType,
        subjectType: recoveryPolicy.subjectType,
        subjectRef: recoveryPolicy.subjectRef,
        maxCostMinor: '0',
        assetAuthority: 'none',
        singleUse: true,
        activationExpiresAt: new Date(
          now.getTime() + GOVERNANCE_RECOVERY_ACTIVATION_TTL_SECONDS * 1000,
        ).toISOString(),
        ratificationTtlSeconds: recoveryPolicy.ratificationTtlSeconds,
      } : null,
      targetReadiness: {
        status: targetBlockers.length === 0 ? 'ready_for_governed_cutover' : 'blocked',
        blockers: targetBlockers,
        requiredChecks: [
          'profile',
          'action_contract',
          'electorate',
          'operator',
          'provider',
          'resource',
          'external_signer',
          'payer',
          'visibility',
          'recovery',
          'rollback',
        ],
        readinessDigest: hashCanonicalGovernanceValue(
          'alcheme.governance.configuration-transition-readiness',
          {
            bundleDigest: targetBundle.bundleDigest,
            checks: targetReadinessChecks,
            blockers: targetBlockers,
          },
        ),
        bootstrap: {
          state: bootstrapReadiness.state,
          bundleDigest: bootstrapReadiness.bundleDigest,
          checks: targetReadinessChecks,
          blockers: bootstrapReadiness.blockers,
        },
        profile: {
          status: 'ready',
          bindingId: profile.profileBindingId,
          versionRef: profile.profileVersionRef,
          definitionDigest: profile.profileDefinitionDigest,
        },
        actionContract: { status: 'ready', actionType: CIRCLE_GOVERNANCE_BINDING_POLICY_VERSION_UPDATE_ACTION_TYPE },
        electorate: { status: 'ready', eligibleActorCount: targetEligibleActors.length },
        operator: { status: 'ready' },
        provider: {
          status: targetBundle.bundle.providerRefs.length > 0 ? 'opaque_blocked' : 'not_applicable',
          refs: targetBundle.bundle.providerRefs,
        },
        resource: {
          status: targetBundle.bundle.resourceRefs.length > 0 ? 'opaque_blocked' : 'not_applicable',
          refs: targetBundle.bundle.resourceRefs,
        },
        externalSigner: {
          status: externalAuthorityBlockers.length > 0 ? 'p06_readback_required' : 'not_applicable',
          authority: 'none_required_for_p03_policy_pointer_cutover',
        },
        payer: { status: 'unchanged_active_ref', ref: targetBundle.bundle.payerPolicy },
        visibility: { status: 'unchanged_active_ref', ref: targetBundle.bundle.visibilityPolicy },
        recovery: { status: 'unchanged_active_ref', ref: targetBundle.bundle.emergencyPolicy },
        rollback: { status: 'available_before_cutover', bundle: bundleRef(activeBundleRecord) },
      },
      memberImpact: {
        affectedActorCount: transitionImpact.affectedActorPubkeys.length,
        actorSnapshotDigest: transitionImpact.actorSnapshotDigest,
        gainedProposalActors: transitionImpact.gainedProposalActors,
        lostProposalActors: transitionImpact.lostProposalActors,
        gainedVoteActors: transitionImpact.gainedVoteActors,
        lostVoteActors: transitionImpact.lostVoteActors,
        gainedOperatorActors: transitionImpact.gainedOperatorActors,
        lostOperatorActors: transitionImpact.lostOperatorActors,
        signerImpact: transitionImpact.signerImpact,
        changedRights: transitionImpact.changedRights,
        payerChange: 'none',
        visibilityChange: 'none',
        pendingTaskDisposition: 'freeze_current_case_snapshot',
      },
      resourceImpact: transitionImpact.resourceImpact,
      taskImpact: transitionImpact.taskImpact,
      exitWindow: transitionImpact.exitWindow,
      institutionalContinuity,
      notificationPlan: {
        type: 'governance_transition',
        sourceType: 'governance_case',
        recipientCount: transitionImpact.affectedActorPubkeys.length,
        recipientSnapshotDigest: transitionImpact.actorSnapshotDigest,
        impactDigest: transitionImpact.impactDigest,
        delivery: 'same_transaction_as_case_intake',
      },
      audience: {
        plan: 'authorized_members_and_case_operators',
        publicSummary: circle?.circleType === 'Secret'
          ? 'minimal_risk_summary_only'
          : 'bundle_digests_and_structured_diff',
        sealedEvidence: 'provider_and_resource_readback_refs',
        disclosureBasis: 'governance_case_review',
      },
      cutover: {
        status: 'not_started',
        currentAuthorityRemainsActive: true,
        targetMayApproveItself: false,
      },
      transitionSteps: [
        {
          id: 'prepare_target_bundle',
          owner: 'P03',
          reversibility: 'compensable',
          status: 'prepared',
        },
        {
          id: 'governed_local_pointer_cutover',
          owner: 'P03',
          reversibility: 'compensable',
          status: 'awaiting_accepted_decision',
        },
        {
          id: 'external_authority_or_resource_transfer',
          owner: 'P06',
          reversibility: 'irreversible',
          status: externalAuthorityBlockers.length > 0 ? 'blocked' : 'not_applicable',
        },
      ],
      irreversibleBoundary: {
        stepId: 'external_authority_or_resource_transfer',
        status: 'not_crossed',
        oneClickRollback: false,
      },
      rollbackPolicy: {
        beforeBoundary: 'new_governed_transition_to_verified_source_bundle',
        afterBoundary: 'manual_recovery_or_new_governed_transition',
        sourceBundle: rollbackOf
          ? asRecord(rollbackOf.sourceBundle)
          : bundleRef(activeBundleRecord),
      },
      rollbackOf,
      inFlightDisposition: {
        acceptedArtifacts: {
          mode: 'preserve_immutable_digest',
          authorityBlock: 'amendment_or_superseding_case_required',
          transitionOperatorMayRewrite: false,
        },
        existingOperationEffects: {
          mode: 'continue_frozen_lifecycle',
          policySource: 'initial_receipt_appeal_window_and_effect_events',
          transitionOperatorMayRewrite: false,
        },
        newInvocations: {
          mode: 'target_bundle_only',
          source: 'active_binding_and_authority_projection',
        },
        appealAccess: 'survives_membership_or_role_loss',
      },
    };
    const configurationTransitionPlan = {
      ...transitionPlanBody,
      planDigest: hashCanonicalGovernanceValue(TRANSITION_PLAN_DOMAIN, transitionPlanBody),
    };
    const requestedActionPayload = {
      bindingId: binding.id,
      targetCircleId: input.circleId,
      currentPolicyVersionId: currentPolicyVersion.id,
      currentPolicyVersion: currentPolicyVersion.version,
      currentPolicyConfigDigest: currentPolicyVersion.configDigest,
      bindingControlDigest: authoritySnapshot.bindingControlDigest,
      electorateTemplate,
      proposedConfigDigest,
      proposedPolicyVersionId: nextPolicyVersionId,
      proposedPolicyVersion: nextPolicyVersion,
      rollbackFromCaseId: input.rollbackFromCaseId ?? null,
      targetCommitteeCircleId,
      recoveryPolicyId: recoveryPolicy?.id ?? null,
      configurationTransitionPlan,
      proposedByPubkey: input.actorPubkey,
    };
    const result = await createGovernanceCaseIntake(tx, {
      circleId: input.circleId,
      title: rollbackOf
        ? 'Review governed configuration rollback'
        : 'Review governance configuration transition',
      requestedDecision: rollbackOf
        ? 'Should a new governed transition restore the verified source configuration under the currently active rules?'
        : 'Should the frozen target governance configuration replace the active bundle under the current governance rules?',
      requestedActionPayload,
      caseType: 'policy',
      templateId: 'basic-community',
      actionType: CIRCLE_GOVERNANCE_BINDING_POLICY_VERSION_UPDATE_ACTION_TYPE,
      subjectType: 'circle_governance_binding',
      subjectRef: input.bindingId,
      authorityBindingId: input.bindingId,
      authorityResolution,
      decisionMechanismKind: 'equal_weight_threshold',
      originKind: 'manual_item',
      sourceMessageIds: [],
      idempotencyKey: input.idempotencyKey,
      openedByPubkey: input.actorPubkey,
      actorRole: input.actorRole,
      relationshipKind: rollbackOf ? 'supersedes' : null,
      relatedCaseId: input.rollbackFromCaseId ?? null,
      relationshipReason: rollbackOf
        ? 'Governed rollback to the verified source configuration; no direct pointer rewind.'
        : null,
      openedAt: now,
    });
    if (!result.replayed) {
      await persistConfigurationTransitionNotifications(tx, {
        caseId: result.governanceCase.id,
        circleId: input.circleId,
        recipientPubkeys: transitionImpact.affectedActorPubkeys,
        planDigest: configurationTransitionPlan.planDigest,
        impactDigest: transitionImpact.impactDigest,
        actorSnapshotDigest: transitionImpact.actorSnapshotDigest,
        fromBundle: bundleRef(activeBundleRecord),
        toBundle: bundleRef(targetBundle),
        changedRights: transitionPlanBody.memberImpact.changedRights,
        taskImpact: transitionImpact.taskImpact,
        resourceImpact: transitionImpact.resourceImpact,
        exitWindow: transitionImpact.exitWindow,
        createdAt: now,
      });
    }
    return { status: 'requires_governance' as const, ...result };
  };
  return typeof prisma.$transaction === 'function'
    ? prisma.$transaction((tx: any) => execute(tx))
    : execute(prisma);
}

async function resolveConfigurationInstitutionalContinuity(
  tx: any,
  input: {
    home: any;
    binding: any;
    profile: {
      profileBindingId: string;
      profileVersionRef: string;
      profileDefinitionDigest: string;
      definition: any;
    };
    recoveryPolicyId: string | null;
  },
) {
  const [profileBinding, mandates] = await Promise.all([
    tx.governanceProfileBinding.findUnique({
      where: { id: input.profile.profileBindingId },
      include: { definitionVersion: true },
    }),
    tx.governanceMandate.findMany({
      where: {
        delegatorGovernanceHomeType: input.home.homeType,
        delegatorGovernanceHomeRef: input.home.homeRef,
        status: { in: ['active', 'offered', 'countered'] },
      },
      include: {
        binding: true,
        versions: { orderBy: { version: 'asc' } },
      },
      orderBy: { id: 'asc' },
    }),
  ]);
  if (
    !profileBinding
    || profileBinding.homeIdentityBindingId !== input.home.id
    || profileBinding.state !== 'active'
    || profileBinding.compatibilityStatus !== 'ready'
    || profileBinding.definitionVersion?.versionRef !== input.profile.profileVersionRef
    || profileBinding.definitionVersion?.definitionDigest !== input.profile.profileDefinitionDigest
  ) {
    throw new Error('governance_configuration_transition_profile_continuity_unavailable');
  }
  const mandateSnapshot = mandates.map((mandate: any) => {
    const versions = Array.isArray(mandate.versions) ? mandate.versions : [];
    const currentVersion = versions.find((version: any) => version.version === mandate.currentVersion);
    if (!currentVersion || currentVersion.termsDigest !== mandate.currentTermsDigest) {
      throw new Error('governance_configuration_transition_mandate_snapshot_invalid');
    }
    const disposition = input.recoveryPolicyId && mandate.id === input.binding.mandateId
      ? 'deactivate'
      : 'keep';
    const pendingOffers = versions.filter((version: any) => (
      version.targetAcceptedTermsDigest === version.termsDigest
      && version.committeeAcceptedTermsDigest == null
    )).map((version: any) => ({
      version: Number(version.version),
      termsDigest: String(version.termsDigest),
      disposition: 'keep',
    }));
    return {
      id: String(mandate.id),
      status: String(mandate.status),
      currentVersion: Number(mandate.currentVersion),
      currentTermsDigest: String(mandate.currentTermsDigest),
      targetAuthorizationStatus: String(mandate.targetAuthorizationStatus),
      committeeAcceptanceStatus: String(mandate.committeeAcceptanceStatus),
      bindingId: mandate.binding?.id == null ? null : String(mandate.binding.id),
      bindingStatus: mandate.binding?.status == null ? null : String(mandate.binding.status),
      disposition,
      activeEffectDisposition: currentVersion.terms?.effectPolicy == null
        ? 'not_applicable_collective_decision_only'
        : 'continue_frozen_lifecycle',
      appealAccess: 'bound_to_original_receipt',
      pendingOffers,
    };
  });
  if (!mandateSnapshot.some((mandate: any) => mandate.id === input.binding.mandateId)) {
    throw new Error('governance_configuration_transition_active_mandate_required');
  }
  const mandateSnapshotDigest = hashCanonicalGovernanceValue(
    TRANSITION_MANDATE_SNAPSHOT_DOMAIN,
    mandateSnapshot,
  );
  const definition = input.profile.definition;
  const compatibilityMatrix = {
    capability: {
      status: 'compatible_unchanged',
      actionCatalog: definition.actionCatalog,
      authorityCapabilities: definition.authorityCapabilities,
      adapterCapabilities: definition.adapterCapabilities,
    },
    schema: {
      status: 'compatible_unchanged',
      profileDefinitionDigest: input.profile.profileDefinitionDigest,
    },
    provider: {
      status: 'compatible_unchanged',
      capabilities: definition.providerCapabilities,
      runtimeOwner: 'P06',
    },
    uiMetadata: {
      status: 'compatible_unchanged',
      schemaId: definition.uiSchemaMetadata.schemaId,
      labelKey: definition.uiSchemaMetadata.labelKey,
    },
    incompatibilities: [] as string[],
  };
  const continuityBody = {
    homeIdentity: {
      id: String(input.home.id),
      homeType: String(input.home.homeType),
      homeRef: String(input.home.homeRef),
      identityVersion: Number(input.home.identityVersion),
      bindingDigest: String(input.home.bindingDigest),
      status: String(input.home.status),
      disposition: 'preserve_same_binding',
    },
    profile: {
      bindingId: String(profileBinding.id),
      state: String(profileBinding.state),
      versionRef: input.profile.profileVersionRef,
      definitionDigest: input.profile.profileDefinitionDigest,
      compatibilityStatus: String(profileBinding.compatibilityStatus),
      compatibilityDigest: String(profileBinding.compatibilityDigest),
      migrationPreviewDigest: String(profileBinding.migrationPreviewDigest),
      disposition: 'preserve_same_binding_and_version',
      compatibilityMatrix,
      inFlight: {
        existingInvocations: 'retain_frozen_profile_binding_and_version',
        newInvocations: 'resolve_active_profile_at_creation',
      },
    },
    mandates: {
      snapshot: mandateSnapshot,
      snapshotDigest: mandateSnapshotDigest,
      activeEffects: 'follow_each_frozen_mandate_disposition',
      appealAccess: 'bound_to_original_receipt',
      silentCopyOrLoss: 'forbidden',
    },
    retroactivity: {
      mode: 'prospective_only',
      existingContent: 'unchanged',
      memberSanctions: 'not_retroactive',
      governanceEligibility: 'not_retroactive',
      historicalReview: {
        status: 'not_requested',
        requiredProducer: 'governed_action_gateway',
        recording: 'new_invocation_and_receipt',
        originalRecord: 'preserve_immutable',
        appealPolicy: 'target_policy_for_new_review',
      },
    },
  };
  return {
    ...continuityBody,
    continuityDigest: hashCanonicalGovernanceValue(
      TRANSITION_CONTINUITY_DOMAIN,
      continuityBody,
    ),
  };
}

async function resolveGovernedConfigurationRollbackTarget(
  tx: any,
  input: {
    rollbackFromCaseId: string;
    homeIdentityBindingId: string;
    binding: any;
    currentPolicyVersion: any;
    activeBundleRecord: any;
    eligibleActorCount: number;
    actionScope: string;
  },
): Promise<{
  electorateTemplate: ReturnType<typeof normalizeCircleGovernanceCommitteeElectorateTemplate>;
  rules: unknown;
  rollbackOf: Record<string, unknown>;
}> {
  const rollbackCase = await tx.governanceCase.findUnique({
    where: { id: input.rollbackFromCaseId },
    include: { primaryRequest: { include: { decision: true } } },
  });
  const payload = asRecord(rollbackCase?.requestedActionPayload);
  const plan = asRecord(payload.configurationTransitionPlan);
  const fromBundleRef = asRecord(plan.fromBundle);
  const toBundleRef = asRecord(plan.toBundle);
  const boundary = asRecord(plan.irreversibleBoundary);
  const targetReadiness = asRecord(plan.targetReadiness);
  const provider = asRecord(targetReadiness.provider);
  const resource = asRecord(targetReadiness.resource);
  const primaryRequest = rollbackCase?.primaryRequest;
  if (
    !rollbackCase
    || rollbackCase.homeIdentityBindingId !== input.homeIdentityBindingId
    || rollbackCase.subjectType !== 'circle_governance_binding'
    || rollbackCase.subjectRef !== input.binding.id
    || plan.kind !== 'governance_configuration_transition'
    || plan.currentContract !== 'governance_configuration_transition'
    || boundary.stepId !== 'external_authority_or_resource_transfer'
    || boundary.status !== 'not_crossed'
    || boundary.oneClickRollback !== false
    || provider.status !== 'not_applicable'
    || resource.status !== 'not_applicable'
    || !primaryRequest?.decision
    || primaryRequest.state !== 'accepted'
    || primaryRequest.decision.decision !== 'accepted'
    || input.binding.sourceRequestId !== primaryRequest.id
    || input.binding.sourceDecisionDigest !== primaryRequest.decision.decisionDigest
    || payload.proposedPolicyVersionId !== input.currentPolicyVersion.id
    || input.activeBundleRecord.id !== toBundleRef.id
    || input.activeBundleRecord.bundleDigest !== toBundleRef.digest
  ) {
    throw new Error('governance_configuration_rollback_source_not_eligible');
  }
  const sourceBundleId = typeof fromBundleRef.id === 'string' ? fromBundleRef.id : '';
  const sourceBundle = sourceBundleId
    ? await tx.governanceConfigurationBundle.findUnique({ where: { id: sourceBundleId } })
    : null;
  const sourcePolicyVersionId = typeof payload.currentPolicyVersionId === 'string'
    ? payload.currentPolicyVersionId
    : '';
  const sourcePolicyVersion = sourcePolicyVersionId
    ? await tx.governancePolicyVersion.findUnique({ where: { id: sourcePolicyVersionId } })
    : null;
  if (
    !sourceBundle
    || sourceBundle.homeIdentityBindingId !== input.homeIdentityBindingId
    || sourceBundle.bundleDigest !== fromBundleRef.digest
    || sourceBundle.version !== Number(fromBundleRef.version)
    || !sourcePolicyVersion
    || sourcePolicyVersion.policyId !== input.binding.policyId
    || sourcePolicyVersion.status !== 'superseded'
    || sourcePolicyVersion.configDigest !== payload.currentPolicyConfigDigest
    || computeGovernancePolicyRulesDigest(sourcePolicyVersion.rules)
      !== sourcePolicyVersion.configDigest
  ) {
    throw new Error('governance_configuration_rollback_source_drift');
  }
  const rule = Array.isArray(asRecord(sourcePolicyVersion.rules).rules)
    ? (asRecord(sourcePolicyVersion.rules).rules as any[]).find((candidate) => (
        candidate?.id === `committee:${input.actionScope}`
      ))
    : null;
  if (!rule) throw new Error('governance_configuration_rollback_source_policy_invalid');
  const electorateTemplate = normalizeCircleGovernanceCommitteeElectorateTemplate({
    source: rule.electorate?.source,
    weight: rule.weight,
    threshold: rule.threshold,
    ballotDisclosure: rule.ballotDisclosure,
    quadraticVoiceCredits: rule.quadraticVoiceCredits,
  }, input.eligibleActorCount);
  if (
    computeGovernancePolicyRulesDigest(
      buildCommitteePolicyRules(input.actionScope, electorateTemplate),
    ) !== sourcePolicyVersion.configDigest
  ) {
    throw new Error('governance_configuration_rollback_source_policy_invalid');
  }
  return {
    electorateTemplate,
    rules: sourcePolicyVersion.rules,
    rollbackOf: {
      caseId: rollbackCase.id,
      sourceBundle: bundleRef(sourceBundle),
      sourcePolicyVersionId: sourcePolicyVersion.id,
      sourcePolicyConfigDigest: sourcePolicyVersion.configDigest,
      governingRequestId: primaryRequest.id,
      governingDecisionDigest: primaryRequest.decision.decisionDigest,
    },
  };
}

async function resolveConfigurationTransitionImpact(
  tx: any,
  input: {
    homeIdentityBindingId: string;
    currentActors: Array<{ pubkey: string; role?: string | null }>;
    targetActors: Array<{ pubkey: string; role?: string | null }>;
    providerRefs: GovernanceBootstrapVersionedRef[];
    resourceRefs: GovernanceBootstrapVersionedRef[];
    policyChangedRights: string[];
  },
) {
  const normalizeActors = (actors: Array<{ pubkey: string; role?: string | null }>) => (
    [...new Map(actors.map((actor) => [String(actor.pubkey), {
      pubkey: String(actor.pubkey),
      role: actor.role == null ? null : String(actor.role),
    }])).values()].sort((left, right) => left.pubkey.localeCompare(right.pubkey))
  );
  const currentActors = normalizeActors(input.currentActors);
  const targetActors = normalizeActors(input.targetActors);
  const currentActorKeys = new Set(currentActors.map((actor) => actor.pubkey));
  const targetActorKeys = new Set(targetActors.map((actor) => actor.pubkey));
  const currentOperatorKeys = new Set(
    currentActors.filter(isGovernanceCommitteeOperator).map((actor) => actor.pubkey),
  );
  const targetOperatorKeys = new Set(
    targetActors.filter(isGovernanceCommitteeOperator).map((actor) => actor.pubkey),
  );
  const difference = (left: Set<string>, right: Set<string>) => (
    [...left].filter((value) => !right.has(value)).sort()
  );
  const gainedVoteActors = difference(targetActorKeys, currentActorKeys);
  const lostVoteActors = difference(currentActorKeys, targetActorKeys);
  const gainedOperatorActors = difference(targetOperatorKeys, currentOperatorKeys);
  const lostOperatorActors = difference(currentOperatorKeys, targetOperatorKeys);
  if (lostVoteActors.length > 0 || lostOperatorActors.length > 0) {
    throw new Error('governance_configuration_transition_exit_window_policy_required');
  }
  const affectedActorPubkeys = [...new Set([
    ...currentActors.map((actor) => actor.pubkey),
    ...targetActors.map((actor) => actor.pubkey),
  ])].sort();
  const pendingTasks = await tx.governanceRequest.findMany({
    where: {
      homeIdentityBindingId: input.homeIdentityBindingId,
      state: 'active',
    },
    orderBy: [{ openedAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      state: true,
      actionType: true,
      targetType: true,
      targetRef: true,
      openedAt: true,
    },
  });
  const actorSnapshotDigest = hashCanonicalGovernanceValue(
    TRANSITION_ACTOR_SNAPSHOT_DOMAIN,
    { currentActors, targetActors },
  );
  const taskSnapshotDigest = hashCanonicalGovernanceValue(
    TRANSITION_TASK_SNAPSHOT_DOMAIN,
    pendingTasks.map((task: any) => ({
      id: task.id,
      state: task.state,
      actionType: task.actionType,
      targetType: task.targetType,
      targetRef: task.targetRef,
      openedAt: toIsoString(task.openedAt),
    })),
  );
  const signerImpact = input.providerRefs.length === 0
    ? { status: 'not_applicable', affectedSignerCount: 0, owner: 'P06' }
    : { status: 'p06_readback_required', affectedSignerCount: null, owner: 'P06' };
  const resourceImpact = {
    status: input.resourceRefs.length === 0 ? 'not_applicable' : 'p06_readback_required',
    affectedResourceCount: input.resourceRefs.length,
    refs: input.resourceRefs,
  };
  const taskImpact = {
    pendingTaskCount: pendingTasks.length,
    taskSnapshotDigest,
    disposition: 'freeze_current_case_snapshot',
  };
  const exitWindow = {
    status: 'not_required_no_rights_loss',
    deadline: null,
    affectedActorCount: 0,
  };
  const impactBody = {
    actorSnapshotDigest,
    affectedActorCount: affectedActorPubkeys.length,
    gainedProposalActors: [] as string[],
    lostProposalActors: [] as string[],
    gainedVoteActors,
    lostVoteActors,
    gainedOperatorActors,
    lostOperatorActors,
    changedRights: [...new Set([
      ...input.policyChangedRights,
      ...(gainedVoteActors.length > 0 || lostVoteActors.length > 0
        ? ['vote_eligibility']
        : []),
      ...(gainedOperatorActors.length > 0 || lostOperatorActors.length > 0
        ? ['operator_authority']
        : []),
    ])],
    signerImpact,
    payerChange: 'none',
    visibilityChange: 'none',
    resourceImpact,
    taskImpact,
    exitWindow,
  };
  return {
    ...impactBody,
    affectedActorPubkeys,
    impactDigest: hashCanonicalGovernanceValue(TRANSITION_IMPACT_DOMAIN, impactBody),
  };
}

function resolvePolicyChangedRights(
  currentRules: unknown,
  targetRules: unknown,
  actionScope: string,
): string[] {
  const findRule = (value: unknown) => {
    const rules = asRecord(value).rules;
    return Array.isArray(rules)
      ? rules.find((candidate) => candidate?.id === `committee:${actionScope}`) ?? null
      : null;
  };
  const current = findRule(currentRules);
  const target = findRule(targetRules);
  if (!current || !target) {
    throw new Error('governance_configuration_transition_policy_impact_unavailable');
  }
  return [
    !isDeepStrictEqual(current.threshold, target.threshold) ? 'decision_threshold' : null,
    !isDeepStrictEqual(current.ballotDisclosure, target.ballotDisclosure) ? 'ballot_disclosure' : null,
    !isDeepStrictEqual(current.quadraticVoiceCredits, target.quadraticVoiceCredits)
      ? 'voice_credit_budget'
      : null,
  ].filter((value): value is string => value !== null);
}

async function persistConfigurationTransitionNotifications(
  tx: any,
  input: {
    caseId: string;
    circleId: number;
    recipientPubkeys: string[];
    planDigest: string;
    impactDigest: string;
    actorSnapshotDigest: string;
    fromBundle: { id: string; version: number; digest: string };
    toBundle: { id: string; version: number; digest: string };
    changedRights: string[];
    taskImpact: Record<string, unknown>;
    resourceImpact: Record<string, unknown>;
    exitWindow: Record<string, unknown>;
    createdAt: Date;
  },
): Promise<void> {
  const recipients = await tx.user.findMany({
    where: { pubkey: { in: input.recipientPubkeys } },
    select: { id: true, pubkey: true },
    orderBy: { pubkey: 'asc' },
  });
  if (
    recipients.length !== input.recipientPubkeys.length
    || recipients.some((recipient: any, index: number) => (
      recipient.pubkey !== input.recipientPubkeys[index]
    ))
  ) {
    throw new Error('governance_configuration_transition_notification_recipient_drift');
  }
  if (recipients.length === 0) {
    throw new Error('governance_configuration_transition_notification_recipient_required');
  }
  await tx.notification.createMany({
    data: recipients.map((recipient: any) => ({
      userId: recipient.id,
      type: 'governance_transition',
      title: 'Governance configuration transition requires review',
      body: 'Your governance rights or pending work may be affected. Review the frozen impact and transition record before cutover.',
      sourceType: 'governance_case',
      sourceId: input.caseId,
      circleId: input.circleId,
      createdAt: input.createdAt,
      metadata: {
        schemaVersion: 1,
        canonicalUrl: `/governance/cases/${encodeURIComponent(input.caseId)}#configuration-transition-impact`,
        caseId: input.caseId,
        planDigest: input.planDigest,
        impactDigest: input.impactDigest,
        actorSnapshotDigest: input.actorSnapshotDigest,
        fromBundle: input.fromBundle,
        toBundle: input.toBundle,
        changedRights: input.changedRights,
        taskImpact: input.taskImpact,
        resourceImpact: input.resourceImpact,
        exitWindow: input.exitWindow,
      },
    })),
  });
}

async function buildConfigurationTransitionAuditRecord(
  prisma: any,
  input: {
    governanceCase: any;
    plan: Record<string, any>;
    transitionStatus: GovernanceConfigurationTransitionReadback['status'];
    fromBundle: { id: string; version: number; digest: string };
    toBundle: { id: string; version: number; digest: string };
    activeBundle: { id: string; version: number; digest: string } | null;
    activePolicy: { id: string; versionId: string; version: number } | null;
    governingRequestId: string | null;
    rollbackCases: any[];
    disposition: GovernanceConfigurationTransitionReadback['disposition'];
    recovery: GovernanceConfigurationTransitionReadback['recovery'];
    deadlockRecovery: GovernanceConfigurationTransitionReadback['deadlockRecovery'];
  },
): Promise<GovernanceConfigurationTransitionReadback['auditRecord']> {
  const governingRequest = input.governingRequestId
    ? await prisma.governanceRequest.findUnique({
        where: { id: input.governingRequestId },
        include: {
          decision: true,
          receipts: { orderBy: [{ executedAt: 'asc' }, { id: 'asc' }] },
        },
      })
    : null;
  const receipts = Array.isArray(governingRequest?.receipts)
    ? governingRequest.receipts.map((receipt: any) => ({
        id: String(receipt.id),
        actionType: String(receipt.actionType),
        executorModule: String(receipt.executorModule),
        executionStatus: String(receipt.executionStatus),
        executionRef: receipt.executionRef == null ? null : String(receipt.executionRef),
        errorCode: receipt.errorCode == null ? null : String(receipt.errorCode),
        decisionDigest: receipt.decisionDigest == null ? null : String(receipt.decisionDigest),
        evidenceDigest: receipt.executionEvidenceDigest == null
          ? null
          : String(receipt.executionEvidenceDigest),
        executedAt: toIsoString(receipt.executedAt),
      }))
    : [];
  const failedReceipts = receipts.filter((receipt: any) => receipt.executionStatus === 'failed');
  const structuredDiff = Array.isArray(input.plan.structuredDiff)
    ? input.plan.structuredDiff
    : [];
  const structuredDiffDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.configuration-transition-diff',
    structuredDiff,
  );
  const rollbackRecords = input.rollbackCases.map((candidate: any) => {
    const payload = asRecord(candidate.requestedActionPayload);
    const plan = asRecord(payload.configurationTransitionPlan);
    return {
      caseId: String(candidate.id),
      requestId: candidate.primaryRequest?.id == null ? null : String(candidate.primaryRequest.id),
      decision: candidate.primaryRequest?.decision?.decision == null
        ? null
        : String(candidate.primaryRequest.decision.decision),
      decisionDigest: candidate.primaryRequest?.decision?.decisionDigest == null
        ? null
        : String(candidate.primaryRequest.decision.decisionDigest),
      fromBundle: asRecord(plan.fromBundle),
      toBundle: asRecord(plan.toBundle),
      openedAt: toIsoString(candidate.openedAt),
    };
  });
  const oldRulesDecision = governingRequest ? {
    requestId: String(governingRequest.id),
    ruleId: String(governingRequest.ruleId),
    policyVersionId: String(governingRequest.policyVersionId),
    policyVersion: Number(governingRequest.policyVersion),
    state: String(governingRequest.state),
    decision: governingRequest.decision?.decision == null
      ? null
      : String(governingRequest.decision.decision),
    decisionDigest: governingRequest.decision?.decisionDigest == null
      ? null
      : String(governingRequest.decision.decisionDigest),
    decidedAt: toIsoString(governingRequest.decision?.decidedAt),
  } : null;
  const authorizedBody = {
    schemaVersion: 1,
    visibility: 'authorized_full',
    caseId: String(input.governanceCase.id),
    status: input.transitionStatus,
    planDigest: String(input.plan.planDigest ?? ''),
    fromBundle: input.fromBundle,
    toBundle: input.toBundle,
    structuredDiff,
    structuredDiffDigest,
    oldRulesDecision,
    handoffReceipts: receipts,
    cutover: {
      status: input.transitionStatus,
      activeBundle: input.activeBundle,
      activePolicy: input.activePolicy,
    },
    failure: {
      status: failedReceipts.length > 0 ? 'recorded' : 'none_recorded',
      receipts: failedReceipts,
    },
    rollback: {
      status: input.recovery.status,
      records: rollbackRecords,
    },
    recovery: {
      status: input.recovery.status,
      deadlockStatus: input.deadlockRecovery.status,
      authorityContinuityStatus: input.deadlockRecovery.authorityContinuity.status,
      recoveryCaseId: input.deadlockRecovery.recoveryCaseId,
      ratificationCaseId: input.deadlockRecovery.ratificationCaseId,
    },
    institutionalContinuity: asRecord(input.plan.institutionalContinuity),
    inFlightDisposition: input.disposition,
    historicalCaseRecalculation: false,
  };
  const recordDigest = hashCanonicalGovernanceValue(TRANSITION_AUDIT_DOMAIN, authorizedBody);
  const authorized = { ...authorizedBody, recordDigest };
  const publicSummary = String(asRecord(input.plan.audience).publicSummary ?? 'minimal_risk_summary_only');
  const discloseBundleFacts = publicSummary === 'bundle_digests_and_structured_diff';
  const publicRecord = {
    schemaVersion: 1,
    visibility: discloseBundleFacts ? 'public_safe' : 'minimal_risk_summary_only',
    recordDigest,
    status: input.transitionStatus,
    riskSummary: discloseBundleFacts
      ? 'governance_configuration_transition'
      : 'restricted_governance_transition',
    planDigest: discloseBundleFacts ? String(input.plan.planDigest ?? '') : null,
    fromBundleDigest: discloseBundleFacts ? input.fromBundle.digest : null,
    toBundleDigest: discloseBundleFacts ? input.toBundle.digest : null,
    structuredDiffDigest: discloseBundleFacts ? structuredDiffDigest : null,
    failureStatus: failedReceipts.length > 0 ? 'recorded' : 'none_recorded',
    rollbackStatus: input.recovery.status,
    recoveryStatus: input.deadlockRecovery.status,
    continuityDigest: discloseBundleFacts
      ? String(asRecord(input.plan.institutionalContinuity).continuityDigest ?? '')
      : null,
    retroactivityMode: discloseBundleFacts
      ? String(asRecord(asRecord(input.plan.institutionalContinuity).retroactivity).mode ?? '')
      : null,
    inFlightDispositionStatus: input.disposition.status,
    historicalCaseRecalculation: false,
  };
  return { authorized, public: publicRecord };
}

function toIsoString(value: unknown): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function persistDraftPolicyVersion(
  prisma: any,
  input: {
    id: string;
    policyId: string;
    version: number;
    rules: unknown;
    configDigest: string;
    createdByPubkey: string;
  },
): Promise<void> {
  const existing = await prisma.governancePolicyVersion.findUnique({ where: { id: input.id } });
  if (existing) {
    if (
      existing.policyId !== input.policyId
      || existing.version !== input.version
      || existing.status !== 'draft'
      || existing.configDigest !== input.configDigest
      || !isDeepStrictEqual(existing.rules, input.rules)
      || existing.createdByPubkey !== input.createdByPubkey
    ) {
      throw new Error('governance_configuration_transition_draft_policy_conflict');
    }
    return;
  }
  await prisma.governancePolicyVersion.create({
    data: {
      ...input,
      status: 'draft',
      activatedAt: null,
    },
  });
}

function assertCurrentPolicyDimensions(bundle: GovernanceBootstrapBundle, currentVersion: any): void {
  for (const dimension of ['voterEligibility', 'votingPower'] as const) {
    const ref = bundle.policyDimensions[dimension].policy;
    if (
      bundle.policyDimensions[dimension].applicability !== 'applicable'
      || !ref
      || ref.ref !== currentVersion.id
      || ref.version !== String(currentVersion.version)
      || ref.digest !== currentVersion.configDigest
    ) {
      throw new Error('governance_configuration_transition_active_policy_dimension_mismatch');
    }
  }
}

function buildTargetBundle(
  current: GovernanceBootstrapBundle,
  targetPolicyRef: GovernanceBootstrapVersionedRef,
): GovernanceBootstrapBundleInput {
  const input = stripBundleMetadata(current);
  return {
    ...input,
    policyDimensions: {
      ...input.policyDimensions,
      voterEligibility: { applicability: 'applicable', policy: targetPolicyRef },
      votingPower: { applicability: 'applicable', policy: targetPolicyRef },
    },
  };
}

function stripBundleMetadata(bundle: GovernanceBootstrapBundle): GovernanceBootstrapBundleInput {
  const {
    schemaVersion: _schemaVersion,
    canonicalCodecVersion: _canonicalCodecVersion,
    ...input
  } = bundle;
  return JSON.parse(JSON.stringify(input)) as GovernanceBootstrapBundleInput;
}

function policyDimensionDiff(
  path: string,
  from: GovernanceBootstrapVersionedRef,
  to: GovernanceBootstrapVersionedRef,
) {
  return { path, category: 'institutional_power', from, to };
}

function buildPolicyTransitionReadinessChecks(input: {
  bundle: GovernanceBootstrapBundle;
  bundleDigest: string;
  circleId: number;
  binding: any;
  bindingControlDigest: string;
  targetPolicyVersionId: string;
  targetPolicyConfigDigest: string;
  targetEligibleActors: Array<{ pubkey: string; role?: string | null; weight: string; source: string }>;
}): GovernanceBootstrapReadinessChecks {
  const ready = (
    evidenceRef: string,
    evidenceDigest: string,
  ) => ({
    status: 'ready' as const,
    evidenceRef,
    evidenceDigest,
    bundleDigest: input.bundleDigest,
    reasonCode: null,
  });
  const notApplicable = {
    status: 'not_applicable' as const,
    evidenceRef: null,
    evidenceDigest: null,
    bundleDigest: null,
    reasonCode: null,
  };
  const unknown = (reasonCode: string) => ({
    status: 'unknown' as const,
    evidenceRef: null,
    evidenceDigest: null,
    bundleDigest: input.bundleDigest,
    reasonCode,
  });
  return {
    eligibleActors: ready(
      `circle:${input.circleId}:target-electorate`,
      hashCanonicalGovernanceValue(
        'alcheme.governance.configuration-transition-target-electorate',
        input.targetEligibleActors,
      ),
    ),
    threshold: ready(input.targetPolicyVersionId, input.targetPolicyConfigDigest),
    authority: ready(input.binding.id, input.bindingControlDigest),
    funding: ready(input.bundle.payerPolicy.ref, input.bundle.payerPolicy.digest),
    publicSafeBoundary: ready(
      input.bundle.visibilityPolicy.ref,
      input.bundle.visibilityPolicy.digest,
    ),
    recoveryContact: ready(
      input.bundle.emergencyPolicy.ref,
      input.bundle.emergencyPolicy.digest,
    ),
    mandates: input.bundle.mandateRefs.length === 0
      ? notApplicable
      : unknown('target_mandate_readback_required'),
    providers: input.bundle.providerRefs.length === 0
      ? notApplicable
      : unknown('target_provider_readback_owned_by_P06'),
    resources: input.bundle.resourceRefs.length === 0
      ? notApplicable
      : unknown('target_resource_readback_owned_by_P06'),
  };
}

function bundleRef(value: { id: string; version: number; bundleDigest: string }) {
  return { id: value.id, version: value.version, digest: value.bundleDigest };
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}
