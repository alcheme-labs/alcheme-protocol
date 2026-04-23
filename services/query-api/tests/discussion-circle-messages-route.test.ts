import { describe, expect, test, jest } from '@jest/globals';
import type { Router } from 'express';

import { discussionRouter } from '../src/rest/discussion';

function getRouteHandler(router: Router, path: string, method: 'get') {
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

function createDiscussionRow(overrides: Record<string, unknown> = {}) {
    return {
        envelopeId: 'env-1',
        roomKey: 'circle:8',
        circleId: 8,
        senderPubkey: '9QfRrR7dW7B8d8n3k3D6Vw6m3W9R2kA2jGk4dWpP1uHz',
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
        relevanceStatus: 'ready',
        embeddingScore: 1,
        actualMode: 'embedding',
        analysisVersion: 'v1',
        topicProfileVersion: 'topic:1',
        semanticFacets: [],
        focusScore: 1,
        focusLabel: 'focused',
        analysisCompletedAt: new Date('2026-04-08T10:00:00.000Z'),
        analysisErrorCode: null,
        analysisErrorMessage: null,
        authorAnnotations: [],
        isFeatured: false,
        highlightCount: 0,
        featureReason: null,
        featuredAt: null,
        isEphemeral: false,
        expiresAt: null,
        clientTimestamp: new Date('2026-04-08T10:00:00.000Z'),
        lamport: 42n,
        prevEnvelopeId: null,
        deleted: false,
        tombstoneReason: null,
        tombstonedAt: null,
        sourceMessageDeleted: null,
        createdAt: new Date('2026-04-08T10:00:00.000Z'),
        updatedAt: new Date('2026-04-08T10:00:00.000Z'),
        ...overrides,
    };
}

describe('discussion circle messages route', () => {
    test('afterLamport returns only newer messages in ascending lamport order', async () => {
        const queryRaw: any = jest.fn()
            .mockImplementationOnce(async () => [
                createDiscussionRow({ envelopeId: 'env-43', lamport: 43n }),
                createDiscussionRow({ envelopeId: 'env-44', lamport: 44n }),
            ])
            .mockImplementationOnce(async () => []);

        const prisma = { $queryRaw: queryRaw };
        const router = discussionRouter(prisma as any, {} as any);
        const handler = getRouteHandler(router, '/circles/:id/messages', 'get');

        const req = {
            params: { id: '8' },
            query: { afterLamport: '42', limit: '120' },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload.messages.map((message: any) => message.envelopeId)).toEqual(['env-43', 'env-44']);

        const firstQueryArg = queryRaw.mock.calls[0]?.[0] as any;
        const renderedSql = Array.isArray(firstQueryArg)
            ? firstQueryArg.join('?')
            : typeof firstQueryArg?.sql === 'string'
                ? firstQueryArg.sql
                : '';
        expect(renderedSql).toContain('m.lamport >');
        expect(renderedSql).toContain('ORDER BY m.lamport ASC');
        expect(next).not.toHaveBeenCalled();
    });

    test('afterLamport still returns forwarded messages and system notices', async () => {
        const queryRaw: any = jest.fn()
            .mockImplementationOnce(async () => [
                createDiscussionRow({
                    envelopeId: 'env-forward',
                    lamport: 43n,
                    messageKind: 'forward',
                    subjectType: 'discussion_message',
                    subjectId: 'env-source',
                    metadata: {
                        sourceEnvelopeId: 'env-source',
                        sourceCircleId: 7,
                        sourceCircleName: 'Lv0 Circle',
                        sourceLevel: 0,
                        sourceAuthorHandle: 'alice',
                        forwarderHandle: 'bob',
                        sourceMessageCreatedAt: '2026-04-08T10:00:00.000Z',
                        forwardedAt: '2026-04-08T10:05:00.000Z',
                        sourceDeleted: false,
                        snapshotText: 'forwarded',
                    },
                }),
                createDiscussionRow({
                    envelopeId: 'env-notice',
                    lamport: 44n,
                    senderPubkey: 'system_notice',
                    senderHandle: 'ghost.system',
                    messageKind: 'draft_candidate_notice',
                    subjectType: 'discussion_message',
                    subjectId: 'env-source',
                    metadata: { candidateId: 'cand_123', state: 'open', sourceMessageIds: ['env-source'] },
                }),
            ])
            .mockImplementationOnce(async () => []);

        const prisma = { $queryRaw: queryRaw };
        const router = discussionRouter(prisma as any, {} as any);
        const handler = getRouteHandler(router, '/circles/:id/messages', 'get');

        const req = {
            params: { id: '8' },
            query: { afterLamport: '42' },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload.messages.map((message: any) => message.messageKind)).toEqual([
            'forward',
            'draft_candidate_notice',
        ]);
        expect(next).not.toHaveBeenCalled();
    });

    test('beforeLamport and afterLamport cannot be combined', async () => {
        const prisma = { $queryRaw: jest.fn() };
        const router = discussionRouter(prisma as any, {} as any);
        const handler = getRouteHandler(router, '/circles/:id/messages', 'get');

        const req = {
            params: { id: '8' },
            query: { beforeLamport: '100', afterLamport: '42' },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(400);
        expect(res.payload).toEqual(expect.objectContaining({ error: 'invalid_lamport_range' }));
        expect(next).not.toHaveBeenCalled();
    });

    test('invalid afterLamport returns 400', async () => {
        const prisma = { $queryRaw: jest.fn() };
        const router = discussionRouter(prisma as any, {} as any);
        const handler = getRouteHandler(router, '/circles/:id/messages', 'get');

        const req = {
            params: { id: '8' },
            query: { afterLamport: 'not-a-number' },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(400);
        expect(res.payload).toEqual(expect.objectContaining({ error: 'invalid_after_lamport' }));
        expect(next).not.toHaveBeenCalled();
    });

    test('targeted lookup route exists for envelope-scoped Plaza refresh', async () => {
        const prisma = { $queryRaw: jest.fn() };
        const router = discussionRouter(prisma as any, {} as any);

        expect(() => getRouteHandler(router, '/circles/:id/messages/lookup', 'get')).not.toThrow();
    });
});
