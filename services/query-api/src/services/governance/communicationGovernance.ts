import { createHash } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import {
  applyCircleRoomVoicePolicy,
  normalizeCircleRoomVoicePolicyPatch,
} from "../communication/circleRoom";
import { createGovernedActionRegistry } from "./actionRegistry";
import {
  listCommitteeEligibleActors,
  resolveActiveCircleGovernanceBinding,
} from "./circleGovernanceBindings";
import { GovernedActionGateway } from "./governedActionGateway";
import { createPrismaGovernanceRequestStore } from "./policyEngine";
import { canonicalSolanaPublicKeyString } from "../identity/solanaPublicKey";
import {
  COMMUNICATION_MEMBER_MUTE_APPEAL_KIND,
  COMMUNICATION_MEMBER_MUTE_RATIFICATION_KIND,
  communicationMemberMuteRatificationPayload,
  type CommunicationMemberMuteReviewTiming,
  linkTemporaryCommunicationMuteInTransaction,
  publicCommunicationMemberMuteState,
  resolveTemporaryCommunicationMuteContract,
} from './communicationMemberMuteLifecycle';
import { hashCanonicalGovernanceValue } from './canonicalCodec';
import { createGovernanceCaseIntake } from './governanceCase';
import { isGovernanceCommitteeOperator } from './circleCommitteeActors';
import { transitionOperationEffectInTransaction } from './operationEffectLifecycle';
import { openGovernedActionAppeal } from './governedActionAppeal';
import {
  linkCommunicationMessageHideInTransaction,
  publicCommunicationMessageHideState,
  resolveCommunicationMessageHideContract,
} from './communicationMessageHideLifecycle';
import { ensureCommunicationOperationRecurrenceReviewCase } from './communicationOperationEscalation';

export const COMMUNICATION_VOICE_POLICY_UPDATE_ACTION_TYPE =
  "communication.voice_policy.update";
export const COMMUNICATION_MEMBER_MUTE_ACTION_TYPE = "communication.member.mute";
export const COMMUNICATION_MESSAGE_HIDE_ACTION_TYPE = "communication.message.hide";

