/**
 * Collaborative Editing — Session/JWT + Identity Level Authentication
 *
 * Verifies WebSocket connection requests:
 * 1. Session cookie validation (preferred for browser clients)
 * 2. JWT token validation (compatibility fallback)
 * 2. Identity level check (Initiate+ required for editing)
 */

import { IncomingMessage } from 'http';
import { URL } from 'url';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { IdentityLevel } from '../identity/thresholds';
import {
    getAuthSession,
    getAuthSessionCookieName,
    getCookieValue,
} from '../auth/session';
import { getActiveCircleMembership } from '../services/membership/checks';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const COLLAB_AUTH_MODE = (
    process.env.COLLAB_AUTH_MODE
    || (process.env.NODE_ENV === 'production' ? 'strict' : 'relaxed')
).toLowerCase();
const RELAXED_AUTH = COLLAB_AUTH_MODE !== 'strict';

export interface CollabUser {
    userId: number;
    handle: string;
    identityLevel: IdentityLevel;
    circleId: number;
}

interface ParsedCollabRoom {
    roomName: string;
    draftId: number | null;
}

function parseCollabRoom(pathname: string): ParsedCollabRoom | null {
    const roomMatch = pathname.match(/^\/collab\/([^/?#]+)/);
    if (!roomMatch) return null;

    const roomName = decodeURIComponent(roomMatch[1]);
    const draftMatch = roomName.match(/^crucible-(\d+)$/);
    const draftId = draftMatch ? Number.parseInt(draftMatch[1], 10) : null;

    return {
        roomName,
        draftId: Number.isFinite(draftId as number) ? draftId : null,
    };
}

async function resolveCircleIdFromDraft(
    prisma: PrismaClient,
    draftId: number | null,
): Promise<number | null> {
    if (!draftId) return null;
    const post = await prisma.post.findUnique({
        where: { id: draftId },
        select: { circleId: true },
    });
    return post?.circleId ?? null;
}

function buildRelaxedUser(circleId: number | null, reason: string): CollabUser {
    console.warn(`🤝 Collab relaxed auth: ${reason}`);
    return {
        userId: 0,
        handle: 'dev-collab',
        identityLevel: IdentityLevel.Member,
        circleId: circleId || 0,
    };
}

function parseUserId(value: unknown): number | null {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

function parseCookieHeader(headerValue: string[] | string | undefined): string | undefined {
    if (Array.isArray(headerValue)) return headerValue.join('; ');
    return headerValue;
}

/**
 * Authenticate a WebSocket upgrade request.
 * Expects: ws://host/collab/crucible-{draftId}?token={jwt}
 *
 * Returns CollabUser on success, throws on failure.
 */
export async function authenticateCollabRequest(
    req: IncomingMessage,
    prisma: PrismaClient,
    redis: Redis,
): Promise<CollabUser> {
    // Parse URL and extract token
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const room = parseCollabRoom(url.pathname);
    if (!room) {
        throw new CollabAuthError(4400, 'Invalid room path');
    }
    const token = url.searchParams.get('token');
    let userId: number | null = null;
    let tokenUserHandle: string | null = null;

    if (token) {
        try {
            const payload = jwt.verify(token, JWT_SECRET) as any;
            userId = parseUserId(payload?.userId ?? payload?.sub);
            tokenUserHandle = typeof payload?.handle === 'string' ? payload.handle : null;
            if (!userId) {
                throw new Error('missing_user_id');
            }
        } catch (err) {
            if (RELAXED_AUTH) {
                const circleId = await resolveCircleIdFromDraft(prisma, room.draftId);
                return buildRelaxedUser(circleId, `invalid token for room ${room.roomName}`);
            }
            throw new CollabAuthError(4401, 'Invalid or expired token');
        }
    } else {
        const cookieName = getAuthSessionCookieName();
        const cookieHeader = parseCookieHeader(req.headers.cookie);
        const sessionId = getCookieValue(cookieHeader, cookieName);
        if (sessionId) {
            const session = await getAuthSession(redis, sessionId);
            userId = parseUserId(session?.userId);
        }
    }

    if (!userId) {
        if (RELAXED_AUTH) {
            const circleId = await resolveCircleIdFromDraft(prisma, room.draftId);
            return buildRelaxedUser(circleId, `missing auth for room ${room.roomName}`);
        }
        throw new CollabAuthError(4401, 'Missing authentication token');
    }

    if (!room.draftId) {
        if (RELAXED_AUTH) {
            return {
                userId,
                handle: tokenUserHandle || 'collab-user',
                identityLevel: IdentityLevel.Member,
                circleId: 0,
            };
        }
        throw new CollabAuthError(4400, 'Unsupported room type');
    }

    // Look up the draft/post to find the circle
    const post = await prisma.post.findUnique({
        where: { id: room.draftId },
        select: { circleId: true },
    });

    if (!post?.circleId) {
        if (RELAXED_AUTH) {
            return {
                userId,
                handle: tokenUserHandle || 'collab-user',
                identityLevel: IdentityLevel.Member,
                circleId: 0,
            };
        }
        throw new CollabAuthError(4404, 'Draft not found or not in a circle');
    }

    // Check membership and identity level
    const [member, user] = await Promise.all([
        getActiveCircleMembership(prisma, {
            circleId: post.circleId,
            userId,
        }),
        prisma.user.findUnique({
            where: { id: userId },
            select: { handle: true },
        }),
    ]);

    if (!member || member.status !== 'Active') {
        if (RELAXED_AUTH) {
            return {
                userId,
                handle: tokenUserHandle || 'collab-user',
                identityLevel: IdentityLevel.Member,
                circleId: post.circleId,
            };
        }
        throw new CollabAuthError(4403, 'Not a member of this circle');
    }

    const identityLevel = (member.identityLevel as IdentityLevel) || IdentityLevel.Visitor;

    // Require at least Initiate level for collaborative editing
    const allowedLevels: IdentityLevel[] = [
        IdentityLevel.Initiate,
        IdentityLevel.Member,
        IdentityLevel.Elder,
    ];

    if (!allowedLevels.includes(identityLevel)) {
        if (RELAXED_AUTH) {
            return {
                userId,
                handle: user?.handle || tokenUserHandle || 'collab-user',
                identityLevel: IdentityLevel.Member,
                circleId: post.circleId,
            };
        }
        throw new CollabAuthError(
            4403,
            `Insufficient identity level: ${identityLevel}. Requires Initiate or above.`,
        );
    }

    return {
        userId,
        handle: user?.handle || tokenUserHandle || 'collab-user',
        identityLevel,
        circleId: post.circleId,
    };
}

export class CollabAuthError extends Error {
    constructor(
        public readonly code: number,
        message: string,
    ) {
        super(message);
        this.name = 'CollabAuthError';
    }
}
