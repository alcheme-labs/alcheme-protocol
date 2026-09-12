import { canonicalSolanaPublicKeyString } from '../identity/solanaPublicKey';
import type { GovernedActionImpact } from './actionRegistry';
import { hashCanonicalGovernanceValue } from './canonicalCodec';
import { ensureGovernedActionRuntimeSeeds } from './governedActionGatewayRuntime';
import { createPrismaGovernedActionInvocationStore } from './invocationStore';
import { transitionOperationEffectInTransaction } from './operationEffectLifecycle';

export const GOVERNED_ACTION_APPEAL_ACTION_TYPE = 'governed_action.appeal.open';
const APPEAL_CONFLICT_RULE = 'original_executor_and_appellant_excluded';

export type GovernedActionAppealChannel =
  | 'circle_policy'
  | 'operator_misconduct';

export interface GovernedActionAppealRoutingReadback {
  contract: 'governed-action-appeal-routing-current';
  source: 'canonical_receipt_action_type';
  selectedChannel: GovernedActionAppealChannel | null;
  channels: {
    circlePolicy: {
      status: 'configured' | 'not_applicable';
      authorityClass: 'circle_policy_independent_reviewer';
      visibility: 'circle_actor_appellant_and_authorized_independent_reviewer';
      deadline: string | null;
      submission: { method: 'POST'; path: string } | null;
    };
    operatorMisconduct: {
      status: 'configured' | 'not_applicable';
      authorityClass: 'independent_circle_governance_or_unavailable';
      visibility: 'affected_subject_and_independent_circle_reviewer';
      deadline: string | null;
      submission: { method: 'POST'; path: string } | null;
    };
    platformSafetyLegal: {
      status: 'unavailable_no_bound_authority';
      authorityClass: 'not_bound';
      visibility: 'unavailable';
      deadline: null;
      submission: null;
    };
  };
}

export function projectGovernedActionAppealRouting(input: {
  actionType: string;
  circleId: number;
  receiptId: string;
  deadline: string | null;
}): GovernedActionAppealRoutingReadback {
  const circlePolicy = input.actionType.startsWith('circle.policy.');
  const operatorMisconduct = input.actionType === 'communication.member.mute'
    || input.actionType === 'communication.message.hide'
    || input.actionType === 'content.visibility.downrank';
  return {
    contract: 'governed-action-appeal-routing-current',
    source: 'canonical_receipt_action_type',
    selectedChannel: circlePolicy
      ? 'circle_policy'
      : operatorMisconduct ? 'operator_misconduct' : null,
    channels: {
      circlePolicy: {
        status: circlePolicy ? 'configured' : 'not_applicable',
        authorityClass: 'circle_policy_independent_reviewer',
        visibility: 'circle_actor_appellant_and_authorized_independent_reviewer',
        deadline: circlePolicy ? input.deadline : null,
        submission: circlePolicy ? {
          method: 'POST',
          path: `/api/v1/circles/${input.circleId}/operation-receipts/${encodeURIComponent(input.receiptId)}/appeals`,
        } : null,
      },
      operatorMisconduct: {
        status: operatorMisconduct ? 'configured' : 'not_applicable',
        authorityClass: 'independent_circle_governance_or_unavailable',
        visibility: 'affected_subject_and_independent_circle_reviewer',
        deadline: operatorMisconduct ? input.deadline : null,
        submission: operatorMisconduct ? {
          method: 'POST',
          path: input.actionType === 'content.visibility.downrank'
            ? `/api/v1/circles/${input.circleId}/posts/{contentId}/downrank-appeals`
            : `/api/v1/communication/circles/${input.circleId}/moderation-state/appeals`,
        } : null,
      },
      platformSafetyLegal: {
        status: 'unavailable_no_bound_authority',
        authorityClass: 'not_bound',
        visibility: 'unavailable',
        deadline: null,
        submission: null,
      },
    },
  };
}

function appealDefinition(windowSeconds: number) {
  return {
    actionType: GOVERNED_ACTION_APPEAL_ACTION_TYPE,
    targetType: 'operation_receipt',
    impact: 'medium' as const,
    fallbackAuthority: 'none' as const,
    governanceMode: 'required_when_bound' as const,
    executionAdapter: 'governed_action_appeal',
    executionDomain: 'off_chain' as const,
    receiptRequired: true,
    idempotencyScope: 'governance_home_action_subject' as const,
    idempotencyWindowSeconds: windowSeconds,
    appealPolicy: null,
  };
}

