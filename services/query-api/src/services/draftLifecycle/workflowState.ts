import { Prisma, type PrismaClient } from '@prisma/client';

import {
    buildDefaultLifecycleTemplate,
    resolveCirclePolicyProfile,
} from '../policy/profile';
import {
    createCollabEditAnchorBatch,
    getCollabEditAnchorById,
    getCollabEditAnchorsBySnapshotHash,
    verifyCollabEditAnchor,
    type CollabEditAnchorRecord,
} from '../collabEditAnchor';
import { sqlTimestampWithoutTimeZone } from '../../utils/sqlTimestamp';
import type {
    DraftLifecycleTemplateSnapshot,
    DraftReviewEntryMode,
} from '../policy/types';
import {
    createDraftVersionSnapshot,
    loadDraftVersionSnapshot,
    updateDraftVersionSnapshotSourceEvidence,
} from './versionSnapshots';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export type DraftWorkflowDocumentStatus =
    | 'drafting'
    | 'review'
    | 'crystallization_active'
    | 'crystallization_failed'
    | 'crystallized'
    | 'archived';

export type DraftWorkflowTransitionMode =
    | 'seeded'
    | 'auto_lock'
    | 'manual_lock'
    | 'manual_extend'
    | 'archived'
    | 'review_window_elapsed'
    | 'enter_crystallization'
    | 'crystallization_succeeded'
    | 'crystallization_failed'
    | 'rollback_to_review'
    | null;

interface DraftWorkflowStateRow {
    draftPostId: number;
    circleId: number | null;
    documentStatus: string;
    currentSnapshotVersion: number;
    currentRound: number;
    reviewEntryMode: string;
    draftingStartedAt: Date | null;
    draftingEndsAt: Date | null;
    reviewStartedAt: Date | null;
    reviewEndsAt: Date | null;
    reviewWindowExpiredAt: Date | null;
    crystallizationPolicyProfileDigest: string | null;
    crystallizationAnchorSignature: string | null;
    transitionMode: string | null;
    lastTransitionAt: Date | null;
    lastTransitionBy: number | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface DraftWorkflowSweepResult {
    transitionedCount: number;
    transitionedDraftPostIds: number[];
    reviewWindowExpiredCount: number;
    reviewWindowExpiredDraftPostIds: number[];
}

export interface DraftWorkflowStateView {
    draftPostId: number;
    circleId: number | null;
    documentStatus: DraftWorkflowDocumentStatus;
    currentSnapshotVersion: number;
    currentRound: number;
    reviewEntryMode: DraftReviewEntryMode;
    draftingStartedAt: string | null;
    draftingEndsAt: string | null;
    reviewStartedAt: string | null;
    reviewEndsAt: string | null;
    reviewWindowExpiredAt: string | null;
    crystallizationPolicyProfileDigest: string | null;
    crystallizationAnchorSignature: string | null;
    transitionMode: DraftWorkflowTransitionMode;
    lastTransitionAt: string | null;
    lastTransitionBy: number | null;
}

export class DraftWorkflowStateError extends Error {
    code: string;
    statusCode: number;

    constructor(code: string, statusCode: number, message: string) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
    }
}

function isMissingTableError(error: unknown, tableName: string): boolean {
    const code = (error as { code?: string } | null)?.code;
    if (code === '42P01') return true;
    const message = error instanceof Error ? error.message : String(error ?? '');
    return message.includes(tableName) && message.includes('does not exist');
}

function addMinutes(date: Date, minutes: number): Date {
    return new Date(date.getTime() + (minutes * 60 * 1000));
}

function parseNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function toIsoString(value: Date | string | null | undefined): string | null {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    return String(value);
}

function normalizeDocumentStatus(raw: unknown): DraftWorkflowDocumentStatus {
    const value = String(raw || '').trim().toLowerCase();
    if (value === 'review') return 'review';
    if (value === 'crystallization_active') return 'crystallization_active';
    if (value === 'crystallization_failed') return 'crystallization_failed';
    if (value === 'crystallized') return 'crystallized';
    if (value === 'archived') return 'archived';
    return 'drafting';
}

function normalizeReviewEntryMode(raw: unknown): DraftReviewEntryMode {
    const value = String(raw || '').trim().toLowerCase();
    if (value === 'auto_only') return 'auto_only';
    if (value === 'manual_only') return 'manual_only';
    return 'auto_or_manual';
}

function normalizeTransitionMode(raw: unknown): DraftWorkflowTransitionMode {
    const value = String(raw || '').trim().toLowerCase();
    if (value === 'seeded') return 'seeded';
    if (value === 'auto_lock') return 'auto_lock';
    if (value === 'manual_lock') return 'manual_lock';
    if (value === 'manual_extend') return 'manual_extend';
    if (value === 'archived') return 'archived';
    if (value === 'review_window_elapsed') return 'review_window_elapsed';
    if (value === 'enter_crystallization') return 'enter_crystallization';
    if (value === 'crystallization_succeeded') return 'crystallization_succeeded';
    if (value === 'crystallization_failed') return 'crystallization_failed';
    if (value === 'rollback_to_review') return 'rollback_to_review';
    return null;
}

function mapRowToView(row: DraftWorkflowStateRow): DraftWorkflowStateView {
    return {
        draftPostId: row.draftPostId,
        circleId: row.circleId,
        documentStatus: normalizeDocumentStatus(row.documentStatus),
        currentSnapshotVersion: Math.max(1, row.currentSnapshotVersion || 1),
        currentRound: Math.max(1, row.currentRound || 1),
        reviewEntryMode: normalizeReviewEntryMode(row.reviewEntryMode),
        draftingStartedAt: toIsoString(row.draftingStartedAt),
        draftingEndsAt: toIsoString(row.draftingEndsAt),
        reviewStartedAt: toIsoString(row.reviewStartedAt),
        reviewEndsAt: toIsoString(row.reviewEndsAt),
        reviewWindowExpiredAt: toIsoString(row.reviewWindowExpiredAt),
        crystallizationPolicyProfileDigest: row.crystallizationPolicyProfileDigest ?? null,
        crystallizationAnchorSignature: row.crystallizationAnchorSignature ?? null,
        transitionMode: normalizeTransitionMode(row.transitionMode),
        lastTransitionAt: toIsoString(row.lastTransitionAt),
        lastTransitionBy: row.lastTransitionBy ?? null,
    };
}

async function loadDraftWorkflowStateRow(
    prisma: PrismaLike,
    draftPostId: number,
): Promise<DraftWorkflowStateRow | null> {
    try {
        const rows = await prisma.$queryRaw<DraftWorkflowStateRow[]>(Prisma.sql`
            SELECT
                draft_post_id AS "draftPostId",
                circle_id AS "circleId",
                document_status AS "documentStatus",
                current_snapshot_version AS "currentSnapshotVersion",
                current_round AS "currentRound",
                review_entry_mode AS "reviewEntryMode",
                drafting_started_at AS "draftingStartedAt",
                drafting_ends_at AS "draftingEndsAt",
                review_started_at AS "reviewStartedAt",
                review_ends_at AS "reviewEndsAt",
                review_window_expired_at AS "reviewWindowExpiredAt",
                crystallization_policy_profile_digest AS "crystallizationPolicyProfileDigest",
                crystallization_anchor_signature AS "crystallizationAnchorSignature",
                transition_mode AS "transitionMode",
                last_transition_at AS "lastTransitionAt",
                last_transition_by AS "lastTransitionBy",
                created_at AS "createdAt",
                updated_at AS "updatedAt"
            FROM draft_workflow_state
            WHERE draft_post_id = ${draftPostId}
            LIMIT 1
        `);
        return rows[0] || null;
    } catch (error) {
        if (isMissingTableError(error, 'draft_workflow_state')) {
            return null;
        }
        throw error;
    }
}

