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
    const sourceMessageRow = {
        envelopeId: 'env-source-1',
        roomKey: 'circle:7',
        circleId: 7,
        senderPubkey: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
        senderHandle: 'alice',
        messageKind: 'plain',
        subjectType: null,
        subjectId: null,
        metadata: null,
        payloadText: '讨论材料：把这一段带到更适合继续提炼的圈层。',
        payloadHash: 'f'.repeat(64),
        nonce: 'abc123',
        signature: null,
        signatureVerified: true,
        authMode: 'session_token',
        sessionId: 'session-1',
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
        clientTimestamp: new Date('2026-03-02T10:00:00.000Z'),
        lamport: BigInt(42),
        prevEnvelopeId: null,
        deleted: false,
        tombstoneReason: null,
        tombstonedAt: null,
        sourceMessageDeleted: null,
        createdAt: new Date('2026-03-02T10:00:00.000Z'),
        updatedAt: new Date('2026-03-02T10:00:00.000Z'),
    };

    const tx = {
        $queryRaw: jest.fn(async () => ([{
            ...sourceMessageRow,
            envelopeId: 'env-forward-1',
            roomKey: 'circle:8',
            circleId: 8,
            senderPubkey: '9QfRrR7dW7B8d8n3k3D6Vw6m3W9R2kA2jGk4dWpP1uHz',
            senderHandle: 'bob',
            messageKind: 'forward',
            subjectType: 'discussion_message',
            subjectId: 'env-source-1',
            metadata: {
                sourceEnvelopeId: 'env-source-1',
                sourceCircleId: 7,
                sourceCircleName: 'Lv0 Circle',
                sourceLevel: 0,
                sourceAuthorHandle: 'alice',
                forwarderHandle: 'bob',
                sourceMessageCreatedAt: '2026-03-02T10:00:00.000Z',
                forwardedAt: '2026-03-02T10:05:00.000Z',
                sourceDeleted: false,
                snapshotText: '讨论材料：把这一段带到更适合继续提炼的圈层。',
            },
        }])),
        $executeRaw: jest.fn(async () => 1),
        notification: {
            create: jest.fn(async () => ({ id: 77 })),
        },
    };

    return {
        user: {
            findUnique: jest.fn(async (input: any) => {
                if (input?.where?.id === 11) {
                    return {
                        id: 11,
                        pubkey: '9QfRrR7dW7B8d8n3k3D6Vw6m3W9R2kA2jGk4dWpP1uHz',
                        handle: 'bob',
                    };
                }
                if (input?.where?.pubkey === '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa') {
                    return {
                        id: 17,
                        pubkey: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
                        handle: 'alice',
                    };
                }
                return null;
            }),
        },
        circle: {
            findUnique: jest.fn(async (input: { where: { id: number } }) => {
                const id = input?.where?.id;
                if (id === 7) {
                    return { id: 7, name: 'Lv0 Circle', level: 0, parentCircleId: null };
                }
                if (id === 8) {
                    return { id: 8, name: 'Lv1 Circle', level: 1, parentCircleId: 7 };
                }
                return null;
            }),
        },
        circleMember: {
            findUnique: jest.fn()
                .mockImplementationOnce(async () => ({ role: 'Member', status: 'Active', identityLevel: 'Member' }))
                .mockImplementationOnce(async () => ({ role: 'Member', status: 'Active', identityLevel: 'Member' })),
        },
        $queryRaw: jest.fn(async () => ([sourceMessageRow])),
        $transaction: jest.fn(async (callback: any) => callback(tx)),
        __tx: tx,
    };
}

describe('discussion forward notification', () => {
    test('notifies the original author on successful governed forwarding', async () => {
        const prisma = createPrismaMock();
        const router = discussionRouter(prisma as any, {} as any);
        const handler = getRouteHandler(router, '/messages/:envelopeId/forward', 'post');

        const req = {
            params: { envelopeId: 'env-source-1' },
            userId: 11,
            body: { targetCircleId: 8 },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(201);
        expect(prisma.__tx.notification.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                userId: 17,
                type: 'forward',
                sourceType: 'discussion',
                circleId: 8,
            }),
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('failed forwarding does not notify the original author', async () => {
        const prisma = createPrismaMock();
        prisma.circle.findUnique = jest.fn(async (input: { where: { id: number } }) => {
            const id = input?.where?.id;
            if (id === 1) {
                return { id: 1, name: 'Root Circle', level: 0, parentCircleId: null };
            }
            if (id === 7) {
                return { id: 7, name: 'Lv0 Circle', level: 1, parentCircleId: 1 };
            }
            if (id === 8) {
                return { id: 8, name: 'Peer Circle', level: 1, parentCircleId: 1 };
            }
            return null;
        }) as any;

        const router = discussionRouter(prisma as any, {} as any);
        const handler = getRouteHandler(router, '/messages/:envelopeId/forward', 'post');

        const req = {
            params: { envelopeId: 'env-source-1' },
            userId: 11,
            body: { targetCircleId: 8 },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(403);
        expect(prisma.__tx.notification.create).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });
});
