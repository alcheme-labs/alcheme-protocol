import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export type DraftDiscussionState = 'open' | 'proposed' | 'accepted' | 'rejected' | 'applied' | 'withdrawn';
export type DraftDiscussionTargetType = 'paragraph' | 'structure' | 'document';
export type DraftDiscussionResolution = 'accepted' | 'rejected';
export type DraftDiscussionIssueType =
    | 'fact_correction'
    | 'expression_improvement'
    | 'knowledge_supplement'
    | 'question_and_supplement';

export interface DraftDiscussionMessageRecord {
    id: string;
    authorId: number;
    messageType: string;
    content: string | null;
    createdAt: string;
}

export interface DraftDiscussionThreadRecord {
    id: string;
    draftPostId: number;
    targetType: DraftDiscussionTargetType;
    targetRef: string;
    targetVersion: number;
    issueType: DraftDiscussionIssueType;
    state: DraftDiscussionState;
    createdBy: number;
    createdAt: string;
    updatedAt: string;
    latestResolution: {
        resolvedBy: number;
        toState: DraftDiscussionResolution;
        reason: string | null;
        resolvedAt: string;
    } | null;
    latestApplication: {
        appliedBy: number;
        appliedEditAnchorId: string;
        appliedSnapshotHash: string;
        appliedDraftVersion: number;
        reason: string | null;
        appliedAt: string;
    } | null;
    latestMessage: {
        authorId: number;
        messageType: string;
        content: string | null;
        createdAt: string;
    } | null;
    messages: DraftDiscussionMessageRecord[];
}

interface DraftDiscussionThreadRow {
    id: bigint;
    draftPostId: number;
    targetType: string;
    targetRef: string;
    targetVersion: number;
    issueType: string;
    state: string;
    createdBy: number;
    createdAt: Date;
    updatedAt: Date;
}

interface DraftDiscussionResolutionRow {
    resolvedBy: number;
    toState: string;
    reason: string | null;
    resolvedAt: Date;
}

interface DraftDiscussionApplicationRow {
    appliedBy: number;
    appliedEditAnchorId: string;
    appliedSnapshotHash: string;
    appliedDraftVersion: number;
    reason: string | null;
    appliedAt: Date;
}

interface DraftDiscussionMessageRow {
    id: bigint;
    authorId: number;
    messageType: string;
    content: string | null;
    createdAt: Date;
}

export class DraftDiscussionLifecycleError extends Error {
    constructor(
        public readonly code: string,
        public readonly statusCode: number,
        message?: string,
    ) {
        super(message || code);
        this.name = 'DraftDiscussionLifecycleError';
    }
}

function parsePositiveInt(value: unknown, fallback: number): number {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

function normalizeText(value: unknown): string {
    return String(value ?? '').trim();
}

function normalizeTargetType(value: unknown): DraftDiscussionTargetType {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === 'paragraph' || normalized === 'structure' || normalized === 'document') {
        return normalized;
    }
    throw new DraftDiscussionLifecycleError(
        'draft_discussion_invalid_target_type',
        400,
        'targetType must be paragraph|structure|document',
    );
}

function normalizeIssueType(
    value: unknown,
    fallback: DraftDiscussionIssueType = 'question_and_supplement',
): DraftDiscussionIssueType {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) return fallback;
    if (
        normalized === 'fact_correction'
        || normalized === 'expression_improvement'
        || normalized === 'knowledge_supplement'
        || normalized === 'question_and_supplement'
    ) {
        return normalized;
    }
    throw new DraftDiscussionLifecycleError(
        'draft_discussion_invalid_issue_type',
        400,
        'issueType must be fact_correction|expression_improvement|knowledge_supplement|question_and_supplement',
    );
}

function normalizeResolution(value: unknown): DraftDiscussionResolution {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === 'accepted' || normalized === 'rejected') {
        return normalized;
    }
    throw new DraftDiscussionLifecycleError(
        'draft_discussion_invalid_resolution',
        400,
        'resolution must be accepted|rejected',
    );
}