export async function openCommunicationRestrictionAppeal(
  prisma: PrismaClient,
  input: {
    circleId: number;
    originalReceiptId: string;
    appellantPubkey: string;
    reasonCode: string;
    evidence: Record<string, unknown>;
    now?: Date;
  },
) {
  if (!Number.isSafeInteger(input.circleId) || input.circleId <= 0) {
    throw operationalError(400, 'invalid_circle_id');
  }
  const appellantPubkey = canonicalSolanaPublicKeyString(input.appellantPubkey);
  if (!appellantPubkey || appellantPubkey !== input.appellantPubkey) {
    throw operationalError(400, 'governed_action_appeal_appellant_invalid');
  }
  return (prisma as any).$transaction(async (tx: any) => {
    const receipt = await tx.operationReceipt.findUnique({
      where: { id: input.originalReceiptId },
      include: {
        invocation: { include: { contractVersion: true } },
        initialEffect: true,
      },
    });
    const invocation = receipt?.invocation;
    const requestedEffect = invocation?.requestedEffect
      && typeof invocation.requestedEffect === 'object'
      && !Array.isArray(invocation.requestedEffect)
      ? invocation.requestedEffect as Record<string, unknown>
      : null;
    const actionType = invocation?.contractVersion?.actionType;
    const isMemberMute = actionType === COMMUNICATION_MEMBER_MUTE_ACTION_TYPE;
    const isMessageHide = actionType === COMMUNICATION_MESSAGE_HIDE_ACTION_TYPE;
    const expectedSubjectRef = isMemberMute
      ? `${input.circleId}:${appellantPubkey}`
      : `${input.circleId}:${String(requestedEffect?.envelopeId ?? '')}`;
    if (
      !receipt
      || receipt.executionStatus !== 'succeeded'
      || !receipt.initialEffect
      || (!isMemberMute && !isMessageHide)
      || invocation.governanceHomeType !== 'circle'
      || invocation.governanceHomeRef !== String(input.circleId)
      || invocation.subjectType !== (isMemberMute ? 'communication_room_member' : 'communication_message')
      || invocation.subjectRef !== expectedSubjectRef
      || requestedEffect?.roomKey !== `circle:${input.circleId}`
      || requestedEffect?.targetMemberPubkey !== appellantPubkey
      || (isMessageHide && !String(requestedEffect?.envelopeId ?? ''))
    ) {
      throw operationalError(403, 'governed_action_appeal_appellant_not_subject');
    }
    const opened = await openGovernedActionAppeal(tx, {
      originalReceiptId: receipt.id,
      appellantPubkey,
      reasonCode: input.reasonCode,
      evidence: input.evidence,
      now: input.now,
    });
    if (
      opened.appeal.resolutionPath !== 'governance_case_appeal_resolution'
      || opened.appeal.governanceCaseRef
    ) return opened;
    if (!isMemberMute) return opened;
    const now = input.now ?? new Date();
    const subjectRef = expectedSubjectRef;
    const collectiveAuthority = await resolveActiveCircleGovernanceBinding(tx, {
      targetCircleId: input.circleId,
      actionType: COMMUNICATION_MEMBER_MUTE_ACTION_TYPE,
      purpose: 'collective_decision',
      now,
      subjectType: 'communication_room_member',
      subjectRef,
    });
    if (!collectiveAuthority) return opened;
    const eligibleActors = await listCommitteeEligibleActors(tx, {
      committeeCircleId: collectiveAuthority.binding.committeeCircleId,
    });
    const independentActors = eligibleActors.filter((candidate: any) => (
      candidate.pubkey !== receipt.actorPubkey
      && candidate.pubkey !== appellantPubkey
    ));
    const coordinator = independentActors.find(isGovernanceCommitteeOperator);
    if (!coordinator) return opened;
    const appeal = await tx.governedActionAppeal.findUnique({
      where: { id: opened.appeal.id },
    });
    if (!appeal || !receipt.initialEffect) {
      throw operationalError(409, 'governed_action_appeal_owner_required');
    }
    const appealPayload = {
      kind: COMMUNICATION_MEMBER_MUTE_APPEAL_KIND,
      currentContract: 'communication-member-temporary-mute-current',
      appealId: appeal.id,
      circleId: input.circleId,
      roomKey: `circle:${input.circleId}`,
      targetMemberPubkey: appellantPubkey,
      subjectRef,
      appealInvocationId: appeal.appealInvocationId,
      originalInvocationId: receipt.invocationId,
      originalReceiptId: receipt.id,
      originalReceiptDigest: receipt.receiptDigest,
      operationEffectId: receipt.initialEffect.id,
      originalEffectDigest: receipt.initialEffect.effectDigest,
      originalOperatorPubkey: receipt.actorPubkey,
      appellantPubkey,
      evidenceDigest: appeal.evidenceDigest,
      appealWindowEndsAt: new Date(appeal.appealWindowEndsAt).toISOString(),
      requestedOutcome: 'revoke',
      conflictRule: 'original_executor_and_appellant_excluded',
    } as const;
    const created = await createGovernanceCaseIntake(tx, {
      circleId: input.circleId,
      title: 'Resolve temporary communication restriction appeal',
      requestedDecision: 'Should the independent eligible electorate revoke this exact temporary communication mute based on the frozen private appeal evidence?',
      requestedActionPayload: { communicationMemberMuteAppeal: appealPayload },
      caseType: 'policy',
      templateId: 'basic-community',
      actionType: COMMUNICATION_MEMBER_MUTE_ACTION_TYPE,
      subjectType: 'communication_room_member',
      subjectRef,
      authorityBindingId: collectiveAuthority.binding.id,
      authorityResolution: collectiveAuthority,
      decisionMechanismKind: 'equal_weight_threshold',
      originKind: 'native_invocation',
      sourceInvocationId: receipt.invocationId,
      sourceReceiptId: receipt.id,
      sourceMessageIds: [],
      idempotencyKey: `operation-appeal:${appeal.id}`,
      openedByPubkey: coordinator.pubkey,
      actorRole: String(coordinator.role),
      openedAt: now,
    });
    const bound = await tx.governedActionAppeal.updateMany({
      where: {
        id: appeal.id,
        state: 'blocked_no_independent_authority',
        governanceCaseRef: null,
        appealResolutionArtifactRef: null,
      },
      data: {
        state: 'governance_case_pending',
        governanceCaseRef: created.governanceCase.id,
      },
    });
    if (bound.count !== 1) {
      const current = await tx.governedActionAppeal.findUnique({ where: { id: appeal.id } });
      if (
        current?.state !== 'governance_case_pending'
        || current?.governanceCaseRef !== created.governanceCase.id
      ) throw operationalError(409, 'governed_action_appeal_case_binding_conflict');
    }
    return {
      appeal: {
        ...opened.appeal,
        state: 'governance_case_pending',
        governanceCaseRef: created.governanceCase.id,
      },
      replayed: opened.replayed,
    };
  });
}

