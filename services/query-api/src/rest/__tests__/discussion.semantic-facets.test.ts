import { normalizeDiscussionSemanticFacets } from '../discussion';

describe('discussion message semantic facets', () => {
    test('preserves every canonical semantic facet in API DTOs', () => {
        expect(normalizeDiscussionSemanticFacets([
            'fact',
            'explanation',
            'emotion',
            'question',
            'problem',
            'criteria',
            'proposal',
            'summary',
            'unknown',
            42,
        ])).toEqual([
            'fact',
            'explanation',
            'emotion',
            'question',
            'problem',
            'criteria',
            'proposal',
            'summary',
        ]);
    });
});
