import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import { loadNodeRuntimeConfig, requirePrivateSidecarSurface } from '../config/services';
import { loadPrivateText } from '../services/privateContentBridge';
import { AuthActorError, requireAuthenticatedActor, type AuthActor } from '../services/auth/actor';
import {
    authorizeDraftActionForActor,
    requireSourceMaterialAccessForActor,
    requireSourceMaterialReviewActor,
    sendAuthActorError,
} from '../services/auth/actorPermissions';
import {
    createSourceMaterial,
    SOURCE_MATERIAL_PLAINTEXT_CUSTODY,
} from '../services/sourceMaterials/ingest';
import { sha256Hex } from '../services/sourceMaterials/uploadBridge';
import {
    createStorageFabricObjectClientFromRuntime,
    type StorageFabricObjectClient,
} from '../services/sourceMaterials/storageFabricObjectClient';
import { markCircleTopicProfileDirty } from '../services/discussion/analysis/invalidation';
import { listSourceMaterials } from '../services/sourceMaterials/readModel';
import {
    isSourceMaterialVisibleToCircleMember,
    normalizeSourceMaterialLifecycleStatus,
    normalizeSourceMaterialPrivacyClass,
    type SourceMaterialLifecycleStatus,
} from '../services/sourceMaterials/lifecycle';
import { publishSourceMaterialAcceptedSystemNotice } from '../services/discussion/systemNoticeProducer';
import {
    evaluateSourceMaterialGovernance,
    shouldGovernSourceMaterialLifecycle,
    sourceMaterialActionTypeForLifecycleStatus,
} from '../services/governance/sourceMaterialGovernance';
import { resolveActiveCircleGovernanceBinding } from '../services/governance/circleGovernanceBindings';
import {
    buildSourceMaterialLicenseFacts,
    withdrawKnowledgePublicationsUsingSourceMaterial,
} from '../services/knowledgePublicationLicense';

const SOURCE_MATERIAL_TERMINAL_STATUSES = new Set<SourceMaterialLifecycleStatus>([
    'rejected',
    'redacted',
    'revoked',
    'expired',
]);

const SOURCE_MATERIAL_ROUTE_TRANSITIONS: Record<SourceMaterialLifecycleStatus, SourceMaterialLifecycleStatus[]> = {
    nominated: ['submitted', 'rejected', 'revoked', 'expired'],
    submitted: ['review_pending', 'accepted_to_plaza', 'rejected', 'revoked', 'expired'],
    review_pending: ['accepted_to_plaza', 'rejected', 'redacted', 'revoked', 'expired'],
    accepted_to_plaza: ['redacted', 'revoked'],
    used_in_draft: ['redacted', 'revoked'],
    crystallized: ['redacted', 'revoked'],
    rejected: [],
    redacted: [],
    revoked: [],
    expired: [],
};

function canTransitionSourceMaterialLifecycle(input: {
    currentStatus: SourceMaterialLifecycleStatus;
    nextStatus: SourceMaterialLifecycleStatus;
    isManager: boolean;
}): boolean {
    if (input.currentStatus === input.nextStatus) return true;
    if (SOURCE_MATERIAL_TERMINAL_STATUSES.has(input.currentStatus)) return false;
    if (!input.isManager) {
        return input.currentStatus === 'nominated' && input.nextStatus === 'submitted';
    }
    return SOURCE_MATERIAL_ROUTE_TRANSITIONS[input.currentStatus].includes(input.nextStatus);
}

