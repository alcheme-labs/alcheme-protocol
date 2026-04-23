import { describe, expect, jest, test } from '@jest/globals';
import type { Router } from 'express';

import { discussionRouter } from '../src/rest/discussion';

function getRouteHandler(router: Router, path: string, method: 'post') {
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

describe('ghost draft working copy route', () => {
    test('accept route writes through the shared working copy semantics and returns the updated working copy', async () => {
        const postFindUnique: any = jest.fn();
        postFindUnique.mockResolvedValueOnce({
            id: 42,
            authorId: 9,
            circleId: 7,
            status: 'Draft',
        });
        postFindUnique.mockResolvedValueOnce({
            id: 42,
            status: 'Draft',
            text: '',
            heatScore: 4,
            updatedAt: new Date('2026-03-24T12:00:00.000Z'),
        });
        postFindUnique.mockResolvedValueOnce({
            id: 42,
            status: 'Draft',
            text: '',
            heatScore: 4,
            updatedAt: new Date('2026-03-24T12:00:00.000Z'),
        });
        const prisma = {
            post: {
                findUnique: postFindUnique,
                update: jest.fn(async () => ({
                    id: 42,
                    status: 'Draft',
                    updatedAt: new Date('2026-03-24T12:01:00.000Z'),
                    heatScore: 9,
                })),
            },
            circleMember: {
                findUnique: jest.fn(async () => ({
                    role: 'Member',
                    status: 'Active',
                    identityLevel: 'Member',
                })),
            },
            ghostDraftGeneration: {
                findUnique: jest.fn(async () => ({
                    id: 15,
                    draftPostId: 42,
                    draftText: 'AI baseline',
                    origin: 'ai',
                    providerMode: 'builtin',
                    model: 'ghost-model',
                    promptAsset: 'ghost-draft-comment',
                    promptVersion: 'v1',
                    sourceDigest: 'a'.repeat(64),
                    ghostRunId: null,
                    createdAt: new Date('2026-03-24T11:59:00.000Z'),
                })),
            },
            ghostDraftAcceptance: {
                create: jest.fn(async () => ({
                    id: 88,
                    acceptedAt: new Date('2026-03-24T12:01:00.000Z'),
                })),
            },
        } as any;

        const router = discussionRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/ghost-drafts/:generationId/accept', 'post');

        const req = {
            params: { postId: '42', generationId: '15' },
            body: {
                mode: 'accept_replace',
                workingCopyHash: 'e'.repeat(64),
                workingCopyUpdatedAt: '2026-03-24T12:00:00.000Z',
            },
            userId: 8,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            result: {
                applied: true,
                changed: true,
                workingCopyContent: 'AI baseline',
                heatScore: 9,
                generation: {
                    generationId: 15,
                    postId: 42,
                },
            },
        });
        expect(next).not.toHaveBeenCalled();
    });
});
