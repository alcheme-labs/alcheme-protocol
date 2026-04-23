import { describe, expect, test } from '@jest/globals';

import {
    claimNextAiJob,
    completeAiJob,
    computeAiJobBackoffMs,
    enqueueAiJob,
    failAiJob,
    requeueStaleAiJobs,
    renewAiJobLease,
} from '../runtime';
import { loadAiJobById } from '../readModel';
import { createInMemoryAiJobPrisma } from '../testStore';

describe('ai job runtime', () => {
    test('enqueue persists scope truth and dedupes by key', async () => {
        const prisma = createInMemoryAiJobPrisma();

        const first = await enqueueAiJob(prisma as any, {
            jobType: 'ghost_draft_generate',
            dedupeKey: 'ghost:42:abc',
            scopeType: 'draft',
            scopeDraftPostId: 42,
            scopeCircleId: 7,
            requestedByUserId: 9,
            payload: {
                postId: 42,
            },
        });
        const second = await enqueueAiJob(prisma as any, {
            jobType: 'ghost_draft_generate',
            dedupeKey: 'ghost:42:abc',
            scopeType: 'draft',
            scopeDraftPostId: 42,
            scopeCircleId: 7,
            requestedByUserId: 9,
            payload: {
                postId: 42,
                duplicate: true,
            },
        });

        expect(second.id).toBe(first.id);
        expect(prisma.__rows).toHaveLength(1);
        expect(first).toMatchObject({
            jobType: 'ghost_draft_generate',
            scopeType: 'draft',
            scopeDraftPostId: 42,
            scopeCircleId: 7,
            requestedByUserId: 9,
            status: 'queued',
        });
    });

    test('concurrent workers can only claim the same queued job once', async () => {
        const prisma = createInMemoryAiJobPrisma();
        await enqueueAiJob(prisma as any, {
            jobType: 'ghost_draft_generate',
            scopeType: 'draft',
            scopeDraftPostId: 42,
            scopeCircleId: 7,
            requestedByUserId: 9,
            availableAt: new Date('2026-03-24T19:59:00.000Z'),
            payload: { postId: 42 },
        });

        const [first, second] = await Promise.all([
            claimNextAiJob(prisma as any, {
                workerId: 'worker-a',
                now: new Date('2026-03-24T20:00:00.000Z'),
            }),
            claimNextAiJob(prisma as any, {
                workerId: 'worker-b',
                now: new Date('2026-03-24T20:00:00.000Z'),
            }),
        ]);

        const claimed = [first, second].filter(Boolean);
        expect(claimed).toHaveLength(1);
        expect(claimed[0]).toMatchObject({
            status: 'running',
        });
    });

    test('failed jobs are re-queued with backoff before becoming terminal failures', async () => {
        const prisma = createInMemoryAiJobPrisma();
        const queued = await enqueueAiJob(prisma as any, {
            jobType: 'discussion_trigger_evaluate',
            scopeType: 'circle',
            scopeCircleId: 77,
            requestedByUserId: 11,
            maxAttempts: 2,
            availableAt: new Date('2026-03-24T20:00:00.000Z'),
            payload: { circleId: 77 },
        });

        const firstClaim = await claimNextAiJob(prisma as any, {
            workerId: 'worker-a',
            now: new Date('2026-03-24T20:01:00.000Z'),
        });
        expect(firstClaim?.id).toBe(queued.id);

        const firstFailure = await failAiJob(prisma as any, {
            jobId: queued.id,
            claimToken: firstClaim?.claimToken || '',
            error: {
                code: 'temporary_failure',
                message: 'try later',
            },
            now: new Date('2026-03-24T20:01:10.000Z'),
        });
        expect(firstFailure).toMatchObject({
            status: 'queued',
            attempts: 1,
            lastErrorCode: 'temporary_failure',
        });
        expect(firstFailure?.availableAt.getTime()).toBeGreaterThan(new Date('2026-03-24T20:01:10.000Z').getTime());
        expect(computeAiJobBackoffMs(1)).toBeGreaterThan(0);

        const tooEarly = await claimNextAiJob(prisma as any, {
            workerId: 'worker-b',
            now: new Date('2026-03-24T20:01:10.999Z'),
        });
        expect(tooEarly).toBeNull();

        const secondClaim = await claimNextAiJob(prisma as any, {
            workerId: 'worker-b',
            now: new Date(firstFailure!.availableAt.getTime() + 1),
        });
        const terminal = await failAiJob(prisma as any, {
            jobId: queued.id,
            claimToken: secondClaim?.claimToken || '',
            error: {
                code: 'permanent_failure',
                message: 'stop retrying',
            },
            now: new Date('2026-03-24T20:03:00.000Z'),
        });

        expect(terminal).toMatchObject({
            status: 'failed',
            attempts: 2,
            completedAt: new Date('2026-03-24T20:03:00.000Z'),
            lastErrorCode: 'permanent_failure',
        });
    });

    test('successful jobs persist structured results', async () => {
        const prisma = createInMemoryAiJobPrisma();
        const queued = await enqueueAiJob(prisma as any, {
            jobType: 'ghost_draft_generate',
            dedupeKey: 'ghost:12:active',
            scopeType: 'draft',
            scopeDraftPostId: 12,
            scopeCircleId: 7,
            requestedByUserId: 3,
            availableAt: new Date('2026-03-24T20:09:00.000Z'),
            payload: { postId: 12 },
        });
        const claimed = await claimNextAiJob(prisma as any, {
            workerId: 'worker-a',
            now: new Date('2026-03-24T20:10:00.000Z'),
        });

        const succeeded = await completeAiJob(prisma as any, {
            jobId: queued.id,
            claimToken: claimed?.claimToken || '',
            result: {
                generationId: 91,
                postId: 12,
            },
            now: new Date('2026-03-24T20:10:05.000Z'),
        });
        const loaded = await loadAiJobById(prisma as any, queued.id);

        expect(succeeded).toMatchObject({
            status: 'succeeded',
            completedAt: new Date('2026-03-24T20:10:05.000Z'),
        });
        expect(loaded).toMatchObject({
            id: queued.id,
            status: 'succeeded',
            dedupeKey: null,
            result: {
                generationId: 91,
                postId: 12,
            },
        });
    });

    test('completed jobs release their dedupe key so an identical request can enqueue a fresh run', async () => {
        const prisma = createInMemoryAiJobPrisma();
        const first = await enqueueAiJob(prisma as any, {
            jobType: 'ghost_draft_generate',
            dedupeKey: 'ghost:42:fingerprint',
            scopeType: 'draft',
            scopeDraftPostId: 42,
            scopeCircleId: 7,
            requestedByUserId: 9,
            availableAt: new Date('2026-03-24T20:00:00.000Z'),
            payload: { postId: 42 },
        });
        const claimed = await claimNextAiJob(prisma as any, {
            workerId: 'worker-a',
            now: new Date('2026-03-24T20:01:00.000Z'),
        });
        await completeAiJob(prisma as any, {
            jobId: first.id,
            claimToken: claimed?.claimToken || '',
            result: { generationId: 1001, postId: 42 },
            now: new Date('2026-03-24T20:01:05.000Z'),
        });

        const rerun = await enqueueAiJob(prisma as any, {
            jobType: 'ghost_draft_generate',
            dedupeKey: 'ghost:42:fingerprint',
            scopeType: 'draft',
            scopeDraftPostId: 42,
            scopeCircleId: 7,
            requestedByUserId: 9,
            availableAt: new Date('2026-03-24T20:02:00.000Z'),
            payload: { postId: 42, rerun: true },
        });

        expect(rerun.id).not.toBe(first.id);
        expect(prisma.__rows).toHaveLength(2);
        expect(prisma.__rows[0]?.dedupeKey).toBeNull();
        expect(prisma.__rows[1]?.dedupeKey).toBe('ghost:42:fingerprint');
    });

    test('crystal asset issue jobs enqueue and claim through the shared ai job runtime', async () => {
        const prisma = createInMemoryAiJobPrisma();
        const queued = await enqueueAiJob(prisma as any, {
            jobType: 'crystal_asset_issue',
            dedupeKey: 'crystal-asset-issue:9',
            scopeType: 'circle',
            scopeCircleId: 7,
            requestedByUserId: 9,
            availableAt: new Date('2026-04-12T19:00:00.000Z'),
            payload: {
                knowledgeRowId: 9,
                knowledgePublicId: 'knowledge-9',
            },
        });

        const claimed = await claimNextAiJob(prisma as any, {
            workerId: 'worker-crystal',
            now: new Date('2026-04-12T19:00:01.000Z'),
        });

        expect(claimed).toMatchObject({
            id: queued.id,
            jobType: 'crystal_asset_issue',
            scopeCircleId: 7,
            status: 'running',
            payload: {
                knowledgeRowId: 9,
                knowledgePublicId: 'knowledge-9',
            },
        });
    });

    test('stale running jobs are re-queued so another worker can reclaim them', async () => {
        const prisma = createInMemoryAiJobPrisma([
            {
                id: 9,
                jobType: 'ghost_draft_generate',
                scopeType: 'draft',
                scopeDraftPostId: 42,
                scopeCircleId: 7,
                requestedByUserId: 3,
                status: 'running',
                attempts: 1,
                maxAttempts: 3,
                availableAt: new Date('2026-03-24T20:00:00.000Z'),
                claimedAt: new Date('2026-03-24T20:00:00.000Z'),
                workerId: 'worker-a',
                claimToken: 'claim-9',
                payloadJson: { postId: 42 },
                updatedAt: new Date('2026-03-24T20:00:00.000Z'),
            },
        ]);

        const requeued = await requeueStaleAiJobs(prisma as any, {
            now: new Date('2026-03-24T20:02:01.000Z'),
            leaseMs: 60_000,
        });
        const claimed = await claimNextAiJob(prisma as any, {
            workerId: 'worker-b',
            now: new Date('2026-03-24T20:02:01.000Z'),
        });

        expect(requeued).toBe(1);
        expect(claimed).toMatchObject({
            id: 9,
            status: 'running',
            workerId: 'worker-b',
        });
    });

    test('stale running jobs at max attempts become terminal failures instead of being re-queued again', async () => {
        const prisma = createInMemoryAiJobPrisma([
            {
                id: 10,
                jobType: 'ghost_draft_generate',
                dedupeKey: 'ghost:42:expired',
                scopeType: 'draft',
                scopeDraftPostId: 42,
                scopeCircleId: 7,
                requestedByUserId: 3,
                status: 'running',
                attempts: 3,
                maxAttempts: 3,
                availableAt: new Date('2026-03-24T20:00:00.000Z'),
                claimedAt: new Date('2026-03-24T20:00:00.000Z'),
                workerId: 'worker-a',
                claimToken: 'claim-10',
                payloadJson: { postId: 42 },
                updatedAt: new Date('2026-03-24T20:00:00.000Z'),
            },
        ]);

        const recovered = await requeueStaleAiJobs(prisma as any, {
            now: new Date('2026-03-24T20:02:01.000Z'),
            leaseMs: 60_000,
        });

        expect(recovered).toBe(1);
        expect(prisma.__rows[0]).toMatchObject({
            id: 10,
            status: 'failed',
            dedupeKey: null,
            workerId: null,
            claimToken: null,
            lastErrorCode: 'ai_job_worker_expired',
        });
        expect(prisma.__rows[0].completedAt).toEqual(new Date('2026-03-24T20:02:01.000Z'));
    });

    test('terminal failures release their dedupe key so callers can enqueue a replacement run', async () => {
        const prisma = createInMemoryAiJobPrisma();
        const first = await enqueueAiJob(prisma as any, {
            jobType: 'ghost_draft_generate',
            dedupeKey: 'ghost:42:failure',
            scopeType: 'draft',
            scopeDraftPostId: 42,
            scopeCircleId: 7,
            requestedByUserId: 9,
            maxAttempts: 1,
            availableAt: new Date('2026-03-24T20:00:00.000Z'),
            payload: { postId: 42 },
        });
        const claimed = await claimNextAiJob(prisma as any, {
            workerId: 'worker-a',
            now: new Date('2026-03-24T20:00:30.000Z'),
        });
        await failAiJob(prisma as any, {
            jobId: first.id,
            claimToken: claimed?.claimToken || '',
            error: {
                code: 'permanent_failure',
                message: 'stop retrying',
            },
            now: new Date('2026-03-24T20:00:45.000Z'),
        });

        const rerun = await enqueueAiJob(prisma as any, {
            jobType: 'ghost_draft_generate',
            dedupeKey: 'ghost:42:failure',
            scopeType: 'draft',
            scopeDraftPostId: 42,
            scopeCircleId: 7,
            requestedByUserId: 9,
            availableAt: new Date('2026-03-24T20:01:00.000Z'),
            payload: { postId: 42, rerun: true },
        });

        expect(rerun.id).not.toBe(first.id);
        expect(prisma.__rows[0]?.dedupeKey).toBeNull();
        expect(prisma.__rows[1]?.dedupeKey).toBe('ghost:42:failure');
    });

    test('renewAiJobLease only refreshes the matching running claim', async () => {
        const prisma = createInMemoryAiJobPrisma([
            {
                id: 11,
                jobType: 'ghost_draft_generate',
                scopeType: 'draft',
                scopeDraftPostId: 42,
                scopeCircleId: 7,
                requestedByUserId: 3,
                status: 'running',
                attempts: 1,
                maxAttempts: 3,
                availableAt: new Date('2026-03-24T20:00:00.000Z'),
                claimedAt: new Date('2026-03-24T20:00:00.000Z'),
                workerId: 'worker-a',
                claimToken: 'claim-11',
                payloadJson: { postId: 42 },
                updatedAt: new Date('2026-03-24T20:00:00.000Z'),
            },
        ]);

        const refreshed = await renewAiJobLease(prisma as any, {
            jobId: 11,
            claimToken: 'claim-11',
            now: new Date('2026-03-24T20:00:30.000Z'),
        });
        const ignored = await renewAiJobLease(prisma as any, {
            jobId: 11,
            claimToken: 'stale-claim',
            now: new Date('2026-03-24T20:00:45.000Z'),
        });

        expect(refreshed).toBe(true);
        expect(ignored).toBe(false);
        expect(prisma.__rows[0].claimedAt).toEqual(new Date('2026-03-24T20:00:30.000Z'));
    });

    test('claims discussion trigger jobs before trailing discussion analysis jobs', async () => {
        const prisma = createInMemoryAiJobPrisma([
            {
                id: 31,
                jobType: 'discussion_message_analyze',
                scopeType: 'circle',
                scopeCircleId: 7,
                status: 'queued',
                availableAt: new Date('2026-04-10T01:00:00.000Z'),
                payloadJson: { circleId: 7, envelopeId: 'env-1' },
            },
            {
                id: 32,
                jobType: 'discussion_message_analyze',
                scopeType: 'circle',
                scopeCircleId: 7,
                status: 'queued',
                availableAt: new Date('2026-04-10T01:00:00.000Z'),
                payloadJson: { circleId: 7, envelopeId: 'env-2' },
            },
            {
                id: 33,
                jobType: 'discussion_message_analyze',
                scopeType: 'circle',
                scopeCircleId: 7,
                status: 'queued',
                availableAt: new Date('2026-04-10T01:00:00.000Z'),
                payloadJson: { circleId: 7, envelopeId: 'env-3' },
            },
            {
                id: 34,
                jobType: 'discussion_trigger_evaluate',
                scopeType: 'circle',
                scopeCircleId: 7,
                status: 'queued',
                availableAt: new Date('2026-04-10T01:00:00.000Z'),
                payloadJson: { circleId: 7 },
            },
        ]);

        const claimed = await claimNextAiJob(prisma as any, {
            workerId: 'worker-priority',
            now: new Date('2026-04-10T01:00:01.000Z'),
        });

        expect(claimed?.jobType).toBe('discussion_trigger_evaluate');
        expect(claimed?.id).toBe(34);
    });

    test('does not let discussion trigger jobs leapfrog earlier ghost draft jobs', async () => {
        const prisma = createInMemoryAiJobPrisma([
            {
                id: 41,
                jobType: 'ghost_draft_generate',
                scopeType: 'draft',
                scopeDraftPostId: 55,
                scopeCircleId: 7,
                status: 'queued',
                availableAt: new Date('2026-04-10T01:00:00.000Z'),
                payloadJson: { postId: 55 },
            },
            {
                id: 42,
                jobType: 'discussion_message_analyze',
                scopeType: 'circle',
                scopeCircleId: 7,
                status: 'queued',
                availableAt: new Date('2026-04-10T01:00:00.000Z'),
                payloadJson: { circleId: 7, envelopeId: 'env-42' },
            },
            {
                id: 43,
                jobType: 'discussion_trigger_evaluate',
                scopeType: 'circle',
                scopeCircleId: 7,
                status: 'queued',
                availableAt: new Date('2026-04-10T01:00:00.000Z'),
                payloadJson: { circleId: 7 },
            },
        ]);

        const claimed = await claimNextAiJob(prisma as any, {
            workerId: 'worker-mixed',
            now: new Date('2026-04-10T01:00:01.000Z'),
        });

        expect(claimed?.jobType).toBe('ghost_draft_generate');
        expect(claimed?.id).toBe(41);
    });
});
