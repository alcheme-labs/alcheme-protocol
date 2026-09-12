import {
    DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY,
    type CircleDraftWorkflowPolicy,
} from '@/lib/api/circlesPolicyProfile';

export type DraftWorkflowGovernancePresetId = 'startup' | 'standard' | 'strict';
export type DraftWorkflowGovernancePresetSelection = DraftWorkflowGovernancePresetId | 'custom';

const DRAFT_WORKFLOW_POLICY_FIELDS: (keyof CircleDraftWorkflowPolicy)[] = [
    'createIssueMinRole',
    'followupIssueMinRole',
    'reviewIssueMinRole',
    'retagIssueMinRole',
    'applyIssueMinRole',
    'manualEndDraftingMinRole',
    'advanceFromReviewMinRole',
    'enterCrystallizationMinRole',
    'allowAuthorWithdrawBeforeReview',
    'allowModeratorRetagIssue',
];

export const DRAFT_WORKFLOW_GOVERNANCE_PRESETS: Record<
    DraftWorkflowGovernancePresetId,
    CircleDraftWorkflowPolicy
> = {
    startup: {
        createIssueMinRole: 'Initiate',
        followupIssueMinRole: 'Initiate',
        reviewIssueMinRole: 'Moderator',
        retagIssueMinRole: 'Moderator',
        applyIssueMinRole: 'Admin',
        manualEndDraftingMinRole: 'Moderator',
        advanceFromReviewMinRole: 'Admin',
        enterCrystallizationMinRole: 'Admin',
        allowAuthorWithdrawBeforeReview: true,
        allowModeratorRetagIssue: true,
    },
    standard: DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY,
    strict: {
        createIssueMinRole: 'Elder',
        followupIssueMinRole: 'Member',
        reviewIssueMinRole: 'Moderator',
        retagIssueMinRole: 'Moderator',
        applyIssueMinRole: 'Admin',
        manualEndDraftingMinRole: 'Moderator',
        advanceFromReviewMinRole: 'Admin',
        enterCrystallizationMinRole: 'Admin',
        allowAuthorWithdrawBeforeReview: true,
        allowModeratorRetagIssue: true,
    },
};

function policyMatchesPreset(
    policy: CircleDraftWorkflowPolicy,
    preset: CircleDraftWorkflowPolicy,
): boolean {
    return DRAFT_WORKFLOW_POLICY_FIELDS.every((field) => policy[field] === preset[field]);
}

export function resolveDraftWorkflowGovernancePreset(
    policy: CircleDraftWorkflowPolicy | null | undefined,
): DraftWorkflowGovernancePresetSelection {
    if (!policy) return 'standard';
    for (const [presetId, preset] of Object.entries(DRAFT_WORKFLOW_GOVERNANCE_PRESETS)) {
        if (policyMatchesPreset(policy, preset)) {
            return presetId as DraftWorkflowGovernancePresetId;
        }
    }
    return 'custom';
}

export function applyDraftWorkflowGovernancePreset(
    presetId: DraftWorkflowGovernancePresetSelection,
    currentPolicy: CircleDraftWorkflowPolicy = DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY,
): CircleDraftWorkflowPolicy {
    // Long-term product anchor: docs/architecture/circle-governance-model-templates.zh-CN.md.
    // Presets only fill the current draftWorkflowPolicy fields; template names are not backend permission facts.
    if (presetId === 'custom') return { ...currentPolicy };
    const preset = DRAFT_WORKFLOW_GOVERNANCE_PRESETS[presetId] || DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY;
    return { ...preset };
}
