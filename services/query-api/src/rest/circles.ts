import { Router, type Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { loadGhostConfig } from '../ai/ghost/config';
import {
    loadCircleGhostSettingsPatch,
    loadPendingCircleGhostSettingsPatch,
    resolveCircleGhostSettings,
    upsertPendingCircleGhostSettings,
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
import {
    applyCircleGenesisSetting,
    applyCircleGhostSetting,
    applyCircleMetadataSetting,
    applyCirclePostCreateSettings,
    CircleSettingsWriteError,
    invalidateCircleMetadataSettingCaches,
} from '../services/policy/postCreateSettings';
import {
    CIRCLE_POLICY_COMMUNITY_PROFILE_UPDATE_ACTION_TYPE,
    CIRCLE_POLICY_GENESIS_UPDATE_ACTION_TYPE,
    CIRCLE_POLICY_GHOST_UPDATE_ACTION_TYPE,
    CIRCLE_POLICY_METADATA_UPDATE_ACTION_TYPE,
    evaluateCirclePolicyGovernance,
    executeCirclePolicyDirectOperation,
    openCirclePolicyOperationAppeal,
    resolveCirclePolicyOperationAppeal,
} from '../services/governance/circlePolicyGovernance';
import { isInternalApiRequest } from '../security/internalAuth';
import {
    AuthActorError,
    requireAuthenticatedActor,
    requireCircleActor,
    requireCircleManagerActor,
} from '../services/auth/actor';
import {
    executeSharedCommitteeContentVisibilityDownrank,
    openContentVisibilityDownrankAppeal,
    readContentVisibilityDownrankAppealAccess,
} from '../services/governance/contentVisibilityDownrank';
import {
    readActiveFeedRankingPolicy,
    resolveFeedGovernanceActorCapability,
} from '../services/governance/feedRankingPolicy';
import { updateFeedRankingPolicyWithApplication } from '../services/governance/feedPolicyApplication';
import {
    readFeedRecommendationExperiments,
    startFeedRecommendationExperiment,
    stopFeedRecommendationExperiment,
} from '../services/governance/feedRecommendationExperiment';
import {
    listOperatorCapabilitySuspensions,
    openOperatorCapabilitySuspensionRatificationCase,
    suspendOperatorCapability,
} from '../services/governance/operatorCapabilitySuspension';
import { readActivePlatformSafetyLegalStatuses } from '../services/governance/platformSafety';
import { resolveActorCanManageCircle } from '../services/circles/managePermission';
import {
    bootstrapNewCircleGovernanceHome,
    createNewCircleSafeDefaultReader,
    reenterExistingCircleGovernanceHome,
} from '../services/governance/governanceNewCircleBootstrapRuntime';
import { governanceBootstrapProfileBindingId } from '../services/governance/governanceProfileLifecycle';
import {
    activateCircleGovernanceBootstrapCeremony,
    openCircleGovernanceBootstrapCeremony,
    openCircleGovernanceBootstrapFoundingRequest,
    prepareCircleGovernanceBootstrapPreview,
} from '../services/governance/governanceBootstrapCircleSurface';
import {
    createGovernanceBootstrapLocalnetCircleReader,
} from '../services/governance/governanceBootstrapLocalnetAdapter';
import {
    GOVERNANCE_BOOTSTRAP_CIRCLE_MANAGER_PROGRAM_ID,
} from '../services/governance/governanceBootstrapCeremonyContract';
import { requirePrivateSidecarSurface } from '../config/services';

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

function transactionContainsCircleCreateV2(
    tx: any,
    programId: string,
    circleAccountRef: string,
): boolean {
    const accountKeysRaw = tx?.transaction?.message?.accountKeys;
    const accountKeys = Array.isArray(accountKeysRaw)
        ? accountKeysRaw.map((item: any) => (typeof item === 'string' ? item : String(item?.pubkey || '')))
        : [];
    if (!accountKeys.includes(circleAccountRef)) return false;
    const expectedDiscriminator = createHash('sha256')
        .update('global:create_circle_v2')
        .digest()
        .subarray(0, 8);
    const instructions = tx?.transaction?.message?.instructions;
    if (!Array.isArray(instructions)) return false;
    return instructions.some((instruction: any) => {
        const instructionProgramId = typeof instruction?.programId === 'string'
            ? instruction.programId
            : accountKeys[instruction?.programIdIndex];
        if (instructionProgramId !== programId || typeof instruction?.data !== 'string') return false;
        try {
            return Buffer.from(bs58.decode(instruction.data)).subarray(0, 8).equals(expectedDiscriminator);
        } catch {
            return false;
        }
    });
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
    enforceFreshness?: boolean;
    expectedCircleAccountRef?: string;
}): Promise<{ ok: boolean; reason?: string }> {
    if (!input.txSignature) return { ok: false, reason: 'missing_creation_tx_signature' };
    const tx = await fetchTransactionFromRpc(input.txSignature);
    if (!tx) return { ok: false, reason: 'creation_tx_not_found' };
    if (tx?.meta?.err) return { ok: false, reason: 'creation_tx_failed' };

    if (input.enforceFreshness !== false) {
        const maxAgeSec = Math.max(60, Number(process.env.GHOST_SETTINGS_PENDING_TX_MAX_AGE_SEC || '1800'));
        const blockTime = Number(tx?.blockTime || 0);
        if (!Number.isFinite(blockTime) || blockTime <= 0) {
            return { ok: false, reason: 'creation_tx_missing_blocktime' };
        }
        const ageSec = Math.floor(Date.now() / 1000) - blockTime;
        if (ageSec > maxAgeSec) {
            return { ok: false, reason: 'creation_tx_too_old' };
        }
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
    if (
        input.expectedCircleAccountRef
        && !transactionContainsCircleCreateV2(tx, circlesProgramId, input.expectedCircleAccountRef)
    ) {
        return { ok: false, reason: 'creation_tx_circle_or_instruction_mismatch' };
    }

    return { ok: true };
}

function sendCircleRouteError(res: Response, error: unknown): boolean {
    if (error instanceof AuthActorError) {
        res.status(error.statusCode).json(error.toResponseBody());
        return true;
    }
    if (error instanceof CircleSettingsWriteError) {
        res.status(error.statusCode).json(error.body);
        return true;
    }
    return false;
}

function sendGovernedActionAppealRouteError(res: Response, error: unknown): boolean {
    const code = error instanceof Error ? error.message : '';
    if (!code.startsWith('governed_action_appeal_')) return false;
    if (code === 'governed_action_appeal_missing') {
        res.status(404).json({ error: code });
        return true;
    }
    if (code.endsWith('_invalid') || code.endsWith('_required')) {
        res.status(400).json({ error: code });
        return true;
    }
    if (code.includes('_conflict') || code.includes('_authority_')) {
        res.status(403).json({ error: code });
        return true;
    }
    res.status(409).json({ error: code });
    return true;
}

function sendGovernanceExecutionSidecarRequired(res: Response): boolean {
    const gate = requirePrivateSidecarSurface('governance_execution');
    if (gate.ok) return false;
    res.status(gate.statusCode).json({ error: gate.error, route: gate.route });
    return true;
}

export function circleRouter(prisma: PrismaClient, redis: Redis): Router {
    const router = Router();
    const ghostConfig = loadGhostConfig();

    router.post('/:id/operation-receipts/:receiptId/appeals', async (req, res, next) => {
        try {
            if (sendGovernanceExecutionSidecarRequired(res)) return;
            const circleId = Number(req.params.id);
            if (!Number.isInteger(circleId) || circleId <= 0) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            const actor = await requireCircleActor(req, prisma, {
                circleId,
                action: 'circle.read',
                requireSessionCookie: true,
                requireMemberChainPresence: false,
            });
            const result = await openCirclePolicyOperationAppeal(prisma, {
                circleId,
                originalReceiptId: String(req.params.receiptId || '').trim(),
                appellantPubkey: actor.pubkey,
                reasonCode: String(req.body?.reasonCode || '').trim(),
                evidence: req.body?.evidence && typeof req.body.evidence === 'object'
                    ? req.body.evidence
                    : {},
            });
            return res.status(result.replayed ? 200 : 201).json(result);
        } catch (error) {
            if (sendCircleRouteError(res, error)) return;
            if (sendGovernedActionAppealRouteError(res, error)) return;
            next(error);
        }
    });

    router.post('/:id/governed-action-appeals/:appealId/resolution', async (req, res, next) => {
        try {
            if (sendGovernanceExecutionSidecarRequired(res)) return;
            const circleId = Number(req.params.id);
            if (!Number.isInteger(circleId) || circleId <= 0) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            const reviewer = await requireCircleActor(req, prisma, {
                circleId,
                action: 'circle.manage',
                minRole: 'Admin',
                requireSessionCookie: true,
            });
            const result = await resolveCirclePolicyOperationAppeal(prisma, {
                circleId,
                appealId: String(req.params.appealId || '').trim(),
                reviewerPubkey: reviewer.pubkey,
                outcome: req.body?.outcome,
                reasonCode: String(req.body?.reasonCode || '').trim(),
                evidence: req.body?.evidence && typeof req.body.evidence === 'object'
                    ? req.body.evidence
                    : {},
            });
            return res.status(result.replayed ? 200 : 201).json(result);
        } catch (error) {
            if (sendCircleRouteError(res, error)) return;
            if (sendGovernedActionAppealRouteError(res, error)) return;
            next(error);
        }
    });

    router.post('/:id/governance-bootstrap', async (req, res, next) => {
        try {
            const circleId = Number(req.params.id);
            const mode = typeof req.body?.mode === 'string' ? req.body.mode.trim() : '';
            if (!Number.isInteger(circleId) || circleId < 0 || circleId > 255) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            if (mode === 'authoritative_chain_reentry') {
                if (circleId < 1) return res.status(400).json({ error: 'invalid_circle_id' });
                const runtime = loadGovernanceBootstrapCircleReentryRuntimeConfig();
                const actor = await requireCircleActor(req, prisma, {
                    circleId,
                    action: 'circle.owner',
                    minRole: 'Owner',
                    requireSessionCookie: true,
                    requireMemberChainPresence: false,
                });
                const result = await reenterExistingCircleGovernanceHome({
                    prisma: prisma as any,
                    chainReader: createNewCircleSafeDefaultReader({
                        rpcUrl: runtime.rpcUrl,
                        programId: runtime.programId,
                        commitment: 'finalized',
                    }),
                }, { circleId, actorPubkey: actor.pubkey });
                return res.json({
                    ok: true,
                    circleId,
                    homeIdentityBindingId: result.identity.id,
                    activationState: result.activation.state,
                    profileBindingId: result.profileBinding.id,
                    chainStateDigest: result.readback.stateDigest,
                    observedSlot: result.readback.observedSlot,
                });
            }
            const actorPubkey = typeof req.body?.actorPubkey === 'string' ? req.body.actorPubkey.trim() : '';
            const creationTxSignature = typeof req.body?.creationTxSignature === 'string'
                ? req.body.creationTxSignature.trim()
                : '';
            if (!actorPubkey || !creationTxSignature) {
                return res.status(400).json({ error: 'new_circle_governance_bootstrap_evidence_required' });
            }
            const programId = String(
                process.env.CIRCLES_PROGRAM_ID || process.env.NEXT_PUBLIC_CIRCLES_PROGRAM_ID || '',
            ).trim();
            if (!programId) {
                return res.status(503).json({ error: 'new_circle_governance_bootstrap_chain_unavailable' });
            }
            const [circleAccount] = PublicKey.findProgramAddressSync(
                [Buffer.from('circle'), Buffer.from([circleId])],
                new PublicKey(programId),
            );
            const transactionEvidence = await verifyPendingCreationTx({
                actorPubkey,
                txSignature: creationTxSignature,
                enforceFreshness: false,
                expectedCircleAccountRef: circleAccount.toBase58(),
            });
            if (!transactionEvidence.ok) {
                return res.status(409).json({
                    error: 'new_circle_creation_transaction_unverified',
                    reason: transactionEvidence.reason,
                });
            }
            const rpcUrl = String(process.env.SOLANA_RPC_URL || process.env.RPC_URL || '').trim();
            if (!rpcUrl || !programId) {
                return res.status(503).json({ error: 'new_circle_governance_bootstrap_chain_unavailable' });
            }
            const result = await bootstrapNewCircleGovernanceHome({
                prisma: prisma as any,
                chainReader: createNewCircleSafeDefaultReader({ rpcUrl, programId }),
            }, {
                circleId,
                actorPubkey,
                creationTxSignature,
            });
            return res.json({
                ok: true,
                circleId,
                homeIdentityBindingId: result.identity.id,
                activationState: result.activation.state,
                profileBindingId: result.profileBinding.id,
                chainStateDigest: result.readback.stateDigest,
                observedSlot: result.readback.observedSlot,
            });
        } catch (error) {
            if (sendCircleRouteError(res, error)) return;
            if (sendGovernanceBootstrapRouteError(res, error)) return;
            const message = error instanceof Error ? error.message : 'new_circle_governance_bootstrap_failed';
            if (message.startsWith('new_circle_') || message.startsWith('governance_home_')) {
                return res.status(409).json({ error: message });
            }
            next(error);
        }
    });

    router.get('/:id/governance-bootstrap', async (req, res, next) => {
        try {
            const circleId = Number(req.params.id);
            if (!Number.isInteger(circleId) || circleId < 1 || circleId > 255) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            await requireCircleActor(req, prisma, {
                circleId,
                action: 'circle.read',
                requireSessionCookie: true,
                requireMemberChainPresence: false,
            });
            const homeIdentityBindingId = `governance-home-circle-${circleId}-v1`;
            const [home, profileBinding, latestCeremony] = await Promise.all([
                (prisma as any).governanceHomeIdentityBinding.findUnique({
                    where: { id: homeIdentityBindingId },
                    include: { activationState: true },
                }),
                (prisma as any).governanceProfileBinding.findUnique({
                    where: { id: governanceBootstrapProfileBindingId(homeIdentityBindingId) },
                    select: {
                        id: true,
                        state: true,
                        compatibilityStatus: true,
                        profileDefinitionVersionId: true,
                    },
                }),
                (prisma as any).governanceBootstrapCeremony.findFirst({
                    where: { homeIdentityBindingId },
                    orderBy: { createdAt: 'desc' },
                    select: {
                        id: true,
                        state: true,
                        waitingPeriodSeconds: true,
                        failureCode: true,
                        effectiveAt: true,
                        createdAt: true,
                        updatedAt: true,
                    },
                }),
            ]);
            if (!home?.activationState) {
                return res.status(404).json({ error: 'governance_bootstrap_circle_home_not_initialized' });
            }
            let runtimeBlocker: string | null = null;
            let runtimeNetwork: 'solana:localnet' | 'solana:devnet' | null = null;
            try {
                runtimeNetwork = loadGovernanceBootstrapCircleRuntimeConfig().network;
            } catch (error) {
                runtimeBlocker = error instanceof Error ? error.message : 'governance_bootstrap_runtime_disabled';
                const configuredNetwork = String(process.env.GOVERNANCE_BOOTSTRAP_CHAIN_ID || '').trim();
                runtimeNetwork = configuredNetwork === 'solana:localnet' || configuredNetwork === 'solana:devnet'
                    ? configuredNetwork
                    : null;
            }
            return res.json({
                ok: true,
                circleId,
                home: {
                    id: home.id,
                    identityVersion: home.identityVersion,
                    status: home.status,
                    chainAccountRef: home.chainAccountRef,
                },
                activation: {
                    state: home.activationState.state,
                    bootstrapBundleVersion: home.activationState.bootstrapBundleVersion,
                    bootstrapBundleDigest: home.activationState.bootstrapBundleDigest,
                    bootstrapBypassStatus: home.activationState.bootstrapBypassStatus,
                    failureCode: home.activationState.failureCode,
                    lastVerifiedAt: home.activationState.lastVerifiedAt,
                    activatedAt: home.activationState.activatedAt,
                },
                profileBinding: profileBinding ? {
                    id: profileBinding.id,
                    state: profileBinding.state,
                    compatibilityStatus: profileBinding.compatibilityStatus,
                    profileDefinitionVersionId: profileBinding.profileDefinitionVersionId,
                } : null,
                runtime: {
                    available: runtimeBlocker === null,
                    blocker: runtimeBlocker,
                    network: runtimeNetwork,
                },
                latestCeremony: latestCeremony ? {
                    ...latestCeremony,
                    availableAt: new Date(
                        new Date(latestCeremony.createdAt).getTime()
                        + latestCeremony.waitingPeriodSeconds * 1000,
                    ).toISOString(),
                } : null,
            });
        } catch (error) {
            if (sendCircleRouteError(res, error)) return;
            next(error);
        }
    });

    router.post('/:id/governance-bootstrap/ceremony-preview', async (req, res, next) => {
        try {
            const circleId = Number(req.params.id);
            const runtime = loadGovernanceBootstrapCircleRuntimeConfig();
            const actor = await requireCircleActor(req, prisma, {
                circleId,
                action: 'circle.owner',
                minRole: 'Owner',
                requireSessionCookie: true,
                requireMemberChainPresence: false,
            });
            const preview = await prepareCircleGovernanceBootstrapPreview({
                prisma,
                chainReader: createGovernanceBootstrapLocalnetCircleReader(runtime),
            }, {
                circleId,
                actorPubkey: actor.pubkey,
            });
            return res.json({ ok: true, preview });
        } catch (error) {
            if (sendCircleRouteError(res, error)) return;
            if (sendGovernanceBootstrapRouteError(res, error)) return;
            next(error);
        }
    });

    router.post('/:id/governance-bootstrap/ceremonies/:ceremonyId/open', async (req, res, next) => {
        try {
            const circleId = Number(req.params.id);
            const runtime = loadGovernanceBootstrapCircleRuntimeConfig();
            const actor = await requireCircleActor(req, prisma, {
                circleId,
                action: 'circle.owner',
                minRole: 'Owner',
                requireSessionCookie: true,
                requireMemberChainPresence: false,
            });
            const preview = req.body?.preview;
            assertGovernanceBootstrapRoutePreview(preview, circleId, req.params.ceremonyId, actor.pubkey);
            const result = await openCircleGovernanceBootstrapCeremony({
                prisma,
                chainReader: createGovernanceBootstrapLocalnetCircleReader(runtime),
            }, {
                preview,
                signatureBase64: String(req.body?.signatureBase64 || ''),
                governanceRequestId: typeof req.body?.governanceRequestId === 'string'
                    ? req.body.governanceRequestId.trim()
                    : null,
                now: new Date(),
            });
            // The timelock starts only after the server has accepted and persisted
            // the wallet signature. A preloaded preview must not consume it.
            const availableAt = new Date(
                new Date(result.opened.ceremony.createdAt).getTime()
                + result.opened.ceremony.waitingPeriodSeconds * 1000,
            ).toISOString();
            return res.json({
                ok: true,
                ceremonyId: result.opened.ceremony.id,
                state: result.opened.ceremony.state,
                availableAt,
                temporaryAuthority: result.temporaryAuthority,
            });
        } catch (error) {
            if (sendCircleRouteError(res, error)) return;
            if (sendGovernanceBootstrapRouteError(res, error)) return;
            next(error);
        }
    });

    router.post('/:id/governance-bootstrap/ceremonies/:ceremonyId/founding-request', async (req, res, next) => {
        try {
            const circleId = Number(req.params.id);
            const runtime = loadGovernanceBootstrapCircleRuntimeConfig();
            const actor = await requireCircleActor(req, prisma, {
                circleId,
                action: 'circle.owner',
                minRole: 'Owner',
                requireSessionCookie: true,
                requireMemberChainPresence: false,
            });
            const preview = req.body?.preview;
            assertGovernanceBootstrapRoutePreview(preview, circleId, req.params.ceremonyId, actor.pubkey);
            const request = await openCircleGovernanceBootstrapFoundingRequest({
                prisma,
                chainReader: createGovernanceBootstrapLocalnetCircleReader(runtime),
            }, { preview, now: new Date() });
            return res.status(201).json({
                ok: true,
                request: {
                    id: request.id,
                    state: request.state,
                    actionType: request.actionType,
                    targetType: request.targetType,
                    targetRef: request.targetRef,
                    openedAt: request.openedAt,
                    snapshot: request.snapshot,
                },
            });
        } catch (error) {
            if (sendCircleRouteError(res, error)) return;
            if (sendGovernanceBootstrapRouteError(res, error)) return;
            next(error);
        }
    });

    router.post('/:id/governance-bootstrap/ceremonies/:ceremonyId/activate', async (req, res, next) => {
        try {
            const circleId = Number(req.params.id);
            const runtime = loadGovernanceBootstrapCircleRuntimeConfig();
            const actor = await requireCircleActor(req, prisma, {
                circleId,
                action: 'circle.owner',
                minRole: 'Owner',
                requireSessionCookie: true,
                requireMemberChainPresence: false,
            });
            const result = await activateCircleGovernanceBootstrapCeremony({
                prisma,
                chainReader: createGovernanceBootstrapLocalnetCircleReader(runtime),
                rpcUrl: runtime.rpcUrl,
                programId: runtime.programId,
            }, {
                circleId,
                ceremonyId: req.params.ceremonyId,
                actorPubkey: actor.pubkey,
                now: new Date(),
            });
            if (!result.activated) {
                return res.status(409).json({
                    ok: false,
                    error: 'governance_bootstrap_not_ready',
                    gate: result.queued?.gate?.gate ?? null,
                    activationState: result.activation?.activation?.state ?? null,
                    temporaryAuthority: result.temporaryAuthority,
                });
            }
            return res.json({
                ok: true,
                ceremonyId: req.params.ceremonyId,
                state: result.activation.ceremony.state,
                activationState: result.activation.activation.state,
                effectiveAt: result.activation.activation.activatedAt,
                readbackRef: result.activation.event.readbackRef,
            });
        } catch (error) {
            if (sendCircleRouteError(res, error)) return;
            if (sendGovernanceBootstrapRouteError(res, error)) return;
            next(error);
        }
    });

    router.get('/:id/governance-bootstrap/ceremonies/:ceremonyId', async (req, res, next) => {
        try {
            const circleId = Number(req.params.id);
            loadGovernanceBootstrapCircleRuntimeConfig();
            await requireCircleActor(req, prisma, {
                circleId,
                action: 'circle.read',
                requireSessionCookie: true,
                requireMemberChainPresence: false,
            });
            const ceremony = await (prisma as any).governanceBootstrapCeremony.findUnique({
                where: { id: req.params.ceremonyId },
                include: {
                    events: { orderBy: { sequence: 'asc' } },
                    deliveries: { orderBy: { attempt: 'asc' } },
                },
            });
            if (!ceremony || ceremony.homeIdentityBindingId !== `governance-home-circle-${circleId}-v1`) {
                return res.status(404).json({ error: 'governance_bootstrap_ceremony_not_found' });
            }
            return res.json({
                ok: true,
                ceremony: {
                    id: ceremony.id,
                    state: ceremony.state,
                    actorPubkey: ceremony.actorPubkey,
                    sourceAuthorityType: ceremony.sourceAuthorityType,
                    sourceAuthorityRef: ceremony.sourceAuthorityRef,
                    configurationBundleDigest: ceremony.configurationBundleDigest,
                    governanceRequestId: ceremony.governanceRequestId,
                    confirmationPolicyVersion: ceremony.confirmationPolicyVersion,
                    waitingPeriodSeconds: ceremony.waitingPeriodSeconds,
                    readinessDigest: ceremony.readinessDigest,
                    firstExternalEffectAt: ceremony.firstExternalEffectAt,
                    effectiveAt: ceremony.effectiveAt,
                    failureCode: ceremony.failureCode,
                    createdAt: ceremony.createdAt,
                    updatedAt: ceremony.updatedAt,
                    temporaryAuthority: {
                        active: ceremony.state !== 'active',
                        retainedAfterActivation: false,
                        bypassStatus: 'disabled',
                    },
                },
                events: ceremony.events.map((event: any) => ({
                    sequence: event.sequence,
                    eventType: event.eventType,
                    status: event.status,
                    evidenceRefs: event.evidenceRefs,
                    providerRef: event.providerRef,
                    providerVersionRef: event.providerVersionRef,
                    transactionSignature: event.transactionSignature,
                    readbackRef: event.readbackRef,
                    observedAuthorityRef: event.observedAuthorityRef,
                    occurredAt: event.occurredAt,
                })),
                deliveries: ceremony.deliveries.map((delivery: any) => ({
                    operationType: delivery.operationType,
                    attempt: delivery.attempt,
                    status: delivery.status,
                    availableAt: delivery.availableAt,
                    providerRef: delivery.providerRef,
                    providerVersionRef: delivery.providerVersionRef,
                    externalRef: delivery.externalRef,
                    transactionSignature: delivery.transactionSignature,
                    errorCode: delivery.errorCode,
                    submittedAt: delivery.submittedAt,
                    confirmedAt: delivery.confirmedAt,
                })),
            });
        } catch (error) {
            if (sendCircleRouteError(res, error)) return;
            if (sendGovernanceBootstrapRouteError(res, error)) return;
            next(error);
        }
    });

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
            if (sendCircleRouteError(res, error)) return;
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
            if (sendCircleRouteError(res, error)) return;
            next(error);
        }
    });

    // GET /api/v1/circles/:id/posts
    router.get('/:id/posts', async (req, res, next) => {
        try {
            const id = parseInt(req.params.id);
            const limit = parseInt(req.query.limit as string) || 20;

            const posts = await prisma.post.findMany({
                where: { circleId: id, safetyQuarantined: false },
                take: limit,
                orderBy: [{ downranked: 'asc' }, { createdAt: 'desc' }],
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

            const legalStatuses = await readActivePlatformSafetyLegalStatuses(
                prisma as any,
                posts.map((post) => post.contentId),
            );
            const byContentId = new Map(
                legalStatuses.map((status) => [status.contentId, status]),
            );
            res.json(posts
                .filter((post) =>
                    byContentId.get(post.contentId)?.legalSafeProjection?.listRead !== 'excluded')
                .map((post) => {
                    const legalStatus = byContentId.get(post.contentId);
                    return legalStatus
                        ? { ...post, platformSafetyLegalStatus: legalStatus }
                        : post;
                }));
        } catch (error) {
            if (sendCircleRouteError(res, error)) return;
            next(error);
        }
    });

    router.post('/:id/posts/:contentId/downrank', async (req, res, next) => {
        try {
            const circleId = Number(req.params.id);
            if (!Number.isSafeInteger(circleId) || circleId <= 0) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            const actor = await requireAuthenticatedActor(req, prisma, {
                requireSessionCookie: true,
            });
            const result = await executeSharedCommitteeContentVisibilityDownrank(prisma, {
                circleId,
                actorPubkey: actor.pubkey,
                contentId: String(req.params.contentId || '').trim(),
                factorBps: Number(req.body?.factorBps),
                durationSeconds: Number(req.body?.durationSeconds),
                reasonCode: String(req.body?.reasonCode || '').trim(),
                idempotencyKey: String(req.body?.idempotencyKey || '').trim(),
            });
            return res.json({
                ok: true,
                replayed: result.replayed,
                rankingAdjustment: result.result,
                receipt: result.receipt,
                contract: result.contract,
            });
        } catch (error) {
            if (sendCircleRouteError(res, error)) return;
            const statusCode = typeof (error as { statusCode?: unknown }).statusCode === 'number'
                ? (error as { statusCode: number }).statusCode
                : null;
            if (statusCode) return res.status(statusCode).json({ error: (error as Error).message });
            const code = error instanceof Error ? error.message : 'content_visibility_downrank_failed';
            if (code.startsWith('governed_shared_committee_')
                || code === 'governed_action_authority_binding_required') {
                return res.status(403).json({ error: code });
            }
            next(error);
        }
    });

    router.post('/:id/posts/:contentId/downrank-appeals', async (req, res, next) => {
        try {
            const circleId = Number(req.params.id);
            if (!Number.isSafeInteger(circleId) || circleId <= 0) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            const actor = await requireAuthenticatedActor(req, prisma, {
                requireSessionCookie: true,
            });
            const evidence = req.body?.evidence;
            if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
                return res.status(400).json({ error: 'content_visibility_downrank_appeal_input_invalid' });
            }
            const result = await openContentVisibilityDownrankAppeal(prisma, {
                circleId,
                contentId: String(req.params.contentId || '').trim(),
                originalReceiptId: String(req.body?.originalReceiptId || '').trim(),
                appellantPubkey: actor.pubkey,
                reasonCode: String(req.body?.reasonCode || '').trim(),
                evidence,
            });
            return res.status(result.replayed ? 200 : 201).json({ ok: true, ...result });
        } catch (error) {
            if (sendCircleRouteError(res, error)) return;
            const statusCode = typeof (error as { statusCode?: unknown }).statusCode === 'number'
                ? (error as { statusCode: number }).statusCode
                : null;
            if (statusCode) return res.status(statusCode).json({ error: (error as Error).message });
            const code = error instanceof Error ? error.message : 'content_visibility_downrank_appeal_failed';
            if (code.startsWith('governed_action_appeal_')) {
                const status = code.includes('not_subject') ? 403 : code.endsWith('_invalid') ? 400 : 409;
                return res.status(status).json({ error: code });
            }
            next(error);
        }
    });

    router.get('/:id/posts/:contentId/downrank-appeal-access', async (req, res, next) => {
        try {
            const circleId = Number(req.params.id);
            if (!Number.isSafeInteger(circleId) || circleId <= 0) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            const actor = await requireAuthenticatedActor(req, prisma, {
                requireSessionCookie: true,
            });
            const result = await readContentVisibilityDownrankAppealAccess(prisma, {
                circleId,
                contentId: String(req.params.contentId || '').trim(),
                appellantPubkey: actor.pubkey,
            });
            return res.json({ ok: true, ...result });
        } catch (error) {
            if (sendCircleRouteError(res, error)) return;
            const statusCode = typeof (error as { statusCode?: unknown }).statusCode === 'number'
                ? (error as { statusCode: number }).statusCode
                : null;
            if (statusCode) return res.status(statusCode).json({ error: (error as Error).message });
            next(error);
        }
    });

    router.get('/:id/feed-ranking-policy', async (req, res, next) => {
        try {
            const circleId = Number(req.params.id);
            if (!Number.isSafeInteger(circleId) || circleId <= 0) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            const actor = await requireAuthenticatedActor(req, prisma, { requireSessionCookie: true });
            const [policy, capability] = await Promise.all([
                readActiveFeedRankingPolicy(prisma, circleId),
                resolveFeedGovernanceActorCapability(prisma, { circleId, actorPubkey: actor.pubkey }),
            ]);
            return res.json({ ok: true, policy, capability });
        } catch (error) {
            if (sendCircleRouteError(res, error)) return;
            next(error);
        }
    });

    router.post('/:id/feed-ranking-policy', async (req, res, next) => {
        try {
            const circleId = Number(req.params.id);
            if (!Number.isSafeInteger(circleId) || circleId <= 0) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            const actor = await requireAuthenticatedActor(req, prisma, { requireSessionCookie: true });
            const result = await updateFeedRankingPolicyWithApplication(prisma, {
                circleId,
                actorPubkey: actor.pubkey,
                signalKeys: Array.isArray(req.body?.signalKeys) ? req.body.signalKeys.map(String) : [],
                defaultFactorBps: Number(req.body?.defaultFactorBps),
                maxDurationSeconds: Number(req.body?.maxDurationSeconds),
                maxActiveRatioBps: Number(req.body?.maxActiveRatioBps),
                applicationMode: req.body?.applicationMode == null
                    ? 'prospective_only'
                    : String(req.body.applicationMode) as 'prospective_only' | 're_evaluate_existing_content',
                reEvaluateContentIds: Array.isArray(req.body?.reEvaluateContentIds)
                    ? req.body.reEvaluateContentIds.map(String)
                    : [],
                reEvaluateDurationSeconds: req.body?.reEvaluateDurationSeconds == null
                    ? null
                    : Number(req.body.reEvaluateDurationSeconds),
                reasonCode: String(req.body?.reasonCode || '').trim(),
                idempotencyKey: String(req.body?.idempotencyKey || '').trim(),
            });
            return res.json({
                ok: true,
                replayed: result.replayed,
                policy: result.result,
                receipt: result.receipt,
                application: result.application,
                reEvaluation: result.reEvaluation,
                reEvaluationFailures: result.reEvaluationFailures,
                reEvaluationStatus: result.reEvaluationStatus,
            });
        } catch (error) {
            if (sendCircleRouteError(res, error)) return;
            const statusCode = typeof (error as { statusCode?: unknown }).statusCode === 'number'
                ? (error as { statusCode: number }).statusCode : null;
            if (statusCode) return res.status(statusCode).json({ error: (error as Error).message });
            const code = error instanceof Error ? error.message : 'feed_ranking_policy_update_failed';
            if (code.startsWith('governed_shared_committee_')
                || code === 'governed_action_authority_binding_required') {
                return res.status(403).json({ error: code });
            }
            next(error);
        }
    });

    router.get('/:id/feed-recommendation-experiments', async (req, res, next) => {
        try {
            const circleId = Number(req.params.id);
            if (!Number.isSafeInteger(circleId) || circleId <= 0) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            await requireAuthenticatedActor(req, prisma, { requireSessionCookie: true });
            const experiments = await readFeedRecommendationExperiments(prisma, { circleId });
            return res.json({ ok: true, experiments });
        } catch (error) {
            if (sendCircleRouteError(res, error)) return;
            next(error);
        }
    });

    router.post('/:id/feed-recommendation-experiments/start', async (req, res, next) => {
        try {
            const circleId = Number(req.params.id);
            if (!Number.isSafeInteger(circleId) || circleId <= 0) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            const actor = await requireAuthenticatedActor(req, prisma, { requireSessionCookie: true });
            const result = await startFeedRecommendationExperiment(prisma, {
                circleId, actorPubkey: actor.pubkey,
                targetRatioBps: Number(req.body?.targetRatioBps),
                durationSeconds: Number(req.body?.durationSeconds),
                reasonCode: String(req.body?.reasonCode || '').trim(),
                idempotencyKey: String(req.body?.idempotencyKey || '').trim(),
            });
            return res.json({ ok: true, replayed: result.replayed, experiment: result.result, receipt: result.receipt });
        } catch (error) {
            if (sendCircleRouteError(res, error)) return;
            const statusCode = typeof (error as { statusCode?: unknown }).statusCode === 'number'
                ? (error as { statusCode: number }).statusCode : null;
            if (statusCode) return res.status(statusCode).json({ error: (error as Error).message });
            next(error);
        }
    });

    router.post('/:id/feed-recommendation-experiments/:receiptId/stop', async (req, res, next) => {
        try {
            const circleId = Number(req.params.id);
            if (!Number.isSafeInteger(circleId) || circleId <= 0) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            const actor = await requireAuthenticatedActor(req, prisma, { requireSessionCookie: true });
            const result = await stopFeedRecommendationExperiment(prisma, {
                circleId, actorPubkey: actor.pubkey,
                experimentReceiptId: String(req.params.receiptId || '').trim(),
                reasonCode: String(req.body?.reasonCode || '').trim(),
                idempotencyKey: String(req.body?.idempotencyKey || '').trim(),
            });
            return res.json({ ok: true, replayed: result.replayed, experiment: result.result, receipt: result.receipt });
        } catch (error) {
            if (sendCircleRouteError(res, error)) return;
            const statusCode = typeof (error as { statusCode?: unknown }).statusCode === 'number'
                ? (error as { statusCode: number }).statusCode : null;
            if (statusCode) return res.status(statusCode).json({ error: (error as Error).message });
            next(error);
        }
    });

    router.get('/:id/operator-capability-suspensions', async (req, res, next) => {
        try {
            const circleId = Number(req.params.id);
            if (!Number.isSafeInteger(circleId) || circleId <= 0) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            const actor = await requireAuthenticatedActor(req, prisma, { requireSessionCookie: true });
            const targetOperatorPubkey = String(req.query.targetOperatorPubkey || actor.pubkey).trim();
            let readScope: 'target_subject' | 'circle_manager' | 'issuing_operator_receipts_only';
            let issuingActorPubkey: string | null = null;
            if (targetOperatorPubkey !== actor.pubkey) {
                const canManage = await resolveActorCanManageCircle({
                    req, prisma, circleId, actorPubkey: actor.pubkey,
                });
                if (canManage) {
                    readScope = 'circle_manager';
                } else {
                    readScope = 'issuing_operator_receipts_only';
                    issuingActorPubkey = actor.pubkey;
                }
            } else {
                readScope = 'target_subject';
            }
            const suspensions = await listOperatorCapabilitySuspensions(prisma, {
                circleId,
                targetOperatorPubkey,
                issuingActorPubkey,
            });
            return res.json({ schemaVersion: 1, circleId, targetOperatorPubkey, readScope, suspensions });
        } catch (error) {
            if (sendCircleRouteError(res, error)) return;
            const statusCode = typeof (error as { statusCode?: unknown }).statusCode === 'number'
                ? (error as { statusCode: number }).statusCode : null;
            if (statusCode) return res.status(statusCode).json({ error: (error as Error).message });
            next(error);
        }
    });

    router.post('/:id/operator-capability-suspensions', async (req, res, next) => {
        try {
            const circleId = Number(req.params.id);
            if (!Number.isSafeInteger(circleId) || circleId <= 0) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            const actor = await requireAuthenticatedActor(req, prisma, { requireSessionCookie: true });
            const result = await suspendOperatorCapability(prisma, {
                circleId,
                actorPubkey: actor.pubkey,
                targetOperatorPubkey: String(req.body?.targetOperatorPubkey || '').trim(),
                targetActionType: String(req.body?.targetActionType || '').trim(),
                targetSubjectType: String(req.body?.targetSubjectType || '').trim(),
                targetSubjectRef: String(req.body?.targetSubjectRef || '').trim(),
                durationSeconds: Number(req.body?.durationSeconds),
                reasonCode: String(req.body?.reasonCode || '').trim(),
                idempotencyKey: String(req.body?.idempotencyKey || '').trim(),
                sourceReportId: req.body?.sourceReportId == null
                    ? null : String(req.body.sourceReportId).trim(),
                ratificationCaseId: req.body?.ratificationCaseId == null
                    ? null : String(req.body.ratificationCaseId).trim(),
            });
            return res.status(result.replayed ? 200 : 201).json({ ok: true, ...result });
        } catch (error) {
            if (sendCircleRouteError(res, error)) return;
            const statusCode = typeof (error as { statusCode?: unknown }).statusCode === 'number'
                ? (error as { statusCode: number }).statusCode : null;
            if (statusCode) return res.status(statusCode).json({ error: (error as Error).message });
            const code = error instanceof Error ? error.message : 'operator_capability_suspension_failed';
            if (code.startsWith('governed_shared_committee_')
                || code === 'governed_action_authority_binding_required') {
                return res.status(403).json({ error: code });
            }
            next(error);
        }
    });

    router.post('/:id/operator-capability-suspensions/:effectId/ratification-cases', async (req, res, next) => {
        try {
            const circleId = Number(req.params.id);
            if (!Number.isSafeInteger(circleId) || circleId <= 0) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            const actor = await requireCircleManagerActor(req, prisma, {
                circleId,
                allowModerator: false,
                requireSessionCookie: true,
            });
            const result = await openOperatorCapabilitySuspensionRatificationCase(prisma, {
                circleId,
                effectId: String(req.params.effectId || '').trim(),
                actorPubkey: actor.pubkey,
                actorRole: actor.membership.role,
                idempotencyKey: String(req.body?.idempotencyKey || '').trim(),
            });
            return res.status(result.replayed ? 200 : 201).json({ ok: true, ...result });
        } catch (error) {
            if (sendCircleRouteError(res, error)) return;
            const statusCode = typeof (error as { statusCode?: unknown }).statusCode === 'number'
                ? (error as { statusCode: number }).statusCode : null;
            if (statusCode) return res.status(statusCode).json({ error: (error as Error).message });
            next(error);
        }
    });

    // GET /api/v1/circles/:id/members/:userId/identity
    router.get('/:id/members/:userId/identity', async (req, res, next) => {
        try {
            const circleId = parseInt(req.params.id);
            const userId = parseInt(req.params.userId);
            if (!Number.isFinite(circleId) || !Number.isFinite(userId) || circleId <= 0 || userId <= 0) {
                return res.status(400).json({ error: 'invalid_member_identity_target' });
            }

            await requireCircleActor(req, prisma, {
                circleId,
                action: 'circle.read',
                requireSessionCookie: true,
                requireMemberChainPresence: false,
            });

            // Target-domain query after the viewer passed the circle.read actor gate.
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
            if (sendCircleRouteError(res, error)) return;
            next(error);
        }
    });

    // POST /api/v1/circles/:id/members/:userId/identity/evaluate
    // Trigger identity re-evaluation for a specific member
    router.post('/:id/members/:userId/identity/evaluate', async (req, res, next) => {
        try {
            if (!isInternalApiRequest({ headers: req.headers })) {
                return res.status(401).json({ error: 'internal_api_token_required' });
            }
            const circleId = parseInt(req.params.id);
            const userId = parseInt(req.params.userId);

            const { evaluateAndUpdate } = await import('../identity/machine');
            const result = await evaluateAndUpdate(prisma, userId, circleId);

            res.json(result);
        } catch (error) {
            if (sendCircleRouteError(res, error)) return;
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
            if (sendCircleRouteError(res, error)) return;
            next(error);
        }
    });

    // PUT /api/v1/circles/:id/post-create-settings
    router.put('/:id/post-create-settings', async (req, res, next) => {
        try {
            const circleId = parseInt(req.params.id, 10);
            if (!Number.isFinite(circleId)) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }

            const incoming = (req.body && typeof req.body === 'object') ? req.body : {};
            const actorPubkey = typeof (incoming as any).actorPubkey === 'string'
                ? (incoming as any).actorPubkey.trim()
                : '';
            const signedMessage = typeof (incoming as any).signedMessage === 'string'
                ? (incoming as any).signedMessage
                : '';
            const signature = typeof (incoming as any).signature === 'string'
                ? (incoming as any).signature
                : '';
            const signedPayload = parseCircleSettingsSignedMessage(signedMessage);

            if (!actorPubkey || !signedPayload || !signature || signedPayload.settingKind !== 'post_create_settings') {
                return res.status(401).json({
                    error: 'circle_post_create_settings_auth_required',
                    message: 'actorPubkey/signedMessage/signature are required',
                });
            }
            if (
                signedPayload.circleId !== circleId
                || signedPayload.actorPubkey !== actorPubkey
            ) {
                return res.status(400).json({ error: 'circle_post_create_settings_payload_mismatch' });
            }
            if (!verifyEd25519SignatureBase64({
                senderPubkey: actorPubkey,
                message: signedMessage,
                signatureBase64: signature,
            })) {
                return res.status(401).json({ error: 'invalid_circle_post_create_settings_signature' });
            }

            const requestPatch = (incoming as any).patch && typeof (incoming as any).patch === 'object'
                ? (incoming as any).patch
                : incoming;
            const expectedMessage = buildCircleSettingsSigningMessage(buildCircleSettingsSigningPayload({
                circleId,
                actorPubkey,
                settingKind: 'post_create_settings',
                payload: requestPatch,
                clientTimestamp: signedPayload.clientTimestamp,
                nonce: signedPayload.nonce,
                anchor: signedPayload.anchor ?? null,
            }));
            if (expectedMessage !== signedMessage) {
                return res.status(400).json({ error: 'circle_post_create_settings_payload_mismatch' });
            }
            if (!isCircleSettingsSignatureFresh({
                clientTimestamp: signedPayload.clientTimestamp,
                windowMs: Number(process.env.CIRCLE_SETTINGS_SIGNATURE_WINDOW_MS || '300000'),
            })) {
                return res.status(401).json({ error: 'circle_post_create_settings_signature_expired' });
            }
            const nonceStored = typeof (redis as any)?.set === 'function'
                ? await (redis as any).set(
                    `circle_settings:post_create_settings:${circleId}:${actorPubkey}:${signedPayload.nonce}`,
                    '1',
                    'EX',
                    Math.max(60, Number(process.env.CIRCLE_SETTINGS_NONCE_TTL_SEC || '600')),
                    'NX',
                )
                : 'OK';
            if (nonceStored !== 'OK') {
                return res.status(409).json({ error: 'circle_settings_replay_detected' });
            }

            const result = await applyCirclePostCreateSettings(prisma, redis, {
                req,
                circleId,
                actorPubkey,
                patch: signedPayload.payload as any,
                audit: {
                    signedMessage,
                    signature,
                    clientTimestamp: signedPayload.clientTimestamp,
                    nonce: signedPayload.nonce,
                    anchor: signedPayload.anchor ?? null,
                },
                ghostConfig,
            });
            return res.status(result.statusCode).json(result.body);
        } catch (error) {
            if (sendCircleRouteError(res, error)) return;
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
                const canManage = await resolveActorCanManageCircle({ req, prisma, circleId, actorPubkey });
                if (!canManage) {
                    return res.status(403).json({
                        error: 'forbidden_circle_ghost_settings_update',
                    });
                }
                const governance = await evaluateCirclePolicyGovernance(prisma, {
                    circleId,
                    actionType: CIRCLE_POLICY_GHOST_UPDATE_ACTION_TYPE,
                    actorPubkey,
                    directAllowed: canManage,
                    payload: {
                        ...normalizePatchForSigning(patch),
                        settingKind: 'ghost_settings',
                        executionDomain: 'off_chain',
                        chainStatus: 'not_required',
                    },
                });
                if (governance.status === 'requires_governance') {
                    return res.status(202).json(governance);
                }
                if (governance.status === 'denied') {
                    return res.status(403).json({ error: governance.error });
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

            if (circle) {
                const effective = await applyCircleGhostSetting(prisma, {
                    circleId,
                    actorPubkey,
                    patch: patch as any,
                    audit: {
                        signedMessage,
                        signature,
                        clientTimestamp: String((signedPayload as any).clientTimestamp || ''),
                        nonce,
                        anchor: canonicalSignedPayload?.settingKind === 'ghost_settings'
                            ? canonicalSignedPayload.anchor ?? null
                            : ((signedPayload as GhostSettingsSignedPayload).creationTxSignature
                                ? { creationTxSignature: (signedPayload as GhostSettingsSignedPayload).creationTxSignature }
                                : null),
                    },
                    ghostConfig,
                });
                return res.status(200).json({
                    ok: true,
                    circleId,
                    source: 'circle',
                    pendingCircleIndex: false,
                    settings: effective,
                });
            }

            let savedPatch;
            try {
                savedPatch = await upsertPendingCircleGhostSettings(prisma, circleId, patch as any, actorPubkey);
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
            return res.status(circle ? 200 : 202).json({
                ok: true,
                circleId,
                source: 'pending',
                pendingCircleIndex: !circle,
                settings: effective,
            });
        } catch (error) {
            if (sendCircleRouteError(res, error)) return;
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

            const canManage = await resolveActorCanManageCircle({ req, prisma, circleId, actorPubkey });
            if (!canManage) {
                return res.status(403).json({ error: 'circle_genesis_mode_forbidden' });
            }
            const governance = await evaluateCirclePolicyGovernance(prisma, {
                circleId,
                actionType: CIRCLE_POLICY_GENESIS_UPDATE_ACTION_TYPE,
                actorPubkey,
                directAllowed: canManage,
                payload: {
                    genesisMode,
                    settingKind: 'genesis_mode',
                    executionDomain: 'off_chain',
                    chainStatus: 'not_required',
                },
            });
            if (governance.status === 'requires_governance') {
                return res.status(202).json(governance);
            }
            if (governance.status === 'denied') {
                return res.status(403).json({ error: governance.error });
            }

            const updated = await applyCircleGenesisSetting(prisma, {
                circleId,
                actorPubkey,
                genesisMode,
                audit: {
                    signedMessage,
                    signature,
                    clientTimestamp: String((signedPayload as any).clientTimestamp || ''),
                    nonce: String((signedPayload as any).nonce || ''),
                    anchor: canonicalSignedPayload?.settingKind === 'genesis_mode'
                        ? canonicalSignedPayload.anchor ?? null
                        : null,
                },
            });

            return res.json({
                ok: true,
                circleId: updated.id,
                genesisMode: updated.genesisMode,
            });
        } catch (error) {
            if (sendCircleRouteError(res, error)) return;
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

            const canManage = await resolveActorCanManageCircle({ req, prisma, circleId, actorPubkey });
            if (!canManage) {
                return res.status(403).json({ error: 'circle_metadata_forbidden' });
            }
            const governancePayload = {
                description: normalizedDescription,
                settingKind: 'circle_metadata',
                signedMessage,
                signature,
                clientTimestamp: signedPayload.clientTimestamp,
                nonce: signedPayload.nonce,
                anchor: signedPayload.anchor ?? null,
                executionDomain: 'off_chain',
                chainStatus: 'not_required',
            };
            const governance = await evaluateCirclePolicyGovernance(prisma, {
                circleId,
                actionType: CIRCLE_POLICY_METADATA_UPDATE_ACTION_TYPE,
                actorPubkey,
                directAllowed: canManage,
                payload: governancePayload,
            });
            if (governance.status === 'requires_governance') {
                return res.status(202).json(governance);
            }
            if (governance.status === 'denied') {
                return res.status(403).json({ error: governance.error });
            }

            const operation = await executeCirclePolicyDirectOperation(prisma, {
                circleId,
                actionType: CIRCLE_POLICY_METADATA_UPDATE_ACTION_TYPE,
                actorPubkey,
                payload: governancePayload,
                reasonCode: 'circle_manager_wallet_signed_metadata_update',
                idempotencyKey: `${CIRCLE_POLICY_METADATA_UPDATE_ACTION_TYPE}:${circleId}:${signedPayload.nonce}`,
                execute: async (client) => ({
                    result: await applyCircleMetadataSetting(client, redis, {
                        circleId,
                        actorPubkey,
                        description: normalizedDescription,
                        audit: {
                            signedMessage,
                            signature,
                            clientTimestamp: signedPayload.clientTimestamp,
                            nonce: signedPayload.nonce,
                            anchor: signedPayload.anchor ?? null,
                        },
                        deferCacheInvalidation: true,
                    }),
                    executionRef: `circle:${circleId}:metadata`,
                }),
                readback: async (client) => {
                    const current = await client.circle.findUnique({
                        where: { id: circleId },
                        select: { id: true, name: true, description: true },
                    });
                    if (!current) throw new Error('circle_metadata_readback_missing');
                    return current;
                },
            });
            await invalidateCircleMetadataSettingCaches(redis, circleId);
            const updated = operation.result;

            return res.json({
                ok: true,
                circleId: updated.id,
                metadata: {
                    name: updated.name,
                    description: updated.description,
                },
                operationReceipt: operation.receipt,
            });
        } catch (error) {
            if (sendCircleRouteError(res, error)) return;
            next(error);
        }
    });

    // PUT /api/v1/circles/:id/community-profile
    router.put('/:id/community-profile', async (req, res, next) => {
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

            if (!actorPubkey || !signedPayload || !signature || signedPayload.settingKind !== 'community_profile') {
                return res.status(401).json({
                    error: 'circle_community_profile_auth_required',
                    message: 'actorPubkey/signedMessage/signature are required',
                });
            }

            if (!verifyEd25519SignatureBase64({
                senderPubkey: actorPubkey,
                message: signedMessage,
                signatureBase64: signature,
            })) {
                return res.status(401).json({ error: 'invalid_circle_community_profile_signature' });
            }

            const communityType = typeof incoming.communityType === 'string'
                ? incoming.communityType.trim().toLowerCase()
                : '';
            const displayRole = typeof incoming.displayRole === 'string'
                ? incoming.displayRole.trim().toLowerCase()
                : '';

            let expectedMessage: string;
            try {
                expectedMessage = buildCircleSettingsSigningMessage(buildCircleSettingsSigningPayload({
                    circleId,
                    actorPubkey,
                    settingKind: 'community_profile',
                    payload: {
                        communityType,
                        displayRole,
                    },
                    clientTimestamp: signedPayload.clientTimestamp,
                    nonce: signedPayload.nonce,
                    anchor: signedPayload.anchor ?? null,
                }));
            } catch {
                return res.status(400).json({ error: 'invalid_circle_community_profile_payload' });
            }
            if (expectedMessage !== signedMessage) {
                return res.status(400).json({
                    error: 'circle_community_profile_signature_payload_mismatch',
                });
            }
            if (!isCircleSettingsSignatureFresh({
                clientTimestamp: signedPayload.clientTimestamp,
                windowMs: Number(process.env.CIRCLE_SETTINGS_SIGNATURE_WINDOW_MS || '300000'),
            })) {
                return res.status(401).json({ error: 'circle_community_profile_signature_expired' });
            }

            const canManage = await resolveActorCanManageCircle({ req, prisma, circleId, actorPubkey });
            if (!canManage) {
                return res.status(403).json({ error: 'circle_community_profile_forbidden' });
            }
            const governance = await evaluateCirclePolicyGovernance(prisma, {
                circleId,
                actionType: CIRCLE_POLICY_COMMUNITY_PROFILE_UPDATE_ACTION_TYPE,
                actorPubkey,
                directAllowed: canManage,
                payload: {
                    communityType,
                    displayRole,
                    settingKind: 'community_profile',
                    signedMessage,
                    signature,
                    clientTimestamp: signedPayload.clientTimestamp,
                    nonce: signedPayload.nonce,
                    anchor: signedPayload.anchor ?? null,
                    executionDomain: 'off_chain',
                    chainStatus: 'not_required',
                },
            });
            if (governance.status === 'requires_governance') {
                return res.status(202).json(governance);
            }
            if (governance.status === 'denied') {
                return res.status(403).json({ error: governance.error });
            }

            const section = buildStoredCircleSettingsEnvelopeSection({
                settingKind: 'community_profile',
                payload: {
                    communityType,
                    displayRole,
                },
                actorPubkey,
                signedMessage,
                signature,
                clientTimestamp: signedPayload.clientTimestamp,
                nonce: signedPayload.nonce,
                anchor: signedPayload.anchor ?? null,
            });
            await persistCircleSettingsEnvelopeSection(prisma, {
                circleId,
                section,
            });

            await redis.del(`circle:${circleId}`);

            return res.json({
                ok: true,
                circleId,
                communityProfile: section.payload,
            });
        } catch (error) {
            if (sendCircleRouteError(res, error)) return;
            next(error);
        }
    });

    return router;
}