export type GovernedActionAppealResolutionPath =
  | 'independent_review'
  | 'governance_case_appeal_resolution';

export type GovernedActionAppealResolutionOutcome =
  | 'uphold'
  | 'modify_reduce'
  | 'revoke'
  | 'expire';

export const GOVERNED_ACTION_APPEAL_NO_AGGRAVATION_BOUNDARY = Object.freeze({
  contract: 'governed-action-appeal-no-aggravation-current',
  sameAppealEffect: 'preserve_or_reduce_only',
  sameAppealOutcomes: Object.freeze(['uphold', 'modify_reduce', 'revoke', 'expire'] as const),
  reReview: 'requires_explicit_review_without_expanding_original_effect',
  aggravation: Object.freeze({
    disposition: 'forbidden_in_current_appeal',
    nextAction: 'separate_new_action_required',
    notice: 'fresh_notice_required',
    defenseWindow: 'fresh_defense_window_required',
    authority: 'corresponding_high_risk_authority_chain_required',
    currentAutomaticProducer: 'none',
  }),
} as const);

export function resolveGovernedActionAppealPath(
  riskFloor: GovernedActionImpact,
  collectiveCommitmentRequired: boolean,
): GovernedActionAppealResolutionPath {
  return collectiveCommitmentRequired || riskFloor === 'high' || riskFloor === 'critical'
    ? 'governance_case_appeal_resolution'
    : 'independent_review';
}

export function validateGovernedActionAppealResolution(input: {
  resolutionPath: GovernedActionAppealResolutionPath;
  originalActorPubkey: string;
  appellantPubkey: string;
  reviewerPubkey: string;
  outcome: GovernedActionAppealResolutionOutcome;
}): GovernedActionAppealResolutionOutcome {
  if (input.resolutionPath !== 'independent_review') {
    throw new Error('governed_action_appeal_case_resolution_required');
  }
  if (input.reviewerPubkey === input.originalActorPubkey) {
    throw new Error('governed_action_appeal_original_executor_conflict');
  }
  if (input.reviewerPubkey === input.appellantPubkey) {
    throw new Error('governed_action_appeal_appellant_reviewer_conflict');
  }
  if (!['uphold', 'modify_reduce', 'revoke', 'expire'].includes(input.outcome)) {
    throw new Error('governed_action_appeal_resolution_aggravation_forbidden');
  }
  return input.outcome;
}

export function appealEffectStateForResolution(
  outcome: GovernedActionAppealResolutionOutcome,
): 'superseded' | 'revoked' | 'expired' | null {
  if (outcome === 'modify_reduce') return 'superseded';
  if (outcome === 'revoke') return 'revoked';
  if (outcome === 'expire') return 'expired';
  return null;
}

export interface GovernedActionAppealRecord {
  id: string;
  appealInvocationId: string;
  originalInvocationId: string;
  originalReceiptId: string;
  appellantPubkey: string;
  appealWindowEndsAt: string;
  resolutionPath: GovernedActionAppealResolutionPath;
  state: string;
  governanceCaseRef: string | null;
  appealResolutionArtifactRef: string | null;
}

