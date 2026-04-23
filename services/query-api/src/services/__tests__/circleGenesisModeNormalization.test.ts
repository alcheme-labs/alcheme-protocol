import { describe, expect, test } from '@jest/globals';

import {
    normalizeCircleGenesisMode,
    normalizeCircleGenesisModeForStorage,
} from '../circleGenesisMode';

describe('circle genesis mode normalization', () => {
    test('maps legacy and null values onto canonical BLANK | SEEDED truth', () => {
        expect(normalizeCircleGenesisMode(null)).toBe('BLANK');
        expect(normalizeCircleGenesisMode(undefined)).toBe('BLANK');
        expect(normalizeCircleGenesisMode('Fractal')).toBe('BLANK');
        expect(normalizeCircleGenesisMode('Organic')).toBe('BLANK');
        expect(normalizeCircleGenesisMode('Seeded')).toBe('SEEDED');
        expect(normalizeCircleGenesisMode('SEEDED')).toBe('SEEDED');
        expect(normalizeCircleGenesisMode('BLANK')).toBe('BLANK');
    });

    test('storage normalizer only accepts canonical values and rejects unknown input', () => {
        expect(normalizeCircleGenesisModeForStorage('BLANK')).toBe('BLANK');
        expect(normalizeCircleGenesisModeForStorage('SEEDED')).toBe('SEEDED');
        expect(() => normalizeCircleGenesisModeForStorage('Seeded')).toThrow(/invalid genesis mode/i);
        expect(() => normalizeCircleGenesisModeForStorage('Organic')).toThrow(/invalid genesis mode/i);
    });
});
