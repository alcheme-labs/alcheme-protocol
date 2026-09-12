export interface ConfigurationCopilotConfig {
    enabled: boolean;
    maxIntentChars: number;
    maxChanges: number;
    contextTtlMs: number;
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

export function loadConfigurationCopilotConfig(env: NodeJS.ProcessEnv = process.env): ConfigurationCopilotConfig {
    return {
        enabled: parseBool(env.AI_CONFIGURATION_COPILOT_ENABLED, true),
        maxIntentChars: parsePositiveInt(env.AI_CONFIGURATION_COPILOT_MAX_INTENT_CHARS, 800),
        maxChanges: Math.min(parsePositiveInt(env.AI_CONFIGURATION_COPILOT_MAX_CHANGES, 12), 20),
        contextTtlMs: parsePositiveInt(env.AI_CONFIGURATION_COPILOT_CONTEXT_TTL_MS, 30 * 60 * 1000),
    };
}
