interface ResolveFeedRepostStateInput {
    isRepost: boolean;
    walletConnected: boolean;
    canPublish: boolean;
    pending: boolean;
    membershipPending?: boolean;
}

export type FeedRepostReason =
    | 'connect_wallet'
    | 'join_circle'
    | 'pending_membership'
    | 'pending'
    | 'already_reposted';

interface FeedRepostState {
    disabled: boolean;
    reason: FeedRepostReason | null;
}

interface DeriveFeedRepostMembershipPendingInput {
    joinState?: string | null;
    joinBannerHint?: string | null;
    pendingMembershipHint?: string | null;
}

function normalizeHint(value: string | null | undefined): string | null {
    const normalized = value
        ?.trim()
        .toLowerCase()
        .replace(/[.!?。！？]+$/u, '')
        .trim();
    return normalized ? normalized : null;
}

export function deriveFeedRepostMembershipPending(
    input: DeriveFeedRepostMembershipPendingInput,
): boolean {
    if (input.joinState === 'pending') {
        return true;
    }

    const joinBannerHint = normalizeHint(input.joinBannerHint);
    const pendingMembershipHint = normalizeHint(input.pendingMembershipHint);
    return Boolean(joinBannerHint && pendingMembershipHint && joinBannerHint === pendingMembershipHint);
}

export function resolveFeedRepostState(input: ResolveFeedRepostStateInput): FeedRepostState {
    if (!input.walletConnected) {
        return {
            disabled: true,
            reason: 'connect_wallet',
        };
    }

    if (input.membershipPending) {
        return {
            disabled: true,
            reason: 'pending_membership',
        };
    }

    if (!input.canPublish) {
        return {
            disabled: true,
            reason: 'join_circle',
        };
    }

    if (input.pending) {
        return {
            disabled: true,
            reason: 'pending',
        };
    }

    if (input.isRepost) {
        return {
            disabled: true,
            reason: 'already_reposted',
        };
    }

    return {
        disabled: false,
        reason: null,
    };
}
