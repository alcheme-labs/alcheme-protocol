import { describe, expect, jest, test } from '@jest/globals';

import * as readModel from '../readModel';
import {
    DraftReferenceMaterializationError,
    materializeDraftCrystalReferencesOrThrow,
} from '../materialization';

function link(overrides: Record<string, unknown> = {}) {
    return {
        referenceId: 'ref-1',
        draftPostId: 42,
        draftVersion: 1,
        sourceBlockId: 'paragraph:0',
        crystalName: 'Old Crystal',
        crystalBlockAnchor: null,
        sourceKnowledgeId: 'K-old',
        sourceOnChainAddress: 'Old111111111111111111111111111111111111111',
        resolutionStatus: 'resolved',
        status: 'parsed',
        ...overrides,
    } as any;
}

function materialize(referenceLinks: any[]) {
    jest.spyOn(readModel, 'loadDraftReferenceLinks').mockResolvedValue(referenceLinks);
    const referenceClient = {
        addReferences: jest.fn(async () => ['sig-1']),
    };
    return {
        referenceClient,
        promise: materializeDraftCrystalReferencesOrThrow({} as any, {
            draftPostId: 42,
            targetKnowledgeId: 'K-new',
            targetOnChainAddress: 'New111111111111111111111111111111111111111',
            requestedByUserId: 9,
            referenceClient,
        }),
    };
}

describe('draft crystal reference materialization', () => {
    test('does not submit anything when the draft has no crystal references', async () => {
        const { referenceClient, promise } = materialize([]);

        await expect(promise).resolves.toEqual({
            attempted: 0,
            succeeded: 0,
            skipped: 0,
            signatures: [],
        });
        expect(referenceClient.addReferences).not.toHaveBeenCalled();
    });

    test('fails unresolved references before chain submission', async () => {
        const { referenceClient, promise } = materialize([
            link({
                sourceKnowledgeId: null,
                sourceOnChainAddress: null,
                resolutionStatus: 'not_found',
            }),
        ]);

        await expect(promise).rejects.toMatchObject({
            code: 'draft_reference_unresolved',
        });
        expect(referenceClient.addReferences).not.toHaveBeenCalled();
    });

    test('fails ambiguous references before chain submission', async () => {
        const { referenceClient, promise } = materialize([
            link({
                sourceKnowledgeId: null,
                sourceOnChainAddress: null,
                resolutionStatus: 'ambiguous',
            }),
        ]);

        await expect(promise).rejects.toMatchObject({
            code: 'draft_reference_ambiguous',
        });
        expect(referenceClient.addReferences).not.toHaveBeenCalled();
    });

    test('deduplicates and submits new crystal to old crystal citation references', async () => {
        const oldAddress = 'Old111111111111111111111111111111111111111';
        const { referenceClient, promise } = materialize([
            link({ referenceId: 'ref-1', sourceOnChainAddress: oldAddress }),
            link({ referenceId: 'ref-2', sourceOnChainAddress: oldAddress }),
        ]);

        await expect(promise).resolves.toEqual({
            attempted: 1,
            succeeded: 1,
            skipped: 1,
            signatures: ['sig-1'],
        });
        expect(referenceClient.addReferences).toHaveBeenCalledWith([
            {
                sourceOnChainAddress: 'New111111111111111111111111111111111111111',
                targetOnChainAddress: oldAddress,
                referenceType: 'citation',
            },
        ]);
    });

    test('blocks self references before chain submission', async () => {
        const { referenceClient, promise } = materialize([
            link({
                sourceKnowledgeId: 'K-new',
                sourceOnChainAddress: 'New111111111111111111111111111111111111111',
            }),
        ]);

        await expect(promise).rejects.toMatchObject({
            code: 'draft_reference_self_reference',
        });
        expect(referenceClient.addReferences).not.toHaveBeenCalled();
    });

    test('wraps client failure as a structured materialization error', async () => {
        jest.spyOn(readModel, 'loadDraftReferenceLinks').mockResolvedValue([link()]);
        const referenceClient = {
            addReferences: jest.fn(async () => {
                throw new Error('RPC confirmation failed');
            }),
        };

        await expect(materializeDraftCrystalReferencesOrThrow({} as any, {
            draftPostId: 42,
            targetKnowledgeId: 'K-new',
            targetOnChainAddress: 'New111111111111111111111111111111111111111',
            requestedByUserId: 9,
            referenceClient,
        })).rejects.toBeInstanceOf(DraftReferenceMaterializationError);
        await expect(materializeDraftCrystalReferencesOrThrow({} as any, {
            draftPostId: 42,
            targetKnowledgeId: 'K-new',
            targetOnChainAddress: 'New111111111111111111111111111111111111111',
            requestedByUserId: 9,
            referenceClient,
        })).rejects.toMatchObject({
            code: 'reference_materialization_failed',
        });
    });
});
