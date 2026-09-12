export interface StyleAdvisorConfig {
    enabled: boolean;
    maxIntentChars: number;
    maxTokenChanges: number;
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

	export function loadStyleAdvisorConfig(env: NodeJS.ProcessEnv = process.env): StyleAdvisorConfig {
	    return {
	        enabled: parseBoolean(
	            env.AI_STYLE_ADVISOR_ENABLED ?? env.ALCHEME_STYLE_ADVISOR_ENABLED,
	            true,
	        ),
	        maxIntentChars: parsePositiveInt(env.AI_STYLE_ADVISOR_MAX_INTENT_CHARS, 900),
        maxTokenChanges: parsePositiveInt(env.AI_STYLE_ADVISOR_MAX_TOKEN_CHANGES, 8),
        contextTtlMs: parsePositiveInt(env.AI_STYLE_ADVISOR_CONTEXT_TTL_MS, 24 * 60 * 60 * 1000),
    };
}