async function loadDueDraftWorkflowStateRows(
    prisma: PrismaClient,
    input: {
        now: Date;
        limit: number;
    },
): Promise<DraftWorkflowStateRow[]> {
    try {
        const now = sqlTimestampWithoutTimeZone(input.now);
        return await prisma.$queryRaw<DraftWorkflowStateRow[]>(Prisma.sql`
            SELECT
                draft_post_id AS "draftPostId",
                circle_id AS "circleId",
                document_status AS "documentStatus",
                current_snapshot_version AS "currentSnapshotVersion",
                current_round AS "currentRound",
                review_entry_mode AS "reviewEntryMode",
                drafting_started_at AS "draftingStartedAt",
                drafting_ends_at AS "draftingEndsAt",
                review_started_at AS "reviewStartedAt",
                review_ends_at AS "reviewEndsAt",
                review_window_expired_at AS "reviewWindowExpiredAt",
                crystallization_policy_profile_digest AS "crystallizationPolicyProfileDigest",
                crystallization_anchor_signature AS "crystallizationAnchorSignature",
                transition_mode AS "transitionMode",
                last_transition_at AS "lastTransitionAt",
                last_transition_by AS "lastTransitionBy",
                created_at AS "createdAt",
                updated_at AS "updatedAt"
            FROM draft_workflow_state
            WHERE document_status = 'drafting'
                AND review_entry_mode <> 'manual_only'
                AND drafting_ends_at IS NOT NULL
                AND drafting_ends_at <= ${now}
            ORDER BY drafting_ends_at ASC
            LIMIT ${input.limit}
        `);
    } catch (error) {
        if (isMissingTableError(error, 'draft_workflow_state')) {
            return [];
        }
        throw error;
    }
}

async function loadDueReviewWindowExpiredRows(
    prisma: PrismaClient,
    input: {
        now: Date;
        limit: number;
    },
): Promise<DraftWorkflowStateRow[]> {
    try {
        const now = sqlTimestampWithoutTimeZone(input.now);
        return await prisma.$queryRaw<DraftWorkflowStateRow[]>(Prisma.sql`
            SELECT
                draft_post_id AS "draftPostId",
                circle_id AS "circleId",
                document_status AS "documentStatus",
                current_snapshot_version AS "currentSnapshotVersion",
                current_round AS "currentRound",
                review_entry_mode AS "reviewEntryMode",
                drafting_started_at AS "draftingStartedAt",
                drafting_ends_at AS "draftingEndsAt",
                review_started_at AS "reviewStartedAt",
                review_ends_at AS "reviewEndsAt",
                review_window_expired_at AS "reviewWindowExpiredAt",
                crystallization_policy_profile_digest AS "crystallizationPolicyProfileDigest",
                crystallization_anchor_signature AS "crystallizationAnchorSignature",
                transition_mode AS "transitionMode",
                last_transition_at AS "lastTransitionAt",
                last_transition_by AS "lastTransitionBy",
                created_at AS "createdAt",
                updated_at AS "updatedAt"
            FROM draft_workflow_state
            WHERE document_status = 'review'
                AND review_ends_at IS NOT NULL
                AND review_ends_at <= ${now}
                AND review_window_expired_at IS NULL
            ORDER BY review_ends_at ASC
            LIMIT ${input.limit}
        `);
    } catch (error) {
        if (isMissingTableError(error, 'draft_workflow_state')) {
            return [];
        }
        throw error;
    }
}

async function markDraftWorkflowReviewWindowExpired(
    prisma: PrismaLike,
    input: {
        draftPostId: number;
        expiredAt: Date;
    },
): Promise<boolean> {
    const expiredAt = sqlTimestampWithoutTimeZone(input.expiredAt);
    const updatedAt = sqlTimestampWithoutTimeZone(new Date());
    const updated = await prisma.$executeRaw(Prisma.sql`
        UPDATE draft_workflow_state
        SET
            review_window_expired_at = ${expiredAt},
            transition_mode = 'review_window_elapsed',
            last_transition_at = ${expiredAt},
            updated_at = ${updatedAt}
        WHERE draft_post_id = ${input.draftPostId}
            AND document_status = 'review'
            AND review_ends_at IS NOT NULL
            AND review_ends_at <= ${expiredAt}
            AND review_window_expired_at IS NULL
    `);
    return Number(updated) > 0;
}

async function insertSeedDraftWorkflowState(
    prisma: PrismaLike,
    input: {
        draftPostId: number;
        circleId: number | null;
        template: DraftLifecycleTemplateSnapshot;
        seedStartedAt: Date;
    },
): Promise<void> {
    const seedStartedAt = sqlTimestampWithoutTimeZone(input.seedStartedAt);
    const draftingEndsAt = sqlTimestampWithoutTimeZone(
        addMinutes(input.seedStartedAt, input.template.draftingWindowMinutes),
    );
    await prisma.$executeRaw(Prisma.sql`
        INSERT INTO draft_workflow_state (
            draft_post_id,
            circle_id,
            document_status,
            current_snapshot_version,
            current_round,
            review_entry_mode,
            drafting_started_at,
            drafting_ends_at,
            review_started_at,
            review_ends_at,
            review_window_expired_at,
            transition_mode,
            last_transition_at,
            last_transition_by
        )
        VALUES (
            ${input.draftPostId},
            ${input.circleId},
            'drafting',
            1,
            1,
            ${input.template.reviewEntryMode},
            ${seedStartedAt},
            ${draftingEndsAt},
            ${null},
            ${null},
            ${null},
            'seeded',
            ${seedStartedAt},
            ${null}
        )
        ON CONFLICT (draft_post_id) DO NOTHING
    `);
}

async function transitionDraftWorkflowStateToReview(
    prisma: PrismaLike,
    input: {
        draftPostId: number;
        template: DraftLifecycleTemplateSnapshot;
        reviewStartedAt: Date;
        nextSnapshotVersion: number;
        transitionMode: 'auto_lock' | 'manual_lock';
        actorUserId: number | null;
    },
): Promise<boolean> {
    const updatedAt = sqlTimestampWithoutTimeZone(new Date());
    const reviewStartedAt = sqlTimestampWithoutTimeZone(input.reviewStartedAt);
    const reviewEndsAt = sqlTimestampWithoutTimeZone(
        addMinutes(input.reviewStartedAt, input.template.reviewWindowMinutes),
    );
    const updated = await prisma.$executeRaw(Prisma.sql`
        UPDATE draft_workflow_state
        SET
            document_status = 'review',
            current_snapshot_version = ${input.nextSnapshotVersion},
            review_started_at = ${reviewStartedAt},
            review_ends_at = ${reviewEndsAt},
            review_window_expired_at = ${null},
            transition_mode = ${input.transitionMode},
            last_transition_at = ${reviewStartedAt},
            last_transition_by = ${input.actorUserId},
            updated_at = ${updatedAt}
        WHERE draft_post_id = ${input.draftPostId}
            AND document_status = 'drafting'
    `);
    return Number(updated) > 0;
}

