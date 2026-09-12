import { BN } from '@coral-xyz/anchor';

export function encodeCircleFlags(input: {
    kind: 'main' | 'auxiliary';
    mode: 'knowledge' | 'social';
    minCrystals: number;
}): BN {
    const kindBit = input.kind === 'auxiliary' ? 1 : 0;
    const modeBit = input.mode === 'social' ? 1 : 0;
    const boundedMinCrystals = Math.max(0, Math.min(Math.floor(input.minCrystals), 0xffff));
    const flags = kindBit | (modeBit << 1) | (boundedMinCrystals << 2);
    return new BN(flags);
}
