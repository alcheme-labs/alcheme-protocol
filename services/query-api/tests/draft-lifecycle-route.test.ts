import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Router } from 'express';

import { draftLifecycleRouter } from '../src/rest/draftLifecycle';
import * as draftLifecycleService from '../src/services/draftLifecycle/readModel';
import * as draftLifecycleAnchorVerification from '../src/services/draftLifecycle/anchorVerification';
import * as draftWorkflowStateService from '../src/services/draftLifecycle/workflowState';
import * as membershipChecks from '../src/services/membership/checks';
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

function createPrismaMock(input?: {
    membership?: { role: string; status: string; identityLevel: string } | null;
}) {
    const membership = input && 'membership' in input
        ? input.membership
        : {
            role: 'Member',
            status: 'Active',
            identityLevel: 'Member',
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
                creatorId: 77,
            })),
        },
        circleMember: {
            findUnique: jest.fn(async () => membership),
        },
        user: {
            findUnique: jest.fn(async () => ({
                id: 9,
                pubkey: 'Actor111111111111111111111111111111111111111',
            })),
        },
    } as any;
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

describe('draft lifecycle route', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(policyProfileService, 'resolveCirclePolicyProfile')
            .mockResolvedValue(buildPolicyProfile());
        jest.spyOn(draftLifecycleAnchorVerification, 'verifyEnterDraftLifecycleCrystallizationAnchor')
            .mockResolvedValue({ ok: true });
        jest.spyOn(draftLifecycleAnchorVerification, 'verifyArchiveDraftLifecycleAnchor')
            .mockResolvedValue({ ok: true });
        jest.spyOn(draftLifecycleAnchorVerification, 'verifyRestoreDraftLifecycleAnchor')
            .mockResolvedValue({ ok: true });
        jest.spyOn(draftWorkflowStateService, 'getPersistedDraftWorkflowState')
            .mockResolvedValue({
                draftPostId: 42,
                circleId: 7,
                documentStatus: 'review',
                currentSnapshotVersion: 2,
                currentRound: 1,
                reviewEntryMode: 'auto_or_manual',
                draftingStartedAt: '2026-03-16T10:00:00.000Z',
                draftingEndsAt: null,
                reviewStartedAt: '2026-03-16T10:10:00.000Z',
                reviewEndsAt: '2026-03-16T11:10:00.000Z',
                reviewWindowExpiredAt: null,
                crystallizationPolicyProfileDigest: null,
                crystallizationAnchorSignature: null,
                transitionMode: 'manual_lock',
                lastTransitionAt: '2026-03-16T10:10:00.000Z',
                lastTransitionBy: 9,
            } as any);
    });

    test('returns Team 03 lifecycle read model through a non-discussion seam', async () => {
        const prisma = createPrismaMock();
        const router = draftLifecycleRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId', 'get');
        const lifecycleSpy = jest.spyOn(draftLifecycleService, 'resolveDraftLifecycleReadModel')
            .mockResolvedValue({
                draftPostId: 42,
                circleId: 7,
                documentStatus: 'drafting',
                currentSnapshotVersion: 1,
                handoff: {
                    candidateId: 'cand_001',
                    draftPostId: 42,
                    sourceMessageIds: ['env_a'],
                    sourceDiscussionLabels: ['fact'],
                    lastProposalId: 'gov_777',
                    acceptedAt: '2026-03-16T10:00:00.000Z',
                },
                stableSnapshot: {
                    draftVersion: 1,
                    sourceKind: 'accepted_candidate_v1_seed',
                    seedDraftAnchorId: 'a'.repeat(64),
                    sourceEditAnchorId: null,
                    sourceSummaryHash: 'b'.repeat(64),
                    sourceMessagesDigest: 'c'.repeat(64),
                    contentHash: null,
                    createdAt: '2026-03-16T10:00:00.000Z',
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
                    updatedAt: '2026-03-16T10:05:00.000Z',
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

        const req = {
            params: { postId: '42' },
            userId: 9,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            draftPostId: 42,
            lifecycle: expect.objectContaining({
                currentSnapshotVersion: 1,
                documentStatus: 'drafting',
            }),
        });
        expect(lifecycleSpy).toHaveBeenCalledWith(prisma, { draftPostId: 42 });
        expect(next).not.toHaveBeenCalled();
    });

    test('reuses existing draft read permission checks before resolving lifecycle', async () => {
        const prisma = createPrismaMock({ membership: null });
        const router = draftLifecycleRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId', 'get');
        const lifecycleSpy = jest.spyOn(draftLifecycleService, 'resolveDraftLifecycleReadModel');

        const req = {
            params: { postId: '42' },
            userId: 9,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(403);
        expect(res.payload).toMatchObject({
            error: 'draft_membership_required',
        });
        expect(lifecycleSpy).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('still returns lifecycle when accepted candidate handoff is missing', async () => {
        const prisma = createPrismaMock();
        const router = draftLifecycleRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId', 'get');
        jest.spyOn(draftLifecycleService, 'resolveDraftLifecycleReadModel')
            .mockResolvedValue({
                draftPostId: 42,
                circleId: 7,
                documentStatus: 'drafting',
                currentSnapshotVersion: 1,
                handoff: null,
                stableSnapshot: {
                    draftVersion: 1,
                    sourceKind: null,
                    seedDraftAnchorId: null,
                    sourceEditAnchorId: null,
                    sourceSummaryHash: null,
                    sourceMessagesDigest: null,
                    contentHash: null,
                    createdAt: '2026-03-16T10:00:00.000Z',
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
                    updatedAt: '2026-03-16T10:05:00.000Z',
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
                warnings: [
                    'draft source handoff is missing; treating candidate source as unavailable for this draft',
                ],
            } as any);

        const req = {
            params: { postId: '42' },
            userId: 9,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            lifecycle: {
                handoff: null,
                stableSnapshot: {
                    sourceKind: null,
                },
            },
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('allows moderators to end drafting early and enter review through a dedicated route', async () => {
        const prisma = createPrismaMock({
            membership: {
                role: 'Moderator',
                status: 'Active',
                identityLevel: 'Member',
            },
        });
        const router = draftLifecycleRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/enter-review', 'post');
        const enterReviewSpy = jest.spyOn(draftLifecycleService, 'enterDraftLifecycleReview')
            .mockResolvedValue({
                draftPostId: 42,
                circleId: 7,
                documentStatus: 'review',
                currentSnapshotVersion: 1,
                currentRound: 1,
                reviewEntryMode: 'auto_or_manual',
                transitionMode: 'manual_lock',
                draftingEndsAt: '2026-03-16T10:30:00.000Z',
                reviewEndsAt: '2026-03-16T14:30:00.000Z',
                handoff: null,
                stableSnapshot: {
                    draftVersion: 1,
                    sourceKind: null,
                    seedDraftAnchorId: null,
                    sourceEditAnchorId: null,
                    sourceSummaryHash: null,
                    sourceMessagesDigest: null,
                    contentHash: null,
                    createdAt: '2026-03-16T10:00:00.000Z',
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
                    updatedAt: '2026-03-16T10:05:00.000Z',
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
        const req = {
            params: { postId: '42' },
            userId: 9,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            lifecycle: {
                documentStatus: 'review',
                transitionMode: 'manual_lock',
            },
        });
        expect(enterReviewSpy).toHaveBeenCalledWith(prisma, {
            draftPostId: 42,
            actorUserId: 9,
            confirmApplyAcceptedGhostThreads: false,
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('allows members to end drafting early when circle policy lowers manualEndDraftingMinRole', async () => {
        const prisma = createPrismaMock({
            membership: {
                role: 'Member',
                status: 'Active',
                identityLevel: 'Member',
            },
        });
        const router = draftLifecycleRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/enter-review', 'post');
        jest.spyOn(policyProfileService, 'resolveCirclePolicyProfile')
            .mockResolvedValue(buildPolicyProfile({
                manualEndDraftingMinRole: 'Member',
            }));
        const enterReviewSpy = jest.spyOn(draftLifecycleService, 'enterDraftLifecycleReview')
            .mockResolvedValue({
                draftPostId: 42,
                circleId: 7,
                documentStatus: 'review',
                currentSnapshotVersion: 1,
                currentRound: 1,
                reviewEntryMode: 'auto_or_manual',
                transitionMode: 'manual_lock',
                draftingEndsAt: '2026-03-16T10:30:00.000Z',
                reviewEndsAt: '2026-03-16T14:30:00.000Z',
                handoff: null,
                stableSnapshot: {
                    draftVersion: 1,
                    sourceKind: null,
                    seedDraftAnchorId: null,
                    sourceEditAnchorId: null,
                    sourceSummaryHash: null,
                    sourceMessagesDigest: null,
                    contentHash: null,
                    createdAt: '2026-03-16T10:00:00.000Z',
                },
                workingCopy: {
                    workingCopyId: 'draft:42:working-copy',
                    draftPostId: 42,
                    basedOnSnapshotVersion: 1,
                    workingCopyContent: 'Draft body',
                    workingCopyHash: 'd'.repeat(64),
                    status: 'locked',
                    roomKey: 'crucible-42',
                    latestEditAnchorId: null,
                    latestEditAnchorStatus: null,
                    updatedAt: '2026-03-16T10:05:00.000Z',
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

        const req = {
            params: { postId: '42' },
            userId: 9,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(enterReviewSpy).toHaveBeenCalledWith(prisma, {
            draftPostId: 42,
            actorUserId: 9,
            confirmApplyAcceptedGhostThreads: false,
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('allows admins to advance review into the next drafting round', async () => {
        const prisma = createPrismaMock({
            membership: {
                role: 'Admin',
                status: 'Active',
                identityLevel: 'Member',
            },
        });
        const router = draftLifecycleRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/advance-review', 'post');
        const advanceReviewSpy = jest.spyOn(draftLifecycleService, 'advanceDraftLifecycleReview')
            .mockResolvedValue({
                draftPostId: 42,
                circleId: 7,
                documentStatus: 'drafting',
                currentSnapshotVersion: 2,
                currentRound: 2,
                reviewEntryMode: 'auto_or_manual',
                transitionMode: 'manual_extend',
                draftingEndsAt: '2026-03-16T12:00:00.000Z',
                reviewEndsAt: null,
                handoff: null,
                stableSnapshot: {
                    draftVersion: 2,
                    sourceKind: 'review_bound_snapshot',
                    seedDraftAnchorId: null,
                    sourceEditAnchorId: 'a'.repeat(64),
                    sourceSummaryHash: null,
                    sourceMessagesDigest: null,
                    contentHash: 'b'.repeat(64),
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
                    totalThreadCount: 2,
                    openThreadCount: 0,
                    proposedThreadCount: 0,
                    acceptedThreadCount: 0,
                    appliedThreadCount: 2,
                    mismatchedApplicationCount: 0,
                    latestThreadUpdatedAt: '2026-03-16T11:05:00.000Z',
                },
                warnings: [],
            } as any);

        const req = {
            params: { postId: '42' },
            userId: 9,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            lifecycle: {
                documentStatus: 'drafting',
                transitionMode: 'manual_extend',
                currentRound: 2,
            },
        });
        expect(advanceReviewSpy).toHaveBeenCalledWith(prisma, {
            draftPostId: 42,
            actorUserId: 9,
            confirmApplyAcceptedGhostThreads: false,
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('allows moderators to enter crystallization from review', async () => {
        const prisma = createPrismaMock({
            membership: {
                role: 'Moderator',
                status: 'Active',
                identityLevel: 'Member',
            },
        });
        const router = draftLifecycleRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/enter-crystallization', 'post');
        const enterCrystallizationSpy = jest.spyOn(draftLifecycleService, 'enterDraftLifecycleCrystallization')
            .mockResolvedValue({
                draftPostId: 42,
                circleId: 7,
                documentStatus: 'crystallization_active',
                currentSnapshotVersion: 2,
                currentRound: 1,
                reviewEntryMode: 'auto_or_manual',
                transitionMode: 'enter_crystallization',
                draftingEndsAt: null,
                reviewEndsAt: '2026-03-16T14:30:00.000Z',
                handoff: null,
                stableSnapshot: {
                    draftVersion: 2,
                    sourceKind: 'review_bound_snapshot',
                    seedDraftAnchorId: null,
                    sourceEditAnchorId: 'a'.repeat(64),
                    sourceSummaryHash: null,
                    sourceMessagesDigest: null,
                    contentHash: 'b'.repeat(64),
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
                    totalThreadCount: 2,
                    openThreadCount: 0,
                    proposedThreadCount: 0,
                    acceptedThreadCount: 0,
                    appliedThreadCount: 2,
                    mismatchedApplicationCount: 0,
                    latestThreadUpdatedAt: '2026-03-16T11:05:00.000Z',
                },
                warnings: [],
            } as any);

        const req = {
            params: { postId: '42' },
            userId: 9,
            body: {
                anchorSignature: 'sig_enter_001',
                policyProfileDigest: 'a'.repeat(64),
            },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            lifecycle: {
                documentStatus: 'crystallization_active',
                transitionMode: 'enter_crystallization',
            },
        });
        expect(draftLifecycleAnchorVerification.verifyEnterDraftLifecycleCrystallizationAnchor)
            .toHaveBeenCalledWith({
                actorPubkey: 'Actor111111111111111111111111111111111111111',
                anchorSignature: 'sig_enter_001',
                draftPostId: 42,
                policyProfileDigest: 'a'.repeat(64),
                minimumAcceptedAt: '2026-03-16T10:10:00.000Z',
                reusedAnchorSignature: null,
            });
        expect(enterCrystallizationSpy).toHaveBeenCalledWith(prisma, {
            draftPostId: 42,
            actorUserId: 9,
            anchorSignature: 'sig_enter_001',
            policyProfileDigest: 'a'.repeat(64),
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('requires a signed on-chain anchor before entering crystallization', async () => {
        const prisma = createPrismaMock({
            membership: {
                role: 'Moderator',
                status: 'Active',
                identityLevel: 'Member',
            },
        });
        const router = draftLifecycleRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/enter-crystallization', 'post');
        const enterCrystallizationSpy = jest.spyOn(draftLifecycleService, 'enterDraftLifecycleCrystallization');

        const req = {
            params: { postId: '42' },
            userId: 9,
            body: {},
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(400);
        expect(res.payload).toMatchObject({
            error: 'anchor_signature_required',
        });
        expect(enterCrystallizationSpy).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('rejects enter crystallization when the submitted milestone signature cannot be verified on-chain', async () => {
        const prisma = createPrismaMock({
            membership: {
                role: 'Moderator',
                status: 'Active',
                identityLevel: 'Member',
            },
        });
        const router = draftLifecycleRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/enter-crystallization', 'post');
        const enterCrystallizationSpy = jest.spyOn(draftLifecycleService, 'enterDraftLifecycleCrystallization');
        jest.spyOn(draftLifecycleAnchorVerification, 'verifyEnterDraftLifecycleCrystallizationAnchor')
            .mockResolvedValue({
                ok: false,
                reason: 'anchor_tx_not_found',
            });

        const req = {
            params: { postId: '42' },
            userId: 9,
            body: {
                anchorSignature: 'sig_enter_001',
                policyProfileDigest: 'a'.repeat(64),
            },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(422);
        expect(res.payload).toMatchObject({
            error: 'anchor_signature_unverified',
            reason: 'anchor_tx_not_found',
        });
        expect(enterCrystallizationSpy).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('returns a server error when crystallization anchor verification is misconfigured', async () => {
        const prisma = createPrismaMock({
            membership: {
                role: 'Moderator',
                status: 'Active',
                identityLevel: 'Member',
            },
        });
        const router = draftLifecycleRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/enter-crystallization', 'post');
        const enterCrystallizationSpy = jest.spyOn(draftLifecycleService, 'enterDraftLifecycleCrystallization');
        jest.spyOn(draftLifecycleAnchorVerification, 'verifyEnterDraftLifecycleCrystallizationAnchor')
            .mockResolvedValue({
                ok: false,
                reason: 'content_program_id_unconfigured',
            });

        const req = {
            params: { postId: '42' },
            userId: 9,
            body: {
                anchorSignature: 'sig_enter_001',
                policyProfileDigest: 'a'.repeat(64),
            },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(500);
        expect(res.payload).toMatchObject({
            error: 'anchor_verification_misconfigured',
            reason: 'content_program_id_unconfigured',
        });
        expect(enterCrystallizationSpy).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('allows moderators to retry crystallization from failure state', async () => {
        const prisma = createPrismaMock({
            membership: {
                role: 'Moderator',
                status: 'Active',
                identityLevel: 'Member',
            },
        });
        const router = draftLifecycleRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/retry-crystallization', 'post');
        const retrySpy = jest.spyOn(draftLifecycleService, 'retryDraftLifecycleCrystallization')
            .mockResolvedValue({
                draftPostId: 42,
                circleId: 7,
                documentStatus: 'crystallization_active',
                currentSnapshotVersion: 2,
                currentRound: 1,
                reviewEntryMode: 'auto_or_manual',
                transitionMode: 'enter_crystallization',
                draftingEndsAt: null,
                reviewEndsAt: '2026-03-16T14:30:00.000Z',
                handoff: null,
                stableSnapshot: {
                    draftVersion: 2,
                    sourceKind: 'review_bound_snapshot',
                    seedDraftAnchorId: null,
                    sourceEditAnchorId: 'a'.repeat(64),
                    sourceSummaryHash: null,
                    sourceMessagesDigest: null,
                    contentHash: 'b'.repeat(64),
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
                    totalThreadCount: 2,
                    openThreadCount: 0,
                    proposedThreadCount: 0,
                    acceptedThreadCount: 0,
                    appliedThreadCount: 2,
                    mismatchedApplicationCount: 0,
                    latestThreadUpdatedAt: '2026-03-16T11:05:00.000Z',
                },
                warnings: [],
            } as any);

        const req = {
            params: { postId: '42' },
            userId: 9,
            body: {
                anchorSignature: 'sig_retry_001',
                policyProfileDigest: 'a'.repeat(64),
            },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            lifecycle: {
                documentStatus: 'crystallization_active',
            },
        });
        expect(draftLifecycleAnchorVerification.verifyEnterDraftLifecycleCrystallizationAnchor)
            .toHaveBeenCalledWith({
                actorPubkey: 'Actor111111111111111111111111111111111111111',
                anchorSignature: 'sig_retry_001',
                draftPostId: 42,
                policyProfileDigest: 'a'.repeat(64),
                minimumAcceptedAt: '2026-03-16T10:10:00.000Z',
                reusedAnchorSignature: null,
            });
        expect(retrySpy).toHaveBeenCalledWith(prisma, {
            draftPostId: 42,
            actorUserId: 9,
            anchorSignature: 'sig_retry_001',
            policyProfileDigest: 'a'.repeat(64),
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('exposes an explicit repair route for crystallization evidence backfill', async () => {
        const prisma = createPrismaMock({
            membership: {
                role: 'Moderator',
                status: 'Active',
                identityLevel: 'Member',
            },
        });
        const router = draftLifecycleRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/repair-crystallization-evidence', 'post');
        const repairSpy = jest.spyOn(draftLifecycleService, 'repairDraftLifecycleCrystallizationEvidence')
            .mockResolvedValue({
                draftPostId: 42,
                circleId: 7,
                documentStatus: 'crystallization_active',
                currentSnapshotVersion: 2,
                currentRound: 1,
                reviewEntryMode: 'auto_or_manual',
                transitionMode: 'enter_crystallization',
                draftingEndsAt: null,
                reviewEndsAt: '2026-03-16T14:30:00.000Z',
                handoff: null,
                stableSnapshot: {
                    draftVersion: 2,
                    sourceKind: 'review_bound_snapshot',
                    seedDraftAnchorId: null,
                    sourceEditAnchorId: 'a'.repeat(64),
                    sourceSummaryHash: null,
                    sourceMessagesDigest: null,
                    contentHash: 'b'.repeat(64),
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
                    totalThreadCount: 2,
                    openThreadCount: 0,
                    proposedThreadCount: 0,
                    acceptedThreadCount: 0,
                    appliedThreadCount: 2,
                    mismatchedApplicationCount: 0,
                    latestThreadUpdatedAt: '2026-03-16T11:05:00.000Z',
                },
                warnings: [],
            } as any);

        const req = {
            params: { postId: '42' },
            userId: 9,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            lifecycle: {
                documentStatus: 'crystallization_active',
            },
        });
        expect(repairSpy).toHaveBeenCalledWith(prisma, {
            draftPostId: 42,
            actorUserId: 9,
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('requires a signed on-chain anchor before retrying crystallization', async () => {
        const prisma = createPrismaMock({
            membership: {
                role: 'Moderator',
                status: 'Active',
                identityLevel: 'Member',
            },
        });
        const router = draftLifecycleRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/retry-crystallization', 'post');
        const retrySpy = jest.spyOn(draftLifecycleService, 'retryDraftLifecycleCrystallization');

        const req = {
            params: { postId: '42' },
            userId: 9,
            body: {},
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(400);
        expect(res.payload).toMatchObject({
            error: 'anchor_signature_required',
        });
        expect(retrySpy).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('allows admins to roll failed crystallization back to review', async () => {
        const prisma = createPrismaMock({
            membership: {
                role: 'Admin',
                status: 'Active',
                identityLevel: 'Member',
            },
        });
        const router = draftLifecycleRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/rollback-crystallization', 'post');
        const rollbackSpy = jest.spyOn(draftLifecycleService, 'rollbackDraftLifecycleCrystallizationFailure')
            .mockResolvedValue({
                draftPostId: 42,
                circleId: 7,
                documentStatus: 'review',
                currentSnapshotVersion: 2,
                currentRound: 1,
                reviewEntryMode: 'auto_or_manual',
                transitionMode: 'rollback_to_review',
                draftingEndsAt: null,
                reviewEndsAt: '2026-03-16T14:30:00.000Z',
                handoff: null,
                stableSnapshot: {
                    draftVersion: 2,
                    sourceKind: 'review_bound_snapshot',
                    seedDraftAnchorId: null,
                    sourceEditAnchorId: 'a'.repeat(64),
                    sourceSummaryHash: null,
                    sourceMessagesDigest: null,
                    contentHash: 'b'.repeat(64),
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
                    totalThreadCount: 2,
                    openThreadCount: 0,
                    proposedThreadCount: 0,
                    acceptedThreadCount: 0,
                    appliedThreadCount: 2,
                    mismatchedApplicationCount: 0,
                    latestThreadUpdatedAt: '2026-03-16T11:05:00.000Z',
                },
                warnings: [],
            } as any);

        const req = {
            params: { postId: '42' },
            userId: 9,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            lifecycle: {
                documentStatus: 'review',
                transitionMode: 'rollback_to_review',
            },
        });
        expect(rollbackSpy).toHaveBeenCalledWith(prisma, {
            draftPostId: 42,
            actorUserId: 9,
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('exposes archive route and returns archived lifecycle with anchor metadata', async () => {
        const prisma = createPrismaMock({
            membership: {
                role: 'Admin',
                status: 'Active',
                identityLevel: 'Member',
            },
        });
        const router = draftLifecycleRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/archive', 'post');
        const archiveSpy = jest.spyOn(draftLifecycleService, 'archiveDraftLifecycle')
            .mockResolvedValue({
                draftPostId: 42,
                circleId: 7,
                documentStatus: 'archived',
                currentSnapshotVersion: 2,
                currentRound: 2,
                reviewEntryMode: 'auto_or_manual',
                transitionMode: 'archived',
                draftingEndsAt: null,
                reviewEndsAt: null,
                reviewWindowExpiredAt: null,
                policyProfileDigest: '8'.repeat(64),
                handoff: null,
                stableSnapshot: {
                    draftVersion: 2,
                    sourceKind: 'review_bound_snapshot',
                    seedDraftAnchorId: null,
                    sourceEditAnchorId: 'a'.repeat(64),
                    sourceSummaryHash: null,
                    sourceMessagesDigest: null,
                    contentHash: 'b'.repeat(64),
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
                    totalThreadCount: 2,
                    openThreadCount: 0,
                    proposedThreadCount: 0,
                    acceptedThreadCount: 0,
                    appliedThreadCount: 2,
                    mismatchedApplicationCount: 0,
                    latestThreadUpdatedAt: '2026-03-16T11:05:00.000Z',
                },
                warnings: [],
            } as any);

        const req = {
            params: { postId: '42' },
            userId: 9,
            body: {
                anchorSignature: 'sig_archive_001',
                policyProfileDigest: 'a'.repeat(64),
            },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            anchorSignature: 'sig_archive_001',
            lifecycle: {
                documentStatus: 'archived',
                policyProfileDigest: '8'.repeat(64),
            },
        });
        expect(archiveSpy).toHaveBeenCalledWith(prisma, {
            draftPostId: 42,
            actorUserId: 9,
            anchorSignature: 'sig_archive_001',
        });
        expect(draftLifecycleAnchorVerification.verifyArchiveDraftLifecycleAnchor)
            .toHaveBeenCalledWith({
                actorPubkey: 'Actor111111111111111111111111111111111111111',
                anchorSignature: 'sig_archive_001',
                draftPostId: 42,
                policyProfileDigest: 'a'.repeat(64),
                minimumAcceptedAt: '2026-03-16T10:10:00.000Z',
            });
        expect(next).not.toHaveBeenCalled();
    });

    test('rejects archive when the submitted milestone signature cannot be verified on-chain', async () => {
        const prisma = createPrismaMock({
            membership: {
                role: 'Admin',
                status: 'Active',
                identityLevel: 'Member',
            },
        });
        const router = draftLifecycleRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/archive', 'post');
        const archiveSpy = jest.spyOn(draftLifecycleService, 'archiveDraftLifecycle');
        jest.spyOn(draftLifecycleAnchorVerification, 'verifyArchiveDraftLifecycleAnchor')
            .mockResolvedValue({
                ok: false,
                reason: 'anchor_instruction_missing',
            });

        const req = {
            params: { postId: '42' },
            userId: 9,
            body: {
                anchorSignature: 'sig_archive_001',
                policyProfileDigest: 'a'.repeat(64),
            },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(422);
        expect(res.payload).toMatchObject({
            error: 'anchor_signature_unverified',
            reason: 'anchor_instruction_missing',
        });
        expect(archiveSpy).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('exposes restore route and reopens archived drafts as drafting', async () => {
        const prisma = createPrismaMock({
            membership: {
                role: 'Admin',
                status: 'Active',
                identityLevel: 'Member',
            },
        });
        const router = draftLifecycleRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/restore', 'post');
        const restoreSpy = jest.spyOn(draftLifecycleService, 'restoreDraftLifecycle')
            .mockResolvedValue({
                draftPostId: 42,
                circleId: 7,
                documentStatus: 'drafting',
                currentSnapshotVersion: 2,
                currentRound: 3,
                reviewEntryMode: 'auto_or_manual',
                transitionMode: 'manual_extend',
                draftingEndsAt: '2026-03-16T13:00:00.000Z',
                reviewEndsAt: null,
                reviewWindowExpiredAt: null,
                policyProfileDigest: '9'.repeat(64),
                handoff: null,
                stableSnapshot: {
                    draftVersion: 2,
                    sourceKind: 'review_bound_snapshot',
                    seedDraftAnchorId: null,
                    sourceEditAnchorId: 'a'.repeat(64),
                    sourceSummaryHash: null,
                    sourceMessagesDigest: null,
                    contentHash: 'b'.repeat(64),
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
                    totalThreadCount: 2,
                    openThreadCount: 0,
                    proposedThreadCount: 0,
                    acceptedThreadCount: 0,
                    appliedThreadCount: 2,
                    mismatchedApplicationCount: 0,
                    latestThreadUpdatedAt: '2026-03-16T11:05:00.000Z',
                },
                warnings: [],
            } as any);

        const req = {
            params: { postId: '42' },
            userId: 9,
            body: {
                anchorSignature: 'sig_restore_001',
                policyProfileDigest: 'a'.repeat(64),
            },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            anchorSignature: 'sig_restore_001',
            lifecycle: {
                documentStatus: 'drafting',
                currentRound: 3,
                policyProfileDigest: '9'.repeat(64),
            },
        });
        expect(restoreSpy).toHaveBeenCalledWith(prisma, {
            draftPostId: 42,
            actorUserId: 9,
            anchorSignature: 'sig_restore_001',
        });
        expect(draftLifecycleAnchorVerification.verifyRestoreDraftLifecycleAnchor)
            .toHaveBeenCalledWith({
                actorPubkey: 'Actor111111111111111111111111111111111111111',
                anchorSignature: 'sig_restore_001',
                draftPostId: 42,
                policyProfileDigest: 'a'.repeat(64),
                minimumAcceptedAt: '2026-03-16T10:10:00.000Z',
            });
        expect(next).not.toHaveBeenCalled();
    });

    test('rejects restore when the submitted milestone signature cannot be verified on-chain', async () => {
        const prisma = createPrismaMock({
            membership: {
                role: 'Admin',
                status: 'Active',
                identityLevel: 'Member',
            },
        });
        const router = draftLifecycleRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/restore', 'post');
        const restoreSpy = jest.spyOn(draftLifecycleService, 'restoreDraftLifecycle');
        jest.spyOn(draftLifecycleAnchorVerification, 'verifyRestoreDraftLifecycleAnchor')
            .mockResolvedValue({
                ok: false,
                reason: 'anchor_instruction_missing',
            });

        const req = {
            params: { postId: '42' },
            userId: 9,
            body: {
                anchorSignature: 'sig_restore_001',
                policyProfileDigest: 'a'.repeat(64),
            },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(422);
        expect(res.payload).toMatchObject({
            error: 'anchor_signature_unverified',
            reason: 'anchor_instruction_missing',
        });
        expect(restoreSpy).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });
});
