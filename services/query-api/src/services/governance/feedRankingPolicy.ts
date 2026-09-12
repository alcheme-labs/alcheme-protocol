import type { PrismaClient } from '@prisma/client';

import {
  CONTENT_VISIBILITY_DOWNRANK_ACTION_TYPE,
  createGovernedActionRegistry,
  FEED_RANKING_POLICY_UPDATE_ACTION_TYPE,
  FEED_RECOMMENDATION_EXPERIMENT_START_ACTION_TYPE,
  FEED_RECOMMENDATION_EXPERIMENT_STOP_ACTION_TYPE,
} from './actionRegistry';
import { hashCanonicalGovernanceValue } from './canonicalCodec';
import {
  listCommitteeEligibleActors,
  resolveActiveCircleGovernanceBinding,
} from './circleGovernanceBindings';
import { isGovernanceCommitteeOperator } from './circleCommitteeActors';
import { GovernedActionGateway } from './governedActionGateway';
import { transitionOperationEffectInTransaction } from './operationEffectLifecycle';
import { createPrismaGovernanceRequestStore } from './policyEngine';
import { canonicalSolanaPublicKeyString } from '../identity/solanaPublicKey';

const ALLOWED_SIGNALS = new Set([
  'content_safety',
  'discussion_quality',
  'engagement',
  'freshness',
  'member_relevance',
]);

export interface FeedRankingPolicyContract {
  contractVersion: 'feed-ranking-policy-current';
  signalKeys: string[];
  targetScope: 'public_circle_root_posts';
  defaultFactorBps: number;
  maxDurationSeconds: number;
  maxActiveRatioBps: number;
  policyApplication: 'prospective_only';
  aiActivation: false;
  rollback: 'superseding_version_and_effect_expiry';
}

export interface FeedPolicyApplicationContract {
  mode: 'prospective_only' | 're_evaluate_existing_content';
  contentIds: string[];
  durationSeconds: number | null;
  historicalFacts: 'append_only';
  governanceEligibilityEffect: false;
  priorSanctionAggravation: false;
}

export function resolveFeedPolicyApplicationContract(input: {
  mode?: unknown;
  contentIds?: unknown;
  durationSeconds?: unknown;
  maximumDurationSeconds?: unknown;
}): FeedPolicyApplicationContract {
  const mode = input.mode == null ? 'prospective_only' : String(input.mode);
  const contentIds = Array.isArray(input.contentIds)
    ? [...new Set(input.contentIds.map((value) => String(value).trim()).filter(Boolean))].sort()
    : [];
  const durationSeconds = input.durationSeconds == null ? null : Number(input.durationSeconds);
  const maximumDurationSeconds = input.maximumDurationSeconds == null
    ? null : Number(input.maximumDurationSeconds);
  const prospective = mode === 'prospective_only'
    && contentIds.length === 0
    && durationSeconds === null;
  const reEvaluate = mode === 're_evaluate_existing_content'
    && contentIds.length >= 1
    && contentIds.length <= 25
    && contentIds.every((contentId) => contentId.length <= 128)
    && Number.isSafeInteger(durationSeconds)
    && Number(durationSeconds) >= 300
    && Number.isSafeInteger(maximumDurationSeconds)
    && Number(durationSeconds) <= Number(maximumDurationSeconds);
  if (!prospective && !reEvaluate) {
    throw policyError(400, 'feed_policy_application_contract_invalid');
  }
  return {
    mode: mode as FeedPolicyApplicationContract['mode'],
    contentIds,
    durationSeconds,
    historicalFacts: 'append_only',
    governanceEligibilityEffect: false,
    priorSanctionAggravation: false,
  };
}

export function resolveFeedRankingPolicyContract(input: {
  signalKeys: string[];
  defaultFactorBps: number;
  maxDurationSeconds: number;
  maxActiveRatioBps: number;
}): FeedRankingPolicyContract {
  const signalKeys = Array.isArray(input.signalKeys)
    ? [...new Set(input.signalKeys.map((value) => String(value).trim()).filter(Boolean))].sort()
    : [];
  if (
    signalKeys.length < 1
    || signalKeys.length > ALLOWED_SIGNALS.size
    || signalKeys.some((value) => !ALLOWED_SIGNALS.has(value))
    || !Number.isSafeInteger(input.defaultFactorBps)
    || input.defaultFactorBps < 100
    || input.defaultFactorBps > 9000
    || !Number.isSafeInteger(input.maxDurationSeconds)
    || input.maxDurationSeconds < 300
    || input.maxDurationSeconds > 86400
    || !Number.isSafeInteger(input.maxActiveRatioBps)
    || input.maxActiveRatioBps < 1
    || input.maxActiveRatioBps > 5000
  ) throw policyError(400, 'feed_ranking_policy_contract_invalid');
  return {
    contractVersion: 'feed-ranking-policy-current',
    signalKeys,
    targetScope: 'public_circle_root_posts',
    defaultFactorBps: input.defaultFactorBps,
    maxDurationSeconds: input.maxDurationSeconds,
    maxActiveRatioBps: input.maxActiveRatioBps,
    policyApplication: 'prospective_only',
    aiActivation: false,
    rollback: 'superseding_version_and_effect_expiry',
  };
}

