import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import {
    authorizeDraftAction,
    parseAuthUserIdFromRequest,
    requireCircleManagerRole,
} from '../services/membership/checks';
import { resolveDraftLifecycleReadModel } from '../services/draftLifecycle/readModel';
import {
    createGovernanceProposal,
    createPrismaGovernanceRuntimeStore,
} from '../services/governance/runtime';
import {
    createPrismaTemporaryEditGrantStore,
    expireTemporaryEditGrant,
    issueTemporaryEditGrant,
    normalizeTemporaryEditGrantApprovalMode,
    reconcileTemporaryEditGrantGovernance,
    requestTemporaryEditGrant,
    revokeTemporaryEditGrant,
} from '../services/draftBlocks/grants';

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

function addMinutes(now: Date, minutes: number | null): Date | null {
    if (!minutes || minutes <= 0) return null;
    return new Date(now.getTime() + (minutes * 60 * 1000));
}

export function temporaryEditGrantRouter(prisma: PrismaClient, _redis: Redis): Router {
    const router = Router();
    const grantStore = createPrismaTemporaryEditGrantStore(prisma);
    const governanceStore = createPrismaGovernanceRuntimeStore(prisma);

    router.get('/drafts/:postId/temporary-edit-grants', async (req, res) => {
        const draftPostId = asPositiveInteger(req.params.postId);
        if (!draftPostId) {
            return res.status(400).json({ error: 'invalid_draft_post_id' });
        }

        const grants = await grantStore.listDraftGrants({ draftPostId });
        const reconciled = await Promise.all(grants.map(async (grant) => {
            let nextGrant = grant;
            if (grant.approvalMode === 'governance_vote' && grant.governanceProposalId) {
                nextGrant = await reconcileTemporaryEditGrantGovernance(grantStore, {
                    grantId: grant.grantId,
                    governanceProposal: await governanceStore.getProposal(grant.governanceProposalId),
                });
            }
            return expireTemporaryEditGrant(grantStore, {
                grantId: nextGrant.grantId,
                now: new Date(),
            });
        }));

        return res.json({ grants: reconciled });
    });

    router.post('/drafts/:postId/temporary-edit-grants', async (req, res) => {
        try {
            const draftPostId = asPositiveInteger(req.params.postId);
            const userId = parseAuthUserIdFromRequest(req);
            const blockId = asOptionalString(req.body?.blockId);
            const approvalMode = normalizeTemporaryEditGrantApprovalMode(req.body?.approvalMode ?? 'manager_confirm');

            if (!draftPostId || !userId || !blockId || !approvalMode) {
                return res.status(400).json({ error: 'invalid_temporary_edit_grant_input' });
            }

            const access = await authorizeDraftAction(prisma, {
                postId: draftPostId,
                userId,
                action: 'read',
            });
            if (!access.allowed) {
                return res.status(access.statusCode).json({
                    error: access.error,
                    message: access.message,
                });
            }

            const lifecycle = await resolveDraftLifecycleReadModel(prisma, {
                draftPostId,
            });
            if (lifecycle.documentStatus !== 'drafting') {
                return res.status(409).json({
                    error: 'temporary_edit_grant_requires_drafting',
                });
            }
            if (!lifecycle.circleId) {
                return res.status(409).json({
                    error: 'temporary_edit_grant_requires_circle_bound_draft',
                });
            }

            const grantId = randomUUID();
            let governanceProposalId: string | null = null;
            if (approvalMode === 'governance_vote') {
                const governanceProposal = await createGovernanceProposal(governanceStore, {
                    proposalId: randomUUID(),
                    circleId: lifecycle.circleId,
                    actionType: 'temporary_edit_grant',
                    targetType: 'temporary_edit_grant',
                    targetId: grantId,
                    targetVersion: lifecycle.stableSnapshot.draftVersion,
                    createdBy: userId,
                    electorateScope: 'qualified_roles',
                    voteRule: 'single_approver',
                    thresholdValue: 1,
                    configSnapshot: {
                        draftPostId,
                        blockId,
                    },
                });
                governanceProposalId = governanceProposal.proposalId;
            }

            const grant = await requestTemporaryEditGrant(grantStore, {
                grantId,
                draftPostId,
                blockId,
                granteeUserId: asPositiveInteger(req.body?.granteeUserId) ?? userId,
                requestedBy: userId,
                approvalMode,
                governanceProposalId,
                requestNote: asOptionalString(req.body?.requestNote),
                requestedAt: new Date(),
            });

            return res.json({ grant });
        } catch (error) {
            return res.status(400).json({
                error: error instanceof Error ? error.message : 'temporary_edit_grant_request_failed',
            });
        }
    });

    router.post('/grants/:grantId/issue', async (req, res) => {
        try {
            const userId = parseAuthUserIdFromRequest(req);
            const grantId = asOptionalString(req.params.grantId);
            if (!userId || !grantId) {
                return res.status(400).json({ error: 'invalid_temporary_edit_grant_issue_input' });
            }

            const grant = await grantStore.getGrant(grantId);
            if (!grant) {
                return res.status(404).json({ error: 'temporary_edit_grant_not_found' });
            }

            const lifecycle = await resolveDraftLifecycleReadModel(prisma, {
                draftPostId: grant.draftPostId,
            });
            if (!lifecycle.circleId) {
                return res.status(409).json({
                    error: 'temporary_edit_grant_requires_circle_bound_draft',
                });
            }

            const managerAllowed = await requireCircleManagerRole(prisma, {
                circleId: lifecycle.circleId,
                userId,
                allowModerator: true,
            });
            if (!managerAllowed) {
                return res.status(403).json({
                    error: 'temporary_edit_grant_manager_required',
                });
            }

            if (grant.approvalMode === 'governance_vote' && grant.governanceProposalId) {
                const governanceProposal = await governanceStore.getProposal(grant.governanceProposalId);
                const reconciled = await reconcileTemporaryEditGrantGovernance(grantStore, {
                    grantId,
                    governanceProposal,
                });
                if (reconciled.status === 'rejected' || reconciled.status === 'expired') {
                    return res.status(409).json({
                        error: 'temporary_edit_grant_governance_blocked',
                        grant: reconciled,
                    });
                }
                if (!governanceProposal || governanceProposal.status !== 'executed') {
                    return res.status(409).json({
                        error: 'temporary_edit_grant_governance_not_executed',
                        grant: reconciled,
                    });
                }
            }

            const now = new Date();
            const issued = await issueTemporaryEditGrant(grantStore, {
                grantId,
                grantedBy: userId,
                grantedAt: now,
                expiresAt: addMinutes(now, asOptionalInteger(req.body?.expiresInMinutes) ?? 60),
            });

            return res.json({ grant: issued });
        } catch (error) {
            return res.status(400).json({
                error: error instanceof Error ? error.message : 'temporary_edit_grant_issue_failed',
            });
        }
    });

    router.post('/grants/:grantId/revoke', async (req, res) => {
        try {
            const userId = parseAuthUserIdFromRequest(req);
            const grantId = asOptionalString(req.params.grantId);
            if (!userId || !grantId) {
                return res.status(400).json({ error: 'invalid_temporary_edit_grant_revoke_input' });
            }

            const grant = await grantStore.getGrant(grantId);
            if (!grant) {
                return res.status(404).json({ error: 'temporary_edit_grant_not_found' });
            }

            const lifecycle = await resolveDraftLifecycleReadModel(prisma, {
                draftPostId: grant.draftPostId,
            });
            if (!lifecycle.circleId) {
                return res.status(409).json({
                    error: 'temporary_edit_grant_requires_circle_bound_draft',
                });
            }

            const managerAllowed = await requireCircleManagerRole(prisma, {
                circleId: lifecycle.circleId,
                userId,
                allowModerator: true,
            });
            if (!managerAllowed) {
                return res.status(403).json({
                    error: 'temporary_edit_grant_manager_required',
                });
            }

            const revoked = await revokeTemporaryEditGrant(grantStore, {
                grantId,
                revokedBy: userId,
                revokedAt: new Date(),
            });

            return res.json({ grant: revoked });
        } catch (error) {
            return res.status(400).json({
                error: error instanceof Error ? error.message : 'temporary_edit_grant_revoke_failed',
            });
        }
    });

    return router;
}
