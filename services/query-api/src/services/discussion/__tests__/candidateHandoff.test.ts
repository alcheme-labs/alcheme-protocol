import { parseAcceptedCandidateHandoffMetadata } from '../candidateHandoff';

describe('candidateHandoff', () => {
    test('parses accepted candidate handoff contract', () => {
        const parsed = parseAcceptedCandidateHandoffMetadata({
            candidateId: 'cand_001',
            state: 'accepted',
            draftPostId: 42,
            sourceMessageIds: ['env_a', 'env_b', 'env_a'],
            sourceDiscussionLabels: ['fact', 'emotion', 'invalid'],
            lastProposalId: 'gov_777',
        });

        expect(parsed).toEqual({
            candidateId: 'cand_001',
            draftPostId: 42,
            sourceMessageIds: ['env_a', 'env_b'],
            sourceSemanticFacets: ['fact', 'emotion'],
            sourceAuthorAnnotations: [],
            lastProposalId: 'gov_777',
        });
    });

    test('returns null for non-accepted candidate state', () => {
        const parsed = parseAcceptedCandidateHandoffMetadata({
            candidateId: 'cand_002',
            state: 'proposal_active',
            draftPostId: 42,
        });
        expect(parsed).toBeNull();
    });

    test('returns null when required fields are missing', () => {
        const parsed = parseAcceptedCandidateHandoffMetadata({
            state: 'accepted',
            draftPostId: 0,
        });
        expect(parsed).toBeNull();
    });
});
