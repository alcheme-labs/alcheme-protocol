import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Router } from 'express';

import { discussionRouter } from '../src/rest/discussion';
import {
    assertDraftDiscussionTransition,
    DraftDiscussionLifecycleError,
    type DraftDiscussionThreadRecord,
    validateDraftDiscussionApplicationEvidence,
} from '../src/services/draftDiscussionLifecycle';
import * as draftDiscussionLifecycleService from '../src/services/draftDiscussionLifecycle';
import * as draftLifecycleReadModelService from '../src/services/draftLifecycle/readModel';
import * as collabEditAnchorService from '../src/services/collabEditAnchor';
import * as policyProfileService from '../src/services/policy/profile';

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

function makeThread(
    overrides: Partial<DraftDiscussionThreadRecord> = {},
): DraftDiscussionThreadRecord {
    return {
        id: '1',
        draftPostId: 42,
        targetType: 'paragraph',
        targetRef: 'p:1',
        targetVersion: 1,
        issueType: 'knowledge_supplement',
        state: 'open',
        createdBy: 11,
        createdAt: '2026-03-13T12:00:00.000Z',
        updatedAt: '2026-03-13T12:00:00.000Z',
        latestResolution: null,
        latestApplication: null,
        latestMessage: null,
        messages: [],
        ...overrides,
    };
}

function createPrismaMock(input?: {
    role?: string;
    identityLevel?: string;
    status?: string;
    circleCreatorId?: number;
}) {
    const role = input?.role || 'Member';
    const identityLevel = input?.identityLevel || 'Member';
    const status = input?.status || 'Active';
    const circleCreatorId = input?.circleCreatorId ?? 99;

    const member = {
        role,
        status,
        identityLevel,
    };

    return {
        post: {
            findUnique: jest.fn(async () => ({
                id: 42,
                authorId: 9,
                circleId: 7,
                status: 'Draft',
            })),
        },
        circle: {
            findUnique: jest.fn(async () => ({
                creatorId: circleCreatorId,
            })),
        },
        circleMember: {
            findUnique: jest.fn(async () => member),
        },
    };
}

function buildPolicyProfile(overrides?: Record<string, unknown>) {
    return {
        circleId: 7,
        sourceType: 'circle_override',
        inheritanceMode: 'independent',
        inheritsFromProfileId: null,
        inheritsFromCircleId: null,
        draftGenerationPolicy: {} as any,
        draftLifecycleTemplate: {
            templateId: 'fast_deposition',
            draftGenerationVotingMinutes: 10,
            draftingWindowMinutes: 45,
            reviewWindowMinutes: 180,
            maxRevisionRounds: 2,
            reviewEntryMode: 'auto_or_manual',
        },
        draftWorkflowPolicy: {
            createIssueMinRole: 'Member',
            followupIssueMinRole: 'Member',
            reviewIssueMinRole: 'Moderator',
            retagIssueMinRole: 'Moderator',
            applyIssueMinRole: 'Admin',
            manualEndDraftingMinRole: 'Moderator',
            advanceFromReviewMinRole: 'Admin',
            enterCrystallizationMinRole: 'Moderator',
            allowAuthorWithdrawBeforeReview: true,
            allowModeratorRetagIssue: true,
            ...(overrides || {}),
        },
        blockEditEligibilityPolicy: {} as any,
        forkPolicy: {} as any,
        ghostPolicy: {} as any,
        localEditability: 'editable',
        effectiveFrom: new Date('2026-03-19T00:00:00.000Z'),
        resolvedFromProfileVersion: null,
        configVersion: 1,
    } as any;
}

