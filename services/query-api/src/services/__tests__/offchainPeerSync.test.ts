import { describe, expect, test, jest } from '@jest/globals';

import { ingestPeerEnvelope } from '../offchainPeerSync';

describe('ingestPeerEnvelope', () => {
    test('preserves forward-card provenance fields from remote peers', async () => {
        const queryRaw = jest.fn(async () => ([{
            lamport: 42n,
            envelopeId: 'env-forward-1',
        }]));

        const client = {
            $queryRaw: queryRaw,
        };

        await ingestPeerEnvelope(client as any, {
            envelopeId: 'env-forward-1',
            roomKey: 'circle:8',
            circleId: 8,
            senderPubkey: '9QfRrR7dW7B8d8n3k3D6Vw6m3W9R2kA2jGk4dWpP1uHz',
            senderHandle: 'bob',
            messageKind: 'forward',
            subjectType: 'discussion_message',
            subjectId: 'env-source-1',
            metadata: {
                sourceEnvelopeId: 'env-source-1',
                sourceCircleId: 7,
                sourceCircleName: 'Lv0 Circle',
                sourceLevel: 0,
                sourceAuthorHandle: 'alice',
                forwarderHandle: 'bob',
                sourceDeleted: false,
                snapshotText: '讨论材料：把这一段带到更适合继续提炼的圈层。',
            },
            text: '讨论材料：把这一段带到更适合继续提炼的圈层。',
            payloadHash: 'f'.repeat(64),
            nonce: 'abc123',
            signature: null,
            signatureVerified: true,
            authMode: 'session_token',
            sessionId: 'peer-session-1',
            relevanceScore: 1,
            relevanceStatus: 'ready',
            semanticScore: 1,
            embeddingScore: 0.91,
            qualityScore: 0.5,
            spamScore: 0,
            decisionConfidence: 0.5,
            relevanceMethod: 'rule',
            actualMode: 'embedding',
            analysisVersion: 'v2',
            topicProfileVersion: 'topic:circle:8:v3',
            semanticFacets: ['fact', 'question'],
            focusScore: 0.88,
            focusLabel: 'focused',
            isFeatured: true,
            featureReason: 'embedding_featured:aligned',
            featuredAt: '2026-03-02T10:06:00.000Z',
            analysisCompletedAt: '2026-03-02T10:06:00.000Z',
            analysisErrorCode: null,
            analysisErrorMessage: null,
            authorAnnotations: ['fact'],
            isEphemeral: true,
            expiresAt: '2026-03-03T10:05:00.000Z',
            clientTimestamp: '2026-03-02T10:05:00.000Z',
            lamport: 42,
            prevEnvelopeId: null,
            deleted: false,
            tombstoneReason: null,
            tombstonedAt: null,
            createdAt: '2026-03-02T10:05:00.000Z',
            updatedAt: '2026-03-02T10:05:00.000Z',
        });

        expect(queryRaw).toHaveBeenCalledTimes(1);
        const statementCall = (queryRaw as any).mock.calls[0] as unknown[] | undefined;
        expect(statementCall).toBeDefined();
        const strings = statementCall?.[0] as string[] | undefined;
        expect(strings).toBeDefined();
        const renderedSql = strings!.join('?');
        const values = statementCall!.slice(1);
        expect(renderedSql).toContain('message_kind');
        expect(renderedSql).toContain('subject_type');
        expect(renderedSql).toContain('subject_id');
        expect(renderedSql).toContain('metadata');
        expect(renderedSql).toContain('relevance_status');
        expect(renderedSql).toContain('embedding_score');
        expect(renderedSql).toContain('actual_mode');
        expect(renderedSql).toContain('topic_profile_version');
        expect(renderedSql).toContain('semantic_facets');
        expect(renderedSql).toContain('focus_label');
        expect(renderedSql).toContain('author_annotations');
        expect(renderedSql).toContain('is_ephemeral');
        expect(renderedSql).toContain('expires_at');
        expect(values).toContain('forward');
        expect(values).toContain('discussion_message');
        expect(values).toContain('env-source-1');
        expect(values).toContain(true);
        expect(values).toContain('ready');
        expect(values).toContain(0.91);
        expect(values).toContain('embedding');
        expect(values).toContain('topic:circle:8:v3');
        expect(values).toContain(JSON.stringify(['fact', 'question']));
        expect(values).toContain('focused');
        expect(values).toContain(JSON.stringify(['fact']));
        expect(values).toContain('session_token');
        expect(values).not.toContain('peer-session-1');
        expect(values).toContain(JSON.stringify({
            sourceEnvelopeId: 'env-source-1',
            sourceCircleId: 7,
            sourceCircleName: 'Lv0 Circle',
            sourceLevel: 0,
            sourceAuthorHandle: 'alice',
            forwarderHandle: 'bob',
            sourceDeleted: false,
            snapshotText: '讨论材料：把这一段带到更适合继续提炼的圈层。',
        }));
    });
});
