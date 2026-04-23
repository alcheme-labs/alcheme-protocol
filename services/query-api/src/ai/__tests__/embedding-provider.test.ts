import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { assessBuiltinAiGatewayAvailability, serviceConfig } from '../../config/services';
import { cosineSimilarity } from '../embedding';
import { generateAiEmbedding } from '../provider';

function makeJsonResponse(payload: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => payload,
    } as Response;
}

describe('embedding provider', () => {
    const originalAiMode = serviceConfig.ai.mode;
    const originalGatewayUrl = serviceConfig.ai.gatewayUrl;
    const originalGatewayKey = serviceConfig.ai.gatewayKey;
    const originalGatewayTimeoutMs = (serviceConfig.ai as any).gatewayTimeoutMs;
    const originalExternalUrl = serviceConfig.ai.externalUrl;
    const originalExternalTimeoutMs = (serviceConfig.ai as any).externalTimeoutMs;
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        jest.clearAllMocks();
        serviceConfig.ai.mode = 'builtin';
        serviceConfig.ai.gatewayUrl = 'https://gateway.example/v1';
        serviceConfig.ai.gatewayKey = 'gateway-secret';
        (serviceConfig.ai as any).gatewayTimeoutMs = 2500;
        serviceConfig.ai.externalUrl = 'https://external.example/ai';
        (serviceConfig.ai as any).externalTimeoutMs = 2500;
    });

    afterEach(() => {
        serviceConfig.ai.mode = originalAiMode;
        serviceConfig.ai.gatewayUrl = originalGatewayUrl;
        serviceConfig.ai.gatewayKey = originalGatewayKey;
        (serviceConfig.ai as any).gatewayTimeoutMs = originalGatewayTimeoutMs;
        serviceConfig.ai.externalUrl = originalExternalUrl;
        (serviceConfig.ai as any).externalTimeoutMs = originalExternalTimeoutMs;
        globalThis.fetch = originalFetch;
    });

    test('builtin embedding uses the OpenAI-compatible embeddings endpoint', async () => {
        const fetchMock = jest.fn(async () => makeJsonResponse({
            data: [{ embedding: [0.1, 0.2, 0.3] }],
        }));
        globalThis.fetch = fetchMock as any;

        const result = await generateAiEmbedding({
            task: 'discussion-relevance',
            text: '异步编程与事件循环',
        });

        expect(fetchMock).toHaveBeenCalledWith(
            'https://gateway.example/v1/embeddings',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    authorization: 'Bearer gateway-secret',
                }),
            }),
        );
        expect(result).toMatchObject({
            embedding: [0.1, 0.2, 0.3],
            providerMode: 'builtin',
            model: 'nomic-embed-text',
        });
    });

    test('external embedding uses the sovereign embed endpoint', async () => {
        serviceConfig.ai.mode = 'external';
        const fetchMock = jest.fn(async () => makeJsonResponse({
            embedding: [0.9, 0.8],
        }));
        globalThis.fetch = fetchMock as any;

        const result = await generateAiEmbedding({
            task: 'circle-topic-profile',
            text: '异步编程讨论组：async await 与并发模型',
        });

        expect(fetchMock).toHaveBeenCalledWith(
            'https://external.example/ai/embed',
            expect.objectContaining({
                method: 'POST',
            }),
        );
        expect(result).toMatchObject({
            embedding: [0.9, 0.8],
            providerMode: 'external',
            model: 'nomic-embed-text',
        });
    });

    test('builtin embedding fails fast when NEW_API_URL still points at frontend dev server', async () => {
        serviceConfig.ai.gatewayUrl = 'http://localhost:3000/v1';
        await expect(generateAiEmbedding({
            task: 'discussion-relevance',
            text: '事件循环',
        })).rejects.toThrow(/frontend_dev_server_gateway/i);
    });

    test('builtin embedding retries transient 429 responses before falling back to failure', async () => {
        const responses = [
            makeJsonResponse({
                error: { message: 'rate limit exceeded' },
            }, 429),
            makeJsonResponse({
                data: [{ embedding: [0.4, 0.5, 0.6] }],
            }),
        ];
        const fetchMock = jest.fn(async () => responses.shift() as Response);
        globalThis.fetch = fetchMock as any;

        const result = await generateAiEmbedding({
            task: 'discussion-relevance',
            text: '先把讨论沉淀为草稿，再讨论执行边界',
        });

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(result).toMatchObject({
            embedding: [0.4, 0.5, 0.6],
            providerMode: 'builtin',
            model: 'nomic-embed-text',
        });
    });

    test('builtin embedding does not retry non-retryable 400 responses', async () => {
        const fetchMock = jest.fn(async () => makeJsonResponse({
            error: { message: 'invalid embedding payload' },
        }, 400));
        globalThis.fetch = fetchMock as any;

        await expect(generateAiEmbedding({
            task: 'discussion-relevance',
            text: '无效请求',
        })).rejects.toThrow('invalid embedding payload');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test('gateway availability helper marks localhost:3000 as unavailable', () => {
        expect(assessBuiltinAiGatewayAvailability('http://localhost:3000/v1')).toEqual({
            available: false,
            reason: 'frontend_dev_server_gateway',
        });
        expect(assessBuiltinAiGatewayAvailability('https://gateway.example/v1')).toEqual({
            available: true,
            reason: 'ok',
        });
    });

    test('cosine similarity returns a bounded semantic similarity score', () => {
        expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 5);
        expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
        expect(cosineSimilarity([], [1, 0])).toBe(0);
    });
});
