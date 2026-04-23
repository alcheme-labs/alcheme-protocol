import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { normalizeGovernanceActionType } from '../services/governance/actionTypes';
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

    return router;
}
