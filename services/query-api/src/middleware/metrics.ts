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
        const route = req.route?.path || req.path;

        recordHttpRequest(
            req.method,
            route,
            res.statusCode,
            duration
        );
    });

    next();
};
