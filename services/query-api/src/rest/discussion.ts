import { Router } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

import {
    DISCUSSION_STREAM_KEY,
    buildDiscussionRoomKey,
    buildDiscussionSigningMessage,
    buildDiscussionSigningPayload,
    buildDiscussionTombstoneMessage,
    buildDiscussionTombstonePayload,
    computeDiscussionEnvelopeId,
    normalizeDiscussionText,
    readOffchainWatermark,
    sha256Hex,
    updateOffchainWatermark,
    verifyEd25519SignatureBase64,
} from '../services/offchainDiscussion';
import { parseOffchainPeerUrls } from '../services/offchainPeerSync';
import {
    buildPendingDiscussionAnalysisInsertValues,
    enqueueDiscussionMessageAnalyzeJob,
} from '../services/discussion/analysis/enqueue';
import {
    DISCUSSION_SEMANTIC_FACETS,
    type DiscussionAnalysisStatus,
    type DiscussionFocusLabel,
    type SemanticFacet,
} from '../services/discussion/analysis/types';
import {
    invalidateDiscussionSummaryCache,
} from '../services/discussion/summaryCache';
import {
    loadDiscussionSummaryDiagnostics,
} from '../services/discussion/summaryDiagnostics';
import {
    createDiscussionIntelligence,
} from '../ai/discussion-intelligence';
import { loadGhostConfig } from '../ai/ghost/config';
import {
    loadCircleGhostSettingsPatch,
    resolveCircleGhostSettings,
} from '../ai/ghost/circle-settings';
import {
    DraftAnchorRepairError,
    getDraftAnchorById,
    getLatestDraftAnchorByPostId,
    repairDraftAnchorBatch,
    verifyDraftAnchor,
} from '../services/draftAnchor';
import {
    DraftContributorProofError,
    getDraftContributorProof,
} from '../services/contributorProof';
import {
    buildCanonicalProofPackageV2,
    PROOF_PACKAGE_BINDING_VERSION,
} from '../services/proofPackage';
import {
    issueProofPackageSignature,
    persistProofPackageIssuance,
} from '../services/proofPackageIssuer';
import {
    getCollabEditAnchorById,
    getCollabEditAnchorsByPostId,
    verifyCollabEditAnchor,
} from '../services/collabEditAnchor';
import {
    applyDraftDiscussionThread,
    appendDraftDiscussionMessage,
    createDraftDiscussionThread,
    DraftDiscussionLifecycleError,
    getDraftDiscussionThread,
    listDraftDiscussionThreads,
    proposeDraftDiscussionThread,
    resolveDraftDiscussionThread,
    withdrawDraftDiscussionThread,
} from '../services/draftDiscussionLifecycle';
import {
    authorizeDraftAction,
    hasActiveCircleMembership,
    parseAuthUserIdFromRequest,
    type DraftPermissionAction,
} from '../services/membership/checks';
import { sqlTimestampWithoutTimeZone } from '../utils/sqlTimestamp';
import {
    localizeDraftWorkflowPermissionDecision,
    resolveDraftWorkflowPermission,
} from '../services/policy/draftWorkflowPermissions';
import { localizeQueryApiCopy } from '../i18n/copy';
import { resolveExpressRequestLocale } from '../i18n/request';
import type { AppLocale } from '../i18n/locale';
import {
    finalizeDraftLifecycleCrystallization,
    resolveDraftLifecycleReadModel,
} from '../services/draftLifecycle/readModel';
import { DraftWorkflowStateError } from '../services/draftLifecycle/workflowState';
import { updateDraftContentAndHeat } from '../services/heat/postHeat';
import {
    acceptGhostDraftIntoWorkingCopy,
    GhostDraftAcceptanceError,
    normalizeGhostDraftAcceptanceMode,
} from '../services/ghostDraft/acceptance';
import {
    acceptDraftCandidateIntoDraft,
    createDraftFromManualDiscussionSelection,
    DraftCandidateAcceptanceError,
} from '../services/discussion/candidateAcceptance';
import { bumpKnowledgeHeat, KNOWLEDGE_HEAT_EVENTS } from '../services/heat/knowledgeHeat';
import {
    canForwardDiscussionMessage,
    type ForwardingCircleNode,
} from '../services/discussion/forwardingPolicy';
import { prepareStructuredDiscussionWriteMetadata } from '../services/discussion/systemNoticeSeam';
import { extractStructuredDiscussionMetadata } from '../services/discussion/structuredMessageMetadata';
import {
    buildDiscussionRealtimeChannel,
    parseDiscussionRealtimePayload,
    publishDiscussionRealtimeEvent,
    serializeDiscussionRealtimeHeartbeat,
    serializeDiscussionRealtimeSseEvent,
} from '../services/discussion/realtime';
import {
    bindKnowledgeToDraftSource,
    CrystallizationBindingError,
} from '../services/crystallizationBinding';
import { computePolicyProfileDigest } from '../services/policy/digest';
import {
    mapContributionSyncError,
    syncKnowledgeContributionsFromDraftProof,
} from '../services/knowledgeContributions';
import { enqueueCrystalAssetIssueJob } from '../services/crystalAssets/enqueue';
import { upsertCrystalEntitlementsForKnowledge } from '../services/crystalEntitlements/upsert';
import {
    markCrystallizationAttemptBindingSynced,
    markCrystallizationAttemptFinalizationFailed,
    markCrystallizationAttemptFinalized,
    markCrystallizationAttemptReferencesFailed,
    markCrystallizationAttemptReferencesSynced,
    upsertCrystallizationAttempt,
} from '../services/draftReferences/crystallizationAttempt';
import {
    DraftReferenceMaterializationError,
    materializeDraftCrystalReferencesOrThrow,
} from '../services/draftReferences/materialization';
import {
    createReferenceMaterializationClientFromEnv,
    type ReferenceMaterializationClient,
} from '../services/draftReferences/referenceMaterializationClient';
import {
    evaluateDraftStrictBindingViolation,
    resolveDraftStrictBindingMode,
} from '../services/crystallizationContract';
import {
    buildPublicPolicyDigestSnapshot,
    resolveCirclePolicyProfile,
} from '../services/policy/profile';
import { PublicKey } from '@solana/web3.js';

interface DiscussionRow {
    envelopeId: string;
    roomKey: string;
    circleId: number;
    senderPubkey: string;
    senderHandle: string | null;
    messageKind: string;
    subjectType: string | null;
    subjectId: string | null;
    metadata: Prisma.JsonValue | null;
    payloadText: string;
    payloadHash: string;
    nonce: string;
    signature: string | null;
    signatureVerified: boolean;
    authMode: string;
    sessionId: string | null;
    relevanceScore: Prisma.Decimal | number | string | null;
    semanticScore: Prisma.Decimal | number | string | null;
    qualityScore: Prisma.Decimal | number | string | null;
    spamScore: Prisma.Decimal | number | string | null;
    decisionConfidence: Prisma.Decimal | number | string | null;
    relevanceMethod: string | null;
    relevanceStatus: string | null;
    embeddingScore: Prisma.Decimal | number | string | null;
    actualMode: string | null;
    analysisVersion: string | null;
    topicProfileVersion: string | null;
    semanticFacets: Prisma.JsonValue | null;
    focusScore: Prisma.Decimal | number | string | null;
    focusLabel: string | null;
    analysisCompletedAt: Date | null;
    analysisErrorCode: string | null;
    analysisErrorMessage: string | null;
    authorAnnotations: Prisma.JsonValue | null;
    isFeatured: boolean;
    highlightCount: number;
    featureReason: string | null;
    featuredAt: Date | null;
    isEphemeral: boolean;
    expiresAt: Date | null;
    clientTimestamp: Date;
    lamport: bigint;
    prevEnvelopeId: string | null;
    deleted: boolean;
    tombstoneReason: string | null;
    tombstonedAt: Date | null;
    sourceMessageDeleted: boolean | null;
    createdAt: Date;
    updatedAt: Date;
}

const discussionHighlightCountJoin = Prisma.sql`
    LEFT JOIN (
        SELECT
            envelope_id,
            COUNT(*)::INT AS highlight_count
        FROM discussion_message_highlights
        GROUP BY envelope_id
    ) dh ON dh.envelope_id = m.envelope_id
`;

const discussionForwardSourceJoin = Prisma.sql`
    LEFT JOIN circle_discussion_messages source_message
      ON m.message_kind = 'forward'
     AND m.subject_type = 'discussion_message'
     AND m.subject_id = source_message.envelope_id
`;

const discussionSelectColumns = Prisma.sql`
    m.envelope_id AS "envelopeId",
    m.room_key AS "roomKey",
    m.circle_id AS "circleId",
    m.sender_pubkey AS "senderPubkey",
    m.sender_handle AS "senderHandle",
    m.message_kind AS "messageKind",
    m.subject_type AS "subjectType",
    m.subject_id AS "subjectId",
    m.metadata AS "metadata",
    m.payload_text AS "payloadText",
    m.payload_hash AS "payloadHash",
    m.nonce AS "nonce",
    m.signature AS "signature",
    m.signature_verified AS "signatureVerified",
    m.auth_mode AS "authMode",
    m.session_id AS "sessionId",
    m.relevance_score AS "relevanceScore",
    m.semantic_score AS "semanticScore",
    m.quality_score AS "qualityScore",
    m.spam_score AS "spamScore",
    m.decision_confidence AS "decisionConfidence",
    m.relevance_method AS "relevanceMethod",
    m.relevance_status AS "relevanceStatus",
    m.embedding_score AS "embeddingScore",
    m.actual_mode AS "actualMode",
    m.analysis_version AS "analysisVersion",
    m.topic_profile_version AS "topicProfileVersion",
    m.semantic_facets AS "semanticFacets",
    m.focus_score AS "focusScore",
    m.focus_label AS "focusLabel",
    m.analysis_completed_at AS "analysisCompletedAt",
    m.analysis_error_code AS "analysisErrorCode",
    m.analysis_error_message AS "analysisErrorMessage",
    m.author_annotations AS "authorAnnotations",
    m.is_featured AS "isFeatured",
    COALESCE(dh.highlight_count, 0) AS "highlightCount",
    m.feature_reason AS "featureReason",
    m.featured_at AS "featuredAt",
    m.is_ephemeral AS "isEphemeral",
    m.expires_at AS "expiresAt",
    m.client_timestamp AS "clientTimestamp",
    m.lamport AS "lamport",
    m.prev_envelope_id AS "prevEnvelopeId",
    m.deleted AS "deleted",
    m.tombstone_reason AS "tombstoneReason",
    m.tombstoned_at AS "tombstonedAt",
    source_message.deleted AS "sourceMessageDeleted",
    m.created_at AS "createdAt",
    m.updated_at AS "updatedAt"
`;

function normalizeRelevanceScore(value: Prisma.Decimal | number | string | null | undefined): number {
    if (value === null || value === undefined) return 1;
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, Math.min(1, value));
    }
    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed)) return Math.max(0, Math.min(1, parsed));
        return 1;
    }
    if (typeof value === 'object' && typeof (value as { toNumber?: () => number }).toNumber === 'function') {
        const parsed = (value as { toNumber: () => number }).toNumber();
        if (Number.isFinite(parsed)) return Math.max(0, Math.min(1, parsed));
    }
    return 1;
}

interface DiscussionSessionRow {
    sessionId: string;
    senderPubkey: string;
    senderHandle: string | null;
    scope: string;
    issuedAt: Date;
    expiresAt: Date;
    revoked: boolean;
    lastSeenAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

interface DiscussionSessionTokenPayload {
    typ: 'discussion_session';
    sessionId: string;
    senderPubkey: string;
    scope: string;
    iat?: number;
    exp?: number;
}

interface DiscussionSummaryRow {
    payloadText: string;
    senderPubkey: string;
    senderHandle: string | null;
    createdAt: Date;
    relevanceScore: Prisma.Decimal | number | string | null;
    semanticScore: Prisma.Decimal | number | string | null;
    focusScore: Prisma.Decimal | number | string | null;
    semanticFacets: Prisma.JsonValue | null;
}

interface CircleForwardingRow {
    id: number;
    name: string;
    level: number;
    parentCircleId: number | null;
}

interface DraftDiscussionResolutionRefRow {
    threadId: bigint;
    resolutionId: bigint;
    applicationId: bigint;
}

type DraftDiscussionMutationAction = 'create' | 'propose' | 'reply' | 'withdraw' | 'resolve' | 'apply';

function parsePositiveInt(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(value || '', 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(value || '', 10);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return parsed;
}

function parseOptionalLamport(value: string | undefined, mode: 'positive' | 'non_negative'): bigint | null | 'invalid' {
    if (value === undefined) return null;
    const parsed = mode === 'positive'
        ? parsePositiveInt(value, NaN)
        : parseNonNegativeInt(value, NaN);
    if (!Number.isFinite(parsed)) {
        return 'invalid';
    }
    return BigInt(parsed);
}

function parseEnvelopeIdsQuery(value: string | string[] | undefined): string[] {
    const raw = Array.isArray(value) ? value.join(',') : value || '';
    return raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined) return fallback;
    if (value === '1' || value === 'true') return true;
    if (value === '0' || value === 'false') return false;
    return fallback;
}

function parsePublicKey(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    if (!normalized) return null;
    try {
        return new PublicKey(normalized).toBase58();
    } catch {
        return null;
    }
}

function parseHex64(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalized)) return null;
    return normalized;
}

function parseHex128(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (!/^[a-f0-9]{128}$/.test(normalized)) return null;
    return normalized;
}

function parsePositiveU16(value: unknown): number | null {
    const parsed = typeof value === 'number'
        ? value
        : typeof value === 'string'
            ? Number(value)
            : NaN;
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return null;
    if (parsed <= 0 || parsed > 65535) return null;
    return parsed;
}

function parseIsoTimestamp(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    if (!normalized) return null;
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
}

function randomNonce(): string {
    return crypto.randomBytes(16).toString('hex');
}

function randomSessionId(): string {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID().replace(/-/g, '');
    }
    return crypto.randomBytes(16).toString('hex');
}

function parseBearerToken(headerValue: string | undefined): string | null {
    if (!headerValue || !headerValue.startsWith('Bearer ')) return null;
    const token = headerValue.slice(7).trim();
    return token.length > 0 ? token : null;
}

function normalizeDiscussionScope(raw: string | undefined): string {
    const scope = String(raw || 'circle:*').trim().toLowerCase();
    if (scope === 'circle:*') return scope;
    if (/^circle:\d+$/.test(scope)) return scope;
    throw new Error('invalid_discussion_scope');
}

function scopeAllowsCircle(scope: string, circleId: number): boolean {
    if (scope === 'circle:*') return true;
    const prefix = 'circle:';
    if (!scope.startsWith(prefix)) return false;
    const scopedCircleId = Number.parseInt(scope.slice(prefix.length), 10);
    return Number.isFinite(scopedCircleId) && scopedCircleId === circleId;
}

function buildSessionBootstrapPayload(input: {
    senderPubkey: string;
    scope: string;
    clientTimestamp: string;
    nonce: string;
}) {
    return {
        v: 1 as const,
        action: 'session_init' as const,
        senderPubkey: input.senderPubkey,
        scope: input.scope,
        clientTimestamp: input.clientTimestamp,
        nonce: input.nonce,
    };
}

function buildSessionBootstrapMessage(payload: ReturnType<typeof buildSessionBootstrapPayload>): string {
    return `alcheme-discussion-session:${JSON.stringify(payload)}`;
}

function parseSessionTokenPayload(
    token: string,
    jwtSecret: string,
): DiscussionSessionTokenPayload | null {
    try {
        const decoded = jwt.verify(token, jwtSecret) as DiscussionSessionTokenPayload;
        if (!decoded || decoded.typ !== 'discussion_session') return null;
        if (!decoded.sessionId || !decoded.senderPubkey || !decoded.scope) return null;
        return decoded;
    } catch {
        return null;
    }
}

