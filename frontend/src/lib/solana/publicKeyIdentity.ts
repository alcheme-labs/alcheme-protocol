import { PublicKey } from '@solana/web3.js';

export function canonicalPublicKeyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    if (!normalized) return null;
    try {
        const publicKey = new PublicKey(normalized);
        return publicKey.toBase58() === normalized ? normalized : null;
    } catch {
        return null;
    }
}

export function publicKeyStringsEqual(left: unknown, right: unknown): boolean {
    const canonicalLeft = canonicalPublicKeyString(left);
    const canonicalRight = canonicalPublicKeyString(right);
    return canonicalLeft !== null && canonicalRight !== null && canonicalLeft === canonicalRight;
}
