import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const generateStructuredOutputMock = jest.fn();

jest.mock('../discussion-intelligence/llm', () => ({
    generateStructuredOutput: (...args: unknown[]) => generateStructuredOutputMock(...args),
}));

import { analyzeDiscussionSemanticFacets } from '../discussion-intelligence/analyzer';

describe('discussion semantic facets llm pass', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('parses structured semantic facets from llm output', async () => {
        (generateStructuredOutputMock as any).mockResolvedValue({
            semantic_facets: ['proposal', 'question', 'criteria', 'proposal'],
        });

        const result = await analyzeDiscussionSemanticFacets({
            text: '那是不是可以先试一个保守方案？',
            circleContext: '圈层主题：讨论沉淀实验室',
            recentContext: 'Recent discussion summary:\n- Key questions: draft trigger conditions',
        });

        expect(result).toEqual(['proposal', 'question', 'criteria']);
        expect(generateStructuredOutputMock).toHaveBeenCalledWith(expect.objectContaining({
            systemPrompt: expect.stringContaining('discussion semantic-facets judge'),
        }));
    });

    test('returns null when llm output is missing or malformed', async () => {
        (generateStructuredOutputMock as any).mockResolvedValue({
            semantic_facets: 'proposal',
        });

        const result = await analyzeDiscussionSemanticFacets({
            text: '我现在有点沮丧。',
            circleContext: '圈层主题：讨论沉淀实验室',
        });

        expect(result).toBeNull();
    });
});
