import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Router } from 'express';

const scoreMessageMock = jest.fn();
const triggerDraftFromDiscussionMock = jest.fn();

jest.mock('../src/ai/discussion-intelligence', () => ({
    createDiscussionIntelligence: () => ({
        resolvePolicy: jest.fn(),
        scoreMessage: scoreMessageMock,
        summarizeMessages: jest.fn(),
        triggerDraftFromDiscussion: triggerDraftFromDiscussionMock,
    }),
}));

import { discussionRouter } from '../src/rest/discussion';
import * as runtime from '../src/services/aiJobs/runtime';

function getRouteHandler(router: Router, path: string, method: 'post') {
    const layer = (router as any).stack.find((item: any) =>
        item.route?.path === path
        && item.route?.stack?.some((entry: any) => entry.method === method),
    );
    const routeLayer = [...(layer?.route?.stack || [])]
        .reverse()
        .find((entry: any) => entry.method === method);
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

function createPrismaMock() {
    const insertedRow = {
        envelopeId: 'env-member-1',
        roomKey: 'circle:7',
        circleId: 7,
        senderPubkey: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
        senderHandle: 'alice',
        messageKind: 'plain',
        subjectType: null,
        subjectId: null,
        metadata: null,
        payloadText: '异步分析测试消息',
        payloadHash: 'f'.repeat(64),
        nonce: 'abc123',
        signature: null,
        signatureVerified: false,
        authMode: 'unsigned_local',
        sessionId: null,
        relevanceScore: 1,
        semanticScore: 1,
        qualityScore: 0.5,
        spamScore: 0,
        decisionConfidence: 0.5,
        relevanceMethod: 'rule',
        isFeatured: false,
        highlightCount: 0,
        featureReason: null,
        featuredAt: null,
        isEphemeral: false,
        expiresAt: null,
        clientTimestamp: new Date('2026-04-01T10:00:00.000Z'),
        lamport: BigInt(52),
        prevEnvelopeId: null,
        deleted: false,
        tombstoneReason: null,
        tombstonedAt: null,
        sourceMessageDeleted: null,
        createdAt: new Date('2026-04-01T10:00:00.000Z'),
        updatedAt: new Date('2026-04-01T10:00:00.000Z'),
    };

    const tx = {
        $queryRaw: jest.fn(async () => ([insertedRow])),
        $executeRaw: jest.fn(async () => 1),
    };

    return {
        user: {
            findUnique: jest.fn(async () => ({
                id: 11,
                pubkey: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
                handle: 'alice',
            })),
        },
        circle: {
            findUnique: jest.fn(async () => ({
                id: 7,
                name: 'Async Circle',
                description: '异步测试圈层',
            })),
        },
        circleMember: {
            findUnique: jest.fn(async () => ({
                status: 'Active',
            })),
        },
        $queryRaw: jest.fn(async () => ([])),
        $executeRaw: jest.fn(async () => 1),
        $transaction: jest.fn(async (callback: any) => callback(tx)),
    };
}

describe('discussion message async analysis route', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('posts the message without scoring inline and enqueues async analysis instead', async () => {
        jest.spyOn(runtime, 'enqueueAiJob').mockResolvedValueOnce({
            id: 401,
            jobType: 'discussion_message_analyze',
            dedupeKey: 'discussion-analysis:env-member-1',
            scopeType: 'circle',
            scopeDraftPostId: null,
            scopeCircleId: 7,
            requestedByUserId: 11,
            status: 'queued',
            attempts: 0,
            maxAttempts: 3,
            availableAt: new Date('2026-04-01T10:00:00.000Z'),
            claimedAt: null,
            completedAt: null,
            workerId: null,
            claimToken: null,
            payload: {
                circleId: 7,
                envelopeId: 'env-member-1',
            },
            result: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            createdAt: new Date('2026-04-01T10:00:00.000Z'),
            updatedAt: new Date('2026-04-01T10:00:00.000Z'),
        } as any);
        const prisma = createPrismaMock();
        const redis = {
            del: jest.fn(async () => 1),
            publish: jest.fn(async () => 1),
        } as any;
        const router = discussionRouter(prisma as any, redis);
        const handler = getRouteHandler(router, '/circles/:id/messages', 'post');
        const req = {
            params: { id: '7' },
            headers: {},
            body: {
                senderPubkey: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
                senderHandle: 'alice',
                text: '异步分析测试消息',
                clientTimestamp: '2026-04-01T10:00:00.000Z',
                nonce: 'abc123',
            },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(201);
        expect(scoreMessageMock).not.toHaveBeenCalled();
        expect(triggerDraftFromDiscussionMock).not.toHaveBeenCalled();
        expect(runtime.enqueueAiJob).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            jobType: 'discussion_message_analyze',
            scopeType: 'circle',
            scopeCircleId: 7,
            requestedByUserId: 11,
            payload: expect.objectContaining({
                circleId: 7,
                envelopeId: 'env-member-1',
            }),
        }));
        expect(redis.publish).toHaveBeenCalledWith(
            'discussion:circle:7',
            JSON.stringify({
                circleId: 7,
                latestLamport: 52,
                envelopeId: 'env-member-1',
                reason: 'message_created',
            }),
        );
        expect(next).not.toHaveBeenCalled();
    });

    test('still returns 201 when async analysis enqueue fails', async () => {
        jest.spyOn(runtime, 'enqueueAiJob').mockRejectedValueOnce(new Error('queue unavailable'));
        const prisma = createPrismaMock();
        const redis = {
            del: jest.fn(async () => 1),
            publish: jest.fn(async () => 1),
        } as any;
        const router = discussionRouter(prisma as any, redis);
        const handler = getRouteHandler(router, '/circles/:id/messages', 'post');
        const req = {
            params: { id: '7' },
            headers: {},
            body: {
                senderPubkey: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
                senderHandle: 'alice',
                text: '异步分析测试消息',
                clientTimestamp: '2026-04-01T10:00:00.000Z',
                nonce: 'abc123',
            },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(201);
        expect(runtime.enqueueAiJob).toHaveBeenCalledTimes(1);
        expect(next).not.toHaveBeenCalled();
    });
});
