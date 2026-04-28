import { describe, expect, jest, test } from '@jest/globals';

import { generateCircleSummarySnapshot } from '../generator';

function getQueryText(query: any): string {
    return Array.isArray(query?.strings)
        ? query.strings.join(' ')
        : String(query || '');
}

function makePrisma() {
    return {
        $queryRaw: jest.fn(async (query: any) => {
            const queryText = getQueryText(query);

            if (queryText.includes('FROM knowledge k')) {
                return [{
                    knowledgeId: 'knowledge-1',
                    title: 'Alpha conclusion',
                    version: 2,
                    citationCount: 3,
                    createdAt: new Date('2026-03-24T20:00:00.000Z'),
                    contributorsCount: 2,
                    sourceDraftPostId: 42,
                    sourceAnchorId: 'anchor-1',
                    sourceSummaryHash: 'summary-hash',
                    sourceMessagesDigest: 'messages-digest',
                    proofPackageHash: 'proof-hash',
                    bindingVersion: 1,
                    bindingCreatedAt: new Date('2026-03-24T20:30:00.000Z'),
                    outboundReferenceCount: 1,
                    inboundReferenceCount: 2,
                }];
            }
            if (queryText.includes('FROM draft_workflow_state dws')) {
                return [{
                    draftPostId: 42,
                    documentStatus: 'drafting',
                    currentSnapshotVersion: 4,
                    updatedAt: new Date('2026-03-24T21:00:00.000Z'),
                    draftVersion: 4,
                    sourceSummaryHash: 'summary-hash',
                    sourceMessagesDigest: 'messages-digest',
                }];
            }
            if (queryText.includes('FROM draft_discussion_threads')) {
                return [{
                    openThreadCount: 1,
                    totalThreadCount: 2,
                }];
            }

            throw new Error(`unexpected query: ${queryText}`);
        }),
    } as any;
}

function hasHan(value: unknown): boolean {
    return /[\u3400-\u9fff]/u.test(JSON.stringify(value));
}

describe('circle summary generator i18n boundary', () => {
    test('generates fixed projection copy in the requested locale with English fallback for es/fr', async () => {
        const generatedAt = new Date('2026-03-24T22:00:00.000Z');

        const enSnapshot = await generateCircleSummarySnapshot(makePrisma(), {
            circleId: 7,
            generatedAt,
            locale: 'en',
        });
        const zhSnapshot = await generateCircleSummarySnapshot(makePrisma(), {
            circleId: 7,
            generatedAt,
            locale: 'zh',
        });
        const esSnapshot = await generateCircleSummarySnapshot(makePrisma(), {
            circleId: 7,
            generatedAt,
            locale: 'es',
        });

        expect(hasHan(enSnapshot.issueMap)).toBe(false);
        expect(hasHan(enSnapshot.sedimentationTimeline)).toBe(false);
        expect(hasHan(enSnapshot.openQuestions)).toBe(false);
        expect(hasHan(esSnapshot.issueMap)).toBe(false);
        expect(hasHan(esSnapshot.openQuestions)).toBe(false);
        expect(hasHan(zhSnapshot.issueMap)).toBe(true);
        expect(enSnapshot.generationMetadata).toMatchObject({ locale: 'en' });
        expect(esSnapshot.generationMetadata).toMatchObject({ locale: 'es' });
        expect(zhSnapshot.generationMetadata).toMatchObject({ locale: 'zh' });
        expect(enSnapshot.viewpointBranches[0]).toMatchObject({
            citationCount: 3,
            outboundReferenceCount: 1,
            inboundReferenceCount: 2,
            createdAt: '2026-03-24T20:00:00.000Z',
        });
    });
});
