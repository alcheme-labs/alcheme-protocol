import type { Prisma, PrismaClient } from '@prisma/client';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export const DRAFT_HEAT_EVENTS = {
    edit: 5,
    comment: 3,
} as const;

export async function bumpPostHeat(
    prisma: PrismaLike,
    input: { postId: number; delta: number },
) {
    if (!Number.isFinite(input.delta) || input.delta <= 0) {
        return null;
    }

    return prisma.post.update({
        where: { id: input.postId },
        data: {
            heatScore: { increment: input.delta },
        },
        select: {
            id: true,
            heatScore: true,
        },
    });
}

export async function updateDraftContentAndHeat(
    prisma: PrismaLike,
    input: {
        postId: number;
        text: string;
        precondition?: {
            expectedText?: string | null;
            expectedUpdatedAt?: Date | null;
        };
    },
) {
    const current = await prisma.post.findUnique({
        where: { id: input.postId },
        select: {
            id: true,
            status: true,
            text: true,
            updatedAt: true,
            heatScore: true,
        },
    });

    if (!current) {
        throw new Error('draft_not_found');
    }

    const currentText = String(current.text || '');
    const matchesExpectedText =
        input.precondition?.expectedText === undefined
        || input.precondition?.expectedText === null
        || currentText === input.precondition.expectedText;
    const matchesExpectedUpdatedAt =
        !input.precondition?.expectedUpdatedAt
        || current.updatedAt.getTime() === input.precondition.expectedUpdatedAt.getTime();

    if (input.precondition && (!matchesExpectedText || !matchesExpectedUpdatedAt)) {
        return {
            id: current.id,
            status: current.status,
            updatedAt: current.updatedAt,
            heatScore: current.heatScore,
            changed: false,
            currentText,
            preconditionFailed: true,
        };
    }

    if (currentText === input.text) {
        return {
            id: current.id,
            status: current.status,
            updatedAt: current.updatedAt,
            heatScore: current.heatScore,
            changed: false,
            currentText,
            preconditionFailed: false,
        };
    }

    if (input.precondition) {
        const updated = await prisma.post.updateMany({
            where: {
                id: input.postId,
                status: 'Draft',
                updatedAt: input.precondition.expectedUpdatedAt ?? undefined,
                text: input.precondition.expectedText ?? undefined,
            },
            data: {
                text: input.text,
                heatScore: { increment: DRAFT_HEAT_EVENTS.edit },
            },
        });

        if (Number(updated?.count || 0) !== 1) {
            const latest = await prisma.post.findUnique({
                where: { id: input.postId },
                select: {
                    id: true,
                    status: true,
                    text: true,
                    updatedAt: true,
                    heatScore: true,
                },
            });
            if (!latest) {
                throw new Error('draft_not_found');
            }
            return {
                id: latest.id,
                status: latest.status,
                updatedAt: latest.updatedAt,
                heatScore: latest.heatScore,
                changed: false,
                currentText: String(latest.text || ''),
                preconditionFailed: true,
            };
        }

        const persisted = await prisma.post.findUnique({
            where: { id: input.postId },
            select: {
                id: true,
                status: true,
                text: true,
                updatedAt: true,
                heatScore: true,
            },
        });
        if (!persisted) {
            throw new Error('draft_not_found');
        }
        return {
            id: persisted.id,
            status: persisted.status,
            updatedAt: persisted.updatedAt,
            heatScore: persisted.heatScore,
            changed: true,
            currentText: String(persisted.text || ''),
            preconditionFailed: false,
        };
    }

    const updated = await prisma.post.update({
        where: { id: input.postId },
        data: {
            text: input.text,
            heatScore: { increment: DRAFT_HEAT_EVENTS.edit },
        },
        select: {
            id: true,
            status: true,
            updatedAt: true,
            heatScore: true,
        },
    });

    return {
        ...updated,
        changed: true,
        currentText: input.text,
        preconditionFailed: false,
    };
}
