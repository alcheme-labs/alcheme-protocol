import type { RequestHandler } from 'express';
import type { Redis } from 'ioredis';
import {
    LEGACY_LOGIN_TOKEN_AUDIENCE,
    LEGACY_LOGIN_TOKEN_TYPE,
    verifyToken,
} from './auth';
import {
    deleteAuthSession,
    getAuthSession,
    getAuthSessionCookieName,
    getAuthSessionCookieOptions,
    getCookieValue,
    touchAuthSession,
} from '../auth/session';

function parseBearerToken(headerValue: string | undefined): string | null {
    if (!headerValue || !headerValue.startsWith('Bearer ')) return null;
    const token = headerValue.slice(7).trim();
    return token.length > 0 ? token : null;
}

function parseUserId(value: unknown): number | null {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined) return fallback;
    const normalized = value.trim().toLowerCase();
    if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true;
    if (normalized === '0' || normalized === 'false' || normalized === 'no') return false;
    return fallback;
}

function allowLegacyBearerFallback(): boolean {
    return parseBool(process.env.AUTH_SESSION_ALLOW_LEGACY_BEARER, false);
}

function isAcceptedLegacyLoginToken(decoded: any): boolean {
    return decoded?.typ === LEGACY_LOGIN_TOKEN_TYPE
        && decoded?.aud === LEGACY_LOGIN_TOKEN_AUDIENCE;
}

export function sessionAuth(redis: Redis): RequestHandler {
    return async (req, res, next) => {
        const cookieName = getAuthSessionCookieName();
        const cookieHeader = Array.isArray(req.headers.cookie)
            ? req.headers.cookie.join('; ')
            : req.headers.cookie;

        try {
            const sessionId = getCookieValue(cookieHeader, cookieName);
            if (sessionId) {
                const session = await getAuthSession(redis, sessionId);
                if (session) {
                    (req as any).userId = session.userId;
                    (req as any).userPubkey = session.pubkey;
                    (req as any).sessionId = sessionId;
                    await touchAuthSession(redis, sessionId, session);
                    return next();
                }

                await deleteAuthSession(redis, sessionId);
                res.clearCookie(cookieName, getAuthSessionCookieOptions());
            }

            const authorization = Array.isArray(req.headers.authorization)
                ? req.headers.authorization[0]
                : req.headers.authorization;
            const bearer = parseBearerToken(authorization);
            if (bearer && allowLegacyBearerFallback()) {
                const decoded = verifyToken(bearer);
                const userId = parseUserId(decoded?.userId ?? decoded?.sub);
                if (userId && isAcceptedLegacyLoginToken(decoded)) {
                    (req as any).userId = userId;
                    (req as any).userPubkey = typeof decoded?.publicKey === 'string'
                        ? decoded.publicKey
                        : undefined;
                    console.info('legacy bearer auth fallback accepted', {
                        path: req.path,
                        userId,
                        tokenSource: 'legacy_bearer',
                    });
                }
            }
        } catch (error) {
            console.warn('session auth middleware error:', error);
        }

        return next();
    };
}
