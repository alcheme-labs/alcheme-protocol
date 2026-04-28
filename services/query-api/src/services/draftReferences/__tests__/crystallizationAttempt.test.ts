import { describe, expect, jest, test } from '@jest/globals';

import {
    findLatestResumableCrystallizationAttemptForDraft,
    findResumableCrystallizationAttempt,
    markCrystallizationAttemptBindingSynced,
    markCrystallizationAttemptFinalizationFailed,
    markCrystallizationAttemptFinalized,
    markCrystallizationAttemptReferencesFailed,
    markCrystallizationAttemptReferencesSynced,
    upsertCrystallizationAttempt,
} from '../crystallizationAttempt';

const HASH = 'a'.repeat(64);

function attemptRow(overrides: Record<string, unknown> = {}) {
    return {
        id: BigInt(1),
        draftPostId: 42,
        proofPackageHash: HASH,
        knowledgeId: null,
        knowledgeOnChainAddress: 'NewPda111111111111111111111111111111111',
        status: 'binding_pending',
        failureCode: null,
        failureMessage: null,
        createdAt: new Date('2026-04-27T00:00:00.000Z'),
        updatedAt: new Date('2026-04-27T00:00:00.000Z'),
        ...overrides,
    };
}

function sqlText(value: unknown): string {
    if (value && typeof value === 'object' && Array.isArray((value as { strings?: unknown }).strings)) {
        return ((value as { strings: string[] }).strings).join('?');
    }
    return String(value);
}

describe('draft crystallization attempt recovery record', () => {
    test('upserts a binding-pending attempt and preserves the existing on-chain address for retry', async () => {
        const prisma = {
            $queryRaw: jest.fn(async () => [attemptRow()]),
        } as any;

        const result = await upsertCrystallizationAttempt(prisma, {
            draftPostId: 42,
            proofPackageHash: HASH.toUpperCase(),
            knowledgeOnChainAddress: 'NewPda111111111111111111111111111111111',
        });

        expect(result).toMatchObject({
            draftPostId: 42,
            proofPackageHash: HASH,
            knowledgeId: null,
            knowledgeOnChainAddress: 'NewPda111111111111111111111111111111111',
            status: 'binding_pending',
        });
        expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
        expect(sqlText(prisma.$queryRaw.mock.calls[0][0])).toContain('ON CONFLICT');
        expect(sqlText(prisma.$queryRaw.mock.calls[0][0])).toContain('knowledge_on_chain_address');
    });

    test('finds only same-proof resumable attempts and ignores finalized attempts', async () => {
        const prisma = {
            $queryRaw: jest.fn(async () => [attemptRow({ status: 'references_failed' })]),
        } as any;

        const result = await findResumableCrystallizationAttempt(prisma, {
            draftPostId: 42,
            proofPackageHash: HASH,
        });

        expect(result?.status).toBe('references_failed');
        expect(sqlText(prisma.$queryRaw.mock.calls[0][0])).toContain('proof_package_hash');
        expect(sqlText(prisma.$queryRaw.mock.calls[0][0])).toContain('status IN');
        expect(sqlText(prisma.$queryRaw.mock.calls[0][0])).not.toContain('= finalized');
    });

    test('finds the latest resumable attempt for lifecycle retry surfaces', async () => {
        const prisma = {
            $queryRaw: jest.fn(async () => [attemptRow({ status: 'finalization_failed' })]),
        } as any;

        const result = await findLatestResumableCrystallizationAttemptForDraft(prisma, {
            draftPostId: 42,
        });

        expect(result?.status).toBe('finalization_failed');
        expect(sqlText(prisma.$queryRaw.mock.calls[0][0])).toContain('ORDER BY updated_at DESC');
    });

    test('backfills knowledge id when binding sync succeeds', async () => {
        const prisma = {
            $queryRaw: jest.fn(async () => [attemptRow({
                knowledgeId: 'K-new',
                status: 'binding_synced',
            })]),
        } as any;

        const result = await markCrystallizationAttemptBindingSynced(prisma, {
            draftPostId: 42,
            proofPackageHash: HASH,
            knowledgeId: 'K-new',
        });

        expect(result).toMatchObject({
            knowledgeId: 'K-new',
            status: 'binding_synced',
        });
    });

    test('records reference and lifecycle failure statuses without leaking raw config', async () => {
        const queryRaw = jest.fn<() => Promise<any[]>>()
                .mockResolvedValueOnce([attemptRow({
                    status: 'references_failed',
                    failureCode: 'reference_materialization_failed',
                    failureMessage: 'RPC confirmation failed after retry',
                })])
                .mockResolvedValueOnce([attemptRow({
                    status: 'finalization_failed',
                    failureCode: 'draft_lifecycle_finalize_failed',
                    failureMessage: 'Draft lifecycle finalization failed',
                })]);
        const prisma = {
            $queryRaw: queryRaw,
        } as any;

        await expect(markCrystallizationAttemptReferencesFailed(prisma, {
            draftPostId: 42,
            proofPackageHash: HASH,
            failureCode: 'reference_materialization_failed',
            failureMessage: 'RPC confirmation failed after retry',
        })).resolves.toMatchObject({
            status: 'references_failed',
            failureCode: 'reference_materialization_failed',
        });
        await expect(markCrystallizationAttemptFinalizationFailed(prisma, {
            draftPostId: 42,
            proofPackageHash: HASH,
            failureCode: 'draft_lifecycle_finalize_failed',
            failureMessage: 'Draft lifecycle finalization failed',
        })).resolves.toMatchObject({
            status: 'finalization_failed',
            failureCode: 'draft_lifecycle_finalize_failed',
        });
    });

    test('marks synced and finalized terminal states', async () => {
        const queryRaw = jest.fn<() => Promise<any[]>>()
                .mockResolvedValueOnce([attemptRow({ status: 'references_synced' })])
                .mockResolvedValueOnce([attemptRow({ status: 'finalized' })]);
        const prisma = {
            $queryRaw: queryRaw,
        } as any;

        await expect(markCrystallizationAttemptReferencesSynced(prisma, {
            draftPostId: 42,
            proofPackageHash: HASH,
        })).resolves.toMatchObject({
            status: 'references_synced',
        });
        await expect(markCrystallizationAttemptFinalized(prisma, {
            draftPostId: 42,
            proofPackageHash: HASH,
        })).resolves.toMatchObject({
            status: 'finalized',
        });
    });
});
