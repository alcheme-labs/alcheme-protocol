import {
    createAiJobHandlerError,
} from '../aiJobs/errors';

export type AiGenerationFailureCode = 'invalid_model_output' | 'provider_failed';

export function toAiGenerationFailureCode(error: unknown): AiGenerationFailureCode {
    const record = error && typeof error === 'object'
        ? error as { code?: unknown; message?: unknown }
        : null;
    const code = typeof record?.code === 'string' ? record.code.trim() : '';
    const message = error instanceof Error ? error.message : '';
    if (code === 'invalid_model_output' || message === 'invalid_model_output') {
        return 'invalid_model_output';
    }
    return 'provider_failed';
}

export function throwAiGenerationFailure(error: unknown): never {
    const code = toAiGenerationFailureCode(error);
    throw createAiGenerationFailureError(code);
}

export function createAiGenerationFailureError(code: AiGenerationFailureCode): Error {
    return createAiJobHandlerError(code, code);
}
