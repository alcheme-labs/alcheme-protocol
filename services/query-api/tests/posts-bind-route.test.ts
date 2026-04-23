import { describe, expect, test, jest } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import type { Router } from 'express';

import { postRouter } from '../src/rest/posts';

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

function createPrismaMock(input?: {
    existingPost?: Partial<{
        id: number;
        contentId: string;
        authorId: number;
        circleId: number | null;
        status: string;
        visibility: string;
        createdAt: Date;
    }>;
    memberStatus?: 'Active' | 'Banned' | null;
    circle?: Partial<{
        id: number;
        onChainAddress: string;
        mode: string;
        kind: string;
    }>;
}) {
    const existingPost = {
        id: 1,
        contentId: 'content-1',
        authorId: 11,
        circleId: null as number | null,
        status: 'Published',
        visibility: 'Public',
        createdAt: new Date(Date.now() - 5 * 60 * 1000),
        ...(input?.existingPost || {}),
    };
    const circle = {
        id: 7,
        onChainAddress: 'circle-pda-7',
        mode: 'social',
        kind: 'auxiliary',
        ...(input?.circle || {}),
    };

    return {
        circle: {
            findUnique: jest.fn(async () => circle),
        },
        post: {
            findUnique: jest.fn(async () => existingPost),
            findFirst: jest.fn(async () => existingPost),
            update: jest.fn(async (args: any) => ({
                id: existingPost.id,
                contentId: args.where.contentId ?? existingPost.contentId,
                circleId: args.data.circleId,
                text: args.data.text ?? null,
                visibility: existingPost.visibility,
                status: args.data.status ?? existingPost.status,
                updatedAt: new Date(),
            })),
        },
        circleMember: {
            findUnique: jest.fn(async () => {
                if (input?.memberStatus === null) return null;
                return { status: input?.memberStatus || 'Active' };
            }),
        },
    };
}

function createRedisMock() {
    return {
        del: jest.fn(async () => 1),
        publish: jest.fn(async () => 1),
    };
}

