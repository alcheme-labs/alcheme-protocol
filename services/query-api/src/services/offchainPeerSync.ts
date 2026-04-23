import { Prisma, PrismaClient } from '@prisma/client';
import { DISCUSSION_STREAM_KEY, updateOffchainWatermark } from './offchainDiscussion';
import { sqlTimestampWithoutTimeZone } from '../utils/sqlTimestamp';

type SqlClient = PrismaClient | Prisma.TransactionClient;

interface RemoteDiscussionEnvelope {
    envelopeId: string;
    roomKey: string;
    circleId: number;
    senderPubkey: string;
    senderHandle: string | null;
    messageKind?: string | null;
    subjectType?: string | null;
    subjectId?: string | null;
    metadata?: Prisma.JsonValue | null;
    text: string;
    payloadHash: string;
    nonce: string;
    signature: string | null;
    signatureVerified: boolean;
    authMode?: string | null;
    sessionId?: string | null;
    relevanceScore?: number | string | null;
    semanticScore?: number | string | null;
    qualityScore?: number | string | null;
    spamScore?: number | string | null;
    decisionConfidence?: number | string | null;
    relevanceMethod?: string | null;
    relevanceStatus?: string | null;
    embeddingScore?: number | string | null;
    actualMode?: string | null;
    analysisVersion?: string | null;
    topicProfileVersion?: string | null;
    semanticFacets?: Prisma.JsonValue | null;
    focusScore?: number | string | null;
    focusLabel?: string | null;
    analysisCompletedAt?: string | null;
    analysisErrorCode?: string | null;
    analysisErrorMessage?: string | null;
    authorAnnotations?: Prisma.JsonValue | null;
    isFeatured?: boolean | null;
    featureReason?: string | null;
    featuredAt?: string | null;
    clientTimestamp: string;
    lamport: number;
    prevEnvelopeId: string | null;
    deleted: boolean;
    isEphemeral?: boolean | null;
    expiresAt?: string | null;
    tombstoneReason: string | null;
    tombstonedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

interface RemoteDiscussionBatch {
    messages: RemoteDiscussionEnvelope[];
}

interface PeerSyncStateRow {
    peerUrl: string;
    lastRemoteLamport: bigint;
    lastSuccessAt: Date | null;
    lastError: string | null;
}

let intervalHandle: NodeJS.Timeout | null = null;
let running = false;

function normalizePeerUrl(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        const path = parsed.pathname.replace(/\/+$/, '');
        const normalized = `${parsed.protocol}//${parsed.host}${path}`;
        return normalized;
    } catch {
        return null;
    }
}

export function parseOffchainPeerUrls(raw = process.env.OFFCHAIN_DISCUSSION_PEERS || ''): string[] {
    const parts = raw
        .split(/[\n,]/g)
        .map((value) => normalizePeerUrl(value))
        .filter((value): value is string => !!value);
    return Array.from(new Set(parts));
}

function buildPeerStreamUrl(peerUrl: string, afterLamport: bigint, limit: number): string {
    const base = peerUrl.replace(/\/+$/, '');
    const query = new URLSearchParams({
        afterLamport: afterLamport.toString(),
        limit: String(limit),
        includeDeleted: 'true',
    });
    return `${base}/api/v1/discussion/stream?${query.toString()}`;
}

async function fetchPeerBatch(input: {
    peerUrl: string;
    afterLamport: bigint;
    limit: number;
    timeoutMs: number;
}): Promise<RemoteDiscussionBatch> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    const url = buildPeerStreamUrl(input.peerUrl, input.afterLamport, input.limit);

    try {
        const response = await fetch(url, {
            method: 'GET',
            cache: 'no-store',
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(`peer stream request failed (${response.status})`);
        }
        const json = await response.json();
        const messages = Array.isArray(json?.messages) ? json.messages : [];
        return { messages };
    } finally {
        clearTimeout(timer);
    }
}

async function readPeerState(client: SqlClient, peerUrl: string): Promise<PeerSyncStateRow | null> {
    const rows = await client.$queryRaw<PeerSyncStateRow[]>`
        SELECT
            peer_url AS "peerUrl",
            last_remote_lamport AS "lastRemoteLamport",
            last_success_at AS "lastSuccessAt",
            last_error AS "lastError"
        FROM offchain_peer_sync_state
        WHERE peer_url = ${peerUrl}
        LIMIT 1
    `;
    return rows[0] || null;
}

