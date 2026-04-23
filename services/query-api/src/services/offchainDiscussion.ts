import crypto from 'crypto';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Prisma, PrismaClient } from '@prisma/client';

export const DISCUSSION_STREAM_KEY = process.env.DISCUSSION_STREAM_KEY || 'circle-discussion';

type SqlClient = PrismaClient | Prisma.TransactionClient;

export interface DiscussionSigningPayload {
    v: 1;
    roomKey: string;
    circleId: number;
    senderPubkey: string;
    text: string;
    clientTimestamp: string;
    nonce: string;
    prevEnvelopeId: string | null;
    subjectType?: 'knowledge' | 'discussion_message';
    subjectId?: string;
}

export interface DiscussionTombstonePayload {
    v: 1;
    action: 'tombstone';
    roomKey: string;
    circleId: number;
    senderPubkey: string;
    envelopeId: string;
    reason: string;
    clientTimestamp: string;
}

export interface OffchainWatermarkRow {
    streamKey: string;
    lastLamport: bigint;
    lastEnvelopeId: string | null;
    lastIngestedAt: Date | null;
    updatedAt: Date;
}

export function buildDiscussionRoomKey(circleId: number): string {
    return `circle:${circleId}`;
}

function normalizeDiscussionSubject(input: {
    subjectType?: string | null;
    subjectId?: string | null;
}): { subjectType?: 'knowledge' | 'discussion_message'; subjectId?: string } {
    const subjectType = typeof input.subjectType === 'string' ? input.subjectType.trim() : '';
    const subjectId = typeof input.subjectId === 'string' ? input.subjectId.trim() : '';

    if (!subjectType && !subjectId) {
        return {};
    }

    if (!subjectId) {
        throw new Error('invalid_discussion_subject');
    }

    if (subjectType !== 'knowledge' && subjectType !== 'discussion_message') {
        throw new Error('invalid_discussion_subject');
    }

    return {
        subjectType,
        subjectId,
    };
}

export function normalizeDiscussionText(text: string): string {
    return text.replace(/\r\n/g, '\n').trim();
}

export function sha256Hex(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}

export function buildDiscussionSigningPayload(input: {
    roomKey: string;
    circleId: number;
    senderPubkey: string;
    text: string;
    clientTimestamp: string;
    nonce: string;
    prevEnvelopeId?: string | null;
    subjectType?: string | null;
    subjectId?: string | null;
}): DiscussionSigningPayload {
    const subject = normalizeDiscussionSubject({
        subjectType: input.subjectType,
        subjectId: input.subjectId,
    });

    return {
        v: 1,
        roomKey: input.roomKey,
        circleId: input.circleId,
        senderPubkey: input.senderPubkey,
        text: normalizeDiscussionText(input.text),
        clientTimestamp: input.clientTimestamp,
        nonce: input.nonce,
        prevEnvelopeId: input.prevEnvelopeId ?? null,
        ...subject,
    };
}

export function buildDiscussionSigningMessage(payload: DiscussionSigningPayload): string {
    return `alcheme-discussion:${JSON.stringify(payload)}`;
}

export function buildDiscussionTombstonePayload(input: {
    roomKey: string;
    circleId: number;
    senderPubkey: string;
    envelopeId: string;
    reason: string;
    clientTimestamp: string;
}): DiscussionTombstonePayload {
    return {
        v: 1,
        action: 'tombstone',
        roomKey: input.roomKey,
        circleId: input.circleId,
        senderPubkey: input.senderPubkey,
        envelopeId: input.envelopeId,
        reason: input.reason,
        clientTimestamp: input.clientTimestamp,
    };
}

export function buildDiscussionTombstoneMessage(payload: DiscussionTombstonePayload): string {
    return `alcheme-discussion-action:${JSON.stringify(payload)}`;
}

