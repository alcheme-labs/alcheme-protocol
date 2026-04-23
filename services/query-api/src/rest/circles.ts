import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { loadGhostConfig } from '../ai/ghost/config';
import {
    loadCircleGhostSettingsPatch,
    loadPendingCircleGhostSettingsPatch,
    resolveCircleGhostSettings,
    upsertPendingCircleGhostSettings,
    upsertCircleGhostSettings,
} from '../ai/ghost/circle-settings';
import { verifyEd25519SignatureBase64 } from '../services/offchainDiscussion';
import {
    normalizeCircleGenesisModeForStorage,
    type CircleGenesisMode,
} from '../services/circleGenesisMode';
import {
    buildCircleSettingsSigningMessage,
    buildCircleSettingsSigningPayload,
    buildStoredCircleSettingsEnvelopeSection,
    isCircleSettingsSignatureFresh,
    parseCircleSettingsSignedMessage,
    persistCircleSettingsEnvelopeSection,
} from '../services/policy/settingsEnvelope';
import { invalidateDiscussionTopicProfileCache } from '../services/discussion/topicProfile';

const GHOST_SETTINGS_SIGNING_PREFIX = 'alcheme-circle-ghost-settings:';
const CIRCLE_GENESIS_MODE_SIGNING_PREFIX = 'alcheme-circle-genesis-mode:';

interface GhostSettingsSignedPayload {
    v: 1;
    action: 'ghost_settings_update';
    circleId: number;
    actorPubkey: string;
    patch: Record<string, unknown>;
    clientTimestamp: string;
    nonce: string;
    creationTxSignature?: string | null;
}

interface CircleGenesisModeSignedPayload {
    v: 1;
    action: 'genesis_mode_update';
    circleId: number;
    actorPubkey: string;
    genesisMode: CircleGenesisMode;
    clientTimestamp: string;
    nonce: string;
}

function parseBoolLike(value: unknown): boolean | null {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === '1' || normalized === 'true') return true;
        if (normalized === '0' || normalized === 'false') return false;
    }
    return null;
}

function normalizePatchForSigning(input: Record<string, unknown>): Record<string, unknown> {
    const patch: Record<string, unknown> = {};
    if (Object.prototype.hasOwnProperty.call(input, 'summaryUseLLM')) {
        const parsed = parseBoolLike(input.summaryUseLLM);
        if (parsed !== null) patch.summaryUseLLM = parsed;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'draftTriggerMode')) {
        patch.draftTriggerMode = String(input.draftTriggerMode || '').toLowerCase() === 'auto_draft'
            ? 'auto_draft'
            : 'notify_only';
    }
    if (Object.prototype.hasOwnProperty.call(input, 'triggerSummaryUseLLM')) {
        const parsed = parseBoolLike(input.triggerSummaryUseLLM);
        if (parsed !== null) patch.triggerSummaryUseLLM = parsed;
    }
    return patch;
}

function buildGhostSettingsSigningPayload(input: {
    circleId: number;
    actorPubkey: string;
    patch: Record<string, unknown>;
    clientTimestamp: string;
    nonce: string;
    creationTxSignature?: string | null;
}): GhostSettingsSignedPayload {
    return {
        v: 1,
        action: 'ghost_settings_update',
        circleId: input.circleId,
        actorPubkey: input.actorPubkey,
        patch: normalizePatchForSigning(input.patch),
        clientTimestamp: input.clientTimestamp,
        nonce: input.nonce,
        creationTxSignature: input.creationTxSignature || null,
    };
}

function buildGhostSettingsSigningMessage(payload: GhostSettingsSignedPayload): string {
    return `${GHOST_SETTINGS_SIGNING_PREFIX}${JSON.stringify(payload)}`;
}

function parseGhostSettingsSignedMessage(raw: unknown): GhostSettingsSignedPayload | null {
    if (typeof raw !== 'string' || !raw.startsWith(GHOST_SETTINGS_SIGNING_PREFIX)) return null;
    try {
        const parsed = JSON.parse(raw.slice(GHOST_SETTINGS_SIGNING_PREFIX.length));
        if (!parsed || typeof parsed !== 'object') return null;
        if (parsed.v !== 1 || parsed.action !== 'ghost_settings_update') return null;
        return parsed as GhostSettingsSignedPayload;
    } catch {
        return null;
    }
}

