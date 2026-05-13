import { CircleType, JoinRequirement } from '@prisma/client';
import { evaluateMembershipJoinDecision, resolveCircleJoinPolicy } from '../engine';

describe('membership engine token gate behavior', () => {
    test('TokenGated with minCrystals 0 is treated as a one-crystal gate', () => {
        const decision = evaluateMembershipJoinDecision({
            policy: resolveCircleJoinPolicy({
                joinRequirement: JoinRequirement.TokenGated,
                circleType: CircleType.Open,
                minCrystals: 0,
            }),
            userCrystals: 0,
            hasActiveMembership: false,
            hasPendingRequest: false,
            isBanned: false,
            hasValidInvite: false,
        });

        expect(decision.state).toBe('insufficient_crystals');
        expect(decision.minCrystals).toBe(1);
        expect(decision.missingCrystals).toBe(1);
    });

    test('TokenGated with minCrystals above balance blocks entry', () => {
        const decision = evaluateMembershipJoinDecision({
            policy: resolveCircleJoinPolicy({
                joinRequirement: JoinRequirement.TokenGated,
                circleType: CircleType.Open,
                minCrystals: 3,
            }),
            userCrystals: 1,
            hasActiveMembership: false,
            hasPendingRequest: false,
            isBanned: false,
            hasValidInvite: false,
        });

        expect(decision.state).toBe('insufficient_crystals');
        expect(decision.missingCrystals).toBe(2);
    });

    test('TokenGated with invalid minCrystals still becomes a one-crystal gate', () => {
        const policy = resolveCircleJoinPolicy({
            joinRequirement: JoinRequirement.TokenGated,
            circleType: CircleType.Open,
            minCrystals: Number.NaN,
        });

        expect(policy.minCrystals).toBe(1);
    });
});
