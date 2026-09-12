export interface DiscussionProviderFailure {
    code: string;
    message: string;
}

export class DiscussionAnalysisProviderError extends Error {
    readonly code: string;
    readonly retryable = true;

    constructor(code: string, message: string) {
        super(message || code);
        this.name = 'DiscussionAnalysisProviderError';
        this.code = normalizeDiscussionProviderCode(code);
    }
}

export function classifyDiscussionProviderFailure(error: unknown): DiscussionProviderFailure {
    const message = normalizeDiscussionProviderMessage(error);
    const rawCode = error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
        ? String((error as { code: string }).code).trim()
        : '';

    if (rawCode.startsWith('discussion_provider_') || rawCode === 'discussion_topic_profile_embedding_unavailable') {
        return {
            code: normalizeDiscussionProviderCode(rawCode),
            message,
        };
    }

    if (rawCode === 'provider_rate_limited' || /\b(rate limit|rpm limit|too many requests)\b/i.test(message)) {
        return {
            code: 'discussion_provider_rate_limited',
            message,
        };
    }

    if (rawCode === 'provider_timeout' || /\b(timeout|timed out)\b/i.test(message)) {
        return {
            code: 'discussion_provider_timeout',
            message,
        };
    }

    return {
        code: 'discussion_provider_failed',
        message,
    };
}

export function toDiscussionAnalysisProviderError(error: unknown): DiscussionAnalysisProviderError {
    if (error instanceof DiscussionAnalysisProviderError) {
        return error;
    }
    const failure = classifyDiscussionProviderFailure(error);
    return new DiscussionAnalysisProviderError(failure.code, failure.message);
}

export function isDiscussionAnalysisProviderError(error: unknown): error is DiscussionAnalysisProviderError {
    if (error instanceof DiscussionAnalysisProviderError) return true;
    const code = error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
        ? String((error as { code: string }).code).trim()
        : '';
    return code.startsWith('discussion_provider_') || code === 'discussion_topic_profile_embedding_unavailable';
}

export function isProviderFailureLike(error: unknown): boolean {
    if (isDiscussionAnalysisProviderError(error)) return true;
    const message = normalizeDiscussionProviderMessage(error);
    const code = error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
        ? String((error as { code: string }).code).trim()
        : '';
    if (code.startsWith('provider_')) return true;
    return /^builtin_ai_gateway_unavailable:/i.test(message)
        || /\b(rate limit|rpm limit|too many requests|timeout|timed out|fetch failed|network|econnreset|enotfound)\b/i.test(message)
        || /\bbuiltin ai (embedding|text) request\b/i.test(message);
}

function normalizeDiscussionProviderCode(value: string): string {
    const text = String(value || '').trim();
    return (text || 'discussion_provider_failed').slice(0, 128);
}

function normalizeDiscussionProviderMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
        return error.message.trim().slice(0, 512);
    }
    if (typeof error === 'string' && error.trim()) {
        return error.trim().slice(0, 512);
    }
    return 'discussion provider failed';
}
