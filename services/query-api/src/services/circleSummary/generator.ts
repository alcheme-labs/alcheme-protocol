import { Prisma, type PrismaClient } from '@prisma/client';

import { loadGhostConfig } from '../../ai/ghost/config';
import { loadCircleGhostSettingsPatch, resolveCircleGhostSettings } from '../../ai/ghost/circle-settings';
import { buildAiSourceDigest, type AiGenerationMetadata } from '../../ai/metadata';
import { generateAiText } from '../../ai/provider';
import {
    loadLatestCircleSummarySnapshot,
    persistCircleSummarySnapshot,
    type CircleSummaryGeneratedBy,
    type CircleSummarySnapshot,
    type CircleSummarySnapshotPersistenceInput,
} from './snapshot';

interface SummaryOutputRow {
    knowledgeId: string;
    title: string;
    version: number;
    citationCount: number;
    createdAt: Date;
    contributorsCount: number;
    sourceDraftPostId: number | null;
    sourceAnchorId: string | null;
    sourceSummaryHash: string | null;
    sourceMessagesDigest: string | null;
    proofPackageHash: string | null;
    bindingVersion: number | null;
    bindingCreatedAt: Date | null;
    outboundReferenceCount: number;
    inboundReferenceCount: number;
}

interface SummaryDraftRow {
    draftPostId: number;
    documentStatus: string;
    currentSnapshotVersion: number;
    updatedAt: Date | null;
    draftVersion: number | null;
    sourceSummaryHash: string | null;
    sourceMessagesDigest: string | null;
}

interface SummaryThreadStatsRow {
    openThreadCount: number;
    totalThreadCount: number;
}

interface SummaryFreshnessRow {
    latestSourceUpdatedAt: Date | null;
}

interface SummaryDiscussionMessageRow {
    payloadText: string | null;
    senderPubkey: string;
    senderHandle: string | null;
    createdAt: Date;
    relevanceScore: number | null;
    semanticScore: number | null;
    focusScore: number | null;
    semanticFacets: string[] | null;
}

interface EnsureLatestCircleSummarySnapshotInput {
    circleId: number;
    forceGenerate?: boolean;
    now?: Date;
}

function formatShortDate(value: Date | null | undefined): string {
    if (!(value instanceof Date)) return '时间待补';
    return value.toLocaleDateString('zh-CN', {
        month: 'short',
        day: 'numeric',
    });
}

function normalizeGeneratedBy(forceGenerate: boolean): CircleSummaryGeneratedBy {
    return forceGenerate ? 'user_requested' : 'system_projection';
}

function normalizeEffectiveGeneratedBy(input: {
    forceGenerate: boolean;
    usedLLM: boolean;
}): CircleSummaryGeneratedBy {
    if (input.usedLLM) return 'system_llm';
    return normalizeGeneratedBy(input.forceGenerate);
}

