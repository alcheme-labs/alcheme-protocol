import type { EvidenceRef } from '../types';

export const TREND_PLACE_PROMPT_TASK_TYPE = 'place_prompt.trend_aware.v1' as const;
export const TREND_PLACE_PROMPT_ACTION = 'place_prompt.apply_to_create_circle_form' as const;

export type TrendFailureCode =
    | 'trend_disabled'
    | 'no_trend_source'
    | 'stale_trend_cache'
    | 'budget_exceeded'
    | 'provider_failed'
    | 'permission_denied'
    | 'validator_rejected';

export type TrendPromptStatus =
    | 'pending'
    | 'ready'
    | 'fallback'
    | 'failed'
    | 'expired';

export type TrendLocale = 'en' | 'zh' | 'fr' | 'es';

export interface TrendPromptInput {
    promptId?: string;
    placeSeed: string;
    locale: TrendLocale;
    communityType?: string | null;
    mode?: 'social' | 'knowledge' | null;
    requestedByUserId: number;
}

export interface TrendSourceBudgetPolicy {
    ttlSeconds: number;
    minFetchIntervalSeconds: number;
    maxQueryChars: number;
    maxReceiptsPerFetch: number;
}

export interface TrendSourceConfig {
    id?: string;
    sourceKey: string;
    displayName: string;
    sourceType: 'manual_snapshot';
    owner: string;
    sourceUrl?: string | null;
    allowedHosts?: string[];
    secretScope: 'none';
    privacyProfile: 'public_aggregate';
    loggingBoundary: 'summary_digest_only';
    budgetPolicy: TrendSourceBudgetPolicy;
    licenseNote: string;
    visibility: 'public';
    status: 'enabled' | 'disabled' | 'blocked';
    killSwitch?: boolean;
    bootstrapSource?: 'env' | 'file' | 'database';
    snapshots?: TrendSourceSnapshot[];
}

export interface TrendSourceSnapshot {
    query: string;
    summary: string;
    confidence?: number;
    sourceUrl?: string | null;
    capturedAt?: string | null;
}

export interface ValidatedTrendSource extends TrendSourceConfig {
    id: string;
    allowedHosts: string[];
    killSwitch: boolean;
    bootstrapSource: 'env' | 'file' | 'database';
    snapshots: TrendSourceSnapshot[];
}

export interface TrendReceiptView {
    id: string;
    sourceId: string;
    sourceKey: string;
    sourceUrl: string | null;
    query: string;
    fetchedAt: string;
    expiresAt: string;
    summary: string;
    digest: string;
    licenseNote: string;
    confidence: number;
    visibility: 'public';
    cacheKey: string;
    status: 'fresh' | 'stale' | 'blocked' | 'failed';
}

export interface TrendPlacePromptSuggestion {
    id: string;
    title: string;
    namePatch: string | null;
    descriptionPatch: string;
    promptText: string;
    rationale: string;
    confidence: number;
    evidenceRefIds: string[];
}

export interface TrendPlacePromptPayload {
    status: 'pending' | 'ready' | 'fallback' | 'failed';
    failureCode: TrendFailureCode | null;
    generatedAt: string | null;
    expiresAt: string | null;
    query: {
        display: string;
        digest: string;
    };
    confidence: number;
    sourceDigest: string;
    suggestions: TrendPlacePromptSuggestion[];
    evidenceRefs: Array<EvidenceRef & {
        sourceType: 'trend_receipt';
        visibility: 'public';
    }>;
}

export interface TrendPromptCacheView {
    id: string;
    promptId: string;
    cacheKey: string;
    taskType: typeof TREND_PLACE_PROMPT_TASK_TYPE;
    requestedByUserId: number;
    status: TrendPromptStatus;
    failureCode: TrendFailureCode | null;
    aiJobId: number | null;
    proposalArtifactId: string | null;
    expiresAt: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    prompt: TrendPlacePromptPayload | null;
}
