import { MemberStatus, type PrismaClient } from '@prisma/client';

import {
    resolvePlazaDiscussionContextForWrite,
} from './plazaRoomCapability';
import type { RoomDiscussionContext } from './roomDiscussionAdapter';
import {
    AuthActorError,
    resolveCircleActorForAuthActor,
} from '../auth/actor';
import type { AuthActor, CircleActor } from '../auth/actor';

export interface PlazaDiscussionWriteAccess {
    sender: { id: number; pubkey: string; handle: string | null } | null;
    membershipStatus: string | null;
    membershipRole?: string | null;
    isActiveMember: boolean;
    isVisitorDust: boolean;
    context: RoomDiscussionContext;
}

export class PlazaDiscussionWriteAccessError extends Error {
    constructor(
        public readonly statusCode: number,
        public readonly code: string,
        message: string,
    ) {
        super(message);
    }
}

async function resolveCircleActorForDiscussionWrite(input: {
    prisma: PrismaClient;
    circleId: number;
    actor: AuthActor;
}): Promise<CircleActor | null> {
    try {
        return await resolveCircleActorForAuthActor(input.actor, input.prisma, {
            circleId: input.circleId,
            action: 'discussion.write',
        });
    } catch (error) {
        if (
            error instanceof AuthActorError
            && error.code === 'circle_membership_required'
            && error.reason === 'active_membership_required'
        ) {
            const membership = await input.prisma.circleMember.findUnique({
                where: {
                    circleId_userId: {
                        circleId: input.circleId,
                        userId: input.actor.userId,
                    },
                },
                select: {
                    status: true,
                },
            });
            if (membership?.status === MemberStatus.Banned) {
                throw new PlazaDiscussionWriteAccessError(
                    403,
                    'discussion_membership_banned',
                    'banned members cannot post discussion messages',
                );
            }
            return null;
        }
        throw error;
    }
}

export async function resolvePlazaDiscussionWriteAccess(input: {
    prisma: PrismaClient;
    circleId: number;
    actor?: AuthActor;
    circleActor?: CircleActor;
    now: Date;
}): Promise<PlazaDiscussionWriteAccess> {
    const circleActor = input.circleActor
        ?? (input.actor
            ? await resolveCircleActorForDiscussionWrite({
                prisma: input.prisma,
                circleId: input.circleId,
                actor: input.actor,
            })
            : null);

    if (!circleActor && !input.actor) {
        throw new PlazaDiscussionWriteAccessError(401, 'auth_session_required', 'authenticated session is required');
    }

    const context = await resolvePlazaDiscussionContextForWrite(input.prisma as any, {
        circleId: input.circleId,
        activeCircleMember: !!circleActor,
        circleActor,
        now: input.now,
    });

    if (!circleActor) {
        return {
            sender: input.actor
                ? {
                    id: input.actor.userId,
                    pubkey: input.actor.pubkey,
                    handle: input.actor.handle,
                }
                : null,
            membershipStatus: null,
            membershipRole: null,
            isActiveMember: false,
            isVisitorDust: true,
            context,
        };
    }

    return {
        sender: {
            id: circleActor.userId,
            pubkey: circleActor.pubkey,
            handle: circleActor.handle,
        },
        membershipStatus: circleActor.membership.status,
        membershipRole: circleActor.membership.role,
        isActiveMember: true,
        isVisitorDust: false,
        context,
    };
}
