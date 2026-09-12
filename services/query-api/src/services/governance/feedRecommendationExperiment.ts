import type { PrismaClient } from '@prisma/client';

import {
  createGovernedActionRegistry,
  FEED_RECOMMENDATION_EXPERIMENT_START_ACTION_TYPE,
  FEED_RECOMMENDATION_EXPERIMENT_STOP_ACTION_TYPE,
} from './actionRegistry';
import { hashCanonicalGovernanceValue } from './canonicalCodec';
import {
  listCommitteeEligibleActors,
  resolveActiveCircleGovernanceBinding,
} from './circleGovernanceBindings';
import { readActiveFeedRankingPolicy } from './feedRankingPolicy';
import { GovernedActionGateway } from './governedActionGateway';
import { transitionOperationEffectInTransaction } from './operationEffectLifecycle';
import { createPrismaGovernanceRequestStore } from './policyEngine';
import { canonicalSolanaPublicKeyString } from '../identity/solanaPublicKey';

export interface FeedRecommendationExperimentContract {
  contractVersion: 'feed-recommendation-experiment-current';
  policyId: string;
  policyVersion: number;
  policyConfigDigest: string;
  targetRatioBps: number;
  durationSeconds: number;
  startedAt: string;
  expiresAt: string;
  targetScope: 'public_circle_root_posts';
  activation: 'shared_committee_exact_actor_only';
  aiActivation: false;
  rollback: 'governed_stop_or_automatic_expiry';
}

export function resolveFeedRecommendationExperimentContract(input: {
  policy: {
    id: string;
    version: number;
    configDigest: string;
    maxActiveRatioBps: number;
    maxDurationSeconds: number;
  };
  targetRatioBps: number;
  durationSeconds: number;
  startedAt: Date;
  expiresAt?: Date;
}): FeedRecommendationExperimentContract {
  const expiresAt = input.expiresAt
    ?? new Date(input.startedAt.getTime() + input.durationSeconds * 1000);
  if (
    !input.policy.id
    || !Number.isSafeInteger(input.policy.version)
    || input.policy.version <= 0
    || !/^[a-f0-9]{64}$/.test(input.policy.configDigest)
    || !Number.isSafeInteger(input.targetRatioBps)
    || input.targetRatioBps < 1
    || input.targetRatioBps > input.policy.maxActiveRatioBps
    || !Number.isSafeInteger(input.durationSeconds)
    || input.durationSeconds < 300
    || input.durationSeconds > input.policy.maxDurationSeconds
    || !Number.isFinite(input.startedAt.getTime())
    || !Number.isFinite(expiresAt.getTime())
    || expiresAt.getTime() - input.startedAt.getTime() !== input.durationSeconds * 1000
  ) throw experimentError(400, 'feed_recommendation_experiment_contract_invalid');
  return {
    contractVersion: 'feed-recommendation-experiment-current',
    policyId: input.policy.id,
    policyVersion: input.policy.version,
    policyConfigDigest: input.policy.configDigest,
    targetRatioBps: input.targetRatioBps,
    durationSeconds: input.durationSeconds,
    startedAt: input.startedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    targetScope: 'public_circle_root_posts',
    activation: 'shared_committee_exact_actor_only',
    aiActivation: false,
    rollback: 'governed_stop_or_automatic_expiry',
  };
}

export function publicFeedRecommendationExperiment(input: {
  effect: any;
  receipt: any;
  invocation: any;
}) {
  const payload = record(input.invocation?.requestedEffect);
  const contract = resolveFeedRecommendationExperimentContract({
    policy: {
      id: String(payload.policyId ?? ''),
      version: Number(payload.policyVersion),
      configDigest: String(payload.policyConfigDigest ?? ''),
      maxActiveRatioBps: Number(payload.targetRatioBps),
      maxDurationSeconds: Number(payload.durationSeconds),
    },
    targetRatioBps: Number(payload.targetRatioBps),
    durationSeconds: Number(payload.durationSeconds),
    startedAt: date(payload.startedAt),
    expiresAt: date(payload.expiresAt),
  });
  if (
    payload.contractVersion !== contract.contractVersion
    || input.invocation?.subjectRef !== `${Number(payload.circleId)}:${String(payload.experimentId)}`
    || !['active', 'expired', 'revoked'].includes(String(input.effect?.state))
    || !input.effect?.id
    || !input.receipt?.id
  ) throw experimentError(409, 'feed_recommendation_experiment_readback_invalid');
  return {
    ...contract,
    experimentId: String(payload.experimentId),
    circleId: Number(payload.circleId),
    state: input.effect.state === 'active'
      ? 'active' as const
      : input.effect.state === 'expired' ? 'expired' as const : 'stopped' as const,
    effectId: String(input.effect.id),
    receiptId: String(input.receipt.id),
  };
}