export function verifyEd25519SignatureBase64(input: {
    senderPubkey: string;
    message: string;
    signatureBase64: string | null | undefined;
}): boolean {
    if (!input.signatureBase64) return false;

    try {
        const signatureBytes = Buffer.from(input.signatureBase64, 'base64');
        const pubkeyBytes = bs58.decode(input.senderPubkey);
        const messageBytes = new TextEncoder().encode(input.message);
        return nacl.sign.detached.verify(messageBytes, signatureBytes, pubkeyBytes);
    } catch {
        return false;
    }
}

export function computeDiscussionEnvelopeId(input: {
    roomKey: string;
    senderPubkey: string;
    payloadHash: string;
    clientTimestamp: string;
    nonce: string;
    prevEnvelopeId?: string | null;
    signatureBase64?: string | null;
    subjectType?: string | null;
    subjectId?: string | null;
}): string {
    const subject = normalizeDiscussionSubject({
        subjectType: input.subjectType,
        subjectId: input.subjectId,
    });

    const seed = [
        input.roomKey,
        input.senderPubkey,
        input.payloadHash,
        input.clientTimestamp,
        input.nonce,
        input.prevEnvelopeId ?? '',
        input.signatureBase64 ?? '',
        subject.subjectType ?? '',
        subject.subjectId ?? '',
    ].join('|');
    return sha256Hex(seed);
}