function parseOptionalDigest64(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase().replace(/^sha256:/, '');
    return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

function buildLifecycleProvenance(input: {
    existing: unknown;
    fromStatus: SourceMaterialLifecycleStatus;
    toStatus: SourceMaterialLifecycleStatus;
    userId: number;
    actorPubkey: string | null;
    reason: string | null;
    governanceRequestId: string | null;
    reviewDecisionDigest: string | null;
}): Record<string, unknown> {
    const base = input.existing && typeof input.existing === 'object' && !Array.isArray(input.existing)
        ? { ...(input.existing as Record<string, unknown>) }
        : {};
    const existingEvents = Array.isArray(base.lifecycleEvents)
        ? base.lifecycleEvents.filter((event) => event && typeof event === 'object').slice(-19)
        : [];
    return {
        ...base,
        lifecycleEvents: [
            ...existingEvents,
            {
                fromStatus: input.fromStatus,
                toStatus: input.toStatus,
                userId: input.userId,
                actorPubkey: input.actorPubkey,
                reason: input.reason,
                governanceRequestId: input.governanceRequestId,
                reviewDecisionDigest: input.reviewDecisionDigest,
                at: new Date().toISOString(),
            },
        ],
    };
}

async function verifyGovernanceRequestForLifecycle(
    prisma: PrismaClient,
    input: {
        governanceRequestId: string | null;
        sourceMaterialId: number;
        actionType: string;
        legacyActionType: string;
    },
): Promise<{ ok: true } | { ok: false; statusCode: number; error: string }> {
    if (!input.governanceRequestId) return { ok: true };
    const request = await (prisma as any).governanceRequest?.findUnique?.({
        where: { id: input.governanceRequestId },
        select: {
            id: true,
            state: true,
            actionType: true,
            targetType: true,
            targetRef: true,
        },
    });
    if (!request) {
        return { ok: false, statusCode: 404, error: 'source_material_governance_request_not_found' };
    }
    if (
        request.state !== 'accepted'
        || (request.actionType !== input.actionType && request.actionType !== input.legacyActionType)
        || request.targetType !== 'source_material'
        || request.targetRef !== String(input.sourceMaterialId)
    ) {
        return { ok: false, statusCode: 409, error: 'source_material_governance_request_mismatch' };
    }
    return { ok: true };
}

function legacySourceMaterialActionTypeForLifecycleStatus(status: SourceMaterialLifecycleStatus): string {
    if (status === 'accepted_to_plaza') return 'external_app_source_material_accept';
    if (status === 'rejected') return 'external_app_source_material_reject';
    if (status === 'redacted') return 'external_app_source_material_redact';
    if (status === 'revoked') return 'external_app_source_material_revoke';
    return 'external_app_source_material_submit';
}

async function hasActiveSourceMaterialAcceptBindingForRead(
    prisma: PrismaClient,
    circleId: number,
): Promise<boolean> {
    try {
        const binding = await resolveActiveCircleGovernanceBinding(prisma as any, {
            targetCircleId: circleId,
            actionType: 'source_material.accept',
        });
        return Boolean(binding);
    } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (
            message === 'circle_governance_committee_not_found'
            || message === 'circle_governance_policy_not_found'
            || message === 'circle_governance_policy_version_not_found'
        ) {
            return false;
        }
        throw error;
    }
}