function normalizeState(value: unknown): DraftDiscussionState {
    const normalized = normalizeText(value).toLowerCase();
    if (
        normalized === 'open'
        || normalized === 'proposed'
        || normalized === 'accepted'
        || normalized === 'rejected'
        || normalized === 'applied'
        || normalized === 'withdrawn'
    ) {
        return normalized;
    }
    throw new DraftDiscussionLifecycleError(
        'draft_discussion_invalid_state',
        409,
        `invalid thread lifecycle state: ${normalized || 'unknown'}`,
    );
}

export function assertDraftDiscussionTransition(
    from: DraftDiscussionState,
    to: DraftDiscussionState,
) {
    if (from === 'open' && to === 'proposed') return;
    if (from === 'open' && to === 'withdrawn') return;
    if (from === 'proposed' && (to === 'accepted' || to === 'rejected')) return;
    if (from === 'accepted' && to === 'applied') return;
    throw new DraftDiscussionLifecycleError(
        'draft_discussion_invalid_transition',
        409,
        `invalid transition ${from} -> ${to}`,
    );
}

export function validateDraftDiscussionApplicationEvidence(input: {
    appliedEditAnchorId: string;
    appliedSnapshotHash: string;
    appliedDraftVersion: number;
}) {
    const appliedEditAnchorId = normalizeText(input.appliedEditAnchorId);
    const appliedSnapshotHash = normalizeText(input.appliedSnapshotHash).toLowerCase();
    const appliedDraftVersion = parsePositiveInt(input.appliedDraftVersion, NaN);

    if (!appliedEditAnchorId) {
        throw new DraftDiscussionLifecycleError(
            'draft_discussion_apply_evidence_required',
            422,
            'appliedEditAnchorId is required',
        );
    }
    if (!/^[a-f0-9]{64}$/i.test(appliedSnapshotHash)) {
        throw new DraftDiscussionLifecycleError(
            'draft_discussion_apply_evidence_required',
            422,
            'appliedSnapshotHash must be a 64-char hex hash',
        );
    }
    if (!Number.isFinite(appliedDraftVersion)) {
        throw new DraftDiscussionLifecycleError(
            'draft_discussion_apply_evidence_required',
            422,
            'appliedDraftVersion must be a positive integer',
        );
    }

    return {
        appliedEditAnchorId,
        appliedSnapshotHash,
        appliedDraftVersion,
    };
}

function toThreadRecord(input: {
    thread: DraftDiscussionThreadRow;
    latestResolution: DraftDiscussionResolutionRow | null;
    latestApplication: DraftDiscussionApplicationRow | null;
    messages: DraftDiscussionMessageRow[];
}): DraftDiscussionThreadRecord {
    const messages = input.messages.map((message) => ({
        id: String(message.id),
        authorId: message.authorId,
        messageType: normalizeText(message.messageType),
        content: message.content,
        createdAt: message.createdAt.toISOString(),
    }));
    const latestMessage = input.messages[input.messages.length - 1] || null;

    return {
        id: String(input.thread.id),
        draftPostId: input.thread.draftPostId,
        targetType: normalizeTargetType(input.thread.targetType),
        targetRef: input.thread.targetRef,
        targetVersion: input.thread.targetVersion,
        issueType: normalizeIssueType(input.thread.issueType),
        state: normalizeState(input.thread.state),
        createdBy: input.thread.createdBy,
        createdAt: input.thread.createdAt.toISOString(),
        updatedAt: input.thread.updatedAt.toISOString(),
        latestResolution: input.latestResolution
            ? {
                resolvedBy: input.latestResolution.resolvedBy,
                toState: normalizeResolution(input.latestResolution.toState),
                reason: input.latestResolution.reason,
                resolvedAt: input.latestResolution.resolvedAt.toISOString(),
            }
            : null,
        latestApplication: input.latestApplication
            ? {
                appliedBy: input.latestApplication.appliedBy,
                appliedEditAnchorId: input.latestApplication.appliedEditAnchorId,
                appliedSnapshotHash: input.latestApplication.appliedSnapshotHash,
                appliedDraftVersion: input.latestApplication.appliedDraftVersion,
                reason: input.latestApplication.reason,
                appliedAt: input.latestApplication.appliedAt.toISOString(),
            }
            : null,
        latestMessage: latestMessage
            ? {
                authorId: latestMessage.authorId,
                messageType: normalizeText(latestMessage.messageType),
                content: latestMessage.content,
                createdAt: latestMessage.createdAt.toISOString(),
            }
            : null,
        messages,
    };
}

