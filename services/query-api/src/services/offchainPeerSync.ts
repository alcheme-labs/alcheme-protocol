import { createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';

import {
    DISCUSSION_STREAM_KEY,
    updateOffchainWatermark,
    verifyEd25519SignatureBase64,
} from './offchainDiscussion';
import {
    parseTrustedOffchainPeers,
    verifySignedDiscussionStreamBatch,
    type SignedDiscussionStreamBatch,
    type TrustedOffchainPeer,
} from './offchainPeerTrust';
import {
    computeForwardBundleDigest,
    createForwardBundleRecord,
    type ForwardBundleItemInput,
} from './discussion/forwardingBundleStore';
import { runSingletonTask } from './runtime/queryRuntimeTaskState';
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
    forwardBundleCard?: RemoteForwardBundleCard | null;
    text: string;
    payloadHash: string;
    nonce: string;
    signature: string | null;
    signedMessage?: string | null;
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

interface RemoteForwardBundleCard {
    bundleId?: string | null;
    sourceCircleId?: number | null;
    sourceCircleName?: string | null;
    sourceLevel?: number | null;
    forwarderHandle?: string | null;
    forwardedAt?: string | null;
    itemCount?: number | null;
    sourceItems?: Array<{
        sourceEnvelopeId?: string | null;
        sourceAuthorPubkey?: string | null;
        sourceAuthorDisplayName?: string | null;
        sourceAuthorDisplaySource?: string | null;
        sourceAuthorDisplayCircleId?: number | null;
        sourceMessageCreatedAt?: string | null;
        snapshotText?: string | null;
        snapshotTruncated?: boolean | null;
        sourceDeleted?: boolean | null;
    }> | null;
}

interface RemoteDiscussionBatch {
    messages: RemoteDiscussionEnvelope[];
}

type OffchainPeerSyncTarget =
    | {
        mode: 'trusted';
        peerUrl: string;
        peerIdentity: string;
        peer: TrustedOffchainPeer;
    }
    | {
        mode: 'legacy';
        peerUrl: string;
        peerIdentity: string;
    };

interface PeerSyncStateRow {
    peerUrl: string;
    peerIdentity: string;
    lastRemoteLamport: bigint;
    lastSuccessAt: Date | null;
    lastError: string | null;
}

interface SingletonSchedulerOptions {
    ownerId?: string;
}

let intervalHandle: NodeJS.Timeout | null = null;
let running = false;

function safeIdentityPart(value: string): string {
    return value
        .trim()
        .replace(/[^a-zA-Z0-9_.:-]+/g, '_')
        .slice(0, 40) || 'unknown';
}

export function buildLegacyOffchainPeerSyncIdentity(peerUrl: string): string {
    const digest = createHash('sha256')
        .update(peerUrl)
        .digest('hex')
        .slice(0, 16);
    return `legacy:${digest}`;
}

export function buildTrustedOffchainPeerSyncIdentity(peer: TrustedOffchainPeer): string {
    const digest = createHash('sha256')
        .update(`${peer.peerId}\n${peer.deploymentId}\n${peer.baseUrl}\n${peer.publicKeyBase64}`)
        .digest('hex')
        .slice(0, 16);
    return [
        'trusted',
        safeIdentityPart(peer.peerId),
        safeIdentityPart(peer.deploymentId),
        digest,
    ].join(':');
}

export function buildOffchainPeerSyncTaskKey(
    peerUrl: string,
    peerIdentity = buildLegacyOffchainPeerSyncIdentity(peerUrl),
): string {
    const digest = createHash('sha256')
        .update(`${peerIdentity}\n${peerUrl}`)
        .digest('hex')
        .slice(0, 16);
    return `offchain_peer_sync:${digest}`;
}

export function buildPublicOffchainPeerRef(peerUrl: string, peerIdentity: string): string {
    const digest = createHash('sha256')
        .update(`${peerIdentity}\n${peerUrl}`)
        .digest('hex')
        .slice(0, 16);
    return `peer:${digest}`;
}

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

export function resolveOffchainPeerSyncTargets(input: {
    nodeEnv?: string;
    trustedPeersRaw?: string;
    legacyPeersRaw?: string;
} = {}): OffchainPeerSyncTarget[] {
    const nodeEnv = String(input.nodeEnv ?? process.env.NODE_ENV ?? '').trim().toLowerCase();
    const trustedPeers = parseTrustedOffchainPeers(input.trustedPeersRaw);
    if (trustedPeers.length > 0) {
        return trustedPeers.map((peer) => ({
            mode: 'trusted',
            peerUrl: peer.baseUrl,
            peerIdentity: buildTrustedOffchainPeerSyncIdentity(peer),
            peer,
        }));
    }
    if (nodeEnv === 'production') {
        return [];
    }
    return parseOffchainPeerUrls(input.legacyPeersRaw).map((peerUrl) => ({
        mode: 'legacy',
        peerUrl,
        peerIdentity: buildLegacyOffchainPeerSyncIdentity(peerUrl),
    }));
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

function buildTrustedPeerStreamExportUrl(peer: TrustedOffchainPeer, afterLamport: bigint, limit: number): string {
    const url = new URL('/api/v1/discussion/stream/export', peer.baseUrl);
    url.searchParams.set('streamKey', DISCUSSION_STREAM_KEY);
    url.searchParams.set('afterLamport', afterLamport.toString());
    url.searchParams.set('limit', String(limit));
    return url.toString();
}

async function fetchPeerBatch(input: {
    target: OffchainPeerSyncTarget;
    afterLamport: bigint;
    limit: number;
    timeoutMs: number;
}): Promise<RemoteDiscussionBatch> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    const url = input.target.mode === 'trusted'
        ? buildTrustedPeerStreamExportUrl(input.target.peer, input.afterLamport, input.limit)
        : buildPeerStreamUrl(input.target.peerUrl, input.afterLamport, input.limit);

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
        if (input.target.mode === 'trusted') {
            const batch = json as SignedDiscussionStreamBatch;
            if (!verifySignedDiscussionStreamBatch(input.target.peer, batch, {
                streamKey: DISCUSSION_STREAM_KEY,
                afterLamport: input.afterLamport.toString(),
            })) {
                throw new Error('trusted_peer_signature_invalid');
            }
            const messages = Array.isArray(batch.messages) ? batch.messages : [];
            return { messages: messages as RemoteDiscussionEnvelope[] };
        }
        const messages = Array.isArray(json?.messages) ? json.messages : [];
        return { messages };
    } finally {
        clearTimeout(timer);
    }
}

