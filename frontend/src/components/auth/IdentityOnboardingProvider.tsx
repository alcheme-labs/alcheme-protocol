'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
    ensureWalletSession,
    fetchSessionMe,
    isIdentityNotRegisteredError,
    type QueryApiErrorCode,
    type SessionUser,
} from '@/lib/auth/session';
import { shouldSignAuthSession } from '@/lib/auth/sessionPolicy';
import {
    IdentityOnboardingContext,
    type WalletIdentityState,
} from '@/lib/auth/identityOnboarding';
import { useI18n } from '@/i18n/useI18n';

interface IdentityOnboardingProviderProps {
    children: ReactNode;
}

type InternalVerificationState = 'unknown' | 'unverified' | 'verified';

interface ResolvedSessionError {
    code: QueryApiErrorCode | 'session_error';
    message: string;
}

const SESSION_CONFIRMATION_ATTEMPTS = 4;
const SESSION_CONFIRMATION_DELAY_MS = 300;

function resolveVerificationState(user: SessionUser | null): InternalVerificationState {
    return user ? 'unverified' : 'unknown';
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForConfirmedSession(
    publicKeyBase58: string,
    maxAttempts = SESSION_CONFIRMATION_ATTEMPTS,
): Promise<SessionUser | null> {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const session = await fetchSessionMe().catch((error) => {
            if (attempt >= maxAttempts) {
                throw error;
            }
            return null;
        });

        if (session?.authenticated && session.user?.pubkey === publicKeyBase58) {
            return session.user;
        }

        if (attempt < maxAttempts) {
            await sleep(SESSION_CONFIRMATION_DELAY_MS);
        }
    }

    return null;
}

function normalizeSessionError(
    error: unknown,
    t: ReturnType<typeof useI18n>,
): ResolvedSessionError {
    const fallbackMessage = t('errors.sessionConfirmation');
    if (error instanceof Error && error.message) {
        if (error.message.toLowerCase().includes('invalid signature')) {
            return {
                code: 'invalid_signature',
                message: t('errors.invalidSignature'),
            };
        }
    }
    return {
        code: 'session_error',
        message: fallbackMessage,
    };
}

export default function IdentityOnboardingProvider({ children }: IdentityOnboardingProviderProps) {
    const t = useI18n('IdentityOnboardingProvider');
    const { connected, publicKey, signMessage } = useWallet();
    const [identityState, setIdentityState] = useState<WalletIdentityState>('disconnected');
    const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
    // Internal placeholder only.
    // Do not expose through context or UI until verification data is real.
    const internalVerificationStateRef = useRef<InternalVerificationState>('unknown');
    const [lastErrorCode, setLastErrorCode] = useState<QueryApiErrorCode | 'session_error' | null>(null);
    const [lastErrorMessage, setLastErrorMessage] = useState<string | null>(null);
    const requestIdRef = useRef(0);
    const publicKeyBase58 = publicKey?.toBase58() || null;

    const applyResolvedState = useCallback((
        requestId: number,
        nextState: WalletIdentityState,
        nextUser: SessionUser | null,
        nextError?: ResolvedSessionError | null,
    ) => {
        if (requestId !== requestIdRef.current) return nextState;
        setIdentityState(nextState);
        setSessionUser(nextUser);
        internalVerificationStateRef.current = resolveVerificationState(nextUser);
        setLastErrorCode(nextError?.code || null);
        setLastErrorMessage(nextError?.message || null);
        return nextState;
    }, []);

    const refreshIdentityState = useCallback(async (): Promise<WalletIdentityState> => {
        const requestId = ++requestIdRef.current;

        if (!connected || !publicKeyBase58) {
            return applyResolvedState(requestId, 'disconnected', null);
        }

        setIdentityState('connecting_session');

        const existingSession = await fetchSessionMe().catch(() => null);
        if (existingSession?.authenticated && existingSession.user?.pubkey === publicKeyBase58) {
            return applyResolvedState(requestId, 'registered', existingSession.user);
        }

        try {
            await ensureWalletSession({
                publicKey: publicKeyBase58,
                signMessage: shouldSignAuthSession(signMessage),
            });

            const confirmedUser = await waitForConfirmedSession(publicKeyBase58);
            if (confirmedUser) {
                return applyResolvedState(requestId, 'registered', confirmedUser);
            }
            return applyResolvedState(requestId, 'session_error', null, {
                code: 'session_error',
                message: t('errors.sessionConfirmation'),
            });
        } catch (error) {
            if (isIdentityNotRegisteredError(error)) {
                return applyResolvedState(requestId, 'unregistered', null);
            }

            try {
                const fallbackUser = await waitForConfirmedSession(publicKeyBase58, 1);
                if (fallbackUser) {
                    return applyResolvedState(requestId, 'registered', fallbackUser);
                }
            } catch (fallbackError) {
                console.warn('identity onboarding fallback refresh failed:', fallbackError);
            }

            console.warn('identity onboarding refresh failed:', error);
            return applyResolvedState(requestId, 'session_error', null, normalizeSessionError(error, t));
        }
    }, [applyResolvedState, connected, publicKeyBase58, signMessage, t]);

    useEffect(() => {
        void refreshIdentityState();
    }, [refreshIdentityState]);

    const value = useMemo(() => ({
        identityState,
        walletConnected: connected,
        walletPublicKey: publicKeyBase58,
        sessionUser,
        lastErrorCode,
        lastErrorMessage,
        refreshIdentityState,
    }), [
        connected,
        identityState,
        lastErrorCode,
        lastErrorMessage,
        publicKeyBase58,
        refreshIdentityState,
        sessionUser,
    ]);

    return (
        <IdentityOnboardingContext.Provider value={value}>
            {children}
        </IdentityOnboardingContext.Provider>
    );
}
