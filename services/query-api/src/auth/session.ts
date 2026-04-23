import crypto from 'crypto';
import type { CookieOptions } from 'express';
import type { Redis } from 'ioredis';

export interface AuthSessionRecord {
    userId: number;
    pubkey: string;
    issuedAt: string;
    expiresAt: string;
}

interface SessionLoginMessagePayload {
    v: 1;
    action: 'session_login';
    publicKey: string;
    nonce: string;
    clientTimestamp: string;
    domain?: string;
}

const SESSION_COOKIE_DEFAULT = 'alcheme_session';
const SESSION_TTL_DEFAULT_SEC = 7 * 24 * 60 * 60;
const SESSION_NONCE_TTL_DEFAULT_SEC = 5 * 60;
const SESSION_SIGNING_PREFIX = 'alcheme-auth-session:';

function parsePositiveInt(raw: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(String(raw || ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

function normalizeSameSite(raw: string | undefined): CookieOptions['sameSite'] {
    const normalized = String(raw || 'lax').trim().toLowerCase();
    if (normalized === 'strict') return 'strict';
    if (normalized === 'none') return 'none';
    return 'lax';
}

function parseOptionalBoolean(raw: string | undefined): boolean | null {
    if (raw === undefined) return null;
    const normalized = raw.trim().toLowerCase();
    if (!normalized) return null;
    if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true;
    if (normalized === '0' || normalized === 'false' || normalized === 'no') return false;
    return null;
}

function inferSecureCookieDefault(): boolean {
    const explicit = parseOptionalBoolean(process.env.AUTH_SESSION_COOKIE_SECURE);
    if (explicit !== null) {
        return explicit;
    }

    const publicBaseUrl = String(process.env.QUERY_API_PUBLIC_BASE_URL || '').trim();
    if (publicBaseUrl) {
        try {
            return new URL(publicBaseUrl).protocol === 'https:';
        } catch {
            // Fall through to the environment-based default.
        }
    }

    return process.env.NODE_ENV === 'production';
}

function randomSessionId(): string {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID().replace(/-/g, '');
    }
    return crypto.randomBytes(16).toString('hex');
}

function randomNonce(): string {
    return crypto.randomBytes(16).toString('hex');
}

export function getAuthSessionTtlSec(): number {
    return parsePositiveInt(process.env.AUTH_SESSION_TTL_SEC, SESSION_TTL_DEFAULT_SEC);
}

export function getAuthSessionNonceTtlSec(): number {
    return parsePositiveInt(process.env.AUTH_SESSION_NONCE_TTL_SEC, SESSION_NONCE_TTL_DEFAULT_SEC);
}

export function getAuthSessionCookieName(): string {
    const configured = String(process.env.AUTH_SESSION_COOKIE_NAME || '').trim();
    return configured.length > 0 ? configured : SESSION_COOKIE_DEFAULT;
}

export function getAuthSessionCookieOptions(): CookieOptions {
    return {
        httpOnly: true,
        secure: inferSecureCookieDefault(),
        sameSite: normalizeSameSite(process.env.AUTH_SESSION_SAME_SITE),
        path: '/',
        maxAge: getAuthSessionTtlSec() * 1000,
    };
}

export function parseCookieHeader(cookieHeader: string | undefined): Map<string, string> {
    const map = new Map<string, string>();
    if (!cookieHeader || cookieHeader.trim().length === 0) return map;

    const pairs = cookieHeader.split(';');
    for (const pair of pairs) {
        const index = pair.indexOf('=');
        if (index <= 0) continue;
        const key = pair.slice(0, index).trim();
        const value = pair.slice(index + 1).trim();
        if (!key) continue;
        try {
            map.set(key, decodeURIComponent(value));
        } catch {
            map.set(key, value);
        }
    }

    return map;
}

export function getCookieValue(cookieHeader: string | undefined, cookieName: string): string | null {
    const cookies = parseCookieHeader(cookieHeader);
    const value = cookies.get(cookieName);
    if (!value) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function authSessionRedisKey(sessionId: string): string {
    return `auth:session:${sessionId}`;
}

function authNonceRedisKey(publicKey: string, nonce: string): string {
    return `auth:nonce:${publicKey}:${nonce}`;
}

export async function createAuthSession(
    redis: Redis,
    input: { userId: number; pubkey: string },
): Promise<{ sessionId: string; record: AuthSessionRecord }> {
    const ttlSec = getAuthSessionTtlSec();
    const sessionId = randomSessionId();
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + ttlSec * 1000);

    const record: AuthSessionRecord = {
        userId: input.userId,
        pubkey: input.pubkey,
        issuedAt: issuedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
    };

    await redis.setex(authSessionRedisKey(sessionId), ttlSec, JSON.stringify(record));
    return { sessionId, record };
}

export async function getAuthSession(redis: Redis, sessionId: string): Promise<AuthSessionRecord | null> {
    if (!sessionId || sessionId.trim().length === 0) return null;
    const raw = await redis.get(authSessionRedisKey(sessionId));
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw) as Partial<AuthSessionRecord>;
        const userId = Number(parsed.userId);
        const pubkey = String(parsed.pubkey || '').trim();
        const issuedAt = String(parsed.issuedAt || '').trim();
        const expiresAt = String(parsed.expiresAt || '').trim();
        if (!Number.isFinite(userId) || userId <= 0) return null;
        if (!pubkey || !issuedAt || !expiresAt) return null;

        const expiryMs = Date.parse(expiresAt);
        if (!Number.isFinite(expiryMs) || expiryMs <= Date.now()) {
            return null;
        }

        return {
            userId,
            pubkey,
            issuedAt,
            expiresAt,
        };
    } catch {
        return null;
    }
}

