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

describe('circle metadata route', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        verifyEd25519SignatureBase64Mock.mockReturnValue(true);
        jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-04-05T21:20:30.000Z').getTime());
    });

    test('persists signed circle description updates for circle managers', async () => {
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
                    name: '讨论沉淀实验室',
                    description: data.description,
                })),
            },
        } as any;

        const redis = {
            del: jest.fn(async () => 1),
        } as any;

        const router = circleRouter(prisma, redis);
        const handler = getRouteHandler(router, '/:id/metadata', 'put');
        const res = createMockResponse();

        await handler({
            params: { id: '7' },
            body: {
                actorPubkey: 'owner-pubkey',
                description: '一个专注于把高质量讨论沉淀为可执行草稿的协作圈层。',
                signedMessage: 'alcheme-circle-settings:{"v":1,"action":"circle_settings_publish","circleId":7,"actorPubkey":"owner-pubkey","settingKind":"circle_metadata","payload":{"description":"一个专注于把高质量讨论沉淀为可执行草稿的协作圈层。"},"clientTimestamp":"2026-04-05T21:20:00.000Z","nonce":"circle-metadata-01"}',
                signature: 'base64-signature',
            },
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(200);
        expect(prisma.circle.update).toHaveBeenCalledWith({
            where: { id: 7 },
            data: {
                description: '一个专注于把高质量讨论沉淀为可执行草稿的协作圈层。',
            },
            select: {
                id: true,
                name: true,
                description: true,
            },
        });
        expect(redis.del).toHaveBeenCalledWith('circle:7');
        expect(res.payload).toMatchObject({
            ok: true,
            circleId: 7,
            metadata: {
                description: '一个专注于把高质量讨论沉淀为可执行草稿的协作圈层。',
            },
        });
    });

    test('rejects circle metadata writes from non-managers', async () => {
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
                findUnique: jest.fn(async () => ({ id: 12 })),
            },
            circleMember: {
                findUnique: jest.fn(async () => ({
                    role: 'Member',
                    status: 'Active',
                })),
            },
        } as any;

        const router = circleRouter(prisma, { del: jest.fn() } as any);
        const handler = getRouteHandler(router, '/:id/metadata', 'put');
        const res = createMockResponse();

        await handler({
            params: { id: '7' },
            body: {
                actorPubkey: 'member-pubkey',
                description: '不应该写入',
                signedMessage: 'alcheme-circle-settings:{"v":1,"action":"circle_settings_publish","circleId":7,"actorPubkey":"member-pubkey","settingKind":"circle_metadata","payload":{"description":"不应该写入"},"clientTimestamp":"2026-04-05T21:20:00.000Z","nonce":"circle-metadata-02"}',
                signature: 'base64-signature',
            },
        } as any, res as any, jest.fn());

        expect(res.statusCode).toBe(403);
        expect(res.payload).toMatchObject({
            error: 'circle_metadata_forbidden',
        });
    });
});
