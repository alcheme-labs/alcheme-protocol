import crypto from 'crypto';

import { Prisma, type PrismaClient } from '@prisma/client';

import { getCollabEditAnchorsByPostId } from '../collabEditAnchor';
import { getLatestDraftAnchorByPostId } from '../draftAnchor';
import {
    applyDraftDiscussionThread,
    listDraftDiscussionThreads,
    type DraftDiscussionThreadRecord,
} from '../draftDiscussionLifecycle';
import { updateDraftContentAndHeat } from '../heat/postHeat';
import {
    buildDefaultLifecycleTemplate,
    buildPublicPolicyDigestSnapshot,
    resolveCirclePolicyProfile,
} from '../policy/profile';
import { computePolicyProfileDigest } from '../policy/digest';
import {
    parseAcceptedCandidateHandoffMetadata,
    type AcceptedCandidateHandoff,
} from '../discussion/candidateHandoff';
import {
    advanceDraftLifecycleFromReview as advanceDraftWorkflowFromReview,
    archiveDraftLifecycle as archiveDraftWorkflow,
    DraftWorkflowStateError,
    enterDraftLifecycleReview as enterDraftWorkflowReview,
    enterDraftLifecycleCrystallization as enterDraftWorkflowCrystallization,
    failDraftLifecycleCrystallization as failDraftWorkflowCrystallization,
    finalizeDraftLifecycleCrystallization as finalizeDraftWorkflowCrystallization,
    repairDraftLifecycleCrystallizationEvidence as repairDraftWorkflowCrystallizationEvidence,
    restoreDraftLifecycle as restoreDraftWorkflow,
    retryDraftLifecycleCrystallization as retryDraftWorkflowCrystallization,
    rollbackDraftLifecycleCrystallizationFailure as rollbackDraftWorkflowCrystallizationFailure,
    resolveDraftWorkflowState,
    type DraftWorkflowDocumentStatus,
    type DraftWorkflowTransitionMode,
} from './workflowState';
import { loadDraftVersionSnapshot } from './versionSnapshots';
import { applyGhostDraftSuggestionToContent } from '../ghostDraft/suggestionPatches';
import { toGhostDraftResultView, type GhostDraftSuggestionView } from '../ghostDraft/readModel';

interface AcceptedCandidateNoticeRow {
    messageKind: string;
    metadata: unknown;
    createdAt: Date;
}

interface DraftPostRow {
    id: number;
    authorId: number;
    circleId: number | null;
    text: string | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
}

interface GhostDraftAcceptanceChainRow {
    id: number;
    requestWorkingCopyHash: string | null;
    resultingWorkingCopyHash: string | null;
    acceptedThreadIds: unknown;
    changed: boolean;
    acceptedAt: Date;
}

interface PendingGhostDraftApplicationBatch {
    acceptanceId: number;
    appliedSnapshotHash: string;
    threadIds: string[];
}

interface PendingGhostDraftApplications {
    batches: PendingGhostDraftApplicationBatch[];
    pendingThreadIds: string[];
    threadsById: Map<string, DraftDiscussionThreadRecord>;
}

export interface AcceptedCandidateSeedView extends AcceptedCandidateHandoff {
    acceptedAt: string;
}

export interface DraftStableSnapshotView {
    draftVersion: number;
    sourceKind: 'accepted_candidate_v1_seed' | 'review_bound_snapshot' | null;
    seedDraftAnchorId: string | null;
    sourceEditAnchorId: string | null;
    sourceSummaryHash: string | null;
    sourceMessagesDigest: string | null;
    contentHash: string | null;
    createdAt: string | null;
}

export interface DraftWorkingCopyView {
    workingCopyId: string;
    draftPostId: number;
    basedOnSnapshotVersion: number;
    workingCopyContent: string;
    workingCopyHash: string;
    status: 'active';
    roomKey: string;
    latestEditAnchorId: string | null;
    latestEditAnchorStatus: string | null;
    updatedAt: string;
}

export interface DraftReviewBindingView {
    boundSnapshotVersion: number;
    totalThreadCount: number;
    openThreadCount: number;
    proposedThreadCount: number;
    acceptedThreadCount: number;
    appliedThreadCount: number;
    mismatchedApplicationCount: number;
    latestThreadUpdatedAt: string | null;
}

export interface DraftLifecycleReadModel {
    draftPostId: number;
    circleId: number | null;
    documentStatus: DraftWorkflowDocumentStatus;
    currentSnapshotVersion: number;
    currentRound: number;
    policyProfileDigest?: string | null;
    reviewEntryMode: 'auto_only' | 'manual_only' | 'auto_or_manual';
    draftingEndsAt: string | null;
    reviewEndsAt: string | null;
    reviewWindowExpiredAt: string | null;
    transitionMode: DraftWorkflowTransitionMode;
    handoff: AcceptedCandidateSeedView | null;
    stableSnapshot: DraftStableSnapshotView;
    workingCopy: DraftWorkingCopyView;
    reviewBinding: DraftReviewBindingView;
    warnings: string[];
}

export class DraftReviewAdvanceConfirmationError extends Error {
    readonly code = 'draft_review_apply_confirmation_required';
    readonly statusCode = 409;

