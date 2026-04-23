import { ensureOffchainDiscussionSchema } from '../src/services/offchainDiscussion';

describe('ensureOffchainDiscussionSchema', () => {
    test('ignores duplicate relation-name races while bootstrapping discussion indexes', async () => {
        const duplicateRelationRace = Object.assign(new Error('duplicate relation name'), {
            code: 'P2010',
            meta: {
                code: '23505',
                message: 'Key (relname, relnamespace)=(idx_discussion_circle_message_kind_lamport, 2200) already exists.',
            },
        });

        const prisma = {
            $executeRawUnsafe: jest.fn().mockImplementation(async (stmt: string) => {
                if (stmt.includes('idx_discussion_circle_message_kind_lamport')) {
                    throw duplicateRelationRace;
                }
                return undefined;
            }),
            $executeRaw: jest.fn().mockResolvedValue(undefined),
        };

        await expect(ensureOffchainDiscussionSchema(prisma as any)).resolves.toBeUndefined();
        expect(prisma.$executeRawUnsafe.mock.calls.length).toBeGreaterThan(1);
        expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    test('rethrows non-duplicate bootstrap failures', async () => {
        const failure = Object.assign(new Error('table missing'), {
            code: 'P2010',
            meta: {
                code: '42P01',
                message: 'relation "missing_table" does not exist',
            },
        });

        const prisma = {
            $executeRawUnsafe: jest.fn().mockRejectedValueOnce(failure),
            $executeRaw: jest.fn(),
        };

        await expect(ensureOffchainDiscussionSchema(prisma as any)).rejects.toBe(failure);
    });

    test('rethrows duplicate relation-name errors for unexpected relations', async () => {
        const duplicateUnknownRelation = Object.assign(new Error('duplicate relation name'), {
            code: 'P2010',
            meta: {
                code: '23505',
                message: 'Key (relname, relnamespace)=(unexpected_existing_relation, 2200) already exists.',
            },
        });

        const prisma = {
            $executeRawUnsafe: jest.fn().mockRejectedValueOnce(duplicateUnknownRelation),
            $executeRaw: jest.fn(),
        };

        await expect(ensureOffchainDiscussionSchema(prisma as any)).rejects.toBe(duplicateUnknownRelation);
    });
});
