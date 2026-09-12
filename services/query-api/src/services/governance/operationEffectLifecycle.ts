import { isDeepStrictEqual } from 'node:util';

import { canonicalSolanaPublicKeyString } from '../identity/solanaPublicKey';
import { hashCanonicalGovernanceValue } from './canonicalCodec';

export const GOVERNED_ACTION_INVOCATION_STATES = [
  'requested', 'preflighted', 'authorized', 'executing',
  'completed', 'blocked', 'failed', 'escalated',
] as const;
export type GovernedActionInvocationState = typeof GOVERNED_ACTION_INVOCATION_STATES[number];

export const OPERATION_EFFECT_STATES = [
  'active', 'expired', 'revoked', 'superseded',
  'ratification_required', 'rollback_failed',
] as const;
export type OperationEffectState = typeof OPERATION_EFFECT_STATES[number];

const INVOCATION_EDGES: Readonly<Record<GovernedActionInvocationState, readonly GovernedActionInvocationState[]>> = {
  requested: ['preflighted', 'blocked', 'failed', 'escalated'],
  preflighted: ['authorized', 'blocked', 'failed', 'escalated'],
  authorized: ['executing', 'blocked', 'failed', 'escalated'],
  executing: ['completed', 'blocked', 'failed', 'escalated'],
  completed: [],
  blocked: ['preflighted', 'authorized', 'failed', 'escalated'],
  failed: [],
  escalated: [],
};

const EFFECT_EDGES: Readonly<Record<OperationEffectState, readonly OperationEffectState[]>> = {
  active: ['expired', 'revoked', 'superseded', 'ratification_required', 'rollback_failed'],
  ratification_required: ['active', 'expired', 'revoked', 'superseded', 'rollback_failed'],
  rollback_failed: ['revoked', 'superseded'],
  expired: [],
  revoked: [],
  superseded: [],
};

export function assertInvocationLifecycleTransition(
  current: GovernedActionInvocationState,
  next: GovernedActionInvocationState,
): GovernedActionInvocationState {
  if (!INVOCATION_EDGES[current]?.includes(next)) {
    throw new Error('governed_action_invocation_transition_invalid');
  }
  return next;
}

export function assertOperationEffectTransition(
  current: OperationEffectState,
  next: OperationEffectState,
): OperationEffectState {
  if (!EFFECT_EDGES[current]?.includes(next)) {
    throw new Error('operation_effect_transition_invalid');
  }
  return next;
}

export async function createInitialOperationEffect(
  tx: any,
  input: {
    invocationId: string;
    receipt: { id: string; invocationId: string; receiptDigest: string; executionStatus: string };
    activatedAt: Date;
  },
): Promise<any> {
  if (input.receipt.invocationId !== input.invocationId
    || input.receipt.executionStatus !== 'succeeded'
    || !/^[a-f0-9]{64}$/.test(input.receipt.receiptDigest)) {
    throw new Error('operation_effect_initial_receipt_invalid');
  }
  const expected = expectedInitialEffect(input);
  const existing = await tx.operationEffect.findUnique({
    where: { invocationId: input.invocationId }, include: { events: true },
  });
  if (existing) {
    assertExactInitialEffect(existing, expected);
    return existing;
  }
  const effect = await tx.operationEffect.create({ data: {
    id: expected.id, invocationId: input.invocationId, initialReceiptId: input.receipt.id,
    state: 'active', stateVersion: 0, effectDigest: expected.effectDigest,
    activatedAt: input.activatedAt, updatedAt: input.activatedAt,
  } });
  await tx.operationEffectEvent.create({ data: expected.event });
  return { ...effect, events: [expected.event] };
}

export async function assertInitialOperationEffectForReceipt(
  tx: any,
  input: {
    invocationId: string;
    receipt: { id: string; invocationId: string; receiptDigest: string; executionStatus: string; completedAt: Date };
  },
): Promise<any> {
  const expected = expectedInitialEffect({
    invocationId: input.invocationId,
    receipt: input.receipt,
    activatedAt: new Date(input.receipt.completedAt),
  });
  const existing = await tx.operationEffect.findUnique({
    where: { invocationId: input.invocationId }, include: { events: true },
  });
  if (!existing) throw new Error('operation_effect_initial_migration_required');
  assertExactInitialEffect(existing, expected);
  return existing;
}

export async function transitionOperationEffect(
  prisma: any,
  input: {
    effectId: string;
    nextState: OperationEffectState;
    reasonCode: string;
    actorPubkey: string | null;
    sourceReceiptId: string | null;
    occurredAt: Date;
  },
): Promise<any> {
  assertReasonAndActor(input.reasonCode, input.actorPubkey);
  return prisma.$transaction((tx: any) => transitionOperationEffectInTransaction(tx, input));
}

