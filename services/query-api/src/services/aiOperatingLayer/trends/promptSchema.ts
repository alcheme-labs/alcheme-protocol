import type { TrendPlacePromptPayload, TrendPlacePromptSuggestion } from './types';

const FORBIDDEN_FIELDS = new Set([
    'rawPrompt',
    'rawText',
    'privateText',
    'providerRawResponse',
    'proofRoot',
    'signature',
    'receiptWeight',
    'contextCapsuleId',
]);

export function validateTrendPromptPayload(value: unknown): {
    ok: true;
    payload: TrendPlacePromptPayload;
} | {
    ok: false;
    error:
        | 'invalid_payload'
        | 'too_few_suggestions'
        | 'too_many_suggestions'
        | 'fallback_requires_suggestions'
        | 'forbidden_field'
        | 'invalid_suggestion';
    forbiddenFields?: string[];
} {
    const forbiddenFields = Array.from(collectForbiddenFields(value));
    if (forbiddenFields.length > 0) {
        return { ok: false, error: 'forbidden_field', forbiddenFields };
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { ok: false, error: 'invalid_payload' };
    }
    const payload = value as TrendPlacePromptPayload;
    if (!Array.isArray(payload.suggestions)) return { ok: false, error: 'invalid_payload' };

    if (payload.status === 'failed') {
        return {
            ok: true,
            payload: {
                ...payload,
                suggestions: [],
            },
        };
    }

    if (payload.status === 'fallback' && payload.suggestions.length === 0) {
        return { ok: false, error: 'fallback_requires_suggestions' };
    }
    if (payload.suggestions.length < 3) return { ok: false, error: 'too_few_suggestions' };
    if (payload.suggestions.length > 5) return { ok: false, error: 'too_many_suggestions' };
    if (!payload.suggestions.every(isValidSuggestion)) {
        return { ok: false, error: 'invalid_suggestion' };
    }
    return { ok: true, payload };
}

export function parseProviderTrendPromptOutput(
    text: string,
    base: Omit<TrendPlacePromptPayload, 'suggestions' | 'status' | 'failureCode'>,
): {
    ok: true;
    payload: TrendPlacePromptPayload;
} | {
    ok: false;
    error: string;
} {
    let parsed: any;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { ok: false, error: 'invalid_json' };
    }
    const suggestions = Array.isArray(parsed?.suggestions)
        ? parsed.suggestions.map(normalizeSuggestion)
        : [];
    const validation = validateTrendPromptPayload({
        ...base,
        status: 'ready',
        failureCode: null,
        suggestions,
    });
    if (!validation.ok) return { ok: false, error: validation.error };
    return { ok: true, payload: validation.payload };
}

function normalizeSuggestion(value: unknown, index: number): TrendPlacePromptSuggestion {
    const record = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
    return {
        id: safeText(record.id, `suggestion_${index + 1}`, 64),
        title: safeText(record.title, `Suggestion ${index + 1}`, 80),
        namePatch: record.namePatch === null || record.namePatch === undefined
            ? null
            : safeText(record.namePatch, '', 80) || null,
        descriptionPatch: safeText(record.descriptionPatch, '', 240),
        promptText: safeText(record.promptText, '', 240),
        rationale: safeText(record.rationale, '', 240),
        confidence: clamp(Number(record.confidence ?? 0.5), 0, 1),
        evidenceRefIds: Array.isArray(record.evidenceRefIds)
            ? record.evidenceRefIds.map((item) => safeText(item, '', 128)).filter(Boolean).slice(0, 5)
            : [],
    };
}

function isValidSuggestion(value: TrendPlacePromptSuggestion): boolean {
    return Boolean(value.id)
        && Boolean(value.title)
        && Boolean(value.descriptionPatch)
        && Boolean(value.promptText)
        && Boolean(value.rationale)
        && Number.isFinite(value.confidence)
        && value.confidence >= 0
        && value.confidence <= 1
        && Array.isArray(value.evidenceRefIds);
}

function collectForbiddenFields(value: unknown, output = new Set<string>()): Set<string> {
    if (!value || typeof value !== 'object') return output;
    if (Array.isArray(value)) {
        value.forEach((item) => collectForbiddenFields(item, output));
        return output;
    }
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if (FORBIDDEN_FIELDS.has(key)) output.add(key);
        collectForbiddenFields(nested, output);
    }
    return output;
}

function safeText(value: unknown, fallback: string, maxLength: number): string {
    const normalized = String(value ?? fallback)
        .replace(/\s+/g, ' ')
        .trim();
    return normalized.slice(0, maxLength);
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
}
