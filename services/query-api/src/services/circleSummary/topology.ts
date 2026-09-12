import type { PrismaClient } from '@prisma/client';

export type CircleSummaryTopologyAccessState =
    | 'readable'
    | 'locked'
    | 'requestable'
    | 'hidden';

export interface CircleSummaryTopologyItem {
    circleId: number;
    safeTitle?: string;
    kind: 'main' | 'auxiliary';
    level: number;
    parentCircleId: number | null;
    accessState: CircleSummaryTopologyAccessState;
    unavailableReason?: string;
    activityScore: number;
    stableOutputCount: number;
}

export interface CircleSummaryTopologyPayload {
    current: CircleSummaryTopologyItem;
    parent: CircleSummaryTopologyItem | null;
    children: CircleSummaryTopologyItem[];
    auxiliarySiblings: CircleSummaryTopologyItem[];
    sourceVersion: string;
}

type CircleRow = {
    id: number;
    name: string;
    creatorId: number;
    kind: string;
    circleType: string;
    joinRequirement: string;
    minCrystals?: number | null;
    level: number;
    parentCircleId: number | null;
    lifecycleStatus: string;
    knowledgeCount?: number | null;
    postsCount?: number | null;
    updatedAt?: Date | string | null;
};

function normalizeKind(value: unknown): 'main' | 'auxiliary' {
    return value === 'auxiliary' ? 'auxiliary' : 'main';
}

function stableTimestamp(value: Date | string | null | undefined): string {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string' && value.trim()) return value.trim();
    return 'unknown-updated-at';
}

function sourceVersionFor(rows: CircleRow[]): string {
    return rows
        .map((row) => [
            row.id,
            row.parentCircleId ?? 'root',
            row.kind,
            row.level,
            row.lifecycleStatus,
            stableTimestamp(row.updatedAt),
        ].join(':'))
        .sort()
        .join('|');
}

function deriveUnavailableAccessState(
    row: CircleRow,
): Exclude<CircleSummaryTopologyAccessState, 'readable'> {
    if (row.circleType === 'Secret') {
        return 'hidden';
    }
    if (row.joinRequirement === 'Free' || row.joinRequirement === 'ApprovalRequired') {
        return 'requestable';
    }
    return 'locked';
}

function unavailableReasonFor(
    accessState: CircleSummaryTopologyAccessState,
    row: CircleRow,
): string | undefined {
    if (accessState === 'requestable') {
        return row.joinRequirement === 'ApprovalRequired'
            ? 'approval_required'
            : 'join_available';
    }
    if (accessState === 'locked') {
        if (row.joinRequirement === 'InviteOnly') return 'invite_required';
        if (row.joinRequirement === 'TokenGated') return 'token_gate_required';
        return 'access_locked';
    }
    return undefined;
}

function toItem(
    row: CircleRow,
    readableIds: Set<number>,
    viewerUserId: number,
    forceReadable = false,
): CircleSummaryTopologyItem {
    const readable = forceReadable || readableIds.has(row.id) || row.creatorId === viewerUserId;
    const accessState: CircleSummaryTopologyAccessState = readable
        ? 'readable'
        : deriveUnavailableAccessState(row);
    const unavailableReason = unavailableReasonFor(accessState, row);
    const base: CircleSummaryTopologyItem = {
        circleId: row.id,
        kind: normalizeKind(row.kind),
        level: row.level,
        parentCircleId: row.parentCircleId,
        accessState,
        ...(unavailableReason ? { unavailableReason } : {}),
        activityScore: Number(row.postsCount ?? 0),
        stableOutputCount: Number(row.knowledgeCount ?? 0),
    };
    if (accessState === 'hidden') {
        return base;
    }
    return {
        ...base,
        safeTitle: row.name,
    };
}

export async function loadCircleSummaryTopology(
    prisma: PrismaClient,
    input: {
        circleId: number;
        viewerUserId: number;
    },
): Promise<CircleSummaryTopologyPayload> {
    const current = await prisma.circle.findUnique({
        where: { id: input.circleId },
    }) as CircleRow | null;
    if (!current) {
        throw new Error('circle_not_found');
    }

    const parent = current.parentCircleId
        ? await prisma.circle.findUnique({ where: { id: current.parentCircleId } }) as CircleRow | null
        : null;

    const children = await prisma.circle.findMany({
        where: {
            parentCircleId: current.id,
            lifecycleStatus: 'Active',
        },
        orderBy: { createdAt: 'desc' },
    }) as CircleRow[];

    const auxiliarySiblings = current.parentCircleId
        ? await prisma.circle.findMany({
            where: {
                parentCircleId: current.parentCircleId,
                lifecycleStatus: 'Active',
                kind: 'auxiliary',
            },
            orderBy: { createdAt: 'desc' },
        }) as CircleRow[]
        : [];

    const candidateRows = [
        current,
        ...(parent ? [parent] : []),
        ...children,
        ...auxiliarySiblings.filter((row) => row.id !== current.id),
    ];
    const candidateIds = [...new Set(candidateRows.map((row) => row.id))];
    const memberships = await prisma.circleMember.findMany({
        where: {
            userId: input.viewerUserId,
            status: 'Active',
            circleId: { in: candidateIds },
        },
        select: {
            circleId: true,
        },
    });
    const readableIds = new Set<number>(memberships.map((row) => Number(row.circleId)));

    return {
        current: toItem(current, readableIds, input.viewerUserId, true),
        parent: parent && parent.lifecycleStatus === 'Active'
            ? toItem(parent, readableIds, input.viewerUserId)
            : null,
        children: children.map((row) => toItem(row, readableIds, input.viewerUserId)),
        auxiliarySiblings: auxiliarySiblings
            .filter((row) => row.id !== current.id)
            .map((row) => toItem(row, readableIds, input.viewerUserId)),
        sourceVersion: sourceVersionFor(candidateRows),
    };
}
