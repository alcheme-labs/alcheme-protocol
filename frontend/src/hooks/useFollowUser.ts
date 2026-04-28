'use client';

import { useCallback, useRef, useState } from 'react';
import { PublicKey } from '@solana/web3.js';

import { useAlchemeSDK } from './useAlchemeSDK';
import { waitForIndexedSlot, waitForSignatureSlot } from '@/lib/api/sync';
import { useIdentityOnboarding } from '@/lib/auth/identityOnboarding';
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

function normalizeFollowError(error: unknown): { type: FollowErrorType; message: string } {
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
            message: '你取消了钱包签名，本次关注操作未提交。',
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
            message: '网络或 RPC 异常，关注状态暂未更新，请稍后重试。',
        };
    }

    return {
        type: 'unknown',
        message: raw || '关注操作失败，请稍后重试。',
    };
}

function resolveIdentityGuard(input: {
    walletConnected: boolean;
    walletPublicKey: string | null;
    identityState: 'disconnected' | 'connecting_session' | 'registered' | 'unregistered' | 'session_error';
}): { ok: true } | { ok: false; message: string } {
    if (!input.walletConnected || !input.walletPublicKey) {
        return {
            ok: false,
            message: '请先连接钱包后再关注成员。',
        };
    }
    if (input.identityState === 'connecting_session') {
        return {
            ok: false,
            message: '身份确认中，请稍候后再试。',
        };
    }
    if (input.identityState === 'unregistered') {
        return {
            ok: false,
            message: '请先创建链上身份后再关注成员。',
        };
    }
    if (input.identityState === 'session_error') {
        return {
            ok: false,
            message: '身份状态确认失败，请先重试身份确认。',
        };
    }
    return { ok: true };
}

export function useFollowUser(): UseFollowUserReturn {
    const sdk = useAlchemeSDK();
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
        const desiredFollowState = action === 'follow';

        if (!sdk?.provider.publicKey) {
            const message = '请先连接钱包后再关注成员。';
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
        });
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
            const message = '目标成员资料未就绪，请稍后重试。';
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
            const message = '成员资料未就绪，暂时无法关注。';
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
            const message = '成员公钥格式无效，暂时无法关注。';
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
            const message = '不能关注自己。';
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
                setError('关注交易已上链，索引同步中。');
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
                setError('关注交易已上链，索引同步中。');
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
            const normalized = normalizeFollowError(followError);
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
    }, [identityState, pendingOutcome, sdk, walletConnected, walletPublicKey]);

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
