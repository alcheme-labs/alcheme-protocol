type ContributionAssessmentLogLevel = 'info' | 'warn';

export interface ContributionAssessmentFailureLog {
    errorName: string;
    errorCode: string;
    errorStatus: number | null;
    failureClass: string;
}

const SAFE_ERROR_TOKEN = /^[a-z][a-z0-9_.:-]{0,127}$/i;

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function safeToken(value: unknown): string | null {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized && SAFE_ERROR_TOKEN.test(normalized) ? normalized : null;
}

function safeStatus(value: unknown): number | null {
    const normalized = Number(value);
    return Number.isInteger(normalized) && normalized >= 100 && normalized <= 599
        ? normalized
        : null;
}

function classifyFailure(input: {
    code: string | null;
    status: number | null;
    messages: string[];
}): string {
    const text = [input.code ?? '', ...input.messages]
        .join(' ')
        .toLowerCase()
        .replace(/[_:-]+/g, ' ');
    if (input.status === 401 || input.status === 403 || /\b(auth|api key|unauthorized|forbidden)\b/.test(text)) {
        return 'provider_auth_failed';
    }
    if (input.status === 429 || /\b(rate limit|too many requests)\b/.test(text)) {
        return 'provider_rate_limited';
    }
    if (/\b(timeout|timed out|aborted)\b/.test(text)) return 'provider_timeout';
    if (
        /\b(model|endpoint)\b.*\b(invalid|unsupported|unavailable|not found)\b/.test(text)
        || /\bno endpoints?\b/.test(text)
    ) {
        return 'provider_model_unavailable';
    }
    if (/\b(empty output|did not include content)\b/.test(text)) return 'provider_empty_output';
    if (/\b(json|malformed output|forbidden output|unprovided evidence)\b/.test(text)) {
        return 'provider_output_invalid';
    }
    if (input.status !== null && input.status >= 500) return 'provider_upstream_failed';
    if (input.code === 'provider_request_failed') return 'provider_request_failed';
    return 'provider_error_unclassified';
}

/**
 * Produces bounded provider diagnostics without persisting prompts, raw model
 * output, credentials, response bodies, or arbitrary upstream error text.
 */
export function normalizeContributionAssessmentFailureForLog(
    error: unknown,
): ContributionAssessmentFailureLog {
    const record = asRecord(error);
    const cause = asRecord(record.cause);
    const messages = [
        error instanceof Error ? error.message : '',
        cause instanceof Error ? cause.message : typeof cause.message === 'string' ? cause.message : '',
    ].filter(Boolean);
    const errorCode = safeToken(record.code)
        ?? safeToken(cause.code)
        ?? messages.map(safeToken).find((value): value is string => value !== null)
        ?? 'provider_error_unclassified';
    const errorStatus = safeStatus(record.status)
        ?? safeStatus(record.statusCode)
        ?? safeStatus(cause.status)
        ?? safeStatus(cause.statusCode);
    return {
        errorName: safeToken(record.name) ?? 'Error',
        errorCode,
        errorStatus,
        failureClass: classifyFailure({ code: errorCode, status: errorStatus, messages }),
    };
}

function sanitizeLogPayload(payload: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
        if (value === undefined) continue;
        if (typeof value === 'bigint') {
            sanitized[key] = value.toString();
            continue;
        }
        sanitized[key] = value;
    }
    return sanitized;
}

export function logContributionAssessmentEvent(
    level: ContributionAssessmentLogLevel,
    event: string,
    payload: Record<string, unknown>,
): void {
    const normalized = sanitizeLogPayload(payload);
    const message = `[contribution-assessment][${event}]`;
    if (level === 'warn') {
        console.warn(message, normalized);
        return;
    }
    console.log(message, normalized);
}
