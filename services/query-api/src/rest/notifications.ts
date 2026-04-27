import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { resolveRequestLocale } from '../i18n/locale';
import { localizeNotification } from '../notifications/localize';

export function notificationRouter(prisma: PrismaClient, redis: Redis): Router {
    const router = Router();

    // GET /notifications - 获取用户通知列表
    router.get('/', async (req: Request, res: Response) => {
        try {
            const userId = parseInt(req.query.userId as string);
            const unread = req.query.unread === 'true';
            const limit = parseInt(req.query.limit as string) || 20;
            const offset = parseInt(req.query.offset as string) || 0;
            const locale = resolveRequestLocale({
                requestedLocale: getRequestHeader(req, 'x-alcheme-locale'),
                acceptLanguage: getRequestHeader(req, 'accept-language'),
            });

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

            const circleIds = Array.from(
                new Set(
                    notifications
                        .map((notification) => notification.circleId)
                        .filter((circleId): circleId is number => typeof circleId === 'number'),
                ),
            );
            const circleNameById = circleIds.length > 0
                ? new Map(
                    (
                        await prisma.circle.findMany({
                            where: { id: { in: circleIds } },
                            select: { id: true, name: true },
                        })
                    ).map((circle) => [circle.id, circle.name]),
                )
                : new Map<number, string>();

            const localizedNotifications = notifications.map((notification) => {
                const localized = localizeNotification(notification, {
                    locale,
                    circleName: notification.circleId ? circleNameById.get(notification.circleId) ?? null : null,
                });
                return {
                    ...notification,
                    displayTitle: localized.displayTitle,
                    displayBody: localized.displayBody,
                };
            });

            return res.json({
                data: localizedNotifications,
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

function getRequestHeader(req: Request, name: string): string | undefined {
    if (typeof req.header === 'function') {
        return req.header(name) ?? undefined;
    }
    const value = req.headers?.[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
}
