import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import {
    parseAuthUserIdFromRequest,
    requireCircleManagerRole,
} from '../services/membership/checks';
import {
    createGovernanceProposal,
    createPrismaGovernanceRuntimeStore,
} from '../services/governance/runtime';
import { resolveDraftLifecycleReadModel } from '../services/draftLifecycle/readModel';
import { resolveDraftWorkflowPermission } from '../services/policy/draftWorkflowPermissions';
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

export function revisionDirectionRouter(prisma: PrismaClient, _redis: Redis): Router {
    const router = Router();
    const revisionStore = createPrismaRevisionDirectionStore(prisma);
    const governanceStore = createPrismaGovernanceRuntimeStore(prisma);

    router.get('/drafts/:postId/revision-directions', async (req, res) => {
        const draftPostId = asPositiveInteger(req.params.postId);
        if (!draftPostId) {
            return res.status(400).json({ error: 'invalid_draft_post_id' });
        }

        const draftVersion = asOptionalInteger(req.query?.draftVersion);
        const proposals = await listRevisionDirectionProposals(revisionStore, {
            draftPostId,
            draftVersion,
        });

        const reconciledProposals = await Promise.all(proposals.map(async (proposal) => {
            if (proposal.acceptanceMode !== 'governance_vote' || !proposal.governanceProposalId) {
                return proposal;
            }
            const governanceProposal = await governanceStore.getProposal(proposal.governanceProposalId);
            return reconcileRevisionDirectionProposalGovernance(revisionStore, {
                revisionProposalId: proposal.revisionProposalId,
                governanceProposal,
            });
        }));

        const acceptedDirections = await listAcceptedRevisionDirectionsForNextRound(revisionStore, {
            draftPostId,
            draftVersion,
        });

        return res.json({
            proposals: reconciledProposals,
            acceptedDirections,
        });
    });

    router.post('/drafts/:postId/revision-directions', async (req, res) => {
        try {
            const draftPostId = asPositiveInteger(req.params.postId);
            const userId = parseAuthUserIdFromRequest(req);
            const acceptanceMode = normalizeRevisionDirectionAcceptanceMode(req.body?.acceptanceMode);
            const summary = asOptionalString(req.body?.summary);
            const scopeType = asOptionalString(req.body?.scopeType) ?? 'document';
            const scopeRef = asOptionalString(req.body?.scopeRef) ?? 'document';

            if (!draftPostId || !userId || !acceptanceMode || !summary) {
                return res.status(400).json({ error: 'invalid_revision_direction_input' });
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

            const permission = await resolveDraftWorkflowPermission(prisma, {
                circleId: lifecycle.circleId,
                userId,
                action: 'followup_issue',
            });
            if (!permission.allowed) {
                return res.status(403).json({
                    error: 'revision_direction_permission_denied',
                    message: permission.reason,
                });
            }

            const revisionProposalId = randomUUID();
            let governanceProposalId: string | null = null;

            if (acceptanceMode === 'governance_vote') {
                const governanceProposal = await createGovernanceProposal(governanceStore, {
                    proposalId: randomUUID(),
                    circleId: lifecycle.circleId,
                    actionType: 'revision_direction',
                    targetType: 'revision_direction',
                    targetId: revisionProposalId,
                    targetVersion: lifecycle.stableSnapshot.draftVersion,
                    createdBy: userId,
                    electorateScope: (asOptionalString(req.body?.electorateScope) as any) ?? 'qualified_roles',
                    voteRule: (asOptionalString(req.body?.voteRule) as any) ?? 'single_approver',
                    thresholdValue: asOptionalInteger(req.body?.thresholdValue) ?? 1,
                    quorum: asOptionalInteger(req.body?.quorum),
                    configSnapshot: {
                        draftPostId,
                        draftVersion: lifecycle.stableSnapshot.draftVersion,
                        scopeType,
                        scopeRef,
                        summary,
                    },
                });
                governanceProposalId = governanceProposal.proposalId;
            }

            const proposal = await createRevisionDirectionProposal(revisionStore, {
                revisionProposalId,
                draftPostId,
                draftVersion: lifecycle.stableSnapshot.draftVersion,
                scopeType,
                scopeRef,
                proposedBy: userId,
                summary,
                acceptanceMode,
                governanceProposalId,
                createdAt: new Date(),
            });

            return res.json({ proposal });
        } catch (error) {
            return res.status(400).json({
                error: error instanceof Error ? error.message : 'revision_direction_create_failed',
            });
        }
    });

    router.post('/proposals/:proposalId/accept', async (req, res) => {
        try {
            const userId = parseAuthUserIdFromRequest(req);
            const revisionProposalId = asOptionalString(req.params.proposalId);
            if (!userId || !revisionProposalId) {
                return res.status(400).json({ error: 'invalid_revision_direction_accept_input' });
            }

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

            if (proposal.acceptanceMode === 'manager_confirm') {
                const allowed = await requireCircleManagerRole(prisma, {
                    circleId: lifecycle.circleId,
                    userId,
                    allowModerator: true,
                });
                if (!allowed) {
                    return res.status(403).json({
                        error: 'revision_direction_manager_confirmation_required',
                    });
                }
            } else if (proposal.acceptanceMode === 'role_confirm') {
                const permission = await resolveDraftWorkflowPermission(prisma, {
                    circleId: lifecycle.circleId,
                    userId,
                    action: 'accept_reject_issue',
                });
                if (!permission.allowed) {
                    return res.status(403).json({
                        error: 'revision_direction_role_confirmation_required',
                        message: permission.reason,
                    });
                }
            } else {
                const governanceProposal = proposal.governanceProposalId
                    ? await governanceStore.getProposal(proposal.governanceProposalId)
                    : null;
                const reconciled = await reconcileRevisionDirectionProposalGovernance(revisionStore, {
                    revisionProposalId,
                    governanceProposal,
                });
                if (reconciled.status !== 'accepted') {
                    return res.status(409).json({
                        error: 'revision_direction_governance_not_executed',
                        proposal: reconciled,
                    });
                }
                return res.json({ proposal: reconciled });
            }

            const accepted = await acceptRevisionDirectionProposal(revisionStore, {
                revisionProposalId,
                acceptedBy: userId,
                acceptedAt: new Date(),
            });
            return res.json({ proposal: accepted });
        } catch (error) {
            return res.status(400).json({
                error: error instanceof Error ? error.message : 'revision_direction_accept_failed',
            });
        }
    });

    router.post('/proposals/:proposalId/reject', async (req, res) => {
        try {
            const userId = parseAuthUserIdFromRequest(req);
            const revisionProposalId = asOptionalString(req.params.proposalId);
            if (!userId || !revisionProposalId) {
                return res.status(400).json({ error: 'invalid_revision_direction_reject_input' });
            }

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

            if (proposal.acceptanceMode === 'manager_confirm') {
                const allowed = await requireCircleManagerRole(prisma, {
                    circleId: lifecycle.circleId,
                    userId,
                    allowModerator: true,
                });
                if (!allowed) {
                    return res.status(403).json({
                        error: 'revision_direction_manager_confirmation_required',
                    });
                }
            } else if (proposal.acceptanceMode === 'role_confirm') {
                const permission = await resolveDraftWorkflowPermission(prisma, {
                    circleId: lifecycle.circleId,
                    userId,
                    action: 'accept_reject_issue',
                });
                if (!permission.allowed) {
                    return res.status(403).json({
                        error: 'revision_direction_role_confirmation_required',
                        message: permission.reason,
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
            return res.status(400).json({
                error: error instanceof Error ? error.message : 'revision_direction_reject_failed',
            });
        }
    });

    return router;
}
