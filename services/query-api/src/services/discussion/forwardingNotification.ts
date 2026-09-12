import type { Prisma, PrismaClient } from '@prisma/client';

import { localizeQueryApiCopy } from '../../i18n/copy';
import type { AppLocale } from '../../i18n/locale';
import { canUserReadCircleForNotification } from '../auth/actorPermissions';
import type { AuthActor } from '../auth/actor';

type SqlClient = PrismaClient | Prisma.TransactionClient;

export interface ForwardNotificationSourceItem {
    sourceAuthorPubkey: string;
}

interface ForwardSourceAuthorUser {
    id: number;
    pubkey: string;
    handle: string;
}

export async function createForwardNotifications(input: {
    prisma: PrismaClient;
    tx: SqlClient;
    actor: AuthActor;
    forwardKind: 'single' | 'bundle';
    targetCircle: {
        id: number;
        name: string;
    };
    targetEnvelopeId: string;
    sourceItems: readonly ForwardNotificationSourceItem[];
    locale: AppLocale;
}): Promise<void> {
    const sourceAuthorPubkeys = Array.from(new Set(input.sourceItems
        .map((item) => item.sourceAuthorPubkey.trim())
        .filter((pubkey) => pubkey && pubkey !== input.actor.pubkey)));
    if (sourceAuthorPubkeys.length === 0) return;

    const users = await input.prisma.user.findMany({
        where: {
            pubkey: {
                in: sourceAuthorPubkeys,
            },
        },
        select: {
            id: true,
            pubkey: true,
            handle: true,
        },
    }) as ForwardSourceAuthorUser[];
    const usersByPubkey = new Map(users.map((user) => [user.pubkey, user]));
    const senderLabel = formatSenderLabel({ handle: input.actor.handle }, input.locale);
    const countByUserId = new Map<number, {
        user: ForwardSourceAuthorUser;
        count: number;
    }>();

    for (const pubkey of sourceAuthorPubkeys) {
        const user = usersByPubkey.get(pubkey);
        if (!user || user.id === input.actor.userId) continue;
        const current = countByUserId.get(user.id);
        countByUserId.set(user.id, {
            user,
            count: (current?.count ?? 0) + input.sourceItems.filter((item) => item.sourceAuthorPubkey === pubkey).length,
        });
    }

    for (const { user, count } of countByUserId.values()) {
        const canReadTarget = await canUserReadCircleForNotification(input.prisma, {
            userId: user.id,
            circleId: input.targetCircle.id,
        });
        const messageKey = input.forwardKind === 'bundle'
            ? (canReadTarget ? 'discussion.forward_bundle' : 'discussion.forward_bundle_private')
            : (canReadTarget ? 'discussion.forwarded' : 'discussion.forwarded_private');
        const forwardedMessageCount = input.forwardKind === 'bundle'
            ? input.sourceItems.length
            : count;
        await input.tx.notification.create({
            data: {
                userId: user.id,
                type: 'forward',
                title: messageKey,
                body: null,
                metadata: {
                    messageKey,
                    params: {
                        senderLabel,
                        count: forwardedMessageCount,
                        ...(canReadTarget ? { targetCircleName: input.targetCircle.name } : {}),
                    },
                },
                sourceType: 'discussion',
                sourceId: canReadTarget ? input.targetEnvelopeId : null,
                circleId: canReadTarget ? input.targetCircle.id : null,
                read: false,
            },
        });
    }
}

function formatSenderLabel(sender: { handle?: string | null }, locale: AppLocale): string {
    const handle = typeof sender.handle === 'string' ? sender.handle.trim() : '';
    if (handle) return handle;
    return localizeQueryApiCopy('identity.genericMember', locale);
}
