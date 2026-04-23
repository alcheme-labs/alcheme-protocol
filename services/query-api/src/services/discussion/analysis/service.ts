import { Prisma, type PrismaClient } from '@prisma/client';

import { embedDiscussionText, cosineSimilarity } from '../../../ai/embedding';
import {
    analyzeDiscussionMessage,
    analyzeDiscussionSemanticFacets,
} from '../../../ai/discussion-intelligence/analyzer';
import { normalizeScore01 } from '../../../ai/discussion-intelligence/rules';
import { decideFeatured } from './featured';
import { inferSemanticFacets, normalizeAuthorAnnotations } from './facets';
import type { DiscussionAnalysisResult, DiscussionFocusLabel, SemanticFacet } from './types';
import { loadDiscussionTopicProfile } from '../topicProfile';

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

function classifyEmbeddingFallbackError(error: unknown): {
    analysisErrorCode: string | null;
    analysisErrorMessage: string | null;
} {
    const message = error instanceof Error ? error.message : String(error || '');
    const normalized = message.trim();
    const code = typeof (error as { code?: unknown })?.code === 'string'
        ? (error as { code: string }).code
        : null;

    if (code === 'provider_rate_limited' || /\b(rate limit|rpm limit|too many requests)\b/i.test(normalized)) {
        return {
            analysisErrorCode: 'discussion_provider_rate_limited',
            analysisErrorMessage: normalized.slice(0, 512) || 'provider_rate_limited',
        };
    }

    if (code === 'provider_timeout' || /\b(timeout|timed out)\b/i.test(normalized)) {
        return {
            analysisErrorCode: 'discussion_provider_timeout',
            analysisErrorMessage: normalized.slice(0, 512) || 'provider_timeout',
        };
    }

    return {
        analysisErrorCode: null,
        analysisErrorMessage: null,
    };
}

function inferFocusLabel(input: {
    score: number;
    semanticFacets: string[];
    actualMode: string;
}): DiscussionFocusLabel {
    if (input.score >= 0.62) return 'focused';
    const strongSemanticFacetCount = new Set(
        input.semanticFacets.filter((facet) => facet === 'question' || facet === 'proposal' || facet === 'explanation'),
    ).size;
    if (
        input.actualMode !== 'fallback_rule'
        && input.score >= 0.5
        && strongSemanticFacetCount >= 2
    ) {
        return 'focused';
    }
    if (input.score >= 0.35) return 'contextual';
    return 'off_topic';
}

const RECENT_DISCUSSION_CONTEXT_MAX_CHARS = 280;

interface RecentDiscussionContextRow {
    payloadText: string;
    senderHandle: string | null;
    senderPubkey: string;
    focusScore: number | null;
    semanticFacets: unknown;
    createdAt: Date;
}

function normalizeText(input: string): string {
    return String(input || '').replace(/\s+/g, ' ').trim();
}

function clipText(input: string, maxLength: number): string {
    if (input.length <= maxLength) return input;
    return `${input.slice(0, Math.max(0, maxLength - 1))}…`;
}

function toFacetArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
}

function shortSender(senderHandle: string | null, senderPubkey: string): string {
    if (senderHandle && senderHandle.trim()) return senderHandle.trim();
    if (senderPubkey.length <= 10) return senderPubkey;
    return `${senderPubkey.slice(0, 4)}...${senderPubkey.slice(-4)}`;
}

