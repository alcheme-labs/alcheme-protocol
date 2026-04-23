import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

const generateStructuredOutputMock = jest.fn() as any;

jest.mock('../discussion-intelligence/llm', () => ({
    generateStructuredOutput: generateStructuredOutputMock,
}));

import { serviceConfig } from '../../config/services';
import { judgeDiscussionTrigger } from '../discussion-intelligence/trigger-judge';

interface TriggerFixtureCase {
    input: {
        circleName: string;
        circleDescription?: string | null;
        mode: 'notify_only' | 'auto_draft';
        allowLLM?: boolean;
        messageCount: number;
        focusedRatio: number;
        questionCount: number;
        participantCount: number;
        spamRatio: number;
        topicHeat: number;
        summary: string;
    };
    llmResponse?: Record<string, unknown>;
    expected: {
        shouldTrigger: boolean;
        recommendedAction: 'none' | 'notify_only' | 'auto_draft';
        reasonCode: string;
        reason: string;
        confidence: number;
        riskFlags: string[];
        method: 'rule' | 'llm';
    };
}

function loadFixture(): Record<string, TriggerFixtureCase> {
    const filePath = path.resolve(__dirname, '../evals/fixtures/ghost-trigger.json');
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, TriggerFixtureCase>;
}

describe('trigger judge regression pack', () => {
    const fixture = loadFixture();
    const originalAiMode = serviceConfig.ai.mode;

    beforeEach(() => {
        jest.clearAllMocks();
        serviceConfig.ai.mode = 'builtin';
    });

    afterEach(() => {
        serviceConfig.ai.mode = originalAiMode;
    });

    test('rule fallback fixture stays stable for low-signal discussions', async () => {
        const current = fixture.rule_low_signal;
        const result = await judgeDiscussionTrigger(current.input);

        expect(result).toMatchObject(current.expected);
        expect(result.confidence).toBeCloseTo(current.expected.confidence, 4);
    });

    test('llm fixture stays stable and cannot escalate notify_only mode', async () => {
        const current = fixture.llm_notify_guard;
        generateStructuredOutputMock.mockResolvedValueOnce(current.llmResponse as any);

        const result = await judgeDiscussionTrigger(current.input);

        expect(generateStructuredOutputMock).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject(current.expected);
        expect(result.confidence).toBeCloseTo(current.expected.confidence, 4);
    });
});
