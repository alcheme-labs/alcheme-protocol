import type { PrismaClient } from '@prisma/client';

import { projectGovernedDirectOperationReceipt } from './governedActionGateway';
import { transitionOperationEffectInTransaction } from './operationEffectLifecycle';
import {
  GOVERNED_ACTION_APPEAL_NO_AGGRAVATION_BOUNDARY,
  projectGovernedActionAppealRouting,
} from './governedActionAppeal';
import {
  reconcileExpiredCommunicationMessageHides,
} from './communicationMessageHideLifecycle';

export const COMMUNICATION_MEMBER_MUTE_MIN_DURATION_SECONDS = 5 * 60;
export const COMMUNICATION_MEMBER_MUTE_MAX_DURATION_SECONDS = 24 * 60 * 60;
export const COMMUNICATION_MEMBER_MUTE_RATIFICATION_KIND =
  'communication_member_mute_ratification';
export const COMMUNICATION_MEMBER_MUTE_APPEAL_KIND =
  'communication_member_mute_appeal_resolution';

export type CommunicationMemberMuteReviewTiming =
  | 'pre_execution'
  | 'post_execution_ratification';

export const COMMUNICATION_MEMBER_MUTE_SCOPE = {
  capability: 'communication_room_write_and_voice',
  membership: 'unchanged',
  proposal: 'unchanged',
  voter: 'unchanged',
  benefits: 'unchanged',
} as const;

const EFFECTIVE_RESTRICTION_STATES = ['active', 'ratification_required', 'rollback_failed'];
const RESTRICTION_RISK_PRIORITY: Record<string, number> = {
  critical: 400,
  high: 300,
  medium: 200,
  low: 100,
};