export async function executeSharedCommitteeMemberMute(
  prisma: PrismaClient,
  input: {
    circleId: number;
    actorPubkey: string;
    targetMemberPubkey: string;
    muted: boolean;
    durationSeconds: number;
    reviewTiming: CommunicationMemberMuteReviewTiming;
    reasonCode: string;
    idempotencyKey: string;
  },
) {
  const actorPubkey = canonicalSolanaPublicKeyString(input.actorPubkey);
  const targetMemberPubkey = canonicalSolanaPublicKeyString(input.targetMemberPubkey);
  if (!Number.isSafeInteger(input.circleId) || input.circleId <= 0) {
    throw operationalError(400, "invalid_circle_id");
  }
  if (!actorPubkey || !targetMemberPubkey) {
    throw operationalError(400, "invalid_operator_mute_pubkey");
  }
  if (input.muted !== true) {
    throw operationalError(400, "operator_capability_only_allows_mute");
  }
  const reasonCode = input.reasonCode.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  if (!reasonCode || reasonCode.length > 96) {
    throw operationalError(400, "invalid_operator_mute_reason");
  }
  if (input.reviewTiming === 'post_execution_ratification'
    && reasonCode !== 'credible_safety_risk') {
    throw operationalError(400, 'operator_emergency_mute_reason_required');
  }
  if (!idempotencyKey || idempotencyKey.length > 128) {
    throw operationalError(400, "invalid_operator_mute_idempotency_key");
  }

  const roomKey = `circle:${input.circleId}`;
  const targetRef = `${input.circleId}:${targetMemberPubkey}`;
  const run = async (tx: PrismaClient) => {
    const now = new Date();
    await (tx as any).$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      `communication-member-mute:${input.circleId}:${targetMemberPubkey}`,
    );
    const room = await tx.communicationRoom.findUnique({ where: { roomKey } });
    if (!room || room.roomType !== "circle" || room.parentCircleId !== input.circleId) {
      throw operationalError(404, "operator_mute_target_room_not_found");
    }
    const member = await tx.communicationRoomMember.findUnique({
      where: { roomKey_walletPubkey: { roomKey, walletPubkey: targetMemberPubkey } },
    });
    if (!member || member.leftAt != null) {
      throw operationalError(404, "operator_mute_target_member_not_active");
    }
    const existingInvocation = await (tx as any).governedActionInvocation.findFirst({
      where: {
        actorPubkey,
        subjectType: 'communication_room_member',
        subjectRef: targetRef,
        idempotencyKey,
        contractVersion: { actionType: COMMUNICATION_MEMBER_MUTE_ACTION_TYPE },
      },
      orderBy: { createdAt: 'desc' },
    });
    const requestedEffect = existingInvocation?.requestedEffect
      && typeof existingInvocation.requestedEffect === 'object'
      && !Array.isArray(existingInvocation.requestedEffect)
      ? existingInvocation.requestedEffect as Record<string, unknown>
      : null;
    if (existingInvocation && (
      requestedEffect?.contractVersion !== 'communication-member-temporary-mute-current'
      || Number(requestedEffect.durationSeconds) !== input.durationSeconds
      || requestedEffect.reviewTiming !== input.reviewTiming
      || requestedEffect.roomKey !== roomKey
      || requestedEffect.targetMemberPubkey !== targetMemberPubkey
      || existingInvocation.reasonDigest !== hashCanonicalGovernanceValue(
        'alcheme.governance.action-reason',
        { reasonCode },
      )
    )) {
      throw operationalError(409, 'operator_mute_idempotency_conflict');
    }
    const frozenExpiry = requestedEffect?.expiresAt == null
      ? undefined
      : new Date(String(requestedEffect.expiresAt));
    const temporaryContract = resolveTemporaryCommunicationMuteContract({
      durationSeconds: input.durationSeconds,
      now,
      reviewTiming: input.reviewTiming,
      ...(frozenExpiry ? { expiresAt: frozenExpiry } : {}),
    });
    const payload = {
      roomKey,
      targetMemberPubkey,
      muted: true,
      contractVersion: temporaryContract.contractVersion,
      durationSeconds: temporaryContract.durationSeconds,
      maximumDurationSeconds: temporaryContract.maximumDurationSeconds,
      expiresAt: temporaryContract.expiresAt.toISOString(),
      automaticExpiry: temporaryContract.automaticExpiry,
      notification: temporaryContract.notification,
      reviewTiming: temporaryContract.reviewTiming,
      ratification: temporaryContract.ratification,
      appeal: temporaryContract.appeal,
      rollback: temporaryContract.rollback,
      scope: temporaryContract.scope,
    };
    const registry = createGovernedActionRegistry({
      includePhase1Defaults: true,
      includeCommunicationActions: true,
    });
    const gateway = new GovernedActionGateway({
      registry,
      resolveBinding: (bindingInput) =>
        resolveActiveCircleGovernanceBinding(tx as any, bindingInput),
      listCommitteeEligibleActors: (eligibleInput) =>
        listCommitteeEligibleActors(tx as any, eligibleInput),
      requestStore: createPrismaGovernanceRequestStore(tx as any),
      runtimePrisma: tx as any,
      runtimeTransactionClient: true,
      now: () => now,
    });
    const outcome = await gateway.executeSharedCommitteeOperation({
      actionType: COMMUNICATION_MEMBER_MUTE_ACTION_TYPE,
      targetCircleId: input.circleId,
      targetType: "communication_room_member",
      targetRef,
      actorPubkey,
      payload,
      reasonCode,
      idempotencyKey,
      execute: async () => {
        const updated = await tx.communicationRoomMember.updateMany({
          where: {
            roomKey,
            walletPubkey: targetMemberPubkey,
            leftAt: null,
            muted: false,
          },
          data: {
            muted: true,
            mutedAt: now,
            muteExpiresAt: temporaryContract.expiresAt,
            muteReasonCode: reasonCode,
          },
        });
        if (updated.count !== 1) {
          throw operationalError(409, "operator_mute_target_member_changed");
        }
        const readback = await tx.communicationRoomMember.findUnique({
          where: { roomKey_walletPubkey: { roomKey, walletPubkey: targetMemberPubkey } },
        });
        if (!readback || readback.muted !== true || readback.leftAt != null) {
          throw operationalError(409, "operator_mute_readback_mismatch");
        }
        return {
          result: publicCommunicationMemberMuteState(readback),
          executionRef: `communication-member:${input.circleId}:${targetMemberPubkey}:muted`,
        };
      },
    });
    const effect = await (tx as any).operationEffect.findUnique({
      where: { invocationId: outcome.receipt.invocationId },
    });
    if (!effect || effect.initialReceiptId !== outcome.receipt.id) {
      throw operationalError(409, 'operator_mute_effect_readback_mismatch');
    }
    let ratificationCase: any = null;
    let requiredEffectState = temporaryContract.initialEffectState as
      | 'active'
      | 'ratification_required'
      | 'expired'
      | 'revoked';
    if (temporaryContract.initialEffectState === 'ratification_required') {
      if (!outcome.replayed) {
        await transitionOperationEffectInTransaction(tx as any, {
          effectId: effect.id,
          nextState: 'ratification_required',
          reasonCode: 'emergency_communication_mute_requires_ratification',
          actorPubkey,
          sourceReceiptId: outcome.receipt.id,
          occurredAt: now,
        });
        requiredEffectState = 'ratification_required';
      } else if (!['ratification_required', 'active', 'expired', 'revoked'].includes(effect.state)) {
        throw operationalError(409, 'operator_mute_ratification_effect_mismatch');
      } else {
        requiredEffectState = effect.state;
      }
      const collectiveAuthority = await resolveActiveCircleGovernanceBinding(tx as any, {
        targetCircleId: input.circleId,
        actionType: COMMUNICATION_MEMBER_MUTE_ACTION_TYPE,
        purpose: 'collective_decision',
        now,
        subjectType: 'communication_room_member',
        subjectRef: targetRef,
      });
      const operationalBindingId = String((outcome.receipt.limits as any)?.domainBindingId ?? '');
      if (!collectiveAuthority || collectiveAuthority.binding.id !== operationalBindingId) {
        throw operationalError(409, 'operator_mute_ratification_authority_required');
      }
      const eligibleActors = await listCommitteeEligibleActors(tx as any, {
        committeeCircleId: collectiveAuthority.binding.committeeCircleId,
      });
      const operator = eligibleActors.find((candidate: any) => candidate.pubkey === actorPubkey);
      if (!operator || !eligibleActors.some((candidate: any) => candidate.pubkey !== actorPubkey)) {
        throw operationalError(409, 'operator_mute_independent_ratifier_required');
      }
      const ratificationPayload = {
        kind: COMMUNICATION_MEMBER_MUTE_RATIFICATION_KIND,
        currentContract: 'communication-member-temporary-mute-current',
        circleId: input.circleId,
        roomKey,
        targetMemberPubkey,
        subjectRef: targetRef,
        originalInvocationId: outcome.receipt.invocationId,
        originalReceiptId: outcome.receipt.id,
        operationEffectId: effect.id,
        originalOperatorPubkey: actorPubkey,
        ratificationDeadline: temporaryContract.expiresAt.toISOString(),
        onRejectOrTimeout: 'expire_and_unmute_exact_member',
      } as const;
      if (outcome.replayed) {
        const cases = await (tx as any).governanceCase.findMany({
          where: {
            originKind: 'native_invocation',
            originRef: `operation_receipt:${outcome.receipt.id}`,
          },
          orderBy: { openedAt: 'desc' },
          take: 8,
        });
        const ratificationCases = cases.filter((candidate: any) => (
          communicationMemberMuteRatificationPayload(candidate.requestedActionPayload)
        ));
        if (ratificationCases.length > 1) {
          throw operationalError(409, 'operator_mute_ratification_case_ambiguous');
        }
        ratificationCase = ratificationCases[0] ?? null;
        const frozen = communicationMemberMuteRatificationPayload(
          ratificationCase?.requestedActionPayload,
        );
        if (
          !ratificationCase
          || ratificationCase.subjectType !== 'communication_room_member'
          || ratificationCase.subjectRef !== targetRef
          || !frozen
          || frozen.originalInvocationId !== outcome.receipt.invocationId
          || frozen.originalReceiptId !== outcome.receipt.id
          || frozen.operationEffectId !== effect.id
          || frozen.originalOperatorPubkey !== actorPubkey
          || frozen.ratificationDeadline !== temporaryContract.expiresAt.toISOString()
        ) throw operationalError(409, 'operator_mute_ratification_case_mismatch');
      } else {
        const created = await createGovernanceCaseIntake(tx as any, {
          circleId: input.circleId,
          title: 'Ratify emergency communication restriction',
          requestedDecision: 'Should the independent eligible electorate ratify this exact temporary emergency communication mute until its frozen expiry?',
          requestedActionPayload: { communicationMemberMuteRatification: ratificationPayload },
          caseType: 'policy',
          templateId: 'basic-community',
          actionType: COMMUNICATION_MEMBER_MUTE_ACTION_TYPE,
          subjectType: 'communication_room_member',
          subjectRef: targetRef,
          authorityBindingId: collectiveAuthority.binding.id,
          authorityResolution: collectiveAuthority,
          decisionMechanismKind: 'equal_weight_threshold',
          originKind: 'native_invocation',
          sourceInvocationId: outcome.receipt.invocationId,
          sourceReceiptId: outcome.receipt.id,
          sourceMessageIds: [],
          idempotencyKey: `operation-ratification:${outcome.receipt.id}`,
          openedByPubkey: actorPubkey,
          actorRole: String(operator.role),
          openedAt: now,
        });
        ratificationCase = created.governanceCase;
      }
    } else if (effect.state !== 'active') {
      throw operationalError(409, 'operator_mute_effect_readback_mismatch');
    }
    const durableMember = await linkTemporaryCommunicationMuteInTransaction(tx as any, {
      circleId: input.circleId,
      roomKey,
      targetMemberPubkey,
      reasonCode,
      mutedAt: now,
      expiresAt: temporaryContract.expiresAt,
      receipt: outcome.receipt,
      replayed: outcome.replayed,
      requiredEffectState,
      ratificationCaseId: ratificationCase?.id ?? null,
    });
    const recurrenceReviewCase = await ensureCommunicationOperationRecurrenceReviewCase(tx, {
      circleId: input.circleId,
      actionType: COMMUNICATION_MEMBER_MUTE_ACTION_TYPE,
      currentReceiptId: outcome.receipt.id,
      now,
    });
    return {
      ...outcome,
      result: publicCommunicationMemberMuteState(durableMember),
      contract: {
        ...temporaryContract,
        expiresAt: temporaryContract.expiresAt.toISOString(),
      },
      ratificationCase: ratificationCase ? {
        id: ratificationCase.id,
        url: `/governance/cases/${encodeURIComponent(ratificationCase.id)}`,
        deadline: temporaryContract.expiresAt.toISOString(),
      } : null,
      recurrenceReviewCase: recurrenceReviewCase ? {
        id: recurrenceReviewCase.id,
        url: `/governance/cases/${encodeURIComponent(recurrenceReviewCase.id)}`,
      } : null,
    };
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await (prisma as any).$transaction((tx: PrismaClient) => run(tx));
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : null;
      if (!['P2002', 'P2034'].includes(code ?? '') || attempt === 2) throw error;
    }
  }
  throw operationalError(409, "operator_mute_retry_exhausted");
}

