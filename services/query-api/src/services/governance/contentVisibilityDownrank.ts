import type { PrismaClient } from '@prisma/client';

import {
  CONTENT_VISIBILITY_DOWNRANK_ACTION_TYPE,
  createGovernedActionRegistry,
} from './actionRegistry';
import {
  listCommitteeEligibleActors,
  resolveActiveCircleGovernanceBinding,
} from './circleGovernanceBindings';
import { hashCanonicalGovernanceValue } from './canonicalCodec';
import {
  GovernedActionGateway,
  projectGovernedDirectOperationReceipt,
} from './governedActionGateway';
import {
  GOVERNED_ACTION_APPEAL_NO_AGGRAVATION_BOUNDARY,
  openGovernedActionAppeal,
  projectGovernedActionAppealRouting,
} from './governedActionAppeal';
import { resolveFeedRankingPolicyContract } from './feedRankingPolicy';
import { readActiveFeedRecommendationExperimentInTransaction } from './feedRecommendationExperiment';
import { transitionOperationEffectInTransaction } from './operationEffectLifecycle';
import { createPrismaGovernanceRequestStore } from './policyEngine';
import { canonicalSolanaPublicKeyString } from '../identity/solanaPublicKey';
import { createGovernanceCaseIntake } from './governanceCase';
import { isGovernanceCommitteeOperator } from './circleCommitteeActors';
import { CONTENT_VISIBILITY_DOWNRANK_APPEAL_KIND } from './contentVisibilityDownrankAppeal';

export {
  contentVisibilityDownrankAppealPayload,
  resolveContentVisibilityDownrankAppealInTransaction,
} from './contentVisibilityDownrankAppeal';

export interface ContentVisibilityDownrankContract {
  contractVersion: 'content-visibility-downrank-current';
  factorBps: number;
  durationSeconds: number;
  expiresAt: Date;
  scope: 'single_circle_feed_post';
  signals: 'frozen_post_ranking_inputs';
  activation: 'shared_committee_exact_actor_only';
  aiActivation: false;
  rollback: 'scheduler_read_and_governance_case_reconciliation';
  audit: 'canonical_operation_receipt_and_effect';
  appeal: 'canonical_operation_receipt_window';
  publicProjection: 'ranking_adjusted_until_expiry';
  delete: false;
  authorRestriction: false;
  governanceEligibilityEffect: false;
}

export function resolveContentVisibilityDownrankContract(input: {
  factorBps: number;
  durationSeconds: number;
  now: Date;
  expiresAt?: Date;
}): ContentVisibilityDownrankContract {
  if (
    !Number.isSafeInteger(input.factorBps)
    || input.factorBps < 100
    || input.factorBps > 9000
    || !Number.isSafeInteger(input.durationSeconds)
    || input.durationSeconds < 5 * 60
    || input.durationSeconds > 24 * 60 * 60
    || !(input.now instanceof Date)
    || !Number.isFinite(input.now.getTime())
  ) throw new Error('content_visibility_downrank_contract_invalid');
  const expiresAt = input.expiresAt
    ?? new Date(input.now.getTime() + input.durationSeconds * 1000);
  if (
    !Number.isFinite(expiresAt.getTime())
    || expiresAt.getTime() - input.now.getTime() !== input.durationSeconds * 1000
  ) throw new Error('content_visibility_downrank_contract_invalid');
  return {
    contractVersion: 'content-visibility-downrank-current',
    factorBps: input.factorBps,
    durationSeconds: input.durationSeconds,
    expiresAt,
    scope: 'single_circle_feed_post',
    signals: 'frozen_post_ranking_inputs',
    activation: 'shared_committee_exact_actor_only',
    aiActivation: false,
    rollback: 'scheduler_read_and_governance_case_reconciliation',
    audit: 'canonical_operation_receipt_and_effect',
    appeal: 'canonical_operation_receipt_window',
    publicProjection: 'ranking_adjusted_until_expiry',
    delete: false,
    authorRestriction: false,
    governanceEligibilityEffect: false,
  };
}

