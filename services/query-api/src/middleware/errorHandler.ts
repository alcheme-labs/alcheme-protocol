import { Request, Response, NextFunction } from 'express';

export function errorHandler(
    error: Error,
    req: Request,
    res: Response,
    next: NextFunction
) {
    console.error('Error:', error);
    const typed = error as Error & {
        statusCode?: number;
        status?: number;
        code?: string;
        details?: unknown;
    };
    const statusCode = typed.statusCode ?? typed.status;
    if (statusCode && statusCode >= 400 && statusCode < 600 && typed.code) {
        return res.status(statusCode).json({
            error: typed.code,
            message: error.message,
            ...(typed.details ? { details: typed.details } : {}),
        });
    }

    if (error.name === 'PrismaClientKnownRequestError') {
        return res.status(400).json({
            error: 'Database error',
            message: error.message,
        });
    }

    if (error.name === 'ValidationError') {
        return res.status(400).json({
            error: 'Validation error',
            message: error.message,
        });
    }

    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'production'
            ? 'An unexpected error occurred'
            : error.message,
    });
}
