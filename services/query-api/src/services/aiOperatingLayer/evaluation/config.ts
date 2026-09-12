export interface NeutralEvaluationConfig {
    enabled: boolean;
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
    if (typeof raw !== 'string') return fallback;
    const normalized = raw.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

export function loadNeutralEvaluationConfig(
    env: NodeJS.ProcessEnv = process.env,
): NeutralEvaluationConfig {
    return {
        enabled: parseBool(env.AI_NEUTRAL_EVALUATION_ENABLED, true),
    };
}
