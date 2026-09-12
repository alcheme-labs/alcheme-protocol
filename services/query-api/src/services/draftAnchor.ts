import fs from 'fs';
import os from 'os';
import path from 'path';
import { Prisma, PrismaClient } from '@prisma/client';
import type { Commitment } from '@solana/web3.js';
import {
    AnchorSignerMode,
} from './anchorSigner';
import {
    buildDraftAnchorMessagesDigest,
    buildDraftAnchorProofPackage,
    normalizeDraftAnchorText,
    sha256Hex,
    stableStringify,
} from './settlement/proofPackage';
import { SolanaMemoSettlementAdapter } from './settlement/solanaAdapter';
import type {
    DraftAnchorCanonicalPayload,
    DraftAnchorMessagePayload,
} from './settlement/types';
export type {
    DraftAnchorCanonicalPayload,
    DraftAnchorMessagePayload,
} from './settlement/types';

const DEFAULT_MEMO_PREFIX = 'alcheme-draft-anchor:v1:';

export type DraftAnchorStatus = 'pending' | 'anchoring' | 'anchored' | 'failed' | 'skipped';

export interface DraftAnchorMessageInput {
    envelopeId: string;
    payloadHash: string;
    lamport: bigint;
    senderPubkey: string;
    createdAt: Date;
    semanticScore: number;
    relevanceMethod: string;
}

interface DraftAnchorBatchRow {
    anchorId: string;
    circleId: number;
    draftPostId: number;
    roomKey: string;
    triggerReason: string;
    summaryHash: string;
    messagesDigest: string;
    payloadHash: string;
    canonicalPayload: unknown;
    messageCount: number;
    fromLamport: bigint | null;
    toLamport: bigint | null;
    chain: string;
    memoText: string;
    txSignature: string | null;
    txSlot: bigint | null;
    status: string;
    errorMessage: string | null;
    createdAt: Date;
    anchoredAt: Date | null;
    updatedAt: Date;
}

export interface DraftAnchorRecord {
    anchorId: string;
    circleId: number;
    draftPostId: number;
    roomKey: string;
    triggerReason: string;
    summaryHash: string;
    messagesDigest: string;
    payloadHash: string;
    canonicalPayload: DraftAnchorCanonicalPayload | null;
    messageCount: number;
    fromLamport: string | null;
    toLamport: string | null;
    chain: string;
    memoText: string;
    txSignature: string | null;
    txSlot: string | null;
    status: DraftAnchorStatus;
    errorMessage: string | null;
    createdAt: string;
    anchoredAt: string | null;
    updatedAt: string;
}

export interface DraftAnchorProof {
    payloadHashMatches: boolean;
    anchorIdMatchesPayloadHash: boolean;
    summaryHashMatches: boolean;
    messagesDigestMatches: boolean;
    payloadEnvelopeMatches: boolean;
    memoContainsAnchor: boolean;
    memoContainsSummaryHash: boolean;
    memoContainsMessagesDigest: boolean;
    verifiable: boolean;
}

export interface CreateDraftAnchorBatchInput {
    prisma: PrismaClient;
    circleId: number;
    draftPostId: number;
    roomKey: string;
    triggerReason: string;
    summaryText: string;
    summaryMethod: string;
    messages: DraftAnchorMessageInput[];
}

export class DraftAnchorRepairError extends Error {
    code: string;
    statusCode: number;

    constructor(code: string, statusCode: number, message = code) {
        super(message);
        this.name = 'DraftAnchorRepairError';
        this.code = code;
        this.statusCode = statusCode;
    }
}

type PrismaLike = PrismaClient | Prisma.TransactionClient;

interface DraftAnchorRuntimeConfig {
    enabled: boolean;
    writerEnabled: boolean;
    claimStaleSeconds: number;
    signerMode: AnchorSignerMode;
    signerUrl: string | null;
    signerAuthToken: string | null;
    signerTimeoutMs: number;
    rpcUrl: string;
    commitment: Commitment;
    keypairPath: string;
    memoPrefix: string;
}

function isSha256Hex(value: string): boolean {
    return /^[a-f0-9]{64}$/i.test(value);
}

