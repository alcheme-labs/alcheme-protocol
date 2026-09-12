import { Router, Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { web3SignatureAuth, generateToken } from '../middleware/auth';

export function createLegacyAuthRouter(prisma: PrismaClient): Router {
    const router = Router();

    // Legacy compatibility router for machine clients still using bearer JWT login.
    router.use((_req, res, next) => {
        res.setHeader('Deprecation', 'true');
        next();
    });

    /**
     * POST /auth/login
     * Authenticate with Web3 wallet signature and get JWT token
     */
    router.post('/login', web3SignatureAuth, async (req: Request, res: Response) => {
        try {
            const { publicKey } = (req as any).user;

            // Find user by pubkey (wallet address)
            const user = await prisma.user.findUnique({
                where: { pubkey: publicKey },
            });

            if (!user) {
                return res.status(401).json({
                    code: 'identity_not_registered',
                    error: 'User not registered. Please register on-chain first.',
                });
            }

            // Generate JWT token
            const token = generateToken(publicKey, user.id.toString());

            res.json({
                success: true,
                token,
                user: {
                    id: user.id,
                    pubkey: user.pubkey,
                    handle: user.handle,
                    createdAt: user.createdAt,
                },
            });
        } catch (error) {
            console.error('Login error:', error);
            res.status(500).json({ error: 'Login failed' });
        }
    });

    /**
     * GET /auth/nonce
     * Get a nonce for wallet signature
     */
    router.get('/nonce', (req: Request, res: Response) => {
        const nonce = Math.random().toString(36).substring(2, 15);
        const timestamp = Date.now();

        const message = JSON.stringify({
            nonce,
            timestamp,
            domain: 'alcheme.com',
            statement: 'Sign in to Alcheme Protocol',
        });

        res.json({
            message,
            instructions: 'Sign this message with your Solana wallet',
        });
    });

    return router;
}

export default createLegacyAuthRouter;
