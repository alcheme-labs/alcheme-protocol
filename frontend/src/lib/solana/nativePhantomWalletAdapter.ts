'use client';

import bs58 from 'bs58';
import {
    BaseMessageSignerWalletAdapter,
    WalletConnectionError,
    WalletDisconnectionError,
    WalletNotConnectedError,
    WalletNotReadyError,
    WalletPublicKeyError,
    WalletReadyState,
    WalletSignMessageError,
    WalletSignTransactionError,
    type TransactionOrVersionedTransaction,
    type WalletName,
} from '@solana/wallet-adapter-base';
import {
    PublicKey,
    Transaction,
    VersionedTransaction,
    type TransactionVersion,
} from '@solana/web3.js';
import {
    assertNativePhantomTransactionSigningSupported,
    buildPhantomConnectUrl,
    buildPhantomProviderMethodUrl,
    createPhantomEncryptionKeypair,
    decryptPhantomConnectCallback,
    decryptPhantomProviderCallback,
    derivePhantomSharedSecret,
    resolveNativePhantomTransportUrl,
    shouldRefreshNativePhantomSessionOnError,
} from '../../../config/nativePhantomDeeplink.mjs';
import {
    isNativeWalletBridgeAvailable,
    onNativeWalletCallback,
    requestNativeOpenExternalUrl,
} from '../mobile/nativeWalletBridge';

type NativePhantomMethod =
    | 'signAllTransactions'
    | 'signMessage'
    | 'signTransaction';

interface NativePhantomSessionRecord {
    dappEncryptionPublicKey: string;
    dappEncryptionSecretKey: string;
    phantomEncryptionPublicKey: string;
    session: string;
    walletPublicKey: string;
}

export const NATIVE_PHANTOM_SESSION_STORAGE_KEY = 'alcheme_native_phantom_session_v1';
const NATIVE_PHANTOM_CALLBACK_TIMEOUT_MS = 180_000;
const NATIVE_PHANTOM_REDIRECT_URL = 'alcheme://wallet/callback';
const NATIVE_PHANTOM_METHOD_LABEL = 'Phantom';
const NATIVE_PHANTOM_CLUSTER = resolveNativePhantomCluster(process.env.NEXT_PUBLIC_SOLANA_RPC_URL);

export const NativePhantomWalletName = NATIVE_PHANTOM_METHOD_LABEL as WalletName<'Phantom'>;

export class NativePhantomWalletAdapter extends BaseMessageSignerWalletAdapter<typeof NativePhantomWalletName> {
    name = NativePhantomWalletName;
    url = 'https://phantom.app/download';
    icon =
        'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDgiIGhlaWdodD0iMTA4IiB2aWV3Qm94PSIwIDAgMTA4IDEwOCIgZmlsbD0ibm9uZSI+CjxyZWN0IHdpZHRoPSIxMDgiIGhlaWdodD0iMTA4IiByeD0iMjYiIGZpbGw9IiNBQjlGRjIiLz4KPHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik00Ni41MjY3IDY5LjkyMjlDNDIuMDA1NCA3Ni44NTA5IDM0LjQyOTIgODUuNjE4MiAyNC4zNDggODUuNjE4MkMxOS41ODI0IDg1LjYxODIgMTUgODMuNjU2MyAxNSA3NS4xMzQyQzE1IDUzLjQzMDUgNDQuNjMyNiAxOS44MzI3IDcyLjEyNjggMTkuODMyN0M4Ny43NjggMTkuODMyNyA5NCAzMC42ODQ2IDk0IDQzLjAwNzlDOTQgNTguODI1OCA4My43MzU1IDc2LjkxMjIgNzMuNTMyMSA3Ni45MTIyQzcwLjI5MzkgNzYuOTEyMiA2OC43MDUzIDc1LjEzNDIgNjguNzA1MyA3Mi4zMTRDNjguNzA1MyA3MS41NzgzIDY4LjgyNzUgNzAuNzgxMiA2OS4wNzE5IDY5LjkyMjlDNjUuNTg5MyA3NS44Njk5IDU4Ljg2ODUgODEuMzg3OCA1Mi41NzU0IDgxLjM4NzhDNDcuOTkzIDgxLjM4NzggNDUuNjcxMyA3OC41MDYzIDQ1LjY3MTMgNzQuNDU5OEM0NS42NzEzIDcyLjk4ODQgNDUuOTc2OCA3MS40NTU2IDQ2LjUyNjcgNjkuOTIyOVpNODMuNjc2MSA0Mi41Nzk0QzgzLjY3NjEgNDYuMTcwNCA4MS41NTc1IDQ3Ljk2NTggNzkuMTg3NSA0Ny45NjU4Qzc2Ljc4MTYgNDcuOTY1OCA3NC42OTg5IDQ2LjE3MDQgNzQuNjk4OSA0Mi41Nzk0Qzc0LjY5ODkgMzguOTg4NSA3Ni43ODE2IDM3LjE5MzEgNzkuMTg3NSAzNy4xOTMxQzgxLjU1NzUgMzcuMTkzMSA4My42NzYxIDM4Ljk4ODUgODMuNjc2MSA0Mi41Nzk0Wk03MC4yMTAzIDQyLjU3OTVDNzAuMjEwMyA0Ni4xNzA0IDY4LjA5MTYgNDcuOTY1OCA2NS43MjE2IDQ3Ljk2NThDNjMuMzE1NyA0Ny45NjU4IDYxLjIzMyA0Ni4xNzA0IDYxLjIzMyA0Mi41Nzk1QzYxLjIzMyAzOC45ODg1IDYzLjMxNTcgMzcuMTkzMSA2NS43MjE2IDM3LjE5MzFDNjguMDkxNiAzNy4xOTMxIDcwLjIxMDMgMzguOTg4NSA3MC4yMTAzIDQyLjU3OTVaIiBmaWxsPSIjRkZGREY4Ii8+Cjwvc3ZnPg==';
    supportedTransactionVersions: ReadonlySet<TransactionVersion> = new Set(['legacy', 0]);
    publicKey: PublicKey | null = null;
    connecting = false;