async function upsertPeerState(
    client: SqlClient,
    params: {
        peerUrl: string;
        lastRemoteLamport: bigint;
        lastSuccessAt?: Date | null;
        lastError?: string | null;
    },
): Promise<void> {
    await client.$executeRaw`
        INSERT INTO offchain_peer_sync_state (
            peer_url,
            last_remote_lamport,
            last_success_at,
            last_error,
            updated_at
        )
        VALUES (
            ${params.peerUrl},
            ${params.lastRemoteLamport},
            ${params.lastSuccessAt ?? null},
            ${params.lastError ?? null},
            NOW()
        )
        ON CONFLICT (peer_url) DO UPDATE SET
            last_remote_lamport = GREATEST(
                offchain_peer_sync_state.last_remote_lamport,
                EXCLUDED.last_remote_lamport
            ),
            last_success_at = EXCLUDED.last_success_at,
            last_error = EXCLUDED.last_error,
            updated_at = NOW()
    `;
}

function parseRemoteDate(value: string | null | undefined, fallback: Date): Date {
    if (!value) return fallback;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function parseOptionalRemoteDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseNormalizedScore(value: unknown, fallback: number): number {
    const parsed = Number.parseFloat(String(value ?? ''));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.min(1, parsed));
}

function parseOptionalNormalizedScore(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number.parseFloat(String(value));
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, Math.min(1, parsed));
}

