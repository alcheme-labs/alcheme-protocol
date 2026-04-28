import { describe, expect, test } from '@jest/globals';

import { IdentityLevel } from '../thresholds';
import {
    buildCompletedIdentityTransitionReason,
    buildIdentityHint,
    buildIdentityNotification,
} from '../copy';

describe('identity copy helpers', () => {
    const thresholds = {
        initiateMessages: 3,
        memberCitations: 2,
        elderPercentile: 10,
        inactivityDays: 30,
    };

    test('returns a neutral member hint when elder threshold is not met', () => {
        expect(buildIdentityHint({
            currentLevel: IdentityLevel.Member,
            thresholds,
            messageCount: 0,
            citationCount: 0,
            reputationPercentile: 30,
            locale: 'zh',
        })).toBe('当前信誉位于前 30%（需进入前 10%）方可晋升为长老。');
    });

    test('returns an eligibility member hint when elder threshold is met', () => {
        expect(buildIdentityHint({
            currentLevel: IdentityLevel.Member,
            thresholds,
            messageCount: 0,
            citationCount: 0,
            reputationPercentile: 8,
            locale: 'zh',
        })).toBe('当前信誉位于前 8%（阈值前 10%）可晋升为长老。');
    });

    test('builds completed visitor promotion wording', () => {
        expect(buildCompletedIdentityTransitionReason({
            previousLevel: IdentityLevel.Visitor,
            newLevel: IdentityLevel.Initiate,
            thresholds,
            messageCount: 4,
            citationCount: 0,
        })).toBe('已发送 4 条消息，达到 3 条门槛，已晋升为入局者。');
    });

    test('builds completed initiate promotion wording', () => {
        expect(buildCompletedIdentityTransitionReason({
            previousLevel: IdentityLevel.Initiate,
            newLevel: IdentityLevel.Member,
            thresholds,
            messageCount: 0,
            citationCount: 3,
        })).toBe('已获得 3 次引用，达到 2 次门槛，已晋升为成员。');
    });

    test('builds completed elder promotion wording', () => {
        expect(buildCompletedIdentityTransitionReason({
            previousLevel: IdentityLevel.Member,
            newLevel: IdentityLevel.Elder,
            thresholds,
            messageCount: 0,
            citationCount: 0,
            reputationPercentile: 10,
        })).toBe('当前信誉位于前 10%（阈值前 10%），已晋升为长老。');
    });

    test('does not store localized fallback circle labels in identity metadata', () => {
        const notification = buildIdentityNotification({
            circleId: 7,
            circleName: null,
            previousLevel: IdentityLevel.Elder,
            newLevel: IdentityLevel.Member,
            reason: '当前信誉已降至前 35% 之外（阈值前 10%），身份调整为成员。',
        });

        expect(notification.title).toBe('identity.level_changed');
        expect(notification.body).toBeNull();
        expect(notification.metadata.params).toEqual(expect.objectContaining({
            previousLevel: IdentityLevel.Elder,
            nextLevel: IdentityLevel.Member,
            reasonKey: 'identity.reputation_demotion',
            reasonParams: {
                reputationPercentile: '35',
                threshold: '10',
            },
        }));
        expect(notification.metadata.params).not.toHaveProperty('circleName');
    });
});
