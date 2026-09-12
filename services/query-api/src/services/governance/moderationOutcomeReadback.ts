import { hashCanonicalGovernanceValue } from './canonicalCodec';
import { projectGovernedDirectOperationReceipt } from './governedActionGateway';

const MODERATION_ACTION_TYPES = [
  'communication.member.mute',
  'communication.message.hide',
] as const;
const MINIMUM_PRIVACY_SAMPLE_SIZE = 5;
const MINIMUM_DISTINCT_PARTICIPANTS = 3;

type ModerationActionType = typeof MODERATION_ACTION_TYPES[number];
type AppealOutcome = 'uphold' | 'modify_reduce' | 'revoke' | 'expire';

export interface ModerationOutcomeReadback {
  schemaVersion: 1;
  circleId: number;
  scope: {
    actionTypes: ModerationActionType[];
    source: 'canonical_operation_receipt_effect_and_appeal_resolution';
    visibility: 'circle_member_aggregate_no_actor_subject_reason_or_evidence';
  };
  actions: {
    total: number;
    byType: Record<ModerationActionType, number>;
    repeated: number;
    recurrenceRateBps: number;
  };
  appeals: {
    opened: number;
    pending: number;
    resolved: number;
    privacyStatus: 'available' | 'insufficient_sample';
    minimumSampleSize: number;
    minimumDistinctSubjects: number;
    outcomes: null | {
      uphold: number;
      modify: number;
      revoke: number;
      expiredWithoutMeritsDecision: number;
    };
    correctedActionCount: number | null;
    correctedActionRateBps: number | null;
    duration: null | {
      averageSeconds: number;
      medianSeconds: number;
    };
  };
  operatorConcentration: {
    privacyStatus: 'available' | 'insufficient_sample';
    minimumSampleSize: number;
    minimumDistinctOperators: number;
    distinctOperatorCount: number | null;
    topOperatorShareBps: number | null;
  };
  incentiveBoundary: 'moderation_volume_is_never_contribution_or_performance';
}

export async function readModerationOutcomes(
  prisma: any,
  input: { circleId: number },
): Promise<ModerationOutcomeReadback> {
  if (!Number.isSafeInteger(input.circleId) || input.circleId <= 0) {
    throw new Error('moderation_outcome_circle_invalid');
  }
  const receipts = await prisma.operationReceipt.findMany({
    where: {
      executionStatus: 'succeeded',
      invocation: {
        governanceHomeType: 'circle',
        governanceHomeRef: String(input.circleId),
        contractVersion: { actionType: { in: [...MODERATION_ACTION_TYPES] } },
      },
    },
    include: {
      invocation: {
        include: {
          contractVersion: true,
          authoritySnapshot: { include: { binding: true } },
        },
      },
      initialEffect: true,
      appeals: { include: { resolutionReceipt: true } },
    },
    orderBy: [{ completedAt: 'asc' }, { id: 'asc' }],
  });
  return projectModerationOutcomes(receipts, input.circleId);
}