function parseOptionalPositiveInt(value: unknown): number | null {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseOptionalString(value: unknown): string | null {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || null;
}

function isSupportedTextLikeSourceMaterial(input: {
    name: string | null;
    mimeType: string | null;
}): boolean {
    const mimeType = String(input.mimeType || '').trim().toLowerCase();
    const name = String(input.name || '').trim().toLowerCase();
    if (!mimeType && !name) return false;
    if (mimeType.startsWith('text/')) return true;
    if (mimeType === 'application/json') return true;
    if (mimeType === 'application/ld+json') return true;
    if (mimeType === 'application/xml') return true;
    if (mimeType === 'text/csv') return true;
    return (
        name.endsWith('.txt')
        || name.endsWith('.md')
        || name.endsWith('.markdown')
        || name.endsWith('.json')
        || name.endsWith('.csv')
        || name.endsWith('.yaml')
        || name.endsWith('.yml')
        || name.endsWith('.xml')
    );
}

async function validateSeededSourceNodeScope(
    prisma: PrismaClient,
    input: {
        circleId: number;
        seededSourceNodeId: number | null;
    },
): Promise<{
    ok: true;
} | {
    ok: false;
    statusCode: number;
    error: string;
}> {
    if (!input.seededSourceNodeId) {
        return { ok: true };
    }

    const seededSourceNode = await (prisma as any).seededSourceNode.findUnique({
        where: { id: input.seededSourceNodeId },
        select: {
            id: true,
            circleId: true,
        },
    });
    if (!seededSourceNode) {
        return {
            ok: false,
            statusCode: 404,
            error: 'source_material_seeded_source_node_not_found',
        };
    }
    if (Number(seededSourceNode.circleId) !== input.circleId) {
        return {
            ok: false,
            statusCode: 409,
            error: 'source_material_seeded_source_circle_mismatch',
        };
    }

    return { ok: true };
}

export function sourceMaterialsRouter(
    prisma: PrismaClient,
    redis: Redis,
    options?: {
        createStorageFabricObjectClient?: typeof createStorageFabricObjectClientFromRuntime;
    },
): Router {
    const router = Router();

    async function requireSourceMaterialActor(req: any, circleId: number) {
        const actor = await requireAuthenticatedActor(req, prisma, { requireSessionCookie: true });
        await requireSourceMaterialAccessForActor(prisma, { actor, circleId });
        return {
            actor,
            userId: actor.userId,
        };
    }

    async function canReviewSourceMaterials(actor: AuthActor, circleId: number): Promise<boolean> {
        try {
            await requireSourceMaterialReviewActor(prisma, { actor, circleId });
            return true;
        } catch (error) {
            if (error instanceof AuthActorError && error.code === 'circle_role_required') {
                return false;
            }
            throw error;
        }
    }

    router.get('/:id/source-materials', async (req, res, next) => {
        try {
            const gate = requirePrivateSidecarSurface('source_materials');
            if (!gate.ok) {
                return res.status(gate.statusCode).json({
                    error: gate.error,
                    route: gate.route,
                });
            }

            const circleId = parseOptionalPositiveInt(req.params.id);
            if (!circleId) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }

            const { actor, userId } = await requireSourceMaterialActor(req, circleId);

            const draftPostId = parseOptionalPositiveInt(req.query?.draftPostId);
            if (draftPostId) {
                const access = await authorizeDraftActionForActor(prisma, {
                    actor,
                    postId: draftPostId,
                    action: 'read',
                });
                if (!access.allowed) {
                    return res.status(access.statusCode).json({
                        error: access.error,
                        message: access.message,
                    });
                }
                if (access.post?.circleId !== circleId) {
                    return res.status(409).json({ error: 'source_material_draft_circle_mismatch' });
                }
            }

            const canReview = await canReviewSourceMaterials(actor, circleId);
            const wantsGovernedAcceptQueue = req.query?.reviewQueue === 'governed_accept';
            const canViewGovernedAcceptQueue = wantsGovernedAcceptQueue
                && !canReview
                && await hasActiveSourceMaterialAcceptBindingForRead(prisma, circleId);

            const materials = await listSourceMaterials(prisma, {
                circleId,
                draftPostId,
                discussionThreadId: parseOptionalString(req.query?.discussionThreadId),
                seededSourceNodeId: parseOptionalPositiveInt(req.query?.seededSourceNodeId),
                canReview,
                canViewReviewQueue: canReview || canViewGovernedAcceptQueue,
            });

            return res.json({
                ok: true,
                circleId,
                materials,
                custody: SOURCE_MATERIAL_PLAINTEXT_CUSTODY,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            next(error);
        }
    });

    router.get('/:id/source-materials/:sourceMaterialId/content', async (req, res, next) => {
        try {
            const gate = requirePrivateSidecarSurface('source_materials');
            if (!gate.ok) {
                return res.status(gate.statusCode).json({
                    error: gate.error,
                    route: gate.route,
                });
            }

            const circleId = parseOptionalPositiveInt(req.params.id);
            const sourceMaterialId = parseOptionalPositiveInt(req.params.sourceMaterialId);
            if (!circleId) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            if (!sourceMaterialId) {
                return res.status(400).json({ error: 'invalid_source_material_id' });
            }

            const { actor } = await requireSourceMaterialActor(req, circleId);
            const material = await (prisma as any).sourceMaterial.findFirst({
                where: { id: sourceMaterialId, circleId },
                select: {
                    id: true,
                    circleId: true,
                    name: true,
                    mimeType: true,
                    lifecycleStatus: true,
                    evidencePrivacyClass: true,
                    storageObjectId: true,
                    rawTextLocator: true,
                    chunks: {
                        select: {
                            chunkIndex: true,
                            text: true,
                            textLocator: true,
                        },
                        orderBy: { chunkIndex: 'asc' },
                    },
                },
            });
            if (!material) {
                return res.status(404).json({ error: 'source_material_not_found' });
            }

            const lifecycleStatus = normalizeSourceMaterialLifecycleStatus(
                material.lifecycleStatus ?? 'accepted_to_plaza',
            );
            if (lifecycleStatus === 'revoked') {
                return res.status(403).json({ error: 'source_material_revoked' });
            }

            const canReview = await canReviewSourceMaterials(actor, circleId);
            if (!isSourceMaterialVisibleToCircleMember({
                lifecycleStatus,
                evidencePrivacyClass: normalizeSourceMaterialPrivacyClass(
                    material.evidencePrivacyClass ?? 'public',
                ),
                canReview,
            })) {
                return res.status(403).json({ error: 'source_material_not_visible' });
            }

            const storageObjectId = typeof material.storageObjectId === 'string'
                ? material.storageObjectId.trim()
                : '';
            if (!storageObjectId) {
                return res.status(409).json({ error: 'source_material_object_missing' });
            }

            const createObjectClient = options?.createStorageFabricObjectClient
                ?? createStorageFabricObjectClientFromRuntime;
            const objectClient = createObjectClient({
                runtimeRole: loadNodeRuntimeConfig().runtimeRole,
            });
            const ownerRef = String(process.env.STORAGE_FABRIC_OBJECT_OWNER_REF || '').trim();
            let result: { bytes: Buffer; contentType: string | null } | null = null;
            let objectReadError: unknown;
            if (objectClient) {
                try {
                    result = await objectClient.readObject({
                        principalRef: ownerRef || actor.pubkey,
                        objectId: storageObjectId,
                    });
                } catch (error) {
                    objectReadError = error;
                }
            }
            if (!result) {
                result = await loadSourceMaterialPlaintextFallback(material);
            }
            if (!result) {
                if (objectReadError instanceof Error && objectReadError.message) {
                    return res.status(400).json({ error: objectReadError.message });
                }
                if (!objectClient) {
                    return res.status(409).json({ error: 'source_material_object_missing' });
                }
                return res.status(400).json({ error: 'storage_fabric_object_read_failed' });
            }

            const filename = String(material.name || 'source-material.txt').replace(/[\r\n"]/g, '_');
            res.set('content-type', result.contentType || material.mimeType || 'text/plain; charset=utf-8');
            res.set('Content-Disposition', `attachment; filename="${filename}"`);
            return res.send(result.bytes);
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof Error && error.message) {
                return res.status(400).json({ error: error.message });
            }
            next(error);
        }
    });

    router.post('/:id/source-materials/:sourceMaterialId/lifecycle', async (req, res, next) => {
        try {
            const gate = requirePrivateSidecarSurface('source_materials');
            if (!gate.ok) {
                return res.status(gate.statusCode).json({
                    error: gate.error,
                    route: gate.route,
                });
            }

            const circleId = parseOptionalPositiveInt(req.params.id);
            const sourceMaterialId = parseOptionalPositiveInt(req.params.sourceMaterialId);
            if (!circleId) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            if (!sourceMaterialId) {
                return res.status(400).json({ error: 'invalid_source_material_id' });
            }

            const { actor, userId } = await requireSourceMaterialActor(req, circleId);
            const isManager = await canReviewSourceMaterials(actor, circleId);

            const material = await (prisma as any).sourceMaterial.findFirst({
                where: {
                    id: sourceMaterialId,
                    circleId,
                },
                select: {
                    id: true,
                    circleId: true,
                    lifecycleStatus: true,
                    originType: true,
                    originRef: true,
                    externalAppId: true,
                    roomKey: true,
                    contentDigest: true,
                    evidencePrivacyClass: true,
                    visibilityScope: true,
                    summaryText: true,
                    provenance: true,
                },
            });
            if (!material) {
                return res.status(404).json({ error: 'source_material_not_found' });
            }

            let currentStatus: SourceMaterialLifecycleStatus;
            let nextStatus: SourceMaterialLifecycleStatus;
            try {
                currentStatus = normalizeSourceMaterialLifecycleStatus(
                    material.lifecycleStatus ?? 'accepted_to_plaza',
                );
                nextStatus = normalizeSourceMaterialLifecycleStatus(req.body?.nextStatus);
            } catch (error) {
                return res.status(400).json({
                    error: error instanceof Error ? error.message : 'invalid_source_material_lifecycle_status',
                });
            }

            const governanceRequestId = parseOptionalString(req.body?.governanceRequestId);
            const transitionShapeAllowed =
                currentStatus !== nextStatus
                && !SOURCE_MATERIAL_TERMINAL_STATUSES.has(currentStatus)
                && SOURCE_MATERIAL_ROUTE_TRANSITIONS[currentStatus].includes(nextStatus);
            const directTransitionAllowed = canTransitionSourceMaterialLifecycle({
                currentStatus,
                nextStatus,
                isManager,
            });
            const mayProposeGovernedAccept =
                nextStatus === 'accepted_to_plaza'
                && transitionShapeAllowed
                && !governanceRequestId;
            const governanceExecutionAllowed =
                Boolean(governanceRequestId)
                && transitionShapeAllowed;

            if (!directTransitionAllowed && !mayProposeGovernedAccept && !governanceExecutionAllowed) {
                return res.status(409).json({
                    error: isManager
                        ? 'source_material_lifecycle_transition_not_allowed'
                        : 'source_material_manager_required',
                    currentStatus,
                    nextStatus,
                });
            }

            if (mayProposeGovernedAccept && !isManager) {
                const canViewMaterialForGovernedAccept = isSourceMaterialVisibleToCircleMember({
                    lifecycleStatus: currentStatus,
                    evidencePrivacyClass: normalizeSourceMaterialPrivacyClass(
                        material.evidencePrivacyClass ?? 'public',
                    ),
                    canReview: false,
                    canViewReviewQueue: true,
                });
                if (!canViewMaterialForGovernedAccept) {
                    return res.status(403).json({ error: 'source_material_access_denied' });
                }
            }

            const rawReviewDecisionDigest = parseOptionalString(req.body?.reviewDecisionDigest);
            const reviewDecisionDigest = rawReviewDecisionDigest
                ? parseOptionalDigest64(rawReviewDecisionDigest)
                : null;
            if (rawReviewDecisionDigest && !reviewDecisionDigest) {
                return res.status(400).json({ error: 'invalid_source_material_review_decision_digest' });
            }
            const actionType = sourceMaterialActionTypeForLifecycleStatus(nextStatus);
            const legacyActionType = legacySourceMaterialActionTypeForLifecycleStatus(nextStatus);
            const governanceCheck = await verifyGovernanceRequestForLifecycle(prisma, {
                governanceRequestId,
                sourceMaterialId,
                actionType,
                legacyActionType,
            });
            if (!governanceCheck.ok) {
                return res.status(governanceCheck.statusCode).json({ error: governanceCheck.error });
            }
            if ((directTransitionAllowed || mayProposeGovernedAccept) && !governanceRequestId && shouldGovernSourceMaterialLifecycle(nextStatus)) {
                const governance = await evaluateSourceMaterialGovernance(prisma, {
                    circleId,
                    sourceMaterialId,
                    actionType,
                    actorPubkey: actor.pubkey,
                    directAllowed: isManager && directTransitionAllowed,
                    payload: {
                        circleId,
                        sourceMaterialId,
                        fromStatus: currentStatus,
                        toStatus: nextStatus,
                        reason: parseOptionalString(req.body?.reason),
                        reviewDecisionDigest,
                        contentDigest: material.contentDigest,
                        originType: material.originType ?? null,
                        externalAppId: material.externalAppId ?? null,
                        roomKey: material.roomKey ?? null,
                    },
                });
                if (governance.status === 'requires_governance') {
                    return res.status(202).json(governance);
                }
                if (governance.status === 'denied' && !directTransitionAllowed) {
                    return res.status(409).json({
                        error: 'source_material_manager_required',
                        currentStatus,
                        nextStatus,
                    });
                }
                if (governance.status === 'denied') {
                    return res.status(403).json({ error: governance.error });
                }
            }

            if (!directTransitionAllowed && !governanceRequestId) {
                return res.status(409).json({
                    error: 'source_material_manager_required',
                    currentStatus,
                    nextStatus,
                });
            }

            const updated = await (prisma as any).sourceMaterial.update({
                where: { id: sourceMaterialId },
                data: {
                    lifecycleStatus: nextStatus,
                    ...(governanceRequestId ? { reviewRequestId: governanceRequestId } : {}),
                    ...(reviewDecisionDigest ? { reviewDecisionDigest } : {}),
                    ...(nextStatus === 'redacted'
                        ? {
                            evidencePrivacyClass: 'redacted',
                            visibilityScope: 'sealed',
                            rawText: null,
                            rawTextLocator: null,
                        }
                        : {}),
                    provenance: buildLifecycleProvenance({
                        existing: material.provenance,
                        fromStatus: currentStatus,
                        toStatus: nextStatus,
                        userId,
                        actorPubkey: parseOptionalString(req.body?.actorPubkey),
                        reason: parseOptionalString(req.body?.reason),
                        governanceRequestId,
                        reviewDecisionDigest,
                    }),
                },
                select: {
                    id: true,
                    circleId: true,
                    name: true,
                    lifecycleStatus: true,
                    originType: true,
                    originRef: true,
                    externalAppId: true,
                    roomKey: true,
                    contentDigest: true,
                    evidencePrivacyClass: true,
                    visibilityScope: true,
                    submittedByPubkey: true,
                    reviewRequestId: true,
                    reviewDecisionDigest: true,
                    provenance: true,
                },
            });

            if (nextStatus === 'redacted' || nextStatus === 'revoked') {
                await withdrawKnowledgePublicationsUsingSourceMaterial({
                    prisma,
                    sourceMaterialId: updated.id,
                });
            }

            let systemNoticeEnvelopeId: string | null = null;
            if (nextStatus === 'accepted_to_plaza') {
                systemNoticeEnvelopeId = await publishSourceMaterialAcceptedSystemNotice(
                    prisma,
                    {
                        circleId,
                        sourceMaterialId: updated.id,
                        originType: updated.originType ?? 'manual_upload',
                        originRef: updated.originRef ?? null,
                        externalAppId: updated.externalAppId ?? null,
                        roomKey: updated.roomKey ?? null,
                        contentDigest: updated.contentDigest,
                        lifecycleStatus: updated.lifecycleStatus,
                        evidencePrivacyClass: updated.evidencePrivacyClass ?? 'public',
                        summaryText: material.summaryText ?? null,
                    },
                    redis,
                );
                try {
                    await markCircleTopicProfileDirty({
                        prisma,
                        redis,
                        circleId,
                        reason: 'source_material_accepted',
                        requestedByUserId: userId,
                    });
                } catch {
                    // best effort only
                }
            }

            return res.json({
                ok: true,
                circleId,
                material: updated,
                systemNoticeEnvelopeId,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            next(error);
        }
    });

    router.post('/:id/source-materials', async (req, res, next) => {
        try {
            const gate = requirePrivateSidecarSurface('source_materials');
            if (!gate.ok) {
                return res.status(gate.statusCode).json({
                    error: gate.error,
                    route: gate.route,
                });
            }

            const circleId = parseOptionalPositiveInt(req.params.id);
            if (!circleId) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }

            const { actor, userId } = await requireSourceMaterialActor(req, circleId);

            const name = parseOptionalString(req.body?.name);
            const content = typeof req.body?.content === 'string' ? req.body.content : '';
            const mimeType = parseOptionalString(req.body?.mimeType);
            const draftPostId = parseOptionalPositiveInt(req.body?.draftPostId);
            const seededSourceNodeId = parseOptionalPositiveInt(req.body?.seededSourceNodeId);
            const discussionThreadId = parseOptionalString(req.body?.discussionThreadId);
            const externalUrlCapture = req.body?.externalUrlCapture === true
                ? {
                    canonicalUrl: parseOptionalString(req.body?.canonicalUrl) ?? '',
                    externalAuthorLabel: parseOptionalString(req.body?.externalAuthorLabel) ?? '',
                    publishedAt: parseOptionalString(req.body?.publishedAt) ?? '',
                }
                : null;
            const recaptureOfSourceMaterialId = parseOptionalPositiveInt(
                req.body?.recaptureOfSourceMaterialId,
            );
            if (req.body?.recaptureOfSourceMaterialId != null && !recaptureOfSourceMaterialId) {
                return res.status(400).json({ error: 'source_material_recapture_id_invalid' });
            }
            if (recaptureOfSourceMaterialId && !externalUrlCapture) {
                return res.status(400).json({ error: 'source_material_recapture_origin_mismatch' });
            }

            if (!name) {
                return res.status(400).json({ error: 'source_material_name_required' });
            }
            if (!content.trim()) {
                return res.status(400).json({ error: 'source_material_content_required' });
            }
            if (!isSupportedTextLikeSourceMaterial({ name, mimeType })) {
                return res.status(415).json({ error: 'source_material_binary_upload_not_supported' });
            }

            const licenseBasis = req.body?.license?.basis === 'external_license'
                ? 'external_license'
                : req.body?.license?.basis === 'self_authored_safe_default'
                    ? 'self_authored_safe_default'
                    : null;
            if (!licenseBasis) {
                return res.status(400).json({ error: 'source_material_license_facts_required' });
            }
            const license = buildSourceMaterialLicenseFacts({
                basis: licenseBasis,
                rightsHolder: parseOptionalString(req.body?.license?.rightsHolder) ?? '',
                licenseRef: parseOptionalString(req.body?.license?.licenseRef),
                licenseVersion: parseOptionalString(req.body?.license?.licenseVersion),
                publicDisplayAuthorized: req.body?.license?.publicDisplayAuthorized === true,
                commercialUseAuthorized: req.body?.license?.commercialUseAuthorized === true,
                nftUseAuthorized: req.body?.license?.nftUseAuthorized === true,
            });

            if (draftPostId) {
                const access = await authorizeDraftActionForActor(prisma, {
                    actor,
                    postId: draftPostId,
                    action: 'edit',
                });
                if (!access.allowed) {
                    return res.status(access.statusCode).json({
                        error: access.error,
                        message: access.message,
                    });
                }
                if (access.post?.circleId !== circleId) {
                    return res.status(409).json({ error: 'source_material_draft_circle_mismatch' });
                }
            }

            const seededNodeValidation = await validateSeededSourceNodeScope(prisma, {
                circleId,
                seededSourceNodeId,
            });
            if (seededNodeValidation.ok === false) {
                return res.status(seededNodeValidation.statusCode).json({
                    error: seededNodeValidation.error,
                });
            }

            const createObjectClient = options?.createStorageFabricObjectClient
                ?? createStorageFabricObjectClientFromRuntime;
            const objectClient = createObjectClient({
                runtimeRole: loadNodeRuntimeConfig().runtimeRole,
            });
            const storageObject = objectClient
                ? await uploadSourceMaterialObject(objectClient, {
                    principalRef: actor.pubkey,
                    circleId,
                    mimeType,
                    content,
                })
                : null;

            const material = await createSourceMaterial(prisma, {
                circleId,
                uploadedByUserId: userId,
                draftPostId,
                discussionThreadId,
                seededSourceNodeId,
                name,
                mimeType,
                content,
                originType: externalUrlCapture ? 'external_url_capture' : 'manual_upload',
                externalUrlCapture,
                recaptureOfSourceMaterialId,
                licenseFacts: license.facts,
                licenseFactsDigest: license.digest,
                licenseAuthorizedByPubkey: actor.pubkey,
                ...(storageObject ? { storageObject } : {}),
            });

            try {
                await markCircleTopicProfileDirty({
                    prisma,
                    redis,
                    circleId,
                    reason: 'source_material_created',
                    requestedByUserId: userId,
                });
            } catch {
                // best effort only
            }

            return res.json({
                ok: true,
                circleId,
                material,
                custody: SOURCE_MATERIAL_PLAINTEXT_CUSTODY,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof Error && error.message) {
                return res.status(400).json({ error: error.message });
            }
            next(error);
        }
    });

    return router;
}

async function loadSourceMaterialPlaintextFallback(material: {
    mimeType?: string | null;
    rawTextLocator?: string | null;
    chunks?: Array<{ text?: string | null; textLocator?: string | null }>;
}): Promise<{ bytes: Buffer; contentType: string | null } | null> {
    const raw = await loadPrivateText(material.rawTextLocator);
    if (raw) {
        return {
            bytes: Buffer.from(raw, 'utf8'),
            contentType: material.mimeType || 'text/plain; charset=utf-8',
        };
    }
    const chunks = Array.isArray(material.chunks) ? material.chunks : [];
    if (chunks.length === 0) {
        return null;
    }
    const parts: string[] = [];
    for (const chunk of chunks) {
        const stored = typeof chunk.text === 'string' && chunk.text.trim() ? chunk.text : null;
        const loaded = stored ?? await loadPrivateText(chunk.textLocator);
        if (loaded == null) {
            return null;
        }
        parts.push(loaded);
    }
    return {
        bytes: Buffer.from(parts.join('\n\n'), 'utf8'),
        contentType: material.mimeType || 'text/plain; charset=utf-8',
    };
}

async function uploadSourceMaterialObject(
    client: StorageFabricObjectClient,
    input: {
        principalRef: string;
        circleId: number;
        mimeType: string | null;
        content: string;
    },
) {
    const uploaded = await client.uploadObject({
        principalRef: input.principalRef,
        mimeType: input.mimeType || 'text/plain',
        bytes: Buffer.from(input.content, 'utf8'),
        idempotencyKey: `source-material:${input.circleId}:${sha256Hex(input.content)}`,
    });
    return {
        objectId: uploaded.objectId,
        receiptId: uploaded.receiptId,
        receiptDigest: uploaded.receiptDigest,
        scopeRef: uploaded.scopeRef,
        tenantId: uploaded.tenantId,
        contentDigest: uploaded.contentDigest,
    };
}