async function loadValidSessionById(
    prisma: PrismaClient,
    sessionId: string,
): Promise<DiscussionSessionRow | null> {
    const rows = await prisma.$queryRaw<DiscussionSessionRow[]>`
        SELECT
            session_id AS "sessionId",
            sender_pubkey AS "senderPubkey",
            sender_handle AS "senderHandle",
            scope AS "scope",
            issued_at AS "issuedAt",
            expires_at AS "expiresAt",
            revoked AS "revoked",
            last_seen_at AS "lastSeenAt",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
        FROM discussion_sessions
        WHERE session_id = ${sessionId}
        LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    if (row.revoked) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null;
    return row;
}

function signDiscussionSessionToken(input: {
    sessionId: string;
    senderPubkey: string;
    scope: string;
    expiresAt: Date;
    jwtSecret: string;
}): string {
    const nowSec = Math.floor(Date.now() / 1000);
    const expSec = Math.max(nowSec + 1, Math.floor(input.expiresAt.getTime() / 1000));
    const payload: DiscussionSessionTokenPayload = {
        typ: 'discussion_session',
        sessionId: input.sessionId,
        senderPubkey: input.senderPubkey,
        scope: input.scope,
        iat: nowSec,
        exp: expSec,
    };
    return jwt.sign(payload, input.jwtSecret);
}

function formatSenderLabel(input: { handle?: string | null; pubkey?: string | null }, locale: AppLocale): string {
    if (input.handle && input.handle.trim()) return input.handle.trim();
    const pubkey = input.pubkey?.trim() || '';
    if (!pubkey) return localizeQueryApiCopy('discussion.member.unknown', locale);
    if (pubkey.length <= 8) return pubkey;
    return `${pubkey.slice(0, 4)}...${pubkey.slice(-4)}`;
}

function parseForwardCard(row: DiscussionRow) {
    if (row.messageKind !== 'forward') return null;
    const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? row.metadata as Record<string, unknown>
        : null;
    const snapshotText = typeof metadata?.snapshotText === 'string' && metadata.snapshotText.trim()
        ? metadata.snapshotText.trim()
        : row.payloadText;

    return {
        sourceEnvelopeId: typeof metadata?.sourceEnvelopeId === 'string' ? metadata.sourceEnvelopeId : row.subjectId,
        sourceCircleId: typeof metadata?.sourceCircleId === 'number' ? metadata.sourceCircleId : null,
        sourceCircleName: typeof metadata?.sourceCircleName === 'string' ? metadata.sourceCircleName : null,
        sourceLevel: typeof metadata?.sourceLevel === 'number' ? metadata.sourceLevel : null,
        sourceAuthorHandle: typeof metadata?.sourceAuthorHandle === 'string' ? metadata.sourceAuthorHandle : null,
        forwarderHandle: typeof metadata?.forwarderHandle === 'string'
            ? metadata.forwarderHandle
            : row.senderHandle,
        sourceMessageCreatedAt: typeof metadata?.sourceMessageCreatedAt === 'string'
            ? metadata.sourceMessageCreatedAt
            : null,
        forwardedAt: typeof metadata?.forwardedAt === 'string' ? metadata.forwardedAt : row.createdAt.toISOString(),
        sourceDeleted: row.sourceMessageDeleted ?? Boolean(metadata?.sourceDeleted),
        snapshotText,
    };
}

function mapRowToDto(row: DiscussionRow) {
    return {
        envelopeId: row.envelopeId,
        roomKey: row.roomKey,
        circleId: row.circleId,
        senderPubkey: row.senderPubkey,
        senderHandle: row.senderHandle,
        messageKind: row.messageKind,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        metadata: row.metadata,
        forwardCard: parseForwardCard(row),
        text: row.deleted ? '' : row.payloadText,
        payloadHash: row.payloadHash,
        nonce: row.nonce,
        signature: row.signature,
        signatureVerified: row.signatureVerified,
        authMode: row.authMode,
        // Session ids remain node-local runtime artifacts even when the message
        // itself is part of the portable off-chain protocol state.
        sessionId: null,
        relevanceScore: normalizeRelevanceScore(row.semanticScore ?? row.relevanceScore),
        semanticScore: normalizeRelevanceScore(row.semanticScore ?? row.relevanceScore),
        relevanceStatus: normalizeDiscussionAnalysisStatus(row.relevanceStatus),
        embeddingScore: normalizeRelevanceScore(row.embeddingScore ?? 0),
        qualityScore: normalizeRelevanceScore(row.qualityScore ?? 0.5),
        spamScore: normalizeRelevanceScore(row.spamScore ?? 0),
        decisionConfidence: normalizeRelevanceScore(row.decisionConfidence ?? 0.5),
        relevanceMethod: row.relevanceMethod || 'rule',
        actualMode: row.actualMode,
        analysisVersion: row.analysisVersion,
        topicProfileVersion: row.topicProfileVersion,
        semanticFacets: normalizeDiscussionSemanticFacets(row.semanticFacets),
        focusScore: normalizeRelevanceScore(row.focusScore ?? 0),
        focusLabel: normalizeDiscussionFocusLabel(row.focusLabel),
        analysisCompletedAt: row.analysisCompletedAt?.toISOString() || null,
        analysisErrorCode: row.analysisErrorCode,
        analysisErrorMessage: row.analysisErrorMessage,
        authorAnnotations: normalizeAuthorAnnotations(row.authorAnnotations),
        isFeatured: row.isFeatured,
        highlightCount: row.highlightCount,
        featureReason: row.featureReason,
        featuredAt: row.featuredAt?.toISOString() || null,
        isEphemeral: row.isEphemeral,
        expiresAt: row.expiresAt?.toISOString() || null,
        clientTimestamp: row.clientTimestamp.toISOString(),
        lamport: Number(row.lamport),
        prevEnvelopeId: row.prevEnvelopeId,
        deleted: row.deleted,
        tombstoneReason: row.tombstoneReason,
        tombstonedAt: row.tombstonedAt?.toISOString() || null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

function normalizeDiscussionAnalysisStatus(value: string | null | undefined): DiscussionAnalysisStatus {
    if (value === 'pending' || value === 'ready' || value === 'stale' || value === 'failed') {
        return value;
    }
    return 'ready';
}

function normalizeDiscussionFocusLabel(value: string | null | undefined): DiscussionFocusLabel | null {
    if (value === 'focused' || value === 'contextual' || value === 'off_topic') {
        return value;
    }
    return null;
}

export function normalizeDiscussionSemanticFacets(value: Prisma.JsonValue | null | undefined): SemanticFacet[] {
    if (!Array.isArray(value)) return [];
    const allowed = new Set<SemanticFacet>(DISCUSSION_SEMANTIC_FACETS);
    return value.filter((item): item is SemanticFacet => typeof item === 'string' && allowed.has(item as SemanticFacet));
}

function normalizeAuthorAnnotations(value: Prisma.JsonValue | null | undefined): Array<{ kind: string; source: string }> {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is { kind: string; source: string } =>
        Boolean(item)
        && typeof item === 'object'
        && !Array.isArray(item)
        && typeof (item as { kind?: unknown }).kind === 'string'
        && typeof (item as { source?: unknown }).source === 'string');
}

function readInternalSummaryToken(headers: Record<string, string | string[] | undefined>): string | null {
    const ghostHeader = headers['x-ghost-admin-token'];
    const legacyHeader = headers['x-internal-api-token'];
    const candidate = Array.isArray(ghostHeader)
        ? ghostHeader[0]
        : Array.isArray(legacyHeader)
            ? legacyHeader[0]
            : ghostHeader || legacyHeader;
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim();
    }

    const authorization = Array.isArray(headers.authorization)
        ? headers.authorization[0]
        : headers.authorization;
    return parseBearerToken(typeof authorization === 'string' ? authorization : undefined);
}

export function discussionRouter(prisma: PrismaClient, redis: Redis): Router {
    const router = Router();
    const FORWARD_SNAPSHOT_MAX_LENGTH = 220;

    async function loadKnowledgeDiscussionContext(knowledgeId: string) {
        const normalizedKnowledgeId = String(knowledgeId || '').trim();
        if (!normalizedKnowledgeId) {
            return null;
        }

        return prisma.knowledge.findUnique({
            where: { knowledgeId: normalizedKnowledgeId },
            select: {
                id: true,
                knowledgeId: true,
                circleId: true,
                title: true,
            },
        });
    }

    async function loadCircleForwardingNode(circleId: number): Promise<(ForwardingCircleNode & { name: string }) | null> {
        const visited = new Set<number>();
        let currentCircleId: number | null = circleId;
        let rootCircleId: number | null = null;
        let targetCircle: CircleForwardingRow | null = null;

        while (currentCircleId) {
            if (visited.has(currentCircleId)) {
                throw new Error(`circle_hierarchy_cycle_detected:${circleId}`);
            }
            visited.add(currentCircleId);

            const circle: CircleForwardingRow | null = await prisma.circle.findUnique({
                where: { id: currentCircleId },
                select: {
                    id: true,
                    name: true,
                    level: true,
                    parentCircleId: true,
                },
            });
            if (!circle) return null;
            if (!targetCircle) {
                targetCircle = circle;
            }
            if (!circle.parentCircleId) {
                rootCircleId = circle.id;
                break;
            }
            currentCircleId = circle.parentCircleId;
        }

        if (!targetCircle || !rootCircleId) return null;
        return {
            id: targetCircle.id,
            name: targetCircle.name,
            level: targetCircle.level,
            parentCircleId: targetCircle.parentCircleId,
            rootCircleId,
        };
    }

    function buildForwardSnapshotText(text: string, locale: AppLocale): string {
        const normalized = normalizeDiscussionText(text).replace(/\s+/g, ' ').trim();
        if (!normalized) return localizeQueryApiCopy('discussion.forward.emptySourceMessage', locale);
        if (normalized.length <= FORWARD_SNAPSHOT_MAX_LENGTH) {
            return normalized;
        }
        return `${normalized.slice(0, FORWARD_SNAPSHOT_MAX_LENGTH - 1)}…`;
    }
    const ghostConfig = loadGhostConfig();
    const jwtSecret = process.env.JWT_SECRET || 'change-me-in-production';
    const discussionAuthMode = process.env.DISCUSSION_AUTH_MODE || 'session_token';
    const requireSessionToken = process.env.DISCUSSION_REQUIRE_SESSION_TOKEN === 'true';
    const requireSessionBootstrapSignature = process.env.DISCUSSION_REQUIRE_SESSION_BOOTSTRAP_SIGNATURE !== 'false';
    const sessionTtlSec = parsePositiveInt(process.env.DISCUSSION_SESSION_TTL_SEC, 1800);
    const sessionRefreshWindowSec = parsePositiveInt(process.env.DISCUSSION_SESSION_REFRESH_WINDOW_SEC, 300);
    const requireSignatures = process.env.REQUIRE_DISCUSSION_SIGNATURES === 'true';
    const maxTextLength = parsePositiveInt(process.env.DISCUSSION_MESSAGE_MAX_LENGTH, 2000);
    const visitorDustTtlSec = parsePositiveInt(process.env.DISCUSSION_VISITOR_DUST_TTL_SEC, 24 * 60 * 60);
    const discussionSummaryWindow = ghostConfig.summary.windowSize;
    const discussionSummaryCacheTtlSec = ghostConfig.summary.cacheTtlSec;
    const discussionSummaryInternalEndpointEnabled = ghostConfig.summary.internalEndpointEnabled;
    const ghostAdminToken = ghostConfig.admin.token;
    const draftStrictBindingMode = resolveDraftStrictBindingMode();
    const proofPackageGeneratedBy = process.env.PROOF_PACKAGE_GENERATED_BY || 'query-api';
    const discussionIntelligence = createDiscussionIntelligence({
        prisma,
        redis,
    });

    async function emitDiscussionRealtimeEvent(input: {
        circleId: number;
        latestLamport?: number | null;
        envelopeId?: string | null;
        reason: Parameters<typeof publishDiscussionRealtimeEvent>[1]['reason'];
    }) {
        try {
            await publishDiscussionRealtimeEvent(redis, input);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`discussion realtime publish failed for circle ${input.circleId}: ${message}`);
        }
    }

    function emitDraftStrictWarning(input: {
        endpoint: string;
        draftPostId: number;
        code: string;
        message: string;
        details?: Record<string, unknown>;
    }) {
        const payload = {
            endpoint: input.endpoint,
            draftPostId: input.draftPostId,
            code: input.code,
            message: input.message,
            mode: draftStrictBindingMode,
            ...(input.details ? { details: input.details } : {}),
        };
        console.warn('[discussion][draft_strict_binding_warning]', payload);
        return payload;
    }

    async function loadDraftDiscussionResolutionRefs(
        draftPostId: number,
        db: PrismaClient | Prisma.TransactionClient = prisma,
    ): Promise<string[]> {
        const rows = await db.$queryRaw<DraftDiscussionResolutionRefRow[]>(Prisma.sql`
            SELECT
                t.id AS "threadId",
                accepted.id AS "resolutionId",
                applied.id AS "applicationId"
            FROM draft_discussion_threads t
            JOIN LATERAL (
                SELECT id
                FROM draft_discussion_resolutions
                WHERE thread_id = t.id
                  AND to_state = 'accepted'
                ORDER BY resolved_at DESC, id DESC
                LIMIT 1
            ) accepted ON TRUE
            JOIN LATERAL (
                SELECT id
                FROM draft_discussion_applications
                WHERE thread_id = t.id
                ORDER BY applied_at DESC, id DESC
                LIMIT 1
            ) applied ON TRUE
            WHERE t.draft_post_id = ${draftPostId}
              AND t.state = 'applied'
            ORDER BY t.id ASC
        `);

        return rows.map((row) =>
            `thread:${String(row.threadId)}:resolution:${String(row.resolutionId)}:application:${String(row.applicationId)}`);
    }

    function resolveProofPackageGeneratedAt(input: {
        anchoredAt?: string | Date | null;
        createdAt?: string | Date | null;
        updatedAt?: string | Date | null;
    }): string {
        const candidate = input.anchoredAt ?? input.createdAt ?? input.updatedAt ?? null;
        if (!candidate) {
            return new Date().toISOString();
        }
        const date = candidate instanceof Date ? candidate : new Date(candidate);
        if (Number.isNaN(date.getTime())) {
            throw new Error('draft_anchor_generated_at_invalid');
        }
        return date.toISOString();
    }

    function mapProofPackageIssuanceError(error: unknown): {
        code: string;
        statusCode: number;
        message: string;
    } {
        const issuerConfigErrorCodes = new Set([
            'missing_issuer_key_id',
            'invalid_issuer_key_id',
            'missing_issuer_secret',
            'invalid_issuer_secret',
            'issuer_key_id_secret_mismatch',
        ]);
        const snapshotPayloadErrorCodes = new Set([
            'invalid_proof_snapshot',
            'invalid_proof_snapshot_signature',
            'invalid_proof_snapshot_binding_version',
            'invalid_hex_64',
            'invalid_contributors_count',
            'invalid_binding_version',
            'invalid_timestamp',
        ]);
        if (error instanceof DraftContributorProofError) {
            const statusCode = error.code === 'draft_anchor_unverifiable'
                ? 422
                : error.code === 'draft_anchor_not_found'
                    ? 409
                    : error.statusCode;
            return {
                code: error.code,
                statusCode,
                message: error.message,
            };
        }
        if (error instanceof Error) {
            if (issuerConfigErrorCodes.has(error.message)) {
                return {
                    code: 'proof_package_issuer_misconfigured',
                    statusCode: 500,
                    message: 'proof package issuer configuration is invalid',
                };
            }
            if (snapshotPayloadErrorCodes.has(error.message)) {
                return {
                    code: 'invalid_proof_snapshot',
                    statusCode: 400,
                    message: 'proof snapshot payload is invalid or inconsistent',
                };
            }
            if (error.message === 'draft_anchor_not_found') {
                return {
                    code: 'draft_anchor_not_found',
                    statusCode: 409,
                    message: 'draft has no collab edit anchor yet',
                };
            }
            if (error.message === 'draft_anchor_not_final') {
                return {
                    code: 'draft_anchor_not_final',
                    statusCode: 409,
                    message: 'latest collab edit anchor is not anchored on-chain yet',
                };
            }
            if (error.message === 'draft_anchor_unverifiable') {
                return {
                    code: 'draft_anchor_unverifiable',
                    statusCode: 422,
                    message: 'latest collab edit anchor proof check failed',
                };
            }
            return {
                code: 'proof_package_issuance_failed',
                statusCode: 500,
                message: error.message,
            };
        }
        return {
            code: 'proof_package_issuance_failed',
            statusCode: 500,
            message: 'failed to persist proof package issuance',
        };
    }

    function resolveContributionSyncViolation(mapped: {
        code: string;
        statusCode: number;
        message: string;
    }): {
        code: string;
        statusCode: number;
        message: string;
        details?: Record<string, unknown>;
    } {
        if (mapped.code === 'draft_anchor_unverifiable') {
            return {
                code: mapped.code,
                statusCode: 422,
            message: mapped.message || 'latest collab edit anchor proof check failed',
            };
        }
        if (mapped.code === 'knowledge_circle_mismatch' || mapped.code === 'draft_knowledge_circle_mismatch') {
            return {
                code: 'knowledge_circle_mismatch',
                statusCode: 409,
                message: mapped.message || 'draft and knowledge circle mismatch',
            };
        }
        if (
            mapped.code === 'proof_binding_required'
            || mapped.code === 'contributors_root_mismatch'
            || mapped.code === 'contributors_count_mismatch'
            || mapped.code === 'draft_anchor_not_found'
        ) {
            return {
                code: 'proof_binding_required',
                statusCode: 409,
                message: mapped.message || 'indexed proof binding is required before contribution sync',
            };
        }
        return {
            code: 'contribution_sync_required',
            statusCode: mapped.statusCode,
            message: mapped.message || 'knowledge contribution snapshot sync failed',
            details: {
                sourceCode: mapped.code,
                sourceStatusCode: mapped.statusCode,
            },
        };
    }

    function isBusinessStatusCode(statusCode: number): boolean {
        return Number.isFinite(statusCode) && statusCode >= 400 && statusCode < 500;
    }

    class ProofPackageIssuanceTxError extends Error {
        constructor(public readonly causeError: unknown) {
            super('proof_package_issuance_tx_error');
            this.name = 'ProofPackageIssuanceTxError';
        }
    }

    async function finalizeCrystallizationLifecycleOrThrow(input: {
        draftPostId: number;
        actorUserId: number | null;
        locale: AppLocale;
    }): Promise<void> {
        try {
            await finalizeDraftLifecycleCrystallization(prisma, input);
        } catch (error) {
            if (
                error instanceof DraftWorkflowStateError
                && error.code === 'draft_not_in_crystallization'
            ) {
                try {
                    const lifecycle = await resolveDraftLifecycleReadModel(prisma, {
                        draftPostId: input.draftPostId,
                    });
                    if (lifecycle.documentStatus === 'crystallized') {
                        return;
                    }
                } catch (reloadError) {
                    console.warn('[discussion][crystallization_lifecycle_finalize_reload_failed]', {
                        draftPostId: input.draftPostId,
                        message: reloadError instanceof Error ? reloadError.message : String(reloadError),
                    });
                }
            }
            console.warn('[discussion][crystallization_lifecycle_finalize_failed]', {
                draftPostId: input.draftPostId,
                message: error instanceof Error ? error.message : String(error),
            });
            throw new CrystallizationBindingError(
                'draft_lifecycle_finalize_failed',
                500,
                localizeQueryApiCopy('draft.crystallization.lifecycleFinalizeFailed', input.locale),
            );
        }
    }

    function createLazyReferenceMaterializationClient(): ReferenceMaterializationClient {
        return {
            async addReferences(references) {
                if (references.length === 0) return [];
                return createReferenceMaterializationClientFromEnv().addReferences(references);
            },
        };
    }

    interface DraftProofSnapshotInput {
        proofPackageHash: string;
        sourceAnchorId: string;
        contributorsRoot: string;
        contributorsCount: number;
        bindingVersion: number;
        generatedAt: string;
        issuerKeyId: string;
        issuedSignature: string;
        proofPackage: Prisma.JsonValue;
    }

    function validateProofSnapshot(input: DraftProofSnapshotInput): DraftProofSnapshotInput {
        if (input.bindingVersion !== PROOF_PACKAGE_BINDING_VERSION) {
            throw new Error('invalid_proof_snapshot_binding_version');
        }

        if (!input.proofPackage || typeof input.proofPackage !== 'object' || Array.isArray(input.proofPackage)) {
            throw new Error('invalid_proof_snapshot');
        }

        const proofPackage = input.proofPackage as Record<string, unknown>;
        const packageDraftAnchor = parseHex64(proofPackage.draft_anchor);
        const packageRoot = parseHex64(proofPackage.root);
        const packageCount = parsePositiveU16(proofPackage.count);
        const packageGeneratedAt = parseIsoTimestamp(proofPackage.generated_at);
        if (!packageDraftAnchor || !packageRoot || !packageCount || !packageGeneratedAt) {
            throw new Error('invalid_proof_snapshot');
        }
        if (
            packageDraftAnchor !== input.sourceAnchorId
            || packageRoot !== input.contributorsRoot
            || packageCount !== input.contributorsCount
            || packageGeneratedAt !== input.generatedAt
        ) {
            throw new Error('invalid_proof_snapshot');
        }

        const issuance = issueProofPackageSignature({
            proof_package_hash: input.proofPackageHash,
            contributors_root: input.contributorsRoot,
            contributors_count: input.contributorsCount,
            source_anchor_id: input.sourceAnchorId,
            binding_version: input.bindingVersion,
            generated_at: input.generatedAt,
            issuerKeyId: input.issuerKeyId,
        });
        if (issuance.issued_signature !== input.issuedSignature) {
            throw new Error('invalid_proof_snapshot_signature');
        }

        return {
            ...input,
            issuerKeyId: issuance.issuer_key_id,
            proofPackage: input.proofPackage as Prisma.JsonValue,
        };
    }

    function isIssuerConfigurationError(error: unknown): boolean {
        if (!(error instanceof Error)) return false;
        return (
            error.message === 'missing_issuer_key_id'
            || error.message === 'invalid_issuer_key_id'
            || error.message === 'missing_issuer_secret'
            || error.message === 'invalid_issuer_secret'
        );
    }

    async function resolveStableSnapshotCollabEvidence(
        draftPostId: number,
        db: PrismaClient | Prisma.TransactionClient = prisma,
    ) {
        const lifecycle = await resolveDraftLifecycleReadModel(db as PrismaClient, { draftPostId });
        const stableSnapshot = lifecycle.stableSnapshot;
        const sourceEditAnchorId = String(stableSnapshot?.sourceEditAnchorId || '').trim().toLowerCase();
        if (!sourceEditAnchorId) {
            throw new DraftWorkflowStateError(
                'draft_anchor_not_found',
                409,
                'draft stable snapshot has no collab edit anchor yet',
            );
        }

        const anchor = await getCollabEditAnchorById(db as PrismaClient, sourceEditAnchorId);
        if (!anchor) {
            throw new DraftWorkflowStateError(
                'draft_anchor_not_found',
                409,
                'draft stable snapshot collab edit anchor could not be found',
            );
        }
        if (anchor.status !== 'anchored') {
            throw new DraftWorkflowStateError(
                'draft_anchor_not_final',
                409,
                'stable snapshot collab edit anchor is not anchored on-chain yet',
            );
        }
        if (
            stableSnapshot?.contentHash
            && String(anchor.snapshotHash || '').toLowerCase() !== String(stableSnapshot.contentHash || '').toLowerCase()
        ) {
            throw new DraftWorkflowStateError(
                'draft_anchor_snapshot_mismatch',
                409,
                'stable snapshot collab edit anchor does not match the locked draft snapshot',
            );
        }

        const proof = verifyCollabEditAnchor(anchor);
        if (!proof.verifiable) {
            throw new DraftWorkflowStateError(
                'draft_anchor_unverifiable',
                422,
                'stable snapshot collab edit anchor proof check failed',
            );
        }

        return {
            lifecycle,
            stableSnapshot,
            anchor,
            proof,
        };
    }

    async function persistCurrentDraftProofPackageIssuance(
        draftPostId: number,
        db: PrismaClient | Prisma.TransactionClient = prisma,
        snapshot?: DraftProofSnapshotInput,
    ) {
        if (snapshot) {
            const validatedSnapshot = validateProofSnapshot(snapshot);
            return persistProofPackageIssuance(db as PrismaClient, {
                draftPostId,
                proofPackageHash: validatedSnapshot.proofPackageHash,
                sourceAnchorId: validatedSnapshot.sourceAnchorId,
                contributorsRoot: validatedSnapshot.contributorsRoot,
                contributorsCount: validatedSnapshot.contributorsCount,
                bindingVersion: validatedSnapshot.bindingVersion,
                canonicalProofPackage: validatedSnapshot.proofPackage,
                generatedAt: validatedSnapshot.generatedAt,
                generatedBy: proofPackageGeneratedBy,
                issuerKeyId: validatedSnapshot.issuerKeyId,
                issuedSignature: validatedSnapshot.issuedSignature,
                issuedAt: new Date().toISOString(),
            });
        }

        const contributorProof = await getDraftContributorProof(db as PrismaClient, draftPostId);
        const stableEvidence = await resolveStableSnapshotCollabEvidence(draftPostId, db);

        const discussionResolutionRefs = await loadDraftDiscussionResolutionRefs(draftPostId, db);
        const generatedAt = resolveProofPackageGeneratedAt({
            anchoredAt: (stableEvidence.anchor as any).anchoredAt ?? null,
            createdAt: (stableEvidence.anchor as any).createdAt ?? null,
            updatedAt: (stableEvidence.anchor as any).updatedAt ?? null,
        });
        const proofPackage = buildCanonicalProofPackageV2({
            contributorProof,
            collabEditAnchorId: stableEvidence.anchor.anchorId,
            discussionResolutionRefs,
            generatedAt,
        });
        const issuance = issueProofPackageSignature({
            proof_package_hash: proofPackage.proof_package_hash,
            contributors_root: proofPackage.canonical_proof_package.root,
            contributors_count: proofPackage.canonical_proof_package.count,
            source_anchor_id: proofPackage.canonical_proof_package.draft_anchor,
            binding_version: PROOF_PACKAGE_BINDING_VERSION,
            generated_at: proofPackage.canonical_proof_package.generated_at,
        });

        return persistProofPackageIssuance(db as PrismaClient, {
            draftPostId,
            proofPackageHash: proofPackage.proof_package_hash,
            sourceAnchorId: proofPackage.canonical_proof_package.draft_anchor,
            contributorsRoot: proofPackage.canonical_proof_package.root,
            contributorsCount: proofPackage.canonical_proof_package.count,
            bindingVersion: PROOF_PACKAGE_BINDING_VERSION,
            canonicalProofPackage: proofPackage.canonical_proof_package as unknown as Prisma.JsonValue,
            generatedAt: proofPackage.canonical_proof_package.generated_at,
            generatedBy: proofPackageGeneratedBy,
            issuerKeyId: issuance.issuer_key_id,
            issuedSignature: issuance.issued_signature,
            issuedAt: issuance.issued_at,
        });
    }

    async function ensureDraftAccessFromRequest(
        req: any,
        res: any,
        postId: number,
        action: DraftPermissionAction,
    ) {
        const authUserId = parseAuthUserIdFromRequest(req);
        const access = await authorizeDraftAction(prisma, {
            postId,
            userId: authUserId,
            action,
        });
        if (!access.allowed) {
            res.status(access.statusCode).json({
                error: access.error,
                message: access.message,
            });
            return null;
        }
        return access;
    }

    async function ensureDraftDiscussionMutationAccess(
        req: any,
        res: any,
        postId: number,
        action: DraftDiscussionMutationAction,
    ) {
        const authUserId = parseAuthUserIdFromRequest(req);
        const access = await authorizeDraftAction(prisma, {
            postId,
            userId: authUserId,
            action: 'read',
        });
        if (!access.allowed) {
            res.status(access.statusCode).json({
                error: access.error,
                message: access.message,
            });
            return null;
        }

        const circleId = access.post?.circleId;
        if (!authUserId || !circleId || circleId <= 0) {
            res.status(409).json({
                error: 'draft_circle_required',
                message: 'draft discussion mutation requires a circle-bound draft',
            });
            return null;
        }

        if (action === 'propose' || action === 'resolve' || action === 'apply') {
            const permission = await resolveDraftWorkflowPermission(prisma, {
                circleId,
                userId: authUserId,
                action: action === 'apply'
                    ? 'apply_accepted_issue'
                    : 'accept_reject_issue',
            });
            if (!permission.allowed) {
                res.status(403).json({
                    error: action === 'apply'
                        ? 'draft_discussion_apply_permission_denied'
                        : 'draft_discussion_resolve_permission_denied',
                    message: localizeDraftWorkflowPermissionDecision(permission, resolveExpressRequestLocale(req)),
                });
                return null;
            }
        }

        if (action === 'create' || action === 'reply') {
            const permission = await resolveDraftWorkflowPermission(prisma, {
                circleId,
                userId: authUserId,
                action: action === 'create' ? 'create_issue' : 'followup_issue',
            });
            if (!permission.allowed) {
                res.status(403).json({
                    error: action === 'create'
                        ? 'draft_discussion_create_permission_denied'
                        : 'draft_discussion_followup_permission_denied',
                    message: localizeDraftWorkflowPermissionDecision(permission, resolveExpressRequestLocale(req)),
                });
                return null;
            }
        }

        return {
            access,
            authUserId,
            circleId,
        };
    }

    async function resolveDraftDiscussionApplyEvidence(input: {
        draftPostId: number;
        body: any;
    }): Promise<{
        appliedEditAnchorId: string;
        appliedSnapshotHash: string;
        appliedDraftVersion: number;
    }> {
        const appliedEditAnchorId = String(input.body?.appliedEditAnchorId || '').trim();
        const appliedSnapshotHash = String(input.body?.appliedSnapshotHash || '').trim().toLowerCase();
        const appliedDraftVersionRaw = input.body?.appliedDraftVersion;
        const appliedDraftVersion = parsePositiveInt(
            appliedDraftVersionRaw === undefined || appliedDraftVersionRaw === null
                ? undefined
                : String(appliedDraftVersionRaw),
            NaN,
        );
        const hasAnyProvidedEvidence =
            Boolean(appliedEditAnchorId)
            || Boolean(appliedSnapshotHash)
            || Number.isFinite(appliedDraftVersion);

        if (
            appliedEditAnchorId
            && /^[a-f0-9]{64}$/i.test(appliedSnapshotHash)
            && Number.isFinite(appliedDraftVersion)
        ) {
            return {
                appliedEditAnchorId,
                appliedSnapshotHash,
                appliedDraftVersion,
            };
        }

        if (hasAnyProvidedEvidence) {
            throw new DraftDiscussionLifecycleError(
                'draft_discussion_apply_evidence_required',
                422,
                'apply evidence must include edit_anchor_id, 64-char snapshot_hash, and positive draft_version',
            );
        }

        const latestAnchors = await getCollabEditAnchorsByPostId(prisma, input.draftPostId, 1);
        const latestAnchor = latestAnchors[0] || null;
        if (!latestAnchor) {
            throw new DraftDiscussionLifecycleError(
                'draft_discussion_apply_evidence_unavailable',
                422,
                'no collaboration anchor available; save draft changes before applying',
            );
        }
        const proof = verifyCollabEditAnchor(latestAnchor);
        if (!proof.verifiable) {
            throw new DraftDiscussionLifecycleError(
                'draft_discussion_apply_evidence_unavailable',
                422,
                'latest collaboration anchor is not verifiable',
            );
        }

        return {
            appliedEditAnchorId: latestAnchor.anchorId,
            appliedSnapshotHash: latestAnchor.snapshotHash,
            appliedDraftVersion: parsePositiveInt(latestAnchor.toSeq, 1),
        };
    }

    async function authenticateSessionFromRequest(input: {
        authorizationHeader: string | undefined;
        circleId: number;
        expectedSenderPubkey?: string;
    }): Promise<
        | {
            ok: true;
            tokenProvided: boolean;
            session: DiscussionSessionRow;
        }
        | {
            ok: false;
            tokenProvided: boolean;
            status: number;
            error: string;
            message: string;
        }
        | {
            ok: true;
            tokenProvided: false;
            session: null;
        }
    > {
        const token = parseBearerToken(input.authorizationHeader);
        if (!token) {
            return { ok: true, tokenProvided: false, session: null };
        }

        const payload = parseSessionTokenPayload(token, jwtSecret);
        if (!payload) {
            return {
                ok: false,
                tokenProvided: true,
                status: 401,
                error: 'invalid_discussion_session_token',
                message: 'discussion session token is invalid or expired',
            };
        }

        const session = await loadValidSessionById(prisma, payload.sessionId);
        if (!session) {
            return {
                ok: false,
                tokenProvided: true,
                status: 401,
                error: 'discussion_session_not_found',
                message: 'discussion session is not found, expired, or revoked',
            };
        }

        if (session.senderPubkey !== payload.senderPubkey || session.scope !== payload.scope) {
            return {
                ok: false,
                tokenProvided: true,
                status: 401,
                error: 'discussion_session_token_mismatch',
                message: 'discussion session token does not match persisted session',
            };
        }

        if (input.expectedSenderPubkey && input.expectedSenderPubkey !== session.senderPubkey) {
            return {
                ok: false,
                tokenProvided: true,
                status: 403,
                error: 'discussion_session_sender_mismatch',
                message: 'discussion session sender does not match message sender',
            };
        }

        if (!scopeAllowsCircle(session.scope, input.circleId)) {
            return {
                ok: false,
                tokenProvided: true,
                status: 403,
                error: 'discussion_session_scope_violation',
                message: 'discussion session scope does not allow this circle',
            };
        }

        await prisma.$executeRaw`
            UPDATE discussion_sessions
            SET
                last_seen_at = NOW(),
                updated_at = NOW()
            WHERE session_id = ${session.sessionId}
        `;

        return {
            ok: true,
            tokenProvided: true,
            session,
        };
    }

    router.post('/sessions', async (req, res, next) => {
        try {
            const senderPubkey = String(req.body?.senderPubkey || '').trim();
            if (!senderPubkey) {
                return res.status(400).json({ error: 'missing_sender_pubkey' });
            }

            const senderHandleRaw = String(req.body?.senderHandle || '').trim();
            const senderHandle = senderHandleRaw.slice(0, 32) || null;

            let scope: string;
            try {
                scope = normalizeDiscussionScope(req.body?.scope ? String(req.body.scope) : undefined);
            } catch {
                return res.status(400).json({
                    error: 'invalid_discussion_scope',
                    message: 'scope must be "circle:*" or "circle:<id>"',
                });
            }

            const requestedTtl = parsePositiveInt(req.body?.ttlSec ? String(req.body.ttlSec) : undefined, sessionTtlSec);
            const ttlSec = Math.min(Math.max(requestedTtl, 60), 24 * 60 * 60);
            const now = new Date();
            const expiresAt = new Date(now.getTime() + ttlSec * 1000);

            const clientTimestamp = req.body?.clientTimestamp
                ? new Date(String(req.body.clientTimestamp))
                : now;
            if (Number.isNaN(clientTimestamp.getTime())) {
                return res.status(400).json({ error: 'invalid_client_timestamp' });
            }
            const clientTimestampIso = clientTimestamp.toISOString();
            const nonce = String(req.body?.nonce || randomNonce());

            const payload = buildSessionBootstrapPayload({
                senderPubkey,
                scope,
                clientTimestamp: clientTimestampIso,
                nonce,
            });
            const canonicalSignedMessage = buildSessionBootstrapMessage(payload);
            const signedMessage = req.body?.signedMessage ? String(req.body.signedMessage) : canonicalSignedMessage;
            if (signedMessage !== canonicalSignedMessage) {
                return res.status(400).json({
                    error: 'signed_message_mismatch',
                    message: 'signedMessage does not match canonical session bootstrap payload',
                });
            }

            const signature = req.body?.signature ? String(req.body.signature) : null;
            const signatureVerified = verifyEd25519SignatureBase64({
                senderPubkey,
                message: signedMessage,
                signatureBase64: signature,
            });
            if (requireSessionBootstrapSignature && !signatureVerified) {
                return res.status(401).json({
                    error: 'session_signature_required',
                    message: 'valid ed25519 signature is required to create discussion session',
                });
            }

            const sessionId = randomSessionId();
            const insertedRows = await prisma.$queryRaw<DiscussionSessionRow[]>`
                INSERT INTO discussion_sessions (
                    session_id,
                    sender_pubkey,
                    sender_handle,
                    scope,
                    issued_at,
                    expires_at,
                    revoked,
                    last_seen_at,
                    client_meta,
                    created_at,
                    updated_at
                )
                VALUES (
                    ${sessionId},
                    ${senderPubkey},
                    ${senderHandle},
                    ${scope},
                    NOW(),
                    ${expiresAt},
                    FALSE,
                    NOW(),
                    ${req.body?.clientMeta && typeof req.body.clientMeta === 'object' ? req.body.clientMeta : null}::jsonb,
                    NOW(),
                    NOW()
                )
                RETURNING
                    session_id AS "sessionId",
                    sender_pubkey AS "senderPubkey",
                    sender_handle AS "senderHandle",
                    scope AS "scope",
                    issued_at AS "issuedAt",
                    expires_at AS "expiresAt",
                    revoked AS "revoked",
                    last_seen_at AS "lastSeenAt",
                    created_at AS "createdAt",
                    updated_at AS "updatedAt"
            `;
            const session = insertedRows[0];
            if (!session) {
                throw new Error('failed_to_create_discussion_session');
            }

            const discussionAccessToken = signDiscussionSessionToken({
                sessionId: session.sessionId,
                senderPubkey: session.senderPubkey,
                scope: session.scope,
                expiresAt: session.expiresAt,
                jwtSecret,
            });

            res.status(201).json({
                ok: true,
                sessionId: session.sessionId,
                senderPubkey: session.senderPubkey,
                scope: session.scope,
                expiresAt: session.expiresAt.toISOString(),
                discussionAccessToken,
                signatureVerified,
            });
        } catch (error) {
            if (error instanceof GhostDraftAcceptanceError) {
                return res.status(error.statusCode).json({
                    error: error.code,
                    message: error.message,
                });
            }
            next(error);
        }
    });

    router.post('/sessions/:id/refresh', async (req, res, next) => {
        try {
            const sessionId = String(req.params.id || '').trim();
            if (!sessionId) {
                return res.status(400).json({ error: 'missing_session_id' });
            }

            const token = parseBearerToken(req.headers.authorization);
            if (!token) {
                return res.status(401).json({ error: 'missing_discussion_session_token' });
            }

            const payload = parseSessionTokenPayload(token, jwtSecret);
            if (!payload) {
                return res.status(401).json({
                    error: 'invalid_discussion_session_token',
                    message: 'discussion session token is invalid or expired',
                });
            }
            if (payload.sessionId !== sessionId) {
                return res.status(403).json({
                    error: 'discussion_session_id_mismatch',
                    message: 'session id in path does not match token session id',
                });
            }

            const session = await loadValidSessionById(prisma, payload.sessionId);
            if (!session) {
                return res.status(401).json({
                    error: 'discussion_session_not_found',
                    message: 'discussion session is not found, expired, or revoked',
                });
            }

            const remainingMs = session.expiresAt.getTime() - Date.now();
            const requestedTtl = parsePositiveInt(req.body?.ttlSec ? String(req.body.ttlSec) : undefined, sessionTtlSec);
            const ttlSec = Math.min(Math.max(requestedTtl, 60), 24 * 60 * 60);
            const nextExpiresAt = new Date(Date.now() + ttlSec * 1000);

            if (remainingMs > sessionRefreshWindowSec * 1000) {
                const tokenUnchanged = signDiscussionSessionToken({
                    sessionId: session.sessionId,
                    senderPubkey: session.senderPubkey,
                    scope: session.scope,
                    expiresAt: session.expiresAt,
                    jwtSecret,
                });
                return res.json({
                    ok: true,
                    sessionId: session.sessionId,
                    senderPubkey: session.senderPubkey,
                    scope: session.scope,
                    expiresAt: session.expiresAt.toISOString(),
                    discussionAccessToken: tokenUnchanged,
                    refreshed: false,
                });
            }

            const rows = await prisma.$queryRaw<DiscussionSessionRow[]>`
                UPDATE discussion_sessions
                SET
                    expires_at = ${nextExpiresAt},
                    last_seen_at = NOW(),
                    updated_at = NOW()
                WHERE session_id = ${session.sessionId}
                  AND revoked = FALSE
                RETURNING
                    session_id AS "sessionId",
                    sender_pubkey AS "senderPubkey",
                    sender_handle AS "senderHandle",
                    scope AS "scope",
                    issued_at AS "issuedAt",
                    expires_at AS "expiresAt",
                    revoked AS "revoked",
                    last_seen_at AS "lastSeenAt",
                    created_at AS "createdAt",
                    updated_at AS "updatedAt"
            `;
            const refreshedSession = rows[0];
            if (!refreshedSession) {
                return res.status(401).json({
                    error: 'discussion_session_not_found',
                    message: 'discussion session is not found, expired, or revoked',
                });
            }

            const refreshedToken = signDiscussionSessionToken({
                sessionId: refreshedSession.sessionId,
                senderPubkey: refreshedSession.senderPubkey,
                scope: refreshedSession.scope,
                expiresAt: refreshedSession.expiresAt,
                jwtSecret,
            });

            res.json({
                ok: true,
                sessionId: refreshedSession.sessionId,
                senderPubkey: refreshedSession.senderPubkey,
                scope: refreshedSession.scope,
                expiresAt: refreshedSession.expiresAt.toISOString(),
                discussionAccessToken: refreshedToken,
                refreshed: true,
            });
        } catch (error) {
            next(error);
        }
    });

    router.delete('/sessions/:id', async (req, res, next) => {
        try {
            const sessionId = String(req.params.id || '').trim();
            if (!sessionId) {
                return res.status(400).json({ error: 'missing_session_id' });
            }

            const token = parseBearerToken(req.headers.authorization);
            if (!token) {
                return res.status(401).json({ error: 'missing_discussion_session_token' });
            }

            const payload = parseSessionTokenPayload(token, jwtSecret);
            if (!payload) {
                return res.status(401).json({
                    error: 'invalid_discussion_session_token',
                    message: 'discussion session token is invalid or expired',
                });
            }
            if (payload.sessionId !== sessionId) {
                return res.status(403).json({
                    error: 'discussion_session_id_mismatch',
                    message: 'session id in path does not match token session id',
                });
            }

            await prisma.$executeRaw`
                UPDATE discussion_sessions
                SET
                    revoked = TRUE,
                    updated_at = NOW()
                WHERE session_id = ${sessionId}
            `;

            res.json({ ok: true, sessionId });
        } catch (error) {
            next(error);
        }
    });

    router.get('/watermark', async (_req, res, next) => {
        try {
            const watermark = await readOffchainWatermark(prisma);
            res.json({
                streamKey: DISCUSSION_STREAM_KEY,
                watermark: watermark
                    ? {
                        lastLamport: Number(watermark.lastLamport),
                        lastEnvelopeId: watermark.lastEnvelopeId,
                        lastIngestedAt: watermark.lastIngestedAt?.toISOString() || null,
                        updatedAt: watermark.updatedAt.toISOString(),
                    }
                    : {
                        lastLamport: 0,
                        lastEnvelopeId: null,
                        lastIngestedAt: null,
                        updatedAt: null,
                    },
            });
        } catch (error) {
            next(error);
        }
    });

    router.get('/stream', async (req, res, next) => {
        try {
            const streamKey = String(req.query.streamKey || DISCUSSION_STREAM_KEY);
            const afterLamport = BigInt(parseNonNegativeInt(req.query.afterLamport as string, 0));
            const limit = Math.min(parsePositiveInt(req.query.limit as string, 200), 1000);
            const includeDeleted = parseBool(req.query.includeDeleted as string, true);

            const deletedFilter = includeDeleted
                ? Prisma.sql`TRUE`
                : Prisma.sql`m.deleted = FALSE`;

            const rows = await prisma.$queryRaw<DiscussionRow[]>(Prisma.sql`
                SELECT
                    ${discussionSelectColumns}
                FROM circle_discussion_messages m
                ${discussionForwardSourceJoin}
                ${discussionHighlightCountJoin}
                WHERE m.stream_key = ${streamKey}
                  AND m.lamport > ${afterLamport}
                  AND ${deletedFilter}
                ORDER BY m.lamport ASC
                LIMIT ${limit}
            `);

            const watermark = await readOffchainWatermark(prisma, streamKey);
            res.json({
                streamKey,
                afterLamport: Number(afterLamport),
                nextAfterLamport: rows.length > 0 ? Number(rows[rows.length - 1].lamport) : Number(afterLamport),
                count: rows.length,
                watermark: watermark
                    ? {
                        lastLamport: Number(watermark.lastLamport),
                        lastEnvelopeId: watermark.lastEnvelopeId,
                        lastIngestedAt: watermark.lastIngestedAt?.toISOString() || null,
                    }
                    : null,
                messages: rows.map(mapRowToDto),
            });
        } catch (error) {
            next(error);
        }
    });

    router.get('/peers', async (_req, res, next) => {
        try {
            const configuredPeers = parseOffchainPeerUrls();
            const rows = await prisma.$queryRaw<Array<{
                peerUrl: string;
                lastRemoteLamport: bigint;
                lastSuccessAt: Date | null;
                lastError: string | null;
                updatedAt: Date;
            }>>`
                SELECT
                    peer_url AS "peerUrl",
                    last_remote_lamport AS "lastRemoteLamport",
                    last_success_at AS "lastSuccessAt",
                    last_error AS "lastError",
                    updated_at AS "updatedAt"
                FROM offchain_peer_sync_state
                ORDER BY peer_url ASC
            `;

            const rowMap = new Map(rows.map((row) => [row.peerUrl, row]));
            const peers = configuredPeers.map((peerUrl) => {
                const row = rowMap.get(peerUrl);
                return {
                    peerUrl,
                    lastRemoteLamport: row ? Number(row.lastRemoteLamport) : 0,
                    lastSuccessAt: row?.lastSuccessAt?.toISOString() || null,
                    lastError: row?.lastError || null,
                    updatedAt: row?.updatedAt?.toISOString() || null,
                };
            });

            res.json({
                configuredPeers,
                peers,
            });
        } catch (error) {
            next(error);
        }
    });

    router.get('/circles/:id/messages', async (req, res, next) => {
        try {
            const circleId = parsePositiveInt(req.params.id, NaN);
            if (!Number.isFinite(circleId)) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }

            const roomKey = buildDiscussionRoomKey(circleId);
            const limit = Math.min(parsePositiveInt(req.query.limit as string, 80), 200);
            const beforeLamportRaw = req.query.beforeLamport as string | undefined;
            const afterLamportRaw = req.query.afterLamport as string | undefined;
            const includeDeleted = parseBool(req.query.includeDeleted as string, false);
            const beforeLamport = parseOptionalLamport(beforeLamportRaw, 'positive');
            const afterLamport = parseOptionalLamport(afterLamportRaw, 'non_negative');

            if (beforeLamport === 'invalid') {
                return res.status(400).json({ error: 'invalid_before_lamport' });
            }
            if (afterLamport === 'invalid') {
                return res.status(400).json({ error: 'invalid_after_lamport' });
            }
            if (beforeLamport !== null && afterLamport !== null) {
                return res.status(400).json({ error: 'invalid_lamport_range' });
            }

            const rows = await prisma.$queryRaw<DiscussionRow[]>(Prisma.sql`
                SELECT
                    ${discussionSelectColumns}
                FROM circle_discussion_messages m
                ${discussionForwardSourceJoin}
                ${discussionHighlightCountJoin}
                WHERE m.room_key = ${roomKey}
                  AND (
                      (m.subject_type IS NULL AND m.subject_id IS NULL)
                      OR (
                          m.subject_type = 'discussion_message'
                          AND m.subject_id IS NOT NULL
                          AND m.message_kind IN ('forward', 'draft_candidate_notice', 'governance_notice')
                      )
                  )
                  AND (
                      m.is_ephemeral = FALSE
                      OR m.expires_at IS NULL
                      OR m.expires_at > NOW()
                  )
                  AND (${beforeLamport}::BIGINT IS NULL OR m.lamport < ${beforeLamport}::BIGINT)
                  AND (${afterLamport}::BIGINT IS NULL OR m.lamport > ${afterLamport}::BIGINT)
                  AND (${includeDeleted}::BOOLEAN = TRUE OR m.deleted = FALSE)
                ORDER BY m.lamport ${afterLamport === null ? Prisma.raw('DESC') : Prisma.raw('ASC')}
                LIMIT ${limit}
            `);

            const ordered = afterLamport === null ? [...rows].reverse() : rows;
            const watermark = await readOffchainWatermark(prisma);
            res.json({
                circleId,
                roomKey,
                count: ordered.length,
                watermark: watermark
                    ? {
                        lastLamport: Number(watermark.lastLamport),
                        lastEnvelopeId: watermark.lastEnvelopeId,
                        lastIngestedAt: watermark.lastIngestedAt?.toISOString() || null,
                    }
                    : null,
                messages: ordered.map(mapRowToDto),
            });
        } catch (error) {
            next(error);
        }
    });

    router.get('/circles/:id/messages/lookup', async (req, res, next) => {
        try {
            const circleId = parsePositiveInt(req.params.id, NaN);
            if (!Number.isFinite(circleId)) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }

            const envelopeIds = parseEnvelopeIdsQuery(req.query.envelopeIds as string | string[] | undefined);
            if (envelopeIds.length === 0) {
                return res.status(400).json({ error: 'invalid_envelope_ids' });
            }

            const roomKey = buildDiscussionRoomKey(circleId);
            const includeDeleted = parseBool(req.query.includeDeleted as string, false);
            const rows = await prisma.$queryRaw<DiscussionRow[]>(Prisma.sql`
                SELECT
                    ${discussionSelectColumns}
                FROM circle_discussion_messages m
                ${discussionForwardSourceJoin}
                ${discussionHighlightCountJoin}
                WHERE m.room_key = ${roomKey}
                  AND m.envelope_id IN (${Prisma.join(envelopeIds)})
                  AND (
                      m.is_ephemeral = FALSE
                      OR m.expires_at IS NULL
                      OR m.expires_at > NOW()
                  )
                  AND (${includeDeleted}::BOOLEAN = TRUE OR m.deleted = FALSE)
                ORDER BY m.lamport ASC
            `);

            res.json({
                circleId,
                roomKey,
                count: rows.length,
                messages: rows.map(mapRowToDto),
            });
        } catch (error) {
            next(error);
        }
    });

    router.get('/circles/:id/stream', async (req, res, next) => {
        try {
            const circleId = parsePositiveInt(req.params.id, NaN);
            if (!Number.isFinite(circleId)) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            if (!redis || typeof (redis as Partial<Redis>).duplicate !== 'function') {
                return res.status(503).json({
                    error: 'discussion_realtime_unavailable',
                    message: 'discussion realtime stream is unavailable',
                });
            }

            const channel = buildDiscussionRealtimeChannel(circleId);
            const subscriber = (redis as Redis).duplicate();
            await subscriber.subscribe(channel);

            res.status(200);
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            if (typeof (res as any).flushHeaders === 'function') {
                (res as any).flushHeaders();
            }

            let closed = false;
            const heartbeatTimer = setInterval(() => {
                if (closed) return;
                res.write(serializeDiscussionRealtimeHeartbeat());
            }, 15_000);

            const handleRedisMessage = (incomingChannel: string, rawMessage: string) => {
                if (closed || incomingChannel !== channel) return;
                const payload = parseDiscussionRealtimePayload(rawMessage);
                if (!payload || payload.circleId !== circleId) return;
                res.write(serializeDiscussionRealtimeSseEvent(payload));
            };

            const cleanup = () => {
                if (closed) return;
                closed = true;
                clearInterval(heartbeatTimer);
                if (typeof (subscriber as any).off === 'function') {
                    (subscriber as any).off('message', handleRedisMessage);
                } else if (typeof (subscriber as any).removeListener === 'function') {
                    (subscriber as any).removeListener('message', handleRedisMessage);
                }
                void Promise.resolve(subscriber.unsubscribe(channel)).catch(() => undefined);
                if (typeof subscriber.quit === 'function') {
                    void Promise.resolve(subscriber.quit()).catch(() => undefined);
                }
            };

            subscriber.on('message', handleRedisMessage);
            req.on('close', cleanup);
        } catch (error) {
            next(error);
        }
    });

    router.get('/knowledge/:knowledgeId/messages', async (req, res, next) => {
        try {
            const authUserId = parseAuthUserIdFromRequest(req);
            if (!authUserId) {
                return res.status(401).json({ error: 'authentication_required' });
            }

            const knowledge = await loadKnowledgeDiscussionContext(req.params.knowledgeId);
            if (!knowledge) {
                return res.status(404).json({ error: 'knowledge_not_found' });
            }

            const isMember = await hasActiveCircleMembership(prisma, {
                circleId: knowledge.circleId,
                userId: authUserId,
            });
            if (!isMember) {
                return res.status(403).json({
                    error: 'discussion_membership_required',
                    message: 'only active circle members can access crystal discussion',
                });
            }

            const roomKey = buildDiscussionRoomKey(knowledge.circleId);
            const limit = Math.min(parsePositiveInt(req.query.limit as string, 80), 200);
            const beforeLamportRaw = req.query.beforeLamport as string | undefined;
            const includeDeleted = parseBool(req.query.includeDeleted as string, false);
            const beforeLamport = beforeLamportRaw ? BigInt(parsePositiveInt(beforeLamportRaw, 0)) : null;

            const rows = await prisma.$queryRaw<DiscussionRow[]>(Prisma.sql`
                SELECT
                    ${discussionSelectColumns}
                FROM circle_discussion_messages m
                ${discussionForwardSourceJoin}
                ${discussionHighlightCountJoin}
                WHERE m.room_key = ${roomKey}
                  AND m.subject_type = 'knowledge'
                  AND m.subject_id = ${knowledge.knowledgeId}
                  AND (${beforeLamport}::BIGINT IS NULL OR m.lamport < ${beforeLamport}::BIGINT)
                  AND (${includeDeleted}::BOOLEAN = TRUE OR m.deleted = FALSE)
                ORDER BY m.lamport DESC
                LIMIT ${limit}
            `);

            const ordered = [...rows].reverse();
            const watermark = await readOffchainWatermark(prisma);
            res.json({
                knowledgeId: knowledge.knowledgeId,
                circleId: knowledge.circleId,
                roomKey,
                count: ordered.length,
                watermark: watermark
                    ? {
                        lastLamport: Number(watermark.lastLamport),
                        lastEnvelopeId: watermark.lastEnvelopeId,
                        lastIngestedAt: watermark.lastIngestedAt?.toISOString() || null,
                    }
                    : null,
                messages: ordered.map(mapRowToDto),
            });
        } catch (error) {
            next(error);
        }
    });

    router.get('/internal/circles/:id/summary', async (req, res, next) => {
        try {
            if (!discussionSummaryInternalEndpointEnabled) {
                return res.status(404).json({ error: 'not_found' });
            }
            if (!ghostAdminToken) {
                return res.status(503).json({
                    error: 'ghost_admin_token_unconfigured',
                    message: 'internal summary endpoint is not configured',
                });
            }

            const providedToken = readInternalSummaryToken(req.headers);
            if (!providedToken || providedToken !== ghostAdminToken) {
                return res.status(401).json({
                    error: 'unauthorized_internal_summary_access',
                });
            }

            const circleId = parsePositiveInt(req.params.id, NaN);
            if (!Number.isFinite(circleId)) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }

            const force = parseBool(req.query.force as string, false);
            const circleGhostPatch = await loadCircleGhostSettingsPatch(prisma, circleId);
            const effectiveGhostSettings = resolveCircleGhostSettings(ghostConfig, circleGhostPatch);
            const diagnostics = await loadDiscussionSummaryDiagnostics(prisma, redis, circleId, {
                force,
                windowSize: discussionSummaryWindow,
                cacheTtlSec: discussionSummaryCacheTtlSec,
                summaryUseLLM: effectiveGhostSettings.summaryUseLLM,
                configSource: circleGhostPatch ? 'circle' : 'global_default',
                summarizeMessages: (input) => discussionIntelligence.summarizeMessages(input),
            });

            res.json(diagnostics);
        } catch (error) {
            next(error);
        }
    });

    router.get('/draft-anchors/:anchorId', async (req, res, next) => {
        try {
            const anchorId = String(req.params.anchorId || '').trim().toLowerCase();
            if (!/^[a-f0-9]{64}$/.test(anchorId)) {
                return res.status(400).json({ error: 'invalid_anchor_id' });
            }

            const anchor = await getDraftAnchorById(prisma, anchorId);
            if (!anchor) {
                return res.status(404).json({ error: 'draft_anchor_not_found' });
            }
            const access = await ensureDraftAccessFromRequest(req, res, anchor.draftPostId, 'read');
            if (!access) return;

            const proof = verifyDraftAnchor(anchor);
            return res.json({
                anchor,
                proof,
            });
        } catch (error) {
            next(error);
        }
    });

    router.get('/drafts/:postId/anchor', async (req, res, next) => {
        try {
            const postId = parsePositiveInt(req.params.postId, NaN);
            if (!Number.isFinite(postId)) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }
            const access = await ensureDraftAccessFromRequest(req, res, postId, 'read');
            if (!access) return;

            const anchor = await getLatestDraftAnchorByPostId(prisma, postId);
            if (!anchor) {
                return res.status(404).json({ error: 'draft_anchor_not_found' });
            }

            const proof = verifyDraftAnchor(anchor);
            return res.json({
                anchor,
                proof,
            });
        } catch (error) {
            next(error);
        }
    });

    router.post('/drafts/:postId/anchor/repair', async (req, res, next) => {
        try {
            const postId = parsePositiveInt(req.params.postId, NaN);
            if (!Number.isFinite(postId)) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }
            const access = await ensureDraftAccessFromRequest(req, res, postId, 'edit');
            if (!access) return;

            const anchorId = typeof req.body?.anchorId === 'string'
                ? req.body.anchorId
                : null;
            const anchor = await repairDraftAnchorBatch({
                prisma,
                draftPostId: postId,
                anchorId,
            });
            const proof = verifyDraftAnchor(anchor);
            return res.json({
                ok: proof.verifiable,
                mode: draftStrictBindingMode,
                anchor,
                proof,
            });
        } catch (error) {
            if (error instanceof DraftAnchorRepairError) {
                return res.status(error.statusCode).json({
                    error: error.code,
                    message: error.message,
                    mode: draftStrictBindingMode,
                });
            }
            next(error);
        }
    });

    router.get('/drafts/:postId/contributor-proof', async (req, res, next) => {
        try {
            const postId = parsePositiveInt(req.params.postId, NaN);
            if (!Number.isFinite(postId)) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }
            const access = await ensureDraftAccessFromRequest(req, res, postId, 'read');
            if (!access) return;

            const proof = await getDraftContributorProof(prisma, postId);
            return res.json({
                ok: true,
                mode: draftStrictBindingMode,
                proof,
            });
        } catch (error) {
            if (error instanceof DraftContributorProofError) {
                const decision = evaluateDraftStrictBindingViolation({
                    mode: draftStrictBindingMode,
                    code: error.code,
                    message: error.message,
                    enforceStatusCode: error.code === 'draft_anchor_unverifiable'
                        ? 422
                        : error.statusCode,
                });
                if (decision.blocked) {
                    return res.status(decision.statusCode || 409).json({
                        error: decision.error?.code || error.code,
                        message: decision.error?.message || error.message,
                        mode: draftStrictBindingMode,
                    });
                }
                const warning = emitDraftStrictWarning({
                    endpoint: 'GET /drafts/:postId/contributor-proof',
                    draftPostId: parsePositiveInt(req.params.postId, 0),
                    code: decision.warning?.code || error.code,
                    message: decision.warning?.message || error.message,
                });
                return res.json({
                    ok: true,
                    mode: draftStrictBindingMode,
                    proof: null,
                    warning,
                });
            }
            next(error);
        }
    });

    router.get('/drafts/:postId/proof-package', async (req, res, next) => {
        try {
            const postId = parsePositiveInt(req.params.postId, NaN);
            if (!Number.isFinite(postId)) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }
            const access = await ensureDraftAccessFromRequest(req, res, postId, 'read');
            if (!access) return;

            const contributorProof = await getDraftContributorProof(prisma, postId);
            const stableEvidence = await resolveStableSnapshotCollabEvidence(postId, prisma);

            const discussionResolutionRefs = await loadDraftDiscussionResolutionRefs(postId);
            const generatedAt = resolveProofPackageGeneratedAt({
                anchoredAt: (stableEvidence.anchor as any).anchoredAt ?? null,
                createdAt: (stableEvidence.anchor as any).createdAt ?? null,
                updatedAt: (stableEvidence.anchor as any).updatedAt ?? null,
            });
            const proofPackage = buildCanonicalProofPackageV2({
                contributorProof,
                collabEditAnchorId: stableEvidence.anchor.anchorId,
                discussionResolutionRefs,
                generatedAt,
            });
            let issuance: ReturnType<typeof issueProofPackageSignature>;
            try {
                issuance = issueProofPackageSignature({
                    proof_package_hash: proofPackage.proof_package_hash,
                    contributors_root: proofPackage.canonical_proof_package.root,
                    contributors_count: proofPackage.canonical_proof_package.count,
                    source_anchor_id: proofPackage.canonical_proof_package.draft_anchor,
                    binding_version: PROOF_PACKAGE_BINDING_VERSION,
                    generated_at: proofPackage.canonical_proof_package.generated_at,
                });
            } catch (error) {
                if (isIssuerConfigurationError(error)) {
                    const mapped = mapProofPackageIssuanceError(error);
                    const warning = emitDraftStrictWarning({
                        endpoint: 'GET /drafts/:postId/proof-package',
                        draftPostId: postId,
                        code: mapped.code,
                        message: mapped.message,
                    });
                    return res.json({
                        ok: true,
                        mode: draftStrictBindingMode,
                        draftPostId: postId,
                        root: proofPackage.canonical_proof_package.root,
                        count: proofPackage.canonical_proof_package.count,
                        proof_package_hash: proofPackage.proof_package_hash,
                        source_anchor_id: proofPackage.canonical_proof_package.draft_anchor,
                        binding_version: PROOF_PACKAGE_BINDING_VERSION,
                        generated_at: proofPackage.canonical_proof_package.generated_at,
                        proofPackage: proofPackage.canonical_proof_package,
                        warning,
                    });
                }
                throw error;
            }

            return res.json({
                ok: true,
                mode: draftStrictBindingMode,
                draftPostId: postId,
                root: proofPackage.canonical_proof_package.root,
                count: proofPackage.canonical_proof_package.count,
                proof_package_hash: proofPackage.proof_package_hash,
                source_anchor_id: proofPackage.canonical_proof_package.draft_anchor,
                binding_version: PROOF_PACKAGE_BINDING_VERSION,
                generated_at: proofPackage.canonical_proof_package.generated_at,
                issuer_key_id: issuance.issuer_key_id,
                issued_signature: issuance.issued_signature,
                proofPackage: proofPackage.canonical_proof_package,
            });
        } catch (error) {
            if (error instanceof DraftWorkflowStateError) {
                const decision = evaluateDraftStrictBindingViolation({
                    mode: draftStrictBindingMode,
                    code: error.code,
                    message: error.message,
                    enforceStatusCode: error.statusCode,
                });
                if (decision.blocked) {
                    return res.status(decision.statusCode || error.statusCode || 409).json({
                        error: decision.error?.code || error.code,
                        message: decision.error?.message || error.message,
                        mode: draftStrictBindingMode,
                    });
                }
                const warning = emitDraftStrictWarning({
                    endpoint: 'GET /drafts/:postId/proof-package',
                    draftPostId: parsePositiveInt(req.params.postId, 0),
                    code: decision.warning?.code || error.code,
                    message: decision.warning?.message || error.message,
                });
                return res.json({
                    ok: true,
                    mode: draftStrictBindingMode,
                    proofPackage: null,
                    warning,
                });
            }
            if (error instanceof DraftContributorProofError) {
                const decision = evaluateDraftStrictBindingViolation({
                    mode: draftStrictBindingMode,
                    code: error.code,
                    message: error.message,
                    enforceStatusCode: error.code === 'draft_anchor_unverifiable'
                        ? 422
                        : error.statusCode,
                });
                if (decision.blocked) {
                    return res.status(decision.statusCode || 409).json({
                        error: decision.error?.code || error.code,
                        message: decision.error?.message || error.message,
                        mode: draftStrictBindingMode,
                    });
                }
                const warning = emitDraftStrictWarning({
                    endpoint: 'GET /drafts/:postId/proof-package',
                    draftPostId: parsePositiveInt(req.params.postId, 0),
                    code: decision.warning?.code || error.code,
                    message: decision.warning?.message || error.message,
                });
                return res.json({
                    ok: true,
                    mode: draftStrictBindingMode,
                    proofPackage: null,
                    warning,
                });
            }
            next(error);
        }
    });

    router.get('/drafts/:postId/edit-anchors', async (req, res, next) => {
        try {
            const postId = parsePositiveInt(req.params.postId, NaN);
            if (!Number.isFinite(postId)) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }
            const access = await ensureDraftAccessFromRequest(req, res, postId, 'read');
            if (!access) return;

            const limit = Math.min(parsePositiveInt(req.query.limit as string, 20), 100);
            const anchors = await getCollabEditAnchorsByPostId(prisma, postId, limit);
            return res.json({
                draftPostId: postId,
                count: anchors.length,
                anchors: anchors.map((anchor) => ({
                    ...anchor,
                    proof: verifyCollabEditAnchor(anchor),
                })),
            });
        } catch (error) {
            next(error);
        }
    });

    router.get('/edit-anchors/:anchorId', async (req, res, next) => {
        try {
            const anchorId = String(req.params.anchorId || '').trim().toLowerCase();
            if (!/^[a-f0-9]{64}$/.test(anchorId)) {
                return res.status(400).json({ error: 'invalid_anchor_id' });
            }

            const anchor = await getCollabEditAnchorById(prisma, anchorId);
            if (!anchor) {
                return res.status(404).json({ error: 'collab_edit_anchor_not_found' });
            }
            const access = await ensureDraftAccessFromRequest(req, res, anchor.draftPostId, 'read');
            if (!access) return;

            return res.json({
                anchor,
                proof: verifyCollabEditAnchor(anchor),
            });
        } catch (error) {
            next(error);
        }
    });

    router.get('/drafts/:postId/publish-readiness', async (req, res, next) => {
        try {
            const postId = parsePositiveInt(req.params.postId, NaN);
            if (!Number.isFinite(postId)) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }
            const access = await ensureDraftAccessFromRequest(req, res, postId, 'read');
            if (!access) return;

            const stableEvidence = await resolveStableSnapshotCollabEvidence(postId, prisma);

            return res.json({
                ready: true,
                reason: 'ok',
                mode: draftStrictBindingMode,
                anchor: stableEvidence.anchor,
                proof: stableEvidence.proof,
            });
        } catch (error) {
            if (error instanceof DraftWorkflowStateError) {
                const decision = evaluateDraftStrictBindingViolation({
                    mode: draftStrictBindingMode,
                    code: error.code,
                    message: error.message,
                    enforceStatusCode: error.statusCode,
                });
                if (decision.blocked) {
                    return res.status(decision.statusCode || error.statusCode || 409).json({
                        ready: false,
                        reason: error.code === 'draft_anchor_not_found'
                            ? 'no_edit_anchor'
                            : error.code === 'draft_anchor_not_final'
                                ? 'latest_anchor_not_final'
                                : error.code === 'draft_anchor_unverifiable'
                                    ? 'latest_anchor_unverifiable'
                                    : error.code,
                        error: decision.error?.code || error.code,
                        message: decision.error?.message || error.message,
                        mode: draftStrictBindingMode,
                    });
                }
                const warning = emitDraftStrictWarning({
                    endpoint: 'GET /drafts/:postId/publish-readiness',
                    draftPostId: parsePositiveInt(req.params.postId, 0),
                    code: decision.warning?.code || error.code,
                    message: decision.warning?.message || error.message,
                });
                return res.json({
                    ready: true,
                    reason: 'ok_with_warning',
                    mode: draftStrictBindingMode,
                    warning,
                });
            }
            next(error);
        }
    });

    router.post('/drafts/:postId/crystallization-attempt', async (req, res, next) => {
        try {
            const postId = parsePositiveInt(req.params.postId, NaN);
            if (!Number.isFinite(postId)) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }

            const access = await ensureDraftAccessFromRequest(req, res, postId, 'read');
            if (!access) return;

            const circleId = access.post?.circleId;
            const authUserId = parseAuthUserIdFromRequest(req);
            if (!authUserId || !circleId) {
                return res.status(403).json({
                    error: 'draft_crystallize_permission_denied',
                    message: localizeQueryApiCopy('draft.crystallization.missingCircleContextRegister', resolveExpressRequestLocale(req)),
                });
            }
            const permission = await resolveDraftWorkflowPermission(prisma, {
                circleId,
                userId: authUserId,
                action: 'enter_crystallization',
            });
            if (!permission.allowed) {
                return res.status(403).json({
                    error: 'draft_crystallize_permission_denied',
                    message: localizeDraftWorkflowPermissionDecision(permission, resolveExpressRequestLocale(req)),
                });
            }
            const lifecycle = await resolveDraftLifecycleReadModel(prisma, {
                draftPostId: postId,
            });
            if (lifecycle.documentStatus !== 'crystallization_active') {
                return res.status(409).json({
                    error: 'draft_not_ready_for_crystallization_execution',
                    message: localizeQueryApiCopy('draft.crystallization.notReadyForAttemptRegistration', resolveExpressRequestLocale(req)),
                });
            }

            const knowledgePda = parsePublicKey(req.body?.knowledgePda);
            if (!knowledgePda) {
                return res.status(400).json({
                    error: 'invalid_knowledge_pda',
                    message: 'knowledgePda must be a valid public key',
                });
            }
            const proofPackageHash = parseHex64(req.body?.proofPackageHash ?? req.body?.proof_package_hash);
            if (!proofPackageHash) {
                return res.status(400).json({
                    error: 'invalid_proof_package_hash',
                    message: 'proofPackageHash must be a 64-character hex string',
                });
            }

            const attempt = await upsertCrystallizationAttempt(prisma as any, {
                draftPostId: postId,
                proofPackageHash,
                knowledgeOnChainAddress: knowledgePda,
            });

            return res.json({
                ok: true,
                draftPostId: postId,
                attempt: {
                    proofPackageHash: attempt.proofPackageHash,
                    knowledgeId: attempt.knowledgeId,
                    knowledgeOnChainAddress: attempt.knowledgeOnChainAddress,
                    status: attempt.status,
                    failureCode: attempt.failureCode,
                    failureMessage: attempt.failureMessage,
                },
            });
        } catch (error) {
            next(error);
        }
    });

    router.post('/drafts/:postId/crystallization-binding', async (req, res, next) => {
        try {
            const postId = parsePositiveInt(req.params.postId, NaN);
            if (!Number.isFinite(postId)) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }

            const access = await ensureDraftAccessFromRequest(req, res, postId, 'read');
            if (!access) return;

            const circleId = access.post?.circleId;
            const authUserId = parseAuthUserIdFromRequest(req);
            if (!authUserId || !circleId) {
                return res.status(403).json({
                    error: 'draft_crystallize_permission_denied',
                    message: localizeQueryApiCopy('draft.crystallization.missingCircleContextBinding', resolveExpressRequestLocale(req)),
                });
            }
            const permission = await resolveDraftWorkflowPermission(prisma, {
                circleId,
                userId: authUserId,
                action: 'enter_crystallization',
            });
            if (!permission.allowed) {
                return res.status(403).json({
                    error: 'draft_crystallize_permission_denied',
                    message: localizeDraftWorkflowPermissionDecision(permission, resolveExpressRequestLocale(req)),
                });
            }
            const lifecycle = await resolveDraftLifecycleReadModel(prisma, {
                draftPostId: postId,
            });
            if (lifecycle.documentStatus !== 'crystallization_active') {
                return res.status(409).json({
                    error: 'draft_not_ready_for_crystallization_execution',
                    message: localizeQueryApiCopy('draft.crystallization.notReadyForExecution', resolveExpressRequestLocale(req)),
                });
            }
            const policyProfileDigest = computePolicyProfileDigest(
                buildPublicPolicyDigestSnapshot(
                    await resolveCirclePolicyProfile(prisma, circleId),
                ),
            );

            const knowledgePda = parsePublicKey(req.body?.knowledgePda);
            if (!knowledgePda) {
                return res.status(400).json({
                    error: 'invalid_knowledge_pda',
                    message: 'knowledgePda must be a valid public key',
                });
            }

            const rawProofSnapshot = {
                proofPackageHash: req.body?.proofPackageHash ?? req.body?.proof_package_hash,
                sourceAnchorId: req.body?.sourceAnchorId ?? req.body?.source_anchor_id,
                contributorsRoot: req.body?.contributorsRoot ?? req.body?.contributors_root,
                contributorsCount: req.body?.contributorsCount ?? req.body?.contributors_count,
                bindingVersion: req.body?.bindingVersion ?? req.body?.binding_version,
                generatedAt: req.body?.generatedAt ?? req.body?.generated_at,
                issuerKeyId: req.body?.issuerKeyId ?? req.body?.issuer_key_id,
                issuedSignature: req.body?.issuedSignature ?? req.body?.issued_signature,
                proofPackage: req.body?.proofPackage ?? req.body?.proof_package,
            };
            const hasProofSnapshotInput = Object.values(rawProofSnapshot).some((value) => {
                if (value === null || value === undefined) return false;
                if (typeof value === 'string') return value.trim().length > 0;
                return true;
            });
            const proofSnapshot = (
                hasProofSnapshotInput || draftStrictBindingMode === 'enforce'
            )
                ? {
                    proofPackageHash: parseHex64(rawProofSnapshot.proofPackageHash),
                    sourceAnchorId: parseHex64(rawProofSnapshot.sourceAnchorId),
                    contributorsRoot: parseHex64(rawProofSnapshot.contributorsRoot),
                    contributorsCount: parsePositiveU16(rawProofSnapshot.contributorsCount),
                    bindingVersion: parsePositiveU16(rawProofSnapshot.bindingVersion),
                    generatedAt: parseIsoTimestamp(rawProofSnapshot.generatedAt),
                    issuerKeyId: parsePublicKey(rawProofSnapshot.issuerKeyId),
                    issuedSignature: parseHex128(rawProofSnapshot.issuedSignature),
                    proofPackage:
                        rawProofSnapshot.proofPackage
                        && typeof rawProofSnapshot.proofPackage === 'object'
                        && !Array.isArray(rawProofSnapshot.proofPackage)
                            ? rawProofSnapshot.proofPackage as Prisma.JsonValue
                            : null,
                }
                : null;
            if ((hasProofSnapshotInput || draftStrictBindingMode === 'enforce') && (
                !proofSnapshot?.proofPackageHash
                || !proofSnapshot.sourceAnchorId
                || !proofSnapshot.contributorsRoot
                || !proofSnapshot.contributorsCount
                || !proofSnapshot.bindingVersion
                || !proofSnapshot.generatedAt
                || !proofSnapshot.issuerKeyId
                || !proofSnapshot.issuedSignature
                || !proofSnapshot.proofPackage
            )) {
                return res.status(400).json({
                    error: 'invalid_proof_snapshot',
                    message: 'proof snapshot fields are incomplete or invalid',
                });
            }
            let validatedProofSnapshot: DraftProofSnapshotInput | null = null;
            if (proofSnapshot) {
                try {
                    validatedProofSnapshot = validateProofSnapshot({
                        proofPackageHash: proofSnapshot.proofPackageHash as string,
                        sourceAnchorId: proofSnapshot.sourceAnchorId as string,
                        contributorsRoot: proofSnapshot.contributorsRoot as string,
                        contributorsCount: proofSnapshot.contributorsCount as number,
                        bindingVersion: proofSnapshot.bindingVersion as number,
                        generatedAt: proofSnapshot.generatedAt as string,
                        issuerKeyId: proofSnapshot.issuerKeyId as string,
                        issuedSignature: proofSnapshot.issuedSignature as string,
                        proofPackage: proofSnapshot.proofPackage as Prisma.JsonValue,
                    });
                } catch (error) {
                    if (isIssuerConfigurationError(error)) {
                        throw error;
                    }
                    return res.status(400).json({
                        error: 'invalid_proof_snapshot',
                        message: 'proof snapshot payload is invalid or inconsistent',
                    });
                }
            }
            let effectiveKnowledgePda = knowledgePda;
            let currentCrystallizationAttemptStatus: string | null = null;
            if (validatedProofSnapshot?.proofPackageHash) {
                const attempt = await upsertCrystallizationAttempt(prisma as any, {
                    draftPostId: postId,
                    proofPackageHash: validatedProofSnapshot.proofPackageHash,
                    knowledgeOnChainAddress: knowledgePda,
                });
                effectiveKnowledgePda = attempt.knowledgeOnChainAddress;
                currentCrystallizationAttemptStatus = attempt.status;
            }

            let contributionSnapshot: {
                synced: boolean;
                code?: string;
                message?: string;
                contributorsCount?: number;
                contributorsRoot?: string | null;
            } = {
                synced: false,
            };
            let proofPackageIssuance: {
                persisted: boolean;
                proofPackageHash?: string;
                sourceAnchorId?: string;
                contributorsRoot?: string;
                contributorsCount?: number;
                bindingVersion?: number;
                generatedAt?: string;
                issuerKeyId?: string;
                issuedSignature?: string;
                issuedAt?: string;
                code?: string;
                message?: string;
                warning?: Record<string, unknown>;
            } = {
                persisted: false,
            };

            const markBindingAttemptSynced = async (input: {
                proofPackageHash: string | undefined;
                knowledgeId: string;
            }) => {
                if (!input.proofPackageHash) return;
                await markCrystallizationAttemptBindingSynced(prisma as any, {
                    draftPostId: postId,
                    proofPackageHash: input.proofPackageHash,
                    knowledgeId: input.knowledgeId,
                });
            };

            const materializeReferencesBeforeFinalization = async (input: {
                proofPackageHash: string | undefined;
                knowledgeId: string;
                attemptStatus: string | null;
            }) => {
                if (
                    input.attemptStatus === 'references_synced'
                    || input.attemptStatus === 'finalization_failed'
                ) {
                    return {
                        attempted: 0,
                        succeeded: 0,
                        skipped: 0,
                        signatures: [],
                    };
                }
                try {
                    const result = await materializeDraftCrystalReferencesOrThrow(prisma as any, {
                        draftPostId: postId,
                        targetKnowledgeId: input.knowledgeId,
                        targetOnChainAddress: effectiveKnowledgePda,
                        requestedByUserId: authUserId || null,
                        referenceClient: createLazyReferenceMaterializationClient(),
                    });
                    if (input.proofPackageHash) {
                        await markCrystallizationAttemptReferencesSynced(prisma as any, {
                            draftPostId: postId,
                            proofPackageHash: input.proofPackageHash,
                        });
                    }
                    return result;
                } catch (error) {
                    if (input.proofPackageHash) {
                        await markCrystallizationAttemptReferencesFailed(prisma as any, {
                            draftPostId: postId,
                            proofPackageHash: input.proofPackageHash,
                            failureCode: error instanceof DraftReferenceMaterializationError
                                ? error.code
                                : 'reference_materialization_failed',
                            failureMessage: error instanceof Error
                                ? error.message
                                : String(error),
                        }).catch((markError) => {
                            console.warn('[discussion][crystallization_attempt_references_failed_mark_failed]', {
                                draftPostId: postId,
                                message: markError instanceof Error ? markError.message : String(markError),
                            });
                        });
                    }
                    throw error;
                }
            };

            const finalizeLifecycleAndAttempt = async (input: {
                proofPackageHash: string | undefined;
            }) => {
                try {
                    await finalizeCrystallizationLifecycleOrThrow({
                        draftPostId: postId,
                        actorUserId: authUserId || null,
                        locale: resolveExpressRequestLocale(req),
                    });
                    if (input.proofPackageHash) {
                        await markCrystallizationAttemptFinalized(prisma as any, {
                            draftPostId: postId,
                            proofPackageHash: input.proofPackageHash,
                        });
                    }
                } catch (error) {
                    if (input.proofPackageHash) {
                        await markCrystallizationAttemptFinalizationFailed(prisma as any, {
                            draftPostId: postId,
                            proofPackageHash: input.proofPackageHash,
                            failureCode: error instanceof CrystallizationBindingError
                                ? error.code
                                : 'draft_lifecycle_finalize_failed',
                            failureMessage: error instanceof Error
                                ? error.message
                                : String(error),
                        }).catch((markError) => {
                            console.warn('[discussion][crystallization_attempt_finalization_failed_mark_failed]', {
                                draftPostId: postId,
                                message: markError instanceof Error ? markError.message : String(markError),
                            });
                        });
                    }
                    throw error;
                }
            };

            const syncCrystalAssetsForKnowledge = async (knowledgeId: string) => {
                const entitlementSync = await upsertCrystalEntitlementsForKnowledge(prisma as any, {
                    knowledgePublicId: knowledgeId,
                });
                await enqueueCrystalAssetIssueJob(prisma as any, {
                    knowledgeRowId: entitlementSync.knowledgeRowId,
                    knowledgePublicId: entitlementSync.knowledgePublicId,
                    requestedByUserId: authUserId || null,
                });
            };

            if (draftStrictBindingMode === 'enforce') {
                try {
                    const atomicResult = await prisma.$transaction(async (tx) => {
                        const atomicBinding = await bindKnowledgeToDraftSource(tx as any, {
                            draftPostId: postId,
                            knowledgeOnChainAddress: effectiveKnowledgePda,
                        });
                        const synced = await syncKnowledgeContributionsFromDraftProof(prisma, {
                            draftPostId: postId,
                            knowledgeOnChainAddress: effectiveKnowledgePda,
                        }, {
                            tx,
                            requireBindingProjection: true,
                            proofAnchorId: validatedProofSnapshot?.sourceAnchorId || undefined,
                            expectedProofPackageHash: validatedProofSnapshot?.proofPackageHash || undefined,
                            expectedContributorsRoot: validatedProofSnapshot?.contributorsRoot || undefined,
                            expectedContributorsCount: validatedProofSnapshot?.contributorsCount || undefined,
                        });
                        let persistedIssuance;
                        try {
                            persistedIssuance = await persistCurrentDraftProofPackageIssuance(
                                postId,
                                tx,
                                validatedProofSnapshot || undefined,
                            );
                        } catch (error) {
                            throw new ProofPackageIssuanceTxError(error);
                        }
                        return {
                            atomicBinding,
                            synced,
                            persistedIssuance,
                        };
                    });
                    proofPackageIssuance = {
                        persisted: true,
                        proofPackageHash: atomicResult.persistedIssuance.proofPackageHash,
                        sourceAnchorId: atomicResult.persistedIssuance.sourceAnchorId,
                        contributorsRoot: atomicResult.persistedIssuance.contributorsRoot,
                        contributorsCount: atomicResult.persistedIssuance.contributorsCount,
                        bindingVersion: atomicResult.persistedIssuance.bindingVersion,
                        generatedAt: atomicResult.persistedIssuance.generatedAt,
                        issuerKeyId: atomicResult.persistedIssuance.issuerKeyId,
                        issuedSignature: atomicResult.persistedIssuance.issuedSignature,
                        issuedAt: atomicResult.persistedIssuance.issuedAt,
                    };
                    await markBindingAttemptSynced({
                        proofPackageHash: atomicResult.persistedIssuance.proofPackageHash,
                        knowledgeId: atomicResult.synced.knowledgeId,
                    });
                    const referenceMaterialization = await materializeReferencesBeforeFinalization({
                        proofPackageHash: atomicResult.persistedIssuance.proofPackageHash,
                        knowledgeId: atomicResult.synced.knowledgeId,
                        attemptStatus: currentCrystallizationAttemptStatus,
                    });
                    await syncCrystalAssetsForKnowledge(atomicResult.synced.knowledgeId);
                    await finalizeLifecycleAndAttempt({
                        proofPackageHash: atomicResult.persistedIssuance.proofPackageHash,
                    });

                    return res.json({
                        ok: true,
                        draftPostId: postId,
                        knowledgePda: effectiveKnowledgePda,
                        policyProfileDigest,
                        mode: draftStrictBindingMode,
                        referenceMaterialization,
                        contributionSnapshot: {
                            synced: true,
                            contributorsCount: atomicResult.synced.contributorsCount,
                            contributorsRoot: atomicResult.synced.contributorsRoot,
                        },
                        proofPackageIssuance,
                        ...atomicResult.atomicBinding,
                    });
                } catch (error) {
                    if (error instanceof CrystallizationBindingError) {
                        throw error;
                    }
                    if (error instanceof DraftReferenceMaterializationError) {
                        throw error;
                    }
                    if (error instanceof ProofPackageIssuanceTxError) {
                        const mapped = mapProofPackageIssuanceError(error.causeError);
                        if (!isBusinessStatusCode(mapped.statusCode)) {
                            throw error.causeError;
                        }
                        const decision = evaluateDraftStrictBindingViolation({
                            mode: draftStrictBindingMode,
                            code: mapped.code,
                            message: mapped.message,
                            enforceStatusCode: mapped.statusCode,
                        });
                        return res.status(decision.statusCode || mapped.statusCode).json({
                            error: decision.error?.code || mapped.code,
                            message: decision.error?.message || mapped.message,
                            mode: draftStrictBindingMode,
                            details: decision.error?.details || null,
                        });
                    }
                    const mapped = mapContributionSyncError(error);
                    if (!isBusinessStatusCode(mapped.statusCode)) {
                        throw error;
                    }
                    const normalized = resolveContributionSyncViolation(mapped);
                    const decision = evaluateDraftStrictBindingViolation({
                        mode: draftStrictBindingMode,
                        code: normalized.code,
                        message: normalized.message,
                        enforceStatusCode: normalized.statusCode,
                        details: normalized.details,
                    });
                    return res.status(decision.statusCode || normalized.statusCode).json({
                        error: decision.error?.code || normalized.code,
                        message: decision.error?.message || normalized.message,
                        mode: draftStrictBindingMode,
                        details: decision.error?.details || null,
                    });
                }
            }

            const binding = await bindKnowledgeToDraftSource(prisma, {
                draftPostId: postId,
                knowledgeOnChainAddress: effectiveKnowledgePda,
            });
            try {
                const synced = await syncKnowledgeContributionsFromDraftProof(prisma, {
                    draftPostId: postId,
                    knowledgeOnChainAddress: effectiveKnowledgePda,
                }, {
                    proofAnchorId: validatedProofSnapshot?.sourceAnchorId || undefined,
                    expectedProofPackageHash: validatedProofSnapshot?.proofPackageHash || undefined,
                    expectedContributorsRoot: validatedProofSnapshot?.contributorsRoot || undefined,
                    expectedContributorsCount: validatedProofSnapshot?.contributorsCount || undefined,
                });
                contributionSnapshot = {
                    synced: true,
                    contributorsCount: synced.contributorsCount,
                    contributorsRoot: synced.contributorsRoot,
                };
            } catch (error) {
                const mapped = mapContributionSyncError(error);
                if (!isBusinessStatusCode(mapped.statusCode)) {
                    throw error;
                }
                const normalized = resolveContributionSyncViolation(mapped);
                const decision = evaluateDraftStrictBindingViolation({
                    mode: draftStrictBindingMode,
                    code: normalized.code,
                    message: normalized.message,
                    enforceStatusCode: normalized.statusCode,
                    details: normalized.details,
                });
                if (decision.blocked) {
                    return res.status(decision.statusCode || normalized.statusCode).json({
                        error: decision.error?.code || normalized.code,
                        message: decision.error?.message || normalized.message,
                        mode: draftStrictBindingMode,
                        details: decision.error?.details || null,
                    });
                }
                const warning = emitDraftStrictWarning({
                    endpoint: 'POST /drafts/:postId/crystallization-binding',
                    draftPostId: postId,
                    code: decision.warning?.code || normalized.code,
                    message: decision.warning?.message || normalized.message,
                    details: normalized.details,
                });
                contributionSnapshot = {
                    synced: false,
                    code: decision.warning?.code || normalized.code,
                    message: decision.warning?.message || normalized.message,
                };
                (contributionSnapshot as any).warning = warning;
            }

            try {
                const persisted = await persistCurrentDraftProofPackageIssuance(postId);
                proofPackageIssuance = {
                    persisted: true,
                    proofPackageHash: persisted.proofPackageHash,
                    sourceAnchorId: persisted.sourceAnchorId,
                    contributorsRoot: persisted.contributorsRoot,
                    contributorsCount: persisted.contributorsCount,
                    bindingVersion: persisted.bindingVersion,
                    generatedAt: persisted.generatedAt,
                    issuerKeyId: persisted.issuerKeyId,
                    issuedSignature: persisted.issuedSignature,
                    issuedAt: persisted.issuedAt,
                };
                const persistedAttempt = await upsertCrystallizationAttempt(prisma as any, {
                    draftPostId: postId,
                    proofPackageHash: persisted.proofPackageHash,
                    knowledgeId: binding.knowledgeId,
                    knowledgeOnChainAddress: effectiveKnowledgePda,
                });
                currentCrystallizationAttemptStatus = persistedAttempt.status;
                await markBindingAttemptSynced({
                    proofPackageHash: persisted.proofPackageHash,
                    knowledgeId: binding.knowledgeId,
                });
                await materializeReferencesBeforeFinalization({
                    proofPackageHash: persisted.proofPackageHash,
                    knowledgeId: binding.knowledgeId,
                    attemptStatus: currentCrystallizationAttemptStatus,
                });
                await syncCrystalAssetsForKnowledge(binding.knowledgeId);
                await finalizeLifecycleAndAttempt({
                    proofPackageHash: persisted.proofPackageHash,
                });
            } catch (error) {
                if (error instanceof DraftReferenceMaterializationError) {
                    throw error;
                }
                if (error instanceof CrystallizationBindingError) {
                    throw error;
                }
                const mapped = mapProofPackageIssuanceError(error);
                if (!isBusinessStatusCode(mapped.statusCode)) {
                    throw error;
                }
                const decision = evaluateDraftStrictBindingViolation({
                    mode: draftStrictBindingMode,
                    code: mapped.code,
                    message: mapped.message,
                    enforceStatusCode: mapped.statusCode,
                });
                if (decision.blocked) {
                    return res.status(decision.statusCode || mapped.statusCode).json({
                        error: decision.error?.code || mapped.code,
                        message: decision.error?.message || mapped.message,
                        mode: draftStrictBindingMode,
                        details: decision.error?.details || null,
                    });
                }
                const warning = emitDraftStrictWarning({
                    endpoint: 'POST /drafts/:postId/crystallization-binding',
                    draftPostId: postId,
                    code: decision.warning?.code || mapped.code,
                    message: decision.warning?.message || mapped.message,
                });
                proofPackageIssuance = {
                    persisted: false,
                    code: decision.warning?.code || mapped.code,
                    message: decision.warning?.message || mapped.message,
                    warning,
                };
            }

            return res.json({
                ok: true,
                draftPostId: postId,
                knowledgePda: effectiveKnowledgePda,
                policyProfileDigest,
                mode: draftStrictBindingMode,
                contributionSnapshot,
                proofPackageIssuance,
                ...binding,
            });
        } catch (error) {
            if (error instanceof CrystallizationBindingError) {
                return res.status(error.statusCode).json({
                    error: error.code,
                    message: error.message,
                });
            }
            if (error instanceof DraftReferenceMaterializationError) {
                const statusCode = error.code === 'reference_materialization_failed' ? 503 : 409;
                return res.status(statusCode).json({
                    error: error.code,
                    message: error.message,
                    details: error.details || null,
                });
            }
            next(error);
        }
    });

    router.post('/drafts/:postId/discussions', async (req, res, next) => {
        try {
            const postId = parsePositiveInt(req.params.postId, NaN);
            if (!Number.isFinite(postId)) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }
            const access = await ensureDraftDiscussionMutationAccess(req, res, postId, 'create');
            if (!access) return;
            const lifecycle = await resolveDraftLifecycleReadModel(prisma, {
                draftPostId: postId,
            });

            const thread = await createDraftDiscussionThread(prisma, {
                draftPostId: postId,
                actorUserId: access.authUserId,
                targetType: req.body?.targetType,
                targetRef: req.body?.targetRef,
                targetVersion: lifecycle.currentSnapshotVersion,
                issueType: req.body?.issueType,
                content: req.body?.content,
            });

            return res.status(201).json({
                ok: true,
                draftPostId: postId,
                thread,
            });
        } catch (error) {
            if (error instanceof DraftDiscussionLifecycleError) {
                return res.status(error.statusCode).json({
                    error: error.code,
                    message: error.message,
                });
            }
            next(error);
        }
    });

    router.post('/drafts/:postId/discussions/:threadId/messages', async (req, res, next) => {
        try {
            const postId = parsePositiveInt(req.params.postId, NaN);
            if (!Number.isFinite(postId)) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }
            const threadId = parsePositiveInt(req.params.threadId, NaN);
            if (!Number.isFinite(threadId)) {
                return res.status(400).json({ error: 'invalid_thread_id' });
            }
            const access = await ensureDraftDiscussionMutationAccess(req, res, postId, 'reply');
            if (!access) return;

            const thread = await appendDraftDiscussionMessage(prisma, {
                draftPostId: postId,
                threadId,
                actorUserId: access.authUserId,
                content: req.body?.content,
            });

            return res.json({
                ok: true,
                draftPostId: postId,
                thread,
            });
        } catch (error) {
            if (error instanceof DraftDiscussionLifecycleError) {
                return res.status(error.statusCode).json({
                    error: error.code,
                    message: error.message,
                });
            }
            next(error);
        }
    });

    router.post('/drafts/:postId/discussions/:threadId/withdraw', async (req, res, next) => {
        try {
            const postId = parsePositiveInt(req.params.postId, NaN);
            if (!Number.isFinite(postId)) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }
            const threadId = parsePositiveInt(req.params.threadId, NaN);
            if (!Number.isFinite(threadId)) {
                return res.status(400).json({ error: 'invalid_thread_id' });
            }
            const access = await ensureDraftDiscussionMutationAccess(req, res, postId, 'withdraw');
            if (!access) return;
            const currentThread = await getDraftDiscussionThread(prisma, {
                draftPostId: postId,
                threadId,
            });
            const permission = await resolveDraftWorkflowPermission(prisma, {
                circleId: access.circleId,
                userId: access.authUserId,
                action: 'withdraw_own_issue',
                isThreadAuthor: currentThread.createdBy === access.authUserId,
            });
            if (!permission.allowed) {
                return res.status(403).json({
                    error: 'draft_discussion_withdraw_permission_denied',
                    message: localizeDraftWorkflowPermissionDecision(permission, resolveExpressRequestLocale(req)),
                });
            }

            const thread = await withdrawDraftDiscussionThread(prisma, {
                draftPostId: postId,
                threadId,
                actorUserId: access.authUserId,
                reason: req.body?.reason,
            });

            return res.json({
                ok: true,
                draftPostId: postId,
                thread,
            });
        } catch (error) {
            if (error instanceof DraftDiscussionLifecycleError) {
                return res.status(error.statusCode).json({
                    error: error.code,
                    message: error.message,
                });
            }
            next(error);
        }
    });

    router.post('/drafts/:postId/discussions/:threadId/propose', async (req, res, next) => {
        try {
            const postId = parsePositiveInt(req.params.postId, NaN);
            if (!Number.isFinite(postId)) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }
            const threadId = parsePositiveInt(req.params.threadId, NaN);
            if (!Number.isFinite(threadId)) {
                return res.status(400).json({ error: 'invalid_thread_id' });
            }
            const access = await ensureDraftDiscussionMutationAccess(req, res, postId, 'propose');
            if (!access) return;
            const currentThread = await getDraftDiscussionThread(prisma, {
                draftPostId: postId,
                threadId,
            });
            const nextIssueType = typeof req.body?.issueType === 'string'
                ? String(req.body.issueType).trim()
                : '';
            if (nextIssueType && nextIssueType !== currentThread.issueType) {
                const permission = await resolveDraftWorkflowPermission(prisma, {
                    circleId: access.circleId,
                    userId: access.authUserId,
                    action: 'retag_issue',
                });
                if (!permission.allowed) {
                    return res.status(403).json({
                        error: 'draft_discussion_retag_permission_denied',
                        message: localizeDraftWorkflowPermissionDecision(permission, resolveExpressRequestLocale(req)),
                    });
                }
            }

            const thread = await proposeDraftDiscussionThread(prisma, {
                draftPostId: postId,
                threadId,
                actorUserId: access.authUserId,
                issueType: req.body?.issueType,
                content: req.body?.content,
            });

            return res.json({
                ok: true,
                draftPostId: postId,
                thread,
            });
        } catch (error) {
            if (error instanceof DraftDiscussionLifecycleError) {
                return res.status(error.statusCode).json({
                    error: error.code,
                    message: error.message,
                });
            }
            next(error);
        }
    });

    router.post('/drafts/:postId/discussions/:threadId/resolve', async (req, res, next) => {
        try {
            const postId = parsePositiveInt(req.params.postId, NaN);
            if (!Number.isFinite(postId)) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }
            const threadId = parsePositiveInt(req.params.threadId, NaN);
            if (!Number.isFinite(threadId)) {
                return res.status(400).json({ error: 'invalid_thread_id' });
            }
            const access = await ensureDraftDiscussionMutationAccess(req, res, postId, 'resolve');
            if (!access) return;
            const currentThread = await getDraftDiscussionThread(prisma, {
                draftPostId: postId,
                threadId,
            });
            const nextIssueType = typeof req.body?.issueType === 'string'
                ? String(req.body.issueType).trim()
                : '';
            if (nextIssueType && nextIssueType !== currentThread.issueType) {
                const permission = await resolveDraftWorkflowPermission(prisma, {
                    circleId: access.circleId,
                    userId: access.authUserId,
                    action: 'retag_issue',
                });
                if (!permission.allowed) {
                    return res.status(403).json({
                        error: 'draft_discussion_retag_permission_denied',
                        message: localizeDraftWorkflowPermissionDecision(permission, resolveExpressRequestLocale(req)),
                    });
                }
            }

            const thread = await resolveDraftDiscussionThread(prisma, {
                draftPostId: postId,
                threadId,
                actorUserId: access.authUserId,
                resolution: req.body?.resolution,
                issueType: req.body?.issueType,
                reason: req.body?.reason,
            });

            return res.json({
                ok: true,
                draftPostId: postId,
                thread,
            });
        } catch (error) {
            if (error instanceof DraftDiscussionLifecycleError) {
                return res.status(error.statusCode).json({
                    error: error.code,
                    message: error.message,
                });
            }
            next(error);
        }
    });

    router.post('/drafts/:postId/discussions/:threadId/apply', async (req, res, next) => {
        try {
            const postId = parsePositiveInt(req.params.postId, NaN);
            if (!Number.isFinite(postId)) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }
            const threadId = parsePositiveInt(req.params.threadId, NaN);
            if (!Number.isFinite(threadId)) {
                return res.status(400).json({ error: 'invalid_thread_id' });
            }
            const access = await ensureDraftDiscussionMutationAccess(req, res, postId, 'apply');
            if (!access) return;
            const evidence = await resolveDraftDiscussionApplyEvidence({
                draftPostId: postId,
                body: req.body,
            });

            const thread = await applyDraftDiscussionThread(prisma, {
                draftPostId: postId,
                threadId,
                actorUserId: access.authUserId,
                appliedEditAnchorId: evidence.appliedEditAnchorId,
                appliedSnapshotHash: evidence.appliedSnapshotHash,
                appliedDraftVersion: evidence.appliedDraftVersion,
                reason: req.body?.reason,
            });

            return res.json({
                ok: true,
                draftPostId: postId,
                thread,
            });
        } catch (error) {
            if (error instanceof DraftDiscussionLifecycleError) {
                return res.status(error.statusCode).json({
                    error: error.code,
                    message: error.message,
                });
            }
            next(error);
        }
    });

    router.get('/drafts/:postId/discussions', async (req, res, next) => {
        try {
            const postId = parsePositiveInt(req.params.postId, NaN);
            if (!Number.isFinite(postId)) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }
            const access = await ensureDraftAccessFromRequest(req, res, postId, 'read');
            if (!access) return;

            const limit = Math.min(parsePositiveInt(req.query.limit as string, 20), 100);
            const threads = await listDraftDiscussionThreads(prisma, {
                draftPostId: postId,
                limit,
            });

            return res.json({
                ok: true,
                draftPostId: postId,
                viewerUserId: parseAuthUserIdFromRequest(req),
                count: threads.length,
                threads,
            });
        } catch (error) {
            if (error instanceof DraftDiscussionLifecycleError) {
                return res.status(error.statusCode).json({
                    error: error.code,
                    message: error.message,
                });
            }
            next(error);
        }
    });

    router.post('/drafts/:postId/content', async (req, res, next) => {
        try {
            const postId = parsePositiveInt(req.params.postId, NaN);
            if (!Number.isFinite(postId)) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }

            const text = String(req.body?.text || '').trim();
            if (!text) {
                return res.status(400).json({ error: 'empty_text' });
            }
            if (text.length > 20000) {
                return res.status(400).json({ error: 'text_too_long', maxLength: 20000 });
            }
            const access = await ensureDraftAccessFromRequest(req, res, postId, 'edit');
            if (!access) return;

            const updated = await updateDraftContentAndHeat(prisma, {
                postId,
                text,
            });

            return res.json({
                ok: true,
                draftPostId: updated.id,
                status: updated.status,
                updatedAt: updated.updatedAt.toISOString(),
                heatScore: Number(updated.heatScore ?? 0),
                changed: updated.changed,
            });
        } catch (error) {
            next(error);
        }
    });

    router.post('/drafts/:postId/ghost-drafts/:generationId/accept', async (req, res, next) => {
        try {
            const postId = parsePositiveInt(req.params.postId, NaN);
            const generationId = parsePositiveInt(req.params.generationId, NaN);
            if (!Number.isFinite(postId)) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }
            if (!Number.isFinite(generationId)) {
                return res.status(400).json({ error: 'invalid_generation_id' });
            }

            const mode = normalizeGhostDraftAcceptanceMode(req.body?.mode);
            if (!mode) {
                return res.status(400).json({ error: 'invalid_mode' });
            }

            const userId = parseAuthUserIdFromRequest(req);
            const result = await acceptGhostDraftIntoWorkingCopy(prisma as any, {
                draftPostId: postId,
                generationId,
                userId,
                mode,
                locale: resolveExpressRequestLocale(req),
                workingCopyHash: typeof req.body?.workingCopyHash === 'string'
                    ? req.body.workingCopyHash
                    : null,
                workingCopyUpdatedAt: typeof req.body?.workingCopyUpdatedAt === 'string'
                    ? req.body.workingCopyUpdatedAt
                    : null,
            });

            return res.json({
                ok: true,
                result,
            });
        } catch (error) {
            next(error);
        }
    });

    router.post('/circles/:circleId/candidates/:candidateId/create-draft', async (req, res, next) => {
        try {
            const circleId = parsePositiveInt(req.params.circleId, NaN);
            const candidateId = String(req.params.candidateId || '').trim();
            if (!Number.isFinite(circleId)) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            if (!candidateId) {
                return res.status(400).json({ error: 'invalid_candidate_id' });
            }

            const result = await acceptDraftCandidateIntoDraft(prisma as any, {
                circleId,
                candidateId,
                userId: parseAuthUserIdFromRequest(req),
            });

            return res.json({
                ok: true,
                result,
            });
        } catch (error) {
            if (error instanceof DraftCandidateAcceptanceError) {
                return res.status(error.statusCode).json({
                    error: error.code,
                    message: error.message,
                });
            }
            next(error);
        }
    });

    router.post('/circles/:circleId/drafts/from-messages', async (req, res, next) => {
        try {
            const circleId = parsePositiveInt(req.params.circleId, NaN);
            if (!Number.isFinite(circleId)) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            const body = req.body ?? {};
            const sourceMessageIds = Array.isArray(body.sourceMessageIds)
                ? body.sourceMessageIds
                    .map((value: unknown) => String(value || '').trim())
                    .filter((value: string) => value.length > 0)
                : [];
            if (sourceMessageIds.length === 0) {
                return res.status(400).json({
                    error: 'invalid_source_message_ids',
                    message: 'sourceMessageIds must contain at least one discussion message id',
                });
            }

            const result = await createDraftFromManualDiscussionSelection(prisma as any, {
                circleId,
                sourceMessageIds,
                userId: parseAuthUserIdFromRequest(req),
            });

            return res.json({
                ok: true,
                result,
            });
        } catch (error) {
            if (error instanceof DraftCandidateAcceptanceError) {
                return res.status(error.statusCode).json({
                    error: error.code,
                    message: error.message,
                });
            }
            next(error);
        }
    });

    router.get('/drafts/:postId/content', async (req, res, next) => {
        try {
            const postId = parsePositiveInt(req.params.postId, NaN);
            if (!Number.isFinite(postId)) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }
            const access = await ensureDraftAccessFromRequest(req, res, postId, 'read');
            if (!access) return;

            const post = await prisma.post.findUnique({
                where: { id: postId },
                select: { id: true, status: true, text: true, heatScore: true, updatedAt: true },
            });
            if (!post) {
                return res.status(404).json({ error: 'draft_not_found' });
            }
            if (String(post.status) !== 'Draft') {
                return res.status(409).json({ error: 'not_draft_status' });
            }

            return res.json({
                ok: true,
                draftPostId: post.id,
                status: post.status,
                text: post.text || '',
                heatScore: Number(post.heatScore ?? 0),
                updatedAt: post.updatedAt.toISOString(),
            });
        } catch (error) {
            next(error);
        }
    });

    router.post('/circles/:id/messages', async (req, res, next) => {
        try {
            const circleId = parsePositiveInt(req.params.id, NaN);
            if (!Number.isFinite(circleId)) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }

            const senderPubkey = String(req.body?.senderPubkey || '').trim();
            const senderHandleRaw = String(req.body?.senderHandle || '').trim();
            const textRaw = String(req.body?.text || '');
            const text = normalizeDiscussionText(textRaw);

            if (!senderPubkey) return res.status(400).json({ error: 'missing_sender_pubkey' });
            if (!text) return res.status(400).json({ error: 'empty_message' });
            if (text.length > maxTextLength) {
                return res.status(400).json({
                    error: 'message_too_long',
                    maxLength: maxTextLength,
                });
            }
            const structuredMetadata = prepareStructuredDiscussionWriteMetadata(req.body?.metadata);

            const sender = await prisma.user.findUnique({
                where: { pubkey: senderPubkey },
                select: { id: true, handle: true },
            });
            const membership = sender
                ? await prisma.circleMember.findUnique({
                    where: {
                        circleId_userId: {
                            circleId,
                            userId: sender.id,
                        },
                    },
                    select: {
                        status: true,
                    },
                })
                : null;
            if (membership?.status === 'Banned') {
                return res.status(403).json({
                    error: 'discussion_membership_banned',
                    message: 'banned members cannot post discussion messages',
                });
            }
            const isActiveMember = membership?.status === 'Active';
            const isVisitorDust = !isActiveMember;

            const sessionAuth = await authenticateSessionFromRequest({
                authorizationHeader: req.headers.authorization,
                circleId,
                expectedSenderPubkey: senderPubkey,
            });
            if (!sessionAuth.ok) {
                return res.status(sessionAuth.status).json({
                    error: sessionAuth.error,
                    message: sessionAuth.message,
                });
            }
            if (
                discussionAuthMode === 'session_token'
                && requireSessionToken
                && !sessionAuth.session
            ) {
                return res.status(401).json({
                    error: 'discussion_session_required',
                    message: 'discussion session token is required in session_token mode',
                });
            }

            const clientTimestamp = req.body?.clientTimestamp
                ? new Date(String(req.body.clientTimestamp))
                : new Date();
            if (Number.isNaN(clientTimestamp.getTime())) {
                return res.status(400).json({ error: 'invalid_client_timestamp' });
            }
            const clientTimestampIso = clientTimestamp.toISOString();
            const persistedKnowledgeMessageAt = sqlTimestampWithoutTimeZone(clientTimestamp);
            const nonce = String(req.body?.nonce || randomNonce());
            const prevEnvelopeId = req.body?.prevEnvelopeId ? String(req.body.prevEnvelopeId) : null;
            const signature = req.body?.signature ? String(req.body.signature) : null;
            const roomKey = buildDiscussionRoomKey(circleId);

            const signingPayload = buildDiscussionSigningPayload({
                roomKey,
                circleId,
                senderPubkey,
                text,
                clientTimestamp: clientTimestampIso,
                nonce,
                prevEnvelopeId,
            });
            const canonicalSignedMessage = buildDiscussionSigningMessage(signingPayload);
            const signedMessage = req.body?.signedMessage ? String(req.body.signedMessage) : canonicalSignedMessage;

            if (signedMessage !== canonicalSignedMessage) {
                return res.status(400).json({
                    error: 'signed_message_mismatch',
                    message: 'signedMessage does not match canonical discussion payload',
                });
            }

            const signatureVerified = verifyEd25519SignatureBase64({
                senderPubkey,
                message: signedMessage,
                signatureBase64: signature,
            });
            const authenticatedBySession = !!sessionAuth.session;
            if (!authenticatedBySession && requireSignatures && !signatureVerified) {
                return res.status(401).json({
                    error: 'signature_required',
                    message: 'valid ed25519 signature is required for discussion messages',
                });
            }

            const authMode =
                sessionAuth.session
                    ? 'session_token'
                    : signatureVerified
                        ? 'wallet_per_message'
                        : 'unsigned_local';
            const sessionId = sessionAuth.session?.sessionId || null;

            const payloadHash = sha256Hex(text);
            const envelopeId = computeDiscussionEnvelopeId({
                roomKey,
                senderPubkey,
                payloadHash,
                clientTimestamp: clientTimestampIso,
                nonce,
                prevEnvelopeId,
                signatureBase64: signature,
            });
            const expiresAt = isVisitorDust
                ? new Date(Date.now() + visitorDustTtlSec * 1000)
                : null;
            const persistedMessageAt = sqlTimestampWithoutTimeZone(clientTimestamp);

            const senderHandle = senderHandleRaw || sender?.handle || null;
            const authorAnnotations = extractStructuredDiscussionMetadata(structuredMetadata).authorAnnotations
                .map((kind) => ({ kind, source: 'author' as const }));
            const pendingAnalysis = buildPendingDiscussionAnalysisInsertValues({
                authorAnnotations,
            });

            const inserted = await prisma.$transaction(async (tx) => {
                const rows = await tx.$queryRaw<DiscussionRow[]>`
                    INSERT INTO circle_discussion_messages (
                        envelope_id,
                        stream_key,
                        room_key,
                        circle_id,
                        sender_pubkey,
                        sender_handle,
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
                        relevance_status,
                        relevance_score,
                        semantic_score,
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
                        created_at,
                        updated_at
                    )
                    VALUES (
                        ${envelopeId},
                        ${DISCUSSION_STREAM_KEY},
                        ${roomKey},
                        ${circleId},
                        ${senderPubkey},
                        ${senderHandle},
                        ${structuredMetadata ? JSON.stringify(structuredMetadata) : null}::jsonb,
                        ${text},
                        ${payloadHash},
                        ${nonce},
                        ${signature},
                        'ed25519',
                        ${signedMessage},
                        ${signatureVerified},
                        ${authMode},
                        ${sessionId},
                        ${pendingAnalysis.relevanceStatus},
                        ${pendingAnalysis.relevanceScore},
                        ${pendingAnalysis.semanticScore},
                        ${pendingAnalysis.embeddingScore},
                        ${pendingAnalysis.qualityScore},
                        ${pendingAnalysis.spamScore},
                        ${pendingAnalysis.decisionConfidence},
                        ${pendingAnalysis.relevanceMethod},
                        ${pendingAnalysis.actualMode},
                        ${pendingAnalysis.analysisVersion},
                        ${pendingAnalysis.topicProfileVersion},
                        ${pendingAnalysis.semanticFacetsJson}::jsonb,
                        ${pendingAnalysis.focusScore},
                        ${pendingAnalysis.focusLabel},
                        ${pendingAnalysis.isFeatured},
                        ${pendingAnalysis.featureReason},
                        ${null},
                        ${pendingAnalysis.analysisCompletedAt},
                        ${pendingAnalysis.analysisErrorCode},
                        ${pendingAnalysis.analysisErrorMessage},
                        ${pendingAnalysis.authorAnnotationsJson}::jsonb,
                        ${isVisitorDust},
                        ${sqlTimestampWithoutTimeZone(expiresAt)},
                        ${persistedMessageAt},
                        ${prevEnvelopeId},
                        ${persistedMessageAt},
                        ${persistedMessageAt}
                    )
                    ON CONFLICT (envelope_id) DO UPDATE SET
                        updated_at = ${sqlTimestampWithoutTimeZone(new Date())}
                    RETURNING
                        envelope_id AS "envelopeId",
                        room_key AS "roomKey",
                        circle_id AS "circleId",
                        sender_pubkey AS "senderPubkey",
                        sender_handle AS "senderHandle",
                        message_kind AS "messageKind",
                        subject_type AS "subjectType",
                        subject_id AS "subjectId",
                        metadata AS "metadata",
                        payload_text AS "payloadText",
                        payload_hash AS "payloadHash",
                        nonce AS "nonce",
                        signature AS "signature",
                        signature_verified AS "signatureVerified",
                        auth_mode AS "authMode",
                        session_id AS "sessionId",
                        relevance_score AS "relevanceScore",
                        semantic_score AS "semanticScore",
                        relevance_status AS "relevanceStatus",
                        embedding_score AS "embeddingScore",
                        quality_score AS "qualityScore",
                        spam_score AS "spamScore",
                        decision_confidence AS "decisionConfidence",
                        relevance_method AS "relevanceMethod",
                        actual_mode AS "actualMode",
                        analysis_version AS "analysisVersion",
                        topic_profile_version AS "topicProfileVersion",
                        semantic_facets AS "semanticFacets",
                        focus_score AS "focusScore",
                        focus_label AS "focusLabel",
                        is_featured AS "isFeatured",
                        COALESCE((
                            SELECT COUNT(*)::INT
                            FROM discussion_message_highlights dh
                            WHERE dh.envelope_id = circle_discussion_messages.envelope_id
                        ), 0) AS "highlightCount",
                        feature_reason AS "featureReason",
                        featured_at AS "featuredAt",
                        analysis_completed_at AS "analysisCompletedAt",
                        analysis_error_code AS "analysisErrorCode",
                        analysis_error_message AS "analysisErrorMessage",
                        author_annotations AS "authorAnnotations",
                        is_ephemeral AS "isEphemeral",
                        expires_at AS "expiresAt",
                        client_timestamp AS "clientTimestamp",
                        lamport AS "lamport",
                        prev_envelope_id AS "prevEnvelopeId",
                        deleted AS "deleted",
                        tombstone_reason AS "tombstoneReason",
                        tombstoned_at AS "tombstonedAt",
                        NULL::BOOLEAN AS "sourceMessageDeleted",
                        created_at AS "createdAt",
                        updated_at AS "updatedAt"
                `;

                const row = rows[0];
                if (!row) {
                    throw new Error('failed_to_insert_discussion_message');
                }

                await updateOffchainWatermark(tx, {
                    lamport: row.lamport,
                    envelopeId: row.envelopeId,
                });

                return row;
            });

            try {
                await enqueueDiscussionMessageAnalyzeJob(prisma, {
                    envelopeId: inserted.envelopeId,
                    circleId,
                    requestedByUserId: sender?.id ?? null,
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.warn(`discussion analysis enqueue failed for circle ${circleId}: ${message}`);
            }

            await emitDiscussionRealtimeEvent({
                circleId,
                latestLamport: Number(inserted.lamport),
                envelopeId: inserted.envelopeId,
                reason: 'message_created',
            });

            res.status(201).json({
                ok: true,
                message: mapRowToDto(inserted),
            });
        } catch (error) {
            next(error);
        }
    });

    router.post('/messages/:envelopeId/forward', async (req, res, next) => {
        try {
            const authUserId = parseAuthUserIdFromRequest(req);
            if (!authUserId) {
                return res.status(401).json({ error: 'authentication_required' });
            }

            const sourceEnvelopeId = String(req.params.envelopeId || '').trim();
            if (!sourceEnvelopeId) {
                return res.status(400).json({ error: 'missing_envelope_id' });
            }

            const targetCircleId = parsePositiveInt(String(req.body?.targetCircleId || ''), NaN);
            if (!Number.isFinite(targetCircleId)) {
                return res.status(400).json({ error: 'invalid_target_circle_id' });
            }

            const sourceRows = await prisma.$queryRaw<DiscussionRow[]>(Prisma.sql`
                SELECT
                    ${discussionSelectColumns}
                FROM circle_discussion_messages m
                ${discussionForwardSourceJoin}
                ${discussionHighlightCountJoin}
                WHERE m.envelope_id = ${sourceEnvelopeId}
                LIMIT 1
            `);
            const sourceRow = sourceRows[0];
            if (!sourceRow) {
                return res.status(404).json({ error: 'discussion_message_not_found' });
            }

            const [authUser, sourceCircle, targetCircle, sourceMembership, targetMembership] = await Promise.all([
                prisma.user.findUnique({
                    where: { id: authUserId },
                    select: { id: true, pubkey: true, handle: true },
                }),
                loadCircleForwardingNode(sourceRow.circleId),
                loadCircleForwardingNode(targetCircleId),
                hasActiveCircleMembership(prisma, {
                    circleId: sourceRow.circleId,
                    userId: authUserId,
                }),
                hasActiveCircleMembership(prisma, {
                    circleId: targetCircleId,
                    userId: authUserId,
                }),
            ]);
            const sourceAuthorUser = await prisma.user.findUnique({
                where: { pubkey: sourceRow.senderPubkey },
                select: { id: true, pubkey: true, handle: true },
            });

            if (!authUser) {
                return res.status(401).json({ error: 'auth_user_not_found' });
            }
            if (!sourceCircle) {
                return res.status(404).json({ error: 'source_circle_not_found' });
            }
            if (!targetCircle) {
                return res.status(404).json({ error: 'target_circle_not_found' });
            }
            if (!sourceMembership) {
                return res.status(403).json({
                    error: 'source_circle_membership_required',
                    message: 'only active members of the source circle can forward messages',
                });
            }
            if (!targetMembership) {
                return res.status(403).json({
                    error: 'target_circle_membership_required',
                    message: 'only active members of the target circle can forward messages into it',
                });
            }

            const forwardDecision = canForwardDiscussionMessage({
                sourceCircle,
                targetCircle,
                sourceMessageKind: sourceRow.messageKind,
                sourceIsEphemeral: sourceRow.isEphemeral,
            });
            if (!forwardDecision.allowed) {
                if (forwardDecision.reason === 'ephemeral_not_forwardable') {
                    return res.status(409).json({ error: 'forward_ephemeral_not_allowed' });
                }
                if (forwardDecision.reason === 'forward_of_forward_not_allowed') {
                    return res.status(409).json({ error: 'forward_of_forward_not_allowed' });
                }
                if (forwardDecision.reason === 'different_tree') {
                    return res.status(403).json({ error: 'forward_cross_tree_not_allowed' });
                }
                return res.status(403).json({ error: 'forward_same_or_lower_level_not_allowed' });
            }

            const locale = resolveExpressRequestLocale(req);
            const snapshotText = buildForwardSnapshotText(sourceRow.payloadText, locale);
            const forwardedAt = new Date();
            const metadata = {
                sourceEnvelopeId: sourceRow.envelopeId,
                sourceCircleId: sourceCircle.id,
                sourceCircleName: sourceCircle.name,
                sourceLevel: sourceCircle.level,
                sourceAuthorHandle: sourceRow.senderHandle,
                forwarderHandle: authUser.handle,
                sourceMessageCreatedAt: sourceRow.createdAt.toISOString(),
                forwardedAt: forwardedAt.toISOString(),
                sourceDeleted: sourceRow.deleted,
                snapshotText,
            };
            const nonce = randomNonce();
            const roomKey = buildDiscussionRoomKey(targetCircle.id);
            const clientTimestamp = forwardedAt.toISOString();
            const persistedForwardedAt = sqlTimestampWithoutTimeZone(forwardedAt);
            const payloadHash = sha256Hex(snapshotText);
            const envelopeId = computeDiscussionEnvelopeId({
                roomKey,
                senderPubkey: authUser.pubkey,
                payloadHash,
                clientTimestamp,
                nonce,
                prevEnvelopeId: null,
                signatureBase64: null,
                subjectType: 'discussion_message',
                subjectId: sourceRow.envelopeId,
            });

            const inserted = await prisma.$transaction(async (tx) => {
                const rows = await tx.$queryRaw<DiscussionRow[]>(Prisma.sql`
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
                        quality_score,
                        spam_score,
                        decision_confidence,
                        relevance_method,
                        is_featured,
                        feature_reason,
                        featured_at,
                        client_timestamp,
                        prev_envelope_id,
                        created_at,
                        updated_at
                    )
                    VALUES (
                        ${envelopeId},
                        ${DISCUSSION_STREAM_KEY},
                        ${roomKey},
                        ${targetCircle.id},
                        ${authUser.pubkey},
                        ${authUser.handle},
                        'forward',
                        'discussion_message',
                        ${sourceRow.envelopeId},
                        ${JSON.stringify(metadata)}::jsonb,
                        ${snapshotText},
                        ${payloadHash},
                        ${nonce},
                        NULL,
                        'ed25519',
                        ${`alcheme-discussion-forward:${JSON.stringify({ sourceEnvelopeId: sourceRow.envelopeId, targetCircleId: targetCircle.id, nonce })}`},
                        TRUE,
                        'session_token',
                        NULL,
                        1,
                        1,
                        0.5,
                        0,
                        0.5,
                        'rule',
                        FALSE,
                        NULL,
                        NULL,
                        ${persistedForwardedAt},
                        NULL,
                        ${persistedForwardedAt},
                        ${persistedForwardedAt}
                    )
                    ON CONFLICT (envelope_id) DO UPDATE SET
                        updated_at = ${sqlTimestampWithoutTimeZone(new Date())}
                    RETURNING
                        envelope_id AS "envelopeId",
                        room_key AS "roomKey",
                        circle_id AS "circleId",
                        sender_pubkey AS "senderPubkey",
                        sender_handle AS "senderHandle",
                        message_kind AS "messageKind",
                        subject_type AS "subjectType",
                        subject_id AS "subjectId",
                        metadata AS "metadata",
                        payload_text AS "payloadText",
                        payload_hash AS "payloadHash",
                        nonce AS "nonce",
                        signature AS "signature",
                        signature_verified AS "signatureVerified",
                        auth_mode AS "authMode",
                        session_id AS "sessionId",
                        relevance_score AS "relevanceScore",
                        semantic_score AS "semanticScore",
                        quality_score AS "qualityScore",
                        spam_score AS "spamScore",
                        decision_confidence AS "decisionConfidence",
                        relevance_method AS "relevanceMethod",
                        is_featured AS "isFeatured",
                        COALESCE((
                            SELECT COUNT(*)::INT
                            FROM discussion_message_highlights dh
                            WHERE dh.envelope_id = circle_discussion_messages.envelope_id
                        ), 0) AS "highlightCount",
                        feature_reason AS "featureReason",
                        featured_at AS "featuredAt",
                        is_ephemeral AS "isEphemeral",
                        expires_at AS "expiresAt",
                        client_timestamp AS "clientTimestamp",
                        lamport AS "lamport",
                        prev_envelope_id AS "prevEnvelopeId",
                        deleted AS "deleted",
                        tombstone_reason AS "tombstoneReason",
                        tombstoned_at AS "tombstonedAt",
                        NULL::BOOLEAN AS "sourceMessageDeleted",
                        created_at AS "createdAt",
                        updated_at AS "updatedAt"
                `);

                const row = rows[0];
                if (!row) {
                    throw new Error('failed_to_insert_forward_message');
                }

                await updateOffchainWatermark(tx, {
                    lamport: row.lamport,
                    envelopeId: row.envelopeId,
                });

                if (sourceAuthorUser && sourceAuthorUser.id !== authUser.id) {
                    const senderLabel = formatSenderLabel(authUser, locale);
                    await tx.notification.create({
                        data: {
                            userId: sourceAuthorUser.id,
                            type: 'forward',
                            title: 'discussion.forwarded',
                            body: null,
                            metadata: {
                                messageKey: 'discussion.forwarded',
                                params: {
                                    senderLabel,
                                    targetCircleName: targetCircle.name,
                                },
                            },
                            sourceType: 'discussion',
                            sourceId: row.envelopeId,
                            circleId: targetCircle.id,
                            read: false,
                        },
                    });
                }

                return row;
            });

            await emitDiscussionRealtimeEvent({
                circleId: targetCircle.id,
                latestLamport: Number(inserted.lamport),
                envelopeId: inserted.envelopeId,
                reason: 'message_forwarded',
            });

            return res.status(201).json({
                ok: true,
                message: mapRowToDto(inserted),
            });
        } catch (error) {
            next(error);
        }
    });

    router.post('/knowledge/:knowledgeId/messages', async (req, res, next) => {
        try {
            const authUserId = parseAuthUserIdFromRequest(req);
            if (!authUserId) {
                return res.status(401).json({ error: 'authentication_required' });
            }

            const knowledge = await loadKnowledgeDiscussionContext(req.params.knowledgeId);
            if (!knowledge) {
                return res.status(404).json({ error: 'knowledge_not_found' });
            }

            const senderPubkey = String(req.body?.senderPubkey || '').trim();
            const senderHandleRaw = String(req.body?.senderHandle || '').trim();
            const textRaw = String(req.body?.text || '');
            const text = normalizeDiscussionText(textRaw);

            if (!senderPubkey) return res.status(400).json({ error: 'missing_sender_pubkey' });
            if (!text) return res.status(400).json({ error: 'empty_message' });
            if (text.length > maxTextLength) {
                return res.status(400).json({
                    error: 'message_too_long',
                    maxLength: maxTextLength,
                });
            }
            const structuredMetadata = prepareStructuredDiscussionWriteMetadata(req.body?.metadata);

            const [authUser, isMember] = await Promise.all([
                prisma.user.findUnique({
                    where: { id: authUserId },
                    select: { id: true, pubkey: true, handle: true },
                }),
                hasActiveCircleMembership(prisma, {
                    circleId: knowledge.circleId,
                    userId: authUserId,
                }),
            ]);

            if (!authUser || authUser.pubkey !== senderPubkey) {
                return res.status(403).json({
                    error: 'discussion_sender_mismatch',
                    message: 'authenticated user must match senderPubkey',
                });
            }
            if (!isMember) {
                return res.status(403).json({
                    error: 'discussion_membership_required',
                    message: 'only active circle members can access crystal discussion',
                });
            }

            const sessionAuth = await authenticateSessionFromRequest({
                authorizationHeader: req.headers.authorization,
                circleId: knowledge.circleId,
                expectedSenderPubkey: senderPubkey,
            });
            if (!sessionAuth.ok) {
                return res.status(sessionAuth.status).json({
                    error: sessionAuth.error,
                    message: sessionAuth.message,
                });
            }
            if (
                discussionAuthMode === 'session_token'
                && requireSessionToken
                && !sessionAuth.session
            ) {
                return res.status(401).json({
                    error: 'discussion_session_required',
                    message: 'discussion session token is required in session_token mode',
                });
            }

            const clientTimestamp = req.body?.clientTimestamp
                ? new Date(String(req.body.clientTimestamp))
                : new Date();
            if (Number.isNaN(clientTimestamp.getTime())) {
                return res.status(400).json({ error: 'invalid_client_timestamp' });
            }
            const clientTimestampIso = clientTimestamp.toISOString();
            const nonce = String(req.body?.nonce || randomNonce());
            const prevEnvelopeId = req.body?.prevEnvelopeId ? String(req.body.prevEnvelopeId) : null;
            const signature = req.body?.signature ? String(req.body.signature) : null;
            const roomKey = buildDiscussionRoomKey(knowledge.circleId);

            const signingPayload = buildDiscussionSigningPayload({
                roomKey,
                circleId: knowledge.circleId,
                senderPubkey,
                text,
                clientTimestamp: clientTimestampIso,
                nonce,
                prevEnvelopeId,
                subjectType: 'knowledge',
                subjectId: knowledge.knowledgeId,
            });
            const canonicalSignedMessage = buildDiscussionSigningMessage(signingPayload);
            const signedMessage = req.body?.signedMessage ? String(req.body.signedMessage) : canonicalSignedMessage;

            if (signedMessage !== canonicalSignedMessage) {
                return res.status(400).json({
                    error: 'signed_message_mismatch',
                    message: 'signedMessage does not match canonical discussion payload',
                });
            }

            const signatureVerified = verifyEd25519SignatureBase64({
                senderPubkey,
                message: signedMessage,
                signatureBase64: signature,
            });
            const authenticatedBySession = !!sessionAuth.session;
            if (!authenticatedBySession && requireSignatures && !signatureVerified) {
                return res.status(401).json({
                    error: 'signature_required',
                    message: 'valid ed25519 signature is required for discussion messages',
                });
            }

            const authMode =
                sessionAuth.session
                    ? 'session_token'
                    : signatureVerified
                        ? 'wallet_per_message'
                        : 'unsigned_local';
            const sessionId = sessionAuth.session?.sessionId || null;

            const payloadHash = sha256Hex(text);
            const envelopeId = computeDiscussionEnvelopeId({
                roomKey,
                senderPubkey,
                payloadHash,
                clientTimestamp: clientTimestampIso,
                nonce,
                prevEnvelopeId,
                signatureBase64: signature,
                subjectType: 'knowledge',
                subjectId: knowledge.knowledgeId,
            });

            const senderHandle = senderHandleRaw || authUser.handle || null;
            const persistedKnowledgeMessageAt = sqlTimestampWithoutTimeZone(clientTimestamp);

            const inserted = await prisma.$transaction(async (tx) => {
                const rows = await tx.$queryRaw<DiscussionRow[]>`
                    INSERT INTO circle_discussion_messages (
                        envelope_id,
                        stream_key,
                        room_key,
                        circle_id,
                        sender_pubkey,
                        sender_handle,
                        metadata,
                        subject_type,
                        subject_id,
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
                        quality_score,
                        spam_score,
                        decision_confidence,
                        relevance_method,
                        is_featured,
                        feature_reason,
                        featured_at,
                        client_timestamp,
                        prev_envelope_id,
                        created_at,
                        updated_at
                    )
                    VALUES (
                        ${envelopeId},
                        ${DISCUSSION_STREAM_KEY},
                        ${roomKey},
                        ${knowledge.circleId},
                        ${senderPubkey},
                        ${senderHandle},
                        ${structuredMetadata ? JSON.stringify(structuredMetadata) : null}::jsonb,
                        'knowledge',
                        ${knowledge.knowledgeId},
                        ${text},
                        ${payloadHash},
                        ${nonce},
                        ${signature},
                        'ed25519',
                        ${signedMessage},
                        ${signatureVerified},
                        ${authMode},
                        ${sessionId},
                        1,
                        1,
                        0.5,
                        0,
                        0.5,
                        'rule',
                        FALSE,
                        NULL,
                        NULL,
                        ${persistedKnowledgeMessageAt},
                        ${prevEnvelopeId},
                        ${persistedKnowledgeMessageAt},
                        ${persistedKnowledgeMessageAt}
                    )
                    ON CONFLICT (envelope_id) DO UPDATE SET
                        updated_at = ${sqlTimestampWithoutTimeZone(new Date())}
                    RETURNING
                        envelope_id AS "envelopeId",
                        room_key AS "roomKey",
                        circle_id AS "circleId",
                        sender_pubkey AS "senderPubkey",
                        sender_handle AS "senderHandle",
                        message_kind AS "messageKind",
                        subject_type AS "subjectType",
                        subject_id AS "subjectId",
                        metadata AS "metadata",
                        payload_text AS "payloadText",
                        payload_hash AS "payloadHash",
                        nonce AS "nonce",
                        signature AS "signature",
                        signature_verified AS "signatureVerified",
                        auth_mode AS "authMode",
                        session_id AS "sessionId",
                        relevance_score AS "relevanceScore",
                        semantic_score AS "semanticScore",
                        quality_score AS "qualityScore",
                        spam_score AS "spamScore",
                        decision_confidence AS "decisionConfidence",
                        relevance_method AS "relevanceMethod",
                        is_featured AS "isFeatured",
                        COALESCE((
                            SELECT COUNT(*)::INT
                            FROM discussion_message_highlights dh
                            WHERE dh.envelope_id = circle_discussion_messages.envelope_id
                        ), 0) AS "highlightCount",
                        feature_reason AS "featureReason",
                        featured_at AS "featuredAt",
                        is_ephemeral AS "isEphemeral",
                        expires_at AS "expiresAt",
                        client_timestamp AS "clientTimestamp",
                        lamport AS "lamport",
                        prev_envelope_id AS "prevEnvelopeId",
                        deleted AS "deleted",
                        tombstone_reason AS "tombstoneReason",
                        tombstoned_at AS "tombstonedAt",
                        NULL::BOOLEAN AS "sourceMessageDeleted",
                        created_at AS "createdAt",
                        updated_at AS "updatedAt"
                `;

                const row = rows[0];
                if (!row) {
                    throw new Error('failed_to_insert_discussion_message');
                }

                await updateOffchainWatermark(tx, {
                    lamport: row.lamport,
                    envelopeId: row.envelopeId,
                });

                await bumpKnowledgeHeat(tx, {
                    knowledgeId: knowledge.knowledgeId,
                    delta: KNOWLEDGE_HEAT_EVENTS.discussion,
                });

                return row;
            });

            res.status(201).json({
                ok: true,
                message: mapRowToDto(inserted),
            });
        } catch (error) {
            next(error);
        }
    });

    router.post('/circles/:id/messages/:envelopeId/tombstone', async (req, res, next) => {
        try {
            const circleId = parsePositiveInt(req.params.id, NaN);
            if (!Number.isFinite(circleId)) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            const envelopeId = String(req.params.envelopeId || '').trim();
            if (!envelopeId) {
                return res.status(400).json({ error: 'missing_envelope_id' });
            }

            const senderPubkey = String(req.body?.senderPubkey || '').trim();
            if (!senderPubkey) {
                return res.status(400).json({ error: 'missing_sender_pubkey' });
            }

            const sessionAuth = await authenticateSessionFromRequest({
                authorizationHeader: req.headers.authorization,
                circleId,
                expectedSenderPubkey: senderPubkey,
            });
            if (!sessionAuth.ok) {
                return res.status(sessionAuth.status).json({
                    error: sessionAuth.error,
                    message: sessionAuth.message,
                });
            }
            if (
                discussionAuthMode === 'session_token'
                && requireSessionToken
                && !sessionAuth.session
            ) {
                return res.status(401).json({
                    error: 'discussion_session_required',
                    message: 'discussion session token is required in session_token mode',
                });
            }

            const reasonRaw = String(req.body?.reason || 'user_deleted').trim();
            const reason = reasonRaw.slice(0, 64) || 'user_deleted';
            const roomKey = buildDiscussionRoomKey(circleId);

            const existingRows = await prisma.$queryRaw<Array<{
                envelopeId: string;
                senderPubkey: string;
                lamport: bigint;
                deleted: boolean;
            }>>`
                SELECT
                    envelope_id AS "envelopeId",
                    sender_pubkey AS "senderPubkey",
                    lamport AS "lamport",
                    deleted AS "deleted"
                FROM circle_discussion_messages
                WHERE envelope_id = ${envelopeId}
                  AND circle_id = ${circleId}
                LIMIT 1
            `;

            const existing = existingRows[0];
            if (!existing) {
                return res.status(404).json({ error: 'message_not_found' });
            }
            if (existing.senderPubkey !== senderPubkey) {
                return res.status(403).json({ error: 'only_sender_can_tombstone' });
            }
            if (existing.deleted) {
                return res.status(200).json({ ok: true, alreadyDeleted: true });
            }

            const clientTimestamp = req.body?.clientTimestamp
                ? new Date(String(req.body.clientTimestamp))
                : new Date();
            if (Number.isNaN(clientTimestamp.getTime())) {
                return res.status(400).json({ error: 'invalid_client_timestamp' });
            }
            const clientTimestampIso = clientTimestamp.toISOString();

            const signature = req.body?.signature ? String(req.body.signature) : null;
            const payload = buildDiscussionTombstonePayload({
                roomKey,
                circleId,
                senderPubkey,
                envelopeId,
                reason,
                clientTimestamp: clientTimestampIso,
            });
            const canonicalSignedMessage = buildDiscussionTombstoneMessage(payload);
            const signedMessage = req.body?.signedMessage ? String(req.body.signedMessage) : canonicalSignedMessage;

            if (signedMessage !== canonicalSignedMessage) {
                return res.status(400).json({
                    error: 'signed_message_mismatch',
                    message: 'signedMessage does not match canonical tombstone payload',
                });
            }

            const signatureVerified = verifyEd25519SignatureBase64({
                senderPubkey,
                message: signedMessage,
                signatureBase64: signature,
            });
            const persistedTombstonedAt = sqlTimestampWithoutTimeZone(clientTimestamp);
            if (!sessionAuth.session && requireSignatures && !signatureVerified) {
                return res.status(401).json({
                    error: 'signature_required',
                    message: 'valid ed25519 signature is required for tombstone operations',
                });
            }

            const updated = await prisma.$transaction(async (tx) => {
                const rows = await tx.$queryRaw<DiscussionRow[]>`
                    UPDATE circle_discussion_messages
                    SET
                        deleted = TRUE,
                        tombstone_reason = ${reason},
                        tombstoned_at = ${persistedTombstonedAt},
                        lamport = nextval('discussion_lamport_seq'),
                        updated_at = ${persistedTombstonedAt}
                    WHERE envelope_id = ${envelopeId}
                      AND circle_id = ${circleId}
                    RETURNING
                        envelope_id AS "envelopeId",
                        room_key AS "roomKey",
                        circle_id AS "circleId",
                        sender_pubkey AS "senderPubkey",
                        sender_handle AS "senderHandle",
                        message_kind AS "messageKind",
                        subject_type AS "subjectType",
                        subject_id AS "subjectId",
                        metadata AS "metadata",
                        payload_text AS "payloadText",
                        payload_hash AS "payloadHash",
                        nonce AS "nonce",
                        signature AS "signature",
                        signature_verified AS "signatureVerified",
                        auth_mode AS "authMode",
                        session_id AS "sessionId",
                        relevance_score AS "relevanceScore",
                        semantic_score AS "semanticScore",
                        quality_score AS "qualityScore",
                        spam_score AS "spamScore",
                        decision_confidence AS "decisionConfidence",
                        relevance_method AS "relevanceMethod",
                        is_featured AS "isFeatured",
                        COALESCE((
                            SELECT COUNT(*)::INT
                            FROM discussion_message_highlights dh
                            WHERE dh.envelope_id = circle_discussion_messages.envelope_id
                        ), 0) AS "highlightCount",
                        feature_reason AS "featureReason",
                        featured_at AS "featuredAt",
                        is_ephemeral AS "isEphemeral",
                        expires_at AS "expiresAt",
                        client_timestamp AS "clientTimestamp",
                        lamport AS "lamport",
                        prev_envelope_id AS "prevEnvelopeId",
                        deleted AS "deleted",
                        tombstone_reason AS "tombstoneReason",
                        tombstoned_at AS "tombstonedAt",
                        NULL::BOOLEAN AS "sourceMessageDeleted",
                        created_at AS "createdAt",
                        updated_at AS "updatedAt"
                `;
                const row = rows[0];
                if (!row) {
                    throw new Error('failed_to_tombstone_discussion_message');
                }

                await updateOffchainWatermark(tx, {
                    lamport: row.lamport,
                    envelopeId: row.envelopeId,
                });
                return row;
            });

            await emitDiscussionRealtimeEvent({
                circleId,
                latestLamport: Number(updated.lamport),
                envelopeId: updated.envelopeId,
                reason: 'message_tombstoned',
            });

            const forwardedDependents = await prisma.$queryRaw<Array<{
                envelopeId: string;
                circleId: number;
            }>>(Prisma.sql`
                SELECT
                    envelope_id AS "envelopeId",
                    circle_id AS "circleId"
                FROM circle_discussion_messages
                WHERE message_kind = 'forward'
                  AND subject_type = 'discussion_message'
                  AND subject_id = ${envelopeId}
            `);

            for (const dependent of forwardedDependents) {
                await emitDiscussionRealtimeEvent({
                    circleId: dependent.circleId,
                    envelopeId: dependent.envelopeId,
                    reason: 'message_refresh_required',
                });
            }

            try {
                await invalidateDiscussionSummaryCache(redis, circleId);
            } catch {
                // ignore cache invalidation failures
            }

            res.json({
                ok: true,
                message: mapRowToDto(updated),
            });
        } catch (error) {
            next(error);
        }
    });

    return router;
}
