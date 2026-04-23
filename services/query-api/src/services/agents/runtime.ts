import type { Prisma, PrismaClient } from '@prisma/client';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export interface CreateCircleAgentInput {
    circleId: number;
    agentPubkey: string;
    handle: string;
    displayName?: string | null;
    description?: string | null;
    ownerUserId?: number | null;
    createdByUserId: number;
}

export interface BindAgentToUserInput {
    circleId: number;
    agentId: number;
    ownerUserId: number | null;
}

export async function createCircleAgent(prisma: PrismaLike, input: CreateCircleAgentInput) {
    const agentPubkey = String(input.agentPubkey || '').trim();
    const handle = String(input.handle || '').trim();
    const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
    const description = typeof input.description === 'string' ? input.description.trim() : '';
    if (!agentPubkey) {
        throw new Error('agent_pubkey_required');
    }
    if (!handle) {
        throw new Error('agent_handle_required');
    }

    const prismaAny = prisma as any;
    return prismaAny.agent.create({
        data: {
            circleId: input.circleId,
            agentPubkey,
            handle,
            displayName: displayName || null,
            description: description || null,
            ownerUserId: input.ownerUserId ?? null,
            createdByUserId: input.createdByUserId,
            status: 'active',
        },
    });
}

export async function bindAgentToUser(prisma: PrismaLike, input: BindAgentToUserInput) {
    const prismaAny = prisma as any;
    const existing = await prismaAny.agent.findUnique({
        where: { id: input.agentId },
    });
    if (!existing) {
        throw new Error('agent_not_found');
    }
    if (Number(existing.circleId) !== input.circleId) {
        throw new Error('agent_circle_mismatch');
    }

    return prismaAny.agent.update({
        where: { id: input.agentId },
        data: {
            ownerUserId: input.ownerUserId ?? null,
        },
    });
}

export async function listCircleAgents(prisma: PrismaLike, circleId: number) {
    const prismaAny = prisma as any;
    return prismaAny.agent.findMany({
        where: { circleId },
        orderBy: [
            { createdAt: 'desc' },
            { id: 'desc' },
        ],
    });
}

export async function loadCircleAgentsByPubkeys(
    prisma: PrismaLike,
    input: { circleId?: number | null; pubkeys: string[] },
) {
    const normalizedPubkeys = Array.from(
        new Set(
            input.pubkeys
                .map((value) => String(value || '').trim())
                .filter((value) => value.length > 0),
        ),
    );
    const prismaAny = prisma as any;
    if (normalizedPubkeys.length === 0 || !prismaAny.agent || typeof prismaAny.agent.findMany !== 'function') {
        return [];
    }

    return prismaAny.agent.findMany({
        where: {
            agentPubkey: { in: normalizedPubkeys },
            circleId: typeof input.circleId === 'number' && input.circleId > 0 ? input.circleId : undefined,
        },
        select: {
            agentPubkey: true,
            handle: true,
        },
    });
}
