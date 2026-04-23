import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { createAiJobHandlers } from '../handlers';
import { createAiJobWorker } from '../worker';
import { enqueueAiJob } from '../runtime';
import { createInMemoryAiJobPrisma } from '../testStore';

jest.mock('../../../ai/discussion-draft-trigger', () => ({
    maybeTriggerGhostDraftFromDiscussion: jest.fn(),
}));

const {
    maybeTriggerGhostDraftFromDiscussion: maybeTriggerGhostDraftFromDiscussionMock,
} = jest.requireMock('../../../ai/discussion-draft-trigger') as {
    maybeTriggerGhostDraftFromDiscussion: any;
};

describe('ai job worker', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
    });

    test('runOnce claims a queued job and marks it succeeded after handler success', async () => {
        const prisma = createInMemoryAiJobPrisma();
        await enqueueAiJob(prisma as any, {
            jobType: 'ghost_draft_generate',
            scopeType: 'draft',
            scopeDraftPostId: 55,
            scopeCircleId: 7,
            requestedByUserId: 9,
            payload: { postId: 55 },
        });
        const handler = jest.fn(async () => ({
            generationId: 401,
        }));

        const worker = createAiJobWorker({
            prisma: prisma as any,
            workerId: 'worker-a',
            pollIntervalMs: 100,
            handlers: {
                ghost_draft_generate: handler,
            },
        });

        const processed = await worker.runOnce();

        expect(processed).toBe(true);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(prisma.__rows[0]).toMatchObject({
            status: 'succeeded',
            resultJson: {
                generationId: 401,
            },
        });
    });

    test('start and stop control polling without leaving the worker running', async () => {
        const prisma = createInMemoryAiJobPrisma();
        await enqueueAiJob(prisma as any, {
            jobType: 'ghost_draft_generate',
            scopeType: 'draft',
            scopeDraftPostId: 77,
            scopeCircleId: 7,
            requestedByUserId: 9,
            payload: { postId: 77 },
        });
        const handler = jest.fn(async () => ({
            generationId: 402,
        }));

        const worker = createAiJobWorker({
            prisma: prisma as any,
            workerId: 'worker-b',
            pollIntervalMs: 100,
            handlers: {
                ghost_draft_generate: handler,
            },
        });

        worker.start();
        await jest.advanceTimersByTimeAsync(125);
        expect(worker.isRunning()).toBe(true);
        expect(handler).toHaveBeenCalledTimes(1);

        await worker.stop();
        await jest.advanceTimersByTimeAsync(200);

        expect(worker.isRunning()).toBe(false);
        expect(handler).toHaveBeenCalledTimes(1);
    });

    test('handler failures are written back onto the durable job state', async () => {
        const prisma = createInMemoryAiJobPrisma();
        await enqueueAiJob(prisma as any, {
            jobType: 'discussion_trigger_evaluate',
            scopeType: 'circle',
            scopeCircleId: 88,
            requestedByUserId: 9,
            maxAttempts: 1,
            payload: { circleId: 88 },
        });
        const worker = createAiJobWorker({
            prisma: prisma as any,
            workerId: 'worker-c',
            pollIntervalMs: 100,
            handlers: {
                discussion_trigger_evaluate: jest.fn(async () => {
                    throw new Error('boom');
                }),
            },
        });

        await worker.runOnce();

        expect(prisma.__rows[0]).toMatchObject({
            status: 'failed',
            lastErrorMessage: 'boom',
        });
    });

    test('worker executes the discussion trigger handler instead of leaving the job queued', async () => {
        const prisma = createInMemoryAiJobPrisma();
        maybeTriggerGhostDraftFromDiscussionMock.mockResolvedValueOnce({
            triggered: true,
            reason: 'created',
            draftPostId: 123,
        });
        const queued = await enqueueAiJob(prisma as any, {
            jobType: 'discussion_trigger_evaluate',
            scopeType: 'circle',
            scopeCircleId: 88,
            requestedByUserId: 9,
            availableAt: new Date('2026-03-24T19:59:00.000Z'),
            payload: { circleId: 88 },
        });
        const redis = {} as any;
        const worker = createAiJobWorker({
            prisma: prisma as any,
            redis,
            workerId: 'worker-d',
            pollIntervalMs: 100,
            handlers: createAiJobHandlers({
                prisma: prisma as any,
                redis,
            }),
        });

        await worker.runOnce();

        expect(maybeTriggerGhostDraftFromDiscussionMock).toHaveBeenCalledWith({
            prisma,
            redis,
            circleId: 88,
            aiJob: expect.objectContaining({
                id: queued.id,
                requestedByUserId: 9,
            }),
        });
        expect(prisma.__rows[0]).toMatchObject({
            status: 'succeeded',
            resultJson: {
                circleId: 88,
                triggered: true,
                reason: 'created',
                draftPostId: 123,
            },
        });
    });

    test('worker renews the claim lease while a long-running handler is still executing', async () => {
        let resolveHandler: (() => void) | undefined;
        const handler = jest.fn(async () => {
            await new Promise<void>((resolve) => {
                resolveHandler = resolve;
            });
            return { generationId: 499 };
        });
        const prisma = createInMemoryAiJobPrisma();
        await enqueueAiJob(prisma as any, {
            jobType: 'ghost_draft_generate',
            scopeType: 'draft',
            scopeDraftPostId: 55,
            scopeCircleId: 7,
            requestedByUserId: 9,
            payload: { postId: 55 },
        });
        const worker = createAiJobWorker({
            prisma: prisma as any,
            workerId: 'worker-lease',
            pollIntervalMs: 100,
            leaseMs: 3_000,
            handlers: {
                ghost_draft_generate: handler,
            },
        });

        const runPromise = worker.runOnce();
        const initialClaimedAt = prisma.__rows[0].claimedAt?.getTime();

        await jest.advanceTimersByTimeAsync(1_200);

        expect(prisma.__rows[0].claimedAt?.getTime()).toBeGreaterThan(initialClaimedAt ?? 0);

        resolveHandler?.();
        await runPromise;

        expect(prisma.__rows[0]).toMatchObject({
            status: 'succeeded',
            resultJson: { generationId: 499 },
        });
    });

    test('worker runs a queued discussion trigger before trailing analysis jobs', async () => {
        const prisma = createInMemoryAiJobPrisma([
            {
                id: 101,
                jobType: 'discussion_message_analyze',
                scopeType: 'circle',
                scopeCircleId: 88,
                status: 'queued',
                availableAt: new Date('2026-04-10T02:00:00.000Z'),
                payloadJson: { circleId: 88, envelopeId: 'env-101' },
            },
            {
                id: 102,
                jobType: 'discussion_trigger_evaluate',
                scopeType: 'circle',
                scopeCircleId: 88,
                status: 'queued',
                availableAt: new Date('2026-04-10T02:00:00.000Z'),
                payloadJson: { circleId: 88 },
            },
        ]);
        maybeTriggerGhostDraftFromDiscussionMock.mockResolvedValueOnce({
            triggered: true,
            reason: 'created',
            draftPostId: 456,
        });
        const analyzeHandler = jest.fn(async () => ({ updated: true }));
        const redis = {} as any;
        const worker = createAiJobWorker({
            prisma: prisma as any,
            redis,
            workerId: 'worker-priority-order',
            pollIntervalMs: 100,
            handlers: {
                ...createAiJobHandlers({
                    prisma: prisma as any,
                    redis,
                }),
                discussion_message_analyze: analyzeHandler,
            },
        });

        await worker.runOnce();

        expect(maybeTriggerGhostDraftFromDiscussionMock).toHaveBeenCalledTimes(1);
        expect(analyzeHandler).not.toHaveBeenCalled();
        expect(prisma.__rows.find((row) => row.id === 102)).toMatchObject({
            status: 'succeeded',
        });
    });

    test('worker does not delay an earlier ghost draft behind discussion trigger traffic', async () => {
        const prisma = createInMemoryAiJobPrisma([
            {
                id: 111,
                jobType: 'ghost_draft_generate',
                scopeType: 'draft',
                scopeDraftPostId: 66,
                scopeCircleId: 7,
                requestedByUserId: 9,
                status: 'queued',
                availableAt: new Date('2026-04-10T02:00:00.000Z'),
                payloadJson: { postId: 66 },
            },
            {
                id: 112,
                jobType: 'discussion_trigger_evaluate',
                scopeType: 'circle',
                scopeCircleId: 88,
                status: 'queued',
                availableAt: new Date('2026-04-10T02:00:00.000Z'),
                payloadJson: { circleId: 88 },
            },
        ]);
        const ghostHandler = jest.fn(async () => ({ generationId: 601 }));
        const redis = {} as any;
        const worker = createAiJobWorker({
            prisma: prisma as any,
            redis,
            workerId: 'worker-mixed-order',
            pollIntervalMs: 100,
            handlers: {
                ...createAiJobHandlers({
                    prisma: prisma as any,
                    redis,
                }),
                ghost_draft_generate: ghostHandler,
            },
        });

        await worker.runOnce();

        expect(ghostHandler).toHaveBeenCalledTimes(1);
        expect(maybeTriggerGhostDraftFromDiscussionMock).not.toHaveBeenCalled();
        expect(prisma.__rows.find((row) => row.id === 111)).toMatchObject({
            status: 'succeeded',
        });
    });
});
