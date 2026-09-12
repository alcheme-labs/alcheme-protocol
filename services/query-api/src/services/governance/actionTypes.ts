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
    external_app_server_key_rotate: {
        actionType: 'external_app_server_key_rotate',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    external_app_server_key_revoke: {
        actionType: 'external_app_server_key_revoke',
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
    external_app_appeal_resolution: {
        actionType: 'external_app_appeal_resolution',
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
    external_app_primary_circle_bind: {
        actionType: 'external_app_primary_circle_bind',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    external_app_primary_circle_change: {
        actionType: 'external_app_primary_circle_change',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    external_app_attached_circle_bind: {
        actionType: 'external_app_attached_circle_bind',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    external_app_attached_circle_revoke: {
        actionType: 'external_app_attached_circle_revoke',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    external_app_provisioning_grant: {
        actionType: 'external_app_provisioning_grant',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    external_app_provisioning_revoke: {
        actionType: 'external_app_provisioning_revoke',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    external_app_source_material_submit: {
        actionType: 'external_app_source_material_submit',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    external_app_source_material_accept: {
        actionType: 'external_app_source_material_accept',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    external_app_source_material_reject: {
        actionType: 'external_app_source_material_reject',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    external_app_source_material_redact: {
        actionType: 'external_app_source_material_redact',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    external_app_knowledge_context_access: {
        actionType: 'external_app_knowledge_context_access',
        voteMode: 'optional',
        requiresPolicyProfileDigest: false,
    },
    room_upgrade_circle_propose: {
        actionType: 'room_upgrade_circle_propose',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    room_upgrade_circle_execute: {
        actionType: 'room_upgrade_circle_execute',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    fork_context_release_create: {
        actionType: 'fork_context_release_create',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    fork_context_release_revoke: {
        actionType: 'fork_context_release_revoke',
        voteMode: 'required',
        requiresPolicyProfileDigest: false,
    },
    fork_reference_exception_grant: {
        actionType: 'fork_reference_exception_grant',
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
    if (normalized === 'external_app_server_key_rotate') return 'external_app_server_key_rotate';
    if (normalized === 'external_app_server_key_revoke') return 'external_app_server_key_revoke';
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
    if (normalized === 'external_app_appeal_resolution') return 'external_app_appeal_resolution';
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
    if (normalized === 'external_app_primary_circle_bind') return 'external_app_primary_circle_bind';
    if (normalized === 'external_app_primary_circle_change') return 'external_app_primary_circle_change';
    if (normalized === 'external_app_attached_circle_bind') return 'external_app_attached_circle_bind';
    if (normalized === 'external_app_attached_circle_revoke') return 'external_app_attached_circle_revoke';
    if (normalized === 'external_app_provisioning_grant') return 'external_app_provisioning_grant';
    if (normalized === 'external_app_provisioning_revoke') return 'external_app_provisioning_revoke';
    if (normalized === 'external_app_source_material_submit') return 'external_app_source_material_submit';
    if (normalized === 'external_app_source_material_accept') return 'external_app_source_material_accept';
    if (normalized === 'external_app_source_material_reject') return 'external_app_source_material_reject';
    if (normalized === 'external_app_source_material_redact') return 'external_app_source_material_redact';
    if (normalized === 'external_app_knowledge_context_access') return 'external_app_knowledge_context_access';
    if (normalized === 'room_upgrade_circle_propose') return 'room_upgrade_circle_propose';
    if (normalized === 'room_upgrade_circle_execute') return 'room_upgrade_circle_execute';
    if (normalized === 'fork_context_release_create') return 'fork_context_release_create';
    if (normalized === 'fork_context_release_revoke') return 'fork_context_release_revoke';
    if (normalized === 'fork_reference_exception_grant') return 'fork_reference_exception_grant';
    return null;
}
