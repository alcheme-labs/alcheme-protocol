export async function assertV2ByIdTargetIsPublicActive(
    contentId: string,
    action: 'reply' | 'repost',
): Promise<void> {
    const normalized = String(contentId || '').trim();
    if (!normalized) {
        throw new Error(`v2 ${action} 目标 contentId 不能为空`);
    }

    const response = await fetch(`/api/v1/posts/${encodeURIComponent(normalized)}`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
    });

    if (!response.ok) {
        throw new Error(`v2 ${action} 目标内容不可用或尚未索引（contentId=${normalized}）`);
    }

    const post = await response.json();
    const visibility = String(post?.visibility || '').trim();
    const status = String(post?.status || '').trim();
    const visible = visibility === 'Public';
    const active = status === 'Active' || status === 'Published';

    if (!visible || !active) {
        throw new Error(
            `v2 ${action} by-id 当前仅支持 Public 且 Active/Published 目标内容（contentId=${normalized}）`,
        );
    }
}
