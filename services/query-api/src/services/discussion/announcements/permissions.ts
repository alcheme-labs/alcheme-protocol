import type { CircleActor } from '../../auth/actor';

// Projection-only helper. Do not use this module to authorize a request from
// raw request fields; callers must pass an already resolved CircleActor.

export interface CircleAnnouncementRoleAccess {
    user: { id: number; pubkey: string; handle: string | null } | null;
    membership: { role: string | null; status: string | null } | null;
    isCreator: boolean;
    isActiveMember: boolean;
    canPublish: boolean;
    canManage: boolean;
}

export class CircleAnnouncementPermissionError extends Error {
    constructor(
        public readonly code: string,
        public readonly statusCode = 403,
        message = code,
    ) {
        super(message);
        this.name = 'CircleAnnouncementPermissionError';
    }
}

export async function resolveCircleAnnouncementRoleAccess(
    input: { circleId: number; actor: CircleActor },
): Promise<CircleAnnouncementRoleAccess> {
    if (input.actor.circle.id !== input.circleId) {
        throw new CircleAnnouncementPermissionError('announcement_not_found', 404);
    }
    const role = input.actor.membership.role;
    const status = input.actor.membership.status;
    const isCreator = input.actor.circle.creatorId === input.actor.userId;
    const isActiveMember = status === 'Active';
    const canPublish = isCreator || (isActiveMember && (role === 'Owner' || role === 'Admin' || role === 'Moderator'));
    const canManage = isCreator || (isActiveMember && (role === 'Owner' || role === 'Admin'));

    return {
        user: { id: input.actor.userId, pubkey: input.actor.pubkey, handle: input.actor.handle },
        membership: { role, status },
        isCreator,
        isActiveMember,
        canPublish,
        canManage,
    };
}

export async function requireCircleAnnouncementAuthorRole(
    input: { circleId: number; actor: CircleActor },
): Promise<CircleAnnouncementRoleAccess> {
    const access = await resolveCircleAnnouncementRoleAccess(input);
    if (!access.canPublish) {
        throw new CircleAnnouncementPermissionError('announcement_author_role_required', 403);
    }
    return access;
}

export async function requireCircleAnnouncementManagerRole(
    input: { circleId: number; actor: CircleActor },
): Promise<CircleAnnouncementRoleAccess> {
    const access = await resolveCircleAnnouncementRoleAccess(input);
    if (!access.canManage) {
        throw new CircleAnnouncementPermissionError('announcement_manager_role_required', 403);
    }
    return access;
}

export async function resolveCircleAnnouncementReadAccess(
    input: { circleId: number; actor: CircleActor },
): Promise<CircleAnnouncementRoleAccess> {
    const access = await resolveCircleAnnouncementRoleAccess(input);
    if (!access.isCreator && !access.isActiveMember) {
        throw new CircleAnnouncementPermissionError('announcement_membership_required', 403);
    }
    return access;
}
