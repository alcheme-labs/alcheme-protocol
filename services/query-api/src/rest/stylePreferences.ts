import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import { requireAuthenticatedActor } from '../services/auth/actor';
import {
    requireCircleManagerForActor,
    sendAuthActorError,
} from '../services/auth/actorPermissions';
import {
    applyStylePreferenceFromProposal,
    deleteStylePreferencesForActor,
    exportStylePreferencesForActor,
    loadCurrentStylePreference,
    resetCircleStylePreference,
} from '../services/aiOperatingLayer/style/preferences';

function parsePositiveInt(value: unknown): number | null {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

function parseScope(value: unknown): 'personal' | 'circle' | null {
    if (value === 'personal' || value === 'circle') return value;
    return null;
}

function serializePreference(row: any): Record<string, unknown> | null {
    if (!row) return null;
    return {
        id: String(row.id || ''),
        scopeType: String(row.scopeType || ''),
        userId: row.userId ?? null,
        circleId: row.circleId ?? null,
        status: String(row.status || ''),
        preferencePayload: row.preferencePayload && typeof row.preferencePayload === 'object'
            ? row.preferencePayload
            : {},
        sourceProposalId: row.sourceProposalId ? String(row.sourceProposalId) : null,
        updatedAt: row.updatedAt instanceof Date
            ? row.updatedAt.toISOString()
            : typeof row.updatedAt === 'string'
                ? row.updatedAt
                : null,
    };
}

export function stylePreferencesRouter(prisma: PrismaClient, _redis: Redis): Router {
    const router = Router();

    router.get('/style-preferences/current', async (req, res, next) => {
        try {
            const actor = await requireAuthenticatedActor(req, prisma as any, {
                requireSessionCookie: true,
            });
            const scope = parseScope(req.query.scope);
            if (!scope) {
                return res.status(400).json({ error: 'invalid_style_preference_scope' });
            }
            const circleId = scope === 'circle' ? parsePositiveInt(req.query.circleId) : null;
            if (scope === 'circle') {
                if (!circleId) {
                    return res.status(400).json({ error: 'invalid_circle_id' });
                }
                await requireCircleManagerForActor(prisma as any, {
                    actor,
                    circleId,
                });
            }
            const preference = await loadCurrentStylePreference(prisma as any, {
                scope,
                actorUserId: actor.userId,
                circleId,
            });
            return res.status(200).json({
                ok: true,
                preference: serializePreference(preference),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return next(error);
        }
    });

    router.post('/style-preferences/apply', async (req, res, next) => {
        try {
            const actor = await requireAuthenticatedActor(req, prisma as any, {
                requireSessionCookie: true,
            });
            const scope = parseScope(req.body?.scope);
            const proposalId = String(req.body?.proposalId || '').trim();
            if (!scope) {
                return res.status(400).json({ error: 'invalid_style_preference_scope' });
            }
            if (!proposalId) {
                return res.status(400).json({ error: 'invalid_style_proposal_id' });
            }
            const circleId = scope === 'circle' ? parsePositiveInt(req.body?.circleId) : null;
            if (scope === 'circle') {
                if (!circleId) {
                    return res.status(400).json({ error: 'invalid_circle_id' });
                }
                await requireCircleManagerForActor(prisma as any, {
                    actor,
                    circleId,
                });
            }

            const result = await applyStylePreferenceFromProposal(prisma as any, {
                proposalId,
                actorUserId: actor.userId,
                scope,
                circleId,
            });
            return res.status(200).json({
                ok: true,
                scope: result.scope,
                preference: serializePreference(result.preference),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            const message = error instanceof Error ? error.message : String(error || '');
	            if (/style_proposal_not_found|style_proposal_scope_mismatch/.test(message)) {
	                return res.status(404).json({ error: 'style_proposal_not_found' });
	            }
	            if (/style_proposal_not_applicable/.test(message)) {
	                return res.status(409).json({ error: 'style_proposal_not_applicable' });
	            }
	            if (/invalid_style_preference|invalid_style_proposal_id/.test(message)) {
	                return res.status(400).json({ error: 'invalid_style_preference' });
	            }
            return next(error);
        }
    });

    router.get('/style-preferences/export', async (req, res, next) => {
        try {
            const actor = await requireAuthenticatedActor(req, prisma as any, {
                requireSessionCookie: true,
            });
            const exported = await exportStylePreferencesForActor(prisma as any, {
                actorUserId: actor.userId,
            });
            return res.status(200).json({
                ok: true,
                ...exported,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return next(error);
        }
    });

    router.delete('/style-preferences/personal', async (req, res, next) => {
        try {
            const actor = await requireAuthenticatedActor(req, prisma as any, {
                requireSessionCookie: true,
            });
            const result = await deleteStylePreferencesForActor(prisma as any, {
                actorUserId: actor.userId,
            });
            return res.status(200).json({
                ok: true,
                ...result,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return next(error);
        }
    });

    router.post('/style-preferences/circle/reset', async (req, res, next) => {
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
            const result = await resetCircleStylePreference(prisma as any, {
                actorUserId: actor.userId,
                circleId,
            });
            return res.status(200).json({
                ok: true,
                ...result,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return next(error);
        }
    });

    return router;
}
