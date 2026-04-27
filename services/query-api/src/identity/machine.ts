/**
 * Identity State Machine
 *
 * Evaluates a user's contributions within a Circle and determines
 * their identity level: Visitor → Initiate → Member → Elder.
 *
 * State Transitions:
 *   Visitor  → Initiate : posted ≥ N messages in the circle
 *   Initiate → Member   : cited ≥ M times OR reputation above threshold
 *   Member   → Elder    : reputation in top X% of circle
 *   Elder    → Member   : reputation drops below threshold
 *   Member   → Initiate : inactive for > D days
 */

import { CircleMembershipEventType, PrismaClient } from '@prisma/client';
import {
    IdentityLevel,
    getThresholds,
    getIdentityNotificationMode,
    shouldNotifyIdentityTransition,
    IdentityThresholds,
} from './thresholds';
import {
    buildCompletedIdentityTransitionReason,
    buildIdentityNotification,
    buildInitiateEligibilityReason,
    buildMemberElderEligibilityReason,
    buildVisitorEligibilityReason,
} from './copy';

export interface UserCircleStats {
    messageCount: number;
    citationCount: number;
    reputationScore: number;
    lastActiveAt: Date | null;
}

export interface EvaluationResult {
    previousLevel: IdentityLevel;
    newLevel: IdentityLevel;
    changed: boolean;
    reason?: string;
}

/**
 * Evaluate identity level for a user in a specific circle.
 */
export function evaluateIdentity(
    stats: UserCircleStats,
    currentLevel: IdentityLevel,
    thresholds: IdentityThresholds,
    circleReputationPercentile?: number,
): EvaluationResult {
    let newLevel = currentLevel;
    let reason: string | undefined;

    // Check demotion first (Elder → Member, Member → Initiate)
    if (currentLevel === IdentityLevel.Elder) {
        // Elder → Member if reputation drops
        if (circleReputationPercentile !== undefined && circleReputationPercentile > thresholds.elderPercentile) {
            newLevel = IdentityLevel.Member;
            reason = `当前信誉已降至前 ${circleReputationPercentile}% 之外（阈值前 ${thresholds.elderPercentile}%），身份调整为成员。`;
        }
    }

    if (currentLevel === IdentityLevel.Member || currentLevel === IdentityLevel.Elder) {
        // Member/Elder → Initiate if inactive
        if (stats.lastActiveAt) {
            const daysSinceActive = Math.floor(
                (Date.now() - stats.lastActiveAt.getTime()) / (1000 * 60 * 60 * 24),
            );
            if (daysSinceActive > thresholds.inactivityDays) {
                newLevel = IdentityLevel.Initiate;
                reason = `已 ${daysSinceActive} 天未活跃（阈值 ${thresholds.inactivityDays} 天），身份调整为入局者。`;
            }
        }
    }

    // Check promotion (only if not demoted)
    if (newLevel === currentLevel) {
        if (currentLevel === IdentityLevel.Visitor && stats.messageCount >= thresholds.initiateMessages) {
            newLevel = IdentityLevel.Initiate;
            reason = buildVisitorEligibilityReason(stats.messageCount, thresholds.initiateMessages);
        }

        if (currentLevel === IdentityLevel.Initiate && stats.citationCount >= thresholds.memberCitations) {
            newLevel = IdentityLevel.Member;
            reason = buildInitiateEligibilityReason(stats.citationCount, thresholds.memberCitations);
        }

        if (currentLevel === IdentityLevel.Member) {
            if (circleReputationPercentile !== undefined && circleReputationPercentile <= thresholds.elderPercentile) {
                newLevel = IdentityLevel.Elder;
                reason = buildMemberElderEligibilityReason(circleReputationPercentile, thresholds.elderPercentile);
            }
        }
    }

    return {
        previousLevel: currentLevel,
        newLevel,
        changed: newLevel !== currentLevel,
        reason,
    };
}

/**
 * Fetch user's contribution stats within a circle from DB.
 */
export async function getUserCircleStats(
    prisma: PrismaClient,
    userId: number,
    circleId: number,
): Promise<UserCircleStats> {
    // Count messages posted by user in this circle
    const messageCount = await prisma.post.count({
        where: {
            authorId: userId,
            circleId: circleId,
            status: 'Active',
        },
    });

    // Count citations: how many times this user's posts were replied to
    // by other users in this circle
    const userPostIds = await prisma.post.findMany({
        where: {
            authorId: userId,
            circleId: circleId,
            status: 'Active',
        },
        select: { id: true },
    });

    const citationCount = userPostIds.length > 0
        ? await prisma.post.count({
            where: {
                parentPostId: { in: userPostIds.map(p => p.id) },
                authorId: { not: userId }, // don't count self-replies
            },
        })
        : 0;

    // Get reputation score from the user record
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { reputationScore: true },
    });

    // Get last activity date
    const lastPost = await prisma.post.findFirst({
        where: {
            authorId: userId,
            circleId: circleId,
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
    });

    return {
        messageCount,
        citationCount,
        reputationScore: Number(user?.reputationScore ?? 0),
        lastActiveAt: lastPost?.createdAt ?? null,
    };
}

