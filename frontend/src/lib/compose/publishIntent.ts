export type PublishIntent = 'feed' | 'draft';
export type FeedVisibility = 'Public' | 'CircleOnly';

type CircleModeRef = { mode: string } | null | undefined;

export function normalizeRequestedPublishIntent(raw: string | null): PublishIntent | null {
    if (raw === 'feed' || raw === 'draft') {
        return raw;
    }
    return null;
}

export function isFeedIntentAllowed(circle: CircleModeRef): boolean {
    return Boolean(circle);
}

export function isDraftIntentAllowed(circle: CircleModeRef): boolean {
    return circle?.mode === 'knowledge';
}

export function resolveAllowedPublishIntent(
    circle: CircleModeRef,
    requestedIntent: PublishIntent,
): PublishIntent {
    if (!circle) return requestedIntent;
    if (requestedIntent === 'draft' && !isDraftIntentAllowed(circle)) return 'feed';
    return requestedIntent;
}

export function resolveFeedVisibility(
    circleType: 'Open' | 'Closed' | 'Secret' | string | null | undefined,
): FeedVisibility {
    return circleType === 'Closed' || circleType === 'Secret' ? 'CircleOnly' : 'Public';
}
