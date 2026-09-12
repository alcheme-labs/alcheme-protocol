'use client';

import { useState, useCallback } from 'react';
import { useAlchemeSDK } from './useAlchemeSDK';
import { useI18n } from '@/i18n/useI18n';
import { waitForSignatureSlot, waitForIndexedSlot } from '@/lib/api/sync';
import { fetchSessionMe } from '@/lib/api/session';
import { bindPostToCircle } from '@/lib/api/bindPostToCircle';
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

interface CreateContentOptions {
    text: string;
    contentType?: 'Post' | 'Video' | 'Image' | 'Audio' | 'Article';
    tags?: string[];
    externalUri?: string;
    circleId: number;
    visibility?: 'Public' | 'CircleOnly' | 'FollowersOnly' | 'Private';
    postStatus?: 'Draft';
}

interface UseCreateContentReturn {
    createContent: (options: CreateContentOptions) => Promise<string | null>;
    loading: boolean;
    syncing: boolean;
    indexed: boolean;
    error: string | null;
    txSignature: string | null;
}

/**
 * useCreateContent — 创建内容（链上交易）
 *
 * 替代原来的 query-api createPost mutation。
 * 调用 SDK content.createContent() 在链上创建内容。
 * indexer 监听 ContentCreated 事件后入库。
 */
export function useCreateContent(): UseCreateContentReturn {
    const sdk = useAlchemeSDK();
    const t = useI18n('WalletOnchainWrite');
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [indexed, setIndexed] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [txSignature, setTxSignature] = useState<string | null>(null);

    const createContent = useCallback(async (options: CreateContentOptions): Promise<string | null> => {
        const contentMutationErrorCopy: ContentMutationErrorCopy = {
            bindCircleAuthorityMissing: t('errors.bindCircleAuthorityMissing'),
            bindCircleFailed: t('errors.bindCircleFailed'),
            bindCircleTimeout: t('errors.bindCircleTimeout'),
            sessionHandleMissing: t('errors.sessionHandleMissing'),
            sdkV2ContentIdUnavailable: t('errors.sdkV2ContentIdUnavailable'),
            v2ContentIdConflictRetryFailed: t('errors.v2ContentIdConflictRetryFailed'),
        };
        if (!sdk) {
            setError(t('errors.walletRequired'));
            return null;
        }
        if (!Number.isFinite(options.circleId) || options.circleId <= 0) {
            setError(t('errors.circleRequired'));
            return null;
        }

        setLoading(true);
        setSyncing(false);
        setIndexed(false);
        setError(null);
        setTxSignature(null);

        try {
            const writeMode = resolveContentWriteMode(process.env.NEXT_PUBLIC_CONTENT_WRITE_MODE);
            const useV2WritePath = writeMode === 'v2';
            const contentApi = sdk.content as any;
            const author = sdk.provider.publicKey;
            if (!author) {
                setError(t('errors.walletRequired'));
                return null;
            }
            const session = await fetchSessionMe().catch(() => ({ authenticated: false as const }));
            const identityHandle = resolveIdentityHandleForV2(writeMode, session);
            if (!identityHandle) {
                throw new Error(ONCHAIN_WRITE_ERROR_CODES.sessionHandleMissing);
            }
            const routeOptions = buildV2RouteOptions(
                writeMode,
                identityHandle,
                process.env.NEXT_PUBLIC_IDENTITY_REGISTRY_NAME || 'social_hub_identity',
            );
            if (!routeOptions || routeOptions.useV2 !== true) {
                throw new Error('v2 route options unavailable');
            }
            const visibilityLevel =
                options.visibility === 'CircleOnly'
                    ? 'CircleOnly'
                    : options.visibility === 'Private'
                        ? 'Private'
                        : options.visibility === 'FollowersOnly'
                        ? 'Followers'
                        : 'Public';
            const contentStatus = options.postStatus === 'Draft' ? 'Draft' : 'Published';
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
                const contentPostPda = sdk.pda.findContentPostPda(author, contentId);
                const expectedContentId = contentPostPda.toBase58();
                const bindContentId = resolveBindContentId(writeMode, contentId, expectedContentId);
                const fallbackContentIds = [expectedContentId];

                try {
                    const tx = await contentApi.createContent({
                        contentId,
                        text: options.text,
                        contentType: options.contentType || 'Post',
                        tags: options.tags || [],
                        externalUri: options.externalUri,
                        identityHandle,
                        identityRegistryName: process.env.NEXT_PUBLIC_IDENTITY_REGISTRY_NAME || 'social_hub_identity',
                        useV2: true,
                        enableV1FallbackOnV2Failure: false,
                        visibilityLevel,
                        protocolCircleId: options.visibility === 'CircleOnly' ? options.circleId : undefined,
                        contentStatus,
                    });

                    setTxSignature(tx);

                    setSyncing(true);
                    let indexedByQueryApi = false;
                    const signatureSlot = await waitForSignatureSlot(sdk.connection, tx);
                    if (signatureSlot === null) {
                        setError(t('errors.signatureSlotMissingBinding'));
                    } else {
                        const indexWait = await waitForIndexedSlot(signatureSlot);
                        indexedByQueryApi = indexWait.ok;
                        setIndexed(indexedByQueryApi);
                        if (!indexWait.ok) {
                            setError(t('errors.indexLaggingBinding'));
                        }
                    }

                    await bindPostToCircle({
                        contentId: bindContentId,
                        circleId: options.circleId,
                        text: options.text,
                        status: options.postStatus,
                        fallbackContentIds,
                    });
                    setIndexed(indexedByQueryApi);
                    if (indexedByQueryApi) {
                        setError(null);
                    }
                    return tx;
                } catch (error) {
                    if (
                        useV2WritePath &&
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
        } catch (err: any) {
            const msg = normalizeContentMutationError(err, contentMutationErrorCopy, t('errors.createContentFailed'));
            setError(msg);
            console.error('[useCreateContent]', err);
            return null;
        } finally {
            setSyncing(false);
            setLoading(false);
        }
    }, [sdk, t]);

    return { createContent, loading, syncing, indexed, error, txSignature };
}
