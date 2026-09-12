import type {
    CircleIdentityDisplayState,
    CircleIdentityLevelValue,
    CircleRoleValue,
} from './identityTypes';

export interface ActorDisplayLike {
    effectiveName?: string | null;
    displaySource?: string | null;
    pubkey?: string | null;
}

export function resolveActorDisplayLabel(input: ActorDisplayLike | null | undefined, fallback: string): string {
    const effectiveName = typeof input?.effectiveName === 'string' ? input.effectiveName.trim() : '';
    if (effectiveName) return effectiveName;
    return fallback;
}

export function mapIdentityLevelToDisplayState(
    level: CircleIdentityLevelValue | null | undefined,
): CircleIdentityDisplayState {
    if (level === 'Visitor') return 'observer';
    if (level === 'Initiate') return 'participant';
    if (level === 'Member') return 'contributor';
    if (level === 'Elder') return 'senior_contributor';
    return 'unknown';
}

export function isGovernanceRole(value: CircleRoleValue | null | undefined): boolean {
    return value === 'Owner' || value === 'Admin' || value === 'Moderator';
}
