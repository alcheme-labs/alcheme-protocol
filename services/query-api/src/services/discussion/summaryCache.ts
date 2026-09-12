import type { Redis } from 'ioredis';

export function buildDiscussionSummaryCacheKey(circleId: number): string {
    return `discussion:summary:circle:${circleId}`;
}

export async function invalidateDiscussionSummaryCache(
    redis: Redis,
    circleId: number,
): Promise<void> {
    await redis.del(buildDiscussionSummaryCacheKey(circleId));
}
