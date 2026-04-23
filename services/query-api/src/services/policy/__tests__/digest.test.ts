import type { CirclePolicyProfile } from '../types';
import {
    buildPublicPolicyDigestSnapshot,
    computePolicyProfileDigest,
} from '../digest';

function makeProfile(): CirclePolicyProfile {
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
    };
}

describe('policy profile digest', () => {
    test('computes a stable digest for the same public policy fields', () => {
        const snapshot = buildPublicPolicyDigestSnapshot(makeProfile());

        expect(computePolicyProfileDigest(snapshot)).toBe(computePolicyProfileDigest(snapshot));
    });

    test('ignores ghost policy because it is outside the frozen digest scope', () => {
        const base = makeProfile();
        const changedGhostPolicy = {
            ...base,
            ghostPolicy: {
                ...base.ghostPolicy,
                summaryUseLLM: true,
                triggerGenerateComment: false,
            },
        };

        expect(
            computePolicyProfileDigest(buildPublicPolicyDigestSnapshot(base)),
        ).toBe(
            computePolicyProfileDigest(buildPublicPolicyDigestSnapshot(changedGhostPolicy)),
        );
    });

    test('changes digest when a frozen public policy field changes', () => {
        const base = makeProfile();
        const changedForkPolicy = {
            ...base,
            forkPolicy: {
                ...base.forkPolicy,
                minimumContributions: 5,
            },
        };

        expect(
            computePolicyProfileDigest(buildPublicPolicyDigestSnapshot(base)),
        ).not.toBe(
            computePolicyProfileDigest(buildPublicPolicyDigestSnapshot(changedForkPolicy)),
        );
    });
});
