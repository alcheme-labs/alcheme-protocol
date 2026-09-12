import { hashCanonicalGovernanceValue } from './canonicalCodec';
import {
  buildCommitteePolicyRules,
  resolveActiveCircleGovernanceBinding,
} from './circleGovernanceBindings';
import {
  hasGovernanceCommitteeOperator,
  listCommitteeEligibleActors,
} from './circleCommitteeActors';
import {
  CIRCLE_GOVERNANCE_BINDING_POLICY_VERSION_UPDATE_ACTION_TYPE,
} from './circleGovernanceBindingExecution';
import { createGovernanceCaseIntake } from './governanceCase';
import { computeGovernancePolicyRulesDigest } from './policyEngine';
import {
  projectGovernanceAuthorityHealthReadback,
  type GovernanceAuthorityHealthReadback,
} from './governanceAuthorityHealthReadback';

export const GOVERNANCE_RECOVERY_TRIGGER = 'zero_eligible_electorate';
export const GOVERNANCE_THRESHOLD_UNREACHABLE_TRIGGER = 'signer_threshold_unreachable';
export type GovernanceAuthorityContinuityTrigger =
  | typeof GOVERNANCE_RECOVERY_TRIGGER
  | typeof GOVERNANCE_THRESHOLD_UNREACHABLE_TRIGGER;
export const GOVERNANCE_RECOVERY_ACTIVATION_TTL_SECONDS = 60 * 60;
export const GOVERNANCE_RECOVERY_RATIFICATION_TTL_SECONDS = 24 * 60 * 60;
export const GOVERNANCE_RECOVERY_POLICY_KIND = 'governance_recovery_policy_proposal';
export const GOVERNANCE_RECOVERY_RATIFICATION_KIND = 'governance_recovery_ratification';

const ACTOR_SNAPSHOT_DOMAIN = 'alcheme.governance.recovery-actor-snapshot';
const POLICY_ID_DOMAIN = 'alcheme.governance.recovery-policy-id';
const AUTHORITY_CONTINUITY_EVIDENCE_DOMAIN = 'alcheme.governance.authority-continuity-evidence';

export type GovernanceAuthorityContinuityStatus =
  | 'not_applicable'
  | 'healthy'
  | 'manual_recovery_pending'
  | 'permanently_blocked_governance_authority'
  | 'drifted';

export interface GovernanceAuthorityContinuityReadback {
  status: GovernanceAuthorityContinuityStatus;
  stateVersion: number;
  trigger: GovernanceAuthorityContinuityTrigger | null;
  canonicalAuthority: 'verified' | 'unverified' | 'not_applicable';
  offPlatformReconstitution: 'not_verified' | 'not_applicable';
  externalAuthorityStatus: 'p06_provider_readback_required';
  fallbackAuthority: 'none';
  reporterAuthority: 'none';
  evidenceDigest: string | null;
  evidenceIntegrity: 'verified' | 'not_recorded' | 'drifted';
  startedAt: string | null;
  terminalAt: string | null;
  canRetryTargetPreflight: boolean;
  canRecordPermanentBlock: boolean;
  warning: string;
  faultControls: {
    waitingPeriod: 'until_lawful_authority_restored';
    freeze: 'new_governance_except_recovery_and_history';
    successor: 'prebound_recovery_circle_or_manual_reconstitution';
    notification: 'circle_managers_and_current_members';
    providerAuthority: 'p06_provider_readback_required';
  } | null;
}

export interface GovernanceRecoveryReadback {
  mode: 'prebound_recovery_circle' | 'manual_recovery_only';
  status:
    | 'not_configured'
    | 'available'
    | 'activation_pending'
    | 'ratification_pending'
    | 'ratified'
    | 'ratification_failed'
    | 'consumed';
  automaticRecoveryConfigured: boolean;
  warning: string;
  trigger: typeof GOVERNANCE_RECOVERY_TRIGGER | null;
  recoveryCircleId: number | null;
  frozenActorCount: number;
  unanimityRequired: boolean;
  maxCostMinor: '0';
  activationTtlSeconds: number;
  ratificationTtlSeconds: number;
  ratificationDeadline: string | null;
  failClosed: true;
  authorityContinuity: GovernanceAuthorityContinuityReadback;
  authorityHealth: GovernanceAuthorityHealthReadback;
  resourceAuthorityRecovery: GovernanceResourceAuthorityRecoveryReadback;
}

export interface GovernanceResourceAuthorityRecoveryReadback {
  authority: 'canonical_resource_authority_and_provider_readback';
  status:
    | 'not_configured'
    | 'healthy'
    | 'recovery_pending'
    | 'rotation_failed'
    | 'permanently_blocked_external_authority';
  resourceBindingCount: number;
  authorityBindingCount: number;
  verifiedProviderReadbackCount: number;
  acceptedArtifacts: Array<{
    requestId: string;
    decisionDigest: string;
    provider: string;
    resourceBindingId: string;
  }>;
  resourceBindings: Array<{
    id: string;
    provider: string;
    capability: string;
    status: string;
    resourceRef: string | null;
    ownerProgramRef: string;
    verifiedSlot: number | null;
    stateDigest: string | null;
    providerReadback: 'verified' | 'missing';
    authorityBindings: Array<{
      id: string;
      role: string;
      status: string;
      currentAuthority: string | null;
      custodyStatus: string;
      verifiedSlot: number | null;
      stateDigest: string | null;
    }>;
  }>;
  rotation: {
    providerNativeRotationAvailable: false;
    externalSignerRevokeReadback: 'verified' | 'not_verified' | 'not_applicable';
    circleOwnerAdminFallbackAllowed: false;
    fallbackAuthority: 'none';
  };
  unfulfilledObligations: string[];
  residualRisks: string[];
}

export async function resolveGovernanceRecoveryReadback(
  prisma: any,
  input: { circleId: number; bindingId?: string | null; now?: Date },
): Promise<GovernanceRecoveryReadback> {
  const bindingId = input.bindingId ?? null;
  const [policy, binding] = await Promise.all([
    bindingId && prisma.governanceRecoveryPolicy?.findFirst
      ? prisma.governanceRecoveryPolicy.findFirst({
          where: { OR: [{ bindingId }, { targetBindingId: bindingId }] },
          orderBy: { createdAt: 'desc' },
        })
      : null,
    bindingId && prisma.circleGovernanceBinding?.findUnique
      ? prisma.circleGovernanceBinding.findUnique({ where: { id: bindingId } })
      : null,
  ]);
  const authorityContinuity = projectGovernanceAuthorityContinuityReadback(binding);
  const authorityHealth = projectGovernanceAuthorityHealthReadback(binding, input.now ?? new Date());
  const resourceBindings = await readGovernanceResourceAuthorityBindings(prisma, input.circleId);
  const resourceAuthorityRecovery = projectGovernanceResourceAuthorityRecoveryReadback(
    resourceBindings,
    authorityContinuity,
    authorityHealth,
  );
  if (!policy) {
    return {
      mode: 'manual_recovery_only',
      status: 'not_configured',
      automaticRecoveryConfigured: false,
      warning: 'No automatic recovery is configured. A governance deadlock may be permanently unrecoverable.',
      trigger: null,
      recoveryCircleId: null,
      frozenActorCount: 0,
      unanimityRequired: true,
      maxCostMinor: '0',
      activationTtlSeconds: GOVERNANCE_RECOVERY_ACTIVATION_TTL_SECONDS,
      ratificationTtlSeconds: GOVERNANCE_RECOVERY_RATIFICATION_TTL_SECONDS,
      ratificationDeadline: null,
      failClosed: true,
      authorityContinuity,
      authorityHealth,
      resourceAuthorityRecovery,
    };
  }
  const actors = Array.isArray(policy.actorSnapshot) ? policy.actorSnapshot : [];
  const ratificationExpired = policy.ratificationStatus === 'pending'
    && policy.ratificationDeadline
    && (input.now ?? new Date()) > new Date(policy.ratificationDeadline);
  return {
    mode: 'prebound_recovery_circle',
    status: ratificationExpired
      ? 'ratification_failed'
      : normalizeReadbackStatus(policy.status, policy.ratificationStatus),
    automaticRecoveryConfigured: true,
    warning: ratificationExpired
      || policy.ratificationStatus === 'failed'
      || policy.ratificationStatus === 'rejected'
      || policy.ratificationStatus === 'expired'
      ? 'Recovery ratification failed. Future high and critical actions remain blocked.'
      : 'Recovery is limited to one zero-electorate configuration transition and does not grant asset authority.',
    trigger: GOVERNANCE_RECOVERY_TRIGGER,
    recoveryCircleId: Number(policy.recoveryCircleId),
    frozenActorCount: actors.length,
    unanimityRequired: true,
    maxCostMinor: '0',
    activationTtlSeconds: Number(policy.activationTtlSeconds),
    ratificationTtlSeconds: Number(policy.ratificationTtlSeconds),
    ratificationDeadline: policy.ratificationDeadline
      ? new Date(policy.ratificationDeadline).toISOString()
      : null,
    failClosed: true,
    authorityContinuity,
    authorityHealth,
    resourceAuthorityRecovery,
  };
}

