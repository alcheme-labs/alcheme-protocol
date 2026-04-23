import { describe, expect, test, jest } from '@jest/globals';
import type { Router } from 'express';

import { discussionRouter } from '../src/rest/discussion';
import {
    buildDiscussionSigningMessage,
    buildDiscussionSigningPayload,
} from '../src/services/offchainDiscussion';

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

function createPrismaMock() {
    const tx = {
        $queryRaw: jest.fn(async () => ([
            {
                envelopeId: 'env-1',
                roomKey: 'circle:7',
                circleId: 7,
                senderPubkey: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
                senderHandle: 'alice',
                payloadText: 'Crystal thread message',
                payloadHash: 'f'.repeat(64),
                nonce: 'abc123',
                signature: null,
                signatureVerified: true,
                authMode: 'wallet_per_message',
                sessionId: 'session-knowledge-1',
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
                clientTimestamp: new Date('2026-03-01T12:00:00.000Z'),
                lamport: BigInt(12),
                prevEnvelopeId: null,
                deleted: false,
                tombstoneReason: null,
                tombstonedAt: null,
                createdAt: new Date('2026-03-01T12:00:00.000Z'),
                updatedAt: new Date('2026-03-01T12:00:00.000Z'),
                subjectType: 'knowledge',
                subjectId: 'knowledge-9',
            },
        ])),
        $executeRaw: jest.fn(async () => 1),
        knowledge: {
            update: jest.fn(async () => ({ id: 9, heatScore: 3 })),
        },
    };

    return {
        knowledge: {
            findUnique: jest.fn(async () => ({
                id: 9,
                knowledgeId: 'knowledge-9',
                circleId: 7,
            })),
        },
        user: {
            findUnique: jest.fn(async () => ({
                id: 11,
                pubkey: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
                handle: 'alice',
            })),
        },
        circleMember: {
            findUnique: jest.fn(async () => ({
                role: 'Member',
                status: 'Active',
                identityLevel: 'Member',
            })),
        },
        $queryRaw: jest.fn(async () => ([
            {
                envelopeId: 'env-1',
                roomKey: 'circle:7',
                circleId: 7,
                senderPubkey: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
                senderHandle: 'alice',
                payloadText: 'Crystal thread message',
                payloadHash: 'f'.repeat(64),
                nonce: 'abc123',
                signature: null,
                signatureVerified: true,
                authMode: 'wallet_per_message',
                sessionId: 'session-knowledge-1',
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
                clientTimestamp: new Date('2026-03-01T12:00:00.000Z'),
                lamport: BigInt(12),
                prevEnvelopeId: null,
                deleted: false,
                tombstoneReason: null,
                tombstonedAt: null,
                createdAt: new Date('2026-03-01T12:00:00.000Z'),
                updatedAt: new Date('2026-03-01T12:00:00.000Z'),
                subjectType: 'knowledge',
                subjectId: 'knowledge-9',
            },
        ])),
        $transaction: jest.fn(async (callback: any) => callback(tx)),
        __tx: tx,
    };
}

describe('knowledge discussion routes', () => {
    test('fetches crystal-thread messages for active circle members', async () => {
        const prisma = createPrismaMock();
        const router = discussionRouter(prisma as any, {} as any);
        const handler = getRouteHandler(router, '/knowledge/:knowledgeId/messages', 'get');

        const req = {
            params: { knowledgeId: 'knowledge-9' },
            query: { limit: '20' },
            userId: 11,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            knowledgeId: 'knowledge-9',
            circleId: 7,
            count: 1,
        });
        expect(res.payload.messages[0]).toMatchObject({
            envelopeId: 'env-1',
            subjectType: 'knowledge',
            subjectId: 'knowledge-9',
        });
        expect(res.payload.messages[0].sessionId).toBeNull();
        expect(next).not.toHaveBeenCalled();
    });

    test('rejects posting crystal-thread messages for non-members', async () => {
        const prisma = createPrismaMock();
        (prisma.circleMember.findUnique as any).mockResolvedValueOnce(null);
        const router = discussionRouter(prisma as any, {} as any);
        const handler = getRouteHandler(router, '/knowledge/:knowledgeId/messages', 'post');

        const req = {
            params: { knowledgeId: 'knowledge-9' },
            userId: 11,
            body: {
                senderPubkey: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
                text: 'I want to discuss this crystal',
                clientTimestamp: '2026-03-01T12:00:00.000Z',
                nonce: 'abc123',
            },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(403);
        expect(res.payload).toMatchObject({
            error: 'discussion_membership_required',
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('bumps crystal heat when a subject-bound knowledge message is created', async () => {
        const prisma = createPrismaMock();
        const router = discussionRouter(prisma as any, { del: jest.fn(async () => 1) } as any);
        const handler = getRouteHandler(router, '/knowledge/:knowledgeId/messages', 'post');

        const clientTimestamp = '2026-03-01T12:00:00.000Z';
        const nonce = 'abc123';
        const signedPayload = buildDiscussionSigningPayload({
            roomKey: 'circle:7',
            circleId: 7,
            senderPubkey: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
            text: 'I want to discuss this crystal',
            clientTimestamp,
            nonce,
            subjectType: 'knowledge',
            subjectId: 'knowledge-9',
        });
        const signedMessage = buildDiscussionSigningMessage(signedPayload);

        const req = {
            params: { knowledgeId: 'knowledge-9' },
            userId: 11,
            headers: {},
            body: {
                senderPubkey: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
                text: 'I want to discuss this crystal',
                clientTimestamp,
                nonce,
                signedMessage,
            },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(201);
        expect(prisma.__tx.knowledge.update).toHaveBeenCalledWith({
            where: { knowledgeId: 'knowledge-9' },
            data: { heatScore: { increment: 3 } },
            select: { id: true, heatScore: true },
        });
        expect(next).not.toHaveBeenCalled();
    });
});