export function publicFeedRankingPolicy(policy: any) {
  if (
    !policy
    || !['active', 'superseded'].includes(String(policy.status))
    || policy.prospectiveOnly !== true
    || policy.aiActivation !== false
  ) throw policyError(409, 'feed_ranking_policy_readback_invalid');
  const contract = resolveFeedRankingPolicyContract({
    signalKeys: Array.isArray(policy.signals) ? policy.signals.map(String) : [],
    defaultFactorBps: Number(policy.defaultFactorBps),
    maxDurationSeconds: Number(policy.maxDurationSeconds),
    maxActiveRatioBps: Number(policy.maxActiveRatioBps),
  });
  return {
    ...contract,
    id: String(policy.id),
    circleId: Number(policy.circleId),
    version: Number(policy.version),
    status: String(policy.status) as 'active' | 'superseded',
    configDigest: String(policy.configDigest),
    sourceReceiptId: String(policy.sourceReceiptId ?? ''),
    activatedAt: date(policy.activatedAt).toISOString(),
  };
}

export async function readActiveFeedRankingPolicy(prisma: any, circleId: number) {
  const policy = await prisma.feedRankingPolicyVersion.findFirst({
    where: { circleId, status: 'active' },
    orderBy: { version: 'desc' },
  });
  return policy ? publicFeedRankingPolicy(policy) : null;
}

export async function resolveFeedGovernanceActorCapability(
  prisma: any,
  input: { circleId: number; actorPubkey: string },
) {
  const actorPubkey = canonicalSolanaPublicKeyString(input.actorPubkey);
  if (!actorPubkey || actorPubkey !== input.actorPubkey) {
    throw policyError(400, 'feed_governance_actor_invalid');
  }
  const actionTypes = {
    updatePolicy: FEED_RANKING_POLICY_UPDATE_ACTION_TYPE,
    startExperiment: FEED_RECOMMENDATION_EXPERIMENT_START_ACTION_TYPE,
    stopExperiment: FEED_RECOMMENDATION_EXPERIMENT_STOP_ACTION_TYPE,
    downrankContent: CONTENT_VISIBILITY_DOWNRANK_ACTION_TYPE,
  } as const;
  const actionKeys = Object.keys(actionTypes) as Array<keyof typeof actionTypes>;
  const resolutions = await Promise.all(actionKeys.map(async (key) => [
    key,
    await resolveActiveCircleGovernanceBinding(prisma, {
      targetCircleId: input.circleId,
      actionType: actionTypes[key],
      purpose: 'operational_execution',
    }),
  ] as const));
  const eligibleByCommittee = new Map<number, Awaited<ReturnType<typeof listCommitteeEligibleActors>>>();
  const actions = {
    updatePolicy: false,
    startExperiment: false,
    stopExperiment: false,
    downrankContent: false,
  };
  const committeeCircleIds = {
    updatePolicy: null as number | null,
    startExperiment: null as number | null,
    stopExperiment: null as number | null,
    downrankContent: null as number | null,
  };
  let hasSharedCommitteeBinding = false;
  for (const [key, resolved] of resolutions) {
    if (!resolved || resolved.binding.bindingType !== 'shared_committee') continue;
    hasSharedCommitteeBinding = true;
    const committeeCircleId = resolved.binding.committeeCircleId;
    committeeCircleIds[key] = committeeCircleId;
    let eligible = eligibleByCommittee.get(committeeCircleId);
    if (!eligible) {
      eligible = await listCommitteeEligibleActors(prisma, { committeeCircleId });
      eligibleByCommittee.set(committeeCircleId, eligible);
    }
    actions[key] = hasExactFeedGovernanceActionCapability(
      resolved.binding,
      eligible,
      actorPubkey,
    );
  }
  const canOperate = Object.values(actions).some(Boolean);
  return {
    canOperate,
    actions,
    reason: canOperate
      ? null
      : hasSharedCommitteeBinding
        ? 'exact_frozen_committee_operator_required' as const
        : 'shared_committee_binding_required' as const,
    committeeCircleIds,
  };
}