export async function executeSharedCommitteeMessageHide(
  prisma: PrismaClient,
  input: {
    circleId: number;
    actorPubkey: string;
    envelopeId: string;
    durationSeconds: number;
    reasonCode: string;
    idempotencyKey: string;
  },
) {
  const actorPubkey = canonicalSolanaPublicKeyString(input.actorPubkey);
  const envelopeId = input.envelopeId.trim();
  const reasonCode = input.reasonCode.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  if (!Number.isSafeInteger(input.circleId) || input.circleId <= 0) {
    throw operationalError(400, 'invalid_circle_id');
  }
  if (!actorPubkey || !envelopeId || envelopeId.length > 96) {
    throw operationalError(400, 'invalid_operator_message_hide_subject');
  }
  if (!reasonCode || reasonCode.length > 96 || !idempotencyKey || idempotencyKey.length > 128) {
    throw operationalError(400, 'invalid_operator_message_hide_input');
  }
  const roomKey = `circle:${input.circleId}`;
  const targetRef = `${input.circleId}:${envelopeId}`;
  const run = async (tx: PrismaClient) => {
    const now = new Date();
    await (tx as any).$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      `communication-message-hide:${targetRef}`,
    );
    const message = await (tx as any).communicationMessage.findUnique({ where: { envelopeId } });
    if (!message || message.roomKey !== roomKey || message.deleted === true) {
      throw operationalError(404, 'operator_message_hide_target_not_found');
    }
    const existingInvocation = await (tx as any).governedActionInvocation.findFirst({
      where: {
        actorPubkey,
        subjectType: 'communication_message',
        subjectRef: targetRef,
        idempotencyKey,
        contractVersion: { actionType: COMMUNICATION_MESSAGE_HIDE_ACTION_TYPE },
      },
      orderBy: { createdAt: 'desc' },
    });
    const requestedEffect = existingInvocation?.requestedEffect
      && typeof existingInvocation.requestedEffect === 'object'
      && !Array.isArray(existingInvocation.requestedEffect)
      ? existingInvocation.requestedEffect as Record<string, unknown>
      : null;
    if (existingInvocation && (
      requestedEffect?.contractVersion !== 'communication-message-hide-current'
      || Number(requestedEffect.durationSeconds) !== input.durationSeconds
      || requestedEffect.roomKey !== roomKey
      || requestedEffect.envelopeId !== envelopeId
      || requestedEffect.targetMemberPubkey !== message.senderPubkey
      || requestedEffect.restore !== 'scheduler_and_read_reconciliation'
      || requestedEffect.notification !== 'subject_notification_and_canonical_state_readback'
      || requestedEffect.appeal !== 'canonical_operation_receipt_window'
      || existingInvocation.reasonDigest !== hashCanonicalGovernanceValue(
        'alcheme.governance.action-reason',
        { reasonCode },
      )
    )) throw operationalError(409, 'operator_message_hide_idempotency_conflict');
    const frozenExpiry = requestedEffect?.expiresAt == null
      ? undefined
      : new Date(String(requestedEffect.expiresAt));
    const contract = resolveCommunicationMessageHideContract({
      durationSeconds: input.durationSeconds,
      now,
      ...(frozenExpiry ? { expiresAt: frozenExpiry } : {}),
    });
    const evidenceDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.communication-message-hide-evidence',
      {
        envelopeId,
        roomKey,
        senderPubkey: message.senderPubkey,
        payloadHash: message.payloadHash,
        createdAt: message.createdAt.toISOString(),
      },
    );
    const payload = {
      contractVersion: contract.contractVersion,
      envelopeId,
      roomKey,
      targetMemberPubkey: message.senderPubkey,
      durationSeconds: contract.durationSeconds,
      expiresAt: contract.expiresAt.toISOString(),
      scope: contract.scope,
      evidenceDigest,
      publicProjection: contract.publicProjection,
      restore: contract.restore,
      notification: contract.notification,
      appeal: contract.appeal,
      delete: contract.delete,
    };
    const gateway = new GovernedActionGateway({
      registry: createGovernedActionRegistry({
        includePhase1Defaults: true,
        includeCommunicationActions: true,
      }),
      resolveBinding: (bindingInput) => resolveActiveCircleGovernanceBinding(tx as any, bindingInput),
      listCommitteeEligibleActors: (eligibleInput) => listCommitteeEligibleActors(tx as any, eligibleInput),
      requestStore: createPrismaGovernanceRequestStore(tx as any),
      runtimePrisma: tx as any,
      runtimeTransactionClient: true,
      now: () => now,
    });
    const outcome = await gateway.executeSharedCommitteeOperation({
      actionType: COMMUNICATION_MESSAGE_HIDE_ACTION_TYPE,
      targetCircleId: input.circleId,
      targetType: 'communication_message',
      targetRef,
      actorPubkey,
      payload,
      reasonCode,
      idempotencyKey,
      execute: async () => {
        const updated = await (tx as any).communicationMessage.updateMany({
          where: { envelopeId, roomKey, hidden: false, deleted: false },
          data: {
            hidden: true,
            hiddenAt: now,
            hideExpiresAt: contract.expiresAt,
            hideReasonCode: reasonCode,
            hideEvidenceDigest: evidenceDigest,
          },
        });
        if (updated.count !== 1) throw operationalError(409, 'operator_message_hide_target_changed');
        const readback = await (tx as any).communicationMessage.findUnique({ where: { envelopeId } });
        if (!readback || readback.hidden !== true || readback.deleted === true) {
          throw operationalError(409, 'operator_message_hide_readback_mismatch');
        }
        return {
          result: publicCommunicationMessageHideState(readback),
          executionRef: `communication-message:${targetRef}:hidden`,
        };
      },
    });
    const durable = await linkCommunicationMessageHideInTransaction(tx as any, {
      circleId: input.circleId,
      envelopeId,
      hiddenAt: outcome.replayed
        ? new Date(String(requestedEffect?.hiddenAt ?? message.hiddenAt))
        : now,
      expiresAt: contract.expiresAt,
      reasonCode,
      evidenceDigest,
      receipt: outcome.receipt,
      replayed: outcome.replayed,
    });
    return {
      ...outcome,
      result: publicCommunicationMessageHideState(durable),
      contract: { ...contract, expiresAt: contract.expiresAt.toISOString() },
    };
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await (prisma as any).$transaction((tx: PrismaClient) => run(tx));
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code)
        : null;
      if (!['P2002', 'P2034'].includes(code ?? '') || attempt === 2) throw error;
    }
  }
  throw operationalError(409, 'operator_message_hide_retry_exhausted');
}

