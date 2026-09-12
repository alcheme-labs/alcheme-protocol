import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import { requirePrivateSidecarSurface } from '../config/services';
import { requireAuthenticatedActor } from '../services/auth/actor';
import {
    requireCircleManagerForActor,
    requireSourceMaterialAccessForActor,
    sendAuthActorError,
} from '../services/auth/actorPermissions';
import { enqueueAiJob } from '../services/aiJobs/runtime';
import { loadConfigurationCopilotConfig } from '../services/aiOperatingLayer/configuration/config';
import {
    buildSourceMaterialEvidenceRef,
    normalizeLocale,
    persistConfigurationCopilotContext,
} from '../services/aiOperatingLayer/configuration/context';
import {
    CONFIGURATION_FIELD_POLICY_VERSION,
    normalizeConfigurationSnapshot,
    validateConfigurationTargetFields,
} from '../services/aiOperatingLayer/configuration/fieldPolicy';
import type {
    ConfigurationCopilotEntrypoint,
    ConfigurationCopilotInteractionMode,
    ConfigurationCopilotSubjectType,
} from '../services/aiOperatingLayer/configuration/types';
import { listSourceMaterials } from '../services/sourceMaterials/readModel';

const CONFIG_EVENT_TYPES = new Set([
    'field_accepted',
    'all_fields_accepted',
    'ignored',
    'local_undo',
    'local_draft_applied',
]);

function parsePositiveInt(value: unknown): number | null {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

function parseSourceMaterialIds(value: unknown): number[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(
        value
            .map((item) => Number(item))
            .filter((item) => Number.isFinite(item) && item > 0)
            .map((item) => Math.trunc(item)),
    ));
}

function parseCreateSessionId(value: unknown): string {
    const text = String(value ?? '').trim();
    return /^[a-z0-9_.:-]{8,128}$/i.test(text) ? text : '';
}

function parseEntrypoint(value: unknown): ConfigurationCopilotEntrypoint | null {
    if (value === 'create_circle' || value === 'circle_settings' || value === 'fork_create') return value;
    return null;
}

function parseInteractionMode(value: unknown): ConfigurationCopilotInteractionMode {
    if (value === 'field_inline' || value === 'section_diff' || value === 'full_panel') return value;
    return 'full_panel';
}

function mapSourceMaterialVisibility(value: string): 'public' | 'member_visible' | 'reviewer_only' | 'sealed' | 'redacted' {
    if (value === 'public') return 'public';
    if (value === 'reviewer_only') return 'reviewer_only';
    if (value === 'sealed') return 'sealed';
    if (value === 'redacted') return 'redacted';
    return 'member_visible';
}