export async function readGovernanceResourceAuthorityBindings(
  prisma: any,
  circleId: number,
): Promise<any[]> {
  if (
    !Number.isSafeInteger(circleId)
    || circleId <= 0
    || !prisma?.governanceHomeIdentityBinding?.findMany
    || !prisma?.governedResourceBinding?.findMany
  ) return [];
  const homes = await prisma.governanceHomeIdentityBinding.findMany({
    where: { homeType: 'circle', homeRef: String(circleId), supersededAt: null },
    select: { id: true },
    orderBy: { identityVersion: 'desc' },
    take: 5,
  });
  const homeIds = homes.map((home: any) => text(home?.id)).filter(Boolean) as string[];
  if (homeIds.length === 0) return [];
  return prisma.governedResourceBinding.findMany({
    where: { homeIdentityBindingId: { in: homeIds } },
    include: { authorityBindings: { orderBy: { authorityRole: 'asc' } } },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    take: 25,
  });
}

export function projectGovernanceResourceAuthorityRecoveryReadback(
  resources: any[],
  authorityContinuity: GovernanceAuthorityContinuityReadback,
  authorityHealth: GovernanceAuthorityHealthReadback,
): GovernanceResourceAuthorityRecoveryReadback {
  const resourceBindings = (Array.isArray(resources) ? resources : [])
    .map((resource) => normalizeResourceAuthorityBinding(resource))
    .filter((resource): resource is NonNullable<ReturnType<typeof normalizeResourceAuthorityBinding>> => resource !== null);
  const authorityBindingCount = resourceBindings.reduce(
    (count, resource) => count + resource.authorityBindings.length,
    0,
  );
  const verifiedProviderReadbackCount = resourceBindings.filter(
    (resource) => resource.providerReadback === 'verified',
  ).length;
  const acceptedArtifacts = resourceBindings.flatMap((resource) => (
    resource.sourceRequestId && resource.sourceDecisionDigest
      ? [{
          requestId: resource.sourceRequestId,
          decisionDigest: resource.sourceDecisionDigest,
          provider: resource.provider,
          resourceBindingId: resource.id,
        }]
      : []
  ));
  const lostOrCompromisedSigner = authorityHealth.faultAssessment?.faultClass === 'lost_key'
    || authorityHealth.faultAssessment?.faultClass === 'compromised_key';
  const permanentlyBlocked = authorityContinuity.status === 'permanently_blocked_governance_authority'
    || (
      authorityHealth.faultAssessment?.faultClass === 'lost_key'
      && authorityHealth.faultAssessment.emergencyFreeze.reviewStatus === 'overdue'
    );
  const recoveryPending = authorityContinuity.status === 'manual_recovery_pending'
    || authorityHealth.highRiskPlanGate !== 'allowed'
    || resourceBindings.some((resource) => resource.providerReadback !== 'verified');
  const status: GovernanceResourceAuthorityRecoveryReadback['status'] =
    resourceBindings.length === 0
      ? 'not_configured'
      : permanentlyBlocked
        ? 'permanently_blocked_external_authority'
        : lostOrCompromisedSigner
          ? 'rotation_failed'
          : recoveryPending
            ? 'recovery_pending'
            : 'healthy';
  const unfulfilledObligations = [
    ...(resourceBindings.length === 0 ? ['no_p06_resource_binding_available'] : []),
    ...(verifiedProviderReadbackCount !== resourceBindings.length
      ? ['authoritative_provider_readback_required']
      : []),
    ...(lostOrCompromisedSigner ? ['external_signer_rotation_or_reconstitution_required'] : []),
    ...(permanentlyBlocked ? ['unfulfilled_original_external_authority_obligations_preserved'] : []),
  ];
  const residualRisks = [
    'resource_pause_requires_separate_provider_authority',
    'external_signer_revoke_requires_authoritative_provider_readback',
    ...(resourceBindings.some((resource) => resource.authorityBindings.length === 0)
      ? ['resource_authority_bindings_missing']
      : []),
    ...(permanentlyBlocked ? ['external_authority_may_be_permanently_unrecoverable'] : []),
  ];
  return {
    authority: 'canonical_resource_authority_and_provider_readback',
    status,
    resourceBindingCount: resourceBindings.length,
    authorityBindingCount,
    verifiedProviderReadbackCount,
    acceptedArtifacts,
    resourceBindings: resourceBindings.map(({
      sourceRequestId: _sourceRequestId,
      sourceDecisionDigest: _sourceDecisionDigest,
      ...resource
    }) => resource),
    rotation: {
      providerNativeRotationAvailable: false,
      externalSignerRevokeReadback: status === 'healthy' ? 'verified' : 'not_verified',
      circleOwnerAdminFallbackAllowed: false,
      fallbackAuthority: 'none',
    },
    unfulfilledObligations,
    residualRisks,
  };
}