    private sessionRecord: NativePhantomSessionRecord | null = null;

    get readyState(): WalletReadyState {
        return isNativeWalletBridgeAvailable()
            ? WalletReadyState.Installed
            : WalletReadyState.Unsupported;
    }

    async autoConnect(): Promise<void> {
        if (this.connected) {
            return;
        }

        const sessionRecord = this.readSessionRecord();
        if (!sessionRecord) {
            return;
        }

        this.applySessionRecord(sessionRecord);
        if (this.publicKey) {
            this.emit('connect', this.publicKey);
        }
    }

    async connect(): Promise<void> {
        try {
            if (this.connected || this.connecting) {
                return;
            }

            if (this.readyState !== WalletReadyState.Installed) {
                throw new WalletNotReadyError();
            }

            const cachedSession = this.readSessionRecord();
            if (cachedSession) {
                this.applySessionRecord(cachedSession);
                if (!this.publicKey) {
                    throw new WalletPublicKeyError();
                }
                this.emit('connect', this.publicKey);
                return;
            }

            await this.establishFreshSession();
            if (!this.publicKey) {
                throw new WalletPublicKeyError();
            }

            this.emit('connect', this.publicKey);
        } catch (error: unknown) {
            const wrappedError = error instanceof Error
                ? new WalletConnectionError(error.message, error)
                : new WalletConnectionError('Native Phantom connection failed.');
            this.emit('error', wrappedError);
            throw wrappedError;
        } finally {
            this.connecting = false;
        }
    }

    async disconnect(): Promise<void> {
        try {
            this.clearSessionRecord();
        } catch (error: unknown) {
            const wrappedError = error instanceof Error
                ? new WalletDisconnectionError(error.message, error)
                : new WalletDisconnectionError('Native Phantom disconnect failed.');
            this.emit('error', wrappedError);
            throw wrappedError;
        }

        this.emit('disconnect');
    }

    async signTransaction<T extends TransactionOrVersionedTransaction<this['supportedTransactionVersions']>>(
        transaction: T,
    ): Promise<T> {
        try {
            const payload = await this.requestProviderPayload('signTransaction', {
                transaction: serializeTransaction(transaction),
            });
            const encodedTransaction = payload?.transaction;
            if (typeof encodedTransaction !== 'string') {
                throw new Error('Missing signed transaction in Phantom callback.');
            }

            return deserializeSignedTransaction(transaction, encodedTransaction);
        } catch (error: unknown) {
            const wrappedError = error instanceof Error
                ? new WalletSignTransactionError(error.message, error)
                : new WalletSignTransactionError('Native Phantom signTransaction failed.');
            this.emit('error', wrappedError);
            throw wrappedError;
        }
    }

