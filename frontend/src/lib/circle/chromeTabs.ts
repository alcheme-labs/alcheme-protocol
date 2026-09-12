export type CircleChromeMode = 'social' | 'knowledge';
export type CircleChromeTab = 'plaza' | 'feed' | 'crucible' | 'sanctuary' | 'governance';

export function resolveChromeTabs(mode: CircleChromeMode): CircleChromeTab[] {
    return mode === 'social'
        ? ['plaza', 'feed', 'governance']
        : ['plaza', 'crucible', 'sanctuary', 'governance'];
}

export function isFeedSurfaceAllowed(_mode: CircleChromeMode): boolean {
    return true;
}

export function canOpenTab(
    tabs: string[],
    mode: CircleChromeMode,
    tab: string,
): boolean {
    if (tab === 'feed' && isFeedSurfaceAllowed(mode)) return true;
    return tabs.includes(tab);
}

export function resolveTabBarActiveIndex(tabIds: string[], activeTab: string): number {
    return tabIds.indexOf(activeTab);
}
