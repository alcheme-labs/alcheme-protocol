import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import { requirePrivateSidecarSurface } from '../config/services';
import {
    requireAuthenticatedActor,
    requireCircleActorForAuthActor,
} from '../services/auth/actor';
import {
    sendAuthActorError,
} from '../services/auth/actorPermissions';
import { enqueueAiJob } from '../services/aiJobs/runtime';
import { loadSettingsTextAssistConfig } from '../services/aiOperatingLayer/settingsTextAssist/config';
import {
    SETTINGS_TEXT_ASSIST_POLICY_VERSION,
    normalizeLocale,
    persistSettingsTextAssistContext,
} from '../services/aiOperatingLayer/settingsTextAssist/context';
import {
    getSettingsTextFieldPolicy,
} from '../services/aiOperatingLayer/settingsTextAssist/fieldPolicy';

function parsePositiveInt(value: unknown): number | null {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

function hasUnsupportedSourceMaterialRequest(body: unknown): boolean {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
    const record = body as Record<string, unknown>;
    return ['sourceMaterialIds', 'sourceMaterialId', 'sourceMaterials'].some((key) =>
        Object.prototype.hasOwnProperty.call(record, key));
}

export function settingsTextAssistRouter(prisma: PrismaClient, _redis: Redis): Router {
    const router = Router();

    router.post('/settings-text-assist/proposals', async (req, res, next) => {
        try {
            const config = loadSettingsTextAssistConfig();
            if (!config.enabled) {
                return res.status(200).json({
                    ok: true,
                    status: 'disabled',
                    reasonCode: 'settings_text_assist_disabled',
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
                    error: 'settings_text_assist_source_materials_not_supported',
                });
            }

            const policy = getSettingsTextFieldPolicy(req.body?.field);
            if (!policy) {
                return res.status(400).json({ error: 'invalid_settings_text_assist_field' });
            }

            let subjectId: string;
            const scopeType = 'system';
            const scopeCircleId: number | null = null;

            if (policy.subjectType === 'circle_alias') {
                const circleId = parsePositiveInt(req.body?.circleId);
                if (!circleId) {
                    return res.status(400).json({ error: 'invalid_circle_id' });
                }
                await requireCircleActorForAuthActor(actor, prisma as any, {
                    circleId,
                    action: 'circle.read',
                    requireMemberChainPresence: false,
                });
                subjectId = String(circleId);
            } else {
                subjectId = String(actor.userId);
            }

            const persisted = await persistSettingsTextAssistContext({
                prisma: prisma as any,
                subjectType: policy.subjectType,
                subjectId,
                requestedByUserId: actor.userId,
                field: policy.field,
                locale: normalizeLocale(req.body?.locale),
                userIntent: req.body?.userIntent,
                currentValue: req.body?.currentValue,
                surroundingValues: req.body?.surroundingValues,
            });
            const dedupeKey = [
                'settings_text_assist_generate',
                policy.subjectType,
                subjectId,
                policy.field,
                persisted.contextDigest.slice(0, 32),
            ].join(':');
            const job = await enqueueAiJob(prisma as any, {
                jobType: 'settings_text_assist_generate',
                dedupeKey,
                scopeType,
                scopeCircleId,
                requestedByUserId: actor.userId,
                contextCapsuleId: persisted.capsuleId,
                payload: {
                    subjectType: policy.subjectType,
                    subjectId,
                    field: policy.field,
                    requestedByUserId: actor.userId,
                    fieldPolicyVersion: SETTINGS_TEXT_ASSIST_POLICY_VERSION,
                },
            });

            return res.status(202).json({
                ok: true,
                status: 'queued',
                jobId: job.id,
                proposalSubjectType: policy.subjectType,
                proposalSubjectId: subjectId,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return next(error);
        }
    });

    return router;
}
