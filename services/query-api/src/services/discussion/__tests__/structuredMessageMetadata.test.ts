import {
    buildStructuredDiscussionMetadata,
    extractStructuredDiscussionMetadata,
} from '../structuredMessageMetadata';

describe('structuredMessageMetadata', () => {
    test('extracts author annotations from metadata array and normalizes primary annotation', () => {
        const parsed = extractStructuredDiscussionMetadata({
            discussionLabels: ['emotion', 'fact', 'fact', 'unknown'],
            primaryDiscussionLabel: 'explanation',
            focusTag: '  topic-a  ',
            selectedForCandidate: true,
        });

        expect(parsed).toEqual({
            authorAnnotations: ['fact', 'emotion'],
            primaryAuthorAnnotation: 'explanation',
            focusTag: 'topic-a',
            selectedForCandidate: true,
        });
    });

    test('supports legacy single-label metadata fallback', () => {
        const parsed = extractStructuredDiscussionMetadata({
            discussionLabel: 'fact',
        });

        expect(parsed.authorAnnotations).toEqual(['fact']);
        expect(parsed.primaryAuthorAnnotation).toBe('fact');
    });

    test('builds null when no structured fields are present', () => {
        const built = buildStructuredDiscussionMetadata({
            random: 'value',
        });
        expect(built).toBeNull();
    });

    test('builds sanitized payload', () => {
        const built = buildStructuredDiscussionMetadata({
            discussionLabels: ['emotion', 'fact', 'invalid'],
            primaryDiscussionLabel: 'fact',
            focusTag: '  abc  ',
            selectedForCandidate: 1,
        });

        expect(built).toEqual({
            authorAnnotations: ['fact', 'emotion'],
            primaryAuthorAnnotation: 'fact',
            focusTag: 'abc',
            selectedForCandidate: true,
        });
    });
});
