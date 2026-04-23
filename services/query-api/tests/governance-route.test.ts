import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Router } from 'express';

import { governanceRouter } from '../src/rest/governance';
import * as governanceRuntime from '../src/services/governance/runtime';
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

function makePolicyProfile() {
    return {
        circleId: 7,
        sourceType: 'circle_override',
        inheritanceMode: 'independent',
        inheritsFromProfileId: null,
        inheritsFromCircleId: null,
        draftGenerationPolicy: {
            actionType: 'draft_generation',
            proposalMode: 'signal_based',
            electorateScope: 'discussion_participants_with_manager_guard',
            eligibleRoles: ['Member', 'Elder', 'Owner', 'Admin', 'Moderator'],
            voteRule: 'threshold_count',
            thresholdValue: 2,
            quorum: null,
            timeWindowMinutes: 10,
            managerConfirmationRequired: true,
            allowManualMultiSelectCandidate: true,
            allowGhostAutoDraft: false,
        },
        draftLifecycleTemplate: {
            templateId: 'fast_deposition',
            draftGenerationVotingMinutes: 10,
            draftingWindowMinutes: 45,
            reviewWindowMinutes: 180,
            maxRevisionRounds: 2,
            reviewEntryMode: 'manual_only',
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
        },
        blockEditEligibilityPolicy: {
            mode: 'manager_or_contributor_or_temporary_editor',
            managerOverride: true,
            contributorEvidenceRequired: true,
        },
        forkPolicy: {
            enabled: true,
            thresholdMode: 'contribution_threshold',
            minimumContributions: 3,
            minimumRole: 'Member',
            requiresGovernanceVote: false,
            inheritancePrefillSource: 'lv0_default_profile',
            knowledgeLineageInheritance: 'upstream_until_fork_node',
        },
        ghostPolicy: {
            draftTriggerMode: 'notify_only',
            summaryUseLLM: false,
            triggerSummaryUseLLM: false,
            triggerGenerateComment: true,
        },
        localEditability: 'editable',
        effectiveFrom: new Date('2026-03-21T00:00:00.000Z'),
        resolvedFromProfileVersion: null,
        configVersion: 4,
    } as any;
}

describe('governance route', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        jest.spyOn(policyProfileService, 'resolveCirclePolicyProfile').mockResolvedValue(makePolicyProfile());
    });

    test('creates a governance proposal and attaches policyProfileDigest from the frozen public policy fields', async () => {
        const createSpy = jest.spyOn(governanceRuntime, 'createGovernanceProposal').mockResolvedValue({
            proposalId: 'proposal-1',
            circleId: 7,
            actionType: 'crystallization',
            targetType: 'draft_post',
            targetId: '99',
            targetVersion: null,
            status: 'active',
            createdBy: 12,
            electorateScope: 'contributors_of_current_draft',
            voteRule: 'threshold_count',
            thresholdValue: 2,
            quorum: null,
            opensAt: null,
            closesAt: null,
            resolvedAt: null,
            executedAt: null,
            executionError: null,
            executionMarker: null,
            policyProfileDigest: 'digest-1',
            configSnapshot: { draftPostId: 99 },
            createdAt: new Date('2026-03-21T00:00:00.000Z'),
            updatedAt: new Date('2026-03-21T00:00:00.000Z'),
        } as any);

        const router = governanceRouter({} as any, {} as any);
        const handler = getRouteHandler(router, '/proposals', 'post');
        const req = {
            userId: 12,
            body: {
                circleId: 7,
                actionType: 'crystallization',
                targetType: 'draft_post',
                targetId: '99',
                electorateScope: 'contributors_of_current_draft',
                voteRule: 'threshold_count',
                thresholdValue: 2,
            },
        } as any;
        const res = createMockResponse();

        await handler(req, res as any);

        expect(res.statusCode).toBe(200);
        expect(createSpy).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                actionType: 'crystallization',
                policyProfileDigest: expect.any(String),
            }),
        );
        expect(res.payload.proposal.policyProfileDigest).toBe('digest-1');
    });

    test('allows fork proposal creation without vote settings', async () => {
        const createSpy = jest.spyOn(governanceRuntime, 'createGovernanceProposal').mockResolvedValue({
            proposalId: 'fork-1',
            circleId: 7,
            actionType: 'fork',
            targetType: 'circle',
            targetId: '7',
            targetVersion: null,
            status: 'passed',
            createdBy: 15,
            electorateScope: null,
            voteRule: null,
            thresholdValue: null,
            quorum: null,
            opensAt: null,
            closesAt: null,
            resolvedAt: null,
            executedAt: null,
            executionError: null,
            executionMarker: null,
            policyProfileDigest: 'digest-fork',
            configSnapshot: { sourceCircleId: 7 },
            createdAt: new Date('2026-03-21T00:00:00.000Z'),
            updatedAt: new Date('2026-03-21T00:00:00.000Z'),
        } as any);

        const router = governanceRouter({} as any, {} as any);
        const handler = getRouteHandler(router, '/proposals', 'post');
        const req = {
            userId: 15,
            body: {
                circleId: 7,
                actionType: 'fork',
                targetType: 'circle',
                targetId: '7',
            },
        } as any;
        const res = createMockResponse();

        await handler(req, res as any);

        expect(res.statusCode).toBe(200);
        expect(createSpy).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                actionType: 'fork',
                electorateScope: null,
                voteRule: null,
                thresholdValue: null,
            }),
        );
    });

    test('records a governance vote through the vote route', async () => {
        const voteSpy = jest.spyOn(governanceRuntime, 'recordGovernanceVote').mockResolvedValue({
            proposalId: 'proposal-1',
            voterUserId: 22,
            vote: 'approve',
            reason: 'sounds good',
            createdAt: new Date('2026-03-21T00:03:00.000Z'),
        });

        const router = governanceRouter({} as any, {} as any);
        const handler = getRouteHandler(router, '/proposals/:proposalId/votes', 'post');
        const req = {
            params: { proposalId: 'proposal-1' },
            userId: 22,
            body: {
                vote: 'approve',
                reason: 'sounds good',
            },
        } as any;
        const res = createMockResponse();

        await handler(req, res as any);

        expect(res.statusCode).toBe(200);
        expect(voteSpy).toHaveBeenCalledWith(expect.anything(), {
            proposalId: 'proposal-1',
            voterUserId: 22,
            vote: 'approve',
            reason: 'sounds good',
            createdAt: expect.any(Date),
        });
    });
});