export function publicContentVisibilityDownrankState(post: {
  downranked?: boolean | null;
  downrankFactorBps?: number | null;
  downrankExpiresAt?: Date | string | null;
  downrankOperationEffectId?: string | null;
  downrankReasonCode?: string | null;
}) {
  if (post.downranked !== true) return { state: 'normal' as const, factorBps: null, expiresAt: null };
  const expiresAt = post.downrankExpiresAt instanceof Date
    ? post.downrankExpiresAt
    : new Date(String(post.downrankExpiresAt ?? ''));
  const factorBps = Number(post.downrankFactorBps);
  if (!Number.isSafeInteger(factorBps) || factorBps < 100 || factorBps > 9000
    || !Number.isFinite(expiresAt.getTime())) {
    throw new Error('content_visibility_downrank_readback_invalid');
  }
  return {
    state: 'adjusted' as const,
    factorBps,
    expiresAt: expiresAt.toISOString(),
  };
}

export function resolveContentVisibilityDownrankRatio(input: {
  policy: { id: string; configDigest: string; maxActiveRatioBps: number };
  experiment: null | {
    experimentId: string;
    policyId: string;
    policyConfigDigest: string;
    targetRatioBps: number;
    effectId: string;
    receiptId: string;
    state: string;
  };
}) {
  if (!input.experiment) {
    return { effectiveMaxActiveRatioBps: input.policy.maxActiveRatioBps, experiment: null };
  }
  if (input.experiment.state !== 'active'
    || input.experiment.policyId !== input.policy.id
    || input.experiment.policyConfigDigest !== input.policy.configDigest
    || !Number.isSafeInteger(input.experiment.targetRatioBps)
    || input.experiment.targetRatioBps < 1
    || input.experiment.targetRatioBps > input.policy.maxActiveRatioBps
    || !input.experiment.effectId
    || !input.experiment.receiptId) {
    throw downrankError(409, 'content_visibility_downrank_experiment_policy_mismatch');
  }
  return {
    effectiveMaxActiveRatioBps: input.experiment.targetRatioBps,
    experiment: {
      experimentId: input.experiment.experimentId,
      effectId: input.experiment.effectId,
      receiptId: input.experiment.receiptId,
      targetRatioBps: input.experiment.targetRatioBps,
    },
  };
}

