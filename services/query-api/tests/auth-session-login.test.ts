import { describe, expect, test, jest } from '@jest/globals';
import type { Router } from 'express';
import { Connection } from '@solana/web3.js';

import { authRouter } from '../src/rest/auth';

class MockRedis {
    private store = new Map<string, string>();

    async get(key: string): Promise<string | null> {
        return this.store.get(key) ?? null;
    }

    async setex(key: string, _ttlSec: number, value: string): Promise<'OK'> {
        this.store.set(key, value);
        return 'OK';
    }

    async del(key: string): Promise<number> {
        const existed = this.store.delete(key);
        return existed ? 1 : 0;
    }
}

function getRouteHandler(router: Router, path: string, method: 'get' | 'post') {
    const routeLayer = findRouteLayer((router as any).stack, path, method);
    if (!routeLayer?.handle) {
        throw new Error(`route handler not found for ${method.toUpperCase()} ${path}`);
    }
    return routeLayer.handle;
}

function createMockResponse() {
    return {
        statusCode: 200,
        payload: null as any,
        cookies: [] as Array<{ name: string; value: string; options: unknown }>,
        clearedCookies: [] as Array<{ name: string; options: unknown }>,
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        json(payload: any) {
            this.payload = payload;
            return this;
        },
        cookie(name: string, value: string, options: unknown) {
            this.cookies.push({ name, value, options });
            return this;
        },
        clearCookie(name: string, options: unknown) {
            this.clearedCookies.push({ name, options });
            return this;
        },
    };
}

function findRouteLayer(stack: any[], path: string, method: 'get' | 'post'): any | null {
    for (const item of stack) {
        if (item.route?.path === path) {
            const matched = [...(item.route?.stack || [])]
                .reverse()
                .find((entry: any) => entry.method === method);
            if (matched) return matched;
        }
        const nestedStack = item.handle?.stack;
        if (Array.isArray(nestedStack)) {
            const matched = findRouteLayer(nestedStack, path, method);
            if (matched) return matched;
        }
    }
    return null;
}

function hasRouteHandler(router: Router, path: string, method: 'get' | 'post') {
    return Boolean(findRouteLayer((router as any).stack, path, method));
}

