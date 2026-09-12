import type {
    AnchoredSuggestionCandidateSnapshot,
    AnchoredSuggestionDecision,
    AnchoredSuggestionReasonCode,
} from './types';

const KIND_SET = new Set(['signup', 'poll', 'challenge', 'none']);
const REASON_SET = new Set<AnchoredSuggestionReasonCode>([
    'needs_participants',
    'needs_decision',
    'needs_verification',
    'low_actionability',
    'unclear',
]);

export function parseAnchoredSuggestionModelOutput(input: {
    rawText: unknown;
    candidates: AnchoredSuggestionCandidateSnapshot[];
}): AnchoredSuggestionDecision[] {
    const parsed = parseJsonObject(input.rawText);
    const allowedEnvelopeIds = new Set(input.candidates.map((candidate) => candidate.envelopeId));
    const candidatesByEnvelopeId = new Map(input.candidates.map((candidate) => [candidate.envelopeId, candidate]));
    const rawDecisions = normalizeRawDecisions(parsed, allowedEnvelopeIds);
    if (!rawDecisions) throw new Error('invalid_model_output');

    const decisions: AnchoredSuggestionDecision[] = [];
    const seenEnvelopeIds = new Set<string>();
    for (const raw of rawDecisions) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            throw new Error('invalid_model_output');
        }
        const record = raw as Record<string, unknown>;
        const envelopeId = normalizeString(record.envelopeId);
        if (!allowedEnvelopeIds.has(envelopeId)) {
            throw new Error('invalid_model_output');
        }
        if (seenEnvelopeIds.has(envelopeId)) {
            throw new Error('invalid_model_output');
        }
        seenEnvelopeIds.add(envelopeId);
        const candidate = candidatesByEnvelopeId.get(envelopeId);
        if (!candidate) {
            throw new Error('invalid_model_output');
        }
        const suggestedType = normalizeString(record.suggestedType);
        if (!KIND_SET.has(suggestedType)) {
            throw new Error('invalid_model_output');
        }
        const fallback = createDefaultDecisionForSuggestedType(candidate, suggestedType as AnchoredSuggestionDecision['suggestedType']);
        const rawReasonCode = normalizeString(record.reasonCode) as AnchoredSuggestionReasonCode;
        const reasonCode = REASON_SET.has(rawReasonCode) ? rawReasonCode : fallback.reasonCode;
        decisions.push({
            envelopeId,
            shouldSuggest: fallback.shouldSuggest,
            suggestedType: suggestedType as AnchoredSuggestionDecision['suggestedType'],
            importanceScore: fallback.importanceScore,
            actionabilityScore: fallback.actionabilityScore,
            discussionAdvancementScore: fallback.discussionAdvancementScore,
            confidence: fallback.confidence,
            reasonCode,
            shortReason: normalizeShortReason(record.shortReason ?? record.reason, reasonCode),
        });
    }
    if (decisions.length === 0 || seenEnvelopeIds.size !== allowedEnvelopeIds.size) {
        throw new Error('invalid_model_output');
    }
    return decisions;
}

function createDecision(
    candidate: AnchoredSuggestionCandidateSnapshot,
    input: Omit<AnchoredSuggestionDecision, 'envelopeId' | 'shouldSuggest'>,
): AnchoredSuggestionDecision {
    return {
        envelopeId: candidate.envelopeId,
        shouldSuggest: true,
        suggestedType: input.suggestedType,
        importanceScore: clampScore(input.importanceScore + focusBoost(candidate.focusScore) + engagementBoost(candidate)),
        actionabilityScore: clampScore(input.actionabilityScore),
        discussionAdvancementScore: clampScore(input.discussionAdvancementScore),
        confidence: clampScore(input.confidence),
        reasonCode: input.reasonCode,
        shortReason: input.shortReason,
    };
}

