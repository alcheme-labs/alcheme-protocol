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
import {
    AuthActorError,
    requireAuthenticatedActor,
    requireCircleActorForAuthActor,
    type AuthActor,
} from '../services/auth/actor';
import {
    resolveJwtSecret,
} from '../config/jwtSecret';

const JWT_SECRET = resolveJwtSecret(process.env, { localFallback: 'dev-secret' });
const LOCAL_RELAXED_PROFILE = 'local-relaxed';

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

function isCollabRelaxedMode(): boolean {
    return String(process.env.COLLAB_AUTH_MODE || 'strict').trim().toLowerCase() === 'relaxed';
}

function isProductionEnv(): boolean {
    return String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

function isLoopbackHost(hostHeader: string | undefined): boolean {
    if (!hostHeader) return false;
    try {
        const parsed = new URL(`http://${hostHeader}`);
        const hostname = parsed.hostname.toLowerCase();
        return hostname === 'localhost'
            || hostname === '127.0.0.1'
            || hostname === '[::1]';
    } catch {
        return false;
    }
}

function isCollabRelaxedAuthAllowed(req: IncomingMessage): boolean {
    return isCollabRelaxedMode()
        && process.env.ALCHEME_TEST_PROFILE === LOCAL_RELAXED_PROFILE
        && !isProductionEnv()
        && isLoopbackHost(req.headers.host);
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

function mapAuthActorError(error: AuthActorError): CollabAuthError {
    if (error.statusCode === 401) return new CollabAuthError(4401, error.message);
    if (error.statusCode === 404) return new CollabAuthError(4404, error.message);
    return new CollabAuthError(4403, error.message);
}

function identityLevelFromActor(actor: { membership: { identityLevel?: string | null } }): IdentityLevel {
    const level = actor.membership.identityLevel;
    if (
        level === IdentityLevel.Initiate ||
        level === IdentityLevel.Member ||
        level === IdentityLevel.Elder ||
        level === IdentityLevel.Visitor
    ) {
        return level;
    }
    return IdentityLevel.Visitor;
}

async function resolveCollabAuthActor(
    req: IncomingMessage,
    prisma: PrismaClient,
    redis: Redis,
    token: string | null,
    roomName: string,
    relaxedAuth: boolean,
): Promise<{ actor: AuthActor; tokenUserHandle: string | null } | null> {
    let authRequest: any | null = null;
    let tokenUserHandle: string | null = null;

    if (token) {
        try {
            const payload = jwt.verify(token, JWT_SECRET) as any;
            const userId = parseUserId(payload?.userId ?? payload?.sub);
            tokenUserHandle = typeof payload?.handle === 'string' ? payload.handle : null;
            if (!userId) {
                throw new Error('missing_user_id');
            }
            authRequest = {
                userId,
                userPubkey: typeof payload?.publicKey === 'string'
                    ? payload.publicKey
                    : typeof payload?.pubkey === 'string'
                        ? payload.pubkey
                        : undefined,
                sessionId: null,
                authSource: 'legacy_bearer',
            };
        } catch {
            if (relaxedAuth) return null;
            throw new CollabAuthError(4401, 'Invalid or expired token');
        }
    } else {
        const cookieName = getAuthSessionCookieName();
        const cookieHeader = parseCookieHeader(req.headers.cookie);
        const sessionId = getCookieValue(cookieHeader, cookieName);
        if (sessionId) {
            const session = await getAuthSession(redis, sessionId);
            const userId = parseUserId(session?.userId);
            if (userId) {
                authRequest = {
                    userId,
                    userPubkey: session?.pubkey,
                    sessionId,
                    authSource: 'session_cookie',
                };
            }
        }
    }

    if (!authRequest) {
        if (relaxedAuth) return null;
        throw new CollabAuthError(4401, `Missing authentication for room ${roomName}`);
    }

    try {
        const actor = await requireAuthenticatedActor(authRequest, prisma, {
            allowLegacyBearer: Boolean(token),
            requireSessionCookie: !token,
        });
        return { actor, tokenUserHandle };
    } catch (error) {
        if (error instanceof AuthActorError) {
            throw mapAuthActorError(error);
        }
        throw error;
    }
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
    const relaxedAuth = isCollabRelaxedAuthAllowed(req);
    const auth = await resolveCollabAuthActor(req, prisma, redis, token, room.roomName, relaxedAuth);
    if (!auth) {
        if (relaxedAuth) {
            const circleId = await resolveCircleIdFromDraft(prisma, room.draftId);
            return buildRelaxedUser(circleId, `missing auth for room ${room.roomName}`);
        }
        throw new CollabAuthError(4401, 'Missing authentication token');
    }

    if (!room.draftId) {
        if (relaxedAuth) {
            return {
                userId: auth.actor.userId,
                handle: auth.tokenUserHandle || 'collab-user',
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
        if (relaxedAuth) {
            return {
                userId: auth.actor.userId,
                handle: auth.tokenUserHandle || 'collab-user',
                identityLevel: IdentityLevel.Member,
                circleId: 0,
            };
        }
        throw new CollabAuthError(4404, 'Draft not found or not in a circle');
    }

    let circleActor;
    try {
        circleActor = await requireCircleActorForAuthActor(auth.actor, prisma, {
            circleId: post.circleId,
            action: 'draft.write',
        });
    } catch (error) {
        if (relaxedAuth) {
            return {
                userId: auth.actor.userId,
                handle: auth.tokenUserHandle || auth.actor.handle || 'collab-user',
                identityLevel: IdentityLevel.Member,
                circleId: post.circleId,
            };
        }
        if (error instanceof AuthActorError) {
            throw mapAuthActorError(error);
        }
        throw error;
    }

    const identityLevel = identityLevelFromActor(circleActor);

    // Require at least Initiate level for collaborative editing
    const allowedLevels: IdentityLevel[] = [
        IdentityLevel.Initiate,
        IdentityLevel.Member,
        IdentityLevel.Elder,
    ];

    if (!allowedLevels.includes(identityLevel)) {
        if (relaxedAuth) {
            return {
                userId: auth.actor.userId,
                handle: auth.actor.handle || auth.tokenUserHandle || 'collab-user',
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
        userId: auth.actor.userId,
        handle: auth.actor.handle || auth.tokenUserHandle || 'collab-user',
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
