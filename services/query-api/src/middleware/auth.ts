import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import * as nacl from 'tweetnacl';
import bs58 from 'bs58';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
export const LEGACY_LOGIN_TOKEN_TYPE = 'legacy_login';
export const LEGACY_LOGIN_TOKEN_AUDIENCE = 'query_api';

export interface AuthenticatedRequest extends Request {
    user?: {
        publicKey: string;
        userId?: string;
    };
}

/**
 * JWT Authentication Middleware
 * Validates JWT token from Authorization header
 */
export const jwtAuth = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.substring(7); // Remove 'Bearer ' prefix

        const decoded = jwt.verify(token, JWT_SECRET) as any;

        req.user = {
            publicKey: decoded.publicKey,
            userId: decoded.userId,
        };

        next();
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            return res.status(401).json({ error: 'Token expired' });
        }
        if (error instanceof jwt.JsonWebTokenError) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        return res.status(500).json({ error: 'Authentication error' });
    }
};

/**
 * Optional JWT Authentication
 * Validates token if present, but allows request to proceed without it
 */
export const optionalJwtAuth = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next(); // No token, but that's okay
    }

    try {
        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, JWT_SECRET) as any;

        req.user = {
            publicKey: decoded.publicKey,
            userId: decoded.userId,
        };
    } catch (error) {
        // Invalid token, but don't fail the request
        console.warn('Invalid token in optional auth:', error);
    }

    next();
};

/**
 * Web3 Signature Verification Middleware
 * Verifies Solana wallet signature
 */
export const web3SignatureAuth = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
) => {
    try {
        const { publicKey, signature, message } = req.body;

        if (!publicKey || !signature || !message) {
            return res.status(400).json({
                error: 'Missing required fields: publicKey, signature, message',
            });
        }

        // Decode the signature and public key from base58
        const signatureUint8 = bs58.decode(signature);
        const publicKeyUint8 = bs58.decode(publicKey);
        const messageUint8 = new TextEncoder().encode(message);

        // Verify the signature
        const isValid = nacl.sign.detached.verify(
            messageUint8,
            signatureUint8,
            publicKeyUint8
        );

        if (!isValid) {
            return res.status(401).json({ error: 'Invalid signature' });
        }

        // Check if message is recent (prevent replay attacks)
        const messageData = JSON.parse(message);
        const timestamp = messageData.timestamp;
        const currentTime = Date.now();
        const fiveMinutes = 5 * 60 * 1000;

        if (Math.abs(currentTime - timestamp) > fiveMinutes) {
            return res.status(401).json({ error: 'Message expired' });
        }

        req.user = {
            publicKey,
        };

        next();
    } catch (error) {
        console.error('Web3 signature verification error:', error);
        return res.status(401).json({ error: 'Signature verification failed' });
    }
};

/**
 * Generate JWT token for authenticated user
 */
export const generateToken = (publicKey: string, userId?: string): string => {
    return jwt.sign(
        {
            typ: LEGACY_LOGIN_TOKEN_TYPE,
            aud: LEGACY_LOGIN_TOKEN_AUDIENCE,
            publicKey,
            userId,
            iat: Math.floor(Date.now() / 1000),
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN as any }
    );
};

/**
 * Verify and decode JWT token without middleware
 */
export const verifyToken = (token: string): any => {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        return null;
    }
};
