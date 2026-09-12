import fs from 'fs';

export interface TrendPromptConfig {
    promptsEnabled: boolean;
    providerEnabled: boolean;
    maxInputChars: number;
    maxReceipts: number;
    userDailyLimit: number;
    pendingTtlMs: number;
    fallbackTtlMs: number;
    readyTtlMs: number;
    sourcesJson: string;
    sourcesFile: string;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
    if (raw === undefined) return fallback;
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

export function loadTrendPromptConfig(env: NodeJS.ProcessEnv = process.env): TrendPromptConfig {
    return {
        promptsEnabled: parseBoolean(env.AI_TREND_PROMPTS_ENABLED, true),
        providerEnabled: parseBoolean(env.AI_TREND_PROMPT_PROVIDER_ENABLED, true),
        maxInputChars: parsePositiveInt(env.AI_TREND_PROMPT_MAX_INPUT_CHARS, 1600),
        maxReceipts: parsePositiveInt(env.AI_TREND_PROMPT_MAX_RECEIPTS, 3),
        userDailyLimit: parsePositiveInt(env.AI_TREND_PROMPT_USER_DAILY_LIMIT, 20),
        pendingTtlMs: parsePositiveInt(env.AI_TREND_PROMPT_PENDING_TTL_MS, 5 * 60_000),
        fallbackTtlMs: parsePositiveInt(env.AI_TREND_PROMPT_FALLBACK_TTL_MS, 30 * 60_000),
        readyTtlMs: parsePositiveInt(env.AI_TREND_PROMPT_READY_TTL_MS, 60 * 60_000),
        sourcesJson: String(env.AI_TREND_SOURCES_JSON || '').trim(),
        sourcesFile: String(env.AI_TREND_SOURCES_FILE || '').trim(),
    };
}

export function readConfiguredTrendSources(config = loadTrendPromptConfig()): unknown[] {
    const raw = config.sourcesJson || readOptionalFile(config.sourcesFile);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
}

function readOptionalFile(filepath: string): string {
    if (!filepath) return '';
    try {
        return fs.readFileSync(filepath, 'utf8');
    } catch {
        return '';
    }
}
