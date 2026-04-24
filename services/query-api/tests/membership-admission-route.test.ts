import { afterAll, beforeAll, describe, expect, jest, test } from '@jest/globals';
import type { Router } from 'express';
import nacl from 'tweetnacl';
import { PublicKey } from '@solana/web3.js';

import { membershipRouter } from '../src/rest/membership';

function getRouteHandler(router: Router, path: string, method: 'get' | 'post') {
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

function createJoinPrismaMock(input?: {
    circle?: {
        joinRequirement?: 'Free' | 'ApprovalRequired' | 'TokenGated' | 'InviteOnly';
        circleType?: 'Open' | 'Closed' | 'Secret';
        minCrystals?: number;
        creatorId?: number;
        lifecycleStatus?: 'Active' | 'Archived';
    };
    membership?: any;
    invite?: any;
    approvedRequest?: any;
    entitlements?: Array<{
        ownerPubkey: string;
        status: string;
        circleId: number;
    }>;
}) {
    const entitlements = input?.entitlements ?? [];
    return {
        circle: {
            findUnique: jest.fn(async ({ where }: any) => {
                if (where?.id !== 7) return null;
                return {
                    id: 7,
                    joinRequirement: input?.circle?.joinRequirement ?? 'Free',
                    circleType: input?.circle?.circleType ?? 'Open',
                    minCrystals: input?.circle?.minCrystals ?? 0,
                    creatorId: input?.circle?.creatorId ?? 42,
                    lifecycleStatus: input?.circle?.lifecycleStatus ?? 'Active',
                };
            }),
            findMany: jest.fn(async () => []),
        },
        user: {
            findUnique: jest.fn(async () => ({
                id: 88,
                handle: 'candidate',
                pubkey: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
            })),
        },
        circleMember: {
            findUnique: jest.fn(async () => input?.membership ?? null),
            create: jest.fn(async () => {
                throw new Error('circleMember.create should not run during join bridge preflight');
            }),
            update: jest.fn(async () => {
                throw new Error('circleMember.update should not run during join bridge preflight');
            }),
        },
        circleJoinRequest: {
            findFirst: jest.fn(async ({ where }: any) => {
                if (where?.status === 'Approved') return input?.approvedRequest ?? null;
                return null;
            }),
            create: jest.fn(async () => ({
                id: 501,
                circleId: 7,
                userId: 88,
                status: 'Pending',
            })),
            update: jest.fn(async () => ({ id: 701 })),
            findUnique: jest.fn(async () => ({
                id: 701,
                circleId: 7,
                userId: 88,
                status: 'Pending',
            })),
        },
        circleInvite: {
            findUnique: jest.fn(async () => input?.invite ?? null),
            findFirst: jest.fn(async ({ where }: any) => {
                const invite = input?.invite ?? null;
                if (!invite) {
                    return null;
                }
                if (where?.status && invite.status !== where.status) {
                    return null;
                }
                if (Array.isArray(where?.OR) && where.OR.length > 0) {
                    const matched = where.OR.some((clause: any) => {
                        if (!clause) {
                            return false;
                        }
                        if (clause.status && clause.status !== invite.status) {
                            return false;
                        }
                        if (clause.acceptedById && clause.acceptedById !== invite.acceptedById) {
                            return false;
                        }
                        return true;
                    });
                    if (!matched) {
                        return null;
                    }
                }
                return invite;
            }),
            update: jest.fn(async () => ({ id: input?.invite?.id ?? 601 })),
        },
        circleMembershipEvent: {
            create: jest.fn(async () => ({ id: 1 })),
        },
        knowledge: {
            count: jest.fn(async () => 0),
        },
        crystalEntitlement: {
            count: jest.fn(async ({ where }: any) => entitlements.filter((row) => {
                if (where?.ownerPubkey && row.ownerPubkey !== where.ownerPubkey) return false;
                if (where?.status && row.status !== where.status) return false;
                const circleIds = Array.isArray(where?.circleId?.in)
                    ? where.circleId.in.map((value: unknown) => Number(value))
                    : null;
                if (circleIds && !circleIds.includes(row.circleId)) return false;
                return true;
            }).length),
        },
    };
}

const originalIssuerKey = process.env.MEMBERSHIP_BRIDGE_ISSUER_KEY_ID;
const originalIssuerSecret = process.env.MEMBERSHIP_BRIDGE_ISSUER_SECRET;

beforeAll(() => {
    const seed = new Uint8Array(32).fill(7);
    const keyPair = nacl.sign.keyPair.fromSeed(seed);
    process.env.MEMBERSHIP_BRIDGE_ISSUER_KEY_ID = new PublicKey(keyPair.publicKey).toBase58();
    process.env.MEMBERSHIP_BRIDGE_ISSUER_SECRET = Buffer.from(seed).toString('hex');
});

afterAll(() => {
    if (originalIssuerKey === undefined) {
        delete process.env.MEMBERSHIP_BRIDGE_ISSUER_KEY_ID;
    } else {
        process.env.MEMBERSHIP_BRIDGE_ISSUER_KEY_ID = originalIssuerKey;
    }
    if (originalIssuerSecret === undefined) {
        delete process.env.MEMBERSHIP_BRIDGE_ISSUER_SECRET;
    } else {
        process.env.MEMBERSHIP_BRIDGE_ISSUER_SECRET = originalIssuerSecret;
    }
});

function setMembershipIssuerEnv(input: {
    keyId?: string | null;
    secret?: string | null;
}) {
    if (input.keyId === undefined) {
        delete process.env.MEMBERSHIP_BRIDGE_ISSUER_KEY_ID;
    } else {
        process.env.MEMBERSHIP_BRIDGE_ISSUER_KEY_ID = input.keyId ?? '';
    }
    if (input.secret === undefined) {
        delete process.env.MEMBERSHIP_BRIDGE_ISSUER_SECRET;
    } else {
        process.env.MEMBERSHIP_BRIDGE_ISSUER_SECRET = input.secret ?? '';
    }
}

describe('membership admission bridge routes', () => {
    test('GET /circles/:id/me surfaces invite-backed can_join for invite-only circles', async () => {
        const prisma = createJoinPrismaMock({
            circle: {
                joinRequirement: 'InviteOnly',
                circleType: 'Closed',
            },
            invite: {
                id: 601,
                code: 'invite-601',
                circleId: 7,
                status: 'Active',
                inviteeUserId: 88,
                inviteeHandle: null,
                acceptedById: null,
                expiresAt: new Date(Date.now() + 60_000),
            },
        });
        const router = membershipRouter(prisma as any, { publish: jest.fn(async () => 1) } as any);
        const handler = getRouteHandler(router, '/circles/:id/me', 'get');

        const req = {
            params: { id: '7' },
            userId: 88,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            authenticated: true,
            circleId: 7,
            joinState: 'can_join',
            membership: null,
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('GET /circles/:id/me reports entitlement-backed crystal deficits', async () => {
        const prisma = createJoinPrismaMock({
            circle: {
                joinRequirement: 'TokenGated',
                minCrystals: 3,
            },
            entitlements: [
                {
                    ownerPubkey: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
                    status: 'active',
                    circleId: 7,
                },
            ],
        });
        const router = membershipRouter(prisma as any, { publish: jest.fn(async () => 1) } as any);
        const handler = getRouteHandler(router, '/circles/:id/me', 'get');

        const req = {
            params: { id: '7' },
            userId: 88,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            authenticated: true,
            circleId: 7,
            joinState: 'insufficient_crystals',
            userCrystals: 1,
            missingCrystals: 2,
        });
        expect((prisma.crystalEntitlement.count as any)).toHaveBeenCalled();
        expect((prisma.knowledge.count as any)).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('GET /circles/:id/me treats an approved join request as immediately claimable', async () => {
        const prisma = createJoinPrismaMock({
            circle: {
                joinRequirement: 'ApprovalRequired',
                circleType: 'Closed',
            },
            approvedRequest: {
                id: 801,
                circleId: 7,
                userId: 88,
                status: 'Approved',
            },
        });
        const router = membershipRouter(prisma as any, { publish: jest.fn(async () => 1) } as any);
        const handler = getRouteHandler(router, '/circles/:id/me', 'get');

        const req = {
            params: { id: '7' },
            userId: 88,
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            authenticated: true,
            circleId: 7,
            joinState: 'can_join',
            membership: null,
            pendingRequest: null,
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('POST /circles/:id/join returns claim-membership grant for first-time open join', async () => {
        const prisma = createJoinPrismaMock();
        const router = membershipRouter(prisma as any, { publish: jest.fn(async () => 1) } as any);
        const handler = getRouteHandler(router, '/circles/:id/join', 'post');

        const req = {
            params: { id: '7' },
            userId: 88,
            body: {},
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            circleId: 7,
            joinState: 'can_join',
            finalization: {
                action: 'claim_membership',
                grant: expect.objectContaining({
                    circleId: 7,
                    role: 'Member',
                    kind: 'Open',
                    artifactId: 0,
                    issuerKeyId: process.env.MEMBERSHIP_BRIDGE_ISSUER_KEY_ID,
                }),
            },
        });
        expect((prisma.circleMember.create as any)).not.toHaveBeenCalled();
        expect((prisma.circleMember.update as any)).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('POST /circles/:id/join rejects archived circles before grant issuance', async () => {
        const prisma = createJoinPrismaMock({
            circle: {
                lifecycleStatus: 'Archived',
            },
        });
        const router = membershipRouter(prisma as any, { publish: jest.fn(async () => 1) } as any);
        const handler = getRouteHandler(router, '/circles/:id/join', 'post');

        const req = {
            params: { id: '7' },
            userId: 88,
            body: {},
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(409);
        expect(res.payload).toMatchObject({
            error: 'circle_archived',
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('POST /circles/:id/join forwards a clear error when the membership attestor secret is missing', async () => {
        const prisma = createJoinPrismaMock();
        const router = membershipRouter(prisma as any, { publish: jest.fn(async () => 1) } as any);
        const handler = getRouteHandler(router, '/circles/:id/join', 'post');
        const previousKey = process.env.MEMBERSHIP_BRIDGE_ISSUER_KEY_ID;
        const previousSecret = process.env.MEMBERSHIP_BRIDGE_ISSUER_SECRET;

        setMembershipIssuerEnv({
            keyId: previousKey ?? null,
            secret: '',
        });

        try {
            const req = {
                params: { id: '7' },
                userId: 88,
                body: {},
            } as any;
            const res = createMockResponse();
            const next = jest.fn();

            await handler(req, res as any, next);

            expect(next).toHaveBeenCalledWith(expect.objectContaining({
                message: 'missing_membership_bridge_issuer_secret',
            }));
        } finally {
            setMembershipIssuerEnv({
                keyId: previousKey ?? null,
                secret: previousSecret ?? null,
            });
        }
    });

    test('POST /circles/:id/join forwards a clear error when the membership attestor key and secret mismatch', async () => {
        const prisma = createJoinPrismaMock();
        const router = membershipRouter(prisma as any, { publish: jest.fn(async () => 1) } as any);
        const handler = getRouteHandler(router, '/circles/:id/join', 'post');
        const previousKey = process.env.MEMBERSHIP_BRIDGE_ISSUER_KEY_ID;
        const previousSecret = process.env.MEMBERSHIP_BRIDGE_ISSUER_SECRET;

        setMembershipIssuerEnv({
            keyId: new PublicKey('4wBqpZM9xaGgkQ8WXVbwyodH4qzM7gc3KJ2YMBX1AHzm').toBase58(),
            secret: previousSecret ?? null,
        });

        try {
            const req = {
                params: { id: '7' },
                userId: 88,
                body: {},
            } as any;
            const res = createMockResponse();
            const next = jest.fn();

            await handler(req, res as any, next);

            expect(next).toHaveBeenCalledWith(expect.objectContaining({
                message: 'membership_bridge_issuer_key_mismatch',
            }));
        } finally {
            setMembershipIssuerEnv({
                keyId: previousKey ?? null,
                secret: previousSecret ?? null,
            });
        }
    });

    test('POST /circles/:id/join blocks on entitlement-backed crystal deficits', async () => {
        const prisma = createJoinPrismaMock({
            circle: {
                joinRequirement: 'TokenGated',
                minCrystals: 3,
            },
            entitlements: [
                {
                    ownerPubkey: '8YtN3rH6cQn5Aq9pkNfKQbH4sD7mL2xV5pR1tZuE9cAa',
                    status: 'active',
                    circleId: 7,
                },
            ],
        });
        const router = membershipRouter(prisma as any, { publish: jest.fn(async () => 1) } as any);
        const handler = getRouteHandler(router, '/circles/:id/join', 'post');

        const req = {
            params: { id: '7' },
            userId: 88,
            body: {},
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(403);
        expect(res.payload).toMatchObject({
            error: 'insufficient_crystals',
            joinState: 'insufficient_crystals',
            minCrystals: 3,
            userCrystals: 1,
            missingCrystals: 2,
        });
        expect((prisma.crystalEntitlement.count as any)).toHaveBeenCalled();
        expect((prisma.knowledge.count as any)).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('POST /circles/:id/join returns reactivation shim for existing inactive membership', async () => {
        const prisma = createJoinPrismaMock({
            membership: {
                id: 77,
                circleId: 7,
                userId: 88,
                role: 'Member',
                status: 'Left',
            },
        });
        const router = membershipRouter(prisma as any, { publish: jest.fn(async () => 1) } as any);
        const handler = getRouteHandler(router, '/circles/:id/join', 'post');

        const req = {
            params: { id: '7' },
            userId: 88,
            body: {},
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            circleId: 7,
            joinState: 'can_join',
            finalization: {
                action: 'reactivate_existing',
            },
        });
        expect((prisma.circleMember.create as any)).not.toHaveBeenCalled();
        expect((prisma.circleMember.update as any)).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('POST /circles/:id/join consumes explicit invite artifact into a claim grant', async () => {
        const prisma = createJoinPrismaMock({
            invite: {
                id: 601,
                code: 'invite-601',
                circleId: 7,
                status: 'Active',
                inviteeUserId: 88,
                inviteeHandle: null,
                expiresAt: new Date(Date.now() + 60_000),
            },
        });
        const router = membershipRouter(prisma as any, { publish: jest.fn(async () => 1) } as any);
        const handler = getRouteHandler(router, '/circles/:id/join', 'post');

        const req = {
            params: { id: '7' },
            userId: 88,
            body: { inviteCode: 'invite-601' },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            circleId: 7,
            joinState: 'can_join',
            finalization: {
                action: 'claim_membership',
                grant: expect.objectContaining({
                    kind: 'Invite',
                    artifactId: 601,
                }),
            },
        });
        expect((prisma.circleInvite.update as any)).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 601 },
            }),
        );
        expect((prisma.circleMember.create as any)).not.toHaveBeenCalled();
        expect((prisma.circleMember.update as any)).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('POST /circles/:id/join reuses an accepted invite artifact for the same user during claim retry', async () => {
        const prisma = createJoinPrismaMock({
            circle: {
                joinRequirement: 'InviteOnly',
                circleType: 'Closed',
            },
            invite: {
                id: 602,
                code: 'invite-602',
                circleId: 7,
                status: 'Accepted',
                acceptedById: 88,
                inviteeUserId: null,
                inviteeHandle: null,
                expiresAt: new Date(Date.now() + 60_000),
            },
        });
        const router = membershipRouter(prisma as any, { publish: jest.fn(async () => 1) } as any);
        const handler = getRouteHandler(router, '/circles/:id/join', 'post');

        const req = {
            params: { id: '7' },
            userId: 88,
            body: { inviteCode: 'invite-602' },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            circleId: 7,
            joinState: 'can_join',
            finalization: {
                action: 'claim_membership',
                grant: expect.objectContaining({
                    kind: 'Invite',
                    artifactId: 602,
                }),
            },
        });
        expect((prisma.circleInvite.update as any)).not.toHaveBeenCalled();
        expect((prisma.circleMember.create as any)).not.toHaveBeenCalled();
        expect((prisma.circleMember.update as any)).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('POST /circles/:id/join discovers an accepted targeted invite for retry without a code', async () => {
        const prisma = createJoinPrismaMock({
            circle: {
                joinRequirement: 'InviteOnly',
                circleType: 'Closed',
            },
            invite: {
                id: 603,
                code: 'invite-603',
                circleId: 7,
                status: 'Accepted',
                acceptedById: 88,
                inviteeUserId: 88,
                inviteeHandle: null,
                expiresAt: new Date(Date.now() + 60_000),
            },
        });
        const router = membershipRouter(prisma as any, { publish: jest.fn(async () => 1) } as any);
        const handler = getRouteHandler(router, '/circles/:id/join', 'post');

        const req = {
            params: { id: '7' },
            userId: 88,
            body: {},
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            circleId: 7,
            joinState: 'can_join',
            finalization: {
                action: 'claim_membership',
                grant: expect.objectContaining({
                    kind: 'Invite',
                    artifactId: 603,
                }),
            },
        });
        expect((prisma.circleInvite.update as any)).not.toHaveBeenCalled();
        expect((prisma.circleMember.create as any)).not.toHaveBeenCalled();
        expect((prisma.circleMember.update as any)).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    test('POST /circles/:id/join-requests/:requestId/approve no longer activates membership directly', async () => {
        const prisma = createJoinPrismaMock();
        const router = membershipRouter(prisma as any, { publish: jest.fn(async () => 1) } as any);
        const handler = getRouteHandler(router, '/circles/:id/join-requests/:requestId/approve', 'post');

        const req = {
            userId: 42,
            params: { id: '7', requestId: '701' },
            body: { reason: 'approved' },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await handler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toMatchObject({
            ok: true,
            circleId: 7,
            requestId: 701,
            status: 'Approved',
            finalizationPending: true,
        });
        expect((prisma.circleMember.create as any)).not.toHaveBeenCalled();
        expect((prisma.circleMember.update as any)).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });
});
