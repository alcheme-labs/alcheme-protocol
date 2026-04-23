import type { Prisma, PrismaClient } from '@prisma/client';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export interface AgentManagementDecision {
    allowed: boolean;
    statusCode: number;
    error: string;
    message: string;
    circleId: number | null;
}

function isManagerRole(role: unknown): boolean {
    const normalized = String(role ?? '');
    return normalized === 'Owner' || normalized === 'Admin';
}

export async function authorizeAgentManagement(
    prisma: PrismaLike,
    input: { circleId: number; userId: number | null | undefined },
): Promise<AgentManagementDecision> {
    if (!input.userId) {
        return {
            allowed: false,
            statusCode: 401,
            error: 'authentication_required',
            message: 'authentication is required',
            circleId: input.circleId,
        };
    }

    const prismaAny = prisma as any;
    const circle = await prismaAny.circle.findUnique({
        where: { id: input.circleId },
        select: { creatorId: true },
    });
    if (!circle) {
        return {
            allowed: false,
            statusCode: 404,
            error: 'circle_not_found',
            message: 'circle not found',
            circleId: input.circleId,
        };
    }
    if (Number(circle.creatorId) === input.userId) {
        return {
            allowed: true,
            statusCode: 200,
            error: 'ok',
            message: 'ok',
            circleId: input.circleId,
        };
    }

    const membership = await prismaAny.circleMember.findUnique({
        where: {
            circleId_userId: {
                circleId: input.circleId,
                userId: input.userId,
            },
        },
        select: {
            role: true,
            status: true,
        },
    });

    if (!membership || String(membership.status) !== 'Active' || !isManagerRole(membership.role)) {
        return {
            allowed: false,
            statusCode: 403,
            error: 'agent_management_forbidden',
            message: 'only circle owners or admins can manage agents',
            circleId: input.circleId,
        };
    }

    return {
        allowed: true,
        statusCode: 200,
        error: 'ok',
        message: 'ok',
        circleId: input.circleId,
    };
}