async function transitionDraftWorkflowStateToDrafting(
    prisma: PrismaLike,
    input: {
        draftPostId: number;
        template: DraftLifecycleTemplateSnapshot;
        draftingStartedAt: Date;
        actorUserId: number | null;
        allowRestoreFromArchive?: boolean;
    },
): Promise<boolean> {
    const updatedAt = sqlTimestampWithoutTimeZone(new Date());
    const draftingStartedAt = sqlTimestampWithoutTimeZone(input.draftingStartedAt);
    const draftingEndsAt = sqlTimestampWithoutTimeZone(
        addMinutes(input.draftingStartedAt, input.template.draftingWindowMinutes),
    );
    const updated = await prisma.$executeRaw(Prisma.sql`
        UPDATE draft_workflow_state
        SET
            document_status = 'drafting',
            current_round = current_round + 1,
            drafting_started_at = ${draftingStartedAt},
            drafting_ends_at = ${draftingEndsAt},
            review_started_at = ${null},
            review_ends_at = ${null},
            review_window_expired_at = ${null},
            crystallization_policy_profile_digest = ${null},
            crystallization_anchor_signature = ${null},
            transition_mode = 'manual_extend',
            last_transition_at = ${draftingStartedAt},
            last_transition_by = ${input.actorUserId},
            updated_at = ${updatedAt}
        WHERE draft_post_id = ${input.draftPostId}
            AND (
                document_status = 'review'
                ${input.allowRestoreFromArchive
                    ? Prisma.sql`OR document_status = 'archived'`
                    : Prisma.empty}
            )
    `);
    return Number(updated) > 0;
}

async function transitionDraftWorkflowStateToArchived(
    prisma: PrismaLike,
    input: {
        draftPostId: number;
        archivedAt: Date;
        actorUserId: number | null;
    },
): Promise<boolean> {
    const archivedAt = sqlTimestampWithoutTimeZone(input.archivedAt);
    const updatedAt = sqlTimestampWithoutTimeZone(new Date());
    const updated = await prisma.$executeRaw(Prisma.sql`
        UPDATE draft_workflow_state
        SET
            document_status = 'archived',
            drafting_ends_at = ${null},
            review_ends_at = ${null},
            review_window_expired_at = ${null},
            crystallization_policy_profile_digest = ${null},
            crystallization_anchor_signature = ${null},
            transition_mode = 'archived',
            last_transition_at = ${archivedAt},
            last_transition_by = ${input.actorUserId},
            updated_at = ${updatedAt}
        WHERE draft_post_id = ${input.draftPostId}
            AND document_status IN (
                'drafting',
                'review',
                'crystallization_active',
                'crystallization_failed'
            )
    `);
    return Number(updated) > 0;
}

async function transitionDraftWorkflowStateToCrystallization(
    prisma: PrismaLike,
    input: {
        draftPostId: number;
        crystallizationStartedAt: Date;
        actorUserId: number | null;
        policyProfileDigest: string;
        anchorSignature: string;
        allowRetryFromFailure?: boolean;
    },
): Promise<boolean> {
    const crystallizationStartedAt = sqlTimestampWithoutTimeZone(input.crystallizationStartedAt);
    const updatedAt = sqlTimestampWithoutTimeZone(new Date());
    const updated = await prisma.$executeRaw(Prisma.sql`
        UPDATE draft_workflow_state
        SET
            document_status = 'crystallization_active',
            review_ends_at = COALESCE(review_ends_at, ${crystallizationStartedAt}),
            crystallization_policy_profile_digest = ${input.policyProfileDigest},
            crystallization_anchor_signature = ${input.anchorSignature},
            transition_mode = 'enter_crystallization',
            last_transition_at = ${crystallizationStartedAt},
            last_transition_by = ${input.actorUserId},
            updated_at = ${updatedAt}
        WHERE draft_post_id = ${input.draftPostId}
            AND (
                document_status = 'review'
                ${input.allowRetryFromFailure
                    ? Prisma.sql`OR document_status = 'crystallization_failed'`
                    : Prisma.empty}
            )
    `);
    return Number(updated) > 0;
}

async function transitionDraftWorkflowStateToCrystallized(
    prisma: PrismaLike,
    input: {
        draftPostId: number;
        crystallizedAt: Date;
        actorUserId: number | null;
    },
): Promise<boolean> {
    const crystallizedAt = sqlTimestampWithoutTimeZone(input.crystallizedAt);
    const updatedAt = sqlTimestampWithoutTimeZone(new Date());
    const updated = await prisma.$executeRaw(Prisma.sql`
        UPDATE draft_workflow_state
        SET
            document_status = 'crystallized',
            transition_mode = 'crystallization_succeeded',
            last_transition_at = ${crystallizedAt},
            last_transition_by = ${input.actorUserId},
            updated_at = ${updatedAt}
        WHERE draft_post_id = ${input.draftPostId}
            AND document_status = 'crystallization_active'
    `);
    return Number(updated) > 0;
}

async function transitionDraftWorkflowStateToCrystallizationFailed(
    prisma: PrismaLike,
    input: {
        draftPostId: number;
        failedAt: Date;
        actorUserId: number | null;
    },
): Promise<boolean> {
    const failedAt = sqlTimestampWithoutTimeZone(input.failedAt);
    const updatedAt = sqlTimestampWithoutTimeZone(new Date());
    const updated = await prisma.$executeRaw(Prisma.sql`
        UPDATE draft_workflow_state
        SET
            document_status = 'crystallization_failed',
            transition_mode = 'crystallization_failed',
            last_transition_at = ${failedAt},
            last_transition_by = ${input.actorUserId},
            updated_at = ${updatedAt}
        WHERE draft_post_id = ${input.draftPostId}
            AND document_status = 'crystallization_active'
    `);
    return Number(updated) > 0;
}

async function transitionDraftWorkflowStateToReviewFromCrystallizationFailure(
    prisma: PrismaLike,
    input: {
        draftPostId: number;
        template: DraftLifecycleTemplateSnapshot;
        returnedAt: Date;
        actorUserId: number | null;
    },
): Promise<boolean> {
    const returnedAt = sqlTimestampWithoutTimeZone(input.returnedAt);
    const reviewEndsAt = sqlTimestampWithoutTimeZone(
        addMinutes(input.returnedAt, input.template.reviewWindowMinutes),
    );
    const updatedAt = sqlTimestampWithoutTimeZone(new Date());
    const updated = await prisma.$executeRaw(Prisma.sql`
        UPDATE draft_workflow_state
        SET
            document_status = 'review',
            review_started_at = ${returnedAt},
            review_ends_at = ${reviewEndsAt},
            review_window_expired_at = ${null},
            crystallization_policy_profile_digest = ${null},
            crystallization_anchor_signature = ${null},
            transition_mode = 'rollback_to_review',
            last_transition_at = ${returnedAt},
            last_transition_by = ${input.actorUserId},
            updated_at = ${updatedAt}
        WHERE draft_post_id = ${input.draftPostId}
            AND document_status = 'crystallization_failed'
    `);
    return Number(updated) > 0;
}

interface DraftSeedOriginRow {
    createdAt: Date;
}

function normalizeSeedOriginStartedAt(
    handoffCreatedAt: Date | null,
    draftPostCreatedAt: Date | null,
): Date | null {
    if (!handoffCreatedAt) return draftPostCreatedAt;
    if (!draftPostCreatedAt) return handoffCreatedAt;
    const skewMs = Math.abs(handoffCreatedAt.getTime() - draftPostCreatedAt.getTime());
    if (skewMs > 5 * 60 * 1000) {
        return draftPostCreatedAt;
    }
    return handoffCreatedAt;
}

async function loadSeedOriginStartedAt(
    prisma: PrismaLike,
    draftPostId: number,
): Promise<Date | null> {
    const postRows = await prisma.$queryRaw<DraftSeedOriginRow[]>(Prisma.sql`
        SELECT created_at AS "createdAt"
        FROM posts
        WHERE id = ${draftPostId}
        LIMIT 1
    `);
    const postCreatedAt = postRows[0]?.createdAt instanceof Date
        ? postRows[0].createdAt
        : null;

    const handoffRows = await prisma.$queryRaw<DraftSeedOriginRow[]>(Prisma.sql`
        SELECT created_at AS "createdAt"
        FROM circle_discussion_messages
        WHERE deleted = FALSE
          AND metadata IS NOT NULL
          AND message_kind IN ('draft_candidate_notice', 'governance_notice')
          AND metadata->>'draftPostId' = ${String(draftPostId)}
          AND lower(COALESCE(metadata->>'state', '')) = 'accepted'
        ORDER BY created_at DESC
        LIMIT 1
    `);
    const handoffCreatedAt = handoffRows[0]?.createdAt instanceof Date
        ? handoffRows[0].createdAt
        : null;
    return normalizeSeedOriginStartedAt(handoffCreatedAt, postCreatedAt);
}

