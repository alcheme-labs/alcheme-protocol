import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import bs58 from 'bs58';
import * as nacl from 'tweetnacl';
import createLegacyAuthRouter from '../routes/auth';
import {
    consumeSessionLoginNonce,
    createAuthSession,
    createSessionLoginNonce,
    deleteAuthSession,
    getAuthSessionCookieName,
    getAuthSessionCookieOptions,
    getCookieValue,
    parseSessionLoginMessage,
} from '../auth/session';
import { resolveIdentityAccountPresence } from '../services/identityPresence';

const SESSION_USER_SELECT = {
    id: true,
    pubkey: true,
    handle: true,
    displayName: true,
    avatarUri: true,
    createdAt: true,
} as const;

async function loadRegisteredSessionUser(
    prisma: PrismaClient,
    publicKey: string,
) {
    const user = await prisma.user.findUnique({
        where: { pubkey: publicKey },
        select: SESSION_USER_SELECT,
    });
    if (!user) return null;

    const presence = await resolveIdentityAccountPresence(user.handle);
    if (presence === 'missing') {
        return null;
    }

    return user;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined) return fallback;
    const normalized = value.trim().toLowerCase();
    if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true;
    if (normalized === '0' || normalized === 'false' || normalized === 'no') return false;
    return fallback;
}

function requireSessionSignature(): boolean {
    const defaultValue = process.env.NODE_ENV === 'production';
    return parseBool(process.env.AUTH_SESSION_REQUIRE_SIGNATURE, defaultValue);
}

function enableLegacyJwtLogin(): boolean {
    return parseBool(process.env.AUTH_ENABLE_LEGACY_JWT_LOGIN, false);
}

function decodeSignatureCandidates(signature: string): Uint8Array[] {
    const trimmed = String(signature || '').trim();
    if (!trimmed) return [];
    const candidates: Uint8Array[] = [];

    try {
        const asBase58 = bs58.decode(trimmed);
        if (asBase58.length > 0) {
            candidates.push(new Uint8Array(asBase58));
        }
    } catch {
        // Ignore invalid base58 payload.
    }

    try {
        const asBase64 = Buffer.from(trimmed, 'base64');
        if (asBase64.length > 0) {
            candidates.push(new Uint8Array(asBase64));
        }
    } catch {
        // Ignore invalid base64 payload.
    }

    return candidates;
}

function parseRecentTimestamp(input: string, maxSkewMs: number): boolean {
    const timestampMs = Date.parse(input);
    if (!Number.isFinite(timestampMs)) return false;
    return Math.abs(Date.now() - timestampMs) <= maxSkewMs;
}

function normalizePublicKey(input: unknown): string {
    return String(input || '').trim();
}

