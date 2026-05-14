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
    external_app_register: {
        actionType: 'external_app_register',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    approve_store_listing: {
        actionType: 'approve_store_listing',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    approve_managed_node_quota: {
        actionType: 'approve_managed_node_quota',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    downgrade_discovery_status: {
        actionType: 'downgrade_discovery_status',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    limit_capability: {
        actionType: 'limit_capability',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    emergency_hold: {
        actionType: 'emergency_hold',
        voteMode: 'required',
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
    if (normalized === 'external_app_register') return 'external_app_register';
    if (normalized === 'approve_store_listing') return 'approve_store_listing';
    if (normalized === 'approve_managed_node_quota') return 'approve_managed_node_quota';
    if (normalized === 'downgrade_discovery_status') return 'downgrade_discovery_status';
    if (normalized === 'limit_capability') return 'limit_capability';
    if (normalized === 'emergency_hold') return 'emergency_hold';
    return null;
}
