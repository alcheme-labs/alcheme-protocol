'use client';

import { useCallback, useRef, useState } from 'react';
import { PublicKey } from '@solana/web3.js';

import { useAlchemeSDK } from './useAlchemeSDK';
import { useI18n } from '@/i18n/useI18n';
import { waitForIndexedSlot, waitForSignatureSlot } from '@/lib/api/sync';
import { useIdentityOnboarding, type WalletIdentityState } from '@/lib/auth/identityOnboarding';
import {
    beginFollowWrite,
    canStartFollowWrite,
    completeFollowWrite,
    createPendingFollowState,
    markPendingFollowIndexed,
    markPendingFollowIndexTimeout,
    normalizeFollowTargetPubkey,
    type PendingFollowState,
} from '@/lib/follow/stateMachine';

export type FollowAction = 'follow' | 'unfollow';

export type FollowErrorType =
    | 'identity'
    | 'wallet_rejected'
    | 'invalid_target'
    | 'network'
    | 'index_timeout'
    | 'unknown';

export type FollowStatus = 'idle' | 'loading' | 'syncing' | 'indexed' | 'index_timeout' | 'error';

export interface FollowTargetInput {
    targetUserId: number;
    targetPubkey: string | null | undefined;
}

export interface FollowActionResult {
    ok: boolean;
    indexed: boolean;
    txSignature: string | null;
    errorType: FollowErrorType | null;
    pendingOutcome: PendingFollowState | null;
}

interface UseFollowUserReturn {
    followUser: (input: FollowTargetInput) => Promise<FollowActionResult>;
    unfollowUser: (input: FollowTargetInput) => Promise<FollowActionResult>;
    loading: boolean;
    syncing: boolean;
    indexed: boolean;
    status: FollowStatus;
    error: string | null;
    errorType: FollowErrorType | null;
    txSignature: string | null;
    pendingOutcome: PendingFollowState | null;
    clearPendingOutcome: () => void;
}

interface FollowUserErrorCopy {
    signatureCancelled: string;
    network: string;
    failed: string;
    walletRequired: string;
    identityChecking: string;
    identityRequired: string;
    identityCheckFailed: string;
    targetProfilePending: string;
    memberProfilePending: string;
    invalidPubkey: string;
    self: string;
    indexPending: string;
}

function normalizeFollowError(
    error: unknown,
    copy: FollowUserErrorCopy,
): { type: FollowErrorType; message: string } {
    const raw = error instanceof Error ? error.message : String(error || '');
    const normalized = raw.toLowerCase();

    if (
        normalized.includes('user rejected')
        || normalized.includes('user denied')
        || normalized.includes('rejected the request')
        || normalized.includes('walletsigntransactionerror')
        || normalized.includes('walletsignmessageerror')
    ) {
        return {
            type: 'wallet_rejected',
            message: copy.signatureCancelled,
        };
    }

    if (
        normalized.includes('fetch failed')
        || normalized.includes('networkerror')
        || normalized.includes('failed to fetch')
        || normalized.includes('rpc')
        || normalized.includes('timeout')
    ) {
        return {
            type: 'network',
            message: copy.network,
        };
    }

    return {
        type: 'unknown',
        message: raw || copy.failed,
    };
}

function resolveIdentityGuard(input: {
    walletConnected: boolean;
    walletPublicKey: string | null;
    identityState: WalletIdentityState;
}, copy: FollowUserErrorCopy): { ok: true } | { ok: false; message: string } {
    if (!input.walletConnected || !input.walletPublicKey) {
        return {
            ok: false,
            message: copy.walletRequired,
        };
    }
    if (input.identityState === 'connecting_session') {
        return {
            ok: false,
            message: copy.identityChecking,
        };
    }
    if (input.identityState === 'unregistered') {
        return {
            ok: false,
            message: copy.identityRequired,
        };
    }
    if (input.identityState === 'session_error' || input.identityState === 'admission_required') {
        return {
            ok: false,
            message: copy.identityCheckFailed,
        };
    }
    return { ok: true };
}