export async function readEffectiveCommunicationSubjectRestrictionState(
  prisma: PrismaClient,
  input: { circleId: number; walletPubkey: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const roomKey = `circle:${input.circleId}`;
  const memberReconciliation = await reconcileExpiredCommunicationMemberMutes(prisma as any, {
    now,
    limit: 1,
    roomKey,
    walletPubkey: input.walletPubkey,
  });
  if (memberReconciliation.failures.length > 0) {
    throw temporaryMuteError(409, 'effective_restriction_member_reconciliation_failed');
  }
  for (;;) {
    const reconciliation = await reconcileExpiredCommunicationMessageHides(prisma as any, {
      now,
      limit: 500,
      roomKey,
      senderPubkey: input.walletPubkey,
    });
    if (reconciliation.failures.length > 0) {
      throw temporaryMuteError(409, 'effective_restriction_message_reconciliation_failed');
    }
    if (reconciliation.scanned === 0) break;
    if (reconciliation.restored.length === 0) {
      throw temporaryMuteError(409, 'effective_restriction_message_reconciliation_stalled');
    }
  }
  const [member, hiddenMessageHistoryCount, effects] = await Promise.all([
    (prisma as any).communicationRoomMember.findUnique({
      where: { roomKey_walletPubkey: { roomKey, walletPubkey: input.walletPubkey } },
      select: { muteOperationEffectId: true },
    }),
    (prisma as any).communicationMessage.count({
      where: {
        roomKey,
        senderPubkey: input.walletPubkey,
        hideOperationEffectId: { not: null },
      },
    }),
    (prisma as any).operationEffect.findMany({
      where: {
        state: { in: EFFECTIVE_RESTRICTION_STATES },
        OR: [
          { mutedMember: { is: { roomKey, walletPubkey: input.walletPubkey } } },
          { hiddenMessage: { is: { roomKey, senderPubkey: input.walletPubkey } } },
        ],
      },
      include: {
        initialReceipt: {
          include: {
            invocation: {
              include: {
                contractVersion: true,
                authoritySnapshot: { include: { binding: true } },
              },
            },
            appeals: {
              include: { resolutionReceipt: true },
              orderBy: { openedAt: 'desc' },
              take: 2,
            },
          },
        },
        events: { orderBy: { sequence: 'asc' } },
        mutedMember: true,
        hiddenMessage: true,
      },
      orderBy: { id: 'asc' },
    }),
  ]);
  const activeEffects = effects.map((effect: any) => {
    const receipt = effect.initialReceipt;
    const invocation = receipt?.invocation;
    if (!receipt || receipt.id !== effect.initialReceiptId
      || receipt.invocationId !== effect.invocationId
      || receipt.executionStatus !== 'succeeded'
      || !invocation?.authoritySnapshot?.binding
      || receipt.appeals.length > 1) {
      throw temporaryMuteError(409, 'effective_restriction_owner_mismatch');
    }
    const memberLink = effect.mutedMember ?? null;
    const messageLink = effect.hiddenMessage ?? null;
    if ((memberLink == null) === (messageLink == null)) {
      throw temporaryMuteError(409, 'effective_restriction_subject_link_ambiguous');
    }
    const actionType = String(invocation.contractVersion?.actionType ?? '');
    const expectedMember = actionType === 'communication.member.mute';
    const expectedMessage = actionType === 'communication.message.hide';
    if ((!expectedMember && !expectedMessage)
      || (expectedMember && (!memberLink || memberLink.muted !== true
        || memberLink.roomKey !== roomKey
        || memberLink.walletPubkey !== input.walletPubkey
        || memberLink.muteOperationReceiptId !== receipt.id
        || memberLink.muteOperationEffectId !== effect.id))
      || (expectedMessage && (!messageLink || messageLink.hidden !== true
        || messageLink.deleted === true
        || messageLink.roomKey !== roomKey
        || messageLink.senderPubkey !== input.walletPubkey
        || messageLink.hideOperationReceiptId !== receipt.id
        || messageLink.hideOperationEffectId !== effect.id))) {
      throw temporaryMuteError(409, 'effective_restriction_current_link_mismatch');
    }
    const requestedEffect = invocation.requestedEffect
      && typeof invocation.requestedEffect === 'object'
      && !Array.isArray(invocation.requestedEffect)
      ? invocation.requestedEffect as Record<string, unknown>
      : {};
    const expiresAt = new Date(String(requestedEffect.expiresAt ?? ''));
    const appealDeadline = new Date(receipt.appealWindowEndsAt);
    const riskFloor = String(invocation.authoritySnapshot.riskFloor ?? '');
    const priority = RESTRICTION_RISK_PRIORITY[riskFloor];
    const targetRef = expectedMember
      ? input.walletPubkey
      : String(messageLink.envelopeId);
    if (!Number.isFinite(expiresAt.getTime())
      || !Number.isFinite(appealDeadline.getTime())
      || !priority
      || invocation.governanceHomeType !== 'circle'
      || invocation.governanceHomeRef !== String(input.circleId)
      || invocation.subjectType !== (expectedMember
        ? 'communication_room_member'
        : 'communication_message')
      || invocation.subjectRef !== `${input.circleId}:${targetRef}`
      || requestedEffect.roomKey !== roomKey
      || requestedEffect.targetMemberPubkey !== input.walletPubkey
      || String(requestedEffect.appeal ?? '') !== 'canonical_operation_receipt_window') {
      throw temporaryMuteError(409, 'effective_restriction_contract_mismatch');
    }
    const appeal = receipt.appeals[0] ?? null;
    if (appeal && appeal.appellantPubkey !== input.walletPubkey) {
      throw temporaryMuteError(409, 'effective_restriction_appeal_subject_mismatch');
    }
    const projected = projectGovernedDirectOperationReceipt(receipt);
    return {
      actionType,
      subjectType: invocation.subjectType,
      subjectRef: invocation.subjectRef,
      targetRef,
      priority: { source: 'governed_action_risk_floor', riskFloor, rank: priority },
      scope: requestedEffect.scope,
      expiresAt: expiresAt.toISOString(),
      authority: {
        bindingId: projected.roleAssignmentProof.bindingId,
        sourceType: projected.roleAssignmentProof.sourceType,
        sourceRef: projected.roleAssignmentProof.sourceRef,
        sourceVersion: projected.roleAssignmentProof.sourceVersion,
        policyVersionRef: projected.policyVersionRef,
      },
      receipt: {
        id: projected.id,
        receiptDigest: projected.receiptDigest,
      },
      effect: {
        id: effect.id,
        state: effect.state,
        authorityCanReleaseOnlyThisEffect: true,
      },
      appeal: {
        ref: projected.appealRef,
        deadline: appealDeadline.toISOString(),
        routing: projectGovernedActionAppealRouting({
          actionType,
          circleId: input.circleId,
          receiptId: projected.id,
          deadline: appealDeadline.toISOString(),
        }),
        status: appeal?.state
          ?? (now.getTime() <= appealDeadline.getTime() ? 'available' : 'expired'),
        canSubmit: !appeal && now.getTime() <= appealDeadline.getTime(),
        id: appeal?.id ?? null,
      },
    };
  }).sort((left: any, right: any) => (
    right.priority.rank - left.priority.rank
      || left.effect.id.localeCompare(right.effect.id)
  ));
  const hasRestrictionHistory = member?.muteOperationEffectId != null
    || hiddenMessageHistoryCount > 0;
  return {
    subject: { type: 'communication_member', circleId: input.circleId, walletPubkey: input.walletPubkey },
    composition: {
      source: 'canonical_operation_effects',
      rule: 'cumulative_scope_with_risk_floor_priority',
      persistedProjection: false,
    },
    status: activeEffects.length > 0
      ? 'restricted'
      : hasRestrictionHistory ? 'restored' : 'clear',
    activeEffectCount: activeEffects.length,
    activeEffects,
  };
}

export function resolveTemporaryCommunicationMuteContract(input: {
  durationSeconds: number;
  now: Date;
  expiresAt?: Date;
  reviewTiming: CommunicationMemberMuteReviewTiming;
}) {
  if (!Number.isSafeInteger(input.durationSeconds)
    || input.durationSeconds < COMMUNICATION_MEMBER_MUTE_MIN_DURATION_SECONDS
    || input.durationSeconds > COMMUNICATION_MEMBER_MUTE_MAX_DURATION_SECONDS) {
    throw temporaryMuteError(400, 'operator_mute_duration_out_of_range');
  }
  const expiresAt = input.expiresAt ?? new Date(input.now.getTime() + input.durationSeconds * 1000);
  if (!Number.isFinite(expiresAt.getTime())) {
    throw temporaryMuteError(400, 'operator_mute_expiry_invalid');
  }
  if (!['pre_execution', 'post_execution_ratification'].includes(input.reviewTiming)) {
    throw temporaryMuteError(400, 'operator_mute_review_timing_invalid');
  }
  const ratificationRequired = input.reviewTiming === 'post_execution_ratification';
  return {
    contractVersion: 'communication-member-temporary-mute-current',
    durationSeconds: input.durationSeconds,
    maximumDurationSeconds: COMMUNICATION_MEMBER_MUTE_MAX_DURATION_SECONDS,
    expiresAt,
    automaticExpiry: 'scheduler_and_read_reconciliation',
    notification: 'subject_notification_and_canonical_state_readback',
    reviewTiming: input.reviewTiming,
    ratification: {
      required: ratificationRequired,
      caseOwner: ratificationRequired ? 'governance_case' : null,
      deadline: ratificationRequired ? expiresAt.toISOString() : null,
      originalOperatorEligible: false,
      onRejectOrTimeout: ratificationRequired
        ? 'expire_and_unmute_exact_member'
        : 'not_applicable',
    },
    initialEffectState: ratificationRequired ? 'ratification_required' : 'active',
    appeal: 'canonical_operation_receipt_window',
    rollback: 'unmute_exact_communication_member',
    scope: COMMUNICATION_MEMBER_MUTE_SCOPE,
  } as const;
}

export async function linkTemporaryCommunicationMuteInTransaction(
  tx: any,
  input: {
    circleId: number;
    roomKey: string;
    targetMemberPubkey: string;
    reasonCode: string;
    mutedAt: Date;
    expiresAt: Date;
    receipt: { id: string; invocationId: string };
    replayed: boolean;
    requiredEffectState: 'active' | 'ratification_required' | 'expired' | 'revoked';
    ratificationCaseId?: string | null;
  },
): Promise<any> {
  const effect = await tx.operationEffect.findUnique({
    where: { invocationId: input.receipt.invocationId },
  });
  if (!effect || effect.initialReceiptId !== input.receipt.id
    || effect.state !== input.requiredEffectState) {
    throw temporaryMuteError(409, 'operator_mute_effect_readback_mismatch');
  }
  const current = await tx.communicationRoomMember.findUnique({
    where: {
      roomKey_walletPubkey: {
        roomKey: input.roomKey,
        walletPubkey: input.targetMemberPubkey,
      },
    },
  });
  const expectedMuted = ['active', 'ratification_required'].includes(input.requiredEffectState);
  if (!current || current.leftAt != null || current.muted !== expectedMuted) {
    throw temporaryMuteError(409, 'operator_mute_readback_mismatch');
  }
  if (input.replayed) {
    if (current.muteOperationReceiptId !== input.receipt.id
      || current.muteOperationEffectId !== effect.id
      || current.muteReasonCode !== input.reasonCode
      || !(current.mutedAt instanceof Date)
      || !(current.muteExpiresAt instanceof Date)
      || current.muteExpiresAt.getTime() !== input.expiresAt.getTime()
      || !(current.muteNoticeAvailableAt instanceof Date)) {
      throw temporaryMuteError(409, 'operator_mute_replay_readback_mismatch');
    }
    return current;
  }
  if (!expectedMuted) {
    throw temporaryMuteError(409, 'operator_mute_terminal_state_not_executable');
  }
  const linked = await tx.communicationRoomMember.updateMany({
    where: {
      roomKey: input.roomKey,
      walletPubkey: input.targetMemberPubkey,
      leftAt: null,
      muted: true,
      mutedAt: input.mutedAt,
      muteExpiresAt: input.expiresAt,
      muteReasonCode: input.reasonCode,
    },
    data: {
      mutedAt: input.mutedAt,
      muteExpiresAt: input.expiresAt,
      muteOperationReceiptId: input.receipt.id,
      muteOperationEffectId: effect.id,
      muteReasonCode: input.reasonCode,
      muteNoticeAvailableAt: input.mutedAt,
    },
  });
  if (linked.count !== 1) {
    throw temporaryMuteError(409, 'operator_mute_link_cas_failed');
  }
  const subject = await tx.user.findUnique({
    where: { pubkey: input.targetMemberPubkey },
    select: { id: true },
  });
  if (subject) {
    await tx.notification.create({
      data: {
        userId: subject.id,
        type: 'governance_moderation',
        title: 'A temporary communication restriction is active',
        body: `This Circle communication mute expires automatically at ${input.expiresAt.toISOString()}.`,
        sourceType: 'operation_receipt',
        sourceId: input.receipt.id,
        circleId: input.circleId,
        createdAt: input.mutedAt,
        metadata: {
          schemaVersion: 1,
          canonicalUrl: `/governance/moderation/${input.circleId}`,
          receiptId: input.receipt.id,
          scope: COMMUNICATION_MEMBER_MUTE_SCOPE,
          expiresAt: input.expiresAt.toISOString(),
          appeal: 'canonical_operation_receipt_window',
          ratificationCaseId: input.ratificationCaseId ?? null,
        },
      },
    });
  }
  const durable = await tx.communicationRoomMember.findUnique({
    where: {
      roomKey_walletPubkey: {
        roomKey: input.roomKey,
        walletPubkey: input.targetMemberPubkey,
      },
    },
  });
  if (!durable || durable.muteOperationEffectId !== effect.id) {
    throw temporaryMuteError(409, 'operator_mute_link_readback_mismatch');
  }
  return durable;
}

export async function releaseCommunicationMuteForTerminalEffectInTransaction(
  tx: any,
  input: { effectId: string },
): Promise<number> {
  const updated = await tx.communicationRoomMember.updateMany({
    where: { muteOperationEffectId: input.effectId, muted: true },
    data: { muted: false },
  });
  return updated.count;
}

async function reconcileOneTemporaryCommunicationMute(
  tx: any,
  input: { roomKey: string; walletPubkey: string; effectId: string; expiresAt: Date; now: Date },
): Promise<'expired' | 'already_terminal' | 'stale'> {
  const member = await tx.communicationRoomMember.findUnique({
    where: { roomKey_walletPubkey: { roomKey: input.roomKey, walletPubkey: input.walletPubkey } },
  });
  if (!member || member.muted !== true || member.muteOperationEffectId !== input.effectId
    || !(member.muteExpiresAt instanceof Date)
    || member.muteExpiresAt.getTime() !== input.expiresAt.getTime()
    || member.muteExpiresAt.getTime() > input.now.getTime()) return 'stale';
  const effect = await tx.operationEffect.findUnique({ where: { id: input.effectId } });
  if (!effect) throw new Error('communication_mute_effect_missing');
  if (['active', 'ratification_required'].includes(effect.state)) {
    await transitionOperationEffectInTransaction(tx, {
      effectId: effect.id,
      nextState: 'expired',
      reasonCode: 'temporary_communication_mute_expired',
      actorPubkey: null,
      sourceReceiptId: null,
      occurredAt: input.now,
    });
  } else if (!['expired', 'revoked', 'superseded'].includes(effect.state)) {
    throw new Error('communication_mute_effect_not_releasable');
  }
  const released = await releaseCommunicationMuteForTerminalEffectInTransaction(tx, {
    effectId: effect.id,
  });
  if (released !== 1) throw new Error('communication_mute_release_cas_failed');
  return ['active', 'ratification_required'].includes(effect.state) ? 'expired' : 'already_terminal';
}

export async function reconcileExpiredCommunicationMemberMutes(
  prisma: any,
  input: { now?: Date; limit?: number; roomKey?: string; walletPubkey?: string } = {},
) {
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
  const candidates = await prisma.communicationRoomMember.findMany({
    where: {
      muted: true,
      muteExpiresAt: { lte: now },
      muteOperationEffectId: { not: null },
      ...(input.roomKey ? { roomKey: input.roomKey } : {}),
      ...(input.walletPubkey ? { walletPubkey: input.walletPubkey } : {}),
    },
    select: {
      roomKey: true,
      walletPubkey: true,
      muteExpiresAt: true,
      muteOperationEffectId: true,
    },
    orderBy: [{ muteExpiresAt: 'asc' }, { roomKey: 'asc' }, { walletPubkey: 'asc' }],
    take: limit,
  });
  const expired: string[] = [];
  const failures: Array<{ subjectRef: string; error: string }> = [];
  for (const candidate of candidates) {
    const subjectRef = `${candidate.roomKey}:${candidate.walletPubkey}`;
    try {
      const result = await prisma.$transaction((tx: any) => reconcileOneTemporaryCommunicationMute(tx, {
        roomKey: candidate.roomKey,
        walletPubkey: candidate.walletPubkey,
        effectId: candidate.muteOperationEffectId,
        expiresAt: candidate.muteExpiresAt,
        now,
      }));
      if (result !== 'stale') expired.push(subjectRef);
    } catch (error) {
      failures.push({ subjectRef, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { scanned: candidates.length, expired, failures };
}

export async function readCommunicationMemberModerationState(
  prisma: PrismaClient,
  input: { circleId: number; walletPubkey: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const roomKey = `circle:${input.circleId}`;
  await reconcileExpiredCommunicationMemberMutes(prisma as any, {
    now,
    limit: 1,
    roomKey,
    walletPubkey: input.walletPubkey,
  });
  const member = await (prisma as any).communicationRoomMember.findUnique({
    where: { roomKey_walletPubkey: { roomKey, walletPubkey: input.walletPubkey } },
  });
  if (!member) throw temporaryMuteError(404, 'communication_member_not_found');
  if (!member.muteOperationReceiptId || !member.muteOperationEffectId) {
    return { member: publicCommunicationMemberMuteState(member), restriction: null };
  }
  const receipt = await (prisma as any).operationReceipt.findUnique({
    where: { id: member.muteOperationReceiptId },
    include: {
      invocation: { include: { authoritySnapshot: { include: { binding: true } } } },
      initialEffect: { include: { events: { orderBy: { sequence: 'asc' } } } },
      appeals: {
        include: { resolutionReceipt: true },
        orderBy: { openedAt: 'desc' },
        take: 2,
      },
    },
  });
  if (!receipt || receipt.initialEffect?.id !== member.muteOperationEffectId
    || receipt.invocation?.subjectRef !== `${input.circleId}:${input.walletPubkey}`) {
    throw temporaryMuteError(409, 'communication_member_mute_owner_mismatch');
  }
  const lifecycleCases = await (prisma as any).governanceCase.findMany({
    where: {
      originKind: 'native_invocation',
      originRef: `operation_receipt:${receipt.id}`,
    },
    include: {
      primaryRequest: { include: { decision: true } },
    },
    orderBy: { openedAt: 'desc' },
    take: 4,
  });
  const ratificationCases = lifecycleCases.filter((candidate: any) => (
    communicationMemberMuteRatificationPayload(candidate.requestedActionPayload)
  ));
  if (ratificationCases.length > 1) {
    throw temporaryMuteError(409, 'communication_member_mute_ratification_ambiguous');
  }
  const ratificationCase = ratificationCases[0] ?? null;
  const projected = projectGovernedDirectOperationReceipt(receipt);
  if (receipt.appeals.length > 1) {
    throw temporaryMuteError(409, 'communication_member_mute_appeal_ambiguous');
  }
  const appeal = receipt.appeals[0] ?? null;
  const appealDeadline = new Date(receipt.appealWindowEndsAt);
  const requestedEffect = receipt.invocation.requestedEffect
    && typeof receipt.invocation.requestedEffect === 'object'
    && !Array.isArray(receipt.invocation.requestedEffect)
    ? receipt.invocation.requestedEffect as Record<string, unknown>
    : {};
  if (
    !Number.isFinite(appealDeadline.getTime())
    || requestedEffect.contractVersion !== 'communication-member-temporary-mute-current'
    || !Number.isSafeInteger(Number(requestedEffect.durationSeconds))
    || !Number.isSafeInteger(Number(requestedEffect.maximumDurationSeconds))
    || requestedEffect.automaticExpiry !== 'scheduler_and_read_reconciliation'
    || requestedEffect.appeal !== 'canonical_operation_receipt_window'
  ) {
    throw temporaryMuteError(409, 'communication_member_mute_appeal_policy_mismatch');
  }
  return {
    member: publicCommunicationMemberMuteState(member),
    restriction: {
      type: 'temporary_communication_mute',
      scope: COMMUNICATION_MEMBER_MUTE_SCOPE,
      reasonCode: member.muteReasonCode,
      mutedAt: member.mutedAt?.toISOString?.() ?? null,
      expiresAt: member.muteExpiresAt?.toISOString?.() ?? null,
      noticeAvailableAt: member.muteNoticeAvailableAt?.toISOString?.() ?? null,
      authority: {
        source: 'active_governance_mandate',
        policyVersionRef: projected.policyVersionRef,
        decisionPath: projected.roleAssignmentProof.decisionPath,
        selectorDigest: projected.roleAssignmentProof.selectorDigest,
      },
      receipt: {
        id: projected.id,
        subjectType: projected.subjectType,
        subjectRef: projected.subjectRef,
        policyVersionRef: projected.policyVersionRef,
        reasonCode: projected.reasonCode,
        executionStatus: projected.executionStatus,
        reviewAt: projected.reviewAt,
        appealRef: projected.appealRef,
        appealWindowEndsAt: projected.appealWindowEndsAt,
        receiptDigest: projected.receiptDigest,
      },
      effect: {
        id: receipt.initialEffect.id,
        state: receipt.initialEffect.state,
        events: receipt.initialEffect.events.map((event: any) => ({
          sequence: event.sequence,
          toState: event.toState,
          reasonCode: event.reasonCode,
          occurredAt: event.occurredAt.toISOString(),
        })),
      },
      ratification: ratificationCase
        ? {
            required: true,
            caseId: ratificationCase.id,
            caseUrl: `/governance/cases/${encodeURIComponent(ratificationCase.id)}`,
            deadline: communicationMemberMuteRatificationPayload(
              ratificationCase.requestedActionPayload,
            )?.ratificationDeadline ?? null,
            status: ratificationCase.primaryRequest?.decision?.decision
              ?? (receipt.initialEffect.state === 'ratification_required'
                ? 'pending'
                : receipt.initialEffect.state),
          }
        : { required: false, caseId: null, caseUrl: null, deadline: null, status: 'not_required' },
      appealAccess: {
        access: 'canonical_subject_wallet_session',
        membershipRequired: false,
        grantsOtherCirclePermissions: false,
        resolutionBoundary: GOVERNED_ACTION_APPEAL_NO_AGGRAVATION_BOUNDARY,
        action: 'temporary_communication_mute',
        scope: COMMUNICATION_MEMBER_MUTE_SCOPE,
        publicSafeReason: member.muteReasonCode,
        policy: {
          contractVersion: String(requestedEffect.contractVersion ?? ''),
          durationSeconds: Number(requestedEffect.durationSeconds ?? 0),
          maximumDurationSeconds: Number(requestedEffect.maximumDurationSeconds ?? 0),
          automaticExpiry: String(requestedEffect.automaticExpiry ?? ''),
          appeal: String(requestedEffect.appeal ?? ''),
        },
        deadline: appealDeadline.toISOString(),
        routing: projectGovernedActionAppealRouting({
          actionType: 'communication.member.mute',
          circleId: input.circleId,
          receiptId: projected.id,
          deadline: appealDeadline.toISOString(),
        }),
        reporter: { visibility: 'redacted' },
        evidence: { visibility: 'appellant_and_independent_resolver_only' },
        status: appeal?.state
          ?? (now.getTime() <= appealDeadline.getTime() ? 'available' : 'expired'),
        canSubmit: !appeal && now.getTime() <= appealDeadline.getTime(),
        appeal: appeal ? {
          id: appeal.id,
          state: appeal.state,
          resolutionPath: appeal.resolutionPath,
          governanceCaseRef: appeal.governanceCaseRef,
          governanceCaseUrl: appeal.governanceCaseRef
            ? `/governance/cases/${encodeURIComponent(appeal.governanceCaseRef)}`
            : null,
          appealResolutionArtifactRef: appeal.appealResolutionArtifactRef,
          openedAt: appeal.openedAt.toISOString(),
          resolution: appeal.resolutionReceipt ? {
            outcome: appeal.resolutionReceipt.outcome,
            resolvedAt: appeal.resolutionReceipt.resolvedAt.toISOString(),
          } : null,
        } : null,
      },
    },
  };
}

export interface CommunicationMemberMuteRatificationPayload {
  kind: typeof COMMUNICATION_MEMBER_MUTE_RATIFICATION_KIND;
  currentContract: 'communication-member-temporary-mute-current';
  circleId: number;
  roomKey: string;
  targetMemberPubkey: string;
  subjectRef: string;
  originalInvocationId: string;
  originalReceiptId: string;
  operationEffectId: string;
  originalOperatorPubkey: string;
  ratificationDeadline: string;
  onRejectOrTimeout: 'expire_and_unmute_exact_member';
}

export interface CommunicationMemberMuteAppealPayload {
  kind: typeof COMMUNICATION_MEMBER_MUTE_APPEAL_KIND;
  currentContract: 'communication-member-temporary-mute-current';
  appealId: string;
  circleId: number;
  roomKey: string;
  targetMemberPubkey: string;
  subjectRef: string;
  appealInvocationId: string;
  originalInvocationId: string;
  originalReceiptId: string;
  originalReceiptDigest: string;
  operationEffectId: string;
  originalEffectDigest: string;
  originalOperatorPubkey: string;
  appellantPubkey: string;
  evidenceDigest: string;
  appealWindowEndsAt: string;
  requestedOutcome: 'revoke';
  conflictRule: 'original_executor_and_appellant_excluded';
}

export function communicationMemberMuteAppealPayload(
  value: unknown,
): CommunicationMemberMuteAppealPayload | null {
  const container = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const payload = container.communicationMemberMuteAppeal;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const candidate = payload as Record<string, unknown>;
  const deadline = new Date(String(candidate.appealWindowEndsAt ?? 'invalid'));
  if (
    candidate.kind !== COMMUNICATION_MEMBER_MUTE_APPEAL_KIND
    || candidate.currentContract !== 'communication-member-temporary-mute-current'
    || !Number.isSafeInteger(Number(candidate.circleId))
    || Number(candidate.circleId) <= 0
    || candidate.roomKey !== `circle:${candidate.circleId}`
    || typeof candidate.targetMemberPubkey !== 'string'
    || candidate.targetMemberPubkey.length === 0
    || candidate.subjectRef !== `${candidate.circleId}:${candidate.targetMemberPubkey}`
    || typeof candidate.appealId !== 'string'
    || !candidate.appealId.startsWith('governed-action-appeal:')
    || typeof candidate.appealInvocationId !== 'string'
    || !candidate.appealInvocationId.startsWith('governed-invocation:')
    || typeof candidate.originalInvocationId !== 'string'
    || candidate.originalInvocationId.length === 0
    || typeof candidate.originalReceiptId !== 'string'
    || candidate.originalReceiptId.length === 0
    || !/^[a-f0-9]{64}$/.test(String(candidate.originalReceiptDigest ?? ''))
    || typeof candidate.operationEffectId !== 'string'
    || candidate.operationEffectId.length === 0
    || !/^[a-f0-9]{64}$/.test(String(candidate.originalEffectDigest ?? ''))
    || typeof candidate.originalOperatorPubkey !== 'string'
    || candidate.originalOperatorPubkey.length === 0
    || typeof candidate.appellantPubkey !== 'string'
    || candidate.appellantPubkey !== candidate.targetMemberPubkey
    || candidate.appellantPubkey === candidate.originalOperatorPubkey
    || !/^[a-f0-9]{64}$/.test(String(candidate.evidenceDigest ?? ''))
    || Number.isNaN(deadline.getTime())
    || candidate.requestedOutcome !== 'revoke'
    || candidate.conflictRule !== 'original_executor_and_appellant_excluded'
  ) return null;
  return {
    kind: COMMUNICATION_MEMBER_MUTE_APPEAL_KIND,
    currentContract: 'communication-member-temporary-mute-current',
    appealId: candidate.appealId,
    circleId: Number(candidate.circleId),
    roomKey: String(candidate.roomKey),
    targetMemberPubkey: candidate.targetMemberPubkey,
    subjectRef: String(candidate.subjectRef),
    appealInvocationId: candidate.appealInvocationId,
    originalInvocationId: candidate.originalInvocationId,
    originalReceiptId: candidate.originalReceiptId,
    originalReceiptDigest: String(candidate.originalReceiptDigest),
    operationEffectId: candidate.operationEffectId,
    originalEffectDigest: String(candidate.originalEffectDigest),
    originalOperatorPubkey: candidate.originalOperatorPubkey,
    appellantPubkey: candidate.appellantPubkey,
    evidenceDigest: String(candidate.evidenceDigest),
    appealWindowEndsAt: deadline.toISOString(),
    requestedOutcome: 'revoke',
    conflictRule: 'original_executor_and_appellant_excluded',
  };
}

export function communicationMemberMuteRatificationPayload(
  value: unknown,
): CommunicationMemberMuteRatificationPayload | null {
  const container = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const payload = container.communicationMemberMuteRatification;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const candidate = payload as Record<string, unknown>;
  const deadline = new Date(String(candidate.ratificationDeadline ?? 'invalid'));
  if (
    candidate.kind !== COMMUNICATION_MEMBER_MUTE_RATIFICATION_KIND
    || candidate.currentContract !== 'communication-member-temporary-mute-current'
    || !Number.isSafeInteger(Number(candidate.circleId))
    || Number(candidate.circleId) <= 0
    || typeof candidate.roomKey !== 'string'
    || candidate.roomKey !== `circle:${candidate.circleId}`
    || typeof candidate.targetMemberPubkey !== 'string'
    || candidate.targetMemberPubkey.length === 0
    || candidate.subjectRef !== `${candidate.circleId}:${candidate.targetMemberPubkey}`
    || typeof candidate.originalInvocationId !== 'string'
    || candidate.originalInvocationId.length === 0
    || typeof candidate.originalReceiptId !== 'string'
    || candidate.originalReceiptId.length === 0
    || typeof candidate.operationEffectId !== 'string'
    || candidate.operationEffectId.length === 0
    || typeof candidate.originalOperatorPubkey !== 'string'
    || candidate.originalOperatorPubkey.length === 0
    || Number.isNaN(deadline.getTime())
    || candidate.onRejectOrTimeout !== 'expire_and_unmute_exact_member'
  ) return null;
  return {
    kind: COMMUNICATION_MEMBER_MUTE_RATIFICATION_KIND,
    currentContract: 'communication-member-temporary-mute-current',
    circleId: Number(candidate.circleId),
    roomKey: candidate.roomKey,
    targetMemberPubkey: candidate.targetMemberPubkey,
    subjectRef: String(candidate.subjectRef),
    originalInvocationId: candidate.originalInvocationId,
    originalReceiptId: candidate.originalReceiptId,
    operationEffectId: candidate.operationEffectId,
    originalOperatorPubkey: candidate.originalOperatorPubkey,
    ratificationDeadline: deadline.toISOString(),
    onRejectOrTimeout: 'expire_and_unmute_exact_member',
  };
}

export async function resolveCommunicationMemberMuteRatificationInTransaction(
  tx: any,
  input: {
    governanceCase: any;
    request: any;
    decision: { decision: string; decisionDigest: string };
    now: Date;
  },
): Promise<void> {
  const payload = communicationMemberMuteRatificationPayload(input.request.payload);
  if (!payload) throw temporaryMuteError(409, 'communication_mute_ratification_payload_invalid');
  const deadline = new Date(payload.ratificationDeadline);
  if (
    input.governanceCase.originKind !== 'native_invocation'
    || input.governanceCase.originRef !== `operation_receipt:${payload.originalReceiptId}`
    || input.governanceCase.subjectType !== 'communication_room_member'
    || input.governanceCase.subjectRef !== payload.subjectRef
    || input.request.actionType !== 'communication.member.mute'
    || input.request.targetType !== 'communication_room_member'
    || input.request.targetRef !== payload.subjectRef
    || !(input.request.expiresAt instanceof Date)
    || input.request.expiresAt.getTime() !== deadline.getTime()
  ) throw temporaryMuteError(409, 'communication_mute_ratification_case_mismatch');
  const receipt = await tx.operationReceipt.findUnique({ where: { id: payload.originalReceiptId } });
  const effect = await tx.operationEffect.findUnique({
    where: { id: payload.operationEffectId },
    include: { events: { orderBy: { sequence: 'asc' } } },
  });
  const member = await tx.communicationRoomMember.findUnique({
    where: {
      roomKey_walletPubkey: {
        roomKey: payload.roomKey,
        walletPubkey: payload.targetMemberPubkey,
      },
    },
  });
  if (
    !receipt
    || receipt.invocationId !== payload.originalInvocationId
    || receipt.actorPubkey !== payload.originalOperatorPubkey
    || !effect
    || effect.invocationId !== payload.originalInvocationId
    || effect.initialReceiptId !== payload.originalReceiptId
    || !member
    || member.muteOperationReceiptId !== payload.originalReceiptId
    || member.muteOperationEffectId !== payload.operationEffectId
    || !(member.muteExpiresAt instanceof Date)
    || member.muteExpiresAt.getTime() !== deadline.getTime()
  ) throw temporaryMuteError(409, 'communication_mute_ratification_owner_mismatch');
  const accepted = input.decision.decision === 'accepted' && input.now <= deadline;
  const nextState = accepted
    ? 'active'
    : input.decision.decision === 'expired' || input.now > deadline
      ? 'expired'
      : 'revoked';
  const reasonCode = accepted
    ? 'emergency_communication_mute_ratified'
    : nextState === 'expired'
      ? 'emergency_communication_mute_ratification_expired'
      : 'emergency_communication_mute_ratification_rejected';
  if (effect.state === nextState) {
    const terminalEvent = effect.events.find((event: any) => (
      event.toState === nextState
      && (
        event.reasonCode === reasonCode
        || (nextState === 'expired'
          && event.reasonCode === 'temporary_communication_mute_expired')
      )
    ));
    if (!terminalEvent || (accepted ? member.muted !== true : member.muted !== false)) {
      throw temporaryMuteError(409, 'communication_mute_ratification_replay_mismatch');
    }
    return;
  }
  if (effect.state !== 'ratification_required') {
    throw temporaryMuteError(409, 'communication_mute_ratification_effect_unavailable');
  }
  if (member.muted !== true) {
    throw temporaryMuteError(409, 'communication_mute_ratification_member_unavailable');
  }
  await transitionOperationEffectInTransaction(tx, {
    effectId: effect.id,
    nextState,
    reasonCode,
    actorPubkey: null,
    sourceReceiptId: null,
    occurredAt: input.now,
  });
  if (!accepted) {
    const released = await releaseCommunicationMuteForTerminalEffectInTransaction(tx, {
      effectId: effect.id,
    });
    if (released !== 1) {
      throw temporaryMuteError(409, 'communication_mute_ratification_release_failed');
    }
  }
}

export async function resolveCommunicationMemberMuteAppealInTransaction(
  tx: any,
  input: {
    governanceCase: any;
    request: any;
    decision: { decision: string; decisionDigest: string };
    now: Date;
  },
): Promise<CommunicationMemberMuteAppealEffectResult> {
  const payload = communicationMemberMuteAppealPayload(input.request.payload);
  if (!payload) throw temporaryMuteError(409, 'communication_mute_appeal_payload_invalid');
  if (
    input.governanceCase.originKind !== 'native_invocation'
    || input.governanceCase.originRef !== `operation_receipt:${payload.originalReceiptId}`
    || input.governanceCase.invocationId !== payload.originalInvocationId
    || input.governanceCase.subjectType !== 'communication_room_member'
    || input.governanceCase.subjectRef !== payload.subjectRef
    || input.request.actionType !== 'communication.member.mute'
    || input.request.targetType !== 'communication_room_member'
    || input.request.targetRef !== payload.subjectRef
    || !['accepted', 'rejected', 'expired', 'cancelled'].includes(input.decision.decision)
  ) throw temporaryMuteError(409, 'communication_mute_appeal_case_mismatch');
  const appeal = await tx.governedActionAppeal.findUnique({
    where: { id: payload.appealId },
  });
  const receipt = await tx.operationReceipt.findUnique({ where: { id: payload.originalReceiptId } });
  const effect = await tx.operationEffect.findUnique({ where: { id: payload.operationEffectId } });
  const member = await tx.communicationRoomMember.findUnique({
    where: {
      roomKey_walletPubkey: {
        roomKey: payload.roomKey,
        walletPubkey: payload.targetMemberPubkey,
      },
    },
  });
  if (
    !appeal
    || appeal.appealInvocationId !== payload.appealInvocationId
    || appeal.originalInvocationId !== payload.originalInvocationId
    || appeal.originalReceiptId !== payload.originalReceiptId
    || appeal.appellantPubkey !== payload.appellantPubkey
    || appeal.evidenceDigest !== payload.evidenceDigest
    || appeal.resolutionPath !== 'governance_case_appeal_resolution'
    || appeal.governanceCaseRef !== input.governanceCase.id
    || !receipt
    || receipt.invocationId !== payload.originalInvocationId
    || receipt.actorPubkey !== payload.originalOperatorPubkey
    || receipt.receiptDigest !== payload.originalReceiptDigest
    || !effect
    || effect.invocationId !== payload.originalInvocationId
    || effect.initialReceiptId !== payload.originalReceiptId
    || effect.effectDigest !== payload.originalEffectDigest
    || !member
    || member.muteOperationReceiptId !== payload.originalReceiptId
    || member.muteOperationEffectId !== payload.operationEffectId
  ) throw temporaryMuteError(409, 'communication_mute_appeal_owner_mismatch');
  const artifactId = `decision-output:${input.decision.decisionDigest}`;
  if (appeal.state === 'resolved') {
    if (
      appeal.appealResolutionArtifactRef !== artifactId
      || !(appeal.resolvedAt instanceof Date)
    ) throw temporaryMuteError(409, 'communication_mute_appeal_replay_mismatch');
    const artifact = await tx.decisionOutputArtifact.findUnique({ where: { id: artifactId } });
    const resolution = artifact?.constraints?.appealResolution;
    if (
      artifact?.kind !== 'appeal_resolution'
      || resolution?.domain !== 'communication_member_mute'
      || !['active', 'expired', 'revoked', 'superseded', 'ratification_required', 'rollback_failed'].includes(
        String(resolution.resultingEffectState),
      )
      || !['applied', 'preserved'].includes(String(resolution.effectStatus))
    ) throw temporaryMuteError(409, 'communication_mute_appeal_replay_artifact_invalid');
    return {
      artifactId,
      resultingEffectState: String(resolution.resultingEffectState),
      effectApplied: resolution.effectStatus === 'applied',
    };
  }
  const accepted = input.decision.decision === 'accepted';
  if (
    accepted
    && !['active', 'ratification_required', 'expired', 'revoked', 'superseded'].includes(effect.state)
  ) {
    throw temporaryMuteError(409, 'communication_mute_appeal_effect_unavailable');
  }
  let effectApplied = false;
  let resultingEffectState = String(effect.state);
  if (accepted && ['active', 'ratification_required'].includes(effect.state)) {
    await transitionOperationEffectInTransaction(tx, {
      effectId: effect.id,
      nextState: 'revoked',
      reasonCode: 'governance_appeal_revoke',
      actorPubkey: null,
      sourceReceiptId: null,
      occurredAt: input.now,
    });
    const released = await releaseCommunicationMuteForTerminalEffectInTransaction(tx, {
      effectId: effect.id,
    });
    if (released !== 1) {
      throw temporaryMuteError(409, 'communication_mute_appeal_release_failed');
    }
    effectApplied = true;
    resultingEffectState = 'revoked';
  } else if (accepted && member.muted === true) {
    throw temporaryMuteError(409, 'communication_mute_appeal_replay_mismatch');
  }
  const nextAppealState = 'resolved';
  if (appeal.state === nextAppealState) {
    if (
      appeal.appealResolutionArtifactRef !== artifactId
      || !(appeal.resolvedAt instanceof Date)
    ) throw temporaryMuteError(409, 'communication_mute_appeal_replay_mismatch');
  } else {
    const updated = await tx.governedActionAppeal.updateMany({
      where: {
        id: appeal.id,
        state: 'governance_case_pending',
        governanceCaseRef: input.governanceCase.id,
        resolvedAt: null,
      },
      data: {
        state: nextAppealState,
        appealResolutionArtifactRef: artifactId,
        resolvedAt: input.now,
      },
    });
    if (updated.count !== 1) {
      throw temporaryMuteError(409, 'communication_mute_appeal_resolution_cas_failed');
    }
  }
  return {
    artifactId,
    resultingEffectState,
    effectApplied,
  };
}

export interface CommunicationMemberMuteAppealEffectResult {
  artifactId: string;
  resultingEffectState: string;
  effectApplied: boolean;
}

export function publicCommunicationMemberMuteState(member: any) {
  return {
    roomKey: String(member.roomKey),
    walletPubkey: String(member.walletPubkey),
    role: String(member.role),
    canSpeak: member.canSpeak === true,
    muted: member.muted === true,
    banned: member.banned === true,
    joinedAt: member.joinedAt instanceof Date ? member.joinedAt.toISOString() : null,
    leftAt: member.leftAt instanceof Date ? member.leftAt.toISOString() : null,
    scope: COMMUNICATION_MEMBER_MUTE_SCOPE,
    mutedAt: member.mutedAt instanceof Date ? member.mutedAt.toISOString() : null,
    muteExpiresAt: member.muteExpiresAt instanceof Date ? member.muteExpiresAt.toISOString() : null,
    muteNoticeAvailableAt: member.muteNoticeAvailableAt instanceof Date
      ? member.muteNoticeAvailableAt.toISOString()
      : null,
  };
}

function temporaryMuteError(statusCode: number, code: string): Error {
  return Object.assign(new Error(code), { statusCode });
}