export async function ensureOffchainDiscussionSchema(prisma: PrismaClient): Promise<void> {
    const stmts = [
        `
        CREATE SEQUENCE IF NOT EXISTS discussion_lamport_seq
        AS BIGINT
        START WITH 1
        INCREMENT BY 1
        NO MINVALUE
        NO MAXVALUE
        CACHE 1
        `,
        `
        CREATE TABLE IF NOT EXISTS circle_discussion_messages (
            id BIGSERIAL PRIMARY KEY,
            envelope_id VARCHAR(96) NOT NULL UNIQUE,
            stream_key VARCHAR(64) NOT NULL DEFAULT 'circle-discussion',
            room_key VARCHAR(64) NOT NULL,
            circle_id INTEGER NOT NULL,
            sender_pubkey VARCHAR(44) NOT NULL,
            sender_handle VARCHAR(32),
            message_kind VARCHAR(32) NOT NULL DEFAULT 'plain',
            subject_type VARCHAR(32),
            subject_id VARCHAR(128),
            metadata JSONB,
            payload_text TEXT NOT NULL,
            payload_hash CHAR(64) NOT NULL,
            nonce VARCHAR(64) NOT NULL,
            signature VARCHAR(512),
            signature_scheme VARCHAR(16) NOT NULL DEFAULT 'ed25519',
            signed_message TEXT NOT NULL,
            signature_verified BOOLEAN NOT NULL DEFAULT false,
            relevance_score NUMERIC(4,3) NOT NULL DEFAULT 1.000,
            relevance_method VARCHAR(32) NOT NULL DEFAULT 'rule',
            relevance_status VARCHAR(16) NOT NULL DEFAULT 'ready',
            embedding_score NUMERIC(4,3),
            actual_mode VARCHAR(32),
            analysis_version VARCHAR(32),
            topic_profile_version VARCHAR(128),
            semantic_facets JSONB NOT NULL DEFAULT '[]'::jsonb,
            focus_score NUMERIC(4,3),
            focus_label VARCHAR(16),
            is_featured BOOLEAN NOT NULL DEFAULT FALSE,
            feature_reason VARCHAR(240),
            featured_at TIMESTAMP(3),
            analysis_completed_at TIMESTAMP(3),
            analysis_error_code VARCHAR(64),
            analysis_error_message TEXT,
            author_annotations JSONB NOT NULL DEFAULT '[]'::jsonb,
            is_ephemeral BOOLEAN NOT NULL DEFAULT false,
            expires_at TIMESTAMP(3),
            client_timestamp TIMESTAMP(3) NOT NULL,
            lamport BIGINT NOT NULL DEFAULT nextval('discussion_lamport_seq'),
            prev_envelope_id VARCHAR(96),
            deleted BOOLEAN NOT NULL DEFAULT false,
            tombstone_reason VARCHAR(64),
            tombstoned_at TIMESTAMP(3),
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        `,
        `ALTER TABLE circle_discussion_messages ADD COLUMN IF NOT EXISTS message_kind VARCHAR(32) NOT NULL DEFAULT 'plain'`,
        `ALTER TABLE circle_discussion_messages ADD COLUMN IF NOT EXISTS subject_type VARCHAR(32)`,
        `ALTER TABLE circle_discussion_messages ADD COLUMN IF NOT EXISTS subject_id VARCHAR(128)`,
        `ALTER TABLE circle_discussion_messages ADD COLUMN IF NOT EXISTS metadata JSONB`,
        `CREATE INDEX IF NOT EXISTS idx_discussion_room_lamport ON circle_discussion_messages(room_key, lamport DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_discussion_stream_lamport ON circle_discussion_messages(stream_key, lamport ASC)`,
        `CREATE INDEX IF NOT EXISTS idx_discussion_circle_lamport ON circle_discussion_messages(circle_id, lamport DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_discussion_circle_message_kind_lamport ON circle_discussion_messages(circle_id, message_kind, lamport DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_discussion_subject_lamport ON circle_discussion_messages(subject_type, subject_id, lamport DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_discussion_subject_message_kind_lamport ON circle_discussion_messages(subject_type, subject_id, message_kind, lamport DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_discussion_circle_subject_lamport ON circle_discussion_messages(circle_id, subject_type, subject_id, lamport DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_discussion_sender_lamport ON circle_discussion_messages(sender_pubkey, lamport DESC)`,
        `ALTER TABLE circle_discussion_messages ADD COLUMN IF NOT EXISTS auth_mode VARCHAR(32) NOT NULL DEFAULT 'wallet_per_message'`,
        `ALTER TABLE circle_discussion_messages ADD COLUMN IF NOT EXISTS session_id VARCHAR(64)`,
        `ALTER TABLE circle_discussion_messages ADD COLUMN IF NOT EXISTS relevance_score NUMERIC(4,3) NOT NULL DEFAULT 1.000`,
        `ALTER TABLE circle_discussion_messages ADD COLUMN IF NOT EXISTS relevance_method VARCHAR(32) NOT NULL DEFAULT 'rule'`,
        `ALTER TABLE circle_discussion_messages ADD COLUMN IF NOT EXISTS relevance_status VARCHAR(16) NOT NULL DEFAULT 'ready'`,
        `ALTER TABLE circle_discussion_messages ADD COLUMN IF NOT EXISTS embedding_score NUMERIC(4,3)`,
        `ALTER TABLE circle_discussion_messages ADD COLUMN IF NOT EXISTS actual_mode VARCHAR(32)`,
        `ALTER TABLE circle_discussion_messages ADD COLUMN IF NOT EXISTS analysis_version VARCHAR(32)`,
        `ALTER TABLE circle_discussion_messages ADD COLUMN IF NOT EXISTS topic_profile_version VARCHAR(128)`,
        `ALTER TABLE circle_discussion_messages ADD COLUMN IF NOT EXISTS semantic_facets JSONB NOT NULL DEFAULT '[]'::jsonb`,
        `ALTER TABLE circle_discussion_messages ADD COLUMN IF NOT EXISTS focus_score NUMERIC(4,3)`,
        `ALTER TABLE circle_discussion_messages ADD COLUMN IF NOT EXISTS focus_label VARCHAR(16)`,
        `ALTER TABLE circle_discussion_messages ADD COLUMN IF NOT EXISTS semantic_score NUMERIC(4,3)`,
        `ALTER TABLE circle_discussion_messages ADD COLUMN IF NOT EXISTS quality_score NUMERIC(4,3)`,
        `ALTER TABLE circle_discussion_messages ADD COLUMN IF NOT EXISTS spam_score NUMERIC(4,3)`,
        `ALTER TABLE circle_discussion_messages ADD COLUMN IF NOT EXISTS decision_confidence NUMERIC(4,3)`,
        `ALTER TABLE circle_discussion_messages ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE`,
        `ALTER TABLE circle_discussion_messages ADD COLUMN IF NOT EXISTS feature_reason VARCHAR(240)`,
        `ALTER TABLE circle_discussion_messages ADD COLUMN IF NOT EXISTS featured_at TIMESTAMP(3)`,
        `ALTER TABLE circle_discussion_messages ADD COLUMN IF NOT EXISTS analysis_completed_at TIMESTAMP(3)`,
        `ALTER TABLE circle_discussion_messages ADD COLUMN IF NOT EXISTS analysis_error_code VARCHAR(64)`,
        `ALTER TABLE circle_discussion_messages ADD COLUMN IF NOT EXISTS analysis_error_message TEXT`,
        `ALTER TABLE circle_discussion_messages ADD COLUMN IF NOT EXISTS author_annotations JSONB NOT NULL DEFAULT '[]'::jsonb`,
        `ALTER TABLE circle_discussion_messages ADD COLUMN IF NOT EXISTS is_ephemeral BOOLEAN NOT NULL DEFAULT FALSE`,
        `ALTER TABLE circle_discussion_messages ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP(3)`,
        `CREATE INDEX IF NOT EXISTS idx_discussion_session_id ON circle_discussion_messages(session_id)`,
        `CREATE INDEX IF NOT EXISTS idx_discussion_relevance_score ON circle_discussion_messages(relevance_score)`,
        `CREATE INDEX IF NOT EXISTS idx_discussion_semantic_score ON circle_discussion_messages(semantic_score)`,
        `CREATE INDEX IF NOT EXISTS idx_discussion_spam_score ON circle_discussion_messages(spam_score)`,
        `CREATE INDEX IF NOT EXISTS idx_discussion_relevance_status ON circle_discussion_messages(relevance_status)`,
        `CREATE INDEX IF NOT EXISTS idx_discussion_circle_featured_at ON circle_discussion_messages(circle_id, is_featured, featured_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_discussion_circle_ephemeral_lamport ON circle_discussion_messages(circle_id, is_ephemeral, lamport DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_discussion_ephemeral_expires_at ON circle_discussion_messages(is_ephemeral, expires_at)`,
        `
        CREATE TABLE IF NOT EXISTS offchain_sync_watermarks (
            stream_key VARCHAR(64) PRIMARY KEY,
            last_lamport BIGINT NOT NULL DEFAULT 0,
            last_envelope_id VARCHAR(96),
            last_ingested_at TIMESTAMP(3),
            updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        `,
        `
        CREATE TABLE IF NOT EXISTS offchain_peer_sync_state (
            peer_url VARCHAR(512) PRIMARY KEY,
            last_remote_lamport BIGINT NOT NULL DEFAULT 0,
            last_success_at TIMESTAMP(3),
            last_error TEXT,
            updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        `,
        `
        CREATE TABLE IF NOT EXISTS discussion_sessions (
            session_id VARCHAR(64) PRIMARY KEY,
            sender_pubkey VARCHAR(44) NOT NULL,
            sender_handle VARCHAR(32),
            scope VARCHAR(64) NOT NULL DEFAULT 'circle:*',
            issued_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            expires_at TIMESTAMP(3) NOT NULL,
            revoked BOOLEAN NOT NULL DEFAULT false,
            last_seen_at TIMESTAMP(3),
            client_meta JSONB,
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        `,
        `CREATE INDEX IF NOT EXISTS idx_discussion_sessions_sender_pubkey ON discussion_sessions(sender_pubkey)`,
        `CREATE INDEX IF NOT EXISTS idx_discussion_sessions_expires_at ON discussion_sessions(expires_at)`,
        `
        CREATE TABLE IF NOT EXISTS ghost_runs (
            id BIGSERIAL PRIMARY KEY,
            run_kind VARCHAR(64) NOT NULL,
            status VARCHAR(16) NOT NULL,
            circle_id INTEGER NOT NULL,
            reason VARCHAR(64) NOT NULL,
            window_size INTEGER NOT NULL,
            message_count INTEGER,
            focused_count INTEGER,
            focused_ratio NUMERIC(5,4),
            min_messages INTEGER NOT NULL,
            min_question_count INTEGER NOT NULL,
            min_focused_ratio NUMERIC(5,4) NOT NULL,
            question_count INTEGER,
            summary_method VARCHAR(32),
            summary_preview TEXT,
            draft_post_id INTEGER,
            metadata JSONB,
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        `,
        `CREATE INDEX IF NOT EXISTS idx_ghost_runs_kind_created_at ON ghost_runs(run_kind, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_ghost_runs_circle_created_at ON ghost_runs(circle_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_ghost_runs_status_created_at ON ghost_runs(status, created_at DESC)`,
        `
        CREATE TABLE IF NOT EXISTS circle_ghost_settings (
            circle_id INTEGER PRIMARY KEY,
            relevance_mode VARCHAR(16),
            summary_use_llm BOOLEAN,
            draft_trigger_mode VARCHAR(24),
            trigger_summary_use_llm BOOLEAN,
            trigger_generate_comment BOOLEAN,
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        `,
        `CREATE INDEX IF NOT EXISTS idx_circle_ghost_settings_updated_at ON circle_ghost_settings(updated_at DESC)`,
        `
        CREATE TABLE IF NOT EXISTS discussion_draft_anchor_batches (
            anchor_id CHAR(64) PRIMARY KEY,
            circle_id INTEGER NOT NULL,
            draft_post_id INTEGER NOT NULL,
            room_key VARCHAR(64) NOT NULL,
            trigger_reason VARCHAR(64) NOT NULL,
            summary_hash CHAR(64) NOT NULL,
            messages_digest CHAR(64) NOT NULL,
            payload_hash CHAR(64) NOT NULL,
            canonical_payload JSONB NOT NULL,
            message_count INTEGER NOT NULL,
            from_lamport BIGINT,
            to_lamport BIGINT,
            chain VARCHAR(32) NOT NULL DEFAULT 'solana',
            memo_text TEXT NOT NULL,
            tx_signature VARCHAR(128),
            tx_slot BIGINT,
            status VARCHAR(16) NOT NULL DEFAULT 'pending',
            error_message TEXT,
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            anchored_at TIMESTAMP(3),
            updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        `,
        `CREATE INDEX IF NOT EXISTS idx_draft_anchor_batches_circle_created_at ON discussion_draft_anchor_batches(circle_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_draft_anchor_batches_post_created_at ON discussion_draft_anchor_batches(draft_post_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_draft_anchor_batches_status_created_at ON discussion_draft_anchor_batches(status, created_at DESC)`,
        `
        CREATE TABLE IF NOT EXISTS collab_edit_anchor_batches (
            anchor_id CHAR(64) PRIMARY KEY,
            draft_post_id INTEGER NOT NULL,
            circle_id INTEGER NOT NULL,
            room_key VARCHAR(64) NOT NULL,
            from_seq BIGINT NOT NULL,
            to_seq BIGINT NOT NULL,
            update_count INTEGER NOT NULL,
            updates_digest CHAR(64) NOT NULL,
            snapshot_hash CHAR(64) NOT NULL,
            payload_hash CHAR(64) NOT NULL,
            canonical_payload JSONB NOT NULL,
            chain VARCHAR(32) NOT NULL DEFAULT 'solana',
            memo_text TEXT NOT NULL,
            tx_signature VARCHAR(128),
            tx_slot BIGINT,
            status VARCHAR(16) NOT NULL DEFAULT 'pending',
            error_message TEXT,
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            anchored_at TIMESTAMP(3),
            updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        `,
        `CREATE INDEX IF NOT EXISTS idx_collab_anchor_batches_post_created_at ON collab_edit_anchor_batches(draft_post_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_collab_anchor_batches_circle_created_at ON collab_edit_anchor_batches(circle_id, created_at DESC)`,
        `CREATE INDEX IF NOT EXISTS idx_collab_anchor_batches_status_created_at ON collab_edit_anchor_batches(status, created_at DESC)`,
    ];

    for (const stmt of stmts) {
        try {
            await prisma.$executeRawUnsafe(stmt);
        } catch (error) {
            if (isIgnorableDiscussionBootstrapRace(stmt, error)) {
                continue;
            }
            throw error;
        }
    }

    await prisma.$executeRaw`
        INSERT INTO offchain_sync_watermarks (
            stream_key,
            last_lamport,
            last_envelope_id,
            last_ingested_at,
            updated_at
        ) VALUES (
            ${DISCUSSION_STREAM_KEY},
            ${BigInt(0)},
            ${null},
            ${null},
            NOW()
        )
        ON CONFLICT (stream_key) DO NOTHING
    `;
}

