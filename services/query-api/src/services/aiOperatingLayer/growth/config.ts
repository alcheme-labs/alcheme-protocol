export interface CircleGrowthAdvisorConfig {
    enabled: boolean;
    watcherEnabled: boolean;
    lookbackDays: number;
    cooldownDays: number;
    maxConfigChanges: number;
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
    if (typeof raw !== 'string') return fallback;
    const normalized = raw.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(String(raw || ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

export function loadCircleGrowthAdvisorConfig(
    env: NodeJS.ProcessEnv = process.env,
): CircleGrowthAdvisorConfig {
    return {
        enabled: parseBool(env.AI_CIRCLE_GROWTH_ADVISOR_ENABLED, false),
        watcherEnabled: parseBool(env.AI_CIRCLE_GROWTH_WATCHER_ENABLED, false),
        lookbackDays: Math.min(parsePositiveInt(env.AI_CIRCLE_GROWTH_LOOKBACK_DAYS, 30), 120),
        cooldownDays: Math.min(parsePositiveInt(env.AI_CIRCLE_GROWTH_COOLDOWN_DAYS, 7), 30),
        maxConfigChanges: Math.min(parsePositiveInt(env.AI_CIRCLE_GROWTH_MAX_CONFIG_CHANGES, 5), 12),
    };
}
