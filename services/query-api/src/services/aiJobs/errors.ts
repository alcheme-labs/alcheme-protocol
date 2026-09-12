export interface NormalizedAiJobHandlerError {
    code: string;
    message: string;
}

export class AiJobHandlerError extends Error {
    readonly code: string;

    constructor(code: string, message?: string) {
        super(message || code);
        this.name = 'AiJobHandlerError';
        this.code = normalizeAiJobErrorCode(code, 'ai_job_handler_failed');
    }
}

export function createAiJobHandlerError(code: string, message?: string): AiJobHandlerError {
    return new AiJobHandlerError(code, message);
}

export function normalizeAiJobHandlerError(error: unknown): NormalizedAiJobHandlerError {
    const record = error && typeof error === 'object'
        ? error as { code?: unknown; message?: unknown }
        : null;
    const code = normalizeAiJobErrorCode(record?.code, 'ai_job_handler_failed');
    const message = normalizeAiJobErrorMessage(error, code);
    return { code, message };
}

function normalizeAiJobErrorCode(value: unknown, fallback: string): string {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) return fallback;
    return text.slice(0, 128);
}

function normalizeAiJobErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message.trim()) {
        return error.message.trim().slice(0, 2000);
    }
    if (typeof error === 'string' && error.trim()) {
        return error.trim().slice(0, 2000);
    }
    return fallback;
}
