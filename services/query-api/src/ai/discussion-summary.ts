import { generateAiText } from './provider';
import { buildAiSourceDigest, type AiGenerationMetadata } from './metadata';
import { getPromptMetadata, getPromptSchema, getSystemPrompt } from './prompts/registry';
import { localizeQueryApiCopy } from '../i18n/copy';

export interface DiscussionSummaryMessage {
    senderHandle: string | null;
    senderPubkey: string;
    text: string;
    createdAt: Date;
    relevanceScore?: number | null;
    focusScore?: number | null;
    semanticFacets?: string[] | null;
}

export interface DiscussionSummaryInput {
    circleName?: string | null;
    circleDescription?: string | null;
    messages: DiscussionSummaryMessage[];
    useLLM?: boolean;
}

export interface DiscussionSummaryResult {
    summary: string;
    method: 'rule' | 'llm';
    generatedAt: Date;
    messageCount: number;
    generationMetadata: AiGenerationMetadata;
    fallbackDiagnostics: DiscussionSummaryFallbackDiagnostics | null;
}

export interface DiscussionSummaryFallbackDiagnostics {
    attemptedMethod: 'llm';
    reason: 'llm_output_truncated' | 'llm_output_unparseable' | 'llm_request_failed';
    rawFinishReason: string | null;
    rawResponseSnippet: string | null;
    errorMessage: string | null;
}

type SummaryLocale = 'zh' | 'en';

interface SummaryCopy {
    noContent: string;
    contextLabel: string;
    promptLead: string;
    promptMixedLanguage: string;
    promptRequirementsLabel: string;
    promptRequirements: string[];
    promptMessagesLabel: string;
    relevantLine: (validCount: number, focusedCount: number) => string;
    unresolvedLabel: string;
    coreQuestionLabel: string;
    actionLabel: string;
    latestSignalsLabel: string;
    messageSeparator: string;
    listSeparator: string;
    quote: (value: string) => string;
}

const SUMMARY_COPY: Record<SummaryLocale, SummaryCopy> = {
    zh: {
        noContent: '当前还没有可总结的讨论内容。',
        contextLabel: '圈层',
        promptLead: '请基于以下讨论记录，输出与讨论主语言一致的摘要。',
        promptMixedLanguage: '如果讨论混合多种语言，优先使用最近几条实质性消息的主语言。',
        promptRequirementsLabel: '要求：',
        promptRequirements: [
            '1) 只返回 JSON，不要 Markdown、不要编号、不要代码块。',
            '2) JSON 必须包含 summary / consensus / open_questions / next_actions / confidence。',
            '3) 各字段内容使用与讨论主语言一致的语言，只基于提供内容，不要编造。',
        ],
        promptMessagesLabel: '讨论记录：',
        relevantLine: (validCount, focusedCount) => `近 ${validCount} 条消息中，${focusedCount} 条与当前主题高度相关。`,
        unresolvedLabel: '未解决问题',
        coreQuestionLabel: '核心问题',
        actionLabel: '推进事项',
        latestSignalsLabel: '最新进展',
        messageSeparator: '：',
        listSeparator: '；',
        quote: (value) => `「${value}」`,
    },
    en: {
        noContent: 'There is no discussion content to summarize yet.',
        contextLabel: 'Circle',
        promptLead: 'Summarize the discussion below in the same language used by the discussion participants.',
        promptMixedLanguage: 'If the discussion mixes languages, prefer the dominant language used in the most recent substantive messages.',
        promptRequirementsLabel: 'Requirements:',
        promptRequirements: [
            '1) Return JSON only. No Markdown, numbering, or code fences.',
            '2) JSON must contain summary / consensus / open_questions / next_actions / confidence.',
            '3) Fill every field in the discussion language and use only the provided content.',
        ],
        promptMessagesLabel: 'Discussion log:',
        relevantLine: (validCount, focusedCount) => `Of the last ${validCount} messages, ${focusedCount} are highly relevant to the current topic.`,
        unresolvedLabel: 'Unresolved questions',
        coreQuestionLabel: 'Core questions',
        actionLabel: 'Next steps',
        latestSignalsLabel: 'Latest signals',
        messageSeparator: ': ',
        listSeparator: '; ',
        quote: (value) => `"${value}"`,
    },
};

