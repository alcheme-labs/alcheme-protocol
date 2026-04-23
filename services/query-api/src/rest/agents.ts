import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import { parseAuthUserIdFromRequest, requireCircleOwnerRole } from '../services/membership/checks';
import { authorizeAgentManagement } from '../services/agents/access';
import { bindAgentToUser, createCircleAgent, listCircleAgents } from '../services/agents/runtime';
import { resolveCircleAgentPolicy, upsertCircleAgentPolicy } from '../services/agents/policy';

function parsePositiveInt(value: unknown): number | null {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

function parseOptionalText(value: unknown): string | null {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || null;
}

function parseOptionalBps(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, Math.min(10_000, parsed));
}

function parseTriggerScope(value: unknown): 'disabled' | 'draft_only' | 'circle_wide' | null {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'disabled') return 'disabled';
    if (normalized === 'draft_only') return 'draft_only';
    if (normalized === 'circle_wide') return 'circle_wide';
    return null;
}

function parseReviewMode(value: unknown): 'owner_review' | 'admin_review' | 'self_serve' | null {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'owner_review') return 'owner_review';
    if (normalized === 'admin_review') return 'admin_review';
    if (normalized === 'self_serve') return 'self_serve';
    return null;
}

export function agentsRouter(prisma: PrismaClient, _redis: Redis): Router {
    const router = Router();

    router.get('/:id/agents', async (req, res, next) => {
        try {
            const circleId = parsePositiveInt(req.params.id);
            if (!circleId) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }

            const userId = parseAuthUserIdFromRequest(req);
            const access = await authorizeAgentManagement(prisma as any, {
                circleId,
                userId,
            });
            if (!access.allowed) {
                return res.status(access.statusCode).json({
                    error: access.error,
                    message: access.message,
                });
            }

            const agents = await listCircleAgents(prisma as any, circleId);
            return res.status(200).json({
                ok: true,
                circleId,
                agents,
            });
        } catch (error) {
            return next(error);
        }
    });

    router.post('/:id/agents', async (req, res, next) => {
        try {
            const circleId = parsePositiveInt(req.params.id);
            if (!circleId) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }

            const userId = parseAuthUserIdFromRequest(req);
            const access = await authorizeAgentManagement(prisma as any, {
                circleId,
                userId,
            });
            if (!access.allowed) {
                return res.status(access.statusCode).json({
                    error: access.error,
                    message: access.message,
                });
            }

            const pubkey = parseOptionalText(req.body?.pubkey);
            const handle = parseOptionalText(req.body?.handle);
            if (!pubkey) {
                return res.status(400).json({ error: 'agent_pubkey_required' });
            }
            if (!handle) {
                return res.status(400).json({ error: 'agent_handle_required' });
            }

            const agent = await createCircleAgent(prisma as any, {
                circleId,
                agentPubkey: pubkey,
                handle,
                displayName: parseOptionalText(req.body?.displayName),
                description: parseOptionalText(req.body?.description),
                ownerUserId: parsePositiveInt(req.body?.ownerUserId),
                createdByUserId: Number(userId),
            });

            return res.status(200).json({
                ok: true,
                circleId,
                agent,
            });
        } catch (error) {
            if (error instanceof Error && error.message) {
                return res.status(400).json({ error: error.message });
            }
            return next(error);
        }
    });

    router.post('/:id/agents/:agentId/bind', async (req, res, next) => {
        try {
            const circleId = parsePositiveInt(req.params.id);
            const agentId = parsePositiveInt(req.params.agentId);
            if (!circleId) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            if (!agentId) {
                return res.status(400).json({ error: 'invalid_agent_id' });
            }

            const userId = parseAuthUserIdFromRequest(req);
            const access = await authorizeAgentManagement(prisma as any, {
                circleId,
                userId,
            });
            if (!access.allowed) {
                return res.status(access.statusCode).json({
                    error: access.error,
                    message: access.message,
                });
            }

            const ownerUserId = req.body?.ownerUserId === null
                ? null
                : parsePositiveInt(req.body?.ownerUserId);
            if (req.body?.ownerUserId !== null && !ownerUserId) {
                return res.status(400).json({ error: 'owner_user_id_required' });
            }

            const agent = await bindAgentToUser(prisma as any, {
                circleId,
                agentId,
                ownerUserId,
            });
            return res.status(200).json({
                ok: true,
                circleId,
                agent,
            });
        } catch (error) {
            if (error instanceof Error) {
                if (error.message === 'agent_not_found') {
                    return res.status(404).json({ error: error.message });
                }
                if (error.message === 'agent_circle_mismatch') {
                    return res.status(409).json({ error: error.message });
                }
                if (error.message) {
                    return res.status(400).json({ error: error.message });
                }
            }
            return next(error);
        }
    });

    router.get('/:id/agents/policy', async (req, res, next) => {
        try {
            const circleId = parsePositiveInt(req.params.id);
            if (!circleId) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }

            const userId = parseAuthUserIdFromRequest(req);
            const access = await authorizeAgentManagement(prisma as any, {
                circleId,
                userId,
            });
            if (!access.allowed) {
                return res.status(access.statusCode).json({
                    error: access.error,
                    message: access.message,
                });
            }

            const policy = await resolveCircleAgentPolicy(prisma as any, circleId);
            return res.status(200).json({
                ok: true,
                circleId,
                policy,
            });
        } catch (error) {
            if (error instanceof Error && error.message === 'circle_not_found') {
                return res.status(404).json({ error: error.message });
            }
            return next(error);
        }
    });

    router.put('/:id/agents/policy', async (req, res, next) => {
        try {
            const circleId = parsePositiveInt(req.params.id);
            if (!circleId) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }

            const userId = parseAuthUserIdFromRequest(req);
            if (!userId) {
                return res.status(401).json({ error: 'authentication_required' });
            }

            const allowed = await requireCircleOwnerRole(prisma as any, {
                circleId,
                userId,
            });
            if (!allowed) {
                return res.status(403).json({
                    error: 'agent_policy_owner_required',
                    message: 'only the circle owner can update agent policy',
                });
            }

            const patch: Record<string, unknown> = {};
            if (Object.prototype.hasOwnProperty.call(req.body || {}, 'triggerScope')) {
                const triggerScope = parseTriggerScope(req.body?.triggerScope);
                if (!triggerScope) {
                    return res.status(400).json({ error: 'invalid_agent_trigger_scope' });
                }
                patch.triggerScope = triggerScope;
            }
            if (Object.prototype.hasOwnProperty.call(req.body || {}, 'costDiscountBps')) {
                const costDiscountBps = parseOptionalBps(req.body?.costDiscountBps);
                if (costDiscountBps === null) {
                    return res.status(400).json({ error: 'invalid_agent_cost_discount_bps' });
                }
                patch.costDiscountBps = costDiscountBps;
            }
            if (Object.prototype.hasOwnProperty.call(req.body || {}, 'reviewMode')) {
                const reviewMode = parseReviewMode(req.body?.reviewMode);
                if (!reviewMode) {
                    return res.status(400).json({ error: 'invalid_agent_review_mode' });
                }
                patch.reviewMode = reviewMode;
            }
            if (Object.keys(patch).length === 0) {
                return res.status(400).json({ error: 'invalid_agent_policy_patch' });
            }

            const policy = await upsertCircleAgentPolicy(prisma as any, {
                circleId,
                actorUserId: userId,
                patch,
            });

            return res.status(200).json({
                ok: true,
                circleId,
                policy,
            });
        } catch (error) {
            if (error instanceof Error && error.message === 'circle_not_found') {
                return res.status(404).json({ error: error.message });
            }
            return next(error);
        }
    });

    return router;
}
