import { describe, expect, test } from '@jest/globals';

import { resolvers } from '../resolvers';

describe('Circle.genesisMode resolver', () => {
    test('normalizes legacy stored values onto explicit product truth', async () => {
        expect((resolvers as any).Circle.genesisMode({ genesisMode: null })).toBe('BLANK');
        expect((resolvers as any).Circle.genesisMode({ genesisMode: 'Fractal' })).toBe('BLANK');
        expect((resolvers as any).Circle.genesisMode({ genesisMode: 'Organic' })).toBe('BLANK');
        expect((resolvers as any).Circle.genesisMode({ genesisMode: 'Seeded' })).toBe('SEEDED');
        expect((resolvers as any).Circle.genesisMode({ genesisMode: 'SEEDED' })).toBe('SEEDED');
    });
});