export async function enterManualGovernanceRecoveryPending(
  prisma: any,
  input: {
    bindingId: string;
    actorPubkey: string;
    now: Date;
    trigger?: GovernanceAuthorityContinuityTrigger;
    eligibleActorCount?: number;
    requiredThreshold?: number | null;
  },
): Promise<GovernanceAuthorityContinuityReadback> {
  const binding = await prisma.circleGovernanceBinding.findUnique({ where: { id: input.bindingId } });
  if (!binding || binding.status !== 'active') {
    throw new Error('governance_authority_continuity_binding_unavailable');
  }
  const current = normalizeAuthorityContinuityStatus(binding.authorityContinuityState);
  if (current === 'permanently_blocked_governance_authority') {
    throw new Error('permanently_blocked_governance_authority');
  }
  if (current === 'manual_recovery_pending') {
    return projectGovernanceAuthorityContinuityReadback(binding);
  }
  if (current !== 'healthy') throw new Error('governance_authority_continuity_state_drift');
  const trigger = input.trigger ?? GOVERNANCE_RECOVERY_TRIGGER;
  const eligibleActorCount = trigger === GOVERNANCE_RECOVERY_TRIGGER
    ? 0
    : Number(input.eligibleActorCount);
  const requiredThreshold = input.requiredThreshold == null
    ? null
    : Number(input.requiredThreshold);
  if (
    !Number.isSafeInteger(eligibleActorCount)
    || eligibleActorCount < 0
    || (trigger === GOVERNANCE_THRESHOLD_UNREACHABLE_TRIGGER
      && (!Number.isSafeInteger(requiredThreshold) || Number(requiredThreshold) <= eligibleActorCount))
  ) throw new Error('governance_authority_continuity_trigger_evidence_invalid');
  const evidence = {
    kind: 'governance_authority_continuity_assessment',
    schemaVersion: 1,
    state: 'manual_recovery_pending',
    trigger,
    bindingId: binding.id,
    targetCircleId: binding.targetCircleId,
    committeeCircleId: binding.committeeCircleId,
    eligibleActorCount,
    requiredThreshold,
    recoveryPolicy: 'not_configured',
    canonicalAuthority: 'unverified',
    offPlatformReconstitution: 'not_verified',
    externalAuthorityStatus: 'not_assessed_owned_by_p06',
    fallbackAuthority: 'none',
    reportedByPubkey: input.actorPubkey,
    reporterAuthority: 'none',
    waitingPeriod: 'until_lawful_authority_restored',
    freeze: 'new_governance_except_recovery_and_history',
    successor: 'prebound_recovery_circle_or_manual_reconstitution',
    notification: 'circle_managers_and_current_members',
    observedAt: input.now.toISOString(),
  };
  const evidenceDigest = hashCanonicalGovernanceValue(
    AUTHORITY_CONTINUITY_EVIDENCE_DOMAIN,
    evidence,
  );
  const updated = await prisma.circleGovernanceBinding.updateMany({
    where: {
      id: binding.id,
      status: 'active',
      authorityContinuityState: 'healthy',
      authorityContinuityVersion: Number(binding.authorityContinuityVersion ?? 0),
    },
    data: {
      authorityContinuityState: 'manual_recovery_pending',
      authorityContinuityVersion: Number(binding.authorityContinuityVersion ?? 0) + 1,
      authorityContinuityEvidence: evidence,
      authorityContinuityEvidenceDigest: evidenceDigest,
      authorityContinuityStartedAt: input.now,
      authorityContinuityTerminalAt: null,
    },
  });
  if (updated.count !== 1) {
    const concurrent = await prisma.circleGovernanceBinding.findUnique({ where: { id: binding.id } });
    if (normalizeAuthorityContinuityStatus(concurrent?.authorityContinuityState) === 'manual_recovery_pending') {
      return projectGovernanceAuthorityContinuityReadback(concurrent);
    }
    throw new Error('governance_authority_continuity_stale_write');
  }
  return projectGovernanceAuthorityContinuityReadback({
    ...binding,
    authorityContinuityState: 'manual_recovery_pending',
    authorityContinuityVersion: Number(binding.authorityContinuityVersion ?? 0) + 1,
    authorityContinuityEvidence: evidence,
    authorityContinuityEvidenceDigest: evidenceDigest,
    authorityContinuityStartedAt: input.now,
    authorityContinuityTerminalAt: null,
  });
}

export async function resumeGovernanceAuthorityContinuityWithVerifiedExistingAuthority(
  prisma: any,
  input: {
    bindingId: string;
    actorPubkey: string;
    eligibleActorCount: number;
    requiredThreshold?: number | null;
    operatorVerified: boolean;
    now: Date;
  },
): Promise<GovernanceAuthorityContinuityReadback> {
  const binding = await prisma.circleGovernanceBinding.findUnique({ where: { id: input.bindingId } });
  if (!binding || binding.status !== 'active') {
    throw new Error('governance_authority_continuity_binding_unavailable');
  }
  const current = normalizeAuthorityContinuityStatus(binding.authorityContinuityState);
  if (current === 'permanently_blocked_governance_authority') {
    throw new Error('permanently_blocked_governance_authority');
  }
  if (current === 'healthy') return projectGovernanceAuthorityContinuityReadback(binding);
  if (
    current !== 'manual_recovery_pending'
    || !Number.isSafeInteger(input.eligibleActorCount)
    || input.eligibleActorCount <= 0
    || input.operatorVerified !== true
  ) throw new Error('governance_authority_continuity_existing_authority_unverified');
  const previousTrigger = binding.authorityContinuityEvidence?.trigger == null
    ? null
    : String(binding.authorityContinuityEvidence.trigger);
  if (
    previousTrigger === GOVERNANCE_THRESHOLD_UNREACHABLE_TRIGGER
    && (
      !Number.isSafeInteger(input.requiredThreshold)
      || Number(input.requiredThreshold) <= 0
      || Number(input.requiredThreshold) > input.eligibleActorCount
    )
  ) throw new Error('governance_authority_continuity_threshold_still_unreachable');
  const evidence = {
    kind: 'governance_authority_continuity_assessment',
    schemaVersion: 1,
    state: 'healthy',
    resolution: 'existing_canonical_governance_authority_verified',
    bindingId: binding.id,
    targetCircleId: binding.targetCircleId,
    committeeCircleId: binding.committeeCircleId,
    eligibleActorCount: input.eligibleActorCount,
    requiredThreshold: input.requiredThreshold ?? null,
    operatorVerified: true,
    fallbackAuthority: 'none',
    verifiedByPubkey: input.actorPubkey,
    previousEvidenceDigest: binding.authorityContinuityEvidenceDigest ?? null,
    verifiedAt: input.now.toISOString(),
  };
  const evidenceDigest = hashCanonicalGovernanceValue(
    AUTHORITY_CONTINUITY_EVIDENCE_DOMAIN,
    evidence,
  );
  const version = Number(binding.authorityContinuityVersion ?? 0);
  const updated = await prisma.circleGovernanceBinding.updateMany({
    where: {
      id: binding.id,
      status: 'active',
      authorityContinuityState: 'manual_recovery_pending',
      authorityContinuityVersion: version,
    },
    data: {
      authorityContinuityState: 'healthy',
      authorityContinuityVersion: version + 1,
      authorityContinuityEvidence: evidence,
      authorityContinuityEvidenceDigest: evidenceDigest,
      authorityContinuityStartedAt: null,
      authorityContinuityTerminalAt: null,
    },
  });
  if (updated.count !== 1) throw new Error('governance_authority_continuity_stale_write');
  return projectGovernanceAuthorityContinuityReadback({
    ...binding,
    authorityContinuityState: 'healthy',
    authorityContinuityVersion: version + 1,
    authorityContinuityEvidence: evidence,
    authorityContinuityEvidenceDigest: evidenceDigest,
    authorityContinuityStartedAt: null,
    authorityContinuityTerminalAt: null,
  });
}