    constructor(
        public readonly pendingThreadIds: string[],
    ) {
        super(
            pendingThreadIds.length === 1
                ? '1 accepted AI suggestion still needs confirmation before the draft can change stages.'
                : `${pendingThreadIds.length} accepted AI suggestions still need confirmation before the draft can change stages.`,
        );
        this.name = 'DraftReviewAdvanceConfirmationError';
    }

    get pendingThreadCount(): number {
        return this.pendingThreadIds.length;
    }
}

function parsePositiveInt(value: unknown): number | null {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

function parseNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function sha256Hex(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex');
}

function buildWorkingCopyId(draftPostId: number): string {
    return `draft:${draftPostId}:working-copy`;
}

function buildRoomKey(draftPostId: number): string {
    return `crucible-${draftPostId}`;
}

function parseIsoDate(value: string | null | undefined): number {
    if (!value) return 0;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeAcceptedCandidateSeedAt(
    noticeCreatedAt: Date,
    draftPostCreatedAt: Date | null,
): Date {
    if (!draftPostCreatedAt) return noticeCreatedAt;
    const skewMs = Math.abs(noticeCreatedAt.getTime() - draftPostCreatedAt.getTime());
    if (skewMs > 5 * 60 * 1000) {
        return draftPostCreatedAt;
    }
    return noticeCreatedAt;
}

function normalizeSha256Hex(value: unknown): string | null {
    const normalized = parseNonEmptyString(value)?.toLowerCase() || null;
    if (!normalized || !/^[a-f0-9]{64}$/.test(normalized)) {
        return null;
    }
    return normalized;
}

function normalizeThreadIdList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const normalized: string[] = [];
    value.forEach((item) => {
        const threadId = parseNonEmptyString(item);
        if (!threadId || seen.has(threadId)) return;
        seen.add(threadId);
        normalized.push(threadId);
    });
    return normalized;
}

function buildGhostSuggestionApplicationEvidenceId(acceptanceId: number): string {
    return `ghost-draft-acceptance:${acceptanceId}`;
}

function traceGhostDraftAcceptanceChain(
    rows: GhostDraftAcceptanceChainRow[],
    currentWorkingCopyHash: string,
): PendingGhostDraftApplicationBatch[] {
    const indexed = rows
        .map((row) => ({
            acceptanceId: Number(row.id),
            requestWorkingCopyHash: normalizeSha256Hex(row.requestWorkingCopyHash),
            appliedSnapshotHash: normalizeSha256Hex(row.resultingWorkingCopyHash),
            threadIds: normalizeThreadIdList(row.acceptedThreadIds),
            changed: Boolean(row.changed),
            acceptedAt: row.acceptedAt instanceof Date ? row.acceptedAt : new Date(row.acceptedAt),
        }))
        .filter((row) =>
            row.acceptanceId > 0
            && row.changed
            && Boolean(row.appliedSnapshotHash)
            && row.threadIds.length > 0,
        )
        .sort((left, right) => right.acceptedAt.getTime() - left.acceptedAt.getTime());

    const chain: PendingGhostDraftApplicationBatch[] = [];
    const seenAcceptanceIds = new Set<number>();
    const seenHashes = new Set<string>();
    let cursorHash: string | null = currentWorkingCopyHash;

    while (cursorHash && !seenHashes.has(cursorHash)) {
        seenHashes.add(cursorHash);
        const matched = indexed.find((row) =>
            !seenAcceptanceIds.has(row.acceptanceId)
            && row.appliedSnapshotHash === cursorHash,
        );
        if (!matched) break;
        seenAcceptanceIds.add(matched.acceptanceId);
        chain.push({
            acceptanceId: matched.acceptanceId,
            appliedSnapshotHash: matched.appliedSnapshotHash!,
            threadIds: matched.threadIds,
        });
        cursorHash = matched.requestWorkingCopyHash;
    }

    return chain.reverse();
}

async function resolvePendingGhostDraftApplications(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        currentWorkingCopyText: string;
    },
): Promise<PendingGhostDraftApplications> {
    const prismaAny = prisma as any;
    if (typeof prismaAny.ghostDraftAcceptance?.findMany !== 'function') {
        return {
            batches: [],
            pendingThreadIds: [],
            threadsById: new Map<string, DraftDiscussionThreadRecord>(),
        };
    }

    const rows = await prismaAny.ghostDraftAcceptance.findMany({
        where: {
            draftPostId: input.draftPostId,
            acceptanceMode: 'accept_suggestion',
        },
        orderBy: {
            acceptedAt: 'desc',
        },
        select: {
            id: true,
            requestWorkingCopyHash: true,
            resultingWorkingCopyHash: true,
            acceptedThreadIds: true,
            changed: true,
            acceptedAt: true,
        },
    }) as GhostDraftAcceptanceChainRow[];

    const currentWorkingCopyHash = sha256Hex(input.currentWorkingCopyText);
    const candidateBatches = traceGhostDraftAcceptanceChain(rows, currentWorkingCopyHash);
    if (!candidateBatches.length) {
        return {
            batches: [],
            pendingThreadIds: [],
            threadsById: new Map<string, DraftDiscussionThreadRecord>(),
        };
    }

    const threads = await listDraftDiscussionThreads(prisma, {
        draftPostId: input.draftPostId,
        limit: 200,
    });
    const threadsById = new Map<string, DraftDiscussionThreadRecord>(
        threads.map((thread) => [thread.id, thread]),
    );
    const seenThreadIds = new Set<string>();
    const batches = candidateBatches
        .map((batch) => ({
            ...batch,
            threadIds: batch.threadIds.filter((threadId) => {
                const thread = threadsById.get(threadId);
                if (!thread || thread.state !== 'accepted' || seenThreadIds.has(threadId)) {
                    return false;
                }
                seenThreadIds.add(threadId);
                return true;
            }),
        }))
        .filter((batch) => batch.threadIds.length > 0);

    return {
        batches,
        pendingThreadIds: batches.flatMap((batch) => batch.threadIds),
        threadsById,
    };
}