export function hasExactFeedGovernanceActionCapability(
  binding: {
    bindingType: string;
    operatorPolicy?: {
      selector: { frozenActors: Array<{ pubkey: string }> };
    } | null;
  },
  eligible: Array<{ pubkey: string; role?: string | null }>,
  actorPubkey: string,
): boolean {
  const current = eligible.find((candidate) => candidate.pubkey === actorPubkey);
  return Boolean(
    binding.bindingType === 'shared_committee'
    && current
    && isGovernanceCommitteeOperator(current)
    && binding.operatorPolicy?.selector.frozenActors.some(
      (candidate) => candidate.pubkey === actorPubkey,
    ),
  );
}

export async function executeSharedCommitteeFeedRankingPolicyUpdate(
  prisma: PrismaClient,
  input: {
    circleId: number;
    actorPubkey: string;
    signalKeys: string[];
    defaultFactorBps: number;
    maxDurationSeconds: number;
    maxActiveRatioBps: number;
    applicationMode?: 'prospective_only' | 're_evaluate_existing_content';
    reEvaluateContentIds?: string[];
    reEvaluateDurationSeconds?: number | null;
    reasonCode: string;
    idempotencyKey: string;
  },
) {
  if (!Number.isSafeInteger(input.circleId) || input.circleId <= 0) {
    throw policyError(400, 'invalid_circle_id');
  }
  const actorPubkey = canonicalSolanaPublicKeyString(input.actorPubkey);
  const reasonCode = input.reasonCode.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  if (!actorPubkey || actorPubkey !== input.actorPubkey
    || !reasonCode || reasonCode.length > 96
    || !idempotencyKey || idempotencyKey.length > 128) {
    throw policyError(400, 'feed_ranking_policy_input_invalid');
  }
  const requestedContract = resolveFeedRankingPolicyContract(input);
  const requestedApplication = resolveFeedPolicyApplicationContract({
    mode: input.applicationMode,
    contentIds: input.reEvaluateContentIds,
    durationSeconds: input.reEvaluateDurationSeconds,
    maximumDurationSeconds: input.maxDurationSeconds,
  });
  return (prisma as any).$transaction(async (tx: any) => {
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      `feed-ranking-policy:${input.circleId}`,
    );
    const existingInvocation = await tx.governedActionInvocation.findFirst({
      where: {
        actorPubkey,
        subjectType: 'feed_ranking_policy',
        subjectRef: String(input.circleId),
        idempotencyKey,
        contractVersion: { actionType: FEED_RANKING_POLICY_UPDATE_ACTION_TYPE },
      },
      orderBy: { createdAt: 'desc' },
    });
    const existingPayload = record(existingInvocation?.requestedEffect);
    const frozenContract = existingInvocation
      ? resolveFeedRankingPolicyContract({
        signalKeys: Array.isArray(existingPayload.signalKeys) ? existingPayload.signalKeys : [],
        defaultFactorBps: Number(existingPayload.defaultFactorBps),
        maxDurationSeconds: Number(existingPayload.maxDurationSeconds),
        maxActiveRatioBps: Number(existingPayload.maxActiveRatioBps),
      })
      : requestedContract;
    const frozenApplication = existingInvocation
      ? resolveFeedPolicyApplicationContract({
        ...record(existingPayload.application),
        maximumDurationSeconds: frozenContract.maxDurationSeconds,
      })
      : requestedApplication;
    if (JSON.stringify(frozenContract) !== JSON.stringify(requestedContract)) {
      throw policyError(409, 'feed_ranking_policy_idempotency_conflict');
    }
    if (JSON.stringify(frozenApplication) !== JSON.stringify(requestedApplication)) {
      throw policyError(409, 'feed_ranking_policy_idempotency_conflict');
    }
    const active = await tx.feedRankingPolicyVersion.findFirst({
      where: { circleId: input.circleId, status: 'active' },
      orderBy: { version: 'desc' },
    });
    const priorVersion = existingInvocation
      ? Number(existingPayload.priorVersion)
      : Number(active?.version ?? 0);
    const nextVersion = existingInvocation
      ? Number(existingPayload.version)
      : priorVersion + 1;
    const policyId = `feed-policy:${input.circleId}:v${nextVersion}`;
    if (!Number.isSafeInteger(priorVersion) || !Number.isSafeInteger(nextVersion)
      || nextVersion !== priorVersion + 1
      || (existingInvocation && existingPayload.policyId !== policyId)) {
      throw policyError(409, 'feed_ranking_policy_version_invalid');
    }
    const configDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.feed-ranking-policy', frozenContract,
    );
    const now = new Date();
    const payload = {
      ...frozenContract,
      application: frozenApplication,
      policyId,
      priorVersion,
      version: nextVersion,
      configDigest,
      activatedAt: String(existingPayload.activatedAt ?? now.toISOString()),
    };
    const gateway = new GovernedActionGateway({
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
    const outcome = await gateway.executeSharedCommitteeOperation({
      actionType: FEED_RANKING_POLICY_UPDATE_ACTION_TYPE,
      targetCircleId: input.circleId,
      targetType: 'feed_ranking_policy',
      targetRef: String(input.circleId),
      actorPubkey,
      payload,
      reasonCode,
      idempotencyKey,
      execute: async () => {
        if ((active?.version ?? 0) !== priorVersion) {
          throw policyError(409, 'feed_ranking_policy_active_version_changed');
        }
        if (active) {
          if (active.sourceEffectId) {
            await transitionOperationEffectInTransaction(tx, {
              effectId: active.sourceEffectId,
              nextState: 'superseded',
              reasonCode: 'feed_ranking_policy_superseded',
              actorPubkey,
              sourceReceiptId: null,
              occurredAt: now,
            });
          }
          const superseded = await tx.feedRankingPolicyVersion.updateMany({
            where: { id: active.id, status: 'active', version: priorVersion },
            data: { status: 'superseded', supersededAt: now },
          });
          if (superseded.count !== 1) throw policyError(409, 'feed_ranking_policy_supersede_conflict');
        }
        const created = await tx.feedRankingPolicyVersion.create({ data: {
          id: policyId,
          circleId: input.circleId,
          version: nextVersion,
          status: 'active',
          signals: frozenContract.signalKeys,
          targetScope: frozenContract.targetScope,
          defaultFactorBps: frozenContract.defaultFactorBps,
          maxDurationSeconds: frozenContract.maxDurationSeconds,
          maxActiveRatioBps: frozenContract.maxActiveRatioBps,
          prospectiveOnly: true,
          aiActivation: false,
          configDigest,
          activatedAt: date(payload.activatedAt),
        } });
        return {
          result: { ...publicFeedRankingPolicy({ ...created, sourceReceiptId: 'pending' }), sourceReceiptId: null },
          executionRef: `feed-ranking-policy:${input.circleId}:v${nextVersion}`,
        };
      },
    });
    const effect = await tx.operationEffect.findUnique({
      where: { invocationId: outcome.receipt.invocationId },
    });
    if (!effect || effect.initialReceiptId !== outcome.receipt.id
      || (!outcome.replayed && effect.state !== 'active')
      || (outcome.replayed && !['active', 'superseded'].includes(effect.state))) {
      throw policyError(409, 'feed_ranking_policy_effect_readback_mismatch');
    }
    if (!outcome.replayed) {
      const linked = await tx.feedRankingPolicyVersion.updateMany({
        where: { id: policyId, status: 'active', sourceReceiptId: null, sourceEffectId: null },
        data: { sourceReceiptId: outcome.receipt.id, sourceEffectId: effect.id },
      });
      if (linked.count !== 1) throw policyError(409, 'feed_ranking_policy_link_conflict');
    }
    const durable = await tx.feedRankingPolicyVersion.findUnique({ where: { id: policyId } });
    if (!durable || durable.sourceReceiptId !== outcome.receipt.id
      || durable.sourceEffectId !== effect.id || durable.configDigest !== configDigest) {
      throw policyError(409, 'feed_ranking_policy_readback_mismatch');
    }
    return { ...outcome, result: publicFeedRankingPolicy(durable) };
  });
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any> : {};
}

function date(value: unknown): Date {
  const parsed = value instanceof Date ? value : new Date(String(value ?? ''));
  if (!Number.isFinite(parsed.getTime())) throw policyError(409, 'feed_ranking_policy_timestamp_invalid');
  return parsed;
}

function policyError(statusCode: number, code: string): Error {
  return Object.assign(new Error(code), { statusCode });
}