function loadGovernanceBootstrapCircleRuntimeConfig() {
    if (String(process.env.GOVERNANCE_BOOTSTRAP_RUNTIME_ENABLED || '').trim() !== 'true') {
        throw new Error('governance_bootstrap_runtime_disabled');
    }
    const network = String(process.env.GOVERNANCE_BOOTSTRAP_CHAIN_ID || '').trim();
    if (network !== 'solana:localnet' && network !== 'solana:devnet') {
        throw new Error('governance_bootstrap_runtime_network_not_enabled');
    }
    if (network === 'solana:devnet'
        && String(process.env.GOVERNANCE_BOOTSTRAP_DEVNET_DEMO_APPROVED || '').trim() !== 'true') {
        throw new Error('governance_bootstrap_devnet_demo_not_approved');
    }
    if (network === 'solana:devnet'
        && String(process.env.QUERY_API_RUNTIME_ROLE || '').trim() !== 'PRIVATE_SIDECAR') {
        throw new Error('governance_bootstrap_devnet_private_sidecar_required');
    }
    const rpcUrl = String(process.env.SOLANA_RPC_URL || process.env.RPC_URL || '').trim();
    const programId = String(
        process.env.CIRCLES_PROGRAM_ID || process.env.NEXT_PUBLIC_CIRCLES_PROGRAM_ID || '',
    ).trim();
    if (!rpcUrl || programId !== GOVERNANCE_BOOTSTRAP_CIRCLE_MANAGER_PROGRAM_ID) {
        throw new Error('governance_bootstrap_runtime_chain_config_mismatch');
    }
    return { network, rpcUrl, programId } as const;
}

