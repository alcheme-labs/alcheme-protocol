import type { Request } from 'express';
import { type AppLocale, resolveRequestLocale } from './locale';

function getRequestHeader(req: Request, name: string): string | string[] | undefined {
    if (typeof req.header === 'function') {
        return req.header(name) || undefined;
    }
    const headers = (req as unknown as { headers?: Record<string, string | string[] | undefined> }).headers || {};
    return headers[name.toLowerCase()] || headers[name];
}

export function resolveExpressRequestLocale(req: Request): AppLocale {
    return resolveRequestLocale({
        requestedLocale: (req.query?.locale as string | string[] | undefined) ?? getRequestHeader(req, 'x-alcheme-locale'),
        acceptLanguage: getRequestHeader(req, 'accept-language'),
    });
}