async function loadThread(
    prisma: PrismaLike,
    draftPostId: number,
    threadId: bigint,
): Promise<DraftDiscussionThreadRow> {
    const rows = await prisma.$queryRaw<DraftDiscussionThreadRow[]>(Prisma.sql`
        SELECT
            id,
            draft_post_id AS "draftPostId",
            target_type AS "targetType",
            target_ref AS "targetRef",
            target_version AS "targetVersion",
            issue_type AS "issueType",
            state,
            created_by AS "createdBy",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
        FROM draft_discussion_threads
        WHERE id = ${threadId}
          AND draft_post_id = ${draftPostId}
        LIMIT 1
    `);
    const row = rows[0];
    if (!row) {
        throw new DraftDiscussionLifecycleError(
            'draft_discussion_thread_not_found',
            404,
            'draft discussion thread is not found',
        );
    }
    return row;
}

export async function getDraftDiscussionThread(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        threadId: number;
    },
): Promise<DraftDiscussionThreadRecord> {
    const threadId = BigInt(input.threadId);
    const thread = await loadThread(prisma, input.draftPostId, threadId);
    return toThreadRecord({
        thread,
        latestResolution: await loadLatestResolution(prisma, threadId),
        latestApplication: await loadLatestApplication(prisma, threadId),
        messages: await loadMessages(prisma, threadId),
    });
}

async function loadLatestResolution(
    prisma: PrismaLike,
    threadId: bigint,
): Promise<DraftDiscussionResolutionRow | null> {
    const rows = await prisma.$queryRaw<DraftDiscussionResolutionRow[]>(Prisma.sql`
        SELECT
            resolved_by AS "resolvedBy",
            to_state AS "toState",
            reason,
            resolved_at AS "resolvedAt"
        FROM draft_discussion_resolutions
        WHERE thread_id = ${threadId}
        ORDER BY resolved_at DESC
        LIMIT 1
    `);
    return rows[0] || null;
}

async function loadLatestApplication(
    prisma: PrismaLike,
    threadId: bigint,
): Promise<DraftDiscussionApplicationRow | null> {
    const rows = await prisma.$queryRaw<DraftDiscussionApplicationRow[]>(Prisma.sql`
        SELECT
            applied_by AS "appliedBy",
            applied_edit_anchor_id AS "appliedEditAnchorId",
            applied_snapshot_hash AS "appliedSnapshotHash",
            applied_draft_version AS "appliedDraftVersion",
            reason,
            applied_at AS "appliedAt"
        FROM draft_discussion_applications
        WHERE thread_id = ${threadId}
        ORDER BY applied_at DESC
        LIMIT 1
    `);
    return rows[0] || null;
}

async function loadMessages(
    prisma: PrismaLike,
    threadId: bigint,
): Promise<DraftDiscussionMessageRow[]> {
    const rows = await prisma.$queryRaw<DraftDiscussionMessageRow[]>(Prisma.sql`
        SELECT
            id,
            author_id AS "authorId",
            message_type AS "messageType",
            content,
            created_at AS "createdAt"
        FROM draft_discussion_messages
        WHERE thread_id = ${threadId}
        ORDER BY created_at ASC, id ASC
    `);
    return rows;
}

async function insertDraftDiscussionMessage(
    prisma: PrismaLike,
    input: {
        threadId: bigint;
        draftPostId: number;
        authorId: number;
        messageType: string;
        content?: string | null;
    },
) {
    await prisma.$executeRaw(Prisma.sql`
        INSERT INTO draft_discussion_messages (
            thread_id,
            draft_post_id,
            author_id,
            message_type,
            content,
            created_at
        )
        VALUES (
            ${input.threadId},
            ${input.draftPostId},
            ${input.authorId},
            ${normalizeText(input.messageType)},
            ${normalizeText(input.content) || null},
            NOW()
        )
    `);
}

