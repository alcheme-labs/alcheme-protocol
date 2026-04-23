import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';

import { resolvers } from '../src/graphql/resolvers';

describe('knowledge binding projection', () => {
    test('graphql schema exposes knowledge binding field and audit query', () => {
        const schemaPath = path.resolve(__dirname, '../src/graphql/schema.ts');
        const schemaSource = fs.readFileSync(schemaPath, 'utf8');

        expect(schemaSource).toMatch(/type\s+KnowledgeBinding\s*\{/);
        expect(schemaSource).toMatch(/binding:\s*KnowledgeBinding/);
        expect(schemaSource).toMatch(/knowledgeBinding\(knowledgeId:\s*String!\):\s*KnowledgeBinding/);
    });

    test('knowledge query resolver exposes projected binding data', async () => {
        const row = {
            knowledgeId: 'k-demo',
            sourceAnchorId: 'a'.repeat(64),
            proofPackageHash: 'b'.repeat(64),
            contributorsRoot: 'c'.repeat(64),
            contributorsCount: 3,
            bindingVersion: 2,
            generatedAt: new Date('2026-03-13T12:00:00.000Z'),
            boundAt: new Date('2026-03-13T12:00:10.000Z'),
            boundBy: '11111111111111111111111111111111',
            createdAt: new Date('2026-03-13T12:00:11.000Z'),
            updatedAt: new Date('2026-03-13T12:00:12.000Z'),
        };
        const prisma = {
            $queryRaw: jest.fn<() => Promise<any[]>>().mockResolvedValue([row]),
        } as any;

        const knowledgeBinding = await (resolvers as any).Knowledge.binding(
            { knowledgeId: 'k-demo' },
            {},
            { prisma },
        );

        expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
        expect(knowledgeBinding).toMatchObject({
            knowledgeId: 'k-demo',
            sourceAnchorId: 'a'.repeat(64),
            proofPackageHash: 'b'.repeat(64),
            contributorsRoot: 'c'.repeat(64),
            contributorsCount: 3,
            bindingVersion: 2,
            boundBy: '11111111111111111111111111111111',
        });
    });

    test('audit query returns projected binding by knowledge id', async () => {
        const row = {
            knowledgeId: 'k-demo',
            sourceAnchorId: 'a'.repeat(64),
            proofPackageHash: 'b'.repeat(64),
            contributorsRoot: 'c'.repeat(64),
            contributorsCount: 3,
            bindingVersion: 2,
            generatedAt: new Date('2026-03-13T12:00:00.000Z'),
            boundAt: new Date('2026-03-13T12:00:10.000Z'),
            boundBy: '11111111111111111111111111111111',
            createdAt: new Date('2026-03-13T12:00:11.000Z'),
            updatedAt: new Date('2026-03-13T12:00:12.000Z'),
        };
        const prisma = {
            $queryRaw: jest.fn<() => Promise<any[]>>().mockResolvedValue([row]),
        } as any;

        const binding = await (resolvers as any).Query.knowledgeBinding(
            {},
            { knowledgeId: 'k-demo' },
            { prisma },
        );

        expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
        expect(binding).toMatchObject({
            knowledgeId: 'k-demo',
            bindingVersion: 2,
        });
    });

    test('binding projection stays evidence-focused and does not masquerade as the formal output contract', async () => {
        const row = {
            knowledgeId: 'k-demo',
            sourceAnchorId: 'a'.repeat(64),
            proofPackageHash: 'b'.repeat(64),
            contributorsRoot: 'c'.repeat(64),
            contributorsCount: 3,
            bindingVersion: 2,
            generatedAt: new Date('2026-03-13T12:00:00.000Z'),
            boundAt: new Date('2026-03-13T12:00:10.000Z'),
            boundBy: '11111111111111111111111111111111',
            createdAt: new Date('2026-03-13T12:00:11.000Z'),
            updatedAt: new Date('2026-03-13T12:00:12.000Z'),
        };
        const prisma = {
            $queryRaw: jest.fn<() => Promise<any[]>>().mockResolvedValue([row]),
        } as any;

        const binding = await (resolvers as any).Query.knowledgeBinding(
            {},
            { knowledgeId: 'k-demo' },
            { prisma },
        );

        expect((binding as any).contentHash).toBeUndefined();
        expect((binding as any).sourceDraftVersion).toBeUndefined();
    });
});
