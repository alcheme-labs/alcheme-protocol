'use client';

import { useState, useCallback } from 'react';
import { useAlchemeSDK } from './useAlchemeSDK';
import { waitForSignatureSlot, waitForIndexedSlot } from '@/lib/api/sync';
import { fetchSessionMe } from '@/lib/api/session';
import { bindPostToCircle } from '@/lib/api/bindPostToCircle';
import {
    buildV2RouteOptions,
    isV2ContentIdConflictError,
    resolveBindContentId,
    resolveContentWriteMode,
    resolveIdentityHandleForV2,
} from '@/lib/content/writeRoute';

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
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [indexed, setIndexed] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [txSignature, setTxSignature] = useState<string | null>(null);

    const createContent = useCallback(async (options: CreateContentOptions): Promise<string | null> => {
        if (!sdk) {
            setError('请先连接钱包');
            return null;
        }
        if (!Number.isFinite(options.circleId) || options.circleId <= 0) {
            setError('请选择圈层后再发布');
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
                setError('请先连接钱包');
                return null;
            }
            const session = await fetchSessionMe().catch(() => ({ authenticated: false as const }));
            const identityHandle = resolveIdentityHandleForV2(writeMode, session);
            if (!identityHandle) {
                throw new Error('登录态缺少身份 handle，请重新连接钱包后再试');
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
                throw new Error('SDK 缺少 createV2ContentId/getNextV2ContentId，无法安全执行 v2 写入');
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
                        setError('交易已提交，确认槽位暂不可见，正在尝试圈层绑定…');
                    } else {
                        const indexWait = await waitForIndexedSlot(signatureSlot);
                        indexedByQueryApi = indexWait.ok;
                        setIndexed(indexedByQueryApi);
                        if (!indexWait.ok) {
                            setError('交易已上链，但索引尚未追平，正在补写圈层绑定…');
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
            throw lastConflictError || new Error('v2 content_id 冲突重试失败');
        } catch (err: any) {
            const msg = err?.message || '发布内容失败';
            setError(msg);
            console.error('[useCreateContent]', err);
            return null;
        } finally {
            setSyncing(false);
            setLoading(false);
        }
    }, [sdk]);

    return { createContent, loading, syncing, indexed, error, txSignature };
}
