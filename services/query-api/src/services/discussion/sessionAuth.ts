import type { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

import { resolveJwtSecret } from '../../config/jwtSecret';

export interface DiscussionSessionRow {
    sessionId: string;
    senderPubkey: string;
    senderHandle: string | null;
    scope: string;
    issuedAt: Date;
    expiresAt: Date;
    revoked: boolean;
    lastSeenAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface DiscussionSessionTokenPayload {
    typ: 'discussion_session';
    sessionId: string;
    senderPubkey: string;
    scope: string;
    iat?: number;
    exp?: number;
}

export type DiscussionSessionAuthResult =
    | {
        ok: true;
        tokenProvided: boolean;
        session: DiscussionSessionRow;
    }
    | {
        ok: false;
        tokenProvided: boolean;
        status: number;
        error: string;
        message: string;
    }
    | {
        ok: true;
        tokenProvided: false;
        session: null;
    };

export function parseBearerToken(headerValue: string | undefined): string | null {
    if (!headerValue || !headerValue.startsWith('Bearer ')) return null;
    const token = headerValue.slice(7).trim();
    return token.length > 0 ? token : null;
}

export function scopeAllowsCircle(scope: string, circleId: number): boolean {
    if (scope === 'circle:*') return true;
    const prefix = 'circle:';
    if (!scope.startsWith(prefix)) return false;
    const scopedCircleId = Number.parseInt(scope.slice(prefix.length), 10);
    return Number.isFinite(scopedCircleId) && scopedCircleId === circleId;
}

export function parseDiscussionSessionTokenPayload(
    token: string,
    jwtSecret: string,
): DiscussionSessionTokenPayload | null {
    try {
        const decoded = jwt.verify(token, jwtSecret) as DiscussionSessionTokenPayload;
        if (!decoded || decoded.typ !== 'discussion_session') return null;
        if (!decoded.sessionId || !decoded.senderPubkey || !decoded.scope) return null;
        return decoded;
    } catch {
        return null;
    }
}

export async function loadValidDiscussionSessionById(
    prisma: PrismaClient,
    sessionId: string,
): Promise<DiscussionSessionRow | null> {
    const rows = await prisma.$queryRaw<DiscussionSessionRow[]>`
        SELECT
            session_id AS "sessionId",
            sender_pubkey AS "senderPubkey",
            sender_handle AS "senderHandle",
            scope AS "scope",
            issued_at AS "issuedAt",
            expires_at AS "expiresAt",
            revoked AS "revoked",
            last_seen_at AS "lastSeenAt",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
        FROM discussion_sessions
        WHERE session_id = ${sessionId}
        LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    if (row.revoked) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null;
    return row;
}

export function signDiscussionSessionToken(input: {
    sessionId: string;
    senderPubkey: string;
    scope: string;
    expiresAt: Date;
    jwtSecret: string;
}): string {
    const nowSec = Math.floor(Date.now() / 1000);
    const expSec = Math.max(nowSec + 1, Math.floor(input.expiresAt.getTime() / 1000));
    const payload: DiscussionSessionTokenPayload = {
        typ: 'discussion_session',
        sessionId: input.sessionId,
        senderPubkey: input.senderPubkey,
        scope: input.scope,
        iat: nowSec,
        exp: expSec,
    };
    return jwt.sign(payload, input.jwtSecret);
}

export async function authenticateDiscussionSessionFromRequest(input: {
    prisma: PrismaClient;
    jwtSecret?: string;
    authorizationHeader: string | undefined;
    circleId: number;
    actorPubkey: string;
}): Promise<DiscussionSessionAuthResult> {
    const token = parseBearerToken(input.authorizationHeader);
    if (!token) {
        return { ok: true, tokenProvided: false, session: null };
    }

    const payload = parseDiscussionSessionTokenPayload(token, input.jwtSecret ?? resolveJwtSecret());
    if (!payload) {
        return {
            ok: false,
            tokenProvided: true,
            status: 401,
            error: 'invalid_discussion_session_token',
            message: 'discussion session token is invalid or expired',
        };
    }

    const session = await loadValidDiscussionSessionById(input.prisma, payload.sessionId);
    if (!session) {
        return {
            ok: false,
            tokenProvided: true,
            status: 401,
            error: 'discussion_session_not_found',
            message: 'discussion session is not found, expired, or revoked',
        };
    }

    if (session.senderPubkey !== payload.senderPubkey || session.scope !== payload.scope) {
        return {
            ok: false,
            tokenProvided: true,
            status: 401,
            error: 'discussion_session_token_mismatch',
            message: 'discussion session token does not match persisted session',
        };
    }

    if (input.actorPubkey !== session.senderPubkey) {
        return {
            ok: false,
            tokenProvided: true,
            status: 403,
            error: 'discussion_session_sender_mismatch',
            message: 'discussion session sender does not match authenticated actor',
        };
    }

    if (!scopeAllowsCircle(session.scope, input.circleId)) {
        return {
            ok: false,
            tokenProvided: true,
            status: 403,
            error: 'discussion_session_scope_violation',
            message: 'discussion session scope does not allow this circle',
        };
    }

    await input.prisma.$executeRaw`
        UPDATE discussion_sessions
        SET
            last_seen_at = NOW(),
            updated_at = NOW()
        WHERE session_id = ${session.sessionId}
    `;

    return {
        ok: true,
        tokenProvided: true,
        session,
    };
}
