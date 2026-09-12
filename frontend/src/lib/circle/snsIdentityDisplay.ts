export interface SnsWalletDetailLike {
    canonicalActorPubkey: string;
    secondarySnsLabel?: string | null;
    shortPubkey: string;
}

export function formatWalletDetailWithOptionalSns(input: {
    pubkey: string | null | undefined;
    secondarySnsLabel?: string | null;
    shortPubkey: (value: string) => string;
}): SnsWalletDetailLike | null {
    const pubkey = typeof input.pubkey === 'string' ? input.pubkey.trim() : '';
    if (!pubkey) return null;
    const lower = pubkey.toLowerCase();
    if (lower.endsWith('.sol') || lower.includes('.sol')) return null;
    const secondary = typeof input.secondarySnsLabel === 'string' ? input.secondarySnsLabel.trim() : '';
    return {
        canonicalActorPubkey: pubkey,
        secondarySnsLabel: secondary.toLowerCase().endsWith('.sol') ? secondary : null,
        shortPubkey: input.shortPubkey(pubkey),
    };
}
