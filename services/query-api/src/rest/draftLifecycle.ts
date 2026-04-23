import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import {
    authorizeDraftAction,
    parseAuthUserIdFromRequest,
} from '../services/membership/checks';
import {
    advanceDraftLifecycleReview,
    DraftReviewAdvanceConfirmationError,
    archiveDraftLifecycle,
    enterDraftLifecycleCrystallization,
    failDraftLifecycleCrystallization,
    repairDraftLifecycleCrystallizationEvidence,
    retryDraftLifecycleCrystallization,
    restoreDraftLifecycle,
    rollbackDraftLifecycleCrystallizationFailure,
    resolveDraftLifecycleReadModel,
    enterDraftLifecycleReview,
} from '../services/draftLifecycle/readModel';
import {
    verifyArchiveDraftLifecycleAnchor,
    verifyEnterDraftLifecycleCrystallizationAnchor,
    verifyRestoreDraftLifecycleAnchor,
} from '../services/draftLifecycle/anchorVerification';
import {
    DraftWorkflowStateError,
    getPersistedDraftWorkflowState,
} from '../services/draftLifecycle/workflowState';
import { resolveDraftWorkflowPermission } from '../services/policy/draftWorkflowPermissions';

function parsePositiveInt(value: unknown): number | null {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

function parseNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function parsePolicyProfileDigest(value: unknown): string | null {
    const normalized = parseNonEmptyString(value)?.toLowerCase() || null;
    if (!normalized || !/^[a-f0-9]{64}$/.test(normalized)) {
        return null;
    }
    return normalized;
}

function parseBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return normalized === 'true' || normalized === '1';
    }
    if (typeof value === 'number') {
        return value === 1;
    }
    return false;
}

function isAnchorVerificationMisconfigured(reason: string | undefined): boolean {
    return reason === 'content_program_id_unconfigured';
}