export async function startFeedRecommendationExperiment(
  prisma: PrismaClient,
  input: {
    circleId: number;
    actorPubkey: string;
    targetRatioBps: number;
    durationSeconds: number;
    reasonCode: string;
    idempotencyKey: string;
  },
) {
  const common = normalizeCommand(input);
  return (prisma as any).$transaction(async (tx: any) => {
    const now = new Date();
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      `feed-recommendation-experiment:${input.circleId}`,
    );
    await expireFeedRecommendationExperimentsInTransaction(tx, { now, circleId: input.circleId });
    const existingInvocation = await tx.governedActionInvocation.findFirst({
      where: {
        actorPubkey: common.actorPubkey,
        subjectType: 'feed_recommendation_experiment',
        idempotencyKey: common.idempotencyKey,
        contractVersion: { actionType: FEED_RECOMMENDATION_EXPERIMENT_START_ACTION_TYPE },
      },
      orderBy: { createdAt: 'desc' },
    });
    const existingPayload = record(existingInvocation?.requestedEffect);
    const policy = existingInvocation
      ? await tx.feedRankingPolicyVersion.findUnique({ where: { id: String(existingPayload.policyId ?? '') } })
      : await readActiveFeedRankingPolicy(tx, input.circleId);
    if (!policy) throw experimentError(409, 'feed_recommendation_experiment_active_policy_required');
    const startedAt = existingInvocation ? date(existingPayload.startedAt) : now;
    const contract = resolveFeedRecommendationExperimentContract({
      policy: {
        id: String(policy.id), version: Number(policy.version),
        configDigest: String(policy.configDigest),
        maxActiveRatioBps: Number(policy.maxActiveRatioBps),
        maxDurationSeconds: Number(policy.maxDurationSeconds),
      },
      targetRatioBps: input.targetRatioBps,
      durationSeconds: input.durationSeconds,
      startedAt,
      ...(existingInvocation ? { expiresAt: date(existingPayload.expiresAt) } : {}),
    });
    const experimentDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.feed-recommendation-experiment',
      { circleId: input.circleId, idempotencyKey: common.idempotencyKey, ...contract },
    );
    const experimentId = `feed-experiment:${experimentDigest.slice(0, 48)}`;
    if (existingInvocation && (
      existingPayload.experimentId !== experimentId
      || existingPayload.circleId !== input.circleId
    )) throw experimentError(409, 'feed_recommendation_experiment_idempotency_conflict');
    if (!existingInvocation) {
      const active = await listStartEffects(tx, input.circleId, 'active');
      if (active.length > 0) throw experimentError(409, 'feed_recommendation_experiment_already_active');
    }
    const payload = { ...contract, experimentId, circleId: input.circleId };
    const gateway = feedGateway(tx, now);
    const outcome = await gateway.executeSharedCommitteeOperation({
      actionType: FEED_RECOMMENDATION_EXPERIMENT_START_ACTION_TYPE,
      targetCircleId: input.circleId,
      targetType: 'feed_recommendation_experiment',
      targetRef: `${input.circleId}:${experimentId}`,
      actorPubkey: common.actorPubkey,
      payload,
      reasonCode: common.reasonCode,
      idempotencyKey: common.idempotencyKey,
      execute: async () => ({
        result: { experimentId, state: 'active' },
        executionRef: `feed-recommendation-experiment:${input.circleId}:${experimentId}`,
      }),
    });
    const effect = await tx.operationEffect.findUnique({ where: { invocationId: outcome.receipt.invocationId } });
    if (!effect || effect.initialReceiptId !== outcome.receipt.id || effect.state !== 'active') {
      throw experimentError(409, 'feed_recommendation_experiment_effect_missing');
    }
    return {
      ...outcome,
      result: publicFeedRecommendationExperiment({
        effect, receipt: outcome.receipt,
        invocation: existingInvocation ?? { subjectRef: `${input.circleId}:${experimentId}`, requestedEffect: payload },
      }),
    };
  });
}

