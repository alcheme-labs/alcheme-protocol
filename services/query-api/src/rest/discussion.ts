import { Response, Router } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import crypto from 'crypto';

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
import { buildPublicOffchainPeerRef, resolveOffchainPeerSyncTargets } from '../services/offchainPeerSync';
import {
    buildPendingDiscussionAnalysisInsertValues,
    enqueueDiscussionMessageAnalyzeJob,
} from '../services/discussion/analysis/enqueue';
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
    isPublicHardeningRequired,
    resolveJwtSecret,
} from '../config/jwtSecret';
import {
    serviceConfig,
} from '../config/services';
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
    type DraftContributorProofRecord,
} from '../services/contributorProof';
import {
    buildCanonicalProofPackageV2,
    hashCanonicalProofPackageV2,
    normalizeCanonicalProofPackageV2,
    PROOF_PACKAGE_BINDING_VERSION,
} from '../services/proofPackage';
import {
    issueProofPackageSignature,
    persistProofPackageIssuance,
} from '../services/proofPackageIssuer';
import {
    ContributionAssessmentDecisionError,
    prepareDraftContributionAssessment,
    recordContributionAssessmentDecision,
    type PreparedContributionAssessment,
} from '../services/contributionAssessment/decision';
import {
    linkContributionAssessmentToProofPackage,
} from '../services/contributionAssessment/artifact';
import {
    prepareContributionAssessmentProofForDraft,
    type ContributionAssessmentProofPreparation,
} from '../services/contributionAssessment/runtime';
import {
    getHighPenetrationReviewPolicy,
} from '../services/contributionAssessment/policy';
import {
    loadDraftContributionTrace,
} from '../services/contributionAssessment/trace';
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
    loadDraftDiscussionReviewContexts,
    proposeDraftDiscussionThread,
    resolveDraftDiscussionThread,
    withdrawDraftDiscussionThread,
} from '../services/draftDiscussionLifecycle';
import {
    type DraftPermissionAction,
    authorizeDraftActionForActor,
    requireCircleManagerForActor,
    requireCircleOwnerForActor,
    sendAuthActorError,
} from '../services/auth/actorPermissions';
import {
    requireAuthenticatedActor,
    requireCircleActor,
    requireCircleActorForAuthActor,
    requireCircleManagerActor,
} from '../services/auth/actor';
import { sqlTimestampWithoutTimeZone } from '../utils/sqlTimestamp';
import {
    localizeDraftWorkflowPermissionDecision,
    resolveDraftWorkflowPermission,
} from '../services/policy/draftWorkflowPermissions';
import { localizeQueryApiCopy, type QueryApiCopyKey } from '../i18n/copy';
import { resolveExpressRequestLocale } from '../i18n/request';
import type { AppLocale } from '../i18n/locale';
import {
    finalizeDraftLifecycleCrystallization,
    resolveDraftLifecycleReadModel,
    type DraftLifecycleReadModel,
} from '../services/draftLifecycle/readModel';
import { loadDraftVersionSnapshot } from '../services/draftLifecycle/versionSnapshots';
import { DraftWorkflowStateError } from '../services/draftLifecycle/workflowState';
import { updateDraftContentAndHeat } from '../services/heat/postHeat';
import {
    createPrismaTemporaryEditGrantStore,
} from '../services/draftBlocks/grants';
import {
    splitDraftParagraphs,
    validateScopedParagraphEdit,
    type ParagraphScopeErrorCode,
} from '../services/draftBlocks/paragraphScope';
import {
    isDraftSourceParticipant,
} from '../services/draftBlocks/sourceParticipants';
import {
    resolveDraftBlockReadModel,
} from '../services/draftBlocks/readModel';
import {
    acceptGhostDraftIntoWorkingCopy,
    GhostDraftAcceptanceError,
    normalizeGhostDraftAcceptanceMode,
} from '../services/ghostDraft/acceptance';
import {
    acceptDraftCandidateIntoDraft,
    cancelDraftCandidate,
    createDraftFromManualDiscussionSelection,
    DraftCandidateAcceptanceError,
} from '../services/discussion/candidateAcceptance';
import {
    ComposeOffchainDraftError,
    createComposeOffchainDraft,
} from '../services/draftLifecycle/createComposeOffchainDraft';
import { normalizeDraftTitle, resolveDraftTitle } from '../services/draftLifecycle/draftTitle';
import {
    listDraftParagraphStructureDependencies,
    lockDraftParagraphStructure,
} from '../services/draftLifecycle/paragraphStructure';
import { refreshAnnouncementDiscussionProjectionForReply } from '../services/discussion/announcements/discussionProjection';
import { bumpKnowledgeHeat, KNOWLEDGE_HEAT_EVENTS } from '../services/heat/knowledgeHeat';
import {
    createDiscussionForwardBundleProjection,
    createDiscussionForwardProjection,
    sendDiscussionForwardingError,
} from '../services/discussion/forwardingService';
import { prepareStructuredDiscussionWriteMetadata } from '../services/discussion/systemNoticeSeam';
import { extractStructuredDiscussionMetadata } from '../services/discussion/structuredMessageMetadata';
import {
    PlazaDiscussionCapabilityError,
    resolvePlazaDiscussionContextForWrite,
} from '../services/discussion/plazaRoomCapability';
import {
    authenticateDiscussionSessionFromRequest,
    loadValidDiscussionSessionById,
    parseBearerToken,
    parseDiscussionSessionTokenPayload,
    signDiscussionSessionToken,
    type DiscussionSessionRow,
} from '../services/discussion/sessionAuth';
import {
    PlazaDiscussionWriteAccessError,
    resolvePlazaDiscussionWriteAccess,
} from '../services/discussion/writeAccess';
import {
    addDiscussionRealtimeSink,
    DISCUSSION_REALTIME_MAX_BUFFERED_BYTES,
    removeDiscussionRealtimeSink,
    publishDiscussionRealtimeEvent,
    serializeDiscussionRealtimeHeartbeat,
    serializeDiscussionRealtimeSseEvent,
} from '../services/discussion/realtime';
import {
    findCircleDiscussionMessages,
    findCircleDiscussionMessagesAfterLamport,
    findCircleDiscussionMessagesByEnvelopeIds,
    findPlazaVisibleCircleDiscussionMessagesByEnvelopeIdsMap,
    findOffchainDiscussionStreamExportMessages,
    findKnowledgeDiscussionMessages,
    findOffchainDiscussionStreamMessages,
    mapDiscussionReplayReason,
    mapRowToDto,
    mapRowsToDtos,
    type DiscussionRow,
} from '../services/discussion/messagesReadModel';
import {
    bindKnowledgeToDraftSource,
    CrystallizationBindingError,
    resolveKnowledgePublicationOrigin,
} from '../services/crystallizationBinding';
import { computePolicyProfileDigest } from '../services/policy/digest';
import {
    mapContributionSyncError,
    syncKnowledgeContributionsFromDraftProof,
} from '../services/knowledgeContributions';
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
    KnowledgePublicationLicenseError,
    acceptKnowledgePublicationLicense,
    authorizeKnowledgePublicationAttempt,
    prepareKnowledgePublicationAuthorization,
    publishAuthorizedKnowledgeVersion,
    requireAuthorizedKnowledgePublicationAttempt,
    type PreparedKnowledgePublicationAuthorization,
} from '../services/knowledgePublicationLicense';
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
import {
    buildSignedDiscussionStreamBatchFromMessages,
    OffchainExportSigningUnconfiguredError,
} from '../services/offchainPeerTrust';
import { PublicKey } from '@solana/web3.js';

export { normalizeDiscussionSemanticFacets } from '../services/discussion/messagesReadModel';

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

interface DraftDiscussionResolutionRefRow {
    threadId: bigint;
    resolutionId: bigint;
    applicationId: bigint;
}

type DraftDiscussionMutationAction = 'create' | 'propose' | 'reply' | 'withdraw' | 'resolve' | 'apply';

type DraftContentWriteAccess =
    | {
        mode: 'full';
        currentText?: string;
        currentUpdatedAt?: Date;
    }
    | {
        mode: 'scoped_paragraph';
        currentText: string;
        currentUpdatedAt: Date;
    };

interface DraftParagraphEditScopePayload {
    type: 'paragraph';
    blockId: string;
    baseWorkingCopyHash: string;
}

interface DraftParagraphDeletePayload {
    index: number;
}

function parseDraftParagraphEditScope(body: any): DraftParagraphEditScopePayload | null {
    const scope = body?.editScope;
    if (!scope || typeof scope !== 'object') return null;
    if (String(scope.type || '').trim() !== 'paragraph') return null;
    const blockId = String(scope.blockId || '').trim();
    const baseWorkingCopyHash = String(scope.baseWorkingCopyHash || '').trim();
    if (!blockId) return null;
    return {
        type: 'paragraph',
        blockId,
        baseWorkingCopyHash,
    };
}

function parseDraftParagraphDelete(body: any): DraftParagraphDeletePayload | null {
    const payload = body?.paragraphDelete;
    if (!payload || typeof payload !== 'object') return null;
    const index = Number(payload.index);
    if (!Number.isInteger(index) || index < 0) return null;
    return { index };
}

function parseOptionalDraftWorkingCopyHash(body: any): string | null {
    const candidates = [
        body?.workingCopyHash,
        body?.baseWorkingCopyHash,
        body?.editScope?.baseWorkingCopyHash,
    ];
    for (const candidate of candidates) {
        if (typeof candidate !== 'string') continue;
        const normalized = candidate.trim();
        if (normalized) return normalized;
    }
    return null;
}

function isValidDraftWorkingCopyHash(value: string): boolean {
    return /^[a-f0-9]{64}$/i.test(value.trim());
}

const PARAGRAPH_SCOPE_ERROR_COPY_KEY: Record<ParagraphScopeErrorCode, QueryApiCopyKey> = {
    invalid_draft_paragraph_scope: 'draft.scopedEdit.invalidScope',
    draft_working_copy_conflict: 'draft.scopedEdit.workingCopyConflict',
    draft_paragraph_count_changed: 'draft.scopedEdit.paragraphCountChanged',
    draft_paragraph_scope_exceeded: 'draft.scopedEdit.scopeExceeded',
    draft_paragraph_empty: 'draft.scopedEdit.paragraphEmpty',
};

async function remapDraftCommentLineRefsAfterParagraphDelete(
    client: PrismaClient | Prisma.TransactionClient,
    input: {
        postId: number;
        deletedParagraphIndex: number;
    },
) {
    const comments = await client.draftComment.findMany({
        where: { postId: input.postId },
        select: {
            id: true,
            lineRef: true,
        },
    });

    const updates = comments.flatMap((comment) => {
        const matched = String(comment.lineRef || '').trim().match(/^paragraph:(\d+)$/i);
        if (!matched) return [];
        const paragraphIndex = Number.parseInt(matched[1], 10);
        if (!Number.isInteger(paragraphIndex) || paragraphIndex < 0) return [];
        if (paragraphIndex === input.deletedParagraphIndex) {
            return [{
                id: comment.id,
                lineRef: `orphaned:paragraph:${paragraphIndex}`,
            }];
        }
        if (paragraphIndex > input.deletedParagraphIndex) {
            return [{
                id: comment.id,
                lineRef: `paragraph:${paragraphIndex - 1}`,
            }];
        }
        return [];
    });

    await Promise.all(updates.map((update) =>
        client.draftComment.update({
            where: { id: update.id },
            data: { lineRef: update.lineRef },
        }),
    ));
}

function localizeDiscussionRouteCopy(req: any, key: QueryApiCopyKey): string {
    return localizeQueryApiCopy(key, resolveExpressRequestLocale(req));
}

function isDraftReviewIssueWindowOpen(
    lifecycle: Pick<DraftLifecycleReadModel, 'documentStatus' | 'reviewEndsAt' | 'reviewWindowExpiredAt'>,
    now = new Date(),
): boolean {
    if (lifecycle.documentStatus !== 'review') return false;
    if (lifecycle.reviewWindowExpiredAt) return false;
    if (!lifecycle.reviewEndsAt) return true;
    const reviewEndsAtMs = Date.parse(lifecycle.reviewEndsAt);
    return !Number.isFinite(reviewEndsAtMs) || reviewEndsAtMs > now.getTime();
}

function resolveCurrentStableDraftVersion(
    lifecycle: Pick<DraftLifecycleReadModel, 'currentSnapshotVersion'>,
): number | null {
    const version = Number(lifecycle.currentSnapshotVersion);
    return Number.isInteger(version) && version > 0 ? version : null;
}

function isGrantCurrentlyActive(input: {
    status: string;
    granteeUserId: number;
    expiresAt: Date | null;
    actorUserId: number;
    now: Date;
}): boolean {
    if (input.status !== 'active') return false;
    if (input.granteeUserId !== input.actorUserId) return false;
    return !input.expiresAt || input.expiresAt.getTime() > input.now.getTime();
}

function isTemporaryGrantProjectionActive(input: {
    status: string;
    expiresAt: Date | null;
    now: Date;
}): boolean {
    if (input.status !== 'active') return false;
    return !input.expiresAt || input.expiresAt.getTime() > input.now.getTime();
}

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

async function assertCanonicalKnowledgePublicationRoute(
    prisma: PrismaClient | Prisma.TransactionClient,
    draftPostId: number,
): Promise<void> {
    try {
        await resolveKnowledgePublicationOrigin(prisma, draftPostId);
    } catch (error) {
        if (error instanceof CrystallizationBindingError) {
            throw new DraftWorkflowStateError(error.code, error.statusCode, error.message);
        }
        throw error;
    }
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

function normalizeStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    for (const item of value) {
        const normalized = String(item || '').trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
    }
    return Array.from(seen);
}