function buildCircleGenesisModeSigningPayload(input: {
    circleId: number;
    actorPubkey: string;
    genesisMode: unknown;
    clientTimestamp: string;
    nonce: string;
}): CircleGenesisModeSignedPayload {
    return {
        v: 1,
        action: 'genesis_mode_update',
        circleId: input.circleId,
        actorPubkey: input.actorPubkey,
        genesisMode: normalizeCircleGenesisModeForStorage(input.genesisMode),
        clientTimestamp: input.clientTimestamp,
        nonce: input.nonce,
    };
}

function buildCircleGenesisModeSigningMessage(payload: CircleGenesisModeSignedPayload): string {
    return `${CIRCLE_GENESIS_MODE_SIGNING_PREFIX}${JSON.stringify(payload)}`;
}

function parseCircleGenesisModeSignedMessage(raw: unknown): CircleGenesisModeSignedPayload | null {
    if (typeof raw !== 'string' || !raw.startsWith(CIRCLE_GENESIS_MODE_SIGNING_PREFIX)) return null;
    try {
        const parsed = JSON.parse(raw.slice(CIRCLE_GENESIS_MODE_SIGNING_PREFIX.length));
        if (!parsed || typeof parsed !== 'object') return null;
        if (parsed.v !== 1 || parsed.action !== 'genesis_mode_update') return null;
        return parsed as CircleGenesisModeSignedPayload;
    } catch {
        return null;
    }
}

function isTimestampWithinWindow(timestampIso: string, windowMs: number): boolean {
    const ts = new Date(timestampIso).getTime();
    if (!Number.isFinite(ts)) return false;
    return Math.abs(Date.now() - ts) <= windowMs;
}

function stringifyCachePayload(value: unknown): string {
    return JSON.stringify(value, (_key, nestedValue) =>
        typeof nestedValue === 'bigint' ? nestedValue.toString() : nestedValue);
}

function toJsonPayload<T>(value: T): T {
    return JSON.parse(stringifyCachePayload(value)) as T;
}

function extractSignerPubkeys(tx: any): Set<string> {
    const signers = new Set<string>();
    const accountKeys = tx?.transaction?.message?.accountKeys;
    if (Array.isArray(accountKeys)) {
        for (const key of accountKeys) {
            if (typeof key === 'object' && key && key.signer && typeof key.pubkey === 'string') {
                signers.add(key.pubkey);
            }
        }
    }
    if (signers.size === 0 && Array.isArray(accountKeys)) {
        const signatures = tx?.transaction?.signatures;
        if (Array.isArray(signatures)) {
            const signerCount = Math.min(signatures.length, accountKeys.length);
            for (let i = 0; i < signerCount; i += 1) {
                const key = accountKeys[i];
                if (typeof key === 'string') {
                    signers.add(key);
                } else if (typeof key?.pubkey === 'string') {
                    signers.add(key.pubkey);
                }
            }
        }
    }
    return signers;
}

function transactionMentionsProgram(tx: any, programId: string): boolean {
    if (!programId) return true;
    const accountKeysRaw = tx?.transaction?.message?.accountKeys;
    const accountKeys = Array.isArray(accountKeysRaw)
        ? accountKeysRaw.map((item: any) => (typeof item === 'string' ? item : String(item?.pubkey || '')))
        : [];
    const instructions = tx?.transaction?.message?.instructions;
    if (!Array.isArray(instructions)) return false;
    for (const ix of instructions) {
        if (typeof ix?.programId === 'string' && ix.programId === programId) return true;
        if (typeof ix?.programIdIndex === 'number') {
            const indexedProgram = accountKeys[ix.programIdIndex];
            if (indexedProgram === programId) return true;
        }
    }
    return false;
}

