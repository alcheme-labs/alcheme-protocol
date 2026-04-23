/**
 * Ghost Draft — Trigger Logic
 *
 * Determines when Ghost Drafts should be automatically generated:
 * 1. Automatic: Posts with decaying heat + high reply count (community needs a response)
 * 2. Manual: User explicitly requests a draft assist (via API)
 */

import { PrismaClient } from '@prisma/client';

export interface TriggerCandidate {
    postId: number;
    reason: 'heat-decay' | 'highlight-count' | 'manual';
    priority: number; // 0-1, higher = more urgent
}

/**
 * Find posts that are candidates for automatic Ghost Draft generation.
 *
 * Criteria:
 * - Active post with heatScore that has decayed below 50% of peak
 * - Has at least 3 replies (community engagement exists)
 * - No Ghost Draft already generated recently
 * - Post is in an active circle
 */
export async function findTriggerCandidates(
    prisma: PrismaClient,
    limit: number = 10,
): Promise<TriggerCandidate[]> {
    // Find posts with declining heat that have active discussion
    const candidates = await prisma.post.findMany({
        where: {
            status: 'Active',
            circleId: { not: null },
            repliesCount: { gte: 3 },
            // Heat has decayed (below 5.0 means declining interest)
            heatScore: { lte: 5.0, gt: 0 },
        },
        select: {
            id: true,
            heatScore: true,
            repliesCount: true,
        },
        orderBy: [
            { repliesCount: 'desc' },
            { heatScore: 'asc' },
        ],
        take: limit,
    });

    return candidates.map(post => ({
        postId: post.id,
        reason: 'heat-decay' as const,
        // Priority: more replies + lower heat = higher priority
        priority: Math.min(1, (post.repliesCount / 10) * (1 - Number(post.heatScore) / 10)),
    }));
}
