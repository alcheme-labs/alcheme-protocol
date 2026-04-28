'use client';

import { useCallback, useState } from 'react';
import { useApolloClient } from '@apollo/client/react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useAlchemeSDK } from './useAlchemeSDK';
import { waitForIndexedSlot, waitForSignatureSlot } from '@/lib/api/sync';
import {
    ensureWalletSession,
    fetchSessionMe,
    isIdentityNotRegisteredError,
} from '@/lib/api/session';
import { shouldSignAuthSession } from '@/lib/auth/sessionPolicy';
import { validateIdentityHandle } from '@/lib/identity/handle';
import { getBrowserOnlyMockUnsupportedError } from '@/lib/testing/browserOnlyMockPolicy';

interface RegisterIdentityResult {
    signature: string;
    handle: string;
}

interface UseRegisterIdentityReturn {
    registerIdentity: (input: { handle: string }) => Promise<RegisterIdentityResult | null>;
    loading: boolean;
    syncing: boolean;
    error: string | null;
    txSignature: string | null;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLocalRpcEndpoint(rpcEndpoint: string | null | undefined): boolean {
    const value = String(rpcEndpoint || '').toLowerCase();
    return value.includes('127.0.0.1:8899')
        || value.includes('localhost:8899');
}

function isDevnetRpcEndpoint(rpcEndpoint: string | null | undefined): boolean {
    const value = String(rpcEndpoint || '').toLowerCase();
    return value.includes('devnet');
}

function getFundingGuidanceMessage(rpcEndpoint: string | null | undefined): string {
    if (isLocalRpcEndpoint(rpcEndpoint)) {
        return '当前钱包在本地链上没有可用 SOL，无法支付创建身份交易费用。请先给这个钱包空投测试 SOL，再重试。';
    }

    if (isDevnetRpcEndpoint(rpcEndpoint)) {
        return '当前钱包在 Devnet 上没有可用 SOL，无法支付创建身份交易费用。请先领取 Devnet 测试币，再重试。';
    }

    return '当前钱包在所连接网络上没有可用 SOL，无法支付创建身份交易费用。请先为钱包充值后再重试。';
}

async function waitForAuthenticatedSession(input: {
    publicKey: string;
    handle: string;
    signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
    maxAttempts?: number;
    delayMs?: number;
}): Promise<void> {
    const maxAttempts = Math.max(1, input.maxAttempts ?? 18);
    const delayMs = Math.max(500, input.delayMs ?? 1500);
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            await ensureWalletSession({
                publicKey: input.publicKey,
                signMessage: shouldSignAuthSession(input.signMessage),
            });

            const session = await fetchSessionMe();
            if (session.authenticated && session.user?.pubkey === input.publicKey) {
                return;
            }
        } catch (error) {
            lastError = error;
            if (!isIdentityNotRegisteredError(error)) {
                throw error;
            }
        }

        await sleep(delayMs);
    }

    throw lastError instanceof Error
        ? lastError
        : new Error(`身份注册已上链，但索引尚未同步到登录态。handle=${input.handle}`);
}

function buildIdentityIndexerPendingMessage(waitResult: {
    indexedSlot: number;
    reason?: 'timeout' | 'stale';
}): string {
    return '身份已上链，索引暂未追平，请稍后重试登录态确认。';
}

function normalizeRegisterIdentityError(error: unknown, rpcEndpoint?: string | null): string {
    const raw = error instanceof Error ? error.message : String(error ?? '');
    const message = raw.toLowerCase();

    if (message.includes('wallet') && message.includes('connect')) {
        return '请先连接钱包。';
    }

    if (
        message.includes('user rejected')
        || message.includes('user denied')
        || message.includes('rejected the request')
    ) {
        return '你取消了钱包签名，身份未创建。';
    }

    if (message.includes('already in use') || message.includes('has one') || message.includes('taken')) {
        return '该 handle 已被占用，请更换后重试。';
    }

    if (message.includes('invalidhandle') || message.includes('invalid handle')) {
        return '身份 handle 不符合协议规则，请检查后重试。';
    }

    if (
        (message.includes('attempt to debit an account') && message.includes('prior credit'))
        || message.includes('insufficient funds')
        || message.includes('insufficient lamports')
    ) {
        return getFundingGuidanceMessage(rpcEndpoint);
    }

    if (message.includes('index') || message.includes('sync')) {
        return '身份已上链，但索引暂未追平，请稍后重试。';
    }

    return raw || '身份注册失败，请稍后重试。';
}

export function useRegisterIdentity(): UseRegisterIdentityReturn {
    const sdk = useAlchemeSDK();
    const apolloClient = useApolloClient();
    const { connection } = useConnection();
    const { publicKey, signMessage } = useWallet();
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [txSignature, setTxSignature] = useState<string | null>(null);

    const registerIdentity = useCallback(async (input: { handle: string }): Promise<RegisterIdentityResult | null> => {
        const handle = String(input.handle || '').trim();
        const isE2EMockMode = process.env.NEXT_PUBLIC_E2E_WALLET_MOCK === '1';
        const validationError = validateIdentityHandle(handle);
        if (validationError) {
            setError(validationError);
            return null;
        }

        if (!publicKey) {
            setError('请先连接钱包。');
            return null;
        }
        if (isE2EMockMode) {
            setError(getBrowserOnlyMockUnsupportedError('identity_registration'));
            return null;
        }
        if (!sdk) {
            setError('请先连接钱包。');
            return null;
        }

        setLoading(true);
        setSyncing(false);
        setError(null);
        setTxSignature(null);

        try {
            let signature: string;
            const activeSdk = sdk;
            if (!activeSdk) {
                throw new Error('请先连接钱包。');
            }
            const available = await activeSdk.identity.checkHandleAvailability(handle);
            if (!available) {
                throw new Error('handle already in use');
            }
            signature = await activeSdk.identity.registerIdentity(handle, handle);
            setTxSignature(signature);
            setSyncing(true);

            const signatureSlot = await waitForSignatureSlot(activeSdk.connection, signature);
            if (signatureSlot !== null) {
                const waitResult = await waitForIndexedSlot(signatureSlot, { timeoutMs: 45_000, pollMs: 1_500 });
                if (!waitResult.ok) {
                    setError(buildIdentityIndexerPendingMessage(waitResult));
                    return null;
                }
            }

            await waitForAuthenticatedSession({
                publicKey: publicKey.toBase58(),
                handle,
                signMessage,
            });
            await apolloClient.reFetchObservableQueries();

            return {
                signature,
                handle,
            };
        } catch (registerError) {
            setError(normalizeRegisterIdentityError(registerError, connection.rpcEndpoint));
            return null;
        } finally {
            setLoading(false);
            setSyncing(false);
        }
    }, [apolloClient, connection.rpcEndpoint, publicKey, sdk, signMessage]);

    return {
        registerIdentity,
        loading,
        syncing,
        error,
        txSignature,
    };
}
