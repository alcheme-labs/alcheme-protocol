import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import { enqueueDiscussionTriggerEvaluationJob } from '../../../ai/discussion-draft-trigger';
import { enqueueAiJob } from '../../aiJobs/runtime';
import { publishDiscussionRealtimeEvent } from '../realtime';
import {
    invalidateDiscussionTopicProfileCache,
    loadDiscussionTopicProfile,
} from '../topicProfile';
import { invalidateDiscussionSummaryCache } from '../summaryCache';
import { runDiscussionMessageAnalyzeJob } from './enqueue';

export async function enqueueDiscussionCircleReanalyzeJob(
    prisma: PrismaClient,
    input: {
        circleId: number;
        requestedByUserId?: number | null;
    },
) {
    return enqueueAiJob(prisma as any, {
        jobType: 'discussion_circle_reanalyze',
        dedupeKey: `discussion_circle_reanalyze:${input.circleId}`,
        scopeType: 'circle',
        scopeCircleId: input.circleId,
        requestedByUserId: input.requestedByUserId ?? null,
        payload: {
            circleId: input.circleId,
        },
    });
}

export async function markCircleTopicProfileDirty(input: {
    prisma: PrismaClient;
    redis: Redis;
    circleId: number;
    reason: string;
    requestedByUserId?: number | null;
}): Promise<{ updatedCount: number; topicProfileVersion: string }> {
    invalidateDiscussionTopicProfileCache(input.circleId);
    const profile = await loadDiscussionTopicProfile(input.prisma, input.circleId);

    const updatedRows = await input.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ envelopeId: string }>>(Prisma.sql`
            UPDATE circle_discussion_messages
            SET
                relevance_status = 'stale',
                topic_profile_version = ${profile.topicProfileVersion},
                is_featured = FALSE,
                feature_reason = NULL,
                featured_at = NULL,
                analysis_error_code = NULL,
                analysis_error_message = NULL,
                updated_at = NOW()
            WHERE circle_id = ${input.circleId}
              AND deleted = FALSE
              AND COALESCE(relevance_status, 'ready') <> 'pending'
              AND COALESCE(topic_profile_version, '') IS DISTINCT FROM ${profile.topicProfileVersion}
            RETURNING envelope_id AS "envelopeId"
        `);

        return rows;
    });

    for (const row of updatedRows) {
        try {
            await publishDiscussionRealtimeEvent(input.redis, {
                circleId: input.circleId,
                envelopeId: row.envelopeId,
                reason: 'message_refresh_required',
            });
        } catch {
            // best effort only
        }
    }

    await invalidateDiscussionSummaryCache(input.redis, input.circleId);
    await enqueueDiscussionCircleReanalyzeJob(input.prisma, {
        circleId: input.circleId,
        requestedByUserId: input.requestedByUserId ?? null,
    });

    return {
        updatedCount: updatedRows.length,
        topicProfileVersion: profile.topicProfileVersion,
    };
}

export async function runDiscussionCircleReanalyzeJob(input: {
    prisma: PrismaClient;
    redis: Redis;
    circleId: number;
    requestedByUserId?: number | null;
}): Promise<Record<string, unknown>> {
    let processed = 0;
    while (true) {
        const staleRows = await input.prisma.$queryRaw<Array<{ envelopeId: string }>>(Prisma.sql`
            SELECT envelope_id AS "envelopeId"
            FROM circle_discussion_messages
            WHERE circle_id = ${input.circleId}
              AND deleted = FALSE
              AND relevance_status = 'stale'
            ORDER BY lamport ASC
            LIMIT 100
        `);
        if (staleRows.length === 0) {
            break;
        }

        for (const row of staleRows) {
            await runDiscussionMessageAnalyzeJob({
                prisma: input.prisma,
                redis: input.redis,
                envelopeId: row.envelopeId,
                circleId: input.circleId,
                requestedByUserId: input.requestedByUserId ?? null,
            });
            processed += 1;
        }

        if (staleRows.length < 100) {
            break;
        }
    }

    await invalidateDiscussionSummaryCache(input.redis, input.circleId);
    if (processed > 0) {
        try {
            await enqueueDiscussionTriggerEvaluationJob(input.prisma, {
                circleId: input.circleId,
                requestedByUserId: input.requestedByUserId ?? null,
            });
        } catch {
            // best effort only
        }
    }

    return {
        circleId: input.circleId,
        processed,
        remaining: 0,
    };
}