const SUMMARY_LABEL_GROUPS = {
    consensus: ['当前共识', 'Current consensus'],
    unresolved: ['未解决问题', 'Unresolved questions', 'Open questions'],
    next: ['下一步建议', 'Next steps', 'Next actions'],
} as const;

const DISCUSSION_SUMMARY_RESPONSE_FORMAT = {
    type: 'json' as const,
    name: 'discussion_summary',
    description: 'Structured discussion summary with consensus, open questions, next actions, and confidence.',
};

const DISCUSSION_SUMMARY_LLM_MAX_OUTPUT_TOKENS = 700;

function normalizeText(input: string): string {
    return input.replace(/\s+/g, ' ').trim();
}

function normalizeMultilineText(input: string): string {
    return input
        .split('\n')
        .map((line) => normalizeText(line))
        .filter((line) => line.length > 0)
        .join('\n');
}

function clipText(input: string, maxLength: number): string {
    if (input.length <= maxLength) return input;
    return `${input.slice(0, Math.max(0, maxLength - 1))}…`;
}

function clipFallbackSnippet(input: string | null | undefined): string | null {
    const normalized = normalizeMultilineText(String(input || ''));
    if (!normalized) return null;
    return clipText(normalized, 600);
}

function listUnique<T>(items: T[]): T[] {
    return Array.from(new Set(items));
}

function shortSender(senderHandle: string | null, senderPubkey: string): string {
    if (senderHandle && senderHandle.trim()) return senderHandle.trim();
    if (senderPubkey.length <= 10) return senderPubkey;
    return `${senderPubkey.slice(0, 4)}...${senderPubkey.slice(-4)}`;
}

function countMatches(input: string, pattern: RegExp): number {
    return input.match(pattern)?.length ?? 0;
}

function detectSummaryLocale(input: DiscussionSummaryInput): SummaryLocale {
    const samples = [
        input.circleName || '',
        input.circleDescription || '',
        ...input.messages.slice(-12).map((message) => String(message.text || '')),
    ].join('\n');

    const cjkCount = countMatches(samples, /[\u3400-\u9fff]/g);
    const latinCount = countMatches(samples, /[A-Za-z]/g);
    return cjkCount >= latinCount && cjkCount > 0 ? 'zh' : 'en';
}

function buildRuleSummary(input: DiscussionSummaryInput): string {
    const locale = detectSummaryLocale(input);
    const copy = SUMMARY_COPY[locale];
    const validMessages = input.messages
        .map((msg) => ({
            ...msg,
            text: normalizeText(msg.text || ''),
        }))
        .filter((msg) => msg.text.length > 0 && msg.text !== '[消息已删除]');

    if (validMessages.length === 0) {
        return copy.noContent;
    }

    const focusedMessages = validMessages.filter((msg) => (msg.focusScore ?? msg.relevanceScore ?? 1) >= 0.35);
    const candidateMessages = focusedMessages.length >= 3 ? focusedMessages : validMessages;
    const recent = candidateMessages.slice(-8);

    const questionPatterns = [
        /[?？]/,
        /(为什么|怎么|如何|问题|报错|失败|卡住|异常|error|bug)/i,
    ];
    const actionPatterns = [
        /(修复|排查|重启|部署|测试|同步|确认|处理|优化|待办|todo|next step|next steps|follow up|follow-up|improve|simplify|ship|release)/i,
    ];

    const questionPoints = listUnique(
        recent
            .filter((msg) =>
                Boolean(msg.semanticFacets?.includes('question'))
                || questionPatterns.some((pattern) => pattern.test(msg.text)))
            .map((msg) => clipText(msg.text, 30)),
    ).slice(0, 2);
    const problemPoints = listUnique(
        recent
            .filter((msg) => Boolean(msg.semanticFacets?.includes('problem')))
            .map((msg) => clipText(msg.text, 30)),
    ).slice(0, 2);

    const actionPoints = listUnique(
        recent
            .filter((msg) => actionPatterns.some((pattern) => pattern.test(msg.text)))
            .map((msg) => clipText(msg.text, 30)),
    ).slice(0, 2);

    const latestSignals = recent
        .slice(-3)
        .map((msg) => `${shortSender(msg.senderHandle, msg.senderPubkey)}${copy.messageSeparator}${clipText(msg.text, 24)}`);

    const lines: string[] = [];
    lines.push(copy.relevantLine(validMessages.length, focusedMessages.length));
    const unresolvedPoints = listUnique([...problemPoints, ...questionPoints]).slice(0, 3);
    if (problemPoints.length > 0 && unresolvedPoints.length > 0) {
        lines.push(`${copy.unresolvedLabel}${copy.messageSeparator}${unresolvedPoints.map((item) => copy.quote(item)).join(copy.listSeparator)}`);
    } else if (questionPoints.length > 0) {
        lines.push(`${copy.coreQuestionLabel}${copy.messageSeparator}${questionPoints.map((item) => copy.quote(item)).join(copy.listSeparator)}`);
    }
    if (actionPoints.length > 0) {
        lines.push(`${copy.actionLabel}${copy.messageSeparator}${actionPoints.map((item) => copy.quote(item)).join(copy.listSeparator)}`);
    }
    if (latestSignals.length > 0) {
        lines.push(`${copy.latestSignalsLabel}${copy.messageSeparator}${latestSignals.join(copy.listSeparator)}`);
    }

    return lines.join('\n');
}

