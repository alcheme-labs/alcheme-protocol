'use client';

import { createContext, useContext } from 'react';
import type { QueryApiErrorCode, SessionUser } from './session';

export type WalletIdentityState =
    | 'disconnected'
    | 'connecting_session'
    | 'registered'
    | 'unregistered'
    | 'admission_required'
    | 'session_error';

export interface IdentityOnboardingContextValue {
    identityState: WalletIdentityState;
    walletConnected: boolean;
    walletPublicKey: string | null;
    sessionUser: SessionUser | null;
    lastErrorCode: QueryApiErrorCode | 'session_error' | null;
    lastErrorMessage: string | null;
    refreshIdentityState: () => Promise<WalletIdentityState>;
    acceptPublicDemoAdmission: (region: 'US' | 'OTHER' | 'CN') => Promise<WalletIdentityState>;
}

export const IdentityOnboardingContext = createContext<IdentityOnboardingContextValue | null>(null);

export function useIdentityOnboarding(): IdentityOnboardingContextValue {
    const value = useContext(IdentityOnboardingContext);
    if (!value) {
        throw new Error('useIdentityOnboarding must be used within IdentityOnboardingProvider');
    }
    return value;
}
