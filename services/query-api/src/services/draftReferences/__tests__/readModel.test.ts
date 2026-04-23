import { describe, expect, jest, test } from '@jest/globals';

import * as draftBlockReadModel from '../../draftBlocks/readModel';
import { loadDraftReferenceLinks } from '../readModel';

describe('draft reference read model', () => {
    test('reuses Team 03 frozen DraftReferenceLink fields without exposing private parser payloads', async () => {
        const resolveSpy = jest.spyOn(draftBlockReadModel, 'resolveStableDraftReferenceLinkInputs').mockResolvedValue([
            {
                referenceId: 'ref-1',
                draftPostId: 42,
                draftVersion: 4,
                sourceBlockId: 'paragraph:0',
                crystalName: 'Seed Crystal',
                crystalBlockAnchor: 'anchor-1',
                status: 'parsed',
            },
        ]);

        const links = await loadDraftReferenceLinks({} as any, 42);

        expect(resolveSpy).toHaveBeenCalledWith(expect.anything(), {
            draftPostId: 42,
        });
        expect(links).toEqual([
            {
                referenceId: 'ref-1',
                draftPostId: 42,
                draftVersion: 4,
                sourceBlockId: 'paragraph:0',
                crystalName: 'Seed Crystal',
                crystalBlockAnchor: 'anchor-1',
                status: 'parsed',
            },
        ]);
        expect((links[0] as any).linkText).toBeUndefined();
    });
});