export async function openGovernedActionAppeal(
  prisma: any,
  input: {
    originalReceiptId: string;
    appellantPubkey: string;
    reasonCode: string;
    evidence: Record<string, unknown>;
    now?: Date;
  },
): Promise<{ appeal: GovernedActionAppealRecord; replayed: boolean }> {
  const now = input.now ?? new Date();
  const appellantPubkey = canonicalSolanaPublicKeyString(input.appellantPubkey);
  if (!appellantPubkey || appellantPubkey !== input.appellantPubkey) {
    throw new Error('governed_action_appeal_appellant_invalid');
  }
  const reasonCode = input.reasonCode.trim();
  if (!/^[a-z][a-z0-9._-]{2,95}$/.test(reasonCode)) {
    throw new Error('governed_action_appeal_reason_invalid');
  }
  const evidence = normalizeEvidence(input.evidence);
  const evidenceDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.action-appeal-evidence', evidence,
  );
  const reasonDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.action-reason', { reasonCode },
  );
  return runAppealTransaction(prisma, async (tx: any) => {
    const originalReceipt = await tx.operationReceipt.findUnique({
      where: { id: input.originalReceiptId },
      include: {
        invocation: {
          include: { contractVersion: true, authoritySnapshot: true },
        },
        initialEffect: true,
      },
    });
    if (!originalReceipt
      || originalReceipt.executionStatus !== 'succeeded'
      || originalReceipt.appealRef !== `governed-action-appeal:${originalReceipt.id}`
      || !originalReceipt.appealWindowEndsAt
      || !originalReceipt.invocation?.authoritySnapshot
      || !originalReceipt.initialEffect) {
      throw new Error('governed_action_appeal_original_receipt_ineligible');
    }
    const deadline = new Date(originalReceipt.appealWindowEndsAt);
    const completedAt = new Date(originalReceipt.completedAt);
    const originalDefinition = record(originalReceipt.invocation.contractVersion?.definition);
    const appealPolicy = record(originalDefinition.appealPolicy);
    const appealWindowSeconds = Number(appealPolicy.windowSeconds);
    if (!Number.isSafeInteger(appealWindowSeconds)
      || appealWindowSeconds <= 0
      || appealPolicy.conflictRule !== APPEAL_CONFLICT_RULE
      || appealPolicy.resolutionPath !== 'independent_review_or_case') {
      throw new Error('governed_action_appeal_policy_unavailable');
    }
    if (!Number.isFinite(deadline.getTime())
      || !Number.isFinite(completedAt.getTime())
      || deadline.getTime() - completedAt.getTime() !== appealWindowSeconds * 1_000) {
      throw new Error('governed_action_appeal_deadline_mismatch');
    }
    if (now.getTime() < completedAt.getTime() || now.getTime() > deadline.getTime()) {
      throw new Error('governed_action_appeal_window_expired');
    }
    const riskFloor = originalReceipt.invocation.contractVersion.riskFloor as GovernedActionImpact;
    if (!['low', 'medium', 'high', 'critical'].includes(riskFloor)) {
      throw new Error('governed_action_appeal_risk_invalid');
    }
    assertAppealAppellantScope(originalReceipt, appellantPubkey);
    const platformSafetyIndependentReview =
      await resolvePlatformSafetyIndependentReviewAuthority(
        tx,
        originalReceipt,
        appellantPubkey,
      );
    const resolutionPath = platformSafetyIndependentReview
      ? 'independent_review'
      : resolveGovernedActionAppealPath(
          riskFloor,
          originalReceipt.invocation.collectiveCommitmentRequired === true,
        );
    const identityFacts = {
      originalReceiptId: originalReceipt.id,
      originalInvocationId: originalReceipt.invocationId,
      appellantPubkey,
      appealWindowEndsAt: deadline.toISOString(),
    };
    const identityDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.action-appeal-identity', identityFacts,
    );
    const appealId = `governed-action-appeal:${identityDigest.slice(0, 56)}`;
    const existing = await tx.governedActionAppeal.findUnique({
      where: { id: appealId },
      include: { appealInvocation: true },
    });
    if (existing) {
      const existingRequest = record(existing.appealInvocation?.requestedEffect);
      if (existing.evidenceDigest !== evidenceDigest
        || existing.appealInvocation?.reasonDigest !== reasonDigest
        || existingRequest.reasonCode !== reasonCode) {
        throw new Error('governed_action_appeal_immutable_mismatch');
      }
      return { appeal: publicAppeal(existing), replayed: true };
    }

    const payload = {
      kind: 'governed_action_appeal',
      ...identityFacts,
      reasonCode,
      evidenceDigest,
      conflictRule: APPEAL_CONFLICT_RULE,
      resolutionPath,
      independentReviewAuthority: platformSafetyIndependentReview,
    };
    const payloadDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.action-payload', payload,
    );
    const recurrenceKey = `governed-recurrence:${hashCanonicalGovernanceValue(
      'alcheme.governance.action-appeal-recurrence', identityFacts,
    )}`;
    const invocationId = `governed-invocation:${hashCanonicalGovernanceValue(
      'alcheme.governance.action-appeal-invocation', identityFacts,
    ).slice(0, 56)}`;
    const seeded = await ensureGovernedActionRuntimeSeeds(
      { prisma: tx, transactionClient: true },
      {
        definition: appealDefinition(appealWindowSeconds),
        home: {
          homeType: originalReceipt.invocation.governanceHomeType,
          homeRef: originalReceipt.invocation.governanceHomeRef,
        },
        binding: {
          id: `appeal-policy:${originalReceipt.id}`,
          policyId: 'governed-action-appeal-policy',
          policyVersionId: 'governed-action-appeal-policy:v1',
          policyVersion: 1,
          ruleId: 'independent-review-or-case',
          committeeCircleId: 0,
          authoritySourceType: 'governed_action_appeal_policy',
          authoritySourceRef: originalReceipt.id,
          authoritySourceVersion: 'governed-action-appeal-policy:v1',
          authorityPurpose: 'appeal',
          authoritySelector: {
            subjectType: 'operation_receipt',
            subjectRef: originalReceipt.id,
            excludedActorPubkeys: [originalReceipt.actorPubkey, appellantPubkey],
            independentReviewAuthority: platformSafetyIndependentReview,
            environment: 'local_development',
            network: 'solana:localnet',
          },
          authorityLimits: {
            conflictRule: APPEAL_CONFLICT_RULE,
            resolutionPath,
            appealWindowEndsAt: deadline.toISOString(),
            independentReviewAuthority: platformSafetyIndependentReview,
          },
        },
        now,
      },
    );
    const preflightDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.action-appeal-preflight', {
        originalReceiptDigest: originalReceipt.receiptDigest,
        originalEffectDigest: originalReceipt.initialEffect.effectDigest,
        appealContractVersionId: seeded.contractVersionId,
        appealAuthorityBindingId: seeded.authorityBindingId,
        payloadDigest,
        resolutionPath,
        platformSafetyIndependentReview,
      },
    );
    const invocationStore = createPrismaGovernedActionInvocationStore(
      tx,
      { transactionClient: true },
    );
    const invocationState = resolutionPath === 'independent_review' ? 'authorized' : 'escalated';
    await invocationStore.openInvocationWithAuthoritySnapshot({
      invocation: {
        id: invocationId,
        contractVersionId: seeded.contractVersionId,
        profileBindingId: originalReceipt.invocation.profileBindingId,
        governanceHomeType: originalReceipt.invocation.governanceHomeType,
        governanceHomeRef: originalReceipt.invocation.governanceHomeRef,
        actorPubkey: appellantPubkey,
        subjectType: 'operation_receipt',
        subjectRef: originalReceipt.id,
        payloadSchemaVersion: 'governed-action-appeal-v1',
        payloadDigest,
        reasonDigest,
        requestedEffect: payload,
        collectiveCommitmentRequired: resolutionPath !== 'independent_review',
        idempotencyKey: appealId,
        idempotencyScope: 'governance_home_action_subject',
        idempotencyWindowStart: new Date(originalReceipt.completedAt),
        idempotencyWindowEnd: deadline,
        attemptKey: `${invocationId}:attempt:1`,
        recurrenceKey,
        previousReceiptRef: originalReceipt.id,
        preflightStatus: resolutionPath === 'independent_review'
          ? 'appeal_review_authorized'
          : 'appeal_case_required',
        preflightDigest,
        state: invocationState,
        createdAt: now,
        updatedAt: now,
      },
      authoritySnapshot: {
        id: `${invocationId}:authority`,
        invocationId,
        bindingId: seeded.authorityBindingId,
        authoritySourceType: seeded.authority.sourceType,
        authoritySourceRef: seeded.authority.sourceRef,
        authoritySourceVersion: seeded.authority.sourceVersion,
        profileBindingId: originalReceipt.invocation.profileBindingId,
        profileVersionRef: originalReceipt.invocation.authoritySnapshot.profileVersionRef,
        providerVersionRef: null,
        selectorDigest: seeded.authority.selectorDigest,
        capabilityDigest: seeded.authority.capabilityDigest,
        resolvedSubjectDigest: hashCanonicalGovernanceValue(
          'alcheme.governance.action-subject', {
            targetType: 'operation_receipt', targetRef: originalReceipt.id,
          },
        ),
        resolvedPayloadDigest: payloadDigest,
        liveConfigDigest: preflightDigest,
        decisionPath: resolutionPath,
        riskFloor,
        resolverVersion: 'governed-action-appeal-v1',
        validFrom: now,
        validUntil: deadline,
        snapshotDigest: hashCanonicalGovernanceValue(
          'alcheme.governance.action-appeal-authority-snapshot', {
            invocationId,
            bindingId: seeded.authorityBindingId,
            originalReceiptId: originalReceipt.id,
            appellantPubkey,
            resolutionPath,
            validUntil: deadline.toISOString(),
          },
        ),
        createdAt: now,
      },
    });
    const appeal = await tx.governedActionAppeal.create({ data: {
      id: appealId,
      appealInvocationId: invocationId,
      originalInvocationId: originalReceipt.invocationId,
      originalReceiptId: originalReceipt.id,
      appellantPubkey,
      appealWindowEndsAt: deadline,
      evidence,
      evidenceDigest,
      conflictRule: APPEAL_CONFLICT_RULE,
      resolutionPath,
      state: resolutionPath === 'independent_review' ? 'open' : 'blocked_no_independent_authority',
      governanceCaseRef: null,
      appealResolutionArtifactRef: null,
      openedAt: now,
    } });
    return { appeal: publicAppeal(appeal), replayed: false };
  });
}

