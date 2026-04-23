import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Router } from 'express';

import { revisionDirectionRouter } from '../src/rest/revisionDirection';
import * as draftLifecycleReadModel from '../src/services/draftLifecycle/readModel';
import * as draftWorkflowPermissions from '../src/services/policy/draftWorkflowPermissions';
import * as governanceRuntime from '../src/services/governance/runtime';
import * as revisionDirectionRuntime from '../src/services/revisionDirection/runtime';

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

function makeLifecycle(documentStatus: string = 'review') {
    return {
        draftPostId: 42,
        circleId: 7,
        documentStatus,
        currentSnapshotVersion: 3,
        currentRound: 2,
        reviewEntryMode: 'auto_or_manual',
        draftingEndsAt: null,
        reviewEndsAt: '2026-03-22T11:00:00.000Z',
        reviewWindowExpiredAt: null,
        transitionMode: 'manual_lock',
        handoff: null,
        policyProfileDigest: 'f'.repeat(64),
        stableSnapshot: {
            draftVersion: 3,
            sourceKind: 'review_bound_snapshot',
            seedDraftAnchorId: null,
            sourceEditAnchorId: 'a'.repeat(64),
            sourceSummaryHash: null,
            sourceMessagesDigest: null,
            contentHash: 'b'.repeat(64),
            createdAt: '2026-03-22T09:00:00.000Z',
        },
        workingCopy: {
            workingCopyId: 'draft:42:working-copy',
            draftPostId: 42,
            basedOnSnapshotVersion: 3,
            workingCopyContent: 'Draft body',
            workingCopyHash: 'c'.repeat(64),
            status: 'active',
            roomKey: 'crucible-42',
            latestEditAnchorId: null,
            latestEditAnchorStatus: null,
            updatedAt: '2026-03-22T09:10:00.000Z',
        },
        reviewBinding: {
            boundSnapshotVersion: 3,
            totalThreadCount: 2,
            openThreadCount: 1,
            proposedThreadCount: 1,
            acceptedThreadCount: 0,
            appliedThreadCount: 0,
            mismatchedApplicationCount: 0,
            latestThreadUpdatedAt: '2026-03-22T09:10:00.000Z',
        },
        warnings: [],
    } as any;
}

