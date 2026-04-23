jest.mock('../src/ai/provider', () => ({
    generateAiText: jest.fn(),
    generateAiEmbedding: jest.fn(),
}));

jest.mock('../src/config/services', () => ({
    serviceConfig: {
        ai: {
            mode: 'builtin',
            builtinTextApi: 'chat_completions',
        },
    },
}));

import { generateAiEmbedding, generateAiText } from '../src/ai/provider';
import { runAiSmokeCheck } from '../scripts/ai-smoke-check';

describe('ai smoke check script', () => {
    beforeEach(() => {
        jest.resetAllMocks();
    });

    test('runs one text generation and one embedding probe', async () => {
        (generateAiText as jest.Mock).mockResolvedValue({
            text: 'OK',
            model: 'deepseek-chat',
            providerMode: 'builtin',
        });
        (generateAiEmbedding as jest.Mock).mockResolvedValue({
            embedding: [0.1, 0.2, 0.3],
            model: 'bge-m3',
            providerMode: 'builtin',
        });

        const result = await runAiSmokeCheck();

        expect(generateAiText).toHaveBeenCalledWith(expect.objectContaining({
            task: 'discussion-summary',
            dataBoundary: 'public_protocol',
        }));
        expect(generateAiEmbedding).toHaveBeenCalledWith(expect.objectContaining({
            task: 'discussion-relevance',
            dataBoundary: 'public_protocol',
        }));
        expect(result).toMatchObject({
            mode: 'builtin',
            builtinTextApi: 'chat_completions',
            textModel: 'deepseek-chat',
            embeddingModel: 'bge-m3',
            embeddingDimensions: 3,
        });
    });
});
