import type { PrismaClient } from '@prisma/client';

import { hashCanonicalGovernanceValue } from './canonicalCodec';
import { executeSharedCommitteeContentVisibilityDownrank } from './contentVisibilityDownrank';
import { readFeedRecommendationExperiments } from './feedRecommendationExperiment';
import {
  executeSharedCommitteeFeedRankingPolicyUpdate,
  resolveFeedGovernanceActorCapability,
  resolveFeedPolicyApplicationContract,
} from './feedRankingPolicy';

export async function updateFeedRankingPolicyWithApplication(
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
  const application = resolveFeedPolicyApplicationContract({
    mode: input.applicationMode,
    contentIds: input.reEvaluateContentIds,
    durationSeconds: input.reEvaluateDurationSeconds,
    maximumDurationSeconds: input.maxDurationSeconds,
  });
  const capability = await resolveFeedGovernanceActorCapability(prisma, {
    circleId: input.circleId,
    actorPubkey: input.actorPubkey,
  });
  if (!capability.actions.updatePolicy
    || (application.mode === 're_evaluate_existing_content'
      && !capability.actions.downrankContent)) {
    throw applicationError(403, 'feed_policy_application_exact_action_authority_required');
  }
  const experiments = await readFeedRecommendationExperiments(prisma, { circleId: input.circleId });
  if (experiments.some((experiment: { state: string }) => experiment.state === 'active')) {
    throw applicationError(409, 'feed_policy_update_active_experiment_must_stop');
  }
  const policyOutcome = await executeSharedCommitteeFeedRankingPolicyUpdate(prisma, {
    ...input,
    applicationMode: application.mode,
    reEvaluateContentIds: application.contentIds,
    reEvaluateDurationSeconds: application.durationSeconds,
  });
  const reEvaluation = [];
  const reEvaluationFailures: Array<{ contentId: string; error: string }> = [];
  if (application.mode === 're_evaluate_existing_content') {
    for (const contentId of application.contentIds) {
      const subjectIdempotencyKey = `feed-re-evaluate:${hashCanonicalGovernanceValue(
        'alcheme.governance.feed-policy-re-evaluation-subject',
        { policyReceiptId: policyOutcome.receipt.id, contentId },
      )}`;
      try {
        const outcome = await executeSharedCommitteeContentVisibilityDownrank(prisma, {
          circleId: input.circleId,
          actorPubkey: input.actorPubkey,
          contentId,
          factorBps: policyOutcome.result.defaultFactorBps,
          durationSeconds: application.durationSeconds as number,
          rankingPolicyId: policyOutcome.result.id,
          reasonCode: 'feed_policy_re_evaluation',
          idempotencyKey: subjectIdempotencyKey,
        });
        reEvaluation.push({
          contentId,
          receiptId: outcome.receipt.id,
          effectId: outcome.effect.id,
          authority: {
            bindingId: outcome.receipt.roleAssignmentProof.bindingId,
            sourceType: outcome.receipt.roleAssignmentProof.sourceType,
            sourceRef: outcome.receipt.roleAssignmentProof.sourceRef,
            sourceVersion: outcome.receipt.roleAssignmentProof.sourceVersion,
            decisionPath: outcome.receipt.roleAssignmentProof.decisionPath,
            policyVersionRef: outcome.receipt.policyVersionRef,
          },
          appeal: {
            ref: outcome.receipt.appealRef,
            deadline: outcome.receipt.appealWindowEndsAt,
            submission: {
              method: 'POST' as const,
              path: `/api/v1/circles/${input.circleId}/posts/${encodeURIComponent(contentId)}/downrank-appeals`,
            },
          },
          state: outcome.result.state,
          factorBps: outcome.result.factorBps,
          expiresAt: outcome.result.expiresAt,
          replayed: outcome.replayed,
        });
      } catch (error) {
        reEvaluationFailures.push({
          contentId,
          error: error instanceof Error ? error.message : 'feed_policy_re_evaluation_subject_failed',
        });
      }
    }
  }
  const reEvaluationStatus = application.mode === 'prospective_only'
    ? 'not_requested' as const
    : reEvaluationFailures.length === 0
      ? 'succeeded' as const
      : reEvaluation.length === 0 ? 'failed' as const : 'partial' as const;
  return {
    ...policyOutcome,
    application,
    reEvaluation,
    reEvaluationFailures,
    reEvaluationStatus,
  };
}

function applicationError(statusCode: number, code: string): Error {
  return Object.assign(new Error(code), { statusCode });
}
