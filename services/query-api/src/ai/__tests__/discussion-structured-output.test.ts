import { describe, expect, jest, test } from '@jest/globals';

const generateAiTextMock = jest.fn();

jest.mock('../provider', () => ({
    generateAiText: (...args: unknown[]) => generateAiTextMock(...args),
}));

import { generateStructuredOutput } from '../discussion-intelligence/llm';

describe('discussion structured output parsing', () => {
    test('recovers the JSON object when a reasoning model wraps it in text', async () => {
        (generateAiTextMock as any).mockResolvedValueOnce({
            text: '<think>Need to classify the message.</think>\nResult:\n{"semantic_facets":["criteria"]}',
        });

        await expect(generateStructuredOutput({
            modelTask: 'scoring',
            systemPrompt: 'Return JSON only.',
            userPrompt: 'Message: test',
        })).resolves.toEqual({
            semantic_facets: ['criteria'],
        });
    });
});
