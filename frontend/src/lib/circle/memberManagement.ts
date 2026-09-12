import type { InvitableUser } from '@/components/circle/InviteMemberSheet/InviteMemberSheet';

type CircleRoleLike = 'Owner' | 'Admin' | 'Moderator' | 'Member' | string;
type CircleStatusLike = 'Active' | 'Left' | 'Banned' | string;

interface CircleMemberLike {
    circleAlias?: string | null;
    effectiveDisplayName?: string | null;
    globalHandle?: string | null;
    user?: {
        id?: number | null;
        handle?: string | null;
        displayName?: string | null;
        pubkey?: string | null;
    } | null;
    role?: CircleRoleLike | null;
    status?: CircleStatusLike | null;
}

interface DirectoryUserLike {
    id?: number | null;
    handle?: string | null;
    displayName?: string | null;
}

export function shouldSearchGlobalInviteDirectory(input: {
    targetKind?: string | null;
    targetParentCircleId?: number | null;
}): boolean {
    // Main circles own independent membership even when they sit below another
    // main circle. Auxiliary circles keep the parent-member invite pool.
    return String(input.targetKind || '').trim().toLowerCase() !== 'auxiliary';
}

export function resolveInviteSourceCircleId(input: {
    targetCircleId: number;
    targetKind?: string | null;
    targetParentCircleId?: number | null;
}): number {
    if (String(input.targetKind || '').trim().toLowerCase() === 'auxiliary') {
        const parentId = Number(input.targetParentCircleId);
        if (Number.isFinite(parentId) && parentId > 0) {
            return parentId;
        }
    }
    return input.targetCircleId;
}

export function buildInvitableUsers(input: {
    sourceMembers: CircleMemberLike[];
    targetMembers: CircleMemberLike[];
}): InvitableUser[] {
    const sourceMembers = input.sourceMembers.filter((member) => member?.status === 'Active');
    const targetMembers = input.targetMembers.filter((member) => member?.status === 'Active');

    const targetPubkeys = new Set(
        targetMembers
            .map((member) => member.user?.pubkey)
            .filter((value): value is string => typeof value === 'string' && value.length > 0),
    );
    const targetHandles = new Set(
        targetMembers
            .map((member) => member.user?.handle)
            .filter((value): value is string => typeof value === 'string' && value.length > 0),
    );

    const usersByKey = new Map<string, InvitableUser>();
    for (const member of sourceMembers) {
        const handle = String(member.globalHandle || member.user?.handle || '').trim();
        const displayName = String(
            member.effectiveDisplayName
            || member.circleAlias
            || member.user?.displayName
            || handle
            || 'A member',
        );
        const key = String(member.user?.pubkey || handle || displayName).trim();
        if (!key || usersByKey.has(key)) continue;

        const alreadyIn = (
            Boolean(member.user?.pubkey && targetPubkeys.has(member.user.pubkey))
            || Boolean(handle && targetHandles.has(handle))
        );

        usersByKey.set(key, {
            userId: typeof member.user?.id === 'number' ? member.user.id : undefined,
            handle: handle || displayName,
            name: displayName,
            role: member.role === 'Admin' || member.role === 'Moderator' ? 'curator' : 'member',
            alreadyIn,
        });
    }

    return Array.from(usersByKey.values()).sort((left, right) => left.name.localeCompare(right.name));
}

export function buildDirectoryInvitableUsers(input: {
    directoryUsers: DirectoryUserLike[];
    targetMembers: CircleMemberLike[];
}): InvitableUser[] {
    const activeTargetMembers = input.targetMembers.filter((member) => member?.status === 'Active');
    const targetUserIds = new Set(
        activeTargetMembers
            .map((member) => member.user?.id)
            .filter((value): value is number => typeof value === 'number' && value > 0),
    );
    const targetHandles = new Set(
        activeTargetMembers
            .map((member) => String(member.user?.handle || '').trim().toLowerCase())
            .filter(Boolean),
    );

    const usersByHandle = new Map<string, InvitableUser>();
    for (const user of input.directoryUsers) {
        const handle = String(user.handle || '').trim();
        const normalizedHandle = handle.toLowerCase();
        if (!handle || usersByHandle.has(normalizedHandle)) continue;

        const userId = typeof user.id === 'number' && user.id > 0 ? user.id : undefined;
        usersByHandle.set(normalizedHandle, {
            userId,
            handle,
            name: String(user.displayName || handle).trim() || handle,
            role: 'member',
            alreadyIn: Boolean(
                (userId && targetUserIds.has(userId))
                || targetHandles.has(normalizedHandle),
            ),
        });
    }

    return Array.from(usersByHandle.values()).sort((left, right) => left.name.localeCompare(right.name));
}

export function resolveCircleSettingsActionFlags(currentUserRole: 'owner' | 'curator' | 'member'): {
    canManageRoles: boolean;
    canInvite: boolean;
    canLeave: boolean;
} {
    return {
        canManageRoles: currentUserRole === 'owner',
        canInvite: currentUserRole === 'owner' || currentUserRole === 'curator',
        canLeave: currentUserRole !== 'owner',
    };
}