async function updateThreadStateWithExpected(
    prisma: PrismaLike,
    input: {
        draftPostId: number;
        threadId: bigint;
        fromState: DraftDiscussionState;
        toState: DraftDiscussionState;
    },
): Promise<DraftDiscussionThreadRow> {
    const rows = await prisma.$queryRaw<DraftDiscussionThreadRow[]>(Prisma.sql`
        UPDATE draft_discussion_threads
        SET state = ${input.toState}, updated_at = NOW()
        WHERE id = ${input.threadId}
          AND draft_post_id = ${input.draftPostId}
          AND state = ${input.fromState}
        RETURNING
            id,
            draft_post_id AS "draftPostId",
            target_type AS "targetType",
            target_ref AS "targetRef",
            target_version AS "targetVersion",
            issue_type AS "issueType",
            state,
            created_by AS "createdBy",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
    `);
    const row = rows[0];
    if (!row) {
        throw new DraftDiscussionLifecycleError(
            'draft_discussion_transition_conflict',
            409,
            'draft discussion state changed before transition was applied',
        );
    }
    return row;
}

export async function createDraftDiscussionThread(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        actorUserId: number;
        targetType: string;
        targetRef: string;
        targetVersion?: number;
        issueType?: string;
        content?: string;
    },
): Promise<DraftDiscussionThreadRecord> {
    const targetType = normalizeTargetType(input.targetType);
    const targetRef = normalizeText(input.targetRef);
    if (!targetRef) {
        throw new DraftDiscussionLifecycleError(
            'draft_discussion_target_ref_required',
            400,
            'targetRef is required',
        );
    }
    const targetVersion = parsePositiveInt(input.targetVersion ?? 1, 1);
    const issueType = normalizeIssueType(input.issueType, 'question_and_supplement');
    const content = normalizeText(input.content);

    return prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<DraftDiscussionThreadRow[]>(Prisma.sql`
            INSERT INTO draft_discussion_threads (
                draft_post_id,
                target_type,
                target_ref,
                target_version,
                issue_type,
                state,
                created_by,
                created_at,
                updated_at
            )
            VALUES (
                ${input.draftPostId},
                ${targetType},
                ${targetRef},
                ${targetVersion},
                ${issueType},
                'open',
                ${input.actorUserId},
                NOW(),
                NOW()
            )
            RETURNING
                id,
                draft_post_id AS "draftPostId",
                target_type AS "targetType",
                target_ref AS "targetRef",
                target_version AS "targetVersion",
                issue_type AS "issueType",
                state,
                created_by AS "createdBy",
                created_at AS "createdAt",
                updated_at AS "updatedAt"
        `);
        const created = rows[0];
        if (!created) {
            throw new DraftDiscussionLifecycleError(
                'draft_discussion_create_failed',
                500,
                'failed to create draft discussion thread',
            );
        }

        await insertDraftDiscussionMessage(tx, {
            threadId: created.id,
            draftPostId: input.draftPostId,
            authorId: input.actorUserId,
            messageType: 'create',
            content,
        });

        return toThreadRecord({
            thread: created,
            latestResolution: null,
            latestApplication: null,
            messages: await loadMessages(tx, created.id),
        });
    });
}

