import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Router } from 'express';

const listSeededFileTreeMock = jest.fn<() => Promise<any[]>>();
const resolveSeededReferenceMock = jest.fn<() => Promise<any>>();

jest.mock('../src/services/seeded/file-tree', () => ({
    listSeededFileTree: listSeededFileTreeMock,
}));

jest.mock('../src/services/seeded/reference-parser', () => ({
    resolveSeededReference: resolveSeededReferenceMock,
}));

import { seededRouter } from '../src/rest/seeded';

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

describe('seeded reference routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        listSeededFileTreeMock.mockResolvedValue([
            {
                id: 1,
                nodeType: 'directory',
                name: 'docs',
                path: 'docs',
                contentDigest: null,
                children: [],
            },
        ]);
        resolveSeededReferenceMock.mockResolvedValue({
            raw: '@file:docs/guide.md:2',
            path: 'docs/guide.md',
            line: 2,
            lineText: 'second line',
            fileName: 'guide.md',
            contentDigest: 'seeded-hash-7',
        });
    });

    test('returns the seeded file tree for active members', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    id: 7,
                    creatorId: 11,
                    genesisMode: 'SEEDED',
                })),
            },
            circleMember: {
                findUnique: jest.fn(async () => null),
            },
        } as any;

        const router = seededRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/:id/seeded/tree', 'get');
        const res = createMockResponse();

        await handler({
            params: { id: '7' },
            userId: 11,
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(200);
        expect(listSeededFileTreeMock).toHaveBeenCalledWith(prisma, 7);
        expect(res.payload).toMatchObject({
            ok: true,
            circleId: 7,
            custody: {
                plaintextReadAccess: 'active_member_or_creator',
            },
        });
    });

    test('resolves an @file:line reference for active members', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    id: 7,
                    creatorId: 11,
                    genesisMode: 'SEEDED',
                })),
            },
            circleMember: {
                findUnique: jest.fn(async () => null),
            },
        } as any;

        const router = seededRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/:id/seeded/reference', 'get');
        const res = createMockResponse();

        await handler({
            params: { id: '7' },
            userId: 11,
            query: {
                ref: '@file:docs/guide.md:2',
            },
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(200);
        expect(resolveSeededReferenceMock).toHaveBeenCalledWith(prisma, {
            circleId: 7,
            value: '@file:docs/guide.md:2',
        });
        expect(res.payload.reference).toMatchObject({
            path: 'docs/guide.md',
            line: 2,
            lineText: 'second line',
            contentDigest: 'seeded-hash-7',
        });
        expect(res.payload).toMatchObject({
            custody: {
                plaintextHosting: 'circle_seeded_explicit',
            },
        });
    });
});
