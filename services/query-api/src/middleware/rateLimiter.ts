import rateLimit from 'express-rate-limit';

import { getCommunicationRateLimitSession } from './communicationRateLimitSession';

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MAX = 100;
const DEFAULT_DISCUSSION_READ_MAX = 1200;
const DEFAULT_DISCUSSION_WRITE_MAX = 240;
const DEFAULT_COMMUNICATION_READ_MAX = 1200;
const DEFAULT_COMMUNICATION_STREAM_MAX = 30;
const DEFAULT_COMMUNICATION_WRITE_MAX = 240;
const DEFAULT_COMMUNICATION_BOOTSTRAP_MAX = 240;
const DEFAULT_AUTH_SESSION_MAX = 600;
const DEFAULT_CIRCLE_RUNTIME_MAX = 600;
const DEFAULT_GOVERNANCE_BOOTSTRAP_WRITE_MAX = 30;
const DEFAULT_DRAFT_RUNTIME_MAX = 1200;
const DISCUSSION_READ_BUCKET = 'discussion_read';
const DISCUSSION_WRITE_BUCKET = 'discussion_write';
const COMMUNICATION_READ_BUCKET = 'communication_read';
const COMMUNICATION_STREAM_BUCKET = 'communication_stream';
const COMMUNICATION_WRITE_BUCKET = 'communication_write';
const COMMUNICATION_BOOTSTRAP_BUCKET = 'communication_bootstrap';
const COMMUNICATION_CONTROL_BUCKET = 'communication_control';
const AUTH_SESSION_BUCKET = 'auth_session';
const CIRCLE_RUNTIME_BUCKET = 'circle_runtime';
const GOVERNANCE_BOOTSTRAP_WRITE_BUCKET = 'governance_bootstrap_write';
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
    communicationReadMax: number;
    communicationStreamMax: number;
    communicationWriteMax: number;
    communicationBootstrapMax: number;
    authSessionMax: number;
    circleRuntimeMax: number;
    governanceBootstrapWriteMax: number;
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
        communicationReadMax: parsePositiveInt(
            env.COMMUNICATION_READ_RATE_LIMIT_MAX,
            DEFAULT_COMMUNICATION_READ_MAX,
        ),
        communicationStreamMax: parsePositiveInt(
            env.COMMUNICATION_STREAM_RATE_LIMIT_MAX,
            DEFAULT_COMMUNICATION_STREAM_MAX,
        ),
        communicationWriteMax: parsePositiveInt(
            env.COMMUNICATION_WRITE_RATE_LIMIT_MAX,
            DEFAULT_COMMUNICATION_WRITE_MAX,
        ),
        communicationBootstrapMax: parsePositiveInt(
            env.COMMUNICATION_BOOTSTRAP_RATE_LIMIT_MAX,
            DEFAULT_COMMUNICATION_BOOTSTRAP_MAX,
        ),
        authSessionMax: parsePositiveInt(
            env.AUTH_SESSION_RATE_LIMIT_MAX,
            DEFAULT_AUTH_SESSION_MAX,
        ),
        circleRuntimeMax: parsePositiveInt(
            env.CIRCLE_RUNTIME_RATE_LIMIT_MAX,
            DEFAULT_CIRCLE_RUNTIME_MAX,
        ),
        governanceBootstrapWriteMax: parsePositiveInt(
            env.GOVERNANCE_BOOTSTRAP_WRITE_RATE_LIMIT_MAX,
            DEFAULT_GOVERNANCE_BOOTSTRAP_WRITE_MAX,
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
    if (/^\/discussion\/circles\/\d+\/messages\/lookup$/.test(normalizedPath)) return true;
    if (/^\/discussion\/circles\/\d+\/stream$/.test(normalizedPath)) return true;
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

export function isCommunicationReadPath(method: string | undefined, path: string | undefined): boolean {
    if (String(method || '').toUpperCase() !== 'GET') return false;
    const normalizedPath = normalizeCommunicationPath(path);
    return /^\/communication\/rooms\/[^/]+(?:\/messages)?$/.test(normalizedPath);
}

export function isCommunicationStreamPath(method: string | undefined, path: string | undefined): boolean {
    if (String(method || '').toUpperCase() !== 'GET') return false;
    return /^\/communication\/rooms\/[^/]+\/stream$/.test(normalizeCommunicationPath(path));
}

export function isCommunicationWritePath(method: string | undefined, path: string | undefined): boolean {
    if (String(method || '').toUpperCase() !== 'POST') return false;
    return /^\/communication\/rooms\/[^/]+\/messages$/.test(normalizeCommunicationPath(path));
}

export function isCommunicationBootstrapPath(method: string | undefined, path: string | undefined): boolean {
    const normalizedMethod = String(method || '').toUpperCase();
    const normalizedPath = normalizeCommunicationPath(path);
    if (normalizedMethod === 'POST' && normalizedPath === '/communication/rooms/resolve') return true;
    if (
        normalizedMethod === 'POST'
        && /^\/communication\/rooms\/[^/]+\/members$/.test(normalizedPath)
    ) return true;
    if (
        normalizedMethod === 'POST'
        && /^\/communication\/circles\/\d+\/room-session$/.test(normalizedPath)
    ) return true;
    if (normalizedMethod === 'POST' && normalizedPath === '/communication/sessions') return true;
    return ['POST', 'DELETE'].includes(normalizedMethod)
        && /^\/communication\/sessions\/[^/]+(?:\/refresh)?$/.test(normalizedPath);
}

function isCommunicationPath(path: string | undefined): boolean {
    return /^\/communication(?:\/|$)/.test(normalizeCommunicationPath(path));
}

function normalizeCommunicationPath(path: string | undefined): string {
    const normalized = String(path || '');
    return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
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
    if (/^\/circles\/\d+\/aliases\/me$/.test(normalizedPath)) return true;
    if (/^\/circles\/\d+\/ghost-settings$/.test(normalizedPath)) return true;
    if (/^\/circles\/\d+\/authority\/owner-transfer-requests$/.test(normalizedPath)) return true;
    if (/^\/policy\/circles\/\d+\/profile$/.test(normalizedPath)) return true;
    if (/^\/governance\/circles\/\d+\/governance-bindings$/.test(normalizedPath)) return true;
    if (/^\/governance\/circles\/\d+\/committee-profile$/.test(normalizedPath)) return true;
    if (/^\/governance\/circles\/\d+\/requests$/.test(normalizedPath)) return true;
    if (/^\/governance\/circles\/\d+\/cases$/.test(normalizedPath)) return true;
    if (/^\/governance\/circles\/\d+\/provider-trust\/(?:realms|squads)\/readback$/.test(normalizedPath)) {
        return true;
    }
    if (/^\/governance\/cases\/(?:inbox|[^/]+)$/.test(normalizedPath)) return true;
    if (/^\/circles\/\d+\/governance-bootstrap$/.test(normalizedPath)) return true;
    if (/^\/circles\/\d+\/governance-bootstrap\/ceremonies\/[^/]+$/.test(normalizedPath)) return true;
    if (/^\/external-apps\/circle-bindings\/by-circle\/\d+$/.test(normalizedPath)) return true;
    if (/^\/fork\/circles\/\d+\/lineage$/.test(normalizedPath)) return true;
    if (/^\/extensions\/capabilities$/.test(normalizedPath)) return true;
    return false;
}

export function isCircleRuntimeWritePath(method: string | undefined, path: string | undefined): boolean {
    const normalizedMethod = String(method || '').toUpperCase();
    const normalizedPath = String(path || '');
    if (['PUT', 'DELETE'].includes(normalizedMethod)
        && /^\/circles\/\d+\/aliases\/me$/.test(normalizedPath)) return true;
    return false;
}

export function isGovernanceBootstrapWritePath(
    method: string | undefined,
    path: string | undefined,
): boolean {
    if (String(method || '').toUpperCase() !== 'POST') return false;
    const normalizedPath = String(path || '');
    if (/^\/circles\/\d+\/governance-bootstrap$/.test(normalizedPath)) return true;
    if (/^\/circles\/\d+\/governance-bootstrap\/ceremony-preview$/.test(normalizedPath)) return true;
    return /^\/circles\/\d+\/governance-bootstrap\/ceremonies\/[^/]+\/(?:open|founding-request|activate)$/.test(
        normalizedPath,
    );
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
    if (isCommunicationStreamPath(method, path)) return COMMUNICATION_STREAM_BUCKET;
    if (isCommunicationReadPath(method, path)) return COMMUNICATION_READ_BUCKET;
    if (isCommunicationWritePath(method, path)) return COMMUNICATION_WRITE_BUCKET;
    if (isCommunicationBootstrapPath(method, path)) return COMMUNICATION_BOOTSTRAP_BUCKET;
    if (isCommunicationPath(path)) return COMMUNICATION_CONTROL_BUCKET;
    if (isDiscussionMessageReadPath(method, path)) return DISCUSSION_READ_BUCKET;
    if (isDiscussionMessageWritePath(method, path)) return DISCUSSION_WRITE_BUCKET;
    if (isAuthSessionPath(method, path)) return AUTH_SESSION_BUCKET;
    if (isCircleRuntimeReadPath(method, path)) return CIRCLE_RUNTIME_BUCKET;
    if (isGovernanceBootstrapWritePath(method, path)) return GOVERNANCE_BOOTSTRAP_WRITE_BUCKET;
    if (isCircleRuntimeWritePath(method, path)) return CIRCLE_RUNTIME_BUCKET;
    if (isDraftRuntimeReadPath(method, path)) return DRAFT_RUNTIME_BUCKET;
    return API_DEFAULT_BUCKET;
}

function resolveRateLimitActorKey(input: {
    communicationWalletPubkey?: unknown;
    userId?: unknown;
    senderPubkey?: unknown;
    ip: string | undefined | null;
}): string {
    const communicationWalletPubkey = typeof input.communicationWalletPubkey === 'string'
        ? input.communicationWalletPubkey.trim()
        : '';
    if (communicationWalletPubkey) {
        return `wallet:${communicationWalletPubkey}`;
    }

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
    communicationWalletPubkey?: unknown;
    userId?: unknown;
    senderPubkey?: unknown;
}): string {
    const bucket = resolveRateLimitBucket(input.method, input.path);
    const communicationBucket = bucket.startsWith('communication_');
    const actorKey = resolveRateLimitActorKey({
        communicationWalletPubkey: input.communicationWalletPubkey,
        userId: input.userId,
        // Communication senderPubkey is request body input. It is not an
        // authenticated actor until the room session has been validated.
        senderPubkey: communicationBucket ? undefined : input.senderPubkey,
        ip: input.ip,
    });
    return `${bucket}:${actorKey}`;
}