/**
 * Calculate a user's reputation percentile within a circle.
 * Returns percentile (1 = top 1%, 100 = bottom).
 */
export async function getReputationPercentile(
    prisma: PrismaClient,
    userId: number,
    circleId: number,
): Promise<number> {
    // Get all active members' reputation scores in this circle
    const members = await prisma.circleMember.findMany({
        where: {
            circleId,
            status: 'Active',
        },
        include: {
            user: { select: { reputationScore: true } },
        },
    });

    if (members.length <= 1) return 1; // sole member = top 1%

    const scores = members.map(m => Number(m.user.reputationScore)).sort((a, b) => b - a);
    const userScore = Number(members.find(m => m.userId === userId)?.user.reputationScore ?? 0);
    const rank = scores.findIndex(s => s <= userScore) + 1; // 1-indexed rank

    return Math.ceil((rank / scores.length) * 100);
}

/**
 * Evaluate and update a single user's identity level in a circle.
 * Returns the evaluation result.
 */
export async function evaluateAndUpdate(
    prisma: PrismaClient,
    userId: number,
    circleId: number,
    input?: {
        circleName?: string | null;
    },
): Promise<EvaluationResult> {
    const member = await prisma.circleMember.findUnique({
        where: { circleId_userId: { circleId, userId } },
    });

    if (!member) {
        return {
            previousLevel: IdentityLevel.Visitor,
            newLevel: IdentityLevel.Visitor,
            changed: false,
            reason: '当前用户还不是该圈层成员',
        };
    }

    const currentLevel = (member.identityLevel as IdentityLevel) || IdentityLevel.Visitor;
    const stats = await getUserCircleStats(prisma, userId, circleId);
    const percentile = await getReputationPercentile(prisma, userId, circleId);
    const thresholds = getThresholds(null, circleId);
    const notificationMode = getIdentityNotificationMode(circleId, null);

    const result = evaluateIdentity(stats, currentLevel, thresholds, percentile);

    if (result.changed) {
        const finalizedReason = buildCompletedIdentityTransitionReason({
            previousLevel: result.previousLevel,
            newLevel: result.newLevel,
            thresholds,
            messageCount: stats.messageCount,
            citationCount: stats.citationCount,
            reputationPercentile: percentile,
            fallbackReason: result.reason,
        });
        const shouldNotify = shouldNotifyIdentityTransition(
            result.previousLevel,
            result.newLevel,
            notificationMode,
        );
        const notification = shouldNotify
            ? buildIdentityNotification({
                circleId,
                circleName: input?.circleName ?? null,
                previousLevel: result.previousLevel,
                newLevel: result.newLevel,
                reason: finalizedReason ?? undefined,
            })
            : null;

        await prisma.$transaction(async (tx) => {
            await tx.circleMember.update({
                where: { circleId_userId: { circleId, userId } },
                data: { identityLevel: result.newLevel },
            });

            await tx.circleMembershipEvent.create({
                data: {
                    circleId,
                    userId,
                    eventType: CircleMembershipEventType.IdentityChanged,
                    reason: finalizedReason ?? null,
                    metadata: {
                        fromLevel: result.previousLevel,
                        toLevel: result.newLevel,
                        source: 'identity_cron',
                    },
                },
            });

            if (notification) {
                await tx.notification.create({
                    data: {
                        userId,
                        type: 'identity',
                        title: notification.title,
                        body: notification.body,
                        metadata: notification.metadata,
                        sourceType: 'circle_identity',
                        sourceId: notification.sourceId,
                        circleId,
                        read: false,
                    },
                });
            }
        });
    }

    return result;
}

/**
 * Batch evaluate all members of a circle. Used by cron job.
 */
export async function evaluateCircle(
    prisma: PrismaClient,
    circleId: number,
    input?: {
        circleName?: string | null;
    },
): Promise<EvaluationResult[]> {
    const members = await prisma.circleMember.findMany({
        where: { circleId, status: 'Active' },
        select: { userId: true },
    });

    const results: EvaluationResult[] = [];
    for (const member of members) {
        const result = await evaluateAndUpdate(prisma, member.userId, circleId, {
            circleName: input?.circleName ?? null,
        });
        if (result.changed) {
            results.push(result);
        }
    }

    return results;
}
