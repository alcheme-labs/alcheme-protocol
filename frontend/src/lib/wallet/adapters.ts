import type { AlchemeWalletAccountSnapshot } from './types';

export interface AlchemeWalletAdapterRuntime {
    getSnapshot(): AlchemeWalletAccountSnapshot;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    signMessage?(message: Uint8Array): Promise<Uint8Array>;
    signTransaction?(transaction: unknown): Promise<unknown>;
    sendTransaction?(transaction: unknown, connection: unknown): Promise<string>;
}

export const EMBEDDED_WALLET_NOT_IMPLEMENTED = 'embedded_wallet_not_implemented';
