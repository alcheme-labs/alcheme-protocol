/**
 * AI Provider — Vercel AI SDK + New API Gateway
 *
 * Shared AI provider used by Ghost Draft, summaries, triggers, and discussion intelligence.
 * Text generation routes through the existing OpenAI-compatible gateway or external service.
 * Embeddings use the same provider boundary, but via explicit HTTP requests so we can support
 * both builtin gateway and external sovereign deployments with the same contract.
 */

import { generateText, Output as AiOutput, jsonSchema } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { AiBuiltinTextApi, loadAiModelConfig } from '../config/ai';
import {
    assessBuiltinAiGatewayAvailability,
    loadNodeRuntimeConfig,
    serviceConfig,
} from '../config/services';
import { generateExternalAiEmbedding, generateExternalAiText } from './external-client';

export type AiModelTask =
    | 'scoring'
    | 'ghost-draft'
    | 'discussion-initial-draft'
    | 'discussion-summary'
    | 'discussion-trigger'
    | 'embedding';

export type AiEmbeddingTask =
    | 'discussion-relevance'
    | 'circle-topic-profile';

export type AiDataBoundary =
    | 'public_protocol'
    | 'private_plaintext';

/**
 * Create the default AI provider that routes through New API gateway.
 * New API is OpenAI-compatible, so we use @ai-sdk/openai with custom baseURL.
 */
export function getAIProvider() {
    const config = serviceConfig.ai;

    return createOpenAI({
        baseURL: config.gatewayUrl,
        apiKey: config.gatewayKey || 'sk-no-key',
    });
}

function selectBuiltinTextModel(
    provider: ReturnType<typeof createOpenAI>,
    modelId: string,
    textApi: AiBuiltinTextApi,
) {
    if (textApi === 'chat_completions') {
        return provider.chat(modelId);
    }
    return provider(modelId);
}

export function getBuiltinTextModel(modelId: string) {
    return selectBuiltinTextModel(getAIProvider(), modelId, serviceConfig.ai.builtinTextApi);
}

function normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function buildGatewayUrl(pathname: string): string {
    return new URL(pathname.replace(/^\/+/, ''), normalizeBaseUrl(serviceConfig.ai.gatewayUrl)).toString();
}

function getGatewayTimeoutMs(): number {
    const raw = Number((serviceConfig.ai as any).gatewayTimeoutMs ?? 15000);
    return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 15000;
}

const BUILTIN_EMBEDDING_MAX_ATTEMPTS = 3;
const BUILTIN_EMBEDDING_RETRYABLE_STATUSES = new Set([408, 409, 425, 429]);

class AiProviderError extends Error {
    code: string;
    status?: number;

    constructor(message: string, input: { code: string; status?: number }) {
        super(message);
        this.name = 'AiProviderError';
        this.code = input.code;
        this.status = input.status;
    }
}

function getBuiltinEmbeddingBackoffMs(attempt: number): number {
    return 250 * attempt;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableBuiltinEmbeddingStatus(status: number): boolean {
    return BUILTIN_EMBEDDING_RETRYABLE_STATUSES.has(status) || status >= 500;
}

function isProviderRateLimitMessage(message: string): boolean {
    return /\b(rate limit|rpm limit|too many requests)\b/i.test(message);
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error || '');
}

function isTimeoutError(error: unknown): boolean {
    const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
    if (record.code === 'provider_timeout' || record.name === 'AbortError') return true;
    return /\b(timeout|timed out|aborted)\b/i.test(getErrorMessage(error));
}

function buildBuiltinEmbeddingError(status: number, message: string): Error {
    if ((status === 403 || status === 429) && isProviderRateLimitMessage(message)) {
        return new AiProviderError(message, {
            code: 'provider_rate_limited',
            status,
        });
    }
    return new AiProviderError(message, {
        code: 'provider_request_failed',
        status,
    });
}

