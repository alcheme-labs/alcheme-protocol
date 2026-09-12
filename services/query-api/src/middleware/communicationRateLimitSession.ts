import type { Prisma, PrismaClient } from '@prisma/client';
import type { RequestHandler } from 'express';

export interface CommunicationRateLimitSession {
    sessionId: string;
    walletPubkey: string;
    scopeType: string;
    scopeRef: string;
    expiresAt: Date;
    revoked: boolean;
    contributionGrant?: Prisma.JsonValue | null;
    contributionGrantDigest?: string | null;
}

const communicationRateLimitSessionKey = Symbol('communicationRateLimitSession');

type RequestWithCommunicationRateLimitSession = {
    [communicationRateLimitSessionKey]?: CommunicationRateLimitSession;
};

function parseBearerToken(headerValue: string | undefined): string | null {
    if (!headerValue || !headerValue.startsWith('Bearer ')) return null;
    const token = headerValue.slice(7).trim();
    return token.length > 0 ? token : null;
}

export function communicationRateLimitSessionActor(
    prisma: Pick<PrismaClient, 'communicationSession'>,
): RequestHandler {
    return async (req, _res, next) => {
        try {
            const authorization = Array.isArray(req.headers.authorization)
                ? req.headers.authorization[0]
                : req.headers.authorization;
            const token = parseBearerToken(authorization);
            if (!token) return next();

            const session = await prisma.communicationSession.findUnique({
                where: { sessionId: token },
            }) as CommunicationRateLimitSession | null;
            if (!session || session.revoked || session.expiresAt.getTime() <= Date.now()) {
                return next();
            }

            (req as RequestWithCommunicationRateLimitSession)[communicationRateLimitSessionKey] = session;
            return next();
        } catch (error) {
            return next(error);
        }
    };
}

export function getCommunicationRateLimitSession(
    req: unknown,
): CommunicationRateLimitSession | null {
    return (req as RequestWithCommunicationRateLimitSession | null)?.[communicationRateLimitSessionKey]
        ?? null;
}
