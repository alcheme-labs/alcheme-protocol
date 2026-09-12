export type CircleGenesisMode = 'BLANK' | 'SEEDED';

export function normalizeCircleGenesisMode(value: unknown): CircleGenesisMode {
    const raw = String(value ?? '').trim();
    if (raw === 'Seeded' || raw.toUpperCase() === 'SEEDED') {
        return 'SEEDED';
    }
    return 'BLANK';
}

export function normalizeCircleGenesisModeForStorage(value: unknown): CircleGenesisMode {
    const normalized = String(value ?? '').trim();
    if (normalized === 'BLANK') return 'BLANK';
    if (normalized === 'SEEDED') return 'SEEDED';
    throw new Error(`invalid genesis mode: ${String(value ?? '')}`);
}
