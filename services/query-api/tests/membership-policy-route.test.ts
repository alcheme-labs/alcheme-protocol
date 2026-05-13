import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Router } from 'express';

const verifyEd25519SignatureBase64Mock = jest.fn();

jest.mock('../src/services/offchainDiscussion', () => ({
    verifyEd25519SignatureBase64: verifyEd25519SignatureBase64Mock,
}));

import { membershipRouter } from '../src/rest/membership';

function getRouteHandler(router: Router, path: string, method: 'put') {
    const layer = (router as any).stack.find((item: any) =>
        item.route?.path === path
        && item.route?.stack?.some((entry: any) => entry.method === method),
    );
    const routeLayer = layer?.route?.stack?.find((entry: any) => entry.method === method);
    if (!routeLayer?.handle) {
        throw new Error(`route handler not found for ${method.toUpperCase()} ${path}`);
    }
    return routeLayer.handle;
}

function createMockResponse() {
    return {
        statusCode: 200,
        payload: null as any,
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        json(payload: any) {
            this.payload = payload;
            return this;
        },
    };
}

function createPrismaMock(input?: {
    actorRole?: 'Owner' | 'Admin' | 'Moderator' | 'Member' | null;
    actorPubkey?: string;
}) {
    const actorRole = input?.actorRole ?? 'Owner';
    const actorPubkey = input?.actorPubkey ?? 'owner-pubkey';

    return {
        circle: {
            findUnique: jest.fn(async () => ({
                id: 7,
                creatorId: 9,
                creator: { pubkey: 'owner-pubkey' },
                joinRequirement: 'Free',
                circleType: 'Open',
                    minCrystals: 0,
            })),
            update: jest.fn(async ({ data }: any) => ({
                id: 7,
                joinRequirement: data.joinRequirement ?? 'Free',
                circleType: data.circleType ?? 'Open',
                minCrystals: 0,
            })),
        },
        user: {
            findUnique: jest.fn(async ({ where }: any) => {
                if (where?.pubkey === actorPubkey) {
                    return { id: actorPubkey === 'owner-pubkey' ? 9 : 12 };
                }
                return null;
            }),
        },
        circleMember: {
            findUnique: jest.fn(async () => actorRole ? ({
                role: actorRole,
                status: 'Active',
            }) : null),
        },
    } as any;
}

describe('membership policy route', () => {
    beforeEach(() => {
        jest.restoreAllMocks();
        jest.clearAllMocks();
        jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-03-27T00:00:30.000Z').getTime());
        verifyEd25519SignatureBase64Mock.mockReturnValue(true);
    });

    test('accepts wallet-signed membership policy updates and projects the stable policy payload', async () => {
        const prisma = createPrismaMock({ actorRole: 'Owner', actorPubkey: 'owner-pubkey' });
        const router = membershipRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/circles/:id/policy', 'put');
        const res = createMockResponse();

        await handler({
            params: { id: '7' },
            body: {
                actorPubkey: 'owner-pubkey',
                signedMessage: 'alcheme-circle-settings:{"v":1,"action":"circle_settings_publish","circleId":7,"actorPubkey":"owner-pubkey","settingKind":"membership_policy","payload":{"joinRequirement":"ApprovalRequired","circleType":"Closed","minCrystals":0},"clientTimestamp":"2026-03-27T00:00:00.000Z","nonce":"membership-policy-01"}',
                signature: 'base64-signature',
                joinRequirement: 'ApprovalRequired',
                circleType: 'Closed',
                minCrystals: 0,
            },
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(200);
        expect(prisma.circle.update).toHaveBeenCalledWith({
            where: { id: 7 },
            data: {
                joinRequirement: 'ApprovalRequired',
                circleType: 'Closed',
            },
            select: {
                id: true,
                joinRequirement: true,
                circleType: true,
                minCrystals: true,
            },
        });
        expect(res.payload).toMatchObject({
            ok: true,
            circleId: 7,
            policy: {
                joinRequirement: 'ApprovalRequired',
                circleType: 'Closed',
                minCrystals: 0,
                requiresApproval: true,
                requiresInvite: false,
            },
        });
    });

    test('rejects membership policy writes without a canonical wallet signature', async () => {
        const prisma = createPrismaMock({ actorRole: 'Owner', actorPubkey: 'owner-pubkey' });
        const router = membershipRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/circles/:id/policy', 'put');
        const res = createMockResponse();

        await handler({
            params: { id: '7' },
            body: {
                joinRequirement: 'InviteOnly',
                circleType: 'Closed',
            },
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(401);
        expect(res.payload).toMatchObject({
            error: 'circle_settings_auth_required',
        });
        expect(prisma.circle.update).not.toHaveBeenCalled();
    });
});
