import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import {
    requireAuthenticatedActor,
} from '../services/auth/actor';
import {
    authorizeDraftActionForActor,
    requireCircleManagerForActor,
    sendAuthActorError,
} from '../services/auth/actorPermissions';
import {
    evaluateRevisionDirectionGovernance,
    publicDraftGovernanceRequest,
    resolveRevisionDirectionGovernanceAuthority,
} from '../services/governance/draftGovernance';
import {
    isRevisionDirectionAcceptActionType,
    REVISION_DIRECTION_ACCEPT_ACTION_TYPE,
} from '../services/governance/actionRegistry';
import { hashCanonicalGovernanceValue } from '../services/governance/canonicalCodec';
import {
    verifyEnterDraftLifecycleCrystallizationAnchor,
} from '../services/draftLifecycle/anchorVerification';
import { resolveDraftLifecycleReadModel } from '../services/draftLifecycle/readModel';
import { getPersistedDraftWorkflowState } from '../services/draftLifecycle/workflowState';
import { lockDraftParagraphStructure } from '../services/draftLifecycle/paragraphStructure';
import {
    localizeDraftWorkflowPermissionDecision,
    resolveDraftWorkflowPermission,
} from '../services/policy/draftWorkflowPermissions';
import { resolveExpressRequestLocale } from '../i18n/request';
import {
    acceptRevisionDirectionProposal,
    createPrismaRevisionDirectionStore,
    createRevisionDirectionProposal,
    listAcceptedRevisionDirectionsForNextRound,
    listRevisionDirectionProposals,
    normalizeRevisionDirectionAcceptanceMode,
    reconcileRevisionDirectionProposalGovernance,
    rejectRevisionDirectionProposal,
} from '../services/revisionDirection/runtime';

