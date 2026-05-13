export type CircleAccessType = 'free' | 'crystal' | 'invite' | 'approval';

export type CircleAccessRequirement =
    | { type: 'free' }
    | { type: 'crystal'; minCrystals: number }
    | { type: 'invite' }
    | { type: 'approval' };

export function resolveCircleAccessRequirement(input: {
    joinRequirement?: 'Free' | 'ApprovalRequired' | 'TokenGated' | 'InviteOnly' | string | null;
    circleType?: 'Open' | 'Closed' | 'Secret' | string | null;
    minCrystals?: number | null;
}): CircleAccessRequirement {
    const minCrystals = Math.max(0, Math.floor(Number(input.minCrystals || 0)));
    if (input.joinRequirement === 'InviteOnly' || input.circleType === 'Secret') {
        return { type: 'invite' };
    }
    if (input.joinRequirement === 'ApprovalRequired') {
        return { type: 'approval' };
    }
    if (input.joinRequirement === 'TokenGated' || minCrystals > 0) {
        return { type: 'crystal', minCrystals: Math.max(1, minCrystals) };
    }
    return { type: 'free' };
}

export function accessRequirementToAccessType(input: CircleAccessRequirement): CircleAccessType {
    return input.type;
}