    async signAllTransactions<T extends TransactionOrVersionedTransaction<this['supportedTransactionVersions']>>(
        transactions: T[],
    ): Promise<T[]> {
        try {
            const payload = await this.requestProviderPayload('signAllTransactions', {
                transactions: transactions.map((transaction) => serializeTransaction(transaction)),
            });
            const encodedTransactions = payload?.transactions;
            if (!Array.isArray(encodedTransactions)) {
                throw new Error('Missing signed transactions in Phantom callback.');
            }

            return transactions.map((transaction, index) => {
                const encodedTransaction = encodedTransactions[index];
                if (typeof encodedTransaction !== 'string') {
                    throw new Error('Signed transaction payload is incomplete.');
                }
                return deserializeSignedTransaction(transaction, encodedTransaction);
            });
        } catch (error: unknown) {
            const wrappedError = error instanceof Error
                ? new WalletSignTransactionError(error.message, error)
                : new WalletSignTransactionError('Native Phantom signAllTransactions failed.');
            this.emit('error', wrappedError);
            throw wrappedError;
        }
    }

    async signMessage(message: Uint8Array): Promise<Uint8Array> {
        try {
            const payload = await this.requestProviderPayload('signMessage', {
                message: bs58.encode(message),
                display: 'utf8',
            });
            const signature = payload?.signature;
            if (typeof signature !== 'string') {
                throw new Error('Missing signature in Phantom callback.');
            }

            return bs58.decode(signature);
        } catch (error: unknown) {
            const wrappedError = error instanceof Error
                ? new WalletSignMessageError(error.message, error)
                : new WalletSignMessageError('Native Phantom signMessage failed.');
            this.emit('error', wrappedError);
            throw wrappedError;
        }
    }

    private async requestProviderPayload(
        method: NativePhantomMethod,
        payload: Record<string, unknown>,
        allowSessionRefresh = true,
    ): Promise<Record<string, unknown> | null> {
        if (method === 'signTransaction' || method === 'signAllTransactions') {
            assertNativePhantomTransactionSigningSupported(process.env.NEXT_PUBLIC_SOLANA_RPC_URL);
        }

        const sessionRecord = this.requireSessionRecord();
        const requestId = createNativePhantomRequestId(method);
        const providerUrl = buildPhantomProviderMethodUrl({
            method,
            redirectUrl: NATIVE_PHANTOM_REDIRECT_URL,
            dappEncryptionPublicKey: sessionRecord.dappEncryptionPublicKey,
            sharedSecret: derivePhantomSharedSecret({
                dappEncryptionSecretKey: bs58.decode(sessionRecord.dappEncryptionSecretKey),
                phantomEncryptionPublicKey: sessionRecord.phantomEncryptionPublicKey,
            }),
            payload: {
                ...payload,
                session: sessionRecord.session,
            },
            requestId,
        });

            const transportUrl = resolveNativePhantomTransportUrl(providerUrl, {
                preferProtocolHandler: true,
            });
        const callbackPromise = waitForNativePhantomCallback(requestId);
        const didOpen = requestNativeOpenExternalUrl(transportUrl.toString());
        if (!didOpen) {
            throw new Error(`Unable to open Phantom for ${method}.`);
        }

        try {
            const callbackUrl = await callbackPromise;
            const result = decryptPhantomProviderCallback({
                callbackUrl,
                sharedSecret: derivePhantomSharedSecret({
                    dappEncryptionSecretKey: bs58.decode(sessionRecord.dappEncryptionSecretKey),
                    phantomEncryptionPublicKey: sessionRecord.phantomEncryptionPublicKey,
                }),
            });

            return result.payload;
        } catch (error: unknown) {
            if (allowSessionRefresh && shouldRefreshNativePhantomSessionOnError(error)) {
                this.clearSessionRecord();
                await this.establishFreshSession();
                return this.requestProviderPayload(method, payload, false);
            }

            throw error;
        }
    }

    private async establishFreshSession(): Promise<void> {
        const keypair = createPhantomEncryptionKeypair();
        const requestId = createNativePhantomRequestId('connect');
        const connectUrl = buildPhantomConnectUrl({
            appUrl: getNativePhantomAppUrl(),
            cluster: NATIVE_PHANTOM_CLUSTER,
            redirectUrl: NATIVE_PHANTOM_REDIRECT_URL,
            dappEncryptionPublicKey: bs58.encode(keypair.publicKey),
            requestId,
        });

        const transportUrl = resolveNativePhantomTransportUrl(connectUrl, {
            preferProtocolHandler: true,
        });
        const callbackPromise = waitForNativePhantomCallback(requestId);
        const didOpen = requestNativeOpenExternalUrl(transportUrl.toString());
        if (!didOpen) {
            throw new WalletConnectionError('Unable to open Phantom from the native shell bridge.');
        }

        const callbackUrl = await callbackPromise;
        const result = decryptPhantomConnectCallback({
            callbackUrl,
            dappEncryptionSecretKey: keypair.secretKey,
            rpcUrl: process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
        });
        const sessionRecord: NativePhantomSessionRecord = {
            dappEncryptionPublicKey: bs58.encode(keypair.publicKey),
            dappEncryptionSecretKey: bs58.encode(keypair.secretKey),
            phantomEncryptionPublicKey: result.phantomEncryptionPublicKey,
            session: result.session,
            walletPublicKey: result.publicKey,
        };

        this.persistSessionRecord(sessionRecord);
        this.applySessionRecord(sessionRecord);
    }

