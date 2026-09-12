import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { generateToken } from '../middleware/auth';

export function verificationRouter(prisma: PrismaClient, redis: Redis): Router {
    const router = Router();

    // POST /api/v1/verify/email/init
    router.post('/email/init', async (req: Request, res: Response) => {
        const { email, userId } = req.body;

        if (!email || !userId) {
            return res.status(400).json({ error: 'Email and userId required' });
        }

        // Generate 6-digit code
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const key = `verify:email:${userId}`;

        // Store code in Redis (TTL 10 mins)
        await redis.setex(key, 600, JSON.stringify({ email, code }));

        // MOCK EMAIL SENDING
        console.log(`📧 [MOCK EMAIL] To: ${email}, Code: ${code}`);

        res.json({ success: true, message: 'Verification code sent (check server logs)' });
    });

    // POST /api/v1/verify/email/confirm
    router.post('/email/confirm', async (req: Request, res: Response) => {
        const { code, userId } = req.body;

        if (!code || !userId) {
            return res.status(400).json({ error: 'Code and userId required' });
        }

        const key = `verify:email:${userId}`;
        const data = await redis.get(key);

        if (!data) {
            return res.status(400).json({ error: 'Invalid or expired code' });
        }

        const { email, code: storedCode } = JSON.parse(data);

        if (code !== storedCode) {
            return res.status(400).json({ error: 'Incorrect code' });
        }

        // Contact / verification state remains app-local; protocol-owned public profile fields
        // must be finalized through wallet-signed identity transactions, not this route.
        await prisma.user.update({
            where: { id: userId },
            data: {
                email,
                emailVerified: true,
                verificationLevel: { increment: 1 } // Simple increment logic
            }
        });

        // Clean up Redis
        await redis.del(key);

        res.json({ success: true, message: 'Email verified successfully' });
    });

    return router;
}
