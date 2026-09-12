import type { DraftLifecycleReadModel } from '@/lib/api/draftWorkingCopy';
import type { DraftWorkflowActionCapability } from '@/lib/circle/draftPermissions';

export interface DraftIssueCapabilityCopy {
    stageRequired: string;
    reviewWindowExpired: string;
    stableSnapshotRequired: string;
}

export function deriveDraftIssueCreateCapability(input: {
    lifecycle: DraftLifecycleReadModel | null | undefined;
    workflowPermission: DraftWorkflowActionCapability;
}, copy: DraftIssueCapabilityCopy): DraftWorkflowActionCapability {
    const workflowAllowed = input.workflowPermission.allowed;
    const workflowReason = input.workflowPermission.reason;
    const lifecycle = input.lifecycle;

    if (!lifecycle || lifecycle.documentStatus !== 'review') {
        return {
            allowed: false,
            reason: copy.stageRequired,
        };
    }

    if (lifecycle.reviewWindowExpiredAt) {
        return {
            allowed: false,
            reason: copy.reviewWindowExpired,
        };
    }

    if (lifecycle.reviewEndsAt) {
        const reviewEndsAtMs = Date.parse(lifecycle.reviewEndsAt);
        if (Number.isFinite(reviewEndsAtMs) && reviewEndsAtMs <= Date.now()) {
            return {
                allowed: false,
                reason: copy.reviewWindowExpired,
            };
        }
    }

    if (
        !lifecycle.stableSnapshot
        || !Number.isInteger(Number(lifecycle.stableSnapshot.draftVersion))
        || Number(lifecycle.stableSnapshot.draftVersion) <= 0
        || !lifecycle.stableSnapshot.contentHash
    ) {
        return {
            allowed: false,
            reason: copy.stableSnapshotRequired,
        };
    }

    if (!workflowAllowed) {
        return {
            allowed: false,
            reason: workflowReason,
        };
    }

    return {
        allowed: true,
        reason: null,
    };
}
