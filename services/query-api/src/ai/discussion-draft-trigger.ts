import crypto from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { summarizeDiscussionThread } from './discussion-summary';
import {
    DiscussionInitialDraftError,
    generateInitialDiscussionDraft,
} from './discussion-initial-draft';
import { judgeDiscussionTrigger } from './discussion-intelligence/trigger-judge';
import {
    computeFocusStats,
    hasQuestionSignal,
} from './discussion-intelligence/rules';
import { loadGhostConfig } from './ghost/config';
import {
    loadCircleGhostSettingsPatch,
    resolveCircleGhostSettings,
} from './ghost/circle-settings';
import { createDraftAnchorBatch } from '../services/draftAnchor';
import {
    createDraftVersionSnapshot,
    updateDraftVersionSnapshotSourceEvidence,
} from '../services/draftLifecycle/versionSnapshots';
import { buildDiscussionRoomKey } from '../services/offchainDiscussion';
import {
    extractStructuredDiscussionMetadata,
    type AuthorAnnotationKind,
} from '../services/discussion/structuredMessageMetadata';
import {
    DISCUSSION_SEMANTIC_FACETS,
    type SemanticFacet,
    type DiscussionFocusLabel,
} from '../services/discussion/analysis/types';
import { publishDraftCandidateSystemNotices } from '../services/discussion/systemNoticeProducer';
import { DISCUSSION_SYSTEM_NOTICE_KINDS } from '../services/discussion/systemNoticeSeam';
import { toAiJobRecord } from '../services/aiJobs/readModel';
import { enqueueAiJob } from '../services/aiJobs/runtime';

interface DiscussionSignalRow {
    envelopeId: string;
    payloadHash: string;
    lamport: bigint;
    payloadText: string;
    messageKind: string | null;
    metadata: Prisma.JsonValue | null;
    senderPubkey: string;
    senderHandle: string | null;
    createdAt: Date;
    relevanceScore: Prisma.Decimal | number | string | null;
    semanticScore: Prisma.Decimal | number | string | null;
    qualityScore: Prisma.Decimal | number | string | null;
    spamScore: Prisma.Decimal | number | string | null;
    decisionConfidence: Prisma.Decimal | number | string | null;
    relevanceMethod: string | null;
    semanticFacets: Prisma.JsonValue | null;
    authorAnnotations: Prisma.JsonValue | null;
    focusScore: Prisma.Decimal | number | string | null;
    focusLabel: string | null;
}

type GhostRunStatus = 'triggered' | 'skipped' | 'error';

interface GhostRunAuditInput {
    status: GhostRunStatus;
    reason: string;
    circleId: number;
    windowSize: number;
    minMessages: number;
    minQuestionCount: number;
    minFocusedRatio: number;
    messageCount?: number | null;
    focusedCount?: number | null;
    focusedRatio?: number | null;
    questionCount?: number | null;
    summaryMethod?: string | null;
    summaryPreview?: string | null;
    draftPostId?: number | null;
    metadata?: unknown;
    aiJobId?: number | null;
    aiJobAttempt?: number | null;
    aiJobRequestedByUserId?: number | null;
}

export interface DiscussionTriggerDiagnosticsSnapshot {
    scope: 'circle-scoped';
    circleId: number;
    createdAt: string;
    input: {
        windowEnvelopeIds: string[];
        windowDigest: string | null;
        triggerSettings: {
            draftTriggerMode: string | null;
            triggerSummaryUseLLM: boolean | null;
            minMessages: number | null;
            minQuestionCount: number | null;
            minFocusedRatio: number | null;
        };
        messageCount: number | null;
        focusedCount: number | null;
        focusedRatio: number | null;
        questionCount: number | null;
    };
    runtime: {
        summaryMethod: string | null;
        aiJobId: number | null;
        aiJobAttempt: number | null;
        requestedByUserId: number | null;
        judge: Record<string, unknown> | null;
    };
    output: {
        status: GhostRunStatus;
        reason: string;
        summaryPreview: string | null;
        draftPostId: number | null;
    };
    failure: {
        code: string | null;
        message: string | null;
    };
}

function normalizeScore(value: Prisma.Decimal | number | string | null | undefined): number {
    if (value === null || value === undefined) return 1;
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.min(1, value));
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

function normalizeText(input: string): string {
    return input.replace(/\s+/g, ' ').trim();
}

function buildCooldownKey(circleId: number): string {
    return `discussion:draft-trigger:circle:${circleId}`;
}

function buildLockKey(circleId: number): string {
    return `discussion:draft-trigger:lock:${circleId}`;
}

