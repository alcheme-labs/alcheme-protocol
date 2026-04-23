import rateLimit from 'express-rate-limit';

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MAX = 100;
const DEFAULT_DISCUSSION_READ_MAX = 1200;
const DEFAULT_DISCUSSION_WRITE_MAX = 240;
const DEFAULT_AUTH_SESSION_MAX = 600;
const DEFAULT_CIRCLE_RUNTIME_MAX = 600;
const DEFAULT_DRAFT_RUNTIME_MAX = 1200;
const DISCUSSION_READ_BUCKET = 'discussion_read';
const DISCUSSION_WRITE_BUCKET = 'discussion_write';
const AUTH_SESSION_BUCKET = 'auth_session';
const CIRCLE_RUNTIME_BUCKET = 'circle_runtime';
const DRAFT_RUNTIME_BUCKET = 'draft_runtime';
const API_DEFAULT_BUCKET = 'api_default';

function parsePositiveInt(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

export interface RateLimitSettings {
    windowMs: number;
    defaultMax: number;
    discussionReadMax: number;
    discussionWriteMax: number;
    authSessionMax: number;
    circleRuntimeMax: number;
    draftRuntimeMax: number;
}

export function resolveRateLimitSettings(env: NodeJS.ProcessEnv = process.env): RateLimitSettings {
    return {
        windowMs: parsePositiveInt(env.API_RATE_LIMIT_WINDOW_MS, DEFAULT_WINDOW_MS),
        defaultMax: parsePositiveInt(env.API_RATE_LIMIT_MAX, DEFAULT_MAX),
        discussionReadMax: parsePositiveInt(
            env.DISCUSSION_READ_RATE_LIMIT_MAX,
            DEFAULT_DISCUSSION_READ_MAX,
        ),
        discussionWriteMax: parsePositiveInt(
            env.DISCUSSION_WRITE_RATE_LIMIT_MAX,
            DEFAULT_DISCUSSION_WRITE_MAX,
        ),
        authSessionMax: parsePositiveInt(
            env.AUTH_SESSION_RATE_LIMIT_MAX,
            DEFAULT_AUTH_SESSION_MAX,
        ),
        circleRuntimeMax: parsePositiveInt(
            env.CIRCLE_RUNTIME_RATE_LIMIT_MAX,
            DEFAULT_CIRCLE_RUNTIME_MAX,
        ),
        draftRuntimeMax: parsePositiveInt(
            env.DRAFT_RUNTIME_RATE_LIMIT_MAX,
            DEFAULT_DRAFT_RUNTIME_MAX,
        ),
    };
}

const rateLimitSettings = resolveRateLimitSettings();

export function isDiscussionMessageReadPath(method: string | undefined, path: string | undefined): boolean {
    if (String(method || '').toUpperCase() !== 'GET') return false;
    const normalizedPath = String(path || '');
    if (/^\/discussion\/circles\/\d+\/messages$/.test(normalizedPath)) return true;
    if (/^\/discussion\/knowledge\/[^/]+\/messages$/.test(normalizedPath)) return true;
    if (/^\/discussion\/drafts\/\d+\/edit-anchors$/.test(normalizedPath)) return true;
    if (/^\/discussion\/edit-anchors\/[a-f0-9]{64}$/.test(normalizedPath)) return true;
    return false;
}

export function isDiscussionMessageWritePath(method: string | undefined, path: string | undefined): boolean {
    if (String(method || '').toUpperCase() !== 'POST') return false;
    const normalizedPath = String(path || '');
    if (/^\/discussion\/circles\/\d+\/messages$/.test(normalizedPath)) return true;
    if (/^\/discussion\/knowledge\/[^/]+\/messages$/.test(normalizedPath)) return true;
    if (/^\/discussion\/drafts\/\d+\/discussions\/[^/]+\/messages$/.test(normalizedPath)) return true;
    return false;
}

export function isAuthSessionPath(method: string | undefined, path: string | undefined): boolean {
    const normalizedPath = String(path || '');
    const normalizedMethod = String(method || '').toUpperCase();
    if (!['GET', 'POST'].includes(normalizedMethod)) return false;
    return /^\/auth\/session\/(?:me|nonce|login)$/.test(normalizedPath)
        || /^\/session\/(?:me|nonce|login)$/.test(normalizedPath);
}

export function isCircleRuntimeReadPath(method: string | undefined, path: string | undefined): boolean {
    if (String(method || '').toUpperCase() !== 'GET') return false;
    const normalizedPath = String(path || '');
    if (/^\/membership\/circles\/\d+\/me$/.test(normalizedPath)) return true;
    if (/^\/membership\/circles\/\d+\/identity-status$/.test(normalizedPath)) return true;
    if (/^\/circles\/\d+\/ghost-settings$/.test(normalizedPath)) return true;
    if (/^\/policy\/circles\/\d+\/profile$/.test(normalizedPath)) return true;
    if (/^\/fork\/circles\/\d+\/lineage$/.test(normalizedPath)) return true;
    if (/^\/extensions\/capabilities$/.test(normalizedPath)) return true;
    return false;
}

export function isDraftRuntimeReadPath(method: string | undefined, path: string | undefined): boolean {
    if (String(method || '').toUpperCase() !== 'GET') return false;
    const normalizedPath = String(path || '');
    if (/^\/draft-lifecycle\/drafts\/\d+$/.test(normalizedPath)) return true;
    if (/^\/discussion\/drafts\/\d+\/discussions$/.test(normalizedPath)) return true;
    if (/^\/discussion\/drafts\/\d+\/content$/.test(normalizedPath)) return true;
    if (/^\/drafts\/\d+\/reference-links$/.test(normalizedPath)) return true;
    if (/^\/temporary-edit-grants\/drafts\/\d+\/temporary-edit-grants$/.test(normalizedPath)) return true;
    if (/^\/revision-directions\/drafts\/\d+\/revision-directions$/.test(normalizedPath)) return true;
    if (/^\/circles\/\d+\/source-materials$/.test(normalizedPath)) return true;
    if (/^\/ai-jobs$/.test(normalizedPath)) return true;
    return false;
}

function resolveRateLimitBucket(method: string | undefined, path: string | undefined): string {
    if (isDiscussionMessageReadPath(method, path)) return DISCUSSION_READ_BUCKET;
    if (isDiscussionMessageWritePath(method, path)) return DISCUSSION_WRITE_BUCKET;
    if (isAuthSessionPath(method, path)) return AUTH_SESSION_BUCKET;
    if (isCircleRuntimeReadPath(method, path)) return CIRCLE_RUNTIME_BUCKET;
    if (isDraftRuntimeReadPath(method, path)) return DRAFT_RUNTIME_BUCKET;
    return API_DEFAULT_BUCKET;
}

function resolveRateLimitActorKey(input: {
    userId?: unknown;
    senderPubkey?: unknown;
    ip: string | undefined | null;
}): string {
    const senderPubkey = typeof input.senderPubkey === 'string' ? input.senderPubkey.trim() : '';
    if (senderPubkey) {
        return `sender:${senderPubkey}`;
    }

    const parsedUserId = Number(input.userId);
    if (Number.isFinite(parsedUserId) && parsedUserId > 0) {
        return `user:${Math.floor(parsedUserId)}`;
    }

    const normalizedIp = String(input.ip || '').trim() || 'unknown';
    return `ip:${normalizedIp}`;
}

export function resolveRateLimitBucketKey(input: {
    method: string | undefined;
    path: string | undefined;
    ip: string | undefined | null;
    userId?: unknown;
    senderPubkey?: unknown;
}): string {
    const bucket = resolveRateLimitBucket(input.method, input.path);
    const actorKey = resolveRateLimitActorKey({
        userId: input.userId,
        senderPubkey: input.senderPubkey,
        ip: input.ip,
    });
    return `${bucket}:${actorKey}`;
}

function resolveBucketMax(bucketKey: string): number {
    if (bucketKey.startsWith(`${DISCUSSION_READ_BUCKET}:`)) {
        return rateLimitSettings.discussionReadMax;
    }
    if (bucketKey.startsWith(`${DISCUSSION_WRITE_BUCKET}:`)) {
        return rateLimitSettings.discussionWriteMax;
    }
    if (bucketKey.startsWith(`${AUTH_SESSION_BUCKET}:`)) {
        return rateLimitSettings.authSessionMax;
    }
    if (bucketKey.startsWith(`${CIRCLE_RUNTIME_BUCKET}:`)) {
        return rateLimitSettings.circleRuntimeMax;
    }
    if (bucketKey.startsWith(`${DRAFT_RUNTIME_BUCKET}:`)) {
        return rateLimitSettings.draftRuntimeMax;
    }
    return rateLimitSettings.defaultMax;
}

export const rateLimiter = rateLimit({
    windowMs: rateLimitSettings.windowMs,
    max: (req) => {
        const bucketKey = resolveRateLimitBucketKey({
            method: req.method,
            path: req.path,
            ip: req.ip,
            userId: (req as any).userId,
            senderPubkey: (req as any).body?.senderPubkey,
        });
        return resolveBucketMax(bucketKey);
    },
    keyGenerator: (req) =>
        resolveRateLimitBucketKey({
            method: req.method,
            path: req.path,
            ip: req.ip,
            userId: (req as any).userId,
            senderPubkey: (req as any).body?.senderPubkey,
        }),
    message: {
        error: 'Too many requests',
        message: 'Please try again later',
    },
    standardHeaders: true,
    legacyHeaders: false,
});