export async function executeSharedCommitteeContentVisibilityDownrank(
  prisma: PrismaClient,
  input: {
    circleId: number;
    actorPubkey: string;
    contentId: string;
    factorBps: number;
    durationSeconds: number;
    rankingPolicyId?: string;
    reasonCode: string;
    idempotencyKey: string;
  },
) {
  const actorPubkey = canonicalSolanaPublicKeyString(input.actorPubkey);
  const contentId = input.contentId.trim();
  const reasonCode = input.reasonCode.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  if (!Number.isSafeInteger(input.circleId) || input.circleId <= 0) {
    throw downrankError(400, 'invalid_circle_id');
  }
  if (!actorPubkey || actorPubkey !== input.actorPubkey || !contentId || contentId.length > 128) {
    throw downrankError(400, 'content_visibility_downrank_subject_invalid');
  }
  if (!reasonCode || reasonCode.length > 96 || !idempotencyKey || idempotencyKey.length > 128) {
    throw downrankError(400, 'content_visibility_downrank_input_invalid');
  }
  const targetRef = `${input.circleId}:${contentId}`;
  const run = async (tx: PrismaClient) => {
    const now = new Date();
    await (tx as any).$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      `content-visibility-downrank-circle:${input.circleId}`,
    );
    await (tx as any).$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      `content-visibility-downrank:${targetRef}`,
    );
    const post = await (tx as any).post.findUnique({
      where: { contentId },
      include: { author: { select: { id: true, pubkey: true } } },
    });
    if (
      !post
      || post.circleId !== input.circleId
      || !['Active', 'Published'].includes(String(post.status))
      || post.isV2Draft === true
      || post.parentPostId != null
      || post.visibility === 'Private'
    ) throw downrankError(404, 'content_visibility_downrank_target_not_found');

    const existingInvocation = await (tx as any).governedActionInvocation.findFirst({
      where: {
        actorPubkey,
        subjectType: 'feed_post',
        subjectRef: targetRef,
        idempotencyKey,
        contractVersion: { actionType: CONTENT_VISIBILITY_DOWNRANK_ACTION_TYPE },
      },
      orderBy: { createdAt: 'desc' },
    });
    const requestedEffect = record(existingInvocation?.requestedEffect);
    if (existingInvocation && (
      requestedEffect.contractVersion !== 'content-visibility-downrank-current'
      || requestedEffect.contentId !== contentId
      || Number(requestedEffect.factorBps) !== input.factorBps
      || Number(requestedEffect.durationSeconds) !== input.durationSeconds
      || existingInvocation.reasonDigest !== hashCanonicalGovernanceValue(
        'alcheme.governance.action-reason',
        { reasonCode },
      )
    )) throw downrankError(409, 'content_visibility_downrank_idempotency_conflict');

    const frozenPolicyRef = record(requestedEffect.rankingPolicy);
    const rankingPolicy = existingInvocation
      ? await (tx as any).feedRankingPolicyVersion.findUnique({
        where: { id: String(frozenPolicyRef.id ?? '') },
      })
      : await (tx as any).feedRankingPolicyVersion.findFirst({
        where: { circleId: input.circleId, status: 'active' },
        orderBy: { version: 'desc' },
      });
    if (!rankingPolicy || rankingPolicy.circleId !== input.circleId
      || (!existingInvocation && rankingPolicy.status !== 'active')
      || (input.rankingPolicyId != null && rankingPolicy.id !== input.rankingPolicyId)
      || rankingPolicy.configDigest !== String(frozenPolicyRef.configDigest ?? rankingPolicy.configDigest)) {
      throw downrankError(409, 'content_visibility_downrank_active_policy_required');
    }
    const rankingContract = resolveFeedRankingPolicyContract({
      signalKeys: Array.isArray(rankingPolicy.signals) ? rankingPolicy.signals.map(String) : [],
      defaultFactorBps: Number(rankingPolicy.defaultFactorBps),
      maxDurationSeconds: Number(rankingPolicy.maxDurationSeconds),
      maxActiveRatioBps: Number(rankingPolicy.maxActiveRatioBps),
    });
    if (input.factorBps !== rankingContract.defaultFactorBps
      || input.durationSeconds > rankingContract.maxDurationSeconds) {
      throw downrankError(409, 'content_visibility_downrank_policy_bounds_exceeded');
    }
    const activeExperiment = await readActiveFeedRecommendationExperimentInTransaction(tx as any, {
      circleId: input.circleId,
      now,
    });
    const ratio = resolveContentVisibilityDownrankRatio({
      policy: {
        id: rankingPolicy.id,
        configDigest: rankingPolicy.configDigest,
        maxActiveRatioBps: rankingContract.maxActiveRatioBps,
      },
      experiment: activeExperiment,
    });
    if (!existingInvocation) {
      const [eligibleCount, activeCount] = await Promise.all([
        (tx as any).post.count({ where: {
          circleId: input.circleId,
          parentPostId: null,
          isV2Draft: false,
          visibility: { not: 'Private' },
          status: { in: ['Active', 'Published'] },
        } }),
        (tx as any).post.count({ where: {
          circleId: input.circleId,
          downranked: true,
          downrankExpiresAt: { gt: now },
        } }),
      ]);
      const activeLimit = Math.max(1, Math.floor(
        Number(eligibleCount) * ratio.effectiveMaxActiveRatioBps / 10_000,
      ));
      if (Number(activeCount) + 1 > activeLimit) {
        throw downrankError(409, 'content_visibility_downrank_policy_ratio_exceeded');
      }
    }

    const frozenDownrankedAt = requestedEffect.downrankedAt == null
      ? undefined
      : date(requestedEffect.downrankedAt);
    const frozenExpiry = requestedEffect.expiresAt == null
      ? undefined
      : new Date(String(requestedEffect.expiresAt));
    const downrankedAt = frozenDownrankedAt ?? now;
    const contract = resolveContentVisibilityDownrankContract({
      factorBps: input.factorBps,
      durationSeconds: input.durationSeconds,
      now: downrankedAt,
      ...(frozenExpiry ? { expiresAt: frozenExpiry } : {}),
    });
    const currentSignals = {
      contentId,
      circleId: input.circleId,
      authorPubkey: String(post.author?.pubkey ?? ''),
      contentType: String(post.contentType),
      visibility: String(post.visibility),
      status: String(post.status),
      createdAt: date(post.createdAt).toISOString(),
      updatedAt: date(post.updatedAt).toISOString(),
      heatScore: String(post.heatScore),
      likesCount: Number(post.likesCount),
      repostsCount: Number(post.repostsCount),
      repliesCount: Number(post.repliesCount),
      viewsCount: Number(post.viewsCount),
      tags: Array.isArray(post.tags) ? [...post.tags].map(String).sort() : [],
    };
    const frozenSignals = existingInvocation
      ? record(requestedEffect.frozenSignals)
      : currentSignals;
    const expectedEvidenceDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.content-visibility-downrank-evidence',
      frozenSignals,
    );
    const evidenceDigest = existingInvocation
      ? String(requestedEffect.evidenceDigest ?? '')
      : expectedEvidenceDigest;
    if (
      frozenSignals.contentId !== contentId
      || Number(frozenSignals.circleId) !== input.circleId
      || frozenSignals.authorPubkey !== String(post.author?.pubkey ?? '')
      || evidenceDigest !== expectedEvidenceDigest
    ) throw downrankError(409, 'content_visibility_downrank_frozen_evidence_mismatch');
    const payload = {
      ...contract,
      rankingPolicy: {
        id: rankingPolicy.id,
        version: rankingPolicy.version,
        configDigest: rankingPolicy.configDigest,
        signalKeys: rankingContract.signalKeys,
        maxActiveRatioBps: rankingContract.maxActiveRatioBps,
      },
      recommendationExperiment: ratio.experiment,
      downrankedAt: downrankedAt.toISOString(),
      expiresAt: contract.expiresAt.toISOString(),
      contentId,
      targetRef,
      evidenceDigest,
      frozenSignals,
    };
    const gateway = new GovernedActionGateway({
      registry: createGovernedActionRegistry({
        includePhase1Defaults: true,
        includeFeedGovernanceActions: true,
      }),
      resolveBinding: (bindingInput) => resolveActiveCircleGovernanceBinding(tx as any, bindingInput),
      listCommitteeEligibleActors: (eligibleInput) => listCommitteeEligibleActors(tx as any, eligibleInput),
      requestStore: createPrismaGovernanceRequestStore(tx as any),
      runtimePrisma: tx as any,
      runtimeTransactionClient: true,
      now: () => now,
    });
    const outcome = await gateway.executeSharedCommitteeOperation({
      actionType: CONTENT_VISIBILITY_DOWNRANK_ACTION_TYPE,
      targetCircleId: input.circleId,
      targetType: 'feed_post',
      targetRef,
      actorPubkey,
      payload,
      reasonCode,
      idempotencyKey,
      execute: async () => {
        const updated = await (tx as any).post.updateMany({
          where: {
            contentId,
            circleId: input.circleId,
            downranked: false,
            updatedAt: post.updatedAt,
          },
          data: {
            downranked: true,
            downrankFactorBps: contract.factorBps,
            downrankedAt: now,
            downrankExpiresAt: contract.expiresAt,
            downrankReasonCode: reasonCode,
            downrankEvidenceDigest: evidenceDigest,
            downrankOperationReceiptId: null,
            downrankOperationEffectId: null,
          },
        });
        if (updated.count !== 1) {
          throw downrankError(409, 'content_visibility_downrank_target_changed');
        }
        const readback = await (tx as any).post.findUnique({ where: { contentId } });
        if (!readback || readback.downranked !== true) {
          throw downrankError(409, 'content_visibility_downrank_readback_mismatch');
        }
        return {
          result: publicContentVisibilityDownrankState(readback),
          executionRef: `feed-post:${targetRef}:ranking-adjusted`,
        };
      },
    });
    const durable = await linkContentVisibilityDownrankInTransaction(tx as any, {
      contentId,
      downrankedAt,
      expiresAt: contract.expiresAt,
      factorBps: contract.factorBps,
      reasonCode,
      evidenceDigest,
      receipt: outcome.receipt,
      replayed: outcome.replayed,
    });
    if (!outcome.replayed && post.author?.id) {
      await (tx as any).notification.create({
        data: {
          userId: post.author.id,
          type: 'governance_moderation',
          title: 'Feed ranking was temporarily adjusted',
          body: `This post returns to normal ranking at ${contract.expiresAt.toISOString()}.`,
          sourceType: 'operation_receipt',
          sourceId: outcome.receipt.id,
          circleId: input.circleId,
          createdAt: now,
          metadata: {
            schemaVersion: 1,
            canonicalUrl: `/circles/${input.circleId}?tab=feed&post=${encodeURIComponent(contentId)}`,
            receiptId: outcome.receipt.id,
            contentId,
            expiresAt: contract.expiresAt.toISOString(),
            appealRef: outcome.receipt.appealRef,
            delete: 'not_executed',
            authorRestriction: 'not_applied',
          },
        },
      });
    }
    return {
      ...outcome,
      result: publicContentVisibilityDownrankState(durable.post),
      effect: {
        id: durable.effect.id,
        state: durable.effect.state,
        effectDigest: durable.effect.effectDigest,
      },
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
  throw downrankError(409, 'content_visibility_downrank_retry_exhausted');
}

