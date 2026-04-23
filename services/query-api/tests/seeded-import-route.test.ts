import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Router } from 'express';
import type { markCircleTopicProfileDirty as markCircleTopicProfileDirtyFn } from '../src/services/discussion/analysis/invalidation';

const importSeededSourcesMock = jest.fn();
const markCircleTopicProfileDirtyMock = jest.fn<typeof markCircleTopicProfileDirtyFn>();

jest.mock('../src/services/seeded/importer', () => ({
    importSeededSources: importSeededSourcesMock,
    SEEDED_PLAINTEXT_CUSTODY: {
        manifestAvailability: 'digest_and_reference_metadata',
        plaintextHosting: 'circle_seeded_explicit',
        plaintextReadAccess: 'active_member_or_creator',
    },
}));

jest.mock('../src/services/discussion/analysis/invalidation', () => ({
    markCircleTopicProfileDirty: markCircleTopicProfileDirtyMock,
}));

import { seededRouter } from '../src/rest/seeded';

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

describe('seeded import route', () => {
    const originalRuntimeRole = process.env.QUERY_API_RUNTIME_ROLE;
    const originalDeploymentProfile = process.env.QUERY_API_DEPLOYMENT_PROFILE;

    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.QUERY_API_RUNTIME_ROLE;
        delete process.env.QUERY_API_DEPLOYMENT_PROFILE;
        importSeededSourcesMock.mockImplementation(async () => ({
            circleId: 7,
            fileCount: 1,
            nodeCount: 2,
            manifestDigest: 'a'.repeat(64),
        }));
        markCircleTopicProfileDirtyMock.mockResolvedValue({
            updatedCount: 3,
            topicProfileVersion: 'topic:7:seeded',
        });
    });

    afterEach(() => {
        process.env.QUERY_API_RUNTIME_ROLE = originalRuntimeRole;
        process.env.QUERY_API_DEPLOYMENT_PROFILE = originalDeploymentProfile;
    });

    test('imports seeded source files for managed SEEDED circles', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    id: 7,
                    creatorId: 11,
                    genesisMode: 'SEEDED',
                })),
            },
        } as any;

        const router = seededRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/:id/seeded/import', 'post');
        const res = createMockResponse();

        await handler({
            params: { id: '7' },
            userId: 11,
            body: {
                files: [
                    { path: 'docs/intro.md', content: '# Intro' },
                ],
            },
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(200);
        expect(importSeededSourcesMock).toHaveBeenCalledWith(prisma, {
            circleId: 7,
            files: [{ path: 'docs/intro.md', content: '# Intro', mimeType: null }],
        });
        expect(markCircleTopicProfileDirtyMock).toHaveBeenCalledWith({
            prisma,
            redis: {},
            circleId: 7,
            reason: 'seeded_import_completed',
            requestedByUserId: 11,
        });
        expect(res.payload).toMatchObject({
            ok: true,
            circleId: 7,
            fileCount: 1,
            manifest: {
                digest: 'a'.repeat(64),
            },
            custody: {
                plaintextHosting: 'circle_seeded_explicit',
            },
        });
    });

    test('requires seed files when the circle is configured as SEEDED', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    id: 7,
                    creatorId: 11,
                    genesisMode: 'SEEDED',
                })),
            },
        } as any;

        const router = seededRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/:id/seeded/import', 'post');
        const res = createMockResponse();

        await handler({
            params: { id: '7' },
            userId: 11,
            body: {
                files: [],
            },
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(400);
        expect(res.payload).toMatchObject({
            error: 'seeded_files_required',
        });
    });

    test('fails explicitly on public-node-only deployments instead of hosting seeded plaintext by default', async () => {
        process.env.QUERY_API_RUNTIME_ROLE = 'PUBLIC_NODE';
        process.env.QUERY_API_DEPLOYMENT_PROFILE = 'public_node_only';

        const prisma = {} as any;
        const router = seededRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/:id/seeded/import', 'post');
        const res = createMockResponse();

        await handler({
            params: { id: '7' },
            userId: 11,
            body: {
                files: [
                    { path: 'docs/intro.md', content: '# Intro' },
                ],
            },
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(409);
        expect(res.payload).toMatchObject({
            error: 'private_sidecar_required',
            route: 'seeded',
        });
        expect(importSeededSourcesMock).not.toHaveBeenCalled();
    });
});
