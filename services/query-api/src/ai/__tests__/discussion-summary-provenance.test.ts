import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const generateTextMock = jest.fn();

jest.mock('ai', () => ({
    generateText: generateTextMock,
    Output: {
        object: jest.fn((input) => input),
    },
    jsonSchema: jest.fn((schema) => schema),
}));

import { serviceConfig } from '../../config/services';
import { summarizeDiscussionThread } from '../discussion-summary';

const baseMessages = [
    {
        senderHandle: 'alice',
        senderPubkey: 'alice-pubkey',
        text: '我们已经对结论 A 形成了共识。',
        createdAt: new Date('2026-03-24T21:00:00.000Z'),
        relevanceScore: 0.95,
    },
    {
        senderHandle: 'bob',
        senderPubkey: 'bob-pubkey',
        text: '还需要补一条来源证据。',
        createdAt: new Date('2026-03-24T21:01:00.000Z'),
        relevanceScore: 0.82,
    },
];

describe('discussion summary provenance', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns llm generation metadata when llm summarization succeeds', async () => {
        (generateTextMock as any).mockResolvedValueOnce({
            text: '当前共识：结论 A 已形成。未解决问题：证据链待补。下一步建议：补齐引用。',
        });

        const result = await summarizeDiscussionThread({
            circleName: 'Alpha',
            circleDescription: '讨论场',
            useLLM: true,
            messages: baseMessages,
        });

        expect(result).toMatchObject({
            method: 'llm',
            messageCount: 2,
            generationMetadata: {
                providerMode: 'builtin',
                model: 'qwen2.5:7b',
                promptAsset: 'discussion-summary',
                promptVersion: 'v1',
            },
        });
        expect(result.generationMetadata.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
    });

    test('still returns rule provenance metadata when llm is disabled or unavailable', async () => {
        const result = await summarizeDiscussionThread({
            circleName: 'Alpha',
            useLLM: false,
            messages: baseMessages,
        });

        expect(result).toMatchObject({
            method: 'rule',
            generationMetadata: {
                providerMode: 'rule',
                model: 'rule-based',
                promptAsset: 'discussion-summary',
                promptVersion: 'v1',
            },
        });
        expect(result.generationMetadata.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
    });

    test('still allows external AI for public discussion summaries even when private-content external consent remains disabled', async () => {
        const originalMode = serviceConfig.ai.mode;
        const originalExternalUrl = serviceConfig.ai.externalUrl;
        const originalExternalPrivateContentMode = (serviceConfig.ai as any).externalPrivateContentMode;
        const originalFetch = globalThis.fetch;

        try {
            serviceConfig.ai.mode = 'external';
            serviceConfig.ai.externalUrl = 'https://external.example/ai';
            (serviceConfig.ai as any).externalPrivateContentMode = 'deny';
            globalThis.fetch = jest.fn(async () => ({
                ok: true,
                status: 200,
                json: async () => ({
                    text: '当前共识：结论 A 已形成。未解决问题：证据链待补。下一步建议：补齐引用。',
                }),
            })) as any;

            const result = await summarizeDiscussionThread({
                circleName: 'Alpha',
                circleDescription: '讨论场',
                useLLM: true,
                messages: baseMessages,
            });

            expect(result).toMatchObject({
                method: 'llm',
                generationMetadata: {
                    providerMode: 'external',
                    model: 'qwen2.5:7b',
                },
            });
        } finally {
            serviceConfig.ai.mode = originalMode;
            serviceConfig.ai.externalUrl = originalExternalUrl;
            (serviceConfig.ai as any).externalPrivateContentMode = originalExternalPrivateContentMode;
            globalThis.fetch = originalFetch;
        }
    });
});
