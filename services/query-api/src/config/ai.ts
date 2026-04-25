export type AiExternalPrivateContentMode = 'deny' | 'allow';
export type AiBuiltinTextApi = 'chat_completions' | 'responses';

/**
 * AI runtime routing.
 *
 * - builtin: current primary path. query-api talks directly to an OpenAI-compatible gateway.
 * - external: reserved adapter contract for sovereign/private deployments. This repo defines the
 *   contract (`/generate-text`, `/embed`) but does not ship a production external AI service.
 */
export interface AiRuntimeConfig {
    mode: 'builtin' | 'external';
    builtinTextApi: AiBuiltinTextApi;
    externalUrl?: string;
    externalTimeoutMs: number;
    externalPrivateContentMode: AiExternalPrivateContentMode;
    gatewayUrl: string;
    gatewayKey: string;
    gatewayTimeoutMs: number;
}

export interface AiModelConfig {
    scoring: string;
    ghostDraft: string;
    discussionInitialDraft: string;
    discussionSummary: string;
    discussionTrigger: string;
    embedding: string;
}

const VALID_AI_EXTERNAL_PRIVATE_CONTENT_MODES: AiExternalPrivateContentMode[] = [
    'deny',
    'allow',
];
const VALID_AI_BUILTIN_TEXT_APIS: AiBuiltinTextApi[] = [
    'chat_completions',
    'responses',
];

function parsePositiveInt(raw: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(String(raw || ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

function parseAiExternalPrivateContentMode(
    raw: string | undefined,
    fallback: AiExternalPrivateContentMode = 'deny',
): AiExternalPrivateContentMode {
    if (typeof raw !== 'string') return fallback;
    const normalized = raw.trim().toLowerCase() as AiExternalPrivateContentMode;
    return VALID_AI_EXTERNAL_PRIVATE_CONTENT_MODES.includes(normalized) ? normalized : fallback;
}

function parseAiBuiltinTextApi(
    raw: string | undefined,
    fallback: AiBuiltinTextApi = 'chat_completions',
): AiBuiltinTextApi {
    if (typeof raw !== 'string') return fallback;
    const normalized = raw.trim().toLowerCase() as AiBuiltinTextApi;
    return VALID_AI_BUILTIN_TEXT_APIS.includes(normalized) ? normalized : fallback;
}

export function loadAiRuntimeConfig(env: NodeJS.ProcessEnv = process.env): AiRuntimeConfig {
    return {
        mode: (env.AI_MODE || 'builtin') as 'builtin' | 'external',
        builtinTextApi: parseAiBuiltinTextApi(env.AI_BUILTIN_TEXT_API),
        externalUrl: env.AI_EXTERNAL_URL,
        externalTimeoutMs: parsePositiveInt(env.AI_EXTERNAL_TIMEOUT_MS, 15000),
        externalPrivateContentMode: parseAiExternalPrivateContentMode(env.AI_EXTERNAL_PRIVATE_CONTENT_MODE),
        gatewayUrl: env.NEW_API_URL || 'http://localhost:3000/v1',
        gatewayKey: env.NEW_API_KEY || '',
        gatewayTimeoutMs: parsePositiveInt(env.NEW_API_TIMEOUT_MS || env.AI_GATEWAY_TIMEOUT_MS, 15000),
    };
}

export function loadAiModelConfig(env: NodeJS.ProcessEnv = process.env): AiModelConfig {
    return {
        scoring: env.SCORING_MODEL || 'qwen2.5:7b',
        ghostDraft: env.GHOST_DRAFT_MODEL || 'llama3.1:8b',
        discussionInitialDraft: env.DISCUSSION_INITIAL_DRAFT_MODEL || env.GHOST_DRAFT_MODEL || 'llama3.1:8b',
        discussionSummary: env.DISCUSSION_SUMMARY_MODEL || 'qwen2.5:7b',
        discussionTrigger: env.DISCUSSION_TRIGGER_MODEL || env.SCORING_MODEL || 'qwen2.5:7b',
        embedding: env.EMBEDDING_MODEL || env.DISCUSSION_EMBEDDING_MODEL || 'nomic-embed-text',
    };
}
