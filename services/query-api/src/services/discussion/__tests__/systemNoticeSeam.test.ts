import {
    buildDiscussionSystemNoticeSeed,
    prepareStructuredDiscussionWriteMetadata,
} from '../systemNoticeSeam';

describe('systemNoticeSeam', () => {
    test('reuses structured metadata normalization for discussion write path', () => {
        const metadata = prepareStructuredDiscussionWriteMetadata({
            discussionLabels: ['emotion', 'fact', 'invalid'],
            primaryDiscussionLabel: 'fact',
            selectedForCandidate: true,
        });

        expect(metadata).toEqual({
            authorAnnotations: ['fact', 'emotion'],
            primaryAuthorAnnotation: 'fact',
            selectedForCandidate: true,
        });
    });

    test('builds validated draft candidate notice seed', () => {
        const seed = buildDiscussionSystemNoticeSeed({
            messageKind: 'draft_candidate_notice',
            metadata: {
                candidateId: 'cand_001',
                state: 'proposal_active',
            },
            payloadText: 'candidate notice',
            subjectType: 'discussion_message',
            subjectId: 'env_001',
        });

        expect(seed).toEqual({
            messageKind: 'draft_candidate_notice',
            metadata: {
                candidateId: 'cand_001',
                state: 'proposal_active',
            },
            payloadText: 'candidate notice',
            subjectType: 'discussion_message',
            subjectId: 'env_001',
        });
    });

    test('rejects unknown system notice kinds', () => {
        const seed = buildDiscussionSystemNoticeSeed({
            messageKind: 'candidate_card_state',
            metadata: { candidateId: 'cand_002' },
        });

        expect(seed).toBeNull();
    });
});
