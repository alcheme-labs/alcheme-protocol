'use client';

import {
    BaseMessageSignerWalletAdapter,
    WalletReadyState,
    type SendTransactionOptions,
    type TransactionOrVersionedTransaction,
    type WalletName,
} from '@solana/wallet-adapter-base';
import type { Connection, TransactionSignature } from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';

export const E2E_WALLET_NAME = 'Codex E2E Wallet';
const E2E_WALLET_ICON = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2264%22 height=%2264%22 viewBox=%220 0 64 64%22 fill=%22none%22%3E%3Ccircle cx=%2232%22 cy=%2232%22 r=%2230%22 fill=%22%231F2421%22 stroke=%22%23C7A86B%22 stroke-width=%222%22/%3E%3Cpath d=%22M20 20h24v24H20z%22 stroke=%22%23C7A86B%22 stroke-width=%222%22/%3E%3Cpath d=%22M24 32h16%22 stroke=%22%23C7A86B%22 stroke-width=%222%22/%3E%3C/svg%3E';
const DEFAULT_E2E_WALLET_PUBKEY = '11111111111111111111111111111111';

function readConfiguredPubkey(): PublicKey {
    if (typeof window === 'undefined') {
        return new PublicKey(DEFAULT_E2E_WALLET_PUBKEY);
    }
    const configured = window.localStorage.getItem('alcheme_e2e_wallet_pubkey') || DEFAULT_E2E_WALLET_PUBKEY;
    return new PublicKey(configured);
}

export class E2EWalletAdapter extends BaseMessageSignerWalletAdapter<typeof E2E_WALLET_NAME> {
    name = E2E_WALLET_NAME as WalletName<typeof E2E_WALLET_NAME>;
    url = 'https://example.invalid/codex-e2e-wallet';
    icon = E2E_WALLET_ICON;
    readyState = WalletReadyState.Installed;
    publicKey: PublicKey | null = null;
    connecting = false;
    supportedTransactionVersions = null;

    async connect(): Promise<void> {
        if (this.connected || this.connecting) return;
        this.connecting = true;
        try {
            this.publicKey = readConfiguredPubkey();
            this.emit('connect', this.publicKey);
        } finally {
            this.connecting = false;
        }
    }

    async disconnect(): Promise<void> {
        if (typeof window !== 'undefined') {
            try {
                window.localStorage.removeItem('alcheme_e2e_wallet_pubkey');
            } catch {
                // Ignore storage failures in mock-wallet mode.
            }
        }
        if (!this.publicKey) return;
        this.publicKey = null;
        this.emit('disconnect');
    }

    async signTransaction<T extends TransactionOrVersionedTransaction<this['supportedTransactionVersions']>>(
        transaction: T,
    ): Promise<T> {
        return transaction;
    }

    async signAllTransactions<T extends TransactionOrVersionedTransaction<this['supportedTransactionVersions']>>(
        transactions: T[],
    ): Promise<T[]> {
        return transactions;
    }

    async signMessage(message: Uint8Array): Promise<Uint8Array> {
        return message;
    }

    async sendTransaction(
        _transaction: TransactionOrVersionedTransaction<this['supportedTransactionVersions']>,
        _connection: Connection,
        _options?: SendTransactionOptions,
    ): Promise<TransactionSignature> {
        return 'e2e_wallet_signature';
    }
}
