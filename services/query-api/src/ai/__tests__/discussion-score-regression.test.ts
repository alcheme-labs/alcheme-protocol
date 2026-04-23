import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

const generateStructuredOutputMock = jest.fn() as any;

jest.mock('../discussion-intelligence/llm', () => ({
    generateStructuredOutput: generateStructuredOutputMock,
}));

import { serviceConfig } from '../../config/services';
import { analyzeDiscussionMessage } from '../discussion-intelligence/analyzer';

interface DiscussionScoreFixtureCase {
    input: {
        text: string;
        circleContext?: string;
        useLLM?: boolean;
    };
    llmResponse?: Record<string, unknown>;
    expected: {
        method: 'rule' | 'hybrid';
        semanticScore: number;
        qualityScore: number;
        spamScore: number;
        confidence: number;
        isOnTopic: boolean;
        rationale: string;
    };
}

function loadFixture(): Record<string, DiscussionScoreFixtureCase> {
    const filePath = path.resolve(__dirname, '../evals/fixtures/discussion-score.json');
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, DiscussionScoreFixtureCase>;
}

describe('discussion score regression pack', () => {
    const fixture = loadFixture();
    const originalAiMode = serviceConfig.ai.mode;

    beforeEach(() => {
        jest.clearAllMocks();
        serviceConfig.ai.mode = 'builtin';
    });

    afterEach(() => {
        serviceConfig.ai.mode = originalAiMode;
    });

    test('rule scoring fixture stays stable for on-topic and spam cases', async () => {
        const caseIds = ['rule_on_topic', 'rule_spam'] as const;

        for (const caseId of caseIds) {
            const current = fixture[caseId];
            const result = await analyzeDiscussionMessage(current.input);

            expect(result.method).toBe(current.expected.method);
            expect(result.isOnTopic).toBe(current.expected.isOnTopic);
            expect(result.rationale).toBe(current.expected.rationale);
            expect(result.semanticScore).toBeCloseTo(current.expected.semanticScore, 4);
            expect(result.qualityScore).toBeCloseTo(current.expected.qualityScore, 4);
            expect(result.spamScore).toBeCloseTo(current.expected.spamScore, 4);
            expect(result.confidence).toBeCloseTo(current.expected.confidence, 4);
        }
    });

    test('hybrid scoring fixture stays stable for structured llm output blending', async () => {
        const current = fixture.hybrid_llm;
        generateStructuredOutputMock.mockResolvedValueOnce(current.llmResponse as any);

        const result = await analyzeDiscussionMessage(current.input);

        expect(generateStructuredOutputMock).toHaveBeenCalledTimes(1);
        expect(result.method).toBe(current.expected.method);
        expect(result.isOnTopic).toBe(current.expected.isOnTopic);
        expect(result.rationale).toBe(current.expected.rationale);
        expect(result.semanticScore).toBeCloseTo(current.expected.semanticScore, 4);
        expect(result.qualityScore).toBeCloseTo(current.expected.qualityScore, 4);
        expect(result.spamScore).toBeCloseTo(current.expected.spamScore, 4);
        expect(result.confidence).toBeCloseTo(current.expected.confidence, 4);
    });
});