function buildRecentDiscussionContext(rows: RecentDiscussionContextRow[]): string | null {
    const normalizedRows = rows
        .map((row) => ({
            ...row,
            text: normalizeText(row.payloadText),
            facets: toFacetArray(row.semanticFacets),
        }))
        .filter((row) => row.text.length > 0)
        .slice(-8);
    if (normalizedRows.length === 0) return null;

    const rawLines = normalizedRows.map((row) =>
        `${shortSender(row.senderHandle, row.senderPubkey)}: ${clipText(row.text, 96)}`,
    );
    const rawBlock = rawLines.join('\n');
    if (rawBlock.length <= RECENT_DISCUSSION_CONTEXT_MAX_CHARS) {
        return rawBlock;
    }

    const questionLines = normalizedRows
        .filter((row) => row.facets.includes('question'))
        .map((row) => clipText(row.text, 34))
        .slice(0, 2);
    const problemLines = normalizedRows
        .filter((row) => row.facets.includes('problem'))
        .map((row) => clipText(row.text, 34))
        .slice(0, 2);
    const criteriaLines = normalizedRows
        .filter((row) => row.facets.includes('criteria'))
        .map((row) => clipText(row.text, 34))
        .slice(0, 2);
    const proposalLines = normalizedRows
        .filter((row) => row.facets.includes('proposal'))
        .map((row) => clipText(row.text, 34))
        .slice(0, 2);
    const emotionLines = normalizedRows
        .filter((row) => row.facets.includes('emotion'))
        .map((row) => clipText(row.text, 28))
        .slice(0, 1);

    const summaryLines: string[] = ['Recent discussion summary:'];
    if (questionLines.length > 0) {
        summaryLines.push(`- Key questions: ${questionLines.join('; ')}`);
    }
    if (problemLines.length > 0) {
        summaryLines.push(`- Unresolved problems: ${problemLines.join('; ')}`);
    }
    if (criteriaLines.length > 0) {
        summaryLines.push(`- Decision criteria: ${criteriaLines.join('; ')}`);
    }
    if (proposalLines.length > 0) {
        summaryLines.push(`- Candidate proposals: ${proposalLines.join('; ')}`);
    }
    if (emotionLines.length > 0) {
        summaryLines.push(`- Emotional signals: ${emotionLines.join('; ')}`);
    }
    summaryLines.push(`- Recent messages: ${rawLines.slice(-2).join('; ')}`);
    return summaryLines.join('\n');
}

async function loadRecentDiscussionContext(input: {
    prisma: PrismaClient;
    circleId: number;
    envelopeId?: string;
}): Promise<string | null> {
    if (!input.envelopeId) return null;
    const rows = await input.prisma.$queryRaw<RecentDiscussionContextRow[]>(Prisma.sql`
        SELECT
            payload_text AS "payloadText",
            sender_handle AS "senderHandle",
            sender_pubkey AS "senderPubkey",
            focus_score AS "focusScore",
            semantic_facets AS "semanticFacets",
            created_at AS "createdAt"
        FROM circle_discussion_messages
        WHERE circle_id = ${input.circleId}
          AND envelope_id <> ${input.envelopeId}
          AND subject_type IS NULL
          AND subject_id IS NULL
          AND deleted = FALSE
          AND COALESCE(relevance_status, 'ready') = 'ready'
        ORDER BY lamport DESC
        LIMIT 8
    `);
    return buildRecentDiscussionContext(rows.slice().reverse());
}