async function repairSeededDraftWorkflowStateIfSkewed(
    prisma: PrismaLike,
    input: {
        row: DraftWorkflowStateRow;
        template: DraftLifecycleTemplateSnapshot;
        seedStartedAt: Date;
    },
): Promise<DraftWorkflowStateRow> {
    if (normalizeDocumentStatus(input.row.documentStatus) !== 'drafting') return input.row;
    if (normalizeTransitionMode(input.row.transitionMode) !== 'seeded') return input.row;
    if ((input.row.currentSnapshotVersion || 1) !== 1 || (input.row.currentRound || 1) !== 1) return input.row;
    if (!(input.row.lastTransitionAt instanceof Date) || !(input.row.draftingStartedAt instanceof Date)) {
        return input.row;
    }

    const expectedStartMs = input.seedStartedAt.getTime();
    const transitionDeltaMs = Math.abs(input.row.lastTransitionAt.getTime() - expectedStartMs);
    const draftingDeltaMs = Math.abs(input.row.draftingStartedAt.getTime() - expectedStartMs);
    if (transitionDeltaMs < 60_000 && draftingDeltaMs < 60_000) {
        return input.row;
    }

    const seedStartedAt = sqlTimestampWithoutTimeZone(input.seedStartedAt);
    const draftingEndsAt = sqlTimestampWithoutTimeZone(
        addMinutes(input.seedStartedAt, input.template.draftingWindowMinutes),
    );
    const updatedAt = sqlTimestampWithoutTimeZone(new Date());
    await prisma.$executeRaw(Prisma.sql`
        UPDATE draft_workflow_state
        SET
            drafting_started_at = ${seedStartedAt},
            drafting_ends_at = ${draftingEndsAt},
            last_transition_at = ${seedStartedAt},
            updated_at = ${updatedAt}
        WHERE draft_post_id = ${input.row.draftPostId}
          AND document_status = 'drafting'
          AND transition_mode = 'seeded'
    `);

    return (await loadDraftWorkflowStateRow(prisma, input.row.draftPostId)) || input.row;
}

async function repairAutoLockReviewWorkflowStateIfSkewed(
    prisma: PrismaLike,
    input: {
        row: DraftWorkflowStateRow;
        template: DraftLifecycleTemplateSnapshot;
        seedStartedAt: Date;
    },
): Promise<DraftWorkflowStateRow> {
    if (normalizeDocumentStatus(input.row.documentStatus) !== 'review') return input.row;
    if (normalizeTransitionMode(input.row.transitionMode) !== 'auto_lock') return input.row;
    if (!(input.row.reviewStartedAt instanceof Date) || !(input.row.reviewEndsAt instanceof Date)) {
        return input.row;
    }

    const expectedReviewStartedAt = addMinutes(input.seedStartedAt, input.template.draftingWindowMinutes);
    const expectedReviewEndsAt = addMinutes(expectedReviewStartedAt, input.template.reviewWindowMinutes);
    const reviewStartDeltaMs = Math.abs(input.row.reviewStartedAt.getTime() - expectedReviewStartedAt.getTime());
    const reviewEndDeltaMs = Math.abs(input.row.reviewEndsAt.getTime() - expectedReviewEndsAt.getTime());
    const draftingDeltaMs = input.row.draftingStartedAt instanceof Date
        ? Math.abs(input.row.draftingStartedAt.getTime() - input.seedStartedAt.getTime())
        : Infinity;
    if (reviewStartDeltaMs < 60_000 && reviewEndDeltaMs < 60_000 && draftingDeltaMs < 60_000) {
        return input.row;
    }

    const seedStartedAt = sqlTimestampWithoutTimeZone(input.seedStartedAt);
    const draftingEndsAt = sqlTimestampWithoutTimeZone(expectedReviewStartedAt);
    const reviewStartedAt = sqlTimestampWithoutTimeZone(expectedReviewStartedAt);
    const reviewEndsAt = sqlTimestampWithoutTimeZone(expectedReviewEndsAt);
    const updatedAt = sqlTimestampWithoutTimeZone(new Date());
    await prisma.$executeRaw(Prisma.sql`
        UPDATE draft_workflow_state
        SET
            drafting_started_at = ${seedStartedAt},
            drafting_ends_at = ${draftingEndsAt},
            review_started_at = ${reviewStartedAt},
            review_ends_at = ${reviewEndsAt},
            last_transition_at = ${reviewStartedAt},
            updated_at = ${updatedAt}
        WHERE draft_post_id = ${input.row.draftPostId}
          AND document_status = 'review'
          AND transition_mode = 'auto_lock'
    `);

    return (await loadDraftWorkflowStateRow(prisma, input.row.draftPostId)) || input.row;
}

function inferReviewTransitionMode(
    row: DraftWorkflowStateRow,
): 'auto_lock' | 'manual_lock' {
    if (row.reviewStartedAt instanceof Date && row.draftingEndsAt instanceof Date) {
        const deltaMs = Math.abs(row.reviewStartedAt.getTime() - row.draftingEndsAt.getTime());
        if (deltaMs < 60_000) {
            return 'auto_lock';
        }
    }
    return 'manual_lock';
}

async function repairPrematureReviewWindowElapsedState(
    prisma: PrismaLike,
    input: {
        row: DraftWorkflowStateRow;
        now: Date;
    },
): Promise<DraftWorkflowStateRow> {
    if (normalizeDocumentStatus(input.row.documentStatus) !== 'review') return input.row;
    if (normalizeTransitionMode(input.row.transitionMode) !== 'review_window_elapsed') return input.row;
    if (!(input.row.reviewEndsAt instanceof Date) || !(input.row.lastTransitionAt instanceof Date)) {
        return input.row;
    }
    if (input.row.reviewEndsAt.getTime() <= input.now.getTime() + 1000) {
        return input.row;
    }

    const transitionMode = inferReviewTransitionMode(input.row);
    const restoredTransitionAt = input.row.reviewStartedAt instanceof Date
        ? input.row.reviewStartedAt
        : input.row.lastTransitionAt;
    const reviewWindowExpiredAt = null;
    const lastTransitionAt = sqlTimestampWithoutTimeZone(restoredTransitionAt);
    const updatedAt = sqlTimestampWithoutTimeZone(new Date());
    await prisma.$executeRaw(Prisma.sql`
        UPDATE draft_workflow_state
        SET
            review_window_expired_at = ${reviewWindowExpiredAt},
            transition_mode = ${transitionMode},
            last_transition_at = ${lastTransitionAt},
            updated_at = ${updatedAt}
        WHERE draft_post_id = ${input.row.draftPostId}
          AND document_status = 'review'
          AND transition_mode = 'review_window_elapsed'
    `);

    return (await loadDraftWorkflowStateRow(prisma, input.row.draftPostId)) || input.row;
}

async function loadDraftWorkingCopySnapshotSeed(
    prisma: PrismaLike,
    draftPostId: number,
): Promise<{
    contentSnapshot: string;
}> {
    const post = await prisma.post.findUnique({
        where: { id: draftPostId },
        select: {
            text: true,
        },
    });
    return {
        contentSnapshot: String(post?.text || ''),
    };
}