function clipText(input: string, maxLength: number): string {
    if (input.length <= maxLength) return input;
    return `${input.slice(0, Math.max(0, maxLength - 1))}…`;
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

function truncateSummaryPreview(summary: string | null | undefined): string | null {
    if (!summary) return null;
    const normalized = summary.replace(/\s+/g, ' ').trim();
    if (!normalized) return null;
    return normalized.slice(0, 500);
}

function buildTriggerWindowDigest(rows: Array<{
    envelopeId: string;
    payloadText: string;
    createdAt: Date;
    focusScore: number;
    focusLabel: DiscussionFocusLabel | null;
}>): string {
    return crypto.createHash('sha256').update(JSON.stringify(
        rows.map((row) => ({
            envelopeId: row.envelopeId,
            payloadText: row.payloadText,
            createdAt: row.createdAt.toISOString(),
            focusScore: Number(row.focusScore.toFixed(4)),
            focusLabel: row.focusLabel,
        })),
    )).digest('hex');
}

function parseObject(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function parseStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => String(entry || '').trim())
        .filter((entry) => entry.length > 0);
}

function normalizeSemanticFacets(value: Prisma.JsonValue | null): SemanticFacet[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<SemanticFacet>();
    for (const item of value) {
        const normalized = String(item || '').trim();
        if (!(DISCUSSION_SEMANTIC_FACETS as readonly string[]).includes(normalized)) continue;
        seen.add(normalized as SemanticFacet);
    }
    return DISCUSSION_SEMANTIC_FACETS.filter((label) => seen.has(label));
}

function normalizeFocusLabel(value: string | null | undefined): DiscussionFocusLabel | null {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'focused' || normalized === 'contextual' || normalized === 'off_topic') {
        return normalized;
    }
    return null;
}

function collectSourceSemanticFacets(rows: Array<{ semanticFacets: Prisma.JsonValue | null }>): SemanticFacet[] {
    const seen = new Set<SemanticFacet>();
    for (const row of rows) {
        for (const label of normalizeSemanticFacets(row.semanticFacets)) {
            seen.add(label);
        }
    }
    return DISCUSSION_SEMANTIC_FACETS.filter((label) => seen.has(label));
}

function collectSourceAuthorAnnotations(rows: Array<{ metadata: Prisma.JsonValue | null; authorAnnotations?: Prisma.JsonValue | null }>): AuthorAnnotationKind[] {
    const seen = new Set<AuthorAnnotationKind>();
    for (const row of rows) {
        const parsed = extractStructuredDiscussionMetadata(row.metadata);
        for (const label of parsed.authorAnnotations) {
            seen.add(label);
        }
        if (Array.isArray(row.authorAnnotations)) {
            for (const entry of row.authorAnnotations) {
                const normalized = String(((entry as { kind?: unknown })?.kind ?? entry) || '').trim().toLowerCase();
                if (normalized === 'fact' || normalized === 'explanation' || normalized === 'emotion') {
                    seen.add(normalized as AuthorAnnotationKind);
                }
            }
        }
    }
    return ['fact', 'explanation', 'emotion'].filter((label) => seen.has(label as AuthorAnnotationKind)) as AuthorAnnotationKind[];
}

export async function createTriggeredDraftPostWithInitialSnapshot(
    prisma: PrismaClient,
    input: {
        contentId: string;
        authorId: number;
        circleId: number;
        text: string;
        onChainAddress: string;
    },
): Promise<{ id: number }> {
    return prisma.$transaction(async (tx) => {
        const draftPost = await tx.post.create({
            data: {
                contentId: input.contentId,
                authorId: input.authorId,
                text: input.text,
                contentType: 'ai/discussion-draft',
                circleId: input.circleId,
                status: 'Draft' as any,
                visibility: 'CircleOnly' as any,
                onChainAddress: input.onChainAddress,
                lastSyncedSlot: BigInt(0),
            },
            select: { id: true },
        });

        await createDraftVersionSnapshot(tx, {
            draftPostId: draftPost.id,
            draftVersion: 1,
            contentSnapshot: input.text,
            createdFromState: 'drafting',
            createdBy: input.authorId,
        });

        return draftPost;
    });
}

