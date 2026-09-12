import type { PrismaClient } from '@prisma/client';

import { projectGovernedDirectOperationReceipt } from './governedActionGateway';
import {
  GOVERNED_ACTION_APPEAL_NO_AGGRAVATION_BOUNDARY,
  projectGovernedActionAppealRouting,
} from './governedActionAppeal';
import { transitionOperationEffectInTransaction } from './operationEffectLifecycle';

export const COMMUNICATION_MESSAGE_HIDE_MIN_DURATION_SECONDS = 5 * 60;
export const COMMUNICATION_MESSAGE_HIDE_MAX_DURATION_SECONDS = 24 * 60 * 60;
export const COMMUNICATION_MESSAGE_HIDE_SCOPE = 'circle_room_member_read_surface';

export function resolveCommunicationMessageHideContract(input: {
  durationSeconds: number;
  now: Date;
  expiresAt?: Date;
}) {
  if (!Number.isSafeInteger(input.durationSeconds)
    || input.durationSeconds < COMMUNICATION_MESSAGE_HIDE_MIN_DURATION_SECONDS
    || input.durationSeconds > COMMUNICATION_MESSAGE_HIDE_MAX_DURATION_SECONDS) {
    throw hideError(400, 'operator_message_hide_duration_invalid');
  }
  const expiresAt = input.expiresAt
    ?? new Date(input.now.getTime() + input.durationSeconds * 1000);
  if (!Number.isFinite(expiresAt.getTime())) {
    throw hideError(400, 'operator_message_hide_expiry_invalid');
  }
  return {
    contractVersion: 'communication-message-hide-current',
    durationSeconds: input.durationSeconds,
    maximumDurationSeconds: COMMUNICATION_MESSAGE_HIDE_MAX_DURATION_SECONDS,
    expiresAt,
    scope: COMMUNICATION_MESSAGE_HIDE_SCOPE,
    publicProjection: 'redacted_while_hidden',
    restore: 'scheduler_and_read_reconciliation',
    notification: 'subject_notification_and_canonical_state_readback',
    appeal: 'canonical_operation_receipt_window',
    delete: 'forbidden_separate_high_risk_retention_contract',
  } as const;
}

export function publicCommunicationMessageHideState(message: any) {
  return {
    envelopeId: String(message.envelopeId),
    roomKey: String(message.roomKey),
    hidden: message.hidden === true,
    hiddenAt: message.hiddenAt instanceof Date ? message.hiddenAt.toISOString() : null,
    hideExpiresAt: message.hideExpiresAt instanceof Date
      ? message.hideExpiresAt.toISOString()
      : null,
    reasonCode: message.hideReasonCode == null ? null : String(message.hideReasonCode),
    evidenceDigest: message.hideEvidenceDigest == null
      ? null
      : String(message.hideEvidenceDigest),
    deleted: message.deleted === true,
  };
}

export async function linkCommunicationMessageHideInTransaction(
  tx: any,
  input: {
    circleId: number;
    envelopeId: string;
    hiddenAt: Date;
    expiresAt: Date;
    reasonCode: string;
    evidenceDigest: string;
    receipt: { id: string; invocationId: string };
    replayed: boolean;
  },
) {
  const effect = await tx.operationEffect.findUnique({
    where: { invocationId: input.receipt.invocationId },
  });
  if (!effect || effect.initialReceiptId !== input.receipt.id
    || !['active', 'expired', 'revoked'].includes(effect.state)) {
    throw hideError(409, 'operator_message_hide_effect_readback_mismatch');
  }
  const expectedHidden = effect.state === 'active';
  const current = await tx.communicationMessage.findUnique({
    where: { envelopeId: input.envelopeId },
  });
  if (!current || current.deleted === true || current.hidden !== expectedHidden) {
    throw hideError(409, 'operator_message_hide_readback_mismatch');
  }
  if (input.replayed) {
    if (current.hideOperationReceiptId !== input.receipt.id
      || current.hideOperationEffectId !== effect.id
      || current.hideReasonCode !== input.reasonCode
      || current.hideEvidenceDigest !== input.evidenceDigest
      || !(current.hideExpiresAt instanceof Date)
      || current.hideExpiresAt.getTime() !== input.expiresAt.getTime()) {
      throw hideError(409, 'operator_message_hide_replay_mismatch');
    }
    return current;
  }
  if (!expectedHidden) throw hideError(409, 'operator_message_hide_terminal_state_not_executable');
  const updated = await tx.communicationMessage.updateMany({
    where: {
      envelopeId: input.envelopeId,
      hidden: true,
      deleted: false,
      hiddenAt: input.hiddenAt,
      hideExpiresAt: input.expiresAt,
      hideReasonCode: input.reasonCode,
      hideEvidenceDigest: input.evidenceDigest,
    },
    data: {
      hideOperationReceiptId: input.receipt.id,
      hideOperationEffectId: effect.id,
      hideReasonCode: input.reasonCode,
      hideEvidenceDigest: input.evidenceDigest,
    },
  });
  if (updated.count !== 1) throw hideError(409, 'operator_message_hide_link_cas_failed');
  const durable = await tx.communicationMessage.findUniqueOrThrow({
    where: { envelopeId: input.envelopeId },
  });
  const subject = await tx.user.findUnique({
    where: { pubkey: durable.senderPubkey },
    select: { id: true },
  });
  if (subject) {
    await tx.notification.create({
      data: {
        userId: subject.id,
        type: 'governance_moderation',
        title: 'A message is temporarily hidden',
        body: `This message returns to member read surfaces at ${input.expiresAt.toISOString()}.`,
        sourceType: 'operation_receipt',
        sourceId: input.receipt.id,
        circleId: input.circleId,
        createdAt: input.hiddenAt,
        metadata: {
          schemaVersion: 1,
          canonicalUrl: `/governance/moderation/${input.circleId}?message=${encodeURIComponent(input.envelopeId)}`,
          receiptId: input.receipt.id,
          envelopeId: input.envelopeId,
          scope: COMMUNICATION_MESSAGE_HIDE_SCOPE,
          expiresAt: input.expiresAt.toISOString(),
          publicProjection: 'redacted_while_hidden',
          delete: 'not_executed',
        },
      },
    });
  }
  return durable;
}

