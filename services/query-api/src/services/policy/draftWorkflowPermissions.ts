import type { PrismaClient, Prisma } from '@prisma/client';

import { getActiveCircleMembership } from '../membership/checks';
import type {
    CirclePolicyProfile,
    DraftWorkflowPolicySnapshot,
    GovernanceRole,
} from './types';
import { resolveCirclePolicyProfile } from './profile';

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

function formatRoleLabel(role: GovernanceRole): string {
    if (role === 'Owner') return '圈主';
    if (role === 'Admin') return '管理员';
    if (role === 'Moderator') return '主持人';
    if (role === 'Elder') return '长老';
    if (role === 'Member') return '成员';
    return '初始成员';
}

function buildDeniedReason(action: DraftWorkflowAction, minRole: GovernanceRole | null): string {
    const roleLabel = minRole ? formatRoleLabel(minRole) : '更高权限';
    if (action === 'create_issue') {
        return `当前圈层策略要求至少 ${roleLabel} 才能提交问题单。`;
    }
    if (action === 'followup_issue') {
        return `当前圈层策略要求至少 ${roleLabel} 才能继续追加问题单。`;
    }
    if (action === 'withdraw_own_issue') {
        return '当前圈层策略不允许在进入审议前撤回自己的问题单。';
    }
    if (action === 'start_review' || action === 'accept_reject_issue') {
        return `当前圈层策略要求至少 ${roleLabel} 才能发起或处理问题单审议。`;
    }
    if (action === 'retag_issue') {
        return `当前圈层策略要求至少 ${roleLabel} 才能调整问题类型。`;
    }
    if (action === 'apply_accepted_issue') {
        return `当前圈层策略要求至少 ${roleLabel} 才能确认问题已写入正文。`;
    }
    if (action === 'end_drafting_early') {
        return `当前圈层策略要求至少 ${roleLabel} 才能提前结束编辑并进入审阅。`;
    }
    if (action === 'advance_from_review') {
        return `当前圈层策略要求至少 ${roleLabel} 才能结束本轮审阅并进入下一轮修订。`;
    }
    return `当前圈层策略要求至少 ${roleLabel} 才能发起结晶。`;
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
            reason: '只有活跃圈层成员才能执行这个动作。',
        };
    }

    if (input.action === 'withdraw_own_issue') {
        const allowed = Boolean(input.isThreadAuthor && policy.allowAuthorWithdrawBeforeReview);
        return {
            allowed,
            policy,
            minRole: null,
            reason: allowed
                ? 'ok'
                : buildDeniedReason(input.action, null),
        };
    }

    if (input.action === 'retag_issue' && !policy.allowModeratorRetagIssue) {
        return {
            allowed: false,
            policy,
            minRole: policy.retagIssueMinRole,
            reason: '当前圈层策略暂不允许在审议过程中调整问题类型。',
        };
    }

    const minRole = resolveMinRole(policy, input.action);
    const allowed = minRole ? actorRank(actor) >= roleRank(minRole) : false;
    return {
        allowed,
        policy,
        minRole,
        reason: allowed ? 'ok' : buildDeniedReason(input.action, minRole),
    };
}

export async function resolveCircleDraftWorkflowPolicy(
    prisma: PrismaLike,
    circleId: number,
): Promise<CirclePolicyProfile['draftWorkflowPolicy']> {
    const profile = await resolveCirclePolicyProfile(prisma as PrismaClient, circleId);
    return profile.draftWorkflowPolicy;
}