export async function ingestPeerEnvelope(
    client: SqlClient,
    envelope: RemoteDiscussionEnvelope,
): Promise<{ lamport: bigint; envelopeId: string }> {
    const now = new Date();
    const clientTimestamp = parseRemoteDate(envelope.clientTimestamp, now);
    const createdAt = parseRemoteDate(envelope.createdAt, clientTimestamp);
    const updatedAt = parseRemoteDate(envelope.updatedAt, createdAt);
    const tombstonedAt = parseRemoteDate(envelope.tombstonedAt, now);
    const senderHandle = envelope.senderHandle || null;
    const signature = envelope.signature || null;
    const prevEnvelopeId = envelope.prevEnvelopeId || null;
    const tombstoneReason = envelope.tombstoneReason || null;
    const safeText = typeof envelope.text === 'string' ? envelope.text : '';
    const safeHash = typeof envelope.payloadHash === 'string' && envelope.payloadHash.length > 0
        ? envelope.payloadHash
        : '';
    const safeNonce = typeof envelope.nonce === 'string' && envelope.nonce.length > 0
        ? envelope.nonce
        : envelope.envelopeId.slice(0, 32);
    const signatureVerified = Boolean(envelope.signatureVerified);
    const isDeleted = Boolean(envelope.deleted);
    const isEphemeral = Boolean(envelope.isEphemeral);
    const expiresAt = parseOptionalRemoteDate(envelope.expiresAt);
    const authModeRaw = typeof envelope.authMode === 'string' ? envelope.authMode.trim().toLowerCase() : '';
    const authMode = authModeRaw
        ? authModeRaw.slice(0, 32)
        : 'wallet_per_message';
    const sessionId = null;
    const semanticScore = parseOptionalNormalizedScore(envelope.semanticScore);
    const qualityScore = parseOptionalNormalizedScore(envelope.qualityScore);
    const spamScore = parseOptionalNormalizedScore(envelope.spamScore);
    const decisionConfidence = parseOptionalNormalizedScore(envelope.decisionConfidence);
    const relevanceScore = parseNormalizedScore(
        envelope.relevanceScore ?? semanticScore ?? 1,
        semanticScore ?? 1,
    );
    const embeddingScore = parseOptionalNormalizedScore(envelope.embeddingScore);
    const relevanceMethodRaw = typeof envelope.relevanceMethod === 'string'
        ? envelope.relevanceMethod.trim()
        : '';
    const relevanceMethod = relevanceMethodRaw ? relevanceMethodRaw.slice(0, 32) : 'rule';
    const relevanceStatusRaw = typeof envelope.relevanceStatus === 'string'
        ? envelope.relevanceStatus.trim().toLowerCase()
        : '';
    const relevanceStatus = (
        relevanceStatusRaw === 'pending'
        || relevanceStatusRaw === 'ready'
        || relevanceStatusRaw === 'stale'
        || relevanceStatusRaw === 'failed'
    ) ? relevanceStatusRaw : 'ready';
    const actualMode = typeof envelope.actualMode === 'string' && envelope.actualMode.trim()
        ? envelope.actualMode.trim().slice(0, 32)
        : null;
    const analysisVersion = typeof envelope.analysisVersion === 'string' && envelope.analysisVersion.trim()
        ? envelope.analysisVersion.trim().slice(0, 32)
        : null;
    const topicProfileVersion = typeof envelope.topicProfileVersion === 'string' && envelope.topicProfileVersion.trim()
        ? envelope.topicProfileVersion.trim().slice(0, 128)
        : null;
    const semanticFacetsJson = envelope.semanticFacets === null || envelope.semanticFacets === undefined
        ? JSON.stringify([])
        : JSON.stringify(envelope.semanticFacets);
    const focusScore = parseOptionalNormalizedScore(envelope.focusScore);
    const focusLabelRaw = typeof envelope.focusLabel === 'string' ? envelope.focusLabel.trim() : '';
    const focusLabel = (
        focusLabelRaw === 'focused'
        || focusLabelRaw === 'contextual'
        || focusLabelRaw === 'off_topic'
    ) ? focusLabelRaw : null;
    const analysisCompletedAt = parseOptionalRemoteDate(envelope.analysisCompletedAt);
    const analysisErrorCode = typeof envelope.analysisErrorCode === 'string' && envelope.analysisErrorCode.trim()
        ? envelope.analysisErrorCode.trim().slice(0, 64)
        : null;
    const analysisErrorMessage = typeof envelope.analysisErrorMessage === 'string' && envelope.analysisErrorMessage.trim()
        ? envelope.analysisErrorMessage.trim().slice(0, 2048)
        : null;
    const authorAnnotationsJson = envelope.authorAnnotations === null || envelope.authorAnnotations === undefined
        ? JSON.stringify([])
        : JSON.stringify(envelope.authorAnnotations);
    const isFeatured = Boolean(envelope.isFeatured);
    const featureReason = typeof envelope.featureReason === 'string' && envelope.featureReason.trim()
        ? envelope.featureReason.trim().slice(0, 240)
        : null;
    const featuredAt = parseOptionalRemoteDate(envelope.featuredAt);
    const messageKindRaw = typeof envelope.messageKind === 'string'
        ? envelope.messageKind.trim().toLowerCase()
        : '';
    const messageKind = messageKindRaw === 'forward' ? 'forward' : 'plain';
    const subjectTypeRaw = typeof envelope.subjectType === 'string'
        ? envelope.subjectType.trim()
        : '';
    const subjectIdRaw = typeof envelope.subjectId === 'string'
        ? envelope.subjectId.trim()
        : '';
    const subjectType = (
        (subjectTypeRaw === 'knowledge' || subjectTypeRaw === 'discussion_message')
        && subjectIdRaw
    )
        ? subjectTypeRaw
        : null;
    const subjectId = subjectType ? subjectIdRaw.slice(0, 128) : null;
    const metadataJson = envelope.metadata === null || envelope.metadata === undefined
        ? null
        : JSON.stringify(envelope.metadata);
    const persistedCreatedAt = sqlTimestampWithoutTimeZone(createdAt);
    const persistedUpdatedAt = sqlTimestampWithoutTimeZone(updatedAt);
    const persistedClientTimestamp = sqlTimestampWithoutTimeZone(clientTimestamp);
    const persistedExpiresAt = sqlTimestampWithoutTimeZone(expiresAt);
    const persistedFeaturedAt = sqlTimestampWithoutTimeZone(featuredAt);
    const persistedAnalysisCompletedAt = sqlTimestampWithoutTimeZone(analysisCompletedAt);
    const persistedTombstonedAt = sqlTimestampWithoutTimeZone(isDeleted ? tombstonedAt : null);
    const persistedNow = sqlTimestampWithoutTimeZone(new Date());

    const rows = await client.$queryRaw<Array<{ lamport: bigint; envelopeId: string }>>`
        INSERT INTO circle_discussion_messages (
            envelope_id,
            stream_key,
            room_key,
            circle_id,
            sender_pubkey,
            sender_handle,
            message_kind,
            subject_type,
            subject_id,
            metadata,
            payload_text,
            payload_hash,
            nonce,
            signature,
            signature_scheme,
            signed_message,
            signature_verified,
            auth_mode,
            session_id,
            relevance_score,
            semantic_score,
            relevance_status,
            embedding_score,
            quality_score,
            spam_score,
            decision_confidence,
            relevance_method,
            actual_mode,
            analysis_version,
            topic_profile_version,
            semantic_facets,
            focus_score,
            focus_label,
            is_featured,
            feature_reason,
            featured_at,
            analysis_completed_at,
            analysis_error_code,
            analysis_error_message,
            author_annotations,
            is_ephemeral,
            expires_at,
            client_timestamp,
            prev_envelope_id,
            deleted,
            tombstone_reason,
            tombstoned_at,
            created_at,
            updated_at
        )
        VALUES (
            ${envelope.envelopeId},
            ${DISCUSSION_STREAM_KEY},
            ${envelope.roomKey},
            ${envelope.circleId},
            ${envelope.senderPubkey},
            ${senderHandle},
            ${messageKind},
            ${subjectType},
            ${subjectId},
            ${metadataJson}::jsonb,
            ${safeText},
            ${safeHash},
            ${safeNonce},
            ${signature},
            'ed25519',
            '',
            ${signatureVerified},
            ${authMode},
            ${sessionId},
            ${relevanceScore},
            ${semanticScore},
            ${relevanceStatus},
            ${embeddingScore},
            ${qualityScore},
            ${spamScore},
            ${decisionConfidence},
            ${relevanceMethod},
            ${actualMode},
            ${analysisVersion},
            ${topicProfileVersion},
            ${semanticFacetsJson}::jsonb,
            ${focusScore},
            ${focusLabel},
            ${isFeatured},
            ${featureReason},
            ${persistedFeaturedAt},
            ${persistedAnalysisCompletedAt},
            ${analysisErrorCode},
            ${analysisErrorMessage},
            ${authorAnnotationsJson}::jsonb,
            ${isEphemeral},
            ${persistedExpiresAt},
            ${persistedClientTimestamp},
            ${prevEnvelopeId},
            ${isDeleted},
            ${tombstoneReason},
            ${persistedTombstonedAt},
            ${persistedCreatedAt},
            ${persistedUpdatedAt}
        )
        ON CONFLICT (envelope_id) DO UPDATE SET
            sender_handle = COALESCE(EXCLUDED.sender_handle, circle_discussion_messages.sender_handle),
            message_kind = EXCLUDED.message_kind,
            subject_type = COALESCE(EXCLUDED.subject_type, circle_discussion_messages.subject_type),
            subject_id = COALESCE(EXCLUDED.subject_id, circle_discussion_messages.subject_id),
            metadata = COALESCE(EXCLUDED.metadata, circle_discussion_messages.metadata),
            signature = COALESCE(EXCLUDED.signature, circle_discussion_messages.signature),
            signature_verified = circle_discussion_messages.signature_verified OR EXCLUDED.signature_verified,
            auth_mode = EXCLUDED.auth_mode,
            session_id = COALESCE(EXCLUDED.session_id, circle_discussion_messages.session_id),
            relevance_score = EXCLUDED.relevance_score,
            semantic_score = EXCLUDED.semantic_score,
            relevance_status = EXCLUDED.relevance_status,
            embedding_score = EXCLUDED.embedding_score,
            quality_score = EXCLUDED.quality_score,
            spam_score = EXCLUDED.spam_score,
            decision_confidence = EXCLUDED.decision_confidence,
            relevance_method = EXCLUDED.relevance_method,
            actual_mode = EXCLUDED.actual_mode,
            analysis_version = EXCLUDED.analysis_version,
            topic_profile_version = EXCLUDED.topic_profile_version,
            semantic_facets = EXCLUDED.semantic_facets,
            focus_score = EXCLUDED.focus_score,
            focus_label = EXCLUDED.focus_label,
            is_featured = EXCLUDED.is_featured,
            feature_reason = EXCLUDED.feature_reason,
            featured_at = EXCLUDED.featured_at,
            analysis_completed_at = EXCLUDED.analysis_completed_at,
            analysis_error_code = EXCLUDED.analysis_error_code,
            analysis_error_message = EXCLUDED.analysis_error_message,
            author_annotations = EXCLUDED.author_annotations,
            is_ephemeral = EXCLUDED.is_ephemeral,
            expires_at = EXCLUDED.expires_at,
            deleted = circle_discussion_messages.deleted OR EXCLUDED.deleted,
            tombstone_reason = CASE
                WHEN EXCLUDED.deleted THEN COALESCE(EXCLUDED.tombstone_reason, circle_discussion_messages.tombstone_reason)
                ELSE circle_discussion_messages.tombstone_reason
            END,
            tombstoned_at = CASE
                WHEN EXCLUDED.deleted THEN COALESCE(EXCLUDED.tombstoned_at, circle_discussion_messages.tombstoned_at, ${persistedNow})
                ELSE circle_discussion_messages.tombstoned_at
            END,
            lamport = CASE
                WHEN (circle_discussion_messages.deleted IS DISTINCT FROM (circle_discussion_messages.deleted OR EXCLUDED.deleted))
                    OR circle_discussion_messages.relevance_status IS DISTINCT FROM EXCLUDED.relevance_status
                    OR circle_discussion_messages.semantic_score IS DISTINCT FROM EXCLUDED.semantic_score
                    OR circle_discussion_messages.embedding_score IS DISTINCT FROM EXCLUDED.embedding_score
                    OR circle_discussion_messages.quality_score IS DISTINCT FROM EXCLUDED.quality_score
                    OR circle_discussion_messages.spam_score IS DISTINCT FROM EXCLUDED.spam_score
                    OR circle_discussion_messages.decision_confidence IS DISTINCT FROM EXCLUDED.decision_confidence
                    OR circle_discussion_messages.relevance_method IS DISTINCT FROM EXCLUDED.relevance_method
                    OR circle_discussion_messages.actual_mode IS DISTINCT FROM EXCLUDED.actual_mode
                    OR circle_discussion_messages.analysis_version IS DISTINCT FROM EXCLUDED.analysis_version
                    OR circle_discussion_messages.topic_profile_version IS DISTINCT FROM EXCLUDED.topic_profile_version
                    OR circle_discussion_messages.semantic_facets IS DISTINCT FROM EXCLUDED.semantic_facets
                    OR circle_discussion_messages.focus_score IS DISTINCT FROM EXCLUDED.focus_score
                    OR circle_discussion_messages.focus_label IS DISTINCT FROM EXCLUDED.focus_label
                    OR circle_discussion_messages.is_featured IS DISTINCT FROM EXCLUDED.is_featured
                    OR circle_discussion_messages.feature_reason IS DISTINCT FROM EXCLUDED.feature_reason
                    OR circle_discussion_messages.featured_at IS DISTINCT FROM EXCLUDED.featured_at
                    OR circle_discussion_messages.analysis_completed_at IS DISTINCT FROM EXCLUDED.analysis_completed_at
                    OR circle_discussion_messages.analysis_error_code IS DISTINCT FROM EXCLUDED.analysis_error_code
                    OR circle_discussion_messages.analysis_error_message IS DISTINCT FROM EXCLUDED.analysis_error_message
                    OR circle_discussion_messages.author_annotations IS DISTINCT FROM EXCLUDED.author_annotations
                    THEN nextval('discussion_lamport_seq')
                ELSE circle_discussion_messages.lamport
            END,
            updated_at = ${persistedNow}
        RETURNING lamport AS "lamport", envelope_id AS "envelopeId"
    `;

    if (!rows[0]) {
        throw new Error('failed_to_upsert_peer_envelope');
    }
    return rows[0];
}

