import { Router } from 'express';
import type { Prisma, PrismaClient } from '@prisma/client';
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
    isPublicDemoAdmissionRequired,
    parseSessionLoginMessage,
    type PublicDemoAdmissionRequestPayload,
} from '../auth/session';
import {
    verifyIdentityAccount,
    type IdentityAccountVerification,
} from '../services/chain/accountPresence';
import { isPublicHardeningRequired } from '../config/jwtSecret';
import {
    CURRENT_PUBLIC_DEMO_ADMISSION_POLICY,
    assertCurrentPublicDemoAdmission,
    recordPublicDemoAdmission,
} from '../services/governance/publicDemoAdmission';

const SESSION_USER_SELECT = {
    id: true,
    pubkey: true,
    handle: true,
    displayName: true,
    avatarUri: true,
    createdAt: true,
} as const;

type SessionUserRow = Prisma.UserGetPayload<{ select: typeof SESSION_USER_SELECT }>;

type RegisteredSessionUserResult =
    | { ok: true; user: SessionUserRow }
    | { ok: false; statusCode: 401; code: 'identity_not_registered'; clearSession: boolean }
    | { ok: false; statusCode: 503; code: 'identity_verification_unavailable'; clearSession: false; message: string; reason: string };

function isIdentityProjectionInvalid(verification: Exclude<IdentityAccountVerification, { ok: true }>): boolean {
    return verification.presence === 'missing' || verification.presence === 'mismatch';
}

function identityVerificationFailureResult(
    verification: Exclude<IdentityAccountVerification, { ok: true }>,
): Exclude<RegisteredSessionUserResult, { ok: true }> {
    if (isIdentityProjectionInvalid(verification)) {
        return {
            ok: false,
            statusCode: 401,
            code: 'identity_not_registered',
            clearSession: true,
        };
    }
    return {
        ok: false,
        statusCode: 503,
        code: 'identity_verification_unavailable',
        clearSession: false,
        message: verification.message,
        reason: verification.reason,
    };
}

async function loadRegisteredSessionUser(
    prisma: PrismaClient,
    publicKey: string,
): Promise<RegisteredSessionUserResult> {
    const user = await prisma.user.findUnique({
        where: { pubkey: publicKey },
        select: SESSION_USER_SELECT,
    });
    if (!user) {
        return {
            ok: false,
            statusCode: 401,
            code: 'identity_not_registered',
            clearSession: true,
        };
    }

    const identity = await verifyIdentityAccount({
        handle: user.handle,
        expectedPubkey: user.pubkey,
    });
    if (!identity.ok) {
        return identityVerificationFailureResult(identity);
    }

    return { ok: true, user };
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined) return fallback;
    const normalized = value.trim().toLowerCase();
    if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true;
    if (normalized === '0' || normalized === 'false' || normalized === 'no') return false;
    return fallback;
}

function requireSessionSignature(): boolean {
    const defaultValue = isPublicHardeningRequired(process.env);
    return parseBool(process.env.AUTH_SESSION_REQUIRE_SIGNATURE, defaultValue);
}

function enableLegacyJwtLogin(): boolean {
    return parseBool(process.env.AUTH_ENABLE_LEGACY_JWT_LOGIN, false);
}

function parsePublicDemoAdmissionQuery(query: Record<string, unknown>): PublicDemoAdmissionRequestPayload | undefined {
    const policyVersion = String(query.admissionPolicyVersion || '').trim();
    const jurisdiction = String(query.admissionJurisdiction || '').trim();
    const region = String(query.admissionRegion || '').trim();
    const anyAdmissionField = Boolean(policyVersion || jurisdiction || region)
        || query.adultAttested !== undefined
        || query.termsAccepted !== undefined
        || query.privacyAccepted !== undefined
        || query.safetyPolicyAccepted !== undefined;
    if (!anyAdmissionField) return undefined;
    return {
        policyVersion,
        jurisdiction,
        region,
        adultAttested: String(query.adultAttested || '').toLowerCase() === 'true',
        termsAccepted: String(query.termsAccepted || '').toLowerCase() === 'true',
        privacyAccepted: String(query.privacyAccepted || '').toLowerCase() === 'true',
        safetyPolicyAccepted: String(query.safetyPolicyAccepted || '').toLowerCase() === 'true',
    };
}

function publicDemoAdmissionPolicyResponse() {
    return {
        required: isPublicDemoAdmissionRequired(),
        version: CURRENT_PUBLIC_DEMO_ADMISSION_POLICY.version,
        jurisdiction: CURRENT_PUBLIC_DEMO_ADMISSION_POLICY.jurisdiction,
        minimumAge: CURRENT_PUBLIC_DEMO_ADMISSION_POLICY.minimumAge,
        supportedRegions: CURRENT_PUBLIC_DEMO_ADMISSION_POLICY.supportedRegions,
        chinaAvailability: CURRENT_PUBLIC_DEMO_ADMISSION_POLICY.chinaAvailability,
        dataBoundary: 'attestation_only_no_birth_date_or_identity_document',
    };
}

