import { authorizeDraftAction, requireCircleManagerRole } from '../membership/checks';
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

export async function authorizeAiJobRead(
    prisma: PrismaLike,
    input: {
        job: AiJobRecord;
        userId: number | null | undefined;
    },
): Promise<AiJobAccessDecision> {
    if (!input.userId) {
        return {
            allowed: false,
            statusCode: 401,
            error: 'authentication_required',
            message: 'authentication is required',
        };
    }

    if (input.job.scopeType === 'draft') {
        if (!input.job.scopeDraftPostId) {
            return {
                allowed: false,
                statusCode: 409,
                error: 'invalid_ai_job_scope',
                message: 'draft-scoped ai job is missing draft scope metadata',
            };
        }
        const decision = await authorizeDraftAction(prisma, {
            postId: input.job.scopeDraftPostId,
            userId: input.userId,
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
        const allowed = await requireCircleManagerRole(prisma, {
            circleId: input.job.scopeCircleId,
            userId: input.userId,
        });
        return allowed
            ? okDecision()
            : {
                allowed: false,
                statusCode: 403,
                error: 'ai_job_access_denied',
                message: 'only circle managers can access this ai job',
            };
    }

    if (input.job.scopeType === 'system') {
        return input.job.requestedByUserId === input.userId
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
