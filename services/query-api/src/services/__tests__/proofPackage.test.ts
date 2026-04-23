import {
    buildCanonicalProofPackageV2,
} from '../proofPackage';
import type { DraftContributorProofRecord } from '../contributorProof';

function makeContributorProof(overrides: Partial<DraftContributorProofRecord> = {}): DraftContributorProofRecord {
    return {
        draftPostId: 42,
        circleId: 7,
        anchorId: 'a'.repeat(64),
        payloadHash: 'b'.repeat(64),
        summaryHash: 'c'.repeat(64),
        messagesDigest: 'd'.repeat(64),
        rootHex: 'e'.repeat(64),
        count: 3,
        contributors: [
            {
                pubkey: '11111111111111111111111111111113',
                role: 'Discussant',
                weightBps: 3000,
                leafHex: '1'.repeat(64),
            },
            {
                pubkey: '11111111111111111111111111111111',
                role: 'Author',
                weightBps: 5000,
                leafHex: '2'.repeat(64),
            },
            {
                pubkey: '11111111111111111111111111111112',
                role: 'Discussant',
                weightBps: 2000,
                leafHex: '3'.repeat(64),
            },
        ],
        ...overrides,
    };
}

describe('proofPackage', () => {
    test('produces deterministic hash for identical input', () => {
        const input = {
            contributorProof: makeContributorProof(),
            collabEditAnchorId: 'f'.repeat(64),
            discussionResolutionRefs: [
                'thread:2:resolution:8:application:12',
                'thread:1:resolution:4:application:5',
            ],
            generatedAt: '2026-03-13T12:00:00.000Z',
        };

        const first = buildCanonicalProofPackageV2(input);
        const second = buildCanonicalProofPackageV2(input);

        expect(first.proof_package_hash).toBe(second.proof_package_hash);
        expect(first.canonical_proof_package).toEqual(second.canonical_proof_package);
    });

    test('normalizes field/array ordering into a stable canonical package', () => {
        const ordered = buildCanonicalProofPackageV2({
            contributorProof: makeContributorProof(),
            collabEditAnchorId: 'f'.repeat(64),
            discussionResolutionRefs: [
                'thread:1:resolution:4:application:5',
                'thread:2:resolution:8:application:12',
            ],
            generatedAt: '2026-03-13T12:00:00.000Z',
        });
        const shuffled = buildCanonicalProofPackageV2({
            contributorProof: makeContributorProof({
                contributors: [
                    {
                        pubkey: '11111111111111111111111111111112',
                        role: 'Discussant',
                        weightBps: 2000,
                        leafHex: '3'.repeat(64),
                    },
                    {
                        pubkey: '11111111111111111111111111111111',
                        role: 'Author',
                        weightBps: 5000,
                        leafHex: '2'.repeat(64),
                    },
                    {
                        pubkey: '11111111111111111111111111111113',
                        role: 'Discussant',
                        weightBps: 3000,
                        leafHex: '1'.repeat(64),
                    },
                ],
            }),
            collabEditAnchorId: 'f'.repeat(64),
            discussionResolutionRefs: [
                'thread:2:resolution:8:application:12',
                'thread:1:resolution:4:application:5',
                'thread:1:resolution:4:application:5',
            ],
            generatedAt: '2026-03-13T12:00:00.000Z',
        });

        expect(shuffled.canonical_proof_package).toEqual(ordered.canonical_proof_package);
        expect(shuffled.proof_package_hash).toBe(ordered.proof_package_hash);
    });

    test('changes hash when key field changes', () => {
        const base = buildCanonicalProofPackageV2({
            contributorProof: makeContributorProof(),
            collabEditAnchorId: 'f'.repeat(64),
            discussionResolutionRefs: ['thread:1:resolution:4:application:5'],
            generatedAt: '2026-03-13T12:00:00.000Z',
        });
        const changed = buildCanonicalProofPackageV2({
            contributorProof: makeContributorProof({
                rootHex: '9'.repeat(64),
            }),
            collabEditAnchorId: 'f'.repeat(64),
            discussionResolutionRefs: ['thread:1:resolution:4:application:5'],
            generatedAt: '2026-03-13T12:00:00.000Z',
        });

        expect(changed.proof_package_hash).not.toBe(base.proof_package_hash);
    });
});