async function applyPendingGhostDraftThreads(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        actorUserId: number;
        pending: PendingGhostDraftApplications;
    },
): Promise<void> {
    for (const batch of input.pending.batches) {
        const appliedEditAnchorId = buildGhostSuggestionApplicationEvidenceId(batch.acceptanceId);
        for (const threadId of batch.threadIds) {
            const thread = input.pending.threadsById.get(threadId);
            const numericThreadId = parsePositiveInt(threadId);
            if (!thread || !numericThreadId) continue;
            await applyDraftDiscussionThread(prisma as any, {
                draftPostId: input.draftPostId,
                threadId: numericThreadId,
                actorUserId: input.actorUserId,
                appliedEditAnchorId,
                appliedSnapshotHash: batch.appliedSnapshotHash,
                appliedDraftVersion: thread.targetVersion,
                reason: 'Auto-applied from an accepted AI suggestion while advancing review.',
            });
        }
    }
}

interface QueuedGhostDraftSuggestionRow {
    id: number;
    acceptedSuggestionId: string | null;
    acceptedThreadIds: unknown;
    acceptedAt: Date;
    generation: any;
}

interface QueuedGhostDraftSuggestionBatch {
    acceptanceId: number;
    suggestion: GhostDraftSuggestionView;
    threadIds: string[];
}

async function resolveQueuedGhostDraftSuggestionsForNextRound(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
    },
): Promise<QueuedGhostDraftSuggestionBatch[]> {
    const prismaAny = prisma as any;
    if (
        typeof prismaAny.ghostDraftAcceptance?.findMany !== 'function'
        || typeof prismaAny.ghostDraftAcceptance?.update !== 'function'
    ) {
        return [];
    }

    const rows = await prismaAny.ghostDraftAcceptance.findMany({
        where: {
            draftPostId: input.draftPostId,
            acceptanceMode: 'accept_suggestion',
            changed: false,
        },
        orderBy: {
            acceptedAt: 'asc',
        },
        select: {
            id: true,
            acceptedSuggestionId: true,
            acceptedThreadIds: true,
            acceptedAt: true,
            generation: true,
        },
    }) as QueuedGhostDraftSuggestionRow[];

    if (!rows.length) return [];

    const threads = await listDraftDiscussionThreads(prisma, {
        draftPostId: input.draftPostId,
        limit: 200,
    });
    const threadsById = new Map<string, DraftDiscussionThreadRecord>(
        threads.map((thread) => [thread.id, thread]),
    );

    return rows.flatMap((row) => {
        const acceptedSuggestionId = parseNonEmptyString(row.acceptedSuggestionId);
        if (!acceptedSuggestionId || !row.generation) return [];
        const suggestion = toGhostDraftResultView(row.generation).suggestions
            .find((item) => item.suggestionId === acceptedSuggestionId);
        if (!suggestion) return [];

        const pendingThreadIds = normalizeThreadIdList(row.acceptedThreadIds).filter((threadId) => {
            const thread = threadsById.get(threadId);
            return Boolean(thread && thread.state === 'accepted');
        });
        if (pendingThreadIds.length === 0) return [];

        return [{
            acceptanceId: Number(row.id),
            suggestion: {
                ...suggestion,
                threadIds: pendingThreadIds,
            },
            threadIds: pendingThreadIds,
        }];
    });
}

async function applyQueuedGhostDraftSuggestionsForNextRound(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
    },
): Promise<void> {
    const queuedSuggestions = await resolveQueuedGhostDraftSuggestionsForNextRound(prisma, {
        draftPostId: input.draftPostId,
    });
    if (!queuedSuggestions.length) return;

    const current = await prisma.post.findUnique({
        where: { id: input.draftPostId },
        select: {
            id: true,
            status: true,
            text: true,
            updatedAt: true,
            heatScore: true,
        },
    });
    if (!current) {
        throw new Error('draft_not_found');
    }

    const currentText = String(current.text || '');
    let nextText = currentText;
    const acceptanceUpdates = queuedSuggestions.map((batch) => {
        const requestWorkingCopyHash = sha256Hex(nextText);
        nextText = applyGhostDraftSuggestionToContent(nextText, batch.suggestion);
        return {
            acceptanceId: batch.acceptanceId,
            requestWorkingCopyHash,
            resultingWorkingCopyHash: sha256Hex(nextText),
        };
    });

    const updated = await updateDraftContentAndHeat(prisma, {
        postId: input.draftPostId,
        text: nextText,
        precondition: {
            expectedText: currentText,
            expectedUpdatedAt: current.updatedAt,
        },
    });
    if (updated.preconditionFailed) {
        throw new DraftWorkflowStateError(
            'draft_working_copy_changed',
            409,
            'draft working copy changed while carrying accepted AI revisions into the next round',
        );
    }

    const prismaAny = prisma as any;
    for (const row of acceptanceUpdates) {
        await prismaAny.ghostDraftAcceptance.update({
            where: { id: row.acceptanceId },
            data: {
                requestWorkingCopyHash: row.requestWorkingCopyHash,
                resultingWorkingCopyHash: row.resultingWorkingCopyHash,
                changed: true,
            },
        });
    }
}

