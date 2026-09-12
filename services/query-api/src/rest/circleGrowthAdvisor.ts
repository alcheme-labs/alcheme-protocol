import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import { requirePrivateSidecarSurface } from '../config/services';
import { requireAuthenticatedActor } from '../services/auth/actor';
import {
    requireCircleManagerForActor,
    sendAuthActorError,
} from '../services/auth/actorPermissions';
import { loadCircleGrowthAdvisorConfig } from '../services/aiOperatingLayer/growth/config';
import { collectCircleGrowthSignals } from '../services/aiOperatingLayer/growth/signals';
import { queueCircleGrowthAdvisorProposal } from '../services/aiOperatingLayer/growth/queue';
import {
    convertCircleEvolutionProposal,
    rejectCircleEvolutionProposal,
    snoozeCircleEvolutionProposal,
    toProposalView,
} from '../services/aiOperatingLayer/growth/proposals';

const FORBIDDEN_RESPONSE_KEYS = new Set([
    'rawText',
    'rawPrompt',
    'privateText',
    'providerRawResponse',
    'providerTrace',
    'sourceExcerpt',
]);

export function circleGrowthAdvisorRouter(prisma: PrismaClient, _redis: Redis): Router {
    const router = Router();

    router.post('/circle-growth-advisor/proposals', async (req, res, next) => {
        try {
            const actor = await requireAuthenticatedActor(req, prisma as any, {
                requireSessionCookie: true,
            });
            const circleId = parsePositiveInt(req.body?.circleId);
            if (!circleId) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            await requireCircleManagerForActor(prisma as any, {
                actor,
                circleId,
            });
            const config = loadCircleGrowthAdvisorConfig();
            if (!config.enabled) {
                return res.status(200).json({
                    ok: true,
                    status: 'disabled',
                    reasonCode: 'circle_growth_advisor_disabled',
                });
            }
            const gate = requirePrivateSidecarSurface('ghost_draft_private');
            if (!gate.ok) {
                return res.status(gate.statusCode).json({
                    error: gate.error,
                    route: gate.route,
                });
            }

            const signal = await collectCircleGrowthSignals(prisma as any, {
                circleId,
                requestedByUserId: actor.userId,
                triggerSource: 'manual',
                now: new Date(),
            });
            const result = await queueCircleGrowthAdvisorProposal(prisma as any, {
                signal,
                actorUserId: actor.userId,
                now: new Date(),
            });
            if (result.status === 'no_signal' || result.status === 'deduped') {
                return res.status(200).json(sanitizeForResponse({
                    ...result,
                }));
            }

            return res.status(202).json(sanitizeForResponse({
                ...result,
            }));
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return next(error);
        }
    });

    router.get('/circle-growth-advisor/proposals', async (req, res, next) => {
        try {
            const actor = await requireAuthenticatedActor(req, prisma as any, {
                requireSessionCookie: true,
            });
            const circleId = parsePositiveInt(req.query.circleId);
            if (!circleId) return res.status(400).json({ error: 'invalid_circle_id' });
            await requireCircleManagerForActor(prisma as any, { actor, circleId });
            const proposals = await (prisma as any).circleEvolutionProposal.findMany({
                where: { circleId },
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                take: Math.max(1, Math.min(50, parsePositiveInt(req.query.limit) ?? 20)),
            });
            return res.status(200).json(sanitizeForResponse({
                ok: true,
                proposals: proposals.map(toProposalView),
            }));
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return next(error);
        }
    });

    router.get('/circle-growth-advisor/proposals/:proposalId', async (req, res, next) => {
        try {
            const { actor, proposal } = await requireProposalManager(req, prisma as any);
            const events = await (prisma as any).circleEvolutionProposalEvent.findMany({
                where: { proposalId: proposal.id },
                orderBy: { createdAt: 'desc' },
                take: 25,
            });
            void actor;
            return res.status(200).json(sanitizeForResponse({
                ok: true,
                proposal: toProposalView(proposal),
                events: events.map(serializeEvent),
            }));
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return sendGrowthErrorOrNext(res, next, error);
        }
    });

    router.post('/circle-growth-advisor/proposals/:proposalId/reject', async (req, res, next) => {
        try {
            const gate = requirePrivateSidecarSurface('ghost_draft_private');
            if (!gate.ok) {
                return res.status(gate.statusCode).json({
                    error: gate.error,
                    route: gate.route,
                });
            }
            const { actor } = await requireProposalManager(req, prisma as any);
            const proposal = await rejectCircleEvolutionProposal(prisma as any, {
                proposalId: req.params.proposalId,
                actorUserId: actor.userId,
                reason: req.body?.reason,
            });
            return res.status(200).json(sanitizeForResponse({ ok: true, proposal }));
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return sendGrowthErrorOrNext(res, next, error);
        }
    });

    router.post('/circle-growth-advisor/proposals/:proposalId/snooze', async (req, res, next) => {
        try {
            const gate = requirePrivateSidecarSurface('ghost_draft_private');
            if (!gate.ok) {
                return res.status(gate.statusCode).json({
                    error: gate.error,
                    route: gate.route,
                });
            }
            const { actor } = await requireProposalManager(req, prisma as any);
            const proposal = await snoozeCircleEvolutionProposal(prisma as any, {
                proposalId: req.params.proposalId,
                actorUserId: actor.userId,
                snoozeUntil: req.body?.snoozeUntil,
                reason: req.body?.reason,
            });
            return res.status(200).json(sanitizeForResponse({ ok: true, proposal }));
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return sendGrowthErrorOrNext(res, next, error);
        }
    });

    router.post('/circle-growth-advisor/proposals/:proposalId/convert', async (req, res, next) => {
        try {
            const gate = requirePrivateSidecarSurface('ghost_draft_private');
            if (!gate.ok) {
                return res.status(gate.statusCode).json({
                    error: gate.error,
                    route: gate.route,
                });
            }
            const { actor } = await requireProposalManager(req, prisma as any);
            const proposal = await convertCircleEvolutionProposal(prisma as any, {
                proposalId: req.params.proposalId,
                actorUserId: actor.userId,
            });
            return res.status(200).json(sanitizeForResponse({ ok: true, proposal }));
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return sendGrowthErrorOrNext(res, next, error);
        }
    });

    return router;
}