async function reconcileOneMessageHide(
  tx: any,
  input: { envelopeId: string; effectId: string; expiresAt: Date; now: Date },
) {
  const message = await tx.communicationMessage.findUnique({
    where: { envelopeId: input.envelopeId },
  });
  if (!message || message.hidden !== true || message.hideOperationEffectId !== input.effectId
    || !(message.hideExpiresAt instanceof Date)
    || message.hideExpiresAt.getTime() !== input.expiresAt.getTime()
    || message.hideExpiresAt > input.now) return 'stale';
  const effect = await tx.operationEffect.findUnique({ where: { id: input.effectId } });
  if (!effect) throw new Error('communication_message_hide_effect_missing');
  if (effect.state === 'active') {
    await transitionOperationEffectInTransaction(tx, {
      effectId: effect.id,
      nextState: 'expired',
      reasonCode: 'temporary_communication_message_hide_expired',
      actorPubkey: null,
      sourceReceiptId: null,
      occurredAt: input.now,
    });
  } else if (!['expired', 'revoked'].includes(effect.state)) {
    throw new Error('communication_message_hide_effect_not_releasable');
  }
  const restored = await tx.communicationMessage.updateMany({
    where: { envelopeId: input.envelopeId, hidden: true, hideOperationEffectId: effect.id },
    data: { hidden: false },
  });
  if (restored.count !== 1) throw new Error('communication_message_hide_restore_cas_failed');
  return effect.state === 'active' ? 'expired' : 'already_terminal';
}

