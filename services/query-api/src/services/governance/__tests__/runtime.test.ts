import type { GovernanceProposal, GovernanceVote } from '../../policy/types';
import { getGovernanceActionDefinition } from '../actionTypes';
import {
    createGovernanceProposal,
    markGovernanceProposalExecution,
    recordGovernanceVote,
    resolveGovernanceProposal,
    type GovernanceRuntimeStore,
} from '../runtime';

function createStore(): GovernanceRuntimeStore {
    const proposals = new Map<string, GovernanceProposal>();
    const votes = new Map<string, GovernanceVote>();

    return {
        async getProposal(proposalId: string) {
            return proposals.get(proposalId) ?? null;
        },
        async saveProposal(proposal: GovernanceProposal) {
            proposals.set(proposal.proposalId, proposal);
            return proposal;
        },
        async listVotes(proposalId: string) {
            return Array.from(votes.values())
                .filter((vote) => vote.proposalId === proposalId)
                .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
        },
        async saveVote(vote: GovernanceVote) {
            votes.set(`${vote.proposalId}:${vote.voterUserId}`, vote);
            return vote;
        },
    };
}

describe('governance runtime', () => {
    test('creates, resolves, and executes a vote-backed proposal with idempotent execution markers', async () => {
        const store = createStore();

        const proposal = await createGovernanceProposal(store, {
            proposalId: 'proposal-1',
            circleId: 7,
            actionType: 'crystallization',
            targetType: 'draft_post',
            targetId: '99',
            createdBy: 11,
            electorateScope: 'contributors_of_current_draft',
            voteRule: 'threshold_count',
            thresholdValue: 2,
            quorum: null,
            policyProfileDigest: 'digest-1',
            opensAt: new Date('2026-03-21T00:00:00.000Z'),
            closesAt: new Date('2026-03-21T01:00:00.000Z'),
            configSnapshot: { draftPostId: 99 },
        });

        expect(proposal.status).toBe('active');
        expect(proposal.policyProfileDigest).toBe('digest-1');

        await recordGovernanceVote(store, {
            proposalId: proposal.proposalId,
            voterUserId: 21,
            vote: 'approve',
            reason: null,
            createdAt: new Date('2026-03-21T00:05:00.000Z'),
        });
        await recordGovernanceVote(store, {
            proposalId: proposal.proposalId,
            voterUserId: 22,
            vote: 'approve',
            reason: 'ship it',
            createdAt: new Date('2026-03-21T00:06:00.000Z'),
        });

        const passed = await resolveGovernanceProposal(store, {
            proposalId: proposal.proposalId,
            now: new Date('2026-03-21T00:10:00.000Z'),
        });

        expect(passed.status).toBe('passed');

        const executed = await markGovernanceProposalExecution(store, {
            proposalId: proposal.proposalId,
            executionMarker: 'exec-1',
            now: new Date('2026-03-21T00:11:00.000Z'),
        });
        const repeated = await markGovernanceProposalExecution(store, {
            proposalId: proposal.proposalId,
            executionMarker: 'exec-1',
            now: new Date('2026-03-21T00:12:00.000Z'),
        });

        expect(executed.status).toBe('executed');
        expect(repeated.executionMarker).toBe('exec-1');
        await expect(markGovernanceProposalExecution(store, {
            proposalId: proposal.proposalId,
            executionMarker: 'exec-2',
            now: new Date('2026-03-21T00:13:00.000Z'),
        })).rejects.toThrow('already has a different execution marker');
    });

    test('allows fork to reuse governance action typing without forcing vote flow', async () => {
        const store = createStore();

        expect(getGovernanceActionDefinition('fork').voteMode).toBe('none');

        const proposal = await createGovernanceProposal(store, {
            proposalId: 'fork-1',
            circleId: 7,
            actionType: 'fork',
            targetType: 'circle',
            targetId: '7',
            createdBy: 15,
            policyProfileDigest: 'digest-fork',
            configSnapshot: { sourceCircleId: 7 },
        });

        expect(proposal.status).toBe('passed');
        await expect(recordGovernanceVote(store, {
            proposalId: proposal.proposalId,
            voterUserId: 15,
            vote: 'approve',
            reason: null,
            createdAt: new Date('2026-03-21T00:00:00.000Z'),
        })).rejects.toThrow('does not support vote flow');
    });
});