function loadGovernanceBootstrapCircleReentryRuntimeConfig() {
    const chainId = String(process.env.GOVERNANCE_BOOTSTRAP_CHAIN_ID || '').trim();
    if (chainId !== 'solana:localnet' && chainId !== 'solana:devnet') {
        throw new Error('governance_bootstrap_reentry_network_not_enabled');
    }
    const rpcUrl = String(process.env.SOLANA_RPC_URL || process.env.RPC_URL || '').trim();
    const programId = String(
        process.env.CIRCLES_PROGRAM_ID || process.env.NEXT_PUBLIC_CIRCLES_PROGRAM_ID || '',
    ).trim();
    if (!rpcUrl || programId !== GOVERNANCE_BOOTSTRAP_CIRCLE_MANAGER_PROGRAM_ID) {
        throw new Error('governance_bootstrap_reentry_chain_config_mismatch');
    }
    return { rpcUrl, programId };
}

function assertGovernanceBootstrapRoutePreview(
    preview: any,
    circleId: number,
    ceremonyId: string,
    actorPubkey: string,
) {
    if (!preview || preview.circleId !== circleId
        || preview.openingInput?.ceremonyId !== ceremonyId
        || preview.openingInput?.actorPubkey !== actorPubkey) {
        throw new Error('governance_bootstrap_route_preview_mismatch');
    }
}

function sendGovernanceBootstrapRouteError(res: Response, error: unknown) {
    const message = error instanceof Error ? error.message : '';
    if (!message.startsWith('governance_bootstrap_')) return false;
    const unavailable = message === 'governance_bootstrap_runtime_disabled'
        || message === 'governance_bootstrap_runtime_network_not_enabled'
        || message === 'governance_bootstrap_devnet_demo_not_approved'
        || message === 'governance_bootstrap_devnet_private_sidecar_required'
        || message === 'governance_bootstrap_runtime_chain_config_mismatch'
        || message === 'governance_bootstrap_reentry_network_not_enabled'
        || message === 'governance_bootstrap_reentry_chain_config_mismatch'
        || message === 'governance_bootstrap_runtime_adapter_submit_unavailable';
    res.status(unavailable ? 503 : 409).json({ error: message });
    return true;
}
