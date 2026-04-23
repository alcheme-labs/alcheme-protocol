import { describe, expect, jest, test } from '@jest/globals';
import { print } from 'graphql';

import { typeDefs } from '../schema';
import { resolvers } from '../resolvers';
import * as runtime from '../../services/aiJobs/runtime';
import * as checks from '../../services/membership/checks';

describe('ghost draft async graphql contract', () => {
    test('schema exposes an async ghost draft job envelope instead of synchronous draft text', () => {
        const schemaSource = print(typeDefs);

        expect(schemaSource).toContain('input GenerateGhostDraftInput');
        expect(schemaSource).toContain('type GhostDraftJobResult');
        expect(schemaSource).toContain('generateGhostDraft(input: GenerateGhostDraftInput!): GhostDraftJobResult!');
        expect(schemaSource).not.toContain('generateGhostDraft(postId: Int!): GhostDraftResult!');
    });

    test('generateGhostDraft enqueues a durable ai job and returns the job envelope', async () => {
        const authorizeSpy = jest.spyOn(checks, 'authorizeDraftAction')
            .mockResolvedValueOnce({
                allowed: true,
                statusCode: 200,
                error: 'ok',
                message: 'ok',
                post: {
                    id: 42,
                    authorId: 9,
                    circleId: 7,
                    status: 'Draft',
                },
            } as any)
            .mockResolvedValueOnce({
                allowed: true,
                statusCode: 200,
                error: 'ok',
                message: 'ok',
                post: {
                    id: 42,
                    authorId: 9,
                    circleId: 7,
                    status: 'Draft',
                },
            } as any);
        const enqueueSpy = jest.spyOn(runtime, 'enqueueAiJob')
            .mockResolvedValue({
                id: 501,
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
                    autoApplyRequested: true,
                    workingCopyHash: 'a'.repeat(64),
                    workingCopyUpdatedAt: '2026-03-24T21:29:00.000Z',
                },
                result: null,
                lastErrorCode: null,
                lastErrorMessage: null,
                createdAt: new Date('2026-03-24T21:30:00.000Z'),
                updatedAt: new Date('2026-03-24T21:30:00.000Z'),
            } as any);

        const result = await (resolvers as any).Mutation.generateGhostDraft(
            {},
            {
                input: {
                    postId: 42,
                    preferAutoApply: true,
                    workingCopyHash: 'a'.repeat(64),
                    workingCopyUpdatedAt: '2026-03-24T21:29:00.000Z',
                },
            },
            { prisma: {}, userId: 8 },
        );

        expect(authorizeSpy).toHaveBeenNthCalledWith(1, {}, {
            postId: 42,
            userId: 8,
            action: 'read',
        });
        expect(enqueueSpy).toHaveBeenCalledWith({}, {
            jobType: 'ghost_draft_generate',
            dedupeKey: expect.any(String),
            scopeType: 'draft',
            scopeDraftPostId: 42,
            scopeCircleId: 7,
            requestedByUserId: 8,
            payload: {
                postId: 42,
                autoApplyRequested: true,
                workingCopyHash: 'a'.repeat(64),
                workingCopyUpdatedAt: '2026-03-24T21:29:00.000Z',
                seededReference: null,
                sourceMaterialIds: [],
            },
        });
        expect(result).toMatchObject({
            jobId: 501,
            status: 'queued',
            postId: 42,
            autoApplyRequested: true,
        });
    });
});