function operationalError(statusCode: number, code: string): Error {
  return Object.assign(new Error(code), { statusCode });
}

export function publicCommunicationGovernanceRequest(request: any) {
  return {
    id: request.id,
    policyId: request.policyId,
    policyVersionId: request.policyVersionId,
    policyVersion: request.policyVersion,
    ruleId: request.ruleId,
    scopeType: request.scopeType,
    scopeRef: request.scopeRef,
    actionType: request.actionType,
    targetType: request.targetType,
    targetRef: request.targetRef,
    payload: request.payload ?? null,
    idempotencyKey: request.idempotencyKey,
    proposerPubkey: request.proposerPubkey,
    state: request.state,
    openedAt: request.openedAt instanceof Date ? request.openedAt.toISOString() : request.openedAt ?? null,
    expiresAt: request.expiresAt instanceof Date ? request.expiresAt.toISOString() : request.expiresAt ?? null,
    resolvedAt: request.resolvedAt instanceof Date ? request.resolvedAt.toISOString() : request.resolvedAt ?? null,
    snapshot: request.snapshot ?? null,
  };
}

export async function evaluateCommunicationVoicePolicyGovernance(
  prisma: PrismaClient,
  input: {
    circleId: number;
    roomKey: string;
    actorPubkey: string;
    directAllowed: boolean;
    payload: {
      maxSpeakers: number;
      overflowStrategy: string;
    };
  },
): Promise<
  | { status: "direct_allowed" }
  | { status: "denied"; error: string }
  | { status: "requires_governance"; actionType: string; request: ReturnType<typeof publicCommunicationGovernanceRequest> }