export function draftLifecycleRouter(prisma: PrismaClient, _redis: Redis): Router {
    const router = Router();

    router.get('/drafts/:postId', async (req, res, next) => {
        try {
            const draftPostId = parsePositiveInt(req.params.postId);
            if (!draftPostId) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }

            const authUserId = parseAuthUserIdFromRequest(req);
            const access = await authorizeDraftAction(prisma, {
                postId: draftPostId,
                userId: authUserId,
                action: 'read',
            });
            if (!access.allowed) {
                return res.status(access.statusCode).json({
                    error: access.error,
                    message: access.message,
                });
            }

            const lifecycle = await resolveDraftLifecycleReadModel(prisma, { draftPostId });
            return res.status(200).json({
                ok: true,
                draftPostId,
                lifecycle,
            });
        } catch (error) {
            return next(error);
        }
    });

    router.post('/drafts/:postId/enter-review', async (req, res, next) => {
        try {
            const draftPostId = parsePositiveInt(req.params.postId);
            if (!draftPostId) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }

            const authUserId = parseAuthUserIdFromRequest(req);
            const access = await authorizeDraftAction(prisma, {
                postId: draftPostId,
                userId: authUserId,
                action: 'read',
            });
            if (!access.allowed) {
                return res.status(access.statusCode).json({
                    error: access.error,
                    message: access.message,
                });
            }

            const circleId = access.post?.circleId;
            if (!authUserId || !circleId || circleId <= 0) {
                return res.status(409).json({
                    error: 'draft_circle_required',
                    message: 'manual review entry requires a circle-bound draft',
                });
            }

            const permission = await resolveDraftWorkflowPermission(prisma, {
                circleId,
                userId: authUserId,
                action: 'end_drafting_early',
            });
            if (!permission.allowed) {
                return res.status(403).json({
                    error: 'draft_manual_review_permission_denied',
                    message: permission.reason,
                });
            }

            const lifecycle = await enterDraftLifecycleReview(prisma, {
                draftPostId,
                actorUserId: authUserId,
                confirmApplyAcceptedGhostThreads: parseBoolean(req.body?.confirmApplyAcceptedGhostThreads),
            });
            return res.status(200).json({
                ok: true,
                draftPostId,
                lifecycle,
            });
        } catch (error) {
            if (error instanceof DraftReviewAdvanceConfirmationError) {
                return res.status(error.statusCode).json({
                    error: error.code,
                    message: error.message,
                    pendingThreadIds: error.pendingThreadIds,
                    pendingThreadCount: error.pendingThreadCount,
                });
            }
            if (error instanceof DraftWorkflowStateError) {
                return res.status(error.statusCode).json({
                    error: error.code,
                    message: error.message,
                });
            }
            return next(error);
        }
    });

    router.post('/drafts/:postId/advance-review', async (req, res, next) => {
        try {
            const draftPostId = parsePositiveInt(req.params.postId);
            if (!draftPostId) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }

            const authUserId = parseAuthUserIdFromRequest(req);
            const access = await authorizeDraftAction(prisma, {
                postId: draftPostId,
                userId: authUserId,
                action: 'read',
            });
            if (!access.allowed) {
                return res.status(access.statusCode).json({
                    error: access.error,
                    message: access.message,
                });
            }

            const circleId = access.post?.circleId;
            if (!authUserId || !circleId || circleId <= 0) {
                return res.status(409).json({
                    error: 'draft_circle_required',
                    message: 'review advance requires a circle-bound draft',
                });
            }

            const permission = await resolveDraftWorkflowPermission(prisma, {
                circleId,
                userId: authUserId,
                action: 'advance_from_review',
            });
            if (!permission.allowed) {
                return res.status(403).json({
                    error: 'draft_review_advance_permission_denied',
                    message: permission.reason,
                });
            }

            const lifecycle = await advanceDraftLifecycleReview(prisma, {
                draftPostId,
                actorUserId: authUserId,
                confirmApplyAcceptedGhostThreads: parseBoolean(req.body?.confirmApplyAcceptedGhostThreads),
            });
            return res.status(200).json({
                ok: true,
                draftPostId,
                lifecycle,
            });
        } catch (error) {
            if (error instanceof DraftReviewAdvanceConfirmationError) {
                return res.status(error.statusCode).json({
                    error: error.code,
                    message: error.message,
                    pendingThreadIds: error.pendingThreadIds,
                    pendingThreadCount: error.pendingThreadCount,
                });
            }
            if (error instanceof DraftWorkflowStateError) {
                return res.status(error.statusCode).json({
                    error: error.code,
                    message: error.message,
                });
            }
            return next(error);
        }
    });

    router.post('/drafts/:postId/enter-crystallization', async (req, res, next) => {
        try {
            const draftPostId = parsePositiveInt(req.params.postId);
            if (!draftPostId) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }
            const anchorSignature = parseNonEmptyString(req.body?.anchorSignature);
            if (!anchorSignature) {
                return res.status(400).json({
                    error: 'anchor_signature_required',
                    message: 'enter crystallization requires a signed on-chain anchor signature',
                });
            }
            const policyProfileDigest = parsePolicyProfileDigest(req.body?.policyProfileDigest);
            if (!policyProfileDigest) {
                return res.status(400).json({
                    error: 'policy_profile_digest_required',
                    message: 'enter crystallization requires a verified policy profile digest',
                });
            }

            const authUserId = parseAuthUserIdFromRequest(req);
            const access = await authorizeDraftAction(prisma, {
                postId: draftPostId,
                userId: authUserId,
                action: 'read',
            });
            if (!access.allowed) {
                return res.status(access.statusCode).json({
                    error: access.error,
                    message: access.message,
                });
            }

            const circleId = access.post?.circleId;
            if (!authUserId || !circleId || circleId <= 0) {
                return res.status(409).json({
                    error: 'draft_circle_required',
                    message: 'enter crystallization requires a circle-bound draft',
                });
            }

            const permission = await resolveDraftWorkflowPermission(prisma, {
                circleId,
                userId: authUserId,
                action: 'enter_crystallization',
            });
            if (!permission.allowed) {
                return res.status(403).json({
                    error: 'draft_enter_crystallization_permission_denied',
                    message: permission.reason,
                });
            }
            const actor = await prisma.user.findUnique({
                where: { id: authUserId },
                select: { pubkey: true },
            });
            const workflowState = await getPersistedDraftWorkflowState(prisma, draftPostId);
            const anchorCheck = await verifyEnterDraftLifecycleCrystallizationAnchor({
                actorPubkey: actor?.pubkey || '',
                anchorSignature,
                draftPostId,
                policyProfileDigest,
                minimumAcceptedAt: workflowState?.lastTransitionAt || null,
                reusedAnchorSignature: workflowState?.crystallizationAnchorSignature || null,
            });
            if (!anchorCheck.ok) {
                const misconfigured = isAnchorVerificationMisconfigured(anchorCheck.reason);
                return res.status(misconfigured ? 500 : 422).json({
                    error: misconfigured ? 'anchor_verification_misconfigured' : 'anchor_signature_unverified',
                    reason: anchorCheck.reason || 'anchor_unverified',
                });
            }

            const lifecycle = await enterDraftLifecycleCrystallization(prisma, {
                draftPostId,
                actorUserId: authUserId,
                anchorSignature,
                policyProfileDigest,
            });
            return res.status(200).json({
                ok: true,
                draftPostId,
                anchorSignature,
                lifecycle,
            });
        } catch (error) {
            if (error instanceof DraftWorkflowStateError) {
                return res.status(error.statusCode).json({
                    error: error.code,
                    message: error.message,
                });
            }
            return next(error);
        }
    });

    router.post('/drafts/:postId/fail-crystallization', async (req, res, next) => {
        try {
            const draftPostId = parsePositiveInt(req.params.postId);
            if (!draftPostId) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }

            const authUserId = parseAuthUserIdFromRequest(req);
            const access = await authorizeDraftAction(prisma, {
                postId: draftPostId,
                userId: authUserId,
                action: 'read',
            });
            if (!access.allowed) {
                return res.status(access.statusCode).json({
                    error: access.error,
                    message: access.message,
                });
            }

            const circleId = access.post?.circleId;
            if (!authUserId || !circleId || circleId <= 0) {
                return res.status(409).json({
                    error: 'draft_circle_required',
                    message: 'fail crystallization requires a circle-bound draft',
                });
            }

            const permission = await resolveDraftWorkflowPermission(prisma, {
                circleId,
                userId: authUserId,
                action: 'enter_crystallization',
            });
            if (!permission.allowed) {
                return res.status(403).json({
                    error: 'draft_fail_crystallization_permission_denied',
                    message: permission.reason,
                });
            }

            const lifecycle = await failDraftLifecycleCrystallization(prisma, {
                draftPostId,
                actorUserId: authUserId,
            });
            return res.status(200).json({
                ok: true,
                draftPostId,
                lifecycle,
            });
        } catch (error) {
            if (error instanceof DraftWorkflowStateError) {
                return res.status(error.statusCode).json({
                    error: error.code,
                    message: error.message,
                });
            }
            return next(error);
        }
    });

    router.post('/drafts/:postId/retry-crystallization', async (req, res, next) => {
        try {
            const draftPostId = parsePositiveInt(req.params.postId);
            if (!draftPostId) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }
            const anchorSignature = parseNonEmptyString(req.body?.anchorSignature);
            if (!anchorSignature) {
                return res.status(400).json({
                    error: 'anchor_signature_required',
                    message: 'retry crystallization requires a signed on-chain anchor signature',
                });
            }
            const policyProfileDigest = parsePolicyProfileDigest(req.body?.policyProfileDigest);
            if (!policyProfileDigest) {
                return res.status(400).json({
                    error: 'policy_profile_digest_required',
                    message: 'retry crystallization requires a verified policy profile digest',
                });
            }

            const authUserId = parseAuthUserIdFromRequest(req);
            const access = await authorizeDraftAction(prisma, {
                postId: draftPostId,
                userId: authUserId,
                action: 'read',
            });
            if (!access.allowed) {
                return res.status(access.statusCode).json({
                    error: access.error,
                    message: access.message,
                });
            }

            const circleId = access.post?.circleId;
            if (!authUserId || !circleId || circleId <= 0) {
                return res.status(409).json({
                    error: 'draft_circle_required',
                    message: 'retry crystallization requires a circle-bound draft',
                });
            }

            const permission = await resolveDraftWorkflowPermission(prisma, {
                circleId,
                userId: authUserId,
                action: 'enter_crystallization',
            });
            if (!permission.allowed) {
                return res.status(403).json({
                    error: 'draft_retry_crystallization_permission_denied',
                    message: permission.reason,
                });
            }
            const actor = await prisma.user.findUnique({
                where: { id: authUserId },
                select: { pubkey: true },
            });
            const workflowState = await getPersistedDraftWorkflowState(prisma, draftPostId);
            const anchorCheck = await verifyEnterDraftLifecycleCrystallizationAnchor({
                actorPubkey: actor?.pubkey || '',
                anchorSignature,
                draftPostId,
                policyProfileDigest,
                minimumAcceptedAt: workflowState?.lastTransitionAt || null,
                reusedAnchorSignature: workflowState?.crystallizationAnchorSignature || null,
            });
            if (!anchorCheck.ok) {
                const misconfigured = isAnchorVerificationMisconfigured(anchorCheck.reason);
                return res.status(misconfigured ? 500 : 422).json({
                    error: misconfigured ? 'anchor_verification_misconfigured' : 'anchor_signature_unverified',
                    reason: anchorCheck.reason || 'anchor_unverified',
                });
            }

            const lifecycle = await retryDraftLifecycleCrystallization(prisma, {
                draftPostId,
                actorUserId: authUserId,
                anchorSignature,
                policyProfileDigest,
            });
            return res.status(200).json({
                ok: true,
                draftPostId,
                anchorSignature,
                lifecycle,
            });
        } catch (error) {
            if (error instanceof DraftWorkflowStateError) {
                return res.status(error.statusCode).json({
                    error: error.code,
                    message: error.message,
                });
            }
            return next(error);
        }
    });

    router.post('/drafts/:postId/repair-crystallization-evidence', async (req, res, next) => {
        try {
            const draftPostId = parsePositiveInt(req.params.postId);
            if (!draftPostId) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }

            const authUserId = parseAuthUserIdFromRequest(req);
            const access = await authorizeDraftAction(prisma, {
                postId: draftPostId,
                userId: authUserId,
                action: 'read',
            });
            if (!access.allowed) {
                return res.status(access.statusCode).json({
                    error: access.error,
                    message: access.message,
                });
            }

            const circleId = access.post?.circleId;
            if (!authUserId || !circleId || circleId <= 0) {
                return res.status(409).json({
                    error: 'draft_circle_required',
                    message: 'repairing crystallization evidence requires a circle-bound draft',
                });
            }

            const permission = await resolveDraftWorkflowPermission(prisma, {
                circleId,
                userId: authUserId,
                action: 'enter_crystallization',
            });
            if (!permission.allowed) {
                return res.status(403).json({
                    error: 'draft_repair_crystallization_evidence_permission_denied',
                    message: permission.reason,
                });
            }

            const lifecycle = await repairDraftLifecycleCrystallizationEvidence(prisma, {
                draftPostId,
                actorUserId: authUserId,
            });
            return res.status(200).json({
                ok: true,
                draftPostId,
                lifecycle,
            });
        } catch (error) {
            if (error instanceof DraftWorkflowStateError) {
                return res.status(error.statusCode).json({
                    error: error.code,
                    message: error.message,
                });
            }
            return next(error);
        }
    });

    router.post('/drafts/:postId/rollback-crystallization', async (req, res, next) => {
        try {
            const draftPostId = parsePositiveInt(req.params.postId);
            if (!draftPostId) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }

            const authUserId = parseAuthUserIdFromRequest(req);
            const access = await authorizeDraftAction(prisma, {
                postId: draftPostId,
                userId: authUserId,
                action: 'read',
            });
            if (!access.allowed) {
                return res.status(access.statusCode).json({
                    error: access.error,
                    message: access.message,
                });
            }

            const circleId = access.post?.circleId;
            if (!authUserId || !circleId || circleId <= 0) {
                return res.status(409).json({
                    error: 'draft_circle_required',
                    message: 'rollback crystallization requires a circle-bound draft',
                });
            }

            const permission = await resolveDraftWorkflowPermission(prisma, {
                circleId,
                userId: authUserId,
                action: 'advance_from_review',
            });
            if (!permission.allowed) {
                return res.status(403).json({
                    error: 'draft_rollback_crystallization_permission_denied',
                    message: permission.reason,
                });
            }

            const lifecycle = await rollbackDraftLifecycleCrystallizationFailure(prisma, {
                draftPostId,
                actorUserId: authUserId,
            });
            return res.status(200).json({
                ok: true,
                draftPostId,
                lifecycle,
            });
        } catch (error) {
            if (error instanceof DraftWorkflowStateError) {
                return res.status(error.statusCode).json({
                    error: error.code,
                    message: error.message,
                });
            }
            return next(error);
        }
    });

    router.post('/drafts/:postId/archive', async (req, res, next) => {
        try {
            const draftPostId = parsePositiveInt(req.params.postId);
            if (!draftPostId) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }
            const anchorSignature = parseNonEmptyString(req.body?.anchorSignature);
            if (!anchorSignature) {
                return res.status(400).json({
                    error: 'anchor_signature_required',
                    message: 'archive requires a signed on-chain anchor signature',
                });
            }
            const policyProfileDigest = parsePolicyProfileDigest(req.body?.policyProfileDigest);
            if (!policyProfileDigest) {
                return res.status(400).json({
                    error: 'policy_profile_digest_required',
                    message: 'archive requires a verified policy profile digest',
                });
            }

            const authUserId = parseAuthUserIdFromRequest(req);
            const access = await authorizeDraftAction(prisma, {
                postId: draftPostId,
                userId: authUserId,
                action: 'read',
            });
            if (!access.allowed) {
                return res.status(access.statusCode).json({
                    error: access.error,
                    message: access.message,
                });
            }

            const circleId = access.post?.circleId;
            if (!authUserId || !circleId || circleId <= 0) {
                return res.status(409).json({
                    error: 'draft_circle_required',
                    message: 'archive requires a circle-bound draft',
                });
            }

            const permission = await resolveDraftWorkflowPermission(prisma, {
                circleId,
                userId: authUserId,
                action: 'advance_from_review',
            });
            if (!permission.allowed) {
                return res.status(403).json({
                    error: 'draft_archive_permission_denied',
                    message: permission.reason,
                });
            }
            const actor = await prisma.user.findUnique({
                where: { id: authUserId },
                select: { pubkey: true },
            });
            const workflowState = await getPersistedDraftWorkflowState(prisma, draftPostId);
            const anchorCheck = await verifyArchiveDraftLifecycleAnchor({
                actorPubkey: actor?.pubkey || '',
                anchorSignature,
                draftPostId,
                policyProfileDigest,
                minimumAcceptedAt: workflowState?.lastTransitionAt || null,
            });
            if (!anchorCheck.ok) {
                const misconfigured = isAnchorVerificationMisconfigured(anchorCheck.reason);
                return res.status(misconfigured ? 500 : 422).json({
                    error: misconfigured ? 'anchor_verification_misconfigured' : 'anchor_signature_unverified',
                    reason: anchorCheck.reason || 'anchor_unverified',
                });
            }

            const lifecycle = await archiveDraftLifecycle(prisma, {
                draftPostId,
                actorUserId: authUserId,
                anchorSignature,
            });
            return res.status(200).json({
                ok: true,
                draftPostId,
                anchorSignature,
                lifecycle,
            });
        } catch (error) {
            if (error instanceof DraftWorkflowStateError) {
                return res.status(error.statusCode).json({
                    error: error.code,
                    message: error.message,
                });
            }
            if (error instanceof Error && error.message === 'draft_lifecycle_anchor_signature_required') {
                return res.status(400).json({
                    error: 'anchor_signature_required',
                    message: 'archive requires a signed on-chain anchor signature',
                });
            }
            return next(error);
        }
    });

    router.post('/drafts/:postId/restore', async (req, res, next) => {
        try {
            const draftPostId = parsePositiveInt(req.params.postId);
            if (!draftPostId) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }
            const anchorSignature = parseNonEmptyString(req.body?.anchorSignature);
            if (!anchorSignature) {
                return res.status(400).json({
                    error: 'anchor_signature_required',
                    message: 'restore requires a signed on-chain anchor signature',
                });
            }
            const policyProfileDigest = parsePolicyProfileDigest(req.body?.policyProfileDigest);
            if (!policyProfileDigest) {
                return res.status(400).json({
                    error: 'policy_profile_digest_required',
                    message: 'restore requires a verified policy profile digest',
                });
            }

            const authUserId = parseAuthUserIdFromRequest(req);
            const access = await authorizeDraftAction(prisma, {
                postId: draftPostId,
                userId: authUserId,
                action: 'read',
            });
            if (!access.allowed) {
                return res.status(access.statusCode).json({
                    error: access.error,
                    message: access.message,
                });
            }

            const circleId = access.post?.circleId;
            if (!authUserId || !circleId || circleId <= 0) {
                return res.status(409).json({
                    error: 'draft_circle_required',
                    message: 'restore requires a circle-bound draft',
                });
            }

            const permission = await resolveDraftWorkflowPermission(prisma, {
                circleId,
                userId: authUserId,
                action: 'advance_from_review',
            });
            if (!permission.allowed) {
                return res.status(403).json({
                    error: 'draft_restore_permission_denied',
                    message: permission.reason,
                });
            }
            const actor = await prisma.user.findUnique({
                where: { id: authUserId },
                select: { pubkey: true },
            });
            const workflowState = await getPersistedDraftWorkflowState(prisma, draftPostId);
            const anchorCheck = await verifyRestoreDraftLifecycleAnchor({
                actorPubkey: actor?.pubkey || '',
                anchorSignature,
                draftPostId,
                policyProfileDigest,
                minimumAcceptedAt: workflowState?.lastTransitionAt || null,
            });
            if (!anchorCheck.ok) {
                const misconfigured = isAnchorVerificationMisconfigured(anchorCheck.reason);
                return res.status(misconfigured ? 500 : 422).json({
                    error: misconfigured ? 'anchor_verification_misconfigured' : 'anchor_signature_unverified',
                    reason: anchorCheck.reason || 'anchor_unverified',
                });
            }

            const lifecycle = await restoreDraftLifecycle(prisma, {
                draftPostId,
                actorUserId: authUserId,
                anchorSignature,
            });
            return res.status(200).json({
                ok: true,
                draftPostId,
                anchorSignature,
                lifecycle,
            });
        } catch (error) {
            if (error instanceof DraftWorkflowStateError) {
                return res.status(error.statusCode).json({
                    error: error.code,
                    message: error.message,
                });
            }
            if (error instanceof Error && error.message === 'draft_lifecycle_anchor_signature_required') {
                return res.status(400).json({
                    error: 'anchor_signature_required',
                    message: 'restore requires a signed on-chain anchor signature',
                });
            }
            return next(error);
        }
    });

    return router;
}