describe('auth session login route', () => {
    test('returns a client error for malformed invalid signatures instead of throwing 500', async () => {
        const previousSignaturePolicy = process.env.AUTH_SESSION_REQUIRE_SIGNATURE;
        process.env.AUTH_SESSION_REQUIRE_SIGNATURE = 'false';

        const prisma = {
            user: {
                findUnique: jest.fn(async () => ({
                    id: 1,
                    pubkey: '11111111111111111111111111111111',
                    handle: 'Alchem_dev01',
                    displayName: null,
                    avatarUri: null,
                    createdAt: new Date('2026-03-12T17:47:05.000Z'),
                })),
            },
        } as any;
        const redis = new MockRedis();

        const router = authRouter(prisma, redis as any);
        const nonceHandler = getRouteHandler(router, '/session/nonce', 'get');
        const loginHandler = getRouteHandler(router, '/session/login', 'post');

        const publicKey = '11111111111111111111111111111111';

        const nonceReq = {
            query: { publicKey },
            headers: {},
            hostname: '127.0.0.1',
        } as any;
        const nonceRes = createMockResponse();
        const nonceNext = jest.fn();

        await nonceHandler(nonceReq, nonceRes as any, nonceNext);

        expect(nonceRes.statusCode).toBe(200);
        expect(nonceNext).not.toHaveBeenCalled();

        const loginReq = {
            body: {
                publicKey,
                message: nonceRes.payload.message,
                signature: Buffer.from([1, 2, 3]).toString('base64'),
            },
        } as any;
        const loginRes = createMockResponse();
        const loginNext = jest.fn();

        await loginHandler(loginReq, loginRes as any, loginNext);

        expect(loginRes.statusCode).toBe(400);
        expect(loginRes.payload).toEqual({ error: 'invalid signature encoding' });
        expect(loginRes.cookies).toHaveLength(0);
        expect(loginNext).not.toHaveBeenCalled();

        if (previousSignaturePolicy === undefined) {
            delete process.env.AUTH_SESSION_REQUIRE_SIGNATURE;
        } else {
            process.env.AUTH_SESSION_REQUIRE_SIGNATURE = previousSignaturePolicy;
        }
    });

    test('treats db-only users without on-chain identity accounts as identity_not_registered during session login', async () => {
        const previousRpcUrl = process.env.SOLANA_RPC_URL;
        const previousProgramId = process.env.NEXT_PUBLIC_IDENTITY_PROGRAM_ID;
        process.env.SOLANA_RPC_URL = 'http://127.0.0.1:8899';
        process.env.NEXT_PUBLIC_IDENTITY_PROGRAM_ID = '75fXAp66PU3sgUcQCGJxdA4MKhFcyXXoGW8rhVk8zm4x';

        const getAccountInfoSpy = jest
            .spyOn(Connection.prototype, 'getAccountInfo')
            .mockResolvedValueOnce({ executable: false } as any)
            .mockResolvedValueOnce(null as any);

        const prisma = {
            user: {
                findUnique: jest.fn(async () => ({
                    id: 1,
                    pubkey: 'EAA3QUoPhDDrhausKwMzPzdysRPYi4obM6MRnS2sztUe',
                    handle: 'Alchem_dev01',
                    displayName: null,
                    avatarUri: null,
                    createdAt: new Date('2026-03-12T17:47:05.000Z'),
                })),
            },
        } as any;
        const redis = new MockRedis();

        const router = authRouter(prisma, redis as any);
        const nonceHandler = getRouteHandler(router, '/session/nonce', 'get');
        const loginHandler = getRouteHandler(router, '/session/login', 'post');

        const publicKey = 'EAA3QUoPhDDrhausKwMzPzdysRPYi4obM6MRnS2sztUe';

        const nonceReq = {
            query: { publicKey },
            headers: {},
            hostname: '127.0.0.1',
        } as any;
        const nonceRes = createMockResponse();

        await nonceHandler(nonceReq, nonceRes as any, jest.fn());

        const loginReq = {
            body: {
                publicKey,
                message: nonceRes.payload.message,
            },
        } as any;
        const loginRes = createMockResponse();
        const loginNext = jest.fn();

        await loginHandler(loginReq, loginRes as any, loginNext);

        expect(loginRes.statusCode).toBe(401);
        expect(loginRes.payload).toMatchObject({
            code: 'identity_not_registered',
            error: 'User not registered. Please register on-chain first.',
        });
        expect(loginRes.cookies).toHaveLength(0);
        expect(loginNext).not.toHaveBeenCalled();
        expect(getAccountInfoSpy).toHaveBeenCalledTimes(2);

        getAccountInfoSpy.mockRestore();
        if (previousRpcUrl === undefined) {
            delete process.env.SOLANA_RPC_URL;
        } else {
            process.env.SOLANA_RPC_URL = previousRpcUrl;
        }
        if (previousProgramId === undefined) {
            delete process.env.NEXT_PUBLIC_IDENTITY_PROGRAM_ID;
        } else {
            process.env.NEXT_PUBLIC_IDENTITY_PROGRAM_ID = previousProgramId;
        }
    });

    test('session me clears stale authenticated state when the on-chain identity account is missing', async () => {
        const previousRpcUrl = process.env.SOLANA_RPC_URL;
        const previousProgramId = process.env.NEXT_PUBLIC_IDENTITY_PROGRAM_ID;
        process.env.SOLANA_RPC_URL = 'http://127.0.0.1:8899';
        process.env.NEXT_PUBLIC_IDENTITY_PROGRAM_ID = '75fXAp66PU3sgUcQCGJxdA4MKhFcyXXoGW8rhVk8zm4x';

        const getAccountInfoSpy = jest
            .spyOn(Connection.prototype, 'getAccountInfo')
            .mockResolvedValueOnce({ executable: false } as any)
            .mockResolvedValueOnce(null as any);

        const prisma = {
            user: {
                findUnique: jest.fn(async () => ({
                    id: 1,
                    pubkey: 'EAA3QUoPhDDrhausKwMzPzdysRPYi4obM6MRnS2sztUe',
                    handle: 'Alchem_dev01',
                    displayName: null,
                    avatarUri: null,
                    createdAt: new Date('2026-03-12T17:47:05.000Z'),
                })),
            },
        } as any;
        const redis = new MockRedis();
        await redis.setex('auth:session:stale-session', 60, JSON.stringify({
            sessionId: 'stale-session',
            userId: 1,
            pubkey: 'EAA3QUoPhDDrhausKwMzPzdysRPYi4obM6MRnS2sztUe',
            createdAt: '2026-04-01T00:00:00.000Z',
            lastSeenAt: '2026-04-01T00:00:00.000Z',
            expiresAt: '2026-04-02T00:00:00.000Z',
        }));

        const router = authRouter(prisma, redis as any);
        const sessionMeHandler = getRouteHandler(router, '/session/me', 'get');

        const req = {
            userId: 1,
            sessionId: 'stale-session',
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await sessionMeHandler(req, res as any, next);

        expect(res.statusCode).toBe(200);
        expect(res.payload).toEqual({ authenticated: false });
        expect(res.clearedCookies).toHaveLength(1);
        expect(next).not.toHaveBeenCalled();
        expect(await redis.get('auth:session:stale-session')).toBeNull();
        expect(getAccountInfoSpy).toHaveBeenCalledTimes(2);

        getAccountInfoSpy.mockRestore();
        if (previousRpcUrl === undefined) {
            delete process.env.SOLANA_RPC_URL;
        } else {
            process.env.SOLANA_RPC_URL = previousRpcUrl;
        }
        if (previousProgramId === undefined) {
            delete process.env.NEXT_PUBLIC_IDENTITY_PROGRAM_ID;
        } else {
            process.env.NEXT_PUBLIC_IDENTITY_PROGRAM_ID = previousProgramId;
        }
    });

    test('returns identity_not_registered code for wallets without synced identity rows', async () => {
        const prisma = {
            user: {
                findUnique: jest.fn(async () => null),
            },
        } as any;
        const redis = new MockRedis();

        const router = authRouter(prisma, redis as any);
        const nonceHandler = getRouteHandler(router, '/session/nonce', 'get');
        const loginHandler = getRouteHandler(router, '/session/login', 'post');

        const publicKey = '11111111111111111111111111111111';

        const nonceReq = {
            query: { publicKey },
            headers: {},
            hostname: '127.0.0.1',
        } as any;
        const nonceRes = createMockResponse();
        const nonceNext = jest.fn();

        await nonceHandler(nonceReq, nonceRes as any, nonceNext);

        expect(nonceRes.statusCode).toBe(200);
        expect(nonceNext).not.toHaveBeenCalled();

        const loginReq = {
            body: {
                publicKey,
                message: nonceRes.payload.message,
            },
        } as any;
        const loginRes = createMockResponse();
        const loginNext = jest.fn();

        await loginHandler(loginReq, loginRes as any, loginNext);

        expect(loginRes.statusCode).toBe(401);
        expect(loginRes.payload).toMatchObject({
            code: 'identity_not_registered',
            error: 'User not registered. Please register on-chain first.',
        });
        expect(loginRes.cookies).toHaveLength(0);
        expect(loginNext).not.toHaveBeenCalled();
        expect(prisma.user.findUnique).toHaveBeenCalledWith({
            where: { pubkey: publicKey },
            select: {
                id: true,
                pubkey: true,
                handle: true,
                displayName: true,
                avatarUri: true,
                createdAt: true,
            },
        });
    });

    test('does not mount legacy bearer login routes unless explicitly enabled', async () => {
        const previous = process.env.AUTH_ENABLE_LEGACY_JWT_LOGIN;
        delete process.env.AUTH_ENABLE_LEGACY_JWT_LOGIN;

        const router = authRouter({} as any, new MockRedis() as any);
        expect(hasRouteHandler(router, '/login', 'post')).toBe(false);
        expect(hasRouteHandler(router, '/verify', 'post')).toBe(false);
        expect(hasRouteHandler(router, '/refresh', 'post')).toBe(false);

        process.env.AUTH_ENABLE_LEGACY_JWT_LOGIN = '1';
        const enabledRouter = authRouter({} as any, new MockRedis() as any);
        expect(hasRouteHandler(enabledRouter, '/login', 'post')).toBe(true);
        expect(hasRouteHandler(enabledRouter, '/verify', 'post')).toBe(false);
        expect(hasRouteHandler(enabledRouter, '/refresh', 'post')).toBe(false);

        if (previous === undefined) {
            delete process.env.AUTH_ENABLE_LEGACY_JWT_LOGIN;
        } else {
            process.env.AUTH_ENABLE_LEGACY_JWT_LOGIN = previous;
        }
    });

    test('legacy login returns the same identity_not_registered code when enabled', async () => {
        const previous = process.env.AUTH_ENABLE_LEGACY_JWT_LOGIN;
        process.env.AUTH_ENABLE_LEGACY_JWT_LOGIN = '1';

        const prisma = {
            user: {
                findUnique: jest.fn(async () => null),
            },
        } as any;
        const router = authRouter(prisma, new MockRedis() as any);
        const loginHandler = getRouteHandler(router, '/login', 'post');

        const req = {
            user: {
                publicKey: '11111111111111111111111111111111',
            },
        } as any;
        const res = createMockResponse();
        const next = jest.fn();

        await loginHandler(req, res as any, next);

        expect(res.statusCode).toBe(401);
        expect(res.payload).toMatchObject({
            code: 'identity_not_registered',
            error: 'User not registered. Please register on-chain first.',
        });
        expect(next).not.toHaveBeenCalled();

        if (previous === undefined) {
            delete process.env.AUTH_ENABLE_LEGACY_JWT_LOGIN;
        } else {
            process.env.AUTH_ENABLE_LEGACY_JWT_LOGIN = previous;
        }
    });
});
