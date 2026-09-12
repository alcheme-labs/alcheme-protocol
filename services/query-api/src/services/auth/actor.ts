import type { PrismaClient } from '@prisma/client';

import {
    verifyCircleAccountAddress,
    verifyCircleMemberAccountAddress,
    verifyIdentityAccount,
    type ChainAccountVerification,
    type ChainPresenceReason,
    type IdentityAccountVerification,
} from '../chain/accountPresence';

export type AuthSource = 'session_cookie' | 'legacy_bearer';
export type CircleRole = 'Owner' | 'Admin' | 'Moderator' | 'Member';
export type CircleAction =
    | 'circle.read'
    | 'discussion.write'
    | 'discussion.admin'
    | 'draft.read'
    | 'draft.write'
    | 'source.read'
    | 'source.review'
    | 'circle.manage'
    | 'circle.owner'
    | 'communication.room'
    | 'public.read';

export interface AuthActor {
    userId: number;
    pubkey: string;
    handle: string;
    displayName: string | null;
    sessionId: string | null;
    authSource: AuthSource;
    identity: {
        handle: string;
        identityPubkey: string;
        accountAddress: string;
        presence: 'verified';
    };
}

export interface CircleActor extends AuthActor {
    circle: {
        id: number;
        onChainAddress: string;
        chainPresence: 'verified';
        creatorId: number;
    };
    membership: {
        role: CircleRole;
        status: 'Active';
        identityLevel: string;
        source: 'circle_creator' | 'member_pda';
        chainPresence: 'verified' | 'creator_in_circle_projection';
    };
}

export class AuthActorError extends Error {
    constructor(
        public readonly statusCode: number,
        public readonly code: string,
        message: string,
        public readonly reason: string,
        public readonly recoverable = true,
    ) {
        super(message);
    }

    toResponseBody(): {
        error: string;
        message: string;
        reason: string;
        recoverable: boolean;
    } {
        return {
            error: this.code,
            message: this.message,
            reason: this.reason,
            recoverable: this.recoverable,
        };
    }
}

const AUTH_USER_SELECT = {
    id: true,
    pubkey: true,
    handle: true,
    displayName: true,
} as const;

const CIRCLE_SELECT = {
    id: true,
    creatorId: true,
    onChainAddress: true,
} as const;

const MEMBER_SELECT = {
    role: true,
    status: true,
    identityLevel: true,
    onChainAddress: true,
} as const;

const ROLE_RANK: Record<CircleRole, number> = {
    Owner: 4,
    Admin: 3,
    Moderator: 2,
    Member: 1,
};

function parsePositiveInt(value: unknown): number | null {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.trunc(parsed);
}

function authSourceFromRequest(req: any): AuthSource | null {
    if (req?.authSource === 'session_cookie') return 'session_cookie';
    if (req?.authSource === 'legacy_bearer') return 'legacy_bearer';
    if (req?.sessionId) return 'session_cookie';
    return null;
}

function chainMismatchError(
    message: string,
    reason: ChainPresenceReason | string,
    statusCode = 409,
): AuthActorError {
    return new AuthActorError(
        statusCode,
        'identity_projection_chain_mismatch',
        message,
        reason,
        true,
    );
}

function authRequiredError(reason = 'auth_session_required'): AuthActorError {
    return new AuthActorError(
        401,
        'auth_session_required',
        'authenticated session is required',
        reason,
        true,
    );
}

function roleFromString(value: unknown): CircleRole {
    if (value === 'Owner' || value === 'Admin' || value === 'Moderator' || value === 'Member') {
        return value;
    }
    return 'Member';
}

function roleMeets(role: CircleRole, minRole: CircleRole): boolean {
    return ROLE_RANK[role] >= ROLE_RANK[minRole];
}

function actionRequiresMemberChainPresence(action: CircleAction): boolean {
    return action !== 'public.read' && action !== 'circle.read';
}

function identityFailureToError(verification: Exclude<IdentityAccountVerification, { ok: true }>): AuthActorError {
    const statusCode = verification.presence === 'unavailable' ? 503 : 401;
    return chainMismatchError(verification.message, verification.reason, statusCode);
}

function chainAccountFailureToError(verification: Exclude<ChainAccountVerification, { ok: true }>): AuthActorError {
    const statusCode = verification.presence === 'unavailable' ? 503 : 409;
    return chainMismatchError(verification.message, verification.reason, statusCode);
}

