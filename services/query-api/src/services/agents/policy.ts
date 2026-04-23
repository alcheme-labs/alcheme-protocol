import type { Prisma, PrismaClient } from '@prisma/client';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export type AgentTriggerScope = 'disabled' | 'draft_only' | 'circle_wide';
export type AgentReviewMode = 'owner_review' | 'admin_review' | 'self_serve';

export interface CircleAgentPolicyRecord {
    circleId: number;
    triggerScope: AgentTriggerScope;
    costDiscountBps: number;
    reviewMode: AgentReviewMode;
    updatedByUserId: number | null;
    createdAt?: Date;
    updatedAt?: Date;
}

export interface CircleAgentPolicyPatch {
    triggerScope?: AgentTriggerScope;
    costDiscountBps?: number;
    reviewMode?: AgentReviewMode;
}

const DEFAULT_AGENT_POLICY: Omit<CircleAgentPolicyRecord, 'circleId'> = {
    triggerScope: 'draft_only',
    costDiscountBps: 0,
    reviewMode: 'owner_review',
    updatedByUserId: null,
};

function normalizeTriggerScope(value: unknown, fallback: AgentTriggerScope): AgentTriggerScope {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'disabled') return 'disabled';
    if (normalized === 'circle_wide') return 'circle_wide';
    if (normalized === 'draft_only') return 'draft_only';
    return fallback;
}

function normalizeReviewMode(value: unknown, fallback: AgentReviewMode): AgentReviewMode {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'owner_review') return 'owner_review';
    if (normalized === 'admin_review') return 'admin_review';
    if (normalized === 'self_serve') return 'self_serve';
    return fallback;
}

function normalizeDiscountBps(value: unknown, fallback: number): number {
    const parsed = typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim()
            ? Number(value)
            : Number.NaN;
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.min(10_000, Math.floor(parsed)));
}

async function requireCircle(prisma: PrismaLike, circleId: number) {
    const prismaAny = prisma as any;
    const circle = await prismaAny.circle.findUnique({
        where: { id: circleId },
        select: { id: true },
    });
    if (!circle) {
        throw new Error('circle_not_found');
    }
}

export async function resolveCircleAgentPolicy(
    prisma: PrismaLike,
    circleId: number,
): Promise<CircleAgentPolicyRecord> {
    await requireCircle(prisma, circleId);
    const prismaAny = prisma as any;
    const row = prismaAny.circleAgentPolicy && typeof prismaAny.circleAgentPolicy.findUnique === 'function'
        ? await prismaAny.circleAgentPolicy.findUnique({
            where: { circleId },
        })
        : null;

    return {
        circleId,
        triggerScope: normalizeTriggerScope(row?.triggerScope, DEFAULT_AGENT_POLICY.triggerScope),
        costDiscountBps: normalizeDiscountBps(row?.costDiscountBps, DEFAULT_AGENT_POLICY.costDiscountBps),
        reviewMode: normalizeReviewMode(row?.reviewMode, DEFAULT_AGENT_POLICY.reviewMode),
        updatedByUserId: typeof row?.updatedByUserId === 'number' ? row.updatedByUserId : null,
        createdAt: row?.createdAt,
        updatedAt: row?.updatedAt,
    };
}

export async function upsertCircleAgentPolicy(
    prisma: PrismaLike,
    input: {
        circleId: number;
        actorUserId: number;
        patch: CircleAgentPolicyPatch;
    },
): Promise<CircleAgentPolicyRecord> {
    await requireCircle(prisma, input.circleId);
    const current = await resolveCircleAgentPolicy(prisma, input.circleId);
    const next: CircleAgentPolicyRecord = {
        circleId: input.circleId,
        triggerScope: normalizeTriggerScope(input.patch.triggerScope, current.triggerScope),
        costDiscountBps: normalizeDiscountBps(input.patch.costDiscountBps, current.costDiscountBps),
        reviewMode: normalizeReviewMode(input.patch.reviewMode, current.reviewMode),
        updatedByUserId: input.actorUserId,
    };

    const prismaAny = prisma as any;
    const row = await prismaAny.circleAgentPolicy.upsert({
        where: { circleId: input.circleId },
        create: {
            circleId: input.circleId,
            triggerScope: next.triggerScope,
            costDiscountBps: next.costDiscountBps,
            reviewMode: next.reviewMode,
            updatedByUserId: input.actorUserId,
        },
        update: {
            triggerScope: next.triggerScope,
            costDiscountBps: next.costDiscountBps,
            reviewMode: next.reviewMode,
            updatedByUserId: input.actorUserId,
        },
    });

    return {
        circleId: input.circleId,
        triggerScope: normalizeTriggerScope(row?.triggerScope, next.triggerScope),
        costDiscountBps: normalizeDiscountBps(row?.costDiscountBps, next.costDiscountBps),
        reviewMode: normalizeReviewMode(row?.reviewMode, next.reviewMode),
        updatedByUserId: typeof row?.updatedByUserId === 'number' ? row.updatedByUserId : input.actorUserId,
        createdAt: row?.createdAt,
        updatedAt: row?.updatedAt,
    };
}
