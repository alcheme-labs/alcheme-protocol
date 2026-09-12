export interface FeedLikeStateInput {
    likes: number;
    liked?: boolean;
    pendingLike?: boolean;
}

export interface FeedLikeState {
    likes: number;
    active: boolean;
    disabled: boolean;
}

export function resolveFeedLikeState(input: FeedLikeStateInput): FeedLikeState {
    const persistedLiked = Boolean(input.liked);
    const pendingLike = Boolean(input.pendingLike);
    const active = persistedLiked || pendingLike;

    return {
        likes: persistedLiked ? input.likes : pendingLike ? input.likes + 1 : input.likes,
        active,
        disabled: active,
    };
}
