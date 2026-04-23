import { describe, expect, test, jest } from '@jest/globals';
import type { Router } from 'express';

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

describe('draft content route', () => {
    test('returns authoritative draft content heat score', async () => {
        const prisma = {
            post: {
                findUnique: jest.fn(async () => ({
                    id: 42,
                    authorId: 9,
                    circleId: 7,
                    status: 'Draft',
                    text: 'Draft body',
                    heatScore: 18.5,
                    updatedAt: new Date('2026-03-03T10:00:00.000Z'),
                })),
            },
            circleMember: {
                findUnique: jest.fn(async () => ({
                    role: 'Member',
                    status: 'Active',
                    identityLevel: 'Member',
                })),
            },
        } as any;

        const router = discussionRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/content', 'get');

        const req = {
            params: { postId: '42' },
            userId: 9,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            draftPostId: 42,
            text: 'Draft body',
            heatScore: 18.5,
        });
        expect(next).not.toHaveBeenCalled();
    });
});