> {
  const registry = createGovernedActionRegistry({
    includePhase1Defaults: true,
    includeCommunicationActions: true,
  });
  const gateway = new GovernedActionGateway({
    registry,
    resolveBinding: (bindingInput) =>
      resolveActiveCircleGovernanceBinding(prisma as any, bindingInput),
    listCommitteeEligibleActors: (eligibleInput) =>
      listCommitteeEligibleActors(prisma as any, eligibleInput),
    requestStore: createPrismaGovernanceRequestStore(prisma as any),
    runtimePrisma: prisma as any,
  });

  const decision = await gateway.evaluate({
    actionType: COMMUNICATION_VOICE_POLICY_UPDATE_ACTION_TYPE,
    targetCircleId: input.circleId,
    actorPubkey: input.actorPubkey,
    directAllowed: input.directAllowed,
  });
  if (decision.status === "direct_allowed") {
    return { status: "direct_allowed" };
  }
  if (decision.status === "denied") {
    return {
      status: "denied",
      error: decision.reason,
    };
  }

  const payload = {
    circleId: input.circleId,
    roomKey: input.roomKey,
    maxSpeakers: input.payload.maxSpeakers,
    overflowStrategy: input.payload.overflowStrategy,
    actorPubkey: input.actorPubkey,
  };
  const idempotencyKey = buildCommunicationVoicePolicyIdempotencyKey({
    roomKey: input.roomKey,
    payload,
  });
  const existingRequest = await findActiveCommunicationVoicePolicyRequest(
    prisma as any,
    {
      roomKey: input.roomKey,
      committeeCircleId: decision.committeeCircleId,
      idempotencyKey,
    },
  );
  if (existingRequest) {
    const request = existingRequest as any;
    return {
      status: "requires_governance",
      actionType: request.actionType ?? COMMUNICATION_VOICE_POLICY_UPDATE_ACTION_TYPE,
      request: publicCommunicationGovernanceRequest(request),
    };
  }

  const request = await gateway.openRequest({
    actionType: COMMUNICATION_VOICE_POLICY_UPDATE_ACTION_TYPE,
    targetCircleId: input.circleId,
    targetType: "communication_room",
    targetRef: input.roomKey,
    payload,
    idempotencyKey,
    proposerPubkey: input.actorPubkey,
  });

  return {
    status: "requires_governance",
    actionType: COMMUNICATION_VOICE_POLICY_UPDATE_ACTION_TYPE,
    request: publicCommunicationGovernanceRequest(request),
  };
}