async function rebindDraftDiscussionThreadsToSnapshotVersion(
    prisma: PrismaLike,
    input: {
        draftPostId: number;
        fromVersion: number;
        toVersion: number;
        draftingStartedAt: Date | null;
    },
): Promise<void> {
    if (!input.draftingStartedAt) {
        return;
    }
    await prisma.$executeRaw(Prisma.sql`
        UPDATE draft_discussion_threads
        SET target_version = ${input.toVersion}
        WHERE draft_post_id = ${input.draftPostId}
          AND target_version = ${input.fromVersion}
          AND created_at >= ${input.draftingStartedAt}
    `);
}

async function materializeReviewSnapshotAndEnterState(
    prisma: PrismaLike,
    input: {
        row: DraftWorkflowStateRow;
        template: DraftLifecycleTemplateSnapshot;
        reviewStartedAt: Date;
        transitionMode: 'auto_lock' | 'manual_lock';
        actorUserId: number | null;
    },
): Promise<boolean> {
    const previousVersion = Math.max(1, input.row.currentSnapshotVersion || 1);
    const nextSnapshotVersion = previousVersion + 1;
    const snapshotSeed = await loadDraftWorkingCopySnapshotSeed(prisma, input.row.draftPostId);

    await createDraftVersionSnapshot(prisma, {
        draftPostId: input.row.draftPostId,
        draftVersion: nextSnapshotVersion,
        contentSnapshot: snapshotSeed.contentSnapshot,
        createdFromState: 'drafting',
        createdBy: input.actorUserId,
    });

    await rebindDraftDiscussionThreadsToSnapshotVersion(prisma, {
        draftPostId: input.row.draftPostId,
        fromVersion: previousVersion,
        toVersion: nextSnapshotVersion,
        draftingStartedAt: input.row.draftingStartedAt,
    });

    return transitionDraftWorkflowStateToReview(prisma, {
        draftPostId: input.row.draftPostId,
        template: input.template,
        reviewStartedAt: input.reviewStartedAt,
        nextSnapshotVersion,
        transitionMode: input.transitionMode,
        actorUserId: input.actorUserId,
    });
}

function isUsableSnapshotEvidenceAnchor(
    anchor: CollabEditAnchorRecord | null,
    snapshotHash: string,
): boolean {
    if (!anchor) return false;
    if (anchor.status !== 'anchored') return false;
    if (String(anchor.snapshotHash || '').toLowerCase() !== String(snapshotHash || '').toLowerCase()) {
        return false;
    }
    return verifyCollabEditAnchor(anchor).verifiable;
}

async function resolveBoundSnapshotEvidenceAnchor(
    prisma: PrismaLike,
    input: {
        draftPostId: number;
        sourceEditAnchorId: string | null;
        contentHash: string;
    },
): Promise<{
    usableAnchor: CollabEditAnchorRecord | null;
    pendingAnchor: CollabEditAnchorRecord | null;
}> {
    if (input.sourceEditAnchorId) {
        const boundAnchor = await getCollabEditAnchorById(prisma, input.sourceEditAnchorId);
        if (isUsableSnapshotEvidenceAnchor(boundAnchor, input.contentHash)) {
            return { usableAnchor: boundAnchor, pendingAnchor: null };
        }
        if (
            boundAnchor
            && String(boundAnchor.snapshotHash || '').toLowerCase() === String(input.contentHash || '').toLowerCase()
            && (boundAnchor.status === 'pending' || boundAnchor.status === 'anchoring')
        ) {
            return { usableAnchor: null, pendingAnchor: boundAnchor };
        }
    }

    const matchingAnchors = await getCollabEditAnchorsBySnapshotHash(prisma, {
        draftPostId: input.draftPostId,
        snapshotHash: input.contentHash,
        limit: 10,
    });
    const usableAnchor =
        matchingAnchors.find((anchor) => isUsableSnapshotEvidenceAnchor(anchor, input.contentHash)) || null;
    if (usableAnchor) {
        return { usableAnchor, pendingAnchor: null };
    }
    const pendingAnchor =
        matchingAnchors.find((anchor) => anchor.status === 'pending' || anchor.status === 'anchoring') || null;
    return { usableAnchor: null, pendingAnchor };
}

async function ensureStableSnapshotCollabAnchor(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        draftVersion: number;
        circleId: number | null;
        actorUserId: number | null;
    },
): Promise<CollabEditAnchorRecord> {
    const snapshot = await loadDraftVersionSnapshot(prisma, {
        draftPostId: input.draftPostId,
        draftVersion: input.draftVersion,
    });
    if (!snapshot) {
        throw new DraftWorkflowStateError(
            'draft_snapshot_unavailable',
            409,
            'draft stable snapshot is unavailable',
        );
    }

    const resolved = await resolveBoundSnapshotEvidenceAnchor(prisma, {
        draftPostId: input.draftPostId,
        sourceEditAnchorId: snapshot.sourceEditAnchorId,
        contentHash: snapshot.contentHash,
    });
    if (resolved.usableAnchor) {
        if (snapshot.sourceEditAnchorId !== resolved.usableAnchor.anchorId) {
            await updateDraftVersionSnapshotSourceEvidence(prisma, {
                draftPostId: input.draftPostId,
                draftVersion: input.draftVersion,
                sourceEditAnchorId: resolved.usableAnchor.anchorId,
            });
        }
        return resolved.usableAnchor;
    }
    if (resolved.pendingAnchor) {
        throw new DraftWorkflowStateError(
            'draft_collab_anchor_pending',
            409,
            'draft collab edit anchor is still anchoring on-chain',
        );
    }
    if (!input.circleId) {
        throw new DraftWorkflowStateError(
            'draft_collab_anchor_unavailable',
            409,
            'draft collab edit anchor is unavailable',
        );
    }

    const lifecycleAnchor = await createCollabEditAnchorBatch({
        prisma,
        draftPostId: input.draftPostId,
        circleId: input.circleId,
        roomKey: `crucible-${input.draftPostId}`,
        snapshotHash: snapshot.contentHash,
        generatedAt: new Date(snapshot.createdAt),
        updates: [
            {
                seq: snapshot.draftVersion,
                updateHash: snapshot.contentHash,
                updateBytes: Buffer.byteLength(String(snapshot.contentSnapshot || ''), 'utf8'),
                editorUserId: input.actorUserId,
                editorHandle: null,
                receivedAt: new Date(snapshot.createdAt),
            },
        ],
    });

    if (lifecycleAnchor.status === 'pending' || lifecycleAnchor.status === 'anchoring') {
        throw new DraftWorkflowStateError(
            'draft_collab_anchor_pending',
            409,
            'draft collab edit anchor is still anchoring on-chain',
        );
    }
    if (!isUsableSnapshotEvidenceAnchor(lifecycleAnchor, snapshot.contentHash)) {
        throw new DraftWorkflowStateError(
            'draft_collab_anchor_unavailable',
            409,
            lifecycleAnchor.errorMessage || 'draft collab edit anchor is unavailable',
        );
    }
    if (snapshot.sourceEditAnchorId !== lifecycleAnchor.anchorId) {
        await updateDraftVersionSnapshotSourceEvidence(prisma, {
            draftPostId: input.draftPostId,
            draftVersion: input.draftVersion,
            sourceEditAnchorId: lifecycleAnchor.anchorId,
        });
    }
    return lifecycleAnchor;
}