function buildSummaryPrompt(input: DiscussionSummaryInput): string {
    const locale = detectSummaryLocale(input);
    const copy = SUMMARY_COPY[locale];
    const schema = getPromptSchema('discussion-summary');
    const contextLabel = input.circleName
        ? `${input.circleName}${input.circleDescription ? `（${input.circleDescription}）` : ''}`
        : (locale === 'zh' ? '当前圈层' : 'Current circle');
    const recentMessages = input.messages.slice(-20).map((msg) => {
        const sender = shortSender(msg.senderHandle, msg.senderPubkey);
        const iso = msg.createdAt.toISOString();
        const score = typeof msg.focusScore === 'number'
            ? ` focus=${msg.focusScore.toFixed(2)}`
            : typeof msg.relevanceScore === 'number'
                ? ` relevance=${msg.relevanceScore.toFixed(2)}`
            : '';
        return `[${iso}] @${sender}${score}: ${normalizeText(msg.text || '')}`;
    });

    return [
        `${copy.contextLabel}: ${contextLabel}`,
        copy.promptLead,
        copy.promptMixedLanguage,
        copy.promptRequirementsLabel,
        ...copy.promptRequirements,
        'JSON schema:',
        schema ? JSON.stringify(schema) : '{}',
        copy.promptMessagesLabel,
        recentMessages.join('\n'),
    ].join('\n');
}

function buildDiscussionSummaryMetadata(input: {
    providerMode: string;
    model: string;
    sourceDigest: string;
}): AiGenerationMetadata {
    const prompt = getPromptMetadata('discussion-summary');
    return {
        providerMode: input.providerMode,
        model: input.model,
        promptAsset: prompt.promptAsset,
        promptVersion: prompt.promptVersion,
        sourceDigest: input.sourceDigest,
    };
}

function escapeRegExp(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripSummaryLabel(value: string, labels: readonly string[]): string {
    const pattern = labels.map((label) => escapeRegExp(label)).join('|');
    return normalizeText(value.replace(new RegExp(`^(?:${pattern})\\s*[:：]\\s*`, 'i'), ''));
}

function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => normalizeText(item))
        .filter((item) => item.length > 0);
}

function extractLabeledSummary(raw: string): string | null {
    const withoutThinkTags = raw
        .replace(/<think>/gi, ' ')
        .replace(/<\/think>/gi, ' ');
    const allLabels = [
        ...SUMMARY_LABEL_GROUPS.consensus,
        ...SUMMARY_LABEL_GROUPS.unresolved,
        ...SUMMARY_LABEL_GROUPS.next,
    ];
    const firstLabelIndex = allLabels
        .map((label) => withoutThinkTags.toLowerCase().indexOf(label.toLowerCase()))
        .filter((index) => index >= 0)
        .sort((left, right) => left - right)[0] ?? -1;
    if (firstLabelIndex < 0) return null;

    const relevant = withoutThinkTags
        .slice(firstLabelIndex)
        .replace(/```(?:json)?/gi, ' ')
        .replace(/```/g, ' ')
        .replace(/\s*((?:当前共识|Current consensus)\s*[:：])/gi, '\n$1')
        .replace(/\s*((?:未解决问题|Unresolved questions|Open questions)\s*[:：])/gi, '\n$1')
        .replace(/\s*((?:下一步建议|Next steps|Next actions)\s*[:：])/gi, '\n$1');

    const lines = relevant
        .split('\n')
        .map((line) => normalizeText(line))
        .filter((line) => allLabels.some((label) => {
            const normalizedLine = line.toLowerCase();
            const normalizedLabel = label.toLowerCase();
            return normalizedLine.startsWith(`${normalizedLabel}:`) || normalizedLine.startsWith(`${normalizedLabel}：`);
        }));

    return lines.length > 0 ? lines.join('\n') : null;
}

