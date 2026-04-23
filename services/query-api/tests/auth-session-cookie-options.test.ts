import { afterEach, describe, expect, test } from '@jest/globals';

import { getAuthSessionCookieOptions } from '../src/auth/session';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_PUBLIC_BASE_URL = process.env.QUERY_API_PUBLIC_BASE_URL;
const ORIGINAL_COOKIE_SECURE = process.env.AUTH_SESSION_COOKIE_SECURE;

afterEach(() => {
    if (ORIGINAL_NODE_ENV === undefined) {
        delete process.env.NODE_ENV;
    } else {
        process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    }

    if (ORIGINAL_PUBLIC_BASE_URL === undefined) {
        delete process.env.QUERY_API_PUBLIC_BASE_URL;
    } else {
        process.env.QUERY_API_PUBLIC_BASE_URL = ORIGINAL_PUBLIC_BASE_URL;
    }

    if (ORIGINAL_COOKIE_SECURE === undefined) {
        delete process.env.AUTH_SESSION_COOKIE_SECURE;
    } else {
        process.env.AUTH_SESSION_COOKIE_SECURE = ORIGINAL_COOKIE_SECURE;
    }
});

describe('auth session cookie options', () => {
    test('keeps secure cookies enabled for https public base urls in production', () => {
        process.env.NODE_ENV = 'production';
        process.env.QUERY_API_PUBLIC_BASE_URL = 'https://demo.alcheme.test';
        delete process.env.AUTH_SESSION_COOKIE_SECURE;

        expect(getAuthSessionCookieOptions().secure).toBe(true);
    });

    test('disables secure cookies for http demo public base urls in production', () => {
        process.env.NODE_ENV = 'production';
        process.env.QUERY_API_PUBLIC_BASE_URL = 'http://43.162.99.248';
        delete process.env.AUTH_SESSION_COOKIE_SECURE;

        expect(getAuthSessionCookieOptions().secure).toBe(false);
    });

    test('lets explicit AUTH_SESSION_COOKIE_SECURE override inferred protocol', () => {
        process.env.NODE_ENV = 'production';
        process.env.QUERY_API_PUBLIC_BASE_URL = 'https://demo.alcheme.test';
        process.env.AUTH_SESSION_COOKIE_SECURE = 'false';

        expect(getAuthSessionCookieOptions().secure).toBe(false);
    });
});
