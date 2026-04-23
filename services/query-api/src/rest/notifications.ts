import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';

export function notificationRouter(prisma: PrismaClient, redis: Redis): Router {
    const router = Router();

    // GET /notifications - 获取用户通知列表
    router.get('/', async (req: Request, res: Response) => {
        try {
            const userId = parseInt(req.query.userId as string);
            const unread = req.query.unread === 'true';
            const limit = parseInt(req.query.limit as string) || 20;
            const offset = parseInt(req.query.offset as string) || 0;

            if (isNaN(userId)) {
                return res.status(400).json({ error: 'userId required' });
            }

            const where: any = { userId };
            if (unread) {
                where.read = false;
            }

            const [notifications, total, unreadCount] = await Promise.all([
                prisma.notification.findMany({
                    where,
                    take: limit,
                    skip: offset,
                    orderBy: { createdAt: 'desc' },
                }),
                prisma.notification.count({ where }),
                prisma.notification.count({ where: { userId, read: false } }),
            ]);

            return res.json({
                data: notifications,
                unreadCount,
                pagination: { total, limit, offset, hasMore: offset + limit < total },
            });
        } catch (error) {
            console.error('Error fetching notifications:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    });

    // PUT /notifications/:id/read - 标记通知已读
    router.put('/:id/read', async (req: Request, res: Response) => {
        try {
            const id = parseInt(req.params.id);
            if (isNaN(id)) {
                return res.status(400).json({ error: 'Invalid notification ID' });
            }

            await prisma.notification.update({
                where: { id },
                data: { read: true },
            });

            return res.json({ success: true });
        } catch (error) {
            console.error('Error marking notification read:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    });

    // PUT /notifications/read-all - 标记所有通知已读
    router.put('/read-all', async (req: Request, res: Response) => {
        try {
            const userId = parseInt(req.query.userId as string);
            if (isNaN(userId)) {
                return res.status(400).json({ error: 'userId required' });
            }

            await prisma.notification.updateMany({
                where: { userId, read: false },
                data: { read: true },
            });

            return res.json({ success: true });
        } catch (error) {
            console.error('Error marking all notifications read:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    });

    return router;
}
