import { describe, expect, jest, test } from '@jest/globals';
import { typeDefs } from '../schema';
import { resolvers } from '../resolvers';

function readSchemaSource(): string {
    const maybeBody = (typeDefs as any)?.loc?.source?.body;
    return typeof maybeBody === 'string' ? maybeBody : String(typeDefs);
}

describe('Batch9 RED: v2 private/draft fields exposure', () => {
    test('GraphQL Post type should expose dedicated v2 private/draft fields', () => {
        const schemaSource = readSchemaSource();
        expect(schemaSource).toMatch(/v2VisibilityLevel:\s*String!/);
        expect(schemaSource).toMatch(/v2Status:\s*String!/);
        expect(schemaSource).toMatch(/isV2Private:\s*Boolean!/);
        expect(schemaSource).toMatch(/isV2Draft:\s*Boolean!/);
    });

    test('Query.post should preserve v2 private/draft fields from indexer rows', async () => {
        const prisma = {
            post: {
                findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({
                    id: 401,
                    contentId: '401',
                    onChainAddress: 'Post4011111111111111111111111111111111111',
                    authorId: 9,
                    v2VisibilityLevel: 'Private',
                    v2Status: 'Draft',
                    isV2Private: true,
                    isV2Draft: true,
                }),
            },
        } as any;
        const cache = {
            get: jest.fn<() => Promise<string | null>>().mockResolvedValue(null),
            setex: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        } as any;

        const result = await (resolvers as any).Query.post({}, { contentId: '401' }, { prisma, cache });

        expect(result.v2VisibilityLevel).toBe('Private');
        expect(result.v2Status).toBe('Draft');
        expect(result.isV2Private).toBe(true);
        expect(result.isV2Draft).toBe(true);
    });

    test('Query.post should cache payload even when prisma row contains BigInt fields', async () => {
        const prisma = {
            post: {
                findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({
                    id: 402,
                    contentId: '402',
                    onChainAddress: 'Post4021111111111111111111111111111111111',
                    authorId: 9,
                    v2VisibilityLevel: 'Private',
                    v2Status: 'Draft',
                    isV2Private: true,
                    isV2Draft: true,
                    lastSyncedSlot: BigInt(123),
                }),
            },
        } as any;
        const cache = {
            get: jest.fn<() => Promise<string | null>>().mockResolvedValue(null),
            setex: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        } as any;

        const result = await (resolvers as any).Query.post({}, { contentId: '402' }, { prisma, cache });

        expect(result.contentId).toBe('402');
        expect(cache.setex).toHaveBeenCalledTimes(1);
        const serializedPayload = cache.setex.mock.calls[0][2];
        expect(typeof serializedPayload).toBe('string');
        expect(serializedPayload).toContain('"lastSyncedSlot":"123"');
    });
});
