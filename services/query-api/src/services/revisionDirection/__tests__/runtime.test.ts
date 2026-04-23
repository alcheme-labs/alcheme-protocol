import { describe, expect, test } from '@jest/globals';

import {
    acceptRevisionDirectionProposal,
    createRevisionDirectionProposal,
    listAcceptedRevisionDirectionsForNextRound,
    reconcileRevisionDirectionProposalGovernance,
    type RevisionDirectionProposalRecord,
    type RevisionDirectionStore,
} from '../runtime';

function createInMemoryStore() {
    const proposals = new Map<string, RevisionDirectionProposalRecord>();

    const store: RevisionDirectionStore = {
        async getProposal(revisionProposalId) {
            return proposals.get(revisionProposalId) ?? null;
        },
        async saveProposal(proposal) {
            proposals.set(proposal.revisionProposalId, proposal);
            return proposal;
        },
        async listDraftProposals(input) {
            return Array.from(proposals.values())
                .filter((proposal) => (
                    proposal.draftPostId === input.draftPostId
                    && (input.draftVersion == null || proposal.draftVersion === input.draftVersion)
                ))
                .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
        },
    };

    return { store, proposals };
}

describe('revision direction runtime', () => {
    test('creates minimal revision direction proposals across the frozen acceptance modes', async () => {
        const { store } = createInMemoryStore();

        const managerProposal = await createRevisionDirectionProposal(store, {
            revisionProposalId: 'rd-manager',
            draftPostId: 42,
            draftVersion: 3,
            scopeType: 'document',
            scopeRef: 'document',
            proposedBy: 9,
            summary: '聚焦补充前提条件与反例。',
            acceptanceMode: 'manager_confirm',
            createdAt: new Date('2026-03-22T09:00:00.000Z'),
        });
        const roleProposal = await createRevisionDirectionProposal(store, {
            revisionProposalId: 'rd-role',
            draftPostId: 42,
            draftVersion: 3,
            scopeType: 'paragraph',
            scopeRef: 'paragraph:2',
            proposedBy: 10,
            summary: '把第二段改写成因果链说明。',
            acceptanceMode: 'role_confirm',
            createdAt: new Date('2026-03-22T09:05:00.000Z'),
        });
        const governanceProposal = await createRevisionDirectionProposal(store, {
            revisionProposalId: 'rd-governance',
            draftPostId: 42,
            draftVersion: 3,
            scopeType: 'structure',
            scopeRef: 'paragraph:2,paragraph:3',
            proposedBy: 11,
            summary: '下一轮先重排结构，再统一定义术语。',
            acceptanceMode: 'governance_vote',
            governanceProposalId: 'gov-rd-1',
            createdAt: new Date('2026-03-22T09:10:00.000Z'),
        });

        expect(managerProposal.acceptanceMode).toBe('manager_confirm');
        expect(roleProposal.acceptanceMode).toBe('role_confirm');
        expect(governanceProposal.acceptanceMode).toBe('governance_vote');
        expect(governanceProposal.governanceProposalId).toBe('gov-rd-1');
        expect(governanceProposal.status).toBe('open');
    });

    test('requires governance linkage when acceptanceMode is governance_vote', async () => {
        const { store } = createInMemoryStore();

        await expect(createRevisionDirectionProposal(store, {
            revisionProposalId: 'rd-missing-governance',
            draftPostId: 42,
            draftVersion: 3,
            scopeType: 'document',
            scopeRef: 'document',
            proposedBy: 9,
            summary: '没有治理 proposal id 的提案不应创建成功。',
            acceptanceMode: 'governance_vote',
            createdAt: new Date('2026-03-22T09:00:00.000Z'),
        })).rejects.toThrow('revision_direction_governance_proposal_required');
    });

    test('accepts manager_confirm and role_confirm proposals via direct confirmation', async () => {
        const { store } = createInMemoryStore();

        await createRevisionDirectionProposal(store, {
            revisionProposalId: 'rd-direct-manager',
            draftPostId: 42,
            draftVersion: 3,
            scopeType: 'document',
            scopeRef: 'document',
            proposedBy: 9,
            summary: '先补齐论证边界，再合并措辞。',
            acceptanceMode: 'manager_confirm',
            createdAt: new Date('2026-03-22T09:00:00.000Z'),
        });
        await createRevisionDirectionProposal(store, {
            revisionProposalId: 'rd-direct-role',
            draftPostId: 42,
            draftVersion: 3,
            scopeType: 'paragraph',
            scopeRef: 'paragraph:4',
            proposedBy: 10,
            summary: '第四段需要补上来源解释。',
            acceptanceMode: 'role_confirm',
            createdAt: new Date('2026-03-22T09:05:00.000Z'),
        });

        const managerAccepted = await acceptRevisionDirectionProposal(store, {
            revisionProposalId: 'rd-direct-manager',
            acceptedBy: 21,
            acceptedAt: new Date('2026-03-22T10:00:00.000Z'),
        });
        const roleAccepted = await acceptRevisionDirectionProposal(store, {
            revisionProposalId: 'rd-direct-role',
            acceptedBy: 22,
            acceptedAt: new Date('2026-03-22T10:05:00.000Z'),
        });

        expect(managerAccepted.status).toBe('accepted');
        expect(managerAccepted.acceptedBy).toBe(21);
        expect(roleAccepted.status).toBe('accepted');
        expect(roleAccepted.acceptedBy).toBe(22);
    });

    test('accepts governance_vote proposals only after linked governance execution succeeds', async () => {
        const { store } = createInMemoryStore();

        await createRevisionDirectionProposal(store, {
            revisionProposalId: 'rd-governance-sync',
            draftPostId: 42,
            draftVersion: 3,
            scopeType: 'document',
            scopeRef: 'document',
            proposedBy: 9,
            summary: '治理通过后，下一轮先做结构修订。',
            acceptanceMode: 'governance_vote',
            governanceProposalId: 'gov-rd-sync',
            createdAt: new Date('2026-03-22T09:00:00.000Z'),
        });

        const accepted = await reconcileRevisionDirectionProposalGovernance(store, {
            revisionProposalId: 'rd-governance-sync',
            governanceProposal: {
                proposalId: 'gov-rd-sync',
                status: 'executed',
                executionMarker: 'marker-1',
                executedAt: new Date('2026-03-22T11:00:00.000Z'),
            },
        });

        expect(accepted.status).toBe('accepted');
        expect(accepted.acceptedAt?.toISOString()).toBe('2026-03-22T11:00:00.000Z');
        expect(accepted.governanceProposalId).toBe('gov-rd-sync');
    });

    test('lists accepted directions as next-round drafting inputs', async () => {
        const { store } = createInMemoryStore();

        await createRevisionDirectionProposal(store, {
            revisionProposalId: 'rd-next-round-1',
            draftPostId: 42,
            draftVersion: 3,
            scopeType: 'document',
            scopeRef: 'document',
            proposedBy: 9,
            summary: '下一轮先合并重复观点。',
            acceptanceMode: 'manager_confirm',
            createdAt: new Date('2026-03-22T09:00:00.000Z'),
        });
        await createRevisionDirectionProposal(store, {
            revisionProposalId: 'rd-next-round-2',
            draftPostId: 42,
            draftVersion: 3,
            scopeType: 'paragraph',
            scopeRef: 'paragraph:3',
            proposedBy: 11,
            summary: '第三段改成反驳-回应结构。',
            acceptanceMode: 'role_confirm',
            createdAt: new Date('2026-03-22T09:05:00.000Z'),
        });

        await acceptRevisionDirectionProposal(store, {
            revisionProposalId: 'rd-next-round-1',
            acceptedBy: 31,
            acceptedAt: new Date('2026-03-22T10:00:00.000Z'),
        });

        const nextRoundInputs = await listAcceptedRevisionDirectionsForNextRound(store, {
            draftPostId: 42,
            draftVersion: 3,
        });

        expect(nextRoundInputs).toHaveLength(1);
        expect(nextRoundInputs[0]).toMatchObject({
            revisionProposalId: 'rd-next-round-1',
            status: 'accepted',
            summary: '下一轮先合并重复观点。',
        });
    });
});
