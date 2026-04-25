import { jest } from '@jest/globals';

const resolveCandidateGenerationGovernanceReadModelMock: any = jest.fn();

jest.mock('../../governance/read-models', () => ({
    resolveCandidateGenerationGovernanceReadModel: (...args: unknown[]) =>
        resolveCandidateGenerationGovernanceReadModelMock(...args),
}));

import {
    buildDraftCandidateId,
    buildNoticeEventKey,
    publishDraftCandidateSystemNotices,
    resolveCandidateStateForNotice,
} from '../systemNoticeProducer';

describe('systemNoticeProducer', () => {
    beforeEach(() => {
        resolveCandidateGenerationGovernanceReadModelMock.mockReset();
    });

    test('buildDraftCandidateId is deterministic for same source message set', () => {
        const first = buildDraftCandidateId({
            circleId: 7,
            sourceMessageIds: ['env_1', 'env_2', 'env_3'],
        });
        const second = buildDraftCandidateId({
            circleId: 7,
            sourceMessageIds: ['env_1', 'env_2', 'env_3'],
        });

        expect(first).toBe(second);
        expect(first.startsWith('cand_')).toBe(true);
    });

    test('promotes open/proposal_active to accepted when draft post is already created', () => {
        expect(resolveCandidateStateForNotice({
            governanceState: 'open',
            draftPostId: 101,
        })).toBe('accepted');

        expect(resolveCandidateStateForNotice({
            governanceState: 'proposal_active',
            draftPostId: 101,
        })).toBe('accepted');
    });

    test('keeps generation_failed even when draftPostId is absent', () => {
        expect(resolveCandidateStateForNotice({
            governanceState: 'generation_failed',
            draftPostId: null,
        })).toBe('generation_failed');
    });

    test('notice event key separates distinct draft generation failures for the same candidate', () => {
        const first = buildNoticeEventKey({
            kind: 'draft_candidate_notice',
            candidateId: 'cand_001',
            state: 'generation_failed',
            draftPostId: null,
            proposalId: null,
            executionError: null,
            draftGenerationStatus: 'generation_failed',
            draftGenerationError: 'initial_draft_generation_failed',
            draftGenerationSourceDigest: 'a'.repeat(64),
        });
        const second = buildNoticeEventKey({
            kind: 'draft_candidate_notice',
            candidateId: 'cand_001',
            state: 'generation_failed',
            draftPostId: null,
            proposalId: null,
            executionError: null,
            draftGenerationStatus: 'generation_failed',
            draftGenerationError: 'initial_draft_generation_unparseable',
            draftGenerationSourceDigest: 'a'.repeat(64),
        });
        const third = buildNoticeEventKey({
            kind: 'draft_candidate_notice',
            candidateId: 'cand_001',
            state: 'generation_failed',
            draftPostId: null,
            proposalId: null,
            executionError: null,
            draftGenerationStatus: 'generation_failed',
            draftGenerationError: 'initial_draft_generation_failed',
            draftGenerationSourceDigest: 'b'.repeat(64),
        });

        expect(first).not.toBe(second);
        expect(first).not.toBe(third);
    });

    test('publishes realtime event when a candidate notice row is inserted', async () => {
        resolveCandidateGenerationGovernanceReadModelMock.mockResolvedValue({
            candidateStatus: 'open',
            proposal: null,
            failureRecovery: {
                failedStatus: 'generation_failed',
                canRetryExecutionRoles: [],
                retryExecutionReusesPassedProposal: false,
                canCancelRoles: [],
            },
        });

        const tx = {
            $queryRaw: jest.fn(async () => ([{
                envelopeId: 'env-candidate-notice',
                lamport: 88n,
            }])),
            $executeRaw: jest.fn(async () => 1),
        };
        const prisma = {
            $queryRaw: jest.fn(async () => []),
            $transaction: jest.fn(async (callback: any) => callback(tx)),
        };
        const redis = {
            publish: jest.fn(async () => 1),
        };

        await publishDraftCandidateSystemNotices(
            prisma as any,
            {
                circleId: 7,
                summary: 'summary',
                sourceMessageIds: ['env-1', 'env-2'],
                sourceSemanticFacets: ['question'],
                sourceAuthorAnnotations: [],
                draftPostId: null,
                triggerReason: 'notify_only',
            },
            redis as any,
        );

        expect(redis.publish).toHaveBeenCalledWith(
            'discussion:circle:7',
            JSON.stringify({
                circleId: 7,
                latestLamport: 88,
                envelopeId: 'env-candidate-notice',
                reason: 'candidate_notice_updated',
            }),
        );
    });
});
