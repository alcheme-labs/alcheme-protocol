import { describe, expect, test, jest } from '@jest/globals';

import { resolvers } from '../resolvers';

describe('Knowledge lineage link resolvers', () => {
    test('resolves outbound references from knowledge_references', async () => {
        const prisma = {
            knowledgeReference: {
                findMany: jest.fn(async () => ([
                    {
                        sourceKnowledgeId: 'K-1',
                        targetKnowledgeId: 'K-2',
                        createdAt: new Date('2026-03-02T12:00:00.000Z'),
                    },
                    {
                        sourceKnowledgeId: 'K-1',
                        targetKnowledgeId: 'K-3',
                        createdAt: new Date('2026-03-02T11:00:00.000Z'),
                    },
                ])),
            },
            knowledge: {
                findMany: jest.fn(async () => ([
                    {
                        knowledgeId: 'K-2',
                        onChainAddress: 'AddrK2',
                        title: 'Target K2',
                        createdAt: new Date('2026-03-01T08:00:00.000Z'),
                        citationCount: 4,
                        heatScore: 22.5,
                        circle: { id: 7, name: 'Alpha' },
                    },
                    {
                        knowledgeId: 'K-3',
                        onChainAddress: 'AddrK3',
                        title: 'Target K3',
                        createdAt: new Date('2026-03-01T09:00:00.000Z'),
                        citationCount: 2,
                        heatScore: 11.2,
                        circle: { id: 8, name: 'Beta' },
                    },
                ])),
            },
        } as any;

        const result = await (resolvers as any).Knowledge.references(
            { knowledgeId: 'K-1' },
            { limit: 8 },
            { prisma },
        );

        expect(prisma.knowledgeReference.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { sourceKnowledgeId: 'K-1' },
            take: 8,
        }));
        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({
            knowledgeId: 'K-2',
            circleName: 'Alpha',
            citationCount: 4,
            heatScore: 22.5,
        });
        expect(result[1]).toMatchObject({
            knowledgeId: 'K-3',
            circleName: 'Beta',
        });
    });

    test('resolves inbound citedBy links from knowledge_references', async () => {
        const prisma = {
            knowledgeReference: {
                findMany: jest.fn(async () => ([
                    {
                        sourceKnowledgeId: 'K-9',
                        targetKnowledgeId: 'K-1',
                        createdAt: new Date('2026-03-02T12:00:00.000Z'),
                    },
                ])),
            },
            knowledge: {
                findMany: jest.fn(async () => ([
                    {
                        knowledgeId: 'K-9',
                        onChainAddress: 'AddrK9',
                        title: 'Source K9',
                        createdAt: new Date('2026-03-01T10:00:00.000Z'),
                        citationCount: 7,
                        heatScore: 41,
                        circle: { id: 9, name: 'Gamma' },
                    },
                ])),
            },
        } as any;

        const result = await (resolvers as any).Knowledge.citedBy(
            { knowledgeId: 'K-1' },
            { limit: 8 },
            { prisma },
        );

        expect(prisma.knowledgeReference.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { targetKnowledgeId: 'K-1' },
            take: 8,
        }));
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            knowledgeId: 'K-9',
            circleName: 'Gamma',
            citationCount: 7,
            heatScore: 41,
        });
    });
});