describe('draft discussion lifecycle state contract', () => {
    test('accepts open -> proposed -> accepted/rejected -> applied transitions', () => {
        expect(() => assertDraftDiscussionTransition('open', 'proposed')).not.toThrow();
        expect(() => assertDraftDiscussionTransition('open', 'withdrawn')).not.toThrow();
        expect(() => assertDraftDiscussionTransition('proposed', 'accepted')).not.toThrow();
        expect(() => assertDraftDiscussionTransition('proposed', 'rejected')).not.toThrow();
        expect(() => assertDraftDiscussionTransition('accepted', 'applied')).not.toThrow();
    });

    test('rejects invalid transition when skipping accepted/rejected before applied', () => {
        try {
            assertDraftDiscussionTransition('proposed', 'applied');
            throw new Error('expected invalid transition to throw');
        } catch (error) {
            expect(error).toBeInstanceOf(DraftDiscussionLifecycleError);
            expect((error as DraftDiscussionLifecycleError).code).toBe('draft_discussion_invalid_transition');
        }
    });

    test('requires application evidence fields', () => {
        try {
            validateDraftDiscussionApplicationEvidence({
                appliedEditAnchorId: '',
                appliedSnapshotHash: 'abc',
                appliedDraftVersion: 0,
            });
            throw new Error('expected invalid evidence to throw');
        } catch (error) {
            expect(error).toBeInstanceOf(DraftDiscussionLifecycleError);
            expect((error as DraftDiscussionLifecycleError).code).toBe('draft_discussion_apply_evidence_required');
        }
    });
});