export async function transitionOperationEffectInTransaction(
  tx: any,
  input: {
    effectId: string;
    nextState: OperationEffectState;
    reasonCode: string;
    actorPubkey: string | null;
    sourceReceiptId: string | null;
    occurredAt: Date;
  },
): Promise<any> {
  assertReasonAndActor(input.reasonCode, input.actorPubkey);
  const current = await tx.operationEffect.findUnique({ where: { id: input.effectId } });
  if (!current) throw new Error('operation_effect_missing');
  assertOperationEffectTransition(current.state, input.nextState);
  const sequence = current.stateVersion + 1;
  const facts = {
    effectId: current.id, sequence, fromState: current.state,
    toState: input.nextState, reasonCode: input.reasonCode,
    actorPubkey: input.actorPubkey, sourceReceiptId: input.sourceReceiptId,
    occurredAt: input.occurredAt.toISOString(),
  };
  const transitionDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.operation-effect-transition', facts,
  );
  const updated = await tx.operationEffect.updateMany({
    where: { id: current.id, state: current.state, stateVersion: current.stateVersion },
    data: { state: input.nextState, stateVersion: sequence, updatedAt: input.occurredAt },
  });
  if (updated.count !== 1) throw new Error('operation_effect_transition_cas_failed');
  const event = await tx.operationEffectEvent.create({ data: {
    id: `operation-effect-event:${transitionDigest.slice(0, 57)}`,
    ...facts, occurredAt: input.occurredAt, transitionDigest,
  } });
  return { effect: { ...current, state: input.nextState, stateVersion: sequence }, event };
}

function initialEvent(input: {
  id: string; invocationId: string; initialReceiptId: string; initialReceiptDigest: string;
  initialState: 'active'; effectDigest: string; activatedAt: Date;
}) {
  const facts = {
    effectId: input.id, sequence: 0, fromState: null, toState: input.initialState,
    reasonCode: 'initial_execution_succeeded', actorPubkey: null,
    sourceReceiptId: input.initialReceiptId, occurredAt: input.activatedAt.toISOString(),
  };
  const transitionDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.operation-effect-transition', facts,
  );
  return {
    id: `operation-effect-event:${transitionDigest.slice(0, 57)}`,
    ...facts, occurredAt: input.activatedAt, transitionDigest,
  };
}

function expectedInitialEffect(input: {
  invocationId: string;
  receipt: { id: string; invocationId: string; receiptDigest: string; executionStatus: string };
  activatedAt: Date;
}) {
  if (input.receipt.invocationId !== input.invocationId
    || input.receipt.executionStatus !== 'succeeded'
    || !/^[a-f0-9]{64}$/.test(input.receipt.receiptDigest)) {
    throw new Error('operation_effect_initial_receipt_invalid');
  }
  const effectFacts = {
    invocationId: input.invocationId,
    initialReceiptId: input.receipt.id,
    initialReceiptDigest: input.receipt.receiptDigest,
    initialState: 'active' as const,
  };
  const effectDigest = hashCanonicalGovernanceValue('alcheme.governance.operation-effect', effectFacts);
  const id = `operation-effect:${effectDigest.slice(0, 63)}`;
  return {
    id,
    effectDigest,
    event: initialEvent({ id, ...effectFacts, effectDigest, activatedAt: input.activatedAt }),
  };
}

function assertExactInitialEffect(existing: any, expected: ReturnType<typeof expectedInitialEffect>): void {
  const events = [...(existing.events ?? [])].sort((left, right) => left.sequence - right.sequence);
  const sequencesAreComplete = events.length === existing.stateVersion + 1
    && events.every((event, index) => event.sequence === index);
  if (existing.id !== expected.id
    || existing.initialReceiptId !== expected.event.sourceReceiptId
    || !(OPERATION_EFFECT_STATES as readonly string[]).includes(existing.state)
    || !Number.isInteger(existing.stateVersion)
    || existing.stateVersion < 0
    || existing.effectDigest !== expected.effectDigest
    || !sequencesAreComplete
    || !isDeepStrictEqual(eventFacts(events[0]), eventFacts(expected.event))
    || events.at(-1)?.toState !== existing.state) {
    throw new Error('operation_effect_initial_idempotency_mismatch');
  }
}

function eventFacts(value: any) {
  return {
    effectId: value.effectId, sequence: value.sequence, fromState: value.fromState ?? null,
    toState: value.toState, reasonCode: value.reasonCode,
    actorPubkey: value.actorPubkey ?? null, sourceReceiptId: value.sourceReceiptId ?? null,
    transitionDigest: value.transitionDigest,
    occurredAt: new Date(value.occurredAt).toISOString(),
  };
}

function assertReasonAndActor(reasonCode: string, actorPubkey: string | null): void {
  if (!/^[a-z][a-z0-9._-]{2,95}$/.test(reasonCode)) {
    throw new Error('operation_effect_transition_reason_invalid');
  }
  if (actorPubkey !== null) {
    const canonical = canonicalSolanaPublicKeyString(actorPubkey);
    if (!canonical || canonical !== actorPubkey) throw new Error('operation_effect_actor_invalid');
  }
}
