'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useI18n } from '@/i18n/useI18n';
import { normalizeWalletError, type NormalizedWalletError } from './walletErrors';
import { subscribeWalletAdapterError } from './walletErrorEvents';
import { resolveWalletActionPolicy } from './actionPolicy';
import { allowWalletAutoConnect, clearWalletAutoConnect } from './autoConnect';
import type { AlchemeWalletAccountSnapshot, WalletActionRequest } from './types';
import styles from './WalletActionStatusSurface.module.css';

interface WalletActionContextValue {
    account: AlchemeWalletAccountSnapshot;
    currentAction: WalletActionRequest | null;
    lastError: NormalizedWalletError | null;
    requestWalletConnection: (input: { source: string }) => void;
    requestWalletDisconnect: (input: { source: string }) => Promise<void>;
    beginWalletAction: (input: WalletActionRequest) => boolean;
    completeWalletAction: (input?: { key?: string }) => void;
    reportWalletError: (error: unknown) => NormalizedWalletError;
    clearWalletError: () => void;
}

const WalletActionContext = createContext<WalletActionContextValue | null>(null);

function WalletActionStatusSurface({
    currentAction,
    lastError,
    clearWalletError,
}: {
    currentAction: WalletActionRequest | null;
    lastError: NormalizedWalletError | null;
    clearWalletError: () => void;
}) {
    const t = useI18n('WalletAction');
    if (!lastError && !currentAction) {
        return null;
    }

    const actionPolicy = currentAction
        ? resolveWalletActionPolicy({ kind: currentAction.kind })
        : null;
    const message = lastError
        ? t(lastError.messageKey)
        : actionPolicy
            ? t(actionPolicy.userFacingSummaryKey)
            : t('summary.default');
    const promptCount = currentAction?.expectedWalletPromptCount;

    return (
        <div className={styles.surface} role={lastError ? 'alert' : 'status'}>
            <div className={styles.content}>
                <span className={styles.title}>{message}</span>
                {typeof promptCount === 'number' && promptCount > 0 ? (
                    <span className={styles.meta}>{t('expectedPromptCount', { count: promptCount })}</span>
                ) : null}
            </div>
            {lastError ? (
                <button type="button" className={styles.dismiss} onClick={clearWalletError}>
                    {t('dismiss')}
                </button>
            ) : null}
        </div>
    );
}

function resolveProviderKind(walletName: string | undefined): AlchemeWalletAccountSnapshot['providerKind'] {
    const normalized = String(walletName || '').toLowerCase();
    if (normalized.includes('native') && normalized.includes('phantom')) return 'native_phantom';
    if (normalized.includes('phantom')) return 'phantom';
    if (normalized.includes('solflare')) return 'solflare';
    if (normalized.includes('e2e')) return 'e2e_mock';
    return 'unknown';
}

