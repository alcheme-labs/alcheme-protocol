import { hashCanonicalGovernanceValue } from './canonicalCodec';
import {
  listCommitteeEligibleActors,
  resolveActiveCircleGovernanceBinding,
} from './circleGovernanceBindings';
import { isGovernanceCommitteeOperator } from './circleCommitteeActors';
import { createGovernanceCaseIntake } from './governanceCase';
import { projectGovernedDirectOperationReceipt } from './governedActionGateway';

export const COMMUNICATION_OPERATION_RECURRENCE_REVIEW_KIND =
  'communication_operation_recurrence_review';

export interface CommunicationOperationRecurrenceReviewPayload {
  kind: typeof COMMUNICATION_OPERATION_RECURRENCE_REVIEW_KIND;
  currentContract: 'communication-operation-escalation-current';
  trigger: 'repeated';
  actionType: 'communication.member.mute';
  circleId: number;
  subjectType: 'communication_room_member';
  subjectRef: string;
  currentInvocationId: string;
  currentReceiptId: string;
  currentReceiptDigest: string;
  currentEffectId: string;
  currentEffectDigest: string;
  currentOperatorPubkey: string;
  previousInvocationId: string;
  previousReceiptId: string;
  previousReceiptDigest: string;
  previousEffectId: string;
  previousEffectDigest: string;
  previousOperatorPubkey: string;
  evidencePolicy: 'canonical_receipt_and_effect_digests_only';
  reviewBoundary: 'review_only_no_second_sanction';
  conflictRule: 'operation_actors_excluded';
}

export function communicationOperationRecurrenceReviewPayload(
  value: unknown,
): CommunicationOperationRecurrenceReviewPayload | null {
  const container = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const payload = container.communicationOperationRecurrenceReview;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const candidate = payload as Record<string, unknown>;
  if (
    candidate.kind !== COMMUNICATION_OPERATION_RECURRENCE_REVIEW_KIND
    || candidate.currentContract !== 'communication-operation-escalation-current'
    || candidate.trigger !== 'repeated'
    || candidate.actionType !== 'communication.member.mute'
    || !Number.isSafeInteger(Number(candidate.circleId))
    || Number(candidate.circleId) <= 0
    || candidate.subjectType !== 'communication_room_member'
    || typeof candidate.subjectRef !== 'string'
    || !candidate.subjectRef.startsWith(`${candidate.circleId}:`)
    || typeof candidate.currentInvocationId !== 'string'
    || candidate.currentInvocationId.length === 0
    || typeof candidate.currentReceiptId !== 'string'
    || candidate.currentReceiptId.length === 0
    || typeof candidate.currentEffectId !== 'string'
    || candidate.currentEffectId.length === 0
    || typeof candidate.currentOperatorPubkey !== 'string'
    || candidate.currentOperatorPubkey.length === 0
    || typeof candidate.previousInvocationId !== 'string'
    || candidate.previousInvocationId.length === 0
    || typeof candidate.previousReceiptId !== 'string'
    || candidate.previousReceiptId.length === 0
    || typeof candidate.previousEffectId !== 'string'
    || candidate.previousEffectId.length === 0
    || typeof candidate.previousOperatorPubkey !== 'string'
    || candidate.previousOperatorPubkey.length === 0
    || !/^[a-f0-9]{64}$/.test(String(candidate.currentReceiptDigest ?? ''))
    || !/^[a-f0-9]{64}$/.test(String(candidate.currentEffectDigest ?? ''))
    || !/^[a-f0-9]{64}$/.test(String(candidate.previousReceiptDigest ?? ''))
    || !/^[a-f0-9]{64}$/.test(String(candidate.previousEffectDigest ?? ''))
    || candidate.currentInvocationId === candidate.previousInvocationId
    || candidate.currentReceiptId === candidate.previousReceiptId
    || candidate.currentEffectId === candidate.previousEffectId
    || candidate.evidencePolicy !== 'canonical_receipt_and_effect_digests_only'
    || candidate.reviewBoundary !== 'review_only_no_second_sanction'
    || candidate.conflictRule !== 'operation_actors_excluded'
  ) return null;
  return candidate as unknown as CommunicationOperationRecurrenceReviewPayload;
}

