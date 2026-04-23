import { afterEach, describe, expect, test } from '@jest/globals';

import {
    parseIdentityNotificationMode,
    parseIdentityPolicyByCircle,
    serviceConfig,
} from '../../config/services';
import {
    DEFAULT_THRESHOLDS,
    IdentityLevel,
    getIdentityNotificationMode,
    getThresholds,
    shouldNotifyIdentityTransition,
} from '../thresholds';

describe('identity threshold and notification policy config', () => {
    const originalNotificationMode = serviceConfig.identity.notificationMode;
    const originalCirclePolicies = serviceConfig.identity.circlePolicies;

    afterEach(() => {
        serviceConfig.identity.notificationMode = originalNotificationMode;
        serviceConfig.identity.circlePolicies = originalCirclePolicies;
    });

    test('parses per-circle identity policy JSON and ignores invalid entries', () => {
        const parsed = parseIdentityPolicyByCircle(JSON.stringify({
            7: {
                initiateMessages: 5,
                memberCitations: '3',
                elderPercentile: 15,
                inactivityDays: 45,
                notificationMode: 'promotion_only',
            },
            8: {
                notificationMode: 'none',
            },
            invalid: {
                initiateMessages: 9,
            },
        }));

        expect(parsed[7]).toMatchObject({
            initiateMessages: 5,
            memberCitations: 3,
            elderPercentile: 15,
            inactivityDays: 45,
            notificationMode: 'promotion_only',
        });
        expect(parsed[8]).toMatchObject({
            notificationMode: 'none',
        });
        expect(parsed).not.toHaveProperty('invalid');
    });

    test('applies circle policy thresholds with explicit config taking precedence', () => {
        serviceConfig.identity.circlePolicies = {
            7: {
                initiateMessages: 9,
                memberCitations: 7,
                elderPercentile: 20,
                inactivityDays: 50,
            },
        };

        expect(getThresholds(null, 7)).toMatchObject({
            ...DEFAULT_THRESHOLDS,
            initiateMessages: 9,
            memberCitations: 7,
            elderPercentile: 20,
            inactivityDays: 50,
        });

        expect(
            getThresholds(
                {
                    identityThresholds: {
                        memberCitations: 11,
                    },
                },
                7,
            ),
        ).toMatchObject({
            ...DEFAULT_THRESHOLDS,
            initiateMessages: 9,
            memberCitations: 11,
            elderPercentile: 20,
            inactivityDays: 50,
        });
    });

    test('resolves notification mode with config > circle policy > global', () => {
        serviceConfig.identity.notificationMode = 'all';
        serviceConfig.identity.circlePolicies = {
            7: {
                notificationMode: 'none',
            },
        };

        expect(getIdentityNotificationMode(7, null)).toBe('none');
        expect(getIdentityNotificationMode(7, { identityNotificationMode: 'promotion_only' })).toBe('promotion_only');
        expect(getIdentityNotificationMode(7, { identityNotificationMode: 'invalid' })).toBe('none');
        expect(getIdentityNotificationMode(99, null)).toBe('all');
    });

    test('notification mode parser falls back safely', () => {
        expect(parseIdentityNotificationMode('promotion_only')).toBe('promotion_only');
        expect(parseIdentityNotificationMode('NONE')).toBe('none');
        expect(parseIdentityNotificationMode('bogus', 'all')).toBe('all');
    });

    test('promotion_only only notifies upward transitions', () => {
        expect(
            shouldNotifyIdentityTransition(
                IdentityLevel.Visitor,
                IdentityLevel.Initiate,
                'promotion_only',
            ),
        ).toBe(true);
        expect(
            shouldNotifyIdentityTransition(
                IdentityLevel.Elder,
                IdentityLevel.Member,
                'promotion_only',
            ),
        ).toBe(false);
    });
});
