import {
    buildCandidateGenerationGovernanceReadModel,
    buildCrystallizationGovernanceReadModel,
    buildForkBaselineResolvedView,
    buildForkThresholdResolvedView,
    buildInheritanceResolvedView,
    buildTeam04ForkResolvedInputs,
    mapCrystallizationOutcomeFromProposalStatus,
    mapDraftGenerationOutcomeFromProposalStatus,
} from '../read-models';
import type { CirclePolicyProfile, GovernanceProposal } from '../../policy/types';

function makeProfile(): CirclePolicyProfile {
    return {
        circleId: 1,
        sourceType: 'lv0_default',
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
            draftingWindowMinutes: 30,
            reviewWindowMinutes: 240,
            maxRevisionRounds: 1,
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
        },
        blockEditEligibilityPolicy: {
            mode: 'manager_or_contributor_or_temporary_editor',
            managerOverride: true,
            contributorEvidenceRequired: true,
        },
        forkPolicy: {
            enabled: true,
            thresholdMode: 'contribution_threshold',
            minimumContributions: 1,
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
        effectiveFrom: new Date('2026-03-16T00:00:00.000Z'),
        resolvedFromProfileVersion: null,
        configVersion: 1,
    };
}

function makeProposal(status: GovernanceProposal['status']): GovernanceProposal {
    return {
        proposalId: 'proposal-1',
        circleId: 1,
        actionType: 'draft_generation',
        targetType: 'draft_candidate',
        targetId: 'candidate-1',
        targetVersion: null,
        status,
        createdBy: 10,
        electorateScope: 'discussion_participants_with_manager_guard',
        voteRule: 'threshold_count',
        thresholdValue: 2,
        quorum: null,
        opensAt: new Date('2026-03-16T00:00:00.000Z'),
        closesAt: new Date('2026-03-16T00:10:00.000Z'),
        resolvedAt: null,
        executedAt: null,
        executionError: null,
        configSnapshot: null,
        createdAt: new Date('2026-03-16T00:00:00.000Z'),
    };
}

describe('governance status mapping', () => {
    test('maps execution_failed to generation_failed', () => {
        expect(mapDraftGenerationOutcomeFromProposalStatus('execution_failed')).toBe('generation_failed');
    });

    test('maps executed to accepted', () => {
        expect(mapDraftGenerationOutcomeFromProposalStatus('executed')).toBe('accepted');
    });

    test('maps execution_failed to crystallization_failed', () => {
        expect(mapCrystallizationOutcomeFromProposalStatus('execution_failed')).toBe('crystallization_failed');
    });

    test('maps rejected crystallization to drafting', () => {
        expect(mapCrystallizationOutcomeFromProposalStatus('rejected')).toBe('drafting');
    });
});

describe('governance read models', () => {
    test('builds candidate generation read model with generation_failed semantics', () => {
        const profile = makeProfile();
        const proposal = makeProposal('execution_failed');

        const readModel = buildCandidateGenerationGovernanceReadModel({
            circleId: 1,
            candidateId: 'candidate-1',
            policyProfile: profile,
            proposal,
            votes: [],
        });

        expect(readModel.candidateStatus).toBe('generation_failed');
        expect(readModel.failureRecovery.failedStatus).toBe('generation_failed');
        expect(readModel.failureRecovery.retryExecutionReusesPassedProposal).toBe(true);
        expect(readModel.failureRecovery.canRetryExecutionRoles).toEqual(['Owner', 'Admin', 'Moderator']);
    });

    test('builds crystallization read model with retry and rollback permissions', () => {
        const profile = makeProfile();
        const proposal: GovernanceProposal = {
            ...makeProposal('execution_failed'),
            actionType: 'crystallization',
            targetType: 'draft_post',
            targetId: '99',
        };

        const readModel = buildCrystallizationGovernanceReadModel({
            circleId: 1,
            draftPostId: 99,
            policyProfile: profile,
            proposal,
            votes: [],
        });

        expect(readModel.draftStatus).toBe('crystallization_failed');
        expect(readModel.failureRecovery.retryExecutionReusesPassedProposal).toBe(true);
        expect(readModel.failureRecovery.canRollbackToReviewRoles).toEqual(['Owner', 'Admin', 'Moderator']);
    });

    test('builds fork baseline view from policy profile', () => {
        const profile = makeProfile();
        const view = buildForkBaselineResolvedView({
            circleId: 1,
            policyProfile: profile,
        });

        expect(view.baseline.inheritanceMode).toBe('independent');
        expect(view.baseline.runtimeLiveParentLookup).toBe(false);
        expect(view.threshold.thresholdMode).toBe('contribution_threshold');
    });

    test('builds dedicated fork threshold resolved view', () => {
        const profile = makeProfile();
        const view = buildForkThresholdResolvedView({
            circleId: 1,
            policyProfile: profile,
        });

        expect(view.circleId).toBe(1);
        expect(view.thresholdMode).toBe('contribution_threshold');
        expect(view.minimumContributions).toBe(1);
        expect(view.minimumRole).toBe('Member');
        expect(view.requiresGovernanceVote).toBe(false);
    });

    test('builds dedicated inheritance resolved view', () => {
        const profile = makeProfile();
        const view = buildInheritanceResolvedView({
            circleId: 1,
            policyProfile: profile,
        });

        expect(view.sourceType).toBe('lv0_default');
        expect(view.inheritanceMode).toBe('independent');
        expect(view.localEditability).toBe('editable');
        expect(view.runtimeLiveParentLookup).toBe(false);
    });

    test('builds Team 04 minimum field set inputs', () => {
        const profile = makeProfile();
        const inputs = buildTeam04ForkResolvedInputs({
            circleId: 1,
            policyProfile: profile,
        });

        expect(inputs.forkThresholdResolvedView.minimumContributions).toBe(1);
        expect(inputs.inheritanceResolvedView.inheritanceMode).toBe('independent');
        expect(inputs.minimumFieldSet.configVersion).toBe(1);
        expect(inputs.minimumFieldSet.inheritancePrefillSource).toBe('lv0_default_profile');
        expect(inputs.minimumFieldSet.knowledgeLineageInheritance).toBe('upstream_until_fork_node');
    });
});