async function syncSinglePeer(prisma: PrismaClient, peerUrl: string): Promise<void> {
    const batchLimit = Math.max(1, Number(process.env.OFFCHAIN_DISCUSSION_PULL_LIMIT || '200'));
    const timeoutMs = Math.max(1_000, Number(process.env.OFFCHAIN_DISCUSSION_FETCH_TIMEOUT_MS || '15000'));
    const maxBatchesPerTick = Math.max(1, Number(process.env.OFFCHAIN_DISCUSSION_MAX_BATCHES_PER_TICK || '20'));

    const state = await readPeerState(prisma, peerUrl);
    let cursor = state?.lastRemoteLamport ?? 0n;

    for (let batchIndex = 0; batchIndex < maxBatchesPerTick; batchIndex += 1) {
        const batch = await fetchPeerBatch({
            peerUrl,
            afterLamport: cursor,
            limit: batchLimit,
            timeoutMs,
        });

        if (batch.messages.length === 0) {
            await upsertPeerState(prisma, {
                peerUrl,
                lastRemoteLamport: cursor,
                lastSuccessAt: new Date(),
                lastError: null,
            });
            return;
        }

        let maxRemoteLamport = cursor;
        let lastLocalLamport = 0n;
        let lastEnvelopeId: string | null = null;

        await prisma.$transaction(async (tx) => {
            for (const envelope of batch.messages) {
                if (!envelope?.envelopeId || !envelope?.roomKey || !envelope?.senderPubkey) {
                    continue;
                }

                const remoteLamport = BigInt(Math.max(0, Number(envelope.lamport || 0)));
                if (remoteLamport > maxRemoteLamport) {
                    maxRemoteLamport = remoteLamport;
                }

                const applied = await ingestPeerEnvelope(tx, envelope);
                if (applied.lamport > lastLocalLamport) {
                    lastLocalLamport = applied.lamport;
                    lastEnvelopeId = applied.envelopeId;
                }
            }

            if (lastLocalLamport > 0n) {
                await updateOffchainWatermark(tx, {
                    lamport: lastLocalLamport,
                    envelopeId: lastEnvelopeId,
                });
            }

            await upsertPeerState(tx, {
                peerUrl,
                lastRemoteLamport: maxRemoteLamport,
                lastSuccessAt: new Date(),
                lastError: null,
            });
        });

        if (maxRemoteLamport <= cursor) {
            // Peer returned data but cursor did not advance, stop to avoid infinite loop.
            return;
        }

        cursor = maxRemoteLamport;
        if (batch.messages.length < batchLimit) {
            return;
        }
    }
}

