export const WALLET_AUTOCONNECT_STORAGE_KEY = 'alcheme_wallet_autoconnect_allowed_v1';

export function shouldAttemptWalletAutoConnect(): boolean {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(WALLET_AUTOCONNECT_STORAGE_KEY) === '1';
}

export function allowWalletAutoConnect(): void {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(WALLET_AUTOCONNECT_STORAGE_KEY, '1');
}

export function clearWalletAutoConnect(): void {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(WALLET_AUTOCONNECT_STORAGE_KEY);
}
