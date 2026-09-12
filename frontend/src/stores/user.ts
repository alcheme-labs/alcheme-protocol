import { create } from 'zustand';

interface UserState {
    /** Wallet public key as base58 string */
    walletAddress: string | null;
    /** User handle from backend */
    handle: string | null;
    /** Display name */
    displayName: string | null;
    /** Avatar URI */
    avatarUri: string | null;
    /** Reputation score */
    reputation: number;
    /** Whether the user profile has been loaded */
    profileLoaded: boolean;

    // Actions
    setWallet: (address: string | null) => void;
    setProfile: (profile: {
        handle: string;
        displayName: string | null;
        avatarUri: string | null;
        reputation: number;
    }) => void;
    clearProfile: () => void;
}

export const useUserStore = create<UserState>((set) => ({
    walletAddress: null,
    handle: null,
    displayName: null,
    avatarUri: null,
    reputation: 0,
    profileLoaded: false,

    setWallet: (address) => set({ walletAddress: address }),

    setProfile: (profile) =>
        set({
            handle: profile.handle,
            displayName: profile.displayName,
            avatarUri: profile.avatarUri,
            reputation: profile.reputation,
            profileLoaded: true,
        }),

    clearProfile: () =>
        set({
            walletAddress: null,
            handle: null,
            displayName: null,
            avatarUri: null,
            reputation: 0,
            profileLoaded: false,
        }),
}));
