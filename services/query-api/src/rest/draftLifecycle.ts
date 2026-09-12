import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import { requireAuthenticatedActor } from '../services/auth/actor';
import {
    authorizeDraftActionForActor,
    sendAuthActorError,
} from '../services/auth/actorPermissions';
import {
    advanceDraftLifecycleReview,
    DraftReviewAdvanceConfirmationError,
    archiveDraftLifecycle,
    enterDraftLifecycleCrystallization,
    failDraftLifecycleCrystallization,
    repairDraftLifecycleCrystallizationEvidence,
    retryDraftLifecycleCrystallization,
    routeDraftLifecycleToGovernanceCase,
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
import {
    localizeDraftWorkflowPermissionDecision,
    resolveDraftWorkflowPermission,
} from '../services/policy/draftWorkflowPermissions';
import { resolveExpressRequestLocale } from '../i18n/request';
import { GovernanceCaseWorkflowError } from '../services/governance/governanceCaseWorkflow';
import {
    isRevisionDirectionAcceptActionType,
    type RevisionDirectionAcceptActionType,
} from '../services/governance/actionRegistry';
import {
    matchesGovernedCaseRoutingReplay,
} from '../services/draftLifecycle/versionSnapshots';

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

function parseOrdinaryRoutingConfirmation(value: unknown): {
    path: 'ordinary_knowledge';
    actionIntent: 'none';
    humanConfirmed: true;
} | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (
        record.path !== 'ordinary_knowledge'
        || record.actionIntent !== null
        || record.humanConfirmed !== true
    ) return null;
    return {
        path: 'ordinary_knowledge',
        actionIntent: 'none',
        humanConfirmed: true,
    };
}

function parseGovernedCaseRoutingConfirmation(value: unknown): {
    path: 'governed_case';
    actionIntent: {
        actionType: RevisionDirectionAcceptActionType;
        targetType: 'revision_direction';
        targetRef: string;
        requestId: string;
        requestedEffect: 'accept_revision_direction';
        collectiveCommitmentRequired: true;
    };
    humanConfirmed: true;
} | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const actionIntent = record.actionIntent;
    if (!actionIntent || typeof actionIntent !== 'object' || Array.isArray(actionIntent)) return null;
    const intent = actionIntent as Record<string, unknown>;
    const targetRef = parseNonEmptyString(intent.targetRef);
    const requestId = parseNonEmptyString(intent.requestId);
    const actionType = intent.actionType;
    if (
        record.path !== 'governed_case'
        || record.humanConfirmed !== true
        || !isRevisionDirectionAcceptActionType(actionType)
        || intent.targetType !== 'revision_direction'
        || intent.requestedEffect !== 'accept_revision_direction'
        || intent.collectiveCommitmentRequired !== true
        || !targetRef
        || !requestId
    ) return null;
    return {
        path: 'governed_case',
        actionIntent: {
            actionType,
            targetType: 'revision_direction',
            targetRef,
            requestId,
            requestedEffect: 'accept_revision_direction',
            collectiveCommitmentRequired: true,
        },
        humanConfirmed: true,
    };
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
    return reason === 'content_program_id_unconfigured'
        || reason === 'rpc_url_unconfigured';
}

