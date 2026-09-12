import type { Redis } from 'ioredis';

import type { PreparedGovernanceSignalEnvelopeV2 } from './signalEnvelopeV2';

const CHALLENGE_KEY_PREFIX = 'governance:signal-challenge:v2';

export type GovernanceSignalSubmissionValue =
  | 'approve'
  | 'reject'
  | 'abstain'
  | 'quadratic_voice_credits'
  | 'quadratic_funding';

export interface PendingGovernanceSignalChallenge {
  schemaVersion: 1;
  authority: 'server_owned_ttl_challenge';
  requestId: string;
  caseId: string | null;
  actorPubkey: string;
  submission: {
    value: GovernanceSignalSubmissionValue;
    evidence: Record<string, unknown> | null;
  };
  challenge: PreparedGovernanceSignalEnvelopeV2;
  expiresAt: string;
}

function challengeKey(requestId: string, actorPubkey: string): string {
  return `${CHALLENGE_KEY_PREFIX}:${requestId}:${actorPubkey}`;
}

function isPendingChallenge(value: unknown): value is PendingGovernanceSignalChallenge {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const pending = value as PendingGovernanceSignalChallenge;
  return pending.schemaVersion === 1
    && pending.authority === 'server_owned_ttl_challenge'
    && typeof pending.requestId === 'string'
    && typeof pending.actorPubkey === 'string'
    && typeof pending.expiresAt === 'string'
    && typeof pending.submission?.value === 'string'
    && !!pending.challenge
    && pending.challenge.envelope?.requestId === pending.requestId
    && pending.challenge.envelope?.actor === pending.actorPubkey
    && pending.challenge.envelope?.expiresAt === pending.expiresAt;
}

export async function persistPendingGovernanceSignalChallenge(
  redis: Pick<Redis, 'set'>,
  input: PendingGovernanceSignalChallenge,
  now = new Date(),
): Promise<void> {
  if (!isPendingChallenge(input)) {
    throw new Error('governance_signal_challenge_invalid');
  }
  const ttlSeconds = Math.ceil((new Date(input.expiresAt).getTime() - now.getTime()) / 1000);
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error('governance_signal_challenge_expired');
  }
  const persisted = await redis.set(
    challengeKey(input.requestId, input.actorPubkey),
    JSON.stringify(input),
    'EX',
    ttlSeconds,
  );
  if (persisted !== 'OK') {
    throw new Error('governance_signal_challenge_store_unavailable');
  }
}

export async function readPendingGovernanceSignalChallenge(
  redis: Pick<Redis, 'get' | 'del'>,
  input: { requestId: string; actorPubkey: string; now?: Date },
): Promise<PendingGovernanceSignalChallenge | null> {
  const key = challengeKey(input.requestId, input.actorPubkey);
  const raw = await redis.get(key);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await redis.del(key);
    return null;
  }
  if (!isPendingChallenge(parsed)
    || parsed.requestId !== input.requestId
    || parsed.actorPubkey !== input.actorPubkey
  ) {
    await redis.del(key);
    return null;
  }
  const now = input.now ?? new Date();
  if (new Date(parsed.expiresAt).getTime() <= now.getTime()) {
    await redis.del(key);
    return null;
  }
  return parsed;
}
