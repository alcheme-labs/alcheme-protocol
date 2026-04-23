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
        isEphemeral: false,
        expiresAt: null,
        clientTimestamp: new Date('2026-03-02T10:00:00.000Z'),
        lamport: BigInt(42),
        prevEnvelopeId: null,
        deleted: false,
        tombstoneReason: null,
        tombstonedAt: null,
        createdAt: new Date('2026-03-02T10:00:00.000Z'),
        updatedAt: new Date('2026-03-02T10:00:00.000Z'),
    };

    const insertedForwardRow = {
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
        isEphemeral: false,
        expiresAt: null,
        clientTimestamp: new Date('2026-03-02T10:05:00.000Z'),
        createdAt: new Date('2026-03-02T10:05:00.000Z'),
        updatedAt: new Date('2026-03-02T10:05:00.000Z'),
    };

    const tx = {
        $queryRaw: jest.fn(async () => ([insertedForwardRow])),
        $executeRaw: jest.fn(async () => 1),
    };

    const defaultCircleFindUnique = jest.fn(async (input: { where: { id: number } }) => {
        const id = input?.where?.id;
        if (id === 7) {
            return {
                id: 7,
                name: 'Lv0 Circle',
                level: 0,
                parentCircleId: null,
            };
        }
        if (id === 8) {
            return {
                id: 8,
                name: 'Lv1 Circle',
                level: 1,
                parentCircleId: 7,
            };
        }
        return null;
    });

    const defaultMemberFindUnique = jest.fn();
    defaultMemberFindUnique
        .mockImplementationOnce(async () => ({
            role: 'Member',
            status: 'Active',
            identityLevel: 'Member',
        }))
        .mockImplementationOnce(async () => ({
            role: 'Member',
            status: 'Active',
            identityLevel: 'Member',
        }));

    return {
        user: {
            findUnique: jest.fn(async () => ({
                id: 11,
                pubkey: '9QfRrR7dW7B8d8n3k3D6Vw6m3W9R2kA2jGk4dWpP1uHz',
                handle: 'bob',
            })),
        },
        circle: {
            findUnique: defaultCircleFindUnique,
        },
        circleMember: {
            findUnique: defaultMemberFindUnique,
        },
        $queryRaw: jest.fn(async () => ([sourceMessageRow])),
        $transaction: jest.fn(async (callback: any) => callback(tx)),
        __tx: tx,
        __sourceMessageRow: sourceMessageRow,
    };
}

describe('discussion forward route', () => {
    test('allows forwarding upward for active members of both circles', async () => {
        const prisma = createPrismaMock();
        const redis = {
            publish: jest.fn(async () => 1),
        };
        const router = discussionRouter(prisma as any, redis as any);
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
        expect(res.payload).toMatchObject({
            ok: true,
        });
        expect(res.payload.message).toMatchObject({
            envelopeId: 'env-forward-1',
            messageKind: 'forward',
            subjectType: 'discussion_message',
            subjectId: 'env-source-1',
            metadata: expect.objectContaining({
                sourceEnvelopeId: 'env-source-1',
                sourceCircleId: 7,
                forwarderHandle: 'bob',
            }),
        });
        expect(redis.publish).toHaveBeenCalledWith(
            'discussion:circle:8',
            JSON.stringify({
                circleId: 8,
                latestLamport: 42,
                envelopeId: 'env-forward-1',
                reason: 'message_forwarded',
            }),
        );
        expect(next).not.toHaveBeenCalled();
    });

    test('rejects same-level forwarding', async () => {
        const prisma = createPrismaMock();
        const circleFindUnique = jest.fn(async (input: { where: { id: number } }) => {
            const id = input?.where?.id;
            if (id === 1) {
                return {
                    id: 1,
                    name: 'Root Circle',
                    level: 0,
                    parentCircleId: null,
                };
            }
            if (id === 7) {
                return {
                    id: 7,
                    name: 'Lv0 Circle',
                    level: 1,
                    parentCircleId: 1,
                };
            }
            if (id === 8) {
                return {
                    id: 8,
                    name: 'Peer Circle',
                    level: 1,
                    parentCircleId: 1,
                };
            }
            return null;
        });
        prisma.circle.findUnique = circleFindUnique as any;
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
        expect(res.payload).toMatchObject({
            error: 'forward_same_or_lower_level_not_allowed',
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('rejects forwarding a forwarded card', async () => {
        const prisma = createPrismaMock();
        (prisma.$queryRaw as any).mockResolvedValueOnce([{
            ...prisma.__sourceMessageRow,
            messageKind: 'forward',
        }]);
        const router = discussionRouter(prisma as any, {} as any);
        const handler = getRouteHandler(router, '/messages/:envelopeId/forward', 'post');

        const req = {
            params: { envelopeId: 'env-forward-0' },
            userId: 11,
            body: { targetCircleId: 8 },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(409);
        expect(res.payload).toMatchObject({
            error: 'forward_of_forward_not_allowed',
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('rejects forwarding when target membership is missing', async () => {
        const prisma = createPrismaMock();
        const memberFindUnique = jest.fn();
        memberFindUnique
            .mockImplementationOnce(async () => ({
                role: 'Member',
                status: 'Active',
                identityLevel: 'Member',
            }))
            .mockImplementationOnce(async () => null);
        prisma.circleMember.findUnique = memberFindUnique as any;
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
        expect(res.payload).toMatchObject({
            error: 'target_circle_membership_required',
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('returns 404 when source message does not exist', async () => {
        const prisma = createPrismaMock();
        (prisma.$queryRaw as any).mockResolvedValueOnce([]);
        const router = discussionRouter(prisma as any, {} as any);
        const handler = getRouteHandler(router, '/messages/:envelopeId/forward', 'post');

        const req = {
            params: { envelopeId: 'missing-env' },
            userId: 11,
            body: { targetCircleId: 8 },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(404);
        expect(res.payload).toMatchObject({
            error: 'discussion_message_not_found',
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('rejects forwarding visitor dust messages', async () => {
        const prisma = createPrismaMock();
        (prisma.$queryRaw as any).mockResolvedValueOnce([{
            ...prisma.__sourceMessageRow,
            isEphemeral: true,
            expiresAt: new Date('2026-03-03T10:00:00.000Z'),
        }]);
        const router = discussionRouter(prisma as any, {} as any);
        const handler = getRouteHandler(router, '/messages/:envelopeId/forward', 'post');

        const req = {
            params: { envelopeId: 'env-visitor-1' },
            userId: 11,
            body: { targetCircleId: 8 },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(409);
        expect(res.payload).toMatchObject({
            error: 'forward_ephemeral_not_allowed',
        });
        expect(next).not.toHaveBeenCalled();
    });
});
