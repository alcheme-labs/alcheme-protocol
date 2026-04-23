import { Request, Response, NextFunction } from 'express';

/**
 * Security headers middleware
 */
export const securityHeaders = (req: Request, res: Response, next: NextFunction) => {
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');

    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Enable XSS protection
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // Strict Transport Security (HTTPS only)
    if (process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    // Content Security Policy
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
    );

    next();
};

/**
 * Request sanitization middleware
 */
export const sanitizeInput = (req: Request, res: Response, next: NextFunction) => {
    // Remove null bytes from all string inputs
    const sanitizeObj = (obj: any): any => {
        if (typeof obj === 'string') {
            return obj.replace(/\0/g, '');
        }
        if (Array.isArray(obj)) {
            return obj.map(sanitizeObj);
        }
        if (typeof obj === 'object' && obj !== null) {
            const sanitized: any = {};
            for (const key in obj) {
                sanitized[key] = sanitizeObj(obj[key]);
            }
            return sanitized;
        }
        return obj;
    };

    if (req.body) {
        req.body = sanitizeObj(req.body);
    }
    if (req.query) {
        req.query = sanitizeObj(req.query);
    }
    if (req.params) {
        req.params = sanitizeObj(req.params);
    }

    next();
};
