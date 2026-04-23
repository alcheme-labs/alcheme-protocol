export type GhostDiscussionRelevanceMode = 'rule' | 'hybrid';

export interface GhostSummaryConfig {
    useLLM: boolean;
    windowSize: number;
    cacheTtlSec: number;
    internalEndpointEnabled: boolean;
}

export interface GhostTriggerConfig {
    enabled: boolean;
    mode: 'notify_only' | 'auto_draft';
    windowSize: number;
    minMessages: number;
    minQuestionCount: number;
    minFocusedRatio: number;
    cooldownSec: number;
    summaryUseLLM: boolean;
    generateComment: boolean;
}

export interface GhostConfig {
    relevance: {
        mode: GhostDiscussionRelevanceMode;
    };
    summary: GhostSummaryConfig;
    trigger: GhostTriggerConfig;
    admin: {
        token: string | null;
    };
}

function firstDefined(...values: Array<string | undefined | null>): string | undefined {
    for (const value of values) {
        if (value !== undefined && value !== null && String(value).trim().length > 0) {
            return String(value).trim();
        }
    }
    return undefined;
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
    if (!raw) return fallback;
    const normalized = raw.trim().toLowerCase();
    if (normalized === '1' || normalized === 'true') return true;
    if (normalized === '0' || normalized === 'false') return false;
    return fallback;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(String(raw || ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

function parseRatio(raw: string | undefined, fallback: number): number {
    const parsed = Number.parseFloat(String(raw || ''));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.min(1, parsed));
}

function normalizeRelevanceMode(raw: string | undefined): GhostDiscussionRelevanceMode {
    const normalized = String(raw || '').trim().toLowerCase();
    if (normalized === 'hybrid') return 'hybrid';
    return 'rule';
}

function normalizeTriggerMode(raw: string | undefined): 'notify_only' | 'auto_draft' {
    const normalized = String(raw || '').trim().toLowerCase();
    if (
        normalized === 'auto'
        || normalized === 'auto_draft'
        || normalized === 'ai'
        || normalized === 'ai_auto'
    ) {
        return 'auto_draft';
    }
    return 'notify_only';
}

export function loadGhostConfig(env: NodeJS.ProcessEnv = process.env): GhostConfig {
    const legacyRelevanceUseLLM = parseBool(env.DISCUSSION_RELEVANCE_USE_LLM, false);
    const relevanceMode = normalizeRelevanceMode(
        firstDefined(
            env.GHOST_RELEVANCE_MODE,
            env.DISCUSSION_RELEVANCE_MODE,
            legacyRelevanceUseLLM ? 'hybrid' : 'rule',
        ),
    );

    const summaryUseLLM = parseBool(
        firstDefined(env.GHOST_SUMMARY_USE_LLM, env.DISCUSSION_SUMMARY_USE_LLM),
        false,
    );
    const summaryWindow = Math.min(
        parsePositiveInt(firstDefined(env.GHOST_SUMMARY_WINDOW, env.DISCUSSION_SUMMARY_WINDOW), 80),
        200,
    );
    const summaryCacheTtlSec = parsePositiveInt(
        firstDefined(env.GHOST_SUMMARY_CACHE_TTL_SEC, env.DISCUSSION_SUMMARY_CACHE_TTL_SEC),
        45,
    );
    const summaryInternalEndpointEnabled = parseBool(
        firstDefined(
            env.GHOST_SUMMARY_INTERNAL_ENDPOINT_ENABLED,
            env.GHOST_SUMMARY_ENDPOINT_ENABLED,
            env.DISCUSSION_SUMMARY_INTERNAL_ENDPOINT_ENABLED,
        ),
        false,
    );

    const trigger: GhostTriggerConfig = {
        enabled: parseBool(
            firstDefined(
                env.GHOST_DRAFT_TRIGGER_ENABLED,
                env.DISCUSSION_DRAFT_TRIGGER_ENABLED,
            ),
            true,
        ),
        mode: normalizeTriggerMode(
            firstDefined(
                env.GHOST_DRAFT_TRIGGER_MODE,
                env.DISCUSSION_DRAFT_TRIGGER_MODE,
                'notify_only',
            ),
        ),
        windowSize: Math.min(
            parsePositiveInt(
                firstDefined(
                    env.GHOST_DRAFT_TRIGGER_WINDOW,
                    env.DISCUSSION_DRAFT_TRIGGER_WINDOW,
                ),
                80,
            ),
            200,
        ),
        minMessages: parsePositiveInt(
            firstDefined(
                env.GHOST_DRAFT_TRIGGER_MIN_MESSAGES,
                env.DISCUSSION_DRAFT_TRIGGER_MIN_MESSAGES,
            ),
            10,
        ),
        minQuestionCount: parsePositiveInt(
            firstDefined(
                env.GHOST_DRAFT_TRIGGER_MIN_QUESTIONS,
                env.DISCUSSION_DRAFT_TRIGGER_MIN_QUESTIONS,
            ),
            2,
        ),
        minFocusedRatio: parseRatio(
            firstDefined(
                env.GHOST_DRAFT_TRIGGER_MIN_FOCUSED_RATIO,
                env.DISCUSSION_DRAFT_TRIGGER_MIN_FOCUSED_RATIO,
            ),
            0.55,
        ),
        cooldownSec: parsePositiveInt(
            firstDefined(
                env.GHOST_DRAFT_TRIGGER_COOLDOWN_SEC,
                env.DISCUSSION_DRAFT_TRIGGER_COOLDOWN_SEC,
            ),
            900,
        ),
        summaryUseLLM: parseBool(
            firstDefined(
                env.GHOST_DRAFT_TRIGGER_SUMMARY_USE_LLM,
                env.DISCUSSION_DRAFT_TRIGGER_SUMMARY_USE_LLM,
            ),
            false,
        ),
        generateComment: parseBool(
            firstDefined(
                env.GHOST_DRAFT_TRIGGER_GENERATE_COMMENT,
                env.DISCUSSION_DRAFT_TRIGGER_GENERATE_COMMENT,
            ),
            false,
        ),
    };

    const adminToken = firstDefined(env.GHOST_ADMIN_TOKEN, env.INTERNAL_API_TOKEN) || null;

    return {
        relevance: {
            mode: relevanceMode,
        },
        summary: {
            useLLM: summaryUseLLM,
            windowSize: summaryWindow,
            cacheTtlSec: summaryCacheTtlSec,
            internalEndpointEnabled: summaryInternalEndpointEnabled,
        },
        trigger,
        admin: {
            token: adminToken,
        },
    };
}
