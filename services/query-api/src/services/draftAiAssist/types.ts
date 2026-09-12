import type { AuthActor } from '../auth/actor';
import type { DraftDiscussionState, DraftDiscussionTargetType, DraftDiscussionIssueType } from '../draftDiscussionLifecycle';
import type { DraftWorkflowAction } from '../policy/draftWorkflowPermissions';
import type { AppLocale } from '../../i18n/locale';

export type IssueReviewAssistAction =
    | 'propose_acceptance'
    | 'propose_rejection'
    | 'request_clarification'
    | 'suggest_retag'
    | 'accept_proposal'
    | 'reject_proposal'
    | 'unable_to_judge';

export type IssueReviewAssistReasonCode =
    | 'ok'
    | 'read_access_denied'
    | 'circle_context_missing'
    | 'permission_required'
    | 'unsupported_state'
    | 'target_changed'
    | 'unable_to_judge';

export interface IssueReviewAssistInput {
    draftPostId: number;
    threadId: number | string;
    actor: AuthActor;
    locale?: AppLocale;
}

export interface IssueReviewAssistPermission {
    action: DraftWorkflowAction;
    allowed: boolean;
    reasonCode: string;
    reason: string;
    minRole: string | null;
}

export interface IssueReviewAssistResult {
    draftPostId: number;
    threadId: string;
    threadState: DraftDiscussionState | null;
    targetType: DraftDiscussionTargetType | null;
    targetRef: string | null;
    issueType: DraftDiscussionIssueType | null;
    action: IssueReviewAssistAction;
    actionable: boolean;
    reasonCode: IssueReviewAssistReasonCode;
    reason: string;
    permissions: IssueReviewAssistPermission[];
}

export type AcceptedIssueRevisionManualReasonCode =
    | 'read_access_denied'
    | 'circle_context_missing'
    | 'not_drafting'
    | 'no_accepted_issues'
    | 'requires_manual_handling';

export interface AcceptedIssueRevisionGenerateInput {
    draftPostId: number;
    requestedByUserId: number;
    actor: AuthActor;
    targetRef?: string | null;
    threadIds?: Array<number | string> | null;
    workingCopyHash?: string | null;
    workingCopyUpdatedAt?: string | Date | null;
    seededReference?: {
        path: string;
        line: number;
    } | null;
    sourceMaterialIds?: number[] | null;
}

export interface AcceptedIssueRevisionManualResult {
    status: 'manual_handling';
    draftPostId: number;
    generationId: null;
    reasonCode: AcceptedIssueRevisionManualReasonCode;
    reason: string;
    targetType: DraftDiscussionTargetType | null;
    targetRef: string | null;
    threadIds: string[];
}

export interface AcceptedIssueRevisionGeneratedResult {
    status: 'generated';
    draftPostId: number;
    generationId: number;
    model: string;
    promptAsset: 'accepted-issue-revision';
    promptVersion: string;
    targetRef: string;
    threadIds: string[];
}

export type AcceptedIssueRevisionGenerateResult =
    | AcceptedIssueRevisionGeneratedResult
    | AcceptedIssueRevisionManualResult;

export interface AcceptedIssueRevisionApplyInput {
    draftPostId: number;
    generationId: number;
    suggestionId: string;
    actor: AuthActor;
    locale?: AppLocale;
    workingCopyHash?: string | null;
    workingCopyUpdatedAt?: string | Date | null;
}