function publicDemoAdmissionError(error: unknown): { code: string; message: string } | null {
    const message = error instanceof Error ? error.message : String(error || '');
    if (message === 'public_demo_region_not_supported') {
        return {
            code: message,
            message: 'The public demo is not available in China pending separate compliance support.',
        };
    }
    if (message === 'public_demo_admission_required' || message === 'public_demo_admission_invalid') {
        return {
            code: message,
            message: 'Adult public-demo admission must be accepted for the current policy version.',
        };
    }
    return null;
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

    router.get('/public-demo-policy', (_req, res) => {
        return res.json(publicDemoAdmissionPolicyResponse());
    });

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
            let result;
            try {
                result = await createSessionLoginNonce(redis, {
                    publicKey,
                    domain,
                    publicDemoAdmission: parsePublicDemoAdmissionQuery(req.query as Record<string, unknown>),
                });
            } catch (error) {
                if (error instanceof Error && error.message === 'public_demo_admission_incomplete') {
                    return res.status(400).json({
                        code: error.message,
                        error: 'Public demo admission fields must all be explicitly accepted.',
                    });
                }
                throw error;
            }

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

            const enforceSignature = requireSessionSignature() || isPublicDemoAdmissionRequired();
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

            let publicDemoAdmission = null;
            if (isPublicDemoAdmissionRequired()) {
                try {
                    if (parsed.publicDemoAdmission) {
                        await recordPublicDemoAdmission(prisma, {
                            walletPublicKey: publicKey,
                            signedMessage: message,
                            admission: parsed.publicDemoAdmission,
                        });
                    }
                    publicDemoAdmission = await assertCurrentPublicDemoAdmission(prisma, publicKey);
                } catch (error) {
                    const admissionError = publicDemoAdmissionError(error);
                    if (admissionError) {
                        return res.status(403).json({
                            code: admissionError.code,
                            error: admissionError.message,
                            policy: publicDemoAdmissionPolicyResponse(),
                        });
                    }
                    throw error;
                }
            }

            const userResult = await loadRegisteredSessionUser(prisma, publicKey);
            if (!userResult.ok) {
                if (userResult.code === 'identity_verification_unavailable') {
                    return res.status(userResult.statusCode).json({
                        code: userResult.code,
                        error: userResult.message,
                        reason: userResult.reason,
                        recoverable: true,
                    });
                }
                return res.status(401).json({
                    code: 'identity_not_registered',
                    error: 'User not registered. Please register on-chain first.',
                });
            }
            const user = userResult.user;

            if (isPublicDemoAdmissionRequired()) {
                try {
                    publicDemoAdmission = await assertCurrentPublicDemoAdmission(prisma, user.pubkey, user.id);
                } catch (error) {
                    const admissionError = publicDemoAdmissionError(error);
                    if (admissionError) {
                        return res.status(403).json({
                            code: admissionError.code,
                            error: admissionError.message,
                            policy: publicDemoAdmissionPolicyResponse(),
                        });
                    }
                    throw error;
                }
            }

            if (!enforceSignature && !validSignature) {
                console.warn(
                    `auth session login accepted without signature in non-production mode for ${publicKey}`,
                );
            }

            const { sessionId, record } = await createAuthSession(redis, {
                userId: user.id,
                pubkey: user.pubkey,
                ...(publicDemoAdmission ? {
                    publicDemoAdmission: {
                        policyVersion: publicDemoAdmission.policyVersion,
                        acceptanceDigest: publicDemoAdmission.acceptanceDigest,
                    },
                } : {}),
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
                publicDemoAdmission: publicDemoAdmission
                    ? {
                        policyVersion: publicDemoAdmission.policyVersion,
                        jurisdiction: publicDemoAdmission.jurisdiction,
                        region: publicDemoAdmission.region,
                        acceptedAt: publicDemoAdmission.acceptedAt,
                        acceptanceDigest: publicDemoAdmission.acceptanceDigest,
                    }
                    : { required: false },
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

            let publicDemoAdmission = null;
            if (isPublicDemoAdmissionRequired()) {
                try {
                    publicDemoAdmission = await assertCurrentPublicDemoAdmission(prisma, user.pubkey, user.id);
                } catch (error) {
                    const admissionError = publicDemoAdmissionError(error);
                    if (admissionError) {
                        const sessionId = String((req as any).sessionId || '').trim();
                        if (sessionId) {
                            await deleteAuthSession(redis, sessionId);
                        }
                        res.clearCookie(getAuthSessionCookieName(), getAuthSessionCookieOptions());
                        return res.status(403).json({
                            authenticated: false,
                            code: admissionError.code,
                            error: admissionError.message,
                            policy: publicDemoAdmissionPolicyResponse(),
                        });
                    }
                    throw error;
                }
            }

            const identity = await verifyIdentityAccount({
                handle: user.handle,
                expectedPubkey: user.pubkey,
            });
            if (!identity.ok) {
                const failure = identityVerificationFailureResult(identity);
                if (failure.code === 'identity_verification_unavailable') {
                    return res.status(failure.statusCode).json({
                        authenticated: false,
                        code: failure.code,
                        error: failure.message,
                        reason: failure.reason,
                        recoverable: true,
                    });
                }
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
                publicDemoAdmission: publicDemoAdmission
                    ? {
                        policyVersion: publicDemoAdmission.policyVersion,
                        jurisdiction: publicDemoAdmission.jurisdiction,
                        region: publicDemoAdmission.region,
                        acceptedAt: publicDemoAdmission.acceptedAt,
                        acceptanceDigest: publicDemoAdmission.acceptanceDigest,
                    }
                    : { required: false },
            });
        } catch (error) {
            return next(error);
        }
    });

    return router;
}
