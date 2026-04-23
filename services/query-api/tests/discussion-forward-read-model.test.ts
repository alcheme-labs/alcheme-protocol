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

describe('discussion forward read model', () => {
    test('legacy ghost draft status route is no longer exposed', () => {
        const prisma = {
            $queryRaw: jest.fn(),
        };

        const router = discussionRouter(prisma as any, {} as any);

        expect(() => getRouteHandler(router, '/circles/:circleId/ghost-draft-status', 'get')).toThrow(
            'route handler not found for GET /circles/:circleId/ghost-draft-status',
        );
    });

    test('circle messages expose explicit forwardCard and include governed forwards in read SQL', async () => {
        const queryRaw: any = jest.fn()
            .mockImplementationOnce(async () => [{
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
                payloadText: '讨论材料：把这一段带到更适合继续提炼的圈层。',
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
                clientTimestamp: new Date('2026-03-02T10:05:00.000Z'),
                lamport: 42n,
                prevEnvelopeId: null,
                deleted: false,
                tombstoneReason: null,
                tombstonedAt: null,
                sourceMessageDeleted: true,
                createdAt: new Date('2026-03-02T10:05:00.000Z'),
                updatedAt: new Date('2026-03-02T10:05:00.000Z'),
            }])
            .mockImplementationOnce(async () => []);

        const prisma = {
            $queryRaw: queryRaw,
        };

        const router = discussionRouter(prisma as any, {} as any);
        const handler = getRouteHandler(router, '/circles/:id/messages', 'get');

        const req = {
            params: { id: '8' },
            query: {},
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload.messages).toHaveLength(1);
        expect(res.payload.messages[0]).toMatchObject({
            envelopeId: 'env-forward-1',
            messageKind: 'forward',
            forwardCard: {
                sourceEnvelopeId: 'env-source-1',
                sourceCircleId: 7,
                sourceCircleName: 'Lv0 Circle',
                sourceLevel: 0,
                sourceAuthorHandle: 'alice',
                forwarderHandle: 'bob',
                sourceDeleted: true,
                snapshotText: '讨论材料：把这一段带到更适合继续提炼的圈层。',
            },
        });
        const firstQueryCall = queryRaw.mock.calls[0] as unknown[] | undefined;
        expect(firstQueryCall).toBeDefined();
        const firstQueryArg = firstQueryCall?.[0] as any;
        const renderedSql = Array.isArray(firstQueryArg)
            ? firstQueryArg.join('?')
            : typeof firstQueryArg?.sql === 'string'
                ? firstQueryArg.sql
                : '';
        expect(renderedSql).toContain('m.message_kind = \'forward\'');
        expect(renderedSql).toContain('m.message_kind IN (\'forward\', \'draft_candidate_notice\', \'governance_notice\')');
        expect(renderedSql).not.toContain('AND m.subject_type IS NULL\n                  AND m.subject_id IS NULL');
        expect(next).not.toHaveBeenCalled();
    });

    test('circle messages include draft candidate and governance notices in the chronological stream SQL', async () => {
        const queryRaw: any = jest.fn()
            .mockImplementationOnce(async () => [{
                envelopeId: 'env-notice-1',
                roomKey: 'circle:8',
                circleId: 8,
                senderPubkey: 'system_notice',
                senderHandle: 'ghost.system',
                messageKind: 'draft_candidate_notice',
                subjectType: 'discussion_message',
                subjectId: 'env-source-1',
                metadata: {
                    candidateId: 'cand_123',
                    state: 'accepted',
                    draftPostId: 77,
                    sourceMessageIds: ['env-source-1'],
                    sourceDiscussionLabels: ['fact'],
                },
                payloadText: 'discussion candidate accepted as draft',
                payloadHash: 'a'.repeat(64),
                nonce: 'notice123',
                signature: null,
                signatureVerified: true,
                authMode: 'system_notice',
                sessionId: null,
                relevanceScore: 1,
                semanticScore: 1,
                qualityScore: 0.7,
                spamScore: 0,
                decisionConfidence: 0.7,
                relevanceMethod: 'system',
                isFeatured: false,
                highlightCount: 0,
                featureReason: null,
                featuredAt: null,
                clientTimestamp: new Date('2026-03-16T10:05:00.000Z'),
                lamport: 43n,
                prevEnvelopeId: null,
                deleted: false,
                tombstoneReason: null,
                tombstonedAt: null,
                sourceMessageDeleted: false,
                createdAt: new Date('2026-03-16T10:05:00.000Z'),
                updatedAt: new Date('2026-03-16T10:05:00.000Z'),
            }])
            .mockImplementationOnce(async () => []);

        const prisma = {
            $queryRaw: queryRaw,
        };

        const router = discussionRouter(prisma as any, {} as any);
        const handler = getRouteHandler(router, '/circles/:id/messages', 'get');

        const req = {
            params: { id: '8' },
            query: {},
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload.messages).toHaveLength(1);
        expect(res.payload.messages[0]).toMatchObject({
            envelopeId: 'env-notice-1',
            messageKind: 'draft_candidate_notice',
            subjectType: 'discussion_message',
            subjectId: 'env-source-1',
        });
        const firstQueryCall = queryRaw.mock.calls[0] as unknown[] | undefined;
        expect(firstQueryCall).toBeDefined();
        const firstQueryArg = firstQueryCall?.[0] as any;
        const renderedSql = Array.isArray(firstQueryArg)
            ? firstQueryArg.join('?')
            : typeof firstQueryArg?.sql === 'string'
                ? firstQueryArg.sql
                : '';
        expect(renderedSql).toContain('draft_candidate_notice');
        expect(renderedSql).toContain('governance_notice');
        expect(renderedSql).toContain('m.subject_type = \'discussion_message\'');
        expect(next).not.toHaveBeenCalled();
    });
});
