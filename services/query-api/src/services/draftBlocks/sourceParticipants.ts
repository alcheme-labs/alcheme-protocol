import { MemberStatus, type Prisma, type PrismaClient } from '@prisma/client';

import { loadAcceptedCandidateHandoffForDraftPost } from '../draftLifecycle/readModel';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export interface DraftSourceParticipant {
    userId: number;
    pubkey: string;
    handle: string;
    sourceMessageCount: number;
}

interface SourceMessageRow {
    envelopeId: string;
    senderPubkey: string;
    senderHandle: string | null;
}

interface SourceUserRow {
    id: number;
    pubkey: string;
    handle: string;
}

function asPositiveInteger(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function uniqueNonEmptyStrings(values: unknown[]): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
        const normalized = normalizeNonEmptyString(value);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        result.push(normalized);
    }
    return result;
}

export async function listDraftSourceParticipants(
    prisma: PrismaLike,
    input: { draftPostId: number; circleId: number },
): Promise<DraftSourceParticipant[]> {
    const draftPostId = asPositiveInteger(input.draftPostId);
    const circleId = asPositiveInteger(input.circleId);
    if (!draftPostId || !circleId) return [];

    const handoff = await loadAcceptedCandidateHandoffForDraftPost(
        prisma as PrismaClient,
        draftPostId,
    );
    const sourceMessageIds = uniqueNonEmptyStrings(handoff?.sourceMessageIds || []);
    if (sourceMessageIds.length === 0) return [];

    const sourceMessages = await prisma.circleDiscussionMessage.findMany({
        where: {
            circleId,
            deleted: false,
            envelopeId: { in: sourceMessageIds },
        },
        select: {
            envelopeId: true,
            senderPubkey: true,
            senderHandle: true,
        },
    }) as SourceMessageRow[];
    if (sourceMessages.length === 0) return [];

    const messageByEnvelopeId = new Map(
        sourceMessages.map((message) => [message.envelopeId, message]),
    );
    const orderedPubkeys: string[] = [];
    const senderHandleByPubkey = new Map<string, string>();
    const sourceMessageCountByPubkey = new Map<string, number>();

    for (const envelopeId of handoff?.sourceMessageIds || []) {
        const normalizedEnvelopeId = normalizeNonEmptyString(envelopeId);
        if (!normalizedEnvelopeId) continue;

        const message = messageByEnvelopeId.get(normalizedEnvelopeId);
        const senderPubkey = normalizeNonEmptyString(message?.senderPubkey);
        if (!senderPubkey) continue;

        sourceMessageCountByPubkey.set(
            senderPubkey,
            (sourceMessageCountByPubkey.get(senderPubkey) || 0) + 1,
        );
        if (!orderedPubkeys.includes(senderPubkey)) {
            orderedPubkeys.push(senderPubkey);
        }

        const senderHandle = normalizeNonEmptyString(message?.senderHandle);
        if (senderHandle && !senderHandleByPubkey.has(senderPubkey)) {
            senderHandleByPubkey.set(senderPubkey, senderHandle);
        }
    }
    if (orderedPubkeys.length === 0) return [];

    const users = await prisma.user.findMany({
        where: {
            pubkey: { in: orderedPubkeys },
        },
        select: {
            id: true,
            pubkey: true,
            handle: true,
        },
    }) as SourceUserRow[];
    if (users.length === 0) return [];

    const userByPubkey = new Map(users.map((user) => [user.pubkey, user]));
    const userIds = orderedPubkeys
        .map((pubkey) => userByPubkey.get(pubkey)?.id)
        .filter((userId): userId is number =>
            typeof userId === 'number'
            && Number.isInteger(userId)
            && userId > 0,
        );
    if (userIds.length === 0) return [];

    const activeMembers = await prisma.circleMember.findMany({
        where: {
            circleId,
            userId: { in: userIds },
            status: MemberStatus.Active,
        },
        select: {
            userId: true,
        },
    });
    const activeUserIds = new Set(activeMembers.map((member) => member.userId));

    return orderedPubkeys.flatMap((pubkey) => {
        const user = userByPubkey.get(pubkey);
        if (!user || !activeUserIds.has(user.id)) return [];
        return [{
            userId: user.id,
            pubkey: user.pubkey,
            handle: user.handle || senderHandleByPubkey.get(pubkey) || user.pubkey,
            sourceMessageCount: sourceMessageCountByPubkey.get(pubkey) || 0,
        }];
    });
}

export async function isDraftSourceParticipant(
    prisma: PrismaLike,
    input: { draftPostId: number; circleId: number; userId: number },
): Promise<boolean> {
    const userId = asPositiveInteger(input.userId);
    if (!userId) return false;

    const participants = await listDraftSourceParticipants(prisma, {
        draftPostId: input.draftPostId,
        circleId: input.circleId,
    });
    return participants.some((participant) => participant.userId === userId);
}