async function fetchTransactionFromRpc(signature: string): Promise<any | null> {
    const rpcUrl = process.env.SOLANA_RPC_URL || process.env.RPC_URL;
    if (!rpcUrl) return null;
    const timeoutMs = Math.max(1000, Number(process.env.GHOST_SETTINGS_RPC_TIMEOUT_MS || '5000'));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'getTransaction',
                params: [
                    signature,
                    {
                        encoding: 'jsonParsed',
                        maxSupportedTransactionVersion: 0,
                        commitment: 'confirmed',
                    },
                ],
            }),
            signal: controller.signal,
        });
        if (!response.ok) return null;
        const payload = await response.json();
        return payload?.result || null;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function verifyPendingCreationTx(input: {
    actorPubkey: string;
    txSignature: string | null;
}): Promise<{ ok: boolean; reason?: string }> {
    if (!input.txSignature) return { ok: false, reason: 'missing_creation_tx_signature' };
    const tx = await fetchTransactionFromRpc(input.txSignature);
    if (!tx) return { ok: false, reason: 'creation_tx_not_found' };
    if (tx?.meta?.err) return { ok: false, reason: 'creation_tx_failed' };

    const maxAgeSec = Math.max(60, Number(process.env.GHOST_SETTINGS_PENDING_TX_MAX_AGE_SEC || '1800'));
    const blockTime = Number(tx?.blockTime || 0);
    if (!Number.isFinite(blockTime) || blockTime <= 0) {
        return { ok: false, reason: 'creation_tx_missing_blocktime' };
    }
    const ageSec = Math.floor(Date.now() / 1000) - blockTime;
    if (ageSec > maxAgeSec) {
        return { ok: false, reason: 'creation_tx_too_old' };
    }

    const signers = extractSignerPubkeys(tx);
    if (!signers.has(input.actorPubkey)) {
        return { ok: false, reason: 'creation_tx_signer_mismatch' };
    }

    const circlesProgramId = String(
        process.env.CIRCLES_PROGRAM_ID
        || process.env.NEXT_PUBLIC_CIRCLES_PROGRAM_ID
        || '',
    ).trim();
    if (circlesProgramId && !transactionMentionsProgram(tx, circlesProgramId)) {
        return { ok: false, reason: 'creation_tx_program_mismatch' };
    }

    return { ok: true };
}

async function ensureActorCanManageCircle(
    prisma: PrismaClient,
    circleId: number,
    actorPubkey: string,
): Promise<boolean> {
    const circle = await prisma.circle.findUnique({
        where: { id: circleId },
        select: {
            creator: { select: { pubkey: true } },
        },
    });
    if (!circle) return false;
    if (circle.creator.pubkey === actorPubkey) return true;

    const actor = await prisma.user.findUnique({
        where: { pubkey: actorPubkey },
        select: { id: true },
    });
    if (!actor) return false;

    const member = await prisma.circleMember.findUnique({
        where: {
            circleId_userId: {
                circleId,
                userId: actor.id,
            },
        },
        select: {
            role: true,
            status: true,
        },
    });
    if (!member || member.status !== 'Active') return false;
    return member.role === 'Owner' || member.role === 'Admin';
}