function normalizeAnchorIdHex(value: string): string | null {
    const normalized = String(value || '').trim().toLowerCase();
    return isSha256Hex(normalized) ? normalized : null;
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
    if (!raw) return fallback;
    const normalized = raw.trim().toLowerCase();
    if (normalized === '1' || normalized === 'true') return true;
    if (normalized === '0' || normalized === 'false') return false;
    return fallback;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(String(raw || ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

function parseSignerMode(raw: string | undefined): AnchorSignerMode {
    const normalized = String(raw || 'local').trim().toLowerCase();
    return normalized === 'external' ? 'external' : 'local';
}

function expandHomePath(inputPath: string): string {
    if (!inputPath.startsWith('~/')) return inputPath;
    return path.join(os.homedir(), inputPath.slice(2));
}

function loadDraftAnchorRuntimeConfig(env: NodeJS.ProcessEnv = process.env): DraftAnchorRuntimeConfig {
    const defaultEnabled = env.NODE_ENV !== 'production';
    const defaultWriterEnabled = env.NODE_ENV !== 'production';
    const keypairPath = expandHomePath(
        env.DRAFT_ANCHOR_KEYPAIR_PATH
        || env.SOLANA_KEYPAIR_PATH
        || path.join(os.homedir(), '.config', 'solana', 'id.json'),
    );

    const commitmentRaw = String(env.DRAFT_ANCHOR_COMMITMENT || 'confirmed').trim().toLowerCase();
    const commitment: Commitment =
        commitmentRaw === 'processed'
            ? 'processed'
            : commitmentRaw === 'finalized'
                ? 'finalized'
                : 'confirmed';

    const signerMode = parseSignerMode(env.DRAFT_ANCHOR_SIGNER_MODE || env.ANCHOR_SIGNER_MODE);
    const signerUrl = String(env.DRAFT_ANCHOR_SIGNER_URL || env.ANCHOR_SIGNER_URL || '').trim();
    const signerAuthToken = String(
        env.DRAFT_ANCHOR_SIGNER_AUTH_TOKEN || env.ANCHOR_SIGNER_AUTH_TOKEN || '',
    ).trim();

    return {
        enabled: parseBool(env.DRAFT_ANCHOR_ENABLED, defaultEnabled),
        writerEnabled: parseBool(
            env.DRAFT_ANCHOR_WRITER_ENABLED || env.ANCHOR_WRITER_ENABLED,
            defaultWriterEnabled,
        ),
        claimStaleSeconds: Math.max(
            30,
            Math.min(parsePositiveInt(env.DRAFT_ANCHOR_CLAIM_STALE_SECONDS, 180), 3600),
        ),
        signerMode,
        signerUrl: signerUrl || null,
        signerAuthToken: signerAuthToken || null,
        signerTimeoutMs: Math.max(
            1000,
            Math.min(
                parsePositiveInt(
                    env.DRAFT_ANCHOR_SIGNER_TIMEOUT_MS || env.ANCHOR_SIGNER_TIMEOUT_MS,
                    10000,
                ),
                120000,
            ),
        ),
        rpcUrl: String(
            env.DRAFT_ANCHOR_RPC_URL
            || env.SOLANA_RPC_URL
            || env.RPC_ENDPOINT
            || 'http://127.0.0.1:8899',
        ).trim(),
        commitment,
        keypairPath,
        memoPrefix: String(env.DRAFT_ANCHOR_MEMO_PREFIX || DEFAULT_MEMO_PREFIX).trim() || DEFAULT_MEMO_PREFIX,
    };
}

function parseCanonicalPayload(raw: unknown): DraftAnchorCanonicalPayload | null {
    try {
        const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!value || typeof value !== 'object') return null;
        return value as DraftAnchorCanonicalPayload;
    } catch {
        return null;
    }
}

function mapAnchorRow(row: DraftAnchorBatchRow): DraftAnchorRecord {
    return {
        anchorId: row.anchorId,
        circleId: row.circleId,
        draftPostId: row.draftPostId,
        roomKey: row.roomKey,
        triggerReason: row.triggerReason,
        summaryHash: row.summaryHash,
        messagesDigest: row.messagesDigest,
        payloadHash: row.payloadHash,
        canonicalPayload: parseCanonicalPayload(row.canonicalPayload),
        messageCount: row.messageCount,
        fromLamport: row.fromLamport !== null ? row.fromLamport.toString() : null,
        toLamport: row.toLamport !== null ? row.toLamport.toString() : null,
        chain: row.chain,
        memoText: row.memoText,
        txSignature: row.txSignature,
        txSlot: row.txSlot !== null ? row.txSlot.toString() : null,
        status: (row.status as DraftAnchorStatus) || 'pending',
        errorMessage: row.errorMessage,
        createdAt: row.createdAt.toISOString(),
        anchoredAt: row.anchoredAt?.toISOString() || null,
        updatedAt: row.updatedAt.toISOString(),
    };
}

async function findAnchorById(prisma: PrismaLike, anchorId: string): Promise<DraftAnchorRecord | null> {
    const rows = await prisma.$queryRaw<DraftAnchorBatchRow[]>`
        SELECT
            anchor_id AS "anchorId",
            circle_id AS "circleId",
            draft_post_id AS "draftPostId",
            room_key AS "roomKey",
            trigger_reason AS "triggerReason",
            summary_hash AS "summaryHash",
            messages_digest AS "messagesDigest",
            payload_hash AS "payloadHash",
            canonical_payload AS "canonicalPayload",
            message_count AS "messageCount",
            from_lamport AS "fromLamport",
            to_lamport AS "toLamport",
            chain AS "chain",
            memo_text AS "memoText",
            tx_signature AS "txSignature",
            tx_slot AS "txSlot",
            status AS "status",
            error_message AS "errorMessage",
            created_at AS "createdAt",
            anchored_at AS "anchoredAt",
            updated_at AS "updatedAt"
        FROM discussion_draft_anchor_batches
        WHERE anchor_id = ${anchorId}
        LIMIT 1
    `;
    const row = rows[0];
    return row ? mapAnchorRow(row) : null;
}

async function updateAnchorStatus(prisma: PrismaClient, input: {
    anchorId: string;
    status: DraftAnchorStatus;
    txSignature?: string | null;
    txSlot?: bigint | null;
    errorMessage?: string | null;
}): Promise<void> {
    await prisma.$executeRaw`
        UPDATE discussion_draft_anchor_batches
        SET
            status = ${input.status},
            tx_signature = ${input.txSignature ?? null},
            tx_slot = ${input.txSlot ?? null},
            error_message = ${input.errorMessage ?? null},
            anchored_at = CASE
                WHEN ${input.status} = 'anchored' THEN NOW()
                ELSE anchored_at
            END,
            updated_at = NOW()
        WHERE anchor_id = ${input.anchorId}
    `;
}

function parseSlotBigInt(value: string | null): bigint | null {
    if (!value) return null;
    try {
        const parsed = BigInt(value);
        return parsed >= 0n ? parsed : null;
    } catch {
        return null;
    }
}

async function claimAnchorForSubmission(prisma: PrismaClient, input: {
    anchorId: string;
    claimStaleSeconds: number;
}): Promise<boolean> {
    const rows = await prisma.$queryRaw<{ anchorId: string }[]>`
        UPDATE discussion_draft_anchor_batches
        SET
            status = 'anchoring',
            error_message = NULL,
            updated_at = NOW()
        WHERE
            anchor_id = ${input.anchorId}
            AND (
                status IN ('pending', 'failed', 'skipped')
                OR (
                    status = 'anchoring'
                    AND updated_at < NOW() - (${input.claimStaleSeconds} * INTERVAL '1 second')
                )
            )
        RETURNING anchor_id AS "anchorId"
    `;
    return rows.length > 0;
}

export async function createDraftAnchorBatch(
    input: CreateDraftAnchorBatchInput,
): Promise<DraftAnchorRecord> {
    const config = loadDraftAnchorRuntimeConfig();
    const orderedMessages = [...input.messages].sort((a, b) => {
        if (a.lamport < b.lamport) return -1;
        if (a.lamport > b.lamport) return 1;
        return a.envelopeId.localeCompare(b.envelopeId);
    });

    if (orderedMessages.length === 0) {
        throw new Error('draft_anchor_requires_messages');
    }

    const payloadMessages: DraftAnchorMessagePayload[] = orderedMessages.map((item) => ({
        envelopeId: item.envelopeId,
        payloadHash: item.payloadHash,
        lamport: item.lamport.toString(),
        senderPubkey: item.senderPubkey,
        createdAt: item.createdAt.toISOString(),
        semanticScore: Math.max(0, Math.min(1, item.semanticScore)),
        relevanceMethod: item.relevanceMethod || 'rule',
    }));

    const fromLamport = payloadMessages[0].lamport;
    const toLamport = payloadMessages[payloadMessages.length - 1].lamport;
    const summaryHash = sha256Hex(normalizeDraftAnchorText(input.summaryText));
    const messagesDigest = buildDraftAnchorMessagesDigest(payloadMessages);

    const canonicalPayload: DraftAnchorCanonicalPayload = {
        version: 1,
        anchorType: 'discussion_draft_trigger',
        roomKey: input.roomKey,
        circleId: input.circleId,
        draftPostId: input.draftPostId,
        triggerReason: input.triggerReason,
        summaryMethod: input.summaryMethod || 'rule',
        summaryHash,
        messagesDigest,
        messageCount: payloadMessages.length,
        fromLamport,
        toLamport,
        generatedAt: new Date().toISOString(),
        messages: payloadMessages,
    };

    const proofPackage = buildDraftAnchorProofPackage({
        payload: canonicalPayload,
        memoPrefix: config.memoPrefix,
    });
    const payloadHash = proofPackage.payloadHash;
    const anchorId = proofPackage.anchorId;
    const memoText = proofPackage.memoText;

    const existing = await findAnchorById(input.prisma, anchorId);
    if (existing?.status === 'anchored') return existing;

    if (!existing) {
        const payloadJson = JSON.stringify(canonicalPayload);
        await input.prisma.$executeRaw`
            INSERT INTO discussion_draft_anchor_batches (
                anchor_id,
                circle_id,
                draft_post_id,
                room_key,
                trigger_reason,
                summary_hash,
                messages_digest,
                payload_hash,
                canonical_payload,
                message_count,
                from_lamport,
                to_lamport,
                chain,
                memo_text,
                status,
                created_at,
                updated_at
            )
            VALUES (
                ${anchorId},
                ${input.circleId},
                ${input.draftPostId},
                ${input.roomKey},
                ${input.triggerReason},
                ${summaryHash},
                ${messagesDigest},
                ${payloadHash},
                ${payloadJson}::jsonb,
                ${payloadMessages.length},
                ${BigInt(fromLamport)},
                ${BigInt(toLamport)},
                'solana',
                ${memoText},
                'pending',
                NOW(),
                NOW()
            )
            ON CONFLICT (anchor_id) DO NOTHING
        `;
    }

    const claimed = await claimAnchorForSubmission(input.prisma, {
        anchorId,
        claimStaleSeconds: config.claimStaleSeconds,
    });
    if (!claimed) {
        return (await findAnchorById(input.prisma, anchorId)) as DraftAnchorRecord;
    }

    if (!config.enabled) {
        await updateAnchorStatus(input.prisma, {
            anchorId,
            status: 'skipped',
            errorMessage: 'DRAFT_ANCHOR_ENABLED=false',
        });
        return (await findAnchorById(input.prisma, anchorId)) as DraftAnchorRecord;
    }

    if (!config.writerEnabled) {
        await updateAnchorStatus(input.prisma, {
            anchorId,
            status: 'skipped',
            errorMessage: 'DRAFT_ANCHOR_WRITER_ENABLED=false',
        });
        return (await findAnchorById(input.prisma, anchorId)) as DraftAnchorRecord;
    }

    if (config.signerMode === 'local' && !fs.existsSync(config.keypairPath)) {
        await updateAnchorStatus(input.prisma, {
            anchorId,
            status: 'skipped',
            errorMessage: `anchor keypair not found: ${config.keypairPath}`,
        });
        return (await findAnchorById(input.prisma, anchorId)) as DraftAnchorRecord;
    }

    try {
        const settlementAdapter = new SolanaMemoSettlementAdapter();
        const anchored = await settlementAdapter.submitAnchor({
            anchorPayload: proofPackage.anchorPayload,
            memoText,
            signerConfig: {
                mode: config.signerMode,
                rpcUrl: config.rpcUrl,
                commitment: config.commitment,
                keypairPath: config.keypairPath,
                externalUrl: config.signerUrl,
                externalAuthToken: config.signerAuthToken,
                externalTimeoutMs: config.signerTimeoutMs,
                signerLabel: 'discussion_draft_anchor',
            },
        });

        await updateAnchorStatus(input.prisma, {
            anchorId,
            status: 'anchored',
            txSignature: anchored.settlementTxId,
            txSlot: parseSlotBigInt(anchored.slotOrHeight),
            errorMessage: null,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await updateAnchorStatus(input.prisma, {
            anchorId,
            status: 'failed',
            errorMessage: message.slice(0, 500),
        });
    }

    return (await findAnchorById(input.prisma, anchorId)) as DraftAnchorRecord;
}

export async function getDraftAnchorById(
    prisma: PrismaLike,
    anchorId: string,
): Promise<DraftAnchorRecord | null> {
    return findAnchorById(prisma, anchorId);
}

export async function getLatestDraftAnchorByPostId(
    prisma: PrismaLike,
    draftPostId: number,
): Promise<DraftAnchorRecord | null> {
    const anchors = await getDraftAnchorsByPostId(prisma, draftPostId, 1);
    return anchors[0] || null;
}

export async function getDraftAnchorsByPostId(
    prisma: PrismaLike,
    draftPostId: number,
    limit = 20,
): Promise<DraftAnchorRecord[]> {
    const boundedLimit = Math.max(1, Math.min(parsePositiveInt(String(limit), 20), 100));
    const rows = await prisma.$queryRaw<DraftAnchorBatchRow[]>`
        SELECT
            anchor_id AS "anchorId",
            circle_id AS "circleId",
            draft_post_id AS "draftPostId",
            room_key AS "roomKey",
            trigger_reason AS "triggerReason",
            summary_hash AS "summaryHash",
            messages_digest AS "messagesDigest",
            payload_hash AS "payloadHash",
            canonical_payload AS "canonicalPayload",
            message_count AS "messageCount",
            from_lamport AS "fromLamport",
            to_lamport AS "toLamport",
            chain AS "chain",
            memo_text AS "memoText",
            tx_signature AS "txSignature",
            tx_slot AS "txSlot",
            status AS "status",
            error_message AS "errorMessage",
            created_at AS "createdAt",
            anchored_at AS "anchoredAt",
            updated_at AS "updatedAt"
        FROM discussion_draft_anchor_batches
        WHERE draft_post_id = ${draftPostId}
        ORDER BY created_at DESC
        LIMIT ${boundedLimit}
    `;
    return rows.map(mapAnchorRow);
}

function isDraftAnchorContentVerifiable(record: DraftAnchorRecord): boolean {
    return verifyDraftAnchor({
        ...record,
        status: 'anchored',
    }).verifiable;
}

function selectDraftAnchorRepairCandidate(anchors: DraftAnchorRecord[]): DraftAnchorRecord | null {
    return anchors.find((anchor) => verifyDraftAnchor(anchor).verifiable)
        || anchors.find((anchor) => (
            anchor.status !== 'anchored'
            && isDraftAnchorContentVerifiable(anchor)
        ))
        || null;
}

export async function repairDraftAnchorBatch(input: {
    prisma: PrismaClient;
    draftPostId: number;
    anchorId?: string | null;
}): Promise<DraftAnchorRecord> {
    const config = loadDraftAnchorRuntimeConfig();
    const requestedAnchorId = input.anchorId
        ? normalizeAnchorIdHex(input.anchorId)
        : null;
    if (input.anchorId && !requestedAnchorId) {
        throw new DraftAnchorRepairError(
            'invalid_draft_anchor_id',
            400,
            'draft anchor id must be a 64-character hex string',
        );
    }

    const anchor = requestedAnchorId
        ? await findAnchorById(input.prisma, requestedAnchorId)
        : selectDraftAnchorRepairCandidate(
            await getDraftAnchorsByPostId(input.prisma, input.draftPostId, 20),
        );

    if (!anchor || anchor.draftPostId !== input.draftPostId) {
        throw new DraftAnchorRepairError(
            'draft_anchor_repair_candidate_not_found',
            404,
            'no discussion draft anchor repair candidate was found',
        );
    }

    if (verifyDraftAnchor(anchor).verifiable) {
        return anchor;
    }

    if (!isDraftAnchorContentVerifiable(anchor)) {
        throw new DraftAnchorRepairError(
            'draft_anchor_repair_payload_unverifiable',
            422,
            'discussion draft anchor payload is not internally verifiable',
        );
    }

    const claimed = await claimAnchorForSubmission(input.prisma, {
        anchorId: anchor.anchorId,
        claimStaleSeconds: config.claimStaleSeconds,
    });
    if (!claimed) {
        return (await findAnchorById(input.prisma, anchor.anchorId)) as DraftAnchorRecord;
    }

    if (!config.enabled) {
        await updateAnchorStatus(input.prisma, {
            anchorId: anchor.anchorId,
            status: 'skipped',
            errorMessage: 'DRAFT_ANCHOR_ENABLED=false',
        });
        return (await findAnchorById(input.prisma, anchor.anchorId)) as DraftAnchorRecord;
    }

    if (!config.writerEnabled) {
        await updateAnchorStatus(input.prisma, {
            anchorId: anchor.anchorId,
            status: 'skipped',
            errorMessage: 'DRAFT_ANCHOR_WRITER_ENABLED=false',
        });
        return (await findAnchorById(input.prisma, anchor.anchorId)) as DraftAnchorRecord;
    }

    if (config.signerMode === 'local' && !fs.existsSync(config.keypairPath)) {
        await updateAnchorStatus(input.prisma, {
            anchorId: anchor.anchorId,
            status: 'skipped',
            errorMessage: `anchor keypair not found: ${config.keypairPath}`,
        });
        return (await findAnchorById(input.prisma, anchor.anchorId)) as DraftAnchorRecord;
    }

    try {
        if (!anchor.canonicalPayload) {
            throw new DraftAnchorRepairError(
                'draft_anchor_repair_payload_unverifiable',
                422,
                'discussion draft anchor payload is not internally verifiable',
            );
        }
        const proofPackage = buildDraftAnchorProofPackage({
            payload: anchor.canonicalPayload,
            memoPrefix: config.memoPrefix,
        });
        const settlementAdapter = new SolanaMemoSettlementAdapter();
        const anchored = await settlementAdapter.submitAnchor({
            anchorPayload: proofPackage.anchorPayload,
            memoText: anchor.memoText,
            signerConfig: {
                mode: config.signerMode,
                rpcUrl: config.rpcUrl,
                commitment: config.commitment,
                keypairPath: config.keypairPath,
                externalUrl: config.signerUrl,
                externalAuthToken: config.signerAuthToken,
                externalTimeoutMs: config.signerTimeoutMs,
                signerLabel: 'discussion_draft_anchor_repair',
            },
        });

        await updateAnchorStatus(input.prisma, {
            anchorId: anchor.anchorId,
            status: 'anchored',
            txSignature: anchored.settlementTxId,
            txSlot: parseSlotBigInt(anchored.slotOrHeight),
            errorMessage: null,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await updateAnchorStatus(input.prisma, {
            anchorId: anchor.anchorId,
            status: 'failed',
            errorMessage: message.slice(0, 500),
        });
    }

    return (await findAnchorById(input.prisma, anchor.anchorId)) as DraftAnchorRecord;
}

export function verifyDraftAnchor(record: DraftAnchorRecord): DraftAnchorProof {
    const payload = record.canonicalPayload;
    const canonicalJson = payload ? stableStringify(payload) : null;
    const recomputedPayloadHash = canonicalJson ? sha256Hex(canonicalJson) : null;
    const recomputedMessagesDigest = payload?.messages ? buildDraftAnchorMessagesDigest(payload.messages) : null;
    const payloadHashMatches =
        Boolean(recomputedPayloadHash)
        && isSha256Hex(record.payloadHash)
        && recomputedPayloadHash === record.payloadHash;
    const anchorIdMatchesPayloadHash =
        payloadHashMatches
        && isSha256Hex(record.anchorId)
        && record.anchorId === record.payloadHash;
    const summaryHashMatches =
        Boolean(payload)
        && isSha256Hex(record.summaryHash)
        && payload!.summaryHash === record.summaryHash;
    const messagesDigestMatches =
        Boolean(payload)
        && isSha256Hex(record.messagesDigest)
        && payload!.messagesDigest === record.messagesDigest
        && recomputedMessagesDigest === record.messagesDigest;

    const payloadEnvelopeMatches =
        Boolean(payload)
        && payload!.circleId === record.circleId
        && payload!.draftPostId === record.draftPostId
        && payload!.roomKey === record.roomKey
        && payload!.messageCount === record.messageCount
        && payload!.fromLamport === record.fromLamport
        && payload!.toLamport === record.toLamport;
    const memoContainsAnchor = record.memoText.includes(record.anchorId);
    const memoContainsSummaryHash = record.memoText.includes(record.summaryHash);
    const memoContainsMessagesDigest = record.memoText.includes(record.messagesDigest);

    return {
        payloadHashMatches,
        anchorIdMatchesPayloadHash,
        summaryHashMatches,
        messagesDigestMatches,
        payloadEnvelopeMatches,
        memoContainsAnchor,
        memoContainsSummaryHash,
        memoContainsMessagesDigest,
        verifiable:
            payloadHashMatches
            && anchorIdMatchesPayloadHash
            && summaryHashMatches
            && messagesDigestMatches
            && memoContainsAnchor
            && memoContainsSummaryHash
            && memoContainsMessagesDigest
            && payloadEnvelopeMatches
            && record.status === 'anchored',
    };
}
