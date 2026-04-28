'use client';

import { useState, useCallback } from 'react';
import { useAlchemeSDK } from './useAlchemeSDK';
import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { waitForSignatureSlot, waitForIndexedSlot } from '@/lib/api/sync';

interface DeleteContentOptions {
    /** 内容作者的 PublicKey */
    author: string;
    /** 内容 ID */
    contentId: number;
}

interface UseDeleteContentReturn {
    deleteContent: (options: DeleteContentOptions) => Promise<string | null>;
    loading: boolean;
    syncing: boolean;
    indexed: boolean;
    error: string | null;
    txSignature: string | null;
}

/**
 * useDeleteContent — 删除内容（链上交易）
 *
 * 替代原来的 query-api deletePost mutation。
 * 调用 SDK content.deleteContent() 在链上标记删除。
 * indexer 监听 ContentStatusChanged 事件后更新 DB。
 */
export function useDeleteContent(): UseDeleteContentReturn {
    const sdk = useAlchemeSDK();
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [indexed, setIndexed] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [txSignature, setTxSignature] = useState<string | null>(null);

    const deleteContent = useCallback(async (options: DeleteContentOptions): Promise<string | null> => {
        if (!sdk) {
            setError('请先连接钱包');
            return null;
        }

        setLoading(true);
        setSyncing(false);
        setIndexed(false);
        setError(null);
        setTxSignature(null);

        try {
            const authorPubkey = new PublicKey(options.author);
            const contentId = new BN(options.contentId);

            const tx = await sdk.content.deleteContent(
                authorPubkey,
                contentId,
                { authorDelete: {} },  // DeletionType::AuthorDelete
            );

            setTxSignature(tx);

            setSyncing(true);
            const signatureSlot = await waitForSignatureSlot(sdk.connection, tx);
            if (signatureSlot !== null) {
                const indexWait = await waitForIndexedSlot(signatureSlot);
                setIndexed(indexWait.ok);
                if (!indexWait.ok) {
                    setError('交易已上链，但索引尚未追平，稍后刷新可见。');
                }
            } else {
                setError('交易已提交，暂未获取确认槽位。');
            }

            return tx;
        } catch (err: any) {
            const msg = err?.message || '删除内容失败';
            setError(msg);
            console.error('[useDeleteContent]', err);
            return null;
        } finally {
            setSyncing(false);
            setLoading(false);
        }
    }, [sdk]);

    return { deleteContent, loading, syncing, indexed, error, txSignature };
}