async function writeGhostRunAudit(prisma: PrismaClient, input: GhostRunAuditInput): Promise<void> {
    try {
        const metadata: Record<string, unknown> =
            input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
                ? { ...(input.metadata as Record<string, unknown>) }
                : (input.metadata === undefined ? {} : { value: input.metadata });
        if (input.aiJobId) {
            metadata.aiJobId = input.aiJobId;
        }
        if (input.aiJobAttempt !== null && input.aiJobAttempt !== undefined) {
            metadata.aiJobAttempt = input.aiJobAttempt;
        }
        if (input.aiJobRequestedByUserId !== null && input.aiJobRequestedByUserId !== undefined) {
            metadata.aiJobRequestedByUserId = input.aiJobRequestedByUserId;
        }
        const metadataJson = Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null;
        await prisma.$executeRaw`
            INSERT INTO ghost_runs (
                run_kind,
                status,
                circle_id,
                reason,
                window_size,
                message_count,
                focused_count,
                focused_ratio,
                min_messages,
                min_question_count,
                min_focused_ratio,
                question_count,
                summary_method,
                summary_preview,
                draft_post_id,
                metadata,
                created_at
            )
            VALUES (
                'discussion_draft_trigger',
                ${input.status},
                ${input.circleId},
                ${input.reason},
                ${input.windowSize},
                ${input.messageCount ?? null},
                ${input.focusedCount ?? null},
                ${input.focusedRatio ?? null},
                ${input.minMessages},
                ${input.minQuestionCount},
                ${input.minFocusedRatio},
                ${input.questionCount ?? null},
                ${input.summaryMethod ?? null},
                ${input.summaryPreview ?? null},
                ${input.draftPostId ?? null},
                ${metadataJson}::jsonb,
                NOW()
            )
        `;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`discussion draft trigger: failed to write ghost run audit (${message})`);
    }
}

export function buildDraftOpportunityNotification(input: {
    summary: string;
    messageCount: number;
    focusedRatio: number;
    questionCount: number;
}): {
    title: string;
    body: string | null;
    metadata: {
        messageKey: 'discussion.draft_ready';
        params: {
            messageCount: number;
            focusedPercent: number;
            questionCount: number;
            summary: string;
        };
    };
} {
    const focusedPercent = Number((input.focusedRatio * 100).toFixed(0));
    const summary = clipText(input.summary.replace(/\s+/g, ' ').trim(), 180);

    return {
        title: 'discussion.draft_ready',
        body: null,
        metadata: {
            messageKey: 'discussion.draft_ready',
            params: {
                messageCount: input.messageCount,
                focusedPercent,
                questionCount: input.questionCount,
                summary,
            },
        },
    };
}

export function isDraftTriggerEligibleMessageKind(messageKind: string | null | undefined): boolean {
    const normalized = String(messageKind || '').trim().toLowerCase();
    if (!normalized) return true;
    return !DISCUSSION_SYSTEM_NOTICE_KINDS.includes(normalized as typeof DISCUSSION_SYSTEM_NOTICE_KINDS[number]);
}

async function notifyDraftOpportunity(input: {
    prisma: PrismaClient;
    circleId: number;
    creatorId: number;
    senderPubkeys: string[];
    summary: string;
    messageCount: number;
    focusedRatio: number;
    questionCount: number;
}): Promise<{ notifiedCount: number; userIds: number[] }> {
    const uniquePubkeys = Array.from(new Set(input.senderPubkeys.filter(Boolean)));
    const participants = uniquePubkeys.length > 0
        ? await input.prisma.user.findMany({
            where: { pubkey: { in: uniquePubkeys } },
            select: { id: true },
        })
        : [];

    const recipientIds = Array.from(
        new Set([input.creatorId, ...participants.map((p) => p.id)]),
    ).slice(0, 20);

    if (recipientIds.length === 0) {
        return { notifiedCount: 0, userIds: [] };
    }

    const notification = buildDraftOpportunityNotification({
        summary: input.summary,
        messageCount: input.messageCount,
        focusedRatio: input.focusedRatio,
        questionCount: input.questionCount,
    });

    await input.prisma.notification.createMany({
        data: recipientIds.map((userId) => ({
            userId,
            type: 'draft',
            title: notification.title,
            body: notification.body,
            metadata: notification.metadata,
            sourceType: 'discussion_trigger',
            sourceId: String(input.circleId),
            circleId: input.circleId,
            read: false,
        })),
    });

    return {
        notifiedCount: recipientIds.length,
        userIds: recipientIds,
    };
}

export async function enqueueDiscussionTriggerEvaluationJob(
    prisma: PrismaClient,
    input: {
        circleId: number;
        requestedByUserId?: number | null;
    },
) {
    const prismaAny = prisma as any;
    const existingRows = await prismaAny.aiJob.findMany({
        where: {
            scopeType: 'circle',
            scopeCircleId: input.circleId,
            status: { in: ['queued', 'running'] },
            jobType: 'discussion_trigger_evaluate',
        },
        orderBy: [
            { createdAt: 'desc' },
            { id: 'desc' },
        ],
        take: 1,
    });
    const existing = existingRows[0] ? toAiJobRecord(existingRows[0]) : null;
    if (existing) {
        return existing;
    }

    return enqueueAiJob(prisma as any, {
        jobType: 'discussion_trigger_evaluate',
        scopeType: 'circle',
        scopeCircleId: input.circleId,
        requestedByUserId: input.requestedByUserId ?? null,
        payload: {
            circleId: input.circleId,
        },
    });
}

