import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import { requirePrivateSidecarSurface } from '../config/services';
import {
    requireAuthenticatedActor,
    requireCircleActorForAuthActor,
} from '../services/auth/actor';
import {
    authorizeDraftActionForActor,
    requireSourceMaterialAccessForActor,
    sendAuthActorError,
} from '../services/auth/actorPermissions';
import {
    getEvaluationArtifact,
    listEvaluationArtifacts,
    publishEvaluationArtifact,
    retractEvaluationArtifact,
    serializeEvaluationArtifact,
    submitEvaluationAppeal,
    submitEvaluationReview,
} from '../services/aiOperatingLayer/evaluation/artifacts';
import { queueNeutralEvaluation } from '../services/aiOperatingLayer/evaluation/queue';
import type { NeutralEvaluationSubjectType } from '../services/aiOperatingLayer/evaluation/types';

function parsePositiveInt(value: unknown): number | null {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

function normalizeSubjectType(value: unknown): NeutralEvaluationSubjectType | null {
    if (value === 'post' || value === 'draft_post' || value === 'source_material') return value;
    return null;
}

function normalizeLimit(value: unknown): number {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 20;
    return Math.min(50, parsed);
}

function getErrorStatus(error: unknown): number | null {
    const statusCode = Number((error as any)?.statusCode ?? 0);
    return Number.isFinite(statusCode) && statusCode >= 400 ? statusCode : null;
}

function sendKnownEvaluationError(res: any, error: unknown): boolean {
    const statusCode = getErrorStatus(error);
    if (!statusCode) return false;
    res.status(statusCode).json({
        error: error instanceof Error ? error.message : 'neutral_evaluation_error',
        route: (error as any)?.route,
    });
    return true;
}

function canReadArtifact(artifact: any, actorUserId: number): boolean {
    if (artifact.visibility === 'public') return true;
    return Number(artifact.requestedByUserId ?? 0) === actorUserId
        || Number(artifact.authorUserId ?? 0) === actorUserId;
}

function canWriteArtifactLifecycle(artifact: any, actorUserId: number): boolean {
    return Number(artifact.requestedByUserId ?? 0) === actorUserId
        || Number(artifact.authorUserId ?? 0) === actorUserId;
}

function requireArtifactLifecycleWriter(artifact: any, actorUserId: number): void {
    if (canWriteArtifactLifecycle(artifact, actorUserId)) return;
    const error = new Error('evaluation_artifact_lifecycle_denied') as Error & { statusCode?: number };
    error.statusCode = 403;
    throw error;
}

function privateEvaluationSurfaceForSubject(subjectType: unknown): 'ghost_draft_private' | 'source_materials' | null {
    if (subjectType === 'draft_post') return 'ghost_draft_private';
    if (subjectType === 'source_material') return 'source_materials';
    return null;
}

function assertPrivateEvaluationSubjectSurface(subjectType: unknown): void {
    const surface = privateEvaluationSurfaceForSubject(subjectType);
    if (!surface) return;
    const sidecar = requirePrivateSidecarSurface(surface);
    if (sidecar.ok) return;
    const error = new Error(sidecar.error) as Error & { statusCode?: number; route?: string; code?: string };
    error.statusCode = sidecar.statusCode;
    error.route = sidecar.route;
    error.code = sidecar.error;
    throw error;
}

function assertPrivateEvaluationListSurface(subjectType: unknown): void {
    if (subjectType === 'post') return;
    const surface = privateEvaluationSurfaceForSubject(subjectType) ?? 'ghost_draft_private';
    const sidecar = requirePrivateSidecarSurface(surface);
    if (sidecar.ok) return;
    const error = new Error(sidecar.error) as Error & { statusCode?: number; route?: string; code?: string };
    error.statusCode = sidecar.statusCode;
    error.route = sidecar.route;
    error.code = sidecar.error;
    throw error;
}

async function loadAuthorizedArtifact(
    prisma: PrismaClient,
    actor: any,
    artifactId: string,
): Promise<any> {
    const artifact = await getEvaluationArtifact(prisma as any, artifactId);
    if (!artifact) {
        const error = new Error('evaluation_artifact_not_found') as Error & { statusCode?: number };
        error.statusCode = 404;
        throw error;
    }
    assertPrivateEvaluationSubjectSurface(artifact.subjectType);
    await requireCircleActorForAuthActor(actor, prisma as any, {
        circleId: Number(artifact.circleId),
        action: 'circle.read',
    });
    if (!canReadArtifact(artifact, Number(actor.userId))) {
        const error = new Error('evaluation_artifact_private') as Error & { statusCode?: number };
        error.statusCode = 403;
        throw error;
    }
    return artifact;
}

async function authorizeSubject(
    prisma: PrismaClient,
    actor: any,
    input: {
        circleId: number;
        subjectType: NeutralEvaluationSubjectType;
        subjectId: string;
    },
): Promise<{ authorUserId: number | null }> {
    await requireCircleActorForAuthActor(actor, prisma as any, {
        circleId: input.circleId,
        action: 'circle.read',
    });

    if (input.subjectType === 'draft_post') {
        const postId = parsePositiveInt(input.subjectId);
        if (!postId) {
            const error = new Error('invalid_draft_post_id') as Error & { statusCode?: number };
            error.statusCode = 400;
            throw error;
        }
        const access = await authorizeDraftActionForActor(prisma as any, {
            actor,
            postId,
            action: 'read',
        });
        if (!access.allowed) {
            const error = new Error(access.error || 'draft_read_denied') as Error & { statusCode?: number };
            error.statusCode = access.statusCode;
            throw error;
        }
        if (access.post?.circleId && Number(access.post.circleId) !== input.circleId) {
            const error = new Error('draft_not_found') as Error & { statusCode?: number };
            error.statusCode = 404;
            throw error;
        }
        const sidecar = requirePrivateSidecarSurface('ghost_draft_private');
        if (!sidecar.ok) {
            const error = new Error(sidecar.error) as Error & { statusCode?: number; route?: string };
            error.statusCode = sidecar.statusCode;
            error.route = sidecar.route;
            throw error;
        }
        return {
            authorUserId: Number(access.post?.authorId ?? 0) || null,
        };
    }

    if (input.subjectType === 'source_material') {
        const materialId = parsePositiveInt(input.subjectId);
        if (!materialId) {
            const error = new Error('invalid_source_material_id') as Error & { statusCode?: number };
            error.statusCode = 400;
            throw error;
        }
        const sidecar = requirePrivateSidecarSurface('source_materials');
        if (!sidecar.ok) {
            const error = new Error(sidecar.error) as Error & { statusCode?: number; route?: string };
            error.statusCode = sidecar.statusCode;
            error.route = sidecar.route;
            throw error;
        }
        await requireSourceMaterialAccessForActor(prisma as any, {
            actor,
            circleId: input.circleId,
        });
    }

    return { authorUserId: null };
}

export function neutralEvaluationRouter(prisma: PrismaClient, _redis: Redis): Router {
    const router = Router();

    router.post('/evaluations', async (req, res, next) => {
        try {
            const actor = await requireAuthenticatedActor(req, prisma as any, {
                requireSessionCookie: true,
            });
            const circleId = parsePositiveInt(req.body?.circleId);
            const subjectType = normalizeSubjectType(req.body?.subjectType);
            const subjectId = String(req.body?.subjectId ?? '').trim();
            if (!circleId) return res.status(400).json({ error: 'invalid_circle_id' });
            if (!subjectType) return res.status(400).json({ error: 'invalid_subject_type' });
            if (!subjectId) return res.status(400).json({ error: 'invalid_subject_id' });

            const authorized = await authorizeSubject(prisma, actor, {
                circleId,
                subjectType,
                subjectId,
            });
            const queued = await queueNeutralEvaluation(prisma as any, {
                circleId,
                subjectType,
                subjectId,
                authorUserId: authorized.authorUserId,
                requestedByUserId: actor.userId,
                locale: req.body?.locale,
            });
            if (queued.status === 'blocked_transcript_review') {
                return res.status(409).json(queued);
            }
            if (queued.status === 'no_source') {
                return res.status(200).json(queued);
            }
            return res.status(202).json(queued);
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (sendKnownEvaluationError(res, error)) return;
            return next(error);
        }
    });

    router.get('/evaluations', async (req, res, next) => {
        try {
            const actor = await requireAuthenticatedActor(req, prisma as any, {
                requireSessionCookie: true,
            });
            const circleId = parsePositiveInt(req.query.circleId);
            if (!circleId) return res.status(400).json({ error: 'invalid_circle_id' });
            await requireCircleActorForAuthActor(actor, prisma as any, {
                circleId,
                action: 'circle.read',
            });
            const subjectType = normalizeSubjectType(req.query.subjectType);
            const subjectId = typeof req.query.subjectId === 'string'
                ? req.query.subjectId.trim()
                : null;
            assertPrivateEvaluationListSurface(subjectType);
            const rows = await listEvaluationArtifacts(prisma as any, {
                circleId,
                subjectType,
                subjectId,
                actorUserId: actor.userId,
                limit: normalizeLimit(req.query.limit),
            });
            return res.status(200).json({
                ok: true,
                artifacts: rows.map(serializeEvaluationArtifact),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (sendKnownEvaluationError(res, error)) return;
            return next(error);
        }
    });

    router.get('/evaluations/:artifactId', async (req, res, next) => {
        try {
            const actor = await requireAuthenticatedActor(req, prisma as any, {
                requireSessionCookie: true,
            });
            const artifact = await loadAuthorizedArtifact(prisma, actor, String(req.params.artifactId || ''));
            return res.status(200).json({
                ok: true,
                artifact: serializeEvaluationArtifact(artifact),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (sendKnownEvaluationError(res, error)) return;
            return next(error);
        }
    });

    router.post('/evaluations/:artifactId/publish', async (req, res, next) => {
        try {
            const actor = await requireAuthenticatedActor(req, prisma as any, {
                requireSessionCookie: true,
            });
            const current = await loadAuthorizedArtifact(prisma, actor, String(req.params.artifactId || ''));
            requireArtifactLifecycleWriter(current, Number(actor.userId));
            const artifact = await publishEvaluationArtifact(prisma as any, {
                artifactId: String(req.params.artifactId || ''),
                actorUserId: actor.userId,
                confirmationText: req.body?.confirmationText,
            });
            return res.status(200).json({
                ok: true,
                artifact: serializeEvaluationArtifact(artifact),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (sendKnownEvaluationError(res, error)) return;
            return next(error);
        }
    });

    router.post('/evaluations/:artifactId/retract', async (req, res, next) => {
        try {
            const actor = await requireAuthenticatedActor(req, prisma as any, {
                requireSessionCookie: true,
            });
            const current = await loadAuthorizedArtifact(prisma, actor, String(req.params.artifactId || ''));
            requireArtifactLifecycleWriter(current, Number(actor.userId));
            const artifact = await retractEvaluationArtifact(prisma as any, {
                artifactId: String(req.params.artifactId || ''),
                actorUserId: actor.userId,
                reason: req.body?.reason,
            });
            return res.status(200).json({
                ok: true,
                artifact: serializeEvaluationArtifact(artifact),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (sendKnownEvaluationError(res, error)) return;
            return next(error);
        }
    });

    router.post('/evaluations/:artifactId/appeals', async (req, res, next) => {
        try {
            const actor = await requireAuthenticatedActor(req, prisma as any, {
                requireSessionCookie: true,
            });
            await loadAuthorizedArtifact(prisma, actor, String(req.params.artifactId || ''));
            const appeal = await submitEvaluationAppeal(prisma as any, {
                artifactId: String(req.params.artifactId || ''),
                actorUserId: actor.userId,
                appealText: req.body?.appealText,
            });
            return res.status(200).json({
                ok: true,
                appeal,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (sendKnownEvaluationError(res, error)) return;
            return next(error);
        }
    });

    router.post('/evaluations/:artifactId/reviews', async (req, res, next) => {
        try {
            const actor = await requireAuthenticatedActor(req, prisma as any, {
                requireSessionCookie: true,
            });
            const current = await loadAuthorizedArtifact(prisma, actor, String(req.params.artifactId || ''));
            requireArtifactLifecycleWriter(current, Number(actor.userId));
            const review = await submitEvaluationReview(prisma as any, {
                artifactId: String(req.params.artifactId || ''),
                actorUserId: actor.userId,
                reviewStatus: req.body?.reviewStatus,
                note: req.body?.note,
            });
            return res.status(200).json({
                ok: true,
                review,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (sendKnownEvaluationError(res, error)) return;
            return next(error);
        }
    });

    return router;
}
