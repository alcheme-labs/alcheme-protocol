import { describe, expect, jest, test } from '@jest/globals';

import { authenticateCollabRequest } from '../src/collab/auth';

describe('Task7 gate: collab audience compatibility', () => {
    test('collab auth continues to use post.circleId as app-level feature root', async () => {
        const prisma = {
            post: {
                findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({ circleId: 9 }),
            },
        } as any;

        const redis = {
            get: jest.fn<() => Promise<string | null>>().mockResolvedValue(null),
        } as any;

        const result = await authenticateCollabRequest(
            {
                headers: {
                    host: '127.0.0.1:4000',
                },
                url: '/collab/crucible-42?token=invalid',
            } as any,
            prisma,
            redis,
        );

        expect(prisma.post.findUnique).toHaveBeenCalledWith({
            where: { id: 42 },
            select: { circleId: true },
        });
        expect(result.circleId).toBe(9);
    });
});