function countThreadsByState(
    threads: DraftDiscussionThreadRecord[],
    state: DraftDiscussionThreadRecord['state'],
): number {
    return threads.filter((thread) => thread.state === state).length;
}

function selectStableSnapshotApplication(
    threads: DraftDiscussionThreadRecord[],
    snapshotVersion: number,
): DraftDiscussionThreadRecord | null {
    const candidates = threads
        .filter((thread) =>
            thread.targetVersion === snapshotVersion
            && thread.latestApplication,
        )
        .sort((left, right) =>
            parseIsoDate(right.latestApplication?.appliedAt)
            - parseIsoDate(left.latestApplication?.appliedAt),
        );
    return candidates[0] || null;
}

function buildReviewBinding(
    threads: DraftDiscussionThreadRecord[],
    boundSnapshotVersion: number,
): DraftReviewBindingView {
    const boundThreads = threads
        .filter((thread) => thread.targetVersion === boundSnapshotVersion)
        .sort((left, right) => parseIsoDate(right.updatedAt) - parseIsoDate(left.updatedAt));

    const mismatchedApplicationCount = boundThreads.filter((thread) =>
        Boolean(thread.latestApplication)
        && thread.latestApplication!.appliedDraftVersion !== thread.targetVersion,
    ).length;

    return {
        boundSnapshotVersion,
        totalThreadCount: boundThreads.length,
        openThreadCount: countThreadsByState(boundThreads, 'open'),
        proposedThreadCount: countThreadsByState(boundThreads, 'proposed'),
        acceptedThreadCount: countThreadsByState(boundThreads, 'accepted'),
        appliedThreadCount: countThreadsByState(boundThreads, 'applied'),
        mismatchedApplicationCount,
        latestThreadUpdatedAt: boundThreads[0]?.updatedAt || null,
    };
}

export async function loadAcceptedCandidateHandoffForDraftPost(
    prisma: PrismaClient,
    draftPostId: number,
): Promise<AcceptedCandidateSeedView | null> {
    const draftPost = await prisma.post.findUnique({
        where: { id: draftPostId },
        select: { createdAt: true },
    });
    const rows = await prisma.$queryRaw<AcceptedCandidateNoticeRow[]>(Prisma.sql`
        SELECT
            message_kind AS "messageKind",
            metadata AS "metadata",
            created_at AS "createdAt"
        FROM circle_discussion_messages
        WHERE deleted = FALSE
          AND metadata IS NOT NULL
          AND message_kind IN ('draft_candidate_notice', 'governance_notice')
          AND metadata->>'draftPostId' = ${String(draftPostId)}
        ORDER BY created_at DESC
        LIMIT 50
    `);

    for (const row of rows) {
        const parsed = parseAcceptedCandidateHandoffMetadata(row.metadata);
        if (!parsed || parsed.draftPostId !== draftPostId) continue;
        const acceptedAt = normalizeAcceptedCandidateSeedAt(
            row.createdAt,
            draftPost?.createdAt ?? null,
        );
        return {
            ...parsed,
            acceptedAt: acceptedAt.toISOString(),
        };
    }

    return null;
}

async function loadDraftPost(
    prisma: PrismaClient,
    draftPostId: number,
): Promise<DraftPostRow> {
    const post = await prisma.post.findUnique({
        where: { id: draftPostId },
        select: {
            id: true,
            authorId: true,
            circleId: true,
            text: true,
            status: true,
            createdAt: true,
            updatedAt: true,
        },
    });
    if (!post) {
        throw new Error('draft_not_found');
    }
    if (String(post.status) !== 'Draft') {
        throw new Error('not_draft_status');
    }
    return {
        ...post,
        status: String(post.status),
    };
}

function requireAnchorSignature(value: unknown): string {
    const normalized = parseNonEmptyString(value);
    if (!normalized) {
        throw new Error('draft_lifecycle_anchor_signature_required');
    }
    return normalized;
}

function requirePolicyProfileDigest(value: unknown): string {
    const normalized = parseNonEmptyString(value)?.toLowerCase() || null;
    if (!normalized || !/^[a-f0-9]{64}$/.test(normalized)) {
        throw new Error('policy_profile_digest_required');
    }
    return normalized;
}

