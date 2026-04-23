import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const analyzeDiscussionMessageCanonicalMock = jest.fn();
const enqueueTriggerMock = jest.fn();
const publishDiscussionRealtimeEventMock = jest.fn();

jest.mock('../service', () => ({
    analyzeDiscussionMessageCanonical: (...args: unknown[]) => analyzeDiscussionMessageCanonicalMock(...args),
}));

jest.mock('../../../../ai/discussion-draft-trigger', () => ({
    enqueueDiscussionTriggerEvaluationJob: (...args: unknown[]) => enqueueTriggerMock(...args),
}));

jest.mock('../../realtime', () => ({
    publishDiscussionRealtimeEvent: (...args: unknown[]) => publishDiscussionRealtimeEventMock(...args),
}));

import { runDiscussionMessageAnalyzeJob } from '../enqueue';

function renderSql(query: unknown): string {
    if (Array.isArray((query as { strings?: string[] })?.strings)) {
        return ((query as { strings: string[] }).strings).join('?');
    }
    return String(query || '');
}

describe('runDiscussionMessageAnalyzeJob', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (publishDiscussionRealtimeEventMock as any).mockResolvedValue({
            circleId: 7,
            latestLamport: null,
            envelopeId: 'env-1',
            reason: 'message_refresh_required',
        });
    });

    test('writes a ready canonical analysis snapshot, invalidates summary cache, and re-enqueues trigger evaluation', async () => {
        (analyzeDiscussionMessageCanonicalMock as any).mockResolvedValue({
            relevanceStatus: 'ready',
            semanticScore: 0.81,
            embeddingScore: 0.77,
            qualityScore: 0.7,
            spamScore: 0.05,
            decisionConfidence: 0.9,
            relevanceMethod: 'embedding_llm',
            actualMode: 'embedding_llm',
            analysisVersion: 'v2_embedding_first',
            topicProfileVersion: 'topic:7:abcd',
            focusScore: 0.79,
            focusLabel: 'focused',
            semanticFacets: ['explanation', 'proposal'],
            isFeatured: true,
            featureReason: 'canonical_featured:embedding_llm:high_confidence_focus',
            analysisCompletedAt: new Date('2026-04-01T00:00:00.000Z'),
            analysisErrorCode: null,
            analysisErrorMessage: null,
            authorAnnotations: [],
        });
        (enqueueTriggerMock as any).mockResolvedValue({ id: 11 });

        const queryRaw = jest.fn(async (query: unknown) => {
            const sql = renderSql(query);
            if (sql.includes('UPDATE circle_discussion_messages')) {
                expect(sql).toContain("relevance_status = 'ready'");
                expect(sql).toContain('semantic_facets =');
                expect(sql).toContain('focus_label =');
                expect(sql).not.toContain('lamport = nextval');
                return [{ envelopeId: 'env-1' }];
            }
            throw new Error(`unexpected query: ${sql}`);
        });
        const tx = { $queryRaw: queryRaw };
        const prisma = {
            circleDiscussionMessage: {
                findUnique: jest.fn(async () => ({
                    envelopeId: 'env-1',
                    circleId: 7,
                    payloadText: '异步编程可以减少阻塞等待',
                    deleted: false,
                    relevanceStatus: 'pending',
                    authorAnnotations: [],
                })),
            },
            $transaction: jest.fn(async (runner: (client: typeof tx) => Promise<unknown>) => runner(tx)),
        } as any;
        const redis = {
            del: jest.fn(async () => 1),
        } as any;

        const result = await runDiscussionMessageAnalyzeJob({
            prisma,
            redis,
            envelopeId: 'env-1',
            circleId: 7,
            requestedByUserId: 9,
        });

        expect(result).toMatchObject({
            envelopeId: 'env-1',
            circleId: 7,
            updated: true,
            relevanceStatus: 'ready',
            method: 'embedding_llm',
        });
        expect(redis.del).toHaveBeenCalledWith('discussion:summary:circle:7');
        expect(enqueueTriggerMock).toHaveBeenCalledWith(prisma, {
            circleId: 7,
            requestedByUserId: 9,
        });
        expect(publishDiscussionRealtimeEventMock).toHaveBeenCalledWith(redis, {
            circleId: 7,
            envelopeId: 'env-1',
            reason: 'message_refresh_required',
        });
    });

    test('marks the message as failed when analysis throws, without crashing the job worker', async () => {
        (analyzeDiscussionMessageCanonicalMock as any).mockRejectedValue(new Error('llm_unavailable'));

        const queryRaw = jest.fn(async (query: unknown) => {
            const sql = renderSql(query);
            if (sql.includes('UPDATE circle_discussion_messages')) {
                expect(sql).toContain("relevance_status = 'failed'");
                expect(sql).toContain('analysis_error_code =');
                expect(sql).not.toContain('lamport = nextval');
                return [{ envelopeId: 'env-2' }];
            }
            throw new Error(`unexpected query: ${sql}`);
        });
        const tx = { $queryRaw: queryRaw };
        const prisma = {
            circleDiscussionMessage: {
                findUnique: jest.fn(async () => ({
                    envelopeId: 'env-2',
                    circleId: 7,
                    payloadText: '这个问题需要上下文才能判断',
                    deleted: false,
                    relevanceStatus: 'pending',
                    authorAnnotations: [],
                })),
            },
            $transaction: jest.fn(async (runner: (client: typeof tx) => Promise<unknown>) => runner(tx)),
        } as any;
        const redis = {
            del: jest.fn(async () => 1),
        } as any;

        const result = await runDiscussionMessageAnalyzeJob({
            prisma,
            redis,
            envelopeId: 'env-2',
            circleId: 7,
        });

        expect(result).toMatchObject({
            envelopeId: 'env-2',
            circleId: 7,
            updated: true,
            relevanceStatus: 'failed',
            error: 'llm_unavailable',
        });
        expect(redis.del).toHaveBeenCalledWith('discussion:summary:circle:7');
        expect(enqueueTriggerMock).not.toHaveBeenCalled();
        expect(publishDiscussionRealtimeEventMock).toHaveBeenCalledWith(redis, {
            circleId: 7,
            envelopeId: 'env-2',
            reason: 'message_refresh_required',
        });
    });

    test('persists provider rate-limit diagnostics on ready fallback snapshots', async () => {
        (analyzeDiscussionMessageCanonicalMock as any).mockResolvedValue({
            relevanceStatus: 'ready',
            semanticScore: 0.25,
            embeddingScore: null,
            qualityScore: 0.7,
            spamScore: 0.01,
            decisionConfidence: 0.6,
            relevanceMethod: 'fallback_rule',
            actualMode: 'fallback_rule',
            analysisVersion: 'v2_embedding_first',
            topicProfileVersion: 'topic:51:abcd',
            focusScore: 0.25,
            focusLabel: 'off_topic',
            semanticFacets: ['question', 'proposal'],
            isFeatured: false,
            featureReason: null,
            analysisCompletedAt: new Date('2026-04-06T00:00:00.000Z'),
            analysisErrorCode: 'discussion_provider_rate_limited',
            analysisErrorMessage: 'RPM limit exceeded. Please complete identity verification to lift the restriction.',
            authorAnnotations: [],
        });
        (enqueueTriggerMock as any).mockResolvedValue({ id: 11 });

        const queryRaw = jest.fn(async (query: unknown) => {
            const sql = renderSql(query);
            if (sql.includes('UPDATE circle_discussion_messages')) {
                expect(sql).toContain("relevance_status = 'ready'");
                expect(sql).toContain('analysis_error_code =');
                expect(sql).not.toContain('lamport = nextval');
                const values = Array.isArray((query as { values?: unknown[] })?.values)
                    ? ((query as { values: unknown[] }).values)
                    : [];
                expect(values).toEqual(expect.arrayContaining([
                    'discussion_provider_rate_limited',
                    'RPM limit exceeded. Please complete identity verification to lift the restriction.',
                ]));
                return [{ envelopeId: 'env-3' }];
            }
            throw new Error(`unexpected query: ${sql}`);
        });
        const tx = { $queryRaw: queryRaw };
        const prisma = {
            circleDiscussionMessage: {
                findUnique: jest.fn(async () => ({
                    envelopeId: 'env-3',
                    circleId: 51,
                    payloadText: '那我们是不是应该让系统在讨论成熟到一定程度时，自动帮我们起一个草稿？',
                    deleted: false,
                    relevanceStatus: 'stale',
                    authorAnnotations: [],
                })),
            },
            $transaction: jest.fn(async (runner: (client: typeof tx) => Promise<unknown>) => runner(tx)),
        } as any;
        const redis = {
            del: jest.fn(async () => 1),
        } as any;

        const result = await runDiscussionMessageAnalyzeJob({
            prisma,
            redis,
            envelopeId: 'env-3',
            circleId: 51,
        });

        expect(result).toMatchObject({
            envelopeId: 'env-3',
            circleId: 51,
            updated: true,
            relevanceStatus: 'ready',
            method: 'fallback_rule',
        });
        expect(redis.del).toHaveBeenCalledWith('discussion:summary:circle:51');
        expect(publishDiscussionRealtimeEventMock).toHaveBeenCalledWith(redis, {
            circleId: 51,
            envelopeId: 'env-3',
            reason: 'message_refresh_required',
        });
    });
});