async function requireProposalManager(req: any, prisma: any) {
    const actor = await requireAuthenticatedActor(req, prisma, {
        requireSessionCookie: true,
    });
    const id = String(req.params.proposalId || '').trim();
    const proposal = id
        ? await prisma.circleEvolutionProposal.findUnique({ where: { id } })
        : null;
    if (!proposal) {
        const error = new Error('circle_growth_proposal_not_found');
        (error as Error & { statusCode?: number }).statusCode = 404;
        throw error;
    }
    await requireCircleManagerForActor(prisma, {
        actor,
        circleId: Number(proposal.circleId),
    });
    return { actor, proposal };
}

function parsePositiveInt(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function serializeEvent(row: any) {
    return {
        id: typeof row.id === 'bigint' ? row.id.toString() : String(row.id),
        eventType: String(row.eventType),
        actorUserId: Number.isFinite(Number(row.actorUserId)) ? Number(row.actorUserId) : null,
        eventPayload: row.eventPayload && typeof row.eventPayload === 'object' ? row.eventPayload : {},
        createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt || ''),
    };
}

function sendGrowthErrorOrNext(res: any, next: any, error: unknown) {
    const message = error instanceof Error ? error.message : String(error || '');
    if (message === 'growth_reject_reason_required') {
        return res.status(400).json({ error: message });
    }
    if (message === 'growth_snooze_until_required') {
        return res.status(400).json({ error: message });
    }
    if (message === 'growth_not_convertible') {
        return res.status(409).json({ error: message });
    }
    if ((error as any)?.statusCode) {
        return res.status((error as any).statusCode).json({ error: message });
    }
    return next(error);
}

function sanitizeForResponse<T>(value: T): T {
    return JSON.parse(JSON.stringify(value, (key, nested) =>
        FORBIDDEN_RESPONSE_KEYS.has(key) ? undefined : nested,
    ));
}