function selectLifecyclePolicyProfileDigest(input: {
    documentStatus: DraftWorkflowDocumentStatus;
    livePolicyProfileDigest: string | null;
    persistedCrystallizationPolicyProfileDigest: string | null;
}): string | null {
    if (
        input.documentStatus === 'crystallization_active'
        || input.documentStatus === 'crystallized'
    ) {
        return input.persistedCrystallizationPolicyProfileDigest || input.livePolicyProfileDigest;
    }
    return input.livePolicyProfileDigest;
}

export async function resolveDraftLifecycleReadModel(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        now?: Date | string;
    },
): Promise<DraftLifecycleReadModel> {
    const draftPostId = parsePositiveInt(input.draftPostId);
    if (!draftPostId) {
        throw new Error('invalid_draft_post_id');
    }

    const now = input.now
        ? new Date(input.now)
        : new Date();

    const [post, handoff, draftAnchor, latestCollabAnchors, discussionThreads] = await Promise.all([
        loadDraftPost(prisma, draftPostId),
        loadAcceptedCandidateHandoffForDraftPost(prisma, draftPostId),
        getLatestDraftAnchorByPostId(prisma, draftPostId),
        getCollabEditAnchorsByPostId(prisma, draftPostId, 1),
        listDraftDiscussionThreads(prisma, { draftPostId, limit: 100 }),
    ]);

    const warnings: string[] = [];
    const policyProfile = post.circleId
        ? await resolveCirclePolicyProfile(prisma, post.circleId)
        : null;
    const lifecycleTemplate = policyProfile?.draftLifecycleTemplate || buildDefaultLifecycleTemplate();
    const policyProfileDigest = policyProfile
        ? computePolicyProfileDigest(buildPublicPolicyDigestSnapshot(policyProfile))
        : null;
    const workflowState = await resolveDraftWorkflowState(prisma, {
        draftPostId,
        circleId: post.circleId,
        template: lifecycleTemplate,
        seedStartedAt: new Date(handoff?.acceptedAt || post.createdAt),
        now,
    });
    const currentSnapshotVersion = Math.max(1, workflowState.currentSnapshotVersion || 1);
    const reviewBinding = buildReviewBinding(discussionThreads, currentSnapshotVersion);
    const latestCollabAnchor = latestCollabAnchors[0] || null;
    const stableSnapshotApplication = selectStableSnapshotApplication(
        discussionThreads,
        currentSnapshotVersion,
    );
    const persistedStableSnapshot = currentSnapshotVersion >= 1
        ? await loadDraftVersionSnapshot(prisma, {
            draftPostId,
            draftVersion: currentSnapshotVersion,
        })
        : null;

    if (!handoff) {
        warnings.push(
            'draft source handoff is missing; treating candidate source as unavailable for this draft',
        );
    }
    if (!draftAnchor) {
        warnings.push(
            'v1 seed snapshot is missing draft anchor evidence; current stable snapshot currently relies on accepted handoff metadata only',
        );
    }
    if (reviewBinding.mismatchedApplicationCount > 0) {
        warnings.push(
            'draft discussion application evidence uses legacy appliedDraftVersion values and may not match the current stable snapshot evidence',
        );
    }
    if (currentSnapshotVersion > 1 && !persistedStableSnapshot && !stableSnapshotApplication?.latestApplication) {
        warnings.push(
            'current stable snapshot version is missing persisted snapshot evidence and has no matching application evidence yet',
        );
    }

    const stableSnapshot: DraftStableSnapshotView = currentSnapshotVersion === 1 && persistedStableSnapshot
        ? {
            draftVersion: 1,
            sourceKind: handoff ? 'accepted_candidate_v1_seed' : null,
            seedDraftAnchorId: draftAnchor?.anchorId || null,
            sourceEditAnchorId: persistedStableSnapshot.sourceEditAnchorId || null,
            sourceSummaryHash: persistedStableSnapshot.sourceSummaryHash || draftAnchor?.summaryHash || null,
            sourceMessagesDigest: persistedStableSnapshot.sourceMessagesDigest || draftAnchor?.messagesDigest || null,
            contentHash: persistedStableSnapshot.contentHash || null,
            createdAt: persistedStableSnapshot.createdAt,
        }
        : currentSnapshotVersion > 1 && persistedStableSnapshot
        ? {
            draftVersion: currentSnapshotVersion,
            sourceKind: 'review_bound_snapshot',
            seedDraftAnchorId: draftAnchor?.anchorId || null,
            sourceEditAnchorId: persistedStableSnapshot.sourceEditAnchorId || null,
            sourceSummaryHash: persistedStableSnapshot.sourceSummaryHash || null,
            sourceMessagesDigest: persistedStableSnapshot.sourceMessagesDigest || null,
            contentHash: persistedStableSnapshot.contentHash || null,
            createdAt: persistedStableSnapshot.createdAt,
        }
        : currentSnapshotVersion > 1
        ? {
            draftVersion: currentSnapshotVersion,
            sourceKind: 'review_bound_snapshot',
            seedDraftAnchorId: draftAnchor?.anchorId || null,
            sourceEditAnchorId: stableSnapshotApplication?.latestApplication?.appliedEditAnchorId || null,
            sourceSummaryHash: draftAnchor?.summaryHash || null,
                sourceMessagesDigest: draftAnchor?.messagesDigest || null,
                contentHash: stableSnapshotApplication?.latestApplication?.appliedSnapshotHash || null,
                createdAt:
                stableSnapshotApplication?.latestApplication?.appliedAt
                || stableSnapshotApplication?.updatedAt
                || draftAnchor?.createdAt
                || handoff?.acceptedAt
                || post.createdAt.toISOString(),
        }
        : {
            draftVersion: 1,
            sourceKind: handoff ? 'accepted_candidate_v1_seed' : null,
            seedDraftAnchorId: draftAnchor?.anchorId || null,
            sourceEditAnchorId: null,
            sourceSummaryHash: draftAnchor?.summaryHash || null,
            sourceMessagesDigest: draftAnchor?.messagesDigest || null,
            contentHash: null,
            createdAt: draftAnchor?.createdAt || handoff?.acceptedAt || post.createdAt.toISOString(),
        };

    const workingCopyContent = String(post.text || '');

    return {
        draftPostId,
        circleId: post.circleId,
        documentStatus: workflowState.documentStatus,
        currentSnapshotVersion,
        currentRound: workflowState.currentRound,
        policyProfileDigest: selectLifecyclePolicyProfileDigest({
            documentStatus: workflowState.documentStatus,
            livePolicyProfileDigest: policyProfileDigest,
            persistedCrystallizationPolicyProfileDigest: workflowState.crystallizationPolicyProfileDigest,
        }),
        reviewEntryMode: workflowState.reviewEntryMode,
        draftingEndsAt: workflowState.draftingEndsAt,
        reviewEndsAt: workflowState.reviewEndsAt,
        reviewWindowExpiredAt: workflowState.reviewWindowExpiredAt,
        transitionMode: workflowState.transitionMode,
        handoff,
        stableSnapshot,
        workingCopy: {
            workingCopyId: buildWorkingCopyId(draftPostId),
            draftPostId,
            basedOnSnapshotVersion: stableSnapshot.draftVersion,
            workingCopyContent,
            workingCopyHash: sha256Hex(workingCopyContent),
            status: 'active',
            roomKey: buildRoomKey(draftPostId),
            latestEditAnchorId: latestCollabAnchor?.anchorId || null,
            latestEditAnchorStatus: latestCollabAnchor?.status || null,
            updatedAt: post.updatedAt.toISOString(),
        },
        reviewBinding,
        warnings,
    };
}

