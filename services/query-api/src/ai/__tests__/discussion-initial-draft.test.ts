import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const generateAiTextMock = jest.fn();

jest.mock('../provider', () => ({
    generateAiText: generateAiTextMock,
}));

import {
    DiscussionInitialDraftError,
    generateInitialDiscussionDraft,
    loadInitialDraftSourceMessages,
} from '../discussion-initial-draft';

function createSourceRow(input: {
    envelopeId: string;
    payloadText: string;
    relevanceStatus?: string;
    semanticScore?: string | number | null;
    focusScore?: string | number | null;
    qualityScore?: string | number | null;
    decisionConfidence?: string | number | null;
}) {
    return {
        envelopeId: input.envelopeId,
        senderPubkey: `${input.envelopeId}_sender_pubkey`,
        senderHandle: null,
        payloadText: input.payloadText,
        payloadHash: `${input.envelopeId}`.padEnd(64, 'a').slice(0, 64),
        lamport: BigInt(input.envelopeId.endsWith('b') ? 2 : 1),
        createdAt: new Date(`2026-04-24T00:00:0${input.envelopeId.endsWith('b') ? 2 : 1}.000Z`),
        relevanceStatus: input.relevanceStatus ?? 'ready',
        semanticScore: input.semanticScore ?? null,
        focusScore: input.focusScore ?? null,
        qualityScore: input.qualityScore ?? null,
        spamScore: null,
        decisionConfidence: input.decisionConfidence ?? null,
        relevanceMethod: 'llm',
        semanticFacets: ['question'],
        authorAnnotations: ['fact'],
    };
}

describe('discussion initial draft generator', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('loads ready source messages in candidate order and normalizes nullable analysis metadata', async () => {
        const prisma = {
            $queryRaw: jest.fn(async () => [
                createSourceRow({
                    envelopeId: 'env_b',
                    payloadText: 'Second source message.',
                    semanticScore: '0.84',
                    focusScore: null,
                    qualityScore: null,
                    decisionConfidence: null,
                }),
                createSourceRow({
                    envelopeId: 'env_a',
                    payloadText: 'First source message.',
                    semanticScore: null,
                    focusScore: null,
                    qualityScore: null,
                    decisionConfidence: null,
                }),
            ]),
        } as any;

        const messages = await loadInitialDraftSourceMessages(prisma, {
            circleId: 7,
            sourceMessageIds: ['env_a', 'env_b'],
        });

        expect(messages.map((message) => message.envelopeId)).toEqual(['env_a', 'env_b']);
        expect(messages[0]).toMatchObject({
            payloadText: 'First source message.',
            semanticScore: 1,
            focusScore: 1,
            qualityScore: 0.5,
            decisionConfidence: 0.5,
            semanticFacets: ['question'],
            authorAnnotations: ['fact'],
        });
        expect(messages[1]).toMatchObject({
            semanticScore: 0.84,
            focusScore: 0.84,
            qualityScore: 0.5,
            decisionConfidence: 0.5,
        });
    });

    test('fails closed when any source message is not analysis-ready', async () => {
        const prisma = {
            $queryRaw: jest.fn(async () => [
                createSourceRow({
                    envelopeId: 'env_a',
                    payloadText: 'Still pending.',
                    relevanceStatus: 'pending',
                }),
            ]),
        } as any;

        await expect(loadInitialDraftSourceMessages(prisma, {
            circleId: 7,
            sourceMessageIds: ['env_a'],
        })).rejects.toMatchObject({
            code: 'source_messages_not_ready',
            retryable: true,
        } satisfies Partial<DiscussionInitialDraftError>);
    });

    test('generates a formal draft body from structured LLM output without rule fallback', async () => {
        const prisma = {
            $queryRaw: jest.fn(async () => [
                createSourceRow({
                    envelopeId: 'env_a',
                    payloadText: 'A newcomer needs a staged learning path.',
                }),
                createSourceRow({
                    envelopeId: 'env_b',
                    payloadText: 'The first stage should focus on participation before authorship.',
                }),
            ]),
        } as any;
        (generateAiTextMock as any).mockResolvedValue({
            text: JSON.stringify({
                title: 'Knowledge Circle Learning Path',
                sections: [
                    { heading: 'Context', body: 'The group is designing a staged newcomer path.' },
                    { heading: 'Core Question', body: 'When is someone ready to move from participation to authorship?' },
                    { heading: 'Current Conclusion', body: 'Start with observation and participation before asking for synthesis.' },
                    { heading: 'Learning Path / Sequence', body: 'Observe, participate, synthesize, then steward.' },
                    { heading: 'Open Questions', body: 'The final transition still needs a clearer signal.' },
                    { heading: 'Next Actions', body: 'Turn the sequence into a testable onboarding ritual.' },
                ],
            }),
            model: 'llama3.1:8b',
            providerMode: 'builtin',
            rawFinishReason: 'stop',
        });

        const result = await generateInitialDiscussionDraft(prisma, {
            circleId: 7,
            circleName: 'Knowledge Circle',
            circleDescription: null,
            sourceMessageIds: ['env_a', 'env_b'],
        });

        expect(result.title).toBe('Knowledge Circle Learning Path');
        expect(result.draftText).toContain('# Knowledge Circle Learning Path');
        expect(result.draftText).toContain('## Current Conclusion');
        expect(result.draftText).toContain('Start with observation and participation');
        expect(result.draftText).not.toContain('Of the last');
        expect(result.generationMetadata).toMatchObject({
            providerMode: 'builtin',
            model: 'llama3.1:8b',
            promptAsset: 'discussion-initial-draft',
            promptVersion: 'v1',
        });
        expect(generateAiTextMock).toHaveBeenCalledWith(expect.objectContaining({
            task: 'discussion-initial-draft',
            dataBoundary: 'private_plaintext',
        }));
    });
});
