import { Prisma, type PrismaClient } from '@prisma/client';

import { loadGhostConfig } from '../../ai/ghost/config';
import { loadCircleGhostSettingsPatch, resolveCircleGhostSettings } from '../../ai/ghost/circle-settings';
import { buildAiSourceDigest, type AiGenerationMetadata } from '../../ai/metadata';
import { generateAiText } from '../../ai/provider';
import { localizeQueryApiCopy } from '../../i18n/copy';
import { DEFAULT_LOCALE, type AppLocale } from '../../i18n/locale';
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
    locale?: AppLocale;
}

function formatShortDate(value: Date | null | undefined, locale: AppLocale): string {
    if (!(value instanceof Date)) return localizeQueryApiCopy('circleSummary.timeTbd', locale);
    return value.toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', {
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
    locale: AppLocale;
}): AiGenerationMetadata {
    return {
        providerMode: 'projection',
        model: 'projection',
        promptAsset: 'circle-summary-projection',
        promptVersion: 'v1',
        locale: input.locale,
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
    locale: AppLocale;
}): string {
    const useChinese = input.locale === 'zh';
    const outputLines = input.outputs.slice(0, 6).map((row, index) => (
        useChinese
            ? `${index + 1}. ${row.title} (v${row.version}, 引用 ${row.citationCount}, 草稿 ${row.sourceDraftPostId ?? '无'})`
            : `${index + 1}. ${row.title} (v${row.version}, citations ${row.citationCount}, draft ${row.sourceDraftPostId ?? 'none'})`
    ));
    const messageLines = input.recentMessages
        .slice(-8)
        .map((row) => `[${row.createdAt.toISOString()}] ${row.senderHandle || row.senderPubkey}: ${(row.payloadText || '').trim()}`);

    if (useChinese) {
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

    return [
        `A formal summary snapshot is being generated for circle ${input.circleId}.`,
        'Return exactly 4 plain English sentences, one per line, with no Markdown.',
        'Line 1: current mainline consensus.',
        'Line 2: current draft baseline or body source.',
        'Line 3: unresolved disagreements.',
        'Line 4: recommended next step.',
        `Stable output count: ${input.outputs.length}`,
        `Open issue threads: ${input.threadStats.openThreadCount}/${input.threadStats.totalThreadCount}`,
        input.primaryDraft
            ? `Primary draft: #${input.primaryDraft.draftPostId}, stable version v${input.primaryDraft.currentSnapshotVersion}`
            : 'Primary draft: no single baseline yet',
        'Stable outputs:',
        outputLines.length > 0 ? outputLines.join('\n') : 'No stable outputs yet',
        'Recent discussion:',
        messageLines.length > 0 ? messageLines.join('\n') : 'No public discussion yet',
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
    locale: AppLocale;
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
                promptVersion: 'v2',
                locale: input.locale,
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
        locale?: AppLocale;
    },
): Promise<CircleSummarySnapshotPersistenceInput> {
    const generatedAt = input.generatedAt ?? new Date();
    const locale = input.locale ?? DEFAULT_LOCALE;
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
        locale,
    });

    const projectionSnapshot: CircleSummarySnapshotPersistenceInput = {
        circleId: input.circleId,
        issueMap: [
            {
                title: localizeQueryApiCopy('circleSummary.issueMap.primaryTitle', locale),
                body: primaryOutput
                    ? localizeQueryApiCopy('circleSummary.issueMap.primaryBodyWithOutput', locale, {
                        title: primaryOutput.title,
                    })
                    : localizeQueryApiCopy('circleSummary.issueMap.primaryBodyEmpty', locale),
                emphasis: 'primary',
            },
            {
                title: localizeQueryApiCopy('circleSummary.issueMap.draftTitle', locale),
                body: primaryDraft
                    ? localizeQueryApiCopy('circleSummary.issueMap.draftBodyWithDraft', locale, {
                        draftPostId: primaryDraft.draftPostId,
                        version: primaryDraft.currentSnapshotVersion,
                    })
                    : localizeQueryApiCopy('circleSummary.issueMap.draftBodyEmpty', locale),
                emphasis: 'secondary',
            },
            {
                title: localizeQueryApiCopy('circleSummary.issueMap.conflictTitle', locale),
                body: threadStats.openThreadCount > 0
                    ? localizeQueryApiCopy('circleSummary.issueMap.conflictBodyOpenThreads', locale, {
                        count: threadStats.openThreadCount,
                    })
                    : localizeQueryApiCopy('circleSummary.issueMap.conflictBodyClosed', locale),
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
            routeLabel: index === 0
                ? localizeQueryApiCopy('circleSummary.branch.primaryRoute', locale)
                : localizeQueryApiCopy('circleSummary.branch.parallelRoute', locale, { index: index + 1 }),
            sourceDraftPostId: row.sourceDraftPostId,
            sourceBindingKind: row.sourceAnchorId ? 'snapshot' : 'unbound',
            citationSummary: localizeQueryApiCopy('circleSummary.branch.citationSummary', locale, {
                citations: row.citationCount,
                outbound: row.outboundReferenceCount,
                inbound: row.inboundReferenceCount,
            }),
            citationCount: row.citationCount,
            contributorsCount: row.contributorsCount,
            outboundReferenceCount: row.outboundReferenceCount,
            inboundReferenceCount: row.inboundReferenceCount,
            createdAt: row.createdAt.toISOString(),
            sourceAnchorId: row.sourceAnchorId,
            sourceSummaryHash: row.sourceSummaryHash,
            sourceMessagesDigest: row.sourceMessagesDigest,
            createdAtLabel: formatShortDate(row.createdAt, locale),
        })),
        factExplanationEmotionBreakdown: {
            facts: [
                { label: localizeQueryApiCopy('circleSummary.breakdown.factDiscussions', locale), value: factCount },
                { label: localizeQueryApiCopy('circleSummary.breakdown.crystallizedOutputs', locale), value: outputs.length },
                { label: localizeQueryApiCopy('circleSummary.breakdown.publicIssues', locale), value: threadStats.totalThreadCount },
            ],
            explanations: [
                {
                    label: localizeQueryApiCopy('circleSummary.breakdown.explanationDiscussions', locale),
                    body: explanationCount > 0
                        ? localizeQueryApiCopy('circleSummary.breakdown.explanationBodyWithCount', locale, {
                            count: explanationCount,
                        })
                        : primaryOutput
                            ? localizeQueryApiCopy('circleSummary.breakdown.explanationBodyWithOutput', locale, {
                                title: primaryOutput.title,
                            })
                            : localizeQueryApiCopy('circleSummary.breakdown.explanationBodyEmpty', locale),
                },
            ],
            emotions: [
                {
                    label: localizeQueryApiCopy('circleSummary.breakdown.overallMood', locale),
                    value: emotionCount > 0
                        ? localizeQueryApiCopy('circleSummary.breakdown.moodWithEmotions', locale, {
                            count: emotionCount,
                        })
                        : threadStats.openThreadCount > 0
                            ? localizeQueryApiCopy('circleSummary.breakdown.moodAligning', locale)
                            : localizeQueryApiCopy('circleSummary.breakdown.moodConverging', locale),
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
                ? [
                    localizeQueryApiCopy('circleSummary.conflict.openThreadsNote', locale, {
                        count: threadStats.openThreadCount,
                    }),
                    emotionCount > 0
                        ? localizeQueryApiCopy('circleSummary.conflict.emotionNote', locale, { count: emotionCount })
                        : '',
                ]
                    .filter(Boolean)
                : [emotionCount > 0
                    ? localizeQueryApiCopy('circleSummary.conflict.emotionNote', locale, { count: emotionCount })
                    : localizeQueryApiCopy('circleSummary.conflict.noOpenThreadsNote', locale)],
        },
        sedimentationTimeline: [
            ...(primaryDraft
                ? [{
                    key: `draft-${primaryDraft.draftPostId}-v${primaryDraft.currentSnapshotVersion}`,
                    title: localizeQueryApiCopy('circleSummary.timeline.draftBaselineTitle', locale, {
                        version: primaryDraft.currentSnapshotVersion,
                    }),
                    summary: localizeQueryApiCopy('circleSummary.timeline.draftBaselineSummary', locale, {
                        draftPostId: primaryDraft.draftPostId,
                    }),
                    timeLabel: formatShortDate(primaryDraft.updatedAt, locale),
                }]
                : []),
            ...outputs.slice(0, 5).map((row) => ({
                key: row.knowledgeId,
                title: row.title,
                summary: row.sourceAnchorId
                    ? localizeQueryApiCopy('circleSummary.timeline.outputWithEvidence', locale)
                    : localizeQueryApiCopy('circleSummary.timeline.outputMissingEvidence', locale),
                timeLabel: formatShortDate(row.bindingCreatedAt ?? row.createdAt, locale),
            })),
        ],
        openQuestions: threadStats.openThreadCount > 0
            ? [{
                title: localizeQueryApiCopy('circleSummary.openQuestions.unsettledTitle', locale),
                body: localizeQueryApiCopy('circleSummary.openQuestions.unsettledBody', locale, {
                    count: threadStats.openThreadCount,
                }),
            }]
            : outputs.length === 0
                ? [{
                    title: localizeQueryApiCopy('circleSummary.openQuestions.firstOutputTitle', locale),
                    body: localizeQueryApiCopy('circleSummary.openQuestions.firstOutputBody', locale),
                }]
                : [{
                    title: localizeQueryApiCopy('circleSummary.openQuestions.expandBranchesTitle', locale),
                    body: localizeQueryApiCopy('circleSummary.openQuestions.expandBranchesBody', locale),
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
        locale,
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
        locale: input.locale,
    });

    return persistCircleSummarySnapshot(prisma, generated);
}
