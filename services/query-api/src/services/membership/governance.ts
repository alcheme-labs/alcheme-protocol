import { MemberRole } from '@prisma/client';

import { CIRCLE_MEMBER_REMOVE_ACTION_TYPE } from '../governance/actionRegistry';
import { hashCanonicalGovernanceValue } from '../governance/canonicalCodec';
import { createGovernanceCaseIntake } from '../governance/governanceCase';

const MEMBER_REMOVAL_APPEAL_WINDOW_SECONDS = 72 * 60 * 60;

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

export async function createCircleMemberRemovalGovernanceCase(
    prisma: any,
    input: {
        circleId: number;
        actorPubkey: string;
        actorRole: string;
        targetMembership: {
            id: number;
            userId: number;
            role: MemberRole;
            status: string;
            membershipAccount: string;
            userPubkey: string;
            lastSyncedSlot: bigint | number | string;
        };
        publicReason: unknown;
        now?: Date;
    },
) {
    const publicReason = String(input.publicReason ?? '').trim();
    if (publicReason.length < 10 || publicReason.length > 500) {
        throw new Error('circle_member_removal_reason_required');
    }
    const now = input.now ?? new Date();
    const appealDeadline = new Date(
        now.getTime() + MEMBER_REMOVAL_APPEAL_WINDOW_SECONDS * 1_000,
    );
    const evidenceFacts = {
        source: 'current_circle_membership',
        circleId: input.circleId,
        membershipId: input.targetMembership.id,
        targetUserId: input.targetMembership.userId,
        membershipAccount: input.targetMembership.membershipAccount,
        targetPubkey: input.targetMembership.userPubkey,
        targetRole: input.targetMembership.role,
        targetStatus: input.targetMembership.status,
        lastSyncedSlot: String(input.targetMembership.lastSyncedSlot),
    };
    const evidenceDigest = hashCanonicalGovernanceValue(
        'alcheme.governance.circle-member-removal-evidence',
        evidenceFacts,
    );
    const requestedActionPayload = {
        kind: 'circle_member_removal',
        actionType: CIRCLE_MEMBER_REMOVE_ACTION_TYPE,
        impact: 'permanent_member_removal',
        circleId: input.circleId,
        targetUserId: input.targetMembership.userId,
        targetPubkey: input.targetMembership.userPubkey,
        targetRole: input.targetMembership.role,
        publicReason,
        evidence: {
            source: evidenceFacts.source,
            digest: evidenceDigest,
        },
        respondent: {
            pubkey: input.targetMembership.userPubkey,
            role: 'respondent_appellant',
            notice: 'minimum_required',
        },
        appeal: {
            windowSeconds: MEMBER_REMOVAL_APPEAL_WINDOW_SECONDS,
            deadline: appealDeadline.toISOString(),
            effectBeforeDeadline: 'forbidden',
        },
        reporter: {
            source: 'authenticated_circle_owner',
            visibility: 'institutional_actor',
        },
        execution: {
            status: 'blocked_pending_accepted_decision_and_appeal_window',
            walletFinalization: 'required_after_acceptance',
            providerFinality: 'not_available',
        },
    };
    return createGovernanceCaseIntake(prisma, {
        circleId: input.circleId,
        title: `Review permanent removal of Circle member ${input.targetMembership.userId}`,
        requestedDecision: 'Should this Circle permanently remove the affected member after the protected response and appeal window?',
        requestedActionPayload,
        caseType: 'policy',
        templateId: 'basic-community',
        actionType: CIRCLE_MEMBER_REMOVE_ACTION_TYPE,
        subjectType: 'circle',
        subjectRef: String(input.circleId),
        decisionMechanismKind: 'equal_weight_threshold',
        originKind: 'manual_item',
        sourceMessageIds: [],
        idempotencyKey: `member-removal:${input.circleId}:${input.targetMembership.id}:${String(input.targetMembership.lastSyncedSlot)}`,
        openedByPubkey: input.actorPubkey,
        actorRole: input.actorRole,
        openedAt: now,
    });
}
