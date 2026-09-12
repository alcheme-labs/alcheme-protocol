import type { CircleDraftWorkflowPolicy, GovernanceRole } from '@/lib/api/circlesPolicyProfile';

export interface DraftPermissionMembership {
    role: 'Owner' | 'Admin' | 'Moderator' | 'Member';
    status: 'Active' | 'Banned' | 'Left';
    identityLevel: 'Visitor' | 'Initiate' | 'Member' | 'Elder';
}

export interface DraftPermissionState {
    canComment: boolean;
    canEdit: boolean;
    canCrystallize: boolean;
}

export interface DraftWorkflowActionCapability {
    allowed: boolean;
    reason: string | null;
}

export interface DraftWorkflowPermissionState {
    createIssue: DraftWorkflowActionCapability;
    followupIssue: DraftWorkflowActionCapability;
    withdrawOwnIssue: DraftWorkflowActionCapability;
    startReview: DraftWorkflowActionCapability;
    retagIssue: DraftWorkflowActionCapability;
    acceptRejectIssue: DraftWorkflowActionCapability;
    applyAcceptedIssue: DraftWorkflowActionCapability;
    endDraftingEarly: DraftWorkflowActionCapability;
    advanceFromReview: DraftWorkflowActionCapability;
    enterCrystallization: DraftWorkflowActionCapability;
}

export interface DraftWorkflowPermissionCopy {
    inactiveReason: string;
    roleLabel: Record<GovernanceRole, string>;
    higherRoleLabel: string;
    reasons: {
        createIssue: (role: string) => string;
        followupIssue: (role: string) => string;
        withdrawOwnIssue: string;
        reviewIssue: (role: string) => string;
        retagIssue: (role: string) => string;
        applyAcceptedIssue: (role: string) => string;
        endDraftingEarly: (role: string) => string;
        advanceFromReview: (role: string) => string;
        enterCrystallization: (role: string) => string;
        retagIssueDisabled: string;
    };
}

const DEFAULT_WORKFLOW_PERMISSION_COPY: DraftWorkflowPermissionCopy = {
    inactiveReason: '__inactive_member__',
    roleLabel: {
        Owner: 'owner',
        Admin: 'admin',
        Moderator: 'moderator',
        Elder: 'elder',
        Member: 'member',
        Initiate: 'initiate',
    },
    higherRoleLabel: 'higher_role',
    reasons: {
        createIssue: (role) => `create_issue:${role}`,
        followupIssue: (role) => `followup_issue:${role}`,
        withdrawOwnIssue: 'withdraw_own_issue_disabled',
        reviewIssue: (role) => `review_issue:${role}`,
        retagIssue: (role) => `retag_issue:${role}`,
        applyAcceptedIssue: (role) => `apply_issue:${role}`,
        endDraftingEarly: (role) => `end_drafting_early:${role}`,
        advanceFromReview: (role) => `advance_from_review:${role}`,
        enterCrystallization: (role) => `enter_crystallization:${role}`,
        retagIssueDisabled: 'retag_issue_disabled',
    },
};

export function deriveDraftPermissions(
    membership: DraftPermissionMembership | null | undefined,
): DraftPermissionState {
    if (!membership || membership.status !== 'Active') {
        return {
            canComment: false,
            canEdit: false,
            canCrystallize: false,
        };
    }

    const manager =
        membership.role === 'Owner'
        || membership.role === 'Admin'
        || membership.role === 'Moderator';

    const canComment =
        manager
        || membership.identityLevel === 'Initiate'
        || membership.identityLevel === 'Member'
        || membership.identityLevel === 'Elder';

    const canEdit =
        manager
        || membership.identityLevel === 'Member'
        || membership.identityLevel === 'Elder';

    return {
        canComment,
        canEdit,
        canCrystallize: manager,
    };
}

function roleRank(role: GovernanceRole): number {
    if (role === 'Owner') return 6;
    if (role === 'Admin') return 5;
    if (role === 'Moderator') return 4;
    if (role === 'Elder') return 3;
    if (role === 'Member') return 2;
    return 1;
}

function actorRank(membership: DraftPermissionMembership): number {
    if (membership.role === 'Owner') return roleRank('Owner');
    if (membership.role === 'Admin') return roleRank('Admin');
    if (membership.role === 'Moderator') return roleRank('Moderator');
    if (membership.identityLevel === 'Elder') return roleRank('Elder');
    if (membership.identityLevel === 'Member') return roleRank('Member');
    if (membership.identityLevel === 'Initiate') return roleRank('Initiate');
    return 0;
}