function extractBootstrapIndexName(stmt: string): string | null {
    const match = stmt.trim().match(/^CREATE INDEX IF NOT EXISTS\s+([a-zA-Z0-9_]+)/i);
    return match ? match[1] : null;
}

function extractDuplicateRelationName(message: string): string | null {
    const match = message.match(/\(relname, relnamespace\)=\(([^,]+),\s*\d+\)\s+already exists/i);
    return match ? match[1].replace(/^"|"$/g, '').trim() : null;
}

function isIgnorableDiscussionBootstrapRace(stmt: string, error: unknown): boolean {
    const prismaCode = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
    const meta = typeof error === 'object' && error !== null ? (error as { meta?: unknown }).meta : undefined;
    const databaseCode =
        typeof meta === 'object' && meta !== null ? (meta as { code?: unknown }).code : undefined;
    const message =
        typeof meta === 'object' && meta !== null ? (meta as { message?: unknown }).message : undefined;
    const normalizedMessage = typeof message === 'string' ? message : '';
    const expectedIndexName = extractBootstrapIndexName(stmt);
    const duplicateRelationName = extractDuplicateRelationName(normalizedMessage);

    return prismaCode === 'P2010'
        && databaseCode === '23505'
        && expectedIndexName !== null
        && duplicateRelationName === expectedIndexName;
}

