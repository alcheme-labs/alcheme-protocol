import { describe, expect, test } from '@jest/globals';
import { resolvers } from '../resolvers';

describe('GraphQL knowledge stats heat', () => {
    test('prefers knowledge heat score over source draft fallback', () => {
        const stats = (resolvers as any).Knowledge.stats({
            qualityScore: 91,
            citationCount: 5,
            viewCount: 0,
            heatScore: 27.25,
            sourceDraftHeatScore: 13,
        });

        expect(stats.qualityScore).toBe(91);
        expect(stats.citationCount).toBe(5);
        expect(stats.heatScore).toBe(27.25);
    });

    test('does not revive source draft heat after crystal heat decays to zero', () => {
        const stats = (resolvers as any).Knowledge.stats({
            qualityScore: 91,
            citationCount: 5,
            viewCount: 0,
            heatScore: 0,
            sourceDraftHeatScore: 13,
            sourceContentId: 'draft-content-42',
        });

        expect(stats.heatScore).toBe(0);
    });
});
