import { describe, expect, test } from '@jest/globals';

import {
    isAuthSessionPath,
    isCircleRuntimeReadPath,
    isDraftRuntimeReadPath,
    isDiscussionMessageReadPath,
    isDiscussionMessageWritePath,
    resolveRateLimitBucketKey,
    resolveRateLimitSettings,
} from '../rateLimiter';

describe('discussion read rate-limit policy', () => {
    test('routes circle and knowledge message reads into discussion_read bucket', () => {
        expect(isDiscussionMessageReadPath('GET', '/discussion/circles/88/messages')).toBe(true);
        expect(isDiscussionMessageReadPath('GET', '/discussion/knowledge/kn_99/messages')).toBe(true);
        expect(isDiscussionMessageReadPath('GET', '/discussion/drafts/187/edit-anchors')).toBe(true);
        expect(
            resolveRateLimitBucketKey({
                method: 'GET',
                path: '/discussion/circles/88/messages',
                ip: '127.0.0.1',
            }),
        ).toBe('discussion_read:ip:127.0.0.1');
        expect(
            resolveRateLimitBucketKey({
                method: 'GET',
                path: '/discussion/drafts/187/edit-anchors',
                ip: '127.0.0.1',
            }),
        ).toBe('discussion_read:ip:127.0.0.1');
    });

    test('keeps write routes and unrelated API routes in default bucket', () => {
        expect(isDiscussionMessageReadPath('POST', '/discussion/circles/88/messages')).toBe(false);
        expect(isDiscussionMessageReadPath('GET', '/discussion/circles/88/messages/forward')).toBe(false);
        expect(isDiscussionMessageWritePath('GET', '/discussion/circles/88/messages')).toBe(false);
        expect(
            resolveRateLimitBucketKey({
                method: 'POST',
                path: '/posts/feed',
                ip: '127.0.0.1',
            }),
        ).toBe('api_default:ip:127.0.0.1');
    });

    test('routes discussion writes into a sender-scoped bucket', () => {
        expect(isDiscussionMessageWritePath('POST', '/discussion/circles/88/messages')).toBe(true);
        expect(isDiscussionMessageWritePath('POST', '/discussion/knowledge/kn_99/messages')).toBe(true);
        expect(
            resolveRateLimitBucketKey({
                method: 'POST',
                path: '/discussion/circles/88/messages',
                ip: '127.0.0.1',
                senderPubkey: 'Sender111',
            }),
        ).toBe('discussion_write:sender:Sender111');
    });

    test('routes session and circle runtime reads into dedicated user buckets', () => {
        expect(isAuthSessionPath('GET', '/auth/session/me')).toBe(true);
        expect(isCircleRuntimeReadPath('GET', '/membership/circles/88/identity-status')).toBe(true);
        expect(isDraftRuntimeReadPath('GET', '/draft-lifecycle/drafts/2')).toBe(true);
        expect(isDraftRuntimeReadPath('GET', '/discussion/drafts/2/discussions')).toBe(true);
        expect(
            resolveRateLimitBucketKey({
                method: 'GET',
                path: '/auth/session/me',
                ip: '127.0.0.1',
                userId: 42,
            }),
        ).toBe('auth_session:user:42');
        expect(
            resolveRateLimitBucketKey({
                method: 'GET',
                path: '/membership/circles/88/me',
                ip: '127.0.0.1',
                userId: 42,
            }),
        ).toBe('circle_runtime:user:42');
        expect(
            resolveRateLimitBucketKey({
                method: 'GET',
                path: '/draft-lifecycle/drafts/2',
                ip: '127.0.0.1',
                userId: 42,
            }),
        ).toBe('draft_runtime:user:42');
    });

    test('parses explicit discussion read/window configuration from env', () => {
        const settings = resolveRateLimitSettings({
            API_RATE_LIMIT_WINDOW_MS: '120000',
            API_RATE_LIMIT_MAX: '240',
            DISCUSSION_READ_RATE_LIMIT_MAX: '1800',
            DISCUSSION_WRITE_RATE_LIMIT_MAX: '320',
            AUTH_SESSION_RATE_LIMIT_MAX: '480',
            CIRCLE_RUNTIME_RATE_LIMIT_MAX: '900',
            DRAFT_RUNTIME_RATE_LIMIT_MAX: '1500',
        } as NodeJS.ProcessEnv);

        expect(settings).toEqual({
            windowMs: 120000,
            defaultMax: 240,
            discussionReadMax: 1800,
            discussionWriteMax: 320,
            authSessionMax: 480,
            circleRuntimeMax: 900,
            draftRuntimeMax: 1500,
        });
    });

    test('falls back to defaults when env values are invalid', () => {
        const settings = resolveRateLimitSettings({
            API_RATE_LIMIT_WINDOW_MS: '-1',
            API_RATE_LIMIT_MAX: 'bad',
            DISCUSSION_READ_RATE_LIMIT_MAX: '0',
            DISCUSSION_WRITE_RATE_LIMIT_MAX: '-2',
            AUTH_SESSION_RATE_LIMIT_MAX: 'wat',
            CIRCLE_RUNTIME_RATE_LIMIT_MAX: '0',
            DRAFT_RUNTIME_RATE_LIMIT_MAX: '',
        } as NodeJS.ProcessEnv);

        expect(settings.windowMs).toBe(15 * 60 * 1000);
        expect(settings.defaultMax).toBe(100);
        expect(settings.discussionReadMax).toBe(1200);
        expect(settings.discussionWriteMax).toBe(240);
        expect(settings.authSessionMax).toBe(600);
        expect(settings.circleRuntimeMax).toBe(600);
        expect(settings.draftRuntimeMax).toBe(1200);
    });
});
