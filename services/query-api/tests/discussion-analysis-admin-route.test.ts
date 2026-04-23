import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Router } from 'express';

const loadDiscussionAnalysisDiagnosticsMock = jest.fn();
const loadDiscussionSummaryDiagnosticsMock = jest.fn();
const loadLatestDiscussionTriggerDiagnosticsMock = jest.fn();
const enqueueDiscussionMessageAnalyzeJobMock = jest.fn();
const loadGhostConfigMock = jest.fn();
const loadCircleGhostSettingsPatchMock = jest.fn();
const resolveCircleGhostSettingsMock = jest.fn();

jest.mock('../src/services/discussion/scoringAudit', () => ({
    loadDiscussionAnalysisDiagnostics: loadDiscussionAnalysisDiagnosticsMock,
}));

jest.mock('../src/ai/ghost/config', () => ({
    loadGhostConfig: loadGhostConfigMock,
}));

jest.mock('../src/ai/ghost/circle-settings', () => ({
    loadCircleGhostSettingsPatch: loadCircleGhostSettingsPatchMock,
    resolveCircleGhostSettings: resolveCircleGhostSettingsMock,
}));

jest.mock('../src/services/discussion/summaryDiagnostics', () => ({
    loadDiscussionSummaryDiagnostics: loadDiscussionSummaryDiagnosticsMock,
}));

jest.mock('../src/services/discussion/analysis/enqueue', () => ({
    enqueueDiscussionMessageAnalyzeJob: enqueueDiscussionMessageAnalyzeJobMock,
}));

jest.mock('../src/ai/discussion-draft-trigger', () => ({
    loadLatestDiscussionTriggerDiagnostics: loadLatestDiscussionTriggerDiagnosticsMock,
}));

import { discussionAdminRouter } from '../src/rest/discussionAdmin';

function getRouteHandler(router: Router, path: string, method: 'get' | 'post') {
    const layer = (router as any).stack.find((item: any) =>
        item.route?.path === path
        && item.route?.stack?.some((entry: any) => entry.method === method),
    );
    const routeLayer = layer?.route?.stack?.find((entry: any) => entry.method === method);
    if (!routeLayer?.handle) {
        throw new Error(`route handler not found for ${method.toUpperCase()} ${path}`);
    }
    return routeLayer.handle;
}

function createMockResponse() {
    return {
        statusCode: 200,
        payload: null as any,
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        json(payload: any) {
            this.payload = payload;
            return this;
        },
    };
}