function isRetryableBuiltinEmbeddingError(error: unknown): boolean {
    if ((error as any)?.name === 'AbortError') {
        return true;
    }

    if (error instanceof TypeError) {
        return true;
    }

    const message = error instanceof Error ? error.message : String(error || '');
    return /\b(fetch failed|network|timeout|timed out|socket hang up|econnreset|enotfound)\b/i.test(message);
}

/**
 * Get the model ID to use for a given task.
 * Default models can be overridden via env.
 */
export function getModelId(
    task: AiModelTask = 'scoring',
): string {
    const modelConfig = loadAiModelConfig();
    const defaults: Record<string, string> = {
        scoring: modelConfig.scoring,
        'ghost-draft': modelConfig.ghostDraft,
        'discussion-initial-draft': modelConfig.discussionInitialDraft,
        'discussion-summary': modelConfig.discussionSummary,
        'discussion-trigger': modelConfig.discussionTrigger,
        embedding: modelConfig.embedding,
    };
    return defaults[task] || 'qwen2.5:7b';
}

export interface GenerateAiTextInput {
    task: Exclude<AiModelTask, 'embedding'>;
    systemPrompt?: string | null;
    userPrompt: string;
    temperature?: number;
    maxOutputTokens?: number;
    responseFormat?: {
        type: 'json';
        schema?: unknown;
        name?: string;
        description?: string;
    };
    dataBoundary?: AiDataBoundary;
}

function buildStructuredOutput(
    responseFormat?: GenerateAiTextInput['responseFormat'],
) {
    if (!responseFormat || responseFormat.type !== 'json') {
        return undefined;
    }

    return AiOutput.object({
        schema: jsonSchema((responseFormat.schema as any) ?? {
            type: 'object',
            additionalProperties: true,
        }),
        name: responseFormat.name,
        description: responseFormat.description,
    });
}

export interface GenerateAiTextResult {
    text: string;
    model: string;
    providerMode: 'builtin' | 'external';
    rawFinishReason?: string | null;
}

export interface GenerateAiEmbeddingInput {
    task: AiEmbeddingTask;
    text: string;
    dataBoundary?: AiDataBoundary;
}

export interface GenerateAiEmbeddingResult {
    embedding: number[];
    model: string;
    providerMode: 'builtin' | 'external';
}

export function assertAiTaskAllowed(input: {
    task: AiModelTask;
    dataBoundary?: AiDataBoundary;
}): void {
    const runtime = loadNodeRuntimeConfig();
    if ((input.dataBoundary ?? 'public_protocol') === 'private_plaintext' && runtime.runtimeRole !== 'PRIVATE_SIDECAR') {
        throw new Error('private_sidecar_required');
    }

    if (serviceConfig.ai.mode !== 'external') {
        return;
    }

    const dataBoundary = input.dataBoundary ?? 'public_protocol';
    if (dataBoundary === 'private_plaintext' && serviceConfig.ai.externalPrivateContentMode !== 'allow') {
        throw new Error('external_ai_private_content_consent_required');
    }
}

export async function generateAiText(
    input: GenerateAiTextInput,
): Promise<GenerateAiTextResult> {
    const modelId = getModelId(input.task);

    if (serviceConfig.ai.mode === 'external') {
        assertAiTaskAllowed({
            task: input.task,
            dataBoundary: input.dataBoundary,
        });
        const text = await generateExternalAiText({
            task: input.task,
            model: modelId,
            systemPrompt: input.systemPrompt ?? null,
            userPrompt: input.userPrompt,
            temperature: input.temperature,
            maxOutputTokens: input.maxOutputTokens,
        });
        return {
            text,
            model: modelId,
            providerMode: 'external',
            rawFinishReason: null,
        };
    }

    const timeoutMs = getGatewayTimeoutMs();
    let result;
    try {
        result = await generateText({
            model: getBuiltinTextModel(modelId),
            system: input.systemPrompt ?? undefined,
            prompt: input.userPrompt,
            temperature: input.temperature ?? 0.1,
            maxOutputTokens: input.maxOutputTokens ?? 400,
            output: buildStructuredOutput(input.responseFormat),
            timeout: timeoutMs,
        });
    } catch (error) {
        if (isTimeoutError(error)) {
            throw new AiProviderError(`builtin ai text request timed out after ${timeoutMs}ms`, {
                code: 'provider_timeout',
            });
        }
        throw error;
    }

    return {
        text: String(result.text || '').trim(),
        model: modelId,
        providerMode: 'builtin',
        rawFinishReason: result.rawFinishReason ?? null,
    };
}

