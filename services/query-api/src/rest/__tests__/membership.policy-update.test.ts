import type { Router } from 'express';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { CircleType, JoinRequirement } from '@prisma/client';

import { membershipRouter } from '../membership';
import {
    buildCircleSettingsSigningMessage,
    buildCircleSettingsSigningPayload,
} from '../../services/policy/settingsEnvelope';

function signMembershipPolicy(input: {
    circleId: number;
    joinRequirement: JoinRequirement;
    circleType: CircleType;
    minCrystals: number;
}) {
    const keyPair = nacl.sign.keyPair();
    const actorPubkey = bs58.encode(keyPair.publicKey);
    const payload = buildCircleSettingsSigningPayload({
        circleId: input.circleId,
        actorPubkey,
        settingKind: 'membership_policy',
        payload: {
            joinRequirement: input.joinRequirement,
            circleType: input.circleType,
            minCrystals: input.minCrystals,
        },
        clientTimestamp: new Date().toISOString(),
        nonce: `membership-policy-${input.joinRequirement}-${input.minCrystals}`,
    });
    const signedMessage = buildCircleSettingsSigningMessage(payload);
    const signature = Buffer
        .from(nacl.sign.detached(new TextEncoder().encode(signedMessage), keyPair.secretKey))
        .toString('base64');

    return {
        actorPubkey,
        signedMessage,
        signature,
    };
}

function buildPrisma(input: {
    actorPubkey: string;
    currentMinCrystals: number;
    currentJoinRequirement?: JoinRequirement;
    currentCircleType?: CircleType;
}) {
    return {
        circle: {
            findUnique: jest.fn(async () => ({
                id: 7,
                creatorId: 9,
                creator: { pubkey: input.actorPubkey },
                joinRequirement: input.currentJoinRequirement ?? JoinRequirement.Free,
                circleType: input.currentCircleType ?? CircleType.Open,
                minCrystals: input.currentMinCrystals,
            })),
            update: jest.fn(async ({ data }: any) => ({
                id: 7,
                joinRequirement: data.joinRequirement ?? input.currentJoinRequirement ?? JoinRequirement.Free,
                circleType: data.circleType ?? input.currentCircleType ?? CircleType.Open,
                minCrystals: input.currentMinCrystals,
            })),
        },
        user: {
            findUnique: jest.fn(async () => null),
        },
        circleMember: {
            findUnique: jest.fn(async () => null),
        },
        $executeRawUnsafe: jest.fn(async () => 0),
        $executeRaw: jest.fn(async () => 1),
    } as any;
}

