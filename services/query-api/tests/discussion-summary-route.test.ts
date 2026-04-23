import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Router } from 'express';

const loadGhostConfigMock = jest.fn();
const loadCircleGhostSettingsPatchMock = jest.fn();
const resolveCircleGhostSettingsMock = jest.fn();
const summarizeMessagesMock = jest.fn();

jest.mock('../src/ai/ghost/config', () => ({
    loadGhostConfig: loadGhostConfigMock,
}));

jest.mock('../src/ai/ghost/circle-settings', () => ({
    loadCircleGhostSettingsPatch: loadCircleGhostSettingsPatchMock,
    resolveCircleGhostSettings: resolveCircleGhostSettingsMock,
}));

jest.mock('../src/ai/discussion-intelligence', () => ({
    createDiscussionIntelligence: () => ({
        resolvePolicy: jest.fn(),
        scoreMessage: jest.fn(),
        summarizeMessages: summarizeMessagesMock,
        triggerDraftFromDiscussion: jest.fn(),
    }),
}));

import { discussionRouter } from '../src/rest/discussion';

function getRouteHandler(router: Router, path: string, method: 'get') {
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

describe('discussion summary internal route', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        loadGhostConfigMock.mockReturnValue({
            summary: {
                useLLM: true,
                windowSize: 20,
                cacheTtlSec: 0,
                internalEndpointEnabled: true,
            },
            trigger: {
                enabled: true,
                mode: 'notify_only',
                windowSize: 20,
                minMessages: 3,
                minQuestionCount: 1,
                minFocusedRatio: 0.5,
                cooldownSec: 60,
                summaryUseLLM: false,
                generateComment: false,
            },
            relevance: { mode: 'rule' },
            admin: { token: 'secret-token' },
        });
        (loadCircleGhostSettingsPatchMock as any).mockResolvedValue({
            summaryUseLLM: true,
        });
        resolveCircleGhostSettingsMock.mockReturnValue({
            summaryUseLLM: true,
        });
        (summarizeMessagesMock as any).mockResolvedValue({
            summary: '当前共识：结论 A 已形成。',
            method: 'llm',
            generatedAt: new Date('2026-03-24T22:00:00.000Z'),
            messageCount: 2,
            generationMetadata: {
                providerMode: 'builtin',
                model: 'qwen2.5:7b',
                promptAsset: 'discussion-summary',
                promptVersion: 'v1',
                sourceDigest: 'digest-1',
            },
        });
    });

    test('returns summary generation metadata through the existing synchronous route contract', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    name: 'Alpha',
                    description: '讨论场',
                })),
            },
            $queryRaw: jest.fn(async () => ([
                {
                    payloadText: '我们已经形成共识。',
                    senderPubkey: 'alice',
                    senderHandle: 'alice',
                    createdAt: new Date('2026-03-24T21:00:00.000Z'),
                    relevanceScore: 0.9,
                    semanticScore: 0.9,
                },
                {
                    payloadText: '还需要补证据。',
                    senderPubkey: 'bob',
                    senderHandle: 'bob',
                    createdAt: new Date('2026-03-24T21:01:00.000Z'),
                    relevanceScore: 0.8,
                    semanticScore: 0.8,
                },
            ])),
        } as any;
        const redis = {
            get: jest.fn(),
            setex: jest.fn(),
        } as any;

        const router = discussionRouter(prisma, redis);
        const handler = getRouteHandler(router, '/internal/circles/:id/summary', 'get');
        const res = createMockResponse();

        await handler({
            params: { id: '7' },
            query: {},
            headers: {
                authorization: 'Bearer secret-token',
            },
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            circleId: 7,
            method: 'llm',
            summary: '当前共识：结论 A 已形成。',
            inputFidelity: 'exact_cached_window',
            windowDigest: expect.any(String),
            generationMetadata: {
                providerMode: 'builtin',
                model: 'qwen2.5:7b',
                promptAsset: 'discussion-summary',
                promptVersion: 'v1',
                sourceDigest: 'digest-1',
            },
            fromCache: false,
        });
        expect(res.payload.sourceMessages).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    text: '我们已经形成共识。',
                }),
                expect.objectContaining({
                    text: '还需要补证据。',
                }),
            ]),
        );
        expect(res.payload).not.toHaveProperty('jobId');
        expect(res.payload).not.toHaveProperty('status');
    });

    test('returns honest metadata-only fidelity when serving an old cached summary without source window fields', async () => {
        loadGhostConfigMock.mockReturnValue({
            summary: {
                useLLM: true,
                windowSize: 20,
                cacheTtlSec: 60,
                internalEndpointEnabled: true,
            },
            trigger: {
                enabled: true,
                mode: 'notify_only',
                windowSize: 20,
                minMessages: 3,
                minQuestionCount: 1,
                minFocusedRatio: 0.5,
                cooldownSec: 60,
                summaryUseLLM: false,
                generateComment: false,
            },
            relevance: { mode: 'rule' },
            admin: { token: 'secret-token' },
        });
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    name: 'Alpha',
                    description: '讨论场',
                })),
            },
            $queryRaw: jest.fn(async () => ([
                {
                    payloadText: '当前窗口里的消息 A。',
                    senderPubkey: 'alice',
                    senderHandle: 'alice',
                    createdAt: new Date('2026-03-24T21:00:00.000Z'),
                    relevanceScore: 0.9,
                    semanticScore: 0.9,
                },
            ])),
        } as any;
        const redis = {
            get: jest.fn(async () => JSON.stringify({
                circleId: 7,
                summary: '旧缓存摘要',
                method: 'llm',
                messageCount: 2,
                windowSize: 20,
                configSource: 'global_default',
                config: {
                    summaryUseLLM: false,
                },
                generationMetadata: {
                    providerMode: 'builtin',
                    model: 'qwen2.5:7b',
                    promptAsset: 'discussion-summary',
                    promptVersion: 'v1',
                    sourceDigest: 'cached-digest',
                },
                generatedAt: '2026-03-24T22:00:00.000Z',
                fromCache: false,
            })),
            setex: jest.fn(),
        } as any;

        const router = discussionRouter(prisma, redis);
        const handler = getRouteHandler(router, '/internal/circles/:id/summary', 'get');
        const res = createMockResponse();

        await handler({
            params: { id: '7' },
            query: {},
            headers: {
                authorization: 'Bearer secret-token',
            },
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            summary: '旧缓存摘要',
            fromCache: true,
            inputFidelity: 'metadata_only',
            configSource: 'global_default',
            config: {
                summaryUseLLM: false,
            },
            currentConfigSource: 'circle',
            currentConfig: {
                summaryUseLLM: true,
            },
            cachedSourceDigest: 'cached-digest',
            sourceMessages: [
                expect.objectContaining({
                    text: '当前窗口里的消息 A。',
                }),
            ],
        });
    });
});