export async function analyzeDiscussionMessageCanonical(input: {
    prisma: PrismaClient;
    circleId: number;
    envelopeId?: string;
    text: string;
    authorAnnotations?: unknown;
}): Promise<DiscussionAnalysisResult> {
    const authorAnnotations = normalizeAuthorAnnotations(input.authorAnnotations);
    const topicProfile = await loadDiscussionTopicProfile(input.prisma, input.circleId);
    let recentContextLoaded = false;
    let recentContextValue: string | null = null;
    const getRecentContext = async (): Promise<string | null> => {
        if (recentContextLoaded) return recentContextValue;
        recentContextLoaded = true;
        recentContextValue = await loadRecentDiscussionContext({
            prisma: input.prisma,
            circleId: input.circleId,
            envelopeId: input.envelopeId,
        });
        return recentContextValue;
    };
    const rule = await analyzeDiscussionMessage({
        text: input.text,
        circleContext: topicProfile.snapshotText,
        useLLM: false,
    });

    let semanticScore = normalizeScore01(rule.semanticScore, 0);
    let embeddingScore: number | null = null;
    let qualityScore = normalizeScore01(rule.qualityScore, 0.5);
    let spamScore = normalizeScore01(rule.spamScore, 0);
    let decisionConfidence = normalizeScore01(rule.confidence, 0.55);
    let relevanceMethod = 'fallback_rule';
    let actualMode = 'fallback_rule';
    let analysisErrorCode: string | null = null;
    let analysisErrorMessage: string | null = null;
    let llmSemanticFacets: SemanticFacet[] | null = null;

    if (Array.isArray(topicProfile.embedding) && topicProfile.embedding.length > 0) {
        try {
            const messageEmbedding = await embedDiscussionText({
                text: input.text,
                purpose: 'discussion-relevance',
            });
            embeddingScore = cosineSimilarity(messageEmbedding.embedding, topicProfile.embedding);
            const semanticBase = clamp01(embeddingScore * 0.85 + semanticScore * 0.15);
            semanticScore = semanticBase;
            relevanceMethod = 'embedding';
            actualMode = 'embedding';
            decisionConfidence = Math.max(decisionConfidence, 0.62);

            const shouldUseSecondPass = semanticBase >= 0.42 && semanticBase <= 0.72;
            if (shouldUseSecondPass) {
                const recentContext = await getRecentContext();
                const secondPass = await analyzeDiscussionMessage({
                    text: input.text,
                    circleContext: topicProfile.snapshotText,
                    recentContext: recentContext || undefined,
                    useLLM: true,
                });
                if (secondPass.method === 'hybrid') {
                    semanticScore = clamp01(semanticBase * 0.35 + normalizeScore01(secondPass.semanticScore, semanticBase) * 0.65);
                    qualityScore = clamp01(qualityScore * 0.2 + normalizeScore01(secondPass.qualityScore, qualityScore) * 0.8);
                    spamScore = clamp01(spamScore * 0.2 + normalizeScore01(secondPass.spamScore, spamScore) * 0.8);
                    decisionConfidence = Math.max(decisionConfidence, normalizeScore01(secondPass.confidence, decisionConfidence));
                    relevanceMethod = 'embedding_llm';
                    actualMode = 'embedding_llm';
                    if (Array.isArray(secondPass.semanticFacets)) {
                        llmSemanticFacets = secondPass.semanticFacets as SemanticFacet[];
                    }
                }
            }
        } catch (error) {
            embeddingScore = null;
            const errorMessage = error instanceof Error ? error.message : String(error);
            const classified = classifyEmbeddingFallbackError(error);
            analysisErrorCode = classified.analysisErrorCode;
            analysisErrorMessage = classified.analysisErrorMessage;
            console.warn('[discussion-analysis] embedding step failed; falling back to rule', {
                circleId: input.circleId,
                envelopeId: input.envelopeId ?? null,
                error: errorMessage,
            });
        }
    }

    let dedicatedSemanticFacets: SemanticFacet[] | null = null;
    if (actualMode !== 'fallback_rule') {
        try {
            const recentContext = await getRecentContext();
            const facets = await analyzeDiscussionSemanticFacets({
                text: input.text,
                circleContext: topicProfile.snapshotText,
                recentContext: recentContext || undefined,
            });
            if (Array.isArray(facets)) {
                dedicatedSemanticFacets = facets as SemanticFacet[];
            }
        } catch {
            // best effort only
        }
    }

    const fallbackSemanticFacets = inferSemanticFacets({
        text: input.text,
        authorAnnotations,
    });
    const semanticFacets = dedicatedSemanticFacets ?? llmSemanticFacets ?? fallbackSemanticFacets;
    const focusScore = clamp01(semanticScore * (1 - spamScore * 0.25));
    const focusLabel = inferFocusLabel({
        score: focusScore,
        semanticFacets,
        actualMode,
    });
    const featured = decideFeatured({
        semanticScore,
        qualityScore,
        spamScore,
        focusLabel,
        actualMode,
    });

    return {
        relevanceStatus: 'ready',
        semanticScore,
        embeddingScore,
        qualityScore,
        spamScore,
        decisionConfidence,
        relevanceMethod,
        actualMode,
        analysisVersion: 'v2_embedding_first',
        topicProfileVersion: topicProfile.topicProfileVersion,
        focusScore,
        focusLabel,
        semanticFacets,
        isFeatured: featured.isFeatured,
        featureReason: featured.featureReason,
        analysisCompletedAt: new Date(),
        analysisErrorCode,
        analysisErrorMessage,
        authorAnnotations,
    };
}
