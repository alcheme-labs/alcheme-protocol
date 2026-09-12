import type { EvidenceRef } from '../types';

export type GuardianFindingLevel = 'observe' | 'notify' | 'propose';
export type GuardianFindingRiskLevel = 'low' | 'medium' | 'high';
export type GuardianFindingSeverity = 'info' | 'low' | 'medium' | 'high';
export type GuardianFindingStatus = 'open' | 'acknowledged' | 'dismissed' | 'snoozed' | 'converted';
export type GuardianFindingNotificationPolicy = 'none' | 'ops';
export type GuardianFindingNotificationStatus = 'skipped' | 'sent' | 'failed';

export interface GuardianFindingSuggestedAction {
    kind: string;
    labelKey?: string;
    target?: Record<string, unknown>;
    requiresConfirmation: boolean;
    forbiddenDirectEffects?: string[];
}

export interface GuardianFindingCandidate {
    ownerUserId: number | null;
    circleId: number;
    findingKind: string;
    level: GuardianFindingLevel;
    riskLevel: GuardianFindingRiskLevel;
    severity: GuardianFindingSeverity;
    title: string;
    summary: string;
    explanation: string;
    evidenceRefs: EvidenceRef[];
    suggestedAction: GuardianFindingSuggestedAction;
    sourceDigest: string;
    dedupeKey: string;
    ruleVersion: string;
    modelProfile: string | null;
    cooldownUntil: Date | null;
    notificationPolicy: GuardianFindingNotificationPolicy;
}

export interface GuardianFindingView {
    id: string;
    ownerUserId: number | null;
    circleId: number;
    findingKind: string;
    level: GuardianFindingLevel;
    riskLevel: GuardianFindingRiskLevel;
    severity: GuardianFindingSeverity;
    status: GuardianFindingStatus;
    title: string;
    summary: string;
    explanation: string;
    evidenceRefs: EvidenceRef[];
    suggestedAction: GuardianFindingSuggestedAction;
    sourceDigest: string;
    dedupeKey: string;
    ruleVersion: string;
    modelProfile: string | null;
    cooldownUntil: Date | null;
    notificationStatus: GuardianFindingNotificationStatus;
    notificationError: string | null;
    convertedProposalId: string | null;
    createdAt: Date;
    updatedAt: Date;
}
