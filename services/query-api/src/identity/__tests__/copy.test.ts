import { describe, expect, test } from '@jest/globals';

import { IdentityLevel } from '../thresholds';
import {
    buildCompletedIdentityTransitionReason,
    buildIdentityHint,
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
        })).toBe('当前信誉位于前 30%（需进入前 10%）方可晋升为长老。');
    });

    test('returns an eligibility member hint when elder threshold is met', () => {
        expect(buildIdentityHint({
            currentLevel: IdentityLevel.Member,
            thresholds,
            messageCount: 0,
            citationCount: 0,
            reputationPercentile: 8,
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
});
