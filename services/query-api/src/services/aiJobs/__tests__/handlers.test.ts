import { describe, expect, jest, test } from '@jest/globals';

jest.mock('../../../ai/discussion-draft-trigger', () => ({
    maybeTriggerGhostDraftFromDiscussion: jest.fn(),
}));

jest.mock('../../../ai/ghost-draft', () => ({
    generateGhostDraft: jest.fn(),
}));

jest.mock('../../discussion/analysis/enqueue', () => ({
    runDiscussionMessageAnalyzeJob: jest.fn(),
}));

jest.mock('../../discussion/analysis/invalidation', () => ({
    runDiscussionCircleReanalyzeJob: jest.fn(),
}));

jest.mock('../../ghostDraft/acceptance', () => ({
    acceptGhostDraftIntoWorkingCopy: jest.fn(),
}));

jest.mock('../../crystalAssets/jobs', () => ({
    issueCrystalAssetJob: jest.fn(),
}));

jest.mock('../../crystalAssets/mintAdapter', () => ({
    createCrystalMintAdapter: jest.fn(() => {
        throw new Error('bad_crystal_mint_config');
    }),
}));

import { createAiJobHandlers } from '../handlers';

const {
    createCrystalMintAdapter: createCrystalMintAdapterMock,
} = jest.requireMock('../../crystalAssets/mintAdapter') as {
    createCrystalMintAdapter: jest.Mock;
};

describe('ai job handlers', () => {
    test('does not initialize the crystal mint adapter until a crystal issuance job runs', async () => {
        const handlers = createAiJobHandlers({
            prisma: {} as any,
            redis: {} as any,
        });

        expect(createCrystalMintAdapterMock).not.toHaveBeenCalled();
        await expect(handlers.crystal_asset_issue?.({
            job: {
                payload: {
                    knowledgeRowId: 9,
                },
            } as any,
            prisma: {} as any,
            redis: {} as any,
        } as any)).rejects.toThrow('bad_crystal_mint_config');
        expect(createCrystalMintAdapterMock).toHaveBeenCalledTimes(1);
    });
});