function formatRoleLabel(role: GovernanceRole, copy: DraftWorkflowPermissionCopy): string {
    return copy.roleLabel[role];
}

function buildDeniedReason(
    action: keyof DraftWorkflowPermissionState,
    minRole: GovernanceRole | null,
    copy: DraftWorkflowPermissionCopy,
): string {
    const roleLabel = minRole ? formatRoleLabel(minRole, copy) : copy.higherRoleLabel;
    if (action === 'createIssue') {
        return copy.reasons.createIssue(roleLabel);
    }
    if (action === 'followupIssue') {
        return copy.reasons.followupIssue(roleLabel);
    }
    if (action === 'withdrawOwnIssue') {
        return copy.reasons.withdrawOwnIssue;
    }
    if (action === 'startReview' || action === 'acceptRejectIssue') {
        return copy.reasons.reviewIssue(roleLabel);
    }
    if (action === 'retagIssue') {
        return copy.reasons.retagIssue(roleLabel);
    }
    if (action === 'applyAcceptedIssue') {
        return copy.reasons.applyAcceptedIssue(roleLabel);
    }
    if (action === 'endDraftingEarly') {
        return copy.reasons.endDraftingEarly(roleLabel);
    }
    if (action === 'advanceFromReview') {
        return copy.reasons.advanceFromReview(roleLabel);
    }
    return copy.reasons.enterCrystallization(roleLabel);
}

function resolveRoleCapability(input: {
    membership: DraftPermissionMembership | null | undefined;
    minRole: GovernanceRole;
    action: keyof DraftWorkflowPermissionState;
    copy: DraftWorkflowPermissionCopy;
}): DraftWorkflowActionCapability {
    if (!input.membership || input.membership.status !== 'Active') {
        return { allowed: false, reason: input.copy.inactiveReason };
    }

    const allowed = actorRank(input.membership) >= roleRank(input.minRole);
    return {
        allowed,
        reason: allowed ? null : buildDeniedReason(input.action, input.minRole, input.copy),
    };
}

export function deriveDraftWorkflowPermissions(input: {
    membership: DraftPermissionMembership | null | undefined;
    workflowPolicy: CircleDraftWorkflowPolicy | null | undefined;
}, copy: DraftWorkflowPermissionCopy = DEFAULT_WORKFLOW_PERMISSION_COPY): DraftWorkflowPermissionState {
    const fallbackPolicy: CircleDraftWorkflowPolicy = {
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
    };
    const policy = input.workflowPolicy || fallbackPolicy;

    return {
        createIssue: resolveRoleCapability({
            membership: input.membership,
            minRole: policy.createIssueMinRole,
            action: 'createIssue',
            copy,
        }),
        followupIssue: resolveRoleCapability({
            membership: input.membership,
            minRole: policy.followupIssueMinRole,
            action: 'followupIssue',
            copy,
        }),
        withdrawOwnIssue: !input.membership || input.membership.status !== 'Active'
            ? { allowed: false, reason: copy.inactiveReason }
            : policy.allowAuthorWithdrawBeforeReview
                ? { allowed: true, reason: null }
                : { allowed: false, reason: buildDeniedReason('withdrawOwnIssue', null, copy) },
        startReview: resolveRoleCapability({
            membership: input.membership,
            minRole: policy.reviewIssueMinRole,
            action: 'startReview',
            copy,
        }),
        retagIssue: !policy.allowModeratorRetagIssue
            ? {
                allowed: false,
                reason: copy.reasons.retagIssueDisabled,
            }
            : resolveRoleCapability({
                membership: input.membership,
                minRole: policy.retagIssueMinRole,
                action: 'retagIssue',
                copy,
            }),
        acceptRejectIssue: resolveRoleCapability({
            membership: input.membership,
            minRole: policy.reviewIssueMinRole,
            action: 'acceptRejectIssue',
            copy,
        }),
        applyAcceptedIssue: resolveRoleCapability({
            membership: input.membership,
            minRole: policy.applyIssueMinRole,
            action: 'applyAcceptedIssue',
            copy,
        }),
        endDraftingEarly: resolveRoleCapability({
            membership: input.membership,
            minRole: policy.manualEndDraftingMinRole,
            action: 'endDraftingEarly',
            copy,
        }),
        advanceFromReview: resolveRoleCapability({
            membership: input.membership,
            minRole: policy.advanceFromReviewMinRole,
            action: 'advanceFromReview',
            copy,
        }),
        enterCrystallization: resolveRoleCapability({
            membership: input.membership,
            minRole: policy.enterCrystallizationMinRole,
            action: 'enterCrystallization',
            copy,
        }),
    };
}