export async function stopFeedRecommendationExperiment(
  prisma: PrismaClient,
  input: {
    circleId: number;
    actorPubkey: string;
    experimentReceiptId: string;
    reasonCode: string;
    idempotencyKey: string;
  },
) {
  const common = normalizeCommand(input);
  const experimentReceiptId = input.experimentReceiptId.trim();
  if (!experimentReceiptId) throw experimentError(400, 'feed_recommendation_experiment_receipt_required');
  return (prisma as any).$transaction(async (tx: any) => {
    const now = new Date();
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      `feed-recommendation-experiment:${input.circleId}`,
    );
    const original = await tx.operationReceipt.findUnique({
      where: { id: experimentReceiptId },
      include: { invocation: { include: { contractVersion: true } }, initialEffect: true },
    });
    const payload = record(original?.invocation?.requestedEffect);
    if (!original || original.executionStatus !== 'succeeded' || !original.initialEffect
      || original.invocation?.contractVersion?.actionType !== FEED_RECOMMENDATION_EXPERIMENT_START_ACTION_TYPE
      || Number(payload.circleId) !== input.circleId
      || original.invocation.subjectRef !== `${input.circleId}:${String(payload.experimentId)}`) {
      throw experimentError(404, 'feed_recommendation_experiment_not_found');
    }
    const existingStop = await tx.governedActionInvocation.findFirst({
      where: {
        actorPubkey: common.actorPubkey,
        subjectType: 'feed_recommendation_experiment',
        subjectRef: original.invocation.subjectRef,
        idempotencyKey: common.idempotencyKey,
        contractVersion: { actionType: FEED_RECOMMENDATION_EXPERIMENT_STOP_ACTION_TYPE },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!existingStop && original.initialEffect.state !== 'active') {
      throw experimentError(409, 'feed_recommendation_experiment_not_active');
    }
    const stopPayload = {
      experimentId: payload.experimentId,
      circleId: input.circleId,
      originalReceiptId: original.id,
      originalEffectId: original.initialEffect.id,
      originalEffectDigest: original.initialEffect.effectDigest,
    };
    const gateway = feedGateway(tx, now);
    const outcome = await gateway.executeSharedCommitteeOperation({
      actionType: FEED_RECOMMENDATION_EXPERIMENT_STOP_ACTION_TYPE,
      targetCircleId: input.circleId,
      targetType: 'feed_recommendation_experiment',
      targetRef: original.invocation.subjectRef,
      actorPubkey: common.actorPubkey,
      payload: stopPayload,
      reasonCode: common.reasonCode,
      idempotencyKey: common.idempotencyKey,
      execute: async () => {
        await transitionOperationEffectInTransaction(tx, {
          effectId: original.initialEffect.id,
          nextState: 'revoked',
          reasonCode: 'feed_recommendation_experiment_stopped',
          actorPubkey: common.actorPubkey,
          sourceReceiptId: null,
          occurredAt: now,
        });
        return {
          result: { experimentId: payload.experimentId, state: 'stopped' },
          executionRef: `feed-recommendation-experiment:${input.circleId}:${payload.experimentId}:stopped`,
        };
      },
    });
    const stopEffect = await tx.operationEffect.findUnique({ where: { invocationId: outcome.receipt.invocationId } });
    if (!stopEffect || stopEffect.initialReceiptId !== outcome.receipt.id) {
      throw experimentError(409, 'feed_recommendation_experiment_stop_effect_missing');
    }
    if (!outcome.replayed && stopEffect.state === 'active') {
      await transitionOperationEffectInTransaction(tx, {
        effectId: stopEffect.id,
        nextState: 'expired',
        reasonCode: 'feed_recommendation_experiment_stop_recorded',
        actorPubkey: common.actorPubkey,
        sourceReceiptId: outcome.receipt.id,
        occurredAt: now,
      });
    }
    const finalEffect = await tx.operationEffect.findUnique({ where: { id: original.initialEffect.id } });
    return {
      ...outcome,
      result: publicFeedRecommendationExperiment({
        effect: finalEffect, receipt: original, invocation: original.invocation,
      }),
    };
  });
}

export async function reconcileExpiredFeedRecommendationExperiments(
  prisma: any,
  input: { now?: Date; circleId?: number; limit?: number } = {},
) {
  const now = input.now ?? new Date();
  return prisma.$transaction((tx: any) => expireFeedRecommendationExperimentsInTransaction(tx, {
    now, circleId: input.circleId, limit: input.limit,
  }));
}

export async function readFeedRecommendationExperiments(
  prisma: any,
  input: { circleId: number; now?: Date },
) {
  await reconcileExpiredFeedRecommendationExperiments(prisma, input);
  const effects = await listStartEffects(prisma, input.circleId);
  return effects.map((effect: any) => publicFeedRecommendationExperiment({
    effect, receipt: effect.initialReceipt, invocation: effect.invocation,
  }));
}

export async function readActiveFeedRecommendationExperimentInTransaction(
  tx: any,
  input: { circleId: number; now: Date },
) {
  await expireFeedRecommendationExperimentsInTransaction(tx, input);
  const active = await listStartEffects(tx, input.circleId, 'active', 2);
  if (active.length > 1) {
    throw experimentError(409, 'feed_recommendation_experiment_multiple_active');
  }
  return active[0] ? publicFeedRecommendationExperiment({
    effect: active[0],
    receipt: active[0].initialReceipt,
    invocation: active[0].invocation,
  }) : null;
}

async function expireFeedRecommendationExperimentsInTransaction(
  tx: any,
  input: { now: Date; circleId?: number; limit?: number },
) {
  const effects = await listStartEffects(tx, input.circleId, 'active', input.limit ?? 100);
  const expired: string[] = [];
  const failures: Array<{ effectId: string; error: string }> = [];
  for (const effect of effects) {
    try {
      const payload = record(effect.invocation?.requestedEffect);
      if (date(payload.expiresAt) > input.now) continue;
      let transitioned = false;
      try {
        await transitionOperationEffectInTransaction(tx, {
          effectId: effect.id,
          nextState: 'expired',
          reasonCode: 'feed_recommendation_experiment_expired',
          actorPubkey: null,
          sourceReceiptId: null,
          occurredAt: input.now,
        });
        transitioned = true;
      } catch (error) {
        if (!(error instanceof Error)
          || ![
            'operation_effect_transition_cas_failed',
            'operation_effect_transition_invalid',
          ].includes(error.message)) throw error;
        const concurrent = await tx.operationEffect.findUnique({
          where: { id: effect.id },
        });
        if (!concurrent || !['expired', 'revoked'].includes(concurrent.state)) throw error;
      }
      if (transitioned) expired.push(String(payload.experimentId));
    } catch (error) {
      failures.push({ effectId: effect.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { scanned: effects.length, expired, failures };
}

function listStartEffects(prisma: any, circleId?: number, state?: string, take = 100) {
  return prisma.operationEffect.findMany({
    where: {
      ...(state ? { state } : {}),
      invocation: {
        contractVersion: { actionType: FEED_RECOMMENDATION_EXPERIMENT_START_ACTION_TYPE },
        ...(circleId ? { governanceHomeType: 'circle', governanceHomeRef: String(circleId) } : {}),
      },
    },
    include: { invocation: true, initialReceipt: true },
    orderBy: { activatedAt: 'desc' },
    take: Math.max(1, Math.min(take, 500)),
  });
}

function feedGateway(tx: any, now: Date) {
  return new GovernedActionGateway({
    registry: createGovernedActionRegistry({
      includePhase1Defaults: true,
      includeFeedGovernanceActions: true,
    }),
    resolveBinding: (value) => resolveActiveCircleGovernanceBinding(tx, value),
    listCommitteeEligibleActors: (value) => listCommitteeEligibleActors(tx, value),
    requestStore: createPrismaGovernanceRequestStore(tx),
    runtimePrisma: tx,
    runtimeTransactionClient: true,
    now: () => now,
  });
}

function normalizeCommand(input: {
  circleId: number;
  actorPubkey: string;
  reasonCode: string;
  idempotencyKey: string;
}) {
  const actorPubkey = canonicalSolanaPublicKeyString(input.actorPubkey);
  const reasonCode = input.reasonCode.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  if (!Number.isSafeInteger(input.circleId) || input.circleId <= 0) {
    throw experimentError(400, 'invalid_circle_id');
  }
  if (!actorPubkey || actorPubkey !== input.actorPubkey
    || !/^[a-z][a-z0-9._-]{2,95}$/.test(reasonCode)
    || !idempotencyKey || idempotencyKey.length > 128) {
    throw experimentError(400, 'feed_recommendation_experiment_input_invalid');
  }
  return { actorPubkey, reasonCode, idempotencyKey };
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any> : {};
}

function date(value: unknown): Date {
  const parsed = value instanceof Date ? value : new Date(String(value ?? ''));
  if (!Number.isFinite(parsed.getTime())) throw experimentError(409, 'feed_recommendation_experiment_timestamp_invalid');
  return parsed;
}

function experimentError(statusCode: number, code: string): Error {
  return Object.assign(new Error(code), { statusCode });
}
