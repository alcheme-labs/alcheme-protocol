import { CircleGhostSettings } from '../ghost/circle-settings';

export type DiscussionPolicySource = 'circle' | 'global_default';

export interface DiscussionTriggerThresholds {
    enabled: boolean;
    windowSize: number;
    minMessages: number;
    minQuestionCount: number;
    minFocusedRatio: number;
    cooldownSec: number;
}

export interface DiscussionIntelligencePolicy {
    circleId: number;
    source: DiscussionPolicySource;
    settings: CircleGhostSettings;
    triggerThresholds: DiscussionTriggerThresholds;
}

export interface DiscussionMessageScoreInput {
    text: string;
    circleId?: number;
    circleContext?: string;
    relevanceMode?: 'rule' | 'hybrid';
}

export interface DiscussionMessageScoreResult {
    score: number;
    method: string;
    semanticScore: number;
    qualityScore: number;
    spamScore: number;
    decisionConfidence: number;
    isOnTopic: boolean;
    rationale?: string;
}

export interface DiscussionSummaryMessageInput {
    senderHandle: string | null;
    senderPubkey: string;
    text: string;
    createdAt: Date;
    relevanceScore?: number | null;
}

export interface DiscussionSummaryInput {
    circleId?: number;
    circleName?: string | null;
    circleDescription?: string | null;
    useLLM?: boolean;
    messages: DiscussionSummaryMessageInput[];
}
