import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import {
    authenticateDiscussionSessionFromRequest,
} from '../services/discussion/sessionAuth';
import {
    AnnouncementPermissionError,
    confirmCircleAnnouncement,
    listCircleAnnouncements,
    markCircleAnnouncementSeen,
    markCircleAnnouncementUnread,
    publishCircleAnnouncement,
    readCircleAnnouncementDetail,
} from '../services/discussion/announcements/store';
import {
    publishDiscussionRealtimeEvent,
} from '../services/discussion/realtime';
import { resolveExpressRequestLocale } from '../i18n/request';
import {
    AuthActorError,
    requireCircleActor,
    type CircleActor,
    type CircleAction,
} from '../services/auth/actor';

export function discussionAnnouncementsRouter(
    prisma: PrismaClient,
    redis: Redis,
): Router {
    const router = Router();

    router.get('/circles/:id/announcements', async (req, res, next) => {
        try {
            const circleId = parsePositiveInt(req.params.id);
            if (!circleId) return res.status(400).json({ error: 'invalid_circle_id' });
            const actor = await resolveAnnouncementActor(req, prisma, circleId, {
                action: 'public.read',
                requireMemberChainPresence: false,
            });
            if (!actor.ok) return res.status(actor.status).json({ error: actor.error, message: actor.message });
            const result = await listCircleAnnouncements(prisma as any, {
                circleId,
                actor: actor.circleActor,
                locale: resolveExpressRequestLocale(req),
            });
            return res.json(result);
        } catch (error) {
            if (sendAnnouncementRouteError(res, error)) return;
            next(error);
        }
    });

    router.post('/circles/:id/announcements', async (req, res, next) => {
        try {
            const circleId = parsePositiveInt(req.params.id);
            if (!circleId) return res.status(400).json({ error: 'invalid_circle_id' });
            const actor = await resolveAnnouncementActor(req, prisma, circleId, {
                action: 'discussion.write',
            });
            if (!actor.ok) return res.status(actor.status).json({ error: actor.error, message: actor.message });
            const announcement = await publishCircleAnnouncement(prisma as any, {
                circleId,
                actor: actor.circleActor,
                sessionId: actor.sessionId,
                title: req.body?.title,
                body: req.body?.body,
                confirmationPolicy: req.body?.confirmationPolicy,
                clientNonce: req.body?.clientNonce,
                pinPriority: parseOptionalInt(req.body?.pinPriority),
                pinnedUntil: parseOptionalDate(req.body?.pinnedUntil),
                primarySourceType: req.body?.primarySourceType,
                primarySourceRef: req.body?.primarySourceRef,
                primarySourceEnvelopeId: req.body?.primarySourceEnvelopeId,
                locale: resolveExpressRequestLocale(req),
            });
            await publishAnnouncementProjection(redis, announcement);
            return res.status(201).json({ ok: true, announcement });
        } catch (error) {
            if (sendAnnouncementRouteError(res, error)) return;
            next(error);
        }
    });

    router.get('/circles/:id/announcements/:announcementId', async (req, res, next) => {
        try {
            const circleId = parsePositiveInt(req.params.id);
            if (!circleId) return res.status(400).json({ error: 'invalid_circle_id' });
            const announcementId = normalizeText(req.params.announcementId);
            if (!announcementId) return res.status(400).json({ error: 'invalid_announcement_id' });
            const actor = await resolveAnnouncementActor(req, prisma, circleId, {
                action: 'public.read',
                requireMemberChainPresence: false,
            });
            if (!actor.ok) return res.status(actor.status).json({ error: actor.error, message: actor.message });
            const announcement = await readCircleAnnouncementDetail(prisma as any, {
                circleId,
                announcementId,
                actor: actor.circleActor,
                locale: resolveExpressRequestLocale(req),
            });
            return res.json({ ok: true, announcement });
        } catch (error) {
            if (sendAnnouncementRouteError(res, error)) return;
            next(error);
        }
    });

    router.post('/circles/:id/announcements/:announcementId/seen', async (req, res, next) => {
        try {
            const result = await mutateAnnouncementReceipt(req, prisma, (input) => markCircleAnnouncementSeen(prisma as any, input));
            if ('status' in result) return res.status(result.status).json(result.payload);
            await publishAnnouncementProjection(redis, result.announcement);
            return res.json({ ok: true, announcement: result.announcement });
        } catch (error) {
            if (sendAnnouncementRouteError(res, error)) return;
            next(error);
        }
    });

    router.post('/circles/:id/announcements/:announcementId/mark-unread', async (req, res, next) => {
        try {
            const result = await mutateAnnouncementReceipt(req, prisma, (input) => markCircleAnnouncementUnread(prisma as any, input));
            if ('status' in result) return res.status(result.status).json(result.payload);
            await publishAnnouncementProjection(redis, result.announcement);
            return res.json({ ok: true, announcement: result.announcement });
        } catch (error) {
            if (sendAnnouncementRouteError(res, error)) return;
            next(error);
        }
    });

    router.post('/circles/:id/announcements/:announcementId/confirm', async (req, res, next) => {
        try {
            const result = await mutateAnnouncementReceipt(req, prisma, (input) => confirmCircleAnnouncement(prisma as any, {
                ...input,
                confirmationText: normalizeText(req.body?.confirmationText),
            }));
            if ('status' in result) return res.status(result.status).json(result.payload);
            await publishAnnouncementProjection(redis, result.announcement);
            return res.json({ ok: true, announcement: result.announcement });
        } catch (error) {
            if (sendAnnouncementRouteError(res, error)) return;
            next(error);
        }
    });

    return router;
}