export async function executeCommunicationGovernanceAction(
  prisma: PrismaClient,
  request: {
    id: string;
    actionType: string;
    targetType: string;
    targetRef: string;
    payload?: unknown;
  },
): Promise<{
  executionStatus: "executed" | "skipped";
  executionRef: string | null;
  errorCode?: string | null;
} | null> {
  if (request.actionType !== COMMUNICATION_VOICE_POLICY_UPDATE_ACTION_TYPE) {
    return null;
  }
  if (request.targetType !== "communication_room") return null;
  const payload = normalizeRecord(request.payload);
  const targetRoomKey = request.targetRef;
  const payloadRoomKey = parseNonEmptyString(payload.roomKey);
  if (payloadRoomKey && payloadRoomKey !== targetRoomKey) {
    throw new Error("invalid_communication_voice_policy_target");
  }
  const roomKey = targetRoomKey;
  const circleId =
    parsePositiveInt(payload.circleId) ?? parseCircleRoomKey(roomKey);
  if (!circleId || roomKey !== `circle:${circleId}`) {
    throw new Error("invalid_communication_voice_policy_target");
  }

  const policy = normalizeCircleRoomVoicePolicyPatch({
    maxSpeakers: payload.maxSpeakers,
    overflowStrategy: payload.overflowStrategy,
  });
  await applyCircleRoomVoicePolicy(prisma as any, {
    circleId,
    policy,
  });

  return {
    executionStatus: "executed",
    executionRef: roomKey,
  };
}