export function projectModerationOutcomes(
  receipts: any[],
  circleId: number,
): ModerationOutcomeReadback {
  const actionCounts: Record<ModerationActionType, number> = {
    'communication.member.mute': 0,
    'communication.message.hide': 0,
  };
  const operatorCounts = new Map<string, number>();
  const outcomes: Record<AppealOutcome, number> = {
    uphold: 0,
    modify_reduce: 0,
    revoke: 0,
    expire: 0,
  };
  const durations: number[] = [];
  const resolvedSubjectRefs = new Set<string>();
  let repeated = 0;
  let openedAppeals = 0;
  let pendingAppeals = 0;

  for (const receipt of receipts) {
    const projected = projectGovernedDirectOperationReceipt(receipt);
    const actionType = receipt.invocation?.contractVersion?.actionType;
    const receiptDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.operation-receipt', {
        invocationId: receipt.invocationId,
        attemptKey: receipt.attemptKey,
        actorPubkey: receipt.actorPubkey,
        capabilityDigest: receipt.capabilityDigest,
        policyVersionRef: receipt.policyVersionRef,
        reasonCode: receipt.reasonCode,
        reasonDigest: receipt.reasonDigest,
        limitsDigest: receipt.limitsDigest,
        payloadDigest: receipt.payloadDigest,
        resultDigest: receipt.resultDigest,
        executionAdapter: receipt.executionAdapter,
        executionDomain: receipt.executionDomain,
        executionStatus: receipt.executionStatus,
        executionRef: receipt.executionRef ?? null,
        errorCode: receipt.errorCode ?? null,
        appealRef: receipt.appealRef,
        appealWindowEndsAt: receipt.appealWindowEndsAt == null
          ? null
          : new Date(receipt.appealWindowEndsAt).toISOString(),
        escalationRef: receipt.escalationRef,
        startedAt: new Date(receipt.startedAt).toISOString(),
        completedAt: new Date(receipt.completedAt).toISOString(),
      },
    );
    const effectDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.operation-effect', {
        invocationId: receipt.invocationId,
        initialReceiptId: receipt.id,
        initialReceiptDigest: receipt.receiptDigest,
        initialState: 'active',
      },
    );
    if (
      !MODERATION_ACTION_TYPES.includes(actionType)
      || receipt.invocation.governanceHomeType !== 'circle'
      || receipt.invocation.governanceHomeRef !== String(circleId)
      || receipt.executionStatus !== 'succeeded'
      || !receipt.initialEffect
      || receipt.initialEffect.invocationId !== receipt.invocationId
      || receipt.initialEffect.initialReceiptId !== receipt.id
      || receipt.receiptDigest !== receiptDigest
      || receipt.initialEffect.effectDigest !== effectDigest
      || !Array.isArray(receipt.appeals)
      || receipt.appeals.length > 1
    ) throw new Error('moderation_outcome_canonical_fact_mismatch');
    actionCounts[actionType as ModerationActionType] += 1;
    operatorCounts.set(projected.actorPubkey, (operatorCounts.get(projected.actorPubkey) ?? 0) + 1);
    if (receipt.invocation.previousReceiptRef) repeated += 1;

    const appeal = receipt.appeals[0];
    if (!appeal) continue;
    openedAppeals += 1;
    if (
      appeal.originalReceiptId !== receipt.id
      || appeal.originalInvocationId !== receipt.invocationId
      || !/^[a-f0-9]{64}$/.test(String(appeal.evidenceDigest ?? ''))
    ) throw new Error('moderation_outcome_appeal_owner_mismatch');
    const resolution = appeal.resolutionReceipt;
    if (!resolution) {
      if (appeal.resolvedAt != null || appeal.state === 'resolved') {
        throw new Error('moderation_outcome_appeal_resolution_missing');
      }
      pendingAppeals += 1;
      continue;
    }
    const outcome = resolution.outcome as AppealOutcome;
    const openedAt = new Date(appeal.openedAt);
    const resolvedAt = new Date(resolution.resolvedAt);
    const durationSeconds = Math.floor((resolvedAt.getTime() - openedAt.getTime()) / 1000);
    const expectedDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.action-appeal-resolution-receipt', {
        appealId: appeal.id,
        reviewerPubkey: resolution.reviewerPubkey,
        reviewerAuthorityDigest: resolution.reviewerAuthorityDigest,
        outcome,
        reasonCode: resolution.reasonCode,
        reasonDigest: resolution.reasonDigest,
        evidenceDigest: resolution.evidenceDigest,
        effectUpdateRef: resolution.effectUpdateRef ?? null,
        resolvedAt: resolvedAt.toISOString(),
      },
    );
    if (
      !Object.hasOwn(outcomes, outcome)
      || resolution.appealId !== appeal.id
      || appeal.state !== 'resolved'
      || !(appeal.resolvedAt instanceof Date)
      || appeal.resolvedAt.getTime() !== resolvedAt.getTime()
      || !Number.isFinite(openedAt.getTime())
      || !Number.isFinite(resolvedAt.getTime())
      || durationSeconds < 0
      || resolution.resolutionDigest !== expectedDigest
    ) throw new Error('moderation_outcome_appeal_resolution_mismatch');
    outcomes[outcome] += 1;
    durations.push(durationSeconds);
    resolvedSubjectRefs.add(receipt.invocation.subjectRef);
  }

  const total = receipts.length;
  const resolved = durations.length;
  const appealPrivacyAvailable = resolved >= MINIMUM_PRIVACY_SAMPLE_SIZE
    && resolvedSubjectRefs.size >= MINIMUM_DISTINCT_PARTICIPANTS;
  const concentrationPrivacyAvailable = total >= MINIMUM_PRIVACY_SAMPLE_SIZE
    && operatorCounts.size >= MINIMUM_DISTINCT_PARTICIPANTS;
  const sortedDurations = [...durations].sort((left, right) => left - right);
  const middle = Math.floor(sortedDurations.length / 2);
  const medianSeconds = sortedDurations.length % 2 === 0
    ? Math.round((sortedDurations[middle - 1] + sortedDurations[middle]) / 2)
    : sortedDurations[middle];
  const correctedActionCount = outcomes.modify_reduce + outcomes.revoke;
  const topOperatorCount = Math.max(0, ...operatorCounts.values());

  return {
    schemaVersion: 1,
    circleId,
    scope: {
      actionTypes: [...MODERATION_ACTION_TYPES],
      source: 'canonical_operation_receipt_effect_and_appeal_resolution',
      visibility: 'circle_member_aggregate_no_actor_subject_reason_or_evidence',
    },
    actions: {
      total,
      byType: actionCounts,
      repeated,
      recurrenceRateBps: ratioBps(repeated, total),
    },
    appeals: {
      opened: openedAppeals,
      pending: pendingAppeals,
      resolved,
      privacyStatus: appealPrivacyAvailable ? 'available' : 'insufficient_sample',
      minimumSampleSize: MINIMUM_PRIVACY_SAMPLE_SIZE,
      minimumDistinctSubjects: MINIMUM_DISTINCT_PARTICIPANTS,
      outcomes: appealPrivacyAvailable ? {
        uphold: outcomes.uphold,
        modify: outcomes.modify_reduce,
        revoke: outcomes.revoke,
        expiredWithoutMeritsDecision: outcomes.expire,
      } : null,
      correctedActionCount: appealPrivacyAvailable ? correctedActionCount : null,
      correctedActionRateBps: appealPrivacyAvailable
        ? ratioBps(correctedActionCount, resolved)
        : null,
      duration: appealPrivacyAvailable ? {
        averageSeconds: Math.round(durations.reduce((sum, value) => sum + value, 0) / resolved),
        medianSeconds,
      } : null,
    },
    operatorConcentration: {
      privacyStatus: concentrationPrivacyAvailable ? 'available' : 'insufficient_sample',
      minimumSampleSize: MINIMUM_PRIVACY_SAMPLE_SIZE,
      minimumDistinctOperators: MINIMUM_DISTINCT_PARTICIPANTS,
      distinctOperatorCount: concentrationPrivacyAvailable ? operatorCounts.size : null,
      topOperatorShareBps: concentrationPrivacyAvailable
        ? ratioBps(topOperatorCount, total)
        : null,
    },
    incentiveBoundary: 'moderation_volume_is_never_contribution_or_performance',
  };
}

function ratioBps(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 10_000);
}