export function configurationCopilotRouter(prisma: PrismaClient, _redis: Redis): Router {
    const router = Router();

    router.post('/configuration-copilot/proposals', async (req, res, next) => {
        try {
            const config = loadConfigurationCopilotConfig();
            if (!config.enabled) {
                return res.status(200).json({
                    ok: true,
                    status: 'disabled',
                    reasonCode: 'configuration_copilot_disabled',
                });
            }

            const actor = await requireAuthenticatedActor(req, prisma as any, {
                requireSessionCookie: true,
            });
            const entrypoint = parseEntrypoint(req.body?.entrypoint);
            if (!entrypoint) {
                return res.status(400).json({ error: 'invalid_configuration_copilot_entrypoint' });
            }

            const sourceMaterialIds = parseSourceMaterialIds(req.body?.sourceMaterialIds);
            const targetFieldsResult = validateConfigurationTargetFields(entrypoint, req.body?.targetFields);
            if (!targetFieldsResult.ok) {
                return res.status(400).json({
                    error: 'invalid_configuration_target_fields',
                    fields: targetFieldsResult.errors,
                });
            }
            const interactionMode = parseInteractionMode(req.body?.interactionMode);

            let subjectType: ConfigurationCopilotSubjectType;
            let subjectId: string;
            let scopeType: 'system' | 'circle';
            let scopeCircleId: number | null = null;
            let sourceMaterialRefs: ReturnType<typeof buildSourceMaterialEvidenceRef>[] = [];

            if (entrypoint === 'create_circle' || entrypoint === 'fork_create') {
                if (sourceMaterialIds.length > 0) {
                    return res.status(400).json({
                        error: 'configuration_copilot_pre_create_source_materials_not_supported',
                    });
                }
                if (entrypoint === 'create_circle') {
                    const createSessionId = parseCreateSessionId(req.body?.createSessionId);
                    if (!createSessionId) {
                        return res.status(400).json({ error: 'invalid_create_session_id' });
                    }
                    subjectType = 'circle_create_session';
                    subjectId = createSessionId;
                } else {
                    const forkSessionId = parseCreateSessionId(req.body?.forkSessionId);
                    if (!forkSessionId) {
                        return res.status(400).json({ error: 'invalid_fork_session_id' });
                    }
                    subjectType = 'circle_fork_session';
                    subjectId = forkSessionId;
                }
                scopeType = 'system';
            } else {
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

                if (sourceMaterialIds.length > 0) {
                    const gate = requirePrivateSidecarSurface('source_materials');
                    if (!gate.ok) {
                        return res.status(gate.statusCode).json({
                            error: gate.error,
                            route: gate.route,
                        });
                    }
                    await requireSourceMaterialAccessForActor(prisma as any, {
                        actor,
                        circleId,
                    });
                    const materials = await listSourceMaterials(prisma as any, {
                        circleId,
                        materialIds: sourceMaterialIds,
                        canReview: false,
                        canViewReviewQueue: false,
                    });
                    const found = new Set(materials.map((material) => Number(material.id)));
                    const missing = sourceMaterialIds.filter((materialId) => !found.has(materialId));
                    if (missing.length > 0) {
                        return res.status(404).json({
                            error: 'source_material_not_found',
                            materialIds: missing,
                        });
                    }
                    sourceMaterialRefs = materials.map((material) => buildSourceMaterialEvidenceRef({
                        materialId: material.id,
                        contentDigest: material.contentDigest,
                        visibility: mapSourceMaterialVisibility(material.evidencePrivacyClass),
                        circleId,
                        name: material.name,
                        lifecycleStatus: material.lifecycleStatus,
                    }));
                }
            }

            if (sourceMaterialIds.length === 0) {
                const gate = requirePrivateSidecarSurface('ghost_draft_private');
                if (!gate.ok) {
                    return res.status(gate.statusCode).json({
                        error: gate.error,
                        route: gate.route,
                    });
                }
            }

            const persisted = await persistConfigurationCopilotContext({
                prisma: prisma as any,
                entrypoint,
                subjectType,
                subjectId,
                requestedByUserId: actor.userId,
                locale: normalizeLocale(req.body?.locale),
                userIntent: req.body?.userIntent,
                currentSnapshot: normalizeConfigurationSnapshot(entrypoint, req.body?.currentSnapshot),
                targetFields: targetFieldsResult.targetFields,
                interactionMode,
                sourceMaterialRefs,
            });
            const dedupeKey = [
                'configuration_copilot_generate',
                subjectType,
                subjectId,
                persisted.contextDigest.slice(0, 32),
            ].join(':');
            const job = await enqueueAiJob(prisma as any, {
                jobType: 'configuration_copilot_generate',
                dedupeKey,
                scopeType,
                scopeCircleId,
                requestedByUserId: actor.userId,
                contextCapsuleId: persisted.capsuleId,
                payload: {
                    entrypoint,
                    subjectType,
                    subjectId,
                    requestedByUserId: actor.userId,
                    fieldPolicyVersion: CONFIGURATION_FIELD_POLICY_VERSION,
                    targetFieldCount: targetFieldsResult.targetFields.length,
                    interactionMode,
                    sourceMaterialRefCount: sourceMaterialRefs.length,
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

    router.post('/configuration-copilot/proposals/:proposalId/events', async (req, res, next) => {
        try {
            const gate = requirePrivateSidecarSurface('ghost_draft_private');
            if (!gate.ok) {
                return res.status(gate.statusCode).json({
                    error: gate.error,
                    route: gate.route,
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
            if (!CONFIG_EVENT_TYPES.has(eventType)) {
                return res.status(400).json({ error: 'invalid_configuration_copilot_event_type' });
            }

            const proposal = await (prisma as any).aiProposalArtifact.findUnique({
                where: { id: proposalId },
            });
            if (!proposal || proposal.taskType !== 'configuration.copilot.v1') {
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
            } else if (proposal.subjectType === 'circle_create_session' || proposal.subjectType === 'circle_fork_session') {
                if (Number(proposal.createdByUserId ?? 0) !== actor.userId) {
                    return res.status(404).json({ error: 'ai_proposal_not_found' });
                }
            } else {
                return res.status(404).json({ error: 'ai_proposal_not_found' });
            }

            const eventPayload = sanitizeEventPayload(req.body);
            const event = await (prisma as any).aiProposalEvent.create({
                data: {
                    proposalId,
                    eventType,
                    actorUserId: actor.userId,
                    eventPayload,
                },
            });
            const updateData: Record<string, unknown> = {};
            if (eventType === 'all_fields_accepted' || eventType === 'local_draft_applied') {
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

function sanitizeEventPayload(body: unknown): Record<string, unknown> {
    const record = body && typeof body === 'object' && !Array.isArray(body)
        ? body as Record<string, unknown>
        : {};
    const output: Record<string, unknown> = {};
    const field = typeof record.field === 'string' ? record.field.trim() : '';
    if (field) output.field = field;
    if (Array.isArray(record.fields)) {
        output.fields = record.fields
            .map((item) => String(item || '').trim())
            .filter(Boolean)
            .slice(0, 30);
    }
    const clientStateDigest = typeof record.clientStateDigest === 'string'
        ? record.clientStateDigest.trim()
        : '';
    if (/^[a-f0-9]{16,128}$/i.test(clientStateDigest)) {
        output.clientStateDigest = clientStateDigest;
    }
    return output;
}
