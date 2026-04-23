import type { InvitableUser } from '@/components/circle/InviteMemberSheet/InviteMemberSheet';

type CircleRoleLike = 'Owner' | 'Admin' | 'Moderator' | 'Member' | string;
type CircleStatusLike = 'Active' | 'Left' | 'Banned' | string;

interface CircleMemberLike {
    user?: {
        id?: number | null;
        handle?: string | null;
        displayName?: string | null;
        pubkey?: string | null;
    } | null;
    role?: CircleRoleLike | null;
    status?: CircleStatusLike | null;
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
        const handle = String(member.user?.handle || '').trim();
        const displayName = String(member.user?.displayName || handle || member.user?.pubkey?.slice(0, 8) || '?');
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
