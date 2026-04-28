'use client';

import { useCallback, useRef, useState } from 'react';
import { BN } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { useAlchemeSDK } from './useAlchemeSDK';
import { waitForIndexedSlot, waitForSignatureSlot } from '@/lib/api/sync';

interface UseLikePostOptions {
    onIndexed?: () => Promise<void> | void;
}

interface LikePostInput {
    contentId: string;
    onChainAddress?: string | null;
    authorPubkey?: string | null;
}

interface UseLikePostReturn {
    likePost: (input: LikePostInput) => Promise<string | null>;
    pendingContentIds: Set<string>;
    error: string | null;
}

interface LikeTargetPdaResolver {
    findContentPostPda: (author: PublicKey, contentId: BN) => PublicKey;
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

export function resolveLikeTargetPostPda(
    input: LikePostInput,
    pdaResolver: LikeTargetPdaResolver,
): PublicKey {
    const onChainTarget = tryParsePublicKey(input.onChainAddress);
    if (onChainTarget) {
        return onChainTarget;
    }

    const directContentTarget = tryParsePublicKey(input.contentId);
    if (directContentTarget) {
        return directContentTarget;
    }

    const normalizedContentId = String(input.contentId || '').trim();
    const authorPubkey = tryParsePublicKey(input.authorPubkey);
    if (authorPubkey && /^\d+$/.test(normalizedContentId)) {
        return pdaResolver.findContentPostPda(authorPubkey, new BN(normalizedContentId));
    }

    throw new Error('无法解析帖子链上地址，请稍后刷新重试');
}

export function useLikePost(options: UseLikePostOptions = {}): UseLikePostReturn {
    const sdk = useAlchemeSDK();
    const [pendingContentIds, setPendingContentIds] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);
    const pendingRef = useRef<Set<string>>(new Set());

    const likePost = useCallback(async (input: LikePostInput): Promise<string | null> => {
        if (!sdk?.provider.publicKey) {
            setError('请先连接钱包');
            return null;
        }
        if (pendingRef.current.has(input.contentId)) {
            return null;
        }

        pendingRef.current = new Set(pendingRef.current).add(input.contentId);
        setPendingContentIds(new Set(pendingRef.current));
        setError(null);

        try {
            const contentPostPda = resolveLikeTargetPostPda(input, sdk.pda);
            const signature = await sdk.content.interactWithContent(contentPostPda, { like: {} });
            const signatureSlot = await waitForSignatureSlot(sdk.connection, signature);
            if (signatureSlot !== null) {
                const indexWait = await waitForIndexedSlot(signatureSlot);
                if (indexWait.ok) {
                    await options.onIndexed?.();
                } else {
                    setError('点赞已提交链上，但索引尚未追平，列表可能稍后刷新。');
                }
            } else {
                await options.onIndexed?.();
            }
            return signature;
        } catch (err) {
            const message = err instanceof Error ? err.message : '点赞失败';
            setError(message);
            return null;
        } finally {
            const next = new Set(pendingRef.current);
            next.delete(input.contentId);
            pendingRef.current = next;
            setPendingContentIds(new Set(next));
        }
    }, [options, sdk]);

    return {
        likePost,
        pendingContentIds,
        error,
    };
}
