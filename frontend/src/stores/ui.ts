import { create } from 'zustand';

interface UIState {
    /** Bottom sheet visibility */
    sheetOpen: boolean;
    /** Sheet content identifier */
    sheetContent: string | null;
    /** Search modal state */
    searchOpen: boolean;
    /** Toast messages */
    toast: { message: string; type: 'info' | 'success' | 'error' } | null;

    // Actions
    openSheet: (content: string) => void;
    closeSheet: () => void;
    toggleSearch: () => void;
    showToast: (message: string, type?: 'info' | 'success' | 'error') => void;
    dismissToast: () => void;
}

export const useUIStore = create<UIState>((set) => ({
    sheetOpen: false,
    sheetContent: null,
    searchOpen: false,
    toast: null,

    openSheet: (content) => set({ sheetOpen: true, sheetContent: content }),
    closeSheet: () => set({ sheetOpen: false, sheetContent: null }),
    toggleSearch: () => set((s) => ({ searchOpen: !s.searchOpen })),

    showToast: (message, type = 'info') => {
        set({ toast: { message, type } });
        // Auto-dismiss after 3s
        setTimeout(() => set({ toast: null }), 3000);
    },

    dismissToast: () => set({ toast: null }),
}));
