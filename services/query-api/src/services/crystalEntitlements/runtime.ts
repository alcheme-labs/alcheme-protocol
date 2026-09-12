import type { Prisma, PrismaClient } from '@prisma/client';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export async function loadCircleHierarchyIds(
    prisma: PrismaLike,
    circleId?: number | null,
): Promise<number[]> {
    if (!circleId || !Number.isFinite(circleId) || circleId <= 0) {
        return [];
    }

    const hierarchyIds = new Set<number>([circleId]);

    let currentId: number | null = circleId;
    for (let i = 0; i < 10 && currentId; i++) {
        const parent: { parentCircleId: number | null } | null = await prisma.circle.findUnique({
            where: { id: currentId },
            select: { parentCircleId: true },
        });
        if (!parent?.parentCircleId) break;
        hierarchyIds.add(parent.parentCircleId);
        currentId = parent.parentCircleId;
    }

    const queue: number[] = [circleId];
    for (let depth = 0; depth < 10 && queue.length > 0; depth++) {
        const batch = queue.splice(0, queue.length);
        const children = await prisma.circle.findMany({
            where: { parentCircleId: { in: batch } },
            select: { id: true },
        });
        for (const child of children) {
            if (!hierarchyIds.has(child.id)) {
                hierarchyIds.add(child.id);
                queue.push(child.id);
            }
        }
    }

    return Array.from(hierarchyIds);
}

export async function countActiveCrystalEntitlements(
    prisma: PrismaLike,
    input: {
        ownerPubkey: string;
        circleId?: number | null;
    },
): Promise<number> {
    const ownerPubkey = String(input.ownerPubkey || '').trim();
    if (!ownerPubkey) return 0;

    if (!input.circleId || !Number.isFinite(input.circleId) || input.circleId <= 0) {
        return Math.max(0, await (prisma as any).crystalEntitlement.count({
            where: {
                ownerPubkey,
                status: 'active',
            },
        }));
    }

    const hierarchyIds = await loadCircleHierarchyIds(prisma, input.circleId);
    return Math.max(0, await (prisma as any).crystalEntitlement.count({
        where: {
            ownerPubkey,
            status: 'active',
            circleId: { in: hierarchyIds },
        },
    }));
}

export async function resolveOwnedCrystalCount(
    prisma: PrismaLike,
    input: {
        userId?: number | null;
        ownerPubkey?: string | null;
        circleId?: number | null;
    },
): Promise<number> {
    const explicitPubkey = String(input.ownerPubkey || '').trim();
    if (explicitPubkey) {
        return countActiveCrystalEntitlements(prisma, {
            ownerPubkey: explicitPubkey,
            circleId: input.circleId,
        });
    }

    const userId = Number(input.userId || 0);
    if (!Number.isFinite(userId) || userId <= 0) return 0;

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { pubkey: true },
    });
    if (!user?.pubkey) {
        return 0;
    }

    return countActiveCrystalEntitlements(prisma, {
        ownerPubkey: user.pubkey,
        circleId: input.circleId,
    });
}
