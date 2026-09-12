import type { PrismaClient, Prisma } from '@prisma/client';

import { authorizeDraftActionForActor } from '../auth/actorPermissions';
import { getDraftDiscussionThread } from '../draftDiscussionLifecycle';
import {
    resolveDraftWorkflowPermission,
    type DraftWorkflowAction,
} from '../policy/draftWorkflowPermissions';
import type {
    IssueReviewAssistAction,
    IssueReviewAssistInput,
    IssueReviewAssistPermission,
    IssueReviewAssistReasonCode,
    IssueReviewAssistResult,
} from './types';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

const REVIEW_PERMISSION_ACTIONS: DraftWorkflowAction[] = [
    'start_review',
    'accept_reject_issue',
    'retag_issue',
];

function parsePositiveThreadId(value: number | string): number {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('invalid_thread_id');
    }
    return parsed;
}

function normalizeParagraphIndex(targetRef: string | null | undefined): number | null {
    const match = String(targetRef || '').trim().match(/^paragraph:(\d+)$/i);
    if (!match) return null;
    const parsed = Number.parseInt(match[1], 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function splitParagraphs(text: string): string[] {
    return String(text || '')
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean);
}

async function isTargetChanged(
    prisma: PrismaLike,
    input: {
        draftPostId: number;
        targetType: string | null;
        targetRef: string | null;
    },
): Promise<boolean> {
    if (input.targetType !== 'paragraph') return false;
    const paragraphIndex = normalizeParagraphIndex(input.targetRef);
    if (paragraphIndex === null) return true;

    const post = await prisma.post.findUnique({
        where: { id: input.draftPostId },
        select: { text: true },
    });
    const paragraphs = splitParagraphs(String(post?.text || ''));
    return paragraphIndex >= paragraphs.length;
}

function toPermissionSnapshot(
    action: DraftWorkflowAction,
    decision: Awaited<ReturnType<typeof resolveDraftWorkflowPermission>>,
): IssueReviewAssistPermission {
    return {
        action,
        allowed: Boolean(decision.allowed),
        reasonCode: String(decision.reasonCode || 'unknown'),
        reason: String(decision.reason || decision.reasonCode || 'unknown'),
        minRole: decision.minRole ? String(decision.minRole) : null,
    };
}

function hasPermission(permissions: IssueReviewAssistPermission[], action: DraftWorkflowAction): boolean {
    return Boolean(permissions.find((permission) => permission.action === action && permission.allowed));
}

function firstDeniedReason(permissions: IssueReviewAssistPermission[]): string {
    const denied = permissions.find((permission) => !permission.allowed && permission.reason);
    return denied?.reason || 'No review action is available for your current role.';
}

function chooseOpenAction(input: {
    issueType: string | null;
    targetChanged: boolean;
    canStartReview: boolean;
    canRetag: boolean;
}): { action: IssueReviewAssistAction; reasonCode: IssueReviewAssistReasonCode; reason: string; actionable: boolean } {
    if (input.targetChanged) {
        if (input.canRetag) {
            return {
                action: 'suggest_retag',
                reasonCode: 'target_changed',
                reason: 'The target appears to have changed. Suggest retagging or manual handling.',
                actionable: true,
            };
        }
        return {
            action: 'unable_to_judge',
            reasonCode: 'target_changed',
            reason: 'The target appears to have changed and needs manual handling.',
            actionable: false,
        };
    }
    if (!input.canStartReview && !input.canRetag) {
        return {
            action: 'unable_to_judge',
            reasonCode: 'permission_required',
            reason: 'You do not have a review action available for this issue.',
            actionable: false,
        };
    }
    if (input.issueType === 'question_and_supplement') {
        return {
            action: 'request_clarification',
            reasonCode: 'ok',
            reason: 'This open issue should be clarified before a final review decision.',
            actionable: true,
        };
    }
    return {
        action: 'propose_acceptance',
        reasonCode: 'ok',
        reason: 'This open issue can be turned into a proposed review decision.',
        actionable: true,
    };
}

function chooseProposedAction(input: {
    targetChanged: boolean;
    canAcceptReject: boolean;
}): { action: IssueReviewAssistAction; reasonCode: IssueReviewAssistReasonCode; reason: string; actionable: boolean } {
    if (!input.canAcceptReject) {
        return {
            action: 'unable_to_judge',
            reasonCode: 'permission_required',
            reason: 'You do not have permission to accept or reject proposed issue handling.',
            actionable: false,
        };
    }
    if (input.targetChanged) {
        return {
            action: 'reject_proposal',
            reasonCode: 'target_changed',
            reason: 'The target appears to have changed, so the proposed handling should be rejected or revised.',
            actionable: true,
        };
    }
    return {
        action: 'accept_proposal',
        reasonCode: 'ok',
        reason: 'This proposed issue handling can be accepted if the reviewer agrees.',
        actionable: true,
    };
}

export async function buildIssueReviewAssist(
    prisma: PrismaLike,
    input: IssueReviewAssistInput,
): Promise<IssueReviewAssistResult> {
    const threadId = parsePositiveThreadId(input.threadId);
    const readAccess = await authorizeDraftActionForActor(prisma as PrismaClient, {
        actor: input.actor,
        postId: input.draftPostId,
        action: 'read',
    });
    if (!readAccess.allowed) {
        return {
            draftPostId: input.draftPostId,
            threadId: String(threadId),
            threadState: null,
            targetType: null,
            targetRef: null,
            issueType: null,
            action: 'unable_to_judge',
            actionable: false,
            reasonCode: 'read_access_denied',
            reason: readAccess.message || readAccess.error || 'Read access is required.',
            permissions: [],
        };
    }
    if (!readAccess.post?.circleId || !readAccess.circleActor) {
        return {
            draftPostId: input.draftPostId,
            threadId: String(threadId),
            threadState: null,
            targetType: null,
            targetRef: null,
            issueType: null,
            action: 'unable_to_judge',
            actionable: false,
            reasonCode: 'circle_context_missing',
            reason: 'Circle governance context is required for review assistance.',
            permissions: [],
        };
    }

    const thread = await getDraftDiscussionThread(prisma as PrismaClient, {
        draftPostId: input.draftPostId,
        threadId,
    });
    const permissions = await Promise.all(
        REVIEW_PERMISSION_ACTIONS.map(async (action) => toPermissionSnapshot(
            action,
            await resolveDraftWorkflowPermission(prisma, {
                circleId: Number(readAccess.post?.circleId),
                actor: readAccess.circleActor!,
                action,
                isThreadAuthor: Number(thread.createdBy) === Number(input.actor.userId),
            }),
        )),
    );

    const targetChanged = await isTargetChanged(prisma, {
        draftPostId: input.draftPostId,
        targetType: thread.targetType,
        targetRef: thread.targetRef,
    });
    const canStartReview = hasPermission(permissions, 'start_review');
    const canAcceptReject = hasPermission(permissions, 'accept_reject_issue');
    const canRetag = hasPermission(permissions, 'retag_issue');
    const hasAnyReviewAction = canStartReview || canAcceptReject || canRetag;

    let decision: {
        action: IssueReviewAssistAction;
        reasonCode: IssueReviewAssistReasonCode;
        reason: string;
        actionable: boolean;
    };
    if (!hasAnyReviewAction) {
        decision = {
            action: 'unable_to_judge',
            reasonCode: 'permission_required',
            reason: firstDeniedReason(permissions),
            actionable: false,
        };
    } else if (thread.state === 'open') {
        decision = chooseOpenAction({
            issueType: thread.issueType,
            targetChanged,
            canStartReview,
            canRetag,
        });
    } else if (thread.state === 'proposed') {
        decision = chooseProposedAction({
            targetChanged,
            canAcceptReject,
        });
    } else {
        decision = {
            action: 'unable_to_judge',
            reasonCode: 'unsupported_state',
            reason: `Issue review assist only handles open or proposed issues, not ${thread.state}.`,
            actionable: false,
        };
    }

    return {
        draftPostId: input.draftPostId,
        threadId: thread.id,
        threadState: thread.state,
        targetType: thread.targetType,
        targetRef: thread.targetRef,
        issueType: thread.issueType,
        action: decision.action,
        actionable: Boolean(decision.actionable),
        reasonCode: decision.reasonCode,
        reason: decision.reason,
        permissions,
    };
}