export async function proposeDraftDiscussionThread(
    prisma: PrismaLike,
    input: {
        draftPostId: number;
        threadId: number;
        actorUserId: number;
        issueType?: string;
        content?: string;
    },
): Promise<DraftDiscussionThreadRecord> {
    const threadId = BigInt(input.threadId);
    const nextIssueType = input.issueType ? normalizeIssueType(input.issueType) : null;
    const executeWriteScope = typeof (prisma as any).$transaction === 'function'
        ? (work: (tx: PrismaLike) => Promise<DraftDiscussionThreadRecord>) => (prisma as any).$transaction(work)
        : (work: (tx: PrismaLike) => Promise<DraftDiscussionThreadRecord>) => work(prisma);
    return executeWriteScope(async (tx) => {
        const current = await loadThread(tx, input.draftPostId, threadId);
        const fromState = normalizeState(current.state);
        assertDraftDiscussionTransition(fromState, 'proposed');
        const currentIssueType = normalizeIssueType(current.issueType);
        const updatedRows = await tx.$queryRaw<DraftDiscussionThreadRow[]>(Prisma.sql`
            UPDATE draft_discussion_threads
            SET
                state = 'proposed',
                issue_type = ${nextIssueType || currentIssueType},
                updated_at = NOW()
            WHERE id = ${threadId}
              AND draft_post_id = ${input.draftPostId}
              AND state = ${fromState}
            RETURNING
                id,
                draft_post_id AS "draftPostId",
                target_type AS "targetType",
                target_ref AS "targetRef",
                target_version AS "targetVersion",
                issue_type AS "issueType",
                state,
                created_by AS "createdBy",
                created_at AS "createdAt",
                updated_at AS "updatedAt"
        `);
        const updated = updatedRows[0];
        if (!updated) {
            throw new DraftDiscussionLifecycleError(
                'draft_discussion_transition_conflict',
                409,
                'draft discussion state changed before transition was applied',
            );
        }
        if (nextIssueType && nextIssueType !== currentIssueType) {
            await insertDraftDiscussionMessage(tx, {
                threadId,
                draftPostId: input.draftPostId,
                authorId: input.actorUserId,
                messageType: 'retag',
                content: nextIssueType,
            });
        }
        await insertDraftDiscussionMessage(tx, {
            threadId,
            draftPostId: input.draftPostId,
            authorId: input.actorUserId,
            messageType: 'propose',
            content: input.content,
        });

        return toThreadRecord({
            thread: updated,
            latestResolution: await loadLatestResolution(tx, threadId),
            latestApplication: await loadLatestApplication(tx, threadId),
            messages: await loadMessages(tx, threadId),
        });
    });
}

export async function resolveDraftDiscussionThread(
    prisma: PrismaLike,
    input: {
        draftPostId: number;
        threadId: number;
        actorUserId: number;
        resolution: string;
        issueType?: string;
        reason?: string;
    },
): Promise<DraftDiscussionThreadRecord> {
    const threadId = BigInt(input.threadId);
    const resolution = normalizeResolution(input.resolution);
    const nextIssueType = input.issueType ? normalizeIssueType(input.issueType) : null;
    const executeWriteScope = typeof (prisma as any).$transaction === 'function'
        ? (work: (tx: PrismaLike) => Promise<DraftDiscussionThreadRecord>) => (prisma as any).$transaction(work)
        : (work: (tx: PrismaLike) => Promise<DraftDiscussionThreadRecord>) => work(prisma);
    return executeWriteScope(async (tx) => {
        const current = await loadThread(tx, input.draftPostId, threadId);
        const fromState = normalizeState(current.state);
        assertDraftDiscussionTransition(fromState, resolution);
        const currentIssueType = normalizeIssueType(current.issueType);
        const updatedRows = await tx.$queryRaw<DraftDiscussionThreadRow[]>(Prisma.sql`
            UPDATE draft_discussion_threads
            SET
                state = ${resolution},
                issue_type = ${nextIssueType || currentIssueType},
                updated_at = NOW()
            WHERE id = ${threadId}
              AND draft_post_id = ${input.draftPostId}
              AND state = ${fromState}
            RETURNING
                id,
                draft_post_id AS "draftPostId",
                target_type AS "targetType",
                target_ref AS "targetRef",
                target_version AS "targetVersion",
                issue_type AS "issueType",
                state,
                created_by AS "createdBy",
                created_at AS "createdAt",
                updated_at AS "updatedAt"
        `);
        const updated = updatedRows[0];
        if (!updated) {
            throw new DraftDiscussionLifecycleError(
                'draft_discussion_transition_conflict',
                409,
                'draft discussion state changed before transition was applied',
            );
        }
        if (nextIssueType && nextIssueType !== currentIssueType) {
            await insertDraftDiscussionMessage(tx, {
                threadId,
                draftPostId: input.draftPostId,
                authorId: input.actorUserId,
                messageType: 'retag',
                content: nextIssueType,
            });
        }
        await tx.$executeRaw(Prisma.sql`
            INSERT INTO draft_discussion_resolutions (
                thread_id,
                draft_post_id,
                from_state,
                to_state,
                reason,
                resolved_by,
                resolved_at,
                created_at
            )
            VALUES (
                ${threadId},
                ${input.draftPostId},
                ${fromState},
                ${resolution},
                ${normalizeText(input.reason) || null},
                ${input.actorUserId},
                NOW(),
                NOW()
            )
        `);
        await insertDraftDiscussionMessage(tx, {
            threadId,
            draftPostId: input.draftPostId,
            authorId: input.actorUserId,
            messageType: resolution === 'accepted' ? 'accept' : 'reject',
            content: input.reason,
        });

        return toThreadRecord({
            thread: updated,
            latestResolution: await loadLatestResolution(tx, threadId),
            latestApplication: await loadLatestApplication(tx, threadId),
            messages: await loadMessages(tx, threadId),
        });
    });
}

