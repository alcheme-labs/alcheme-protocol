import { getConfigurationFieldPolicy } from '../configuration/fieldPolicy';
import type {
    CircleEvolutionConfigChange,
    CircleGrowthSignalSnapshot,
} from './types';

const FORBIDDEN_OUTPUT_KEYS = new Set([
    'rawPrompt',
    'rawText',
    'privateText',
    'providerRawResponse',
    'providerTrace',
    'sourceExcerpt',
    'css',
    'selector',
    'remoteResource',
    'applySettings',
    'settingsWrite',
    'governanceTemplateWrite',
    'createChildCircle',
]);

export interface ParsedCircleGrowthAdvisorOutput {
    explanation: string;
    recommendedStage: string;
    currentSignals: Array<Record<string, unknown>>;
    counterSignals: Array<Record<string, unknown>>;
    configDiff: CircleEvolutionConfigChange[];
    evidenceRefIds: string[];
    confidence: 'low' | 'medium' | 'high';
    limitations: string[];
}

export function parseCircleGrowthAdvisorModelOutput(input: {
    rawText: string;
    signal: CircleGrowthSignalSnapshot;
    maxChanges: number;
}): ParsedCircleGrowthAdvisorOutput {
    let parsed: unknown;
    try {
        parsed = JSON.parse(input.rawText);
    } catch {
        throw new Error('invalid_model_output');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('invalid_model_output');
    }
    if (containsForbiddenKey(parsed)) {
        throw new Error('invalid_model_output');
    }
    const record = parsed as Record<string, unknown>;
    const currentSignals = normalizeSignalRefs(record.currentSignals);
    const counterSignals = normalizeSignalRefs(record.counterSignals);
    if (currentSignals.length === 0 || counterSignals.length === 0) {
        throw new Error('invalid_model_output');
    }

    const allowedEvidenceIds = new Set(input.signal.evidenceRefs.map(toEvidenceRefId));
    const evidenceRefIds = Array.isArray(record.evidenceRefs)
        ? record.evidenceRefs.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
    if (evidenceRefIds.some((refId) => !allowedEvidenceIds.has(refId))) {
        throw new Error('invalid_model_output');
    }

    const configDiff = normalizeConfigDiff(record.configDiff, input.maxChanges);
    const explanation = normalizeText(record.explanation, 1200);
    const recommendedStage = normalizeText(record.recommendedStage, 64) || 'no_stage_change';
    if (!explanation) {
        throw new Error('invalid_model_output');
    }

    return {
        explanation,
        recommendedStage,
        currentSignals,
        counterSignals,
        configDiff,
        evidenceRefIds,
        confidence: normalizeConfidence(record.confidence),
        limitations: Array.isArray(record.limitations)
            ? record.limitations.map((item) => normalizeText(item, 160)).filter(Boolean).slice(0, 6)
            : [],
    };
}

function normalizeConfigDiff(value: unknown, maxChanges: number): CircleEvolutionConfigChange[] {
    if (!Array.isArray(value)) return [];
    const changes: CircleEvolutionConfigChange[] = [];
    const seen = new Set<string>();
    for (const raw of value.slice(0, Math.max(1, maxChanges))) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const record = raw as Record<string, unknown>;
        const field = normalizeText(record.field, 128);
        if (!field || seen.has(field)) continue;
        const policy = getConfigurationFieldPolicy('circle_settings', field);
        if (!policy) throw new Error('invalid_model_output');
        seen.add(field);
        changes.push({
            field,
            previousValue: record.previousValue ?? null,
            proposedValue: record.proposedValue ?? null,
            reason: normalizeText(record.reason, 300),
            riskLevel: policy.riskLevel,
            requiredPermission: policy.requiredPermission,
            section: policy.section,
            conflicts: Array.isArray(record.conflicts)
                ? record.conflicts.map((item) => normalizeText(item, 120)).filter(Boolean).slice(0, 5)
                : [],
        });
    }
    return changes;
}

function normalizeSignalRefs(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => item && typeof item === 'object' && !Array.isArray(item)
            ? item as Record<string, unknown>
            : null)
        .filter((item): item is Record<string, unknown> => Boolean(item?.key))
        .slice(0, 12);
}

function normalizeText(value: unknown, max: number): string {
    return String(value || '').trim().slice(0, max);
}

function normalizeConfidence(value: unknown): 'low' | 'medium' | 'high' {
    return value === 'high' || value === 'medium' || value === 'low' ? value : 'medium';
}

function toEvidenceRefId(ref: { sourceType: string; sourceId: string }): string {
    return `${ref.sourceType}:${ref.sourceId}`;
}

function containsForbiddenKey(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) return value.some(containsForbiddenKey);
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if (FORBIDDEN_OUTPUT_KEYS.has(key)) return true;
        if (containsForbiddenKey(nested)) return true;
    }
    return false;
}
