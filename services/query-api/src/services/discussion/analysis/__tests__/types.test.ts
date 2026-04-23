import { describe, expect, test } from '@jest/globals';

import {
    AUTHOR_ANNOTATION_KINDS,
    buildPendingDiscussionAnalysisResult,
    DISCUSSION_ANALYSIS_STATUSES,
    DISCUSSION_FOCUS_LABELS,
    DISCUSSION_SEMANTIC_FACETS,
} from '../types';

describe('discussion analysis types', () => {
    test('exports the canonical status, focus, and semantic facet enums', () => {
        expect(DISCUSSION_ANALYSIS_STATUSES).toEqual(['pending', 'ready', 'stale', 'failed']);
        expect(DISCUSSION_FOCUS_LABELS).toEqual(['focused', 'contextual', 'off_topic']);
        expect(DISCUSSION_SEMANTIC_FACETS).toEqual([
            'fact',
            'explanation',
            'emotion',
            'question',
            'problem',
            'criteria',
            'proposal',
            'summary',
        ]);
        expect(AUTHOR_ANNOTATION_KINDS).toEqual(['fact', 'explanation', 'emotion']);
    });

    test('builds a pending analysis snapshot with safe defaults', () => {
        const pending = buildPendingDiscussionAnalysisResult({
            analysisVersion: 'v1',
            topicProfileVersion: 'topic-7',
            authorAnnotations: [{ kind: 'fact', source: 'author' }],
        });

        expect(pending).toEqual({
            relevanceStatus: 'pending',
            semanticScore: null,
            embeddingScore: null,
            qualityScore: null,
            spamScore: null,
            decisionConfidence: null,
            relevanceMethod: null,
            actualMode: null,
            analysisVersion: 'v1',
            topicProfileVersion: 'topic-7',
            focusScore: null,
            focusLabel: null,
            semanticFacets: [],
            isFeatured: false,
            featureReason: null,
            analysisCompletedAt: null,
            analysisErrorCode: null,
            analysisErrorMessage: null,
            authorAnnotations: [{ kind: 'fact', source: 'author' }],
        });
    });
});