export async function terminalizeGovernanceAuthorityContinuity(
  prisma: any,
  input: {
    bindingId: string;
    targetCircleId: number;
    actorPubkey: string;
    actorRole: string;
    now: Date;
  },
): Promise<GovernanceAuthorityContinuityReadback> {
  const binding = await prisma.circleGovernanceBinding.findUnique({ where: { id: input.bindingId } });
  if (
    !binding
    || binding.status !== 'active'
    || binding.targetCircleId !== input.targetCircleId
  ) {
    throw new Error('governance_authority_continuity_binding_unavailable');
  }
  const current = normalizeAuthorityContinuityStatus(binding.authorityContinuityState);
  if (current === 'permanently_blocked_governance_authority') {
    return projectGovernanceAuthorityContinuityReadback(binding);
  }
  if (current !== 'manual_recovery_pending') {
    throw new Error('governance_authority_continuity_manual_recovery_required');
  }
  const [eligibleActors, recoveryPolicy] = await Promise.all([
    listCommitteeEligibleActors(prisma, { committeeCircleId: binding.committeeCircleId }),
    prisma.governanceRecoveryPolicy.findFirst({
      where: {
        bindingId: binding.id,
        status: { in: ['available', 'activated', 'consumed', 'ratified'] },
      },
    }),
  ]);
  if (eligibleActors.length > 0 || recoveryPolicy) {
    throw new Error('governance_authority_continuity_lawful_path_present');
  }
  const previousEvidence = record(binding.authorityContinuityEvidence);
  const trigger = previousEvidence.trigger === GOVERNANCE_THRESHOLD_UNREACHABLE_TRIGGER
    ? GOVERNANCE_THRESHOLD_UNREACHABLE_TRIGGER
    : GOVERNANCE_RECOVERY_TRIGGER;
  const evidence = {
    kind: 'governance_authority_continuity_assessment',
    schemaVersion: 1,
    state: 'permanently_blocked_governance_authority',
    trigger,
    bindingId: binding.id,
    targetCircleId: binding.targetCircleId,
    committeeCircleId: binding.committeeCircleId,
    eligibleActorCount: Number(previousEvidence.eligibleActorCount ?? 0),
    requiredThreshold: previousEvidence.requiredThreshold ?? null,
    recoveryPolicy: 'not_configured',
    canonicalAuthority: 'none_verified',
    offPlatformReconstitution: 'not_verified',
    externalAuthorityStatus: 'not_assessed_owned_by_p06',
    fallbackAuthority: 'none',
    reportedByPubkey: input.actorPubkey,
    reportedByRole: input.actorRole,
    reporterAuthority: 'none',
    previousEvidenceDigest: binding.authorityContinuityEvidenceDigest ?? null,
    terminalEffect: 'deny_governance_transition_without_legal_reconstitution',
    terminalizedAt: input.now.toISOString(),
  };
  const evidenceDigest = hashCanonicalGovernanceValue(
    AUTHORITY_CONTINUITY_EVIDENCE_DOMAIN,
    evidence,
  );
  const version = Number(binding.authorityContinuityVersion ?? 0);
  const updated = await prisma.circleGovernanceBinding.updateMany({
    where: {
      id: binding.id,
      status: 'active',
      authorityContinuityState: 'manual_recovery_pending',
      authorityContinuityVersion: version,
    },
    data: {
      authorityContinuityState: 'permanently_blocked_governance_authority',
      authorityContinuityVersion: version + 1,
      authorityContinuityEvidence: evidence,
      authorityContinuityEvidenceDigest: evidenceDigest,
      authorityContinuityTerminalAt: input.now,
    },
  });
  if (updated.count !== 1) throw new Error('governance_authority_continuity_stale_write');
  return projectGovernanceAuthorityContinuityReadback({
    ...binding,
    authorityContinuityState: 'permanently_blocked_governance_authority',
    authorityContinuityVersion: version + 1,
    authorityContinuityEvidence: evidence,
    authorityContinuityEvidenceDigest: evidenceDigest,
    authorityContinuityTerminalAt: input.now,
  });
}

export function projectGovernanceAuthorityContinuityReadback(
  binding: any,
): GovernanceAuthorityContinuityReadback {
  if (!binding) {
    return {
      status: 'not_applicable',
      stateVersion: 0,
      trigger: null,
      canonicalAuthority: 'not_applicable',
      offPlatformReconstitution: 'not_applicable',
      externalAuthorityStatus: 'p06_provider_readback_required',
      fallbackAuthority: 'none',
      reporterAuthority: 'none',
      evidenceDigest: null,
      evidenceIntegrity: 'not_recorded',
      startedAt: null,
      terminalAt: null,
      canRetryTargetPreflight: false,
      canRecordPermanentBlock: false,
      warning: 'No active governance binding is available for continuity assessment.',
      faultControls: null,
    };
  }
  const status = normalizeAuthorityContinuityStatus(binding.authorityContinuityState);
  const evidence = record(binding.authorityContinuityEvidence);
  const recordedDigest = text(binding.authorityContinuityEvidenceDigest) || null;
  const calculatedDigest = Object.keys(evidence).length > 0
    ? hashCanonicalGovernanceValue(AUTHORITY_CONTINUITY_EVIDENCE_DOMAIN, evidence)
    : null;
  const evidenceIntegrity = recordedDigest == null && calculatedDigest == null
    ? 'not_recorded' as const
    : recordedDigest != null && recordedDigest === calculatedDigest
      ? 'verified' as const
      : 'drifted' as const;
  const effectiveStatus = evidenceIntegrity === 'drifted' ? 'drifted' : status;
  return {
    status: effectiveStatus,
    stateVersion: Number(binding.authorityContinuityVersion ?? 0),
    trigger: effectiveStatus === 'manual_recovery_pending'
      || effectiveStatus === 'permanently_blocked_governance_authority'
      ? evidence.trigger === GOVERNANCE_THRESHOLD_UNREACHABLE_TRIGGER
        ? GOVERNANCE_THRESHOLD_UNREACHABLE_TRIGGER
        : GOVERNANCE_RECOVERY_TRIGGER
      : null,
    canonicalAuthority: effectiveStatus === 'healthy'
      ? 'verified'
      : effectiveStatus === 'not_applicable'
        ? 'not_applicable'
        : 'unverified',
    offPlatformReconstitution: effectiveStatus === 'not_applicable'
      ? 'not_applicable'
      : 'not_verified',
    externalAuthorityStatus: 'p06_provider_readback_required',
    fallbackAuthority: 'none',
    reporterAuthority: 'none',
    evidenceDigest: recordedDigest,
    evidenceIntegrity,
    startedAt: binding.authorityContinuityStartedAt
      ? new Date(binding.authorityContinuityStartedAt).toISOString()
      : null,
    terminalAt: binding.authorityContinuityTerminalAt
      ? new Date(binding.authorityContinuityTerminalAt).toISOString()
      : null,
    canRetryTargetPreflight: effectiveStatus === 'manual_recovery_pending',
    canRecordPermanentBlock: effectiveStatus === 'manual_recovery_pending',
    faultControls: effectiveStatus === 'manual_recovery_pending'
      || effectiveStatus === 'permanently_blocked_governance_authority'
      ? {
          waitingPeriod: 'until_lawful_authority_restored',
          freeze: 'new_governance_except_recovery_and_history',
          successor: 'prebound_recovery_circle_or_manual_reconstitution',
          notification: 'circle_managers_and_current_members',
          providerAuthority: 'p06_provider_readback_required',
        }
      : null,
    warning: effectiveStatus === 'permanently_blocked_governance_authority'
      ? 'No lawful governance authority path was verified. This governance transition is permanently blocked; no Owner or Operator fallback exists.'
      : effectiveStatus === 'manual_recovery_pending'
        ? 'Manual recovery is pending. Only verified existing canonical governance authority or an approved constitutional/legal reconstitution may return to target preflight.'
        : effectiveStatus === 'drifted'
          ? 'Authority continuity evidence failed integrity verification. Governance transition remains fail closed.'
          : 'Canonical governance authority is healthy. No fallback authority is granted.',
  };
}