export async function resolveDraftWorkflowState(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        circleId: number | null;
        template?: DraftLifecycleTemplateSnapshot;
        seedStartedAt: Date;
        now?: Date;
    },
): Promise<DraftWorkflowStateView> {
    const template = input.template || buildDefaultLifecycleTemplate();
    let row = await loadDraftWorkflowStateRow(prisma, input.draftPostId);
    if (!row) {
        await insertSeedDraftWorkflowState(prisma, {
            draftPostId: input.draftPostId,
            circleId: input.circleId,
            template,
            seedStartedAt: input.seedStartedAt,
        });
        row = await loadDraftWorkflowStateRow(prisma, input.draftPostId);
    }

    if (!row) {
        throw new DraftWorkflowStateError(
            'draft_workflow_state_unavailable',
            500,
            'draft workflow state could not be initialized',
        );
    }

    row = await repairSeededDraftWorkflowStateIfSkewed(prisma, {
        row,
        template,
        seedStartedAt: input.seedStartedAt,
    });
    row = await repairAutoLockReviewWorkflowStateIfSkewed(prisma, {
        row,
        template,
        seedStartedAt: input.seedStartedAt,
    });
    row = await repairPrematureReviewWindowElapsedState(prisma, {
        row,
        now: input.now || new Date(),
    });

    return mapRowToView(row);
}

export async function getPersistedDraftWorkflowState(
    prisma: PrismaClient,
    draftPostId: number,
    input?: {
        now?: Date;
    },
): Promise<DraftWorkflowStateView | null> {
    let row = await loadDraftWorkflowStateRow(prisma, draftPostId);
    if (!row) return null;
    const seedStartedAt = await loadSeedOriginStartedAt(prisma, draftPostId);
    if (seedStartedAt) {
        const template = row.circleId
            ? (await resolveCirclePolicyProfile(prisma, row.circleId)).draftLifecycleTemplate
            : buildDefaultLifecycleTemplate();
        row = await repairSeededDraftWorkflowStateIfSkewed(prisma, {
            row,
            template,
            seedStartedAt,
        });
        row = await repairAutoLockReviewWorkflowStateIfSkewed(prisma, {
            row,
            template,
            seedStartedAt,
        });
    }
    row = await repairPrematureReviewWindowElapsedState(prisma, {
        row,
        now: input?.now || new Date(),
    });
    return row ? mapRowToView(row) : null;
}

export async function reconcileActiveDraftWorkflowStates(
    prisma: PrismaClient,
    input: {
        circleId: number;
        template: DraftLifecycleTemplateSnapshot;
        now?: Date;
    },
): Promise<{
        draftingUpdatedCount: number;
        reviewUpdatedCount: number;
    }> {
    const now = input.now || new Date();
    const nowTimestamp = sqlTimestampWithoutTimeZone(now);
    const updatedAt = sqlTimestampWithoutTimeZone(new Date());
    const draftingUpdated = await prisma.$executeRaw(Prisma.sql`
        UPDATE draft_workflow_state
        SET
            review_entry_mode = ${input.template.reviewEntryMode},
            drafting_ends_at = CASE
                WHEN drafting_started_at IS NULL THEN drafting_ends_at
                ELSE drafting_started_at + (${input.template.draftingWindowMinutes} * INTERVAL '1 minute')
            END,
            updated_at = ${updatedAt}
        WHERE circle_id = ${input.circleId}
            AND document_status = 'drafting'
    `);
    const reviewUpdated = await prisma.$executeRaw(Prisma.sql`
        UPDATE draft_workflow_state
        SET
            review_ends_at = CASE
                WHEN review_started_at IS NULL THEN review_ends_at
                ELSE review_started_at + (${input.template.reviewWindowMinutes} * INTERVAL '1 minute')
            END,
            review_window_expired_at = CASE
                WHEN review_started_at IS NULL THEN review_window_expired_at
                WHEN review_started_at + (${input.template.reviewWindowMinutes} * INTERVAL '1 minute') <= ${nowTimestamp}
                    THEN COALESCE(review_window_expired_at, review_started_at + (${input.template.reviewWindowMinutes} * INTERVAL '1 minute'))
                ELSE NULL
            END,
            transition_mode = CASE
                WHEN review_started_at IS NULL THEN transition_mode
                WHEN review_started_at + (${input.template.reviewWindowMinutes} * INTERVAL '1 minute') <= ${nowTimestamp}
                    THEN 'review_window_elapsed'
                WHEN transition_mode = 'review_window_elapsed'
                    THEN 'manual_lock'
                ELSE transition_mode
            END,
            updated_at = ${updatedAt}
        WHERE circle_id = ${input.circleId}
            AND document_status = 'review'
    `);

    return {
        draftingUpdatedCount: Number(draftingUpdated) || 0,
        reviewUpdatedCount: Number(reviewUpdated) || 0,
    };
}

export async function processDueDraftWorkflowTransitions(
    prisma: PrismaClient,
    input?: {
        now?: Date;
        limit?: number;
        template?: DraftLifecycleTemplateSnapshot;
    },
): Promise<DraftWorkflowSweepResult> {
    const now = input?.now || new Date();
    const limit = Math.max(1, input?.limit || 100);
    const rows = await loadDueDraftWorkflowStateRows(prisma, {
        now,
        limit,
    });
    const reviewRows = await loadDueReviewWindowExpiredRows(prisma, {
        now,
        limit,
    });

    const transitionedDraftPostIds: number[] = [];
    for (const row of rows) {
        const template = input?.template
            || (row.circleId
                ? (await resolveCirclePolicyProfile(prisma, row.circleId)).draftLifecycleTemplate
                : buildDefaultLifecycleTemplate());
        const updated = await prisma.$transaction(async (tx) => {
            const currentRow = await loadDraftWorkflowStateRow(tx, row.draftPostId);
            if (!currentRow || normalizeDocumentStatus(currentRow.documentStatus) !== 'drafting') {
                return false;
            }
            return materializeReviewSnapshotAndEnterState(tx, {
                row: currentRow,
                template,
                reviewStartedAt: currentRow.draftingEndsAt || now,
                transitionMode: 'auto_lock',
                actorUserId: null,
            });
        });
        if (updated) {
            transitionedDraftPostIds.push(row.draftPostId);
        }
    }
    const reviewWindowExpiredDraftPostIds: number[] = [];
    for (const row of reviewRows) {
        const updated = await markDraftWorkflowReviewWindowExpired(prisma, {
            draftPostId: row.draftPostId,
            expiredAt: row.reviewEndsAt || now,
        });
        if (updated) {
            reviewWindowExpiredDraftPostIds.push(row.draftPostId);
        }
    }

    return {
        transitionedCount: transitionedDraftPostIds.length,
        transitionedDraftPostIds,
        reviewWindowExpiredCount: reviewWindowExpiredDraftPostIds.length,
        reviewWindowExpiredDraftPostIds,
    };
}

export async function enterDraftLifecycleReview(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        circleId: number | null;
        actorUserId: number;
        template?: DraftLifecycleTemplateSnapshot;
        seedStartedAt: Date;
        now?: Date;
    },
): Promise<DraftWorkflowStateView> {
    const template = input.template || buildDefaultLifecycleTemplate();
    const now = input.now || new Date();
    const state = await resolveDraftWorkflowState(prisma, {
        draftPostId: input.draftPostId,
        circleId: input.circleId,
        template,
        seedStartedAt: input.seedStartedAt,
        now,
    });

    if (state.documentStatus === 'review') {
        return state;
    }
    if (state.reviewEntryMode === 'auto_only') {
        throw new DraftWorkflowStateError(
            'draft_manual_review_entry_disabled',
            409,
            'this draft only supports automatic review entry',
        );
    }
    if (state.documentStatus !== 'drafting') {
        throw new DraftWorkflowStateError(
            'draft_not_in_drafting',
            409,
            'draft is not currently in drafting state',
        );
    }

    const updated = await prisma.$transaction(async (tx) => {
        const currentRow = await loadDraftWorkflowStateRow(tx, input.draftPostId);
        if (!currentRow) {
            throw new DraftWorkflowStateError(
                'draft_workflow_state_unavailable',
                500,
                'draft workflow state could not be loaded before manual transition',
            );
        }
        if (normalizeDocumentStatus(currentRow.documentStatus) !== 'drafting') {
            return false;
        }
        return materializeReviewSnapshotAndEnterState(tx, {
            row: currentRow,
            template,
            reviewStartedAt: now,
            transitionMode: 'manual_lock',
            actorUserId: input.actorUserId,
        });
    });
    if (!updated) {
        const rowAfterNoop = await loadDraftWorkflowStateRow(prisma, input.draftPostId);
        if (rowAfterNoop) {
            const nextState = mapRowToView(rowAfterNoop);
            if (nextState.documentStatus === 'review') {
                return nextState;
            }
        }
    }
    const row = await loadDraftWorkflowStateRow(prisma, input.draftPostId);
    if (!row) {
        throw new DraftWorkflowStateError(
            'draft_workflow_state_unavailable',
            500,
            'draft workflow state could not be reloaded after manual transition',
        );
    }
    return mapRowToView(row);
}