export async function updateOffchainWatermark(
    client: SqlClient,
    params: { streamKey?: string; lamport: bigint; envelopeId: string | null },
): Promise<void> {
    const streamKey = params.streamKey || DISCUSSION_STREAM_KEY;
    await client.$executeRaw`
        INSERT INTO offchain_sync_watermarks (
            stream_key,
            last_lamport,
            last_envelope_id,
            last_ingested_at,
            updated_at
        ) VALUES (
            ${streamKey},
            ${params.lamport},
            ${params.envelopeId},
            NOW(),
            NOW()
        )
        ON CONFLICT (stream_key) DO UPDATE SET
            last_lamport = GREATEST(offchain_sync_watermarks.last_lamport, EXCLUDED.last_lamport),
            last_envelope_id = CASE
                WHEN EXCLUDED.last_lamport >= offchain_sync_watermarks.last_lamport THEN EXCLUDED.last_envelope_id
                ELSE offchain_sync_watermarks.last_envelope_id
            END,
            last_ingested_at = CASE
                WHEN EXCLUDED.last_lamport >= offchain_sync_watermarks.last_lamport THEN NOW()
                ELSE offchain_sync_watermarks.last_ingested_at
            END,
            updated_at = NOW()
    `;
}

export async function readOffchainWatermark(
    client: SqlClient,
    streamKey = DISCUSSION_STREAM_KEY,
): Promise<OffchainWatermarkRow | null> {
    const rows = await client.$queryRaw<OffchainWatermarkRow[]>`
        SELECT
            stream_key AS "streamKey",
            last_lamport AS "lastLamport",
            last_envelope_id AS "lastEnvelopeId",
            last_ingested_at AS "lastIngestedAt",
            updated_at AS "updatedAt"
        FROM offchain_sync_watermarks
        WHERE stream_key = ${streamKey}
        LIMIT 1
    `;

    return rows[0] || null;
}
