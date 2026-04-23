import { afterEach, describe, expect, jest, test } from '@jest/globals';

import { generateToken } from '../src/middleware/auth';
import { sessionAuth } from '../src/middleware/sessionAuth';

class MockRedis {
    async get(): Promise<string | null> {
        return null;
    }

    async del(): Promise<number> {
        return 0;
    }
}

function createRequest(token: string) {
    return {
        headers: {
            authorization: `Bearer ${token}`,
        },
    } as any;
}

describe('sessionAuth legacy bearer fallback', () => {
    const previousLegacyBearer = process.env.AUTH_SESSION_ALLOW_LEGACY_BEARER;

    afterEach(() => {
        if (previousLegacyBearer === undefined) {
            delete process.env.AUTH_SESSION_ALLOW_LEGACY_BEARER;
        } else {
            process.env.AUTH_SESSION_ALLOW_LEGACY_BEARER = previousLegacyBearer;
        }
    });

    test('does not authenticate legacy bearer tokens by default', async () => {
        delete process.env.AUTH_SESSION_ALLOW_LEGACY_BEARER;

        const token = generateToken('11111111111111111111111111111111', '42');
        const req = createRequest(token);
        const res = { clearCookie() { return this; } } as any;
        const next = jest.fn();

        await sessionAuth(new MockRedis() as any)(req, res, next);

        expect((req as any).userId).toBeUndefined();
        expect((req as any).userPubkey).toBeUndefined();
        expect(next).toHaveBeenCalled();
    });

    test('authenticates legacy bearer tokens only when the explicit fallback flag is enabled', async () => {
        process.env.AUTH_SESSION_ALLOW_LEGACY_BEARER = '1';

        const token = generateToken('11111111111111111111111111111111', '42');
        const req = createRequest(token);
        const res = { clearCookie() { return this; } } as any;
        const next = jest.fn();

        await sessionAuth(new MockRedis() as any)(req, res, next);

        expect((req as any).userId).toBe(42);
        expect((req as any).userPubkey).toBe('11111111111111111111111111111111');
        expect(next).toHaveBeenCalled();
    });
});