export function useFollowUser(): UseFollowUserReturn {
    const sdk = useAlchemeSDK();
    const t = useI18n('WalletOnchainWrite');
    const {
        identityState,
        walletConnected,
        walletPublicKey,
    } = useIdentityOnboarding();

    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [indexed, setIndexed] = useState(false);
    const [status, setStatus] = useState<FollowStatus>('idle');
    const [error, setError] = useState<string | null>(null);
    const [errorType, setErrorType] = useState<FollowErrorType | null>(null);
    const [txSignature, setTxSignature] = useState<string | null>(null);
    const [pendingOutcome, setPendingOutcome] = useState<PendingFollowState | null>(null);

    const inFlightUserIdRef = useRef<number | null>(null);

    const clearPendingOutcome = useCallback(() => {
        setPendingOutcome(null);
    }, []);

    const execute = useCallback(async (action: FollowAction, input: FollowTargetInput): Promise<FollowActionResult> => {
        const errorCopy: FollowUserErrorCopy = {
            signatureCancelled: t('errors.followSignatureCancelled'),
            network: t('errors.followNetwork'),
            failed: t('errors.followFailed'),
            walletRequired: t('errors.followWalletRequired'),
            identityChecking: t('errors.followIdentityChecking'),
            identityRequired: t('errors.followIdentityRequired'),
            identityCheckFailed: t('errors.followIdentityCheckFailed'),
            targetProfilePending: t('errors.followTargetProfilePending'),
            memberProfilePending: t('errors.followMemberProfilePending'),
            invalidPubkey: t('errors.followInvalidPubkey'),
            self: t('errors.followSelf'),
            indexPending: t('errors.followIndexPending'),
        };
        const desiredFollowState = action === 'follow';

        if (!sdk?.provider.publicKey) {
            const message = errorCopy.walletRequired;
            setStatus('error');
            setErrorType('identity');
            setError(message);
            return {
                ok: false,
                indexed: false,
                txSignature: null,
                errorType: 'identity',
                pendingOutcome: null,
            };
        }

        const identityGuard = resolveIdentityGuard({
            walletConnected,
            walletPublicKey,
            identityState,
        }, errorCopy);
        if (!identityGuard.ok) {
            setStatus('error');
            setErrorType('identity');
            setError(identityGuard.message);
            return {
                ok: false,
                indexed: false,
                txSignature: null,
                errorType: 'identity',
                pendingOutcome: null,
            };
        }

        if (!Number.isFinite(input.targetUserId) || input.targetUserId <= 0) {
            const message = errorCopy.targetProfilePending;
            setStatus('error');
            setErrorType('invalid_target');
            setError(message);
            return {
                ok: false,
                indexed: false,
                txSignature: null,
                errorType: 'invalid_target',
                pendingOutcome: null,
            };
        }

        const normalizedTargetPubkey = normalizeFollowTargetPubkey(input.targetPubkey);
        if (!normalizedTargetPubkey) {
            const message = errorCopy.memberProfilePending;
            setStatus('error');
            setErrorType('invalid_target');
            setError(message);
            return {
                ok: false,
                indexed: false,
                txSignature: null,
                errorType: 'invalid_target',
                pendingOutcome: null,
            };
        }

        let targetPubkey: PublicKey;
        try {
            targetPubkey = new PublicKey(normalizedTargetPubkey);
        } catch {
            const message = errorCopy.invalidPubkey;
            setStatus('error');
            setErrorType('invalid_target');
            setError(message);
            return {
                ok: false,
                indexed: false,
                txSignature: null,
                errorType: 'invalid_target',
                pendingOutcome: null,
            };
        }

        if (targetPubkey.equals(sdk.provider.publicKey)) {
            const message = errorCopy.self;
            setStatus('error');
            setErrorType('invalid_target');
            setError(message);
            return {
                ok: false,
                indexed: false,
                txSignature: null,
                errorType: 'invalid_target',
                pendingOutcome: null,
            };
        }

        if (!canStartFollowWrite(inFlightUserIdRef.current)) {
            return {
                ok: false,
                indexed: false,
                txSignature: null,
                errorType: null,
                pendingOutcome,
            };
        }

        const initialPending = createPendingFollowState(input.targetUserId, desiredFollowState);
        inFlightUserIdRef.current = beginFollowWrite(input.targetUserId);
        setPendingOutcome(initialPending);
        setLoading(true);
        setSyncing(false);
        setIndexed(false);
        setStatus('loading');
        setError(null);
        setErrorType(null);
        setTxSignature(null);

        try {
            const signature = desiredFollowState
                ? await sdk.identity.followUser(targetPubkey)
                : await sdk.identity.unfollowUser(targetPubkey);

            setTxSignature(signature);
            setLoading(false);
            setSyncing(true);
            setStatus('syncing');

            const signatureSlot = await waitForSignatureSlot(sdk.connection, signature, {
                timeoutMs: 20_000,
                pollMs: 1_500,
            });

            if (signatureSlot === null) {
                const timeoutPending = markPendingFollowIndexTimeout(initialPending);
                setPendingOutcome(timeoutPending);
                setSyncing(false);
                setStatus('index_timeout');
                setErrorType('index_timeout');
                setError(errorCopy.indexPending);
                return {
                    ok: true,
                    indexed: false,
                    txSignature: signature,
                    errorType: 'index_timeout',
                    pendingOutcome: timeoutPending,
                };
            }

            const indexWait = await waitForIndexedSlot(signatureSlot, {
                timeoutMs: 45_000,
                pollMs: 1_500,
            });
            if (!indexWait.ok) {
                const timeoutPending = markPendingFollowIndexTimeout(initialPending);
                setPendingOutcome(timeoutPending);
                setSyncing(false);
                setStatus('index_timeout');
                setErrorType('index_timeout');
                setError(errorCopy.indexPending);
                return {
                    ok: true,
                    indexed: false,
                    txSignature: signature,
                    errorType: 'index_timeout',
                    pendingOutcome: timeoutPending,
                };
            }

            const indexedPending = markPendingFollowIndexed(initialPending);
            setSyncing(false);
            setIndexed(true);
            setPendingOutcome(indexedPending);
            setStatus('indexed');
            return {
                ok: true,
                indexed: true,
                txSignature: signature,
                errorType: null,
                pendingOutcome: indexedPending,
            };
        } catch (followError) {
            const normalized = normalizeFollowError(followError, errorCopy);
            setStatus('error');
            setErrorType(normalized.type);
            setError(normalized.message);
            setPendingOutcome(null);
            return {
                ok: false,
                indexed: false,
                txSignature: null,
                errorType: normalized.type,
                pendingOutcome: null,
            };
        } finally {
            inFlightUserIdRef.current = completeFollowWrite(inFlightUserIdRef.current, input.targetUserId);
            setLoading(false);
            setSyncing(false);
        }
    }, [identityState, pendingOutcome, sdk, t, walletConnected, walletPublicKey]);

    const followUser = useCallback((input: FollowTargetInput) => execute('follow', input), [execute]);
    const unfollowUser = useCallback((input: FollowTargetInput) => execute('unfollow', input), [execute]);

    return {
        followUser,
        unfollowUser,
        loading,
        syncing,
        indexed,
        status,
        error,
        errorType,
        txSignature,
        pendingOutcome,
        clearPendingOutcome,
    };
}
