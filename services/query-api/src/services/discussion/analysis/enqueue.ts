import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import { enqueueAiJob } from '../../aiJobs/runtime';
import { publishDiscussionRealtimeEvent } from '../realtime';
import { buildPendingDiscussionAnalysisResult } from './types';
import { runDiscussionAnalysisPostWriteEffects } from './postWriteEffects';
import { analyzeDiscussionMessageCanonical } from './service';

export async function enqueueDiscussionMessageAnalyzeJob(
    prisma: PrismaClient,
    input: {
        envelopeId: string;
        circleId: number;
        requestedByUserId?: number | null;
    },
) {
    return enqueueAiJob(prisma as any, {
        jobType: 'discussion_message_analyze',
        dedupeKey: `discussion_message_analyze:${input.envelopeId}`,
        scopeType: 'circle',
        scopeCircleId: input.circleId,
        requestedByUserId: input.requestedByUserId ?? null,
        payload: {
            envelopeId: input.envelopeId,
            circleId: input.circleId,
        },
    });
}

export async function runDiscussionMessageAnalyzeJob(input: {
    prisma: PrismaClient;
    redis: Redis;
    envelopeId: string;
    circleId: number;
    requestedByUserId?: number | null;
}): Promise<Record<string, unknown>> {
    const message = await input.prisma.circleDiscussionMessage.findUnique({
        where: { envelopeId: input.envelopeId },
        select: {
            envelopeId: true,
            circleId: true,
            payloadText: true,
            deleted: true,
            relevanceStatus: true,
            authorAnnotations: true,
        } as any,
    } as any) as {
        envelopeId: string;
        circleId: number;
        payloadText: string;
        deleted: boolean;
        relevanceStatus?: string | null;
        authorAnnotations?: Prisma.JsonValue | null;
    } | null;

    if (!message) {
        return {
            envelopeId: input.envelopeId,
            circleId: input.circleId,
            updated: false,
            reason: 'message_not_found',
        };
    }

    if (message.deleted) {
        return {
            envelopeId: input.envelopeId,
            circleId: input.circleId,
            updated: false,
            reason: 'message_deleted',
        };
    }

    try {
        const analysis = await analyzeDiscussionMessageCanonical({
            prisma: input.prisma,
            circleId: input.circleId,
            envelopeId: input.envelopeId,
            text: message.payloadText,
            authorAnnotations: message.authorAnnotations,
        });

        const rows = await input.prisma.$transaction(async (tx) => {
            const updatedRows = await tx.$queryRaw<Array<{ envelopeId: string }>>(Prisma.sql`
                UPDATE circle_discussion_messages
                SET
                    relevance_status = 'ready',
                    relevance_score = ${analysis.semanticScore},
                    semantic_score = ${analysis.semanticScore},
                    embedding_score = ${analysis.embeddingScore},
                    quality_score = ${analysis.qualityScore},
                    spam_score = ${analysis.spamScore},
                    decision_confidence = ${analysis.decisionConfidence},
                    relevance_method = ${analysis.relevanceMethod},
                    actual_mode = ${analysis.actualMode},
                    analysis_version = ${analysis.analysisVersion},
                    topic_profile_version = ${analysis.topicProfileVersion},
                    focus_score = ${analysis.focusScore},
                    focus_label = ${analysis.focusLabel},
                    semantic_facets = ${JSON.stringify(analysis.semanticFacets)}::jsonb,
                    is_featured = ${analysis.isFeatured},
                    feature_reason = ${analysis.featureReason},
                    featured_at = ${analysis.isFeatured ? analysis.analysisCompletedAt ?? new Date() : null},
                    analysis_completed_at = ${analysis.analysisCompletedAt ?? new Date()},
                    analysis_error_code = ${analysis.analysisErrorCode},
                    analysis_error_message = ${analysis.analysisErrorMessage},
                    updated_at = NOW()
                WHERE envelope_id = ${input.envelopeId}
                RETURNING envelope_id AS "envelopeId"
            `);

            const updated = updatedRows[0];
            if (!updated) {
                throw new Error('discussion_analysis_write_failed');
            }

            return updated;
        });

        await runDiscussionAnalysisPostWriteEffects({
            prisma: input.prisma,
            redis: input.redis,
            circleId: input.circleId,
            previousStatus: message.relevanceStatus,
            nextStatus: 'ready',
            requestedByUserId: input.requestedByUserId ?? null,
        });

        try {
            await publishDiscussionRealtimeEvent(input.redis, {
                circleId: input.circleId,
                envelopeId: rows.envelopeId,
                reason: 'message_refresh_required',
            });
        } catch {
            // best effort only
        }

        return {
            envelopeId: rows.envelopeId,
            circleId: input.circleId,
            updated: true,
            relevanceStatus: 'ready',
            method: analysis.relevanceMethod || 'fallback_rule',
            isFeatured: analysis.isFeatured,
        };
    } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        const rows = await input.prisma.$transaction(async (tx) => {
            const updatedRows = await tx.$queryRaw<Array<{ envelopeId: string }>>(Prisma.sql`
                UPDATE circle_discussion_messages
                SET
                    relevance_status = 'failed',
                    is_featured = FALSE,
                    feature_reason = NULL,
                    featured_at = NULL,
                    analysis_completed_at = NOW(),
                    analysis_error_code = 'discussion_analysis_failed',
                    analysis_error_message = ${messageText.slice(0, 512)},
                    updated_at = NOW()
                WHERE envelope_id = ${input.envelopeId}
                RETURNING envelope_id AS "envelopeId"
            `);

            const updated = updatedRows[0];
            if (!updated) {
                throw error;
            }
            return updated;
        });

        await runDiscussionAnalysisPostWriteEffects({
            prisma: input.prisma,
            redis: input.redis,
            circleId: input.circleId,
            previousStatus: message.relevanceStatus,
            nextStatus: 'failed',
            requestedByUserId: input.requestedByUserId ?? null,
        });

        try {
            await publishDiscussionRealtimeEvent(input.redis, {
                circleId: input.circleId,
                envelopeId: rows.envelopeId,
                reason: 'message_refresh_required',
            });
        } catch {
            // best effort only
        }

        return {
            envelopeId: rows.envelopeId,
            circleId: input.circleId,
            updated: true,
            relevanceStatus: 'failed',
            error: messageText,
        };
    }
}

export function buildPendingDiscussionAnalysisInsertValues(input: {
    authorAnnotations?: Prisma.JsonValue | null;
}) {
    const pending = buildPendingDiscussionAnalysisResult({
        authorAnnotations: [],
    });
    return {
        relevanceStatus: pending.relevanceStatus,
        relevanceScore: 1,
        semanticScore: pending.semanticScore,
        embeddingScore: pending.embeddingScore,
        qualityScore: pending.qualityScore,
        spamScore: pending.spamScore,
        decisionConfidence: pending.decisionConfidence,
        relevanceMethod: 'pending',
        actualMode: pending.actualMode,
        analysisVersion: pending.analysisVersion,
        topicProfileVersion: pending.topicProfileVersion,
        focusScore: pending.focusScore,
        focusLabel: pending.focusLabel,
        semanticFacetsJson: JSON.stringify(pending.semanticFacets),
        isFeatured: pending.isFeatured,
        featureReason: pending.featureReason,
        analysisCompletedAt: pending.analysisCompletedAt,
        analysisErrorCode: pending.analysisErrorCode,
        analysisErrorMessage: pending.analysisErrorMessage,
        authorAnnotationsJson: JSON.stringify(input.authorAnnotations ?? []),
    };
}