async function runSync(prisma: PrismaClient, peers: string[]): Promise<void> {
    for (const peerUrl of peers) {
        try {
            await syncSinglePeer(prisma, peerUrl);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`⚠️ Offchain peer sync failed for ${peerUrl}: ${message}`);
            await upsertPeerState(prisma, {
                peerUrl,
                lastRemoteLamport: (await readPeerState(prisma, peerUrl))?.lastRemoteLamport ?? 0n,
                lastSuccessAt: null,
                lastError: message.slice(0, 2000),
            });
        }
    }
}

export function startOffchainPeerSync(prisma: PrismaClient): void {
    const enabled = process.env.OFFCHAIN_DISCUSSION_PULL_ENABLED !== 'false';
    if (!enabled) {
        console.log('🔁 Offchain peer sync disabled (OFFCHAIN_DISCUSSION_PULL_ENABLED=false)');
        return;
    }

    const peers = parseOffchainPeerUrls();
    if (peers.length === 0) {
        console.log('🔁 Offchain peer sync skipped (OFFCHAIN_DISCUSSION_PEERS is empty)');
        return;
    }

    const intervalMs = Math.max(1_000, Number(process.env.OFFCHAIN_DISCUSSION_PULL_INTERVAL_MS || '5000'));
    console.log(`🔁 Offchain peer sync started (peers=${peers.length}, interval=${intervalMs}ms)`);

    const tick = async () => {
        if (running) return;
        running = true;
        try {
            await runSync(prisma, peers);
        } finally {
            running = false;
        }
    };

    void tick();
    intervalHandle = setInterval(() => {
        void tick();
    }, intervalMs);
}

export function stopOffchainPeerSync(): void {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
    }
    running = false;
    console.log('🔁 Offchain peer sync stopped');
}