export async function resolveGovernedActionAppeal(
  prisma: any,
  input: {
    appealId: string;
    reviewerPubkey: string;
    reviewerAuthorityDigest: string;
    outcome: GovernedActionAppealResolutionOutcome;
    reasonCode: string;
    evidence: Record<string, unknown>;
    now?: Date;
  },
): Promise<{
  resolutionReceipt: any;
  replayed: boolean;
  resolutionBoundary: typeof GOVERNED_ACTION_APPEAL_NO_AGGRAVATION_BOUNDARY;
}> {
  const now = input.now ?? new Date();
  const reviewerPubkey = canonicalSolanaPublicKeyString(input.reviewerPubkey);
  if (!reviewerPubkey || reviewerPubkey !== input.reviewerPubkey) {
    throw new Error('governed_action_appeal_reviewer_invalid');
  }
  if (!/^[a-f0-9]{64}$/.test(input.reviewerAuthorityDigest)) {
    throw new Error('governed_action_appeal_reviewer_authority_invalid');
  }
  const reasonCode = input.reasonCode.trim();
  if (!/^[a-z][a-z0-9._-]{2,95}$/.test(reasonCode)) {
    throw new Error('governed_action_appeal_resolution_reason_invalid');
  }
  const evidence = normalizeEvidence(input.evidence);
  return runAppealTransaction(prisma, async (tx: any) => {
    const appeal = await tx.governedActionAppeal.findUnique({
      where: { id: input.appealId },
      include: {
        resolutionReceipt: true,
        originalReceipt: { include: { initialEffect: true } },
        appealInvocation: true,
      },
    });
    if (!appeal) throw new Error('governed_action_appeal_missing');
    const outcome = validateGovernedActionAppealResolution({
      resolutionPath: appeal.resolutionPath,
      originalActorPubkey: appeal.originalReceipt.actorPubkey,
      appellantPubkey: appeal.appellantPubkey,
      reviewerPubkey,
      outcome: input.outcome,
    });
    const evidenceDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.action-appeal-resolution-evidence', evidence,
    );
    const reasonDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.action-appeal-resolution-reason', { reasonCode },
    );
    const receiptId = `appeal-resolution-receipt:${hashCanonicalGovernanceValue(
      'alcheme.governance.action-appeal-resolution-id', { appealId: appeal.id },
    ).slice(0, 52)}`;
    if (appeal.resolutionReceipt) {
      if (appeal.resolutionReceipt.id !== receiptId
        || appeal.resolutionReceipt.reviewerPubkey !== reviewerPubkey
        || appeal.resolutionReceipt.reviewerAuthorityDigest !== input.reviewerAuthorityDigest
        || appeal.resolutionReceipt.outcome !== outcome
        || appeal.resolutionReceipt.reasonDigest !== reasonDigest
        || appeal.resolutionReceipt.evidenceDigest !== evidenceDigest) {
        throw new Error('governed_action_appeal_resolution_immutable_mismatch');
      }
      return {
        resolutionReceipt: appeal.resolutionReceipt,
        replayed: true,
        resolutionBoundary: GOVERNED_ACTION_APPEAL_NO_AGGRAVATION_BOUNDARY,
      };
    }
    if (appeal.state !== 'open' || !appeal.originalReceipt.initialEffect) {
      throw new Error('governed_action_appeal_not_resolvable');
    }
    const nextEffectState = appealEffectStateForResolution(outcome);
    const effectWasTerminatedByAuthority = [
      'expired',
      'revoked',
      'superseded',
    ].includes(appeal.originalReceipt.initialEffect.state);
    const transition = nextEffectState && !effectWasTerminatedByAuthority
      ? await transitionOperationEffectInTransaction(tx, {
        effectId: appeal.originalReceipt.initialEffect.id,
        nextState: nextEffectState,
        reasonCode: `appeal_${outcome}`,
        actorPubkey: reviewerPubkey,
        sourceReceiptId: null,
        occurredAt: now,
      })
      : null;
    const effectUpdateRef = transition?.event?.id ?? null;
    const resolutionFacts = {
      appealId: appeal.id,
      reviewerPubkey,
      reviewerAuthorityDigest: input.reviewerAuthorityDigest,
      outcome,
      reasonCode,
      reasonDigest,
      evidenceDigest,
      effectUpdateRef,
      resolvedAt: now.toISOString(),
    };
    const resolutionReceipt = await tx.appealResolutionReceipt.create({ data: {
      id: receiptId,
      ...resolutionFacts,
      resolvedAt: now,
      resolutionDigest: hashCanonicalGovernanceValue(
        'alcheme.governance.action-appeal-resolution-receipt', resolutionFacts,
      ),
    } });
    const updated = await tx.governedActionAppeal.updateMany({
      where: { id: appeal.id, state: 'open', resolvedAt: null },
      data: { state: 'resolved', resolvedAt: now },
    });
    if (updated.count !== 1) throw new Error('governed_action_appeal_resolution_cas_failed');
    const executing = await tx.governedActionInvocation.updateMany({
      where: { id: appeal.appealInvocationId, state: 'authorized' },
      data: { state: 'executing', updatedAt: now },
    });
    if (executing.count !== 1) throw new Error('governed_action_appeal_invocation_cas_failed');
    const completed = await tx.governedActionInvocation.updateMany({
      where: { id: appeal.appealInvocationId, state: 'executing' },
      data: { state: 'completed', updatedAt: now },
    });
    if (completed.count !== 1) throw new Error('governed_action_appeal_invocation_cas_failed');
    return {
      resolutionReceipt,
      replayed: false,
      resolutionBoundary: GOVERNED_ACTION_APPEAL_NO_AGGRAVATION_BOUNDARY,
    };
  });
}

