import { describe, expect, jest, test } from '@jest/globals';

import { serviceConfig } from '../../config/services';
import { resolvers } from '../resolvers';
import * as runtime from '../../services/aiJobs/runtime';
import * as checks from '../../services/membership/checks';

describe('ghost draft async access', () => {
    test('generateGhostDraft still requires draft read access before a job is enqueued', async () => {
        const authorizeSpy = jest.spyOn(checks, 'authorizeDraftAction')
            .mockResolvedValueOnce({
                allowed: false,
                statusCode: 403,
                error: 'draft_read_denied',
                message: 'read denied',
                post: null,
            } as any);
        const enqueueSpy = jest.spyOn(runtime, 'enqueueAiJob');

        await expect((resolvers as any).Mutation.generateGhostDraft(
            {},
            {
                input: {
                    postId: 42,
                },
            },
            { prisma: {}, userId: 8 },
        )).rejects.toThrow('draft_read_denied');

        expect(authorizeSpy).toHaveBeenCalledTimes(1);
        expect(enqueueSpy).not.toHaveBeenCalled();
    });

    test('preferAutoApply falls back to candidate-only when the requester lacks draft edit permission', async () => {
        jest.spyOn(checks, 'authorizeDraftAction')
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
                allowed: false,
                statusCode: 403,
                error: 'draft_edit_denied',
                message: 'edit denied',
                post: {
                    id: 42,
                    authorId: 9,
                    circleId: 7,
                    status: 'Draft',
                },
            } as any);
        const enqueueSpy = jest.spyOn(runtime, 'enqueueAiJob')
            .mockResolvedValue({
                id: 777,
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

        expect(enqueueSpy).toHaveBeenCalledWith({}, expect.objectContaining({
            payload: {
                postId: 42,
                autoApplyRequested: false,
                workingCopyHash: 'a'.repeat(64),
                workingCopyUpdatedAt: '2026-03-24T21:29:00.000Z',
                seededReference: null,
                sourceMaterialIds: [],
            },
        }));
        expect(result).toMatchObject({
            jobId: 777,
            autoApplyRequested: false,
        });
    });

    test('generateGhostDraft refuses to enqueue external private-context jobs until explicit consent is configured', async () => {
        const originalMode = serviceConfig.ai.mode;
        const originalExternalPrivateContentMode = (serviceConfig.ai as any).externalPrivateContentMode;

        try {
            serviceConfig.ai.mode = 'external';
            (serviceConfig.ai as any).externalPrivateContentMode = 'deny';

            jest.spyOn(checks, 'authorizeDraftAction')
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
            const enqueueSpy = jest.spyOn(runtime, 'enqueueAiJob');
            enqueueSpy.mockClear();

            await expect((resolvers as any).Mutation.generateGhostDraft(
                {},
                {
                    input: {
                        postId: 42,
                    },
                },
                { prisma: {}, userId: 8 },
            )).rejects.toThrow('external_ai_private_content_consent_required');

            expect(enqueueSpy).not.toHaveBeenCalled();
        } finally {
            serviceConfig.ai.mode = originalMode;
            (serviceConfig.ai as any).externalPrivateContentMode = originalExternalPrivateContentMode;
        }
    });
});
