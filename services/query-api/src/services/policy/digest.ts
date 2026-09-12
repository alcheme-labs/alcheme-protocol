import { createHash } from 'node:crypto';
export { buildPublicPolicyDigestSnapshot } from './profile';
import type { PublicPolicyDigestSnapshot } from './types';

function normalizeForDigest(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((entry) => normalizeForDigest(entry));
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        return Object.keys(record)
            .sort((left, right) => left.localeCompare(right))
            .reduce<Record<string, unknown>>((accumulator, key) => {
                accumulator[key] = normalizeForDigest(record[key]);
                return accumulator;
            }, {});
    }
    return value;
}

export function computePolicyProfileDigest(input: PublicPolicyDigestSnapshot): string {
    const canonical = JSON.stringify(normalizeForDigest(input));
    return createHash('sha256').update(canonical).digest('hex');
}
