import { describe, expect, test } from '@jest/globals';

import {
    isAuthSessionPath,
    isCircleRuntimeReadPath,
    isDiscussionMessageReadPath,
    isDiscussionMessageWritePath,
    resolveRateLimitBucketKey,
} from '../rateLimiter';

describe('rate limiter bucket routing', () => {
    test('identifies circle discussion message reads as realtime read path', () => {
        expect(isDiscussionMessageReadPath('GET', '/discussion/circles/36/messages')).toBe(true);
    });

    test('identifies knowledge discussion message reads as realtime read path', () => {
        expect(isDiscussionMessageReadPath('GET', '/discussion/knowledge/kn_123/messages')).toBe(true);
    });

    test('identifies draft anchor read routes as realtime read path', () => {
        expect(isDiscussionMessageReadPath('GET', '/discussion/drafts/187/edit-anchors')).toBe(true);
        expect(
            isDiscussionMessageReadPath(
                'GET',
                '/discussion/edit-anchors/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            ),
        ).toBe(true);
    });

    test('does not classify non-read discussion operations as realtime read path', () => {
        expect(isDiscussionMessageReadPath('POST', '/discussion/circles/36/messages')).toBe(false);
        expect(isDiscussionMessageReadPath('GET', '/discussion/circles/36/messages/extra')).toBe(false);
        expect(isDiscussionMessageReadPath('POST', '/discussion/drafts/187/edit-anchors')).toBe(false);
        expect(isDiscussionMessageWritePath('GET', '/discussion/circles/36/messages')).toBe(false);
    });

    test('routes discussion reads to dedicated bucket key', () => {
        expect(
            resolveRateLimitBucketKey({
                method: 'GET',
                path: '/discussion/circles/36/messages',
                ip: '127.0.0.1',
            }),
        ).toBe('discussion_read:ip:127.0.0.1');
    });

    test('routes discussion writes to a sender-scoped bucket key', () => {
        expect(isDiscussionMessageWritePath('POST', '/discussion/circles/36/messages')).toBe(true);
        expect(
            resolveRateLimitBucketKey({
                method: 'POST',
                path: '/discussion/circles/36/messages',
                ip: '127.0.0.1',
                senderPubkey: 'Sender111',
            }),
        ).toBe('discussion_write:sender:Sender111');
    });

    test('routes session and circle runtime paths away from the default bucket', () => {
        expect(isAuthSessionPath('GET', '/auth/session/me')).toBe(true);
        expect(isCircleRuntimeReadPath('GET', '/membership/circles/36/me')).toBe(true);
        expect(
            resolveRateLimitBucketKey({
                method: 'GET',
                path: '/auth/session/me',
                ip: '127.0.0.1',
                userId: 9,
            }),
        ).toBe('auth_session:user:9');
        expect(
            resolveRateLimitBucketKey({
                method: 'GET',
                path: '/membership/circles/36/me',
                ip: '127.0.0.1',
                userId: 9,
            }),
        ).toBe('circle_runtime:user:9');
    });

    test('routes non-discussion reads to default bucket key', () => {
        expect(
            resolveRateLimitBucketKey({
                method: 'GET',
                path: '/posts/feed',
                ip: '127.0.0.1',
            }),
        ).toBe('api_default:ip:127.0.0.1');
    });
});