async function linkContentVisibilityDownrankInTransaction(tx: any, input: {
  contentId: string;
  downrankedAt: Date;
  expiresAt: Date;
  factorBps: number;
  reasonCode: string;
  evidenceDigest: string;
  receipt: { id: string; invocationId: string };
  replayed: boolean;
}) {
  const effect = await tx.operationEffect.findUnique({
    where: { invocationId: input.receipt.invocationId },
  });
  if (!effect || effect.initialReceiptId !== input.receipt.id
    || !['active', 'expired', 'revoked'].includes(effect.state)) {
    throw downrankError(409, 'content_visibility_downrank_effect_readback_mismatch');
  }
  const expectedActive = effect.state === 'active';
  const current = await tx.post.findUnique({ where: { contentId: input.contentId } });
  if (!current || current.downranked !== expectedActive) {
    throw downrankError(409, 'content_visibility_downrank_readback_mismatch');
  }
  if (input.replayed) {
    if (current.downrankOperationReceiptId !== input.receipt.id
      || current.downrankOperationEffectId !== effect.id
      || current.downrankReasonCode !== input.reasonCode
      || current.downrankEvidenceDigest !== input.evidenceDigest
      || Number(current.downrankFactorBps) !== input.factorBps
      || date(current.downrankExpiresAt).getTime() !== input.expiresAt.getTime()) {
      throw downrankError(409, 'content_visibility_downrank_replay_mismatch');
    }
    return { post: current, effect };
  }
  if (!expectedActive) {
    throw downrankError(409, 'content_visibility_downrank_terminal_state_not_executable');
  }
  const updated = await tx.post.updateMany({
    where: {
      contentId: input.contentId,
      downranked: true,
      downrankedAt: input.downrankedAt,
      downrankExpiresAt: input.expiresAt,
      downrankFactorBps: input.factorBps,
      downrankReasonCode: input.reasonCode,
      downrankEvidenceDigest: input.evidenceDigest,
      downrankOperationReceiptId: null,
      downrankOperationEffectId: null,
    },
    data: {
      downrankOperationReceiptId: input.receipt.id,
      downrankOperationEffectId: effect.id,
    },
  });
  if (updated.count !== 1) {
    throw downrankError(409, 'content_visibility_downrank_link_cas_failed');
  }
  return {
    post: await tx.post.findUniqueOrThrow({ where: { contentId: input.contentId } }),
    effect,
  };
}