async function findActiveCommunicationVoicePolicyRequest(
  prisma: {
    governanceRequest?: {
      findFirst(input: unknown): Promise<unknown | null>;
    };
  },
  input: {
    roomKey: string;
    committeeCircleId: number;
    idempotencyKey: string;
  },
): Promise<unknown | null> {
  if (typeof prisma.governanceRequest?.findFirst !== "function") return null;
  return prisma.governanceRequest.findFirst({
    where: {
      actionType: COMMUNICATION_VOICE_POLICY_UPDATE_ACTION_TYPE,
      targetType: "communication_room",
      targetRef: input.roomKey,
      scopeType: "circle_governance_committee",
      scopeRef: String(input.committeeCircleId),
      state: "active",
      idempotencyKey: input.idempotencyKey,
    },
    include: {
      snapshot: true,
    },
  });
}

function buildCommunicationVoicePolicyIdempotencyKey(input: {
  roomKey: string;
  payload: Record<string, unknown>;
}): string {
  const digest = createHash("sha256")
    .update(stableJsonStringify(input.payload))
    .digest("hex")
    .slice(0, 24);
  return `communication:voice-policy:${input.roomKey}:${digest}`;
}

function parseCircleRoomKey(value: string): number | null {
  const match = /^circle:(\d+)$/.exec(value);
  return match ? parsePositiveInt(match[1]) : null;
}

function parsePositiveInt(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? Math.trunc(value)
      : typeof value === "string" && /^\d+$/.test(value.trim())
        ? Number.parseInt(value.trim(), 10)
        : null;
  return Number.isSafeInteger(parsed) && parsed && parsed > 0 ? parsed : null;
}

function parseNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`)
    .join(",")}}`;
}
