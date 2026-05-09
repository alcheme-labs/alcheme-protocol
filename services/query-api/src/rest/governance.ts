import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { normalizeGovernanceActionType } from '../services/governance/actionTypes';
import {
    buildGovernanceAuditAnchorPackage,
    buildGovernanceAuditDigestSet,
    type GovernanceAuditDigestSet,
    type GovernanceAuditAnchorPackage,
} from '../services/governance/auditAnchor';
import {
    createPrismaGovernanceEngineStore,
    recordExecutionReceipt,
} from '../services/governance/policyEngine';
import {
    createGovernanceProposal,
    createPrismaGovernanceRuntimeStore,
    markGovernanceProposalExecution,
    recordGovernanceVote,
    resolveGovernanceProposal,
} from '../services/governance/runtime';
import { computePolicyProfileDigest } from '../services/policy/digest';
import {
    buildPublicPolicyDigestSnapshot,
    resolveCirclePolicyProfile,
} from '../services/policy/profile';

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

function asRequiredString(value: unknown): string | null {
    const normalized = asOptionalString(value);
    return normalized && normalized.length > 0 ? normalized : null;
}

function normalizeVote(value: unknown): 'approve' | 'reject' | 'abstain' | null {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'approve') return 'approve';
    if (normalized === 'reject') return 'reject';
    if (normalized === 'abstain') return 'abstain';
    return null;
}

