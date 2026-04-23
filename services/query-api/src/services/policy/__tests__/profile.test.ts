import {
    buildFallbackCirclePolicyProfile,
    mergeCirclePolicyProfile,
} from '../profile';
import type { CirclePolicyProfile } from '../types';

const baseGhostPolicy: CirclePolicyProfile['ghostPolicy'] = {
    summaryUseLLM: false,
    draftTriggerMode: 'notify_only',
    triggerSummaryUseLLM: false,
    triggerGenerateComment: true,
};

describe('circle policy profile fallback', () => {
    test('builds lv0 profile as independent and editable', () => {
        const profile = buildFallbackCirclePolicyProfile({
            circle: {
                id: 1,
                level: 0,
                parentCircleId: null,
                createdAt: new Date('2026-03-16T00:00:00.000Z'),
                joinRequirement: 'Free',
                circleType: 'Open',
                minCrystals: 0,
            },
            ghostPolicy: baseGhostPolicy,
        });

        expect(profile.sourceType).toBe('lv0_default');
        expect(profile.inheritanceMode).toBe('independent');
        expect(profile.localEditability).toBe('editable');
        expect(profile.draftLifecycleTemplate.templateId).toBe('fast_deposition');
        expect((profile.draftLifecycleTemplate as any).reviewEntryMode).toBe('auto_or_manual');
        expect((profile as any).draftWorkflowPolicy).toMatchObject({
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
        });
        expect(profile.draftGenerationPolicy.actionType).toBe('draft_generation');
    });

    test('builds non-root profile with inherited editable fallback', () => {
        const profile = buildFallbackCirclePolicyProfile({
            circle: {
                id: 22,
                level: 2,
                parentCircleId: 8,
                createdAt: new Date('2026-03-16T00:00:00.000Z'),
                joinRequirement: 'ApprovalRequired',
                circleType: 'Closed',
                minCrystals: 3,
            },
            ghostPolicy: baseGhostPolicy,
        });

        expect(profile.sourceType).toBe('inherited_editable');
        expect(profile.inheritanceMode).toBe('inherit_but_editable');
        expect(profile.inheritsFromCircleId).toBe(8);
        expect(profile.localEditability).toBe('editable');
        expect(profile.forkPolicy.minimumContributions).toBe(3);
    });
});

describe('circle policy profile merge', () => {
    test('enforces local locked semantics when inheritance mode is inherit_locked', () => {
        const fallback = buildFallbackCirclePolicyProfile({
            circle: {
                id: 7,
                level: 1,
                parentCircleId: 1,
                createdAt: new Date('2026-03-16T00:00:00.000Z'),
                joinRequirement: 'Free',
                circleType: 'Open',
                minCrystals: 0,
            },
            ghostPolicy: baseGhostPolicy,
        });

        const merged = mergeCirclePolicyProfile(fallback, {
            circleId: 7,
            sourceType: 'inherited_locked',
            inheritanceMode: 'inherit_locked',
            inheritsFromProfileId: 'profile-lv0-v3',
            inheritsFromCircleId: 1,
            draftGenerationPolicy: { thresholdValue: 3 },
            draftLifecycleTemplate: {
                reviewEntryMode: 'manual_only',
            },
            draftWorkflowPolicy: {
                reviewIssueMinRole: 'Member',
                applyIssueMinRole: 'Moderator',
                manualEndDraftingMinRole: 'Member',
            },
            blockEditEligibilityPolicy: null,
            forkPolicy: { requiresGovernanceVote: true },
            ghostPolicy: null,
            localEditability: 'editable',
            effectiveFrom: new Date('2026-03-16T01:00:00.000Z'),
            resolvedFromProfileVersion: 3,
            configVersion: 5,
        });

        expect(merged.sourceType).toBe('inherited_locked');
        expect(merged.inheritanceMode).toBe('inherit_locked');
        expect(merged.localEditability).toBe('locked');
        expect(merged.inheritsFromProfileId).toBe('profile-lv0-v3');
        expect(merged.resolvedFromProfileVersion).toBe(3);
        expect(merged.configVersion).toBe(5);
        expect(merged.draftGenerationPolicy.thresholdValue).toBe(3);
        expect((merged.draftLifecycleTemplate as any).reviewEntryMode).toBe('manual_only');
        expect((merged as any).draftWorkflowPolicy).toMatchObject({
            reviewIssueMinRole: 'Member',
            applyIssueMinRole: 'Moderator',
            manualEndDraftingMinRole: 'Member',
            createIssueMinRole: 'Member',
        });
        expect(merged.forkPolicy.requiresGovernanceVote).toBe(true);
    });
});