export async function resolveGovernanceRecoveryCaseAuthority(
  prisma: any,
  input: {
    recoveryPolicyId: string;
    bindingId: string;
    targetCircleId: number;
    subjectType: string;
    subjectRef: string;
    openedAt: Date;
    now: Date;
  },
): Promise<{ authorityResolution: any; eligibleActors: any[] }> {
  const recovery = await prisma.governanceRecoveryPolicy.findUnique({
    where: { id: input.recoveryPolicyId },
  });
  const binding = await prisma.circleGovernanceBinding.findUnique({
    where: { id: input.bindingId },
  });
  const policy = recovery
    ? await prisma.governancePolicy.findUnique({ where: { id: recovery.recoveryPolicyId } })
    : null;
  const policyVersion = recovery
    ? await prisma.governancePolicyVersion.findUnique({ where: { id: recovery.recoveryPolicyVersionId } })
    : null;
  const actors = Array.isArray(recovery?.actorSnapshot) ? recovery.actorSnapshot : [];
  if (
    !recovery
    || !binding
    || binding.id !== recovery.bindingId
    || binding.targetCircleId !== input.targetCircleId
    || recovery.status !== 'activated'
    || recovery.trigger !== GOVERNANCE_RECOVERY_TRIGGER
    || recovery.actionType !== CIRCLE_GOVERNANCE_BINDING_POLICY_VERSION_UPDATE_ACTION_TYPE
    || recovery.subjectType !== input.subjectType
    || recovery.subjectRef !== input.subjectRef
    || recovery.maxCostMinor !== BigInt(0)
    || !recovery.activatedAt
    || !recovery.activationExpiresAt
    || input.openedAt < new Date(recovery.activatedAt)
    || input.openedAt >= new Date(recovery.activationExpiresAt)
    || input.now >= new Date(recovery.activationExpiresAt)
    || recovery.recoveryCaseId == null
    || !policy
    || policy.status !== 'active'
    || policy.activeVersion !== recovery.recoveryPolicyVersion
    || !policyVersion
    || policyVersion.status !== 'active'
    || policyVersion.policyId !== policy.id
    || policyVersion.version !== recovery.recoveryPolicyVersion
    || computeGovernancePolicyRulesDigest(policyVersion.rules) !== policyVersion.configDigest
    || actors.length < 2
    || hashCanonicalGovernanceValue(ACTOR_SNAPSHOT_DOMAIN, actors) !== recovery.actorSnapshotDigest
  ) throw new Error('governance_recovery_policy_unavailable');
  const effectiveFrom = new Date(recovery.activatedAt);
  const effectiveUntil = new Date(recovery.activationExpiresAt);
  return {
    authorityResolution: {
      binding: {
        id: binding.id,
        targetCircleId: binding.targetCircleId,
        committeeCircleId: recovery.recoveryCircleId,
        policyId: policy.id,
        policyVersionId: policyVersion.id,
        policyVersion: policyVersion.version,
        ruleId: recovery.recoveryRuleId,
        authoritySourceType: 'governance_recovery_policy',
        authoritySourceRef: recovery.id,
        authoritySourceVersion: recovery.actorSnapshotDigest,
        authorityPurpose: 'collective_decision',
        authoritySelector: {
          actionType: recovery.actionType,
          actionPrefix: null,
          subjectType: recovery.subjectType,
          subjectRef: recovery.subjectRef,
          environment: 'local_development',
          network: 'solana:localnet',
        },
        authorityLimits: {
          recoveryPolicyId: recovery.id,
          trigger: GOVERNANCE_RECOVERY_TRIGGER,
          actorSnapshotDigest: recovery.actorSnapshotDigest,
          maxCostMinor: '0',
          assetAuthority: 'none',
          singleUse: true,
          targetCircleId: binding.targetCircleId,
          committeeCircleId: recovery.recoveryCircleId,
          minimumApprovalThreshold: actors.length,
          minimumTimelockSeconds: 0,
          riskFloor: 'critical',
          effectiveFrom: effectiveFrom.toISOString(),
          effectiveUntil: effectiveUntil.toISOString(),
        },
        authorityEffectiveFrom: effectiveFrom,
        authorityEffectiveUntil: effectiveUntil,
      },
      policy,
      policyVersion,
    },
    eligibleActors: actors.map((actor: any) => ({
      pubkey: String(actor.pubkey),
      role: actor.role == null ? null : String(actor.role),
      weight: 1,
      source: 'prebound_recovery_circle',
    })),
  };
}

