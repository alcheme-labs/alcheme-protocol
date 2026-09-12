'use client';

import { useCallback, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { resolveWalletActionPolicy } from './actionPolicy';
import { useWalletAction } from './WalletActionProvider';
import type { WalletActionKind } from './types';

type SignableMessage = string | Uint8Array;

export function useWalletActionRunner() {
    const inFlightKeysRef = useRef(new Set<string>());
    const wallet = useWallet();
    const {
        beginWalletAction,
        completeWalletAction,
        reportWalletError,
    } = useWalletAction();

    const runWalletAction = useCallback(async <T,>(input: {
        kind: WalletActionKind;
        source: string;
        key?: string;
        expectedWalletPromptCount?: number;
        run: () => Promise<T>;
    }): Promise<T> => {
        const key = input.key || `${input.kind}:${input.source}`;
        if (inFlightKeysRef.current.has(key)) {
            throw new Error('wallet_action_already_in_flight');
        }

        const policy = resolveWalletActionPolicy({ kind: input.kind });
        inFlightKeysRef.current.add(key);

        try {
            const started = beginWalletAction({
                kind: policy.kind,
                source: input.source,
                key,
                expectedWalletPromptCount: input.expectedWalletPromptCount,
            });
            if (!started) {
                throw new Error('wallet_action_already_in_flight');
            }
            return await input.run();
        } catch (error) {
            reportWalletError(error);
            throw error;
        } finally {
            inFlightKeysRef.current.delete(key);
            completeWalletAction({ key });
        }
    }, [beginWalletAction, completeWalletAction, reportWalletError]);

    const signMessageForAction = useCallback(async (input: {
        kind: WalletActionKind;
        source: string;
        key?: string;
        message: SignableMessage;
        preserveCurrentAction?: boolean;
    }): Promise<Uint8Array> => {
        const sign = async (): Promise<Uint8Array> => {
            if (!wallet.signMessage) {
                throw new Error('wallet_sign_message_unavailable');
            }
            const messageBytes = typeof input.message === 'string'
                ? new TextEncoder().encode(input.message)
                : input.message;
            return wallet.signMessage(messageBytes);
        };

        if (input.preserveCurrentAction) {
            try {
                return await sign();
            } catch (error) {
                reportWalletError(error);
                throw error;
            }
        }

        return runWalletAction({
            kind: input.kind,
            source: input.source,
            key: input.key,
            run: sign,
        });
    }, [reportWalletError, runWalletAction, wallet]);

    const runWalletActionBatch = useCallback(async <T,>(input: {
        kind: WalletActionKind;
        source: string;
        key?: string;
        expectedWalletPromptCount: number;
        run: () => Promise<T>;
    }): Promise<T> => runWalletAction(input), [runWalletAction]);

    return {
        runWalletAction,
        runWalletActionBatch,
        signMessageForAction,
    };
}