export async function enterDraftLifecycleReview(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        actorUserId: number;
        confirmApplyAcceptedGhostThreads?: boolean;
        now?: Date | string;
    },
): Promise<DraftLifecycleReadModel> {
    const draftPostId = parsePositiveInt(input.draftPostId);
    if (!draftPostId) {
        throw new Error('invalid_draft_post_id');
    }

    const post = await loadDraftPost(prisma, draftPostId);
    const handoff = await loadAcceptedCandidateHandoffForDraftPost(prisma, draftPostId);
    const lifecycleTemplate = post.circleId
        ? (await resolveCirclePolicyProfile(prisma, post.circleId)).draftLifecycleTemplate
        : buildDefaultLifecycleTemplate();
    const pendingGhostDraftApplications = await resolvePendingGhostDraftApplications(prisma, {
        draftPostId,
        currentWorkingCopyText: String(post.text || ''),
    });
    if (
        pendingGhostDraftApplications.pendingThreadIds.length > 0
        && !input.confirmApplyAcceptedGhostThreads
    ) {
        throw new DraftReviewAdvanceConfirmationError(
            pendingGhostDraftApplications.pendingThreadIds,
        );
    }
    if (pendingGhostDraftApplications.pendingThreadIds.length > 0) {
        await applyPendingGhostDraftThreads(prisma, {
            draftPostId,
            actorUserId: input.actorUserId,
            pending: pendingGhostDraftApplications,
        });
    }

    await enterDraftWorkflowReview(prisma, {
        draftPostId,
        circleId: post.circleId,
        actorUserId: input.actorUserId,
        template: lifecycleTemplate,
        seedStartedAt: new Date(handoff?.acceptedAt || post.createdAt),
        now: input.now ? new Date(input.now) : new Date(),
    });

    return resolveDraftLifecycleReadModel(prisma, {
        draftPostId,
        now: input.now,
    });
}

