import type { PlazaMessage } from '@/lib/circle/types';
import type { PlazaAnchoredInteractionType } from './types.ts';

export type InteractionSuggestionKind =
    | 'signup'
    | 'poll'
    | 'challenge'
    | 'none';

export type ActiveInteractionSuggestionKind = Extract<
    PlazaAnchoredInteractionType,
    'signup' | 'poll' | 'challenge'
>;

export type InteractionSuggestionReasonCode =
    | 'needs_participants'
    | 'needs_decision'
    | 'needs_verification'
    | 'low_actionability'
    | 'unclear';

export interface InteractionSuggestionJudgeInput {
    circleId: number;
    message: {
        id: number;
        envelopeId: string;
        text: string;
        createdAt: string | null;
        clientTimestamp: string | null;
        semanticFacets: string[];
        authorAnnotations: string[];
        focusScore: number | null;
        relevanceScore: number | null;
        focusLabel: 'focused' | 'contextual' | 'off_topic' | null;
        usefulCount: number;
        replyCount: number;
    };
}

export interface InteractionSuggestionDecision {
    shouldSuggest: boolean;
    suggestedType: InteractionSuggestionKind;
    importanceScore: number;
    actionabilityScore: number;
    discussionAdvancementScore: number;
    confidence: number;
    reasonCode: InteractionSuggestionReasonCode;
    shortReason: string;
}

export interface AnchoredInteractionSuggestion {
    messageId: number;
    envelopeId: string;
    suggestedInteractionType: ActiveInteractionSuggestionKind;
    reason: string;
    reasonCode: InteractionSuggestionReasonCode;
    shortReason: string;
    sourceSummary: string;
    importanceScore: number;
    actionabilityScore: number;
    discussionAdvancementScore: number;
    confidence: number;
}

export interface AnchoredInteractionSuggestionBuildOptions {
    circleId?: number;
    maxSuggestions?: number;
    viewerKey?: string | null;
    dismissedSuggestionKeys?: ReadonlySet<string>;
    convertedEnvelopeKeys?: ReadonlySet<string>;
    decisionOverridesByEnvelopeId?: ReadonlyMap<string, InteractionSuggestionDecision>;
}

export const MIN_ACTIONABILITY_SCORE = 0.5;
export const MIN_DISCUSSION_ADVANCEMENT_SCORE = 0.4;
export const MIN_CONFIDENCE = 0.45;
export const MAX_ACTIVE_SUGGESTIONS = 2;
export const MAX_AI_DECISION_CANDIDATES = 24;

const ACTIVE_INTERACTION_SUGGESTION_TYPES = new Set<InteractionSuggestionKind>([
    'signup',
    'poll',
    'challenge',
]);

const suggestionSourceMessageKinds = new Set(['plain', 'root']);

export function createAnchoredInteractionSuggestionDismissedKey(input: {
    viewerKey: string;
    circleId: number | string;
    envelopeId: string;
    suggestedInteractionType: ActiveInteractionSuggestionKind;
}): string {
    return [
        'anchored-interaction-suggestion-dismissed',
        input.viewerKey,
        input.circleId,
        input.envelopeId,
        input.suggestedInteractionType,
    ].join(':');
}

export function createAnchoredInteractionSuggestionConvertedKey(input: {
    viewerKey: string;
    circleId: number | string;
    envelopeId: string;
}): string {
    return [
        'anchored-interaction-suggestion-converted',
        input.viewerKey,
        input.circleId,
        input.envelopeId,
    ].join(':');
}

