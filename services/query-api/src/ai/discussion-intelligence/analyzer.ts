import { getPromptSchema, getSystemPrompt } from '../prompts/registry';
import { DISCUSSION_SEMANTIC_FACETS } from '../../services/discussion/analysis/types';
import { generateStructuredOutput } from './llm';
import { normalizeScore01 } from './rules';

export interface MessageAnalysisInput {
    text: string;
    circleContext?: string;
    recentContext?: string;
    useLLM?: boolean;
}

export interface MessageSemanticFacetsInput {
    text: string;
    circleContext?: string;
    recentContext?: string;
}

export interface MessageAnalysisResult {
    semanticScore: number;
    qualityScore: number;
    spamScore: number;
    confidence: number;
    isOnTopic: boolean;
    method: 'rule' | 'hybrid';
    rationale: string;
    semanticFacets?: string[] | null;
}

interface RuleSignal {
    semanticScore: number;
    qualityScore: number;
    spamScore: number;
    isOnTopic: boolean;
    rationale: string;
}

function normalizeText(input: string): string {
    return String(input || '').replace(/\s+/g, ' ').trim();
}

function tokenizeEn(input: string): string[] {
    const matches = input.toLowerCase().match(/[a-z0-9_]{3,}/g);
    if (!matches) return [];
    return Array.from(new Set(matches));
}

function extractZhKeywords(input: string): string[] {
    const matches = input.match(/[\u4e00-\u9fff]{2,}/g);
    if (!matches) return [];
    return Array.from(new Set(matches));
}

function contextMatchRatio(text: string, context: string): number {
    const textNorm = normalizeText(text).toLowerCase();
    const ctxNorm = normalizeText(context).toLowerCase();
    if (!ctxNorm) return 0.5;

    const enKeywords = tokenizeEn(ctxNorm).slice(0, 16);
    const zhKeywords = extractZhKeywords(ctxNorm).slice(0, 16);
    const keywords = [...enKeywords, ...zhKeywords];
    if (keywords.length === 0) return 0.5;

    let hit = 0;
    for (const kw of keywords) {
        if (kw && textNorm.includes(kw.toLowerCase())) {
            hit += 1;
        }
    }
    return hit / keywords.length;
}