export async function advanceDraftLifecycleReview(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        actorUserId: number;
        confirmApplyAcceptedGhostThreads?: boolean;
        now?: Date | string;
    },
): Promise<DraftLifecycleReadModel> {
    const draftPostId = parsePositiveInt(input.draftPostId);
    if (!draftPostId) {
        throw new Error('invalid_draft_post_id');
    }

    const post = await loadDraftPost(prisma, draftPostId);
    const handoff = await loadAcceptedCandidateHandoffForDraftPost(prisma, draftPostId);
    const lifecycleTemplate = post.circleId
        ? (await resolveCirclePolicyProfile(prisma, post.circleId)).draftLifecycleTemplate
        : buildDefaultLifecycleTemplate();
    const pendingGhostDraftApplications = await resolvePendingGhostDraftApplications(prisma, {
        draftPostId,
        currentWorkingCopyText: String(post.text || ''),
    });

    if (
        pendingGhostDraftApplications.pendingThreadIds.length > 0
        && !input.confirmApplyAcceptedGhostThreads
    ) {
        throw new DraftReviewAdvanceConfirmationError(
            pendingGhostDraftApplications.pendingThreadIds,
        );
    }

    if (pendingGhostDraftApplications.pendingThreadIds.length > 0) {
        await applyPendingGhostDraftThreads(prisma, {
            draftPostId,
            actorUserId: input.actorUserId,
            pending: pendingGhostDraftApplications,
        });
    }

    await applyQueuedGhostDraftSuggestionsForNextRound(prisma, {
        draftPostId,
    });

    await advanceDraftWorkflowFromReview(prisma, {
        draftPostId,
        circleId: post.circleId,
        actorUserId: input.actorUserId,
        template: lifecycleTemplate,
        seedStartedAt: new Date(handoff?.acceptedAt || post.createdAt),
        now: input.now ? new Date(input.now) : new Date(),
    });

    return resolveDraftLifecycleReadModel(prisma, {
        draftPostId,
        now: input.now,
    });
}

export async function enterDraftLifecycleCrystallization(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        actorUserId: number;
        anchorSignature: string;
        policyProfileDigest: string;
        now?: Date | string;
    },
): Promise<DraftLifecycleReadModel> {
    const draftPostId = parsePositiveInt(input.draftPostId);
    if (!draftPostId) {
        throw new Error('invalid_draft_post_id');
    }

    const post = await loadDraftPost(prisma, draftPostId);
    const handoff = await loadAcceptedCandidateHandoffForDraftPost(prisma, draftPostId);
    const policyProfile = post.circleId
        ? await resolveCirclePolicyProfile(prisma, post.circleId)
        : null;
    const lifecycleTemplate = policyProfile?.draftLifecycleTemplate || buildDefaultLifecycleTemplate();

    await enterDraftWorkflowCrystallization(prisma, {
        draftPostId,
        circleId: post.circleId,
        actorUserId: input.actorUserId,
        anchorSignature: requireAnchorSignature(input.anchorSignature),
        policyProfileDigest: requirePolicyProfileDigest(input.policyProfileDigest),
        template: lifecycleTemplate,
        seedStartedAt: new Date(handoff?.acceptedAt || post.createdAt),
        now: input.now ? new Date(input.now) : new Date(),
    });

    return resolveDraftLifecycleReadModel(prisma, {
        draftPostId,
        now: input.now,
    });
}

export async function finalizeDraftLifecycleCrystallization(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        actorUserId: number | null;
        now?: Date | string;
    },
): Promise<DraftLifecycleReadModel> {
    const draftPostId = parsePositiveInt(input.draftPostId);
    if (!draftPostId) {
        throw new Error('invalid_draft_post_id');
    }

    const post = await loadDraftPost(prisma, draftPostId);
    const handoff = await loadAcceptedCandidateHandoffForDraftPost(prisma, draftPostId);
    const lifecycleTemplate = post.circleId
        ? (await resolveCirclePolicyProfile(prisma, post.circleId)).draftLifecycleTemplate
        : buildDefaultLifecycleTemplate();

    await finalizeDraftWorkflowCrystallization(prisma, {
        draftPostId,
        circleId: post.circleId,
        actorUserId: input.actorUserId,
        template: lifecycleTemplate,
        seedStartedAt: new Date(handoff?.acceptedAt || post.createdAt),
        now: input.now ? new Date(input.now) : new Date(),
    });

    return resolveDraftLifecycleReadModel(prisma, {
        draftPostId,
        now: input.now,
    });
}

export async function failDraftLifecycleCrystallization(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        actorUserId: number | null;
        now?: Date | string;
    },
): Promise<DraftLifecycleReadModel> {
    const draftPostId = parsePositiveInt(input.draftPostId);
    if (!draftPostId) {
        throw new Error('invalid_draft_post_id');
    }

    const post = await loadDraftPost(prisma, draftPostId);
    const handoff = await loadAcceptedCandidateHandoffForDraftPost(prisma, draftPostId);
    const lifecycleTemplate = post.circleId
        ? (await resolveCirclePolicyProfile(prisma, post.circleId)).draftLifecycleTemplate
        : buildDefaultLifecycleTemplate();

    await failDraftWorkflowCrystallization(prisma, {
        draftPostId,
        circleId: post.circleId,
        actorUserId: input.actorUserId,
        template: lifecycleTemplate,
        seedStartedAt: new Date(handoff?.acceptedAt || post.createdAt),
        now: input.now ? new Date(input.now) : new Date(),
    });

    return resolveDraftLifecycleReadModel(prisma, {
        draftPostId,
        now: input.now,
    });
}

export async function repairDraftLifecycleCrystallizationEvidence(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        actorUserId: number;
        now?: Date | string;
    },
): Promise<DraftLifecycleReadModel> {
    const draftPostId = parsePositiveInt(input.draftPostId);
    if (!draftPostId) {
        throw new Error('invalid_draft_post_id');
    }

    const post = await loadDraftPost(prisma, draftPostId);

    await repairDraftWorkflowCrystallizationEvidence(prisma, {
        draftPostId,
        circleId: post.circleId,
        actorUserId: input.actorUserId,
    });

    return resolveDraftLifecycleReadModel(prisma, {
        draftPostId,
        now: input.now,
    });
}

