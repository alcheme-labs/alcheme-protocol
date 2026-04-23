import { describe, expect, jest, test } from '@jest/globals';
import type { Router } from 'express';

const enqueueDiscussionTriggerEvaluationJobMock: any = jest.fn();
const maybeTriggerGhostDraftFromDiscussionMock: any = jest.fn();

jest.mock('../src/ai/discussion-draft-trigger', () => ({
    enqueueDiscussionTriggerEvaluationJob: enqueueDiscussionTriggerEvaluationJobMock,
    maybeTriggerGhostDraftFromDiscussion: maybeTriggerGhostDraftFromDiscussionMock,
}));

import { createDiscussionIntelligence } from '../src/ai/discussion-intelligence';
import { serviceConfig } from '../src/config/services';
import { aiRouter } from '../src/rest/ai';
import * as runtime from '../src/services/aiJobs/runtime';

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

describe('ai orchestration entrypoints', () => {
    test('legacy post scoring route is no longer exposed', () => {
        const router = aiRouter({} as any, {} as any);
        const scoreLayer = (router as any).stack.find((item: any) =>
            item.route?.path === '/score'
            && item.route?.stack?.some((entry: any) => entry.method === 'post'),
        );

        expect(scoreLayer).toBeUndefined();
    });

    test('discussion intelligence enqueues a durable trigger job instead of executing the trigger inline', async () => {
        enqueueDiscussionTriggerEvaluationJobMock.mockResolvedValueOnce({
            id: 77,
            status: 'queued',
        });
        const prisma = {} as any;
        const redis = {} as any;
        const discussionIntelligence = createDiscussionIntelligence({
            prisma,
            redis,
        });

        const result = await discussionIntelligence.triggerDraftFromDiscussion({
            circleId: 7,
            requestedByUserId: 9,
        });

        expect(enqueueDiscussionTriggerEvaluationJobMock).toHaveBeenCalledWith(prisma, {
            circleId: 7,
            requestedByUserId: 9,
        });
        expect(maybeTriggerGhostDraftFromDiscussionMock).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            triggered: true,
            reason: 'enqueued',
            jobId: 77,
        });
    });

    test('legacy ghost draft route derives the actor from auth context and returns an async job envelope', async () => {
        jest.spyOn(runtime, 'enqueueAiJob').mockResolvedValueOnce({
            id: 41,
            jobType: 'ghost_draft_generate',
            dedupeKey: null,
            scopeType: 'draft',
            scopeDraftPostId: 42,
            scopeCircleId: 7,
            requestedByUserId: 8,
            status: 'queued',
            attempts: 0,
            maxAttempts: 3,
            availableAt: new Date('2026-03-24T21:30:00.000Z'),
            claimedAt: null,
            completedAt: null,
            workerId: null,
            claimToken: null,
            payload: {
                postId: 42,
                autoApplyRequested: false,
            },
            result: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            createdAt: new Date('2026-03-24T21:30:00.000Z'),
            updatedAt: new Date('2026-03-24T21:30:00.000Z'),
        } as any);
        const prisma = {
            post: {
                findUnique: jest.fn(async () => ({
                    id: 42,
                    authorId: 3,
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

        const router = aiRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/ghost-drafts/generate', 'post');
        const res = createMockResponse();

        await handler(
            {
                body: {
                    postId: 42,
                    userId: 999,
                    preferAutoApply: true,
                },
                userId: 8,
            } as any,
            res as any,
            jest.fn(),
        );

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            jobId: 41,
            status: 'queued',
            postId: 42,
        });
        expect((runtime.enqueueAiJob as any).mock.calls[0][1]).toMatchObject({
            requestedByUserId: 8,
            dedupeKey: expect.any(String),
            payload: {
                postId: 42,
                autoApplyRequested: true,
            },
        });
    });

    test('legacy ghost draft route derives a stable dedupe key from the request payload', async () => {
        const enqueueSpy = jest.spyOn(runtime, 'enqueueAiJob')
            .mockResolvedValue({
                id: 41,
                jobType: 'ghost_draft_generate',
                dedupeKey: 'ignored-by-test',
                scopeType: 'draft',
                scopeDraftPostId: 42,
                scopeCircleId: 7,
                requestedByUserId: 8,
                status: 'queued',
                attempts: 0,
                maxAttempts: 3,
                availableAt: new Date('2026-03-24T21:30:00.000Z'),
                claimedAt: null,
                completedAt: null,
                workerId: null,
                claimToken: null,
                payload: {
                    postId: 42,
                    autoApplyRequested: true,
                },
                result: null,
                lastErrorCode: null,
                lastErrorMessage: null,
                createdAt: new Date('2026-03-24T21:30:00.000Z'),
                updatedAt: new Date('2026-03-24T21:30:00.000Z'),
            } as any);
        enqueueSpy.mockClear();
        const prisma = {
            post: {
                findUnique: jest.fn(async () => ({
                    id: 42,
                    authorId: 3,
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

        const router = aiRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/ghost-drafts/generate', 'post');

        const request = {
            body: {
                postId: 42,
                preferAutoApply: true,
                workingCopyHash: 'a'.repeat(64),
                workingCopyUpdatedAt: '2026-03-24T21:29:00.000Z',
                seededReference: {
                    path: 'docs/context.md',
                    line: 12,
                },
                sourceMaterialIds: [9, 4, 9],
            },
            userId: 8,
        } as any;

        await handler(request, createMockResponse() as any, jest.fn());
        await handler(request, createMockResponse() as any, jest.fn());

        const firstCall = enqueueSpy.mock.calls[0]?.[1];
        const secondCall = enqueueSpy.mock.calls[1]?.[1];
        expect(firstCall?.dedupeKey).toEqual(expect.any(String));
        expect(secondCall?.dedupeKey).toBe(firstCall?.dedupeKey);
    });

    test('legacy ghost draft route rejects external private-context generation until explicit consent is configured', async () => {
        const originalMode = serviceConfig.ai.mode;
        const originalExternalPrivateContentMode = (serviceConfig.ai as any).externalPrivateContentMode;

        try {
            serviceConfig.ai.mode = 'external';
            (serviceConfig.ai as any).externalPrivateContentMode = 'deny';

            const enqueueSpy = jest.spyOn(runtime, 'enqueueAiJob');
            enqueueSpy.mockClear();
            const prisma = {
                post: {
                    findUnique: jest.fn(async () => ({
                        id: 42,
                        authorId: 3,
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

            const router = aiRouter(prisma, {} as any);
            const handler = getRouteHandler(router, '/ghost-drafts/generate', 'post');
            const res = createMockResponse();

            await handler(
                {
                    body: {
                        postId: 42,
                    },
                    userId: 8,
                } as any,
                res as any,
                jest.fn(),
            );

            expect(res.statusCode).toBe(409);
            expect(res.payload).toMatchObject({
                error: 'external_ai_private_content_consent_required',
            });
            expect(enqueueSpy).not.toHaveBeenCalled();
        } finally {
            serviceConfig.ai.mode = originalMode;
            (serviceConfig.ai as any).externalPrivateContentMode = originalExternalPrivateContentMode;
        }
    });

    test('legacy ghost draft route fails explicitly on public-node-only deployments', async () => {
        const originalRuntimeRole = process.env.QUERY_API_RUNTIME_ROLE;
        const originalDeploymentProfile = process.env.QUERY_API_DEPLOYMENT_PROFILE;

        try {
            process.env.QUERY_API_RUNTIME_ROLE = 'PUBLIC_NODE';
            process.env.QUERY_API_DEPLOYMENT_PROFILE = 'public_node_only';

            const enqueueSpy = jest.spyOn(runtime, 'enqueueAiJob');
            enqueueSpy.mockClear();
            const prisma = {} as any;
            const router = aiRouter(prisma, {} as any);
            const handler = getRouteHandler(router, '/ghost-drafts/generate', 'post');
            const res = createMockResponse();

            await handler(
                {
                    body: {
                        postId: 42,
                    },
                    userId: 8,
                } as any,
                res as any,
                jest.fn(),
            );

            expect(res.statusCode).toBe(409);
            expect(res.payload).toMatchObject({
                error: 'private_sidecar_required',
                route: 'ghost_draft_private',
            });
            expect(enqueueSpy).not.toHaveBeenCalled();
        } finally {
            process.env.QUERY_API_RUNTIME_ROLE = originalRuntimeRole;
            process.env.QUERY_API_DEPLOYMENT_PROFILE = originalDeploymentProfile;
        }
    });
});
