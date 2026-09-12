import type { PrismaClient, Prisma } from '@prisma/client';

import {
    findCircleDiscussionMessagesAfterLamport,
    mapDiscussionReplayReason,
    type DiscussionRow,
} from '../messagesReadModel';

export type DiscussionReplayEventRow = DiscussionRow;

export async function findDiscussionMessagesAfterLamport(input: {
    prisma: PrismaClient | Prisma.TransactionClient;
    circleId: number;
    roomKey: string;
    afterLamport: bigint;
    limit: number;
}): Promise<DiscussionReplayEventRow[]> {
    return findCircleDiscussionMessagesAfterLamport({
        ...input,
        includeDeleted: true,
    });
}

export { mapDiscussionReplayReason };