function tryParseDiscussionSummaryJson(raw: string): Record<string, unknown> | null {
    const candidates: string[] = [];
    const seen = new Set<string>();
    const pushCandidate = (candidate: string) => {
        const trimmed = candidate.trim();
        if (!trimmed || seen.has(trimmed)) return;
        seen.add(trimmed);
        candidates.push(trimmed);
    };

    const trimmed = raw.trim();
    pushCandidate(trimmed);

    const afterThink = trimmed.includes('</think>')
        ? trimmed.slice(trimmed.lastIndexOf('</think>') + '</think>'.length)
        : trimmed;
    pushCandidate(afterThink);

    const fencedJsonPattern = /```(?:json)?\s*([\s\S]*?)```/gi;
    for (const match of afterThink.matchAll(fencedJsonPattern)) {
        pushCandidate(match[1] || '');
    }

    const firstBrace = afterThink.indexOf('{');
    const lastBrace = afterThink.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        pushCandidate(afterThink.slice(firstBrace, lastBrace + 1));
    }

    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate) as unknown;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }
        } catch {
            // Ignore malformed candidates and continue searching.
        }
    }

    return null;
}

function buildSummaryFromStructuredJson(payload: Record<string, unknown>, locale: SummaryLocale): string | null {
    const copy = SUMMARY_COPY[locale];
    const summary = typeof payload.summary === 'string' ? payload.summary.trim() : '';
    const consensus = typeof payload.consensus === 'string'
        ? stripSummaryLabel(payload.consensus, SUMMARY_LABEL_GROUPS.consensus)
        : '';
    const openQuestions = normalizeStringArray(payload.open_questions)
        .map((item) => stripSummaryLabel(item, SUMMARY_LABEL_GROUPS.unresolved));
    const nextActions = normalizeStringArray(payload.next_actions)
        .map((item) => stripSummaryLabel(item, SUMMARY_LABEL_GROUPS.next));

    const labeledSummary = summary ? extractLabeledSummary(summary) : null;
    if (labeledSummary) {
        return labeledSummary;
    }

    const lines: string[] = [];
    if (consensus) {
        lines.push(`${SUMMARY_LABEL_GROUPS.consensus[locale === 'zh' ? 0 : 1]}${copy.messageSeparator}${consensus}`);
    }
    if (openQuestions.length > 0) {
        lines.push(`${copy.unresolvedLabel}${copy.messageSeparator}${openQuestions.join(copy.listSeparator)}`);
    }
    if (nextActions.length > 0) {
        lines.push(`${copy.actionLabel}${copy.messageSeparator}${nextActions.join(copy.listSeparator)}`);
    }
    return lines.length > 0 ? lines.join('\n') : null;
}

function normalizeDiscussionSummaryOutput(raw: string, locale: SummaryLocale): string | null {
    const structured = tryParseDiscussionSummaryJson(raw);
    const structuredSummary = structured ? buildSummaryFromStructuredJson(structured, locale) : null;
    if (structuredSummary) {
        return structuredSummary;
    }

    const labeledSummary = extractLabeledSummary(raw);
    if (labeledSummary) {
        return labeledSummary;
    }
    return null;
}

export function buildDiscussionSummarySourceDigest(input: DiscussionSummaryInput): string {
    return buildAiSourceDigest({
        circleName: input.circleName || null,
        circleDescription: input.circleDescription || null,
        messages: input.messages.map((message) => ({
            senderHandle: message.senderHandle || null,
            senderPubkey: message.senderPubkey,
            text: normalizeText(message.text || ''),
            createdAt: message.createdAt instanceof Date
                ? message.createdAt.toISOString()
                : new Date(message.createdAt).toISOString(),
            relevanceScore: typeof message.relevanceScore === 'number'
                ? Number(message.relevanceScore.toFixed(4))
                : null,
            focusScore: typeof message.focusScore === 'number'
                ? Number(message.focusScore.toFixed(4))
                : null,
            semanticFacets: Array.isArray(message.semanticFacets)
                ? message.semanticFacets
                : [],
        })),
    });
}

