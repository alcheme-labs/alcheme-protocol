import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Prisma, PrismaClient } from '@prisma/client';
import {
    Commitment,
    PublicKey,
} from '@solana/web3.js';
import {
    AnchorSignerMode,
    submitMemoAnchorWithSigner,
} from './anchorSigner';

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const DEFAULT_MEMO_PREFIX = 'alcheme-collab-anchor:v1:';

export type CollabEditAnchorStatus = 'pending' | 'anchoring' | 'anchored' | 'failed' | 'skipped';

export interface CollabEditUpdateInput {
    seq: number;
    updateHash: string;
    updateBytes: number;
    editorUserId: number | null;
    editorHandle: string | null;
    receivedAt: Date;
}

interface CollabEditUpdatePayload {
    seq: number;
    updateHash: string;
    updateBytes: number;
    editorUserId: number | null;
    editorHandle: string | null;
    receivedAt: string;
}

export interface CollabEditCanonicalPayload {
    version: 1;
    anchorType: 'collab_edit_batch';
    roomKey: string;
    draftPostId: number;
    circleId: number;
    fromSeq: number;
    toSeq: number;
    updateCount: number;
    updatesDigest: string;
    snapshotHash: string;
    generatedAt: string;
    updates: CollabEditUpdatePayload[];
}