describe('draft discussion routes', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(policyProfileService, 'resolveCirclePolicyProfile')
            .mockResolvedValue(buildPolicyProfile());
        jest.spyOn(draftLifecycleReadModelService, 'resolveDraftLifecycleReadModel')
            .mockResolvedValue({
                draftPostId: 42,
                circleId: 7,
                documentStatus: 'drafting',
                currentSnapshotVersion: 1,
                currentRound: 1,
                reviewEntryMode: 'auto_or_manual',
                draftingEndsAt: '2026-03-16T14:30:00.000Z',
                reviewEndsAt: null,
                transitionMode: 'seeded',
                handoff: null,
                stableSnapshot: {
                    draftVersion: 1,
                    sourceKind: 'accepted_candidate_v1_seed',
                    seedDraftAnchorId: null,
                    sourceEditAnchorId: null,
                    sourceSummaryHash: null,
                    sourceMessagesDigest: null,
                    contentHash: null,
                    createdAt: '2026-03-16T11:00:00.000Z',
                },
                workingCopy: {
                    workingCopyId: 'draft:42:working-copy',
                    draftPostId: 42,
                    basedOnSnapshotVersion: 1,
                    workingCopyContent: 'Draft body',
                    workingCopyHash: 'd'.repeat(64),
                    status: 'active',
                    roomKey: 'crucible-42',
                    latestEditAnchorId: null,
                    latestEditAnchorStatus: null,
                    updatedAt: '2026-03-16T11:05:00.000Z',
                },
                reviewBinding: {
                    boundSnapshotVersion: 1,
                    totalThreadCount: 0,
                    openThreadCount: 0,
                    proposedThreadCount: 0,
                    acceptedThreadCount: 0,
                    appliedThreadCount: 0,
                    mismatchedApplicationCount: 0,
                    latestThreadUpdatedAt: null,
                },
                warnings: [],
            } as any);
    });

    test('member+ can create discussion thread', async () => {
        const prisma = createPrismaMock();
        const router = discussionRouter(prisma as any, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/discussions', 'post');
        const createSpy = jest
            .spyOn(draftDiscussionLifecycleService, 'createDraftDiscussionThread')
            .mockResolvedValue(makeThread());

        const req = {
            params: { postId: '42' },
            body: {
                targetType: 'paragraph',
                targetRef: 'p:1',
                targetVersion: 1,
                content: 'suggested rewrite',
                issueType: 'knowledge_supplement',
            },
            userId: 11,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(201);
        expect(res.payload).toMatchObject({
            ok: true,
            draftPostId: 42,
            thread: expect.objectContaining({
                state: 'open',
            }),
        });
        expect(createSpy).toHaveBeenCalledTimes(1);
        expect(createSpy).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                issueType: 'knowledge_supplement',
            }),
        );
        expect(next).not.toHaveBeenCalled();
    });

    test('binds new discussion threads to the current lifecycle snapshot instead of trusting request targetVersion', async () => {
        const prisma = createPrismaMock();
        const router = discussionRouter(prisma as any, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/discussions', 'post');
        const createSpy = jest
            .spyOn(draftDiscussionLifecycleService, 'createDraftDiscussionThread')
            .mockResolvedValue(makeThread({ targetVersion: 2 }));
        jest.spyOn(draftLifecycleReadModelService, 'resolveDraftLifecycleReadModel')
            .mockResolvedValue({
                draftPostId: 42,
                circleId: 7,
                documentStatus: 'review',
                currentSnapshotVersion: 2,
                currentRound: 1,
                reviewEntryMode: 'auto_or_manual',
                draftingEndsAt: null,
                reviewEndsAt: '2026-03-16T14:30:00.000Z',
                transitionMode: 'manual_lock',
                handoff: null,
                stableSnapshot: {
                    draftVersion: 2,
                    sourceKind: 'review_bound_snapshot',
                    seedDraftAnchorId: null,
                    sourceEditAnchorId: null,
                    sourceSummaryHash: null,
                    sourceMessagesDigest: null,
                    contentHash: null,
                    createdAt: '2026-03-16T11:00:00.000Z',
                },
                workingCopy: {
                    workingCopyId: 'draft:42:working-copy',
                    draftPostId: 42,
                    basedOnSnapshotVersion: 2,
                    workingCopyContent: 'Draft body',
                    workingCopyHash: 'd'.repeat(64),
                    status: 'active',
                    roomKey: 'crucible-42',
                    latestEditAnchorId: null,
                    latestEditAnchorStatus: null,
                    updatedAt: '2026-03-16T11:05:00.000Z',
                },
                reviewBinding: {
                    boundSnapshotVersion: 2,
                    totalThreadCount: 0,
                    openThreadCount: 0,
                    proposedThreadCount: 0,
                    acceptedThreadCount: 0,
                    appliedThreadCount: 0,
                    mismatchedApplicationCount: 0,
                    latestThreadUpdatedAt: null,
                },
                warnings: [],
            } as any);

        const req = {
            params: { postId: '42' },
            body: {
                targetType: 'paragraph',
                targetRef: 'p:1',
                targetVersion: 999,
                content: 'suggested rewrite',
                issueType: 'knowledge_supplement',
            },
            userId: 11,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(201);
        expect(createSpy).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                targetVersion: 2,
            }),
        );
        expect(next).not.toHaveBeenCalled();
    });

    test('create thread respects raised createIssueMinRole policy', async () => {
        const prisma = createPrismaMock({
            role: 'Member',
            identityLevel: 'Member',
        });
        const router = discussionRouter(prisma as any, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/discussions', 'post');
        jest.spyOn(policyProfileService, 'resolveCirclePolicyProfile')
            .mockResolvedValue(buildPolicyProfile({
                createIssueMinRole: 'Moderator',
            }));
        const createSpy = jest.spyOn(draftDiscussionLifecycleService, 'createDraftDiscussionThread');

        const req = {
            params: { postId: '42' },
            body: {
                targetType: 'paragraph',
                targetRef: 'p:1',
                targetVersion: 1,
                content: 'suggested rewrite',
                issueType: 'knowledge_supplement',
            },
            userId: 11,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(403);
        expect(res.payload).toMatchObject({
            error: 'draft_discussion_create_permission_denied',
        });
        expect(createSpy).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('initiate-level members can create a thread when createIssueMinRole is lowered to Initiate', async () => {
        const prisma = createPrismaMock({
            role: 'Member',
            identityLevel: 'Initiate',
        });
        const router = discussionRouter(prisma as any, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/discussions', 'post');
        jest.spyOn(policyProfileService, 'resolveCirclePolicyProfile')
            .mockResolvedValue(buildPolicyProfile({
                createIssueMinRole: 'Initiate',
            }));
        const createSpy = jest
            .spyOn(draftDiscussionLifecycleService, 'createDraftDiscussionThread')
            .mockResolvedValue(makeThread({
                latestMessage: {
                    authorId: 11,
                    messageType: 'create',
                    content: '提一个问题',
                    createdAt: '2026-03-13T12:00:00.000Z',
                },
            }) as any);

        const req = {
            params: { postId: '42' },
            body: {
                targetType: 'paragraph',
                targetRef: 'p:1',
                targetVersion: 1,
                content: '提一个问题',
                issueType: 'knowledge_supplement',
            },
            userId: 11,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(201);
        expect(createSpy).toHaveBeenCalledTimes(1);
        expect(next).not.toHaveBeenCalled();
    });

    test('moderator+ can propose discussion transition', async () => {
        const prisma = createPrismaMock({
            role: 'Moderator',
            identityLevel: 'Member',
        });
        const router = discussionRouter(prisma as any, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/discussions/:threadId/propose', 'post');
        jest.spyOn(draftDiscussionLifecycleService, 'getDraftDiscussionThread')
            .mockResolvedValue(makeThread());
        const proposeSpy = jest
            .spyOn(draftDiscussionLifecycleService, 'proposeDraftDiscussionThread')
            .mockResolvedValue(makeThread({ state: 'proposed' }));

        const req = {
            params: { postId: '42', threadId: '1' },
            body: { content: 'let us adopt this change' },
            userId: 11,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            thread: expect.objectContaining({
                state: 'proposed',
            }),
        });
        expect(proposeSpy).toHaveBeenCalledTimes(1);
        expect(next).not.toHaveBeenCalled();
    });

    test('retag during propose respects retagIssueMinRole policy', async () => {
        const prisma = createPrismaMock({
            role: 'Member',
            identityLevel: 'Member',
        });
        const router = discussionRouter(prisma as any, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/discussions/:threadId/propose', 'post');
        jest.spyOn(policyProfileService, 'resolveCirclePolicyProfile')
            .mockResolvedValue(buildPolicyProfile({
                reviewIssueMinRole: 'Member',
                retagIssueMinRole: 'Moderator',
            }));
        jest.spyOn(draftDiscussionLifecycleService, 'getDraftDiscussionThread')
            .mockResolvedValue(makeThread({
                issueType: 'knowledge_supplement',
            }));
        const proposeSpy = jest.spyOn(draftDiscussionLifecycleService, 'proposeDraftDiscussionThread');

        const req = {
            params: { postId: '42', threadId: '1' },
            body: {
                content: 'let us adopt this change',
                issueType: 'fact_correction',
            },
            userId: 11,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(403);
        expect(res.payload).toMatchObject({
            error: 'draft_discussion_retag_permission_denied',
        });
        expect(proposeSpy).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('member+ can append follow-up messages without changing thread state', async () => {
        const prisma = createPrismaMock();
        const router = discussionRouter(prisma as any, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/discussions/:threadId/messages', 'post');
        const appendSpy = jest
            .spyOn(draftDiscussionLifecycleService, 'appendDraftDiscussionMessage')
            .mockResolvedValue(makeThread({
                latestMessage: {
                    authorId: 11,
                    messageType: 'followup',
                    content: '补充一个例子',
                    createdAt: '2026-03-13T12:02:00.000Z',
                },
                messages: [
                    {
                        id: '10',
                        authorId: 11,
                        messageType: 'followup',
                        content: '补充一个例子',
                        createdAt: '2026-03-13T12:02:00.000Z',
                    },
                ],
            }) as any);

        const req = {
            params: { postId: '42', threadId: '1' },
            body: { content: '补充一个例子' },
            userId: 11,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            thread: expect.objectContaining({
                state: 'open',
                latestMessage: expect.objectContaining({
                    messageType: 'followup',
                }),
            }),
        });
        expect(appendSpy).toHaveBeenCalledTimes(1);
        expect(next).not.toHaveBeenCalled();
    });

    test('reply respects raised followupIssueMinRole policy', async () => {
        const prisma = createPrismaMock({
            role: 'Member',
            identityLevel: 'Member',
        });
        const router = discussionRouter(prisma as any, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/discussions/:threadId/messages', 'post');
        jest.spyOn(policyProfileService, 'resolveCirclePolicyProfile')
            .mockResolvedValue(buildPolicyProfile({
                followupIssueMinRole: 'Moderator',
            }));
        const appendSpy = jest.spyOn(draftDiscussionLifecycleService, 'appendDraftDiscussionMessage');

        const req = {
            params: { postId: '42', threadId: '1' },
            body: { content: '补充一个例子' },
            userId: 11,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(403);
        expect(res.payload).toMatchObject({
            error: 'draft_discussion_followup_permission_denied',
        });
        expect(appendSpy).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('initiate-level members can append follow-up messages when followupIssueMinRole is lowered to Initiate', async () => {
        const prisma = createPrismaMock({
            role: 'Member',
            identityLevel: 'Initiate',
        });
        const router = discussionRouter(prisma as any, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/discussions/:threadId/messages', 'post');
        jest.spyOn(policyProfileService, 'resolveCirclePolicyProfile')
            .mockResolvedValue(buildPolicyProfile({
                followupIssueMinRole: 'Initiate',
            }));
        const appendSpy = jest
            .spyOn(draftDiscussionLifecycleService, 'appendDraftDiscussionMessage')
            .mockResolvedValue(makeThread({
                latestMessage: {
                    authorId: 11,
                    messageType: 'followup',
                    content: '继续补充',
                    createdAt: '2026-03-13T12:02:00.000Z',
                },
                messages: [
                    {
                        id: '10',
                        authorId: 11,
                        messageType: 'followup',
                        content: '继续补充',
                        createdAt: '2026-03-13T12:02:00.000Z',
                    },
                ],
            }) as any);

        const req = {
            params: { postId: '42', threadId: '1' },
            body: { content: '继续补充' },
            userId: 11,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(appendSpy).toHaveBeenCalledTimes(1);
        expect(next).not.toHaveBeenCalled();
    });

    test('creator can withdraw issue ticket before review starts', async () => {
        const prisma = createPrismaMock();
        const router = discussionRouter(prisma as any, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/discussions/:threadId/withdraw', 'post');
        jest.spyOn(draftDiscussionLifecycleService, 'getDraftDiscussionThread')
            .mockResolvedValue(makeThread());
        const withdrawSpy = jest
            .spyOn(draftDiscussionLifecycleService, 'withdrawDraftDiscussionThread')
            .mockResolvedValue(makeThread({
                state: 'withdrawn',
                latestMessage: {
                    authorId: 11,
                    messageType: 'withdraw',
                    content: '先撤回',
                    createdAt: '2026-03-13T12:02:00.000Z',
                },
                messages: [
                    {
                        id: '11',
                        authorId: 11,
                        messageType: 'withdraw',
                        content: '先撤回',
                        createdAt: '2026-03-13T12:02:00.000Z',
                    },
                ],
            }) as any);

        const req = {
            params: { postId: '42', threadId: '1' },
            body: { reason: '先撤回' },
            userId: 11,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            thread: expect.objectContaining({
                state: 'withdrawn',
            }),
        });
        expect(withdrawSpy).toHaveBeenCalledTimes(1);
        expect(next).not.toHaveBeenCalled();
    });

    test('withdraw respects allowAuthorWithdrawBeforeReview policy flag', async () => {
        const prisma = createPrismaMock();
        const router = discussionRouter(prisma as any, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/discussions/:threadId/withdraw', 'post');
        jest.spyOn(policyProfileService, 'resolveCirclePolicyProfile')
            .mockResolvedValue(buildPolicyProfile({
                allowAuthorWithdrawBeforeReview: false,
            }));
        jest.spyOn(draftDiscussionLifecycleService, 'getDraftDiscussionThread')
            .mockResolvedValue(makeThread());
        const withdrawSpy = jest.spyOn(draftDiscussionLifecycleService, 'withdrawDraftDiscussionThread');

        const req = {
            params: { postId: '42', threadId: '1' },
            body: { reason: '先撤回' },
            userId: 11,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(403);
        expect(res.payload).toMatchObject({
            error: 'draft_discussion_withdraw_permission_denied',
        });
        expect(withdrawSpy).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('resolve requires moderator or curator permission', async () => {
        const prisma = createPrismaMock({
            role: 'Member',
            identityLevel: 'Member',
            circleCreatorId: 99,
        });
        const router = discussionRouter(prisma as any, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/discussions/:threadId/resolve', 'post');
        jest.spyOn(draftDiscussionLifecycleService, 'getDraftDiscussionThread')
            .mockResolvedValue(makeThread());
        const resolveSpy = jest.spyOn(draftDiscussionLifecycleService, 'resolveDraftDiscussionThread');

        const req = {
            params: { postId: '42', threadId: '1' },
            body: { resolution: 'accepted', reason: 'looks good' },
            userId: 11,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(403);
        expect(res.payload).toMatchObject({
            error: 'draft_discussion_resolve_permission_denied',
        });
        expect(resolveSpy).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('moderator can resolve discussion thread', async () => {
        const prisma = createPrismaMock({
            role: 'Moderator',
            identityLevel: 'Member',
            circleCreatorId: 99,
        });
        const router = discussionRouter(prisma as any, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/discussions/:threadId/resolve', 'post');
        jest.spyOn(draftDiscussionLifecycleService, 'getDraftDiscussionThread')
            .mockResolvedValue(makeThread());
        const resolveSpy = jest
            .spyOn(draftDiscussionLifecycleService, 'resolveDraftDiscussionThread')
            .mockResolvedValue(makeThread({
                state: 'accepted',
                latestResolution: {
                    resolvedBy: 11,
                    toState: 'accepted',
                    reason: 'looks good',
                    resolvedAt: '2026-03-13T12:01:00.000Z',
                },
            }));

        const req = {
            params: { postId: '42', threadId: '1' },
            body: { resolution: 'accepted', reason: 'looks good' },
            userId: 11,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            thread: expect.objectContaining({
                state: 'accepted',
            }),
        });
        expect(resolveSpy).toHaveBeenCalledTimes(1);
        expect(next).not.toHaveBeenCalled();
    });

    test('member can resolve discussion thread when circle policy lowers reviewIssueMinRole', async () => {
        const prisma = createPrismaMock({
            role: 'Member',
            identityLevel: 'Member',
            circleCreatorId: 99,
        });
        const router = discussionRouter(prisma as any, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/discussions/:threadId/resolve', 'post');
        jest.spyOn(policyProfileService, 'resolveCirclePolicyProfile')
            .mockResolvedValue(buildPolicyProfile({
                reviewIssueMinRole: 'Member',
                retagIssueMinRole: 'Member',
            }));
        jest.spyOn(draftDiscussionLifecycleService, 'getDraftDiscussionThread')
            .mockResolvedValue(makeThread());
        const resolveSpy = jest
            .spyOn(draftDiscussionLifecycleService, 'resolveDraftDiscussionThread')
            .mockResolvedValue(makeThread({
                state: 'accepted',
            }));

        const req = {
            params: { postId: '42', threadId: '1' },
            body: { resolution: 'accepted', reason: 'member policy review' },
            userId: 11,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(resolveSpy).toHaveBeenCalledTimes(1);
        expect(next).not.toHaveBeenCalled();
    });

    test('apply requires curator-only permission', async () => {
        const prisma = createPrismaMock({
            role: 'Moderator',
            identityLevel: 'Member',
            circleCreatorId: 99,
        });
        const router = discussionRouter(prisma as any, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/discussions/:threadId/apply', 'post');
        const applySpy = jest.spyOn(draftDiscussionLifecycleService, 'applyDraftDiscussionThread');

        const req = {
            params: { postId: '42', threadId: '1' },
            body: {
                appliedEditAnchorId: 'a'.repeat(64),
                appliedSnapshotHash: 'b'.repeat(64),
                appliedDraftVersion: 3,
                reason: 'applied in draft v3',
            },
            userId: 11,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(403);
        expect(res.payload).toMatchObject({
            error: 'draft_discussion_apply_permission_denied',
        });
        expect(applySpy).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('curator-level actor can apply discussion with evidence', async () => {
        const prisma = createPrismaMock({
            role: 'Member',
            identityLevel: 'Member',
            circleCreatorId: 11,
        });
        const router = discussionRouter(prisma as any, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/discussions/:threadId/apply', 'post');
        const applySpy = jest
            .spyOn(draftDiscussionLifecycleService, 'applyDraftDiscussionThread')
            .mockResolvedValue(makeThread({
                state: 'applied',
                latestResolution: {
                    resolvedBy: 11,
                    toState: 'accepted',
                    reason: 'looks good',
                    resolvedAt: '2026-03-13T12:01:00.000Z',
                },
                latestApplication: {
                    appliedBy: 11,
                    appliedEditAnchorId: 'a'.repeat(64),
                    appliedSnapshotHash: 'b'.repeat(64),
                    appliedDraftVersion: 3,
                    reason: 'applied in draft v3',
                    appliedAt: '2026-03-13T12:02:00.000Z',
                },
            }));

        const req = {
            params: { postId: '42', threadId: '1' },
            body: {
                appliedEditAnchorId: 'a'.repeat(64),
                appliedSnapshotHash: 'b'.repeat(64),
                appliedDraftVersion: 3,
                reason: 'applied in draft v3',
            },
            userId: 11,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            thread: expect.objectContaining({
                state: 'applied',
            }),
        });
        expect(applySpy).toHaveBeenCalledTimes(1);
        expect(next).not.toHaveBeenCalled();
    });

    test('apply can auto-resolve evidence from latest collaboration anchor', async () => {
        const prisma = createPrismaMock({
            role: 'Member',
            identityLevel: 'Member',
            circleCreatorId: 11,
        });
        const router = discussionRouter(prisma as any, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/discussions/:threadId/apply', 'post');
        jest
            .spyOn(collabEditAnchorService, 'getCollabEditAnchorsByPostId')
            .mockResolvedValue([
                {
                    anchorId: 'a'.repeat(64),
                    snapshotHash: 'b'.repeat(64),
                    toSeq: '7',
                } as any,
            ]);
        jest
            .spyOn(collabEditAnchorService, 'verifyCollabEditAnchor')
            .mockReturnValue({
                verifiable: true,
            } as any);
        const applySpy = jest
            .spyOn(draftDiscussionLifecycleService, 'applyDraftDiscussionThread')
            .mockResolvedValue(makeThread({ state: 'applied' }));

        const req = {
            params: { postId: '42', threadId: '1' },
            body: {
                reason: 'auto evidence apply',
            },
            userId: 11,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(applySpy).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                draftPostId: 42,
                threadId: 1,
                actorUserId: 11,
                appliedEditAnchorId: 'a'.repeat(64),
                appliedSnapshotHash: 'b'.repeat(64),
                appliedDraftVersion: 7,
                reason: 'auto evidence apply',
            }),
        );
        expect(next).not.toHaveBeenCalled();
    });

    test('apply returns explicit error when auto evidence is unavailable', async () => {
        const prisma = createPrismaMock({
            role: 'Member',
            identityLevel: 'Member',
            circleCreatorId: 11,
        });
        const router = discussionRouter(prisma as any, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/discussions/:threadId/apply', 'post');
        jest
            .spyOn(collabEditAnchorService, 'getCollabEditAnchorsByPostId')
            .mockResolvedValue([]);
        const applySpy = jest.spyOn(draftDiscussionLifecycleService, 'applyDraftDiscussionThread');

        const req = {
            params: { postId: '42', threadId: '1' },
            body: {
                reason: 'auto evidence apply',
            },
            userId: 11,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(422);
        expect(res.payload).toMatchObject({
            error: 'draft_discussion_apply_evidence_unavailable',
        });
        expect(applySpy).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('invalid transition is rejected with explicit error code', async () => {
        const prisma = createPrismaMock({
            circleCreatorId: 11,
        });
        const router = discussionRouter(prisma as any, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/discussions/:threadId/apply', 'post');
        jest
            .spyOn(draftDiscussionLifecycleService, 'applyDraftDiscussionThread')
            .mockRejectedValue(new DraftDiscussionLifecycleError(
                'draft_discussion_invalid_transition',
                409,
                'invalid transition proposed -> applied',
            ));

        const req = {
            params: { postId: '42', threadId: '1' },
            body: {
                appliedEditAnchorId: 'a'.repeat(64),
                appliedSnapshotHash: 'b'.repeat(64),
                appliedDraftVersion: 3,
            },
            userId: 11,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(409);
        expect(res.payload).toMatchObject({
            error: 'draft_discussion_invalid_transition',
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('lists discussion threads for draft members', async () => {
        const prisma = createPrismaMock();
        const router = discussionRouter(prisma as any, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/discussions', 'get');
        const listSpy = jest
            .spyOn(draftDiscussionLifecycleService, 'listDraftDiscussionThreads')
            .mockResolvedValue([
                makeThread({ id: '2', state: 'proposed' }) as any,
                makeThread({ id: '1', state: 'open' }) as any,
            ]);

        const req = {
            params: { postId: '42' },
            query: { limit: '20' },
            userId: 11,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            draftPostId: 42,
            count: 2,
        });
        expect(res.payload.viewerUserId).toBe(11);
        expect(listSpy).toHaveBeenCalledTimes(1);
        expect(next).not.toHaveBeenCalled();
    });
});