function ruleSpamScore(text: string): number {
    const normalized = normalizeText(text).toLowerCase();
    if (!normalized) return 0.8;

    const strongPatterns = [
        /http[s]?:\/\//,
        /(airdrop|whitelist|free mint|nft sale)/,
        /(加v|vx|私聊|私信我|联系我)/,
        /(买|卖|回收|代充|博彩|返利|套利群)/,
    ];
    const weakPatterns = [
        /(优惠|折扣|推广|广告|引流)/,
        /(telegram|discord|wechat|twitter)/,
    ];

    let score = 0;
    strongPatterns.forEach((pattern) => {
        if (pattern.test(normalized)) score += 0.35;
    });
    weakPatterns.forEach((pattern) => {
        if (pattern.test(normalized)) score += 0.15;
    });

    const urlCount = (normalized.match(/http[s]?:\/\//g) || []).length;
    if (urlCount >= 2) score += 0.25;

    return Math.max(0, Math.min(1, score));
}

function ruleQualityScore(text: string): number {
    const normalized = normalizeText(text);
    if (!normalized) return 0.1;

    let score = 0.45;

    const uniqueChars = new Set(normalized.toLowerCase().split(''));
    const diversity = uniqueChars.size / Math.max(1, normalized.length);
    if (diversity > 0.18) score += 0.15;
    if (diversity < 0.08) score -= 0.2;

    const repetitiveChars = /(.)\1{5,}/.test(normalized);
    if (repetitiveChars) score -= 0.25;

    const hasSentenceSignals = /[。！？.!?]/.test(normalized);
    if (hasSentenceSignals) score += 0.1;

    if (normalized.length < 4) score -= 0.2;
    if (normalized.length > 1600) score -= 0.15;

    return Math.max(0, Math.min(1, score));
}

function ruleSemanticScore(text: string, circleContext?: string): number {
    const normalized = normalizeText(text);
    if (!normalized) return 0.05;

    const spamScore = ruleSpamScore(normalized);
    if (spamScore >= 0.75) return 0.05;

    const context = normalizeText(circleContext || '');
    const ratio = contextMatchRatio(normalized, context);

    // Semantic relevance does not reward length.
    let score = 0.15 + ratio * 0.75;
    if (/[?？]/.test(normalized)) score += 0.05;
    if (/(为什么|怎么|如何|实现|排查|修复|方案|tradeoff)/i.test(normalized)) score += 0.05;

    return Math.max(0, Math.min(1, score));
}

function buildRuleSignal(input: MessageAnalysisInput): RuleSignal {
    const semanticScore = ruleSemanticScore(input.text, input.circleContext);
    const spamScore = ruleSpamScore(input.text);
    const qualityScore = ruleQualityScore(input.text);
    const isOnTopic = semanticScore >= 0.55 && spamScore < 0.6;

    return {
        semanticScore,
        qualityScore,
        spamScore,
        isOnTopic,
        rationale: isOnTopic
            ? 'rule_signals_indicate_topic_alignment'
            : 'rule_signals_indicate_low_alignment_or_spam_risk',
    };
}

function buildRelevanceUserPrompt(input: MessageAnalysisInput, rule: RuleSignal): string {
    const schema = getPromptSchema('discussion-relevance');
    return [
        'Task: evaluate one discussion message.',
        '',
        `CircleContext: ${input.circleContext || '(none)'}`,
        `RecentContext: ${input.recentContext || '(none)'}`,
        `Message: ${normalizeText(input.text)}`,
        '',
        'RuleSignals:',
        JSON.stringify({
            semantic_score: rule.semanticScore,
            quality_score: rule.qualityScore,
            spam_score: rule.spamScore,
            is_on_topic: rule.isOnTopic,
        }),
        '',
        'If the message clearly conveys semantic facets, set semantic_facets using only: fact, explanation, emotion, question, problem, criteria, proposal, summary.',
        '',
        'Return JSON matching this schema:',
        JSON.stringify(schema),
    ].join('\n');
}

const ALLOWED_SEMANTIC_FACETS = new Set<string>(DISCUSSION_SEMANTIC_FACETS);

function normalizeSemanticFacets(value: unknown): string[] | null {
    if (!Array.isArray(value)) return null;
    return Array.from(new Set(
        value
            .map((entry) => String(entry || '').trim().toLowerCase())
            .filter((entry) => ALLOWED_SEMANTIC_FACETS.has(entry)),
    ));
}

function parseLLMRelevanceResult(raw: Record<string, unknown> | null): {
    semanticScore: number;
    qualityScore: number;
    spamScore: number;
    confidence: number;
    isOnTopic: boolean;
    rationale: string;
    semanticFacets: string[] | null;
} | null {
    if (!raw) return null;
    const semanticScore = normalizeScore01(raw.semantic_score, NaN);
    const qualityScore = normalizeScore01(raw.quality_score, NaN);
    const spamScore = normalizeScore01(raw.spam_score, NaN);
    const confidence = normalizeScore01(raw.confidence, NaN);
    const isOnTopic = Boolean(raw.is_on_topic);
    const rationale = String(raw.rationale || '').trim();
    const semanticFacets = normalizeSemanticFacets(raw.semantic_facets);

    if (
        !Number.isFinite(semanticScore)
        || !Number.isFinite(qualityScore)
        || !Number.isFinite(spamScore)
        || !Number.isFinite(confidence)
        || !rationale
    ) {
        return null;
    }

    return {
        semanticScore,
        qualityScore,
        spamScore,
        confidence,
        isOnTopic,
        rationale: rationale.slice(0, 240),
        semanticFacets,
    };
}

function buildSemanticFacetsUserPrompt(input: MessageSemanticFacetsInput): string {
    const schema = getPromptSchema('discussion-semantic-facets');
    return [
        'Task: assign semantic facets to one discussion message.',
        '',
        `CircleContext: ${input.circleContext || '(none)'}`,
        `RecentContext: ${input.recentContext || '(none)'}`,
        `Message: ${normalizeText(input.text)}`,
        '',
        'Return JSON matching this schema:',
        JSON.stringify(schema),
    ].join('\n');
}

export async function analyzeDiscussionSemanticFacets(
    input: MessageSemanticFacetsInput,
): Promise<string[] | null> {
    const raw = await generateStructuredOutput({
        modelTask: 'scoring',
        systemPrompt: getSystemPrompt('discussion-semantic-facets'),
        userPrompt: buildSemanticFacetsUserPrompt(input),
        temperature: 0.1,
        maxOutputTokens: 180,
    });
    if (!raw) return null;
    const facets = normalizeSemanticFacets(raw.semantic_facets);
    if (!facets) {
        console.warn('[discussion-intelligence] semantic facets output malformed', {
            fieldType: Array.isArray(raw.semantic_facets) ? 'array' : typeof raw.semantic_facets,
        });
    }
    return facets;
}

export async function analyzeDiscussionMessage(
    input: MessageAnalysisInput,
): Promise<MessageAnalysisResult> {
    const rule = buildRuleSignal(input);
    const shouldUseLLM = Boolean(input.useLLM);
    if (!shouldUseLLM) {
        return {
            semanticScore: rule.semanticScore,
            qualityScore: rule.qualityScore,
            spamScore: rule.spamScore,
            confidence: 0.55,
            isOnTopic: rule.isOnTopic,
            method: 'rule',
            rationale: rule.rationale,
            semanticFacets: null,
        };
    }

    const llmRaw = await generateStructuredOutput({
        modelTask: 'scoring',
        systemPrompt: getSystemPrompt('discussion-relevance'),
        userPrompt: buildRelevanceUserPrompt(input, rule),
        temperature: 0.1,
        maxOutputTokens: 300,
    });
    const llm = parseLLMRelevanceResult(llmRaw);
    if (!llm) {
        return {
            semanticScore: rule.semanticScore,
            qualityScore: rule.qualityScore,
            spamScore: rule.spamScore,
            confidence: 0.45,
            isOnTopic: rule.isOnTopic,
            method: 'rule',
            rationale: rule.rationale,
            semanticFacets: null,
        };
    }

    // Prefer semantic/spam from LLM, keep small rule anchor for stability.
    const semanticScore = Math.max(0, Math.min(1, llm.semanticScore * 0.85 + rule.semanticScore * 0.15));
    const qualityScore = Math.max(0, Math.min(1, llm.qualityScore * 0.8 + rule.qualityScore * 0.2));
    const spamScore = Math.max(0, Math.min(1, llm.spamScore * 0.8 + rule.spamScore * 0.2));
    const isOnTopic = semanticScore >= 0.55 && spamScore < 0.6 && llm.isOnTopic;

    return {
        semanticScore,
        qualityScore,
        spamScore,
        confidence: llm.confidence,
        isOnTopic,
        method: 'hybrid',
        rationale: llm.rationale,
        semanticFacets: llm.semanticFacets,
    };
}
