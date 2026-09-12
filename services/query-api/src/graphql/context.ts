import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { Request } from 'express';
import { type AppLocale, resolveRequestLocale } from '../i18n/locale';

export interface Context {
    req: Request;
    prisma: PrismaClient;
    cache: Redis;
    userId?: number;
    locale: AppLocale;
}

export function buildContext(
    req: Request,
    prisma: PrismaClient,
    redis: Redis
): Context {
    return {
        req,
        prisma,
        cache: redis,
        userId: (req as any).userId ?? undefined,
        locale: resolveRequestLocale({
            requestedLocale: req.header('x-alcheme-locale'),
            acceptLanguage: req.header('accept-language'),
        }),
    };
}
