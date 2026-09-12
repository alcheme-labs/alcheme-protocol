'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApolloClient } from '@apollo/client/react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
    ensureWalletSession,
    fetchPublicDemoAdmissionPolicy,
    fetchSessionMe,
    isIdentityNotRegisteredError,
    isIdentityVerificationUnavailableError,
    isPublicDemoAdmissionRequiredError,
    isPublicDemoRegionNotSupportedError,
    logoutSession,
    QueryApiRequestError,
    type QueryApiErrorCode,
    type SessionMeResponse,
    type SessionUser,
} from '@/lib/api/session';
import { shouldSignAuthSession } from '@/lib/auth/sessionPolicy';
import {
    IdentityOnboardingContext,
    type WalletIdentityState,
} from '@/lib/auth/identityOnboarding';
import { subscribeIdentityRegistered } from '@/lib/auth/identityRegistrationEvents';
import { useI18n } from '@/i18n/useI18n';
import { normalizeWalletError } from '@/lib/wallet/walletErrors';

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
    walletT: ReturnType<typeof useI18n>,
): ResolvedSessionError {
    if (isIdentityVerificationUnavailableError(error)) {
        return {
            code: 'identity_verification_unavailable',
            message: t('errors.identityVerificationUnavailable'),
        };
    }

    if (isPublicDemoRegionNotSupportedError(error)) {
        return {
            code: 'public_demo_region_not_supported',
            message: t('errors.publicDemoRegionNotSupported'),
        };
    }
    if (isPublicDemoAdmissionRequiredError(error)) {
        return {
            code: 'public_demo_admission_required',
            message: t('errors.publicDemoAdmissionRequired'),
        };
    }

    const fallbackMessage = t('errors.sessionConfirmation');
    if (error instanceof Error && error.message) {
        if (error.message.toLowerCase().includes('invalid signature')) {
            return {
                code: 'invalid_signature',
                message: t('errors.invalidSignature'),
            };
        }
    }
    if (!(error instanceof QueryApiRequestError)) {
        const walletError = normalizeWalletError(error);
        const isWalletError = /wallet|phantom|solflare|sign.?message/i.test(walletError.rawMessage);
        if (isWalletError) {
            return {
                code: 'session_error',
                message: walletT(walletError.messageKey),
            };
        }
    }
    return {
        code: 'session_error',
        message: fallbackMessage,
    };
}

function shouldPreserveAuthSessionOnError(error: unknown): boolean {
    return isIdentityVerificationUnavailableError(error);
}

