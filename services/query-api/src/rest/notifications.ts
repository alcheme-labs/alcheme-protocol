import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { resolveRequestLocale } from '../i18n/locale';
import { localizeNotification } from '../notifications/localize';
import { loadGovernanceNotificationStatuses } from '../notifications/governanceStatus';

export function notificationRouter(prisma: PrismaClient, redis: Redis): Router {
    const router = Router();

    // GET /notifications - 获取用户通知列表
    router.get('/', async (req: Request, res: Response) => {
        try {
            const userId = requireNotificationSessionUser(req, res);
            if (!userId) return;
            if (!validateRequestedNotificationUser(req, res, userId)) return;
            const unread = req.query.unread === 'true';
            const limit = parseInt(req.query.limit as string) || 20;
            const offset = parseInt(req.query.offset as string) || 0;
            const locale = resolveRequestLocale({
                requestedLocale: getRequestHeader(req, 'x-alcheme-locale'),
                acceptLanguage: getRequestHeader(req, 'accept-language'),
            });

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
            const [circleNameById, governanceStatusByCaseId] = await Promise.all([
                circleIds.length > 0
                    ? prisma.circle.findMany({
                            where: { id: { in: circleIds } },
                            select: { id: true, name: true },
                        })
                    : Promise.resolve([]),
                loadGovernanceNotificationStatuses(prisma, notifications),
            ]).then(([circles, statuses]) => [
                new Map(circles.map((circle) => [circle.id, circle.name])),
                statuses,
            ] as const);

            const localizedNotifications = notifications.map((notification) => {
                const localized = localizeNotification(notification, {
                    locale,
                    circleName: notification.circleId ? circleNameById.get(notification.circleId) ?? null : null,
                });
                return {
                    ...notification,
                    displayTitle: localized.displayTitle,
                    displayBody: localized.displayBody,
                    decisionStatus: notification.sourceType === 'governance_case'
                        ? governanceStatusByCaseId.get(String(notification.sourceId))?.decisionStatus ?? null
                        : null,
                    executionStatus: notification.sourceType === 'governance_case'
                        ? governanceStatusByCaseId.get(String(notification.sourceId))?.executionStatus ?? null
                        : null,
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
            const userId = requireNotificationSessionUser(req, res);
            if (!userId) return;
            const id = parseInt(req.params.id);
            if (isNaN(id)) {
                return res.status(400).json({ error: 'Invalid notification ID' });
            }

            await prisma.notification.updateMany({
                where: { id, userId },
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
            const userId = requireNotificationSessionUser(req, res);
            if (!userId) return;
            if (!validateRequestedNotificationUser(req, res, userId)) return;

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

function requireNotificationSessionUser(req: Request, res: Response): number | null {
    const userId = Number((req as any).userId);
    if ((req as any).authSource !== 'session_cookie' || !Number.isSafeInteger(userId) || userId <= 0) {
        res.status(401).json({ error: 'auth_session_required' });
        return null;
    }
    return userId;
}

function validateRequestedNotificationUser(req: Request, res: Response, sessionUserId: number): boolean {
    if (req.query.userId === undefined) return true;
    const requestedUserId = Number(req.query.userId);
    if (!Number.isSafeInteger(requestedUserId) || requestedUserId <= 0) {
        res.status(400).json({ error: 'invalid_user_id' });
        return false;
    }
    if (requestedUserId !== sessionUserId) {
        res.status(403).json({ error: 'notification_user_mismatch' });
        return false;
    }
    return true;
}

function getRequestHeader(req: Request, name: string): string | undefined {
    if (typeof req.header === 'function') {
        return req.header(name) ?? undefined;
    }
    const value = req.headers?.[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
}