export function buildAnchoredInteractionSuggestions(
    messages: PlazaMessage[],
    options: AnchoredInteractionSuggestionBuildOptions = {},
): AnchoredInteractionSuggestion[] {
    const maxSuggestions = Math.min(
        Math.max(options.maxSuggestions ?? MAX_ACTIVE_SUGGESTIONS, 1),
        MAX_ACTIVE_SUGGESTIONS,
    );
    const circleId = options.circleId ?? 0;
    const viewerKey = options.viewerKey || null;
    const replyCountByEnvelopeId = buildReplyCountByEnvelopeId(messages);

    return messages
        .map((message) => createCandidate(message, circleId, replyCountByEnvelopeId))
        .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
        .filter(({ message }) => {
            if (message.anchoredInteractions?.length) return false;
            if (!viewerKey) return true;
            return !options.convertedEnvelopeKeys?.has(createAnchoredInteractionSuggestionConvertedKey({
                viewerKey,
                circleId,
                envelopeId: message.envelopeId!,
            }));
        })
        .map(({ message, judgeInput }) => ({
            message,
            judgeInput,
            decision: resolveSuggestionDecision(judgeInput, options.decisionOverridesByEnvelopeId),
        }))
        .filter((entry): entry is {
            message: PlazaMessage;
            judgeInput: InteractionSuggestionJudgeInput;
            decision: InteractionSuggestionDecision;
        } => entry.decision !== null && isActiveDecision(entry.decision))
        .map(({ message, judgeInput, decision }) => ({
            message,
            judgeInput,
            decision,
            suggestion: createSuggestion(message, judgeInput, decision),
        }))
        .filter(({ suggestion }) => {
            if (!viewerKey) return true;
            return !options.dismissedSuggestionKeys?.has(createAnchoredInteractionSuggestionDismissedKey({
                viewerKey,
                circleId,
                envelopeId: suggestion.envelopeId,
                suggestedInteractionType: suggestion.suggestedInteractionType,
            }));
        })
        .sort((left, right) => compareSuggestions(left, right))
        .slice(0, maxSuggestions)
        .map(({ suggestion }) => suggestion);
}

export function selectAnchoredInteractionSuggestionCandidateEnvelopeIds(
    messages: PlazaMessage[],
    options: Pick<AnchoredInteractionSuggestionBuildOptions, 'circleId' | 'viewerKey' | 'convertedEnvelopeKeys'> & {
        maxCandidates?: number;
    } = {},
): string[] {
    const maxCandidates = Math.min(
        Math.max(Math.trunc(options.maxCandidates ?? MAX_AI_DECISION_CANDIDATES), 1),
        MAX_AI_DECISION_CANDIDATES,
    );
    const circleId = options.circleId ?? 0;
    const viewerKey = options.viewerKey || null;
    const replyCountByEnvelopeId = buildReplyCountByEnvelopeId(messages);

    return messages
        .map((message) => createCandidate(message, circleId, replyCountByEnvelopeId))
        .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
        .filter(({ message }) => {
            if (message.anchoredInteractions?.length) return false;
            if (!viewerKey) return true;
            return !options.convertedEnvelopeKeys?.has(createAnchoredInteractionSuggestionConvertedKey({
                viewerKey,
                circleId,
                envelopeId: message.envelopeId!,
            }));
        })
        .map(({ judgeInput }) => judgeInput.message.envelopeId)
        .slice(0, maxCandidates);
}

function resolveSuggestionDecision(
    judgeInput: InteractionSuggestionJudgeInput,
    overrides: ReadonlyMap<string, InteractionSuggestionDecision> | undefined,
): InteractionSuggestionDecision | null {
    const override = overrides?.get(judgeInput.message.envelopeId);
    return override ?? null;
}

function createCandidate(
    message: PlazaMessage,
    circleId: number,
    replyCountByEnvelopeId: ReadonlyMap<string, number>,
): { message: PlazaMessage; judgeInput: InteractionSuggestionJudgeInput } | null {
    if (!message.envelopeId) return null;
    if (message.deleted || message.ephemeral) return null;
    if (message.focusLabel === 'off_topic') return null;
    const messageKind = typeof message.messageKind === 'string' && message.messageKind.trim()
        ? message.messageKind.trim().toLowerCase()
        : 'plain';
    if (!suggestionSourceMessageKinds.has(messageKind)) return null;

    return {
        message,
        judgeInput: {
            circleId,
            message: {
                id: message.id,
                envelopeId: message.envelopeId,
                text: message.text,
                createdAt: message.createdAt ?? null,
                clientTimestamp: message.clientTimestamp ?? null,
                semanticFacets: message.semanticFacets || [],
                authorAnnotations: message.authorAnnotations || [],
                focusScore: typeof message.focusScore === 'number' ? message.focusScore : null,
                relevanceScore: typeof message.relevanceScore === 'number' ? message.relevanceScore : null,
                focusLabel: message.focusLabel ?? null,
                usefulCount: Math.max(0, Math.trunc(message.usefulCount || 0)),
                replyCount: replyCountByEnvelopeId.get(message.envelopeId) || 0,
            },
        },
    };
}

