import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

const mockGenerateText = jest.fn();
const mockOutputObject = jest.fn(({ schema, name, description }: any) => ({
    name: 'object',
    responseFormat: Promise.resolve({
        type: 'json',
        schema: schema?.__mockJsonSchema ?? schema,
        ...(name ? { name } : {}),
        ...(description ? { description } : {}),
    }),
}));
const mockJsonSchema = jest.fn((schema: unknown) => ({
    __mockJsonSchema: schema,
}));
const mockOpenAiProvider = Object.assign(
    jest.fn((modelId: string) => ({ api: 'responses', modelId })),
    {
        chat: jest.fn((modelId: string) => ({ api: 'chat_completions', modelId })),
    },
);
const mockCreateOpenAI = jest.fn(() => mockOpenAiProvider);

jest.mock('ai', () => ({
    generateText: mockGenerateText,
    Output: {
        object: mockOutputObject,
    },
    jsonSchema: mockJsonSchema,
}));

jest.mock('@ai-sdk/openai', () => ({
    createOpenAI: mockCreateOpenAI,
}));

import { serviceConfig } from '../../config/services';
import { generateAiText } from '../provider';

describe('builtin ai provider text api selection', () => {
    const originalAiMode = serviceConfig.ai.mode;
    const originalBuiltinTextApi = serviceConfig.ai.builtinTextApi;
    const originalGatewayUrl = serviceConfig.ai.gatewayUrl;
    const originalGatewayKey = serviceConfig.ai.gatewayKey;
    const originalScoringModel = process.env.SCORING_MODEL;
    const originalSummaryModel = process.env.DISCUSSION_SUMMARY_MODEL;

    beforeEach(() => {
        jest.clearAllMocks();
        serviceConfig.ai.mode = 'builtin';
        serviceConfig.ai.builtinTextApi = 'chat_completions';
        serviceConfig.ai.gatewayUrl = 'https://gateway.example/v1';
        serviceConfig.ai.gatewayKey = 'gateway-secret';
        process.env.SCORING_MODEL = 'score-model';
        process.env.DISCUSSION_SUMMARY_MODEL = 'summary-model';
        (mockGenerateText as any).mockResolvedValue({
            text: '  OK  ',
        });
    });

    afterEach(() => {
        serviceConfig.ai.mode = originalAiMode;
        serviceConfig.ai.builtinTextApi = originalBuiltinTextApi;
        serviceConfig.ai.gatewayUrl = originalGatewayUrl;
        serviceConfig.ai.gatewayKey = originalGatewayKey;
        if (originalScoringModel === undefined) {
            delete process.env.SCORING_MODEL;
        } else {
            process.env.SCORING_MODEL = originalScoringModel;
        }
        if (originalSummaryModel === undefined) {
            delete process.env.DISCUSSION_SUMMARY_MODEL;
        } else {
            process.env.DISCUSSION_SUMMARY_MODEL = originalSummaryModel;
        }
    });

    test('uses chat-completions model selection when AI_BUILTIN_TEXT_API=chat_completions', async () => {
        const result = await generateAiText({
            task: 'discussion-summary',
            userPrompt: 'Return exactly: OK',
        });

        expect(mockOpenAiProvider.chat).toHaveBeenCalledWith('summary-model');
        expect(mockOpenAiProvider).not.toHaveBeenCalledWith('summary-model');
        expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({
            model: {
                api: 'chat_completions',
                modelId: 'summary-model',
            },
        }));
        expect(result).toMatchObject({
            text: 'OK',
            providerMode: 'builtin',
            model: 'summary-model',
        });
    });

    test('uses responses model selection when AI_BUILTIN_TEXT_API=responses', async () => {
        serviceConfig.ai.builtinTextApi = 'responses';

        await generateAiText({
            task: 'discussion-summary',
            userPrompt: 'Return exactly: OK',
        });

        expect(mockOpenAiProvider).toHaveBeenCalledWith('summary-model');
        expect(mockOpenAiProvider.chat).not.toHaveBeenCalled();
        expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({
            model: {
                api: 'responses',
                modelId: 'summary-model',
            },
        }));
    });

    test('passes json responseFormat through to the chat-completions provider', async () => {
        await generateAiText({
            task: 'discussion-summary',
            userPrompt: 'Return exactly: OK',
            responseFormat: {
                type: 'json',
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['summary'],
                    properties: {
                        summary: { type: 'string' },
                    },
                },
                name: 'discussion_summary',
            },
        } as any);

        expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({
            output: expect.objectContaining({
                name: 'object',
            }),
        }));

        const output = (mockGenerateText.mock.calls[0][0] as any).output;
        const responseFormat = await output.responseFormat;
        expect(responseFormat).toEqual({
            type: 'json',
            schema: {
                type: 'object',
                additionalProperties: false,
                required: ['summary'],
                properties: {
                    summary: { type: 'string' },
                },
            },
            name: 'discussion_summary',
        });
    });
});