export async function applyDraftDiscussionThread(
    prisma: PrismaLike,
    input: {
        draftPostId: number;
        threadId: number;
        actorUserId: number;
        appliedEditAnchorId: string;
        appliedSnapshotHash: string;
        appliedDraftVersion: number;
        reason?: string;
    },
): Promise<DraftDiscussionThreadRecord> {
    const threadId = BigInt(input.threadId);
    const evidence = validateDraftDiscussionApplicationEvidence({
        appliedEditAnchorId: input.appliedEditAnchorId,
        appliedSnapshotHash: input.appliedSnapshotHash,
        appliedDraftVersion: input.appliedDraftVersion,
    });
    const executeWriteScope = typeof (prisma as any).$transaction === 'function'
        ? (work: (tx: PrismaLike) => Promise<DraftDiscussionThreadRecord>) => (prisma as any).$transaction(work)
        : (work: (tx: PrismaLike) => Promise<DraftDiscussionThreadRecord>) => work(prisma);
    return executeWriteScope(async (tx) => {
        const current = await loadThread(tx, input.draftPostId, threadId);
        const fromState = normalizeState(current.state);
        assertDraftDiscussionTransition(fromState, 'applied');

        const updated = await updateThreadStateWithExpected(tx, {
            draftPostId: input.draftPostId,
            threadId,
            fromState,
            toState: 'applied',
        });
        await tx.$executeRaw(Prisma.sql`
            INSERT INTO draft_discussion_applications (
                thread_id,
                draft_post_id,
                applied_by,
                applied_edit_anchor_id,
                applied_snapshot_hash,
                applied_draft_version,
                reason,
                applied_at,
                created_at
            )
            VALUES (
                ${threadId},
                ${input.draftPostId},
                ${input.actorUserId},
                ${evidence.appliedEditAnchorId},
                ${evidence.appliedSnapshotHash},
                ${evidence.appliedDraftVersion},
                ${normalizeText(input.reason) || null},
                NOW(),
                NOW()
            )
        `);
        await insertDraftDiscussionMessage(tx, {
            threadId,
            draftPostId: input.draftPostId,
            authorId: input.actorUserId,
            messageType: 'apply',
            content: input.reason,
        });

        return toThreadRecord({
            thread: updated,
            latestResolution: await loadLatestResolution(tx, threadId),
            latestApplication: await loadLatestApplication(tx, threadId),
            messages: await loadMessages(tx, threadId),
        });
    });
}