function buildReplyCountByEnvelopeId(messages: PlazaMessage[]): Map<string, number> {
    const replyCountByEnvelopeId = new Map<string, number>();
    for (const message of messages) {
        if (message.subjectType === 'discussion_message' && typeof message.subjectId === 'string' && message.subjectId) {
            replyCountByEnvelopeId.set(message.subjectId, (replyCountByEnvelopeId.get(message.subjectId) || 0) + 1);
        }
    }
    return replyCountByEnvelopeId;
}

function createSuggestion(
    message: PlazaMessage,
    judgeInput: InteractionSuggestionJudgeInput,
    decision: InteractionSuggestionDecision,
): AnchoredInteractionSuggestion {
    return {
        messageId: message.id,
        envelopeId: judgeInput.message.envelopeId,
        suggestedInteractionType: decision.suggestedType as ActiveInteractionSuggestionKind,
        reason: decision.reasonCode,
        reasonCode: decision.reasonCode,
        shortReason: decision.shortReason,
        sourceSummary: createSourceSummary(judgeInput.message.text),
        importanceScore: decision.importanceScore,
        actionabilityScore: decision.actionabilityScore,
        discussionAdvancementScore: decision.discussionAdvancementScore,
        confidence: decision.confidence,
    };
}

function isActiveDecision(decision: InteractionSuggestionDecision): boolean {
    return decision.shouldSuggest
        && ACTIVE_INTERACTION_SUGGESTION_TYPES.has(decision.suggestedType)
        && decision.actionabilityScore >= MIN_ACTIONABILITY_SCORE
        && decision.discussionAdvancementScore >= MIN_DISCUSSION_ADVANCEMENT_SCORE
        && decision.confidence >= MIN_CONFIDENCE;
}

function compareSuggestions(
    left: { judgeInput: InteractionSuggestionJudgeInput; suggestion: AnchoredInteractionSuggestion },
    right: { judgeInput: InteractionSuggestionJudgeInput; suggestion: AnchoredInteractionSuggestion },
): number {
    return compareNumbers(right.suggestion.importanceScore, left.suggestion.importanceScore)
        || compareNumbers(right.suggestion.discussionAdvancementScore, left.suggestion.discussionAdvancementScore)
        || compareNumbers(right.suggestion.actionabilityScore, left.suggestion.actionabilityScore)
        || compareNumbers(right.suggestion.confidence, left.suggestion.confidence)
        || compareNumbers(getMessageTimestamp(right.judgeInput.message), getMessageTimestamp(left.judgeInput.message))
        || compareNumbers(right.judgeInput.message.id, left.judgeInput.message.id);
}

function getMessageTimestamp(message: InteractionSuggestionJudgeInput['message']): number {
    const createdAt = parseTime(message.createdAt);
    if (createdAt !== null) return createdAt;
    const clientTimestamp = parseTime(message.clientTimestamp);
    if (clientTimestamp !== null) return clientTimestamp;
    return message.id;
}

function parseTime(value: string | null): number | null {
    if (!value) return null;
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : null;
}

function compareNumbers(left: number, right: number): number {
    if (left === right) return 0;
    return left > right ? 1 : -1;
}

function createSourceSummary(text: string): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    return normalized.length > 80 ? `${normalized.slice(0, 78)}...` : normalized;
}