    private requireSessionRecord(): NativePhantomSessionRecord {
        const sessionRecord = this.sessionRecord ?? this.readSessionRecord();
        if (!sessionRecord) {
            throw new WalletNotConnectedError();
        }

        this.sessionRecord = sessionRecord;
        return sessionRecord;
    }

    private readSessionRecord(): NativePhantomSessionRecord | null {
        if (typeof window === 'undefined') {
            return this.sessionRecord;
        }

        const raw = window.localStorage.getItem(NATIVE_PHANTOM_SESSION_STORAGE_KEY);
        if (!raw) {
            return null;
        }

        try {
            const parsed = JSON.parse(raw) as NativePhantomSessionRecord;
            if (
                !parsed?.walletPublicKey
                || !parsed?.session
                || !parsed?.phantomEncryptionPublicKey
                || !parsed?.dappEncryptionSecretKey
                || !parsed?.dappEncryptionPublicKey
            ) {
                return null;
            }

            return parsed;
        } catch {
            return null;
        }
    }

    private persistSessionRecord(sessionRecord: NativePhantomSessionRecord): void {
        this.sessionRecord = sessionRecord;
        if (typeof window !== 'undefined') {
            window.localStorage.setItem(
                NATIVE_PHANTOM_SESSION_STORAGE_KEY,
                JSON.stringify(sessionRecord),
            );
        }
    }

    private clearSessionRecord(): void {
        this.sessionRecord = null;
        this.publicKey = null;
        if (typeof window !== 'undefined') {
            window.localStorage.removeItem(NATIVE_PHANTOM_SESSION_STORAGE_KEY);
        }
    }

    private applySessionRecord(sessionRecord: NativePhantomSessionRecord): void {
        this.sessionRecord = sessionRecord;
        try {
            this.publicKey = new PublicKey(sessionRecord.walletPublicKey);
        } catch (error: unknown) {
            this.clearSessionRecord();
            const wrappedError = error instanceof Error
                ? new WalletPublicKeyError(error.message, error)
                : new WalletPublicKeyError();
            this.emit('error', wrappedError);
            throw wrappedError;
        }
    }
}

function createNativePhantomRequestId(prefix: string): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}-${crypto.randomUUID()}`;
    }

    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getNativePhantomAppUrl(): string {
    if (typeof window === 'undefined') {
        return 'https://alcheme.local';
    }

    return window.location.origin;
}

function waitForNativePhantomCallback(requestId: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
            unsubscribe();
            reject(new Error('Timed out waiting for Phantom wallet response.'));
        }, NATIVE_PHANTOM_CALLBACK_TIMEOUT_MS);

        const unsubscribe = onNativeWalletCallback((callbackUrl) => {
            try {
                const url = new URL(callbackUrl);
                if (url.searchParams.get('request_id') !== requestId) {
                    return;
                }

                window.clearTimeout(timer);
                unsubscribe();
                resolve(callbackUrl);
            } catch (error: unknown) {
                window.clearTimeout(timer);
                unsubscribe();
                reject(error instanceof Error ? error : new Error('Malformed Phantom callback URL.'));
            }
        });
    });
}

function serializeTransaction(
    transaction: Transaction | VersionedTransaction,
): string {
    if (transaction instanceof VersionedTransaction) {
        return bs58.encode(transaction.serialize());
    }

    return bs58.encode(
        transaction.serialize({
            requireAllSignatures: false,
            verifySignatures: false,
        }),
    );
}

function deserializeSignedTransaction<T extends Transaction | VersionedTransaction>(
    originalTransaction: T,
    encodedTransaction: string,
): T {
    const bytes = bs58.decode(encodedTransaction);
    if (originalTransaction instanceof VersionedTransaction) {
        return VersionedTransaction.deserialize(bytes) as T;
    }

    return Transaction.from(bytes) as T;
}

function resolveNativePhantomCluster(rpcUrl: string | undefined): 'devnet' | 'mainnet-beta' | 'testnet' {
    const value = String(rpcUrl || '').toLowerCase();
    if (value.includes('testnet')) {
        return 'testnet';
    }

    if (value.includes('mainnet')) {
        return 'mainnet-beta';
    }

    return 'devnet';
}