export async function advanceDraftLifecycleFromReview(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        circleId: number | null;
        actorUserId: number;
        template?: DraftLifecycleTemplateSnapshot;
        seedStartedAt: Date;
        now?: Date;
    },
): Promise<DraftWorkflowStateView> {
    const template = input.template || buildDefaultLifecycleTemplate();
    const now = input.now || new Date();
    const state = await resolveDraftWorkflowState(prisma, {
        draftPostId: input.draftPostId,
        circleId: input.circleId,
        template,
        seedStartedAt: input.seedStartedAt,
        now,
    });

    if (state.documentStatus === 'drafting') {
        return state;
    }
    if (state.documentStatus !== 'review') {
        throw new DraftWorkflowStateError(
            'draft_not_in_review',
            409,
            'draft is not currently in review state',
        );
    }
    if (state.currentRound >= template.maxRevisionRounds) {
        throw new DraftWorkflowStateError(
            'draft_max_revision_rounds_reached',
            409,
            'draft has reached the configured maximum revision rounds',
        );
    }

    const updated = await transitionDraftWorkflowStateToDrafting(prisma, {
        draftPostId: input.draftPostId,
        template,
        draftingStartedAt: now,
        actorUserId: input.actorUserId,
    });
    if (!updated) {
        const rowAfterNoop = await loadDraftWorkflowStateRow(prisma, input.draftPostId);
        if (rowAfterNoop) {
            const nextState = mapRowToView(rowAfterNoop);
            if (nextState.documentStatus === 'drafting') {
                return nextState;
            }
        }
    }
    const row = await loadDraftWorkflowStateRow(prisma, input.draftPostId);
    if (!row) {
        throw new DraftWorkflowStateError(
            'draft_workflow_state_unavailable',
            500,
            'draft workflow state could not be reloaded after review advance',
        );
    }
    return mapRowToView(row);
}

export async function enterDraftLifecycleCrystallization(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        circleId: number | null;
        actorUserId: number;
        anchorSignature: string;
        policyProfileDigest: string;
        template?: DraftLifecycleTemplateSnapshot;
        seedStartedAt: Date;
        now?: Date;
    },
): Promise<DraftWorkflowStateView> {
    if (!parseNonEmptyString(input.anchorSignature)) {
        throw new Error('draft_lifecycle_anchor_signature_required');
    }
    if (!parseNonEmptyString(input.policyProfileDigest)) {
        throw new Error('policy_profile_digest_required');
    }
    const template = input.template || buildDefaultLifecycleTemplate();
    const now = input.now || new Date();
    const state = await resolveDraftWorkflowState(prisma, {
        draftPostId: input.draftPostId,
        circleId: input.circleId,
        template,
        seedStartedAt: input.seedStartedAt,
        now,
    });

    if (state.documentStatus === 'crystallization_active') {
        return state;
    }
    if (state.documentStatus !== 'review' && state.documentStatus !== 'crystallization_failed') {
        throw new DraftWorkflowStateError(
            'draft_not_in_review',
            409,
            'draft is not currently in review or crystallization_failed state',
        );
    }

    await ensureStableSnapshotCollabAnchor(prisma, {
        draftPostId: input.draftPostId,
        draftVersion: state.currentSnapshotVersion,
        circleId: input.circleId,
        actorUserId: input.actorUserId,
    });

    const updated = await transitionDraftWorkflowStateToCrystallization(prisma, {
        draftPostId: input.draftPostId,
        crystallizationStartedAt: now,
        actorUserId: input.actorUserId,
        policyProfileDigest: input.policyProfileDigest,
        anchorSignature: input.anchorSignature,
        allowRetryFromFailure: state.documentStatus === 'crystallization_failed',
    });
    if (!updated) {
        const rowAfterNoop = await loadDraftWorkflowStateRow(prisma, input.draftPostId);
        if (rowAfterNoop) {
            const nextState = mapRowToView(rowAfterNoop);
            if (nextState.documentStatus === 'crystallization_active') {
                return nextState;
            }
        }
    }
    const row = await loadDraftWorkflowStateRow(prisma, input.draftPostId);
    if (!row) {
        throw new DraftWorkflowStateError(
            'draft_workflow_state_unavailable',
            500,
            'draft workflow state could not be reloaded after entering crystallization',
        );
    }
    return mapRowToView(row);
}

export async function finalizeDraftLifecycleCrystallization(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        circleId: number | null;
        actorUserId: number | null;
        template?: DraftLifecycleTemplateSnapshot;
        seedStartedAt: Date;
        now?: Date;
    },
): Promise<DraftWorkflowStateView> {
    const template = input.template || buildDefaultLifecycleTemplate();
    const now = input.now || new Date();
    const state = await resolveDraftWorkflowState(prisma, {
        draftPostId: input.draftPostId,
        circleId: input.circleId,
        template,
        seedStartedAt: input.seedStartedAt,
        now,
    });

    if (state.documentStatus === 'crystallized') {
        return state;
    }
    if (state.documentStatus !== 'crystallization_active') {
        throw new DraftWorkflowStateError(
            'draft_not_in_crystallization',
            409,
            'draft is not currently in crystallization state',
        );
    }

    const updated = await transitionDraftWorkflowStateToCrystallized(prisma, {
        draftPostId: input.draftPostId,
        crystallizedAt: now,
        actorUserId: input.actorUserId,
    });
    if (!updated) {
        const rowAfterNoop = await loadDraftWorkflowStateRow(prisma, input.draftPostId);
        if (rowAfterNoop) {
            const nextState = mapRowToView(rowAfterNoop);
            if (nextState.documentStatus === 'crystallized') {
                return nextState;
            }
        }
    }
    const row = await loadDraftWorkflowStateRow(prisma, input.draftPostId);
    if (!row) {
        throw new DraftWorkflowStateError(
            'draft_workflow_state_unavailable',
            500,
            'draft workflow state could not be reloaded after crystallization success',
        );
    }
    return mapRowToView(row);
}

export async function failDraftLifecycleCrystallization(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        circleId: number | null;
        actorUserId: number | null;
        template?: DraftLifecycleTemplateSnapshot;
        seedStartedAt: Date;
        now?: Date;
    },
): Promise<DraftWorkflowStateView> {
    const template = input.template || buildDefaultLifecycleTemplate();
    const now = input.now || new Date();
    const state = await resolveDraftWorkflowState(prisma, {
        draftPostId: input.draftPostId,
        circleId: input.circleId,
        template,
        seedStartedAt: input.seedStartedAt,
        now,
    });

    if (state.documentStatus === 'crystallization_failed') {
        return state;
    }
    if (state.documentStatus !== 'crystallization_active') {
        throw new DraftWorkflowStateError(
            'draft_not_in_crystallization',
            409,
            'draft is not currently in crystallization state',
        );
    }

    const updated = await transitionDraftWorkflowStateToCrystallizationFailed(prisma, {
        draftPostId: input.draftPostId,
        failedAt: now,
        actorUserId: input.actorUserId,
    });
    if (!updated) {
        const rowAfterNoop = await loadDraftWorkflowStateRow(prisma, input.draftPostId);
        if (rowAfterNoop) {
            const nextState = mapRowToView(rowAfterNoop);
            if (nextState.documentStatus === 'crystallization_failed') {
                return nextState;
            }
        }
    }
    const row = await loadDraftWorkflowStateRow(prisma, input.draftPostId);
    if (!row) {
        throw new DraftWorkflowStateError(
            'draft_workflow_state_unavailable',
            500,
            'draft workflow state could not be reloaded after crystallization failure',
        );
    }
    return mapRowToView(row);
}

