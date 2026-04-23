import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const loadDiscussionTopicProfileMock = jest.fn();
const enqueueAiJobMock = jest.fn();
const runDiscussionMessageAnalyzeJobMock = jest.fn();
const enqueueDiscussionTriggerEvaluationJobMock = jest.fn();
const invalidateDiscussionTopicProfileCacheMock = jest.fn();
const publishDiscussionRealtimeEventMock = jest.fn();

jest.mock('../../topicProfile', () => ({
    loadDiscussionTopicProfile: (...args: unknown[]) => loadDiscussionTopicProfileMock(...args),
    invalidateDiscussionTopicProfileCache: (...args: unknown[]) => invalidateDiscussionTopicProfileCacheMock(...args),
}));

jest.mock('../../../aiJobs/runtime', () => ({
    enqueueAiJob: (...args: unknown[]) => enqueueAiJobMock(...args),
}));

jest.mock('../enqueue', () => ({
    runDiscussionMessageAnalyzeJob: (...args: unknown[]) => runDiscussionMessageAnalyzeJobMock(...args),
}));

jest.mock('../../../../ai/discussion-draft-trigger', () => ({
    enqueueDiscussionTriggerEvaluationJob: (...args: unknown[]) => enqueueDiscussionTriggerEvaluationJobMock(...args),
}));

jest.mock('../../realtime', () => ({
    publishDiscussionRealtimeEvent: (...args: unknown[]) => publishDiscussionRealtimeEventMock(...args),
}));

import {
    markCircleTopicProfileDirty,
    runDiscussionCircleReanalyzeJob,
} from '../invalidation';

function renderSql(query: unknown): string {
    if (Array.isArray((query as { strings?: string[] })?.strings)) {
        return ((query as { strings: string[] }).strings).join('?');
    }
    return String(query || '');
}

describe('discussion topic profile invalidation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (publishDiscussionRealtimeEventMock as any).mockResolvedValue({
            circleId: 7,
            latestLamport: null,
            envelopeId: 'env-1',
            reason: 'message_refresh_required',
        });
    });

    test('marks circle messages stale, invalidates summary cache, and enqueues circle reanalysis', async () => {
        (loadDiscussionTopicProfileMock as any).mockResolvedValue({
            topicProfileVersion: 'topic:7:newhash',
        });
        (enqueueAiJobMock as any).mockResolvedValue({ id: 22 });

        const queryRaw = jest.fn(async (query: unknown) => {
            const sql = renderSql(query);
            if (sql.includes('UPDATE circle_discussion_messages')) {
                expect(sql).toContain("relevance_status = 'stale'");
                expect(sql).toContain('topic_profile_version =');
                expect(sql).not.toContain('lamport = nextval');
                return [
                    { envelopeId: 'env-1' },
                    { envelopeId: 'env-2' },
                ];
            }
            throw new Error(`unexpected query: ${sql}`);
        });
        const tx = { $queryRaw: queryRaw };
        const prisma = {
            $transaction: jest.fn(async (runner: (client: typeof tx) => Promise<unknown>) => runner(tx)),
        } as any;
        const redis = {
            del: jest.fn(async () => 1),
        } as any;

        const result = await markCircleTopicProfileDirty({
            prisma,
            redis,
            circleId: 7,
            reason: 'source_material_created',
            requestedByUserId: 9,
        });

        expect(result).toEqual({
            updatedCount: 2,
            topicProfileVersion: 'topic:7:newhash',
        });
        expect(invalidateDiscussionTopicProfileCacheMock).toHaveBeenCalledWith(7);
        expect(redis.del).toHaveBeenCalledWith('discussion:summary:circle:7');
        expect(enqueueAiJobMock).toHaveBeenCalledWith(prisma, expect.objectContaining({
            jobType: 'discussion_circle_reanalyze',
            scopeCircleId: 7,
        }));
        expect(publishDiscussionRealtimeEventMock).toHaveBeenNthCalledWith(1, redis, {
            circleId: 7,
            envelopeId: 'env-1',
            reason: 'message_refresh_required',
        });
        expect(publishDiscussionRealtimeEventMock).toHaveBeenNthCalledWith(2, redis, {
            circleId: 7,
            envelopeId: 'env-2',
            reason: 'message_refresh_required',
        });
    });

    test('keeps processing batches until no stale rows remain', async () => {
        const prisma = {
            $queryRaw: jest.fn(async (query: unknown) => {
                const sql = renderSql(query);
                if (sql.includes('SELECT envelope_id AS "envelopeId"')) {
                    const callCount = (prisma.$queryRaw as jest.Mock).mock.calls.length;
                    if (callCount === 1) {
                        return Array.from({ length: 100 }, (_, index) => ({ envelopeId: `env-${index}` }));
                    }
                    if (callCount === 2) {
                        return Array.from({ length: 37 }, (_, index) => ({ envelopeId: `env-tail-${index}` }));
                    }
                    return [];
                }
                throw new Error(`unexpected query: ${sql}`);
            }),
        } as any;
        const redis = {
            del: jest.fn(async () => 1),
        } as any;
        (runDiscussionMessageAnalyzeJobMock as any).mockResolvedValue({
            updated: true,
            relevanceStatus: 'ready',
        });
        (enqueueAiJobMock as any).mockResolvedValue({ id: 88 });

        const result = await runDiscussionCircleReanalyzeJob({
            prisma,
            redis,
            circleId: 7,
            requestedByUserId: 9,
        });

        expect(result).toMatchObject({
            circleId: 7,
            processed: 137,
            remaining: 0,
        });
        expect(runDiscussionMessageAnalyzeJobMock).toHaveBeenCalledTimes(137);
        expect(enqueueAiJobMock).not.toHaveBeenCalled();
        expect(enqueueDiscussionTriggerEvaluationJobMock).toHaveBeenCalledWith(prisma, {
            circleId: 7,
            requestedByUserId: 9,
        });
    });

    test('re-analyzes stale messages and re-enqueues trigger evaluation once the full batch completes', async () => {
        const prisma = {
            $queryRaw: jest.fn(async (query: unknown) => {
                const sql = renderSql(query);
                if (sql.includes('SELECT envelope_id AS "envelopeId"')) {
                    const callCount = (prisma.$queryRaw as jest.Mock).mock.calls.length;
                    if (callCount === 1) {
                        return [
                            { envelopeId: 'env-1' },
                            { envelopeId: 'env-2' },
                        ];
                    }
                    return [];
                }
                throw new Error(`unexpected query: ${sql}`);
            }),
        } as any;
        const redis = {
            del: jest.fn(async () => 1),
        } as any;
        (runDiscussionMessageAnalyzeJobMock as any).mockResolvedValue({
            updated: true,
            relevanceStatus: 'ready',
        });
        (enqueueDiscussionTriggerEvaluationJobMock as any).mockResolvedValue({ id: 11 });

        const result = await runDiscussionCircleReanalyzeJob({
            prisma,
            redis,
            circleId: 7,
            requestedByUserId: 9,
        });

        expect(result).toMatchObject({
            circleId: 7,
            processed: 2,
        });
        expect(runDiscussionMessageAnalyzeJobMock).toHaveBeenCalledTimes(2);
        expect(redis.del).toHaveBeenCalledWith('discussion:summary:circle:7');
        expect(enqueueDiscussionTriggerEvaluationJobMock).toHaveBeenCalledWith(prisma, {
            circleId: 7,
            requestedByUserId: 9,
        });
    });
});
