import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import {
    summarizeDiscussionThread,
    DiscussionSummaryResult,
} from '../discussion-summary';
import { enqueueDiscussionTriggerEvaluationJob } from '../discussion-draft-trigger';
import { resolveDiscussionPolicyForCircle } from './policy';
import { analyzeDiscussionMessage } from './analyzer';
import { analyzeDiscussionMessageCanonical } from '../../services/discussion/analysis/service';
import {
    DiscussionIntelligencePolicy,
    DiscussionMessageScoreInput,
    DiscussionMessageScoreResult,
    DiscussionSummaryInput,
} from './types';

export interface DiscussionIntelligence {
    resolvePolicy(circleId: number): Promise<DiscussionIntelligencePolicy>;
    scoreMessage(input: DiscussionMessageScoreInput): Promise<DiscussionMessageScoreResult>;
    summarizeMessages(input: DiscussionSummaryInput): Promise<DiscussionSummaryResult>;
    triggerDraftFromDiscussion(input: {
        circleId: number;
        requestedByUserId?: number | null;
    }): Promise<{ triggered: boolean; reason: string; draftPostId?: number; jobId?: number }>;
}

export function createDiscussionIntelligence(input: {
    prisma: PrismaClient;
    redis: Redis;
}): DiscussionIntelligence {
    return {
        async resolvePolicy(circleId: number): Promise<DiscussionIntelligencePolicy> {
            return resolveDiscussionPolicyForCircle(input.prisma, circleId);
        },

        async scoreMessage(params: DiscussionMessageScoreInput): Promise<DiscussionMessageScoreResult> {
            if (Number.isFinite(params.circleId)) {
                const analysis = await analyzeDiscussionMessageCanonical({
                    prisma: input.prisma,
                    circleId: Number(params.circleId),
                    text: params.text,
                    authorAnnotations: [],
                });
                return {
                    score: analysis.semanticScore ?? 0,
                    semanticScore: analysis.semanticScore ?? 0,
                    qualityScore: analysis.qualityScore ?? 0,
                    spamScore: analysis.spamScore ?? 0,
                    decisionConfidence: analysis.decisionConfidence ?? 0,
                    isOnTopic: analysis.focusLabel !== 'off_topic',
                    method: analysis.relevanceMethod || 'fallback_rule',
                    rationale: analysis.featureReason || undefined,
                };
            }

            const analyzed = await analyzeDiscussionMessage({
                text: params.text,
                circleContext: params.circleContext,
                useLLM: Boolean(params.relevanceMode === 'hybrid'),
            });
            return {
                score: analyzed.semanticScore,
                semanticScore: analyzed.semanticScore,
                qualityScore: analyzed.qualityScore,
                spamScore: analyzed.spamScore,
                decisionConfidence: analyzed.confidence,
                isOnTopic: analyzed.isOnTopic,
                method: analyzed.method || 'rule',
                rationale: analyzed.rationale,
            };
        },

        async summarizeMessages(params: DiscussionSummaryInput): Promise<DiscussionSummaryResult> {
            let useLLM = params.useLLM;
            if (useLLM === undefined && Number.isFinite(params.circleId)) {
                const policy = await resolveDiscussionPolicyForCircle(
                    input.prisma,
                    Number(params.circleId),
                );
                useLLM = policy.settings.summaryUseLLM;
            }

            return summarizeDiscussionThread({
                circleName: params.circleName,
                circleDescription: params.circleDescription,
                useLLM,
                messages: params.messages,
            });
        },

        async triggerDraftFromDiscussion(params: {
            circleId: number;
            requestedByUserId?: number | null;
        }): Promise<{ triggered: boolean; reason: string; draftPostId?: number; jobId?: number }> {
            const job = await enqueueDiscussionTriggerEvaluationJob(input.prisma, {
                circleId: params.circleId,
                requestedByUserId: params.requestedByUserId ?? null,
            });
            return {
                triggered: true,
                reason: 'enqueued',
                jobId: job.id,
            };
        },
    };
}
