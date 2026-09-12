import type { Response } from 'express';
import type { PrismaClient } from '@prisma/client';

import {
    authorizeDraftAction,
    type DraftAccessDecision,
    type DraftPermissionAction,
} from '../membership/checks';
import {
    AuthActorError,
    requireCircleActorForAuthActor,
    requireCircleManagerActorForAuthActor,
    requireCircleOwnerActorForAuthActor,
    resolveCircleActorForAuthActor,
    type AuthActor,
    type CircleActor,
} from './actor';

export type { DraftAccessDecision, DraftPermissionAction } from '../membership/checks';

export type DraftActorAccessDecision = DraftAccessDecision & {
    circleActor: CircleActor | null;
};

export function sendAuthActorError(res: Response, error: unknown): boolean {
    if (error instanceof AuthActorError) {
        res.status(error.statusCode).json(error.toResponseBody());
        return true;
    }
    return false;
}

function draftActionToCircleAction(action: DraftPermissionAction): 'draft.read' | 'draft.write' {
    return action === 'read' ? 'draft.read' : 'draft.write';
}

export async function authorizeDraftActionForActor(
    prisma: PrismaClient,
    input: {
        actor: AuthActor;
        postId: number;
        action: DraftPermissionAction;
    },
): Promise<DraftActorAccessDecision> {
    const decision = await authorizeDraftAction(prisma, {
        postId: input.postId,
        userId: input.actor.userId,
        action: input.action,
    });
    if (!decision.allowed) {
        return {
            ...decision,
            circleActor: null,
        };
    }

    const circleId = decision.post?.circleId;
    let circleActor: CircleActor | null = null;
    if (circleId && circleId > 0) {
        circleActor = await requireCircleActorForAuthActor(input.actor, prisma, {
            circleId,
            action: draftActionToCircleAction(input.action),
        });
    }

    return {
        ...decision,
        circleActor,
    };
}

export async function requireSourceMaterialAccessForActor(
    prisma: PrismaClient,
    input: {
        actor: AuthActor;
        circleId: number;
    },
): Promise<CircleActor> {
    return requireCircleActorForAuthActor(input.actor, prisma, {
        circleId: input.circleId,
        action: 'source.read',
    });
}

export async function requireSourceMaterialReviewActor(
    prisma: PrismaClient,
    input: {
        actor: AuthActor;
        circleId: number;
    },
): Promise<CircleActor> {
    return requireCircleManagerActorForAuthActor(input.actor, prisma, {
        circleId: input.circleId,
        allowModerator: true,
        action: 'source.review',
    });
}

export async function requireCircleManagerForActor(
    prisma: PrismaClient,
    input: {
        actor: AuthActor;
        circleId: number;
        allowModerator?: boolean;
    },
): Promise<CircleActor> {
    return requireCircleManagerActorForAuthActor(input.actor, prisma, {
        circleId: input.circleId,
        allowModerator: input.allowModerator,
    });
}

export async function requireCircleOwnerForActor(
    prisma: PrismaClient,
    input: {
        actor: AuthActor;
        circleId: number;
    },
): Promise<CircleActor> {
    return requireCircleOwnerActorForAuthActor(input.actor, prisma, {
        circleId: input.circleId,
    });
}

export async function canUserReadCircleForNotification(
    prisma: PrismaClient,
    input: {
        userId: number;
        circleId: number;
    },
): Promise<boolean> {
    const user = await prisma.user.findUnique({
        where: { id: input.userId },
        select: {
            id: true,
            pubkey: true,
            handle: true,
            displayName: true,
        },
    });
    if (!user) return false;

    const actor: AuthActor = {
        userId: user.id,
        pubkey: user.pubkey,
        handle: user.handle,
        displayName: user.displayName,
        sessionId: null,
        authSource: 'session_cookie',
        identity: {
            handle: user.handle,
            identityPubkey: user.pubkey,
            accountAddress: '',
            presence: 'verified',
        },
    };

    try {
        await resolveCircleActorForAuthActor(actor, prisma, {
            circleId: input.circleId,
            action: 'circle.read',
        });
        return true;
    } catch (error) {
        if (error instanceof AuthActorError && (error.statusCode === 401 || error.statusCode === 403)) {
            return false;
        }
        throw error;
    }
}
