import { normalizeStyleAdvisorProposal } from './validator';
import type {
    StyleAdvisorProposal,
    StyleAdvisorScope,
} from './types';

export function parseStyleAdvisorModelOutput(input: {
    scope: StyleAdvisorScope;
    currentPreference: unknown;
    rawText: unknown;
    maxChanges: number;
}): StyleAdvisorProposal {
    const parsed = parseJsonObject(input.rawText);
    if (!parsed) {
        throw new Error('invalid_model_output');
    }
    return normalizeStyleAdvisorProposal({
        scope: input.scope,
        currentPreference: input.currentPreference,
        modelOutput: parsed,
        maxChanges: input.maxChanges,
    });
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
        if (first >= 0 && last > first) {
            try {
                const parsed = JSON.parse(text.slice(first, last + 1));
                return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                    ? parsed as Record<string, unknown>
                    : null;
            } catch {
                return null;
            }
        }
        return null;
    }
}
