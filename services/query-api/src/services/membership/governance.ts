import { MemberRole } from '@prisma/client';

export interface GovernanceDecision {
    allowed: boolean;
    statusCode: number;
    error: string;
    message: string;
}

interface BaseGovernanceInput {
    actorUserId: number;
    targetUserId: number;
    actorIsOwner: boolean;
    targetRole: MemberRole;
}

interface ValidateRoleChangeInput extends BaseGovernanceInput {
    nextRole: MemberRole;
}

function deny(statusCode: number, error: string, message: string): GovernanceDecision {
    return {
        allowed: false,
        statusCode,
        error,
        message,
    };
}

export function normalizeManagedMemberRole(raw: unknown): MemberRole | null {
    const normalized = String(raw || '').trim().toLowerCase();
    if (!normalized) return null;
    if (normalized === 'member') return MemberRole.Member;
    if (normalized === 'moderator' || normalized === 'curator') return MemberRole.Moderator;
    return null;
}

export function validateCircleMemberRoleChange(input: ValidateRoleChangeInput): GovernanceDecision {
    if (!input.actorIsOwner) {
        return deny(403, 'forbidden', 'only circle owners can change member roles');
    }
    if (input.actorUserId === input.targetUserId) {
        return deny(400, 'self_role_change_not_supported', 'use a dedicated owner transfer flow to change your own role');
    }
    if (input.targetRole === MemberRole.Owner || input.targetRole === MemberRole.Admin) {
        return deny(403, 'protected_member_role', 'owner or admin roles are not mutable in this flow');
    }
    if (input.nextRole !== MemberRole.Member && input.nextRole !== MemberRole.Moderator) {
        return deny(400, 'invalid_target_role', 'only member or moderator roles are supported');
    }
    return {
        allowed: true,
        statusCode: 200,
        error: 'ok',
        message: 'ok',
    };
}

export function validateCircleMemberRemoval(input: BaseGovernanceInput): GovernanceDecision {
    if (!input.actorIsOwner) {
        return deny(403, 'forbidden', 'only circle owners can remove members');
    }
    if (input.actorUserId === input.targetUserId) {
        return deny(400, 'self_removal_not_supported', 'use the leave-circle flow to leave a circle');
    }
    if (input.targetRole === MemberRole.Owner || input.targetRole === MemberRole.Admin) {
        return deny(403, 'protected_member_role', 'owner or admin roles are not removable in this flow');
    }
    return {
        allowed: true,
        statusCode: 200,
        error: 'ok',
        message: 'ok',
    };
}