export async function generateAiEmbedding(
    input: GenerateAiEmbeddingInput,
): Promise<GenerateAiEmbeddingResult> {
    const modelId = getModelId('embedding');

    if (serviceConfig.ai.mode === 'external') {
        assertAiTaskAllowed({
            task: 'embedding',
            dataBoundary: input.dataBoundary,
        });
        const embedding = await generateExternalAiEmbedding({
            task: input.task,
            model: modelId,
            text: input.text,
        });
        return {
            embedding,
            model: modelId,
            providerMode: 'external',
        };
    }

    const gateway = assessBuiltinAiGatewayAvailability(serviceConfig.ai.gatewayUrl);
    if (!gateway.available) {
        throw new Error(`builtin_ai_gateway_unavailable:${gateway.reason}`);
    }

    const timeoutMs = getGatewayTimeoutMs();

    for (let attempt = 1; attempt <= BUILTIN_EMBEDDING_MAX_ATTEMPTS; attempt += 1) {
        const controller = new AbortController();
        const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const headers: Record<string, string> = {
                'content-type': 'application/json',
            };
            if (serviceConfig.ai.gatewayKey) {
                headers.authorization = `Bearer ${serviceConfig.ai.gatewayKey}`;
            }

            const response = await fetch(buildGatewayUrl('/embeddings'), {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: modelId,
                    input: input.text,
                }),
                signal: controller.signal,
            });

            if (!response.ok) {
                let message = `builtin ai embedding request failed with status ${response.status}`;
                try {
                    const payload = await response.json();
                    if (typeof payload?.error?.message === 'string' && payload.error.message.trim()) {
                        message = payload.error.message.trim();
                    } else if (typeof payload?.message === 'string' && payload.message.trim()) {
                        message = payload.message.trim();
                    }
                } catch {
                    // ignore parse failures
                }

                if (attempt < BUILTIN_EMBEDDING_MAX_ATTEMPTS && isRetryableBuiltinEmbeddingStatus(response.status)) {
                    await sleep(getBuiltinEmbeddingBackoffMs(attempt));
                    continue;
                }
                throw buildBuiltinEmbeddingError(response.status, message);
            }

            const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
            const data = Array.isArray(payload?.data) ? payload.data : null;
            const candidate = data
                ? (data[0] as { embedding?: unknown } | undefined)?.embedding
                : payload?.embedding;
            if (!Array.isArray(candidate) || candidate.length === 0) {
                throw new Error('builtin ai embedding response did not include embedding');
            }

            const embedding = candidate
                .map((value) => Number(value))
                .filter((value) => Number.isFinite(value));
            if (embedding.length === 0) {
                throw new Error('builtin ai embedding response did not include embedding');
            }

            return {
                embedding,
                model: modelId,
                providerMode: 'builtin',
            };
        } catch (error) {
            const normalizedError = (error as any)?.name === 'AbortError'
                ? new AiProviderError(`builtin ai embedding request timed out after ${timeoutMs}ms`, {
                    code: 'provider_timeout',
                })
                : error;

            if (attempt < BUILTIN_EMBEDDING_MAX_ATTEMPTS && isRetryableBuiltinEmbeddingError(error)) {
                await sleep(getBuiltinEmbeddingBackoffMs(attempt));
                continue;
            }

            throw normalizedError;
        } finally {
            clearTimeout(timeoutHandle);
        }
    }

    throw new Error('builtin ai embedding request failed after retries');
}