export async function retryDraftLifecycleCrystallization(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        actorUserId: number;
        anchorSignature: string;
        policyProfileDigest: string;
        now?: Date | string;
    },
): Promise<DraftLifecycleReadModel> {
    const draftPostId = parsePositiveInt(input.draftPostId);
    if (!draftPostId) {
        throw new Error('invalid_draft_post_id');
    }

    const post = await loadDraftPost(prisma, draftPostId);
    const handoff = await loadAcceptedCandidateHandoffForDraftPost(prisma, draftPostId);
    const policyProfile = post.circleId
        ? await resolveCirclePolicyProfile(prisma, post.circleId)
        : null;
    const lifecycleTemplate = policyProfile?.draftLifecycleTemplate || buildDefaultLifecycleTemplate();

    await retryDraftWorkflowCrystallization(prisma, {
        draftPostId,
        circleId: post.circleId,
        actorUserId: input.actorUserId,
        anchorSignature: requireAnchorSignature(input.anchorSignature),
        policyProfileDigest: requirePolicyProfileDigest(input.policyProfileDigest),
        template: lifecycleTemplate,
        seedStartedAt: new Date(handoff?.acceptedAt || post.createdAt),
        now: input.now ? new Date(input.now) : new Date(),
    });

    return resolveDraftLifecycleReadModel(prisma, {
        draftPostId,
        now: input.now,
    });
}

export async function rollbackDraftLifecycleCrystallizationFailure(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        actorUserId: number | null;
        now?: Date | string;
    },
): Promise<DraftLifecycleReadModel> {
    const draftPostId = parsePositiveInt(input.draftPostId);
    if (!draftPostId) {
        throw new Error('invalid_draft_post_id');
    }

    const post = await loadDraftPost(prisma, draftPostId);
    const handoff = await loadAcceptedCandidateHandoffForDraftPost(prisma, draftPostId);
    const lifecycleTemplate = post.circleId
        ? (await resolveCirclePolicyProfile(prisma, post.circleId)).draftLifecycleTemplate
        : buildDefaultLifecycleTemplate();

    await rollbackDraftWorkflowCrystallizationFailure(prisma, {
        draftPostId,
        circleId: post.circleId,
        actorUserId: input.actorUserId,
        template: lifecycleTemplate,
        seedStartedAt: new Date(handoff?.acceptedAt || post.createdAt),
        now: input.now ? new Date(input.now) : new Date(),
    });

    return resolveDraftLifecycleReadModel(prisma, {
        draftPostId,
        now: input.now,
    });
}

export async function archiveDraftLifecycle(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        actorUserId: number | null;
        anchorSignature?: string | null;
        now?: Date | string;
    },
): Promise<DraftLifecycleReadModel> {
    const draftPostId = parsePositiveInt(input.draftPostId);
    if (!draftPostId) {
        throw new Error('invalid_draft_post_id');
    }
    if (!parseNonEmptyString(input.anchorSignature)) {
        throw new Error('draft_lifecycle_anchor_signature_required');
    }

    const post = await loadDraftPost(prisma, draftPostId);
    const handoff = await loadAcceptedCandidateHandoffForDraftPost(prisma, draftPostId);
    const lifecycleTemplate = post.circleId
        ? (await resolveCirclePolicyProfile(prisma, post.circleId)).draftLifecycleTemplate
        : buildDefaultLifecycleTemplate();

    await archiveDraftWorkflow(prisma, {
        draftPostId,
        circleId: post.circleId,
        actorUserId: input.actorUserId,
        template: lifecycleTemplate,
        seedStartedAt: new Date(handoff?.acceptedAt || post.createdAt),
        now: input.now ? new Date(input.now) : new Date(),
    });

    return resolveDraftLifecycleReadModel(prisma, {
        draftPostId,
        now: input.now,
    });
}

export async function restoreDraftLifecycle(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        actorUserId: number | null;
        anchorSignature?: string | null;
        now?: Date | string;
    },
): Promise<DraftLifecycleReadModel> {
    const draftPostId = parsePositiveInt(input.draftPostId);
    if (!draftPostId) {
        throw new Error('invalid_draft_post_id');
    }
    if (!parseNonEmptyString(input.anchorSignature)) {
        throw new Error('draft_lifecycle_anchor_signature_required');
    }

    const post = await loadDraftPost(prisma, draftPostId);
    const handoff = await loadAcceptedCandidateHandoffForDraftPost(prisma, draftPostId);
    const lifecycleTemplate = post.circleId
        ? (await resolveCirclePolicyProfile(prisma, post.circleId)).draftLifecycleTemplate
        : buildDefaultLifecycleTemplate();

    await restoreDraftWorkflow(prisma, {
        draftPostId,
        circleId: post.circleId,
        actorUserId: input.actorUserId,
        template: lifecycleTemplate,
        seedStartedAt: new Date(handoff?.acceptedAt || post.createdAt),
        now: input.now ? new Date(input.now) : new Date(),
    });

    return resolveDraftLifecycleReadModel(prisma, {
        draftPostId,
        now: input.now,
    });
}
