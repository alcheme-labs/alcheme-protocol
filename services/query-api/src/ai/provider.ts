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
import { callAiCapability } from '../services/aiOperatingLayer/capabilities/adapter';

export type AiModelTask =
    | 'scoring'
    | 'ghost-draft'
    | 'accepted-issue-revision'
    | 'discussion-initial-draft'
    | 'discussion-summary'
    | 'discussion-trigger'
    | 'place-prompt'
    | 'configuration-copilot'
    | 'settings-text-assist'
    | 'style-advisor'
    | 'anchored-interaction-suggestion'
    | 'knowledge-relationship-label-classifier'
    | 'knowledge-relationship-label-coverage-audit'
    | 'circle-cognitive-map-explain'
    | 'contribution-assessment'
    | 'source-grounded-ask'
    | 'neutral-evaluation'
    | 'circle-growth-advisor'
    | 'embedding';

export type AiEmbeddingTask =
    | 'discussion-relevance'
    | 'circle-topic-profile';

export type AiDataBoundary =
    | 'public_protocol'
    | 'private_plaintext';

type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonValue[]
    | { [key: string]: JsonValue | undefined };

type AiProviderOptions = Record<string, { [key: string]: JsonValue | undefined }>;

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
const BUILTIN_TEXT_MAX_ATTEMPTS = 3;

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