describe('revision direction route', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(draftLifecycleReadModel, 'resolveDraftLifecycleReadModel')
            .mockResolvedValue(makeLifecycle());
        jest.spyOn(draftWorkflowPermissions, 'resolveDraftWorkflowPermission')
            .mockResolvedValue({
                allowed: true,
                policy: {
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
                },
                minRole: 'Member',
                reason: 'ok',
            } as any);
    });

    test('creates a minimal revision direction during review without a governance proposal for manager_confirm', async () => {
        const createSpy = jest.spyOn(revisionDirectionRuntime, 'createRevisionDirectionProposal')
            .mockResolvedValue({
                revisionProposalId: 'rd-1',
                draftPostId: 42,
                draftVersion: 3,
                scopeType: 'document',
                scopeRef: 'document',
                proposedBy: 9,
                summary: '下一轮先补齐前提条件。',
                acceptanceMode: 'manager_confirm',
                status: 'open',
                acceptedBy: null,
                acceptedAt: null,
                governanceProposalId: null,
                createdAt: new Date('2026-03-22T09:00:00.000Z'),
            } as any);
        const governanceSpy = jest.spyOn(governanceRuntime, 'createGovernanceProposal');

        const router = revisionDirectionRouter({} as any, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/revision-directions', 'post');
        const req = {
            userId: 9,
            params: { postId: '42' },
            body: {
                scopeType: 'document',
                scopeRef: 'document',
                summary: '下一轮先补齐前提条件。',
                acceptanceMode: 'manager_confirm',
            },
        } as any;
        const res = createMockResponse();

        await handler(req, res as any);

        expect(res.statusCode).toBe(200);
        expect(governanceSpy).not.toHaveBeenCalled();
        expect(createSpy).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                draftPostId: 42,
                draftVersion: 3,
                acceptanceMode: 'manager_confirm',
                governanceProposalId: null,
            }),
        );
    });

    test('creates governance linkage only when acceptanceMode is governance_vote', async () => {
        jest.spyOn(governanceRuntime, 'createGovernanceProposal').mockResolvedValue({
            proposalId: 'gov-rd-1',
            circleId: 7,
            actionType: 'revision_direction',
            targetType: 'revision_direction',
            targetId: 'rd-gov-1',
            targetVersion: 3,
            status: 'active',
            createdBy: 9,
            electorateScope: 'qualified_roles',
            voteRule: 'single_approver',
            thresholdValue: 1,
            quorum: null,
            opensAt: null,
            closesAt: null,
            resolvedAt: null,
            executedAt: null,
            executionError: null,
            executionMarker: null,
            policyProfileDigest: null,
            configSnapshot: { draftPostId: 42 },
            createdAt: new Date('2026-03-22T09:00:00.000Z'),
            updatedAt: new Date('2026-03-22T09:00:00.000Z'),
        } as any);
        const createSpy = jest.spyOn(revisionDirectionRuntime, 'createRevisionDirectionProposal')
            .mockResolvedValue({
                revisionProposalId: 'rd-gov-1',
                draftPostId: 42,
                draftVersion: 3,
                scopeType: 'document',
                scopeRef: 'document',
                proposedBy: 9,
                summary: '通过治理决定是否先重构结构。',
                acceptanceMode: 'governance_vote',
                status: 'open',
                acceptedBy: null,
                acceptedAt: null,
                governanceProposalId: 'gov-rd-1',
                createdAt: new Date('2026-03-22T09:00:00.000Z'),
            } as any);

        const router = revisionDirectionRouter({} as any, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/revision-directions', 'post');
        const req = {
            userId: 9,
            params: { postId: '42' },
            body: {
                scopeType: 'document',
                scopeRef: 'document',
                summary: '通过治理决定是否先重构结构。',
                acceptanceMode: 'governance_vote',
            },
        } as any;
        const res = createMockResponse();

        await handler(req, res as any);

        expect(res.statusCode).toBe(200);
        expect(createSpy).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                acceptanceMode: 'governance_vote',
                governanceProposalId: 'gov-rd-1',
            }),
        );
        expect(res.payload.proposal.governanceProposalId).toBe('gov-rd-1');
    });

    test('lists revision directions together with accepted next-round inputs', async () => {
        jest.spyOn(revisionDirectionRuntime, 'listRevisionDirectionProposals').mockResolvedValue([
            {
                revisionProposalId: 'rd-1',
                draftPostId: 42,
                draftVersion: 3,
                scopeType: 'document',
                scopeRef: 'document',
                proposedBy: 9,
                summary: '下一轮先补齐前提条件。',
                acceptanceMode: 'manager_confirm',
                status: 'accepted',
                acceptedBy: 21,
                acceptedAt: new Date('2026-03-22T10:00:00.000Z'),
                governanceProposalId: null,
                createdAt: new Date('2026-03-22T09:00:00.000Z'),
            },
        ] as any);
        jest.spyOn(revisionDirectionRuntime, 'listAcceptedRevisionDirectionsForNextRound').mockResolvedValue([
            {
                revisionProposalId: 'rd-1',
                draftPostId: 42,
                draftVersion: 3,
                scopeType: 'document',
                scopeRef: 'document',
                proposedBy: 9,
                summary: '下一轮先补齐前提条件。',
                acceptanceMode: 'manager_confirm',
                status: 'accepted',
                acceptedBy: 21,
                acceptedAt: new Date('2026-03-22T10:00:00.000Z'),
                governanceProposalId: null,
                createdAt: new Date('2026-03-22T09:00:00.000Z'),
            },
        ] as any);

        const router = revisionDirectionRouter({} as any, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/revision-directions', 'get');
        const req = {
            params: { postId: '42' },
            query: { draftVersion: '3' },
        } as any;
        const res = createMockResponse();

        await handler(req, res as any);

        expect(res.statusCode).toBe(200);
        expect(res.payload.acceptedDirections).toHaveLength(1);
        expect(res.payload.acceptedDirections[0].revisionProposalId).toBe('rd-1');
    });
});
