'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
    CIRCLE_SHORTCUTS_CHANGED_EVENT,
    createEmptyCircleShortcutsState,
    findPrimaryCircleShortcut,
    notifyCircleShortcutsChanged,
    readCircleShortcuts,
    removeCircleShortcut,
    setPrimaryCircleShortcut,
    upsertCircleShortcut,
    writeCircleShortcuts,
    type CircleShortcutDraft,
    type CircleShortcutsState,
} from './shortcuts';

export function useCircleShortcuts() {
    const [state, setState] = useState<CircleShortcutsState>(() => createEmptyCircleShortcutsState());
    const [hydrated, setHydrated] = useState(false);

    useEffect(() => {
        setState(readCircleShortcuts());
        setHydrated(true);

        const refresh = () => setState(readCircleShortcuts());
        window.addEventListener('storage', refresh);
        window.addEventListener(CIRCLE_SHORTCUTS_CHANGED_EVENT, refresh);
        return () => {
            window.removeEventListener('storage', refresh);
            window.removeEventListener(CIRCLE_SHORTCUTS_CHANGED_EVENT, refresh);
        };
    }, []);

    const persist = useCallback((buildNext: (current: CircleShortcutsState) => CircleShortcutsState) => {
        const next = writeCircleShortcuts(buildNext(readCircleShortcuts()));
        setState(next);
        notifyCircleShortcutsChanged();
    }, []);

    const addShortcut = useCallback((
        draft: CircleShortcutDraft,
        options?: Parameters<typeof upsertCircleShortcut>[2],
    ) => {
        persist((current) => upsertCircleShortcut(current, draft, options));
    }, [persist]);

    const removeShortcut = useCallback((circleId: number) => {
        persist((current) => removeCircleShortcut(current, circleId));
    }, [persist]);

    const setPrimaryShortcut = useCallback((circleId: number, autoEnterEnabled = true) => {
        persist((current) => setPrimaryCircleShortcut(current, circleId, autoEnterEnabled));
    }, [persist]);

    const primaryShortcut = useMemo(() => findPrimaryCircleShortcut(state), [state]);

    return {
        hydrated,
        state,
        shortcuts: state.shortcuts,
        primaryShortcut,
        addShortcut,
        removeShortcut,
        setPrimaryShortcut,
    };
}
