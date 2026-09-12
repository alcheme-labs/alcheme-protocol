import type { EvidenceRef } from '../types';

export const CIRCLE_GROWTH_TASK_TYPE = 'circle.growth_advisor.v1';
export const CIRCLE_GROWTH_SCHEMA_VERSION = 'v1';

export type CircleGrowthTriggerSource = 'manual' | 'watcher';
export type CircleGrowthSignalStatus = 'ready' | 'no_signal';
export type CircleEvolutionProposalStatus =
    | 'pending'
    | 'ready'
    | 'no_signal'
    | 'failed'
    | 'snoozed'
    | 'rejected'
    | 'converted';

export type CircleGrowthSignalSeverity = 'positive' | 'neutral' | 'warning' | 'critical';

export interface CircleGrowthSignalItem {
    key: string;
    label: string;
    value: number | string | boolean | null;
    severity: CircleGrowthSignalSeverity;
    evidenceRefIds?: string[];
}

export interface CircleGrowthMissingSignal {
    key: string;
    label: string;
    severity: 'warning' | 'critical';
}

export interface CircleGrowthTimeWindow {
    startedAt: string;
    endedAt: string;
}

export interface CircleGrowthCognitiveMapProjection {
    nodeCount: number;
    edgeCount: number;
    branchCount: number;
    unboundBranchCount: number;
    issueCount: number;
    openQuestionCount: number;
    timelineItemCount: number;
}

export interface CircleGrowthSignalSnapshot {
    id: string;
    circleId: number;
    requestedByUserId: number | null;
    triggerSource: CircleGrowthTriggerSource;
    status: CircleGrowthSignalStatus;
    currentSignals: CircleGrowthSignalItem[];
    counterSignals: CircleGrowthSignalItem[];
    missingSignals: CircleGrowthMissingSignal[];
    metrics: Record<string, unknown>;
    cognitiveMapProjection: CircleGrowthCognitiveMapProjection | Record<string, unknown>;
    evidenceRefs: EvidenceRef[];
    sourceDigest: string;
    lookbackStartedAt: Date;
    lookbackEndedAt: Date;
    contextCapsuleId?: string | null;
    createdAt: Date;
}

export interface CircleEvolutionConfigChange {
    field: string;
    previousValue: unknown;
    proposedValue: unknown;
    reason: string;
    riskLevel: 'low' | 'medium' | 'high';
    requiredPermission: string;
    section: string;
    conflicts: string[];
}

export interface CircleEvolutionProposalView {
    id: string;
    circleId: number;
    signalId: string | null;
    status: CircleEvolutionProposalStatus;
    recommendedStage: string | null;
    explanation: string;
    configDiff: CircleEvolutionConfigChange[];
    currentSignals: CircleGrowthSignalItem[];
    counterSignals: CircleGrowthSignalItem[];
    missingSignals: CircleGrowthMissingSignal[];
    metricsSnapshot: Record<string, unknown>;
    cognitiveMapProjection: Record<string, unknown>;
    evidenceRefs: EvidenceRef[];
    sourceDigest: string;
    dedupeKey: string;
    failureCode: string | null;
    failureMessage: string | null;
    rejectReason: string | null;
    cooldownUntil: Date | null;
    guardianFindingId: string | null;
    configurationProposalId: string | null;
    aiJobId: number | null;
    modelProfile: string | null;
    promptVersion: string | null;
    outputSchemaVersion: string;
    createdByUserId: number | null;
    convertedByUserId: number | null;
    rejectedByUserId: number | null;
    snoozedByUserId: number | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface CircleGrowthContextPayload {
    kind: 'circle_growth_advisor.v1';
    circleId: number;
    proposalId: string;
    signalId: string;
    signalStatus: CircleGrowthSignalStatus;
}