function createDefaultDecisionForSuggestedType(
    candidate: AnchoredSuggestionCandidateSnapshot,
    suggestedType: AnchoredSuggestionDecision['suggestedType'],
): AnchoredSuggestionDecision {
    if (suggestedType === 'challenge') {
        return createDecision(candidate, {
            suggestedType: 'challenge',
            reasonCode: 'needs_verification',
            shortReason: 'Needs evidence or verification.',
            importanceScore: 0.72,
            actionabilityScore: 0.72,
            discussionAdvancementScore: 0.78,
            confidence: 0.68,
        });
    }
    if (suggestedType === 'poll') {
        return createDecision(candidate, {
            suggestedType: 'poll',
            reasonCode: 'needs_decision',
            shortReason: 'Needs a shared decision.',
            importanceScore: 0.66,
            actionabilityScore: 0.7,
            discussionAdvancementScore: 0.72,
            confidence: 0.67,
        });
    }
    if (suggestedType === 'signup') {
        return createDecision(candidate, {
            suggestedType: 'signup',
            reasonCode: 'needs_participants',
            shortReason: 'Needs participants or ownership.',
            importanceScore: 0.62,
            actionabilityScore: 0.74,
            discussionAdvancementScore: 0.58,
            confidence: 0.66,
        });
    }
    return {
        envelopeId: candidate.envelopeId,
        shouldSuggest: false,
        suggestedType: 'none',
        importanceScore: 0.2,
        actionabilityScore: 0.25,
        discussionAdvancementScore: 0.2,
        confidence: candidate.actionSignals.includes('draft_only_signal') ? 0.56 : 0.36,
        reasonCode: candidate.actionSignals.includes('draft_only_signal') ? 'low_actionability' : 'unclear',
        shortReason: candidate.actionSignals.includes('draft_only_signal')
            ? 'Not actionable as an interaction yet.'
            : 'No clear interaction action.',
    };
}

function parseJsonObject(rawText: unknown): Record<string, unknown> | null {
    if (rawText && typeof rawText === 'object' && !Array.isArray(rawText)) {
        return rawText as Record<string, unknown>;
    }
    const text = String(rawText ?? '').trim();
    if (!text) return null;
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : null;
    } catch {
        const first = text.indexOf('{');
        const last = text.lastIndexOf('}');
        if (first < 0 || last <= first) return null;
        try {
            const parsed = JSON.parse(text.slice(first, last + 1));
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? parsed as Record<string, unknown>
                : null;
        } catch {
            return null;
        }
    }
}

function normalizeRawDecisions(
    parsed: Record<string, unknown> | null,
    allowedEnvelopeIds: ReadonlySet<string>,
): unknown[] | null {
    if (!parsed) return null;
    if (Array.isArray(parsed.decisions)) return parsed.decisions;
    const decisions = [...allowedEnvelopeIds]
        .map((envelopeId) => ({
            envelopeId,
            suggestedType: normalizeString(parsed[envelopeId]),
        }))
        .filter((decision) => KIND_SET.has(decision.suggestedType));
    return decisions.length > 0 ? decisions : null;
}

function normalizeString(value: unknown): string {
    return String(value ?? '').trim();
}

function clampScore(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function normalizeShortReason(value: unknown, reasonCode: AnchoredSuggestionReasonCode): string {
    const text = normalizeString(value).replace(/\s+/g, ' ');
    if (text.length > 0 && text.length <= 180) return text;
    if (reasonCode === 'needs_participants') return 'Needs participants or ownership.';
    if (reasonCode === 'needs_decision') return 'Needs a shared decision.';
    if (reasonCode === 'needs_verification') return 'Needs evidence or verification.';
    if (reasonCode === 'low_actionability') return 'Not actionable as an interaction yet.';
    return 'No clear interaction action.';
}

function focusBoost(value: number | null): number {
    return typeof value === 'number' && Number.isFinite(value) ? clampScore(value) * 0.16 : 0;
}

function engagementBoost(candidate: AnchoredSuggestionCandidateSnapshot): number {
    return Math.min(0.14, Math.max(0, candidate.usefulCount) * 0.018 + Math.max(0, candidate.replyCount) * 0.026);
}