export async function reconcileExpiredCommunicationMessageHides(
  prisma: any,
  input: {
    now?: Date;
    limit?: number;
    envelopeId?: string;
    roomKey?: string;
    senderPubkey?: string;
  } = {},
) {
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
  const candidates = await prisma.communicationMessage.findMany({
    where: {
      hidden: true,
      hideExpiresAt: { lte: now },
      hideOperationEffectId: { not: null },
      ...(input.envelopeId ? { envelopeId: input.envelopeId } : {}),
      ...(input.roomKey ? { roomKey: input.roomKey } : {}),
      ...(input.senderPubkey ? { senderPubkey: input.senderPubkey } : {}),
    },
    select: { envelopeId: true, hideExpiresAt: true, hideOperationEffectId: true },
    orderBy: [{ hideExpiresAt: 'asc' }, { envelopeId: 'asc' }],
    take: limit,
  });
  const restored: string[] = [];
  const failures: Array<{ envelopeId: string; error: string }> = [];
  for (const candidate of candidates) {
    try {
      const result = await prisma.$transaction((tx: any) => reconcileOneMessageHide(tx, {
        envelopeId: candidate.envelopeId,
        effectId: candidate.hideOperationEffectId,
        expiresAt: candidate.hideExpiresAt,
        now,
      }));
      if (result !== 'stale') restored.push(candidate.envelopeId);
    } catch (error) {
      failures.push({
        envelopeId: candidate.envelopeId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { scanned: candidates.length, restored, failures };
}

export async function readCommunicationMessageHideState(
  prisma: PrismaClient,
  input: {
    circleId: number;
    envelopeId: string;
    audiencePubkey: string;
    canModerate: boolean;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  await reconcileExpiredCommunicationMessageHides(prisma as any, {
    now,
    limit: 1,
    envelopeId: input.envelopeId,
  });
  const message = await (prisma as any).communicationMessage.findUnique({
    where: { envelopeId: input.envelopeId },
  });
  if (!message || message.roomKey !== `circle:${input.circleId}`) {
    throw hideError(404, 'communication_message_not_found');
  }
  if (message.senderPubkey !== input.audiencePubkey && !input.canModerate) {
    throw hideError(403, 'communication_message_hide_readback_forbidden');
  }
  if (!message.hideOperationReceiptId || !message.hideOperationEffectId) {
    return { message: publicCommunicationMessageHideState(message), restriction: null };
  }
  const receipt = await (prisma as any).operationReceipt.findUnique({
    where: { id: message.hideOperationReceiptId },
    include: {
      invocation: {
        include: {
          contractVersion: true,
          authoritySnapshot: { include: { binding: true } },
        },
      },
      initialEffect: { include: { events: { orderBy: { sequence: 'asc' } } } },
      appeals: {
        include: { resolutionReceipt: true },
        orderBy: { openedAt: 'desc' },
        take: 2,
      },
    },
  });
  if (!receipt || receipt.initialEffect?.id !== message.hideOperationEffectId
    || receipt.invocation?.contractVersion?.actionType !== 'communication.message.hide'
    || receipt.invocation?.subjectType !== 'communication_message'
    || receipt.invocation?.subjectRef !== `${input.circleId}:${input.envelopeId}`) {
    throw hideError(409, 'communication_message_hide_owner_mismatch');
  }
  if (!(message.hiddenAt instanceof Date) || !(message.hideExpiresAt instanceof Date)) {
    throw hideError(409, 'communication_message_hide_lifecycle_timestamp_mismatch');
  }
  const projected = projectGovernedDirectOperationReceipt(receipt);
  if (receipt.appeals.length > 1) {
    throw hideError(409, 'communication_message_hide_appeal_ambiguous');
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
    || requestedEffect.contractVersion !== 'communication-message-hide-current'
    || requestedEffect.roomKey !== `circle:${input.circleId}`
    || requestedEffect.envelopeId !== input.envelopeId
    || requestedEffect.targetMemberPubkey !== message.senderPubkey
    || requestedEffect.notification !== 'subject_notification_and_canonical_state_readback'
    || requestedEffect.appeal !== 'canonical_operation_receipt_window'
  ) {
    throw hideError(409, 'communication_message_hide_appeal_policy_mismatch');
  }
  if (appeal && appeal.appellantPubkey !== message.senderPubkey) {
    throw hideError(409, 'communication_message_hide_appeal_subject_mismatch');
  }
  const isSubject = message.senderPubkey === input.audiencePubkey;
  return {
    message: publicCommunicationMessageHideState(message),
    restriction: {
      type: 'temporary_communication_message_hide',
      scope: COMMUNICATION_MESSAGE_HIDE_SCOPE,
      reasonCode: message.hideReasonCode,
      expiresAt: message.hideExpiresAt.toISOString(),
      noticeAvailableAt: message.hiddenAt.toISOString(),
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
          fromState: event.fromState,
          toState: event.toState,
          reasonCode: event.reasonCode,
          occurredAt: event.occurredAt.toISOString(),
        })),
      },
      evidenceDigest: message.hideEvidenceDigest,
      publicProjection: 'redacted_while_hidden',
      delete: 'not_executed',
      appealAccess: {
        access: 'canonical_subject_wallet_session',
        membershipRequired: false,
        grantsOtherCirclePermissions: false,
        resolutionBoundary: GOVERNED_ACTION_APPEAL_NO_AGGRAVATION_BOUNDARY,
        action: 'temporary_communication_message_hide',
        scope: COMMUNICATION_MESSAGE_HIDE_SCOPE,
        publicSafeReason: message.hideReasonCode,
        policy: {
          contractVersion: String(requestedEffect.contractVersion ?? ''),
          durationSeconds: Number(requestedEffect.durationSeconds ?? 0),
          maximumDurationSeconds: Number(requestedEffect.maximumDurationSeconds ?? 0),
          restore: String(requestedEffect.restore ?? ''),
          notification: String(requestedEffect.notification ?? ''),
          appeal: String(requestedEffect.appeal ?? ''),
          delete: String(requestedEffect.delete ?? ''),
        },
        deadline: appealDeadline.toISOString(),
        routing: projectGovernedActionAppealRouting({
          actionType: 'communication.message.hide',
          circleId: input.circleId,
          receiptId: projected.id,
          deadline: appealDeadline.toISOString(),
        }),
        reporter: { visibility: 'redacted' },
        evidence: { visibility: 'appellant_and_independent_resolver_only' },
        status: appeal?.state
          ?? (now.getTime() <= appealDeadline.getTime() ? 'available' : 'expired'),
        canSubmit: isSubject && !appeal && now.getTime() <= appealDeadline.getTime(),
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

function hideError(statusCode: number, code: string): Error & { statusCode: number } {
  return Object.assign(new Error(code), { statusCode });
}
