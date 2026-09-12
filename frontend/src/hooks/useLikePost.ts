'use client';

import { useCallback, useRef, useState } from 'react';
import { useAlchemeSDK } from './useAlchemeSDK';
import { useI18n } from '@/i18n/useI18n';
import { waitForIndexedSlot, waitForSignatureSlot } from '@/lib/api/sync';
import {
    resolveV2LikeTarget,
    type LikePostInput,
} from '@/lib/feed/likeTarget';
import {
    getRawErrorMessage,
    ONCHAIN_WRITE_ERROR_CODES,
} from '@/lib/solana/onchainWriteErrors';

interface UseLikePostOptions {
    onIndexed?: () => Promise<void> | void;
}

interface UseLikePostReturn {
    likePost: (input: LikePostInput) => Promise<string | null>;
    pendingContentIds: Set<string>;
    error: string | null;
}

export { resolveV2LikeTarget } from '@/lib/feed/likeTarget';

export function useLikePost(options: UseLikePostOptions = {}): UseLikePostReturn {
    const sdk = useAlchemeSDK();
    const t = useI18n('WalletOnchainWrite');
    const [pendingContentIds, setPendingContentIds] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);
    const pendingRef = useRef<Set<string>>(new Set());

    const likePost = useCallback(async (input: LikePostInput): Promise<string | null> => {
        if (!sdk?.provider.publicKey) {
            setError(t('errors.walletRequired'));
            return null;
        }
        if (pendingRef.current.has(input.contentId)) {
            return null;
        }

        pendingRef.current = new Set(pendingRef.current).add(input.contentId);
        setPendingContentIds(new Set(pendingRef.current));
        setError(null);

        try {
            const target = resolveV2LikeTarget(input);
            const signature = await sdk.content.likeContentV2ById(
                target.contentId,
                target.contentAuthor,
            );
            const signatureSlot = await waitForSignatureSlot(sdk.connection, signature);
            if (signatureSlot !== null) {
                const indexWait = await waitForIndexedSlot(signatureSlot);
                if (indexWait.ok) {
                    await options.onIndexed?.();
                } else {
                    setError(t('errors.usefulIndexLagging'));
                }
            } else {
                await options.onIndexed?.();
            }
            return signature;
        } catch (err) {
            const raw = getRawErrorMessage(err);
            const message = raw.includes(ONCHAIN_WRITE_ERROR_CODES.likeTargetAddressMissing)
                ? t('errors.likeTargetAddressMissing')
                : raw || t('errors.usefulFailed');
            setError(message);
            return null;
        } finally {
            const next = new Set(pendingRef.current);
            next.delete(input.contentId);
            pendingRef.current = next;
            setPendingContentIds(new Set(next));
        }
    }, [options, sdk, t]);

    return {
        likePost,
        pendingContentIds,
        error,
    };
}