export async function openGovernanceRecoveryPolicyCase(
  prisma: any,
  input: {
    circleId: number;
    bindingId: string;
    recoveryCircleId: number;
    actorPubkey: string;
    actorRole: string;
    idempotencyKey: string;
    now?: Date;
  },
): Promise<{ governanceCase: any; replayed: boolean }> {
  const now = input.now ?? new Date();
  if (
    !Number.isSafeInteger(input.circleId)
    || input.circleId <= 0
    || !Number.isSafeInteger(input.recoveryCircleId)
    || input.recoveryCircleId <= 0
    || input.recoveryCircleId === input.circleId
  ) throw new Error('governance_recovery_circle_must_be_independent');

  const run = async (tx: any) => {
    const existingPolicy = await tx.governanceRecoveryPolicy.findFirst({
      where: { bindingId: input.bindingId },
    });
    if (existingPolicy) throw new Error('governance_recovery_policy_already_configured');
    const binding = await tx.circleGovernanceBinding.findUnique({ where: { id: input.bindingId } });
    if (!binding || binding.targetCircleId !== input.circleId || binding.status !== 'active') {
      throw new Error('circle_governance_binding_not_active');
    }
    const [currentActors, recoveryActors, authorityResolution, homes] = await Promise.all([
      listCommitteeEligibleActors(tx, { committeeCircleId: binding.committeeCircleId }),
      listCommitteeEligibleActors(tx, { committeeCircleId: input.recoveryCircleId }),
      resolveActiveCircleGovernanceBinding(tx, {
        targetCircleId: input.circleId,
        actionType: CIRCLE_GOVERNANCE_BINDING_POLICY_VERSION_UPDATE_ACTION_TYPE,
        purpose: 'collective_decision',
        authorityBindingId: input.bindingId,
        subjectType: 'circle_governance_binding',
        subjectRef: input.bindingId,
        now,
      }),
      tx.governanceHomeIdentityBinding.findMany({
        where: { homeType: 'circle', homeRef: String(input.circleId), supersededAt: null },
        include: { activationState: true },
        orderBy: { identityVersion: 'desc' },
        take: 2,
      }),
    ]);
    if (currentActors.length === 0 || !hasGovernanceCommitteeOperator(currentActors)) {
      throw new Error('governance_recovery_policy_requires_healthy_governance');
    }
    if (recoveryActors.length < 2) throw new Error('governance_recovery_policy_minimum_two_actors');
    if (!authorityResolution || authorityResolution.binding.id !== input.bindingId) {
      throw new Error('governance_recovery_policy_current_authority_required');
    }
    if (
      homes.length !== 1
      || homes[0].status !== 'active'
      || homes[0].activationState?.state !== 'active'
    ) throw new Error('governance_recovery_policy_active_home_required');
    await resumeGovernanceAuthorityContinuityWithVerifiedExistingAuthority(tx, {
      bindingId: binding.id,
      actorPubkey: input.actorPubkey,
      eligibleActorCount: currentActors.length,
      operatorVerified: true,
      now,
    });

    const actorSnapshot = recoveryActors
      .map((actor: any) => ({
        pubkey: String(actor.pubkey),
        role: actor.role == null ? null : String(actor.role),
        weight: 1,
        source: 'prebound_recovery_circle',
      }))
      .sort((left: any, right: any) => left.pubkey.localeCompare(right.pubkey));
    const actorSnapshotDigest = hashCanonicalGovernanceValue(ACTOR_SNAPSHOT_DOMAIN, actorSnapshot);
    const policyId = `governance-recovery:${hashCanonicalGovernanceValue(POLICY_ID_DOMAIN, {
      homeIdentityBindingId: homes[0].id,
      bindingId: input.bindingId,
    }).slice(0, 56)}`;
    const policyVersionId = `${policyId}:v1`;
    const ruleId = `committee:${CIRCLE_GOVERNANCE_BINDING_POLICY_VERSION_UPDATE_ACTION_TYPE}`;
    const rules = buildCommitteePolicyRules(
      CIRCLE_GOVERNANCE_BINDING_POLICY_VERSION_UPDATE_ACTION_TYPE,
      {
        source: 'active_committee_members',
        weight: { mode: 'equal_one' },
        threshold: { mode: 'unanimity', value: null },
        ballotDisclosure: { mode: 'eligible_only' },
        quadraticVoiceCredits: { budgetPerActor: null },
      },
    );
    const policyDigest = computeGovernancePolicyRulesDigest(rules);
    await tx.governancePolicy.upsert({
      where: { id: policyId },
      create: {
        id: policyId,
        scopeType: 'governance_recovery_circle',
        scopeRef: String(input.recoveryCircleId),
        status: 'draft',
        activeVersion: null,
        createdByPubkey: input.actorPubkey,
        metadata: { owner: 'GovernanceRecoveryPolicy', currentContract: true },
      },
      update: {},
    });
    await tx.governancePolicyVersion.upsert({
      where: { id: policyVersionId },
      create: {
        id: policyVersionId,
        policyId,
        version: 1,
        status: 'draft',
        rules,
        configDigest: policyDigest,
        createdByPubkey: input.actorPubkey,
      },
      update: {},
    });
    const proposal = {
      kind: GOVERNANCE_RECOVERY_POLICY_KIND,
      currentContract: 'governance_recovery_policy',
      homeIdentityBindingId: homes[0].id,
      bindingId: input.bindingId,
      recoveryCircleId: input.recoveryCircleId,
      recoveryPolicyId: policyId,
      recoveryPolicyVersionId: policyVersionId,
      recoveryPolicyVersion: 1,
      recoveryRuleId: ruleId,
      recoveryPolicyDigest: policyDigest,
      trigger: GOVERNANCE_RECOVERY_TRIGGER,
      actionType: CIRCLE_GOVERNANCE_BINDING_POLICY_VERSION_UPDATE_ACTION_TYPE,
      subjectType: 'circle_governance_binding',
      subjectRef: input.bindingId,
      actorSnapshot,
      actorSnapshotDigest,
      minimumActors: 2,
      threshold: 'unanimity',
      maxCostMinor: '0',
      assetAuthority: 'none',
      activationTtlSeconds: GOVERNANCE_RECOVERY_ACTIVATION_TTL_SECONDS,
      ratificationTtlSeconds: GOVERNANCE_RECOVERY_RATIFICATION_TTL_SECONDS,
      temporaryCapability: 'single_use',
      fallbackAuthority: 'none',
      offPlatformReconstitution: 'disabled',
    };
    return createGovernanceCaseIntake(tx, {
      circleId: input.circleId,
      title: 'Review independent Recovery Circle binding',
      requestedDecision: 'Should this Home pre-bind the frozen independent Recovery Circle for one zero-electorate configuration recovery?',
      requestedActionPayload: { governanceRecoveryPolicyProposal: proposal },
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
      openedAt: now,
    });
  };
  return typeof prisma.$transaction === 'function'
    ? prisma.$transaction((tx: any) => run(tx))
    : run(prisma);
}

export async function activateGovernanceRecoveryPolicy(
  prisma: any,
  input: {
    requestId: string;
    bindingId: string;
    proposal: unknown;
    decisionDigest: string;
    now: Date;
  },
): Promise<string> {
  const proposal = record(input.proposal);
  const actors = Array.isArray(proposal.actorSnapshot) ? proposal.actorSnapshot : [];
  const actorSnapshotDigest = hashCanonicalGovernanceValue(ACTOR_SNAPSHOT_DOMAIN, actors);
  if (
    proposal.kind !== GOVERNANCE_RECOVERY_POLICY_KIND
    || proposal.currentContract !== 'governance_recovery_policy'
    || proposal.bindingId !== input.bindingId
    || proposal.subjectType !== 'circle_governance_binding'
    || proposal.subjectRef !== input.bindingId
    || proposal.trigger !== GOVERNANCE_RECOVERY_TRIGGER
    || proposal.actionType !== CIRCLE_GOVERNANCE_BINDING_POLICY_VERSION_UPDATE_ACTION_TYPE
    || proposal.threshold !== 'unanimity'
    || proposal.minimumActors !== 2
    || actors.length < 2
    || proposal.actorSnapshotDigest !== actorSnapshotDigest
    || proposal.maxCostMinor !== '0'
    || proposal.assetAuthority !== 'none'
    || proposal.activationTtlSeconds !== GOVERNANCE_RECOVERY_ACTIVATION_TTL_SECONDS
    || proposal.ratificationTtlSeconds !== GOVERNANCE_RECOVERY_RATIFICATION_TTL_SECONDS
    || proposal.temporaryCapability !== 'single_use'
    || proposal.fallbackAuthority !== 'none'
    || proposal.offPlatformReconstitution !== 'disabled'
  ) throw new Error('governance_recovery_policy_proposal_invalid');
  const policyId = text(proposal.recoveryPolicyId);
  const policyVersionId = text(proposal.recoveryPolicyVersionId);
  const homeIdentityBindingId = text(proposal.homeIdentityBindingId);
  const recoveryCircleId = Number(proposal.recoveryCircleId);
  const policyVersion = await prisma.governancePolicyVersion.findUnique({
    where: { id: policyVersionId },
  });
  if (
    !policyId
    || !policyVersionId
    || !homeIdentityBindingId
    || !Number.isSafeInteger(recoveryCircleId)
    || recoveryCircleId <= 0
    || !policyVersion
    || policyVersion.policyId !== policyId
    || policyVersion.version !== 1
    || policyVersion.status !== 'draft'
    || policyVersion.configDigest !== proposal.recoveryPolicyDigest
    || computeGovernancePolicyRulesDigest(policyVersion.rules) !== policyVersion.configDigest
  ) throw new Error('governance_recovery_policy_draft_drift');
  const recoveryPolicyId = `recovery-policy:${hashCanonicalGovernanceValue(POLICY_ID_DOMAIN, {
    homeIdentityBindingId,
    bindingId: input.bindingId,
  }).slice(0, 56)}`;
  const existing = await prisma.governanceRecoveryPolicy.findUnique({ where: { id: recoveryPolicyId } });
  if (existing) {
    if (
      existing.sourceRequestId !== input.requestId
      || existing.sourceDecisionDigest !== input.decisionDigest
    ) throw new Error('governance_recovery_policy_activation_conflict');
    return existing.id;
  }
  const policyUpdated = await prisma.governancePolicy.updateMany({
    where: { id: policyId, status: 'draft', activeVersion: null },
    data: { status: 'active', activeVersion: 1 },
  });
  const versionUpdated = await prisma.governancePolicyVersion.updateMany({
    where: { id: policyVersionId, policyId, status: 'draft', version: 1 },
    data: { status: 'active', activatedAt: input.now },
  });
  if (policyUpdated.count !== 1 || versionUpdated.count !== 1) {
    throw new Error('governance_recovery_policy_activation_stale_write');
  }
  await prisma.governanceRecoveryPolicy.create({ data: {
    id: recoveryPolicyId,
    homeIdentityBindingId,
    bindingId: input.bindingId,
    recoveryCircleId,
    recoveryPolicyId: policyId,
    recoveryPolicyVersionId: policyVersionId,
    recoveryPolicyVersion: 1,
    recoveryRuleId: text(proposal.recoveryRuleId),
    trigger: GOVERNANCE_RECOVERY_TRIGGER,
    actionType: CIRCLE_GOVERNANCE_BINDING_POLICY_VERSION_UPDATE_ACTION_TYPE,
    subjectType: 'circle_governance_binding',
    subjectRef: input.bindingId,
    actorSnapshot: actors,
    actorSnapshotDigest,
    maxCostMinor: BigInt(0),
    activationTtlSeconds: GOVERNANCE_RECOVERY_ACTIVATION_TTL_SECONDS,
    ratificationTtlSeconds: GOVERNANCE_RECOVERY_RATIFICATION_TTL_SECONDS,
    status: 'available',
    stateVersion: 0,
    sourceRequestId: input.requestId,
    sourceDecisionDigest: input.decisionDigest,
    ratificationStatus: 'not_required',
  } });
  return recoveryPolicyId;
}