describe('discussion analysis admin routes', () => {
    const originalRuntimeRole = process.env.QUERY_API_RUNTIME_ROLE;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.QUERY_API_RUNTIME_ROLE = 'PRIVATE_SIDECAR';

        (loadDiscussionAnalysisDiagnosticsMock as any).mockResolvedValue({
            envelopeId: 'env-1',
            circleId: 7,
            roomKey: 'circle:7',
            senderPubkey: 'pubkey',
            senderHandle: 'alice',
            payloadText: '讨论内容',
            metadata: null,
            deleted: false,
            createdAt: new Date('2026-04-01T10:00:00.000Z'),
            updatedAt: new Date('2026-04-01T10:01:00.000Z'),
            analysis: {
                relevanceStatus: 'ready',
                semanticScore: 0.88,
                embeddingScore: 0.9,
                qualityScore: 0.7,
                spamScore: 0.1,
                decisionConfidence: 0.8,
                relevanceMethod: 'embedding_first',
                actualMode: 'embedding_first',
                analysisVersion: 'analysis:v2',
                topicProfileVersion: 'topic:7:aaaa',
                semanticFacets: ['fact', 'question'],
                focusScore: 0.76,
                focusLabel: 'focused',
                isFeatured: true,
                featureReason: 'high_signal',
                analysisCompletedAt: new Date('2026-04-01T10:01:00.000Z'),
                analysisErrorCode: null,
                analysisErrorMessage: null,
                authorAnnotations: ['fact'],
            },
            topicProfile: {
                currentVersion: 'topic:7:bbbb',
                messageVersion: 'topic:7:aaaa',
                isStale: true,
                snapshotText: '圈层主题：异步编程',
                sourceDigest: 'digest',
                embeddingAvailable: true,
                embeddingModel: 'text-embedding',
                embeddingProviderMode: 'builtin',
            },
        });
        (enqueueDiscussionMessageAnalyzeJobMock as any).mockResolvedValue({
            id: 99,
            status: 'queued',
        });
        loadGhostConfigMock.mockReturnValue({
            summary: {
                windowSize: 20,
                cacheTtlSec: 60,
            },
        });
        (loadCircleGhostSettingsPatchMock as any).mockResolvedValue({
            summaryUseLLM: true,
        });
        resolveCircleGhostSettingsMock.mockReturnValue({
            summaryUseLLM: true,
        });
        (loadDiscussionSummaryDiagnosticsMock as any).mockResolvedValue({
            scope: 'circle-scoped',
            circleId: 7,
            summary: '总结内容',
            method: 'llm',
            messageCount: 1,
            windowSize: 20,
            configSource: 'circle',
            config: {
                summaryUseLLM: true,
            },
            generationMetadata: {
                providerMode: 'builtin',
                model: 'qwen',
                promptAsset: 'discussion-summary',
                promptVersion: 'v1',
                sourceDigest: 'digest',
            },
            generatedAt: '2026-04-01T10:01:00.000Z',
            fromCache: false,
            sourceMessages: [
                {
                    senderHandle: 'alice',
                    senderPubkey: 'alice',
                    text: '讨论内容',
                    createdAt: '2026-04-01T10:00:00.000Z',
                    focusScore: 0.9,
                    relevanceScore: 0.9,
                    semanticFacets: ['fact'],
                },
            ],
            windowDigest: 'window-digest',
            inputFidelity: 'exact_cached_window',
            cachedSourceDigest: 'digest',
            fallbackDiagnostics: null,
        });
        (loadLatestDiscussionTriggerDiagnosticsMock as any).mockResolvedValue({
            scope: 'circle-scoped',
            circleId: 7,
            input: {
                windowEnvelopeIds: ['env-1'],
                windowDigest: 'trigger-window',
                triggerSettings: {
                    draftTriggerMode: 'notify_only',
                    triggerSummaryUseLLM: true,
                    minMessages: 3,
                    minQuestionCount: 1,
                    minFocusedRatio: 0.5,
                },
                messageCount: 4,
                focusedCount: 3,
                focusedRatio: 0.75,
                questionCount: 2,
            },
            runtime: {
                summaryMethod: 'llm',
                aiJobId: 55,
                aiJobAttempt: 1,
                requestedByUserId: 11,
            },
            output: {
                status: 'triggered',
                reason: 'created',
                summaryPreview: '摘要',
                draftPostId: 44,
            },
            failure: {
                code: null,
                message: null,
            },
            createdAt: '2026-04-01T10:05:00.000Z',
        });
    });

    afterEach(() => {
        if (originalRuntimeRole === undefined) {
            delete process.env.QUERY_API_RUNTIME_ROLE;
        } else {
            process.env.QUERY_API_RUNTIME_ROLE = originalRuntimeRole;
        }
    });

    test('requires authenticated sidecar session for diagnostics reads', async () => {
        const prisma = {} as any;
        const router = discussionAdminRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/messages/:envelopeId/analysis', 'get');
        const res = createMockResponse();

        await handler({
            params: { envelopeId: 'env-1' },
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(401);
        expect(loadDiscussionAnalysisDiagnosticsMock).not.toHaveBeenCalled();
    });

    test('returns not found when caller cannot manage target circle', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    creatorId: 99,
                })),
            },
            circleMember: {
                findUnique: jest.fn(async () => null),
            },
        } as any;
        const router = discussionAdminRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/messages/:envelopeId/analysis', 'get');
        const res = createMockResponse();

        await handler({
            params: { envelopeId: 'env-1' },
            userId: 11,
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(404);
        expect(res.payload).toMatchObject({
            error: 'discussion_message_not_found',
        });
    });

    test('returns canonical analysis snapshot for circle managers', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    creatorId: 11,
                })),
            },
        } as any;
        const router = discussionAdminRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/messages/:envelopeId/analysis', 'get');
        const res = createMockResponse();

        await handler({
            params: { envelopeId: 'env-1' },
            userId: 11,
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(200);
        expect(res.payload.diagnostics.analysis.semanticFacets).toEqual(['fact', 'question']);
        expect(res.payload.diagnostics.topicProfile.isStale).toBe(true);
    });

    test('re-enqueues analysis replay for circle managers', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    creatorId: 11,
                })),
            },
        } as any;
        const router = discussionAdminRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/messages/:envelopeId/reanalyze', 'post');
        const res = createMockResponse();

        await handler({
            params: { envelopeId: 'env-1' },
            userId: 11,
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(200);
        expect(enqueueDiscussionMessageAnalyzeJobMock).toHaveBeenCalledWith(prisma, {
            envelopeId: 'env-1',
            circleId: 7,
            requestedByUserId: 11,
        });
        expect(res.payload).toMatchObject({
            ok: true,
            jobId: 99,
            status: 'queued',
            circleId: 7,
        });
    });

    test('requires authenticated sidecar session for reanalyze', async () => {
        const prisma = {} as any;
        const router = discussionAdminRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/messages/:envelopeId/reanalyze', 'post');
        const res = createMockResponse();

        await handler({
            params: { envelopeId: 'env-1' },
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(401);
        expect(enqueueDiscussionMessageAnalyzeJobMock).not.toHaveBeenCalled();
    });

    test('returns not found for reanalyze when caller cannot manage target circle', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    creatorId: 99,
                })),
            },
            circleMember: {
                findUnique: jest.fn(async () => null),
            },
        } as any;
        const router = discussionAdminRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/messages/:envelopeId/reanalyze', 'post');
        const res = createMockResponse();

        await handler({
            params: { envelopeId: 'env-1' },
            userId: 11,
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(404);
        expect(enqueueDiscussionMessageAnalyzeJobMock).not.toHaveBeenCalled();
        expect(res.payload).toMatchObject({
            error: 'discussion_message_not_found',
        });
    });

    test('rejects diagnostics route on public nodes', async () => {
        process.env.QUERY_API_RUNTIME_ROLE = 'PUBLIC_NODE';

        const prisma = {} as any;
        const router = discussionAdminRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/messages/:envelopeId/analysis', 'get');
        const res = createMockResponse();

        await handler({
            params: { envelopeId: 'env-1' },
            userId: 11,
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(409);
        expect(res.payload).toMatchObject({
            error: 'private_sidecar_required',
            route: 'discussion_runtime',
        });
    });

    test('rejects reanalyze route on public nodes', async () => {
        process.env.QUERY_API_RUNTIME_ROLE = 'PUBLIC_NODE';

        const prisma = {} as any;
        const router = discussionAdminRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/messages/:envelopeId/reanalyze', 'post');
        const res = createMockResponse();

        await handler({
            params: { envelopeId: 'env-1' },
            userId: 11,
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(409);
        expect(enqueueDiscussionMessageAnalyzeJobMock).not.toHaveBeenCalled();
        expect(res.payload).toMatchObject({
            error: 'private_sidecar_required',
            route: 'discussion_runtime',
        });
    });

    test('returns summary diagnostics for circle managers', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    creatorId: 11,
                })),
            },
        } as any;
        const router = discussionAdminRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/circles/:id/summary', 'get');
        const res = createMockResponse();

        await handler({
            params: { id: '7' },
            query: {},
            userId: 11,
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(200);
        expect(loadDiscussionSummaryDiagnosticsMock).toHaveBeenCalledWith(
            prisma,
            expect.anything(),
            7,
            expect.objectContaining({
                force: false,
                summaryUseLLM: true,
                configSource: 'circle',
            }),
        );
        expect(res.payload.diagnostics.input.inputFidelity).toBe('exact_cached_window');
    });

    test('exposes llm fallback diagnostics in the summary diagnostics payload', async () => {
        (loadDiscussionSummaryDiagnosticsMock as any).mockResolvedValueOnce({
            scope: 'circle-scoped',
            circleId: 7,
            summary: '规则总结',
            method: 'rule',
            messageCount: 2,
            windowSize: 20,
            configSource: 'circle',
            config: {
                summaryUseLLM: true,
            },
            currentConfigSource: 'circle',
            currentConfig: {
                summaryUseLLM: true,
            },
            generationMetadata: {
                providerMode: 'rule',
                model: 'rule-based',
                promptAsset: 'discussion-summary',
                promptVersion: 'v1',
                sourceDigest: 'digest',
            },
            generatedAt: '2026-04-01T10:01:00.000Z',
            fromCache: false,
            sourceMessages: [],
            windowDigest: 'window-digest',
            inputFidelity: 'exact_cached_window',
            cachedSourceDigest: 'digest',
            fallbackDiagnostics: {
                attemptedMethod: 'llm',
                reason: 'llm_output_truncated',
                rawFinishReason: 'length',
                rawResponseSnippet: '好，我现在需要处理这个用户的查询。',
            },
        });

        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    creatorId: 11,
                })),
            },
        } as any;
        const router = discussionAdminRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/circles/:id/summary', 'get');
        const res = createMockResponse();

        await handler({
            params: { id: '7' },
            query: {},
            userId: 11,
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(200);
        expect(res.payload.diagnostics.runtime.fallback).toEqual({
            attemptedMethod: 'llm',
            reason: 'llm_output_truncated',
            rawFinishReason: 'length',
            rawResponseSnippet: '好，我现在需要处理这个用户的查询。',
        });
    });

    test('requires authenticated sidecar session for summary diagnostics', async () => {
        const prisma = {} as any;
        const router = discussionAdminRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/circles/:id/summary', 'get');
        const res = createMockResponse();

        await handler({
            params: { id: '7' },
            query: {},
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(401);
        expect(loadDiscussionSummaryDiagnosticsMock).not.toHaveBeenCalled();
    });

    test('rejects summary diagnostics on public nodes', async () => {
        process.env.QUERY_API_RUNTIME_ROLE = 'PUBLIC_NODE';

        const prisma = {} as any;
        const router = discussionAdminRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/circles/:id/summary', 'get');
        const res = createMockResponse();

        await handler({
            params: { id: '7' },
            query: {},
            userId: 11,
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(409);
        expect(res.payload).toMatchObject({
            error: 'private_sidecar_required',
            route: 'discussion_runtime',
        });
    });

    test('returns trigger diagnostics for circle managers', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    creatorId: 11,
                })),
            },
        } as any;
        const router = discussionAdminRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/circles/:id/trigger', 'get');
        const res = createMockResponse();

        await handler({
            params: { id: '7' },
            userId: 11,
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(200);
        expect(loadLatestDiscussionTriggerDiagnosticsMock).toHaveBeenCalledWith(prisma, 7);
        expect(res.payload.diagnostics.scope).toBe('circle-scoped');
        expect(res.payload.diagnostics.output.reason).toBe('created');
    });

    test('requires authenticated sidecar session for trigger diagnostics', async () => {
        const prisma = {} as any;
        const router = discussionAdminRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/circles/:id/trigger', 'get');
        const res = createMockResponse();

        await handler({
            params: { id: '7' },
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(401);
        expect(loadLatestDiscussionTriggerDiagnosticsMock).not.toHaveBeenCalled();
    });
});
