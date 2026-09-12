import type { WalletIdentityState } from '@/lib/auth/identityOnboarding';

interface WalletSurfaceStateOptions {
    walletConnected: boolean;
    identityState: WalletIdentityState;
}

interface EditableProfileStateOptions extends WalletSurfaceStateOptions {
    handle: string | null | undefined;
}

export function shouldShowHomeWalletBadge(walletConnected: boolean): boolean {
    return walletConnected;
}

export function shouldLoadRegisteredProfile({
    walletConnected,
    identityState,
}: WalletSurfaceStateOptions): boolean {
    return walletConnected && identityState === 'registered';
}

export function canEditRegisteredProfile({
    walletConnected,
    identityState,
    handle,
}: EditableProfileStateOptions): boolean {
    return shouldLoadRegisteredProfile({ walletConnected, identityState }) && Boolean(handle);
}

export function resolveRegisteredProfileItems<T>({
    walletConnected,
    identityState,
    items,
}: WalletSurfaceStateOptions & {
    items: T[] | null | undefined;
}): T[] {
    if (!shouldLoadRegisteredProfile({ walletConnected, identityState })) {
        return [];
    }
    return items ?? [];
}