export async function openGovernanceRecoveryRatificationCase(
  prisma: any,
  input: { recoveryPolicyId: string; recoveryCaseId: string; now: Date },
): Promise<any> {
  const recovery = await prisma.governanceRecoveryPolicy.findUnique({
    where: { id: input.recoveryPolicyId },
  });
  if (
    !recovery
    || recovery.status !== 'consumed'
    || recovery.recoveryCaseId !== input.recoveryCaseId
    || recovery.ratificationStatus !== 'pending'
    || !recovery.ratificationDeadline
    || input.now >= new Date(recovery.ratificationDeadline)
  ) throw new Error('governance_recovery_ratification_unavailable');
  if (recovery.ratificationCaseId) {
    const existing = await prisma.governanceCase.findUnique({
      where: { id: recovery.ratificationCaseId },
    });
    if (!existing) throw new Error('governance_recovery_ratification_case_drift');
    return existing;
  }
  const binding = await prisma.circleGovernanceBinding.findUnique({
    where: { id: recovery.targetBindingId },
  });
  if (
    !binding
    || binding.status !== 'active'
    || binding.id !== recovery.targetBindingId
    || binding.committeeCircleId !== recovery.targetCommitteeCircleId
    || binding.mandateId !== recovery.targetMandateId
    || binding.committeeMandateStatus !== 'pending'
  ) {
    throw new Error('governance_recovery_ratification_binding_unavailable');
  }
  const [authorityResolution, actors] = await Promise.all([
    resolveActiveCircleGovernanceBinding(prisma, {
      targetCircleId: binding.targetCircleId,
      actionType: CIRCLE_GOVERNANCE_BINDING_POLICY_VERSION_UPDATE_ACTION_TYPE,
      purpose: 'collective_decision',
      authorityBindingId: binding.id,
      subjectType: 'circle_governance_binding',
      subjectRef: binding.id,
      now: input.now,
    }),
    listCommitteeEligibleActors(prisma, { committeeCircleId: binding.committeeCircleId }),
  ]);
  const operator = actors.find((actor: any) => ['owner', 'admin', 'moderator']
    .includes(String(actor.role ?? '').toLowerCase()));
  if (!authorityResolution || !operator || actors.length === 0) {
    throw new Error('governance_recovery_ratification_electorate_unavailable');
  }
  const proposal = {
    kind: GOVERNANCE_RECOVERY_RATIFICATION_KIND,
    currentContract: 'governance_recovery_policy',
    recoveryPolicyId: recovery.id,
    recoveryCaseId: input.recoveryCaseId,
    bindingId: binding.id,
    sourceBindingId: recovery.bindingId,
    targetCircleId: binding.targetCircleId,
    ratificationDeadline: new Date(recovery.ratificationDeadline).toISOString(),
    reviewRequired: true,
    onRejectOrTimeout: 'high_critical_fail_closed',
    rollback: 'new_governed_transition_only',
  };
  const result = await createGovernanceCaseIntake(prisma, {
    circleId: binding.targetCircleId,
    title: 'Ratify governance recovery transition',
    requestedDecision: 'Should the recovered target electorate ratify the completed one-shot governance recovery transition?',
    requestedActionPayload: { governanceRecoveryRatification: proposal },
    caseType: 'policy',
    templateId: 'basic-community',
    actionType: CIRCLE_GOVERNANCE_BINDING_POLICY_VERSION_UPDATE_ACTION_TYPE,
    subjectType: 'circle_governance_binding',
    subjectRef: binding.id,
    authorityBindingId: binding.id,
    authorityResolution,
    decisionMechanismKind: 'equal_weight_threshold',
    originKind: 'manual_item',
    sourceMessageIds: [],
    idempotencyKey: `governance-recovery-ratification:${recovery.id}`,
    openedByPubkey: operator.pubkey,
    actorRole: normalizeProposerRole(operator.role),
    relationshipKind: 'related',
    relatedCaseId: input.recoveryCaseId,
    relationshipReason: null,
    openedAt: input.now,
  });
  const attached = await prisma.governanceRecoveryPolicy.updateMany({
    where: {
      id: recovery.id,
      status: 'consumed',
      ratificationStatus: 'pending',
      ratificationCaseId: null,
      stateVersion: recovery.stateVersion,
    },
    data: {
      ratificationCaseId: result.governanceCase.id,
      stateVersion: recovery.stateVersion + 1,
    },
  });
  if (attached.count !== 1) throw new Error('governance_recovery_ratification_case_conflict');
  return result.governanceCase;
}

