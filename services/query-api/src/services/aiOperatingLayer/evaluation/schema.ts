import type { ParsedNeutralEvaluationOutput } from './types';

const FORBIDDEN_KEYS = new Set([
    'score',
    'rank',
    'ranking',
    'rankingAction',
    'reputation',
    'reputationScore',
    'penalty',
    'punishment',
    'reward',
    'permission',
    'permissionChange',
    'governance',
    'governanceAction',
    'moderationAction',
    'contribution',
    'contributorWeight',
    'receiptWeight',
    'proof',
    'proofPackageHash',
    'signature',
    'contributorsRoot',
    'rawText',
    'privateText',
    'sourceExcerpt',
    'rawPrompt',
    'providerRawResponse',
    'providerTrace',
]);

const FORBIDDEN_TEXT = /\b(rank|ranking|score|best author|worst author|penali[sz]e|punish|ban|promote|demote|reputation|reward|receipt weight|contributor weight)\b/i;

export function parseNeutralEvaluationModelOutput(input: {
    rawText: unknown;
    allowedRefIds: string[];
}): ParsedNeutralEvaluationOutput {
    const payload = parseJsonObject(input.rawText);
    if (containsForbiddenKey(payload) || containsForbiddenText(payload)) {
        throw new Error('invalid_neutral_evaluation_output');
    }
    const allowedRefs = new Set(input.allowedRefIds);
    const summary = normalizeText(payload.summary, 1600);
    const claims = normalizeClaims(payload.claims, allowedRefs);
    if (!summary || claims.length === 0) {
        throw new Error('invalid_neutral_evaluation_output');
    }

    return {
        summary,
        claims,
        evidenceSummary: normalizeEvidenceSummary(payload.evidenceSummary, allowedRefs),
        assumptions: normalizeTextArray(payload.assumptions, 8, 360),
        evidenceGaps: normalizeTextArray(payload.evidenceGaps, 8, 360),
        counterpoints: normalizeTextArray(payload.counterpoints, 8, 360),
        verifiableNextSteps: normalizeTextArray(payload.verifiableNextSteps, 8, 360),
        neutralWordingSuggestion: normalizeText(payload.neutralWordingSuggestion, 800),
        confidence: payload.confidence === 'high' || payload.confidence === 'medium' ? payload.confidence : 'low',
        limitations: normalizeTextArray(payload.limitations, 8, 360),
    };
}

function normalizeClaims(value: unknown, allowedRefs: Set<string>): ParsedNeutralEvaluationOutput['claims'] {
    if (!Array.isArray(value)) throw new Error('invalid_neutral_evaluation_output');
    const claims = value.map((item, index) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            throw new Error('invalid_neutral_evaluation_output');
        }
        const record = item as Record<string, unknown>;
        const text = normalizeText(record.text, 700);
        const evidenceRefIds = Array.isArray(record.evidenceRefIds)
            ? record.evidenceRefIds.map((ref) => String(ref || '').trim()).filter(Boolean)
            : [];
        if (!text || evidenceRefIds.length === 0 || evidenceRefIds.some((ref) => !allowedRefs.has(ref))) {
            throw new Error('invalid_neutral_evaluation_output');
        }
        return {
            id: normalizeText(record.id, 80) || `claim_${index + 1}`,
            text,
            evidenceRefIds: Array.from(new Set(evidenceRefIds)).slice(0, 8),
        };
    });
    return claims.slice(0, 12);
}

function normalizeEvidenceSummary(value: unknown, allowedRefs: Set<string>): ParsedNeutralEvaluationOutput['evidenceSummary'] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
        const record = item && typeof item === 'object' && !Array.isArray(item)
            ? item as Record<string, unknown>
            : {};
        const evidenceRefId = normalizeText(record.evidenceRefId, 160);
        const note = normalizeText(record.note, 500);
        if (!evidenceRefId || !note || !allowedRefs.has(evidenceRefId)) return null;
        return { evidenceRefId, note };
    }).filter((item): item is { evidenceRefId: string; note: string } => Boolean(item)).slice(0, 16);
}

function normalizeTextArray(value: unknown, limit: number, maxChars: number): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => normalizeText(item, maxChars))
        .filter(Boolean)
        .slice(0, limit);
}

function normalizeText(value: unknown, maxChars: number): string {
    return String(typeof value === 'string' ? value : '').trim().slice(0, maxChars);
}

function parseJsonObject(rawText: unknown): Record<string, unknown> {
    if (rawText && typeof rawText === 'object' && !Array.isArray(rawText)) {
        return rawText as Record<string, unknown>;
    }
    const text = String(rawText || '').trim();
    if (!text) throw new Error('invalid_neutral_evaluation_output');
    const withoutFence = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    try {
        const parsed = JSON.parse(withoutFence);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('invalid_neutral_evaluation_output');
        }
        return parsed;
    } catch {
        throw new Error('invalid_neutral_evaluation_output');
    }
}

function containsForbiddenKey(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) return value.some(containsForbiddenKey);
    return Object.entries(value as Record<string, unknown>).some(([key, nested]) =>
        FORBIDDEN_KEYS.has(key) || containsForbiddenKey(nested),
    );
}

function containsForbiddenText(value: unknown): boolean {
    if (typeof value === 'string') return FORBIDDEN_TEXT.test(value);
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) return value.some(containsForbiddenText);
    return Object.values(value as Record<string, unknown>).some(containsForbiddenText);
}