function getPolicyRouteHandler(router: Router) {
    const layer = (router as any).stack.find((item: any) =>
        item.route?.path === '/circles/:id/policy'
        && item.route?.stack?.some((entry: any) => entry.method === 'put'),
    );
    const routeLayer = layer?.route?.stack?.find((entry: any) => entry.method === 'put');
    if (!routeLayer?.handle) {
        throw new Error('membership policy route handler not found');
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

async function callPolicyRoute(input: {
    prisma: any;
    redis?: any;
    body: Record<string, unknown>;
}) {
    const router = membershipRouter(input.prisma, input.redis ?? {} as any);
    const handler = getPolicyRouteHandler(router);
    const res = createMockResponse();
    await handler({
        params: { id: '7' },
        body: input.body,
    } as any, res as any, jest.fn());
    return res;
}

describe('membership policy update route', () => {
    test('rejects TokenGated with minCrystals 0', async () => {
        const signed = signMembershipPolicy({
            circleId: 7,
            joinRequirement: JoinRequirement.TokenGated,
            circleType: CircleType.Open,
            minCrystals: 0,
        });
        const prisma = buildPrisma({
            actorPubkey: signed.actorPubkey,
            currentMinCrystals: 0,
        });

        const response = await callPolicyRoute({
            prisma,
            body: {
                ...signed,
                joinRequirement: JoinRequirement.TokenGated,
                circleType: CircleType.Open,
                minCrystals: 0,
            },
        });

        expect(response.statusCode).toBe(400);
        expect(response.payload.error).toBe('token_gate_min_crystals_required');
        expect(prisma.circle.update).not.toHaveBeenCalled();
    });

    test('rejects non-token policies with nonzero minCrystals', async () => {
        const signed = signMembershipPolicy({
            circleId: 7,
            joinRequirement: JoinRequirement.Free,
            circleType: CircleType.Open,
            minCrystals: 2,
        });
        const prisma = buildPrisma({
            actorPubkey: signed.actorPubkey,
            currentMinCrystals: 2,
        });

        const response = await callPolicyRoute({
            prisma,
            body: {
                ...signed,
                joinRequirement: JoinRequirement.Free,
                circleType: CircleType.Open,
                minCrystals: 2,
            },
        });

        expect(response.statusCode).toBe(400);
        expect(response.payload.error).toBe('min_crystals_requires_token_gate');
        expect(prisma.circle.update).not.toHaveBeenCalled();
    });

    test('rejects token policies when requested minCrystals is not yet indexed', async () => {
        const signed = signMembershipPolicy({
            circleId: 7,
            joinRequirement: JoinRequirement.TokenGated,
            circleType: CircleType.Open,
            minCrystals: 3,
        });
        const prisma = buildPrisma({
            actorPubkey: signed.actorPubkey,
            currentMinCrystals: 2,
        });

        const response = await callPolicyRoute({
            prisma,
            body: {
                ...signed,
                joinRequirement: JoinRequirement.TokenGated,
                circleType: CircleType.Open,
                minCrystals: 3,
            },
        });

        expect(response.statusCode).toBe(409);
        expect(response.payload).toMatchObject({
            error: 'min_crystals_projection_mismatch',
            expected: 3,
            actual: 2,
        });
        expect(prisma.circle.update).not.toHaveBeenCalled();
    });

    test('rejects non-token policies until indexed minCrystals has been reset', async () => {
        const signed = signMembershipPolicy({
            circleId: 7,
            joinRequirement: JoinRequirement.Free,
            circleType: CircleType.Open,
            minCrystals: 0,
        });
        const prisma = buildPrisma({
            actorPubkey: signed.actorPubkey,
            currentJoinRequirement: JoinRequirement.TokenGated,
            currentMinCrystals: 2,
        });

        const response = await callPolicyRoute({
            prisma,
            body: {
                ...signed,
                joinRequirement: JoinRequirement.Free,
                circleType: CircleType.Open,
            },
        });

        expect(response.statusCode).toBe(409);
        expect(response.payload).toMatchObject({
            error: 'min_crystals_projection_mismatch',
            expected: 0,
            actual: 2,
        });
        expect(prisma.circle.update).not.toHaveBeenCalled();
    });

    test('accepts token policies when requested minCrystals matches indexed state', async () => {
        const signed = signMembershipPolicy({
            circleId: 7,
            joinRequirement: JoinRequirement.TokenGated,
            circleType: CircleType.Open,
            minCrystals: 3,
        });
        const prisma = buildPrisma({
            actorPubkey: signed.actorPubkey,
            currentMinCrystals: 3,
        });
        const redis = {
            set: jest.fn(async () => 'OK'),
            del: jest.fn(async () => 1),
        };

        const response = await callPolicyRoute({
            prisma,
            redis,
            body: {
                ...signed,
                joinRequirement: JoinRequirement.TokenGated,
                circleType: CircleType.Open,
                minCrystals: 3,
            },
        });

        expect(response.statusCode).toBe(200);
        expect(response.payload).toMatchObject({
            ok: true,
            circleId: 7,
            policy: {
                joinRequirement: JoinRequirement.TokenGated,
                circleType: CircleType.Open,
                minCrystals: 3,
            },
        });
        expect(prisma.circle.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 7 },
            data: {
                joinRequirement: JoinRequirement.TokenGated,
                circleType: CircleType.Open,
            },
        }));
        expect(redis.del).toHaveBeenCalledWith('circle:7');
    });
});