export async function reconcileExpiredContentVisibilityDownranks(
  prisma: any,
  input: { now?: Date; limit?: number; contentId?: string } = {},
) {
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
  const candidates = await prisma.post.findMany({
    where: {
      downranked: true,
      downrankExpiresAt: { lte: now },
      downrankOperationEffectId: { not: null },
      ...(input.contentId ? { contentId: input.contentId } : {}),
    },
    select: { contentId: true, downrankExpiresAt: true, downrankOperationEffectId: true },
    orderBy: [{ downrankExpiresAt: 'asc' }, { contentId: 'asc' }],
    take: limit,
  });
  const restored: string[] = [];
  const failures: Array<{ contentId: string; error: string }> = [];
  for (const candidate of candidates) {
    try {
      const result = await prisma.$transaction(async (tx: any) => {
        const post = await tx.post.findUnique({ where: { contentId: candidate.contentId } });
        if (!post || post.downranked !== true
          || post.downrankOperationEffectId !== candidate.downrankOperationEffectId
          || date(post.downrankExpiresAt).getTime() !== date(candidate.downrankExpiresAt).getTime()
          || date(post.downrankExpiresAt) > now) return 'stale';
        const effect = await tx.operationEffect.findUnique({
          where: { id: candidate.downrankOperationEffectId },
        });
        if (!effect) throw new Error('content_visibility_downrank_effect_missing');
        if (effect.state === 'active') {
          try {
            await transitionOperationEffectInTransaction(tx, {
              effectId: effect.id,
              nextState: 'expired',
              reasonCode: 'content_visibility_downrank_expired',
              actorPubkey: null,
              sourceReceiptId: null,
              occurredAt: now,
            });
          } catch (error) {
            if (!(error instanceof Error)
              || error.message !== 'operation_effect_transition_cas_failed') throw error;
            const [concurrentEffect, concurrentPost] = await Promise.all([
              tx.operationEffect.findUnique({ where: { id: effect.id } }),
              tx.post.findUnique({ where: { contentId: candidate.contentId } }),
            ]);
            if (!concurrentEffect
              || !['expired', 'revoked'].includes(concurrentEffect.state)
              || !concurrentPost
              || concurrentPost.downranked !== false
              || concurrentPost.downrankOperationEffectId !== effect.id) throw error;
            return 'stale';
          }
        } else if (!['expired', 'revoked'].includes(effect.state)) {
          throw new Error('content_visibility_downrank_effect_not_releasable');
        }
        const released = await tx.post.updateMany({
          where: {
            contentId: candidate.contentId,
            downranked: true,
            downrankOperationEffectId: effect.id,
          },
          data: { downranked: false },
        });
        if (released.count !== 1) {
          const concurrentPost = await tx.post.findUnique({
            where: { contentId: candidate.contentId },
          });
          if (concurrentPost?.downranked === false
            && concurrentPost.downrankOperationEffectId === effect.id) return 'stale';
          throw new Error('content_visibility_downrank_restore_cas_failed');
        }
        return effect.state === 'active' ? 'expired' : 'already_terminal';
      });
      if (result !== 'stale') restored.push(candidate.contentId);
    } catch (error) {
      failures.push({
        contentId: candidate.contentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { scanned: candidates.length, restored, failures };
}

export async function openContentVisibilityDownrankAppeal(
  prisma: PrismaClient,
  input: {
    circleId: number;
    contentId: string;
    originalReceiptId: string;
    appellantPubkey: string;
    reasonCode: string;
    evidence: Record<string, unknown>;
    now?: Date;
  },
) {
  const appellantPubkey = canonicalSolanaPublicKeyString(input.appellantPubkey);
  if (!appellantPubkey || appellantPubkey !== input.appellantPubkey) {
    throw downrankError(400, 'governed_action_appeal_appellant_invalid');
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
    const requestedEffect = record(invocation?.requestedEffect);
    const frozenSignals = record(requestedEffect.frozenSignals);
    const post = await tx.post.findUnique({
      where: { contentId: input.contentId },
      include: { author: { select: { pubkey: true } } },
    });
    if (
      !receipt
      || receipt.executionStatus !== 'succeeded'
      || !receipt.initialEffect
      || invocation?.contractVersion?.actionType !== CONTENT_VISIBILITY_DOWNRANK_ACTION_TYPE
      || invocation.governanceHomeType !== 'circle'
      || invocation.governanceHomeRef !== String(input.circleId)
      || invocation.subjectType !== 'feed_post'
      || invocation.subjectRef !== `${input.circleId}:${input.contentId}`
      || requestedEffect.contentId !== input.contentId
      || frozenSignals.authorPubkey !== appellantPubkey
      || !post
      || post.circleId !== input.circleId
      || post.author?.pubkey !== appellantPubkey
    ) throw downrankError(403, 'governed_action_appeal_appellant_not_subject');
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
    const now = input.now ?? new Date();
    const subjectRef = `${input.circleId}:${input.contentId}`;
    const collectiveAuthority = await resolveActiveCircleGovernanceBinding(tx, {
      targetCircleId: input.circleId,
      actionType: CONTENT_VISIBILITY_DOWNRANK_ACTION_TYPE,
      purpose: 'collective_decision',
      now,
      subjectType: 'feed_post',
      subjectRef,
    });
    if (!collectiveAuthority) return opened;
    const eligibleActors = await listCommitteeEligibleActors(tx, {
      committeeCircleId: collectiveAuthority.binding.committeeCircleId,
    });
    const coordinator = eligibleActors
      .filter((candidate: any) => (
        candidate.pubkey !== receipt.actorPubkey
        && candidate.pubkey !== appellantPubkey
      ))
      .find(isGovernanceCommitteeOperator);
    if (!coordinator) return opened;
    const appeal = await tx.governedActionAppeal.findUnique({
      where: { id: opened.appeal.id },
    });
    if (!appeal || !receipt.initialEffect) {
      throw downrankError(409, 'governed_action_appeal_owner_required');
    }
    const appealPayload = {
      kind: CONTENT_VISIBILITY_DOWNRANK_APPEAL_KIND,
      currentContract: 'content-visibility-downrank-current',
      appealId: appeal.id,
      circleId: input.circleId,
      contentId: input.contentId,
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
      title: 'Resolve feed ranking adjustment appeal',
      requestedDecision: 'Should the independent eligible electorate revoke this exact post ranking adjustment based on the frozen appeal evidence?',
      requestedActionPayload: { contentVisibilityDownrankAppeal: appealPayload },
      caseType: 'policy',
      templateId: 'basic-community',
      actionType: CONTENT_VISIBILITY_DOWNRANK_ACTION_TYPE,
      subjectType: 'feed_post',
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
      ) throw downrankError(409, 'governed_action_appeal_case_binding_conflict');
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

export async function readContentVisibilityDownrankAppealAccess(
  prisma: PrismaClient,
  input: { circleId: number; contentId: string; appellantPubkey: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const appellantPubkey = canonicalSolanaPublicKeyString(input.appellantPubkey);
  if (!appellantPubkey || appellantPubkey !== input.appellantPubkey) {
    throw downrankError(400, 'governed_action_appeal_appellant_invalid');
  }
  const reconciliation = await reconcileExpiredContentVisibilityDownranks(prisma as any, {
    now,
    limit: 1,
    contentId: input.contentId,
  });
  if (reconciliation.failures.length > 0) {
    throw downrankError(409, 'content_visibility_downrank_reconciliation_failed');
  }
  const post = await (prisma as any).post.findUnique({
    where: { contentId: input.contentId },
    include: { author: { select: { pubkey: true } } },
  });
  if (!post || post.circleId !== input.circleId || post.author?.pubkey !== appellantPubkey) {
    throw downrankError(403, 'governed_action_appeal_appellant_not_subject');
  }
  if (!post.downrankOperationReceiptId || !post.downrankOperationEffectId) {
    return { adjustment: null };
  }
  const receipt = await (prisma as any).operationReceipt.findUnique({
    where: { id: post.downrankOperationReceiptId },
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
  if (
    !receipt
    || receipt.initialEffect?.id !== post.downrankOperationEffectId
    || receipt.invocation?.contractVersion?.actionType !== CONTENT_VISIBILITY_DOWNRANK_ACTION_TYPE
    || receipt.invocation?.subjectType !== 'feed_post'
    || receipt.invocation?.subjectRef !== `${input.circleId}:${input.contentId}`
    || receipt.appeals.length > 1
  ) throw downrankError(409, 'content_visibility_downrank_appeal_owner_mismatch');
  const projected = projectGovernedDirectOperationReceipt(receipt);
  const appeal = receipt.appeals[0] ?? null;
  if (appeal && appeal.appellantPubkey !== appellantPubkey) {
    throw downrankError(409, 'content_visibility_downrank_appeal_subject_mismatch');
  }
  const deadline = new Date(receipt.appealWindowEndsAt);
  if (!Number.isFinite(deadline.getTime())) {
    throw downrankError(409, 'content_visibility_downrank_appeal_deadline_invalid');
  }
  return {
    adjustment: {
      contentId: input.contentId,
      state: publicContentVisibilityDownrankState(post),
      receipt: {
        id: projected.id,
        receiptDigest: projected.receiptDigest,
        completedAt: receipt.completedAt.toISOString(),
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
      authority: {
        bindingId: projected.roleAssignmentProof.bindingId,
        sourceType: projected.roleAssignmentProof.sourceType,
        sourceRef: projected.roleAssignmentProof.sourceRef,
        sourceVersion: projected.roleAssignmentProof.sourceVersion,
        policyVersionRef: projected.policyVersionRef,
        decisionPath: projected.roleAssignmentProof.decisionPath,
      },
      appealAccess: {
        access: 'canonical_post_author_session',
        membershipRequired: false,
        grantsOtherCirclePermissions: false,
        evidenceVisibility: 'appellant_and_independent_resolver_only',
        resolutionBoundary: GOVERNED_ACTION_APPEAL_NO_AGGRAVATION_BOUNDARY,
        deadline: deadline.toISOString(),
        routing: projectGovernedActionAppealRouting({
          actionType: CONTENT_VISIBILITY_DOWNRANK_ACTION_TYPE,
          circleId: input.circleId,
          receiptId: projected.id,
          deadline: deadline.toISOString(),
        }),
        status: appeal?.state ?? (now <= deadline ? 'available' : 'expired'),
        canSubmit: !appeal && now <= deadline,
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

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function date(value: unknown): Date {
  const parsed = value instanceof Date ? value : new Date(String(value ?? ''));
  if (!Number.isFinite(parsed.getTime())) {
    throw downrankError(409, 'content_visibility_downrank_timestamp_invalid');
  }
  return parsed;
}

function downrankError(statusCode: number, code: string): Error {
  return Object.assign(new Error(code), { statusCode });
}
