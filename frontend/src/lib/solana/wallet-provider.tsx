'use client';

import { useCallback, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import {
    ConnectionProvider,
    WalletProvider,
} from '@solana/wallet-adapter-react';
import type { Adapter, WalletError } from '@solana/wallet-adapter-base';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { E2EWalletAdapter } from './e2eWalletAdapter';
import {
    NativePhantomWalletAdapter,
    NativePhantomWalletName,
    NATIVE_PHANTOM_SESSION_STORAGE_KEY,
} from './nativePhantomWalletAdapter';
import { isNativeWalletBridgeAvailable } from '../mobile/nativeWalletBridge';
import { clearWalletAutoConnect, shouldAttemptWalletAutoConnect } from '../wallet/autoConnect';
import { notifyWalletAdapterError } from '../wallet/walletErrorEvents';
import { isBrowserOnlyMockWallet } from '../testing/browserOnlyMockPolicy';

// Import wallet adapter styles
import '@solana/wallet-adapter-react-ui/styles.css';

function requireSolanaRpcEndpoint(): string {
    const endpoint = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim();
    if (!endpoint) {
        throw new Error('Missing required frontend Solana RPC env: NEXT_PUBLIC_SOLANA_RPC_URL');
    }
    return endpoint;
}

const SOLANA_RPC = requireSolanaRpcEndpoint();

interface SolanaProviderProps {
    children: ReactNode;
}

export default function SolanaProvider({ children }: SolanaProviderProps) {
    const [walletProviderReady, setWalletProviderReady] = useState(false);

    const wallets = useMemo(
        () => {
            if (isBrowserOnlyMockWallet()) {
                return [new E2EWalletAdapter()];
            }
            if (isNativeWalletBridgeAvailable()) {
                return [new NativePhantomWalletAdapter()];
            }
            return [new SolflareWalletAdapter()];
        },
        []
    );

    const handleAutoConnect = useCallback(async (_adapter: Adapter) => shouldAttemptWalletAutoConnect(), []);

    const handleWalletError = useCallback((error: WalletError) => {
        const raw = error?.message || '';
        notifyWalletAdapterError(error);
        if (
            raw.toLowerCase().includes('disconnected port')
            || raw.toLowerCase().includes('failed to send message to service worker')
        ) {
            clearWalletAutoConnect();
        }
        console.warn('[wallet] adapter error', error);
    }, []);

    useLayoutEffect(() => {
        if (typeof window !== 'undefined' && isNativeWalletBridgeAvailable()) {
            const rawWalletName = window.localStorage.getItem('walletName');
            const walletName = rawWalletName ? JSON.parse(rawWalletName) : null;
            if (walletName === NativePhantomWalletName) {
                const persistedSession = window.localStorage.getItem(NATIVE_PHANTOM_SESSION_STORAGE_KEY);
                if (!persistedSession) {
                    window.localStorage.removeItem('walletName');
                }
            }
        }

        setWalletProviderReady(true);
    }, []);

    if (!walletProviderReady) {
        return null;
    }

    return (
        <ConnectionProvider endpoint={SOLANA_RPC}>
            <WalletProvider wallets={wallets} autoConnect={handleAutoConnect} onError={handleWalletError}>
                <WalletModalProvider>{children}</WalletModalProvider>
            </WalletProvider>
        </ConnectionProvider>
    );
}
