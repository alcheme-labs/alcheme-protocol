'use client';

import { useCallback, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { useAlchemeSDK } from './useAlchemeSDK';
import { useI18n } from '@/i18n/useI18n';
import { bindPostToCircle } from '@/lib/api/bindPostToCircle';
import { waitForIndexedSlot, waitForSignatureSlot } from '@/lib/api/sync';
import { fetchSessionMe } from '@/lib/api/session';
import {
    normalizeContentMutationError,
    type ContentMutationErrorCopy,
} from '@/lib/content/onchainWriteCopy';
import {
    buildV2RouteOptions,
    isV2ContentIdConflictError,
    resolveBindContentId,
    resolveContentWriteMode,
    resolveIdentityHandleForV2,
} from '@/lib/content/writeRoute';
import { ONCHAIN_WRITE_ERROR_CODES } from '@/lib/solana/onchainWriteErrors';

interface CreateFeedReplyInput {
    parentContentId: string;
    parentAuthorPubkey?: string;
    circleId: number;
    text: string;
}

interface UseCreateFeedReplyReturn {
    createReply: (input: CreateFeedReplyInput) => Promise<string | null>;
    loading: boolean;
    error: string | null;
    clearError: () => void;
}

export function useCreateFeedReply(): UseCreateFeedReplyReturn {
    const sdk = useAlchemeSDK();
    const t = useI18n('WalletOnchainWrite');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const clearError = useCallback(() => {
        setError(null);
    }, []);

    const createReply = useCallback(async (input: CreateFeedReplyInput): Promise<string | null> => {
        const contentMutationErrorCopy: ContentMutationErrorCopy = {
            bindCircleAuthorityMissing: t('errors.bindCircleAuthorityMissing'),
            bindCircleFailed: t('errors.bindCircleFailed'),
            bindCircleTimeout: t('errors.bindCircleTimeout'),
            sessionHandleMissing: t('errors.sessionHandleMissing'),
            sdkV2ContentIdUnavailable: t('errors.sdkV2ContentIdUnavailable'),
            v2ContentIdConflictRetryFailed: t('errors.v2ContentIdConflictRetryFailed'),
        };
        if (!sdk?.provider.publicKey) {
            setError(t('errors.walletRequired'));
            return null;
        }
        const text = input.text.trim();
        if (!text) {
            setError(t('errors.replyEmpty'));
            return null;
        }

        setLoading(true);
        setError(null);

        try {
            const writeMode = resolveContentWriteMode(process.env.NEXT_PUBLIC_CONTENT_WRITE_MODE);
            const contentApi = sdk.content as any;
            const author = sdk.provider.publicKey;
            const parentRaw = String(input.parentContentId || '').trim();
            const parentIsNumericId = /^\d+$/.test(parentRaw);
            const session = await fetchSessionMe().catch(() => ({ authenticated: false as const }));
            const identityHandle = resolveIdentityHandleForV2(writeMode, session);
            const routeOptions = buildV2RouteOptions(
                writeMode,
                identityHandle,
                process.env.NEXT_PUBLIC_IDENTITY_REGISTRY_NAME || 'social_hub_identity',
            );
            if (!routeOptions || routeOptions.useV2 !== true) {
                throw new Error('v2 route options unavailable');
            }
            const nextV2ContentId = async () => {
                if (typeof contentApi.createV2ContentId === 'function') {
                    return contentApi.createV2ContentId();
                }
                if (typeof contentApi.getNextV2ContentId === 'function') {
                    return contentApi.getNextV2ContentId();
                }
                throw new Error(ONCHAIN_WRITE_ERROR_CODES.sdkV2ContentIdUnavailable);
            };

            const maxAttempts = 3;
            let lastConflictError: unknown = null;
            for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
                const contentId = await nextV2ContentId();
                const expectedContentId = sdk.pda.findContentPostPda(author, contentId).toBase58();
                const bindContentId = resolveBindContentId(writeMode, contentId, expectedContentId);
                const fallbackContentIds = [expectedContentId];
                try {
                    const signature = parentIsNumericId
                        ? await contentApi.createReplyById(
                            contentId,
                            new BN(parentRaw),
                            text,
                            'Post',
                            undefined,
                            {
                                ...routeOptions,
                                parentAuthorPubkey: String(input.parentAuthorPubkey || '').trim(),
                            },
                        )
                        : await contentApi.createReply(
                            contentId,
                            new PublicKey(input.parentContentId),
                            text,
                            'Post',
                            undefined,
                            routeOptions,
                        );

                    const signatureSlot = await waitForSignatureSlot(sdk.connection, signature);
                    if (signatureSlot !== null) {
                        const indexWait = await waitForIndexedSlot(signatureSlot);
                        if (!indexWait.ok) {
                            setError(t('errors.replyIndexLagging'));
                        }
                    }

                    await bindPostToCircle({
                        contentId: bindContentId,
                        circleId: input.circleId,
                        text,
                        fallbackContentIds,
                    });

                    return signature;
                } catch (error) {
                    if (
                        isV2ContentIdConflictError(error) &&
                        attempt < maxAttempts - 1
                    ) {
                        lastConflictError = error;
                        await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 30));
                        continue;
                    }
                    throw error;
                }
            }
            throw lastConflictError || new Error(ONCHAIN_WRITE_ERROR_CODES.v2ContentIdConflictRetryFailed);
        } catch (err) {
            const message = normalizeContentMutationError(err, contentMutationErrorCopy, t('errors.replyFailed'));
            setError(message);
            return null;
        } finally {
            setLoading(false);
        }
    }, [sdk, t]);

    return {
        createReply,
        loading,
        error,
        clearError,
    };
}
