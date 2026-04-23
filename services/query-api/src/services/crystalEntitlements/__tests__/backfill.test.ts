import { afterEach, describe, expect, jest, test } from '@jest/globals';

import {
    hasCrystalEntitlementSetMismatch,
    runCrystalEntitlementBackfill,
} from '../backfill';

jest.mock('../reconcile', () => ({
    reconcileCrystalEntitlements: jest.fn(),
}));

const {
    reconcileCrystalEntitlements: reconcileCrystalEntitlementsMock,
} = jest.requireMock('../reconcile') as {
    reconcileCrystalEntitlements: jest.Mock;
};

describe('crystal entitlement backfill', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    test('reports zero remaining missing rows after apply repairs the detected gaps', async () => {
        (reconcileCrystalEntitlementsMock as any).mockResolvedValue({
            processedKnowledgeCount: 1,
            totalEntitlements: 2,
            knowledgeRowIds: [9],
        });
        const queryRaw: any = jest.fn();
        queryRaw.mockImplementationOnce(async () => ([
            {
                id: 9,
                knowledgeId: 'knowledge-9',
                contributorCount: 2,
                activeEntitlementCount: 1,
                contributorPubkeys: ['author-pubkey', 'discussant-pubkey'],
                activeEntitlementOwnerPubkeys: ['author-pubkey'],
            },
        ]));
        queryRaw.mockImplementationOnce(async () => ([]));
        queryRaw.mockImplementationOnce(async () => ([]));
        const prisma = {
            $queryRaw: queryRaw,
        } as any;

        const summary = await runCrystalEntitlementBackfill(prisma, {
            apply: true,
            batchSize: 100,
            knowledgeRowId: null,
            requireZeroMissing: true,
        });

        expect(summary).toMatchObject({
            mode: 'apply',
            scanned: 1,
            missingKnowledgeCountBeforeRepair: 1,
            missingKnowledgeCount: 0,
            repairedKnowledgeCount: 1,
            repairedEntitlementCount: 2,
        });
        expect(reconcileCrystalEntitlementsMock).toHaveBeenCalledWith(prisma, {
            knowledgeRowId: 9,
            limit: 1,
        });
        expect(queryRaw).toHaveBeenCalledTimes(3);
    });

    test('treats equal-cardinality but different pubkey sets as mismatched', () => {
        expect(hasCrystalEntitlementSetMismatch({
            contributorPubkeys: ['author-pubkey', 'discussant-pubkey'],
            activeEntitlementOwnerPubkeys: ['author-pubkey', 'someone-else'],
        })).toBe(true);
        expect(hasCrystalEntitlementSetMismatch({
            contributorPubkeys: ['author-pubkey', 'discussant-pubkey'],
            activeEntitlementOwnerPubkeys: ['discussant-pubkey', 'author-pubkey'],
        })).toBe(false);
    });
});