export interface RateLimitAdmissionInput {
    method: string;
    path: string;
    ip: string | undefined | null;
    communicationWalletPubkey?: unknown;
    userId?: unknown;
    senderPubkey?: unknown;
}

export interface RateLimitAdmissionResult {
    allowed: boolean;
    bucketKey: string;
}

function resolveBucketMax(bucketKey: string): number {
    if (bucketKey.startsWith(`${COMMUNICATION_STREAM_BUCKET}:`)) {
        return rateLimitSettings.communicationStreamMax;
    }
    if (bucketKey.startsWith(`${COMMUNICATION_READ_BUCKET}:`)) {
        return rateLimitSettings.communicationReadMax;
    }
    if (bucketKey.startsWith(`${COMMUNICATION_WRITE_BUCKET}:`)) {
        return rateLimitSettings.communicationWriteMax;
    }
    if (bucketKey.startsWith(`${COMMUNICATION_BOOTSTRAP_BUCKET}:`)) {
        return rateLimitSettings.communicationBootstrapMax;
    }
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
    if (bucketKey.startsWith(`${GOVERNANCE_BOOTSTRAP_WRITE_BUCKET}:`)) {
        return rateLimitSettings.governanceBootstrapWriteMax;
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
            communicationWalletPubkey: getCommunicationRateLimitSession(req)?.walletPubkey,
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
            communicationWalletPubkey: getCommunicationRateLimitSession(req)?.walletPubkey
                ?? (req as any).communicationWalletPubkey,
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

export function checkRateLimitAdmission(
    input: RateLimitAdmissionInput,
): Promise<RateLimitAdmissionResult> {
    const bucketKey = resolveRateLimitBucketKey(input);
    return new Promise((resolve, reject) => {
        let settled = false;
        const settle = (allowed: boolean) => {
            if (settled) return;
            settled = true;
            resolve({ allowed, bucketKey });
        };
        const headers = new Map<string, unknown>();
        const req = {
            method: input.method,
            path: input.path,
            ip: input.ip || undefined,
            communicationWalletPubkey: input.communicationWalletPubkey,
            userId: input.userId,
            body: input.senderPubkey ? { senderPubkey: input.senderPubkey } : {},
            headers: {},
            app: {
                get: () => false,
            },
        };
        const res = {
            headersSent: false,
            statusCode: 200,
            setHeader(name: string, value: unknown) {
                headers.set(name.toLowerCase(), value);
                return this;
            },
            getHeader(name: string) {
                return headers.get(name.toLowerCase());
            },
            removeHeader(name: string) {
                headers.delete(name.toLowerCase());
                return this;
            },
            status(code: number) {
                this.statusCode = code;
                return this;
            },
            send() {
                this.headersSent = true;
                settle(false);
                return this;
            },
            json() {
                this.headersSent = true;
                settle(false);
                return this;
            },
            end() {
                this.headersSent = true;
                settle(false);
                return this;
            },
        };

        try {
            rateLimiter(req as any, res as any, (error?: unknown) => {
                if (error) {
                    reject(error);
                    return;
                }
                settle(true);
            });
        } catch (error) {
            reject(error);
        }
    });
}
