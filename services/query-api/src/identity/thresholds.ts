/**
 * Identity State Machine — Thresholds & Circle-level overrides
 *
 * Default thresholds: N=3 messages, M=2 citations, X=10% percentile
 * Supports runtime overrides by circle (env policy map), and optional
 * request-level overrides for future circle-config fields.
 */

import {
    serviceConfig,
    parseIdentityNotificationMode,
    type IdentityCirclePolicy,
    type IdentityNotificationMode,
} from '../config/services';

export enum IdentityLevel {
    Visitor = 'Visitor',
    Initiate = 'Initiate',
    Member = 'Member',
    Elder = 'Elder',
}

export interface IdentityThresholds {
    /** Messages to post before becoming Initiate */
    initiateMessages: number;
    /** Times cited by others before becoming Member */
    memberCitations: number;
    /** Reputation percentile (top X%) to become Elder */
    elderPercentile: number;
    /** Days of inactivity before demotion */
    inactivityDays: number;
}

/** Global defaults from env / config */
export const DEFAULT_THRESHOLDS: IdentityThresholds = {
    initiateMessages: serviceConfig.identity.initiateThreshold,
    memberCitations: serviceConfig.identity.memberCitations,
    elderPercentile: serviceConfig.identity.elderPercentile,
    inactivityDays: serviceConfig.identity.inactivityDays,
};

const IDENTITY_LEVEL_ORDER: Record<IdentityLevel, number> = {
    [IdentityLevel.Visitor]: 0,
    [IdentityLevel.Initiate]: 1,
    [IdentityLevel.Member]: 2,
    [IdentityLevel.Elder]: 3,
};

function parseBoundedInteger(
    raw: unknown,
    input: { min: number; max?: number },
): number | null {
    const parsed = typeof raw === 'number'
        ? Math.trunc(raw)
        : (typeof raw === 'string' && /^-?\d+$/.test(raw.trim()))
            ? parseInt(raw.trim(), 10)
            : Number.NaN;
    if (!Number.isFinite(parsed)) return null;
    if (parsed < input.min) return null;
    if (typeof input.max === 'number' && parsed > input.max) return null;
    return parsed;
}

type IdentityThresholdOverride = Partial<Pick<
IdentityCirclePolicy,
'initiateMessages' | 'memberCitations' | 'elderPercentile' | 'inactivityDays'
>>;

function normalizeThresholdOverrides(raw: unknown): IdentityThresholdOverride {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const input = raw as Record<string, unknown>;
    const initiateMessages = parseBoundedInteger(input.initiateMessages, { min: 1 });
    const memberCitations = parseBoundedInteger(input.memberCitations, { min: 0 });
    const elderPercentile = parseBoundedInteger(input.elderPercentile, { min: 1, max: 100 });
    const inactivityDays = parseBoundedInteger(input.inactivityDays, { min: 1 });
    return {
        ...(initiateMessages !== null ? { initiateMessages } : {}),
        ...(memberCitations !== null ? { memberCitations } : {}),
        ...(elderPercentile !== null ? { elderPercentile } : {}),
        ...(inactivityDays !== null ? { inactivityDays } : {}),
    };
}

/**
 * Get effective thresholds for a circle.
 * Priority: defaults < env circle policy < explicit circle config.
 */
export function getThresholds(
    circleConfig?: Record<string, unknown> | null,
    circleId?: number | null,
): IdentityThresholds {
    const policyOverride = (
        typeof circleId === 'number' && Number.isFinite(circleId)
            ? normalizeThresholdOverrides(serviceConfig.identity.circlePolicies[circleId])
            : {}
    );
    const configOverride = normalizeThresholdOverrides(circleConfig?.identityThresholds);
    return {
        ...DEFAULT_THRESHOLDS,
        ...policyOverride,
        ...configOverride,
    };
}

/**
 * Resolve identity notification policy.
 * Priority: global env default < env circle policy < explicit circle config.
 */
export function getIdentityNotificationMode(
    circleId?: number | null,
    circleConfig?: Record<string, unknown> | null,
): IdentityNotificationMode {
    const globalMode = serviceConfig.identity.notificationMode;
    const policyMode = (
        typeof circleId === 'number' && Number.isFinite(circleId)
            ? serviceConfig.identity.circlePolicies[circleId]?.notificationMode
            : undefined
    );
    const configMode = typeof circleConfig?.identityNotificationMode === 'string'
        ? circleConfig.identityNotificationMode
        : undefined;
    const baseMode = parseIdentityNotificationMode(policyMode, globalMode);
    return parseIdentityNotificationMode(configMode, baseMode);
}

export function shouldNotifyIdentityTransition(
    previousLevel: IdentityLevel,
    newLevel: IdentityLevel,
    mode: IdentityNotificationMode,
): boolean {
    if (mode === 'none') return false;
    if (mode === 'all') return true;
    return IDENTITY_LEVEL_ORDER[newLevel] > IDENTITY_LEVEL_ORDER[previousLevel];
}