export async function resolveAuthenticatedActor(
    req: any,
    prisma: PrismaClient,
    options: {
        allowLegacyBearer?: boolean;
        requireSessionCookie?: boolean;
    } = {},
): Promise<AuthActor | null> {
    const userId = parsePositiveInt(req?.userId);
    if (!userId) return null;

    const authSource = authSourceFromRequest(req);
    if (!authSource) return null;
    if (options.requireSessionCookie && authSource !== 'session_cookie') {
        throw authRequiredError('session_cookie_required');
    }
    if (authSource === 'legacy_bearer' && !options.allowLegacyBearer) {
        throw authRequiredError('legacy_bearer_not_allowed');
    }

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: AUTH_USER_SELECT,
    });
    if (!user) return null;

    const requestPubkey = typeof req?.userPubkey === 'string' ? req.userPubkey.trim() : '';
    if (requestPubkey && requestPubkey !== user.pubkey) {
        throw chainMismatchError(
            'request session pubkey does not match user projection',
            'identity_pubkey_mismatch',
            401,
        );
    }

    const identity = await verifyIdentityAccount({
        handle: user.handle,
        expectedPubkey: user.pubkey,
    });
    if (!identity.ok) {
        throw identityFailureToError(identity);
    }

    return {
        userId: user.id,
        pubkey: user.pubkey,
        handle: user.handle,
        displayName: user.displayName,
        sessionId: typeof req?.sessionId === 'string' && req.sessionId.trim() ? req.sessionId.trim() : null,
        authSource,
        identity: {
            handle: identity.handle,
            identityPubkey: identity.identityPubkey,
            accountAddress: identity.accountAddress,
            presence: 'verified',
        },
    };
}

export async function requireAuthenticatedActor(
    req: any,
    prisma: PrismaClient,
    options: {
        allowLegacyBearer?: boolean;
        requireSessionCookie?: boolean;
    } = {},
): Promise<AuthActor> {
    const actor = await resolveAuthenticatedActor(req, prisma, options);
    if (!actor) {
        throw authRequiredError();
    }
    return actor;
}

export async function resolveCircleActorForAuthActor(
    actor: AuthActor,
    prisma: PrismaClient,
    input: {
        circleId: number;
        action: CircleAction;
        minRole?: CircleRole;
        requireMemberChainPresence?: boolean;
    },
): Promise<CircleActor | null> {
    const circle = await prisma.circle.findUnique({
        where: { id: input.circleId },
        select: CIRCLE_SELECT,
    });
    if (!circle) {
        throw new AuthActorError(404, 'circle_not_found', 'circle not found', 'circle_not_found', true);
    }

    const circlePresence = await verifyCircleAccountAddress({ address: circle.onChainAddress });
    if (!circlePresence.ok) {
        throw chainAccountFailureToError(circlePresence);
    }

    const membership = await prisma.circleMember.findUnique({
        where: {
            circleId_userId: {
                circleId: circle.id,
                userId: actor.userId,
            },
        },
        select: MEMBER_SELECT,
    });

    if (circle.creatorId === actor.userId) {
        const role: CircleRole = 'Owner';
        const minRole = input.minRole ?? 'Member';
        if (!roleMeets(role, minRole)) {
            throw new AuthActorError(403, 'circle_role_required', 'insufficient circle role', 'role_required', true);
        }
        return {
            ...actor,
            circle: {
                id: circle.id,
                onChainAddress: circle.onChainAddress,
                chainPresence: 'verified',
                creatorId: circle.creatorId,
            },
            membership: {
                role,
                status: 'Active',
                identityLevel: membership?.identityLevel ? String(membership.identityLevel) : 'Member',
                source: 'circle_creator',
                chainPresence: 'creator_in_circle_projection',
            },
        };
    }

    if (!membership || membership.status !== 'Active') {
        throw new AuthActorError(
            403,
            'circle_membership_required',
            'active circle membership is required',
            'active_membership_required',
            true,
        );
    }

    const role = roleFromString(membership.role);
    const minRole = input.minRole ?? 'Member';
    if (!roleMeets(role, minRole)) {
        throw new AuthActorError(403, 'circle_role_required', 'insufficient circle role', 'role_required', true);
    }

    const requireMemberChain = input.requireMemberChainPresence ?? actionRequiresMemberChainPresence(input.action);
    if (requireMemberChain) {
        const memberPresence = await verifyCircleMemberAccountAddress({ address: membership.onChainAddress });
        if (!memberPresence.ok) {
            throw chainAccountFailureToError(memberPresence);
        }
    }

    return {
        ...actor,
        circle: {
            id: circle.id,
            onChainAddress: circle.onChainAddress,
            chainPresence: 'verified',
            creatorId: circle.creatorId,
        },
        membership: {
            role,
            status: 'Active',
            identityLevel: String(membership.identityLevel),
            source: 'member_pda',
            chainPresence: 'verified',
        },
    };
}

