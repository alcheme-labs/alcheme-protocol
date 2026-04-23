import { describe, expect, test, jest } from '@jest/globals';
import type { Router } from 'express';

import { discussionRouter } from '../src/rest/discussion';

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

describe('discussion tombstone realtime publishing', () => {
    test('publishes tombstone and targeted forward refresh events', async () => {
        const tx = {
            $queryRaw: jest.fn(async () => ([{
                envelopeId: 'env-source-1',
                roomKey: 'circle:7',
                circleId: 7,
                senderPubkey: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
                senderHandle: 'alice',
                messageKind: 'plain',
                subjectType: null,
                subjectId: null,
                metadata: null,
                payloadText: 'hello',
                payloadHash: 'f'.repeat(64),
                nonce: 'abc123',
                signature: null,
                signatureVerified: true,
                authMode: 'session_token',
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
                clientTimestamp: new Date('2026-04-08T10:00:00.000Z'),
                lamport: 77n,
                prevEnvelopeId: null,
                deleted: true,
                tombstoneReason: 'user_deleted',
                tombstonedAt: new Date('2026-04-08T10:05:00.000Z'),
                sourceMessageDeleted: null,
                createdAt: new Date('2026-04-08T10:00:00.000Z'),
                updatedAt: new Date('2026-04-08T10:05:00.000Z'),
            }])),
            $executeRaw: jest.fn(async () => 1),
        };

        const queryRaw: any = jest.fn();
        queryRaw
            .mockResolvedValueOnce([{
                envelopeId: 'env-source-1',
                senderPubkey: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
                lamport: 42n,
                deleted: false,
            }])
            .mockResolvedValueOnce([{
                envelopeId: 'env-forward-1',
                circleId: 8,
            }]);
        const prisma = {
            $queryRaw: queryRaw,
            $transaction: jest.fn(async (callback: any) => callback(tx)),
        };
        const redis = {
            del: jest.fn(async () => 1),
            publish: jest.fn(async () => 1),
        };

        const router = discussionRouter(prisma as any, redis as any);
        const handler = getRouteHandler(router, '/circles/:id/messages/:envelopeId/tombstone', 'post');

        const req = {
            params: { id: '7', envelopeId: 'env-source-1' },
            headers: {},
            body: {
                senderPubkey: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
                reason: 'user_deleted',
                clientTimestamp: '2026-04-08T10:05:00.000Z',
            },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(redis.publish).toHaveBeenNthCalledWith(
            1,
            'discussion:circle:7',
            JSON.stringify({
                circleId: 7,
                latestLamport: 77,
                envelopeId: 'env-source-1',
                reason: 'message_tombstoned',
            }),
        );
        expect(redis.publish).toHaveBeenNthCalledWith(
            2,
            'discussion:circle:8',
            JSON.stringify({
                circleId: 8,
                latestLamport: null,
                envelopeId: 'env-forward-1',
                reason: 'message_refresh_required',
            }),
        );
        expect(next).not.toHaveBeenCalled();
    });
});
