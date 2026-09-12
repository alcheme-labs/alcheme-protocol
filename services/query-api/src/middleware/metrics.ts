import { Request, Response, NextFunction } from 'express';
import { recordHttpRequest } from '../metrics';

/**
 * Middleware to record HTTP request metrics
 */
export const metricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();

    // Record metrics when response finishes
    res.on('finish', () => {
        const duration = (Date.now() - start) / 1000; // Convert to seconds
        const route = resolveHttpMetricRoute(req);

        recordHttpRequest(
            req.method,
            route,
            res.statusCode,
            duration
        );
    });

    next();
};

export function resolveHttpMetricRoute(req: Pick<Request, 'originalUrl' | 'path'>): string {
    const path = String(req.originalUrl || req.path || '').split('?', 1)[0];
    if (path === '/graphql') return '/graphql';
    if (path === '/health') return '/health';
    if (path === '/sync/status') return '/sync/status';
    if (path.startsWith('/api/v1/governance')) return '/api/v1/governance';
    const apiFamily = path.match(/^\/api\/v1\/([^/]+)/)?.[1];
    return apiFamily && /^[a-z0-9-]+$/i.test(apiFamily)
        ? `/api/v1/${apiFamily}`
        : '/other';
}
