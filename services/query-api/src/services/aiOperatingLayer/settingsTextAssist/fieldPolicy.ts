import type {
    SettingsTextAssistField,
    SettingsTextAssistSubjectType,
    SettingsTextSuggestionProposal,
} from './types';

interface SettingsTextFieldPolicy {
    field: SettingsTextAssistField;
    subjectType: SettingsTextAssistSubjectType;
    maxLength: number;
    requiredPermission: string;
}

const SETTINGS_TEXT_FIELD_POLICIES: SettingsTextFieldPolicy[] = [
    {
        field: 'profile.displayName',
        subjectType: 'profile',
        maxLength: 30,
        requiredPermission: 'local_user_confirm',
    },
    {
        field: 'profile.bio',
        subjectType: 'profile',
        maxLength: 120,
        requiredPermission: 'local_user_confirm',
    },
    {
        field: 'circle_alias.alias',
        subjectType: 'circle_alias',
        maxLength: 32,
        requiredPermission: 'circle_alias_owner_local_confirm',
    },
];

const POLICY_BY_FIELD = new Map(SETTINGS_TEXT_FIELD_POLICIES.map((policy) => [policy.field, policy]));

export function listSettingsTextAssistFields(): SettingsTextAssistField[] {
    return SETTINGS_TEXT_FIELD_POLICIES.map((policy) => policy.field);
}

export function getSettingsTextFieldPolicy(field: unknown): SettingsTextFieldPolicy | null {
    const normalized = String(field || '').trim() as SettingsTextAssistField;
    return POLICY_BY_FIELD.get(normalized) ?? null;
}

export function normalizeSettingsTextValue(field: SettingsTextAssistField, value: unknown): string {
    const policy = getSettingsTextFieldPolicy(field);
    const maxLength = policy?.maxLength ?? 200;
    return String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

export function normalizeSettingsTextSuggestion(input: {
    field: SettingsTextAssistField;
    currentValue: unknown;
    modelOutput: unknown;
}): SettingsTextSuggestionProposal {
    const policy = getSettingsTextFieldPolicy(input.field);
    if (!policy) {
        return buildFallbackSettingsTextSuggestion('field_not_allowed', input.field, String(input.currentValue ?? ''));
    }

    const record = input.modelOutput && typeof input.modelOutput === 'object' && !Array.isArray(input.modelOutput)
        ? input.modelOutput as Record<string, unknown>
        : {};
    const previousValue = normalizeSettingsTextValue(input.field, input.currentValue);
    const outputField = String(record.field || input.field).trim();
    const validationErrors: SettingsTextSuggestionProposal['validationErrors'] = [];
    if (outputField !== input.field) {
        validationErrors.push({
            field: outputField || null,
            reasonCode: 'field_mismatch',
            message: 'model output field does not match the requested settings field',
        });
        return {
            field: input.field,
            previousValue,
            suggestedValue: null,
            reason: normalizeReason(record.reason),
            confidence: normalizeConfidence(record.confidence),
            riskLevel: 'low',
            requiredPermission: policy.requiredPermission,
            validationErrors,
        };
    }

    const suggestedValue = normalizeSettingsTextValue(input.field, record.suggestedValue);
    if (!suggestedValue) {
        validationErrors.push({
            field: input.field,
            reasonCode: 'empty_suggestion',
            message: 'suggested value is empty',
        });
    }

    return {
        field: input.field,
        previousValue,
        suggestedValue: suggestedValue || null,
        reason: normalizeReason(record.reason),
        confidence: normalizeConfidence(record.confidence),
        riskLevel: 'low',
        requiredPermission: policy.requiredPermission,
        validationErrors,
    };
}

export function buildFallbackSettingsTextSuggestion(
    reasonCode: string,
    field: SettingsTextAssistField,
    currentValue: unknown,
): SettingsTextSuggestionProposal {
    const policy = getSettingsTextFieldPolicy(field);
    return {
        field,
        previousValue: normalizeSettingsTextValue(field, currentValue),
        suggestedValue: null,
        reason: `Settings Text Assist could not generate a suggestion: ${reasonCode}`,
        confidence: null,
        riskLevel: 'low',
        requiredPermission: policy?.requiredPermission ?? 'local_user_confirm',
        validationErrors: [{
            field,
            reasonCode,
            message: 'No settings text suggestion was generated.',
        }],
    };
}

function normalizeReason(value: unknown): string {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return text.slice(0, 280) || 'Suggested text keeps the setting user-confirmed.';
}

function normalizeConfidence(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, Math.min(1, parsed));
}
