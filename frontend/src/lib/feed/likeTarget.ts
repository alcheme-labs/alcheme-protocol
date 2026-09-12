import { BN } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { ONCHAIN_WRITE_ERROR_CODES } from '../solana/onchainWriteErrors.ts';

const MAX_U64 = new BN('18446744073709551615');

export interface LikePostInput {
    contentId: string;
    onChainAddress?: string | null;
    authorPubkey?: string | null;
}

export interface V2LikeTarget {
    contentId: BN;
    contentAuthor: PublicKey;
}

function tryParsePublicKey(raw: string | null | undefined): PublicKey | null {
    const normalized = String(raw || '').trim();
    if (!normalized) return null;
    try {
        return new PublicKey(normalized);
    } catch {
        return null;
    }
}

export function resolveV2LikeTarget(input: LikePostInput): V2LikeTarget {
    const normalizedContentId = String(input.contentId || '').trim();
    const authorPubkey = tryParsePublicKey(input.authorPubkey);
    if (authorPubkey && /^\d+$/.test(normalizedContentId)) {
        const contentId = new BN(normalizedContentId);
        if (contentId.gt(new BN(0)) && contentId.lte(MAX_U64)) {
            return { contentId, contentAuthor: authorPubkey };
        }
    }

    throw new Error(ONCHAIN_WRITE_ERROR_CODES.likeTargetAddressMissing);
}
