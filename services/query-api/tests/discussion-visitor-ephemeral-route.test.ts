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

function createPrismaMock() {
    const insertedRow = {
        envelopeId: 'env-visitor-1',
        roomKey: 'circle:7',
        circleId: 7,
        senderPubkey: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
        senderHandle: 'visitor_alice',
        messageKind: 'plain',
        subjectType: null,
        subjectId: null,
        metadata: null,
        payloadText: '游客烟尘消息',
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
        isEphemeral: true,
        expiresAt: new Date('2026-03-03T10:00:00.000Z'),
        clientTimestamp: new Date('2026-03-02T10:00:00.000Z'),
        lamport: BigInt(52),
        prevEnvelopeId: null,
        deleted: false,
        tombstoneReason: null,
        tombstonedAt: null,
        sourceMessageDeleted: null,
        createdAt: new Date('2026-03-02T10:00:00.000Z'),
        updatedAt: new Date('2026-03-02T10:00:00.000Z'),
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
                handle: 'visitor_alice',
            })),
        },
        circle: {
            findUnique: jest.fn(async () => ({
                id: 7,
                name: 'Lv0 Circle',
                description: 'root',
            })),
        },
        circleMember: {
            findUnique: jest.fn(async () => null),
        },
        $queryRaw: jest.fn(async () => ([])),
        $transaction: jest.fn(async (callback: any) => callback(tx)),
    };
}

describe('discussion visitor dust route', () => {
    test('allows non-member registered users to post ephemeral visitor messages', async () => {
        const prisma = createPrismaMock();
        const redis = {
            del: jest.fn(async () => 1),
        };
        const router = discussionRouter(prisma as any, redis as any);
        const handler = getRouteHandler(router, '/circles/:id/messages', 'post');

        const req = {
            params: { id: '7' },
            headers: {},
            body: {
                senderPubkey: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
                senderHandle: 'visitor_alice',
                text: '游客烟尘消息',
                clientTimestamp: '2026-03-02T10:00:00.000Z',
                nonce: 'abc123',
            },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(201);
        expect(res.payload).toMatchObject({
            ok: true,
            message: {
                envelopeId: 'env-visitor-1',
                isEphemeral: true,
            },
        });
        expect(typeof res.payload?.message?.expiresAt).toBe('string');
        expect(next).not.toHaveBeenCalled();
    });

    test('allows wallet-only visitors without registered identity rows to post ephemeral dust messages', async () => {
        const prisma = createPrismaMock();
        prisma.user.findUnique = jest.fn(async () => null) as any;
        const redis = {
            del: jest.fn(async () => 1),
        };
        const router = discussionRouter(prisma as any, redis as any);
        const handler = getRouteHandler(router, '/circles/:id/messages', 'post');

        const req = {
            params: { id: '7' },
            headers: {},
            body: {
                senderPubkey: '9QfRrR7dW7B8d8n3k3D6Vw6m3W9R2kA2jGk4dWpP1uHz',
                senderHandle: 'wallet_guest',
                text: '匿名钱包烟尘消息',
                clientTimestamp: '2026-03-02T10:00:00.000Z',
                nonce: 'wallet-guest-1',
            },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(201);
        expect(res.payload).toMatchObject({
            ok: true,
            message: {
                isEphemeral: true,
            },
        });
        expect(prisma.user.findUnique).toHaveBeenCalledWith({
            where: { pubkey: '9QfRrR7dW7B8d8n3k3D6Vw6m3W9R2kA2jGk4dWpP1uHz' },
            select: { id: true, handle: true },
        });
        expect(prisma.circleMember.findUnique).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });
});