describe('post circle bind route authority boundary', () => {
    test('rejects visibility patch as deprecated authority field', async () => {
        const prisma = createPrismaMock();
        const redis = createRedisMock();
        const router = postRouter(prisma as any, redis as any);
        const handler = getRouteHandler(router, '/:contentId/circle', 'post');

        const req = {
            userId: 11,
            params: { contentId: 'content-1' },
            body: { circleId: 7, visibility: 'Public' },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(400);
        expect(res.payload).toMatchObject({
            error: 'deprecated_authority_fields',
        });
        expect((prisma.post.update as any)).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('allows status=Draft patch only for recent unbound posts', async () => {
        const prisma = createPrismaMock({
            existingPost: {
                status: 'Published',
                circleId: null,
                createdAt: new Date(Date.now() - 2 * 60 * 1000),
            },
            circle: {
                mode: 'knowledge',
                kind: 'main',
            },
        });
        const redis = createRedisMock();
        const router = postRouter(prisma as any, redis as any);
        const handler = getRouteHandler(router, '/:contentId/circle', 'post');

        const req = {
            userId: 11,
            params: { contentId: 'content-1' },
            body: { circleId: 7, status: 'Draft', text: 'draft content' },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect((prisma.post.update as any)).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 1 },
                data: expect.objectContaining({
                    circleId: 7,
                    text: 'draft content',
                    status: 'Draft',
                }),
            }),
        );
        expect(next).not.toHaveBeenCalled();
    });

    test('rejects status=Draft patch for stale posts', async () => {
        const prisma = createPrismaMock({
            existingPost: {
                status: 'Published',
                circleId: null,
                createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
            },
        });
        const redis = createRedisMock();
        const router = postRouter(prisma as any, redis as any);
        const handler = getRouteHandler(router, '/:contentId/circle', 'post');

        const req = {
            userId: 11,
            params: { contentId: 'content-1' },
            body: { circleId: 7, status: 'Draft' },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(409);
        expect(res.payload).toMatchObject({
            error: 'draft_status_patch_not_allowed',
        });
        expect((prisma.post.update as any)).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('rejects non-draft status patch values', async () => {
        const prisma = createPrismaMock();
        const redis = createRedisMock();
        const router = postRouter(prisma as any, redis as any);
        const handler = getRouteHandler(router, '/:contentId/circle', 'post');

        const req = {
            userId: 11,
            params: { contentId: 'content-1' },
            body: { circleId: 7, status: 'Published' },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(400);
        expect(res.payload).toMatchObject({
            error: 'deprecated_authority_fields',
        });
        expect((prisma.post.update as any)).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('rejects binding public published posts into knowledge circles', async () => {
        const prisma = createPrismaMock({
            existingPost: {
                status: 'Published',
                visibility: 'Public',
            },
            circle: {
                mode: 'knowledge',
                kind: 'main',
            },
        });
        const redis = createRedisMock();
        const router = postRouter(prisma as any, redis as any);
        const handler = getRouteHandler(router, '/:contentId/circle', 'post');

        const req = {
            userId: 11,
            params: { contentId: 'content-1' },
            body: { circleId: 7, text: 'published feed into knowledge' },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(409);
        expect(res.payload).toMatchObject({
            error: 'circle_mode_intent_mismatch',
        });
        expect((prisma.post.update as any)).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('rejects binding draft posts into social circles', async () => {
        const prisma = createPrismaMock({
            existingPost: {
                status: 'Draft',
                visibility: 'CircleOnly',
            },
            circle: {
                mode: 'social',
                kind: 'main',
            },
        });
        const redis = createRedisMock();
        const router = postRouter(prisma as any, redis as any);
        const handler = getRouteHandler(router, '/:contentId/circle', 'post');

        const req = {
            userId: 11,
            params: { contentId: 'content-1' },
            body: { circleId: 7, status: 'Draft', text: 'draft into social' },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(409);
        expect(res.payload).toMatchObject({
            error: 'circle_mode_intent_mismatch',
        });
        expect((prisma.post.update as any)).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('binds v2 post when fallbackContentIds includes indexed identifier', async () => {
        const indexedPost = {
            id: 42,
            authorId: 11,
            circleId: null,
            status: 'Active',
            visibility: 'Public',
            createdAt: new Date(Date.now() - 2 * 60 * 1000),
            contentId: '1700000000000',
        };
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({ id: 7, onChainAddress: 'circle-pda-7', mode: 'social', kind: 'auxiliary' })),
            },
            post: {
                findUnique: jest.fn(async () => null),
                findFirst: jest.fn(async (args: any) => {
                    const candidates = (args?.where?.OR || [])
                        .map((entry: any) => entry?.contentId || entry?.onChainAddress)
                        .filter((value: unknown) => typeof value === 'string');
                    if (candidates.includes(indexedPost.contentId)) {
                        return indexedPost;
                    }
                    return null;
                }),
                update: jest.fn(async (args: any) => ({
                    id: indexedPost.id,
                    contentId: indexedPost.contentId,
                    circleId: args.data.circleId,
                    text: args.data.text ?? null,
                    visibility: indexedPost.visibility,
                    status: args.data.status ?? indexedPost.status,
                    updatedAt: new Date(),
                })),
            },
            circleMember: {
                findUnique: jest.fn(async () => ({ status: 'Active' })),
            },
        } as any;
        const redis = createRedisMock();
        const router = postRouter(prisma as any, redis as any);
        const handler = getRouteHandler(router, '/:contentId/circle', 'post');

        const req = {
            userId: 11,
            params: { contentId: 'legacy_content_id' },
            body: {
                circleId: 7,
                text: 'v2 bind test',
                fallbackContentIds: ['1700000000000'],
            },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect((prisma.post.findFirst as any)).toHaveBeenCalled();
        expect((prisma.post.update as any)).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: indexedPost.id },
                data: expect.objectContaining({
                    circleId: 7,
                    text: 'v2 bind test',
                }),
            }),
        );
        expect(next).not.toHaveBeenCalled();
    });

    test('keeps post_not_indexed_yet when both primary and fallback identifiers miss', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({ id: 7 })),
            },
            post: {
                findUnique: jest.fn(async () => null),
                findFirst: jest.fn(async () => null),
                update: jest.fn(),
            },
            circleMember: {
                findUnique: jest.fn(async () => ({ status: 'Active' })),
            },
        } as any;
        const redis = createRedisMock();
        const router = postRouter(prisma as any, redis as any);
        const handler = getRouteHandler(router, '/:contentId/circle', 'post');

        const req = {
            userId: 11,
            params: { contentId: 'missing_primary' },
            body: {
                circleId: 7,
                fallbackContentIds: ['missing_fallback'],
            },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(404);
        expect(res.payload).toMatchObject({
            error: 'post_not_indexed_yet',
        });
        expect((prisma.post.update as any)).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('returns explicit app/protocol/on-chain circle authority mapping on bind', async () => {
        const prisma = createPrismaMock();
        const redis = createRedisMock();
        const router = postRouter(prisma as any, redis as any);
        const handler = getRouteHandler(router, '/:contentId/circle', 'post');

        const req = {
            userId: 11,
            params: { contentId: 'content-1' },
            body: { circleId: 7 },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            circleAuthority: {
                appCircleId: 7,
                protocolCircleId: 7,
                circleOnChainAddress: 'circle-pda-7',
            },
        });
        expect(next).not.toHaveBeenCalled();
    });
});

describe('circle authority mapping exposure', () => {
    const repoRoot = path.resolve(__dirname, '..');
    const schemaPath = path.join(repoRoot, 'src/graphql/schema.ts');
    const resolverPath = path.join(repoRoot, 'src/graphql/resolvers.ts');

    function read(filePath: string): string {
        return fs.readFileSync(filePath, 'utf8');
    }

    test('GraphQL Circle exposes protocol circle id and on-chain address explicitly', () => {
        const schema = read(schemaPath);
        const resolvers = read(resolverPath);

        expect(schema).toMatch(/protocolCircleId:\s*Int!/);
        expect(schema).toMatch(/onChainAddress:\s*String!/);
        expect(resolvers).toMatch(/protocolCircleId:\s*\(circle:\s*any\)\s*=>\s*circle\.id/);
    });
});