function normalizeEvidence(value: Record<string, unknown>): Record<string, unknown> {
  const serialized = JSON.stringify(value);
  if (!serialized || Buffer.byteLength(serialized, 'utf8') > 16_384) {
    throw new Error('governed_action_appeal_evidence_invalid');
  }
  const parsed = JSON.parse(serialized);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('governed_action_appeal_evidence_invalid');
  }
  return parsed;
}

async function runAppealTransaction<T>(
  prisma: any,
  work: (tx: any) => Promise<T>,
): Promise<T> {
  if (typeof prisma.$transaction !== 'function') return work(prisma);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(work);
    } catch (error) {
      if (!isRetryableAppealConflict(error) || attempt === 2) throw error;
    }
  }
  throw new Error('governed_action_appeal_retry_exhausted');
}

function assertAppealAppellantScope(originalReceipt: any, appellantPubkey: string): void {
  const invocation = originalReceipt?.invocation;
  const actionType = String(invocation?.contractVersion?.actionType ?? '');
  if (![
    'communication.member.mute',
    'communication.message.hide',
    'content.visibility.downrank',
    'platform.safety.content.quarantine',
    'platform.safety.legal.status.append',
    'platform.safety.incident.activation.resolve',
  ].includes(actionType)) return;
  const requestedEffect = record(invocation?.requestedEffect);
  const subjectRef = String(invocation?.subjectRef ?? '');
  const separator = subjectRef.indexOf(':');
  const circleRef = separator > 0 ? subjectRef.slice(0, separator) : '';
  const subjectValue = separator > 0 ? subjectRef.slice(separator + 1) : '';
  if (actionType === 'platform.safety.incident.activation.resolve') {
    if (
      invocation?.subjectType !== 'platform_safety_incident'
      || subjectRef !== String(requestedEffect.incidentId || '')
      || requestedEffect.commanderPubkey !== appellantPubkey
      || requestedEffect.outcome !== 'approve'
    ) {
      throw new Error('governed_action_appeal_appellant_not_subject');
    }
    return;
  }
  if (actionType === 'platform.safety.content.quarantine') {
    const frozenSubject = record(requestedEffect.frozenSubject);
    if (
      invocation?.subjectType !== 'feed_post'
      || !/^\d+$/.test(circleRef)
      || !subjectValue
      || requestedEffect.contentId !== subjectValue
      || frozenSubject.authorPubkey !== appellantPubkey
    ) {
      throw new Error('governed_action_appeal_appellant_not_subject');
    }
    return;
  }
  if (actionType === 'platform.safety.legal.status.append') {
    if (
      invocation?.subjectType !== 'feed_post'
      || subjectRef !== String(requestedEffect.contentId || '')
      || requestedEffect.authorPubkey !== appellantPubkey
    ) {
      throw new Error('governed_action_appeal_appellant_not_subject');
    }
    return;
  }
  if (actionType === 'content.visibility.downrank') {
    const frozenSignals = record(requestedEffect.frozenSignals);
    if (
      invocation?.subjectType !== 'feed_post'
      || !/^\d+$/.test(circleRef)
      || !subjectValue
      || requestedEffect.contentId !== subjectValue
      || frozenSignals.authorPubkey !== appellantPubkey
    ) {
      throw new Error('governed_action_appeal_appellant_not_subject');
    }
    return;
  }
  if (actionType === 'communication.message.hide') {
    if (
      invocation?.subjectType !== 'communication_message'
      || !/^\d+$/.test(circleRef)
      || !subjectValue
      || requestedEffect.roomKey !== `circle:${circleRef}`
      || requestedEffect.envelopeId !== subjectValue
      || requestedEffect.targetMemberPubkey !== appellantPubkey
    ) {
      throw new Error('governed_action_appeal_appellant_not_subject');
    }
    return;
  }
  if (
    invocation?.subjectType !== 'communication_room_member'
    || !/^\d+$/.test(circleRef)
    || subjectValue !== appellantPubkey
    || requestedEffect.roomKey !== `circle:${circleRef}`
    || requestedEffect.targetMemberPubkey !== appellantPubkey
  ) {
    throw new Error('governed_action_appeal_appellant_not_subject');
  }
}

