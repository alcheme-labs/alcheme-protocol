import { describe, expect, test, jest } from '@jest/globals';
import type { Router } from 'express';

import { postRouter } from '../src/rest/posts';

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

describe('post read route compatibility payload', () => {
    test('returns author.pubkey so sdk can auto-resolve by-id v2 target author', async () => {
        const prisma = {
            post: {
                findUnique: jest.fn(async () => ({
                    contentId: 'v2-content-1',
                    onChainAddress: 'v2-content-1',
                    author: {
                        handle: 'alice',
                        pubkey: 'AuthorPubkey1111111111111111111111111111111111',
                        displayName: 'Alice',
                        avatarUri: null,
                    },
                })),
                findFirst: jest.fn(async () => null),
            },
        };
        const router = postRouter(
            prisma as any,
            {
                get: jest.fn(async () => null),
                setex: jest.fn(async () => 'OK'),
            } as any,
        );
        const handler = getRouteHandler(router, '/:contentId', 'get');
        const req = {
            params: { contentId: 'v2-content-1' },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload?.author?.pubkey).toBe('AuthorPubkey1111111111111111111111111111111111');
        expect((prisma.post.findUnique as any)).toHaveBeenCalledWith(
            expect.objectContaining({
                include: expect.objectContaining({
                    author: expect.objectContaining({
                        select: expect.objectContaining({
                            pubkey: true,
                        }),
                    }),
                }),
            }),
        );
        expect(next).not.toHaveBeenCalled();
    });
});
