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
                markerKnowledgeId: 'K-source',
                markerRaw: '@crystal(Seed Crystal#anchor-1){kid=K-source}',
                status: 'parsed',
            },
        ]);

        const prisma = {
            post: {
                findUnique: jest.fn(async () => ({ circleId: 7 })),
            },
            knowledge: {
                findMany: jest.fn(async () => [
                    {
                        knowledgeId: 'K-source',
                        onChainAddress: 'SourcePda1111111111111111111111111111111',
                    },
                ]),
            },
        } as any;

        const links = await loadDraftReferenceLinks(prisma, 42);

        expect(resolveSpy).toHaveBeenCalledWith(expect.anything(), {
            draftPostId: 42,
        });
        expect(prisma.knowledge.findMany).toHaveBeenCalledWith({
            where: {
                circleId: 7,
                knowledgeId: 'K-source',
            },
            select: {
                knowledgeId: true,
                onChainAddress: true,
            },
            take: 2,
        });
        expect(links).toEqual([
            {
                referenceId: 'ref-1',
                draftPostId: 42,
                draftVersion: 4,
                sourceBlockId: 'paragraph:0',
                crystalName: 'Seed Crystal',
                crystalBlockAnchor: 'anchor-1',
                sourceKnowledgeId: 'K-source',
                sourceOnChainAddress: 'SourcePda1111111111111111111111111111111',
                resolutionStatus: 'resolved',
                status: 'parsed',
            },
        ]);
        expect((links[0] as any).linkText).toBeUndefined();
    });

    test('marks legacy title references ambiguous when same-circle title is not unique', async () => {
        jest.spyOn(draftBlockReadModel, 'resolveStableDraftReferenceLinkInputs').mockResolvedValue([
            {
                referenceId: 'ref-legacy',
                draftPostId: 43,
                draftVersion: 1,
                sourceBlockId: 'paragraph:0',
                crystalName: 'Shared Title',
                crystalBlockAnchor: null,
                markerKnowledgeId: null,
                markerRaw: '@crystal(Shared Title)',
                status: 'parsed',
            },
        ]);
        const prisma = {
            post: {
                findUnique: jest.fn(async () => ({ circleId: 7 })),
            },
            knowledge: {
                findMany: jest.fn(async () => [
                    { knowledgeId: 'K-one', onChainAddress: 'One1111111111111111111111111111111111111' },
                    { knowledgeId: 'K-two', onChainAddress: 'Two1111111111111111111111111111111111111' },
                ]),
            },
        } as any;

        const links = await loadDraftReferenceLinks(prisma, 43);

        expect(prisma.knowledge.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                circleId: 7,
                title: 'Shared Title',
            },
        }));
        expect(links[0]).toMatchObject({
            sourceKnowledgeId: null,
            sourceOnChainAddress: null,
            resolutionStatus: 'ambiguous',
        });
    });
});
