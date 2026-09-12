import type {
    CircleIdentityStatus,
    CircleMembershipSnapshot,
    CircleMembershipView,
} from '@/lib/api/circlesMembership';
import type { ViewerIdentityState } from './identityTypes';

export function resolveActiveMembershipSnapshot(input: {
    routeCircleId: number;
    activeCircleId: number;
    routeSnapshot: CircleMembershipSnapshot | null;
    activeTierSnapshot: CircleMembershipSnapshot | null;
}): CircleMembershipSnapshot | null {
    const { routeCircleId, activeCircleId, routeSnapshot, activeTierSnapshot } = input;
    if (activeCircleId !== routeCircleId) {
        return activeTierSnapshot;
    }
    return routeSnapshot;
}

export function resolveActiveIdentityStatus(input: {
    routeCircleId: number;
    activeCircleId: number;
    routeStatus: CircleIdentityStatus | null;
    activeTierStatus: CircleIdentityStatus | null;
}): CircleIdentityStatus | null {
    const { routeCircleId, activeCircleId, routeStatus, activeTierStatus } = input;
    if (activeCircleId !== routeCircleId) {
        return activeTierStatus;
    }
    return routeStatus;
}

export function deriveCreatorFallbackMembershipSnapshot(input: {
    snapshot: CircleMembershipSnapshot | null;
    circleId: number;
    circleCreatorId: number | null | undefined;
    circleCreatorPubkey?: string | null | undefined;
    circleCreatedAt: string | null | undefined;
    sessionUserId: number | null | undefined;
    walletPubkey?: string | null | undefined;
}): CircleMembershipSnapshot | null {
    const sessionMatchesCreator = (
        Number.isFinite(input.circleCreatorId ?? NaN)
        && Number.isFinite(input.sessionUserId ?? NaN)
        && input.circleCreatorId === input.sessionUserId
    );
    const walletMatchesCreator = (
        typeof input.circleCreatorPubkey === 'string'
        && input.circleCreatorPubkey.trim().length > 0
        && typeof input.walletPubkey === 'string'
        && input.walletPubkey.trim().length > 0
        && input.circleCreatorPubkey === input.walletPubkey
    );

    if (
        !Number.isFinite(input.circleId)
        || input.circleId <= 0
        || !input.circleCreatedAt
        || (!sessionMatchesCreator && !walletMatchesCreator)
    ) {
        return input.snapshot;
    }

    if (
        input.snapshot?.joinState === 'joined'
        && input.snapshot.membership?.status === 'Active'
        && input.snapshot.membership.role === 'Owner'
    ) {
        return input.snapshot;
    }

    return {
        authenticated: true,
        circleId: input.circleId,
        policy: input.snapshot?.policy ?? {
            joinRequirement: 'Free',
            circleType: 'Open',
            minCrystals: 0,
            requiresApproval: false,
            requiresInvite: false,
        },
        joinState: 'joined',
        membership: {
            role: 'Owner',
            status: 'Active',
            identityLevel: 'Member',
            joinedAt: input.circleCreatedAt,
        },
        userCrystals: input.snapshot?.userCrystals ?? 0,
        missingCrystals: 0,
    };
}

export function deriveIdentityStatusFallbackMembershipSnapshot(input: {
    snapshot: CircleMembershipSnapshot | null;
    status: CircleIdentityStatus | null;
    circleId: number;
    circleCreatedAt: string | null | undefined;
}): CircleMembershipSnapshot | null {
    if (!input.status?.authenticated) {
        return input.snapshot;
    }

    const indicatesFormalMembership = input.status.messagingMode === 'formal';

    if (!indicatesFormalMembership) {
        return input.snapshot;
    }

    const snapshotLooksStaleGuestShell = (
        !input.snapshot
        || input.snapshot.joinState === 'guest'
        || input.snapshot.joinState === 'can_join'
    );

    if (!snapshotLooksStaleGuestShell) {
        return input.snapshot;
    }

    return {
        authenticated: true,
        circleId: input.circleId,
        policy: {
            joinRequirement: 'Free',
            circleType: 'Open',
            minCrystals: 0,
            requiresApproval: false,
            requiresInvite: false,
        },
        joinState: 'joined',
        membership: {
            role: 'Member',
            status: 'Active',
            identityLevel: input.status.currentLevel,
            joinedAt: input.circleCreatedAt || '',
        },
        userCrystals: 0,
        missingCrystals: 0,
    };
}

export function deriveViewerCircleState(input: {
    snapshot: CircleMembershipSnapshot | null;
}): {
    joined: boolean;
    identityState: ViewerIdentityState;
    membership: CircleMembershipView | null;
    role: CircleMembershipView['role'] | null;
    contributionLevel: CircleMembershipView['identityLevel'] | null;
} {
    const membership = input.snapshot?.membership?.status === 'Active'
        ? input.snapshot.membership
        : null;

    if (!membership) {
        return {
            joined: input.snapshot?.joinState === 'joined',
            identityState: 'visitor',
            membership: null,
            role: null,
            contributionLevel: null,
        };
    }

    if (membership.role === 'Owner') {
        return {
            joined: true,
            identityState: 'owner',
            membership,
            role: membership.role,
            contributionLevel: membership.identityLevel,
        };
    }
    if (membership.role === 'Admin' || membership.role === 'Moderator') {
        return {
            joined: true,
            identityState: 'curator',
            membership,
            role: membership.role,
            contributionLevel: membership.identityLevel,
        };
    }
    if (membership.identityLevel === 'Initiate') {
        return {
            joined: true,
            identityState: 'initiate',
            membership,
            role: membership.role,
            contributionLevel: membership.identityLevel,
        };
    }
    if (membership.identityLevel === 'Visitor') {
        return {
            joined: true,
            identityState: 'visitor',
            membership,
            role: membership.role,
            contributionLevel: membership.identityLevel,
        };
    }
    return {
        joined: true,
        identityState: 'member',
        membership,
        role: membership.role,
        contributionLevel: membership.identityLevel,
    };
}

export function canManageCircleAgents(input: {
    snapshot: CircleMembershipSnapshot | null;
}): boolean {
    const membership = input.snapshot?.membership;
    if (!membership || membership.status !== 'Active') {
        return false;
    }

    return membership.role === 'Owner'
        || membership.role === 'Admin'
        || membership.role === 'Moderator';
}