export async function ensureCommunicationOperationRecurrenceReviewCase(
  tx: any,
  input: {
    circleId: number;
    actionType: CommunicationOperationRecurrenceReviewPayload['actionType'];
    currentReceiptId: string;
    now: Date;
  },
): Promise<any | null> {
  const current = await tx.operationReceipt.findUnique({
    where: { id: input.currentReceiptId },
    include: {
      invocation: {
        include: {
          contractVersion: true,
          authoritySnapshot: { include: { binding: true } },
        },
      },
      initialEffect: true,
    },
  });
  const previousReceiptId = current?.invocation?.previousReceiptRef;
  if (!previousReceiptId) return null;
  const previous = await tx.operationReceipt.findUnique({
    where: { id: previousReceiptId },
    include: {
      invocation: {
        include: {
          contractVersion: true,
          authoritySnapshot: { include: { binding: true } },
        },
      },
      initialEffect: true,
    },
  });
  if (
    !current?.initialEffect
    || !previous?.initialEffect
    || current.invocation?.contractVersion?.actionType !== input.actionType
    || previous.invocation?.contractVersion?.actionType !== input.actionType
    || current.invocation.governanceHomeType !== 'circle'
    || current.invocation.governanceHomeRef !== String(input.circleId)
    || previous.invocation.governanceHomeType !== 'circle'
    || previous.invocation.governanceHomeRef !== String(input.circleId)
    || current.invocation.subjectType !== previous.invocation.subjectType
    || current.invocation.subjectRef !== previous.invocation.subjectRef
    || current.initialEffect.invocationId !== current.invocationId
    || current.initialEffect.initialReceiptId !== current.id
    || previous.initialEffect.invocationId !== previous.invocationId
    || previous.initialEffect.initialReceiptId !== previous.id
  ) throw escalationError('communication_operation_recurrence_owner_mismatch');
  const currentProjection = projectGovernedDirectOperationReceipt(current);
  projectGovernedDirectOperationReceipt(previous);
  const payload: CommunicationOperationRecurrenceReviewPayload = {
    kind: COMMUNICATION_OPERATION_RECURRENCE_REVIEW_KIND,
    currentContract: 'communication-operation-escalation-current',
    trigger: 'repeated',
    actionType: input.actionType,
    circleId: input.circleId,
    subjectType: current.invocation.subjectType,
    subjectRef: current.invocation.subjectRef,
    currentInvocationId: current.invocationId,
    currentReceiptId: current.id,
    currentReceiptDigest: current.receiptDigest,
    currentEffectId: current.initialEffect.id,
    currentEffectDigest: current.initialEffect.effectDigest,
    currentOperatorPubkey: current.actorPubkey,
    previousInvocationId: previous.invocationId,
    previousReceiptId: previous.id,
    previousReceiptDigest: previous.receiptDigest,
    previousEffectId: previous.initialEffect.id,
    previousEffectDigest: previous.initialEffect.effectDigest,
    previousOperatorPubkey: previous.actorPubkey,
    evidencePolicy: 'canonical_receipt_and_effect_digests_only',
    reviewBoundary: 'review_only_no_second_sanction',
    conflictRule: 'operation_actors_excluded',
  };
  const idempotencyKey = `operation-escalation:${current.id}`;
  const existingCases = await tx.governanceCase.findMany({
    where: {
      originKind: 'native_invocation',
      originRef: `operation_receipt:${current.id}`,
      idempotencyKey,
    },
    orderBy: { openedAt: 'desc' },
    take: 2,
  });
  if (existingCases.length > 1) {
    throw escalationError('communication_operation_recurrence_case_ambiguous');
  }
  if (existingCases.length === 1) {
    const frozen = communicationOperationRecurrenceReviewPayload(
      existingCases[0].requestedActionPayload,
    );
    if (
      !frozen
      || existingCases[0].invocationId !== current.invocationId
      || existingCases[0].subjectType !== current.invocation.subjectType
      || existingCases[0].subjectRef !== current.invocation.subjectRef
      || hashCanonicalGovernanceValue(
        'alcheme.governance.communication-operation-recurrence-review',
        frozen,
      ) !== hashCanonicalGovernanceValue(
        'alcheme.governance.communication-operation-recurrence-review',
        payload,
      )
    ) throw escalationError('communication_operation_recurrence_case_mismatch');
    return existingCases[0];
  }
  const authority = await resolveActiveCircleGovernanceBinding(tx, {
    targetCircleId: input.circleId,
    actionType: input.actionType,
    purpose: 'collective_decision',
    now: input.now,
    subjectType: current.invocation.subjectType,
    subjectRef: current.invocation.subjectRef,
  });
  const operationalBindingId = String((currentProjection.limits as any)?.domainBindingId ?? '');
  if (!authority || authority.binding.id !== operationalBindingId) {
    throw escalationError(authority
      ? 'communication_operation_recurrence_collective_authority_mismatch'
      : 'communication_operation_recurrence_collective_authority_required');
  }
  const eligibleActors = await listCommitteeEligibleActors(tx, {
    committeeCircleId: authority.binding.committeeCircleId,
  });
  const operationActors = new Set([current.actorPubkey, previous.actorPubkey]);
  const coordinator = eligibleActors.find((candidate) => (
    !operationActors.has(candidate.pubkey) && isGovernanceCommitteeOperator(candidate)
  ));
  if (!coordinator) {
    throw escalationError('communication_operation_recurrence_independent_reviewer_required');
  }
  const created = await createGovernanceCaseIntake(tx, {
    circleId: input.circleId,
    title: 'Review repeated communication restriction',
    requestedDecision: 'Should the independent eligible electorate accept this exact repeated communication restriction as policy-compliant without creating or executing another sanction?',
    requestedActionPayload: { communicationOperationRecurrenceReview: payload },
    caseType: 'policy',
    templateId: 'basic-community',
    actionType: input.actionType,
    subjectType: payload.subjectType,
    subjectRef: payload.subjectRef,
    authorityBindingId: authority.binding.id,
    authorityResolution: authority,
    decisionMechanismKind: 'equal_weight_threshold',
    originKind: 'native_invocation',
    sourceInvocationId: current.invocationId,
    sourceReceiptId: current.id,
    sourceMessageIds: [],
    idempotencyKey,
    openedByPubkey: coordinator.pubkey,
    actorRole: String(coordinator.role),
    openedAt: input.now,
  });
  return created.governanceCase;
}

function escalationError(code: string): Error {
  return Object.assign(new Error(code), { statusCode: 409 });
}
