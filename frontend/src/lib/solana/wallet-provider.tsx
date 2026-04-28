'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApolloClient } from '@apollo/client/react';
import {
    ConnectionProvider,
    WalletProvider,
    useWallet,
} from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare';
import { clusterApiUrl } from '@solana/web3.js';
import {
    ensureWalletSession,
    isIdentityNotRegisteredError,
    logoutSession,
} from '@/lib/api/session';
import { E2EWalletAdapter } from './e2eWalletAdapter';
import {
    NativePhantomWalletAdapter,
    NativePhantomWalletName,
    NATIVE_PHANTOM_SESSION_STORAGE_KEY,
} from './nativePhantomWalletAdapter';
import { shouldSignAuthSession } from '@/lib/auth/sessionPolicy';
import { isNativeWalletBridgeAvailable } from '../mobile/nativeWalletBridge';

// Import wallet adapter styles
import '@solana/wallet-adapter-react-ui/styles.css';

const SOLANA_RPC =
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl('devnet');

interface SolanaProviderProps {
    children: ReactNode;
}

function WalletSessionBridge() {
    const apolloClient = useApolloClient();
    const { connected, publicKey, signMessage } = useWallet();
    const lastSessionPubkeyRef = useRef<string | null>(null);
    const publicKeyBase58 = publicKey?.toBase58() || null;
    const resetApolloAuthState = useCallback(async () => {
        try {
            await apolloClient.resetStore();
        } catch (error) {
            console.warn('auth state reset failed:', error);
        }
    }, [apolloClient]);

    useEffect(() => {
        if (!connected || !publicKeyBase58) {
            if (lastSessionPubkeyRef.current) {
                lastSessionPubkeyRef.current = null;
                void logoutSession()
                    .catch((error) => {
                        console.warn('auth session logout failed:', error);
                    })
                    .finally(() => {
                        void resetApolloAuthState();
                    });
            }
            return;
        }

        let cancelled = false;
        void ensureWalletSession({
            publicKey: publicKeyBase58,
            signMessage: shouldSignAuthSession(signMessage),
        })
            .then((result) => {
                if (cancelled) return;
                lastSessionPubkeyRef.current = publicKeyBase58;
                if (result.status !== 'already_authenticated') {
                    void resetApolloAuthState();
                }
            })
            .catch((error) => {
                if (cancelled) return;
                const hadAuthenticatedSession = Boolean(lastSessionPubkeyRef.current);
                lastSessionPubkeyRef.current = null;
                if (isIdentityNotRegisteredError(error)) {
                    console.info('wallet session unavailable: continuing in anonymous mode for unregistered wallet');
                    if (hadAuthenticatedSession) {
                        void resetApolloAuthState();
                    }
                    return;
                }
                if (hadAuthenticatedSession) {
                    void resetApolloAuthState();
                }
                console.warn('ensure wallet session failed:', error);
            });

        return () => {
            cancelled = true;
        };
    }, [connected, publicKeyBase58, resetApolloAuthState, signMessage]);

    return null;
}

export default function SolanaProvider({ children }: SolanaProviderProps) {
    const [walletProviderReady, setWalletProviderReady] = useState(false);

    const wallets = useMemo(
        () => {
            if (process.env.NEXT_PUBLIC_E2E_WALLET_MOCK === '1') {
                return [new E2EWalletAdapter()];
            }
            if (isNativeWalletBridgeAvailable()) {
                return [new NativePhantomWalletAdapter()];
            }
            return [new PhantomWalletAdapter(), new SolflareWalletAdapter()];
        },
        []
    );

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
            <WalletProvider wallets={wallets} autoConnect>
                <WalletSessionBridge />
                <WalletModalProvider>{children}</WalletModalProvider>
            </WalletProvider>
        </ConnectionProvider>
    );
}