export async function loadLatestDiscussionTriggerDiagnostics(
    prisma: PrismaClient,
    circleId: number,
): Promise<DiscussionTriggerDiagnosticsSnapshot | null> {
    const row = await prisma.ghostRun.findFirst({
        where: {
            circleId,
            runKind: 'discussion_draft_trigger',
        },
        orderBy: [
            { createdAt: 'desc' },
            { id: 'desc' },
        ],
    });
    if (!row) {
        return null;
    }

    const metadata = parseObject(row.metadata);
    const judge = parseObject(metadata?.judge);
    const errorMessage = typeof metadata?.error === 'string' ? metadata.error : null;

    return {
        scope: 'circle-scoped',
        circleId: row.circleId,
        createdAt: row.createdAt.toISOString(),
        input: {
            windowEnvelopeIds: parseStringArray(metadata?.windowEnvelopeIds),
            windowDigest: typeof metadata?.windowDigest === 'string' ? metadata.windowDigest : null,
            triggerSettings: {
                draftTriggerMode: typeof metadata?.mode === 'string' ? metadata.mode : null,
                triggerSummaryUseLLM:
                    typeof metadata?.summaryUseLLM === 'boolean'
                        ? metadata.summaryUseLLM
                        : null,
                minMessages: row.minMessages,
                minQuestionCount: row.minQuestionCount,
                minFocusedRatio: Number(row.minFocusedRatio),
            },
            messageCount: row.messageCount ?? null,
            focusedCount: row.focusedCount ?? null,
            focusedRatio: row.focusedRatio === null ? null : Number(row.focusedRatio),
            questionCount: row.questionCount ?? null,
        },
        runtime: {
            summaryMethod: row.summaryMethod ?? null,
            aiJobId: typeof metadata?.aiJobId === 'number' ? metadata.aiJobId : null,
            aiJobAttempt: typeof metadata?.aiJobAttempt === 'number' ? metadata.aiJobAttempt : null,
            requestedByUserId:
                typeof metadata?.aiJobRequestedByUserId === 'number'
                    ? metadata.aiJobRequestedByUserId
                    : null,
            judge,
        },
        output: {
            status: row.status as GhostRunStatus,
            reason: row.reason,
            summaryPreview: row.summaryPreview ?? null,
            draftPostId: row.draftPostId ?? null,
        },
        failure: {
            code: row.status === 'error' ? row.reason : null,
            message: errorMessage,
        },
    };
}

