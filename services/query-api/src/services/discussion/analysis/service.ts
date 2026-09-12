import { Prisma, type PrismaClient } from '@prisma/client';

import { embedDiscussionText, cosineSimilarity } from '../../../ai/embedding';
import {
    analyzeDiscussionMessage,
    analyzeDiscussionSemanticFacets,
    type DiscussionSemanticJudgement,
} from '../../../ai/discussion-intelligence/analyzer';
import { hasQuestionSignal, normalizeScore01 } from '../../../ai/discussion-intelligence/rules';
import { decideFeatured } from './featured';
import { inferSemanticFacets, normalizeAuthorAnnotations } from './facets';
import type { DiscussionAnalysisResult, DiscussionFocusLabel, SemanticFacet } from './types';
import { loadDiscussionTopicProfile } from '../topicProfile';
import {
    DiscussionAnalysisProviderError,
    isProviderFailureLike,
    toDiscussionAnalysisProviderError,
} from './providerErrors';

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

function roundScoreForStorage(value: number): number {
    return Math.round(clamp01(value) * 1000) / 1000;
}

function inferFocusLabel(input: {
    score: number;
    semanticFacets: string[];
    actualMode: string;
    confirmedNoSemanticEvidence?: boolean;
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
    if (input.score >= 0.35 && !input.confirmedNoSemanticEvidence) return 'contextual';
    return 'off_topic';
}

const RECENT_DISCUSSION_CONTEXT_MAX_CHARS = 280;
const CONTEXTUAL_CONTRIBUTION_FACETS = new Set<SemanticFacet>([
    'criteria',
    'proposal',
    'explanation',
    'problem',
    'summary',
]);

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

function displaySender(senderHandle: string | null): string {
    if (senderHandle && senderHandle.trim()) return senderHandle.trim();
    return 'A member';
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
        `${displaySender(row.senderHandle)}: ${clipText(row.text, 96)}`,
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
        WITH current_message AS (
            SELECT lamport
            FROM circle_discussion_messages
            WHERE circle_id = ${input.circleId}
              AND envelope_id = ${input.envelopeId}
            LIMIT 1
        )
        SELECT
            m.payload_text AS "payloadText",
            m.sender_handle AS "senderHandle",
            m.sender_pubkey AS "senderPubkey",
            m.focus_score AS "focusScore",
            m.semantic_facets AS "semanticFacets",
            m.created_at AS "createdAt"
        FROM circle_discussion_messages AS m
        CROSS JOIN current_message
        WHERE m.circle_id = ${input.circleId}
          AND m.lamport < current_message.lamport
          AND m.subject_type IS NULL
          AND m.subject_id IS NULL
          AND m.deleted = FALSE
          AND COALESCE(m.relevance_status, 'ready') = 'ready'
          AND COALESCE(m.focus_label, 'contextual') <> 'off_topic'
        ORDER BY m.lamport DESC
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
    if (!Array.isArray(topicProfile.embedding) || topicProfile.embedding.length === 0) {
        throw new DiscussionAnalysisProviderError(
            topicProfile.embeddingErrorCode || 'discussion_topic_profile_embedding_unavailable',
            topicProfile.embeddingErrorMessage || 'discussion topic profile embedding unavailable',
        );
    }

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
    let relevanceMethod = 'embedding';
    let actualMode = 'embedding';
    let llmSemanticFacets: SemanticFacet[] | null = null;
    let wasContextualRescue = false;
    let dedicatedSemanticFacetsLoaded = false;
    let dedicatedSemanticJudgementValue: DiscussionSemanticJudgement | null = null;
    const getDedicatedSemanticJudgement = async (): Promise<DiscussionSemanticJudgement | null> => {
        if (dedicatedSemanticFacetsLoaded) return dedicatedSemanticJudgementValue;
        dedicatedSemanticFacetsLoaded = true;
        if (actualMode === 'fallback_rule') return null;
        try {
            const recentContext = await getRecentContext();
            const judgement = await analyzeDiscussionSemanticFacets({
                text: input.text,
                circleContext: topicProfile.snapshotText,
                recentContext: recentContext || undefined,
            });
            if (judgement) {
                dedicatedSemanticJudgementValue = judgement;
            }
        } catch {
            // best effort only
        }
        return dedicatedSemanticJudgementValue;
    };

    let messageEmbedding;
    try {
        messageEmbedding = await embedDiscussionText({
            text: input.text,
            purpose: 'discussion-relevance',
        });
    } catch (error) {
        const providerError = toDiscussionAnalysisProviderError(error);
        console.warn('[discussion-analysis] embedding step failed; retrying via ai job', {
            circleId: input.circleId,
            envelopeId: input.envelopeId ?? null,
            code: providerError.code,
            error: providerError.message,
        });
        throw providerError;
    }

    embeddingScore = cosineSimilarity(messageEmbedding.embedding, topicProfile.embedding);
    const semanticBase = clamp01(embeddingScore * 0.85 + semanticScore * 0.15);
    semanticScore = semanticBase;
    relevanceMethod = 'embedding';
    actualMode = 'embedding';
    decisionConfidence = Math.max(decisionConfidence, 0.62);

    const shouldUseStandardSecondPass = semanticBase >= 0.42 && semanticBase <= 0.72;
    const shouldReviewLowScoreFollowUp = semanticBase >= 0.30
        && semanticBase < 0.42
        && spamScore < 0.6
        && hasQuestionSignal(input.text);
    if (shouldUseStandardSecondPass || shouldReviewLowScoreFollowUp) {
        const recentContext = await getRecentContext();
        if (shouldUseStandardSecondPass || recentContext) {
            let secondPass;
            try {
                secondPass = await analyzeDiscussionMessage({
                    text: input.text,
                    circleContext: topicProfile.snapshotText,
                    recentContext: recentContext || undefined,
                    useLLM: true,
                });
            } catch (error) {
                if (isProviderFailureLike(error)) {
                    throw toDiscussionAnalysisProviderError(error);
                }
                throw error;
            }
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
    }

    const fallbackSemanticFacets = inferSemanticFacets({
        text: input.text,
        authorAnnotations,
    });
    const shouldReviewContextualStatement = !shouldUseStandardSecondPass
        && !shouldReviewLowScoreFollowUp
        && semanticBase >= 0.30
        && semanticBase < 0.42
        && spamScore < 0.6;
    if (shouldReviewContextualStatement) {
        const recentContext = await getRecentContext();
        if (recentContext) {
            const contextualJudgement = await getDedicatedSemanticJudgement();
            const contextualFacets = contextualJudgement?.facets ?? null;
            const rescueGateFacets = new Set<SemanticFacet>([
                ...(contextualFacets ?? []),
                ...fallbackSemanticFacets,
            ]);
            const hasContextualContribution = Array.from(rescueGateFacets).some((facet) =>
                CONTEXTUAL_CONTRIBUTION_FACETS.has(facet));
            if (hasContextualContribution) {
                let secondPass = null;
                try {
                    secondPass = await analyzeDiscussionMessage({
                        text: input.text,
                        circleContext: topicProfile.snapshotText,
                        recentContext,
                        useLLM: true,
                        reviewMode: 'contextual_followup_rescue',
                    });
                } catch (error) {
                    if (!isProviderFailureLike(error)) throw error;
                }
                if (secondPass?.method === 'hybrid' && secondPass.isOnTopic) {
                    semanticScore = clamp01(semanticBase * 0.35 + normalizeScore01(secondPass.semanticScore, semanticBase) * 0.65);
                    qualityScore = clamp01(qualityScore * 0.2 + normalizeScore01(secondPass.qualityScore, qualityScore) * 0.8);
                    spamScore = clamp01(spamScore * 0.2 + normalizeScore01(secondPass.spamScore, spamScore) * 0.8);
                    decisionConfidence = Math.max(decisionConfidence, normalizeScore01(secondPass.confidence, decisionConfidence));
                    relevanceMethod = 'embedding_llm';
                    actualMode = 'embedding_llm';
                    wasContextualRescue = true;
                    if (Array.isArray(secondPass.semanticFacets)) {
                        llmSemanticFacets = secondPass.semanticFacets as SemanticFacet[];
                    }
                }
            }
        }
    }

    const dedicatedSemanticJudgement = await getDedicatedSemanticJudgement();
    const dedicatedSemanticFacets = dedicatedSemanticJudgement?.facets ?? null;

    const semanticFacets = (dedicatedSemanticFacets && dedicatedSemanticFacets.length > 0 ? dedicatedSemanticFacets : null)
        ?? (llmSemanticFacets && llmSemanticFacets.length > 0 ? llmSemanticFacets : null)
        ?? fallbackSemanticFacets;
    const focusScore = roundScoreForStorage(semanticScore * (1 - spamScore * 0.25));
    const confirmedNoSemanticEvidence = semanticBase >= 0.35
        && semanticBase < 0.42
        && dedicatedSemanticJudgement?.contextSignal === 'none'
        && dedicatedSemanticJudgement.facets.length === 0
        && fallbackSemanticFacets.length === 0
        && !wasContextualRescue;
    const focusLabel = inferFocusLabel({
        score: focusScore,
        semanticFacets,
        actualMode,
        confirmedNoSemanticEvidence,
    });
    const featured = wasContextualRescue
        ? { isFeatured: false, featureReason: null }
        : decideFeatured({
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
        analysisVersion: 'v4_evidence_gated_focus',
        topicProfileVersion: topicProfile.topicProfileVersion,
        focusScore,
        focusLabel,
        semanticFacets,
        isFeatured: featured.isFeatured,
        featureReason: featured.featureReason,
        analysisCompletedAt: new Date(),
        analysisErrorCode: null,
        analysisErrorMessage: null,
        authorAnnotations,
    };
}
