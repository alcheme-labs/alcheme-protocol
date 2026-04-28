'use client';

import { useCallback, useRef, useState } from 'react';
import { BN } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { useAlchemeSDK } from './useAlchemeSDK';
import { waitForIndexedSlot, waitForSignatureSlot } from '@/lib/api/sync';
import { bindPostToCircle } from '@/lib/api/bindPostToCircle';
import { fetchSessionMe } from '@/lib/api/session';
import {
    buildV2RouteOptions,
    isV2ContentIdConflictError,
    resolveBindContentId,
    resolveContentWriteMode,
    resolveIdentityHandleForV2,
} from '@/lib/content/writeRoute';

interface UseRepostContentOptions {
    onIndexed?: () => Promise<void> | void;
}

interface RepostContentInput {
    originalContentId: string;
    originalAuthorPubkey?: string;
    circleId: number;
}

interface UseRepostContentReturn {
    repostContent: (input: RepostContentInput) => Promise<string | null>;
    pendingContentIds: Set<string>;
    error: string | null;
}

export function useRepostContent(options: UseRepostContentOptions = {}): UseRepostContentReturn {
    const sdk = useAlchemeSDK();
    const [pendingContentIds, setPendingContentIds] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);
    const pendingRef = useRef<Set<string>>(new Set());

    const repostContent = useCallback(async (input: RepostContentInput): Promise<string | null> => {
        if (!sdk?.provider.publicKey) {
            setError('请先连接钱包');
            return null;
        }
        if (pendingRef.current.has(input.originalContentId)) {
            return null;
        }

        pendingRef.current = new Set(pendingRef.current).add(input.originalContentId);
        setPendingContentIds(new Set(pendingRef.current));
        setError(null);

        try {
            const writeMode = resolveContentWriteMode(process.env.NEXT_PUBLIC_CONTENT_WRITE_MODE);
            const contentApi = sdk.content as any;
            const author = sdk.provider.publicKey;
            const originalRaw = String(input.originalContentId || '').trim();
            const originalIsNumericId = /^\d+$/.test(originalRaw);
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
                throw new Error('SDK 缺少 createV2ContentId/getNextV2ContentId，无法安全执行 v2 写入');
            };

            const maxAttempts = 3;
            let lastConflictError: unknown = null;
            for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
                const contentId = await nextV2ContentId();
                const expectedContentId = sdk.pda.findContentPostPda(author, contentId).toBase58();
                const bindContentId = resolveBindContentId(writeMode, contentId, expectedContentId);
                const fallbackContentIds = [expectedContentId];
                try {
                    const signature = originalIsNumericId
                        ? await contentApi.createRepostById(
                            contentId,
                            new BN(originalRaw),
                            undefined,
                            {
                                ...routeOptions,
                                originalAuthorPubkey: String(input.originalAuthorPubkey || '').trim(),
                            },
                        )
                        : await contentApi.createRepost(
                            contentId,
                            new PublicKey(input.originalContentId),
                            undefined,
                            routeOptions,
                        );

                    const signatureSlot = await waitForSignatureSlot(sdk.connection, signature);
                    let indexWaitOk = signatureSlot === null;
                    if (signatureSlot !== null) {
                        const indexWait = await waitForIndexedSlot(signatureSlot);
                        indexWaitOk = indexWait.ok;
                        if (!indexWait.ok) {
                            setError('转发已提交链上，但索引尚未追平，列表可能稍后刷新。');
                        }
                    }

                    await bindPostToCircle({
                        contentId: bindContentId,
                        circleId: input.circleId,
                        fallbackContentIds,
                    });

                    if (indexWaitOk) {
                        await options.onIndexed?.();
                    }
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
            throw lastConflictError || new Error('v2 content_id 冲突重试失败');
        } catch (err) {
            const message = err instanceof Error ? err.message : '转发失败';
            setError(message);
            return null;
        } finally {
            const next = new Set(pendingRef.current);
            next.delete(input.originalContentId);
            pendingRef.current = next;
            setPendingContentIds(new Set(next));
        }
    }, [options, sdk]);

    return {
        repostContent,
        pendingContentIds,
        error,
    };
}