export async function maybeTriggerGhostDraftFromDiscussion(input: {
    prisma: PrismaClient;
    redis: Redis;
    circleId: number;
    aiJob?: {
        id: number;
        attempt: number;
        requestedByUserId: number | null;
    };
}): Promise<{ triggered: boolean; reason: string; draftPostId?: number }> {
    const globalGhostConfig = loadGhostConfig();
    const triggerConfig = globalGhostConfig.trigger;
    const auditBase = {
        circleId: input.circleId,
        windowSize: triggerConfig.windowSize,
        minMessages: triggerConfig.minMessages,
        minQuestionCount: triggerConfig.minQuestionCount,
        minFocusedRatio: triggerConfig.minFocusedRatio,
        aiJobId: input.aiJob?.id ?? null,
        aiJobAttempt: input.aiJob?.attempt ?? null,
        aiJobRequestedByUserId: input.aiJob?.requestedByUserId ?? null,
    };

    if (!triggerConfig.enabled) {
        await writeGhostRunAudit(input.prisma, {
            ...auditBase,
            status: 'skipped',
            reason: 'disabled',
        });
        return { triggered: false, reason: 'disabled' };
    }

    const lockKey = buildLockKey(input.circleId);
    const lock = await input.redis.setnx(lockKey, String(Date.now()));
    if (lock !== 1) {
        await writeGhostRunAudit(input.prisma, {
            ...auditBase,
            status: 'skipped',
            reason: 'lock_not_acquired',
        });
        return { triggered: false, reason: 'lock_not_acquired' };
    }
    await input.redis.expire(lockKey, 15);

    try {
        const cooldownKey = buildCooldownKey(input.circleId);
        const inCooldown = await input.redis.exists(cooldownKey);
        if (inCooldown) {
            await writeGhostRunAudit(input.prisma, {
                ...auditBase,
                status: 'skipped',
                reason: 'cooldown',
            });
            return { triggered: false, reason: 'cooldown' };
        }

        const circle = await input.prisma.circle.findUnique({
            where: { id: input.circleId },
            select: {
                id: true,
                name: true,
                description: true,
                creatorId: true,
            },
        });
        if (!circle) {
            await writeGhostRunAudit(input.prisma, {
                ...auditBase,
                status: 'skipped',
                reason: 'circle_not_found',
            });
            return { triggered: false, reason: 'circle_not_found' };
        }

        const rows = await input.prisma.$queryRaw<DiscussionSignalRow[]>(Prisma.sql`
            SELECT
                envelope_id AS "envelopeId",
                payload_hash AS "payloadHash",
                lamport AS "lamport",
                payload_text AS "payloadText",
                message_kind AS "messageKind",
                metadata AS "metadata",
                sender_pubkey AS "senderPubkey",
                sender_handle AS "senderHandle",
                created_at AS "createdAt",
                relevance_score AS "relevanceScore",
                semantic_score AS "semanticScore",
                quality_score AS "qualityScore",
                spam_score AS "spamScore",
                decision_confidence AS "decisionConfidence",
                relevance_method AS "relevanceMethod",
                semantic_facets AS "semanticFacets",
                author_annotations AS "authorAnnotations",
                focus_score AS "focusScore",
                focus_label AS "focusLabel"
            FROM circle_discussion_messages
            WHERE circle_id = ${input.circleId}
              AND deleted = FALSE
              AND is_ephemeral = FALSE
              AND COALESCE(relevance_status, 'ready') = 'ready'
            ORDER BY lamport DESC
            LIMIT ${triggerConfig.windowSize}
        `);

        const circleGhostPatch = await loadCircleGhostSettingsPatch(input.prisma, input.circleId);
        const effectiveGhostSettings = resolveCircleGhostSettings(globalGhostConfig, circleGhostPatch);

        const ordered = [...rows].reverse();
        const messages = ordered
            .map((row) => ({
                ...row,
                payloadText: normalizeText(row.payloadText || ''),
                semanticScore: normalizeScore(row.semanticScore ?? row.relevanceScore),
                qualityScore: normalizeScore(row.qualityScore ?? 0.5),
                spamScore: normalizeScore(row.spamScore ?? 0),
                decisionConfidence: normalizeScore(row.decisionConfidence ?? 0.5),
                semanticFacets: normalizeSemanticFacets(row.semanticFacets),
                focusScore: normalizeScore(row.focusScore ?? row.semanticScore ?? row.relevanceScore),
                focusLabel: normalizeFocusLabel(row.focusLabel),
            }))
            .filter((row) => row.payloadText.length > 0)
            .filter((row) => isDraftTriggerEligibleMessageKind(row.messageKind));

        if (messages.length < triggerConfig.minMessages) {
            await writeGhostRunAudit(input.prisma, {
                ...auditBase,
                status: 'skipped',
                reason: 'insufficient_messages',
                messageCount: messages.length,
                metadata: {
                    windowEnvelopeIds: messages.map((row) => row.envelopeId),
                    windowDigest: buildTriggerWindowDigest(messages),
                },
            });
            return { triggered: false, reason: 'insufficient_messages' };
        }

        const focusStats = computeFocusStats(
            messages.map((row) => row.focusScore),
            0.35,
        );
        const focusedCount = focusStats.focusedCount;
        const focusedRatio = focusStats.focusedRatio;
        const participantCount = new Set(messages.map((row) => row.senderPubkey)).size;
        const spamCount = messages.filter((row) => row.spamScore >= 0.6).length;
        const spamRatio = spamCount / Math.max(1, messages.length);
        const questionCount = messages.filter((row) =>
            row.semanticFacets.includes('question') || hasQuestionSignal(row.payloadText)
        ).length;
        const windowMetadata = {
            windowEnvelopeIds: messages.map((row) => row.envelopeId),
            windowDigest: buildTriggerWindowDigest(messages),
        };
        const topicHeat = clamp01(
            focusedRatio * 0.55
            + clamp01(participantCount / 8) * 0.2
            + clamp01(questionCount / 6) * 0.25
            - spamRatio * 0.4,
        );

        if (participantCount < 2) {
            await writeGhostRunAudit(input.prisma, {
                ...auditBase,
                status: 'skipped',
                reason: 'insufficient_participants',
                messageCount: messages.length,
                focusedCount,
                focusedRatio,
                metadata: {
                    ...windowMetadata,
                    participantCount,
                    spamRatio,
                    topicHeat,
                },
            });
            return { triggered: false, reason: 'insufficient_participants' };
        }

        if (spamRatio >= 0.35) {
            await writeGhostRunAudit(input.prisma, {
                ...auditBase,
                status: 'skipped',
                reason: 'high_spam_ratio',
                messageCount: messages.length,
                focusedCount,
                focusedRatio,
                metadata: {
                    ...windowMetadata,
                    participantCount,
                    spamRatio,
                    topicHeat,
                },
            });
            return { triggered: false, reason: 'high_spam_ratio' };
        }

        if (focusedRatio < triggerConfig.minFocusedRatio) {
            await writeGhostRunAudit(input.prisma, {
                ...auditBase,
                status: 'skipped',
                reason: 'insufficient_focus',
                messageCount: messages.length,
                focusedCount,
                focusedRatio,
                metadata: {
                    ...windowMetadata,
                    participantCount,
                    spamRatio,
                    topicHeat,
                },
            });
            return { triggered: false, reason: 'insufficient_focus' };
        }

        if (questionCount < triggerConfig.minQuestionCount) {
            await writeGhostRunAudit(input.prisma, {
                ...auditBase,
                status: 'skipped',
                reason: 'insufficient_questions',
                messageCount: messages.length,
                focusedCount,
                focusedRatio,
                questionCount,
                metadata: {
                    ...windowMetadata,
                    participantCount,
                    spamRatio,
                    topicHeat,
                },
            });
            return { triggered: false, reason: 'insufficient_questions' };
        }

        const recentAutoDraft = await input.prisma.post.findFirst({
            where: {
                circleId: input.circleId,
                status: 'Draft' as any,
                contentType: 'ai/discussion-draft',
                createdAt: {
                    gte: new Date(Date.now() - triggerConfig.cooldownSec * 1000),
                },
            },
            select: { id: true },
        });
        if (recentAutoDraft) {
            await input.redis.setex(
                cooldownKey,
                triggerConfig.cooldownSec,
                JSON.stringify({ postId: recentAutoDraft.id, reason: 'recent_auto_draft' }),
            );
            await writeGhostRunAudit(input.prisma, {
                ...auditBase,
                status: 'skipped',
                reason: 'recent_auto_draft',
                messageCount: messages.length,
                focusedCount,
                focusedRatio,
                questionCount,
                draftPostId: recentAutoDraft.id,
                metadata: {
                    ...windowMetadata,
                    participantCount,
                    spamRatio,
                    topicHeat,
                },
            });
            return { triggered: false, reason: 'recent_auto_draft' };
        }

        const summary = await summarizeDiscussionThread({
            circleName: circle.name,
            circleDescription: circle.description,
            useLLM: effectiveGhostSettings.triggerSummaryUseLLM,
            messages: messages.map((row) => ({
                senderHandle: row.senderHandle,
                senderPubkey: row.senderPubkey,
                text: row.payloadText,
                createdAt: row.createdAt,
                relevanceScore: row.focusScore,
            })),
        });

        const triggerDecision = await judgeDiscussionTrigger({
            circleName: circle.name,
            circleDescription: circle.description,
            mode: effectiveGhostSettings.draftTriggerMode,
            allowLLM: effectiveGhostSettings.triggerSummaryUseLLM,
            messageCount: messages.length,
            focusedRatio,
            questionCount,
            participantCount,
            spamRatio,
            topicHeat,
            summary: summary.summary,
        });

        if (!triggerDecision.shouldTrigger || triggerDecision.recommendedAction === 'none') {
            await writeGhostRunAudit(input.prisma, {
                ...auditBase,
                status: 'skipped',
                reason: triggerDecision.reasonCode || 'judge_rejected',
                messageCount: messages.length,
                focusedCount,
                focusedRatio,
                questionCount,
                summaryMethod: summary.method,
                summaryPreview: truncateSummaryPreview(summary.summary),
                metadata: {
                    ...windowMetadata,
                    mode: effectiveGhostSettings.draftTriggerMode,
                    summaryUseLLM: effectiveGhostSettings.triggerSummaryUseLLM,
                    participantCount,
                    spamRatio,
                    topicHeat,
                    judge: triggerDecision,
                    generatedAt: summary.generatedAt.toISOString(),
                },
            });
            return { triggered: false, reason: triggerDecision.reasonCode || 'judge_rejected' };
        }

        if (triggerDecision.recommendedAction === 'notify_only') {
            const notification = await notifyDraftOpportunity({
                prisma: input.prisma,
                circleId: input.circleId,
                creatorId: circle.creatorId,
                senderPubkeys: messages.map((m) => m.senderPubkey),
                summary: summary.summary,
                messageCount: summary.messageCount,
                focusedRatio,
                questionCount,
            });

            const sourceMessageIds = messages.map((row) => row.envelopeId);
            const sourceSemanticFacets = collectSourceSemanticFacets(messages);
            const sourceAuthorAnnotations = collectSourceAuthorAnnotations(messages);
            try {
                await publishDraftCandidateSystemNotices(
                    input.prisma,
                    {
                        circleId: input.circleId,
                        summary: summary.summary,
                        sourceMessageIds,
                        sourceSemanticFacets,
                        sourceAuthorAnnotations,
                        draftPostId: null,
                        triggerReason: triggerDecision.reasonCode || 'notify_only',
                    },
                    input.redis,
                );
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.warn(`discussion draft trigger: failed to publish candidate notice (${message})`);
            }

            await input.redis.setex(
                cooldownKey,
                triggerConfig.cooldownSec,
                JSON.stringify({
                    reason: triggerDecision.reasonCode || 'notify_only',
                    generatedAt: new Date().toISOString(),
                    method: summary.method,
                    notifiedCount: notification.notifiedCount,
                }),
            );

            await writeGhostRunAudit(input.prisma, {
                ...auditBase,
                status: 'triggered',
                reason: triggerDecision.reasonCode || 'notified',
                messageCount: messages.length,
                focusedCount,
                focusedRatio,
                questionCount,
                summaryMethod: summary.method,
                summaryPreview: truncateSummaryPreview(summary.summary),
                metadata: {
                    ...windowMetadata,
                    mode: effectiveGhostSettings.draftTriggerMode,
                    summaryUseLLM: effectiveGhostSettings.triggerSummaryUseLLM,
                    participantCount,
                    spamRatio,
                    topicHeat,
                    judge: triggerDecision,
                    notifiedCount: notification.notifiedCount,
                    notifiedUserIds: notification.userIds,
                    generatedAt: summary.generatedAt.toISOString(),
                },
            });

            return { triggered: true, reason: triggerDecision.reasonCode || 'notified' };
        }

        const sourceMessageIds = messages.map((row) => row.envelopeId);
        const sourceSemanticFacets = collectSourceSemanticFacets(messages);
        const sourceAuthorAnnotations = collectSourceAuthorAnnotations(messages);
        const initialDraft = await generateInitialDiscussionDraft(input.prisma, {
            circleId: input.circleId,
            circleName: circle.name,
            circleDescription: circle.description,
            sourceMessageIds,
        }).catch(async (error) => {
            const generationError = error instanceof DiscussionInitialDraftError
                ? error
                : new DiscussionInitialDraftError({
                    code: 'initial_draft_generation_failed',
                    message: error instanceof Error ? error.message : String(error || ''),
                });
            try {
                await publishDraftCandidateSystemNotices(
                    input.prisma,
                    {
                        circleId: input.circleId,
                        summary: summary.summary,
                        sourceMessageIds,
                        sourceSemanticFacets,
                        sourceAuthorAnnotations,
                        draftPostId: null,
                        triggerReason: triggerDecision.reasonCode || 'auto_draft_generation_failed',
                        candidateStateOverride: 'generation_failed',
                        draftGenerationError: generationError.code,
                    },
                    input.redis,
                );
            } catch (noticeError) {
                const message = noticeError instanceof Error ? noticeError.message : String(noticeError);
                console.warn(`discussion draft trigger: failed to publish generation_failed candidate notice (${message})`);
            }

            await input.redis.setex(
                cooldownKey,
                triggerConfig.cooldownSec,
                JSON.stringify({
                    reason: generationError.code,
                    generatedAt: new Date().toISOString(),
                    method: summary.method,
                }),
            );

            await writeGhostRunAudit(input.prisma, {
                ...auditBase,
                status: 'error',
                reason: generationError.code,
                messageCount: messages.length,
                focusedCount,
                focusedRatio,
                questionCount,
                summaryMethod: summary.method,
                summaryPreview: truncateSummaryPreview(summary.summary),
                metadata: {
                    ...windowMetadata,
                    mode: effectiveGhostSettings.draftTriggerMode,
                    summaryUseLLM: effectiveGhostSettings.triggerSummaryUseLLM,
                    participantCount,
                    spamRatio,
                    topicHeat,
                    judge: triggerDecision,
                    generatedAt: summary.generatedAt.toISOString(),
                    error: generationError.message,
                    diagnostics: generationError.diagnostics,
                },
            });

            return null;
        });
        if (!initialDraft) {
            return { triggered: false, reason: 'initial_draft_generation_failed' };
        }

        const nonce = crypto.randomBytes(8).toString('hex');
        const contentId = `ai-draft:${input.circleId}:${Date.now()}:${nonce}`;
        const onChainAddress = `offchain_ai_${crypto.randomBytes(16).toString('hex')}`.slice(0, 44);
        const text = initialDraft.draftText;

        const draftPost = await createTriggeredDraftPostWithInitialSnapshot(input.prisma, {
            contentId,
            authorId: circle.creatorId,
            circleId: input.circleId,
            text,
            onChainAddress,
        });

        let draftAnchorMeta: Record<string, unknown> = {
            status: 'skipped',
            reason: 'anchor_not_attempted',
        };
        try {
            const anchor = await createDraftAnchorBatch({
                prisma: input.prisma,
                circleId: input.circleId,
                draftPostId: draftPost.id,
                roomKey: buildDiscussionRoomKey(input.circleId),
                triggerReason: triggerDecision.reasonCode || 'created',
                summaryText: summary.summary,
                summaryMethod: summary.method,
                messages: messages.map((row) => ({
                    envelopeId: row.envelopeId,
                    payloadHash: row.payloadHash,
                    lamport: row.lamport,
                    senderPubkey: row.senderPubkey,
                    createdAt: row.createdAt,
                    semanticScore: row.semanticScore,
                    relevanceMethod: row.relevanceMethod || 'rule',
                })),
            });
            draftAnchorMeta = {
                status: anchor.status,
                anchorId: anchor.anchorId,
                payloadHash: anchor.payloadHash,
                messagesDigest: anchor.messagesDigest,
                txSignature: anchor.txSignature,
                txSlot: anchor.txSlot,
                errorMessage: anchor.errorMessage,
                createdAt: anchor.createdAt,
            };

            await updateDraftVersionSnapshotSourceEvidence(input.prisma, {
                draftPostId: draftPost.id,
                draftVersion: 1,
                sourceSummaryHash: anchor.summaryHash,
                sourceMessagesDigest: anchor.messagesDigest,
            });

            if (anchor.txSignature) {
                await input.prisma.post.update({
                    where: { id: draftPost.id },
                    data: {
                        storageUri: `solana://tx/${anchor.txSignature}`,
                    },
                });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            draftAnchorMeta = {
                status: 'failed',
                errorMessage: message,
            };
            console.warn(`discussion draft trigger: failed to anchor batch (${message})`);
        }

        await input.redis.setex(
            cooldownKey,
            triggerConfig.cooldownSec,
            JSON.stringify({
                postId: draftPost.id,
                generatedAt: new Date().toISOString(),
                method: summary.method,
            }),
        );

        await writeGhostRunAudit(input.prisma, {
            ...auditBase,
            status: 'triggered',
            reason: triggerDecision.reasonCode || 'created',
            messageCount: messages.length,
            focusedCount,
            focusedRatio,
            questionCount,
            summaryMethod: summary.method,
            summaryPreview: truncateSummaryPreview(summary.summary),
            draftPostId: draftPost.id,
            metadata: {
                ...windowMetadata,
                mode: effectiveGhostSettings.draftTriggerMode,
                summaryUseLLM: effectiveGhostSettings.triggerSummaryUseLLM,
                participantCount,
                spamRatio,
                topicHeat,
                judge: triggerDecision,
                generateComment: false,
                generatedAt: summary.generatedAt.toISOString(),
                summaryMessageCount: summary.messageCount,
                draftGenerationMethod: 'llm',
                draftGeneration: initialDraft.generationMetadata,
                draftAnchor: draftAnchorMeta,
            },
        });

        try {
            await publishDraftCandidateSystemNotices(
                input.prisma,
                {
                    circleId: input.circleId,
                    summary: summary.summary,
                    sourceMessageIds,
                    sourceSemanticFacets,
                    sourceAuthorAnnotations,
                    draftPostId: draftPost.id,
                    triggerReason: triggerDecision.reasonCode || 'created',
                    draftGenerationStatus: 'succeeded',
                    draftGenerationMethod: 'llm',
                    draftGenerationSourceDigest: initialDraft.sourceDigest,
                },
                input.redis,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`discussion draft trigger: failed to publish candidate notice (${message})`);
        }
        return {
            triggered: true,
            reason: triggerDecision.reasonCode || 'created',
            draftPostId: draftPost.id,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await writeGhostRunAudit(input.prisma, {
            ...auditBase,
            status: 'error',
            reason: 'exception',
            metadata: {
                error: message,
            },
        });
        throw error;
    } finally {
        try {
            await input.redis.del(lockKey);
        } catch {
            // ignore lock cleanup failures
        }
    }
}
