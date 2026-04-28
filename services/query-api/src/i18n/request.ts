import type { Request } from 'express';
import { type AppLocale, resolveRequestLocale } from './locale';

export function resolveExpressRequestLocale(req: Request): AppLocale {
    return resolveRequestLocale({
        requestedLocale: (req.query?.locale as string | string[] | undefined) ?? req.header('x-alcheme-locale'),
        acceptLanguage: req.header('accept-language'),
    });
}