function asPositiveInteger(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function asOptionalInteger(value: unknown): number | null {
    if (value == null || value === '') return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
}

function asOptionalString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function asPolicyProfileDigest(value: unknown): string | null {
    const normalized = asOptionalString(value)?.toLowerCase() ?? null;
    return normalized && /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function hasGovernedRevisionDirectionConfirmation(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const confirmation = value as Record<string, unknown>;
    const actionIntent = confirmation.actionIntent;
    if (!actionIntent || typeof actionIntent !== 'object' || Array.isArray(actionIntent)) return false;
    const intent = actionIntent as Record<string, unknown>;
    return confirmation.path === 'governed_case'
        && confirmation.humanConfirmed === true
        && intent.actionType === REVISION_DIRECTION_ACCEPT_ACTION_TYPE
        && intent.targetType === 'revision_direction'
        && intent.requestedEffect === 'accept_revision_direction'
        && intent.collectiveCommitmentRequired === true;
}

function isAnchorVerificationMisconfigured(reason: string | undefined): boolean {
    return reason === 'content_program_id_unconfigured'
        || reason === 'rpc_url_unconfigured';
}

async function runInTransaction<T>(
    prisma: PrismaClient,
    callback: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
    const transaction = (prisma as any).$transaction;
    if (typeof transaction !== 'function') {
        return callback(prisma);
    }
    return transaction.call(prisma, callback);
}

async function hasExpectedLockedReviewSnapshot(
    prisma: PrismaClient,
    input: { draftPostId: number; draftVersion: number },
): Promise<boolean> {
    const locked = await lockDraftParagraphStructure(prisma, input.draftPostId);
    return Boolean(
        locked
        && locked.documentStatus === 'review'
        && locked.currentSnapshotVersion === input.draftVersion,
    );
}

async function findReusableGovernedRevisionDirection(
    prisma: PrismaClient,
    input: {
        circleId: number;
        draftPostId: number;
        draftVersion: number;
        scopeType: string;
        scopeRef: string;
        summary: string;
        actorPubkey: string;
    },
): Promise<
    | { status: 'none' }
    | { status: 'conflict'; error: string }
    | { status: 'denied'; error: string }
    | { status: 'reused'; proposal: any; governanceRequest: any }
> {
    const proposals = await listRevisionDirectionProposals(
        createPrismaRevisionDirectionStore(prisma),
        {
            draftPostId: input.draftPostId,
            draftVersion: input.draftVersion,
        },
    );
    const openGovernedProposals = proposals.filter((proposal) => (
        proposal.status === 'open'
        && proposal.acceptanceMode === 'governance_request'
    ));
    const candidates: Array<{ proposal: any; request: any }> = [];
    for (const proposal of openGovernedProposals) {
        if (!proposal.governanceRequestId) {
            return { status: 'conflict', error: 'revision_direction_active_retry_conflict' };
        }
        const request = await (prisma as any).governanceRequest.findUnique({
            where: { id: proposal.governanceRequestId },
            include: {
                invocation: true,
                governanceCase: true,
            },
        });
        if (
            request
            && (request.state === 'rejected' || request.state === 'cancelled' || request.state === 'expired')
        ) {
            await reconcileRevisionDirectionProposalGovernance(
                createPrismaRevisionDirectionStore(prisma),
                {
                    revisionProposalId: proposal.revisionProposalId,
                    governanceRequest: request,
                },
            );
            continue;
        }
        candidates.push({ proposal, request });
    }
    if (candidates.length === 0) return { status: 'none' };
    if (candidates.length !== 1) {
        return { status: 'conflict', error: 'revision_direction_active_retry_conflict' };
    }

    const authority = await resolveRevisionDirectionGovernanceAuthority(prisma, {
        circleId: input.circleId,
        actorPubkey: input.actorPubkey,
    }, { transactionClient: true });
    if (authority.status !== 'requires_governance') {
        return { status: 'denied', error: authority.reason };
    }

    const { proposal, request } = candidates[0];
    if (!Number.isInteger(proposal.proposedBy)) {
        return { status: 'conflict', error: 'revision_direction_active_retry_conflict' };
    }
    if (
        proposal.scopeType !== input.scopeType
        || proposal.scopeRef !== input.scopeRef
        || proposal.summary !== input.summary
    ) {
        return { status: 'conflict', error: 'revision_direction_active_retry_conflict' };
    }
    const payload = {
        revisionProposalId: proposal.revisionProposalId,
        draftPostId: input.draftPostId,
        draftVersion: input.draftVersion,
        scopeType: input.scopeType,
        scopeRef: input.scopeRef,
        summary: input.summary,
        proposedBy: proposal.proposedBy,
    };
    const payloadDigest = hashCanonicalGovernanceValue(
        'alcheme.governance.action-payload',
        payload,
    );
    const invocation = request?.invocation;
    const governanceCase = request?.governanceCase;
    if (
        !request
        || request.state !== 'active'
        || (request.expiresAt && new Date(request.expiresAt) <= new Date())
        || request.actionType !== REVISION_DIRECTION_ACCEPT_ACTION_TYPE
        || request.targetType !== 'revision_direction'
        || request.targetRef !== proposal.revisionProposalId
        || !asOptionalString(request.proposerPubkey)
        || request.scopeType !== 'circle_governance_committee'
        || request.scopeRef !== String(authority.committeeCircleId)
        || request.policyId !== authority.policyId
        || request.policyVersionId !== authority.policyVersionId
        || request.ruleId !== authority.ruleId
        || hashCanonicalGovernanceValue(
            'alcheme.governance.action-payload',
            request.payload,
        ) !== payloadDigest
        || !invocation
        || invocation.id !== request.invocationId
        || invocation.subjectType !== 'revision_direction'
        || invocation.subjectRef !== proposal.revisionProposalId
        || invocation.payloadDigest !== payloadDigest
        || !governanceCase
        || governanceCase.id !== request.caseRef
        || governanceCase.primaryRequestId !== request.id
        || governanceCase.invocationId !== invocation.id
        || governanceCase.subjectType !== 'revision_direction'
        || governanceCase.subjectRef !== proposal.revisionProposalId
        || hashCanonicalGovernanceValue(
            'alcheme.governance.action-payload',
            governanceCase.requestedActionPayload,
        ) !== payloadDigest
    ) {
        return { status: 'conflict', error: 'revision_direction_active_retry_conflict' };
    }
    return {
        status: 'reused',
        proposal,
        governanceRequest: publicDraftGovernanceRequest(request),
    };
}

export function revisionDirectionRouter(prisma: PrismaClient, _redis: Redis): Router {
    const router = Router();
    const revisionStore = createPrismaRevisionDirectionStore(prisma);

    router.get('/drafts/:postId/revision-directions', async (req, res) => {
        try {
            const draftPostId = asPositiveInteger(req.params.postId);
            if (!draftPostId) {
                return res.status(400).json({ error: 'invalid_draft_post_id' });
            }

            const actor = await requireAuthenticatedActor(req, prisma, { requireSessionCookie: true });
            const access = await authorizeDraftActionForActor(prisma, {
                actor,
                postId: draftPostId,
                action: 'read',
            });
            if (!access.allowed) {
                return sendDraftAccessDenied(res, access);
            }

            const draftVersion = asOptionalInteger(req.query?.draftVersion);
            const proposals = await listRevisionDirectionProposals(revisionStore, {
                draftPostId,
                draftVersion,
            });

            const reconciledProposals = await Promise.all(proposals.map(async (proposal) => {
                if (proposal.acceptanceMode !== 'governance_request' || !proposal.governanceRequestId) {
                    return proposal;
                }
                const governanceRequest = await (prisma as any).governanceRequest.findUnique({
                    where: { id: proposal.governanceRequestId },
                });
                const reconciled = await reconcileRevisionDirectionProposalGovernance(revisionStore, {
                    revisionProposalId: proposal.revisionProposalId,
                    governanceRequest,
                });
                return {
                    ...reconciled,
                    governanceActionType: isRevisionDirectionAcceptActionType(governanceRequest?.actionType)
                        ? governanceRequest.actionType
                        : null,
                    governanceCaseRef: asOptionalString(governanceRequest?.caseRef),
                };
            }));

            const acceptedDirections = await listAcceptedRevisionDirectionsForNextRound(revisionStore, {
                draftPostId,
                draftVersion,
            });

            return res.json({
                proposals: reconciledProposals,
                acceptedDirections,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return res.status(400).json({
                error: error instanceof Error ? error.message : 'revision_direction_list_failed',
            });
        }
    });

    router.post('/drafts/:postId/revision-directions', async (req, res) => {
        try {
            const draftPostId = asPositiveInteger(req.params.postId);
            const acceptanceMode = normalizeRevisionDirectionAcceptanceMode(req.body?.acceptanceMode);
            const summary = asOptionalString(req.body?.summary);
            const scopeType = asOptionalString(req.body?.scopeType) ?? 'document';
            const scopeRef = asOptionalString(req.body?.scopeRef) ?? 'document';

            if (!draftPostId || !acceptanceMode || !summary) {
                return res.status(400).json({ error: 'invalid_revision_direction_input' });
            }
            const actor = await requireAuthenticatedActor(req, prisma, { requireSessionCookie: true });
            const access = await authorizeDraftActionForActor(prisma, {
                actor,
                postId: draftPostId,
                action: 'comment',
            });
            if (!access.allowed) {
                return sendDraftAccessDenied(res, access);
            }

            const lifecycle = await resolveDraftLifecycleReadModel(prisma, {
                draftPostId,
            });
            if (lifecycle.documentStatus !== 'review') {
                return res.status(409).json({
                    error: 'revision_direction_requires_review_stage',
                });
            }
            if (!lifecycle.circleId) {
                return res.status(409).json({
                    error: 'revision_direction_requires_circle_bound_draft',
                });
            }
            const circleId = lifecycle.circleId;
            if (!access.circleActor) {
                return res.status(409).json({
                    error: 'revision_direction_requires_circle_bound_draft',
                });
            }

            const permission = await resolveDraftWorkflowPermission(prisma, {
                circleId,
                actor: access.circleActor,
                action: acceptanceMode === 'governance_request'
                    ? 'enter_crystallization'
                    : 'followup_issue',
            });
            if (!permission.allowed) {
                return res.status(403).json({
                    error: 'revision_direction_permission_denied',
                    message: localizeDraftWorkflowPermissionDecision(permission, resolveExpressRequestLocale(req)),
                });
            }

            if (acceptanceMode === 'governance_request') {
                const bodyActorPubkey = asOptionalString(req.body?.actorPubkey);
                if (bodyActorPubkey && bodyActorPubkey !== actor.pubkey) {
                    return res.status(403).json({ error: 'actor_pubkey_mismatch' });
                }
                const anchorSignature = asOptionalString(req.body?.anchorSignature);
                const policyProfileDigest = asPolicyProfileDigest(req.body?.policyProfileDigest);
                if (
                    !anchorSignature
                    || !policyProfileDigest
                    || !hasGovernedRevisionDirectionConfirmation(req.body?.routingConfirmation)
                ) {
                    return res.status(400).json({
                        error: 'revision_direction_governance_authorization_required',
                    });
                }
                if (lifecycle.policyProfileDigest !== policyProfileDigest) {
                    return res.status(409).json({ error: 'policy_profile_digest_stale' });
                }
                const workflowState = await getPersistedDraftWorkflowState(prisma, draftPostId);
                const anchorCheck = await verifyEnterDraftLifecycleCrystallizationAnchor({
                    actorPubkey: actor.pubkey,
                    anchorSignature,
                    draftPostId,
                    policyProfileDigest,
                    minimumAcceptedAt: workflowState?.lastTransitionAt ?? null,
                    reusedAnchorSignature: workflowState?.crystallizationAnchorSignature ?? null,
                });
                if (!anchorCheck.ok) {
                    const misconfigured = isAnchorVerificationMisconfigured(anchorCheck.reason);
                    return res.status(misconfigured ? 500 : 422).json({
                        error: misconfigured
                            ? 'anchor_verification_misconfigured'
                            : 'anchor_signature_unverified',
                        reason: anchorCheck.reason ?? 'anchor_unverified',
                    });
                }
                const governed = await runInTransaction(prisma, async (tx) => {
                    const stillCurrent = await hasExpectedLockedReviewSnapshot(tx, {
                        draftPostId,
                        draftVersion: lifecycle.stableSnapshot.draftVersion,
                    });
                    if (!stillCurrent) {
                        return { status: 'stale_review' as const };
                    }
                    const lockedLifecycle = await resolveDraftLifecycleReadModel(tx, {
                        draftPostId,
                    });
                    if (
                        lockedLifecycle.documentStatus !== 'review'
                        || lockedLifecycle.circleId !== circleId
                        || lockedLifecycle.stableSnapshot.draftVersion !== lifecycle.stableSnapshot.draftVersion
                    ) {
                        return { status: 'stale_review' as const };
                    }
                    if (lockedLifecycle.policyProfileDigest !== policyProfileDigest) {
                        return { status: 'stale_policy' as const };
                    }
                    const reusable = await findReusableGovernedRevisionDirection(tx, {
                        circleId,
                        draftPostId,
                        draftVersion: lifecycle.stableSnapshot.draftVersion,
                        scopeType,
                        scopeRef,
                        summary,
                        actorPubkey: actor.pubkey,
                    });
                    if (reusable.status !== 'none') return reusable;
                    const revisionProposalId = randomUUID();
                    const governance = await evaluateRevisionDirectionGovernance(tx, {
                        circleId,
                        draftPostId,
                        draftVersion: lifecycle.stableSnapshot.draftVersion,
                        revisionProposalId,
                        scopeType,
                        scopeRef,
                        summary,
                        proposedBy: actor.userId,
                        actorPubkey: actor.pubkey,
                    }, { transactionClient: true });
                    if (governance.status === 'denied') {
                        return {
                            status: 'denied' as const,
                            error: governance.error,
                        };
                    }
                    const proposal = await createRevisionDirectionProposal(createPrismaRevisionDirectionStore(tx), {
                        revisionProposalId,
                        draftPostId,
                        draftVersion: lifecycle.stableSnapshot.draftVersion,
                        scopeType,
                        scopeRef,
                        proposedBy: actor.userId,
                        summary,
                        acceptanceMode,
                        governanceRequestId: String(governance.request.id),
                        createdAt: new Date(),
                    });
                    return {
                        status: 'requires_governance' as const,
                        proposal,
                        governanceRequest: governance.request,
                    };
                });

                if (governed.status === 'denied') {
                    return res.status(409).json({ error: governed.error });
                }
                if (governed.status === 'conflict') {
                    return res.status(409).json({ error: governed.error });
                }
                if (governed.status === 'stale_review') {
                    return res.status(409).json({ error: 'revision_direction_requires_review_stage' });
                }
                if (governed.status === 'stale_policy') {
                    return res.status(409).json({ error: 'policy_profile_digest_stale' });
                }
                return res.status(202).json({
                    status: 'requires_governance',
                    actionType: governed.governanceRequest.actionType,
                    proposal: governed.proposal,
                    request: governed.governanceRequest,
                });
            }

            const direct = await runInTransaction(prisma, async (tx) => {
                const stillCurrent = await hasExpectedLockedReviewSnapshot(tx, {
                    draftPostId,
                    draftVersion: lifecycle.stableSnapshot.draftVersion,
                });
                if (!stillCurrent) {
                    return { status: 'stale_review' as const };
                }
                const revisionProposalId = randomUUID();
                const proposal = await createRevisionDirectionProposal(createPrismaRevisionDirectionStore(tx), {
                    revisionProposalId,
                    draftPostId,
                    draftVersion: lifecycle.stableSnapshot.draftVersion,
                    scopeType,
                    scopeRef,
                    proposedBy: actor.userId,
                    summary,
                    acceptanceMode,
                    governanceRequestId: null,
                    createdAt: new Date(),
                });
                return { status: 'created' as const, proposal };
            });
            if (direct.status === 'stale_review') {
                return res.status(409).json({ error: 'revision_direction_requires_review_stage' });
            }
            return res.json({ proposal: direct.proposal });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return res.status(400).json({
                error: error instanceof Error ? error.message : 'revision_direction_create_failed',
            });
        }
    });

    router.post('/proposals/:proposalId/accept', async (req, res) => {
        try {
            const revisionProposalId = asOptionalString(req.params.proposalId);
            if (!revisionProposalId) {
                return res.status(400).json({ error: 'invalid_revision_direction_accept_input' });
            }
            const actor = await requireAuthenticatedActor(req, prisma, { requireSessionCookie: true });

            const proposal = await revisionStore.getProposal(revisionProposalId);
            if (!proposal) {
                return res.status(404).json({ error: 'revision_direction_not_found' });
            }

            const lifecycle = await resolveDraftLifecycleReadModel(prisma, {
                draftPostId: proposal.draftPostId,
            });
            if (!lifecycle.circleId) {
                return res.status(409).json({
                    error: 'revision_direction_requires_circle_bound_draft',
                });
            }
            const draftAccess = await authorizeDraftActionForActor(prisma, {
                actor,
                postId: proposal.draftPostId,
                action: 'comment',
            });
            if (!draftAccess.allowed) {
                return sendDraftAccessDenied(res, draftAccess);
            }

            if (proposal.acceptanceMode === 'manager_confirm') {
                await requireCircleManagerForActor(prisma, {
                    circleId: lifecycle.circleId,
                    actor,
                    allowModerator: true,
                });
            } else if (proposal.acceptanceMode === 'role_confirm') {
                if (!draftAccess.circleActor) {
                    return res.status(409).json({
                        error: 'revision_direction_requires_circle_bound_draft',
                    });
                }
                const permission = await resolveDraftWorkflowPermission(prisma, {
                    circleId: lifecycle.circleId,
                    actor: draftAccess.circleActor,
                    action: 'accept_reject_issue',
                });
                if (!permission.allowed) {
                    return res.status(403).json({
                        error: 'revision_direction_role_confirmation_required',
                        message: localizeDraftWorkflowPermissionDecision(permission, resolveExpressRequestLocale(req)),
                    });
                }
            } else {
                const governanceRequest = proposal.governanceRequestId
                    ? await (prisma as any).governanceRequest.findUnique({
                        where: { id: proposal.governanceRequestId },
                    })
                    : null;
                const reconciled = await reconcileRevisionDirectionProposalGovernance(revisionStore, {
                    revisionProposalId,
                    governanceRequest,
                });
                if (reconciled.status !== 'accepted') {
                    return res.status(409).json({
                        error: governanceRequest?.state === 'accepted'
                            ? 'revision_direction_governance_execution_required'
                            : 'revision_direction_governance_not_accepted',
                        proposal: reconciled,
                    });
                }
                return res.json({ proposal: reconciled });
            }

            const accepted = await acceptRevisionDirectionProposal(revisionStore, {
                revisionProposalId,
                acceptedBy: actor.userId,
                acceptedAt: new Date(),
            });
            return res.json({ proposal: accepted });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return res.status(400).json({
                error: error instanceof Error ? error.message : 'revision_direction_accept_failed',
            });
        }
    });

    router.post('/proposals/:proposalId/reject', async (req, res) => {
        try {
            const revisionProposalId = asOptionalString(req.params.proposalId);
            if (!revisionProposalId) {
                return res.status(400).json({ error: 'invalid_revision_direction_reject_input' });
            }
            const actor = await requireAuthenticatedActor(req, prisma, { requireSessionCookie: true });

            const proposal = await revisionStore.getProposal(revisionProposalId);
            if (!proposal) {
                return res.status(404).json({ error: 'revision_direction_not_found' });
            }

            const lifecycle = await resolveDraftLifecycleReadModel(prisma, {
                draftPostId: proposal.draftPostId,
            });
            if (!lifecycle.circleId) {
                return res.status(409).json({
                    error: 'revision_direction_requires_circle_bound_draft',
                });
            }
            const draftAccess = await authorizeDraftActionForActor(prisma, {
                actor,
                postId: proposal.draftPostId,
                action: 'comment',
            });
            if (!draftAccess.allowed) {
                return sendDraftAccessDenied(res, draftAccess);
            }

            if (proposal.acceptanceMode === 'manager_confirm') {
                await requireCircleManagerForActor(prisma, {
                    circleId: lifecycle.circleId,
                    actor,
                    allowModerator: true,
                });
            } else if (proposal.acceptanceMode === 'role_confirm') {
                if (!draftAccess.circleActor) {
                    return res.status(409).json({
                        error: 'revision_direction_requires_circle_bound_draft',
                    });
                }
                const permission = await resolveDraftWorkflowPermission(prisma, {
                    circleId: lifecycle.circleId,
                    actor: draftAccess.circleActor,
                    action: 'accept_reject_issue',
                });
                if (!permission.allowed) {
                    return res.status(403).json({
                        error: 'revision_direction_role_confirmation_required',
                        message: localizeDraftWorkflowPermissionDecision(permission, resolveExpressRequestLocale(req)),
                    });
                }
            } else {
                return res.status(409).json({
                    error: 'revision_direction_governance_rejection_required',
                });
            }

            const rejected = await rejectRevisionDirectionProposal(revisionStore, {
                revisionProposalId,
            });
            return res.json({ proposal: rejected });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return res.status(400).json({
                error: error instanceof Error ? error.message : 'revision_direction_reject_failed',
            });
        }
    });

    return router;
}

function sendDraftAccessDenied(
    res: any,
    access: { statusCode: number; error: string; message: string },
) {
    return res.status(access.statusCode).json({
        error: access.error,
        message: access.message,
    });
}