function asPositiveInt(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function loadSummaryOutputs(
    prisma: PrismaClient,
    circleId: number,
): Promise<SummaryOutputRow[]> {
    return prisma.$queryRaw<SummaryOutputRow[]>(Prisma.sql`
        SELECT
            k.knowledge_id AS "knowledgeId",
            k.title,
            k.version,
            k.citation_count AS "citationCount",
            k.created_at AS "createdAt",
            k.contributors_count AS "contributorsCount",
            contribution.source_draft_post_id AS "sourceDraftPostId",
            binding.source_anchor_id AS "sourceAnchorId",
            contribution.source_summary_hash AS "sourceSummaryHash",
            contribution.source_messages_digest AS "sourceMessagesDigest",
            binding.proof_package_hash AS "proofPackageHash",
            binding.binding_version AS "bindingVersion",
            binding.bound_at AS "bindingCreatedAt",
            COALESCE(outbound.reference_count, 0) AS "outboundReferenceCount",
            COALESCE(inbound.reference_count, 0) AS "inboundReferenceCount"
        FROM knowledge k
        LEFT JOIN knowledge_binding binding
            ON binding.knowledge_id = k.knowledge_id
        LEFT JOIN LATERAL (
            SELECT
                kc.source_draft_post_id,
                kc.source_summary_hash,
                kc.source_messages_digest
            FROM knowledge_contributions kc
            WHERE kc.knowledge_id = k.id
            ORDER BY kc.updated_at DESC, kc.id DESC
            LIMIT 1
        ) contribution ON TRUE
        LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS reference_count
            FROM knowledge_references kr
            WHERE kr.source_knowledge_id = k.knowledge_id
        ) outbound ON TRUE
        LEFT JOIN LATERAL (
            SELECT COUNT(*)::int AS reference_count
            FROM knowledge_references kr
            WHERE kr.target_knowledge_id = k.knowledge_id
        ) inbound ON TRUE
        WHERE k.circle_id = ${circleId}
        ORDER BY k.quality_score DESC, k.created_at DESC
        LIMIT 12
    `);
}

async function loadPrimaryDraft(
    prisma: PrismaClient,
    circleId: number,
): Promise<SummaryDraftRow | null> {
    const rows = await prisma.$queryRaw<SummaryDraftRow[]>(Prisma.sql`
        SELECT
            dws.draft_post_id AS "draftPostId",
            dws.document_status AS "documentStatus",
            dws.current_snapshot_version AS "currentSnapshotVersion",
            dws.updated_at AS "updatedAt",
            latest_snapshot.draft_version AS "draftVersion",
            latest_snapshot.source_summary_hash AS "sourceSummaryHash",
            latest_snapshot.source_messages_digest AS "sourceMessagesDigest"
        FROM draft_workflow_state dws
        LEFT JOIN LATERAL (
            SELECT
                dvs.draft_version,
                dvs.source_summary_hash,
                dvs.source_messages_digest
            FROM draft_version_snapshots dvs
            WHERE dvs.draft_post_id = dws.draft_post_id
            ORDER BY dvs.draft_version DESC
            LIMIT 1
        ) latest_snapshot ON TRUE
        WHERE dws.circle_id = ${circleId}
        ORDER BY dws.updated_at DESC, dws.draft_post_id DESC
        LIMIT 1
    `);
    return rows[0] ?? null;
}

async function loadDraftThreadStats(
    prisma: PrismaClient,
    draftPostId: number | null,
): Promise<SummaryThreadStatsRow> {
    if (!draftPostId) {
        return {
            openThreadCount: 0,
            totalThreadCount: 0,
        };
    }

    const rows = await prisma.$queryRaw<SummaryThreadStatsRow[]>(Prisma.sql`
        SELECT
            COUNT(*) FILTER (WHERE state <> 'resolved')::int AS "openThreadCount",
            COUNT(*)::int AS "totalThreadCount"
        FROM draft_discussion_threads
        WHERE draft_post_id = ${draftPostId}
    `);

    return rows[0] ?? {
        openThreadCount: 0,
        totalThreadCount: 0,
    };
}

async function loadRecentDiscussionMessages(
    prisma: PrismaClient,
    circleId: number,
): Promise<SummaryDiscussionMessageRow[]> {
    return prisma.$queryRaw<SummaryDiscussionMessageRow[]>(Prisma.sql`
        SELECT
            payload_text AS "payloadText",
            sender_pubkey AS "senderPubkey",
            sender_handle AS "senderHandle",
            created_at AS "createdAt",
            relevance_score AS "relevanceScore",
            semantic_score AS "semanticScore",
            focus_score AS "focusScore",
            semantic_facets AS "semanticFacets"
        FROM circle_discussion_messages
        WHERE circle_id = ${circleId}
          AND subject_type IS NULL
          AND subject_id IS NULL
          AND deleted = FALSE
          AND COALESCE(relevance_status, 'ready') = 'ready'
        ORDER BY lamport DESC
        LIMIT 20
    `);
}

export async function loadCircleSummaryLatestSourceUpdatedAt(
    prisma: PrismaClient,
    circleId: number,
): Promise<Date | null> {
    const rows = await prisma.$queryRaw<SummaryFreshnessRow[]>(Prisma.sql`
        SELECT MAX(updated_at) AS "latestSourceUpdatedAt"
        FROM (
            SELECT k.updated_at
            FROM knowledge k
            WHERE k.circle_id = ${circleId}

            UNION ALL

            SELECT dws.updated_at
            FROM draft_workflow_state dws
            WHERE dws.circle_id = ${circleId}

            UNION ALL

            SELECT dvs.created_at AS updated_at
            FROM draft_version_snapshots dvs
            INNER JOIN draft_workflow_state dws
                ON dws.draft_post_id = dvs.draft_post_id
            WHERE dws.circle_id = ${circleId}

            UNION ALL

            SELECT dt.updated_at
            FROM draft_discussion_threads dt
            INNER JOIN draft_workflow_state dws
                ON dws.draft_post_id = dt.draft_post_id
            WHERE dws.circle_id = ${circleId}

            UNION ALL

            SELECT cdm.updated_at
            FROM circle_discussion_messages cdm
            WHERE cdm.circle_id = ${circleId}
        ) source_updates
    `);

    return rows[0]?.latestSourceUpdatedAt instanceof Date
        ? rows[0].latestSourceUpdatedAt
        : null;
}

export function isCircleSummarySnapshotStale(
    snapshot: CircleSummarySnapshot,
    latestSourceUpdatedAt: Date | null,
): boolean {
    return latestSourceUpdatedAt instanceof Date
        && latestSourceUpdatedAt.getTime() > snapshot.generatedAt.getTime();
}

function buildProjectionMetadata(input: {
    circleId: number;
    outputs: SummaryOutputRow[];
    primaryDraft: SummaryDraftRow | null;
    threadStats: SummaryThreadStatsRow;
}): AiGenerationMetadata {
    return {
        providerMode: 'projection',
        model: 'projection',
        promptAsset: 'circle-summary-projection',
        promptVersion: 'v1',
        sourceDigest: buildAiSourceDigest({
            circleId: input.circleId,
            outputs: input.outputs.map((row) => ({
                knowledgeId: row.knowledgeId,
                title: row.title,
                version: row.version,
                citationCount: row.citationCount,
                sourceDraftPostId: row.sourceDraftPostId,
                sourceAnchorId: row.sourceAnchorId,
                sourceMessagesDigest: row.sourceMessagesDigest,
            })),
            primaryDraft: input.primaryDraft
                ? {
                    draftPostId: input.primaryDraft.draftPostId,
                    currentSnapshotVersion: input.primaryDraft.currentSnapshotVersion,
                    sourceSummaryHash: input.primaryDraft.sourceSummaryHash,
                    sourceMessagesDigest: input.primaryDraft.sourceMessagesDigest,
                }
                : null,
            threadStats: input.threadStats,
        }),
    };
}

function buildCircleSummaryLlmPrompt(input: {
    circleId: number;
    outputs: SummaryOutputRow[];
    primaryDraft: SummaryDraftRow | null;
    threadStats: SummaryThreadStatsRow;
    recentMessages: SummaryDiscussionMessageRow[];
}): string {
    const outputLines = input.outputs.slice(0, 6).map((row, index) => (
        `${index + 1}. ${row.title} (v${row.version}, 引用 ${row.citationCount}, 草稿 ${row.sourceDraftPostId ?? '无'})`
    ));
    const messageLines = input.recentMessages
        .slice(-8)
        .map((row) => `[${row.createdAt.toISOString()}] ${row.senderHandle || row.senderPubkey}: ${(row.payloadText || '').trim()}`);

    return [
        `圈层 ${input.circleId} 的正式总结快照正在生成。`,
        '请输出 4 行中文纯文本，每行一个句子，不要 Markdown。',
        '第 1 行：当前主线共识。',
        '第 2 行：当前草稿基线或正文来源。',
        '第 3 行：仍未解决的分歧。',
        '第 4 行：下一步建议。',
        `当前稳定输出数：${input.outputs.length}`,
        `当前未关闭问题单：${input.threadStats.openThreadCount}/${input.threadStats.totalThreadCount}`,
        input.primaryDraft
            ? `主草稿：#${input.primaryDraft.draftPostId}，稳定版本 v${input.primaryDraft.currentSnapshotVersion}`
            : '主草稿：暂无唯一基线',
        '稳定输出：',
        outputLines.length > 0 ? outputLines.join('\n') : '暂无稳定输出',
        '最近讨论：',
        messageLines.length > 0 ? messageLines.join('\n') : '暂无公开讨论',
    ].join('\n');
}

function applyLlmNarrativeToSnapshot(
    base: CircleSummarySnapshotPersistenceInput,
    llmText: string,
): Pick<CircleSummarySnapshotPersistenceInput, 'issueMap' | 'openQuestions'> {
    const lines = llmText
        .split(/\n+/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    return {
        issueMap: base.issueMap.map((card: any, index) => ({
            ...card,
            body: typeof lines[index] === 'string' && lines[index].length > 0
                ? lines[index]
                : card.body,
        })),
        openQuestions: base.openQuestions.map((card: any, index) => ({
            ...card,
            body: typeof lines[index + 3] === 'string' && lines[index + 3].length > 0
                ? lines[index + 3]
                : card.body,
        })),
    };
}

async function buildCircleSummaryLlmOverlay(input: {
    circleId: number;
    outputs: SummaryOutputRow[];
    primaryDraft: SummaryDraftRow | null;
    threadStats: SummaryThreadStatsRow;
    recentMessages: SummaryDiscussionMessageRow[];
}): Promise<{ text: string; metadata: AiGenerationMetadata } | null> {
    try {
        const sourceDigest = buildAiSourceDigest({
            circleId: input.circleId,
            outputs: input.outputs.map((row) => ({
                knowledgeId: row.knowledgeId,
                title: row.title,
                version: row.version,
                citationCount: row.citationCount,
                sourceDraftPostId: row.sourceDraftPostId,
            })),
            primaryDraft: input.primaryDraft
                ? {
                    draftPostId: input.primaryDraft.draftPostId,
                    currentSnapshotVersion: input.primaryDraft.currentSnapshotVersion,
                }
                : null,
            threadStats: input.threadStats,
            recentMessages: input.recentMessages.map((row) => ({
                senderHandle: row.senderHandle,
                senderPubkey: row.senderPubkey,
                text: row.payloadText || '',
                createdAt: row.createdAt.toISOString(),
            })),
        });
        const generated = await generateAiText({
            task: 'discussion-summary',
            userPrompt: buildCircleSummaryLlmPrompt(input),
            temperature: 0.2,
            maxOutputTokens: 260,
            dataBoundary: 'public_protocol',
        });
        const normalized = String(generated.text || '').trim();
        if (!normalized) return null;
        return {
            text: normalized,
            metadata: {
                providerMode: generated.providerMode,
                model: generated.model,
                promptAsset: 'circle-summary-inline',
                promptVersion: 'v1',
                sourceDigest,
            },
        };
    } catch {
        return null;
    }
}

export async function generateCircleSummarySnapshot(
    prisma: PrismaClient,
    input: {
        circleId: number;
        generatedAt?: Date;
        forceGenerate?: boolean;
        useLLM?: boolean;
    },
): Promise<CircleSummarySnapshotPersistenceInput> {
    const generatedAt = input.generatedAt ?? new Date();
    const outputs = await loadSummaryOutputs(prisma, input.circleId);
    const primaryDraft = await loadPrimaryDraft(prisma, input.circleId);
    const threadStats = await loadDraftThreadStats(prisma, primaryDraft?.draftPostId ?? null);
    const shouldUseLLM = Boolean(input.useLLM && outputs.length > 0);
    const recentMessages = shouldUseLLM
        ? [...await loadRecentDiscussionMessages(prisma, input.circleId)].reverse()
        : [];
    const recentFacets = recentMessages.flatMap((row) => Array.isArray(row.semanticFacets) ? row.semanticFacets : []);
    const factCount = recentFacets.filter((facet) => facet === 'fact').length;
    const explanationCount = recentFacets.filter((facet) => facet === 'explanation').length;
    const emotionCount = recentFacets.filter((facet) => facet === 'emotion').length;

    const primaryOutput = outputs[0] ?? null;
    const stableOutputCount = outputs.filter((row) => typeof row.sourceAnchorId === 'string' && row.sourceAnchorId.length > 0).length;
    const projectionMetadata = buildProjectionMetadata({
        circleId: input.circleId,
        outputs,
        primaryDraft,
        threadStats,
    });

    const projectionSnapshot: CircleSummarySnapshotPersistenceInput = {
        circleId: input.circleId,
        issueMap: [
            {
                title: '先看这条已经站稳的结论',
                body: primaryOutput
                    ? `当前最清晰的沉淀焦点是“${primaryOutput.title}”，它已经成为这个圈层目前最适合先进入的认知入口。`
                    : '当前还没有形成稳定的沉淀结果，因此这页先帮助你看清：哪些内容已开始聚焦，哪些仍在形成中。',
                emphasis: 'primary',
            },
            {
                title: '再回看它基于哪份正文',
                body: primaryDraft
                    ? `当前快照回到草稿 #${primaryDraft.draftPostId} 的 v${primaryDraft.currentSnapshotVersion} 稳定版本，继续理解这轮沉淀是怎么形成的。`
                    : '当前还没有唯一的正文基线，因此先从已经沉淀出来的结论进入，不伪造草稿真相。',
                emphasis: 'secondary',
            },
            {
                title: '还有哪些点仍在争论',
                body: threadStats.openThreadCount > 0
                    ? `当前还有 ${threadStats.openThreadCount} 条未关闭的问题单，说明这页总结仍保留继续修订的入口。`
                    : '当前没有悬而未决的问题单，冲突上下文主要体现在不同沉淀分支之间。',
                emphasis: 'muted',
            },
        ],
        conceptGraph: {
            nodes: outputs.map((row) => ({
                id: row.knowledgeId,
                label: row.title,
                version: row.version,
                citationCount: row.citationCount,
                contributorsCount: row.contributorsCount,
                sourceDraftPostId: row.sourceDraftPostId,
            })),
            edges: outputs.flatMap((row) => row.sourceDraftPostId
                ? [{
                    from: `draft-${row.sourceDraftPostId}`,
                    to: row.knowledgeId,
                    kind: 'draft_to_output',
                }]
                : []),
        },
        viewpointBranches: outputs.map((row, index) => ({
            knowledgeId: row.knowledgeId,
            title: row.title,
            routeLabel: index === 0 ? '主线入口' : `并行分支 ${index + 1}`,
            sourceDraftPostId: row.sourceDraftPostId,
            sourceBindingKind: row.sourceAnchorId ? 'snapshot' : 'unbound',
            citationSummary: `总被引 ${row.citationCount} · 预览引用 ${row.outboundReferenceCount} / 预览被引 ${row.inboundReferenceCount}`,
            createdAtLabel: formatShortDate(row.createdAt),
        })),
        factExplanationEmotionBreakdown: {
            facts: [
                { label: '事实类讨论', value: factCount },
                { label: '已结晶输出', value: outputs.length },
                { label: '公开问题单', value: threadStats.totalThreadCount },
            ],
            explanations: [
                {
                    label: '解释类讨论',
                    body: explanationCount > 0
                        ? `最近 ready 讨论里有 ${explanationCount} 条被识别为解释型发言，当前总结优先吸收这些解释脉络。`
                        : primaryOutput
                            ? `当前总览优先从“${primaryOutput.title}”进入，再回到来源草稿与绑定证据。`
                            : '当前还没有主线沉淀，因此总览保持探索态，不额外伪造稳定结论。',
                },
            ],
            emotions: [
                {
                    label: '总体氛围',
                    value: emotionCount > 0
                        ? `最近存在 ${emotionCount} 条情绪型讨论`
                        : threadStats.openThreadCount > 0 ? '仍在对齐中' : '趋于收敛',
                },
            ],
        },
        emotionConflictContext: {
            tensionLevel: threadStats.openThreadCount >= 3
                ? 'high'
                : threadStats.openThreadCount > 0
                    ? 'medium'
                    : 'low',
            notes: threadStats.openThreadCount > 0
                ? [`仍有 ${threadStats.openThreadCount} 条问题单待关闭。`, emotionCount > 0 ? `最近有 ${emotionCount} 条情绪型讨论进入 ready 口径。` : '']
                    .filter(Boolean)
                : [emotionCount > 0 ? `最近有 ${emotionCount} 条情绪型讨论进入 ready 口径。` : '当前没有未关闭的问题单。'],
        },
        sedimentationTimeline: [
            ...(primaryDraft
                ? [{
                    key: `draft-${primaryDraft.draftPostId}-v${primaryDraft.currentSnapshotVersion}`,
                    title: `稳定草稿基线 v${primaryDraft.currentSnapshotVersion}`,
                    summary: `当前总结以草稿 #${primaryDraft.draftPostId} 为可回溯正文来源。`,
                    timeLabel: formatShortDate(primaryDraft.updatedAt),
                }]
                : []),
            ...outputs.slice(0, 5).map((row) => ({
                key: row.knowledgeId,
                title: row.title,
                summary: row.sourceAnchorId
                    ? '已沉淀为知识结果，并保留正式绑定证据。'
                    : '已沉淀为知识结果，但来源绑定仍待补齐。',
                timeLabel: formatShortDate(row.bindingCreatedAt ?? row.createdAt),
            })),
        ],
        openQuestions: threadStats.openThreadCount > 0
            ? [{
                title: '还有哪些问题未被沉淀？',
                body: `当前还有 ${threadStats.openThreadCount} 条问题单未关闭，需要继续回到草稿与讨论上下文。`,
            }]
            : outputs.length === 0
                ? [{
                    title: '何时形成第一条稳定输出？',
                    body: '当前还没有结晶结果，需要继续推进草稿审阅与结晶。',
                }]
                : [{
                    title: '哪些分支值得继续扩展？',
                    body: '当前已有稳定沉淀，下一步可结合引用关系和问题单继续扩展分支。',
                }],
        generatedAt,
        generatedBy: normalizeEffectiveGeneratedBy({
            forceGenerate: Boolean(input.forceGenerate),
            usedLLM: false,
        }),
        generationMetadata: projectionMetadata,
    };

    if (!shouldUseLLM) {
        return projectionSnapshot;
    }

    const llmOverlay = await buildCircleSummaryLlmOverlay({
        circleId: input.circleId,
        outputs,
        primaryDraft,
        threadStats,
        recentMessages,
    });
    if (!llmOverlay) {
        return projectionSnapshot;
    }

    const narrativeBlocks = applyLlmNarrativeToSnapshot(projectionSnapshot, llmOverlay.text);
    return {
        ...projectionSnapshot,
        issueMap: narrativeBlocks.issueMap,
        openQuestions: narrativeBlocks.openQuestions,
        generatedBy: normalizeEffectiveGeneratedBy({
            forceGenerate: Boolean(input.forceGenerate),
            usedLLM: true,
        }),
        generationMetadata: llmOverlay.metadata,
    };
}

export async function ensureLatestCircleSummarySnapshot(
    prisma: PrismaClient,
    input: EnsureLatestCircleSummarySnapshotInput,
): Promise<CircleSummarySnapshot> {
    const forceGenerate = Boolean(input.forceGenerate);
    const latest = await loadLatestCircleSummarySnapshot(prisma, input.circleId);
    const latestSourceUpdatedAt = await loadCircleSummaryLatestSourceUpdatedAt(prisma, input.circleId);

    if (latest && !forceGenerate && !isCircleSummarySnapshotStale(latest, latestSourceUpdatedAt)) {
        return latest;
    }

    const ghostConfig = loadGhostConfig();
    const circleGhostPatch = await loadCircleGhostSettingsPatch(prisma, input.circleId);
    const effectiveGhostSettings = resolveCircleGhostSettings(ghostConfig, circleGhostPatch);

    const generated = await generateCircleSummarySnapshot(prisma, {
        circleId: input.circleId,
        generatedAt: input.now,
        forceGenerate,
        useLLM: effectiveGhostSettings.summaryUseLLM,
    });

    return persistCircleSummarySnapshot(prisma, generated);
}
