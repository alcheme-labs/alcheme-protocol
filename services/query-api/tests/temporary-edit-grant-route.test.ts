import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Router } from 'express';

import { temporaryEditGrantRouter } from '../src/rest/temporaryEditGrant';
import * as draftLifecycleReadModel from '../src/services/draftLifecycle/readModel';
import * as governanceRuntime from '../src/services/governance/runtime';
import * as temporaryGrantRuntime from '../src/services/draftBlocks/grants';
import * as membershipChecks from '../src/services/membership/checks';

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

function makeLifecycle() {
    return {
        draftPostId: 42,
        circleId: 7,
        documentStatus: 'drafting',
        currentSnapshotVersion: 3,
        currentRound: 2,
        reviewEntryMode: 'auto_or_manual',
        draftingEndsAt: '2026-03-22T12:00:00.000Z',
        reviewEndsAt: null,
        reviewWindowExpiredAt: null,
        transitionMode: 'manual_extend',
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
        reviewBinding: null,
        warnings: [],
    } as any;
}

describe('temporary edit grant route', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(draftLifecycleReadModel, 'resolveDraftLifecycleReadModel')
            .mockResolvedValue(makeLifecycle());
        jest.spyOn(membershipChecks, 'authorizeDraftAction').mockResolvedValue({
            allowed: true,
            statusCode: 200,
            error: 'ok',
            message: 'ok',
            post: {
                id: 42,
                authorId: 77,
                circleId: 7,
                status: 'Draft',
            },
        } as any);
        jest.spyOn(membershipChecks, 'requireCircleManagerRole').mockResolvedValue(true);
        jest.spyOn(temporaryGrantRuntime, 'createPrismaTemporaryEditGrantStore').mockReturnValue({
            async getGrant(grantId: string) {
                return {
                    grantId,
                    draftPostId: 42,
                    blockId: 'paragraph:1',
                    granteeUserId: 77,
                    requestedBy: 77,
                    grantedBy: null,
                    revokedBy: null,
                    approvalMode: 'manager_confirm',
                    status: 'requested',
                    governanceProposalId: null,
                    requestNote: null,
                    expiresAt: null,
                    requestedAt: new Date('2026-03-22T09:00:00.000Z'),
                    grantedAt: null,
                    revokedAt: null,
                    updatedAt: new Date('2026-03-22T09:00:00.000Z'),
                };
            },
            async saveGrant(grant: any) {
                return grant;
            },
            async listDraftGrants() {
                return [];
            },
        } as any);
    });

    test('requests a temporary edit grant for a block', async () => {
        jest.spyOn(temporaryGrantRuntime, 'requestTemporaryEditGrant').mockResolvedValue({
            grantId: 'grant-1',
            draftPostId: 42,
            blockId: 'paragraph:1',
            granteeUserId: 77,
            requestedBy: 77,
            grantedBy: null,
            revokedBy: null,
            approvalMode: 'manager_confirm',
            status: 'requested',
            governanceProposalId: null,
            requestNote: null,
            expiresAt: null,
            requestedAt: new Date('2026-03-22T09:00:00.000Z'),
            grantedAt: null,
            revokedAt: null,
            updatedAt: new Date('2026-03-22T09:00:00.000Z'),
        } as any);

        const router = temporaryEditGrantRouter({} as any, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/temporary-edit-grants', 'post');
        const req = {
            userId: 77,
            params: { postId: '42' },
            body: { blockId: 'paragraph:1' },
        } as any;
        const res = createMockResponse();

        await handler(req, res as any);

        expect(res.statusCode).toBe(200);
        expect(res.payload.grant.status).toBe('requested');
    });

    test('issues a grant through the dedicated route', async () => {
        jest.spyOn(temporaryGrantRuntime, 'issueTemporaryEditGrant').mockResolvedValue({
            grantId: 'grant-1',
            draftPostId: 42,
            blockId: 'paragraph:1',
            granteeUserId: 77,
            requestedBy: 77,
            grantedBy: 9,
            revokedBy: null,
            approvalMode: 'manager_confirm',
            status: 'active',
            governanceProposalId: null,
            requestNote: null,
            expiresAt: new Date('2026-03-22T10:00:00.000Z'),
            requestedAt: new Date('2026-03-22T09:00:00.000Z'),
            grantedAt: new Date('2026-03-22T09:05:00.000Z'),
            revokedAt: null,
            updatedAt: new Date('2026-03-22T09:05:00.000Z'),
        } as any);

        const router = temporaryEditGrantRouter({} as any, {} as any);
        const handler = getRouteHandler(router, '/grants/:grantId/issue', 'post');
        const req = {
            userId: 9,
            params: { grantId: 'grant-1' },
            body: { expiresInMinutes: 60 },
        } as any;
        const res = createMockResponse();

        await handler(req, res as any);

        expect(res.statusCode).toBe(200);
        expect(res.payload.grant.status).toBe('active');
    });

    test('revokes a grant through the dedicated route', async () => {
        jest.spyOn(temporaryGrantRuntime, 'revokeTemporaryEditGrant').mockResolvedValue({
            grantId: 'grant-1',
            draftPostId: 42,
            blockId: 'paragraph:1',
            granteeUserId: 77,
            requestedBy: 77,
            grantedBy: 9,
            revokedBy: 9,
            approvalMode: 'manager_confirm',
            status: 'revoked',
            governanceProposalId: null,
            requestNote: null,
            expiresAt: null,
            requestedAt: new Date('2026-03-22T09:00:00.000Z'),
            grantedAt: new Date('2026-03-22T09:05:00.000Z'),
            revokedAt: new Date('2026-03-22T09:10:00.000Z'),
            updatedAt: new Date('2026-03-22T09:10:00.000Z'),
        } as any);

        const router = temporaryEditGrantRouter({} as any, {} as any);
        const handler = getRouteHandler(router, '/grants/:grantId/revoke', 'post');
        const req = {
            userId: 9,
            params: { grantId: 'grant-1' },
            body: {},
        } as any;
        const res = createMockResponse();

        await handler(req, res as any);

        expect(res.statusCode).toBe(200);
        expect(res.payload.grant.status).toBe('revoked');
    });

    test('reuses governance core when a grant request explicitly asks for governance vote', async () => {
        jest.spyOn(governanceRuntime, 'createGovernanceProposal').mockResolvedValue({
            proposalId: 'gov-grant-1',
            circleId: 7,
            actionType: 'temporary_edit_grant',
            targetType: 'temporary_edit_grant',
            targetId: 'grant-gov-1',
            targetVersion: 3,
            status: 'active',
            createdBy: 77,
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
            configSnapshot: { blockId: 'paragraph:2' },
            createdAt: new Date('2026-03-22T09:00:00.000Z'),
            updatedAt: new Date('2026-03-22T09:00:00.000Z'),
        } as any);
        jest.spyOn(temporaryGrantRuntime, 'requestTemporaryEditGrant').mockResolvedValue({
            grantId: 'grant-gov-1',
            draftPostId: 42,
            blockId: 'paragraph:2',
            granteeUserId: 77,
            requestedBy: 77,
            grantedBy: null,
            revokedBy: null,
            approvalMode: 'governance_vote',
            status: 'requested',
            governanceProposalId: 'gov-grant-1',
            requestNote: null,
            expiresAt: null,
            requestedAt: new Date('2026-03-22T09:00:00.000Z'),
            grantedAt: null,
            revokedAt: null,
            updatedAt: new Date('2026-03-22T09:00:00.000Z'),
        } as any);

        const router = temporaryEditGrantRouter({} as any, {} as any);
        const handler = getRouteHandler(router, '/drafts/:postId/temporary-edit-grants', 'post');
        const req = {
            userId: 77,
            params: { postId: '42' },
            body: {
                blockId: 'paragraph:2',
                approvalMode: 'governance_vote',
            },
        } as any;
        const res = createMockResponse();

        await handler(req, res as any);

        expect(res.statusCode).toBe(200);
        expect(res.payload.grant.governanceProposalId).toBe('gov-grant-1');
    });
});
