import type { EvidenceRef } from '../types';

export type StyleAdvisorScope = 'personal' | 'circle' | 'session_preview';
export type StyleSubjectType = 'style_user' | 'circle' | 'style_session';
export type StyleRiskLevel = 'low' | 'medium' | 'high';

export type StyleTokenName = 'surface' | 'text' | 'accent' | 'motion';

export type StyleTokenSelections = {
    surface: string;
    text: string;
    accent: string;
    motion: string;
};

export interface StyleTokenChange {
    token: StyleTokenName;
    previousValue: string;
    proposedValue: string;
    reason: string;
}

export interface StyleLifeFeelInputs {
    colorTemperature: {
        zone: 'cool' | 'neutral' | 'warm';
    };
    emphasisLevel: number;
    curiosityEvents: string[];
}

export interface StyleAccessibilityCheck {
    check: 'contrast' | 'intensity';
    passed: boolean;
    ratio?: number;
    minRatio?: number;
    message: string;
}

export interface StyleValidationError {
    field: string | null;
    reasonCode: string;
    message: string;
}

export interface StyleAdvisorProposal {
    scope: StyleAdvisorScope;
    reason: string;
    riskLevel: StyleRiskLevel;
    tokenPolicyVersion: string;
    styleIntent: string;
    tone: string;
    tokenSelections: StyleTokenSelections;
    tokenDiff: StyleTokenChange[];
    lifeFeelInputs: StyleLifeFeelInputs;
    previewState: {
        scope: StyleAdvisorScope;
        tokenSelections: StyleTokenSelections;
        lifeFeelInputs: StyleLifeFeelInputs;
        swatches: Array<{
            token: StyleTokenName;
            value: string;
            hex?: string | null;
        }>;
    };
    accessibilityChecks: StyleAccessibilityCheck[];
    validationErrors: StyleValidationError[];
}

export interface StyleAdvisorContextPayload {
    kind: 'style_life_feel_advisor.v1';
    scope: StyleAdvisorScope;
    locale: 'en' | 'zh' | 'fr' | 'es';
    sanitizedIntent: {
        text: string;
        digest: string;
    };
    currentPreference: {
        tokenSelections: StyleTokenSelections;
        lifeFeelInputs: StyleLifeFeelInputs;
    };
    lifeFeelSignals: Record<string, unknown>;
    publicCircleSnapshot: Record<string, unknown> | null;
    tokenPolicyVersion: string;
    evidenceRefs: EvidenceRef[];
}