export function draftLifecycleRouter(prisma: PrismaClient, _redis: Redis): Router {
    const router = Router();

    async function resolveDraftAccessFromRequest(
        req: any,
        postId: number,
        action: 'read' | 'comment' | 'edit',
    ) {
        const actor = await requireAuthenticatedActor(req, prisma, { requireSessionCookie: true });
        const access = await authorizeDraftActionForActor(prisma, {
            actor,
            postId,
            action,
        });
        return {
            actor,
            authUserId: actor.userId,
            access,
        };
    }

    function sendDraftAccessDenied(res: any, access: { statusCode: number; error: string; message: string }) {
        return res.status(access.statusCode).json({
            error: access.error,
            message: access.message,
        });
    }

    router.get('/drafts/:postId', async (req, res, next) => {
        try {
            const draftPostId = parsePositiveInt(req.params.postId);
            if (!draftPostId) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }

            const { access } = await resolveDraftAccessFromRequest(req, draftPostId, 'read');
            if (!access.allowed) {
                return sendDraftAccessDenied(res, access);
            }

            const lifecycle = await resolveDraftLifecycleReadModel(prisma, { draftPostId });
            return res.status(200).json({
                ok: true,
                draftPostId,
                lifecycle,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return next(error);
        }
    });

    router.post('/drafts/:postId/enter-review', async (req, res, next) => {
        try {
            const draftPostId = parsePositiveInt(req.params.postId);
            if (!draftPostId) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }

            const { authUserId, access } = await resolveDraftAccessFromRequest(req, draftPostId, 'read');
            if (!access.allowed) {
                return sendDraftAccessDenied(res, access);
            }

            const circleId = access.post?.circleId;
            if (!authUserId || !circleId || circleId <= 0 || !access.circleActor) {
                return res.status(409).json({
                    error: 'draft_circle_required',
                    message: 'manual review entry requires a circle-bound draft',
                });
            }

            const permission = await resolveDraftWorkflowPermission(prisma, {
                circleId,
                actor: access.circleActor,
                action: 'end_drafting_early',
            });
            if (!permission.allowed) {
                return res.status(403).json({
                    error: 'draft_manual_review_permission_denied',
                    message: localizeDraftWorkflowPermissionDecision(permission, resolveExpressRequestLocale(req)),
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
            if (sendAuthActorError(res, error)) return;
            return next(error);
        }
    });

    router.post('/drafts/:postId/advance-review', async (req, res, next) => {
        try {
            const draftPostId = parsePositiveInt(req.params.postId);
            if (!draftPostId) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }

            const { authUserId, access } = await resolveDraftAccessFromRequest(req, draftPostId, 'read');
            if (!access.allowed) {
                return sendDraftAccessDenied(res, access);
            }

            const circleId = access.post?.circleId;
            if (!authUserId || !circleId || circleId <= 0 || !access.circleActor) {
                return res.status(409).json({
                    error: 'draft_circle_required',
                    message: 'review advance requires a circle-bound draft',
                });
            }

            const permission = await resolveDraftWorkflowPermission(prisma, {
                circleId,
                actor: access.circleActor,
                action: 'advance_from_review',
            });
            if (!permission.allowed) {
                return res.status(403).json({
                    error: 'draft_review_advance_permission_denied',
                    message: localizeDraftWorkflowPermissionDecision(permission, resolveExpressRequestLocale(req)),
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
            if (sendAuthActorError(res, error)) return;
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
            const ordinaryRoutingConfirmation = parseOrdinaryRoutingConfirmation(req.body?.routingConfirmation);
            const governedRoutingConfirmation = parseGovernedCaseRoutingConfirmation(req.body?.routingConfirmation);
            if (!ordinaryRoutingConfirmation && !governedRoutingConfirmation) {
                const submittedRouting = req.body?.routingConfirmation;
                if (
                    submittedRouting
                    && typeof submittedRouting === 'object'
                    && !Array.isArray(submittedRouting)
                    && submittedRouting.path === 'ordinary_knowledge'
                    && submittedRouting.actionIntent !== null
                    && submittedRouting.actionIntent !== undefined
                ) {
                    return res.status(409).json({
                        error: 'structured_action_intent_requires_governed_routing',
                        message: 'structured action intent cannot use ordinary Knowledge publication',
                    });
                }
                return res.status(400).json({
                    error: 'crystallization_routing_confirmation_required',
                    message: 'confirm either ordinary Knowledge or a registered governed action path',
                });
            }

            const { actor, authUserId, access } = await resolveDraftAccessFromRequest(req, draftPostId, 'read');
            if (!access.allowed) {
                return sendDraftAccessDenied(res, access);
            }

            const circleId = access.post?.circleId;
            if (!authUserId || !circleId || circleId <= 0 || !access.circleActor) {
                return res.status(409).json({
                    error: 'draft_circle_required',
                    message: 'enter crystallization requires a circle-bound draft',
                });
            }

            const permission = await resolveDraftWorkflowPermission(prisma, {
                circleId,
                actor: access.circleActor,
                action: 'enter_crystallization',
            });
            if (!permission.allowed) {
                return res.status(403).json({
                    error: 'draft_enter_crystallization_permission_denied',
                    message: localizeDraftWorkflowPermissionDecision(permission, resolveExpressRequestLocale(req)),
                });
            }
            const workflowState = await getPersistedDraftWorkflowState(prisma, draftPostId);
            const governedReplayLifecycle = governedRoutingConfirmation
                && workflowState?.crystallizationAnchorSignature
                ? await resolveDraftLifecycleReadModel(prisma, { draftPostId })
                : null;
            const governedReplayReceipt = governedReplayLifecycle
                ?.stableSnapshot.crystallizationRoutingReceipt;
            const isExactGovernedReplay = Boolean(
                governedRoutingConfirmation
                && workflowState
                && governedReplayLifecycle
                && matchesGovernedCaseRoutingReplay(
                    governedReplayReceipt,
                    {
                        draftPostId,
                        draftVersion: workflowState.currentSnapshotVersion,
                        policyProfileDigest,
                        actionType: governedRoutingConfirmation.actionIntent.actionType,
                        targetRef: governedRoutingConfirmation.actionIntent.targetRef,
                        requestId: governedRoutingConfirmation.actionIntent.requestId,
                    },
                )
            );
            if (
                isExactGovernedReplay
                && governedReplayReceipt?.path === 'governed_case'
                && governedReplayReceipt.actorUserId === authUserId
                && workflowState?.crystallizationAnchorSignature === anchorSignature
                && workflowState.crystallizationPolicyProfileDigest === policyProfileDigest
            ) {
                return res.status(200).json({
                    ok: true,
                    draftPostId,
                    anchorSignature,
                    lifecycle: governedReplayLifecycle,
                });
            }
            const anchorCheck = await verifyEnterDraftLifecycleCrystallizationAnchor({
                actorPubkey: actor.pubkey,
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
            if (isExactGovernedReplay) {
                return res.status(200).json({
                    ok: true,
                    draftPostId,
                    anchorSignature,
                    lifecycle: governedReplayLifecycle,
                });
            }

            const lifecycle = governedRoutingConfirmation
                ? await routeDraftLifecycleToGovernanceCase(prisma, {
                    draftPostId,
                    actorUserId: authUserId,
                    actorPubkey: actor.pubkey,
                    anchorSignature,
                    policyProfileDigest,
                    actionType: governedRoutingConfirmation.actionIntent.actionType,
                    revisionProposalId: governedRoutingConfirmation.actionIntent.targetRef,
                    requestId: governedRoutingConfirmation.actionIntent.requestId,
                })
                : await enterDraftLifecycleCrystallization(prisma, {
                    draftPostId,
                    actorUserId: authUserId,
                    anchorSignature,
                    policyProfileDigest,
                    routingConfirmation: ordinaryRoutingConfirmation!,
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
            if (error instanceof GovernanceCaseWorkflowError) {
                return res.status(error.statusCode).json({
                    error: error.code,
                    message: error.message,
                });
            }
            if (error instanceof Error && [
                'revision_direction_crystallization_subject_mismatch',
                'crystallization_governed_action_unregistered',
                'governance_binding_required',
                'crystallization_governed_route_runtime_mismatch',
                'governance_case_native_draft_origin_mismatch',
            ].includes(error.message)) {
                return res.status(409).json({ error: error.message });
            }
            if (sendAuthActorError(res, error)) return;
            return next(error);
        }
    });

    router.post('/drafts/:postId/fail-crystallization', async (req, res, next) => {
        try {
            const draftPostId = parsePositiveInt(req.params.postId);
            if (!draftPostId) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }

            const { authUserId, access } = await resolveDraftAccessFromRequest(req, draftPostId, 'read');
            if (!access.allowed) {
                return sendDraftAccessDenied(res, access);
            }

            const circleId = access.post?.circleId;
            if (!authUserId || !circleId || circleId <= 0 || !access.circleActor) {
                return res.status(409).json({
                    error: 'draft_circle_required',
                    message: 'fail crystallization requires a circle-bound draft',
                });
            }

            const permission = await resolveDraftWorkflowPermission(prisma, {
                circleId,
                actor: access.circleActor,
                action: 'enter_crystallization',
            });
            if (!permission.allowed) {
                return res.status(403).json({
                    error: 'draft_fail_crystallization_permission_denied',
                    message: localizeDraftWorkflowPermissionDecision(permission, resolveExpressRequestLocale(req)),
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
            if (sendAuthActorError(res, error)) return;
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

            const { actor, authUserId, access } = await resolveDraftAccessFromRequest(req, draftPostId, 'read');
            if (!access.allowed) {
                return sendDraftAccessDenied(res, access);
            }

            const circleId = access.post?.circleId;
            if (!authUserId || !circleId || circleId <= 0 || !access.circleActor) {
                return res.status(409).json({
                    error: 'draft_circle_required',
                    message: 'retry crystallization requires a circle-bound draft',
                });
            }

            const permission = await resolveDraftWorkflowPermission(prisma, {
                circleId,
                actor: access.circleActor,
                action: 'enter_crystallization',
            });
            if (!permission.allowed) {
                return res.status(403).json({
                    error: 'draft_retry_crystallization_permission_denied',
                    message: localizeDraftWorkflowPermissionDecision(permission, resolveExpressRequestLocale(req)),
                });
            }
            const workflowState = await getPersistedDraftWorkflowState(prisma, draftPostId);
            const anchorCheck = await verifyEnterDraftLifecycleCrystallizationAnchor({
                actorPubkey: actor.pubkey,
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
            if (sendAuthActorError(res, error)) return;
            return next(error);
        }
    });

    router.post('/drafts/:postId/repair-crystallization-evidence', async (req, res, next) => {
        try {
            const draftPostId = parsePositiveInt(req.params.postId);
            if (!draftPostId) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }

            const { authUserId, access } = await resolveDraftAccessFromRequest(req, draftPostId, 'read');
            if (!access.allowed) {
                return sendDraftAccessDenied(res, access);
            }

            const circleId = access.post?.circleId;
            if (!authUserId || !circleId || circleId <= 0 || !access.circleActor) {
                return res.status(409).json({
                    error: 'draft_circle_required',
                    message: 'repairing crystallization evidence requires a circle-bound draft',
                });
            }

            const permission = await resolveDraftWorkflowPermission(prisma, {
                circleId,
                actor: access.circleActor,
                action: 'enter_crystallization',
            });
            if (!permission.allowed) {
                return res.status(403).json({
                    error: 'draft_repair_crystallization_evidence_permission_denied',
                    message: localizeDraftWorkflowPermissionDecision(permission, resolveExpressRequestLocale(req)),
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
            if (sendAuthActorError(res, error)) return;
            return next(error);
        }
    });

    router.post('/drafts/:postId/rollback-crystallization', async (req, res, next) => {
        try {
            const draftPostId = parsePositiveInt(req.params.postId);
            if (!draftPostId) {
                return res.status(400).json({ error: 'invalid_post_id' });
            }

            const { authUserId, access } = await resolveDraftAccessFromRequest(req, draftPostId, 'read');
            if (!access.allowed) {
                return sendDraftAccessDenied(res, access);
            }

            const circleId = access.post?.circleId;
            if (!authUserId || !circleId || circleId <= 0 || !access.circleActor) {
                return res.status(409).json({
                    error: 'draft_circle_required',
                    message: 'rollback crystallization requires a circle-bound draft',
                });
            }

            const permission = await resolveDraftWorkflowPermission(prisma, {
                circleId,
                actor: access.circleActor,
                action: 'advance_from_review',
            });
            if (!permission.allowed) {
                return res.status(403).json({
                    error: 'draft_rollback_crystallization_permission_denied',
                    message: localizeDraftWorkflowPermissionDecision(permission, resolveExpressRequestLocale(req)),
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
            if (sendAuthActorError(res, error)) return;
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

            const { actor, authUserId, access } = await resolveDraftAccessFromRequest(req, draftPostId, 'read');
            if (!access.allowed) {
                return sendDraftAccessDenied(res, access);
            }

            const circleId = access.post?.circleId;
            if (!authUserId || !circleId || circleId <= 0 || !access.circleActor) {
                return res.status(409).json({
                    error: 'draft_circle_required',
                    message: 'archive requires a circle-bound draft',
                });
            }

            const permission = await resolveDraftWorkflowPermission(prisma, {
                circleId,
                actor: access.circleActor,
                action: 'advance_from_review',
            });
            if (!permission.allowed) {
                return res.status(403).json({
                    error: 'draft_archive_permission_denied',
                    message: localizeDraftWorkflowPermissionDecision(permission, resolveExpressRequestLocale(req)),
                });
            }
            const workflowState = await getPersistedDraftWorkflowState(prisma, draftPostId);
            const anchorCheck = await verifyArchiveDraftLifecycleAnchor({
                actorPubkey: actor.pubkey,
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
            if (sendAuthActorError(res, error)) return;
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

            const { actor, authUserId, access } = await resolveDraftAccessFromRequest(req, draftPostId, 'read');
            if (!access.allowed) {
                return sendDraftAccessDenied(res, access);
            }

            const circleId = access.post?.circleId;
            if (!authUserId || !circleId || circleId <= 0 || !access.circleActor) {
                return res.status(409).json({
                    error: 'draft_circle_required',
                    message: 'restore requires a circle-bound draft',
                });
            }

            const permission = await resolveDraftWorkflowPermission(prisma, {
                circleId,
                actor: access.circleActor,
                action: 'advance_from_review',
            });
            if (!permission.allowed) {
                return res.status(403).json({
                    error: 'draft_restore_permission_denied',
                    message: localizeDraftWorkflowPermissionDecision(permission, resolveExpressRequestLocale(req)),
                });
            }
            const workflowState = await getPersistedDraftWorkflowState(prisma, draftPostId);
            const anchorCheck = await verifyRestoreDraftLifecycleAnchor({
                actorPubkey: actor.pubkey,
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
            if (sendAuthActorError(res, error)) return;
            return next(error);
        }
    });

    return router;
}
