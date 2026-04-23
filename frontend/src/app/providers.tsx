'use client';

import { type ReactNode } from 'react';
import { ApolloProvider } from '@apollo/client/react';
import { apolloClient } from '@/lib/apollo/client';
import IdentityOnboardingProvider from '@/components/auth/IdentityOnboardingProvider';
import SolanaProvider from '@/lib/solana/wallet-provider';
import { useServiceWorker } from '@/hooks/useServiceWorker';

interface ProvidersProps {
    children: ReactNode;
}

/**
 * Client-side providers wrapper.
 * Wraps the app with Apollo (GraphQL) and Solana (Wallet) providers.
 * Registers service worker in production.
 */
export default function Providers({ children }: ProvidersProps) {
    useServiceWorker();

    return (
        <ApolloProvider client={apolloClient}>
            <SolanaProvider>
                <IdentityOnboardingProvider>{children}</IdentityOnboardingProvider>
            </SolanaProvider>
        </ApolloProvider>
    );
}