export function circleRouter(prisma: PrismaClient, redis: Redis): Router {
    const router = Router();
    const ghostConfig = loadGhostConfig();

    // GET /api/v1/circles/:id
    router.get('/:id', async (req, res, next) => {
        try {
            const id = parseInt(req.params.id);
            const cacheKey = `circle:${id}`;

            const cached = await redis.get(cacheKey);
            if (cached) {
                return res.json(JSON.parse(cached));
            }

            const circle = await prisma.circle.findUnique({
                where: { id },
                include: {
                    creator: {
                        select: {
                            handle: true,
                            displayName: true,
                            avatarUri: true,
                        },
                    },
                },
            });

            if (!circle) {
                return res.status(404).json({ error: 'Circle not found' });
            }

            const payload = toJsonPayload(circle);
            await redis.setex(cacheKey, 300, stringifyCachePayload(payload));

            res.json(payload);
        } catch (error) {
            next(error);
        }
    });

    // GET /api/v1/circles/:id/members
    router.get('/:id/members', async (req, res, next) => {
        try {
            const id = parseInt(req.params.id);
            const limit = parseInt(req.query.limit as string) || 50;

            const members = await prisma.circleMember.findMany({
                where: { circleId: id },
                take: limit,
                include: {
                    user: {
                        select: {
                            handle: true,
                            displayName: true,
                            avatarUri: true,
                        },
                    },
                },
            });

            res.json(members);
        } catch (error) {
            next(error);
        }
    });

    // GET /api/v1/circles/:id/posts
    router.get('/:id/posts', async (req, res, next) => {
        try {
            const id = parseInt(req.params.id);
            const limit = parseInt(req.query.limit as string) || 20;

            const posts = await prisma.post.findMany({
                where: { circleId: id },
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    author: {
                        select: {
                            handle: true,
                            displayName: true,
                            avatarUri: true,
                        },
                    },
                },
            });

            res.json(posts);
        } catch (error) {
            next(error);
        }
    });

    // GET /api/v1/circles/:id/members/:userId/identity
    router.get('/:id/members/:userId/identity', async (req, res, next) => {
        try {
            const circleId = parseInt(req.params.id);
            const userId = parseInt(req.params.userId);

            const member = await prisma.circleMember.findUnique({
                where: { circleId_userId: { circleId, userId } },
                select: {
                    identityLevel: true,
                    role: true,
                    status: true,
                    joinedAt: true,
                },
            });

            if (!member) {
                return res.status(404).json({ error: 'Member not found in circle' });
            }

            res.json({
                circleId,
                userId,
                identityLevel: member.identityLevel,
                role: member.role,
                status: member.status,
                joinedAt: member.joinedAt,
            });
        } catch (error) {
            next(error);
        }
    });

    // POST /api/v1/circles/:id/members/:userId/identity/evaluate
    // Trigger identity re-evaluation for a specific member
    router.post('/:id/members/:userId/identity/evaluate', async (req, res, next) => {
        try {
            const circleId = parseInt(req.params.id);
            const userId = parseInt(req.params.userId);

            const { evaluateAndUpdate } = await import('../identity/machine');
            const result = await evaluateAndUpdate(prisma, userId, circleId);

            res.json(result);
        } catch (error) {
            next(error);
        }
    });

    // GET /api/v1/circles/:id/ghost-settings
    router.get('/:id/ghost-settings', async (req, res, next) => {
        try {
            const circleId = parseInt(req.params.id, 10);
            if (!Number.isFinite(circleId)) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }

            const circle = await prisma.circle.findUnique({
                where: { id: circleId },
                select: { id: true },
            });
            const persistedPatch = await loadCircleGhostSettingsPatch(prisma, circleId);
            const pendingPatch = persistedPatch
                ? null
                : await loadPendingCircleGhostSettingsPatch(prisma, circleId);
            const patch = persistedPatch ?? pendingPatch;
            const effective = resolveCircleGhostSettings(ghostConfig, patch);
            return res.json({
                circleId,
                source: persistedPatch ? 'circle' : pendingPatch ? 'pending' : 'global_default',
                pendingCircleIndex: !circle && !!pendingPatch,
                settings: effective,
            });
        } catch (error) {
            next(error);
        }
    });

    // PUT /api/v1/circles/:id/ghost-settings
    router.put('/:id/ghost-settings', async (req, res, next) => {
        try {
            const circleId = parseInt(req.params.id, 10);
            if (!Number.isFinite(circleId)) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }

            const circle = await prisma.circle.findUnique({
                where: { id: circleId },
                select: { id: true },
            });

            const incoming = (req.body && typeof req.body === 'object') ? req.body : {};
            const patch: Record<string, unknown> = {};
            const assignIfProvided = (key: string) => {
                if (Object.prototype.hasOwnProperty.call(incoming, key)) {
                    patch[key] = (incoming as Record<string, unknown>)[key];
                }
            };
            assignIfProvided('summaryUseLLM');
            assignIfProvided('draftTriggerMode');
            assignIfProvided('triggerSummaryUseLLM');
            assignIfProvided('triggerGenerateComment');

            const actorPubkey = typeof incoming.actorPubkey === 'string'
                ? incoming.actorPubkey.trim()
                : '';
            const signedMessage = typeof incoming.signedMessage === 'string'
                ? incoming.signedMessage
                : '';
            const signature = typeof incoming.signature === 'string'
                ? incoming.signature
                : '';
            const canonicalSignedPayload = parseCircleSettingsSignedMessage(signedMessage);
            const legacySignedPayload = parseGhostSettingsSignedMessage(signedMessage);
            const signedPayload = canonicalSignedPayload?.settingKind === 'ghost_settings'
                ? canonicalSignedPayload
                : legacySignedPayload;
            if (!actorPubkey || !signedPayload || !signature) {
                return res.status(401).json({
                    error: 'ghost_settings_auth_required',
                    message: 'actorPubkey/signedMessage/signature are required',
                });
            }
            if (!verifyEd25519SignatureBase64({
                senderPubkey: actorPubkey,
                message: signedMessage,
                signatureBase64: signature,
            })) {
                return res.status(401).json({
                    error: 'invalid_ghost_settings_signature',
                });
            }
            const expectedMessage = canonicalSignedPayload?.settingKind === 'ghost_settings'
                ? buildCircleSettingsSigningMessage(buildCircleSettingsSigningPayload({
                    circleId,
                    actorPubkey,
                    settingKind: 'ghost_settings',
                    payload: patch,
                    clientTimestamp: canonicalSignedPayload.clientTimestamp,
                    nonce: canonicalSignedPayload.nonce,
                    anchor: canonicalSignedPayload.anchor ?? null,
                }))
                : buildGhostSettingsSigningMessage(buildGhostSettingsSigningPayload({
                    circleId,
                    actorPubkey,
                    patch,
                    clientTimestamp: (signedPayload as GhostSettingsSignedPayload).clientTimestamp,
                    nonce: (signedPayload as GhostSettingsSignedPayload).nonce,
                    creationTxSignature: (signedPayload as GhostSettingsSignedPayload).creationTxSignature || null,
                }));
            if (expectedMessage !== signedMessage) {
                return res.status(400).json({
                    error: 'ghost_settings_signature_payload_mismatch',
                });
            }
            const signatureWindowMs = Math.max(60_000, Number(process.env.GHOST_SETTINGS_SIGNATURE_WINDOW_MS || '300000'));
            const signatureFresh = canonicalSignedPayload?.settingKind === 'ghost_settings'
                ? isCircleSettingsSignatureFresh({
                    clientTimestamp: canonicalSignedPayload.clientTimestamp,
                    windowMs: signatureWindowMs,
                })
                : isTimestampWithinWindow((signedPayload as GhostSettingsSignedPayload).clientTimestamp, signatureWindowMs);
            if (!signatureFresh) {
                return res.status(401).json({
                    error: 'ghost_settings_signature_expired',
                });
            }
            const nonce = String((signedPayload as any).nonce || '').trim();
            if (!/^[A-Za-z0-9_-]{8,128}$/.test(nonce)) {
                return res.status(400).json({
                    error: 'invalid_ghost_settings_nonce',
                });
            }
            const nonceTtlSec = Math.max(60, Number(process.env.GHOST_SETTINGS_NONCE_TTL_SEC || '600'));
            const nonceKey = `ghost_settings:nonce:${actorPubkey}:${nonce}`;
            const nonceStored = await redis.set(nonceKey, '1', 'EX', nonceTtlSec, 'NX');
            if (nonceStored !== 'OK') {
                return res.status(409).json({
                    error: 'ghost_settings_replay_detected',
                });
            }

            if (circle) {
                const canManage = await ensureActorCanManageCircle(prisma, circleId, actorPubkey);
                if (!canManage) {
                    return res.status(403).json({
                        error: 'forbidden_circle_ghost_settings_update',
                    });
                }
            } else {
                const creationTxSignature = canonicalSignedPayload?.settingKind === 'ghost_settings'
                    ? String(canonicalSignedPayload.anchor?.creationTxSignature || '')
                    : String((signedPayload as GhostSettingsSignedPayload).creationTxSignature || '');
                const pendingTxValidation = await verifyPendingCreationTx({
                    actorPubkey,
                    txSignature: creationTxSignature || null,
                });
                if (!pendingTxValidation.ok) {
                    return res.status(403).json({
                        error: 'pending_ghost_settings_creation_tx_invalid',
                        reason: pendingTxValidation.reason,
                    });
                }
            }

            let savedPatch;
            try {
                savedPatch = circle
                    ? await upsertCircleGhostSettings(prisma, circleId, patch as any)
                    : await upsertPendingCircleGhostSettings(prisma, circleId, patch as any, actorPubkey);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error ?? '');
                if (message.includes('pending_ghost_settings_limit_exceeded')) {
                    return res.status(429).json({
                        error: 'pending_ghost_settings_limit_exceeded',
                    });
                }
                throw error;
            }
            const effective = resolveCircleGhostSettings(ghostConfig, savedPatch);
            await persistCircleSettingsEnvelopeSection(prisma, {
                circleId,
                section: buildStoredCircleSettingsEnvelopeSection({
                    settingKind: 'ghost_settings',
                    payload: effective as unknown as Record<string, unknown>,
                    actorPubkey,
                    signedMessage,
                    signature,
                    clientTimestamp: String((signedPayload as any).clientTimestamp || ''),
                    nonce,
                    anchor: canonicalSignedPayload?.settingKind === 'ghost_settings'
                        ? canonicalSignedPayload.anchor ?? null
                        : ((signedPayload as GhostSettingsSignedPayload).creationTxSignature
                            ? { creationTxSignature: (signedPayload as GhostSettingsSignedPayload).creationTxSignature }
                            : null),
                }),
            });
            return res.status(circle ? 200 : 202).json({
                ok: true,
                circleId,
                source: circle ? 'circle' : 'pending',
                pendingCircleIndex: !circle,
                settings: effective,
            });
        } catch (error) {
            next(error);
        }
    });

    // PUT /api/v1/circles/:id/genesis-mode
    router.put('/:id/genesis-mode', async (req, res, next) => {
        try {
            const circleId = parseInt(req.params.id, 10);
            if (!Number.isFinite(circleId)) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }

            const incoming = (req.body && typeof req.body === 'object') ? req.body : {};
            const actorPubkey = typeof incoming.actorPubkey === 'string'
                ? incoming.actorPubkey.trim()
                : '';
            const signedMessage = typeof incoming.signedMessage === 'string'
                ? incoming.signedMessage
                : '';
            const signature = typeof incoming.signature === 'string'
                ? incoming.signature
                : '';
            const canonicalSignedPayload = parseCircleSettingsSignedMessage(signedMessage);
            const legacySignedPayload = parseCircleGenesisModeSignedMessage(signedMessage);
            const signedPayload = canonicalSignedPayload?.settingKind === 'genesis_mode'
                ? canonicalSignedPayload
                : legacySignedPayload;

            if (!actorPubkey || !signedPayload || !signature) {
                return res.status(401).json({
                    error: 'circle_genesis_mode_auth_required',
                    message: 'actorPubkey/signedMessage/signature are required',
                });
            }

            if (!verifyEd25519SignatureBase64({
                senderPubkey: actorPubkey,
                message: signedMessage,
                signatureBase64: signature,
            })) {
                return res.status(401).json({ error: 'invalid_circle_genesis_mode_signature' });
            }

            let genesisMode: CircleGenesisMode;
            try {
                genesisMode = normalizeCircleGenesisModeForStorage(incoming.genesisMode);
            } catch {
                return res.status(400).json({ error: 'invalid_circle_genesis_mode' });
            }

            const expectedMessage = canonicalSignedPayload?.settingKind === 'genesis_mode'
                ? buildCircleSettingsSigningMessage(buildCircleSettingsSigningPayload({
                    circleId,
                    actorPubkey,
                    settingKind: 'genesis_mode',
                    payload: {
                        genesisMode,
                    },
                    clientTimestamp: canonicalSignedPayload.clientTimestamp,
                    nonce: canonicalSignedPayload.nonce,
                    anchor: canonicalSignedPayload.anchor ?? null,
                }))
                : buildCircleGenesisModeSigningMessage(buildCircleGenesisModeSigningPayload({
                    circleId,
                    actorPubkey,
                    genesisMode,
                    clientTimestamp: (signedPayload as CircleGenesisModeSignedPayload).clientTimestamp,
                    nonce: (signedPayload as CircleGenesisModeSignedPayload).nonce,
                }));
            if (expectedMessage !== signedMessage) {
                return res.status(400).json({
                    error: 'circle_genesis_mode_signature_payload_mismatch',
                });
            }
            if (
                canonicalSignedPayload?.settingKind === 'genesis_mode'
                && !isCircleSettingsSignatureFresh({
                    clientTimestamp: canonicalSignedPayload.clientTimestamp,
                    windowMs: Number(process.env.CIRCLE_SETTINGS_SIGNATURE_WINDOW_MS || '300000'),
                })
            ) {
                return res.status(401).json({ error: 'circle_genesis_mode_signature_expired' });
            }

            const canManage = await ensureActorCanManageCircle(prisma, circleId, actorPubkey);
            if (!canManage) {
                return res.status(403).json({ error: 'circle_genesis_mode_forbidden' });
            }

            const updated = await prisma.circle.update({
                where: { id: circleId },
                data: { genesisMode },
                select: { id: true, genesisMode: true },
            });
            await persistCircleSettingsEnvelopeSection(prisma, {
                circleId,
                section: buildStoredCircleSettingsEnvelopeSection({
                    settingKind: 'genesis_mode',
                    payload: {
                        genesisMode: updated.genesisMode,
                    },
                    actorPubkey,
                    signedMessage,
                    signature,
                    clientTimestamp: String((signedPayload as any).clientTimestamp || ''),
                    nonce: String((signedPayload as any).nonce || ''),
                    anchor: canonicalSignedPayload?.settingKind === 'genesis_mode'
                        ? canonicalSignedPayload.anchor ?? null
                        : null,
                }),
            });

            return res.json({
                ok: true,
                circleId: updated.id,
                genesisMode: updated.genesisMode,
            });
        } catch (error) {
            next(error);
        }
    });

    // PUT /api/v1/circles/:id/metadata
    router.put('/:id/metadata', async (req, res, next) => {
        try {
            const circleId = parseInt(req.params.id, 10);
            if (!Number.isFinite(circleId)) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }

            const incoming = (req.body && typeof req.body === 'object') ? req.body : {};
            const actorPubkey = typeof incoming.actorPubkey === 'string'
                ? incoming.actorPubkey.trim()
                : '';
            const signedMessage = typeof incoming.signedMessage === 'string'
                ? incoming.signedMessage
                : '';
            const signature = typeof incoming.signature === 'string'
                ? incoming.signature
                : '';
            const signedPayload = parseCircleSettingsSignedMessage(signedMessage);

            if (!actorPubkey || !signedPayload || !signature || signedPayload.settingKind !== 'circle_metadata') {
                return res.status(401).json({
                    error: 'circle_metadata_auth_required',
                    message: 'actorPubkey/signedMessage/signature are required',
                });
            }

            if (!verifyEd25519SignatureBase64({
                senderPubkey: actorPubkey,
                message: signedMessage,
                signatureBase64: signature,
            })) {
                return res.status(401).json({ error: 'invalid_circle_metadata_signature' });
            }

            const description = typeof incoming.description === 'string'
                ? incoming.description.trim().slice(0, 280)
                : '';
            const normalizedDescription = description || null;

            const expectedMessage = buildCircleSettingsSigningMessage(buildCircleSettingsSigningPayload({
                circleId,
                actorPubkey,
                settingKind: 'circle_metadata',
                payload: {
                    description: normalizedDescription,
                },
                clientTimestamp: signedPayload.clientTimestamp,
                nonce: signedPayload.nonce,
                anchor: signedPayload.anchor ?? null,
            }));
            if (expectedMessage !== signedMessage) {
                return res.status(400).json({
                    error: 'circle_metadata_signature_payload_mismatch',
                });
            }
            if (!isCircleSettingsSignatureFresh({
                clientTimestamp: signedPayload.clientTimestamp,
                windowMs: Number(process.env.CIRCLE_SETTINGS_SIGNATURE_WINDOW_MS || '300000'),
            })) {
                return res.status(401).json({ error: 'circle_metadata_signature_expired' });
            }

            const canManage = await ensureActorCanManageCircle(prisma, circleId, actorPubkey);
            if (!canManage) {
                return res.status(403).json({ error: 'circle_metadata_forbidden' });
            }

            const updated = await prisma.circle.update({
                where: { id: circleId },
                data: { description: normalizedDescription },
                select: {
                    id: true,
                    name: true,
                    description: true,
                },
            });

            await persistCircleSettingsEnvelopeSection(prisma, {
                circleId,
                section: buildStoredCircleSettingsEnvelopeSection({
                    settingKind: 'circle_metadata',
                    payload: {
                        description: updated.description,
                    },
                    actorPubkey,
                    signedMessage,
                    signature,
                    clientTimestamp: signedPayload.clientTimestamp,
                    nonce: signedPayload.nonce,
                    anchor: signedPayload.anchor ?? null,
                }),
            });

            await redis.del(`circle:${circleId}`);
            invalidateDiscussionTopicProfileCache(circleId);

            return res.json({
                ok: true,
                circleId: updated.id,
                metadata: {
                    name: updated.name,
                    description: updated.description,
                },
            });
        } catch (error) {
            next(error);
        }
    });

    return router;
}