export function governanceRouter(prisma: PrismaClient, _redis: Redis): Router {
    const router = Router();
    const store = createPrismaGovernanceRuntimeStore(prisma);

    router.get('/proposals/:proposalId', async (req, res) => {
        const proposal = await store.getProposal(String(req.params.proposalId || ''));
        if (!proposal) {
            res.status(404).json({ error: 'proposal_not_found' });
            return;
        }
        const votes = await store.listVotes(proposal.proposalId);
        res.json({ proposal, votes });
    });

    router.post('/proposals', async (req, res) => {
        try {
            const requestUserId = (req as typeof req & { userId?: unknown }).userId;
            const circleId = asPositiveInteger(req.body?.circleId);
            const actionType = normalizeGovernanceActionType(req.body?.actionType);
            const targetType = asOptionalString(req.body?.targetType);
            const targetId = asOptionalString(req.body?.targetId);

            if (!circleId || !actionType || !targetType || !targetId) {
                res.status(400).json({ error: 'invalid_governance_proposal_input' });
                return;
            }

            const profile = await resolveCirclePolicyProfile(prisma, circleId);
            const policyProfileDigest = computePolicyProfileDigest(
                buildPublicPolicyDigestSnapshot(profile),
            );

            const proposal = await createGovernanceProposal(store, {
                proposalId: asOptionalString(req.body?.proposalId) ?? randomUUID(),
                circleId,
                actionType,
                targetType,
                targetId,
                targetVersion: asOptionalInteger(req.body?.targetVersion),
                createdBy: asOptionalInteger(requestUserId ?? req.body?.createdBy),
                electorateScope: req.body?.electorateScope ?? null,
                voteRule: req.body?.voteRule ?? null,
                thresholdValue: asOptionalInteger(req.body?.thresholdValue),
                quorum: asOptionalInteger(req.body?.quorum),
                policyProfileDigest,
                configSnapshot: (req.body?.configSnapshot && typeof req.body.configSnapshot === 'object')
                    ? req.body.configSnapshot as Record<string, unknown>
                    : null,
            });

            res.json({ proposal });
        } catch (error) {
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_proposal_create_failed',
            });
        }
    });

    router.post('/proposals/:proposalId/votes', async (req, res) => {
        try {
            const requestUserId = (req as typeof req & { userId?: unknown }).userId;
            const vote = normalizeVote(req.body?.vote);
            const voterUserId = asPositiveInteger(requestUserId ?? req.body?.voterUserId);
            if (!vote || !voterUserId) {
                res.status(400).json({ error: 'invalid_governance_vote_input' });
                return;
            }

            const recordedVote = await recordGovernanceVote(store, {
                proposalId: String(req.params.proposalId || ''),
                voterUserId,
                vote,
                reason: asOptionalString(req.body?.reason),
                createdAt: new Date(),
            });

            res.json({ vote: recordedVote });
        } catch (error) {
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_vote_record_failed',
            });
        }
    });

    router.post('/proposals/:proposalId/resolve', async (req, res) => {
        try {
            const proposal = await resolveGovernanceProposal(store, {
                proposalId: String(req.params.proposalId || ''),
                now: new Date(),
            });
            res.json({ proposal });
        } catch (error) {
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_proposal_resolve_failed',
            });
        }
    });

    router.post('/proposals/:proposalId/execute', async (req, res) => {
        try {
            const proposal = await markGovernanceProposalExecution(store, {
                proposalId: String(req.params.proposalId || ''),
                executionMarker: asOptionalString(req.body?.executionMarker) ?? randomUUID(),
                executionError: asOptionalString(req.body?.executionError),
                now: new Date(),
            });
            res.json({ proposal });
        } catch (error) {
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_proposal_execute_failed',
            });
        }
    });

    router.post('/requests/:requestId/execution-receipts', async (req, res) => {
        try {
            const requestId = asRequiredString(req.params.requestId);
            const actionType = asRequiredString(req.body?.actionType);
            const executorModule = asRequiredString(req.body?.executorModule);
            const executionStatus = asRequiredString(req.body?.executionStatus);
            const idempotencyKey = asRequiredString(req.body?.idempotencyKey);
            if (
                !requestId
                || !actionType
                || !executorModule
                || !idempotencyKey
                || !['executed', 'failed', 'skipped'].includes(executionStatus ?? '')
            ) {
                res.status(400).json({ error: 'invalid_governance_execution_receipt_input' });
                return;
            }

            const receipt = await recordExecutionReceipt(
                createPrismaGovernanceEngineStore(prisma),
                {
                    id: asOptionalString(req.body?.id) ?? randomUUID(),
                    requestId,
                    actionType,
                    executorModule,
                    executionStatus: executionStatus as 'executed' | 'failed' | 'skipped',
                    executionRef: asOptionalString(req.body?.executionRef),
                    errorCode: asOptionalString(req.body?.errorCode),
                    idempotencyKey,
                    executedAt: new Date(),
                },
            );
            res.status(201).json({ receipt });
        } catch (error) {
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_execution_receipt_record_failed',
            });
        }
    });

    router.get('/requests/:requestId/audit', async (req, res) => {
        try {
            const requestId = asRequiredString(req.params.requestId);
            if (!requestId) {
                res.status(400).json({ error: 'invalid_governance_request_id' });
                return;
            }
            const request = await prisma.governanceRequest.findUnique({
                where: { id: requestId },
                include: {
                    policyVersionRecord: {
                        select: {
                            configDigest: true,
                        },
                    },
                    snapshot: true,
                    signals: {
                        orderBy: { createdAt: 'asc' },
                    },
                    decision: true,
                    receipts: {
                        orderBy: { executedAt: 'asc' },
                    },
                },
            }) as unknown as (null | {
                id: string;
                policyId: string;
                policyVersionId: string;
                policyVersion: number;
                ruleId: string;
                scopeType: string;
                scopeRef: string;
                actionType: string;
                targetType: string;
                targetRef: string;
                payload: Record<string, unknown>;
                idempotencyKey: string;
                proposerPubkey: string;
                state: string;
                openedAt: Date;
                expiresAt: Date | null;
                policyVersionRecord?: { configDigest?: string | null } | null;
                snapshot?: { sourceDigest?: string | null } | null;
                signals?: Array<any>;
                decision?: { decisionDigest?: string | null } | null;
                receipts?: Array<any>;
            });
            if (!request) {
                res.status(404).json({ error: 'governance_request_not_found' });
                return;
            }

            const digestSet: GovernanceAuditDigestSet = buildGovernanceAuditDigestSet({
                request,
                snapshot: request.snapshot ?? null,
                signals: request.signals ?? [],
                decision: request.decision ?? null,
                receipts: request.receipts ?? [],
            });
            const anchorPackage: GovernanceAuditAnchorPackage = buildGovernanceAuditAnchorPackage({
                request,
                digestSet,
            });

            res.json({
                audit: {
                    requestId,
                    digestSet,
                    anchorPayload: anchorPackage.anchorPayload,
                    memoText: anchorPackage.memoText,
                    settlement: {
                        adapterId: 'solana-l1',
                        chainFamily: 'svm',
                        submissionStatus: 'not_submitted',
                    },
                },
            });
        } catch (error) {
            res.status(400).json({
                error: error instanceof Error ? error.message : 'governance_audit_lookup_failed',
            });
        }
    });

    return router;
}
