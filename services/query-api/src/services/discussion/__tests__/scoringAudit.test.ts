import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const loadDiscussionTopicProfileMock = jest.fn();

jest.mock('../topicProfile', () => ({
    loadDiscussionTopicProfile: (...args: unknown[]) => loadDiscussionTopicProfileMock(...args),
}));

import { loadDiscussionAnalysisDiagnostics } from '../scoringAudit';

describe('discussion analysis diagnostics', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('treats stale relevance status as stale even when topic profile versions match', async () => {
        const prisma = {
            circleDiscussionMessage: {
                findUnique: jest.fn(async () => ({
                    envelopeId: 'env-1',
                    circleId: 7,
                    roomKey: 'circle:7',
                    senderPubkey: 'pubkey',
                    senderHandle: 'alice',
                    payloadText: '讨论内容',
                    metadata: null,
                    deleted: false,
                    createdAt: new Date('2026-04-01T10:00:00.000Z'),
                    updatedAt: new Date('2026-04-01T10:05:00.000Z'),
                    relevanceStatus: 'stale',
                    semanticScore: 0.42,
                    embeddingScore: 0.61,
                    qualityScore: 0.55,
                    spamScore: 0.12,
                    decisionConfidence: 0.73,
                    relevanceMethod: 'embedding',
                    actualMode: 'embedding',
                    analysisVersion: 'v2_embedding_first',
                    topicProfileVersion: 'topic:7:abcd',
                    semanticFacets: ['question'],
                    focusScore: 0.44,
                    focusLabel: 'contextual',
                    isFeatured: false,
                    featureReason: null,
                    analysisCompletedAt: new Date('2026-04-01T10:04:00.000Z'),
                    analysisErrorCode: null,
                    analysisErrorMessage: null,
                    authorAnnotations: [],
                })),
            },
        } as any;
        (loadDiscussionTopicProfileMock as any).mockResolvedValue({
            topicProfileVersion: 'topic:7:abcd',
            snapshotText: '圈层主题：异步编程',
            sourceDigest: 'digest',
            embedding: [0.1, 0.2],
            embeddingModel: 'nomic-embed-text',
            embeddingProviderMode: 'builtin',
        });

        const diagnostics = await loadDiscussionAnalysisDiagnostics(prisma, 'env-1');

        expect(diagnostics?.topicProfile.isStale).toBe(true);
        expect(diagnostics?.topicProfile.messageVersion).toBe('topic:7:abcd');
        expect(diagnostics?.topicProfile.currentVersion).toBe('topic:7:abcd');
    });
});
