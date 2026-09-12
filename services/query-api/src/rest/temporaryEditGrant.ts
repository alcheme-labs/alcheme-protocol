import { createHash, randomUUID } from 'node:crypto';
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
import { resolveDraftLifecycleReadModel } from '../services/draftLifecycle/readModel';
import {
    evaluateTemporaryEditGrantGovernance,
} from '../services/governance/draftGovernance';
import {
    createPrismaTemporaryEditGrantStore,
    expireTemporaryEditGrant,
    issueTemporaryEditGrant,
    normalizeTemporaryEditGrantApprovalMode,
    reconcileTemporaryEditGrantGovernance,
    requestTemporaryEditGrant,
    revokeTemporaryEditGrant,
} from '../services/draftBlocks/grants';
import { lockDraftParagraphStructure } from '../services/draftLifecycle/paragraphStructure';

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

function actorPubkeyMatchesSession(rawActorPubkey: unknown, actorPubkey: string): boolean {
    const bodyActorPubkey = asOptionalString(rawActorPubkey);
    return !bodyActorPubkey || bodyActorPubkey === actorPubkey;
}

function sha256Hex(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function addMinutes(now: Date, minutes: number | null): Date | null {
    if (!minutes || minutes <= 0) return null;
    return new Date(now.getTime() + (minutes * 60 * 1000));
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

export function temporaryEditGrantRouter(prisma: PrismaClient, _redis: Redis): Router {
    const router = Router();
    const grantStore = createPrismaTemporaryEditGrantStore(prisma);

    router.get('/drafts/:postId/temporary-edit-grants', async (req, res, next) => {
        try {
            const draftPostId = asPositiveInteger(req.params.postId);
            if (!draftPostId) {
                return res.status(400).json({ error: 'invalid_draft_post_id' });
            }

            const actor = await requireAuthenticatedActor(req, prisma as any, { requireSessionCookie: true });
            const access = await authorizeDraftActionForActor(prisma as any, {
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

            const grants = await grantStore.listDraftGrants({ draftPostId });
            const reconciled = await Promise.all(grants.map(async (grant) => {
                return expireTemporaryEditGrant(grantStore, {
                    grantId: grant.grantId,
                    now: new Date(),
                });
            }));

            return res.json({ grants: reconciled });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return next(error);
        }
    });

    router.post('/drafts/:postId/temporary-edit-grants', async (req, res) => {
        try {
            const draftPostId = asPositiveInteger(req.params.postId);
            const actor = await requireAuthenticatedActor(req, prisma as any, { requireSessionCookie: true });
            const blockId = asOptionalString(req.body?.blockId);
            const approvalMode = normalizeTemporaryEditGrantApprovalMode(req.body?.approvalMode ?? 'manager_confirm');
            const workingCopyHash = asOptionalString(req.body?.workingCopyHash)?.toLowerCase() ?? null;

            if (!draftPostId || !blockId || !approvalMode || !workingCopyHash || !/^[a-f0-9]{64}$/.test(workingCopyHash)) {
                return res.status(400).json({ error: 'invalid_temporary_edit_grant_input' });
            }
            if (!actorPubkeyMatchesSession(req.body?.actorPubkey, actor.pubkey)) {
                return res.status(403).json({ error: 'actor_pubkey_mismatch' });
            }

            const access = await authorizeDraftActionForActor(prisma as any, {
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
            const circleId = lifecycle.circleId;

            const grantId = randomUUID();
            const granteeUserId = asPositiveInteger(req.body?.granteeUserId) ?? actor.userId;
            if (approvalMode === 'governance_request') {
                const governed = await runInTransaction(prisma, async (tx) => {
                    const locked = await lockDraftParagraphStructure(tx, draftPostId);
                    if (!locked || locked.documentStatus !== 'drafting') {
                        return { status: 'stale_draft' as const };
                    }
                    const currentWorkingCopyHash = sha256Hex(locked.text);
                    if (currentWorkingCopyHash !== workingCopyHash) {
                        return {
                            status: 'working_copy_conflict' as const,
                            workingCopyHash: currentWorkingCopyHash,
                        };
                    }
                    const governance = await evaluateTemporaryEditGrantGovernance(tx, {
                        circleId,
                        draftPostId,
                        draftVersion: lifecycle.stableSnapshot.draftVersion,
                        grantId,
                        blockId,
                        granteeUserId,
                        requestedBy: actor.userId,
                        actorPubkey: actor.pubkey,
                        requestNote: asOptionalString(req.body?.requestNote),
                    }, { transactionClient: true });
                    if (governance.status === 'denied') {
                        return {
                            status: 'denied' as const,
                            error: governance.error,
                        };
                    }
                    const grant = await requestTemporaryEditGrant(createPrismaTemporaryEditGrantStore(tx), {
                        grantId,
                        draftPostId,
                        blockId,
                        granteeUserId,
                        requestedBy: actor.userId,
                        approvalMode,
                        governanceRequestId: String(governance.request.id),
                        requestNote: asOptionalString(req.body?.requestNote),
                        requestedAt: new Date(),
                    });
                    return {
                        status: 'requires_governance' as const,
                        grant,
                        governanceRequest: governance.request,
                    };
                });

                if (governed.status === 'denied') {
                    return res.status(409).json({ error: governed.error });
                }
                if (governed.status === 'stale_draft') {
                    return res.status(409).json({ error: 'temporary_edit_grant_requires_drafting' });
                }
                if (governed.status === 'working_copy_conflict') {
                    return res.status(409).json({
                        error: 'draft_working_copy_conflict',
                        workingCopyHash: governed.workingCopyHash,
                    });
                }
                return res.status(202).json({
                    status: 'requires_governance',
                    actionType: 'temporary_edit_grant.approve',
                    grant: governed.grant,
                    request: governed.governanceRequest,
                });
            }

            const managerResult = await runInTransaction(prisma, async (tx) => {
                const locked = await lockDraftParagraphStructure(tx, draftPostId);
                if (!locked || locked.documentStatus !== 'drafting') {
                    return { status: 'stale_draft' as const };
                }
                const currentWorkingCopyHash = sha256Hex(locked.text);
                if (currentWorkingCopyHash !== workingCopyHash) {
                    return {
                        status: 'working_copy_conflict' as const,
                        workingCopyHash: currentWorkingCopyHash,
                    };
                }
                const grant = await requestTemporaryEditGrant(createPrismaTemporaryEditGrantStore(tx), {
                    grantId,
                    draftPostId,
                    blockId,
                    granteeUserId,
                    requestedBy: actor.userId,
                    approvalMode,
                    governanceRequestId: null,
                    requestNote: asOptionalString(req.body?.requestNote),
                    requestedAt: new Date(),
                });
                return { status: 'created' as const, grant };
            });
            if (managerResult.status === 'stale_draft') {
                return res.status(409).json({ error: 'temporary_edit_grant_requires_drafting' });
            }
            if (managerResult.status === 'working_copy_conflict') {
                return res.status(409).json({
                    error: 'draft_working_copy_conflict',
                    workingCopyHash: managerResult.workingCopyHash,
                });
            }
            return res.json({ grant: managerResult.grant });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return res.status(400).json({
                error: error instanceof Error ? error.message : 'temporary_edit_grant_request_failed',
            });
        }
    });

    router.post('/grants/:grantId/issue', async (req, res) => {
        try {
            const actor = await requireAuthenticatedActor(req, prisma as any, { requireSessionCookie: true });
            const grantId = asOptionalString(req.params.grantId);
            if (!grantId) {
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

            await requireCircleManagerForActor(prisma as any, {
                actor,
                circleId: lifecycle.circleId,
                allowModerator: true,
            });

            if (grant.approvalMode === 'governance_request' && grant.governanceRequestId) {
                if (grant.status === 'active') {
                    return res.json({ grant });
                }
                const governanceRequest = await (prisma as any).governanceRequest.findUnique({
                    where: { id: grant.governanceRequestId },
                });
                const reconciled = await reconcileTemporaryEditGrantGovernance(grantStore, {
                    grantId,
                    governanceRequest,
                });
                if (reconciled.status === 'rejected' || reconciled.status === 'expired') {
                    return res.status(409).json({
                        error: 'temporary_edit_grant_governance_blocked',
                        grant: reconciled,
                    });
                }
                if (!governanceRequest || governanceRequest.state !== 'accepted') {
                    return res.status(409).json({
                        error: 'temporary_edit_grant_governance_not_accepted',
                        grant: reconciled,
                    });
                }
                return res.status(409).json({
                    error: 'temporary_edit_grant_governance_execution_required',
                    grant: reconciled,
                });
            }

            const now = new Date();
            const issued = await issueTemporaryEditGrant(grantStore, {
                grantId,
                grantedBy: actor.userId,
                grantedAt: now,
                expiresAt: addMinutes(now, asOptionalInteger(req.body?.expiresInMinutes) ?? 60),
            });

            return res.json({ grant: issued });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return res.status(400).json({
                error: error instanceof Error ? error.message : 'temporary_edit_grant_issue_failed',
            });
        }
    });

    router.post('/grants/:grantId/revoke', async (req, res) => {
        try {
            const actor = await requireAuthenticatedActor(req, prisma as any, { requireSessionCookie: true });
            const grantId = asOptionalString(req.params.grantId);
            if (!grantId) {
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

            await requireCircleManagerForActor(prisma as any, {
                actor,
                circleId: lifecycle.circleId,
                allowModerator: true,
            });

            const revoked = await revokeTemporaryEditGrant(grantStore, {
                grantId,
                revokedBy: actor.userId,
                revokedAt: new Date(),
            });

            return res.json({ grant: revoked });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return res.status(400).json({
                error: error instanceof Error ? error.message : 'temporary_edit_grant_revoke_failed',
            });
        }
    });

    return router;
}
