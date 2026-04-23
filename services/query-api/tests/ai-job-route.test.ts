import { describe, expect, jest, test } from '@jest/globals';
import type { Router } from 'express';

import { aiJobsRouter } from '../src/rest/ai-jobs';

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

describe('ai job route', () => {
    test('job status route reads durable job state through draft scope access gates', async () => {
        const prisma = {
            aiJob: {
                findUnique: jest.fn(async () => ({
                    id: 12,
                    jobType: 'ghost_draft_generate',
                    dedupeKey: 'ghost:12',
                    scopeType: 'draft',
                    scopeDraftPostId: 42,
                    scopeCircleId: 7,
                    requestedByUserId: 9,
                    status: 'succeeded',
                    attempts: 1,
                    maxAttempts: 3,
                    availableAt: new Date('2026-03-24T20:00:00.000Z'),
                    claimedAt: null,
                    completedAt: new Date('2026-03-24T20:00:03.000Z'),
                    workerId: null,
                    claimToken: null,
                    payloadJson: { postId: 42 },
                    resultJson: { generationId: 99 },
                    lastErrorCode: null,
                    lastErrorMessage: null,
                    createdAt: new Date('2026-03-24T20:00:00.000Z'),
                    updatedAt: new Date('2026-03-24T20:00:03.000Z'),
                })),
            },
            post: {
                findUnique: jest.fn(async () => ({
                    id: 42,
                    authorId: 9,
                    circleId: 7,
                    status: 'Draft',
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

        const router = aiJobsRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/:jobId', 'get');
        const res = createMockResponse();

        await handler(
            {
                params: { jobId: '12' },
                userId: 8,
            } as any,
            res as any,
            jest.fn(),
        );

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            job: {
                id: 12,
                scopeType: 'draft',
                result: {
                    generationId: 99,
                },
            },
        });
    });

    test('list route rejects circle-scoped enumeration for non-manager members', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    creatorId: 99,
                })),
            },
            circleMember: {
                findUnique: jest.fn(async () => ({
                    role: 'Member',
                    status: 'Active',
                })),
            },
            aiJob: {
                findMany: jest.fn(async () => []),
            },
        } as any;

        const router = aiJobsRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/', 'get');
        const res = createMockResponse();

        await handler(
            {
                query: { circleId: '7' },
                userId: 8,
            } as any,
            res as any,
            jest.fn(),
        );

        expect(res.statusCode).toBe(403);
        expect(res.payload).toMatchObject({
            error: 'ai_job_access_denied',
        });
    });

    test('list route returns queued discussion trigger jobs for circle managers', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    creatorId: 8,
                })),
            },
            circleMember: {
                findUnique: jest.fn(async () => ({
                    role: 'Admin',
                    status: 'Active',
                })),
            },
            aiJob: {
                findMany: jest.fn(async () => ([{
                    id: 44,
                    jobType: 'discussion_trigger_evaluate',
                    dedupeKey: null,
                    scopeType: 'circle',
                    scopeDraftPostId: null,
                    scopeCircleId: 7,
                    requestedByUserId: 9,
                    status: 'queued',
                    attempts: 0,
                    maxAttempts: 3,
                    availableAt: new Date('2026-03-24T20:00:00.000Z'),
                    claimedAt: null,
                    completedAt: null,
                    workerId: null,
                    claimToken: null,
                    payloadJson: { circleId: 7 },
                    resultJson: null,
                    lastErrorCode: null,
                    lastErrorMessage: null,
                    createdAt: new Date('2026-03-24T20:00:00.000Z'),
                    updatedAt: new Date('2026-03-24T20:00:00.000Z'),
                }])),
            },
        } as any;

        const router = aiJobsRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/', 'get');
        const res = createMockResponse();

        await handler(
            {
                query: { circleId: '7' },
                userId: 8,
            } as any,
            res as any,
            jest.fn(),
        );

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            jobs: [
                {
                    id: 44,
                    jobType: 'discussion_trigger_evaluate',
                    scopeType: 'circle',
                    scopeCircleId: 7,
                    status: 'queued',
                },
            ],
        });
    });

    test('requestedByMe only returns jobs that still pass scope authorization', async () => {
        const prisma = {
            aiJob: {
                findMany: jest.fn(async () => ([
                    {
                        id: 51,
                        jobType: 'ghost_draft_generate',
                        dedupeKey: null,
                        scopeType: 'draft',
                        scopeDraftPostId: 42,
                        scopeCircleId: 7,
                        requestedByUserId: 8,
                        status: 'succeeded',
                        attempts: 1,
                        maxAttempts: 3,
                        availableAt: new Date('2026-03-24T20:00:00.000Z'),
                        claimedAt: null,
                        completedAt: new Date('2026-03-24T20:00:03.000Z'),
                        workerId: null,
                        claimToken: null,
                        payloadJson: { postId: 42 },
                        resultJson: { generationId: 301 },
                        lastErrorCode: null,
                        lastErrorMessage: null,
                        createdAt: new Date('2026-03-24T20:00:00.000Z'),
                        updatedAt: new Date('2026-03-24T20:00:03.000Z'),
                    },
                    {
                        id: 52,
                        jobType: 'ghost_draft_generate',
                        dedupeKey: null,
                        scopeType: 'draft',
                        scopeDraftPostId: 43,
                        scopeCircleId: 8,
                        requestedByUserId: 8,
                        status: 'failed',
                        attempts: 2,
                        maxAttempts: 3,
                        availableAt: new Date('2026-03-24T20:00:00.000Z'),
                        claimedAt: null,
                        completedAt: new Date('2026-03-24T20:00:04.000Z'),
                        workerId: null,
                        claimToken: null,
                        payloadJson: { postId: 43 },
                        resultJson: { generationId: 302 },
                        lastErrorCode: 'draft_membership_required',
                        lastErrorMessage: 'membership expired',
                        createdAt: new Date('2026-03-24T20:00:00.000Z'),
                        updatedAt: new Date('2026-03-24T20:00:04.000Z'),
                    },
                    {
                        id: 53,
                        jobType: 'discussion_trigger_evaluate',
                        dedupeKey: null,
                        scopeType: 'circle',
                        scopeDraftPostId: null,
                        scopeCircleId: 7,
                        requestedByUserId: 8,
                        status: 'queued',
                        attempts: 0,
                        maxAttempts: 3,
                        availableAt: new Date('2026-03-24T20:00:00.000Z'),
                        claimedAt: null,
                        completedAt: null,
                        workerId: null,
                        claimToken: null,
                        payloadJson: { circleId: 7 },
                        resultJson: null,
                        lastErrorCode: null,
                        lastErrorMessage: null,
                        createdAt: new Date('2026-03-24T20:00:00.000Z'),
                        updatedAt: new Date('2026-03-24T20:00:00.000Z'),
                    },
                    {
                        id: 54,
                        jobType: 'ghost_draft_generate',
                        dedupeKey: null,
                        scopeType: 'system',
                        scopeDraftPostId: null,
                        scopeCircleId: null,
                        requestedByUserId: 8,
                        status: 'succeeded',
                        attempts: 1,
                        maxAttempts: 3,
                        availableAt: new Date('2026-03-24T20:00:00.000Z'),
                        claimedAt: null,
                        completedAt: new Date('2026-03-24T20:00:02.000Z'),
                        workerId: null,
                        claimToken: null,
                        payloadJson: null,
                        resultJson: { ok: true },
                        lastErrorCode: null,
                        lastErrorMessage: null,
                        createdAt: new Date('2026-03-24T20:00:00.000Z'),
                        updatedAt: new Date('2026-03-24T20:00:02.000Z'),
                    },
                ])),
            },
            post: {
                findUnique: jest.fn(async ({ where }: any) => {
                    if (Number(where?.id) === 42) {
                        return {
                            id: 42,
                            authorId: 9,
                            circleId: 7,
                            status: 'Draft',
                        };
                    }
                    if (Number(where?.id) === 43) {
                        return {
                            id: 43,
                            authorId: 9,
                            circleId: 8,
                            status: 'Draft',
                        };
                    }
                    return null;
                }),
            },
            circle: {
                findUnique: jest.fn(async ({ where }: any) => ({
                    id: Number(where?.id),
                    creatorId: 99,
                })),
            },
            circleMember: {
                findUnique: jest.fn(async ({ where }: any) => {
                    const circleId = Number(where?.circleId_userId?.circleId);
                    if (circleId === 7) {
                        return {
                            role: 'Member',
                            status: 'Active',
                            identityLevel: 'Member',
                        };
                    }
                    if (circleId === 8) {
                        return null;
                    }
                    return null;
                }),
            },
        } as any;

        const router = aiJobsRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/', 'get');
        const res = createMockResponse();

        await handler(
            {
                query: { requestedByMe: 'true' },
                userId: 8,
            } as any,
            res as any,
            jest.fn(),
        );

        expect(res.statusCode).toBe(200);
        expect(res.payload.ok).toBe(true);
        expect(res.payload.jobs).toHaveLength(2);
        expect(res.payload.jobs.map((job: any) => job.id)).toEqual([51, 54]);
        expect(res.payload.jobs).toEqual([
            expect.objectContaining({ id: 51, scopeType: 'draft', scopeDraftPostId: 42 }),
            expect.objectContaining({ id: 54, scopeType: 'system' }),
        ]);
    });

    test('requestedByMe keeps paging until it fills the visible limit after authorization filtering', async () => {
        const prisma = {
            aiJob: {
                findMany: jest.fn(async ({ skip, take }: any) => {
                    if (Number(skip || 0) === 0 && Number(take) === 1) {
                        return [{
                            id: 61,
                            jobType: 'ghost_draft_generate',
                            dedupeKey: null,
                            scopeType: 'draft',
                            scopeDraftPostId: 143,
                            scopeCircleId: 8,
                            requestedByUserId: 8,
                            status: 'failed',
                            attempts: 1,
                            maxAttempts: 3,
                            availableAt: new Date('2026-03-24T20:00:00.000Z'),
                            claimedAt: null,
                            completedAt: new Date('2026-03-24T20:00:04.000Z'),
                            workerId: null,
                            claimToken: null,
                            payloadJson: { postId: 143 },
                            resultJson: { generationId: 401 },
                            lastErrorCode: 'draft_membership_required',
                            lastErrorMessage: 'membership expired',
                            createdAt: new Date('2026-03-24T20:00:00.000Z'),
                            updatedAt: new Date('2026-03-24T20:00:04.000Z'),
                        }];
                    }
                    if (Number(skip || 0) === 1 && Number(take) === 1) {
                        return [{
                            id: 62,
                            jobType: 'ghost_draft_generate',
                            dedupeKey: null,
                            scopeType: 'draft',
                            scopeDraftPostId: 42,
                            scopeCircleId: 7,
                            requestedByUserId: 8,
                            status: 'succeeded',
                            attempts: 1,
                            maxAttempts: 3,
                            availableAt: new Date('2026-03-24T20:00:00.000Z'),
                            claimedAt: null,
                            completedAt: new Date('2026-03-24T20:00:03.000Z'),
                            workerId: null,
                            claimToken: null,
                            payloadJson: { postId: 42 },
                            resultJson: { generationId: 402 },
                            lastErrorCode: null,
                            lastErrorMessage: null,
                            createdAt: new Date('2026-03-24T19:59:00.000Z'),
                            updatedAt: new Date('2026-03-24T20:00:03.000Z'),
                        }];
                    }
                    return [];
                }),
            },
            post: {
                findUnique: jest.fn(async ({ where }: any) => {
                    if (Number(where?.id) === 42) {
                        return {
                            id: 42,
                            authorId: 9,
                            circleId: 7,
                            status: 'Draft',
                        };
                    }
                    if (Number(where?.id) === 143) {
                        return {
                            id: 143,
                            authorId: 9,
                            circleId: 8,
                            status: 'Draft',
                        };
                    }
                    return null;
                }),
            },
            circle: {
                findUnique: jest.fn(async ({ where }: any) => ({
                    id: Number(where?.id),
                    creatorId: 99,
                })),
            },
            circleMember: {
                findUnique: jest.fn(async ({ where }: any) => {
                    const circleId = Number(where?.circleId_userId?.circleId);
                    if (circleId === 7) {
                        return {
                            role: 'Member',
                            status: 'Active',
                            identityLevel: 'Member',
                        };
                    }
                    return null;
                }),
            },
        } as any;

        const router = aiJobsRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/', 'get');
        const res = createMockResponse();

        await handler(
            {
                query: { requestedByMe: 'true', limit: '1' },
                userId: 8,
            } as any,
            res as any,
            jest.fn(),
        );

        expect(res.statusCode).toBe(200);
        expect(res.payload.jobs).toHaveLength(1);
        expect(res.payload.jobs[0]).toEqual(
            expect.objectContaining({ id: 62, scopeDraftPostId: 42 }),
        );
        expect(prisma.aiJob.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
            skip: 0,
            take: 1,
        }));
        expect(prisma.aiJob.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
            skip: 1,
            take: 1,
        }));
    });
});
