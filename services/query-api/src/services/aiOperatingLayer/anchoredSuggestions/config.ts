export interface AnchoredSuggestionAiConfig {
    enabled: boolean;
}

export function loadAnchoredSuggestionAiConfig(
    env: NodeJS.ProcessEnv = process.env,
): AnchoredSuggestionAiConfig {
    const raw = String(env.AI_ANCHORED_SUGGESTIONS_ENABLED ?? 'true').trim().toLowerCase();
    return {
        enabled: raw !== '0' && raw !== 'false' && raw !== 'off',
    };
}
