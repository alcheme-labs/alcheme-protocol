import { describe, expect, jest, test } from '@jest/globals';

import { authorizeAgentManagement } from '../access';

describe('agent access control', () => {
    test('rejects unauthenticated users before touching circle membership', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(),
            },
            circleMember: {
                findUnique: jest.fn(),
            },
        } as any;

        const decision = await authorizeAgentManagement(prisma, {
            circleId: 7,
            userId: null,
        });

        expect(decision).toMatchObject({
            allowed: false,
            statusCode: 401,
            error: 'authentication_required',
        });
        expect(prisma.circle.findUnique).not.toHaveBeenCalled();
    });

    test('rejects ordinary members from creating or binding circle scoped agents', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    creatorId: 99,
                })),
            },
            circleMember: {
                findUnique: jest.fn(async () => ({
                    role: 'Member',
                    status: 'Active',
                })),
            },
        } as any;

        const decision = await authorizeAgentManagement(prisma, {
            circleId: 7,
            userId: 8,
        });

        expect(decision).toMatchObject({
            allowed: false,
            statusCode: 403,
            error: 'agent_management_forbidden',
        });
    });

    test('allows circle owners and admins to manage agents', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({
                    creatorId: 99,
                })),
            },
            circleMember: {
                findUnique: jest.fn(async () => ({
                    role: 'Admin',
                    status: 'Active',
                })),
            },
        } as any;

        const decision = await authorizeAgentManagement(prisma, {
            circleId: 7,
            userId: 8,
        });

        expect(decision).toMatchObject({
            allowed: true,
            statusCode: 200,
        });
    });
});
