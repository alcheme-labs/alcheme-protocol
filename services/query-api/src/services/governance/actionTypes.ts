import type {
    GovernanceActionType,
    GovernanceActionVoteMode,
} from '../policy/types';

export interface GovernanceActionDefinition {
    actionType: GovernanceActionType;
    voteMode: GovernanceActionVoteMode;
    requiresPolicyProfileDigest: boolean;
}

const GOVERNANCE_ACTION_DEFINITIONS: Record<GovernanceActionType, GovernanceActionDefinition> = {
    draft_generation: {
        actionType: 'draft_generation',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    crystallization: {
        actionType: 'crystallization',
        voteMode: 'required',
        requiresPolicyProfileDigest: true,
    },
    fork: {
        actionType: 'fork',
        voteMode: 'none',
        requiresPolicyProfileDigest: true,
    },
    archived: {
        actionType: 'archived',
        voteMode: 'optional',
        requiresPolicyProfileDigest: true,
    },
    restore: {
        actionType: 'restore',
        voteMode: 'optional',
        requiresPolicyProfileDigest: true,
    },
    revision_direction: {
        actionType: 'revision_direction',
        voteMode: 'optional',
        requiresPolicyProfileDigest: false,
    },
    temporary_edit_grant: {
        actionType: 'temporary_edit_grant',
        voteMode: 'optional',
        requiresPolicyProfileDigest: false,
    },
};

export function getGovernanceActionDefinition(
    actionType: GovernanceActionType,
): GovernanceActionDefinition {
    return GOVERNANCE_ACTION_DEFINITIONS[actionType];
}

export function normalizeGovernanceActionType(
    raw: unknown,
): GovernanceActionType | null {
    const normalized = String(raw || '').trim().toLowerCase();
    if (!normalized) return null;
    if (normalized === 'draft_generation') return 'draft_generation';
    if (normalized === 'crystallization') return 'crystallization';
    if (normalized === 'fork') return 'fork';
    if (normalized === 'archived') return 'archived';
    if (normalized === 'restore') return 'restore';
    if (normalized === 'revision_direction') return 'revision_direction';
    if (normalized === 'temporary_edit_grant') return 'temporary_edit_grant';
    return null;
}
