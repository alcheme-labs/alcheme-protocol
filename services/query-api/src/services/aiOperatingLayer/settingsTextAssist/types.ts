export type SettingsTextAssistSubjectType = 'profile' | 'circle_alias';
export type SettingsTextAssistField =
    | 'profile.displayName'
    | 'profile.bio'
    | 'circle_alias.alias';
export type SettingsTextAssistRiskLevel = 'low';

export interface SettingsTextAssistContextPayload {
    kind: 'settings_text_assist.v1';
    field: SettingsTextAssistField;
    locale: 'en' | 'zh' | 'fr' | 'es';
    sanitizedIntent: {
        text: string;
        digest: string;
    };
    currentValue: string;
    surroundingValues: Record<string, string>;
    fieldPolicyVersion: string;
}

export interface SettingsTextSuggestionProposal {
    field: SettingsTextAssistField;
    previousValue: string;
    suggestedValue: string | null;
    reason: string;
    confidence: number | null;
    riskLevel: SettingsTextAssistRiskLevel;
    requiredPermission: string;
    validationErrors: Array<{
        field: string | null;
        reasonCode: string;
        message: string;
    }>;
}