interface CollabEditAnchorBatchRow {
    anchorId: string;
    draftPostId: number;
    circleId: number;
    roomKey: string;
    fromSeq: bigint;
    toSeq: bigint;
    updateCount: number;
    updatesDigest: string;
    snapshotHash: string;
    payloadHash: string;
    canonicalPayload: unknown;
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

export interface CollabEditAnchorRecord {
    anchorId: string;
    draftPostId: number;
    circleId: number;
    roomKey: string;
    fromSeq: string;
    toSeq: string;
    updateCount: number;
    updatesDigest: string;
    snapshotHash: string;
    payloadHash: string;
    canonicalPayload: CollabEditCanonicalPayload | null;
    chain: string;
    memoText: string;
    txSignature: string | null;
    txSlot: string | null;
    status: CollabEditAnchorStatus;
    errorMessage: string | null;
    createdAt: string;
    anchoredAt: string | null;
    updatedAt: string;
}

export interface CollabEditAnchorProof {
    payloadHashMatches: boolean;
    anchorIdMatchesPayloadHash: boolean;
    updatesDigestMatches: boolean;
    snapshotHashMatches: boolean;
    envelopeMatches: boolean;
    memoContainsAnchor: boolean;
    memoContainsUpdatesDigest: boolean;
    memoContainsSnapshotHash: boolean;
    verifiable: boolean;
}

export interface CreateCollabEditAnchorBatchInput {
    prisma: PrismaLike;
    draftPostId: number;
    circleId: number;
    roomKey: string;
    snapshotHash: string;
    updates: CollabEditUpdateInput[];
    generatedAt?: Date;
}

type PrismaLike = PrismaClient | Prisma.TransactionClient;

interface CollabEditAnchorRuntimeConfig {
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

function sha256Hex(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex');
}

function isSha256Hex(value: string): boolean {
    return /^[a-f0-9]{64}$/i.test(value);
}

function stableSortValue(input: unknown): unknown {
    if (Array.isArray(input)) {
        return input.map(stableSortValue);
    }
    if (input && typeof input === 'object') {
        const record = input as Record<string, unknown>;
        const sorted: Record<string, unknown> = {};
        Object.keys(record)
            .sort()
            .forEach((key) => {
                const value = record[key];
                if (value !== undefined) {
                    sorted[key] = stableSortValue(value);
                }
            });
        return sorted;
    }
    return input;
}

function stableStringify(input: unknown): string {
    return JSON.stringify(stableSortValue(input));
}

function expandHomePath(inputPath: string): string {
    if (!inputPath.startsWith('~/')) return inputPath;
    return path.join(os.homedir(), inputPath.slice(2));
}

function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): CollabEditAnchorRuntimeConfig {
    const defaultEnabled = env.NODE_ENV !== 'production';
    const defaultWriterEnabled = env.NODE_ENV !== 'production';
    const keypairPath = expandHomePath(
        env.COLLAB_EDIT_ANCHOR_KEYPAIR_PATH
        || env.DRAFT_ANCHOR_KEYPAIR_PATH
        || env.SOLANA_KEYPAIR_PATH
        || path.join(os.homedir(), '.config', 'solana', 'id.json'),
    );

    const commitmentRaw = String(env.COLLAB_EDIT_ANCHOR_COMMITMENT || 'confirmed').trim().toLowerCase();
    const commitment: Commitment =
        commitmentRaw === 'processed'
            ? 'processed'
            : commitmentRaw === 'finalized'
                ? 'finalized'
                : 'confirmed';

    const signerMode = parseSignerMode(env.COLLAB_EDIT_ANCHOR_SIGNER_MODE || env.ANCHOR_SIGNER_MODE);
    const signerUrl = String(env.COLLAB_EDIT_ANCHOR_SIGNER_URL || env.ANCHOR_SIGNER_URL || '').trim();
    const signerAuthToken = String(
        env.COLLAB_EDIT_ANCHOR_SIGNER_AUTH_TOKEN || env.ANCHOR_SIGNER_AUTH_TOKEN || '',
    ).trim();

    return {
        enabled: parseBool(env.COLLAB_EDIT_ANCHOR_ENABLED, defaultEnabled),
        writerEnabled: parseBool(
            env.COLLAB_EDIT_ANCHOR_WRITER_ENABLED || env.ANCHOR_WRITER_ENABLED,
            defaultWriterEnabled,
        ),
        claimStaleSeconds: Math.max(
            30,
            Math.min(parsePositiveInt(env.COLLAB_EDIT_ANCHOR_CLAIM_STALE_SECONDS, 180), 3600),
        ),
        signerMode,
        signerUrl: signerUrl || null,
        signerAuthToken: signerAuthToken || null,
        signerTimeoutMs: Math.max(
            1000,
            Math.min(
                parsePositiveInt(
                    env.COLLAB_EDIT_ANCHOR_SIGNER_TIMEOUT_MS || env.ANCHOR_SIGNER_TIMEOUT_MS,
                    10000,
                ),
                120000,
            ),
        ),
        rpcUrl: String(
            env.COLLAB_EDIT_ANCHOR_RPC_URL
            || env.DRAFT_ANCHOR_RPC_URL
            || env.SOLANA_RPC_URL
            || env.RPC_ENDPOINT
            || 'http://127.0.0.1:8899',
        ).trim(),
        commitment,
        keypairPath,
        memoPrefix:
            String(env.COLLAB_EDIT_ANCHOR_MEMO_PREFIX || DEFAULT_MEMO_PREFIX).trim()
            || DEFAULT_MEMO_PREFIX,
    };
}

function buildUpdatesDigest(updates: CollabEditUpdatePayload[]): string {
    const compact = updates.map((item) =>
        `${item.seq}:${item.updateHash}:${item.updateBytes}:${item.editorUserId ?? 0}:${item.editorHandle || ''}`,
    );
    return sha256Hex(compact.join('|'));
}

function buildMemoText(input: {
    memoPrefix: string;
    anchorId: string;
    draftPostId: number;
    circleId: number;
    fromSeq: number;
    toSeq: number;
    updateCount: number;
    updatesDigest: string;
    snapshotHash: string;
}): string {
    const jsonMemo = `${input.memoPrefix}${stableStringify({
        anchorId: input.anchorId,
        draftPostId: input.draftPostId,
        circleId: input.circleId,
        fromSeq: input.fromSeq,
        toSeq: input.toSeq,
        updateCount: input.updateCount,
        updatesDigest: input.updatesDigest,
        snapshotHash: input.snapshotHash,
        v: 1,
    })}`;

    if (Buffer.byteLength(jsonMemo, 'utf8') <= 512) return jsonMemo;

    return [
        input.memoPrefix,
        input.anchorId,
        String(input.draftPostId),
        String(input.circleId),
        String(input.fromSeq),
        String(input.toSeq),
        String(input.updateCount),
        input.updatesDigest,
        input.snapshotHash,
    ].join(':');
}

function parseCanonicalPayload(raw: unknown): CollabEditCanonicalPayload | null {
    try {
        const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!value || typeof value !== 'object') return null;
        return value as CollabEditCanonicalPayload;
    } catch {
        return null;
    }
}

