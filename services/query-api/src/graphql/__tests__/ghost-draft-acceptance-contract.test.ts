import { describe, expect, jest, test } from '@jest/globals';
import { print } from 'graphql';

import { typeDefs } from '../schema';
import { resolvers } from '../resolvers';
import * as acceptanceService from '../../services/ghostDraft/acceptance';

describe('ghost draft graphql contract', () => {
    test('schema exposes provenance and acceptance types', () => {
        const schemaSource = print(typeDefs);

        expect(schemaSource).toContain('type GhostDraftProvenance');
        expect(schemaSource).toContain('generationId: Int!');
        expect(schemaSource).toContain('type GhostDraftSuggestion');
        expect(schemaSource).toContain('suggestions: [GhostDraftSuggestion!]!');
        expect(schemaSource).toContain('type GhostDraftAcceptanceResult');
        expect(schemaSource).toContain('acceptedSuggestion: GhostDraftSuggestion');
        expect(schemaSource).toContain('acceptedThreadIds: [ID!]!');
        expect(schemaSource).toContain('acceptGhostDraft(input: AcceptGhostDraftInput!): GhostDraftAcceptanceResult!');
    });

    test('acceptGhostDraft mutation applies one structured suggestion into the working copy', async () => {
        const acceptanceSpy = jest.spyOn(acceptanceService, 'acceptGhostDraftIntoWorkingCopy')
            .mockResolvedValue({
                generation: {
                    generationId: 15,
                    postId: 42,
                    draftText: 'AI baseline',
                    suggestions: [
                        {
                            suggestionId: 'paragraph:1#501',
                            targetType: 'paragraph',
                            targetRef: 'paragraph:1',
                            threadIds: ['501'],
                            issueTypes: ['knowledge_supplement'],
                            summary: '补上验收人与时间线。',
                            suggestedText: '第二段：补上验收人为治理小组，时间线为本周五前完成首轮确认。',
                        },
                    ],
                    model: 'ghost-model',
                    generatedAt: new Date('2026-03-24T12:00:00.000Z'),
                    provenance: {
                        origin: 'ai',
                        providerMode: 'builtin',
                        model: 'ghost-model',
                        promptAsset: 'ghost-draft-comment',
                        promptVersion: 'v1',
                        sourceDigest: 'a'.repeat(64),
                        ghostRunId: null,
                    },
                },
                applied: true,
                changed: true,
                acceptanceId: 88,
                acceptanceMode: 'accept_suggestion',
                acceptedAt: new Date('2026-03-24T12:01:00.000Z'),
                acceptedByUserId: 8,
                acceptedThreadIds: ['501'],
                acceptedSuggestion: {
                    suggestionId: 'paragraph:1#501',
                    targetType: 'paragraph',
                    targetRef: 'paragraph:1',
                    threadIds: ['501'],
                    issueTypes: ['knowledge_supplement'],
                    summary: '补上验收人与时间线。',
                    suggestedText: '第二段：补上验收人为治理小组，时间线为本周五前完成首轮确认。',
                },
                workingCopyContent: 'AI baseline',
                workingCopyHash: 'b'.repeat(64),
                updatedAt: new Date('2026-03-24T12:01:00.000Z'),
                heatScore: 9,
            });

        const result = await (resolvers as any).Mutation.acceptGhostDraft(
            {},
            {
                input: {
                    postId: 42,
                    generationId: 15,
                    mode: 'ACCEPT_SUGGESTION',
                    suggestionId: 'paragraph:1#501',
                    workingCopyHash: 'c'.repeat(64),
                    workingCopyUpdatedAt: '2026-03-24T12:00:00.000Z',
                },
            },
            { prisma: {}, userId: 8 },
        );

        expect(acceptanceSpy).toHaveBeenCalledWith({}, {
            draftPostId: 42,
            generationId: 15,
            suggestionId: 'paragraph:1#501',
            userId: 8,
            mode: 'accept_suggestion',
            workingCopyHash: 'c'.repeat(64),
            workingCopyUpdatedAt: '2026-03-24T12:00:00.000Z',
        });
        expect(result).toMatchObject({
            applied: true,
            workingCopyContent: 'AI baseline',
            workingCopyHash: 'b'.repeat(64),
            acceptedThreadIds: ['501'],
            acceptedSuggestion: {
                suggestionId: 'paragraph:1#501',
            },
            generation: {
                generationId: 15,
                suggestions: [
                    expect.objectContaining({
                        suggestionId: 'paragraph:1#501',
                    }),
                ],
            },
        });
    });
});
