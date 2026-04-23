import { describe, expect, jest, test } from '@jest/globals';

import { authorizeAiJobRead } from '../access';

const draftJob = {
    id: 1,
    jobType: 'ghost_draft_generate',
    dedupeKey: null,
    scopeType: 'draft',
    scopeDraftPostId: 42,
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
    payload: { postId: 42 },
    result: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: new Date('2026-03-24T20:00:00.000Z'),
    updatedAt: new Date('2026-03-24T20:00:00.000Z'),
} as const;

describe('ai job access', () => {
    test('draft scope reuses draft read access', async () => {
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

        const decision = await authorizeAiJobRead(prisma, {
            job: draftJob as any,
            userId: 8,
        });

        expect(decision).toMatchObject({
            allowed: true,
            statusCode: 200,
        });
    });

    test('circle scope requires current circle manager boundary', async () => {
        const circleJob = {
            ...draftJob,
            scopeType: 'circle',
            scopeDraftPostId: null,
            scopeCircleId: 7,
        };
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
        } as any;

        const decision = await authorizeAiJobRead(prisma, {
            job: circleJob as any,
            userId: 8,
        });

        expect(decision).toMatchObject({
            allowed: false,
            statusCode: 403,
            error: 'ai_job_access_denied',
        });
    });

    test('system scope only exposes jobs back to the requesting user', async () => {
        const systemJob = {
            ...draftJob,
            scopeType: 'system',
            scopeDraftPostId: null,
            scopeCircleId: null,
            requestedByUserId: 9,
        };

        const allowed = await authorizeAiJobRead({} as any, {
            job: systemJob as any,
            userId: 9,
        });
        const denied = await authorizeAiJobRead({} as any, {
            job: systemJob as any,
            userId: 11,
        });

        expect(allowed.allowed).toBe(true);
        expect(denied).toMatchObject({
            allowed: false,
            statusCode: 403,
        });
    });
});