async function buildLLMSummary(
    input: DiscussionSummaryInput,
): Promise<{
    summary: string | null;
    metadata: AiGenerationMetadata | null;
    fallbackDiagnostics: DiscussionSummaryFallbackDiagnostics | null;
}> {
    try {
        const locale = detectSummaryLocale(input);
        const sourceDigest = buildDiscussionSummarySourceDigest(input);
        const generated = await generateAiText({
            task: 'discussion-summary',
            systemPrompt: getSystemPrompt('discussion-summary'),
            userPrompt: buildSummaryPrompt(input),
            temperature: 0.2,
            maxOutputTokens: DISCUSSION_SUMMARY_LLM_MAX_OUTPUT_TOKENS,
            responseFormat: {
                ...DISCUSSION_SUMMARY_RESPONSE_FORMAT,
                schema: getPromptSchema('discussion-summary') ?? undefined,
            },
            dataBoundary: 'public_protocol',
        });
        const normalized = normalizeDiscussionSummaryOutput(generated.text || '', locale);
        if (!normalized || normalized.length === 0) {
            return {
                summary: null,
                metadata: null,
                fallbackDiagnostics: {
                    attemptedMethod: 'llm',
                    reason: generated.rawFinishReason === 'length'
                        ? 'llm_output_truncated'
                        : 'llm_output_unparseable',
                    rawFinishReason: generated.rawFinishReason ?? null,
                    rawResponseSnippet: clipFallbackSnippet(generated.text),
                    errorMessage: null,
                },
            };
        }
        return {
            summary: normalized,
            metadata: buildDiscussionSummaryMetadata({
                providerMode: generated.providerMode,
                model: generated.model,
                sourceDigest,
            }),
            fallbackDiagnostics: null,
        };
    } catch (error) {
        return {
            summary: null,
            metadata: null,
            fallbackDiagnostics: {
                attemptedMethod: 'llm',
                reason: 'llm_request_failed',
                rawFinishReason: null,
                rawResponseSnippet: null,
                errorMessage: error instanceof Error ? error.message : String(error || ''),
            },
        };
    }
}

export async function summarizeDiscussionThread(
    input: DiscussionSummaryInput,
): Promise<DiscussionSummaryResult> {
    const validMessages = input.messages.filter((msg) => normalizeText(msg.text || '').length > 0);
    const sourceDigest = buildDiscussionSummarySourceDigest({
        ...input,
        messages: validMessages,
    });
    if (validMessages.length === 0) {
        return {
            summary: localizeQueryApiCopy('discussionSummary.noContent', 'en'),
            method: 'rule',
            generatedAt: new Date(),
            messageCount: 0,
            generationMetadata: buildDiscussionSummaryMetadata({
                providerMode: 'rule',
                model: 'rule-based',
                sourceDigest,
            }),
            fallbackDiagnostics: null,
        };
    }

    const shouldUseLLM = Boolean(input.useLLM);
    if (shouldUseLLM) {
        const llmSummary = await buildLLMSummary({
            ...input,
            messages: validMessages,
        });
        if (llmSummary?.summary && llmSummary.metadata) {
            return {
                summary: llmSummary.summary,
                method: 'llm',
                generatedAt: new Date(),
                messageCount: validMessages.length,
                generationMetadata: llmSummary.metadata,
                fallbackDiagnostics: null,
            };
        }
        return {
            summary: buildRuleSummary({
                ...input,
                messages: validMessages,
            }),
            method: 'rule',
            generatedAt: new Date(),
            messageCount: validMessages.length,
            generationMetadata: buildDiscussionSummaryMetadata({
                providerMode: 'rule',
                model: 'rule-based',
                sourceDigest,
            }),
            fallbackDiagnostics: llmSummary.fallbackDiagnostics,
        };
    }

    return {
        summary: buildRuleSummary({
            ...input,
            messages: validMessages,
        }),
        method: 'rule',
        generatedAt: new Date(),
        messageCount: validMessages.length,
        generationMetadata: buildDiscussionSummaryMetadata({
            providerMode: 'rule',
            model: 'rule-based',
            sourceDigest,
        }),
        fallbackDiagnostics: null,
    };
}