export async function requireCircleActorForAuthActor(
    actor: AuthActor,
    prisma: PrismaClient,
    input: {
        circleId: number;
        action: CircleAction;
        minRole?: CircleRole;
        requireMemberChainPresence?: boolean;
    },
): Promise<CircleActor> {
    const circleActor = await resolveCircleActorForAuthActor(actor, prisma, input);
    if (!circleActor) {
        throw authRequiredError();
    }
    return circleActor;
}

export async function resolveCircleActor(
    req: any,
    prisma: PrismaClient,
    input: {
        circleId: number;
        action: CircleAction;
        minRole?: CircleRole;
        allowLegacyBearer?: boolean;
        requireSessionCookie?: boolean;
        requireMemberChainPresence?: boolean;
    },
): Promise<CircleActor | null> {
    const actor = await requireAuthenticatedActor(req, prisma, {
        allowLegacyBearer: input.allowLegacyBearer,
        requireSessionCookie: input.requireSessionCookie,
    });
    return resolveCircleActorForAuthActor(actor, prisma, {
        circleId: input.circleId,
        action: input.action,
        minRole: input.minRole,
        requireMemberChainPresence: input.requireMemberChainPresence,
    });
}

export async function requireCircleActor(
    req: any,
    prisma: PrismaClient,
    input: {
        circleId: number;
        action: CircleAction;
        minRole?: CircleRole;
        allowLegacyBearer?: boolean;
        requireSessionCookie?: boolean;
        requireMemberChainPresence?: boolean;
    },
): Promise<CircleActor> {
    const actor = await resolveCircleActor(req, prisma, input);
    if (!actor) {
        throw authRequiredError();
    }
    return actor;
}

export async function requireCircleManagerActorForAuthActor(
    actor: AuthActor,
    prisma: PrismaClient,
    input: {
        circleId: number;
        allowModerator?: boolean;
        action?: CircleAction;
    },
): Promise<CircleActor> {
    return requireCircleActorForAuthActor(actor, prisma, {
        circleId: input.circleId,
        action: input.action ?? 'circle.manage',
        minRole: input.allowModerator ? 'Moderator' : 'Admin',
    });
}

export async function requireCircleManagerActor(
    req: any,
    prisma: PrismaClient,
    input: {
        circleId: number;
        allowModerator?: boolean;
        action?: CircleAction;
        allowLegacyBearer?: boolean;
        requireSessionCookie?: boolean;
    },
): Promise<CircleActor> {
    return requireCircleActor(req, prisma, {
        circleId: input.circleId,
        action: input.action ?? 'circle.manage',
        minRole: input.allowModerator ? 'Moderator' : 'Admin',
        allowLegacyBearer: input.allowLegacyBearer,
        requireSessionCookie: input.requireSessionCookie,
    });
}

export async function requireCircleOwnerActorForAuthActor(
    actor: AuthActor,
    prisma: PrismaClient,
    input: {
        circleId: number;
        action?: CircleAction;
    },
): Promise<CircleActor> {
    return requireCircleActorForAuthActor(actor, prisma, {
        circleId: input.circleId,
        action: input.action ?? 'circle.owner',
        minRole: 'Owner',
    });
}

export async function requireCircleOwnerActor(
    req: any,
    prisma: PrismaClient,
    input: {
        circleId: number;
        action?: CircleAction;
        allowLegacyBearer?: boolean;
        requireSessionCookie?: boolean;
    },
): Promise<CircleActor> {
    return requireCircleActor(req, prisma, {
        circleId: input.circleId,
        action: input.action ?? 'circle.owner',
        minRole: 'Owner',
        allowLegacyBearer: input.allowLegacyBearer,
        requireSessionCookie: input.requireSessionCookie,
    });
}
