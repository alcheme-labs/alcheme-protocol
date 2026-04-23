import { describe, expect, jest, test } from '@jest/globals';
import type { Router } from 'express';

import { crystalRouter } from '../src/rest/crystals';

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

describe('knowledge version diff route', () => {
    test('serves the structured version diff through the formal read route', async () => {
        const prisma = {
            knowledge: {
                findUnique: jest.fn(async () => ({
                    knowledgeId: 'K-1',
                    title: 'Latest crystal title',
                    description: 'Latest crystal description',
                    ipfsCid: 'bafy-current',
                    contentHash: 'f'.repeat(64),
                    version: 3,
                })),
            },
            $queryRaw: jest.fn(async () => ([
                {
                    id: BigInt(103),
                    knowledgeId: 'K-1',
                    eventType: 'contributors_updated',
                    version: 3,
                    actorPubkey: 'BobPubkey1111111111111111111111111111111111',
                    contributorsCount: 5,
                    contributorsRoot: 'b'.repeat(64),
                    sourceEventTimestamp: BigInt(1700001300),
                    eventAt: new Date('2026-03-24T21:03:00.000Z'),
                    createdAt: new Date('2026-03-24T21:03:02.000Z'),
                },
                {
                    id: BigInt(101),
                    knowledgeId: 'K-1',
                    eventType: 'knowledge_submitted',
                    version: 1,
                    actorPubkey: 'AlicePubkey11111111111111111111111111111111',
                    contributorsCount: null,
                    contributorsRoot: null,
                    sourceEventTimestamp: BigInt(1700001000),
                    eventAt: new Date('2026-03-24T21:00:00.000Z'),
                    createdAt: new Date('2026-03-24T21:00:02.000Z'),
                },
            ])),
            user: {
                findMany: jest.fn(async () => ([
                    {
                        pubkey: 'AlicePubkey11111111111111111111111111111111',
                        handle: 'alice',
                    },
                    {
                        pubkey: 'BobPubkey1111111111111111111111111111111111',
                        handle: 'bob',
                    },
                ])),
            },
        } as any;

        const router = crystalRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/:knowledgeId/version-diff', 'get');
        const res = createMockResponse();

        await handler({
            params: { knowledgeId: 'K-1' },
            query: {
                fromVersion: '1',
                toVersion: '3',
            },
        } as any, res as any);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            diff: {
                knowledgeId: 'K-1',
                fromVersion: 1,
                toVersion: 3,
                summary: '当前只能比较版本事件元数据；历史正文快照尚未入库。',
            },
        });
    });

    test('rejects invalid version-diff query parameters', async () => {
        const router = crystalRouter({} as any, {} as any);
        const handler = getRouteHandler(router, '/:knowledgeId/version-diff', 'get');
        const res = createMockResponse();

        await handler({
            params: { knowledgeId: 'K-1' },
            query: {
                fromVersion: 'NaN',
                toVersion: '3',
            },
        } as any, res as any);

        expect(res.statusCode).toBe(400);
        expect(res.payload).toMatchObject({
            error: 'invalid_version_range',
        });
    });
});