export async function touchAuthSession(
    redis: Redis,
    sessionId: string,
    record: AuthSessionRecord,
): Promise<void> {
    const ttlSec = getAuthSessionTtlSec();
    const refreshedRecord: AuthSessionRecord = {
        ...record,
        expiresAt: new Date(Date.now() + ttlSec * 1000).toISOString(),
    };
    await redis.setex(authSessionRedisKey(sessionId), ttlSec, JSON.stringify(refreshedRecord));
}

export async function deleteAuthSession(redis: Redis, sessionId: string): Promise<void> {
    if (!sessionId || sessionId.trim().length === 0) return;
    await redis.del(authSessionRedisKey(sessionId));
}

export async function createSessionLoginNonce(
    redis: Redis,
    input: { publicKey: string; domain?: string },
): Promise<{ nonce: string; message: string; expiresInSec: number }> {
    const nonce = randomNonce();
    const expiresInSec = getAuthSessionNonceTtlSec();
    const payload: SessionLoginMessagePayload = {
        v: 1,
        action: 'session_login',
        publicKey: input.publicKey,
        nonce,
        clientTimestamp: new Date().toISOString(),
        domain: String(input.domain || '').trim() || undefined,
    };
    const message = `${SESSION_SIGNING_PREFIX}${JSON.stringify(payload)}`;

    await redis.setex(
        authNonceRedisKey(input.publicKey, nonce),
        expiresInSec,
        message,
    );

    return {
        nonce,
        message,
        expiresInSec,
    };
}

export async function consumeSessionLoginNonce(
    redis: Redis,
    input: { publicKey: string; nonce: string },
): Promise<string | null> {
    const key = authNonceRedisKey(input.publicKey, input.nonce);
    const stored = await redis.get(key);
    if (!stored) return null;
    await redis.del(key);
    return stored;
}

export function parseSessionLoginMessage(message: string): SessionLoginMessagePayload | null {
    const normalized = String(message || '');
    if (!normalized.startsWith(SESSION_SIGNING_PREFIX)) return null;

    const rawPayload = normalized.slice(SESSION_SIGNING_PREFIX.length);
    if (!rawPayload) return null;

    try {
        const parsed = JSON.parse(rawPayload) as Partial<SessionLoginMessagePayload>;
        if (parsed.v !== 1) return null;
        if (parsed.action !== 'session_login') return null;
        const publicKey = String(parsed.publicKey || '').trim();
        const nonce = String(parsed.nonce || '').trim();
        const clientTimestamp = String(parsed.clientTimestamp || '').trim();
        const domain = typeof parsed.domain === 'string' ? parsed.domain.trim() : undefined;
        if (!publicKey || !nonce || !clientTimestamp) return null;

        return {
            v: 1,
            action: 'session_login',
            publicKey,
            nonce,
            clientTimestamp,
            domain,
        };
    } catch {
        return null;
    }
}
