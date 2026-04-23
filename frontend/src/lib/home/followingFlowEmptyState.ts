export function resolveFollowingFlowEmptyStateMessage(followingCount: number): string {
    if (followingCount > 0) {
        return '你关注的人还没有发布可见内容，稍后再来看看。';
    }

    return '你还没有关注任何创作者，去关注一些创作者吧。';
}