export async function resolveGovernanceRecoveryRatification(
  prisma: any,
  input: {
    requestId: string;
    proposal: unknown;
    decision: 'accepted' | 'rejected' | 'expired' | 'cancelled';
    decisionDigest: string;
    now: Date;
  },
): Promise<string> {
  const proposal = record(input.proposal);
  const recoveryPolicyId = text(proposal.recoveryPolicyId);
  const recovery = recoveryPolicyId
    ? await prisma.governanceRecoveryPolicy.findUnique({ where: { id: recoveryPolicyId } })
    : null;
  const binding = recovery?.targetBindingId
    ? await prisma.circleGovernanceBinding.findUnique({
        where: { id: recovery.targetBindingId },
        include: { mandate: { include: { versions: true } } },
      })
    : null;
  const mandate = binding?.mandate;
  const mandateVersion = Array.isArray(mandate?.versions)
    ? mandate.versions.find((version: any) => version.version === recovery?.targetMandateVersion)
    : null;
  if (
    proposal.kind !== GOVERNANCE_RECOVERY_RATIFICATION_KIND
    || proposal.currentContract !== 'governance_recovery_policy'
    || !recovery
    || recovery.status !== 'consumed'
    || recovery.ratificationStatus !== 'pending'
    || recovery.ratificationCaseId !== proposal.caseId
    || recovery.recoveryCaseId !== proposal.recoveryCaseId
    || recovery.targetBindingId !== proposal.bindingId
    || recovery.bindingId !== proposal.sourceBindingId
    || !binding
    || binding.mandateId !== recovery.targetMandateId
    || binding.committeeCircleId !== recovery.targetCommitteeCircleId
    || binding.committeeMandateStatus !== 'pending'
    || !mandate
    || mandate.id !== recovery.targetMandateId
    || mandate.currentVersion !== recovery.targetMandateVersion
    || mandate.currentTermsDigest !== recovery.targetMandateTermsDigest
    || mandate.committeeAcceptanceStatus !== 'pending'
    || !mandateVersion
    || mandateVersion.termsDigest !== recovery.targetMandateTermsDigest
    || mandateVersion.committeeAcceptedTermsDigest !== null
    || !recovery.ratificationDeadline
    || new Date(recovery.ratificationDeadline).toISOString() !== proposal.ratificationDeadline
    || proposal.onRejectOrTimeout !== 'high_critical_fail_closed'
    || proposal.rollback !== 'new_governed_transition_only'
  ) throw new Error('governance_recovery_ratification_invalid');
  const accepted = input.decision === 'accepted' && input.now <= new Date(recovery.ratificationDeadline);
  const terminalStatus = accepted
    ? 'accepted'
    : input.decision === 'expired' || input.now > new Date(recovery.ratificationDeadline)
      ? 'expired'
      : 'rejected';
  if (accepted) {
    const versionUpdated = await prisma.governanceMandateVersion.updateMany({
      where: {
        id: mandateVersion.id,
        mandateId: mandate.id,
        version: mandate.currentVersion,
        termsDigest: mandate.currentTermsDigest,
        committeeAcceptedTermsDigest: null,
      },
      data: {
        committeeAcceptedAt: input.now,
        committeeAcceptedTermsDigest: mandate.currentTermsDigest,
        sourceRequestId: input.requestId,
        sourceDecisionDigest: input.decisionDigest,
      },
    });
    const mandateUpdated = await prisma.governanceMandate.updateMany({
      where: {
        id: mandate.id,
        status: 'active',
        currentVersion: mandate.currentVersion,
        currentTermsDigest: mandate.currentTermsDigest,
        committeeAcceptanceStatus: 'pending',
      },
      data: { committeeAcceptanceStatus: 'accepted' },
    });
    const bindingUpdated = await prisma.circleGovernanceBinding.updateMany({
      where: {
        id: binding.id,
        mandateId: mandate.id,
        status: 'active',
        committeeMandateStatus: 'pending',
      },
      data: { committeeMandateStatus: 'accepted' },
    });
    if (
      versionUpdated.count !== 1
      || mandateUpdated.count !== 1
      || bindingUpdated.count !== 1
    ) throw new Error('governance_recovery_ratification_authority_stale_write');
  }
  const updated = await prisma.governanceRecoveryPolicy.updateMany({
    where: {
      id: recovery.id,
      status: 'consumed',
      ratificationStatus: 'pending',
      stateVersion: recovery.stateVersion,
    },
    data: {
      status: accepted ? 'ratified' : 'ratification_failed',
      ratificationStatus: terminalStatus,
      terminalReason: accepted ? 'target_electorate_ratified' : 'ratification_rejected_or_timed_out',
      stateVersion: recovery.stateVersion + 1,
    },
  });
  if (updated.count !== 1) throw new Error('governance_recovery_ratification_stale_write');
  return recovery.id;
}

function normalizeReadbackStatus(status: unknown, ratificationStatus: unknown): GovernanceRecoveryReadback['status'] {
  if (ratificationStatus === 'pending') return 'ratification_pending';
  if (ratificationStatus === 'accepted') return 'ratified';
  if (ratificationStatus === 'rejected' || ratificationStatus === 'expired') return 'ratification_failed';
  if (status === 'activated') return 'activation_pending';
  if (status === 'consumed') return 'consumed';
  return 'available';
}

function normalizeResourceAuthorityBinding(resource: any): null | {
  id: string;
  provider: string;
  capability: string;
  status: string;
  resourceRef: string | null;
  ownerProgramRef: string;
  verifiedSlot: number | null;
  stateDigest: string | null;
  providerReadback: 'verified' | 'missing';
  sourceRequestId: string | null;
  sourceDecisionDigest: string | null;
  authorityBindings: Array<{
    id: string;
    role: string;
    status: string;
    currentAuthority: string | null;
    custodyStatus: string;
    verifiedSlot: number | null;
    stateDigest: string | null;
  }>;
} {
  const id = text(resource?.id);
  const provider = text(resource?.provider);
  const capability = text(resource?.capability);
  const status = text(resource?.status) || 'unknown';
  const ownerProgramRef = text(resource?.ownerProgramRef);
  if (!id || !provider || !capability || !ownerProgramRef) return null;
  return {
    id,
    provider,
    capability,
    status,
    resourceRef: text(resource?.resourceRef) || null,
    ownerProgramRef,
    verifiedSlot: positiveIntegerOrNull(resource?.verifiedSlot),
    stateDigest: digestOrNull(resource?.stateDigest),
    providerReadback: hasAuthoritativeProviderReadback(resource) ? 'verified' : 'missing',
    sourceRequestId: text(resource?.sourceRequestId) || null,
    sourceDecisionDigest: digestOrNull(resource?.sourceDecisionDigest),
    authorityBindings: (Array.isArray(resource?.authorityBindings) ? resource.authorityBindings : [])
      .map((binding: any) => normalizeResourceAuthorityBindingRow(binding))
      .filter((binding: ReturnType<typeof normalizeResourceAuthorityBindingRow>): binding is NonNullable<ReturnType<typeof normalizeResourceAuthorityBindingRow>> => binding !== null),
  };
}

function normalizeResourceAuthorityBindingRow(binding: any): null | {
  id: string;
  role: string;
  status: string;
  currentAuthority: string | null;
  custodyStatus: string;
  verifiedSlot: number | null;
  stateDigest: string | null;
} {
  const id = text(binding?.id);
  const role = text(binding?.authorityRole);
  if (!id || !role) return null;
  return {
    id,
    role,
    status: text(binding?.status) || 'unknown',
    currentAuthority: text(binding?.currentAuthority) || null,
    custodyStatus: text(binding?.custodyStatus) || 'unknown',
    verifiedSlot: positiveIntegerOrNull(binding?.verifiedSlot),
    stateDigest: digestOrNull(binding?.stateDigest),
  };
}

function hasAuthoritativeProviderReadback(resource: any): boolean {
  if (positiveIntegerOrNull(resource?.verifiedSlot) !== null && digestOrNull(resource?.stateDigest) !== null) {
    return true;
  }
  const verification = record(resource?.verification);
  const authoritativeReadback = record(verification.authoritativeReadback);
  const providerReceipt = record(verification.providerReceipt);
  const accountGraph = record(verification.accountGraph);
  return authoritativeReadback.providerFinality === 'finalized'
    || authoritativeReadback.status === 'verified_finalized'
    || providerReceipt.providerFinality === 'finalized'
    || providerReceipt.status === 'verified_finalized'
    || accountGraph.providerFinality === 'finalized'
    || accountGraph.status === 'verified_finalized';
}

function positiveIntegerOrNull(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isSafeInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function digestOrNull(value: unknown): string | null {
  const digest = text(value).toLowerCase();
  return /^[a-f0-9]{64}$/.test(digest) ? digest : null;
}

function normalizeAuthorityContinuityStatus(value: unknown): GovernanceAuthorityContinuityStatus {
  if (value == null || value === '' || value === 'healthy') return 'healthy';
  if (value === 'manual_recovery_pending') return 'manual_recovery_pending';
  if (value === 'permanently_blocked_governance_authority') {
    return 'permanently_blocked_governance_authority';
  }
  return 'drifted';
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeProposerRole(value: unknown): 'Owner' | 'Admin' | 'Moderator' {
  const role = String(value ?? '').toLowerCase();
  if (role === 'owner') return 'Owner';
  if (role === 'admin') return 'Admin';
  return 'Moderator';
}