export function WalletActionProvider({ children }: { children: ReactNode }) {
    const wallet = useWallet();
    const { visible: walletModalVisible, setVisible } = useWalletModal();
    const activeActionKeyRef = useRef<string | null>(null);
    const connectAttemptKeyRef = useRef<string | null>(null);
    const connectModalObservedRef = useRef(false);
    const walletConnectionStateRef = useRef({
        modalVisible: walletModalVisible,
        connected: wallet.connected,
        connecting: wallet.connecting,
        hasSelectedWallet: Boolean(wallet.wallet),
    });
    const [currentAction, setCurrentAction] = useState<WalletActionRequest | null>(null);
    const [lastError, setLastError] = useState<NormalizedWalletError | null>(null);

    const account = useMemo<AlchemeWalletAccountSnapshot>(() => ({
        source: 'external',
        providerKind: resolveProviderKind(wallet.wallet?.adapter.name),
        publicKey: wallet.publicKey?.toBase58() || null,
        connected: wallet.connected,
        connecting: wallet.connecting,
        canSignMessage: Boolean(wallet.signMessage),
        canSignTransaction: Boolean(wallet.signTransaction),
        canSendTransaction: Boolean(wallet.sendTransaction),
    }), [
        wallet.connected,
        wallet.connecting,
        wallet.publicKey,
        wallet.sendTransaction,
        wallet.signMessage,
        wallet.signTransaction,
        wallet.wallet?.adapter.name,
    ]);

    const reportWalletError = useCallback((error: unknown) => {
        const normalized = normalizeWalletError(error);
        setLastError(normalized);
        return normalized;
    }, []);

    useEffect(() => subscribeWalletAdapterError(reportWalletError), [reportWalletError]);

    useEffect(() => {
        walletConnectionStateRef.current = {
            modalVisible: walletModalVisible,
            connected: wallet.connected,
            connecting: wallet.connecting,
            hasSelectedWallet: Boolean(wallet.wallet),
        };
    }, [wallet.connected, wallet.connecting, wallet.wallet, walletModalVisible]);

    useEffect(() => {
        if (currentAction?.kind === 'connect_wallet' && walletModalVisible) {
            connectModalObservedRef.current = true;
        }
    }, [currentAction?.kind, walletModalVisible]);

    useEffect(() => {
        if (!wallet.connected || !wallet.publicKey) {
            return;
        }
        allowWalletAutoConnect();
        if (currentAction?.kind === 'connect_wallet') {
            activeActionKeyRef.current = null;
            connectAttemptKeyRef.current = null;
            connectModalObservedRef.current = false;
            setCurrentAction(null);
        }
    }, [currentAction?.kind, wallet.connected, wallet.publicKey]);

    useEffect(() => {
        if (
            currentAction?.kind !== 'connect_wallet'
            || walletModalVisible
            || wallet.connected
            || wallet.connecting
            || !wallet.wallet
        ) {
            return;
        }

        const actionKey = currentAction.key || `${currentAction.kind}:${currentAction.source}`;
        const attemptKey = `${actionKey}:${wallet.wallet.adapter.name}`;
        if (connectAttemptKeyRef.current === attemptKey) {
            return;
        }
        connectAttemptKeyRef.current = attemptKey;
        void wallet.connect().catch((error) => {
            reportWalletError(error);
            connectAttemptKeyRef.current = null;
            activeActionKeyRef.current = null;
            setCurrentAction(null);
        });
    }, [
        currentAction?.kind,
        currentAction?.key,
        currentAction?.source,
        reportWalletError,
        wallet,
        wallet.connected,
        wallet.connecting,
        wallet.wallet,
        walletModalVisible,
    ]);

    useEffect(() => {
        if (
            currentAction?.kind === 'connect_wallet'
            && !walletModalVisible
            && !wallet.connected
            && !wallet.connecting
            && !wallet.wallet
        ) {
            if (!connectModalObservedRef.current) {
                return;
            }
            reportWalletError(new Error('wallet_not_selected'));
            activeActionKeyRef.current = null;
            connectAttemptKeyRef.current = null;
            connectModalObservedRef.current = false;
            setCurrentAction(null);
        }
    }, [currentAction?.kind, reportWalletError, wallet.connected, wallet.connecting, wallet.wallet, walletModalVisible]);

    const beginWalletAction = useCallback((input: WalletActionRequest) => {
        const key = input.key || `${input.kind}:${input.source}`;
        if (activeActionKeyRef.current) {
            return false;
        }
        activeActionKeyRef.current = key;
        setCurrentAction(input);
        setLastError(null);
        return true;
    }, []);

    const completeWalletAction = useCallback((input?: { key?: string }) => {
        if (input?.key && activeActionKeyRef.current && activeActionKeyRef.current !== input.key) {
            return;
        }
        activeActionKeyRef.current = null;
        setCurrentAction(null);
    }, []);

    const requestWalletConnection = useCallback((input: { source: string }) => {
        const policy = resolveWalletActionPolicy({ kind: 'connect_wallet' });
        const key = `${policy.kind}:${input.source}`;
        if (!beginWalletAction({ kind: policy.kind, source: input.source, key })) {
            reportWalletError(new Error('wallet_action_already_in_flight'));
            return;
        }
        connectModalObservedRef.current = false;
        setVisible(true);
        window.setTimeout(() => {
            const state = walletConnectionStateRef.current;
            if (
                activeActionKeyRef.current !== key
                || state.modalVisible
                || state.connected
                || state.connecting
                || state.hasSelectedWallet
            ) {
                return;
            }
            reportWalletError(new Error('wallet_not_ready'));
            activeActionKeyRef.current = null;
            connectAttemptKeyRef.current = null;
            connectModalObservedRef.current = false;
            setCurrentAction(null);
        }, 1200);
    }, [beginWalletAction, reportWalletError, setVisible]);

    const requestWalletDisconnect = useCallback(async (input: { source: string }) => {
        const policy = resolveWalletActionPolicy({ kind: 'disconnect_wallet' });
        const key = `${policy.kind}:${input.source}`;
        if (!beginWalletAction({ kind: policy.kind, source: input.source, key })) {
            reportWalletError(new Error('wallet_action_already_in_flight'));
            return;
        }
        clearWalletAutoConnect();
        try {
            await wallet.disconnect();
        } catch (error) {
            reportWalletError(error);
            throw error;
        } finally {
            completeWalletAction({ key });
        }
    }, [beginWalletAction, completeWalletAction, reportWalletError, wallet]);

    const clearWalletError = useCallback(() => {
        setLastError(null);
    }, []);

    const value = useMemo<WalletActionContextValue>(() => ({
        account,
        currentAction,
        lastError,
        requestWalletConnection,
        requestWalletDisconnect,
        beginWalletAction,
        completeWalletAction,
        reportWalletError,
        clearWalletError,
    }), [
        account,
        beginWalletAction,
        clearWalletError,
        completeWalletAction,
        currentAction,
        lastError,
        reportWalletError,
        requestWalletConnection,
        requestWalletDisconnect,
    ]);

    return (
        <WalletActionContext.Provider value={value}>
            {children}
            <WalletActionStatusSurface
                currentAction={currentAction}
                lastError={lastError}
                clearWalletError={clearWalletError}
            />
        </WalletActionContext.Provider>
    );
}

export function useWalletAction(): WalletActionContextValue {
    const value = useContext(WalletActionContext);
    if (!value) {
        throw new Error('useWalletAction must be used within WalletActionProvider');
    }
    return value;
}