export async function repairDraftLifecycleCrystallizationEvidence(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        circleId: number | null;
        actorUserId: number | null;
    },
): Promise<DraftWorkflowStateView> {
    const row = await loadDraftWorkflowStateRow(prisma, input.draftPostId);
    if (!row) {
        throw new DraftWorkflowStateError(
            'draft_workflow_state_unavailable',
            500,
            'draft workflow state could not be loaded before crystallization evidence repair',
        );
    }
    const normalizedStatus = normalizeDocumentStatus(row.documentStatus);
    if (
        normalizedStatus !== 'review'
        && normalizedStatus !== 'crystallization_active'
        && normalizedStatus !== 'crystallization_failed'
    ) {
        throw new DraftWorkflowStateError(
            'draft_not_ready_for_crystallization_evidence_repair',
            409,
            'draft is not currently in a crystallization-ready lifecycle state',
        );
    }

    await ensureStableSnapshotCollabAnchor(prisma, {
        draftPostId: input.draftPostId,
        draftVersion: row.currentSnapshotVersion,
        circleId: input.circleId ?? row.circleId,
        actorUserId: input.actorUserId,
    });

    const refreshed = await loadDraftWorkflowStateRow(prisma, input.draftPostId);
    if (!refreshed) {
        throw new DraftWorkflowStateError(
            'draft_workflow_state_unavailable',
            500,
            'draft workflow state could not be reloaded after crystallization evidence repair',
        );
    }
    return mapRowToView(refreshed);
}

export async function retryDraftLifecycleCrystallization(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        circleId: number | null;
        actorUserId: number;
        anchorSignature: string;
        policyProfileDigest: string;
        template?: DraftLifecycleTemplateSnapshot;
        seedStartedAt: Date;
        now?: Date;
    },
): Promise<DraftWorkflowStateView> {
    return enterDraftLifecycleCrystallization(prisma, input);
}

export async function rollbackDraftLifecycleCrystallizationFailure(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        circleId: number | null;
        actorUserId: number | null;
        template?: DraftLifecycleTemplateSnapshot;
        seedStartedAt: Date;
        now?: Date;
    },
): Promise<DraftWorkflowStateView> {
    const template = input.template || buildDefaultLifecycleTemplate();
    const now = input.now || new Date();
    const state = await resolveDraftWorkflowState(prisma, {
        draftPostId: input.draftPostId,
        circleId: input.circleId,
        template,
        seedStartedAt: input.seedStartedAt,
        now,
    });

    if (state.documentStatus === 'review') {
        return state;
    }
    if (state.documentStatus !== 'crystallization_failed') {
        throw new DraftWorkflowStateError(
            'draft_not_in_crystallization_failed',
            409,
            'draft is not currently in crystallization_failed state',
        );
    }

    const updated = await transitionDraftWorkflowStateToReviewFromCrystallizationFailure(prisma, {
        draftPostId: input.draftPostId,
        template,
        returnedAt: now,
        actorUserId: input.actorUserId,
    });
    if (!updated) {
        const rowAfterNoop = await loadDraftWorkflowStateRow(prisma, input.draftPostId);
        if (rowAfterNoop) {
            const nextState = mapRowToView(rowAfterNoop);
            if (nextState.documentStatus === 'review') {
                return nextState;
            }
        }
    }
    const row = await loadDraftWorkflowStateRow(prisma, input.draftPostId);
    if (!row) {
        throw new DraftWorkflowStateError(
            'draft_workflow_state_unavailable',
            500,
            'draft workflow state could not be reloaded after rollback to review',
        );
    }
    return mapRowToView(row);
}

export async function archiveDraftLifecycle(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        circleId: number | null;
        actorUserId: number | null;
        template?: DraftLifecycleTemplateSnapshot;
        seedStartedAt: Date;
        now?: Date;
    },
): Promise<DraftWorkflowStateView> {
    const template = input.template || buildDefaultLifecycleTemplate();
    const now = input.now || new Date();
    const state = await resolveDraftWorkflowState(prisma, {
        draftPostId: input.draftPostId,
        circleId: input.circleId,
        template,
        seedStartedAt: input.seedStartedAt,
        now,
    });

    if (state.documentStatus === 'archived') {
        return state;
    }
    if (
        state.documentStatus !== 'drafting'
        && state.documentStatus !== 'review'
        && state.documentStatus !== 'crystallization_active'
        && state.documentStatus !== 'crystallization_failed'
    ) {
        throw new DraftWorkflowStateError(
            'draft_not_active',
            409,
            'draft is not currently in an active lifecycle state',
        );
    }

    const updated = await transitionDraftWorkflowStateToArchived(prisma, {
        draftPostId: input.draftPostId,
        archivedAt: now,
        actorUserId: input.actorUserId,
    });
    if (!updated) {
        const rowAfterNoop = await loadDraftWorkflowStateRow(prisma, input.draftPostId);
        if (rowAfterNoop) {
            const nextState = mapRowToView(rowAfterNoop);
            if (nextState.documentStatus === 'archived') {
                return nextState;
            }
        }
    }
    const row = await loadDraftWorkflowStateRow(prisma, input.draftPostId);
    if (!row) {
        throw new DraftWorkflowStateError(
            'draft_workflow_state_unavailable',
            500,
            'draft workflow state could not be reloaded after archive',
        );
    }
    return mapRowToView(row);
}

export async function restoreDraftLifecycle(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        circleId: number | null;
        actorUserId: number | null;
        template?: DraftLifecycleTemplateSnapshot;
        seedStartedAt: Date;
        now?: Date;
    },
): Promise<DraftWorkflowStateView> {
    const template = input.template || buildDefaultLifecycleTemplate();
    const now = input.now || new Date();
    const state = await resolveDraftWorkflowState(prisma, {
        draftPostId: input.draftPostId,
        circleId: input.circleId,
        template,
        seedStartedAt: input.seedStartedAt,
        now,
    });

    if (state.documentStatus === 'drafting') {
        return state;
    }
    if (state.documentStatus !== 'archived') {
        throw new DraftWorkflowStateError(
            'draft_not_archived',
            409,
            'draft is not currently archived',
        );
    }

    const updated = await transitionDraftWorkflowStateToDrafting(prisma, {
        draftPostId: input.draftPostId,
        template,
        draftingStartedAt: now,
        actorUserId: input.actorUserId,
        allowRestoreFromArchive: true,
    });
    if (!updated) {
        const rowAfterNoop = await loadDraftWorkflowStateRow(prisma, input.draftPostId);
        if (rowAfterNoop) {
            const nextState = mapRowToView(rowAfterNoop);
            if (nextState.documentStatus === 'drafting') {
                return nextState;
            }
        }
    }
    const row = await loadDraftWorkflowStateRow(prisma, input.draftPostId);
    if (!row) {
        throw new DraftWorkflowStateError(
            'draft_workflow_state_unavailable',
            500,
            'draft workflow state could not be reloaded after restore',
        );
    }
    return mapRowToView(row);
}
