import { Request, Response, NextFunction } from 'express';

export function errorHandler(
    error: Error,
    req: Request,
    res: Response,
    next: NextFunction
) {
    console.error('Error:', error);

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
