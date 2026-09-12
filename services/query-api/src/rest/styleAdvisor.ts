import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import { requirePrivateSidecarSurface } from '../config/services';
import { requireAuthenticatedActor } from '../services/auth/actor';
import {
    requireCircleManagerForActor,
    sendAuthActorError,
} from '../services/auth/actorPermissions';
import { enqueueAiJob } from '../services/aiJobs/runtime';
import { loadStyleAdvisorConfig } from '../services/aiOperatingLayer/style/config';
import {
    normalizeLocale,
    persistStyleAdvisorContext,
} from '../services/aiOperatingLayer/style/context';
import type { StyleAdvisorScope, StyleSubjectType } from '../services/aiOperatingLayer/style/types';

const STYLE_EVENT_TYPES = new Set([
    'previewed',
    'ignored',
    'personal_applied',
    'circle_applied',
    'reset',
    'deleted',
    'exported',
]);

function parsePositiveInt(value: unknown): number | null {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

function parseScope(value: unknown): StyleAdvisorScope | null {
    if (value === 'personal' || value === 'circle' || value === 'session_preview') return value;
    return null;
}

function parseSessionPreviewId(value: unknown, actorUserId: number): string {
    const text = String(value ?? '').trim();
    if (/^[a-z0-9_.:-]{8,128}$/i.test(text)) return text;
    return `style_session:${actorUserId}`;
}

function hasUnsupportedSourceMaterialRequest(body: unknown): boolean {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
    const record = body as Record<string, unknown>;
    return ['sourceMaterialIds', 'sourceMaterialId', 'sourceMaterials'].some((key) =>
        Object.prototype.hasOwnProperty.call(record, key));
}

export function styleAdvisorRouter(prisma: PrismaClient, _redis: Redis): Router {
    const router = Router();

    router.post('/style-advisor/proposals', async (req, res, next) => {
        try {
            const config = loadStyleAdvisorConfig();
            if (!config.enabled) {
                return res.status(200).json({
                    ok: true,
                    status: 'disabled',
                    reasonCode: 'style_advisor_disabled',
                });
            }

            const sidecar = requirePrivateSidecarSurface('ghost_draft_private');
            if (!sidecar.ok) {
                return res.status(sidecar.statusCode).json({
                    error: sidecar.error,
                    route: sidecar.route,
                });
            }

            const actor = await requireAuthenticatedActor(req, prisma as any, {
                requireSessionCookie: true,
            });
            if (hasUnsupportedSourceMaterialRequest(req.body)) {
                return res.status(400).json({
                    error: 'style_advisor_source_materials_not_supported',
                });
            }

            const scope = parseScope(req.body?.scope);
            if (!scope) {
                return res.status(400).json({ error: 'invalid_style_advisor_scope' });
            }

            let subjectType: StyleSubjectType;
            let subjectId: string;
            let scopeType: 'system' | 'circle';
            let scopeCircleId: number | null = null;

            if (scope === 'circle') {
                const circleId = parsePositiveInt(req.body?.circleId);
                if (!circleId) {
                    return res.status(400).json({ error: 'invalid_circle_id' });
                }
                await requireCircleManagerForActor(prisma as any, {
                    actor,
                    circleId,
                });
                subjectType = 'circle';
                subjectId = String(circleId);
                scopeType = 'circle';
                scopeCircleId = circleId;
            } else if (scope === 'session_preview') {
                subjectType = 'style_session';
                subjectId = parseSessionPreviewId(req.body?.sessionPreviewId, actor.userId);
                scopeType = 'system';
            } else {
                subjectType = 'style_user';
                subjectId = String(actor.userId);
                scopeType = 'system';
            }

            const persisted = await persistStyleAdvisorContext({
                prisma: prisma as any,
                scope,
                subjectType,
                subjectId,
                requestedByUserId: actor.userId,
                locale: normalizeLocale(req.body?.locale),
                userIntent: req.body?.userIntent,
                currentPreference: req.body?.currentPreference,
                lifeFeelSignals: req.body?.lifeFeelSignals,
                publicCircleSnapshot: req.body?.publicCircleSnapshot,
            });
            const dedupeKey = [
                'style_life_feel_generate',
                subjectType,
                subjectId,
                persisted.contextDigest.slice(0, 32),
            ].join(':');
            const job = await enqueueAiJob(prisma as any, {
                jobType: 'style_life_feel_generate',
                dedupeKey,
                scopeType,
                scopeCircleId,
                requestedByUserId: actor.userId,
                contextCapsuleId: persisted.capsuleId,
                payload: {
                    scope,
                    subjectType,
                    subjectId,
                    requestedByUserId: actor.userId,
                    tokenPolicyVersion: persisted.payload.tokenPolicyVersion,
                },
            });

            return res.status(202).json({
                ok: true,
                status: 'queued',
                jobId: job.id,
                proposalSubjectType: subjectType,
                proposalSubjectId: subjectId,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return next(error);
        }
    });

    router.post('/style-advisor/proposals/:proposalId/events', async (req, res, next) => {
        try {
            const sidecar = requirePrivateSidecarSurface('ghost_draft_private');
            if (!sidecar.ok) {
                return res.status(sidecar.statusCode).json({
                    error: sidecar.error,
                    route: sidecar.route,
                });
            }

            const actor = await requireAuthenticatedActor(req, prisma as any, {
                requireSessionCookie: true,
            });
            const proposalId = String(req.params.proposalId || '').trim();
            const eventType = String(req.body?.eventType || '').trim();
            if (!proposalId) {
                return res.status(400).json({ error: 'invalid_ai_proposal_id' });
            }
            if (!STYLE_EVENT_TYPES.has(eventType)) {
                return res.status(400).json({ error: 'invalid_style_advisor_event_type' });
            }

            const proposal = await (prisma as any).aiProposalArtifact.findUnique({
                where: { id: proposalId },
            });
            if (!proposal || proposal.taskType !== 'style.life_feel_advisor.v1') {
                return res.status(404).json({ error: 'ai_proposal_not_found' });
            }
            if (proposal.subjectType === 'circle') {
                const circleId = parsePositiveInt(proposal.subjectId);
                if (!circleId) {
                    return res.status(404).json({ error: 'ai_proposal_not_found' });
                }
                await requireCircleManagerForActor(prisma as any, {
                    actor,
                    circleId,
                });
            } else if (
                proposal.subjectType === 'style_user'
                || proposal.subjectType === 'style_session'
            ) {
                if (Number(proposal.createdByUserId ?? 0) !== actor.userId) {
                    return res.status(404).json({ error: 'ai_proposal_not_found' });
                }
            } else {
                return res.status(404).json({ error: 'ai_proposal_not_found' });
            }

	            if (
	                (eventType === 'personal_applied' || eventType === 'circle_applied')
	                && (
	                    proposal.domainStatus !== 'applied'
	                    || Number(proposal.appliedByUserId ?? 0) !== actor.userId
	                )
	            ) {
	                return res.status(409).json({
	                    error: 'style_advisor_apply_event_requires_domain_apply',
	                });
	            }

	            const eventPayload = sanitizeStyleEventPayload(req.body);
            const event = await (prisma as any).aiProposalEvent.create({
                data: {
                    proposalId,
                    eventType,
                    actorUserId: actor.userId,
                    eventPayload,
                },
            });
            const updateData: Record<string, unknown> = {};
            if (eventType === 'personal_applied' || eventType === 'circle_applied') {
                updateData.acceptedByUserId = actor.userId;
            }
            if (eventType === 'ignored') {
                updateData.rejectedByUserId = actor.userId;
            }
            if (Object.keys(updateData).length > 0) {
                await (prisma as any).aiProposalArtifact.updateMany({
                    where: { id: proposalId },
                    data: updateData,
                });
            }

            return res.status(201).json({
                ok: true,
                eventId: String(event.id),
                eventType,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return next(error);
        }
    });

    return router;
}

function sanitizeStyleEventPayload(body: unknown): Record<string, unknown> {
    const record = body && typeof body === 'object' && !Array.isArray(body)
        ? body as Record<string, unknown>
        : {};
    const output: Record<string, unknown> = {};
    if (record.scope === 'personal' || record.scope === 'circle' || record.scope === 'session_preview') {
        output.scope = record.scope;
    }
    const clientStateDigest = typeof record.clientStateDigest === 'string'
        ? record.clientStateDigest.trim()
        : '';
    if (/^[a-f0-9]{16,128}$/i.test(clientStateDigest)) {
        output.clientStateDigest = clientStateDigest;
    }
    return output;
}
