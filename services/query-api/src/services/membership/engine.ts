import {
    CircleType,
    IdentityLevel,
    JoinRequirement,
    MemberRole,
    MemberStatus,
    type PrismaClient,
    type Prisma,
} from '@prisma/client';
import { resolveOwnedCrystalCount } from '../crystalEntitlements/runtime';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export interface CircleJoinPolicy {
    joinRequirement: JoinRequirement;
    circleType: CircleType;
    minCrystals: number;
}

export type MembershipJoinState =
    | 'joined'
    | 'can_join'
    | 'approval_required'
    | 'invite_required'
    | 'insufficient_crystals'
    | 'pending'
    | 'banned'
    | 'left'
    | 'guest';

export interface MembershipJoinDecision {
    state: MembershipJoinState;
    requiresApproval: boolean;
    requiresInvite: boolean;
    minCrystals: number;
    userCrystals: number;
    missingCrystals: number;
}

export function resolveCircleJoinPolicy(input: {
    joinRequirement: JoinRequirement;
    circleType: CircleType;
    minCrystals?: number | null;
}): CircleJoinPolicy {
    const parsedMinCrystals = Number(input.minCrystals ?? 0);
    const rawMinCrystals = Number.isFinite(parsedMinCrystals)
        ? Math.max(0, Math.floor(parsedMinCrystals))
        : 0;
    return {
        joinRequirement: input.joinRequirement,
        circleType: input.circleType,
        minCrystals: input.joinRequirement === JoinRequirement.TokenGated
            ? Math.max(1, rawMinCrystals)
            : rawMinCrystals,
    };
}

export function evaluateMembershipJoinDecision(input: {
    policy: CircleJoinPolicy;
    userCrystals: number;
    hasActiveMembership: boolean;
    hasPendingRequest: boolean;
    isBanned: boolean;
    hasValidInvite: boolean;
}): MembershipJoinDecision {
    const userCrystals = Math.max(0, Math.floor(input.userCrystals));
    const minCrystals = Math.max(0, input.policy.minCrystals);
    const requiresTokenGate = input.policy.joinRequirement === JoinRequirement.TokenGated || minCrystals > 0;
    const requiresInvite = input.policy.joinRequirement === JoinRequirement.InviteOnly || input.policy.circleType === CircleType.Secret;
    const requiresApproval =
        input.policy.joinRequirement === JoinRequirement.ApprovalRequired || input.policy.circleType === CircleType.Closed;
    const missingCrystals = Math.max(0, minCrystals - userCrystals);

    if (input.hasActiveMembership) {
        return {
            state: 'joined',
            requiresApproval,
            requiresInvite,
            minCrystals,
            userCrystals,
            missingCrystals,
        };
    }

    if (input.isBanned) {
        return {
            state: 'banned',
            requiresApproval,
            requiresInvite,
            minCrystals,
            userCrystals,
            missingCrystals,
        };
    }

    if (input.hasPendingRequest) {
        return {
            state: 'pending',
            requiresApproval,
            requiresInvite,
            minCrystals,
            userCrystals,
            missingCrystals,
        };
    }

    if (requiresInvite && !input.hasValidInvite) {
        return {
            state: 'invite_required',
            requiresApproval,
            requiresInvite,
            minCrystals,
            userCrystals,
            missingCrystals,
        };
    }

    if (requiresTokenGate && missingCrystals > 0) {
        return {
            state: 'insufficient_crystals',
            requiresApproval,
            requiresInvite,
            minCrystals,
            userCrystals,
            missingCrystals,
        };
    }

    if (requiresApproval && !input.hasValidInvite) {
        return {
            state: 'approval_required',
            requiresApproval,
            requiresInvite,
            minCrystals,
            userCrystals,
            missingCrystals,
        };
    }

    return {
        state: 'can_join',
        requiresApproval,
        requiresInvite,
        minCrystals,
        userCrystals,
        missingCrystals,
    };
}

export async function resolveUserCrystalBalance(
    prisma: PrismaLike,
    userId: number,
    circleId?: number | null,
): Promise<number> {
    return resolveOwnedCrystalCount(prisma, {
        userId,
        circleId,
    });
}

export async function refreshCircleMemberCount(prisma: PrismaLike, circleId: number): Promise<number> {
    const count = await prisma.circleMember.count({
        where: {
            circleId,
            status: MemberStatus.Active,
        },
    });
    await prisma.circle.update({
        where: { id: circleId },
        data: { membersCount: count },
    });
    return count;
}

export async function refreshUserCircleCount(prisma: PrismaLike, userId: number): Promise<number> {
    const count = await prisma.circleMember.count({
        where: {
            userId,
            status: MemberStatus.Active,
        },
    });
    await prisma.user.update({
        where: { id: userId },
        data: { circlesCount: count },
    });
    return count;
}

export function buildOffchainCircleMemberAddress(circleId: number, userId: number): string {
    return `offcm:${circleId}:${userId}`;
}

export async function activateCircleMembership(
    prisma: PrismaLike,
    input: {
        circleId: number;
        userId: number;
        preferredRole?: MemberRole;
    },
) {
    const existing = await prisma.circleMember.findUnique({
        where: {
            circleId_userId: {
                circleId: input.circleId,
                userId: input.userId,
            },
        },
    });

    if (existing) {
        return prisma.circleMember.update({
            where: { id: existing.id },
            data: {
                status: MemberStatus.Active,
                role: existing.role === MemberRole.Owner || existing.role === MemberRole.Admin
                    ? existing.role
                    : (input.preferredRole || MemberRole.Member),
                identityLevel: existing.identityLevel === IdentityLevel.Visitor
                    ? IdentityLevel.Initiate
                    : existing.identityLevel,
            },
        });
    }

    return prisma.circleMember.create({
        data: {
            circleId: input.circleId,
            userId: input.userId,
            role: input.preferredRole || MemberRole.Member,
            status: MemberStatus.Active,
            identityLevel: IdentityLevel.Initiate,
            onChainAddress: buildOffchainCircleMemberAddress(input.circleId, input.userId),
            lastSyncedSlot: BigInt(0),
        },
    });
}
