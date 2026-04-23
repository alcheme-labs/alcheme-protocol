import { resolveNodeRoute } from '@/lib/config/nodeRouting';

export interface CircleAuthorityBinding {
    appCircleId: number;
    protocolCircleId: number;
    circleOnChainAddress: string;
}

async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function bindPostToCircle(input: {
    contentId: string;
    circleId: number;
    text?: string;
    status?: 'Draft';
    fallbackContentIds?: string[];
}): Promise<CircleAuthorityBinding> {
    const route = await resolveNodeRoute('posts_bind');
    const baseUrl = route.urlBase;
    const maxAttempts = 12;
    let lastError = '';

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const response = await fetch(`${baseUrl}/api/v1/posts/${encodeURIComponent(input.contentId)}/circle`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                circleId: input.circleId,
                text: input.text,
                status: input.status,
                fallbackContentIds: input.fallbackContentIds,
            }),
        });

        if (response.ok) {
            const payload = await response.json() as {
                circleAuthority?: CircleAuthorityBinding;
            };

            if (
                !payload.circleAuthority
                || !Number.isFinite(payload.circleAuthority.appCircleId)
                || !Number.isFinite(payload.circleAuthority.protocolCircleId)
                || typeof payload.circleAuthority.circleOnChainAddress !== 'string'
                || payload.circleAuthority.circleOnChainAddress.length === 0
            ) {
                throw new Error('圈层绑定返回缺少 authority 映射');
            }

            return payload.circleAuthority;
        }

        const body = await response.text();
        lastError = `${response.status} ${body}`;
        let errorCode = '';
        try {
            const parsed = JSON.parse(body) as { error?: string };
            errorCode = parsed.error || '';
        } catch {
            errorCode = '';
        }

        if (response.status === 404 && errorCode === 'post_not_indexed_yet') {
            await sleep(Math.min(500 * attempt, 2000));
            continue;
        }

        throw new Error(`圈层绑定失败: ${lastError}`);
    }

    throw new Error(`圈层绑定超时: ${lastError || 'post not indexed yet'}`);
}