export default function IdentityOnboardingProvider({ children }: IdentityOnboardingProviderProps) {
    const t = useI18n('IdentityOnboardingProvider');
    const walletT = useI18n('WalletAction');
    const apolloClient = useApolloClient();
    const { connected, publicKey, signMessage } = useWallet();
    const [identityState, setIdentityState] = useState<WalletIdentityState>('disconnected');
    const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
    // Internal placeholder only.
    // Do not expose through context or UI until verification data is real.
    const internalVerificationStateRef = useRef<InternalVerificationState>('unknown');
    const [lastErrorCode, setLastErrorCode] = useState<QueryApiErrorCode | 'session_error' | null>(null);
    const [lastErrorMessage, setLastErrorMessage] = useState<string | null>(null);
    const requestIdRef = useRef(0);
    const lastSessionPubkeyRef = useRef<string | null>(null);
    const publicKeyBase58 = publicKey?.toBase58() || null;

    const resetApolloAuthState = useCallback(async () => {
        try {
            await apolloClient.resetStore();
        } catch (error) {
            console.warn('auth state reset failed:', error);
        }
    }, [apolloClient]);

    const clearApolloAuthState = useCallback(async () => {
        try {
            await apolloClient.clearStore();
        } catch (error) {
            console.warn('auth client state clear failed:', error);
        }
    }, [apolloClient]);

    const clearAuthenticatedSession = useCallback(async () => {
        lastSessionPubkeyRef.current = null;
        try {
            await logoutSession();
        } catch (error) {
            console.warn('auth session logout failed:', error);
        } finally {
            await resetApolloAuthState();
        }
    }, [resetApolloAuthState]);

    const applyResolvedState = useCallback((
        requestId: number,
        nextState: WalletIdentityState,
        nextUser: SessionUser | null,
        nextError?: ResolvedSessionError | null,
    ) => {
        if (requestId !== requestIdRef.current) return nextState;
        setIdentityState(nextState);
        setSessionUser(nextUser);
        lastSessionPubkeyRef.current = nextUser?.pubkey ?? null;
        internalVerificationStateRef.current = resolveVerificationState(nextUser);
        setLastErrorCode(nextError?.code || null);
        setLastErrorMessage(nextError?.message || null);
        return nextState;
    }, []);

    const refreshIdentityState = useCallback(async (): Promise<WalletIdentityState> => {
        const requestId = ++requestIdRef.current;

        if (!connected || !publicKeyBase58) {
            if (lastSessionPubkeyRef.current) {
                void clearAuthenticatedSession();
            }
            return applyResolvedState(requestId, 'disconnected', null);
        }

        setIdentityState('connecting_session');

        let existingSession: SessionMeResponse | null = null;
        let existingSessionError: unknown = null;
        try {
            existingSession = await fetchSessionMe();
        } catch (error) {
            existingSessionError = error;
        }
        if (existingSession?.authenticated && existingSession.user?.pubkey === publicKeyBase58) {
            return applyResolvedState(requestId, 'registered', existingSession.user);
        }
        if (shouldPreserveAuthSessionOnError(existingSessionError)) {
            return applyResolvedState(
                requestId,
                'session_error',
                null,
                normalizeSessionError(existingSessionError, t, walletT),
            );
        }

        try {
            const publicDemoPolicy = await fetchPublicDemoAdmissionPolicy();
            await ensureWalletSession({
                publicKey: publicKeyBase58,
                signMessage: publicDemoPolicy.required
                    ? signMessage
                    : shouldSignAuthSession(signMessage),
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
            if (isPublicDemoAdmissionRequiredError(error)) {
                return applyResolvedState(
                    requestId,
                    'admission_required',
                    null,
                    normalizeSessionError(error, t, walletT),
                );
            }
            if (isIdentityNotRegisteredError(error)) {
                if (requestId === requestIdRef.current) {
                    void clearAuthenticatedSession();
                }
                return applyResolvedState(requestId, 'unregistered', null);
            }

            if (shouldPreserveAuthSessionOnError(error)) {
                return applyResolvedState(requestId, 'session_error', null, normalizeSessionError(error, t, walletT));
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
            if (requestId === requestIdRef.current) {
                await clearApolloAuthState();
            }
            return applyResolvedState(requestId, 'session_error', null, normalizeSessionError(error, t, walletT));
        }
    }, [
        applyResolvedState,
        clearApolloAuthState,
        clearAuthenticatedSession,
        connected,
        publicKeyBase58,
        signMessage,
        t,
        walletT,
    ]);

    const acceptPublicDemoAdmission = useCallback(async (
        region: 'US' | 'OTHER' | 'CN',
    ): Promise<WalletIdentityState> => {
        const requestId = ++requestIdRef.current;
        if (!connected || !publicKeyBase58) {
            return applyResolvedState(requestId, 'disconnected', null);
        }
        setIdentityState('connecting_session');
        try {
            const policy = await fetchPublicDemoAdmissionPolicy();
            await ensureWalletSession({
                publicKey: publicKeyBase58,
                signMessage,
                publicDemoAdmission: {
                    policyVersion: policy.version,
                    jurisdiction: policy.jurisdiction,
                    region,
                    adultAttested: true,
                    termsAccepted: true,
                    privacyAccepted: true,
                    safetyPolicyAccepted: true,
                },
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
            const resolved = normalizeSessionError(error, t, walletT);
            return applyResolvedState(
                requestId,
                isPublicDemoAdmissionRequiredError(error) || isPublicDemoRegionNotSupportedError(error)
                    ? 'admission_required'
                    : 'session_error',
                null,
                resolved,
            );
        }
    }, [applyResolvedState, connected, publicKeyBase58, signMessage, t, walletT]);

    useEffect(() => {
        void refreshIdentityState();
    }, [refreshIdentityState]);

    useEffect(() => subscribeIdentityRegistered(() => {
        void refreshIdentityState();
    }), [refreshIdentityState]);

    const value = useMemo(() => ({
        identityState,
        walletConnected: connected,
        walletPublicKey: publicKeyBase58,
        sessionUser,
        lastErrorCode,
        lastErrorMessage,
        refreshIdentityState,
        acceptPublicDemoAdmission,
    }), [
        connected,
        identityState,
        lastErrorCode,
        lastErrorMessage,
        publicKeyBase58,
        refreshIdentityState,
        acceptPublicDemoAdmission,
        sessionUser,
    ]);

    return (
        <IdentityOnboardingContext.Provider value={value}>
            {children}
        </IdentityOnboardingContext.Provider>
    );
}
