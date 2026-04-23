import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Router } from 'express';
import type { markCircleTopicProfileDirty as markCircleTopicProfileDirtyFn } from '../src/services/discussion/analysis/invalidation';

const createSourceMaterialMock = jest.fn<() => Promise<any>>();
const listSourceMaterialsMock = jest.fn<() => Promise<any[]>>();
const markCircleTopicProfileDirtyMock = jest.fn<typeof markCircleTopicProfileDirtyFn>();

jest.mock('../src/services/sourceMaterials/ingest', () => ({
    createSourceMaterial: createSourceMaterialMock,
    SOURCE_MATERIAL_PLAINTEXT_CUSTODY: {
        publicNodePersistence: 'digest_locator_and_provenance_metadata',
        privatePlaintextStorage: 'trusted_private_store',
        groundingReadPath: 'authorized_private_fetch_bridge',
    },
}));

jest.mock('../src/services/sourceMaterials/readModel', () => ({
    listSourceMaterials: listSourceMaterialsMock,
}));

jest.mock('../src/services/discussion/analysis/invalidation', () => ({
    markCircleTopicProfileDirty: markCircleTopicProfileDirtyMock,
}));

import { sourceMaterialsRouter } from '../src/rest/sourceMaterials';

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

describe('source material routes', () => {
    const originalRuntimeRole = process.env.QUERY_API_RUNTIME_ROLE;
    const originalDeploymentProfile = process.env.QUERY_API_DEPLOYMENT_PROFILE;

    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.QUERY_API_RUNTIME_ROLE;
        delete process.env.QUERY_API_DEPLOYMENT_PROFILE;
        createSourceMaterialMock.mockResolvedValue({
            id: 31,
            circleId: 7,
            draftPostId: 11,
            name: 'appendix.md',
            mimeType: 'text/markdown',
            extractionStatus: 'ready',
            byteSize: 28,
            contentDigest: 'digest-31',
            chunkCount: 2,
        });
        listSourceMaterialsMock.mockResolvedValue([
            {
                id: 31,
                circleId: 7,
                draftPostId: 11,
                name: 'appendix.md',
                mimeType: 'text/markdown',
                status: 'ai_readable',
                contentDigest: 'digest-31',
                chunkCount: 2,
            },
        ]);
        markCircleTopicProfileDirtyMock.mockResolvedValue({
            updatedCount: 1,
            topicProfileVersion: 'topic:7:abcd',
        });
    });

    afterEach(() => {
        process.env.QUERY_API_RUNTIME_ROLE = originalRuntimeRole;
        process.env.QUERY_API_DEPLOYMENT_PROFILE = originalDeploymentProfile;
    });

    test('creates a source material with explicit circle ownership and optional draft binding', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    id: 7,
                    creatorId: 11,
                })),
            },
            circleMember: {
                findUnique: jest.fn(async () => ({
                    role: 'Member',
                    status: 'Active',
                    identityLevel: 'Member',
                })),
            },
            post: {
                findUnique: jest.fn(async () => ({
                    id: 11,
                    authorId: 11,
                    circleId: 7,
                    status: 'Draft',
                })),
            },
        } as any;

        const router = sourceMaterialsRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/:id/source-materials', 'post');
        const res = createMockResponse();

        await handler({
            params: { id: '7' },
            userId: 11,
            body: {
                name: 'appendix.md',
                mimeType: 'text/markdown',
                content: 'Page one intro.\n\nPage two detail.',
                draftPostId: 11,
            },
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(200);
        expect(createSourceMaterialMock).toHaveBeenCalledWith(prisma, {
            circleId: 7,
            uploadedByUserId: 11,
            draftPostId: 11,
            discussionThreadId: null,
            seededSourceNodeId: null,
            name: 'appendix.md',
            mimeType: 'text/markdown',
            content: 'Page one intro.\n\nPage two detail.',
        });
        expect(markCircleTopicProfileDirtyMock).toHaveBeenCalledWith({
            prisma,
            redis: {},
            circleId: 7,
            reason: 'source_material_created',
            requestedByUserId: 11,
        });
        expect(res.payload.material).toMatchObject({
            circleId: 7,
            draftPostId: 11,
        });
        expect(res.payload).toMatchObject({
            custody: {
                publicNodePersistence: 'digest_locator_and_provenance_metadata',
            },
        });
    });

    test('rejects draft-bound uploads from members who can read the circle but cannot edit the draft', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    id: 7,
                    creatorId: 11,
                })),
            },
            circleMember: {
                findUnique: jest.fn(async () => ({
                    role: 'Member',
                    status: 'Active',
                    identityLevel: 'Initiate',
                })),
            },
            post: {
                findUnique: jest.fn(async () => ({
                    id: 11,
                    authorId: 11,
                    circleId: 7,
                    status: 'Draft',
                })),
            },
        } as any;

        const router = sourceMaterialsRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/:id/source-materials', 'post');
        const res = createMockResponse();

        await handler({
            params: { id: '7' },
            userId: 23,
            body: {
                name: 'notes.md',
                mimeType: 'text/markdown',
                content: 'Need more citations.',
                draftPostId: 11,
            },
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(403);
        expect(createSourceMaterialMock).not.toHaveBeenCalled();
    });

    test('rejects binary uploads until a real extraction pipeline exists', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    id: 7,
                    creatorId: 11,
                })),
            },
            circleMember: {
                findUnique: jest.fn(async () => ({
                    role: 'Member',
                    status: 'Active',
                    identityLevel: 'Member',
                })),
            },
            post: {
                findUnique: jest.fn(async () => ({
                    id: 11,
                    authorId: 11,
                    circleId: 7,
                    status: 'Draft',
                })),
            },
        } as any;

        const router = sourceMaterialsRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/:id/source-materials', 'post');
        const res = createMockResponse();

        await handler({
            params: { id: '7' },
            userId: 11,
            body: {
                name: 'appendix.pdf',
                mimeType: 'application/pdf',
                content: '%PDF-1.7 binary payload',
                draftPostId: 11,
            },
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(415);
        expect(createSourceMaterialMock).not.toHaveBeenCalled();
    });

    test('rejects uploads when seeded source node does not exist', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    id: 7,
                    creatorId: 11,
                })),
            },
            circleMember: {
                findUnique: jest.fn(async () => ({
                    role: 'Member',
                    status: 'Active',
                    identityLevel: 'Member',
                })),
            },
            seededSourceNode: {
                findUnique: jest.fn(async () => null),
            },
        } as any;

        const router = sourceMaterialsRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/:id/source-materials', 'post');
        const res = createMockResponse();

        await handler({
            params: { id: '7' },
            userId: 11,
            body: {
                name: 'appendix.md',
                mimeType: 'text/markdown',
                content: 'Grounding content.',
                seededSourceNodeId: 91,
            },
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(404);
        expect(res.payload).toMatchObject({
            error: 'source_material_seeded_source_node_not_found',
        });
        expect(createSourceMaterialMock).not.toHaveBeenCalled();
    });

    test('rejects uploads when seeded source node belongs to a different circle', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    id: 7,
                    creatorId: 11,
                })),
            },
            circleMember: {
                findUnique: jest.fn(async () => ({
                    role: 'Member',
                    status: 'Active',
                    identityLevel: 'Member',
                })),
            },
            seededSourceNode: {
                findUnique: jest.fn(async () => ({
                    id: 91,
                    circleId: 99,
                })),
            },
        } as any;

        const router = sourceMaterialsRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/:id/source-materials', 'post');
        const res = createMockResponse();

        await handler({
            params: { id: '7' },
            userId: 11,
            body: {
                name: 'appendix.md',
                mimeType: 'text/markdown',
                content: 'Grounding content.',
                seededSourceNodeId: 91,
            },
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(409);
        expect(res.payload).toMatchObject({
            error: 'source_material_seeded_source_circle_mismatch',
        });
        expect(createSourceMaterialMock).not.toHaveBeenCalled();
    });

    test('rejects reads from users outside the circle', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    id: 7,
                    creatorId: 11,
                })),
            },
            circleMember: {
                findUnique: jest.fn(async () => null),
            },
        } as any;

        const router = sourceMaterialsRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/:id/source-materials', 'get');
        const res = createMockResponse();

        await handler({
            params: { id: '7' },
            userId: 99,
            query: {},
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(403);
        expect(listSourceMaterialsMock).not.toHaveBeenCalled();
    });

    test('fails explicitly on public-node-only deployments instead of storing private plaintext on the public node', async () => {
        process.env.QUERY_API_RUNTIME_ROLE = 'PUBLIC_NODE';
        process.env.QUERY_API_DEPLOYMENT_PROFILE = 'public_node_only';

        const prisma = {} as any;
        const router = sourceMaterialsRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/:id/source-materials', 'post');
        const res = createMockResponse();

        await handler({
            params: { id: '7' },
            userId: 11,
            body: {
                name: 'appendix.md',
                mimeType: 'text/markdown',
                content: 'Grounding content.',
            },
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(409);
        expect(res.payload).toMatchObject({
            error: 'private_sidecar_required',
            route: 'source_materials',
        });
        expect(createSourceMaterialMock).not.toHaveBeenCalled();
    });
});
