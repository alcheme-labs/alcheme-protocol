import { hashCanonicalGovernanceValue } from './canonicalCodec';

export const GOVERNED_ACTION_IDEMPOTENCY_SCOPE = 'governance_home_action_subject';

interface GovernedActionInvocationLineageInput {
  idempotencyScope: string;
  idempotencyWindowSeconds: number | null;
  homeIdentityBindingId: string;
  contractVersionId: string;
  profileBindingId: string;
  profileVersionRef: string;
  actionType: string;
  subjectType: string;
  subjectRef: string;
  idempotencyKey: string;
  payloadDigest: string;
  reasonDigest: string | null;
  now: Date;
}

export interface GovernedActionInvocationLineage {
  invocationId: string;
  attemptKey: string;
  recurrenceFamilyKey: string;
  recurrenceKey: string;
  idempotencyWindowStart: Date | null;
  idempotencyWindowEnd: Date | null;
}

export function resolveGovernedActionInvocationLineage(
  input: GovernedActionInvocationLineageInput,
): GovernedActionInvocationLineage {
  if (input.idempotencyScope !== GOVERNED_ACTION_IDEMPOTENCY_SCOPE) {
    throw new Error('governed_action_idempotency_scope_unsupported');
  }
  if (
    input.idempotencyWindowSeconds !== null
    && (!Number.isSafeInteger(input.idempotencyWindowSeconds)
      || input.idempotencyWindowSeconds <= 0)
  ) {
    throw new Error('governed_action_idempotency_window_invalid');
  }
  if (!input.idempotencyKey.trim()) {
    throw new Error('governed_action_idempotency_key_required');
  }
  if (!Number.isFinite(input.now.getTime())) {
    throw new Error('governed_action_idempotency_time_invalid');
  }

  const window = resolveWindow(input.now, input.idempotencyWindowSeconds);
  const familyFacts = {
    idempotencyScope: input.idempotencyScope,
    homeIdentityBindingId: input.homeIdentityBindingId,
    actionType: input.actionType,
    subjectType: input.subjectType,
    subjectRef: input.subjectRef,
  };
  const recurrenceFamilyKey = `governed-recurrence-family:${hashCanonicalGovernanceValue(
    'alcheme.governance.action-recurrence-family',
    familyFacts,
  )}`;
  const recurrenceKey = `governed-recurrence:${hashCanonicalGovernanceValue(
    'alcheme.governance.action-recurrence',
    {
      ...familyFacts,
      contractVersionId: input.contractVersionId,
      profileBindingId: input.profileBindingId,
      profileVersionRef: input.profileVersionRef,
      idempotencyKey: input.idempotencyKey,
      payloadDigest: input.payloadDigest,
      reasonDigest: input.reasonDigest,
      idempotencyWindowStart: window.start?.toISOString() ?? null,
      idempotencyWindowEnd: window.end?.toISOString() ?? null,
    },
  )}`;
  const invocationId = `governed-invocation:${hashCanonicalGovernanceValue(
    'alcheme.governance.action-invocation-id-v2',
    { recurrenceKey },
  ).slice(0, 55)}`;
  return {
    invocationId,
    attemptKey: `${invocationId}:attempt:1`,
    recurrenceFamilyKey,
    recurrenceKey,
    idempotencyWindowStart: window.start,
    idempotencyWindowEnd: window.end,
  };
}

function resolveWindow(
  now: Date,
  windowSeconds: number | null,
): { start: Date | null; end: Date | null } {
  if (windowSeconds === null) return { start: null, end: null };
  const windowMilliseconds = windowSeconds * 1000;
  const startMilliseconds = Math.floor(now.getTime() / windowMilliseconds) * windowMilliseconds;
  const endMilliseconds = startMilliseconds + windowMilliseconds;
  if (!Number.isSafeInteger(startMilliseconds) || !Number.isSafeInteger(endMilliseconds)) {
    throw new Error('governed_action_idempotency_window_invalid');
  }
  return {
    start: new Date(startMilliseconds),
    end: new Date(endMilliseconds),
  };
}
