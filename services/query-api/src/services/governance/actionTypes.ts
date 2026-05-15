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
    external_app_challenge_open: {
        actionType: 'external_app_challenge_open',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    external_app_challenge_accept_resolution: {
        actionType: 'external_app_challenge_accept_resolution',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    external_app_dispute_escalate: {
        actionType: 'external_app_dispute_escalate',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    external_app_dispute_rule: {
        actionType: 'external_app_dispute_rule',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    external_app_owner_bond_slash: {
        actionType: 'external_app_owner_bond_slash',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    external_app_settlement_execute: {
        actionType: 'external_app_settlement_execute',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    external_app_funding_pause: {
        actionType: 'external_app_funding_pause',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    external_app_challenge_abuse_countercase: {
        actionType: 'external_app_challenge_abuse_countercase',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    external_app_appeal_open: {
        actionType: 'external_app_appeal_open',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    external_app_bond_disposition_apply: {
        actionType: 'external_app_bond_disposition_apply',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    external_app_bond_routing_execute: {
        actionType: 'external_app_bond_routing_execute',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    external_app_policy_epoch_update: {
        actionType: 'external_app_policy_epoch_update',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    external_app_parameter_bounds_update: {
        actionType: 'external_app_parameter_bounds_update',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    external_app_governance_role_binding_update: {
        actionType: 'external_app_governance_role_binding_update',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    external_app_policy_epoch_migration: {
        actionType: 'external_app_policy_epoch_migration',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    external_app_bond_exposure_guard_update: {
        actionType: 'external_app_bond_exposure_guard_update',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    external_app_projection_dispute_open: {
        actionType: 'external_app_projection_dispute_open',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    external_app_projection_reconcile: {
        actionType: 'external_app_projection_reconcile',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    external_app_governance_capture_review: {
        actionType: 'external_app_governance_capture_review',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    external_app_emergency_hold_extend: {
        actionType: 'external_app_emergency_hold_extend',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    external_app_emergency_hold_correct: {
        actionType: 'external_app_emergency_hold_correct',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    external_app_registry_revoke: {
        actionType: 'external_app_registry_revoke',
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
    if (normalized === 'external_app_challenge_open') return 'external_app_challenge_open';
    if (normalized === 'external_app_challenge_accept_resolution') return 'external_app_challenge_accept_resolution';
    if (normalized === 'external_app_dispute_escalate') return 'external_app_dispute_escalate';
    if (normalized === 'external_app_dispute_rule') return 'external_app_dispute_rule';
    if (normalized === 'external_app_owner_bond_slash') return 'external_app_owner_bond_slash';
    if (normalized === 'external_app_settlement_execute') return 'external_app_settlement_execute';
    if (normalized === 'external_app_funding_pause') return 'external_app_funding_pause';
    if (normalized === 'external_app_challenge_abuse_countercase') return 'external_app_challenge_abuse_countercase';
    if (normalized === 'external_app_appeal_open') return 'external_app_appeal_open';
    if (normalized === 'external_app_bond_disposition_apply') return 'external_app_bond_disposition_apply';
    if (normalized === 'external_app_bond_routing_execute') return 'external_app_bond_routing_execute';
    if (normalized === 'external_app_policy_epoch_update') return 'external_app_policy_epoch_update';
    if (normalized === 'external_app_parameter_bounds_update') return 'external_app_parameter_bounds_update';
    if (normalized === 'external_app_governance_role_binding_update') return 'external_app_governance_role_binding_update';
    if (normalized === 'external_app_policy_epoch_migration') return 'external_app_policy_epoch_migration';
    if (normalized === 'external_app_bond_exposure_guard_update') return 'external_app_bond_exposure_guard_update';
    if (normalized === 'external_app_projection_dispute_open') return 'external_app_projection_dispute_open';
    if (normalized === 'external_app_projection_reconcile') return 'external_app_projection_reconcile';
    if (normalized === 'external_app_governance_capture_review') return 'external_app_governance_capture_review';
    if (normalized === 'external_app_emergency_hold_extend') return 'external_app_emergency_hold_extend';
    if (normalized === 'external_app_emergency_hold_correct') return 'external_app_emergency_hold_correct';
    if (normalized === 'external_app_registry_revoke') return 'external_app_registry_revoke';
    return null;
}
