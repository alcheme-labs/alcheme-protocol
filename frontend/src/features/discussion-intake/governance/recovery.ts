import type { IdentityState } from '@/components/circle/IdentityBadge';
import type {
    CandidateFailureRecoveryMetadata,
    DraftCandidateInlineNotice,
    GovernanceRole,
} from '@/features/discussion-intake/handoff/acceptedCandidate';

interface CandidateRecoveryActions {
    canRetry: boolean;
    canCancel: boolean;
    retryExecutionReusesPassedProposal: boolean;
}

function mapIdentityToGovernanceRoles(identity: IdentityState): GovernanceRole[] {
    if (identity === 'owner') return ['Owner', 'Admin'];
    if (identity === 'curator') return ['Admin', 'Moderator'];
    if (identity === 'member') return ['Member'];
    if (identity === 'initiate') return ['Initiate'];
    return [];
}

function hasAnyRole(viewerRoles: GovernanceRole[], allowedRoles: GovernanceRole[]): boolean {
    if (viewerRoles.length === 0 || allowedRoles.length === 0) return false;
    return viewerRoles.some((role) => allowedRoles.includes(role));
}

function resolveFromFailureRecovery(input: {
    recovery: CandidateFailureRecoveryMetadata;
    noticeState: DraftCandidateInlineNotice['state'];
    viewerRoles: GovernanceRole[];
}): CandidateRecoveryActions {
    if (input.noticeState !== input.recovery.failedStatus) {
        return {
            canRetry: false,
            canCancel: false,
            retryExecutionReusesPassedProposal: input.recovery.retryExecutionReusesPassedProposal,
        };
    }

    return {
        canRetry: hasAnyRole(input.viewerRoles, input.recovery.canRetryExecutionRoles),
        canCancel: hasAnyRole(input.viewerRoles, input.recovery.canCancelRoles),
        retryExecutionReusesPassedProposal: input.recovery.retryExecutionReusesPassedProposal,
    };
}

export function resolveCandidateRecoveryActions(input: {
    notice: DraftCandidateInlineNotice;
    viewerIdentity: IdentityState;
}): CandidateRecoveryActions {
    const viewerRoles = mapIdentityToGovernanceRoles(input.viewerIdentity);

    if (input.notice.failureRecovery) {
        return resolveFromFailureRecovery({
            recovery: input.notice.failureRecovery,
            noticeState: input.notice.state,
            viewerRoles,
        });
    }

    return {
        canRetry: input.notice.canRetry,
        canCancel: input.notice.canCancel,
        retryExecutionReusesPassedProposal: false,
    };
}
