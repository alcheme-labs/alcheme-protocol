type WalletAdapterErrorListener = (error: unknown) => void;

const listeners = new Set<WalletAdapterErrorListener>();

export function notifyWalletAdapterError(error: unknown): void {
    for (const listener of Array.from(listeners)) {
        listener(error);
    }
}

export function subscribeWalletAdapterError(listener: WalletAdapterErrorListener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
