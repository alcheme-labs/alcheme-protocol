import { describe, expect, jest, test } from '@jest/globals';
import {
    loadCrystallizationOutputRecordByDraftPostId,
    loadCrystallizationOutputRecordByKnowledgeId,
} from '../readModel';

describe('crystallization read model', () => {
    test('builds formal output and evidence payloads from existing persisted projections', async () => {
        const prisma = {
            $queryRaw: jest.fn(async () => ([{
                knowledgeId: 'knowledge-9',
                sourceDraftPostId: 42,
                sourceDraftVersion: 4,
                contentHash: '1'.repeat(64),
                contributorsRoot: '2'.repeat(64),
                createdAt: new Date('2026-03-21T00:00:00.000Z'),
                sourceAnchorId: '3'.repeat(64),
                sourceSummaryHash: '4'.repeat(64),
                sourceMessagesDigest: '5'.repeat(64),
                proofPackageHash: '6'.repeat(64),
                contributorsCount: 3,
                bindingVersion: 2,
                bindingCreatedAt: new Date('2026-03-21T00:01:00.000Z'),
                policyProfileDigest: '7'.repeat(64),
            }])),
        } as any;

        const record = await loadCrystallizationOutputRecordByKnowledgeId(prisma, 'knowledge-9');

        expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
        expect(record).toMatchObject({
            output: {
                knowledgeId: 'knowledge-9',
                sourceDraftPostId: 42,
                sourceDraftVersion: 4,
                contentHash: '1'.repeat(64),
                contributorsRoot: '2'.repeat(64),
            },
            bindingEvidence: {
                sourceAnchorId: '3'.repeat(64),
                sourceSummaryHash: '4'.repeat(64),
                sourceMessagesDigest: '5'.repeat(64),
                proofPackageHash: '6'.repeat(64),
                contributorsCount: 3,
                bindingVersion: 2,
            },
            policyProfileDigest: '7'.repeat(64),
        });
        expect((record?.output as any).sourceAnchorId).toBeUndefined();
        expect((record?.output as any).proofPackageHash).toBeUndefined();
    });

    test('resolves draft-based output without introducing a second output table', async () => {
        const prisma = {
            $queryRaw: jest.fn(async (query: any) => {
                const queryText = Array.isArray(query?.strings)
                    ? query.strings.join(' ')
                    : String(query || '');
                expect(queryText).toContain('FROM knowledge k');
                expect(queryText).toContain('LEFT JOIN knowledge_binding binding');
                expect(queryText).toContain('knowledge_contributions');
                expect(queryText.toLowerCase()).not.toContain('crystal_output');

                return [{
                    knowledgeId: 'knowledge-9',
                    sourceDraftPostId: 42,
                    sourceDraftVersion: 4,
                    contentHash: '1'.repeat(64),
                    contributorsRoot: '2'.repeat(64),
                    createdAt: new Date('2026-03-21T00:00:00.000Z'),
                    sourceAnchorId: '3'.repeat(64),
                    sourceSummaryHash: '4'.repeat(64),
                    sourceMessagesDigest: '5'.repeat(64),
                    proofPackageHash: '6'.repeat(64),
                    contributorsCount: 3,
                    bindingVersion: 2,
                    bindingCreatedAt: new Date('2026-03-21T00:01:00.000Z'),
                    policyProfileDigest: null,
                }];
            }),
        } as any;

        const record = await loadCrystallizationOutputRecordByDraftPostId(prisma, 42);

        expect(record?.output.knowledgeId).toBe('knowledge-9');
        expect(record?.bindingEvidence?.sourceDraftVersion).toBe(4);
    });

    test('reads crystallization policy digest from the persisted draft milestone record', async () => {
        const prisma = {
            $queryRaw: jest.fn(async (query: any) => {
                const queryText = Array.isArray(query?.strings)
                    ? query.strings.join(' ')
                    : String(query || '');
                expect(queryText).toContain('draft_workflow_state');
                expect(queryText).toContain('crystallization_policy_profile_digest');
                expect(queryText.toLowerCase()).not.toContain('from governance_proposals');

                return [{
                    knowledgeId: 'knowledge-9',
                    sourceDraftPostId: 42,
                    sourceDraftVersion: 4,
                    contentHash: '1'.repeat(64),
                    contributorsRoot: '2'.repeat(64),
                    createdAt: new Date('2026-03-21T00:00:00.000Z'),
                    sourceAnchorId: '3'.repeat(64),
                    sourceSummaryHash: '4'.repeat(64),
                    sourceMessagesDigest: '5'.repeat(64),
                    proofPackageHash: '6'.repeat(64),
                    contributorsCount: 3,
                    bindingVersion: 2,
                    bindingCreatedAt: new Date('2026-03-21T00:01:00.000Z'),
                    policyProfileDigest: '7'.repeat(64),
                }];
            }),
        } as any;

        const record = await loadCrystallizationOutputRecordByDraftPostId(prisma, 42);

        expect(record?.policyProfileDigest).toBe('7'.repeat(64));
    });
});