export function authRouter(prisma: PrismaClient, redis: Redis): Router {
    const router = Router();

    if (enableLegacyJwtLogin()) {
        // Compatibility endpoints for machine clients using bearer JWT.
        router.use('/', createLegacyAuthRouter(prisma));
    }

    router.get('/session/nonce', async (req, res, next) => {
        try {
            const publicKey = normalizePublicKey(req.query.publicKey || req.query.pubkey);
            if (!publicKey) {
                return res.status(400).json({ error: 'publicKey is required' });
            }

            let decodedPubkey: Uint8Array;
            try {
                decodedPubkey = bs58.decode(publicKey);
            } catch {
                return res.status(400).json({ error: 'invalid publicKey format' });
            }
            if (decodedPubkey.length !== 32) {
                return res.status(400).json({ error: 'invalid publicKey length' });
            }

            const domain = String(req.headers.origin || req.hostname || '').trim();
            const result = await createSessionLoginNonce(redis, {
                publicKey,
                domain,
            });

            return res.json({
                ok: true,
                publicKey,
                nonce: result.nonce,
                message: result.message,
                expiresInSec: result.expiresInSec,
            });
        } catch (error) {
            return next(error);
        }
    });

    router.post('/session/login', async (req, res, next) => {
        try {
            const publicKey = normalizePublicKey(req.body?.publicKey);
            const message = String(req.body?.message || '');
            const signatureInput = String(req.body?.signature || '').trim();
            if (!publicKey || !message) {
                return res.status(400).json({
                    error: 'publicKey and message are required',
                });
            }

            const parsed = parseSessionLoginMessage(message);
            if (!parsed) {
                return res.status(400).json({ error: 'invalid session signing message' });
            }
            if (parsed.publicKey !== publicKey) {
                return res.status(400).json({ error: 'publicKey mismatch in signing message' });
            }
            if (!parseRecentTimestamp(parsed.clientTimestamp, 10 * 60 * 1000)) {
                return res.status(401).json({ error: 'session signing message expired' });
            }

            const nonceMessage = await consumeSessionLoginNonce(redis, {
                publicKey,
                nonce: parsed.nonce,
            });
            if (!nonceMessage || nonceMessage !== message) {
                return res.status(401).json({ error: 'nonce invalid or already consumed' });
            }

            let publicKeyBytes: Uint8Array;
            try {
                publicKeyBytes = bs58.decode(publicKey);
            } catch {
                return res.status(400).json({ error: 'invalid publicKey format' });
            }
            if (publicKeyBytes.length !== 32) {
                return res.status(400).json({ error: 'invalid publicKey length' });
            }

            const enforceSignature = requireSessionSignature();
            let validSignature = false;
            if (signatureInput.length > 0) {
                const signatures = decodeSignatureCandidates(signatureInput);
                if (signatures.length === 0) {
                    return res.status(400).json({ error: 'invalid signature encoding' });
                }
                const messageBytes = new TextEncoder().encode(message);
                const detachedSignatures = signatures.filter((signature) => signature.length === nacl.sign.signatureLength);
                if (detachedSignatures.length === 0) {
                    return res.status(400).json({ error: 'invalid signature encoding' });
                }
                validSignature = detachedSignatures.some((signature) =>
                    nacl.sign.detached.verify(messageBytes, signature, publicKeyBytes)
                );
                if (!validSignature) {
                    return res.status(401).json({ error: 'invalid signature' });
                }
            }
            if (enforceSignature && !validSignature) {
                return res.status(401).json({ error: 'invalid signature' });
            }

            const user = await loadRegisteredSessionUser(prisma, publicKey);
            if (!user) {
                return res.status(401).json({
                    code: 'identity_not_registered',
                    error: 'User not registered. Please register on-chain first.',
                });
            }

            if (!enforceSignature && !validSignature) {
                console.warn(
                    `auth session login accepted without signature in non-production mode for ${publicKey}`,
                );
            }

            const { sessionId, record } = await createAuthSession(redis, {
                userId: user.id,
                pubkey: user.pubkey,
            });
            res.cookie(
                getAuthSessionCookieName(),
                sessionId,
                getAuthSessionCookieOptions(),
            );

            return res.json({
                ok: true,
                authenticated: true,
                user,
                expiresAt: record.expiresAt,
            });
        } catch (error) {
            return next(error);
        }
    });

    router.post('/session/logout', async (req, res, next) => {
        try {
            const cookieHeader = Array.isArray(req.headers.cookie)
                ? req.headers.cookie.join('; ')
                : req.headers.cookie;
            const sessionId = getCookieValue(cookieHeader, getAuthSessionCookieName());
            if (sessionId) {
                await deleteAuthSession(redis, sessionId);
            }

            res.clearCookie(getAuthSessionCookieName(), getAuthSessionCookieOptions());
            return res.json({ ok: true });
        } catch (error) {
            return next(error);
        }
    });

    router.get('/session/me', async (req, res, next) => {
        try {
            const userId = Number((req as any).userId);
            if (!Number.isFinite(userId) || userId <= 0) {
                return res.json({ authenticated: false });
            }

            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: SESSION_USER_SELECT,
            });
            if (!user) {
                return res.json({ authenticated: false });
            }

            const presence = await resolveIdentityAccountPresence(user.handle);
            if (presence === 'missing') {
                const sessionId = String((req as any).sessionId || '').trim();
                if (sessionId) {
                    await deleteAuthSession(redis, sessionId);
                }
                res.clearCookie(getAuthSessionCookieName(), getAuthSessionCookieOptions());
                return res.json({ authenticated: false });
            }

            return res.json({
                authenticated: true,
                user,
            });
        } catch (error) {
            return next(error);
        }
    });

    return router;
}
