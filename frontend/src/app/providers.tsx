'use client';

import { type ReactNode, useEffect } from 'react';
import { ApolloProvider } from '@apollo/client/react';
import { apolloClient } from '@/lib/apollo/client';
import IdentityOnboardingProvider from '@/components/auth/IdentityOnboardingProvider';
import SolanaProvider from '@/lib/solana/wallet-provider';
import { useServiceWorker } from '@/hooks/useServiceWorker';
import { useCurrentLocale } from '@/i18n/useI18n';
import { setActiveRequestLocale } from '@/lib/api/fetch';

interface ProvidersProps {
    children: ReactNode;
}

/**
 * Client-side providers wrapper.
 * Wraps the app with Apollo (GraphQL) and Solana (Wallet) providers.
 * Registers service worker in production.
 */
export default function Providers({ children }: ProvidersProps) {
    const locale = useCurrentLocale();
    useServiceWorker();

    useEffect(() => {
        setActiveRequestLocale(locale);
    }, [locale]);

    return (
        <ApolloProvider client={apolloClient}>
            <SolanaProvider>
                <IdentityOnboardingProvider>{children}</IdentityOnboardingProvider>
            </SolanaProvider>
        </ApolloProvider>
    );
}