function getBuiltinTextBackoffMs(attempt: number): number {
    return 250 * attempt;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableBuiltinEmbeddingStatus(status: number): boolean {
    return BUILTIN_EMBEDDING_RETRYABLE_STATUSES.has(status) || status >= 500;
}

function isRetryableBuiltinTextError(error: unknown): boolean {
    const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
    const status = Number(record.status);
    if (Number.isInteger(status) && isRetryableBuiltinEmbeddingStatus(status)) return true;
    if (error instanceof TypeError) return true;
    return /\b(fetch failed|network|temporarily overloaded|temporarily unavailable|service unavailable|socket hang up|econnreset|enotfound)\b/i
        .test(getErrorMessage(error));
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

function shouldUseBuiltinChatCompletionsDirect(input: GenerateAiTextInput): boolean {
    return input.task === 'contribution-assessment'
        && serviceConfig.ai.builtinTextApi === 'chat_completions';
}

function readOpenAiCompatibleReasoningOption(
    providerOptions: GenerateAiTextInput['providerOptions'],
): JsonValue | undefined {
    const openAiReasoning = providerOptions?.openai?.reasoning;
    if (openAiReasoning && typeof openAiReasoning === 'object') return openAiReasoning;
    const openRouterReasoning = providerOptions?.openrouter?.reasoning;
    if (openRouterReasoning && typeof openRouterReasoning === 'object') return openRouterReasoning;
    return undefined;
}

function buildOpenAiCompatibleResponseFormat(
    responseFormat: GenerateAiTextInput['responseFormat'],
): JsonValue | undefined {
    if (!responseFormat || responseFormat.type !== 'json') return undefined;
    // json_object is the widest common structured-output contract across the
    // OpenAI-compatible gateways used by Demo. The task parser remains the
    // authority that enforces the supplied schema.
    return { type: 'json_object' };
}

function readHttpStatus(value: unknown): number | null {
    const status = Number(value);
    return Number.isInteger(status) && status >= 400 && status <= 599 ? status : null;
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

function buildBuiltinTextError(status: number, message: string): Error {
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
        'accepted-issue-revision': modelConfig.ghostDraft,
        'discussion-initial-draft': modelConfig.discussionInitialDraft,
        'discussion-summary': modelConfig.discussionSummary,
        'discussion-trigger': modelConfig.discussionTrigger,
        'place-prompt': modelConfig.placePrompt,
        'configuration-copilot': modelConfig.configurationCopilot,
        'settings-text-assist': modelConfig.settingsTextAssist,
        'style-advisor': modelConfig.styleAdvisor,
        'anchored-interaction-suggestion': modelConfig.anchoredInteractionSuggestion,
        'knowledge-relationship-label-classifier': modelConfig.knowledgeRelationshipLabelClassifier,
        'knowledge-relationship-label-coverage-audit': modelConfig.knowledgeRelationshipLabelCoverageAudit,
        'circle-cognitive-map-explain': modelConfig.circleCognitiveMapExplain,
        'contribution-assessment': modelConfig.contributionAssessment,
        'source-grounded-ask': modelConfig.sourceGroundedAsk,
        'neutral-evaluation': modelConfig.neutralEvaluation,
        'circle-growth-advisor': modelConfig.circleGrowthAdvisor,
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
    providerOptions?: AiProviderOptions;
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

function normalizeGeneratedTextResult(
    result: {
        text?: unknown;
        output?: unknown;
        experimental_output?: unknown;
    },
    responseFormat?: GenerateAiTextInput['responseFormat'],
): string {
    const text = String(result.text || '').trim();
    if (text) return text;
    if (!responseFormat || responseFormat.type !== 'json') return '';
    const structuredOutput = result.output ?? result.experimental_output;
    if (structuredOutput === undefined || structuredOutput === null) return '';
    return JSON.stringify(structuredOutput);
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

async function generateAiTextDirect(
    input: GenerateAiTextInput,
): Promise<GenerateAiTextResult> {
    const modelId = getModelId(input.task);
    assertAiTaskAllowed({
        task: input.task,
        dataBoundary: input.dataBoundary,
    });

    if (serviceConfig.ai.mode === 'external') {
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

    if (shouldUseBuiltinChatCompletionsDirect(input)) {
        return generateBuiltinChatCompletionsTextDirect(input, modelId);
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
            providerOptions: input.providerOptions,
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
        text: normalizeGeneratedTextResult(result, input.responseFormat),
        model: modelId,
        providerMode: 'builtin',
        rawFinishReason: result.rawFinishReason ?? null,
    };
}

async function generateBuiltinChatCompletionsTextDirect(
    input: GenerateAiTextInput,
    modelId: string,
): Promise<GenerateAiTextResult> {
    const gateway = assessBuiltinAiGatewayAvailability(serviceConfig.ai.gatewayUrl);
    if (!gateway.available) {
        throw new Error(`builtin_ai_gateway_unavailable:${gateway.reason}`);
    }

    const timeoutMs = getGatewayTimeoutMs();
    const deadline = Date.now() + timeoutMs;
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (input.systemPrompt?.trim()) {
        messages.push({
            role: 'system',
            content: input.systemPrompt.trim(),
        });
    }
    messages.push({
        role: 'user',
        content: input.userPrompt,
    });

    const reasoning = readOpenAiCompatibleReasoningOption(input.providerOptions);
    const responseFormat = buildOpenAiCompatibleResponseFormat(input.responseFormat);
    const body: Record<string, JsonValue | undefined> = {
        model: modelId,
        messages,
        temperature: input.temperature ?? 0.1,
        max_tokens: input.maxOutputTokens ?? 400,
        ...(reasoning ? { reasoning } : {}),
        ...(responseFormat ? { response_format: responseFormat } : {}),
    };

    const headers: Record<string, string> = {
        'content-type': 'application/json',
    };
    if (serviceConfig.ai.gatewayKey) {
        headers.authorization = `Bearer ${serviceConfig.ai.gatewayKey}`;
    }

    for (let attempt = 1; attempt <= BUILTIN_TEXT_MAX_ATTEMPTS; attempt += 1) {
        const controller = new AbortController();
        const remainingMs = Math.max(1, deadline - Date.now());
        const timeoutHandle = setTimeout(() => controller.abort(), remainingMs);
        try {
            const response = await fetch(buildGatewayUrl('/chat/completions'), {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
            const providerError = payload?.error;
            const providerErrorRecord = providerError && typeof providerError === 'object'
                ? providerError as Record<string, unknown>
                : null;
            if (!response.ok || (providerError !== undefined && providerError !== null)) {
                const message = typeof providerError === 'string' && providerError.trim()
                    ? providerError.trim()
                    : typeof providerErrorRecord?.message === 'string' && providerErrorRecord.message.trim()
                        ? providerErrorRecord.message.trim()
                        : typeof payload?.message === 'string' && payload.message.trim()
                            ? payload.message.trim()
                            : `builtin ai text request failed with status ${response.status}`;
                const status = readHttpStatus(providerErrorRecord?.code)
                    ?? readHttpStatus(providerErrorRecord?.status)
                    ?? (response.ok ? 502 : response.status);
                throw buildBuiltinTextError(status, message);
            }

            const choices = Array.isArray(payload?.choices) ? payload.choices : [];
            const firstChoice = choices[0] && typeof choices[0] === 'object'
                ? choices[0] as Record<string, unknown>
                : null;
            const message = firstChoice?.message && typeof firstChoice.message === 'object'
                ? firstChoice.message as Record<string, unknown>
                : null;
            const text = typeof message?.content === 'string' ? message.content.trim() : '';
            if (!text) {
                throw new AiProviderError('builtin ai text response did not include content', {
                    code: 'provider_empty_output',
                });
            }
            return {
                text,
                model: modelId,
                providerMode: 'builtin',
                rawFinishReason: typeof firstChoice?.finish_reason === 'string'
                    ? firstChoice.finish_reason
                    : null,
            };
        } catch (error) {
            const normalizedError = isTimeoutError(error)
                ? new AiProviderError(`builtin ai text request timed out after ${timeoutMs}ms`, {
                    code: 'provider_timeout',
                })
                : error;
            const backoffMs = getBuiltinTextBackoffMs(attempt);
            if (
                attempt < BUILTIN_TEXT_MAX_ATTEMPTS
                && isRetryableBuiltinTextError(normalizedError)
                && Date.now() + backoffMs < deadline
            ) {
                const errorRecord = normalizedError && typeof normalizedError === 'object'
                    ? normalizedError as Record<string, unknown>
                    : {};
                console.warn('[ai-provider][chat-completions-retry]', {
                    task: input.task,
                    model: modelId,
                    attempt,
                    maxAttempts: BUILTIN_TEXT_MAX_ATTEMPTS,
                    errorCode: typeof errorRecord.code === 'string' ? errorRecord.code : 'provider_error_unclassified',
                    errorStatus: readHttpStatus(errorRecord.status),
                });
                await sleep(backoffMs);
                continue;
            }
            throw normalizedError;
        } finally {
            clearTimeout(timeoutHandle);
        }
    }

    throw new AiProviderError('builtin ai text request failed after retries', {
        code: 'provider_request_failed',
    });
}

export async function generateAiText(
    input: GenerateAiTextInput,
): Promise<GenerateAiTextResult> {
    const mapped = mapTextProviderTaskToCapability(input.task);
    if (!mapped) {
        return generateAiTextDirect(input);
    }

    const result = await callAiCapability({
        taskType: mapped.taskType,
        capability: mapped.capability,
        privacyProfile: input.dataBoundary,
        input: {
            prompt: input.userPrompt,
            systemPrompt: input.systemPrompt,
            responseFormat: input.responseFormat,
            providerOptions: input.providerOptions,
            temperature: input.temperature,
            maxOutputTokens: input.maxOutputTokens,
        },
    }, {
        generateAiText: generateAiTextDirect,
        generateAiEmbedding: generateAiEmbeddingDirect,
        assertAiTaskAllowed,
    });

    return {
        text: String(result.output.text || '').trim(),
        model: result.model,
        providerMode: result.providerProfile,
        rawFinishReason: typeof result.output.rawFinishReason === 'string'
            ? result.output.rawFinishReason
            : null,
    };
}

async function generateAiEmbeddingDirect(
    input: GenerateAiEmbeddingInput,
): Promise<GenerateAiEmbeddingResult> {
    const modelId = getModelId('embedding');
    assertAiTaskAllowed({
        task: 'embedding',
        dataBoundary: input.dataBoundary,
    });

    if (serviceConfig.ai.mode === 'external') {
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
                    const payload = await response.json() as {
                        error?: { message?: unknown };
                        message?: unknown;
                    };
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

export async function generateAiEmbedding(
    input: GenerateAiEmbeddingInput,
): Promise<GenerateAiEmbeddingResult> {
    const result = await callAiCapability({
        taskType: input.task === 'circle-topic-profile'
            ? 'discussion.reanalyze.v1'
            : 'discussion.analysis.v1',
        capability: 'text.embed',
        privacyProfile: input.dataBoundary,
        input: {
            text: input.text,
        },
    }, {
        generateAiText: generateAiTextDirect,
        generateAiEmbedding: generateAiEmbeddingDirect,
        assertAiTaskAllowed,
    });

    return {
        embedding: Array.isArray(result.output.embedding)
            ? result.output.embedding.map((value) => Number(value)).filter((value) => Number.isFinite(value))
            : [],
        model: result.model,
        providerMode: result.providerProfile,
    };
}

function mapTextProviderTaskToCapability(
    task: Exclude<AiModelTask, 'embedding'>,
): {
    taskType: string;
    capability: 'text.generate' | 'text.structure';
} | null {
    if (task === 'ghost-draft') {
        return {
            taskType: 'draft.ghost_revision.v1',
            capability: 'text.generate',
        };
    }
    if (task === 'accepted-issue-revision') {
        return {
            taskType: 'draft.accepted_issue_revision.v1',
            capability: 'text.generate',
        };
    }
    if (task === 'discussion-summary') {
        return {
            taskType: 'discussion.summary.v1',
            capability: 'text.generate',
        };
    }
    if (task === 'discussion-trigger') {
        return {
            taskType: 'discussion.trigger.v1',
            capability: 'text.structure',
        };
    }
    if (task === 'configuration-copilot') {
        return {
            taskType: 'configuration.copilot.v1',
            capability: 'text.structure',
        };
    }
    if (task === 'settings-text-assist') {
        return {
            taskType: 'settings.field_text_suggestion.v1',
            capability: 'text.structure',
        };
    }
    if (task === 'style-advisor') {
        return {
            taskType: 'style.life_feel_advisor.v1',
            capability: 'text.structure',
        };
    }
    if (task === 'source-grounded-ask') {
        return {
            taskType: 'source.grounded_ask.v1',
            capability: 'text.structure',
        };
    }
    if (task === 'knowledge-relationship-label-classifier') {
        return {
            taskType: 'knowledge.relationship_label_classify.v1',
            capability: 'text.structure',
        };
    }
    if (task === 'knowledge-relationship-label-coverage-audit') {
        return {
            taskType: 'knowledge.relationship_label_coverage_audit.v1',
            capability: 'text.structure',
        };
    }
    if (task === 'circle-cognitive-map-explain') {
        return {
            taskType: 'circle.cognitive_map_explain.v1',
            capability: 'text.structure',
        };
    }
    if (task === 'contribution-assessment') {
        return {
            taskType: 'contribution.assessment_suggest.v1',
            capability: 'text.structure',
        };
    }
    return null;
}
