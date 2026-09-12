import type { EvidenceRef } from '../types';

export type ConfigurationCopilotEntrypoint = 'create_circle' | 'circle_settings' | 'fork_create';
export type ConfigurationCopilotSubjectType = 'circle_create_session' | 'circle' | 'circle_fork_session';
export type ConfigurationCopilotInteractionMode = 'field_inline' | 'section_diff' | 'full_panel';
export type ConfigurationRiskLevel = 'low' | 'medium' | 'high';

export interface ConfigurationFieldChange {
    field: string;
    previousValue: unknown;
    proposedValue: unknown;
    reason: string;
    riskLevel: ConfigurationRiskLevel;
    requiredPermission: string;
    section: string;
    conflicts: string[];
}

export interface ConfigurationProposalDiff {
    reason: string;
    riskLevel: ConfigurationRiskLevel;
    affectedFields: string[];
    configDiff: ConfigurationFieldChange[];
    validationErrors: Array<{
        field: string | null;
        reasonCode: string;
        message: string;
    }>;
}

export interface ConfigurationCopilotContextPayload {
    kind: 'configuration_copilot.v1';
    entrypoint: ConfigurationCopilotEntrypoint;
    locale: 'en' | 'zh' | 'fr' | 'es';
    sanitizedIntent: {
        text: string;
        digest: string;
    };
    normalizedSnapshot: Record<string, unknown>;
    fieldPolicyVersion: string;
    targetFields: string[];
    interactionMode: ConfigurationCopilotInteractionMode;
    trendRefs: EvidenceRef[];
    sourceMaterialRefs: EvidenceRef[];
}

export interface ConfigurationCopilotRequestInput {
    entrypoint: ConfigurationCopilotEntrypoint;
    createSessionId?: string | null;
    circleId?: number | null;
    locale?: unknown;
    userIntent?: unknown;
    currentSnapshot?: unknown;
    sourceMaterialIds?: number[];
    requestedByUserId: number;
}
