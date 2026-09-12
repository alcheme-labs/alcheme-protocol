export interface CircleHierarchyRow {
    id: number;
    parentCircleId: number | null;
}

export interface CircleHierarchyPrisma {
    circle?: {
        findMany(args: {
            where: { id: { in: number[] } };
            select: { id: true; parentCircleId: true };
        }): Promise<CircleHierarchyRow[]>;
    };
}

function normalizeCircleIds(circleIds: readonly number[]): number[] {
    return Array.from(new Set(
        circleIds
            .map((circleId) => Math.trunc(circleId))
            .filter((circleId) => Number.isFinite(circleId) && circleId > 0),
    ));
}

function buildDirectFirstChain(circleId: number, circlesById: Map<number, CircleHierarchyRow>): number[] {
    const chain: number[] = [];
    const seen = new Set<number>();
    let current: number | null = circleId;

    while (current !== null && !seen.has(current)) {
        chain.push(current);
        seen.add(current);
        current = circlesById.get(current)?.parentCircleId ?? null;
    }

    return chain;
}

export async function loadCircleAncestorChains(input: {
    prisma: CircleHierarchyPrisma;
    circleIds: readonly number[];
}): Promise<Map<number, number[]>> {
    const rootCircleIds = normalizeCircleIds(input.circleIds);
    const result = new Map<number, number[]>();
    if (!rootCircleIds.length) return result;

    if (!input.prisma.circle?.findMany) {
        for (const circleId of rootCircleIds) {
            result.set(circleId, [circleId]);
        }
        return result;
    }

    const circlesById = new Map<number, CircleHierarchyRow>();
    let frontier = new Set(rootCircleIds);
    while (frontier.size) {
        const missing = Array.from(frontier).filter((circleId) => !circlesById.has(circleId));
        if (!missing.length) break;

        const rows = await input.prisma.circle.findMany({
            where: { id: { in: missing } },
            select: {
                id: true,
                parentCircleId: true,
            },
        });

        const next = new Set<number>();
        for (const row of rows) {
            circlesById.set(row.id, row);
            if (typeof row.parentCircleId === 'number' && !circlesById.has(row.parentCircleId)) {
                next.add(row.parentCircleId);
            }
        }
        frontier = next;
    }

    for (const circleId of rootCircleIds) {
        result.set(circleId, buildDirectFirstChain(circleId, circlesById));
    }

    return result;
}