function mapRow(row: CollabEditAnchorBatchRow): CollabEditAnchorRecord {
    return {
        anchorId: row.anchorId,
        draftPostId: row.draftPostId,
        circleId: row.circleId,
        roomKey: row.roomKey,
        fromSeq: row.fromSeq.toString(),
        toSeq: row.toSeq.toString(),
        updateCount: row.updateCount,
        updatesDigest: row.updatesDigest,
        snapshotHash: row.snapshotHash,
        payloadHash: row.payloadHash,
        canonicalPayload: parseCanonicalPayload(row.canonicalPayload),
        chain: row.chain,
        memoText: row.memoText,
        txSignature: row.txSignature,
        txSlot: row.txSlot ? row.txSlot.toString() : null,
        status: (row.status as CollabEditAnchorStatus) || 'pending',
        errorMessage: row.errorMessage,
        createdAt: row.createdAt.toISOString(),
        anchoredAt: row.anchoredAt?.toISOString() || null,
        updatedAt: row.updatedAt.toISOString(),
    };
}

async function findByAnchorId(prisma: PrismaLike, anchorId: string): Promise<CollabEditAnchorRecord | null> {
    const rows = await prisma.$queryRaw<CollabEditAnchorBatchRow[]>`
        SELECT
            anchor_id AS "anchorId",
            draft_post_id AS "draftPostId",
            circle_id AS "circleId",
            room_key AS "roomKey",
            from_seq AS "fromSeq",
            to_seq AS "toSeq",
            update_count AS "updateCount",
            updates_digest AS "updatesDigest",
            snapshot_hash AS "snapshotHash",
            payload_hash AS "payloadHash",
            canonical_payload AS "canonicalPayload",
            chain AS "chain",
            memo_text AS "memoText",
            tx_signature AS "txSignature",
            tx_slot AS "txSlot",
            status AS "status",
            error_message AS "errorMessage",
            created_at AS "createdAt",
            anchored_at AS "anchoredAt",
            updated_at AS "updatedAt"
        FROM collab_edit_anchor_batches
        WHERE anchor_id = ${anchorId}
        LIMIT 1
    `;
    return rows[0] ? mapRow(rows[0]) : null;
}