async function resolvePlatformSafetyIndependentReviewAuthority(
  tx: any,
  originalReceipt: any,
  appellantPubkey: string,
): Promise<Record<string, unknown> | null> {
  const invocation = originalReceipt?.invocation;
  const actionType = invocation?.contractVersion?.actionType;
  if (![
    'platform.safety.content.quarantine',
    'platform.safety.legal.status.append',
    'platform.safety.incident.activation.resolve',
  ].includes(actionType)) {
    return null;
  }
  const requestedEffect = record(invocation.requestedEffect);
  const authority = record(requestedEffect.authority);
  const policy = record(requestedEffect.policy);
  const activationAppeal =
    actionType === 'platform.safety.incident.activation.resolve';
  const legalAppeal =
    actionType === 'platform.safety.legal.status.append';
  const bindingId = String(
    activationAppeal
      ? authority.activationAppealBindingId
      : legalAppeal
        ? authority.roleBindingId
        : authority.independentAppealBindingId,
  );
  const expectedPolicyVersionId = String(
    activationAppeal
      ? authority.activationAppealPolicyVersionId
      : policy.versionId,
  );
  if (
    !bindingId
    || !expectedPolicyVersionId
    || (
      !activationAppeal
      && !/^[a-f0-9]{64}$/.test(String(policy.digest || ''))
    )
  ) {
    throw new Error('governed_action_appeal_independent_authority_invalid');
  }
  const [binding, policyVersion] = await Promise.all([
    tx.systemGovernanceRoleBinding.findUnique({ where: { id: bindingId } }),
    tx.governancePolicyVersion.findUnique({
      where: { id: expectedPolicyVersionId },
    }),
  ]);
  if (
    !binding
    || binding.domain !== 'platform_safety'
    || binding.roleKey !== (
      activationAppeal
        ? 'platform_safety_policy_admin'
        : legalAppeal
          ? 'platform_safety_legal_appeal_reviewer'
          : 'platform_safety_appeal_reviewer'
    )
    || binding.environment !== 'sandbox'
    || binding.status !== 'active'
    || binding.policyVersionId !== expectedPolicyVersionId
    || !policyVersion
    || policyVersion.status !== 'active'
    || (
      !activationAppeal
      && policyVersion.configDigest !== policy.digest
    )
  ) {
    throw new Error('governed_action_appeal_independent_authority_invalid');
  }
  const [circle, memberships] = await Promise.all([
    tx.circle.findUnique({
      where: { id: binding.circleId },
      select: { kind: true, mode: true, circleType: true },
    }),
    tx.circleMember.findMany({
      where: { circleId: binding.circleId, status: 'Active' },
      include: { user: { select: { pubkey: true } } },
      orderBy: { userId: 'asc' },
    }),
  ]);
  if (
    !circle
    || circle.kind !== 'auxiliary'
    || circle.mode !== 'governance'
    || circle.circleType !== 'Secret'
  ) {
    throw new Error('governed_action_appeal_independent_authority_invalid');
  }
  const actorPubkeys = memberships
    .map((membership: any) =>
      canonicalSolanaPublicKeyString(membership.user?.pubkey))
    .filter((value: string | null): value is string => !!value)
    .sort();
  const eligibleActorPubkeys = actorPubkeys.filter(
    (actor: string) =>
      actor !== originalReceipt.actorPubkey && actor !== appellantPubkey,
  );
  if (
    activationAppeal
    && authority.activationAppealActorSetDigest
      !== hashCanonicalGovernanceValue(
        'alcheme.governance.platform-safety-role-actors',
        actorPubkeys,
      )
  ) {
    throw new Error('governed_action_appeal_independent_authority_invalid');
  }
  if (actorPubkeys.length === 0 || eligibleActorPubkeys.length === 0) {
    throw new Error('governed_action_appeal_independent_authority_unavailable');
  }
  return {
    bindingId,
    circleId: binding.circleId,
    policyVersionId: binding.policyVersionId,
    policyDigest: policyVersion.configDigest,
    actorSetDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.platform-safety-role-actors',
      actorPubkeys,
    ),
    eligibleActorSetDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.platform-safety-appeal-eligible-actors',
      eligibleActorPubkeys,
    ),
  };
}

function isRetryableAppealConflict(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code?: unknown }).code);
    if (code === 'P2002' || code === 'P2034') return true;
  }
  const message = error instanceof Error ? error.message : '';
  if (message.includes('current transaction is aborted') || message.includes('25P02')) {
    return true;
  }
  return [
    'operation_effect_transition_cas_failed',
    'operation_effect_transition_invalid',
    'governed_action_appeal_resolution_cas_failed',
    'governed_action_appeal_invocation_cas_failed',
  ].includes(message);
}

function publicAppeal(value: any): GovernedActionAppealRecord {
  return {
    id: String(value.id),
    appealInvocationId: String(value.appealInvocationId),
    originalInvocationId: String(value.originalInvocationId),
    originalReceiptId: String(value.originalReceiptId),
    appellantPubkey: String(value.appellantPubkey),
    appealWindowEndsAt: new Date(value.appealWindowEndsAt).toISOString(),
    resolutionPath: value.resolutionPath,
    state: String(value.state),
    governanceCaseRef: value.governanceCaseRef == null ? null : String(value.governanceCaseRef),
    appealResolutionArtifactRef: value.appealResolutionArtifactRef == null
      ? null
      : String(value.appealResolutionArtifactRef),
  };
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}