async function mutateAnnouncementReceipt(
    req: any,
    prisma: PrismaClient,
    mutate: (input: { circleId: number; announcementId: string; actor: CircleActor; locale: string }) => Promise<any>,
): Promise<{ announcement: any } | { status: number; payload: { error: string; message?: string } }> {
    const circleId = parsePositiveInt(req.params.id);
    if (!circleId) return { status: 400, payload: { error: 'invalid_circle_id' } };
    const announcementId = normalizeText(req.params.announcementId);
    if (!announcementId) return { status: 400, payload: { error: 'invalid_announcement_id' } };
    const actor = await resolveAnnouncementActor(req, prisma, circleId, {
        action: 'public.read',
        requireMemberChainPresence: false,
    });
    if (!actor.ok) return { status: actor.status, payload: { error: actor.error, message: actor.message } };
    const announcement = await mutate({
        circleId,
        announcementId,
        actor: actor.circleActor,
        locale: resolveExpressRequestLocale(req),
    });
    return { announcement };
}

async function resolveAnnouncementActor(
    req: any,
    prisma: PrismaClient,
    circleId: number,
    options: {
        action: CircleAction;
        requireMemberChainPresence?: boolean;
    },
): Promise<
    | { ok: true; circleActor: CircleActor; sessionId: string | null }
    | { ok: false; status: number; error: string; message?: string }
> {
    const circleActor = await requireCircleActor(req, prisma, {
        circleId,
        action: options.action,
        requireSessionCookie: true,
        requireMemberChainPresence: options.requireMemberChainPresence,
    });
    const bodyActorPubkey = normalizeText(req.body?.senderPubkey)
        ?? normalizeText(req.body?.actorPubkey)
        ?? normalizeText(req.query?.senderPubkey)
        ?? normalizeText(req.query?.actorPubkey);
    if (bodyActorPubkey && bodyActorPubkey !== circleActor.pubkey) {
        return { ok: false, status: 403, error: 'sender_pubkey_mismatch' };
    }
    const auth = await authenticateDiscussionSessionFromRequest({
        prisma,
        authorizationHeader: typeof req.headers?.authorization === 'string'
            ? req.headers.authorization
            : undefined,
        circleId,
        actorPubkey: circleActor.pubkey,
    });
    if (!auth.ok) {
        return { ok: false, status: auth.status, error: auth.error, message: auth.message };
    }
    return {
        ok: true,
        circleActor,
        sessionId: auth.session?.sessionId ?? null,
    };
}

async function publishAnnouncementProjection(redis: Redis, announcement: any): Promise<void> {
    await publishDiscussionRealtimeEvent(redis, {
        circleId: announcement.circleId,
        reason: 'announcement_projection_changed',
        announcementId: announcement.announcementId,
        discussionRootEnvelopeId: announcement.discussionRootEnvelopeId,
        projectionVersion: announcement.projectionVersion,
        announcement,
    });
}

function sendAnnouncementRouteError(
    res: { status: (code: number) => { json: (payload: unknown) => unknown } },
    error: unknown,
): boolean {
    if (error instanceof AnnouncementPermissionError) {
        res.status(error.statusCode).json({ error: error.code });
        return true;
    }
    if (error instanceof AuthActorError) {
        res.status(error.statusCode).json(error.toResponseBody());
        return true;
    }
    return false;
}

function parsePositiveInt(value: unknown): number | null {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseOptionalInt(value: unknown): number | null {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseOptionalDate(value: unknown): Date | null {
    const normalized = normalizeText(value);
    if (!normalized) return null;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeText(value: unknown): string | null {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || null;
}
