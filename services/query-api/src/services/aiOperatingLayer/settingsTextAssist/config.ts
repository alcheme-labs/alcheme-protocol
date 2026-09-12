export interface SettingsTextAssistConfig {
    enabled: boolean;
    maxIntentChars: number;
    contextTtlMs: number;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined) return fallback;
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(String(value || ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.trunc(parsed);
}

export function loadSettingsTextAssistConfig(env: NodeJS.ProcessEnv = process.env): SettingsTextAssistConfig {
    return {
        enabled: parseBoolean(
            env.AI_SETTINGS_TEXT_ASSIST_ENABLED ?? env.ALCHEME_SETTINGS_TEXT_ASSIST_ENABLED,
            true,
        ),
        maxIntentChars: parsePositiveInt(env.AI_SETTINGS_TEXT_ASSIST_MAX_INTENT_CHARS, 500),
        contextTtlMs: parsePositiveInt(env.AI_SETTINGS_TEXT_ASSIST_CONTEXT_TTL_MS, 6 * 60 * 60 * 1000),
    };
}
