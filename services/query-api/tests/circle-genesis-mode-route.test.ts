import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Router } from 'express';

const verifyEd25519SignatureBase64Mock = jest.fn();

jest.mock('../src/services/offchainDiscussion', () => ({
    verifyEd25519SignatureBase64: verifyEd25519SignatureBase64Mock,
}));

import { circleRouter } from '../src/rest/circles';

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

describe('circle genesis mode route', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        verifyEd25519SignatureBase64Mock.mockReturnValue(true);
    });

    test('persists canonical genesis mode through query-api for circle managers', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async ({ where }: any) => {
                    if (where?.id === 7) {
                        return {
                            id: 7,
                            creator: { pubkey: 'owner-pubkey' },
                        };
                    }
                    return null;
                }),
                update: jest.fn(async ({ data }: any) => ({
                    id: 7,
                    genesisMode: data.genesisMode,
                })),
            },
        } as any;

        const router = circleRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/:id/genesis-mode', 'put');
        const res = createMockResponse();

        await handler({
            params: { id: '7' },
            body: {
                actorPubkey: 'owner-pubkey',
                genesisMode: 'SEEDED',
                signedMessage: 'alcheme-circle-genesis-mode:{"v":1,"action":"genesis_mode_update","circleId":7,"actorPubkey":"owner-pubkey","genesisMode":"SEEDED","clientTimestamp":"2026-03-24T00:00:00.000Z","nonce":"abc"}',
                signature: 'base64-signature',
            },
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(200);
        expect(prisma.circle.update).toHaveBeenCalledWith({
            where: { id: 7 },
            data: { genesisMode: 'SEEDED' },
            select: { id: true, genesisMode: true },
        });
        expect(res.payload).toMatchObject({
            circleId: 7,
            genesisMode: 'SEEDED',
        });
    });

    test('rejects genesis mode writes from non-managers', async () => {
        const prisma = {
            circle: {
                findUnique: jest.fn(async ({ where }: any) => {
                    if (where?.id === 7) {
                        return {
                            id: 7,
                            creator: { pubkey: 'someone-else' },
                        };
                    }
                    return null;
                }),
            },
            user: {
                findUnique: jest.fn(async () => ({
                    id: 9,
                })),
            },
            circleMember: {
                findUnique: jest.fn(async () => ({
                    role: 'Member',
                    status: 'Active',
                })),
            },
        } as any;

        const router = circleRouter(prisma, {} as any);
        const handler = getRouteHandler(router, '/:id/genesis-mode', 'put');
        const res = createMockResponse();

        await handler({
            params: { id: '7' },
            body: {
                actorPubkey: 'member-pubkey',
                genesisMode: 'BLANK',
                signedMessage: 'alcheme-circle-genesis-mode:{"v":1,"action":"genesis_mode_update","circleId":7,"actorPubkey":"member-pubkey","genesisMode":"BLANK","clientTimestamp":"2026-03-24T00:00:00.000Z","nonce":"abc"}',
                signature: 'base64-signature',
            },
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(403);
        expect(res.payload).toMatchObject({
            error: 'circle_genesis_mode_forbidden',
        });
    });
});