function parseManualDraftSourceScope(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const viewMode = typeof record.viewMode === 'string' && record.viewMode.trim()
        ? record.viewMode.trim()
        : null;
    const visibleMessageCount = typeof record.visibleMessageCount === 'number'
        && Number.isInteger(record.visibleMessageCount)
        && record.visibleMessageCount >= 0
        ? record.visibleMessageCount
        : null;
    const filterLabels = normalizeStringList(record.filterLabels);
    return {
        viewMode,
        visibleMessageCount,
        filterLabels,
    };
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined) return fallback;
    const normalized = value.trim().toLowerCase();
    if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true;
    if (normalized === '0' || normalized === 'false' || normalized === 'no') return false;
    return fallback;
}

export interface DiscussionSecurityConfig {
    discussionAuthMode: 'session_token' | 'wallet_per_message';
    requireSessionToken: boolean;
    requireSignatures: boolean;
}

export function normalizeDiscussionAuthMode(
    value: string | undefined,
): DiscussionSecurityConfig['discussionAuthMode'] {
    const normalized = String(value || 'session_token').trim().toLowerCase();
    if (normalized === 'session_token' || normalized === 'wallet_per_message') {
        return normalized;
    }
    throw new Error('discussion_auth_mode_invalid');
}

export function resolveDiscussionSecurityConfig(
    env: NodeJS.ProcessEnv = process.env,
): DiscussionSecurityConfig {
    const discussionAuthMode = normalizeDiscussionAuthMode(env.DISCUSSION_AUTH_MODE);
    const hardeningRequired = isPublicHardeningRequired(env);
    return {
        discussionAuthMode,
        requireSessionToken: parseBool(
            env.DISCUSSION_REQUIRE_SESSION_TOKEN,
            hardeningRequired && discussionAuthMode === 'session_token',
        ),
        requireSignatures: parseBool(env.REQUIRE_DISCUSSION_SIGNATURES, hardeningRequired),
    };
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

function normalizeDiscussionScope(raw: string | undefined): string {
    const scope = String(raw || 'circle:*').trim().toLowerCase();
    if (scope === 'circle:*') return scope;
    if (/^circle:\d+$/.test(scope)) return scope;
    throw new Error('invalid_discussion_scope');
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

    async function mapDiscussionRowsForResponse(
        rows: readonly DiscussionRow[],
        locale: AppLocale,
        viewerUserId?: number | null,
    ) {
        return mapRowsToDtos({
            prisma,
            rows,
            locale,
            viewerUserId,
        });
    }

    async function mapDiscussionRowForResponse(row: DiscussionRow, locale: AppLocale) {
        const [dto] = await mapDiscussionRowsForResponse([row], locale);
        return dto ?? mapRowToDto(row, { locale });
    }

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

    const ghostConfig = loadGhostConfig();
    const jwtSecret = resolveJwtSecret();
    const {
        discussionAuthMode,
        requireSessionToken,
        requireSignatures,
    } = resolveDiscussionSecurityConfig();
    const sessionTtlSec = parsePositiveInt(process.env.DISCUSSION_SESSION_TTL_SEC, 1800);
    const sessionRefreshWindowSec = parsePositiveInt(process.env.DISCUSSION_SESSION_REFRESH_WINDOW_SEC, 300);
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
        message?: Parameters<typeof publishDiscussionRealtimeEvent>[1]['message'];
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

    class ContributionAssessmentProofEndpointError extends Error {
        constructor(
            public readonly statusCode: number,
            public readonly responseBody: Record<string, unknown>,
        ) {
            super(String(responseBody.message || responseBody.error || 'contribution_assessment_proof_unavailable'));
            this.name = 'ContributionAssessmentProofEndpointError';
        }
    }

    function serializeContributionAssessmentPreparation(
        preparation: ContributionAssessmentProofPreparation | null,
        warning?: { code: string; message: string } | null,
    ) {
        if (!preparation) {
            return warning
                ? {
                    status: 'unavailable',
                    warning,
                }
                : null;
        }
        return {
            rolloutMode: preparation.rolloutMode,
            providerMode: preparation.providerMode,
            status: preparation.status,
            evidenceHash: preparation.evidenceHash,
            assessment: preparation.assessment
                ? {
                    id: preparation.assessment.id.toString(),
                    status: preparation.assessment.status,
                    highPenetrationState: preparation.assessment.highPenetrationState,
                    inputHash: preparation.assessment.inputHash,
                    outputHash: preparation.assessment.outputHash,
                    canonicalAllocationHash: preparation.assessment.canonicalAllocationHash,
                    canonicalContributorsRoot: preparation.assessment.canonicalContributorsRoot,
                    canonicalContributorsCount: preparation.assessment.canonicalContributorsCount,
                    signerKeyId: preparation.assessment.signerKeyId,
                    createdAt: preparation.assessment.createdAt,
                    updatedAt: preparation.assessment.updatedAt,
                }
                : null,
            gate: preparation.gate,
            warning: preparation.warning ?? warning ?? null,
        };
    }

    function serializeContributionAssessmentRead(
        prepared: PreparedContributionAssessment,
        warning?: { code: string; message: string } | null,
    ) {
        return {
            rolloutMode: serviceConfig.contributionAssessment.rolloutMode,
            providerMode: serviceConfig.contributionAssessment.providerMode,
            status: prepared.assessment?.status ?? 'not_prepared',
            evidenceHash: null,
            assessment: prepared.assessment
                ? {
                    id: prepared.assessment.id,
                    status: prepared.assessment.status,
                    highPenetrationState: prepared.assessment.highPenetrationState,
                    inputHash: prepared.assessment.inputHash,
                    outputHash: prepared.assessment.outputHash,
                    canonicalAllocationHash: prepared.assessment.canonicalAllocationHash,
                    canonicalContributorsRoot: prepared.assessment.canonicalContributorsRoot,
                    canonicalContributorsCount: prepared.assessment.canonicalContributorsCount,
                    signerKeyId: prepared.assessment.signerKeyId,
                    createdAt: prepared.assessment.createdAt,
                    updatedAt: prepared.assessment.updatedAt,
                }
                : null,
            gate: prepared.gate,
            warning: warning ?? null,
        };
    }

    function isContributionAssessmentReviewRequiredGate(
        gate: { state?: string | null; required?: boolean | null } | null | undefined,
    ): boolean {
        return Boolean(gate?.required && gate.state === 'high_penetration_needs_review');
    }

    // Proof read endpoints intentionally prepare the contribution assessment artifact in
    // current modes. This keeps contributor-proof, proof-package, and binding on the same
    // signed allocation instead of silently falling back to legacy contributor proof.
    async function resolvePreparedContributionAssessmentProof(draftPostId: number): Promise<{
        preparation: ContributionAssessmentProofPreparation | null;
        warning: { code: string; message: string } | null;
        contributorProof: DraftContributorProofRecord | null;
    }> {
        if (serviceConfig.contributionAssessment.rolloutMode === 'legacy') {
            return {
                preparation: null,
                warning: null,
                contributorProof: null,
            };
        }

        let preparation: ContributionAssessmentProofPreparation;
        let warning: { code: string; message: string } | null = null;
        try {
            preparation = await prepareContributionAssessmentProofForDraft({
                prisma,
                draftPostId,
            });
        } catch (error) {
            warning = {
                code: 'contribution_assessment_prepare_failed',
                message: error instanceof Error ? error.message : String(error),
            };
            throw new ContributionAssessmentProofEndpointError(409, {
                ok: false,
                error: warning.code,
                message: warning.message,
                mode: draftStrictBindingMode,
                contributionAssessment: serializeContributionAssessmentPreparation(null, warning),
            });
        }
        if (preparation.status === 'not_prepared') {
            throw new ContributionAssessmentProofEndpointError(409, {
                ok: false,
                error: 'contribution_assessment_not_prepared',
                message: 'contribution assessment has not been prepared',
                mode: draftStrictBindingMode,
                contributionAssessment: serializeContributionAssessmentPreparation(preparation),
            });
        }
        if (isContributionAssessmentReviewRequiredGate(preparation.gate)) {
            throw new ContributionAssessmentProofEndpointError(409, {
                ok: false,
                error: 'contribution_assessment_review_required',
                message: 'contribution assessment requires review before proof binding',
                mode: draftStrictBindingMode,
                contributionAssessment: serializeContributionAssessmentPreparation(preparation),
            });
        }
        if (!preparation.contributorProof) {
            throw new ContributionAssessmentProofEndpointError(409, {
                ok: false,
                error: 'contribution_assessment_proof_unavailable',
                message: 'contribution assessment proof is unavailable',
                mode: draftStrictBindingMode,
                contributionAssessment: serializeContributionAssessmentPreparation(preparation),
            });
        }

        return {
            preparation,
            warning,
            contributorProof: preparation.contributorProof,
        };
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

        let proofPackage;
        try {
            proofPackage = normalizeCanonicalProofPackageV2(input.proofPackage);
        } catch {
            throw new Error('invalid_proof_snapshot');
        }
        const packageHash = hashCanonicalProofPackageV2(proofPackage);
        if (
            proofPackage.draft_anchor !== input.sourceAnchorId
            || proofPackage.root !== input.contributorsRoot
            || proofPackage.count !== input.contributorsCount
            || proofPackage.generated_at !== input.generatedAt
            || packageHash !== input.proofPackageHash
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
            proofPackage: proofPackage as unknown as Prisma.JsonValue,
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
        await assertCanonicalKnowledgePublicationRoute(db, draftPostId);
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

    async function buildCurrentDraftProofPackage(input: {
        draftPostId: number;
        db: PrismaClient | Prisma.TransactionClient;
        contributorProof: DraftContributorProofRecord;
        generatedAt?: string;
    }) {
        const stableEvidence = await resolveStableSnapshotCollabEvidence(input.draftPostId, input.db);
        const discussionResolutionRefs = await loadDraftDiscussionResolutionRefs(input.draftPostId, input.db);
        const generatedAt = input.generatedAt
            ?? resolveProofPackageGeneratedAt({
                anchoredAt: (stableEvidence.anchor as any).anchoredAt ?? null,
                createdAt: (stableEvidence.anchor as any).createdAt ?? null,
                updatedAt: (stableEvidence.anchor as any).updatedAt ?? null,
            });
        return buildCanonicalProofPackageV2({
            contributorProof: input.contributorProof,
            collabEditAnchorId: stableEvidence.anchor.anchorId,
            discussionResolutionRefs,
            generatedAt,
        });
    }

    function assertPreparedProofPackageMatchesSnapshot(input: {
        proofPackage: ReturnType<typeof buildCanonicalProofPackageV2>;
        snapshot: DraftProofSnapshotInput;
    }) {
        if (
            input.proofPackage.proof_package_hash !== input.snapshot.proofPackageHash
            || input.proofPackage.canonical_proof_package.draft_anchor !== input.snapshot.sourceAnchorId
            || input.proofPackage.canonical_proof_package.root !== input.snapshot.contributorsRoot
            || input.proofPackage.canonical_proof_package.count !== input.snapshot.contributorsCount
            || input.proofPackage.canonical_proof_package.generated_at !== input.snapshot.generatedAt
        ) {
            throw new Error('invalid_proof_snapshot');
        }
    }

    async function persistCurrentDraftProofPackageIssuance(
        draftPostId: number,
        db: PrismaClient | Prisma.TransactionClient = prisma,
        snapshot?: DraftProofSnapshotInput,
        prepared?: {
            contributorProof?: DraftContributorProofRecord | null;
            contributionAssessmentId?: bigint | number | string | null;
        },
    ) {
        const persistAndMaybeLink = async (input: {
            proofPackageHash: string;
            sourceAnchorId: string;
            contributorsRoot: string;
            contributorsCount: number;
            bindingVersion: number;
            canonicalProofPackage: Prisma.JsonValue;
            generatedAt: string;
            issuerKeyId: string;
            issuedSignature: string;
            issuedAt: string;
        }) => {
            const persisted = await persistProofPackageIssuance(db as PrismaClient, {
                draftPostId,
                proofPackageHash: input.proofPackageHash,
                sourceAnchorId: input.sourceAnchorId,
                contributorsRoot: input.contributorsRoot,
                contributorsCount: input.contributorsCount,
                bindingVersion: input.bindingVersion,
                canonicalProofPackage: input.canonicalProofPackage,
                generatedAt: input.generatedAt,
                generatedBy: proofPackageGeneratedBy,
                issuerKeyId: input.issuerKeyId,
                issuedSignature: input.issuedSignature,
                issuedAt: input.issuedAt,
            });
            if (prepared?.contributionAssessmentId) {
                await linkContributionAssessmentToProofPackage(db as PrismaClient, {
                    assessmentId: prepared.contributionAssessmentId,
                    proofPackageId: persisted.proofPackageId,
                    proofPackageHash: persisted.proofPackageHash,
                    canonicalContributorsRoot: persisted.contributorsRoot,
                    canonicalContributorsCount: persisted.contributorsCount,
                    status: 'bound',
                });
            }
            return persisted;
        };
        if (prepared && !prepared.contributorProof) {
            throw new Error('contribution_assessment_proof_unavailable');
        }
        if (snapshot) {
            const validatedSnapshot = validateProofSnapshot(snapshot);
            let proofPackageHash = validatedSnapshot.proofPackageHash;
            let sourceAnchorId = validatedSnapshot.sourceAnchorId;
            let contributorsRoot = validatedSnapshot.contributorsRoot;
            let contributorsCount = validatedSnapshot.contributorsCount;
            let canonicalProofPackage = validatedSnapshot.proofPackage;
            if (prepared?.contributorProof) {
                const preparedProofPackage = await buildCurrentDraftProofPackage({
                    draftPostId,
                    db,
                    contributorProof: prepared.contributorProof,
                    generatedAt: validatedSnapshot.generatedAt,
                });
                assertPreparedProofPackageMatchesSnapshot({
                    proofPackage: preparedProofPackage,
                    snapshot: validatedSnapshot,
                });
                proofPackageHash = preparedProofPackage.proof_package_hash;
                sourceAnchorId = preparedProofPackage.canonical_proof_package.draft_anchor;
                contributorsRoot = preparedProofPackage.canonical_proof_package.root;
                contributorsCount = preparedProofPackage.canonical_proof_package.count;
                canonicalProofPackage =
                    preparedProofPackage.canonical_proof_package as unknown as Prisma.JsonValue;
            }
            return persistAndMaybeLink({
                proofPackageHash,
                sourceAnchorId,
                contributorsRoot,
                contributorsCount,
                bindingVersion: validatedSnapshot.bindingVersion,
                canonicalProofPackage,
                generatedAt: validatedSnapshot.generatedAt,
                issuerKeyId: validatedSnapshot.issuerKeyId,
                issuedSignature: validatedSnapshot.issuedSignature,
                issuedAt: new Date().toISOString(),
            });
        }

        let contributorProof: DraftContributorProofRecord;
        if (prepared) {
            if (!prepared.contributorProof) {
                throw new Error('contribution_assessment_proof_unavailable');
            }
            contributorProof = prepared.contributorProof;
        } else {
            contributorProof = await getDraftContributorProof(db as PrismaClient, draftPostId);
        }
        const proofPackage = await buildCurrentDraftProofPackage({
            draftPostId,
            db,
            contributorProof,
        });
        const issuance = issueProofPackageSignature({
            proof_package_hash: proofPackage.proof_package_hash,
            contributors_root: proofPackage.canonical_proof_package.root,
            contributors_count: proofPackage.canonical_proof_package.count,
            source_anchor_id: proofPackage.canonical_proof_package.draft_anchor,
            binding_version: PROOF_PACKAGE_BINDING_VERSION,
            generated_at: proofPackage.canonical_proof_package.generated_at,
        });

        return persistAndMaybeLink({
            proofPackageHash: proofPackage.proof_package_hash,
            sourceAnchorId: proofPackage.canonical_proof_package.draft_anchor,
            contributorsRoot: proofPackage.canonical_proof_package.root,
            contributorsCount: proofPackage.canonical_proof_package.count,
            bindingVersion: PROOF_PACKAGE_BINDING_VERSION,
            canonicalProofPackage: proofPackage.canonical_proof_package as unknown as Prisma.JsonValue,
            generatedAt: proofPackage.canonical_proof_package.generated_at,
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
        const actor = await requireAuthenticatedActor(req, prisma, { requireSessionCookie: true });
        const access = await authorizeDraftActionForActor(prisma, {
            actor,
            postId,
            action,
        });
        if (!access.allowed) {
            res.status(access.statusCode).json({
                error: access.error,
                message: access.message,
            });
            return null;
        }
        return {
            ...access,
            actor,
            authUserId: actor.userId,
        };
    }

    async function ensureDraftCrystallizationWorkflowPermissionFromAccess(
        req: any,
        res: any,
        access: {
            authUserId?: number | null;
            circleActor?: unknown;
            post?: { circleId?: number | null } | null;
        },
        input: {
            messageKey: QueryApiCopyKey;
        },
    ): Promise<boolean> {
        const circleId = access.post?.circleId;
        if (!access.authUserId || !circleId || !access.circleActor) {
            res.status(403).json({
                error: 'draft_crystallize_permission_denied',
                message: localizeQueryApiCopy(input.messageKey, resolveExpressRequestLocale(req)),
            });
            return false;
        }
        const permission = await resolveDraftWorkflowPermission(prisma, {
            circleId,
            actor: access.circleActor as any,
            action: 'enter_crystallization',
        });
        if (!permission.allowed) {
            res.status(403).json({
                error: 'draft_crystallize_permission_denied',
                message: localizeDraftWorkflowPermissionDecision(permission, resolveExpressRequestLocale(req)),
            });
            return false;
        }
        return true;
    }

    async function resolveDraftContentWriteAccess(
        req: any,
        res: any,
        postId: number,
    ): Promise<DraftContentWriteAccess | null> {
        const actor = await requireAuthenticatedActor(req, prisma, { requireSessionCookie: true });
        const fullAccess = await authorizeDraftActionForActor(prisma, {
            actor,
            postId,
            action: 'edit',
        });

        if (fullAccess.allowed) {
            const lifecycle = await resolveDraftLifecycleReadModel(prisma, { draftPostId: postId });
            if (lifecycle.documentStatus !== 'drafting') {
                res.status(409).json({
                    error: 'draft_content_edit_requires_drafting',
                    message: localizeDiscussionRouteCopy(req, 'draft.content.draftingOnly'),
                });
                return null;
            }

            const requestedWorkingCopyHash = parseOptionalDraftWorkingCopyHash(req.body);
            if (!requestedWorkingCopyHash || !isValidDraftWorkingCopyHash(requestedWorkingCopyHash)) {
                res.status(409).json({
                    error: 'draft_working_copy_precondition_required',
                    message: localizeDiscussionRouteCopy(req, 'draft.content.workingCopyPreconditionRequired'),
                });
                return null;
            }

            const post = await prisma.post.findUnique({
                where: { id: postId },
                select: {
                    id: true,
                    status: true,
                    text: true,
                    updatedAt: true,
                },
            });
            if (!post) {
                res.status(404).json({ error: 'draft_not_found', message: 'draft post is not found' });
                return null;
            }
            if (String(post.status) !== 'Draft') {
                res.status(409).json({ error: 'not_draft_status', message: 'target post is not in Draft status' });
                return null;
            }
            const currentText = String(post.text || '');
            const currentWorkingCopyHash = sha256Hex(currentText);
            if (requestedWorkingCopyHash !== currentWorkingCopyHash) {
                res.status(409).json({
                    error: 'draft_working_copy_conflict',
                    message: localizeDiscussionRouteCopy(req, 'draft.scopedEdit.workingCopyConflict'),
                    workingCopyHash: currentWorkingCopyHash,
                });
                return null;
            }
            return {
                mode: 'full',
                currentText,
                currentUpdatedAt: post.updatedAt,
            };
        }

        if (fullAccess.error !== 'draft_edit_permission_denied') {
            res.status(fullAccess.statusCode).json({
                error: fullAccess.error,
                message: fullAccess.message,
            });
            return null;
        }

        const circleId = fullAccess.post?.circleId;
        if (!circleId || circleId <= 0) {
            res.status(409).json({
                error: 'draft_circle_required',
                message: localizeDiscussionRouteCopy(req, 'draft.scopedEdit.circleRequired'),
            });
            return null;
        }

        await requireCircleActorForAuthActor(actor, prisma, {
            circleId,
            action: 'draft.write',
        });

        const editScope = parseDraftParagraphEditScope(req.body);
        if (!editScope) {
            res.status(403).json({
                error: 'draft_edit_permission_denied',
                message: localizeDiscussionRouteCopy(req, 'draft.scopedEdit.scopeRequired'),
            });
            return null;
        }

        const lifecycle = await resolveDraftLifecycleReadModel(prisma, { draftPostId: postId });
        if (lifecycle.documentStatus !== 'drafting') {
            res.status(409).json({
                error: 'draft_scoped_edit_unavailable',
                message: localizeDiscussionRouteCopy(req, 'draft.scopedEdit.draftingOnly'),
            });
            return null;
        }

        const post = await prisma.post.findUnique({
            where: { id: postId },
            select: {
                id: true,
                circleId: true,
                status: true,
                text: true,
                updatedAt: true,
            },
        });
        if (!post) {
            res.status(404).json({ error: 'draft_not_found', message: 'draft post is not found' });
            return null;
        }
        if (String(post.status) !== 'Draft') {
            res.status(409).json({ error: 'not_draft_status', message: 'target post is not in Draft status' });
            return null;
        }
        if (post.circleId !== circleId) {
            res.status(409).json({
                error: 'draft_circle_mismatch',
                message: localizeDiscussionRouteCopy(req, 'draft.scopedEdit.circleMismatch'),
            });
            return null;
        }

        const sourceParticipant = await isDraftSourceParticipant(prisma, {
            draftPostId: postId,
            circleId,
            userId: actor.userId,
        });

        let temporaryGrantActive = false;
        if (!sourceParticipant) {
            const grants = await createPrismaTemporaryEditGrantStore(prisma).listDraftGrants({
                draftPostId: postId,
                blockId: editScope.blockId,
            });
            const now = new Date();
            temporaryGrantActive = grants.some((grant) =>
                isGrantCurrentlyActive({
                    status: grant.status,
                    granteeUserId: grant.granteeUserId,
                    expiresAt: grant.expiresAt,
                    actorUserId: actor.userId,
                    now,
                }),
            );
        }

        if (!sourceParticipant && !temporaryGrantActive) {
            res.status(403).json({
                error: 'draft_scoped_edit_permission_denied',
                message: localizeDiscussionRouteCopy(req, 'draft.scopedEdit.permissionRequired'),
            });
            return null;
        }

        const currentText = String(post.text || '');
        const currentWorkingCopyHash = sha256Hex(currentText);
        const scopeValidation = validateScopedParagraphEdit({
            blockId: editScope.blockId,
            currentText,
            nextText: String(req.body?.text || '').trim(),
            baseWorkingCopyHash: editScope.baseWorkingCopyHash,
            currentWorkingCopyHash,
        });
        if (!scopeValidation.ok) {
            const statusCode = scopeValidation.code === 'draft_working_copy_conflict' ? 409 : 403;
            res.status(statusCode).json({
                error: scopeValidation.code,
                message: localizeDiscussionRouteCopy(req, PARAGRAPH_SCOPE_ERROR_COPY_KEY[scopeValidation.code]),
                workingCopyHash: currentWorkingCopyHash,
            });
            return null;
        }

        return {
            mode: 'scoped_paragraph',
            currentText,
            currentUpdatedAt: post.updatedAt,
        };
    }

    async function ensureDraftDiscussionMutationAccess(
        req: any,
        res: any,
        postId: number,
        action: DraftDiscussionMutationAction,
    ) {
        const actor = await requireAuthenticatedActor(req, prisma, { requireSessionCookie: true });
        const access = await authorizeDraftActionForActor(prisma, {
            actor,
            postId,
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
        const authUserId = actor.userId;
        if (!authUserId || !circleId || circleId <= 0 || !access.circleActor) {
            res.status(409).json({
                error: 'draft_circle_required',
                message: 'draft discussion mutation requires a circle-bound draft',
            });
            return null;
        }

        if (action === 'propose' || action === 'resolve' || action === 'apply') {
            const permission = await resolveDraftWorkflowPermission(prisma, {
                circleId,
                actor: access.circleActor,
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
                actor: access.circleActor,
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
            actor,
            authUserId,
            circleId,
            circleActor: access.circleActor,
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

    async function ensureDraftDiscussionReviewContext(
        res: Response,
        draftPostId: number,
        thread: Awaited<ReturnType<typeof getDraftDiscussionThread>>,
    ): Promise<boolean> {
        const contexts = await loadDraftDiscussionReviewContexts(prisma, {
            draftPostId,
            threads: [thread],
        });
        const context = contexts[thread.id];
        if (context && context.state !== 'unavailable') return true;
        res.status(409).json({
            error: 'draft_discussion_review_context_unavailable',
            message: 'the creation snapshot, current stable snapshot, or target anchor is unavailable',
        });
        return false;
    }

    router.post('/sessions', async (req, res, next) => {
        try {
            const actor = await requireAuthenticatedActor(req, prisma, { requireSessionCookie: true });
            const bodySenderPubkey = String(req.body?.senderPubkey || '').trim();
            if (bodySenderPubkey && bodySenderPubkey !== actor.pubkey) {
                return res.status(403).json({
                    error: 'sender_pubkey_mismatch',
                    message: 'senderPubkey does not match authenticated actor',
                });
            }
            const senderPubkey = actor.pubkey;

            const senderHandleRaw = String(req.body?.senderHandle || '').trim();
            const senderHandle = (actor.displayName || senderHandleRaw || actor.handle).slice(0, 32) || null;

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
            if (sendAuthActorError(res, error)) return;
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

            const payload = parseDiscussionSessionTokenPayload(token, jwtSecret);
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

            const session = await loadValidDiscussionSessionById(prisma, payload.sessionId);
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

            const payload = parseDiscussionSessionTokenPayload(token, jwtSecret);
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

    router.get('/stream/export', async (req, res, next) => {
        try {
            const streamKey = String(req.query.streamKey || DISCUSSION_STREAM_KEY);
            const afterLamport = BigInt(parseNonNegativeInt(req.query.afterLamport as string, 0));
            const limit = Math.min(parsePositiveInt(req.query.limit as string, 200), 1000);
            const rows = await findOffchainDiscussionStreamExportMessages({
                prisma,
                streamKey,
                afterLamport,
                limit,
            });
            const signedMessageByEnvelopeId = new Map(rows.map((row) => [row.envelopeId, row.signedMessage || '']));
            const messages = (await mapDiscussionRowsForResponse(
                rows,
                resolveExpressRequestLocale(req),
                readViewerUserIdProjection(req),
            )).map((message) => ({
                ...message,
                signedMessage: signedMessageByEnvelopeId.get(message.envelopeId) || '',
            }));
            const batch = buildSignedDiscussionStreamBatchFromMessages(messages, {
                peerId: process.env.OFFCHAIN_DISCUSSION_SERVER_PEER_ID || '',
                deploymentId: process.env.ALCHEME_DEPLOYMENT_ID || 'local',
                streamKey,
                afterLamport: afterLamport.toString(),
                nextAfterLamport: rows.length > 0 ? String(rows[rows.length - 1].lamport) : afterLamport.toString(),
                signingSecretBase64: process.env.OFFCHAIN_DISCUSSION_SERVER_SIGNING_SECRET || '',
            });

            res.json(batch);
        } catch (error) {
            if (error instanceof OffchainExportSigningUnconfiguredError) {
                res.status(503).json({
                    ok: false,
                    code: 'offchain_export_signing_unconfigured',
                });
                return;
            }
            next(error);
        }
    });

    router.get('/stream', async (req, res, next) => {
        try {
            const streamKey = String(req.query.streamKey || DISCUSSION_STREAM_KEY);
            const afterLamport = BigInt(parseNonNegativeInt(req.query.afterLamport as string, 0));
            const limit = Math.min(parsePositiveInt(req.query.limit as string, 200), 1000);
            const includeDeleted = parseBool(req.query.includeDeleted as string, true);

            const rows = await findOffchainDiscussionStreamMessages({
                prisma,
                streamKey,
                afterLamport,
                limit,
                includeDeleted,
            });
                const messages = await mapDiscussionRowsForResponse(
                    rows,
                    resolveExpressRequestLocale(req),
                    readViewerUserIdProjection(req),
                );

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
                messages,
            });
        } catch (error) {
            next(error);
        }
    });

    router.get('/peers', async (_req, res, next) => {
        try {
            const configuredPeerTargets = resolveOffchainPeerSyncTargets();
            const rows = await prisma.$queryRaw<Array<{
                peerUrl: string;
                peerIdentity: string;
                lastRemoteLamport: bigint;
                lastSuccessAt: Date | null;
                lastError: string | null;
                updatedAt: Date;
            }>>`
                SELECT
                    peer_url AS "peerUrl",
                    peer_identity AS "peerIdentity",
                    last_remote_lamport AS "lastRemoteLamport",
                    last_success_at AS "lastSuccessAt",
                    last_error AS "lastError",
                    updated_at AS "updatedAt"
                FROM offchain_peer_sync_state
                ORDER BY peer_url ASC
            `;

            const rowMap = new Map(rows.map((row) => [`${row.peerUrl}\n${row.peerIdentity}`, row]));
            const peers = configuredPeerTargets.map((peer) => {
                const row = rowMap.get(`${peer.peerUrl}\n${peer.peerIdentity}`);
                return {
                    peerRef: buildPublicOffchainPeerRef(peer.peerUrl, peer.peerIdentity),
                    lastRemoteLamport: row ? Number(row.lastRemoteLamport) : 0,
                    lastSuccessAt: row?.lastSuccessAt?.toISOString() || null,
                    hasError: !!row?.lastError,
                    updatedAt: row?.updatedAt?.toISOString() || null,
                };
            });

            res.json({
                configuredPeerCount: configuredPeerTargets.length,
                configuredPeers: configuredPeerTargets.map((peer) => (
                    buildPublicOffchainPeerRef(peer.peerUrl, peer.peerIdentity)
                )),
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

            const rows = await findCircleDiscussionMessages({
                prisma,
                circleId,
                roomKey,
                limit,
                beforeLamport,
                afterLamport,
                includeDeleted,
            });
            const messages = await mapDiscussionRowsForResponse(
                rows,
                resolveExpressRequestLocale(req),
                readViewerUserIdProjection(req),
            );
            const watermark = await readOffchainWatermark(prisma);
            res.json({
                circleId,
                roomKey,
                count: rows.length,
                watermark: watermark
                    ? {
                        lastLamport: Number(watermark.lastLamport),
                        lastEnvelopeId: watermark.lastEnvelopeId,
                        lastIngestedAt: watermark.lastIngestedAt?.toISOString() || null,
                    }
                    : null,
                messages,
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
            const rows = await findCircleDiscussionMessagesByEnvelopeIds({
                prisma,
                circleId,
                roomKey,
                envelopeIds,
                includeDeleted,
            });
            const messages = await mapDiscussionRowsForResponse(rows, resolveExpressRequestLocale(req));

            res.json({
                circleId,
                roomKey,
                count: rows.length,
                messages,
            });
        } catch (error) {
            next(error);
        }
    });

    // Plaza discussion SSE: this stream reports changes for
    // circle_discussion_messages. It is not a LiveKit room stream and does not
    // read or write communication_messages.
    router.get('/circles/:id/stream', async (req, res, next) => {
        try {
            const circleId = parsePositiveInt(req.params.id, NaN);
            if (!Number.isFinite(circleId)) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            const afterLamport = parseOptionalLamport(req.query?.afterLamport as string | undefined, 'non_negative');
            if (afterLamport === 'invalid') {
                return res.status(400).json({ error: 'invalid_after_lamport' });
            }
            if (!redis || typeof (redis as Partial<Redis>).duplicate !== 'function') {
                return res.status(503).json({
                    error: 'discussion_realtime_unavailable',
                    message: 'discussion realtime stream is unavailable',
                });
            }

            res.status(200);
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            if (typeof (res as any).flushHeaders === 'function') {
                (res as any).flushHeaders();
            }

            let closed = false;
            let replaying = true;
            const deliveredEnvelopeIds = new Set<string>();
            const bufferedLiveEvents: Array<Parameters<typeof serializeDiscussionRealtimeSseEvent>[0]> = [];
            const sinkId = `sse:${circleId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
            const heartbeatTimer = setInterval(() => {
                if (closed) return;
                res.write(serializeDiscussionRealtimeHeartbeat());
            }, 15_000);

            const cleanup = () => {
                if (closed) return;
                closed = true;
                clearInterval(heartbeatTimer);
                void removeDiscussionRealtimeSink({ circleId, sinkId }).catch(() => undefined);
            };

            const markDelivered = (payload: Parameters<typeof serializeDiscussionRealtimeSseEvent>[0]) => {
                if (payload.envelopeId) {
                    deliveredEnvelopeIds.add(payload.envelopeId);
                }
            };
            const writePayload = (payload: Parameters<typeof serializeDiscussionRealtimeSseEvent>[0]) => {
                if (closed) return false;
                const accepted = res.write(serializeDiscussionRealtimeSseEvent(payload));
                if (accepted) markDelivered(payload);
                return accepted;
            };
            const drainBufferedLiveEvents = () => {
                replaying = false;
                const events = bufferedLiveEvents.splice(0).sort((left, right) => {
                    const leftLamport = typeof left.latestLamport === 'number' ? left.latestLamport : Number.MAX_SAFE_INTEGER;
                    const rightLamport = typeof right.latestLamport === 'number' ? right.latestLamport : Number.MAX_SAFE_INTEGER;
                    if (leftLamport !== rightLamport) return leftLamport - rightLamport;
                    return String(left.envelopeId || '').localeCompare(String(right.envelopeId || ''));
                });
                for (const event of events) {
                    if (event.envelopeId && deliveredEnvelopeIds.has(event.envelopeId)) continue;
                    writePayload(event);
                }
            };

            await addDiscussionRealtimeSink({
                redis: redis as Redis,
                circleId,
                sink: {
                    id: sinkId,
                    kind: 'sse',
                    sendRealtimePayload(payload) {
                        if (replaying) {
                            bufferedLiveEvents.push(payload);
                            return true;
                        }
                        return writePayload(payload);
                    },
                    close() {
                        cleanup();
                        if (typeof (res as any).end === 'function') {
                            (res as any).end();
                        }
                    },
                    bufferedAmount() {
                        const writable = res as Response & { writableLength?: number; writableNeedDrain?: boolean };
                        if (writable.writableNeedDrain) {
                            return DISCUSSION_REALTIME_MAX_BUFFERED_BYTES + 1;
                        }
                        return Number(writable.writableLength || 0);
                    },
                    queuedEvents() {
                        return bufferedLiveEvents.length;
                    },
                },
            });

            if (afterLamport !== null) {
                const replayRows = await findCircleDiscussionMessagesAfterLamport({
                    prisma,
                    circleId,
                    roomKey: buildDiscussionRoomKey(circleId),
                    afterLamport,
                    limit: 200,
                });
                const replayMessagesByEnvelope = new Map(
                    (await mapDiscussionRowsForResponse(replayRows, resolveExpressRequestLocale(req)))
                        .map((message) => [message.envelopeId, message]),
                );
                for (const row of replayRows) {
                    if (closed) break;
                    let replayMessage: ReturnType<typeof mapRowToDto> | null = null;
                    try {
                        replayMessage = (row as any).message ?? replayMessagesByEnvelope.get(row.envelopeId) ?? null;
                    } catch {
                        replayMessage = null;
                    }
                    res.write(serializeDiscussionRealtimeSseEvent({
                        circleId,
                        latestLamport: Number(row.lamport),
                        envelopeId: row.envelopeId,
                        reason: mapDiscussionReplayReason(row),
                        message: replayMessage,
                    }));
                    if (row.envelopeId) {
                        deliveredEnvelopeIds.add(row.envelopeId);
                    }
                }
            }
            drainBufferedLiveEvents();
            req.on('close', cleanup);
        } catch (error) {
            next(error);
        }
    });

    router.get('/knowledge/:knowledgeId/messages', async (req, res, next) => {
        try {
            const actor = await requireAuthenticatedActor(req, prisma, { requireSessionCookie: true });
            const knowledge = await loadKnowledgeDiscussionContext(req.params.knowledgeId);
            if (!knowledge) {
                return res.status(404).json({ error: 'knowledge_not_found' });
            }

            await requireCircleActorForAuthActor(actor, prisma, {
                circleId: knowledge.circleId,
                action: 'public.read',
                requireMemberChainPresence: false,
            });

            const roomKey = buildDiscussionRoomKey(knowledge.circleId);
            const limit = Math.min(parsePositiveInt(req.query.limit as string, 80), 200);
            const beforeLamportRaw = req.query.beforeLamport as string | undefined;
            const includeDeleted = parseBool(req.query.includeDeleted as string, false);
            const beforeLamport = beforeLamportRaw ? BigInt(parsePositiveInt(beforeLamportRaw, 0)) : null;

            const rows = await findKnowledgeDiscussionMessages({
                prisma,
                circleId: knowledge.circleId,
                knowledgeId: knowledge.knowledgeId,
                roomKey,
                limit,
                beforeLamport,
                includeDeleted,
            });
            const messages = await mapDiscussionRowsForResponse(rows, resolveExpressRequestLocale(req));
            const watermark = await readOffchainWatermark(prisma);
            res.json({
                knowledgeId: knowledge.knowledgeId,
                circleId: knowledge.circleId,
                roomKey,
                count: rows.length,
                watermark: watermark
                    ? {
                        lastLamport: Number(watermark.lastLamport),
                        lastEnvelopeId: watermark.lastEnvelopeId,
                        lastIngestedAt: watermark.lastIngestedAt?.toISOString() || null,
                    }
                    : null,
                messages,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
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
            await assertCanonicalKnowledgePublicationRoute(prisma, postId);

            let assessmentProof: Awaited<ReturnType<typeof resolvePreparedContributionAssessmentProof>> | null = null;
            const proof = serviceConfig.contributionAssessment.rolloutMode === 'legacy'
                ? await getDraftContributorProof(prisma, postId)
                : (assessmentProof = await resolvePreparedContributionAssessmentProof(postId)).contributorProof;
            return res.json({
                ok: true,
                mode: draftStrictBindingMode,
                proof,
                contributionAssessment: serializeContributionAssessmentPreparation(
                    assessmentProof?.preparation ?? null,
                    assessmentProof?.warning ?? null,
                ),
            });
        } catch (error) {
            if (error instanceof ContributionAssessmentProofEndpointError) {
                return res.status(error.statusCode).json(error.responseBody);
            }
            if (
                error instanceof DraftWorkflowStateError
                && error.code === 'crystallization_routing_receipt_required'
            ) {
                return res.status(409).json({
                    ok: false,
                    error: error.code,
                    message: error.message,
                    mode: draftStrictBindingMode,
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

    router.get('/drafts/:postId/contribution-assessment', async (req, res, next) => {
        try {
            const postId = parsePositiveInt(req.params.postId, NaN);
            if (!Number.isFinite(postId)) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }
            const access = await ensureDraftAccessFromRequest(req, res, postId, 'read');
            if (!access) return;

            const rawAssessmentId = Array.isArray(req.query.assessmentId)
                ? req.query.assessmentId[0]
                : req.query.assessmentId;
            const prepared = await prepareDraftContributionAssessment(prisma, {
                draftPostId: postId,
                assessmentId: typeof rawAssessmentId === 'string' ? rawAssessmentId : null,
            });
            return res.json({
                ok: true,
                mode: draftStrictBindingMode,
                ...prepared,
                contributionAssessment: serializeContributionAssessmentRead(prepared),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof ContributionAssessmentDecisionError) {
                return res.status(error.statusCode).json(error.toResponseBody());
            }
            next(error);
        }
    });

    router.get('/drafts/:postId/contribution-trace', async (req, res, next) => {
        try {
            const postId = parsePositiveInt(req.params.postId, NaN);
            if (!Number.isFinite(postId)) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }
            const access = await ensureDraftAccessFromRequest(req, res, postId, 'read');
            if (!access) return;

            const trace = await loadDraftContributionTrace(prisma, {
                draftPostId: postId,
            });
            const reviewRequired = trace.gate?.state === 'high_penetration_needs_review';
            const reviewPolicy = getHighPenetrationReviewPolicy();
            const viewerRole = access.circleActor?.membership.role ?? null;
            const reviewAllowed = reviewPolicy.confirmationAuthority === 'circle_manager'
                ? viewerRole === 'Owner' || viewerRole === 'Admin'
                : viewerRole === 'Owner';
            return res.json({
                ...trace,
                reviewAuthorization: reviewRequired
                    ? {
                        allowed: reviewAllowed,
                        requiredAuthority: reviewPolicy.confirmationAuthority,
                        viewerRole,
                    }
                    : null,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            next(error);
        }
    });

    router.post('/drafts/:postId/contribution-assessment/decisions', async (req, res, next) => {
        try {
            const postId = parsePositiveInt(req.params.postId, NaN);
            if (!Number.isFinite(postId)) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }
            const access = await ensureDraftAccessFromRequest(req, res, postId, 'read');
            if (!access) return;

            const decisionType = String(req.body?.decisionType || '').trim();
            if (decisionType === 'supersede_assessment') {
                return res.status(400).json({
                    error: 'contribution_assessment_decision_not_public',
                    message: 'superseding contribution assessments is not a public draft action',
                });
            }
            if (decisionType === 'continue_with_fallback') {
                return res.status(409).json({
                    error: 'contribution_assessment_fallback_continuation_removed',
                    message: 'fallback contribution allocation cannot be used for proof binding',
                });
            }

            let authority: 'draft_reader' | 'circle_owner' | 'circle_manager' = 'draft_reader';
            if (decisionType === 'confirm_high_penetration' || decisionType === 'reject_high_penetration') {
                const circleId = access.post?.circleId ?? null;
                if (!circleId) {
                    return res.status(409).json({
                        error: 'contribution_assessment_circle_required',
                        message: 'circle-scoped authority is required for high-penetration contribution decisions',
                    });
                }
                const reviewPolicy = getHighPenetrationReviewPolicy();
                if (reviewPolicy.confirmationAuthority === 'circle_manager') {
                    await requireCircleManagerForActor(prisma, {
                        actor: access.actor,
                        circleId,
                    });
                    authority = 'circle_manager';
                } else {
                    await requireCircleOwnerForActor(prisma, {
                        actor: access.actor,
                        circleId,
                    });
                    authority = 'circle_owner';
                }
            }

            const result = await recordContributionAssessmentDecision(prisma, {
                draftPostId: postId,
                assessmentId: req.body?.assessmentId ?? null,
                decisionType,
                candidateId: req.body?.candidateId ?? null,
                actorUserId: access.actor.userId,
                actorPubkey: access.actor.pubkey,
                reason: req.body?.reason ?? null,
                affectedRefs: req.body?.affectedRefs ?? null,
                authority,
            });
            return res.json({
                ok: true,
                mode: draftStrictBindingMode,
                ...result,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof ContributionAssessmentDecisionError) {
                return res.status(error.statusCode).json(error.toResponseBody());
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
            await assertCanonicalKnowledgePublicationRoute(prisma, postId);

            let contributionAssessmentPreparation: ContributionAssessmentProofPreparation | null = null;
            let contributionAssessmentWarning: { code: string; message: string } | null = null;
            let effectiveContributorProof: DraftContributorProofRecord | null = null;
            if (serviceConfig.contributionAssessment.rolloutMode === 'legacy') {
                effectiveContributorProof = await getDraftContributorProof(prisma, postId);
            } else {
                try {
                    const assessmentProof = await resolvePreparedContributionAssessmentProof(postId);
                    contributionAssessmentPreparation = assessmentProof.preparation;
                    contributionAssessmentWarning = assessmentProof.warning;
                    effectiveContributorProof = assessmentProof.contributorProof;
                } catch (error) {
                    if (error instanceof ContributionAssessmentProofEndpointError) {
                        return res.status(error.statusCode).json(error.responseBody);
                    }
                    throw error;
                }
            }
            if (!effectiveContributorProof) {
                return res.status(409).json({
                    ok: false,
                    error: 'contribution_assessment_proof_unavailable',
                    message: 'contribution assessment proof is unavailable',
                    mode: draftStrictBindingMode,
                    contributionAssessment: serializeContributionAssessmentPreparation(
                        contributionAssessmentPreparation,
                        contributionAssessmentWarning,
                    ),
                });
            }
            const stableEvidence = await resolveStableSnapshotCollabEvidence(postId, prisma);

            const discussionResolutionRefs = await loadDraftDiscussionResolutionRefs(postId);
            const generatedAt = resolveProofPackageGeneratedAt({
                anchoredAt: (stableEvidence.anchor as any).anchoredAt ?? null,
                createdAt: (stableEvidence.anchor as any).createdAt ?? null,
                updatedAt: (stableEvidence.anchor as any).updatedAt ?? null,
            });
            const proofPackage = buildCanonicalProofPackageV2({
                contributorProof: effectiveContributorProof,
                collabEditAnchorId: stableEvidence.anchor.anchorId,
                discussionResolutionRefs,
                generatedAt,
            });
            let issuance: ReturnType<typeof issueProofPackageSignature>;
            let persistedProofPackage: Awaited<
                ReturnType<typeof persistCurrentDraftProofPackageIssuance>
            > | null = null;
            const contributionAssessmentResponse = serializeContributionAssessmentPreparation(
                contributionAssessmentPreparation,
                contributionAssessmentWarning,
            );
            try {
                issuance = issueProofPackageSignature({
                    proof_package_hash: proofPackage.proof_package_hash,
                    contributors_root: proofPackage.canonical_proof_package.root,
                    contributors_count: proofPackage.canonical_proof_package.count,
                    source_anchor_id: proofPackage.canonical_proof_package.draft_anchor,
                    binding_version: PROOF_PACKAGE_BINDING_VERSION,
                    generated_at: proofPackage.canonical_proof_package.generated_at,
                });
                persistedProofPackage = await prisma.$transaction((db) =>
                    persistCurrentDraftProofPackageIssuance(
                        postId,
                        db,
                        {
                            proofPackageHash: proofPackage.proof_package_hash,
                            sourceAnchorId: proofPackage.canonical_proof_package.draft_anchor,
                            contributorsRoot: proofPackage.canonical_proof_package.root,
                            contributorsCount: proofPackage.canonical_proof_package.count,
                            bindingVersion: PROOF_PACKAGE_BINDING_VERSION,
                            generatedAt: proofPackage.canonical_proof_package.generated_at,
                            issuerKeyId: issuance.issuer_key_id,
                            issuedSignature: issuance.issued_signature,
                            proofPackage: proofPackage.canonical_proof_package as unknown as Prisma.JsonValue,
                        },
                        {
                            contributorProof: effectiveContributorProof,
                            contributionAssessmentId: contributionAssessmentPreparation?.assessment?.id ?? null,
                        },
                    ));
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
                        ...(contributionAssessmentResponse
                            ? { contributionAssessment: contributionAssessmentResponse }
                            : {}),
                        warning,
                    });
                }
                throw error;
            }
            if (!persistedProofPackage) {
                throw new Error('proof_package_persist_failed');
            }

            return res.json({
                ok: true,
                mode: draftStrictBindingMode,
                draftPostId: postId,
                root: persistedProofPackage.contributorsRoot,
                count: persistedProofPackage.contributorsCount,
                proof_package_hash: persistedProofPackage.proofPackageHash,
                source_anchor_id: persistedProofPackage.sourceAnchorId,
                binding_version: persistedProofPackage.bindingVersion,
                generated_at: persistedProofPackage.generatedAt,
                issuer_key_id: persistedProofPackage.issuerKeyId,
                issued_signature: persistedProofPackage.issuedSignature,
                proofPackage: proofPackage.canonical_proof_package,
                ...(contributionAssessmentResponse
                    ? { contributionAssessment: contributionAssessmentResponse }
                    : {}),
            });
        } catch (error) {
            if (error instanceof DraftWorkflowStateError) {
                if (error.code === 'crystallization_routing_receipt_required') {
                    return res.status(409).json({
                        ok: false,
                        error: error.code,
                        message: error.message,
                        mode: draftStrictBindingMode,
                    });
                }
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
                if (error.code === 'crystallization_routing_receipt_required') {
                    return res.status(409).json({
                        ready: false,
                        reason: error.code,
                        error: error.code,
                        message: error.message,
                        mode: draftStrictBindingMode,
                    });
                }
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

    router.post('/drafts/:postId/publication-license/prepare', async (req, res, next) => {
        try {
            const postId = parsePositiveInt(req.params.postId, NaN);
            if (!Number.isFinite(postId)) return res.status(400).json({ error: 'invalid_post_id' });
            const access = await ensureDraftAccessFromRequest(req, res, postId, 'read');
            if (!access) return;
            const prepared = await prepareKnowledgePublicationAuthorization({
                prisma,
                draftPostId: postId,
                actorPubkey: access.actor.pubkey,
                title: req.body?.title,
                description: req.body?.description,
                contentHash: req.body?.contentHash,
            });
            return res.json({ ok: true, ...prepared });
        } catch (error) {
            if (error instanceof KnowledgePublicationLicenseError) {
                return res.status(error.statusCode).json({ error: error.code, message: error.message });
            }
            next(error);
        }
    });

    router.post('/drafts/:postId/publication-license/accept', async (req, res, next) => {
        try {
            const postId = parsePositiveInt(req.params.postId, NaN);
            if (!Number.isFinite(postId)) return res.status(400).json({ error: 'invalid_post_id' });
            const access = await ensureDraftAccessFromRequest(req, res, postId, 'read');
            if (!access) return;
            const prepared = await acceptKnowledgePublicationLicense({
                prisma,
                draftPostId: postId,
                actorPubkey: access.actor.pubkey,
                title: req.body?.title,
                description: req.body?.description,
                contentHash: req.body?.contentHash,
                signedMessage: String(req.body?.signedMessage || ''),
                signature: String(req.body?.signature || ''),
                nonce: String(req.body?.nonce || ''),
                expiresAt: String(req.body?.expiresAt || ''),
            });
            return res.json({ ok: true, ...prepared });
        } catch (error) {
            if (error instanceof KnowledgePublicationLicenseError) {
                return res.status(error.statusCode).json({ error: error.code, message: error.message });
            }
            next(error);
        }
    });

    router.post('/drafts/:postId/publication-authorization', async (req, res, next) => {
        try {
            const postId = parsePositiveInt(req.params.postId, NaN);
            if (!Number.isFinite(postId)) return res.status(400).json({ error: 'invalid_post_id' });
            const access = await ensureDraftAccessFromRequest(req, res, postId, 'read');
            if (!access) return;
            const permitted = await ensureDraftCrystallizationWorkflowPermissionFromAccess(req, res, access, {
                messageKey: 'draft.crystallization.missingCircleContextRegister',
            });
            if (!permitted) return;
            const prepared = await authorizeKnowledgePublicationAttempt({
                prisma,
                draftPostId: postId,
                actorPubkey: access.actor.pubkey,
                title: req.body?.title,
                description: req.body?.description,
                contentHash: req.body?.contentHash,
                knowledgeOnChainAddress: req.body?.knowledgePda,
            });
            return res.json({ ok: true, ...prepared });
        } catch (error) {
            if (error instanceof KnowledgePublicationLicenseError) {
                return res.status(error.statusCode).json({ error: error.code, message: error.message });
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
            const authUserId = access.authUserId;
            if (!authUserId || !circleId || !access.circleActor) {
                return res.status(403).json({
                    error: 'draft_crystallize_permission_denied',
                    message: localizeQueryApiCopy('draft.crystallization.missingCircleContextRegister', resolveExpressRequestLocale(req)),
                });
            }
            const permission = await resolveDraftWorkflowPermission(prisma, {
                circleId,
                actor: access.circleActor,
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
            await assertCanonicalKnowledgePublicationRoute(prisma, postId);

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

            await requireAuthorizedKnowledgePublicationAttempt({
                prisma,
                draftPostId: postId,
                proofPackageHash,
                knowledgeOnChainAddress: knowledgePda,
            });

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
            if (error instanceof KnowledgePublicationLicenseError) {
                return res.status(error.statusCode).json({
                    error: error.code,
                    message: error.message,
                });
            }
            if (error instanceof DraftWorkflowStateError) {
                return res.status(error.statusCode).json({
                    error: error.code,
                    message: error.message,
                });
            }
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
            const authUserId = access.authUserId;
            if (!authUserId || !circleId || !access.circleActor) {
                return res.status(403).json({
                    error: 'draft_crystallize_permission_denied',
                    message: localizeQueryApiCopy('draft.crystallization.missingCircleContextBinding', resolveExpressRequestLocale(req)),
                });
            }
            const permission = await resolveDraftWorkflowPermission(prisma, {
                circleId,
                actor: access.circleActor,
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
            await assertCanonicalKnowledgePublicationRoute(prisma, postId);
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
            const contributionAssessmentEnabled =
                serviceConfig.contributionAssessment.rolloutMode !== 'legacy';
            const requiresProofSnapshot =
                draftStrictBindingMode === 'enforce' || contributionAssessmentEnabled;
            const bindingProofEnforcementMode =
                contributionAssessmentEnabled ? 'enforce' : draftStrictBindingMode;
            const bindingModeMetadata = {
                proofBindingMode: bindingProofEnforcementMode,
                contributionAssessmentMode: serviceConfig.contributionAssessment.rolloutMode,
            };
            const requiresAtomicProofBinding =
                draftStrictBindingMode === 'enforce' || contributionAssessmentEnabled;
            const proofSnapshot = (
                hasProofSnapshotInput || requiresProofSnapshot
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
            if ((hasProofSnapshotInput || requiresProofSnapshot) && (
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
            if (!validatedProofSnapshot) {
                return res.status(409).json({
                    error: 'knowledge_publication_proof_package_required',
                    message: 'Public Knowledge release requires the current signed proof package',
                });
            }
            let effectiveKnowledgePda = knowledgePda;
            let currentCrystallizationAttemptStatus: string | null = null;
            let publicationPreparation: PreparedKnowledgePublicationAuthorization | null = null;
            if (validatedProofSnapshot?.proofPackageHash) {
                const authorizedAttempt = await requireAuthorizedKnowledgePublicationAttempt({
                    prisma,
                    draftPostId: postId,
                    proofPackageHash: validatedProofSnapshot.proofPackageHash,
                    knowledgeOnChainAddress: knowledgePda,
                });
                const authorization = authorizedAttempt.publicationAuthorization as unknown as {
                    title?: string;
                    description?: string;
                    contentHash?: string;
                };
                publicationPreparation = await prepareKnowledgePublicationAuthorization({
                    prisma,
                    draftPostId: postId,
                    actorPubkey: access.actor.pubkey,
                    title: authorization.title || '',
                    description: authorization.description || '',
                    contentHash: authorization.contentHash || '',
                });
                if (
                    publicationPreparation.authorizationDigest
                    !== authorizedAttempt.publicationAuthorizationDigest
                    || publicationPreparation.missingContributorPubkeys.length > 0
                ) {
                    return res.status(409).json({
                        error: 'knowledge_publication_authorization_stale',
                    });
                }
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
            let contributionAssessmentForBinding: ContributionAssessmentProofPreparation | null = null;
            if (
                contributionAssessmentEnabled
                && validatedProofSnapshot
            ) {
                try {
                    contributionAssessmentForBinding = await prepareContributionAssessmentProofForDraft({
                        prisma,
                        draftPostId: postId,
                    });
                } catch (error) {
                    return res.status(409).json({
                        error: 'contribution_assessment_prepare_failed',
                        message: error instanceof Error ? error.message : String(error),
                        mode: bindingProofEnforcementMode,
                        ...bindingModeMetadata,
                    });
                }
                if (isContributionAssessmentReviewRequiredGate(contributionAssessmentForBinding.gate)) {
                    return res.status(409).json({
                        error: 'contribution_assessment_review_required',
                        message: 'contribution assessment requires review before proof binding',
                        mode: bindingProofEnforcementMode,
                        ...bindingModeMetadata,
                        contributionAssessment:
                            serializeContributionAssessmentPreparation(contributionAssessmentForBinding),
                    });
                }
                if (!contributionAssessmentForBinding.contributorProof) {
                    return res.status(409).json({
                        error: 'contribution_assessment_proof_unavailable',
                        message: 'contribution assessment proof is unavailable',
                        mode: bindingProofEnforcementMode,
                        ...bindingModeMetadata,
                        contributionAssessment:
                            serializeContributionAssessmentPreparation(contributionAssessmentForBinding),
                    });
                }
                if (
                    validatedProofSnapshot.sourceAnchorId !== contributionAssessmentForBinding.contributorProof.anchorId
                    || validatedProofSnapshot.contributorsRoot !== contributionAssessmentForBinding.contributorProof.rootHex
                    || validatedProofSnapshot.contributorsCount !== contributionAssessmentForBinding.contributorProof.count
                ) {
                    return res.status(409).json({
                        error: 'contribution_assessment_proof_mismatch',
                        message: 'request proof snapshot does not match the resolved contribution assessment proof',
                        mode: bindingProofEnforcementMode,
                        ...bindingModeMetadata,
                        contributionAssessment:
                            serializeContributionAssessmentPreparation(contributionAssessmentForBinding),
                    });
                }
            }

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
                if (!publicationPreparation) {
                    throw new KnowledgePublicationLicenseError(
                        'knowledge_publication_authorization_required',
                        409,
                    );
                }
                await publishAuthorizedKnowledgeVersion({
                    prisma,
                    draftPostId: postId,
                    proofPackageHash: input.proofPackageHash,
                    knowledgeOnChainAddress: effectiveKnowledgePda,
                    knowledgeId: input.knowledgeId,
                    sourceSnapshot: publicationPreparation.sourceSnapshot,
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

            const syncCrystalEntitlementsForKnowledge = async (knowledgeId: string) => {
                await upsertCrystalEntitlementsForKnowledge(prisma as any, {
                    knowledgePublicId: knowledgeId,
                });
            };

            if (requiresAtomicProofBinding) {
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
                            contributorProof: contributionAssessmentForBinding?.contributorProof || undefined,
                        });
                        let persistedIssuance;
                        try {
                            persistedIssuance = await persistCurrentDraftProofPackageIssuance(
                                postId,
                                tx,
                                validatedProofSnapshot || undefined,
                                contributionAssessmentForBinding
                                    ? {
                                        contributorProof: contributionAssessmentForBinding.contributorProof,
                                        contributionAssessmentId: contributionAssessmentForBinding.assessment?.id ?? null,
                                    }
                                    : undefined,
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
                    await syncCrystalEntitlementsForKnowledge(atomicResult.synced.knowledgeId);
                    await finalizeLifecycleAndAttempt({
                        proofPackageHash: atomicResult.persistedIssuance.proofPackageHash,
                    });

                    return res.json({
                        ok: true,
                        draftPostId: postId,
                        knowledgePda: effectiveKnowledgePda,
                        policyProfileDigest,
                        mode: bindingProofEnforcementMode,
                        ...bindingModeMetadata,
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
                            mode: bindingProofEnforcementMode,
                            code: mapped.code,
                            message: mapped.message,
                            enforceStatusCode: mapped.statusCode,
                        });
                        return res.status(decision.statusCode || mapped.statusCode).json({
                            error: decision.error?.code || mapped.code,
                            message: decision.error?.message || mapped.message,
                            mode: bindingProofEnforcementMode,
                            ...bindingModeMetadata,
                            details: decision.error?.details || null,
                        });
                    }
                    const mapped = mapContributionSyncError(error);
                    if (!isBusinessStatusCode(mapped.statusCode)) {
                        throw error;
                    }
                    const normalized = resolveContributionSyncViolation(mapped);
                    const decision = evaluateDraftStrictBindingViolation({
                        mode: bindingProofEnforcementMode,
                        code: normalized.code,
                        message: normalized.message,
                        enforceStatusCode: normalized.statusCode,
                        details: normalized.details,
                    });
                    return res.status(decision.statusCode || normalized.statusCode).json({
                        error: decision.error?.code || normalized.code,
                        message: decision.error?.message || normalized.message,
                        mode: bindingProofEnforcementMode,
                        ...bindingModeMetadata,
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
                    contributorProof: contributionAssessmentForBinding?.contributorProof || undefined,
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
                        ...bindingModeMetadata,
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
                const persisted = await persistCurrentDraftProofPackageIssuance(
                    postId,
                    prisma,
                    contributionAssessmentForBinding ? validatedProofSnapshot || undefined : undefined,
                    contributionAssessmentForBinding
                        ? {
                            contributorProof: contributionAssessmentForBinding.contributorProof,
                            contributionAssessmentId: contributionAssessmentForBinding.assessment?.id ?? null,
                        }
                        : undefined,
                );
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
                await syncCrystalEntitlementsForKnowledge(binding.knowledgeId);
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
                        ...bindingModeMetadata,
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
                ...bindingModeMetadata,
                contributionSnapshot,
                proofPackageIssuance,
                ...binding,
            });
        } catch (error) {
            if (error instanceof KnowledgePublicationLicenseError) {
                return res.status(error.statusCode).json({
                    error: error.code,
                    message: error.message,
                });
            }
            if (error instanceof DraftWorkflowStateError) {
                return res.status(error.statusCode).json({
                    error: error.code,
                    message: error.message,
                });
            }
            if (error instanceof CrystallizationBindingError) {
                return res.status(error.statusCode).json({
                    error: error.code,
                    message: error.message,
                    details: error.details || null,
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
            if (!isDraftReviewIssueWindowOpen(lifecycle)) {
                return res.status(409).json({
                    error: 'draft_discussion_requires_review_stage',
                    message: localizeDiscussionRouteCopy(req, 'draft.discussion.reviewStageRequired'),
                });
            }
            const targetVersion = resolveCurrentStableDraftVersion(lifecycle);
            if (!targetVersion) {
                return res.status(409).json({
                    error: 'draft_stable_snapshot_required',
                    message: localizeDiscussionRouteCopy(req, 'draft.discussion.stableSnapshotRequired'),
                });
            }
            const stableSnapshot = await loadDraftVersionSnapshot(prisma, {
                draftPostId: postId,
                draftVersion: targetVersion,
            });
            if (!stableSnapshot) {
                return res.status(409).json({
                    error: 'draft_stable_snapshot_required',
                    message: localizeDiscussionRouteCopy(req, 'draft.discussion.stableSnapshotRequired'),
                });
            }

            const thread = await createDraftDiscussionThread(prisma, {
                draftPostId: postId,
                actorUserId: access.authUserId,
                targetType: req.body?.targetType,
                targetRef: req.body?.targetRef,
                targetVersion,
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
            const lifecycle = await resolveDraftLifecycleReadModel(prisma, {
                draftPostId: postId,
            });
            if (!isDraftReviewIssueWindowOpen(lifecycle)) {
                return res.status(409).json({
                    error: 'draft_discussion_requires_review_stage',
                    message: localizeDiscussionRouteCopy(req, 'draft.discussion.reviewStageRequired'),
                });
            }

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
                actor: access.circleActor,
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
            if (!await ensureDraftDiscussionReviewContext(res, postId, currentThread)) return;
            const nextIssueType = typeof req.body?.issueType === 'string'
                ? String(req.body.issueType).trim()
                : '';
            if (nextIssueType && nextIssueType !== currentThread.issueType) {
                const permission = await resolveDraftWorkflowPermission(prisma, {
                    circleId: access.circleId,
                    actor: access.circleActor,
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
            if (!await ensureDraftDiscussionReviewContext(res, postId, currentThread)) return;
            const nextIssueType = typeof req.body?.issueType === 'string'
                ? String(req.body.issueType).trim()
                : '';
            if (nextIssueType && nextIssueType !== currentThread.issueType) {
                const permission = await resolveDraftWorkflowPermission(prisma, {
                    circleId: access.circleId,
                    actor: access.circleActor,
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
            const currentThread = await getDraftDiscussionThread(prisma, {
                draftPostId: postId,
                threadId,
            });
            if (!await ensureDraftDiscussionReviewContext(res, postId, currentThread)) return;
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
            const reviewContexts = await loadDraftDiscussionReviewContexts(prisma, {
                draftPostId: postId,
                threads,
            });

            return res.json({
                ok: true,
                draftPostId: postId,
                viewerUserId: access.authUserId,
                count: threads.length,
                threads: threads.map((thread) => ({
                    ...thread,
                    reviewContext: reviewContexts[thread.id],
                })),
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
            const access = await resolveDraftContentWriteAccess(req, res, postId);
            if (!access) return;
            const paragraphDelete = parseDraftParagraphDelete(req.body);
            const preserveStructure = req.body?.preserveStructure === true;
            const appendParagraph = req.body?.appendParagraph === true;
            if (preserveStructure && appendParagraph) {
                return res.status(400).json({ error: 'draft_edit_mode_invalid' });
            }
            if (paragraphDelete && access.mode !== 'full') {
                return res.status(403).json({
                    error: 'draft_paragraph_delete_permission_denied',
                    message: localizeDiscussionRouteCopy(req, 'draft.scopedEdit.permissionRequired'),
                });
            }
            if ((preserveStructure || appendParagraph) && access.mode !== 'full') {
                return res.status(403).json({ error: 'draft_document_edit_permission_denied' });
            }
            if (preserveStructure && access.currentText !== undefined) {
                const currentParagraphs = splitDraftParagraphs(access.currentText);
                const nextParagraphs = splitDraftParagraphs(text);
                if (currentParagraphs.length !== nextParagraphs.length) {
                    return res.status(409).json({ error: 'draft_paragraph_count_changed' });
                }
            }
            if (appendParagraph && access.currentText !== undefined) {
                const currentText = access.currentText.trim();
                const appendPrefix = `${currentText}\n\n`;
                const appendedText = text.startsWith(appendPrefix)
                    ? text.slice(appendPrefix.length).trim()
                    : '';
                if (
                    !appendedText
                    || splitDraftParagraphs(appendedText).length !== 1
                    || splitDraftParagraphs(text).length !== splitDraftParagraphs(currentText).length + 1
                ) {
                    return res.status(409).json({ error: 'draft_append_paragraph_invalid' });
                }
            }

            const updateInput = {
                postId,
                text,
                precondition: access.currentText !== undefined
                    && access.currentUpdatedAt !== undefined
                    ? {
                        expectedText: access.currentText,
                        expectedUpdatedAt: access.currentUpdatedAt,
                    }
                    : undefined,
            };
            const structureResult = (paragraphDelete || preserveStructure)
                ? await prisma.$transaction(async (tx) => {
                    const locked = await lockDraftParagraphStructure(tx, postId);
                    if (!locked) {
                        return { outcome: 'missing' as const };
                    }
                    if (locked.documentStatus !== 'drafting') {
                        return { outcome: 'stage_changed' as const };
                    }
                    if (
                        preserveStructure
                        && splitDraftParagraphs(locked.text).length !== splitDraftParagraphs(text).length
                    ) {
                        return { outcome: 'paragraph_count_changed' as const };
                    }
                    const dependencies = await listDraftParagraphStructureDependencies(tx, postId);
                    const blockingDependencies = paragraphDelete
                        ? dependencies.filter((dependency) => dependency !== 'draft_comment')
                        : dependencies;
                    if (blockingDependencies.length > 0) {
                        return { outcome: 'blocked' as const, dependencies: blockingDependencies };
                    }
                    const persisted = await updateDraftContentAndHeat(tx, updateInput);
                    if (paragraphDelete && !persisted.preconditionFailed && persisted.changed) {
                        await remapDraftCommentLineRefsAfterParagraphDelete(tx, {
                            postId,
                            deletedParagraphIndex: paragraphDelete.index,
                        });
                    }
                    return { outcome: 'updated' as const, persisted };
                })
                : null;
            if (structureResult?.outcome === 'missing') {
                return res.status(404).json({ error: 'draft_not_found' });
            }
            if (structureResult?.outcome === 'stage_changed') {
                return res.status(409).json({ error: 'draft_content_edit_requires_drafting' });
            }
            if (structureResult?.outcome === 'paragraph_count_changed') {
                return res.status(409).json({ error: 'draft_paragraph_count_changed' });
            }
            if (structureResult?.outcome === 'blocked') {
                return res.status(409).json({
                    error: paragraphDelete
                        ? 'draft_paragraph_delete_dependency_conflict'
                        : 'draft_document_edit_dependency_conflict',
                    message: paragraphDelete
                        ? 'This paragraph structure is referenced by review or edit-permission records and cannot be deleted.'
                        : 'This paragraph structure is referenced by review or edit-permission records; use paragraph-scoped editing instead.',
                    dependencies: structureResult.dependencies,
                });
            }
            const updated = structureResult?.outcome === 'updated'
                ? structureResult.persisted
                : await updateDraftContentAndHeat(prisma, updateInput);
            if (updated.preconditionFailed) {
                return res.status(409).json({
                    error: 'draft_working_copy_conflict',
                    message: localizeDiscussionRouteCopy(req, 'draft.scopedEdit.workingCopyConflict'),
                    workingCopyHash: sha256Hex(String(updated.currentText || '')),
                });
            }

            return res.json({
                ok: true,
                draftPostId: updated.id,
                status: updated.status,
                updatedAt: updated.updatedAt.toISOString(),
                heatScore: Number(updated.heatScore ?? 0),
                changed: updated.changed,
                workingCopyHash: sha256Hex(String(updated.currentText || text)),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            next(error);
        }
    });

    router.post('/drafts/:postId/title', async (req, res, next) => {
        try {
            const postId = parsePositiveInt(req.params.postId, NaN);
            if (!Number.isFinite(postId)) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }
            let title: string | null;
            try {
                title = normalizeDraftTitle(req.body?.title);
            } catch {
                return res.status(400).json({ error: 'draft_title_invalid' });
            }
            const expectedTitle = typeof req.body?.expectedTitle === 'string'
                ? req.body.expectedTitle.trim().replace(/\s+/g, ' ')
                : '';
            if (!title || !expectedTitle) {
                return res.status(400).json({ error: 'draft_title_precondition_required' });
            }

            const actor = await requireAuthenticatedActor(req, prisma, { requireSessionCookie: true });
            const access = await authorizeDraftActionForActor(prisma, {
                actor,
                postId,
                action: 'edit',
            });
            if (!access.allowed) {
                return res.status(access.statusCode).json({
                    error: access.error,
                    message: access.message,
                });
            }
            const lifecycle = await resolveDraftLifecycleReadModel(prisma, { draftPostId: postId });
            if (lifecycle.documentStatus !== 'drafting') {
                return res.status(409).json({ error: 'draft_title_edit_requires_drafting' });
            }
            const result = await prisma.$transaction(async (tx) => {
                const locked = await lockDraftParagraphStructure(tx, postId);
                if (!locked) return { outcome: 'missing' as const };
                if (locked.documentStatus !== 'drafting') {
                    return { outcome: 'stage_changed' as const };
                }
                const post = await tx.post.findUnique({
                    where: { id: postId },
                    select: {
                        id: true,
                        status: true,
                        text: true,
                        draftTitle: true,
                        updatedAt: true,
                    },
                });
                if (!post) return { outcome: 'missing' as const };
                if (String(post.status) !== 'Draft') {
                    return { outcome: 'not_draft' as const };
                }
                const currentTitle = resolveDraftTitle({
                    draftTitle: post.draftTitle,
                    text: post.text,
                    draftPostId: post.id,
                });
                if (currentTitle !== expectedTitle) {
                    return {
                        outcome: 'conflict' as const,
                        currentTitle,
                        updatedAt: post.updatedAt,
                    };
                }
                const updated = await tx.post.updateMany({
                    where: {
                        id: postId,
                        status: 'Draft' as any,
                        draftTitle: post.draftTitle,
                        updatedAt: post.updatedAt,
                    },
                    data: { draftTitle: title },
                });
                if (updated.count !== 1) return { outcome: 'conflict' as const };
                const readback = await tx.post.findUnique({
                    where: { id: postId },
                    select: { draftTitle: true, text: true, updatedAt: true },
                });
                return readback
                    ? { outcome: 'updated' as const, readback }
                    : { outcome: 'missing' as const };
            });
            if (result.outcome === 'missing') {
                return res.status(404).json({ error: 'draft_not_found' });
            }
            if (result.outcome === 'stage_changed') {
                return res.status(409).json({ error: 'draft_title_edit_requires_drafting' });
            }
            if (result.outcome === 'not_draft') {
                return res.status(409).json({ error: 'not_draft_status' });
            }
            if (result.outcome === 'conflict') {
                if ('currentTitle' in result && result.currentTitle && result.updatedAt) {
                    return res.status(409).json({
                        error: 'draft_title_conflict',
                        currentTitle: result.currentTitle,
                        updatedAt: result.updatedAt.toISOString(),
                    });
                }
                return res.status(409).json({
                    error: 'draft_title_conflict',
                });
            }
            const { readback } = result;
            return res.json({
                ok: true,
                draftPostId: postId,
                draftTitle: readback.draftTitle,
                title: resolveDraftTitle({
                    draftTitle: readback.draftTitle,
                    text: readback.text,
                    draftPostId: postId,
                }),
                updatedAt: readback.updatedAt.toISOString(),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
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

            const access = await ensureDraftAccessFromRequest(req, res, postId, 'edit');
            if (!access) return;
            const result = await acceptGhostDraftIntoWorkingCopy(prisma as any, {
                draftPostId: postId,
                generationId,
                actor: access.actor,
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

            const actor = await requireCircleManagerActor(req, prisma, {
                circleId,
                action: 'draft.write',
                allowModerator: true,
                requireSessionCookie: true,
            });
            const result = await acceptDraftCandidateIntoDraft(prisma as any, {
                circleId,
                candidateId,
                actor,
                redis,
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
            if (sendAuthActorError(res, error)) return;
            next(error);
        }
    });

    router.post('/circles/:circleId/candidates/:candidateId/cancel', async (req, res, next) => {
        try {
            const circleId = parsePositiveInt(req.params.circleId, NaN);
            const candidateId = String(req.params.candidateId || '').trim();
            if (!Number.isFinite(circleId)) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            if (!candidateId) {
                return res.status(400).json({ error: 'invalid_candidate_id' });
            }

            const actor = await requireCircleManagerActor(req, prisma, {
                circleId,
                action: 'draft.write',
                allowModerator: true,
                requireSessionCookie: true,
            });
            const result = await cancelDraftCandidate(prisma as any, {
                circleId,
                candidateId,
                actor,
                redis,
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
            if (sendAuthActorError(res, error)) return;
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
            const sourceCarrier = body.sourceCarrier === 'communication_message'
                ? 'communication_message'
                : 'circle_discussion';
            const sourceMessageIds = Array.isArray(body.sourceMessageIds)
                ? body.sourceMessageIds
                    .map((value: unknown) => String(value || '').trim())
                    .filter((value: string) => value.length > 0)
                : [];
            const sourceMaterialIds: number[] = Array.isArray(body.sourceMaterialIds)
                ? Array.from(new Set<number>(body.sourceMaterialIds
                    .map((value: unknown) => Number(value))
                    .filter((value: number) => Number.isSafeInteger(value) && value > 0)))
                : [];
            if (sourceCarrier === 'circle_discussion' && sourceMessageIds.length === 0) {
                return res.status(400).json({
                    error: 'invalid_source_message_ids',
                    message: 'sourceMessageIds must contain at least one discussion message id',
                });
            }
            if (sourceCarrier === 'communication_message' && sourceMaterialIds.length === 0) {
                return res.status(400).json({
                    error: 'invalid_source_material_ids',
                    message: 'sourceMaterialIds must contain at least one accepted communication source material id',
                });
            }

            const actor = await requireCircleManagerActor(req, prisma, {
                circleId,
                action: 'draft.write',
                allowModerator: true,
                requireSessionCookie: true,
            });
            const result = await createDraftFromManualDiscussionSelection(prisma as any, {
                circleId,
                ...(sourceCarrier === 'communication_message'
                    ? { sourceCarrier, sourceMaterialIds }
                    : { sourceMessageIds }),
                sourceScope: parseManualDraftSourceScope(body.sourceScope),
                actor,
                redis,
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
            if (sendAuthActorError(res, error)) return;
            next(error);
        }
    });

    router.post('/circles/:circleId/drafts', async (req, res, next) => {
        try {
            const circleId = parsePositiveInt(req.params.circleId, NaN);
            if (!Number.isFinite(circleId)) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            const text = typeof req.body?.text === 'string' ? req.body.text : '';
            const actor = await requireCircleActor(req, prisma, {
                circleId,
                action: 'draft.write',
                requireSessionCookie: true,
            });
            const result = await createComposeOffchainDraft(prisma, {
                circleId,
                text,
                actorUserId: actor.userId,
                draftTitle: typeof req.body?.draftTitle === 'string' ? req.body.draftTitle : null,
                clientRequestId: typeof req.body?.clientRequestId === 'string'
                    ? req.body.clientRequestId
                    : null,
            });
            return res.json({
                ok: true,
                result,
            });
        } catch (error) {
            if (error instanceof ComposeOffchainDraftError) {
                return res.status(error.statusCode).json({
                    error: error.code,
                    message: error.message,
                });
            }
            if (sendAuthActorError(res, error)) return;
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
                select: {
                    id: true,
                    status: true,
                    text: true,
                    draftTitle: true,
                    heatScore: true,
                    updatedAt: true,
                },
            });
            if (!post) {
                return res.status(404).json({ error: 'draft_not_found' });
            }
            if (String(post.status) !== 'Draft') {
                return res.status(409).json({ error: 'not_draft_status' });
            }

            const now = new Date();
            const activeTemporaryGrants = (await createPrismaTemporaryEditGrantStore(prisma)
                .listDraftGrants({ draftPostId: postId }))
                .filter((grant) =>
                    isTemporaryGrantProjectionActive({
                        status: grant.status,
                        expiresAt: grant.expiresAt,
                        now,
                    }),
                )
                .map((grant) => ({
                    blockId: grant.blockId,
                    userId: grant.granteeUserId,
                    grantedBy: grant.grantedBy ?? grant.requestedBy,
                    expiresAt: grant.expiresAt ? grant.expiresAt.toISOString() : null,
                }));
            const blockReadModel = await resolveDraftBlockReadModel(prisma, {
                draftPostId: postId,
                viewerUserId: access.authUserId,
                temporaryGrants: activeTemporaryGrants,
                now,
            });
            const permissionSourcesByBlockId = Object.fromEntries(
                blockReadModel.viewerPermissions.map((permission) => [
                    permission.blockId,
                    permission.permissionSources,
                ]),
            );
            const editableBlockIds = blockReadModel.viewerPermissions
                .filter((permission) => permission.canEdit)
                .map((permission) => permission.blockId);
            const isSourceParticipant = blockReadModel.viewerPermissions.some((permission) =>
                permission.permissionSources.includes('source_participant'),
            );
            const paragraphStructureDependencies = await listDraftParagraphStructureDependencies(prisma, postId);
            const paragraphDeleteBlockers = paragraphStructureDependencies.filter(
                (dependency) => dependency !== 'draft_comment',
            );

            return res.json({
                ok: true,
                draftPostId: post.id,
                status: post.status,
                text: post.text || '',
                draftTitle: post.draftTitle,
                title: resolveDraftTitle({
                    draftTitle: post.draftTitle,
                    text: post.text,
                    draftPostId: post.id,
                }),
                heatScore: Number(post.heatScore ?? 0),
                updatedAt: post.updatedAt.toISOString(),
                workingCopyHash: sha256Hex(String(post.text || '')),
                paragraphStructure: {
                    canDelete: paragraphDeleteBlockers.length === 0,
                    deleteBlockedBy: paragraphDeleteBlockers,
                    canEditDocument: paragraphStructureDependencies.length === 0,
                    documentEditBlockedBy: paragraphStructureDependencies,
                },
                scopedPermissions: {
                    isSourceParticipant,
                    editableBlockIds,
                    permissionSourcesByBlockId,
                    viewerPermissions: blockReadModel.viewerPermissions,
                },
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

            const actor = await requireAuthenticatedActor(req, prisma, { requireSessionCookie: true });
            const bodySenderPubkey = String(req.body?.senderPubkey || '').trim();
            if (bodySenderPubkey && bodySenderPubkey !== actor.pubkey) {
                return res.status(403).json({
                    error: 'sender_pubkey_mismatch',
                    message: 'senderPubkey does not match authenticated actor',
                });
            }
            const senderPubkey = actor.pubkey;
            const senderHandleRaw = String(req.body?.senderHandle || '').trim();
            const textRaw = String(req.body?.text || '');
            const text = normalizeDiscussionText(textRaw);
            const locale = resolveExpressRequestLocale(req);

            if (!text) return res.status(400).json({ error: 'empty_message' });
            if (text.length > maxTextLength) {
                return res.status(400).json({
                    error: 'message_too_long',
                    maxLength: maxTextLength,
                });
            }
            const structuredMetadata = prepareStructuredDiscussionWriteMetadata(req.body?.metadata);

            const sessionAuth = await authenticateDiscussionSessionFromRequest({
                prisma,
                jwtSecret,
                authorizationHeader: req.headers.authorization,
                circleId,
                actorPubkey: actor.pubkey,
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
            const subjectTypeRaw = typeof req.body?.subjectType === 'string' ? req.body.subjectType.trim() : '';
            const subjectIdRaw = typeof req.body?.subjectId === 'string' ? req.body.subjectId.trim() : '';
            let subjectType: 'discussion_message' | null = null;
            let subjectId: string | null = null;
            if (subjectTypeRaw || subjectIdRaw) {
                if (subjectTypeRaw !== 'discussion_message' || !subjectIdRaw) {
                    return res.status(400).json({
                        error: 'invalid_discussion_subject',
                        message: 'Plaza messages can only reply to another discussion message',
                    });
                }
                if (subjectIdRaw.length > 128) {
                    return res.status(400).json({
                        error: 'invalid_discussion_subject',
                        message: 'reply source message id is too long',
                    });
                }
                subjectType = 'discussion_message';
                subjectId = subjectIdRaw;
            }
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
                subjectType,
                subjectId,
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

            const writeAccess = await resolvePlazaDiscussionWriteAccess({
                prisma,
                circleId,
                actor,
                now: clientTimestamp,
            });
            const { sender, isVisitorDust } = writeAccess;
            if (subjectType === 'discussion_message' && subjectId) {
                const replySource = await prisma.circleDiscussionMessage.findFirst({
                    where: {
                        circleId,
                        envelopeId: subjectId,
                        deleted: false,
                    },
                    select: { envelopeId: true },
                });
                if (!replySource) {
                    return res.status(404).json({
                        error: 'reply_source_not_found',
                        message: 'reply source message does not exist in this circle',
                    });
                }
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
                subjectType,
                subjectId,
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
                        ${subjectType},
                        ${subjectId},
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
                            FROM discussion_message_highlights useful_marks
                            WHERE useful_marks.envelope_id = circle_discussion_messages.envelope_id
                        ), 0) AS "usefulCount",
                        FALSE AS "viewerHasMarkedUseful",
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

                if (subjectType === 'discussion_message' && subjectId) {
                    await refreshAnnouncementDiscussionProjectionForReply(tx, {
                        circleId,
                        replySubjectEnvelopeId: subjectId,
                        now: clientTimestamp,
                    });
                }

                return row;
            });

            const messageDto = await mapDiscussionRowForResponse(inserted, locale);

            void emitDiscussionRealtimeEvent({
                circleId,
                latestLamport: Number(inserted.lamport),
                envelopeId: inserted.envelopeId,
                reason: 'message_created',
                message: messageDto,
            });

            res.status(201).json({
                ok: true,
                message: messageDto,
            });

            setImmediate(() => {
                void enqueueDiscussionMessageAnalyzeJob(prisma, {
                    envelopeId: inserted.envelopeId,
                    circleId,
                    requestedByUserId: sender?.id ?? null,
                }).catch((error) => {
                    const message = error instanceof Error ? error.message : String(error);
                    console.warn(`discussion analysis enqueue failed for circle ${circleId}: ${message}`);
                });
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (sendPlazaDiscussionCapabilityError(res, error)) return;
            next(error);
        }
    });

    router.post('/messages/forward-batch', async (req, res, next) => {
        try {
            const actor = await requireAuthenticatedActor(req, prisma, { requireSessionCookie: true });
            const targetCircleId = parsePositiveInt(String(req.body?.targetCircleId || ''), NaN);
            if (!Number.isFinite(targetCircleId)) {
                return res.status(400).json({ error: 'invalid_target_circle_id' });
            }

            const result = await createDiscussionForwardBundleProjection({
                prisma,
                actor,
                sourceEnvelopeIds: Array.isArray(req.body?.sourceEnvelopeIds) ? req.body.sourceEnvelopeIds : [],
                targetCircleId,
                locale: resolveExpressRequestLocale(req),
            });

            if (result.realtimeEvent) {
                await emitDiscussionRealtimeEvent(result.realtimeEvent);
            }

            return res.status(result.status === 'existing' ? 200 : 201).json({
                ok: true,
                status: result.status,
                bundleId: result.bundleId,
                message: result.message,
            });
        } catch (error) {
            if (sendDiscussionForwardingError(res, error)) return;
            if (sendAuthActorError(res, error)) return;
            if (sendPlazaDiscussionCapabilityError(res, error)) return;
            next(error);
        }
    });

    router.post('/messages/:envelopeId/forward', async (req, res, next) => {
        try {
            const actor = await requireAuthenticatedActor(req, prisma, { requireSessionCookie: true });

            const sourceEnvelopeId = String(req.params.envelopeId || '').trim();
            if (!sourceEnvelopeId) {
                return res.status(400).json({ error: 'missing_envelope_id' });
            }

            const targetCircleId = parsePositiveInt(String(req.body?.targetCircleId || ''), NaN);
            if (!Number.isFinite(targetCircleId)) {
                return res.status(400).json({ error: 'invalid_target_circle_id' });
            }

            const locale = resolveExpressRequestLocale(req);
            const result = await createDiscussionForwardProjection({
                prisma,
                actor,
                sourceEnvelopeId,
                targetCircleId,
                locale,
            });

            await emitDiscussionRealtimeEvent(result.realtimeEvent);

            return res.status(201).json({
                ok: true,
                message: result.message,
            });
        } catch (error) {
            if (sendDiscussionForwardingError(res, error)) return;
            if (sendAuthActorError(res, error)) return;
            if (sendPlazaDiscussionCapabilityError(res, error)) return;
            next(error);
        }
    });

    router.post('/knowledge/:knowledgeId/messages', async (req, res, next) => {
        try {
            const actor = await requireAuthenticatedActor(req, prisma, { requireSessionCookie: true });

            const knowledge = await loadKnowledgeDiscussionContext(req.params.knowledgeId);
            if (!knowledge) {
                return res.status(404).json({ error: 'knowledge_not_found' });
            }

            const senderPubkeyFromBody = String(req.body?.senderPubkey || '').trim();
            const senderHandleRaw = String(req.body?.senderHandle || '').trim();
            const textRaw = String(req.body?.text || '');
            const text = normalizeDiscussionText(textRaw);

            if (senderPubkeyFromBody && senderPubkeyFromBody !== actor.pubkey) {
                return res.status(403).json({
                    error: 'discussion_sender_mismatch',
                    message: 'authenticated actor must match senderPubkey',
                });
            }
            if (!text) return res.status(400).json({ error: 'empty_message' });
            if (text.length > maxTextLength) {
                return res.status(400).json({
                    error: 'message_too_long',
                    maxLength: maxTextLength,
                });
            }
            const structuredMetadata = prepareStructuredDiscussionWriteMetadata(req.body?.metadata);
            const senderPubkey = actor.pubkey;

            const circleActor = await requireCircleActorForAuthActor(actor, prisma, {
                circleId: knowledge.circleId,
                action: 'discussion.write',
            });

            const sessionAuth = await authenticateDiscussionSessionFromRequest({
                prisma,
                jwtSecret,
                authorizationHeader: req.headers.authorization,
                circleId: knowledge.circleId,
                actorPubkey: actor.pubkey,
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

            await resolvePlazaDiscussionContextForWrite(prisma as any, {
                circleId: knowledge.circleId,
                activeCircleMember: true,
                circleActor,
                now: clientTimestamp,
            });

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

            const senderHandle = actor.displayName || senderHandleRaw || actor.handle || null;
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
                            FROM discussion_message_highlights useful_marks
                            WHERE useful_marks.envelope_id = circle_discussion_messages.envelope_id
                        ), 0) AS "usefulCount",
                        FALSE AS "viewerHasMarkedUseful",
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
                message: await mapDiscussionRowForResponse(inserted, resolveExpressRequestLocale(req)),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (sendPlazaDiscussionCapabilityError(res, error)) return;
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

            const actor = await requireCircleActor(req, prisma, {
                circleId,
                action: 'discussion.write',
                requireSessionCookie: true,
            });
            const bodySenderPubkey = String(req.body?.senderPubkey || '').trim();
            if (bodySenderPubkey && bodySenderPubkey !== actor.pubkey) {
                return res.status(403).json({
                    error: 'discussion_sender_mismatch',
                    message: 'senderPubkey does not match authenticated actor',
                });
            }
            const senderPubkey = actor.pubkey;

            const sessionAuth = await authenticateDiscussionSessionFromRequest({
                prisma,
                jwtSecret,
                authorizationHeader: req.headers.authorization,
                circleId,
                actorPubkey: senderPubkey,
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
                            FROM discussion_message_highlights useful_marks
                            WHERE useful_marks.envelope_id = circle_discussion_messages.envelope_id
                        ), 0) AS "usefulCount",
                        FALSE AS "viewerHasMarkedUseful",
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

            const locale = resolveExpressRequestLocale(req);
            const updatedMessage = await mapDiscussionRowForResponse(updated, locale);

            await emitDiscussionRealtimeEvent({
                circleId,
                latestLamport: Number(updated.lamport),
                envelopeId: updated.envelopeId,
                reason: 'message_tombstoned',
                message: updatedMessage,
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
                UNION
                SELECT
                    m.envelope_id AS "envelopeId",
                    m.circle_id AS "circleId"
                FROM circle_discussion_messages m
                JOIN discussion_forward_bundle_items i
                  ON i.bundle_id = m.subject_id
                WHERE m.message_kind = 'forward_bundle'
                  AND m.subject_type = 'discussion_forward_bundle'
                  AND i.source_envelope_id = ${envelopeId}
            `);

            let dependentMessagesByCircle = new Map<number, Map<string, ReturnType<typeof mapRowToDto>>>();
            try {
                for (const dependentCircleId of [...new Set(forwardedDependents.map((dependent) => dependent.circleId))]) {
                    const dependentEnvelopeIds = forwardedDependents
                        .filter((dependent) => dependent.circleId === dependentCircleId)
                        .map((dependent) => dependent.envelopeId);
                    const visibleRows = await findPlazaVisibleCircleDiscussionMessagesByEnvelopeIdsMap({
                        prisma,
                        circleId: dependentCircleId,
                        roomKey: buildDiscussionRoomKey(dependentCircleId),
                        envelopeIds: dependentEnvelopeIds,
                        includeDeleted: true,
                    });
                    const visibleEntries = [...visibleRows];
                    const visibleDtos = await mapDiscussionRowsForResponse(
                        visibleEntries.map(([, row]) => row),
                        locale,
                    );
                    dependentMessagesByCircle.set(
                        dependentCircleId,
                        new Map(visibleEntries.map(([dependentEnvelopeId], index) => [
                            dependentEnvelopeId,
                            visibleDtos[index] ?? null,
                        ]).filter((entry): entry is [string, ReturnType<typeof mapRowToDto>] => Boolean(entry[1]))),
                    );
                }
            } catch {
                dependentMessagesByCircle = new Map();
            }

            for (const dependent of forwardedDependents) {
                const dependentMessage = dependentMessagesByCircle
                    .get(dependent.circleId)
                    ?.get(dependent.envelopeId) ?? null;
                await emitDiscussionRealtimeEvent({
                    circleId: dependent.circleId,
                    envelopeId: dependent.envelopeId,
                    reason: 'message_refresh_required',
                    ...(dependentMessage ? { message: dependentMessage } : {}),
                });
            }

            try {
                await invalidateDiscussionSummaryCache(redis, circleId);
            } catch {
                // ignore cache invalidation failures
            }

            res.json({
                ok: true,
                message: updatedMessage,
            });
        } catch (error) {
            next(error);
        }
    });

    return router;
}

function sendPlazaDiscussionCapabilityError(
    res: Response,
    error: unknown,
): boolean {
    if (error instanceof PlazaDiscussionWriteAccessError) {
        res.status(error.statusCode).json({
            error: error.code,
            message: error.message,
        });
        return true;
    }
    if (!(error instanceof PlazaDiscussionCapabilityError)) return false;
    res.status(error.statusCode).json({
        error: error.code,
        message: error.message,
    });
    return true;
}

function readViewerUserIdProjection(req: any): number | null {
    const parsed = Number(req?.userId ?? req?.['userId'] ?? req?.['authUserId']);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.trunc(parsed);
}
