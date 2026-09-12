import { AuthActorError, type AuthActor } from '../auth/actor';
import {
    authorizeDraftActionForActor,
    requireCircleManagerForActor,
} from '../auth/actorPermissions';
import type { AiJobRecord, PrismaLike } from './types';

export interface AiJobAccessDecision {
    allowed: boolean;
    statusCode: number;
    error: string;
    message: string;
}

function okDecision(): AiJobAccessDecision {
    return {
        allowed: true,
        statusCode: 200,
        error: 'ok',
        message: 'ok',
    };
}

export async function authorizeAiJobReadForActor(
    prisma: PrismaLike,
    input: {
        job: AiJobRecord;
        actor: AuthActor;
    },
): Promise<AiJobAccessDecision> {
    if (input.job.scopeType === 'draft') {
        if (!input.job.scopeDraftPostId) {
            return {
                allowed: false,
                statusCode: 409,
                error: 'invalid_ai_job_scope',
                message: 'draft-scoped ai job is missing draft scope metadata',
            };
        }
        const decision = await authorizeDraftActionForActor(prisma as any, {
            actor: input.actor,
            postId: input.job.scopeDraftPostId,
            action: 'read',
        });
        return {
            allowed: decision.allowed,
            statusCode: decision.statusCode,
            error: decision.allowed ? 'ok' : decision.error,
            message: decision.message,
        };
    }

    if (input.job.scopeType === 'circle') {
        if (!input.job.scopeCircleId) {
            return {
                allowed: false,
                statusCode: 409,
                error: 'invalid_ai_job_scope',
                message: 'circle-scoped ai job is missing circle scope metadata',
            };
        }
        try {
            await requireCircleManagerForActor(prisma as any, {
                actor: input.actor,
                circleId: input.job.scopeCircleId,
            });
            return okDecision();
        } catch (error) {
            if (error instanceof AuthActorError) {
                return {
                    allowed: false,
                    statusCode: error.statusCode,
                    error: error.code,
                    message: error.message,
                };
            }
            return {
                allowed: false,
                statusCode: 403,
                error: 'ai_job_access_denied',
                message: 'only circle managers can access this ai job',
            };
        }
    }

    if (input.job.scopeType === 'system') {
        return input.job.requestedByUserId === input.actor.userId
            ? okDecision()
            : {
                allowed: false,
                statusCode: 403,
                error: 'ai_job_access_denied',
                message: 'this ai job is only visible to the requesting user',
            };
    }

    return {
        allowed: false,
        statusCode: 409,
        error: 'invalid_ai_job_scope',
        message: 'ai job scope type is not supported',
    };
}