async function readPeerState(
    client: SqlClient,
    target: Pick<OffchainPeerSyncTarget, 'peerUrl' | 'peerIdentity'>,
): Promise<PeerSyncStateRow | null> {
    const rows = await client.$queryRaw<PeerSyncStateRow[]>`
        SELECT
            peer_url AS "peerUrl",
            peer_identity AS "peerIdentity",
            last_remote_lamport AS "lastRemoteLamport",
            last_success_at AS "lastSuccessAt",
            last_error AS "lastError"
        FROM offchain_peer_sync_state
        WHERE peer_url = ${target.peerUrl}
          AND peer_identity = ${target.peerIdentity}
        LIMIT 1
    `;
    if (rows[0]) return rows[0];
    const canInheritMigratedLegacyCursor = target.peerIdentity.startsWith('legacy:')
        || target.peerIdentity.startsWith('trusted:');
    if (!canInheritMigratedLegacyCursor) return null;

    const legacyRows = await client.$queryRaw<PeerSyncStateRow[]>`
        SELECT
            peer_url AS "peerUrl",
            peer_identity AS "peerIdentity",
            last_remote_lamport AS "lastRemoteLamport",
            last_success_at AS "lastSuccessAt",
            last_error AS "lastError"
        FROM offchain_peer_sync_state
        WHERE peer_url = ${target.peerUrl}
          AND peer_identity = 'legacy'
        LIMIT 1
    `;
    const migratedLegacyRow = legacyRows[0];
    if (!migratedLegacyRow) return null;

    const siblingRows = await client.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS "count"
        FROM offchain_peer_sync_state
        WHERE peer_url = ${target.peerUrl}
          AND peer_identity <> 'legacy'
    `;
    const siblingCount = Number(siblingRows[0]?.count ?? 0n);
    return siblingCount === 0 ? migratedLegacyRow : null;
}

async function upsertPeerState(
    client: SqlClient,
    params: {
        peerUrl: string;
        peerIdentity: string;
        lastRemoteLamport: bigint;
        lastSuccessAt?: Date | null;
        lastError?: string | null;
    },
): Promise<void> {
    await client.$executeRaw`
        INSERT INTO offchain_peer_sync_state (
            peer_url,
            peer_identity,
            last_remote_lamport,
            last_success_at,
            last_error,
            updated_at
        )
        VALUES (
            ${params.peerUrl},
            ${params.peerIdentity},
            ${params.lastRemoteLamport},
            ${params.lastSuccessAt ?? null},
            ${params.lastError ?? null},
            NOW()
        )
        ON CONFLICT (peer_url, peer_identity) DO UPDATE SET
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

function normalizeRemoteForwardBundleCard(
    envelope: RemoteDiscussionEnvelope,
    subjectId: string | null,
    metadata: Record<string, unknown> | null,
    createdAt: Date,
): {
    bundleId: string;
    sourceCircleId: number;
    targetCircleId: number;
    orderedSourceEnvelopeIdsDigest: string;
    messageEnvelopeId: string;
    forwarderPubkey: string;
    forwarderHandle: string | null;
    createdAt: Date;
    items: ForwardBundleItemInput[];
} | null {
    const card = envelope.forwardBundleCard;
    if (!card || !subjectId) return null;
    const sourceCircleId = Number(card.sourceCircleId ?? metadata?.sourceCircleId);
    if (!Number.isSafeInteger(sourceCircleId) || sourceCircleId <= 0) return null;
    const rawItems = Array.isArray(card.sourceItems) ? card.sourceItems : [];
    const items = rawItems
        .map((item, index) => {
            const sourceEnvelopeIdRaw = String(item?.sourceEnvelopeId || '').trim();
            const sourceAuthorPubkeyRaw = String(item?.sourceAuthorPubkey || '').trim();
            if (!sourceEnvelopeIdRaw || !sourceAuthorPubkeyRaw) return null;
            const sourceEnvelopeId = sourceEnvelopeIdRaw.slice(0, 96);
            const sourceAuthorPubkey = sourceAuthorPubkeyRaw.slice(0, 44);
            const displayName = String(item?.sourceAuthorDisplayName || '').trim()
                || sourceAuthorPubkeyRaw.slice(0, 12);
            const displaySource = String(item?.sourceAuthorDisplaySource || '').trim()
                || 'peer_forward_bundle';
            const displayCircleIdValue = item?.sourceAuthorDisplayCircleId;
            const displayCircleIdNumber = Number(displayCircleIdValue);
            return {
                position: index,
                sourceEnvelopeId,
                sourceCircleId,
                sourceAuthorPubkey,
                sourceAuthorDisplayName: displayName.slice(0, 96),
                sourceAuthorDisplaySource: displaySource.slice(0, 32),
                sourceAuthorDisplayCircleId: displayCircleIdValue !== null
                    && displayCircleIdValue !== undefined
                    && Number.isSafeInteger(displayCircleIdNumber)
                    && displayCircleIdNumber > 0
                    ? displayCircleIdNumber
                    : null,
                sourceMessageCreatedAt: parseOptionalRemoteDate(item?.sourceMessageCreatedAt || null) ?? createdAt,
                snapshotText: String(item?.snapshotText || '').trim().slice(0, 500),
                snapshotTruncated: Boolean(item?.snapshotTruncated),
                sourceDeletedAtForwardTime: Boolean(item?.sourceDeleted),
            };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (items.length === 0) return null;
    const metadataDigest = typeof metadata?.orderedSourceEnvelopeIdsDigest === 'string'
        && /^[a-f0-9]{64}$/i.test(metadata.orderedSourceEnvelopeIdsDigest)
        ? metadata.orderedSourceEnvelopeIdsDigest
        : null;
    return {
        bundleId: String(card.bundleId || subjectId).trim().slice(0, 96),
        sourceCircleId,
        targetCircleId: envelope.circleId,
        orderedSourceEnvelopeIdsDigest: metadataDigest
            ?? computeForwardBundleDigest(items.map((item) => item.sourceEnvelopeId)),
        messageEnvelopeId: envelope.envelopeId.slice(0, 96),
        forwarderPubkey: envelope.senderPubkey.slice(0, 44),
        forwarderHandle: envelope.senderHandle ? envelope.senderHandle.slice(0, 32) : null,
        createdAt,
        items,
    };
}

async function persistRemoteForwardBundleCard(
    client: SqlClient,
    bundle: NonNullable<ReturnType<typeof normalizeRemoteForwardBundleCard>>,
): Promise<void> {
    await createForwardBundleRecord(client as any, {
        bundleId: bundle.bundleId,
        sourceCircleId: bundle.sourceCircleId,
        targetCircleId: bundle.targetCircleId,
        orderedSourceEnvelopeIdsDigest: bundle.orderedSourceEnvelopeIdsDigest,
        messageEnvelopeId: bundle.messageEnvelopeId,
        forwarderPubkey: bundle.forwarderPubkey,
        forwarderHandle: bundle.forwarderHandle,
        items: bundle.items,
        now: bundle.createdAt,
    });
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
    const signedMessage = typeof envelope.signedMessage === 'string'
        ? envelope.signedMessage
        : '';
    const prevEnvelopeId = envelope.prevEnvelopeId || null;
    const tombstoneReason = null;
    const safeText = typeof envelope.text === 'string' ? envelope.text : '';
    const safeHash = typeof envelope.payloadHash === 'string' && envelope.payloadHash.length > 0
        ? envelope.payloadHash
        : '';
    const safeNonce = typeof envelope.nonce === 'string' && envelope.nonce.length > 0
        ? envelope.nonce
        : envelope.envelopeId.slice(0, 32);
    const isDeleted = false;
    const isEphemeral = Boolean(envelope.isEphemeral);
    const expiresAt = parseOptionalRemoteDate(envelope.expiresAt);
    const authModeRaw = typeof envelope.authMode === 'string' ? envelope.authMode.trim().toLowerCase() : '';
    const authMode = authModeRaw
        ? authModeRaw.slice(0, 32)
        : 'wallet_per_message';
    const signatureVerified = authMode === 'wallet_per_message'
        ? verifyEd25519SignatureBase64({
            senderPubkey: envelope.senderPubkey,
            message: signedMessage,
            signatureBase64: signature,
        })
        : false;
    const sessionId = null;
    const semanticScore = null;
    const qualityScore = null;
    const spamScore = null;
    const decisionConfidence = null;
    const relevanceScore = parseNormalizedScore(null, 1);
    const embeddingScore = null;
    const relevanceMethod = 'peer_import';
    const relevanceStatus = 'pending';
    const actualMode = null;
    const analysisVersion = null;
    const topicProfileVersion = null;
    const semanticFacetsJson = JSON.stringify([]);
    const focusScore = null;
    const focusLabel = null;
    const analysisCompletedAt = null;
    const analysisErrorCode = null;
    const analysisErrorMessage = null;
    const authorAnnotationsJson = JSON.stringify([]);
    const isFeatured = false;
    const featureReason = null;
    const featuredAt = null;
    const messageKindRaw = typeof envelope.messageKind === 'string'
        ? envelope.messageKind.trim().toLowerCase()
        : '';
    const messageKind = (
        messageKindRaw === 'forward'
        || messageKindRaw === 'forward_bundle'
    )
        ? messageKindRaw
        : 'plain';
    const subjectTypeRaw = typeof envelope.subjectType === 'string'
        ? envelope.subjectType.trim()
        : '';
    const subjectIdRaw = typeof envelope.subjectId === 'string'
        ? envelope.subjectId.trim()
        : '';
    const subjectType = (
        (
            subjectTypeRaw === 'knowledge'
            || subjectTypeRaw === 'discussion_message'
            || subjectTypeRaw === 'discussion_forward_bundle'
        )
        && subjectIdRaw
    )
        ? subjectTypeRaw
        : null;
    const subjectId = subjectType ? subjectIdRaw.slice(0, 128) : null;
    const metadataRecord = envelope.metadata
        && typeof envelope.metadata === 'object'
        && !Array.isArray(envelope.metadata)
        ? envelope.metadata as Record<string, unknown>
        : null;
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
            ${signedMessage},
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
        ON CONFLICT (envelope_id) DO NOTHING
        RETURNING lamport AS "lamport", envelope_id AS "envelopeId"
    `;

    if (!rows[0]) {
        return {
            lamport: 0n,
            envelopeId: envelope.envelopeId,
        };
    }
    const remoteForwardBundleCard = normalizeRemoteForwardBundleCard(
        envelope,
        subjectType === 'discussion_forward_bundle' ? subjectId : null,
        metadataRecord,
        createdAt,
    );
    if (messageKind === 'forward_bundle' && remoteForwardBundleCard) {
        await persistRemoteForwardBundleCard(client, remoteForwardBundleCard);
    }
    return rows[0];
}

export async function syncSinglePeer(prisma: PrismaClient, target: OffchainPeerSyncTarget): Promise<void> {
    const batchLimit = Math.max(1, Number(process.env.OFFCHAIN_DISCUSSION_PULL_LIMIT || '200'));
    const timeoutMs = Math.max(1_000, Number(process.env.OFFCHAIN_DISCUSSION_FETCH_TIMEOUT_MS || '15000'));
    const maxBatchesPerTick = Math.max(1, Number(process.env.OFFCHAIN_DISCUSSION_MAX_BATCHES_PER_TICK || '20'));

    const state = await readPeerState(prisma, target);
    let cursor = state?.lastRemoteLamport ?? 0n;

    for (let batchIndex = 0; batchIndex < maxBatchesPerTick; batchIndex += 1) {
        const batch = await fetchPeerBatch({
            target,
            afterLamport: cursor,
            limit: batchLimit,
            timeoutMs,
        });

        if (batch.messages.length === 0) {
            await upsertPeerState(prisma, {
                peerUrl: target.peerUrl,
                peerIdentity: target.peerIdentity,
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
                peerUrl: target.peerUrl,
                peerIdentity: target.peerIdentity,
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

async function runSync(prisma: PrismaClient, targets: OffchainPeerSyncTarget[]): Promise<void> {
    for (const target of targets) {
        try {
            await syncSinglePeer(prisma, target);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`⚠️ Offchain peer sync failed for ${target.peerUrl}: ${message}`);
            await upsertPeerState(prisma, {
                peerUrl: target.peerUrl,
                peerIdentity: target.peerIdentity,
                lastRemoteLamport: (await readPeerState(prisma, target))?.lastRemoteLamport ?? 0n,
                lastSuccessAt: null,
                lastError: message.slice(0, 2000),
            });
        }
    }
}

export function startOffchainPeerSync(
    prisma: PrismaClient,
    options: SingletonSchedulerOptions = {},
): void {
    if (intervalHandle) {
        console.log('🔁 Offchain peer sync already running');
        return;
    }

    const enabled = process.env.OFFCHAIN_DISCUSSION_PULL_ENABLED !== 'false';
    if (!enabled) {
        console.log('🔁 Offchain peer sync disabled (OFFCHAIN_DISCUSSION_PULL_ENABLED=false)');
        return;
    }

    const targets = resolveOffchainPeerSyncTargets();
    if (targets.length === 0) {
        console.log('🔁 Offchain peer sync skipped (no trusted peers configured)');
        return;
    }

    const intervalMs = Math.max(1_000, Number(process.env.OFFCHAIN_DISCUSSION_PULL_INTERVAL_MS || '5000'));
    console.log(`🔁 Offchain peer sync started (peers=${targets.length}, interval=${intervalMs}ms)`);
    const ownerId = options.ownerId || `query-api:${process.pid}`;

    const syncTarget = async (target: OffchainPeerSyncTarget) => {
        await runSingletonTask(prisma, {
            taskKey: buildOffchainPeerSyncTaskKey(target.peerUrl, target.peerIdentity),
            ownerId,
            leaseMs: Math.max(intervalMs * 4, 15_000),
            minIntervalMs: Math.max(1_000, Math.floor(intervalMs * 0.8)),
        }, () => runSync(prisma, [target]));
    };

    const tick = async () => {
        if (running) return;
        running = true;
        try {
            for (const target of targets) {
                try {
                    await syncTarget(target);
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    console.warn(`⚠️ Offchain peer sync scheduler failed for ${target.peerUrl}: ${message}`);
                }
            }
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
