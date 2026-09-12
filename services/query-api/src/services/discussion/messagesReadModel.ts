import { Prisma, type PrismaClient } from '@prisma/client';

import type { AppLocale } from '../../i18n/locale';
import { localizeQueryApiCopy } from '../../i18n/copy';
import {
    resolveCircleActorDisplays,
    type CircleActorDisplay,
    type CircleActorDisplaySource,
} from '../identity/circleActorDisplay';
import {
    resolveCircleIdentityDisplays,
    type CircleIdentityDisplay,
} from '../identity/circleIdentityDisplay';
import { buildDiscussionRoomKey, DISCUSSION_STREAM_KEY } from '../offchainDiscussion';
import {
    DISCUSSION_SEMANTIC_FACETS,
    type DiscussionAnalysisStatus,
    type DiscussionFocusLabel,
    type SemanticFacet,
} from './analysis/types';
import type { DiscussionRealtimeReason } from './realtime/protocol';

export interface DiscussionRow {
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
    usefulCount: number;
    viewerHasMarkedUseful: boolean;
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

export interface OffchainDiscussionExportRow extends DiscussionRow {
    signedMessage: string;
}

export const discussionUsefulCountJoin = Prisma.sql`
    LEFT JOIN (
        SELECT
            envelope_id,
            COUNT(*)::INT AS useful_count
        FROM discussion_message_highlights
        GROUP BY envelope_id
    ) useful_marks ON useful_marks.envelope_id = m.envelope_id
`;

export const discussionForwardSourceJoin = Prisma.sql`
    LEFT JOIN circle_discussion_messages source_message
      ON m.message_kind = 'forward'
     AND m.subject_type = 'discussion_message'
     AND m.subject_id = source_message.envelope_id
`;

export const discussionSelectColumns = Prisma.sql`
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
    COALESCE(useful_marks.useful_count, 0) AS "usefulCount",
    FALSE AS "viewerHasMarkedUseful",
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

const plazaVisibleSubjectPredicate = Prisma.sql`
    (
        (m.subject_type IS NULL AND m.subject_id IS NULL)
        OR (
            m.subject_type = 'discussion_message'
            AND m.subject_id IS NOT NULL
            AND m.message_kind IN ('forward', 'draft_candidate_notice', 'governance_notice', 'interaction_result_notice')
        )
        OR (
            m.subject_type = 'discussion_forward_bundle'
            AND m.subject_id IS NOT NULL
            AND m.message_kind = 'forward_bundle'
        )
        OR (
            m.subject_type = 'announcement'
            AND m.subject_id IS NOT NULL
            AND m.message_kind = 'announcement_notice'
        )
    )
`;

const activeEphemeralPredicate = Prisma.sql`
    (
        m.is_ephemeral = FALSE
        OR m.expires_at IS NULL
        OR m.expires_at > NOW()
    )
`;

function deletedPredicate(includeDeleted: boolean) {
    return includeDeleted ? Prisma.sql`TRUE` : Prisma.sql`m.deleted = FALSE`;
}

function clampLimit(value: number, max = 200): number {
    return Math.max(1, Math.min(Math.trunc(value), max));
}

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

interface HydratedForwardBundleItem {
    bundleId: string;
    position: number;
    sourceEnvelopeId: string;
    sourceCircleId: number;
    sourceAuthorPubkey: string;
    sourceAuthorDisplayName: string;
    sourceAuthorDisplaySource: string;
    sourceAuthorDisplayCircleId: number | null;
    sourceMessageCreatedAt: Date | null;
    snapshotText: string;
    snapshotTruncated: boolean;
    sourceDeletedAtForwardTime: boolean;
    currentSourceDeleted: boolean | null;
}

interface HydratedForwardBundleCard {
    bundleId: string;
    sourceCircleId: number | null;
    sourceCircleName: string | null;
    sourceLevel: number | null;
    forwarderHandle: string | null;
    forwardedAt: Date | null;
    itemCount: number;
    sourceItems: HydratedForwardBundleItem[];
}

function metadataRecord(value: Prisma.JsonValue | null): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function parseForwardBundleCard(
    row: DiscussionRow,
    hydratedBundleCard: HydratedForwardBundleCard | null | undefined,
) {
    if (row.messageKind !== 'forward_bundle') return null;
    if (row.subjectType !== 'discussion_forward_bundle') return null;
    const metadata = metadataRecord(row.metadata);
    const sourceItems = hydratedBundleCard?.sourceItems.map((item) => ({
        sourceEnvelopeId: item.sourceEnvelopeId,
        sourceAuthorPubkey: item.sourceAuthorPubkey,
        sourceAuthorDisplayName: item.sourceAuthorDisplayName,
        sourceAuthorDisplaySource: item.sourceAuthorDisplaySource,
        sourceAuthorDisplayCircleId: item.sourceAuthorDisplayCircleId,
        sourceMessageCreatedAt: item.sourceMessageCreatedAt?.toISOString() || null,
        snapshotText: item.snapshotText,
        snapshotTruncated: item.snapshotTruncated,
        sourceDeleted: item.currentSourceDeleted ?? true,
    })) ?? [];

    return {
        bundleId: hydratedBundleCard?.bundleId
            ?? (typeof row.subjectId === 'string' ? row.subjectId : ''),
        sourceCircleId: hydratedBundleCard?.sourceCircleId
            ?? (typeof metadata?.sourceCircleId === 'number' ? metadata.sourceCircleId : null),
        sourceCircleName: hydratedBundleCard?.sourceCircleName
            ?? (typeof metadata?.sourceCircleName === 'string' ? metadata.sourceCircleName : null),
        sourceLevel: hydratedBundleCard?.sourceLevel
            ?? (typeof metadata?.sourceLevel === 'number' ? metadata.sourceLevel : null),
        forwarderHandle: hydratedBundleCard?.forwarderHandle
            ?? (typeof metadata?.forwarderHandle === 'string' ? metadata.forwarderHandle : row.senderHandle),
        forwardedAt: hydratedBundleCard?.forwardedAt?.toISOString()
            ?? (typeof metadata?.forwardedAt === 'string' ? metadata.forwardedAt : row.createdAt.toISOString()),
        itemCount: hydratedBundleCard?.itemCount
            ?? (typeof metadata?.itemCount === 'number' ? metadata.itemCount : sourceItems.length),
        sourceItems,
    };
}

export function normalizeDiscussionAnalysisStatus(value: string | null | undefined): DiscussionAnalysisStatus {
    if (value === 'pending' || value === 'ready' || value === 'stale' || value === 'failed') {
        return value;
    }
    return 'ready';
}

export function normalizeDiscussionFocusLabel(value: string | null | undefined): DiscussionFocusLabel | null {
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

export type DiscussionSenderDisplaySource = CircleActorDisplaySource;

function buildFallbackSenderIdentityDisplay(): CircleIdentityDisplay {
    return {
        identityLevel: null,
        identityDisplayName: null,
        identityState: 'not_joined',
        membershipSource: 'none',
        membershipCircleId: null,
        role: null,
        roleDisplayName: null,
    };
}

function buildFallbackSenderDisplay(row: DiscussionRow, locale: AppLocale | string): CircleActorDisplay {
    const handle = typeof row.senderHandle === 'string' && row.senderHandle.trim()
        ? row.senderHandle.trim()
        : null;
    return {
        pubkey: row.senderPubkey,
        effectiveName: handle ?? localizeQueryApiCopy('identity.genericMember', locale),
        displaySource: handle ? 'global_handle' : 'generic_member',
        displayCircleId: row.circleId,
        inheritedFromCircleId: null,
        globalHandle: handle,
        globalDisplayName: null,
        circleAlias: null,
        technicalShortAddress: null,
        needsDisplayDisambiguation: false,
        displayCollisionKey: null,
        displayCollisionCount: 1,
    };
}

export function mapRowToDto(
    row: DiscussionRow,
    options: {
        senderDisplay?: CircleActorDisplay | null;
        senderIdentity?: CircleIdentityDisplay | null;
        locale?: AppLocale | string;
        viewerHasMarkedUseful?: boolean;
        forwardBundleCard?: HydratedForwardBundleCard | null;
    } = {},
) {
    const senderDisplay = options.senderDisplay ?? buildFallbackSenderDisplay(row, options.locale ?? 'en');
    const senderIdentity = options.senderIdentity ?? buildFallbackSenderIdentityDisplay();
    return {
        envelopeId: row.envelopeId,
        roomKey: row.roomKey,
        circleId: row.circleId,
        senderPubkey: row.senderPubkey,
        senderHandle: row.senderHandle,
        senderDisplayName: senderDisplay.globalDisplayName,
        senderCircleAlias: senderDisplay.circleAlias,
        senderEffectiveDisplayName: senderDisplay.effectiveName,
        senderDisplaySource: senderDisplay.displaySource,
        senderDisplayCircleId: senderDisplay.displayCircleId,
        senderIdentityLevel: senderIdentity.identityLevel,
        senderIdentityDisplayName: senderIdentity.identityDisplayName,
        senderIdentityState: senderIdentity.identityState,
        senderMembershipSource: senderIdentity.membershipSource,
        senderMembershipCircleId: senderIdentity.membershipCircleId,
        senderRole: senderIdentity.role,
        senderRoleDisplayName: senderIdentity.roleDisplayName,
        messageKind: row.messageKind,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        metadata: row.metadata,
        forwardCard: parseForwardCard(row),
        forwardBundleCard: parseForwardBundleCard(row, options.forwardBundleCard),
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
        usefulCount: row.usefulCount,
        viewerHasMarkedUseful: Boolean(options.viewerHasMarkedUseful ?? row.viewerHasMarkedUseful),
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

export type DiscussionMessageDto = ReturnType<typeof mapRowToDto>;

async function loadForwardBundleCardsForRows(
    prisma: Pick<SqlClient, '$queryRaw'>,
    rows: readonly DiscussionRow[],
): Promise<Map<string, HydratedForwardBundleCard>> {
    const bundleIds = Array.from(new Set(rows
        .filter((row) => row.messageKind === 'forward_bundle'
            && row.subjectType === 'discussion_forward_bundle'
            && typeof row.subjectId === 'string'
            && row.subjectId.trim())
        .map((row) => row.subjectId!.trim())));
    if (bundleIds.length === 0) return new Map();

    const itemRows = await prisma.$queryRaw<Array<{
        bundleId: string;
        sourceCircleId: number | null;
        sourceCircleName: string | null;
        sourceLevel: number | null;
        forwarderHandle: string | null;
        forwardedAt: Date | null;
        itemCount: number;
        position: number;
        sourceEnvelopeId: string;
        itemSourceCircleId: number;
        sourceAuthorPubkey: string;
        sourceAuthorDisplayName: string;
        sourceAuthorDisplaySource: string;
        sourceAuthorDisplayCircleId: number | null;
        sourceMessageCreatedAt: Date | null;
        snapshotText: string;
        snapshotTruncated: boolean;
        sourceDeletedAtForwardTime: boolean;
        currentSourceDeleted: boolean | null;
    }>>(Prisma.sql`
        SELECT
            b.bundle_id AS "bundleId",
            b.source_circle_id AS "sourceCircleId",
            source_circle.name AS "sourceCircleName",
            source_circle.level AS "sourceLevel",
            b.forwarder_handle AS "forwarderHandle",
            b.created_at AS "forwardedAt",
            b.item_count AS "itemCount",
            i.position,
            i.source_envelope_id AS "sourceEnvelopeId",
            i.source_circle_id AS "itemSourceCircleId",
            i.source_author_pubkey AS "sourceAuthorPubkey",
            i.source_author_display_name AS "sourceAuthorDisplayName",
            i.source_author_display_source AS "sourceAuthorDisplaySource",
            i.source_author_display_circle_id AS "sourceAuthorDisplayCircleId",
            i.source_message_created_at AS "sourceMessageCreatedAt",
            i.snapshot_text AS "snapshotText",
            i.snapshot_truncated AS "snapshotTruncated",
            i.source_deleted_at_forward_time AS "sourceDeletedAtForwardTime",
            source_message.deleted AS "currentSourceDeleted"
        FROM discussion_forward_bundles b
        JOIN discussion_forward_bundle_items i
          ON i.bundle_id = b.bundle_id
        LEFT JOIN circles source_circle
          ON source_circle.id = b.source_circle_id
        LEFT JOIN circle_discussion_messages source_message
          ON source_message.envelope_id = i.source_envelope_id
        WHERE b.bundle_id IN (${Prisma.join(bundleIds)})
        ORDER BY b.bundle_id ASC, i.position ASC
    `);

    const cards = new Map<string, HydratedForwardBundleCard>();
    for (const item of itemRows) {
        const current = cards.get(item.bundleId) ?? {
            bundleId: item.bundleId,
            sourceCircleId: item.sourceCircleId,
            sourceCircleName: item.sourceCircleName,
            sourceLevel: item.sourceLevel,
            forwarderHandle: item.forwarderHandle,
            forwardedAt: item.forwardedAt,
            itemCount: item.itemCount,
            sourceItems: [],
        };
        current.sourceItems.push({
            bundleId: item.bundleId,
            position: item.position,
            sourceEnvelopeId: item.sourceEnvelopeId,
            sourceCircleId: item.itemSourceCircleId,
            sourceAuthorPubkey: item.sourceAuthorPubkey,
            sourceAuthorDisplayName: item.sourceAuthorDisplayName,
            sourceAuthorDisplaySource: item.sourceAuthorDisplaySource,
            sourceAuthorDisplayCircleId: item.sourceAuthorDisplayCircleId,
            sourceMessageCreatedAt: item.sourceMessageCreatedAt,
            snapshotText: item.snapshotText,
            snapshotTruncated: item.snapshotTruncated,
            sourceDeletedAtForwardTime: item.sourceDeletedAtForwardTime,
            currentSourceDeleted: item.currentSourceDeleted,
        });
        cards.set(item.bundleId, current);
    }
    return cards;
}

export async function mapRowsToDtos(input: {
    prisma: Pick<SqlClient, '$queryRaw' | 'user' | 'discussionMessageHighlight'> & Partial<Pick<SqlClient, 'circle' | 'circleAlias' | 'circleMember'>>;
    rows: readonly DiscussionRow[];
    locale?: AppLocale | string;
    viewerUserId?: number | null;
}): Promise<DiscussionMessageDto[]> {
    const locale = input.locale ?? 'en';
    const viewerUserId = typeof input.viewerUserId === 'number' && Number.isFinite(input.viewerUserId)
        ? Math.trunc(input.viewerUserId)
        : null;
    const displayRefs = input.rows.map((row) => ({
        displayKey: `message:${row.envelopeId}:sender`,
        pubkey: row.senderPubkey,
        circleId: row.circleId,
    }));
    const displays = await resolveCircleActorDisplays({
        prisma: input.prisma,
        actors: displayRefs,
        mode: 'current',
        locale,
    });
    const identityDisplays = await resolveCircleIdentityDisplays({
        prisma: input.prisma,
        actors: displayRefs,
        locale,
    });
    const forwardBundleCards = await loadForwardBundleCardsForRows(input.prisma, input.rows);
    const envelopeIds = Array.from(new Set(input.rows
        .map((row) => String(row.envelopeId || '').trim())
        .filter((envelopeId) => envelopeId.length > 0)));
    const viewerUsefulEnvelopeIds = viewerUserId && envelopeIds.length > 0
        ? new Set((await input.prisma.discussionMessageHighlight.findMany({
            where: {
                userId: viewerUserId,
                envelopeId: {
                    in: envelopeIds,
                },
            },
            select: {
                envelopeId: true,
            },
        })).map((mark) => mark.envelopeId))
        : new Set<string>();

    return input.rows.map((row) => mapRowToDto(row, {
        locale,
        senderDisplay: displays.get(`message:${row.envelopeId}:sender`) ?? null,
        senderIdentity: identityDisplays.get(`message:${row.envelopeId}:sender`) ?? null,
        viewerHasMarkedUseful: viewerUsefulEnvelopeIds.has(row.envelopeId),
        forwardBundleCard: typeof row.subjectId === 'string'
            ? forwardBundleCards.get(row.subjectId) ?? null
            : null,
    }));
}

type SqlClient = PrismaClient | Prisma.TransactionClient;

export async function findOffchainDiscussionStreamMessages(input: {
    prisma: SqlClient;
    streamKey?: string;
    afterLamport: bigint;
    limit: number;
    includeDeleted: boolean;
}): Promise<DiscussionRow[]> {
    const streamKey = input.streamKey || DISCUSSION_STREAM_KEY;
    return input.prisma.$queryRaw<DiscussionRow[]>(Prisma.sql`
        SELECT
            ${discussionSelectColumns}
        FROM circle_discussion_messages m
        ${discussionForwardSourceJoin}
        ${discussionUsefulCountJoin}
        WHERE m.stream_key = ${streamKey}
          AND m.lamport > ${input.afterLamport}
          AND ${deletedPredicate(input.includeDeleted)}
        ORDER BY m.lamport ASC
        LIMIT ${clampLimit(input.limit, 1000)}
    `);
}

export async function findOffchainDiscussionStreamExportMessages(input: {
    prisma: SqlClient;
    streamKey?: string;
    afterLamport: bigint;
    limit: number;
}): Promise<OffchainDiscussionExportRow[]> {
    const streamKey = input.streamKey || DISCUSSION_STREAM_KEY;
    return input.prisma.$queryRaw<OffchainDiscussionExportRow[]>(Prisma.sql`
        SELECT
            ${discussionSelectColumns},
            m.signed_message AS "signedMessage"
        FROM circle_discussion_messages m
        ${discussionForwardSourceJoin}
        ${discussionUsefulCountJoin}
        WHERE m.stream_key = ${streamKey}
          AND m.lamport > ${input.afterLamport}
        ORDER BY m.lamport ASC
        LIMIT ${clampLimit(input.limit, 1000)}
    `);
}

export async function findCircleDiscussionMessages(input: {
    prisma: SqlClient;
    circleId: number;
    roomKey?: string;
    limit: number;
    beforeLamport: bigint | null;
    afterLamport: bigint | null;
    includeDeleted: boolean;
}): Promise<DiscussionRow[]> {
    const roomKey = input.roomKey || buildDiscussionRoomKey(input.circleId);
    const rows = await input.prisma.$queryRaw<DiscussionRow[]>(Prisma.sql`
        SELECT
            ${discussionSelectColumns}
        FROM circle_discussion_messages m
        ${discussionForwardSourceJoin}
        ${discussionUsefulCountJoin}
        WHERE m.room_key = ${roomKey}
          AND m.circle_id = ${input.circleId}
          AND ${plazaVisibleSubjectPredicate}
          AND ${activeEphemeralPredicate}
          AND (${input.beforeLamport}::BIGINT IS NULL OR m.lamport < ${input.beforeLamport}::BIGINT)
          AND (${input.afterLamport}::BIGINT IS NULL OR m.lamport > ${input.afterLamport}::BIGINT)
          AND ${deletedPredicate(input.includeDeleted)}
        ORDER BY m.lamport ${input.afterLamport === null ? Prisma.raw('DESC') : Prisma.raw('ASC')}
        LIMIT ${clampLimit(input.limit)}
    `);

    return input.afterLamport === null ? [...rows].reverse() : rows;
}

export async function findCircleDiscussionMessagesByEnvelopeIds(input: {
    prisma: SqlClient;
    circleId: number;
    roomKey?: string;
    envelopeIds: string[];
    includeDeleted: boolean;
}): Promise<DiscussionRow[]> {
    if (input.envelopeIds.length === 0) return [];
    const roomKey = input.roomKey || buildDiscussionRoomKey(input.circleId);
    return input.prisma.$queryRaw<DiscussionRow[]>(Prisma.sql`
        SELECT
            ${discussionSelectColumns}
        FROM circle_discussion_messages m
        ${discussionForwardSourceJoin}
        ${discussionUsefulCountJoin}
        WHERE m.room_key = ${roomKey}
          AND m.envelope_id IN (${Prisma.join(input.envelopeIds)})
          AND ${activeEphemeralPredicate}
          AND ${deletedPredicate(input.includeDeleted)}
        ORDER BY m.lamport ASC
    `);
}

export async function findCircleDiscussionMessagesByEnvelopeIdsMap(input: {
    prisma: SqlClient;
    circleId: number;
    roomKey?: string;
    envelopeIds: string[];
    includeDeleted: boolean;
}): Promise<Map<string, DiscussionRow>> {
    const rows = await findCircleDiscussionMessagesByEnvelopeIds(input);
    return new Map(rows.map((row) => [row.envelopeId, row]));
}

export async function findPlazaVisibleCircleDiscussionMessagesByEnvelopeIdsMap(input: {
    prisma: SqlClient;
    circleId: number;
    roomKey?: string;
    envelopeIds: string[];
    includeDeleted: boolean;
}): Promise<Map<string, DiscussionRow>> {
    if (input.envelopeIds.length === 0) return new Map();
    const roomKey = input.roomKey || buildDiscussionRoomKey(input.circleId);
    const rows = await input.prisma.$queryRaw<DiscussionRow[]>(Prisma.sql`
        SELECT
            ${discussionSelectColumns}
        FROM circle_discussion_messages m
        ${discussionForwardSourceJoin}
        ${discussionUsefulCountJoin}
        WHERE m.room_key = ${roomKey}
          AND m.circle_id = ${input.circleId}
          AND m.envelope_id IN (${Prisma.join(input.envelopeIds)})
          AND ${plazaVisibleSubjectPredicate}
          AND ${activeEphemeralPredicate}
          AND ${deletedPredicate(input.includeDeleted)}
        ORDER BY m.lamport ASC
    `);
    return new Map(rows.map((row) => [row.envelopeId, row]));
}

export async function findCircleDiscussionMessagesAfterLamport(input: {
    prisma: SqlClient;
    circleId: number;
    roomKey?: string;
    afterLamport: bigint;
    limit: number;
    includeDeleted?: boolean;
}): Promise<DiscussionRow[]> {
    return findCircleDiscussionMessages({
        prisma: input.prisma,
        circleId: input.circleId,
        roomKey: input.roomKey,
        limit: input.limit,
        beforeLamport: null,
        afterLamport: input.afterLamport,
        includeDeleted: input.includeDeleted ?? true,
    });
}

export async function findKnowledgeDiscussionMessages(input: {
    prisma: SqlClient;
    circleId: number;
    knowledgeId: string;
    roomKey?: string;
    limit: number;
    beforeLamport: bigint | null;
    includeDeleted: boolean;
}): Promise<DiscussionRow[]> {
    const roomKey = input.roomKey || buildDiscussionRoomKey(input.circleId);
    const rows = await input.prisma.$queryRaw<DiscussionRow[]>(Prisma.sql`
        SELECT
            ${discussionSelectColumns}
        FROM circle_discussion_messages m
        ${discussionForwardSourceJoin}
        ${discussionUsefulCountJoin}
        WHERE m.room_key = ${roomKey}
          AND m.subject_type = 'knowledge'
          AND m.subject_id = ${input.knowledgeId}
          AND (${input.beforeLamport}::BIGINT IS NULL OR m.lamport < ${input.beforeLamport}::BIGINT)
          AND ${deletedPredicate(input.includeDeleted)}
        ORDER BY m.lamport DESC
        LIMIT ${clampLimit(input.limit)}
    `);
    return [...rows].reverse();
}

export function mapDiscussionReplayReason(row: Pick<DiscussionRow, 'deleted' | 'messageKind'>): DiscussionRealtimeReason {
    if (row.deleted) return 'message_tombstoned';
    if (row.messageKind === 'draft_candidate_notice') return 'candidate_notice_updated';
    if (row.messageKind === 'interaction_result_notice') return 'interaction_result_published';
    if (row.messageKind === 'announcement_notice') return 'announcement_projection_changed';
    if (row.messageKind === 'governance_notice') return 'system_notice_published';
    if (row.messageKind === 'forward' || row.messageKind === 'forward_bundle') return 'message_forwarded';
    return 'message_created';
}