async function updateAnchorStatus(prisma: PrismaLike, input: {
    anchorId: string;
    status: CollabEditAnchorStatus;
    txSignature?: string | null;
    txSlot?: bigint | null;
    errorMessage?: string | null;
}): Promise<void> {
    await prisma.$executeRaw`
        UPDATE collab_edit_anchor_batches
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

async function claimAnchorForSubmission(prisma: PrismaLike, input: {
    anchorId: string;
    claimStaleSeconds: number;
}): Promise<boolean> {
    const rows = await prisma.$queryRaw<{ anchorId: string }[]>`
        UPDATE collab_edit_anchor_batches
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

export async function createCollabEditAnchorBatch(
    input: CreateCollabEditAnchorBatchInput,
): Promise<CollabEditAnchorRecord> {
    const config = loadRuntimeConfig();
    const orderedUpdates = [...input.updates].sort((a, b) => a.seq - b.seq);
    if (orderedUpdates.length === 0) {
        throw new Error('collab_edit_anchor_requires_updates');
    }
    if (!isSha256Hex(input.snapshotHash)) {
        throw new Error('invalid_snapshot_hash');
    }

    const payloadUpdates: CollabEditUpdatePayload[] = orderedUpdates.map((item) => ({
        seq: Math.max(0, item.seq),
        updateHash: String(item.updateHash || '').toLowerCase(),
        updateBytes: Math.max(0, Math.floor(item.updateBytes || 0)),
        editorUserId: Number.isFinite(item.editorUserId as number) ? item.editorUserId : null,
        editorHandle: item.editorHandle ? String(item.editorHandle).slice(0, 64) : null,
        receivedAt: item.receivedAt.toISOString(),
    }));
    if (payloadUpdates.some((item) => !isSha256Hex(item.updateHash))) {
        throw new Error('invalid_update_hash');
    }

    const fromSeq = payloadUpdates[0].seq;
    const toSeq = payloadUpdates[payloadUpdates.length - 1].seq;
    const updatesDigest = buildUpdatesDigest(payloadUpdates);

    const generatedAt = input.generatedAt instanceof Date ? input.generatedAt : new Date();
    const canonicalPayload: CollabEditCanonicalPayload = {
        version: 1,
        anchorType: 'collab_edit_batch',
        roomKey: input.roomKey,
        draftPostId: input.draftPostId,
        circleId: input.circleId,
        fromSeq,
        toSeq,
        updateCount: payloadUpdates.length,
        updatesDigest,
        snapshotHash: input.snapshotHash,
        generatedAt: generatedAt.toISOString(),
        updates: payloadUpdates,
    };
    const canonicalJson = stableStringify(canonicalPayload);
    const payloadHash = sha256Hex(canonicalJson);
    const anchorId = payloadHash;
    const memoText = buildMemoText({
        memoPrefix: config.memoPrefix,
        anchorId,
        draftPostId: input.draftPostId,
        circleId: input.circleId,
        fromSeq,
        toSeq,
        updateCount: payloadUpdates.length,
        updatesDigest,
        snapshotHash: input.snapshotHash,
    });

    const existing = await findByAnchorId(input.prisma, anchorId);
    if (existing?.status === 'anchored') return existing;

    if (!existing) {
        await input.prisma.$executeRaw`
            INSERT INTO collab_edit_anchor_batches (
                anchor_id,
                draft_post_id,
                circle_id,
                room_key,
                from_seq,
                to_seq,
                update_count,
                updates_digest,
                snapshot_hash,
                payload_hash,
                canonical_payload,
                chain,
                memo_text,
                status,
                created_at,
                updated_at
            )
            VALUES (
                ${anchorId},
                ${input.draftPostId},
                ${input.circleId},
                ${input.roomKey},
                ${BigInt(fromSeq)},
                ${BigInt(toSeq)},
                ${payloadUpdates.length},
                ${updatesDigest},
                ${input.snapshotHash},
                ${payloadHash},
                ${JSON.stringify(canonicalPayload)}::jsonb,
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
        return (await findByAnchorId(input.prisma, anchorId)) as CollabEditAnchorRecord;
    }

    if (!config.enabled) {
        await updateAnchorStatus(input.prisma, {
            anchorId,
            status: 'skipped',
            errorMessage: 'COLLAB_EDIT_ANCHOR_ENABLED=false',
        });
        return (await findByAnchorId(input.prisma, anchorId)) as CollabEditAnchorRecord;
    }
    if (!config.writerEnabled) {
        await updateAnchorStatus(input.prisma, {
            anchorId,
            status: 'skipped',
            errorMessage: 'COLLAB_EDIT_ANCHOR_WRITER_ENABLED=false',
        });
        return (await findByAnchorId(input.prisma, anchorId)) as CollabEditAnchorRecord;
    }
    if (config.signerMode === 'local' && !fs.existsSync(config.keypairPath)) {
        await updateAnchorStatus(input.prisma, {
            anchorId,
            status: 'skipped',
            errorMessage: `anchor keypair not found: ${config.keypairPath}`,
        });
        return (await findByAnchorId(input.prisma, anchorId)) as CollabEditAnchorRecord;
    }

    try {
        const anchored = await submitMemoAnchorWithSigner({
            config: {
                mode: config.signerMode,
                rpcUrl: config.rpcUrl,
                commitment: config.commitment,
                keypairPath: config.keypairPath,
                externalUrl: config.signerUrl,
                externalAuthToken: config.signerAuthToken,
                externalTimeoutMs: config.signerTimeoutMs,
                signerLabel: 'collab_edit_anchor',
            },
            memoText,
            memoProgramId: MEMO_PROGRAM_ID,
        });
        await updateAnchorStatus(input.prisma, {
            anchorId,
            status: 'anchored',
            txSignature: anchored.signature,
            txSlot: anchored.slot,
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

    return (await findByAnchorId(input.prisma, anchorId)) as CollabEditAnchorRecord;
}

export async function getCollabEditAnchorById(
    prisma: PrismaLike,
    anchorId: string,
): Promise<CollabEditAnchorRecord | null> {
    return findByAnchorId(prisma, anchorId);
}

export async function getCollabEditAnchorsByPostId(
    prisma: PrismaLike,
    draftPostId: number,
    limit = 20,
): Promise<CollabEditAnchorRecord[]> {
    const boundedLimit = Math.max(1, Math.min(parsePositiveInt(String(limit), 20), 100));
    const rows = await prisma.$queryRaw<CollabEditAnchorBatchRow[]>`
        SELECT
            anchor_id AS "anchorId",
            draft_post_id AS "draftPostId",
            circle_id AS "circleId",
            room_key AS "roomKey",
            from_seq AS "fromSeq",
            to_seq AS "toSeq",
            update_count AS "updateCount",
            updates_digest AS "updatesDigest",
            snapshot_hash AS "snapshotHash",
            payload_hash AS "payloadHash",
            canonical_payload AS "canonicalPayload",
            chain AS "chain",
            memo_text AS "memoText",
            tx_signature AS "txSignature",
            tx_slot AS "txSlot",
            status AS "status",
            error_message AS "errorMessage",
            created_at AS "createdAt",
            anchored_at AS "anchoredAt",
            updated_at AS "updatedAt"
        FROM collab_edit_anchor_batches
        WHERE draft_post_id = ${draftPostId}
        ORDER BY created_at DESC
        LIMIT ${boundedLimit}
    `;
    return rows.map(mapRow);
}

export async function getCollabEditAnchorsBySnapshotHash(
    prisma: PrismaLike,
    input: {
        draftPostId: number;
        snapshotHash: string;
        limit?: number;
    },
): Promise<CollabEditAnchorRecord[]> {
    const boundedLimit = Math.max(1, Math.min(parsePositiveInt(String(input.limit), 20), 100));
    const rows = await prisma.$queryRaw<CollabEditAnchorBatchRow[]>`
        SELECT
            anchor_id AS "anchorId",
            draft_post_id AS "draftPostId",
            circle_id AS "circleId",
            room_key AS "roomKey",
            from_seq AS "fromSeq",
            to_seq AS "toSeq",
            update_count AS "updateCount",
            updates_digest AS "updatesDigest",
            snapshot_hash AS "snapshotHash",
            payload_hash AS "payloadHash",
            canonical_payload AS "canonicalPayload",
            chain AS "chain",
            memo_text AS "memoText",
            tx_signature AS "txSignature",
            tx_slot AS "txSlot",
            status AS "status",
            error_message AS "errorMessage",
            created_at AS "createdAt",
            anchored_at AS "anchoredAt",
            updated_at AS "updatedAt"
        FROM collab_edit_anchor_batches
        WHERE draft_post_id = ${input.draftPostId}
          AND snapshot_hash = ${String(input.snapshotHash || '').toLowerCase()}
        ORDER BY created_at DESC
        LIMIT ${boundedLimit}
    `;
    return rows.map(mapRow);
}

export function verifyCollabEditAnchor(record: CollabEditAnchorRecord): CollabEditAnchorProof {
    const payload = record.canonicalPayload;
    const canonicalJson = payload ? stableStringify(payload) : null;
    const recomputedPayloadHash = canonicalJson ? sha256Hex(canonicalJson) : null;
    const recomputedUpdatesDigest = payload?.updates ? buildUpdatesDigest(payload.updates) : null;
    const payloadHashMatches =
        Boolean(recomputedPayloadHash)
        && isSha256Hex(record.payloadHash)
        && recomputedPayloadHash === record.payloadHash;
    const anchorIdMatchesPayloadHash =
        payloadHashMatches
        && isSha256Hex(record.anchorId)
        && record.anchorId === record.payloadHash;
    const updatesDigestMatches =
        Boolean(payload)
        && isSha256Hex(record.updatesDigest)
        && payload!.updatesDigest === record.updatesDigest
        && recomputedUpdatesDigest === record.updatesDigest;
    const snapshotHashMatches =
        Boolean(payload)
        && isSha256Hex(record.snapshotHash)
        && payload!.snapshotHash === record.snapshotHash;
    const envelopeMatches =
        Boolean(payload)
        && payload!.draftPostId === record.draftPostId
        && payload!.circleId === record.circleId
        && payload!.roomKey === record.roomKey
        && payload!.fromSeq.toString() === record.fromSeq
        && payload!.toSeq.toString() === record.toSeq
        && payload!.updateCount === record.updateCount;

    const memoContainsAnchor = record.memoText.includes(record.anchorId);
    const memoContainsUpdatesDigest = record.memoText.includes(record.updatesDigest);
    const memoContainsSnapshotHash = record.memoText.includes(record.snapshotHash);

    return {
        payloadHashMatches,
        anchorIdMatchesPayloadHash,
        updatesDigestMatches,
        snapshotHashMatches,
        envelopeMatches,
        memoContainsAnchor,
        memoContainsUpdatesDigest,
        memoContainsSnapshotHash,
        verifiable:
            payloadHashMatches
            && anchorIdMatchesPayloadHash
            && updatesDigestMatches
            && snapshotHashMatches
            && envelopeMatches
            && memoContainsAnchor
            && memoContainsUpdatesDigest
            && memoContainsSnapshotHash
            && (record.status === 'anchored' || record.status === 'pending'),
    };
}