export async function appendDraftDiscussionMessage(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        threadId: number;
        actorUserId: number;
        content?: string;
    },
): Promise<DraftDiscussionThreadRecord> {
    const threadId = BigInt(input.threadId);
    const content = normalizeText(input.content);
    if (!content) {
        throw new DraftDiscussionLifecycleError(
            'draft_discussion_message_required',
            400,
            'content is required',
        );
    }

    return prisma.$transaction(async (tx) => {
        const current = await loadThread(tx, input.draftPostId, threadId);
        const state = normalizeState(current.state);
        if (state === 'rejected' || state === 'applied' || state === 'withdrawn') {
            throw new DraftDiscussionLifecycleError(
                'draft_discussion_thread_closed',
                409,
                `cannot append messages to ${state} threads`,
            );
        }

        const touchedRows = await tx.$queryRaw<DraftDiscussionThreadRow[]>(Prisma.sql`
            UPDATE draft_discussion_threads
            SET updated_at = NOW()
            WHERE id = ${threadId}
              AND draft_post_id = ${input.draftPostId}
            RETURNING
                id,
                draft_post_id AS "draftPostId",
                target_type AS "targetType",
                target_ref AS "targetRef",
                target_version AS "targetVersion",
                issue_type AS "issueType",
                state,
                created_by AS "createdBy",
                created_at AS "createdAt",
                updated_at AS "updatedAt"
        `);
        const touched = touchedRows[0];
        if (!touched) {
            throw new DraftDiscussionLifecycleError(
                'draft_discussion_thread_not_found',
                404,
                'draft discussion thread is not found',
            );
        }

        await insertDraftDiscussionMessage(tx, {
            threadId,
            draftPostId: input.draftPostId,
            authorId: input.actorUserId,
            messageType: 'followup',
            content,
        });

        return toThreadRecord({
            thread: touched,
            latestResolution: await loadLatestResolution(tx, threadId),
            latestApplication: await loadLatestApplication(tx, threadId),
            messages: await loadMessages(tx, threadId),
        });
    });
}

export async function withdrawDraftDiscussionThread(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        threadId: number;
        actorUserId: number;
        reason?: string;
    },
): Promise<DraftDiscussionThreadRecord> {
    const threadId = BigInt(input.threadId);
    return prisma.$transaction(async (tx) => {
        const current = await loadThread(tx, input.draftPostId, threadId);
        const fromState = normalizeState(current.state);
        if (current.createdBy !== input.actorUserId) {
            throw new DraftDiscussionLifecycleError(
                'draft_discussion_withdraw_permission_denied',
                403,
                'only the creator can withdraw this issue ticket',
            );
        }
        assertDraftDiscussionTransition(fromState, 'withdrawn');

        const updated = await updateThreadStateWithExpected(tx, {
            draftPostId: input.draftPostId,
            threadId,
            fromState,
            toState: 'withdrawn',
        });
        await insertDraftDiscussionMessage(tx, {
            threadId,
            draftPostId: input.draftPostId,
            authorId: input.actorUserId,
            messageType: 'withdraw',
            content: input.reason,
        });

        return toThreadRecord({
            thread: updated,
            latestResolution: await loadLatestResolution(tx, threadId),
            latestApplication: await loadLatestApplication(tx, threadId),
            messages: await loadMessages(tx, threadId),
        });
    });
}

export async function listDraftDiscussionThreads(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        limit?: number;
    },
): Promise<DraftDiscussionThreadRecord[]> {
    const limit = Math.max(1, Math.min(parsePositiveInt(input.limit ?? 20, 20), 100));
    const threads = await prisma.$queryRaw<DraftDiscussionThreadRow[]>(Prisma.sql`
        SELECT
            id,
            draft_post_id AS "draftPostId",
            target_type AS "targetType",
            target_ref AS "targetRef",
            target_version AS "targetVersion",
            issue_type AS "issueType",
            state,
            created_by AS "createdBy",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
        FROM draft_discussion_threads
        WHERE draft_post_id = ${input.draftPostId}
        ORDER BY updated_at DESC, id DESC
        LIMIT ${limit}
    `);

    const records: DraftDiscussionThreadRecord[] = [];
    for (const thread of threads) {
        const threadId = thread.id;
        records.push(toThreadRecord({
            thread,
            latestResolution: await loadLatestResolution(prisma, threadId),
            latestApplication: await loadLatestApplication(prisma, threadId),
            messages: await loadMessages(prisma, threadId),
        }));
    }
    return records;
}
