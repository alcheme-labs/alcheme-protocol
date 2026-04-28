import type { PrismaClient, Prisma } from '@prisma/client';

import { getActiveCircleMembership } from '../membership/checks';
import type {
    CirclePolicyProfile,
    DraftWorkflowPolicySnapshot,
    GovernanceRole,
} from './types';
import { resolveCirclePolicyProfile } from './profile';
import {
    localizeDraftWorkflowPermissionReason,
    type DraftWorkflowPermissionReasonCode,
} from '../../i18n/copy';
import type { AppLocale } from '../../i18n/locale';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export type DraftWorkflowAction =
    | 'create_issue'
    | 'followup_issue'
    | 'withdraw_own_issue'
    | 'start_review'
    | 'retag_issue'
    | 'accept_reject_issue'
    | 'apply_accepted_issue'
    | 'end_drafting_early'
    | 'advance_from_review'
    | 'enter_crystallization';

export interface DraftWorkflowPermissionDecision {
    allowed: boolean;
    policy: DraftWorkflowPolicySnapshot;
    minRole: GovernanceRole | null;
    reasonCode: DraftWorkflowPermissionReasonCode;
    reason: string;
}

interface CircleActorSnapshot {
    isActive: boolean;
    isCreator: boolean;
    role: string | null;
    identityLevel: string | null;
}

function roleRank(role: GovernanceRole): number {
    if (role === 'Owner') return 6;
    if (role === 'Admin') return 5;
    if (role === 'Moderator') return 4;
    if (role === 'Elder') return 3;
    if (role === 'Member') return 2;
    return 1;
}

function actorRank(actor: CircleActorSnapshot): number {
    if (!actor.isActive && !actor.isCreator) return 0;
    if (actor.isCreator) return roleRank('Owner');
    if (actor.role === 'Owner') return roleRank('Owner');
    if (actor.role === 'Admin') return roleRank('Admin');
    if (actor.role === 'Moderator') return roleRank('Moderator');
    if (actor.identityLevel === 'Elder') return roleRank('Elder');
    if (actor.identityLevel === 'Member') return roleRank('Member');
    if (actor.identityLevel === 'Initiate') return roleRank('Initiate');
    return 0;
}

function reasonCodeForDeniedAction(action: DraftWorkflowAction): DraftWorkflowPermissionReasonCode {
    if (action === 'create_issue') {
        return 'role_required_create_issue';
    }
    if (action === 'followup_issue') {
        return 'role_required_followup_issue';
    }
    if (action === 'withdraw_own_issue') {
        return 'author_withdraw_disabled';
    }
    if (action === 'start_review' || action === 'accept_reject_issue') {
        return 'role_required_review_issue';
    }
    if (action === 'retag_issue') {
        return 'role_required_retag_issue';
    }
    if (action === 'apply_accepted_issue') {
        return 'role_required_apply_issue';
    }
    if (action === 'end_drafting_early') {
        return 'role_required_end_drafting_early';
    }
    if (action === 'advance_from_review') {
        return 'role_required_advance_from_review';
    }
    return 'role_required_enter_crystallization';
}

function buildDecision(input: {
    allowed: boolean;
    policy: DraftWorkflowPolicySnapshot;
    minRole: GovernanceRole | null;
    reasonCode: DraftWorkflowPermissionReasonCode;
}): DraftWorkflowPermissionDecision {
    return {
        ...input,
        reason: localizeDraftWorkflowPermissionReason({
            reasonCode: input.reasonCode,
            minRole: input.minRole,
        }, 'en'),
    };
}

async function loadActorSnapshot(
    prisma: PrismaLike,
    circleId: number,
    userId: number,
): Promise<CircleActorSnapshot> {
    const [circle, membership] = await Promise.all([
        prisma.circle.findUnique({
            where: { id: circleId },
            select: { creatorId: true },
        }),
        getActiveCircleMembership(prisma, {
            circleId,
            userId,
        }),
    ]);

    const isCreator = Boolean(circle && circle.creatorId === userId);
    return {
        isActive: isCreator || Boolean(membership),
        isCreator,
        role: membership?.role ? String(membership.role) : null,
        identityLevel: membership?.identityLevel ? String(membership.identityLevel) : null,
    };
}

function resolveMinRole(
    policy: DraftWorkflowPolicySnapshot,
    action: DraftWorkflowAction,
): GovernanceRole | null {
    if (action === 'create_issue') return policy.createIssueMinRole;
    if (action === 'followup_issue') return policy.followupIssueMinRole;
    if (action === 'start_review') return policy.reviewIssueMinRole;
    if (action === 'accept_reject_issue') return policy.reviewIssueMinRole;
    if (action === 'retag_issue') return policy.retagIssueMinRole;
    if (action === 'apply_accepted_issue') return policy.applyIssueMinRole;
    if (action === 'end_drafting_early') return policy.manualEndDraftingMinRole;
    if (action === 'advance_from_review') return policy.advanceFromReviewMinRole;
    if (action === 'enter_crystallization') return policy.enterCrystallizationMinRole;
    return null;
}

export async function resolveDraftWorkflowPermission(
    prisma: PrismaLike,
    input: {
        circleId: number;
        userId: number;
        action: DraftWorkflowAction;
        isThreadAuthor?: boolean;
    },
): Promise<DraftWorkflowPermissionDecision> {
    const profile = await resolveCirclePolicyProfile(prisma as PrismaClient, input.circleId);
    const policy = profile.draftWorkflowPolicy;
    const actor = await loadActorSnapshot(prisma, input.circleId, input.userId);

    if (!actor.isActive) {
        return {
            allowed: false,
            policy,
            minRole: null,
            reasonCode: 'inactive_member',
            reason: localizeDraftWorkflowPermissionReason({
                reasonCode: 'inactive_member',
                minRole: null,
            }, 'en'),
        };
    }

    if (input.action === 'withdraw_own_issue') {
        const allowed = Boolean(input.isThreadAuthor && policy.allowAuthorWithdrawBeforeReview);
        return buildDecision({
            allowed,
            policy,
            minRole: null,
            reasonCode: allowed ? 'ok' : 'author_withdraw_disabled',
        });
    }

    if (input.action === 'retag_issue' && !policy.allowModeratorRetagIssue) {
        return buildDecision({
            allowed: false,
            policy,
            minRole: policy.retagIssueMinRole,
            reasonCode: 'retag_disabled',
        });
    }

    const minRole = resolveMinRole(policy, input.action);
    const allowed = minRole ? actorRank(actor) >= roleRank(minRole) : false;
    return buildDecision({
        allowed,
        policy,
        minRole,
        reasonCode: allowed ? 'ok' : reasonCodeForDeniedAction(input.action),
    });
}

export function localizeDraftWorkflowPermissionDecision(
    decision: Pick<DraftWorkflowPermissionDecision, 'reasonCode' | 'minRole'>,
    locale: AppLocale,
): string {
    return localizeDraftWorkflowPermissionReason({
        reasonCode: decision.reasonCode,
        minRole: decision.minRole,
    }, locale);
}

export async function resolveCircleDraftWorkflowPolicy(
    prisma: PrismaLike,
    circleId: number,
): Promise<CirclePolicyProfile['draftWorkflowPolicy']> {
    const profile = await resolveCirclePolicyProfile(prisma as PrismaClient, circleId);
    return profile.draftWorkflowPolicy;
}
