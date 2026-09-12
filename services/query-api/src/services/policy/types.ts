export type PolicyProfileSourceType =
    | 'lv0_default'
    | 'circle_override'
    | 'inherited_locked'
    | 'inherited_editable';

export type PolicyInheritanceMode = 'inherit_locked' | 'inherit_but_editable' | 'independent';

export type PolicyLocalEditability = 'locked' | 'editable';

export type GovernanceActionType =
    | 'draft_generation'
    | 'crystallization'
    | 'fork'
    | 'archived'
    | 'restore'
    | 'revision_direction'
    | 'temporary_edit_grant'
    | 'external_app_register'
    | 'external_app_server_key_rotate'
    | 'external_app_server_key_revoke'
    | 'approve_store_listing'
    | 'approve_managed_node_quota'
    | 'downgrade_discovery_status'
    | 'limit_capability'
    | 'emergency_hold'
    | 'external_app_challenge_open'
    | 'external_app_challenge_accept_resolution'
    | 'external_app_dispute_escalate'
    | 'external_app_dispute_rule'
    | 'external_app_owner_bond_slash'
    | 'external_app_settlement_execute'
    | 'external_app_funding_pause'
    | 'external_app_challenge_abuse_countercase'
    | 'external_app_appeal_resolution'
    | 'external_app_bond_disposition_apply'
    | 'external_app_bond_routing_execute'
    | 'external_app_policy_epoch_update'
    | 'external_app_parameter_bounds_update'
    | 'external_app_governance_role_binding_update'
    | 'external_app_policy_epoch_migration'
    | 'external_app_bond_exposure_guard_update'
    | 'external_app_projection_dispute_open'
    | 'external_app_projection_reconcile'
    | 'external_app_governance_capture_review'
    | 'external_app_emergency_hold_extend'
    | 'external_app_emergency_hold_correct'
    | 'external_app_registry_revoke'
    | 'external_app_primary_circle_bind'
    | 'external_app_primary_circle_change'
    | 'external_app_attached_circle_bind'
    | 'external_app_attached_circle_revoke'
    | 'external_app_provisioning_grant'
    | 'external_app_provisioning_revoke'
    | 'external_app_source_material_submit'
    | 'external_app_source_material_accept'
    | 'external_app_source_material_reject'
    | 'external_app_source_material_redact'
    | 'external_app_knowledge_context_access'
    | 'room_upgrade_circle_propose'
    | 'room_upgrade_circle_execute'
    | 'fork_context_release_create'
    | 'fork_context_release_revoke'
    | 'fork_reference_exception_grant';

export type GovernanceActionVoteMode = 'required' | 'optional' | 'none';

export type GovernanceRequestState =
    | 'active'
    | 'accepted'
    | 'rejected'
    | 'expired'
    | 'cancelled';

export type GovernanceRole = 'Owner' | 'Admin' | 'Moderator' | 'Member' | 'Elder' | 'Initiate';

export type GovernanceElectorateScope =
    | 'discussion_participants'
    | 'discussion_participants_with_manager_guard'
    | 'all_active_members'
    | 'qualified_roles'
    | 'contributors_of_current_draft'
    | 'hybrid';

export type GovernanceVoteRule =
    | 'single_approver'
    | 'threshold_count'
    | 'majority_of_voters'
    | 'majority_of_eligible'
    | 'unanimity';

export type DraftLifecycleTemplateId = 'fast_deposition' | 'standard_collaboration' | 'deep_research';
export type DraftReviewEntryMode = 'auto_only' | 'manual_only' | 'auto_or_manual';

export interface DraftGenerationPolicySnapshot {
    actionType: 'draft_generation';
    proposalMode: 'signal_based' | 'manual' | 'auto';
    electorateScope: GovernanceElectorateScope;
    eligibleRoles: GovernanceRole[];
    voteRule: GovernanceVoteRule;
    thresholdValue: number;
    quorum: number | null;
    timeWindowMinutes: number;
    managerConfirmationRequired: boolean;
    allowManualMultiSelectCandidate: boolean;
    allowGhostAutoDraft: boolean;
}

export interface DraftLifecycleTemplateSnapshot {
    templateId: DraftLifecycleTemplateId;
    draftGenerationVotingMinutes: number;
    draftingWindowMinutes: number;
    reviewWindowMinutes: number;
    maxRevisionRounds: number;
    reviewEntryMode: DraftReviewEntryMode;
}

export type DraftLifecycleTemplatePatch = Pick<
    DraftLifecycleTemplateSnapshot,
    'draftingWindowMinutes' | 'reviewWindowMinutes' | 'maxRevisionRounds' | 'reviewEntryMode'
>;

export interface DraftWorkflowPolicySnapshot {
    createIssueMinRole: GovernanceRole;
    followupIssueMinRole: GovernanceRole;
    reviewIssueMinRole: GovernanceRole;
    retagIssueMinRole: GovernanceRole;
    applyIssueMinRole: GovernanceRole;
    manualEndDraftingMinRole: GovernanceRole;
    advanceFromReviewMinRole: GovernanceRole;
    enterCrystallizationMinRole: GovernanceRole;
    allowAuthorWithdrawBeforeReview: boolean;
    allowModeratorRetagIssue: boolean;
}

export type DraftWorkflowPolicyPatch = Partial<DraftWorkflowPolicySnapshot>;

export interface BlockEditEligibilityPolicySnapshot {
    mode: 'manager_or_contributor_or_temporary_editor';
    managerOverride: boolean;
    contributorEvidenceRequired: boolean;
}

export interface ForkPolicySnapshot {
    enabled: boolean;
    thresholdMode: 'contribution_threshold';
    minimumContributions: number;
    minimumRole: GovernanceRole;
    requiresGovernanceVote: boolean;
    inheritancePrefillSource: 'lv0_default_profile';
    knowledgeLineageInheritance: 'upstream_until_fork_node';
}

export interface GhostPolicySnapshot {
    draftTriggerMode: 'notify_only' | 'auto_draft';
    summaryUseLLM: boolean;
    triggerSummaryUseLLM: boolean;
    triggerGenerateComment: boolean;
}

export interface CirclePolicyProfile {
    circleId: number;
    sourceType: PolicyProfileSourceType;
    inheritanceMode: PolicyInheritanceMode;
    inheritsFromProfileId: string | null;
    inheritsFromCircleId: number | null;
    draftGenerationPolicy: DraftGenerationPolicySnapshot;
    draftLifecycleTemplate: DraftLifecycleTemplateSnapshot;
    draftWorkflowPolicy: DraftWorkflowPolicySnapshot;
    blockEditEligibilityPolicy: BlockEditEligibilityPolicySnapshot;
    forkPolicy: ForkPolicySnapshot;
    ghostPolicy: GhostPolicySnapshot;
    localEditability: PolicyLocalEditability;
    effectiveFrom: Date;
    resolvedFromProfileVersion: number | null;
    configVersion: number;
}

export interface PublicPolicyDigestSnapshot {
    draftLifecycleTemplate: DraftLifecycleTemplateSnapshot;
    draftWorkflowPolicy: DraftWorkflowPolicySnapshot;
    forkPolicy: ForkPolicySnapshot;
}

export interface GovernanceRequestSummary {
    requestId: string;
    actionType: GovernanceActionType;
    targetType: string;
    targetRef: string;
    state: GovernanceRequestState;
    proposerPubkey: string;
    payload: Record<string, unknown> | null;
    openedAt: Date | null;
    expiresAt: Date | null;
    resolvedAt: Date | null;
    executionStatus?: 'executed' | 'failed' | 'skipped' | null;
    executionError?: string | null;
}

export interface GovernanceSignalSummary {
    requestId: string;
    actorPubkey: string | null;
    value: 'approve' | 'reject';
    evidence: Record<string, unknown> | null;
    createdAt: Date;
}

export type DraftCandidateGovernanceStatus =
    | 'open'
    | 'pending'
    | 'proposal_active'
    | 'accepted'
    | 'generation_failed'
    | 'rejected'
    | 'expired'
    | 'cancelled';

export type DraftCrystallizationGovernanceStatus =
    | 'drafting'
    | 'crystallization_active'
    | 'crystallization_failed'
    | 'crystallized'
    | 'archived';

export interface CandidateGenerationGovernanceReadModel {
    circleId: number;
    candidateId: string | null;
    policyProfile: CirclePolicyProfile;
    request: GovernanceRequestSummary | null;
    signals: GovernanceSignalSummary[];
    candidateStatus: DraftCandidateGovernanceStatus;
    failureRecovery: {
        failedStatus: 'generation_failed';
        canRetryExecutionRoles: GovernanceRole[];
        retryExecutionReusesPassedProposal: boolean;
        canCancelRoles: GovernanceRole[];
    };
}

export interface CrystallizationGovernanceReadModel {
    circleId: number;
    draftPostId: number | null;
    policyProfile: CirclePolicyProfile;
    crystallizationPolicy: {
        actionType: 'crystallization';
        electorateScope: GovernanceElectorateScope;
        eligibleRoles: GovernanceRole[];
        voteRule: GovernanceVoteRule;
        thresholdValue: number;
        quorum: number | null;
        timeWindowMinutes: number;
    };
    request: GovernanceRequestSummary | null;
    signals: GovernanceSignalSummary[];
    draftStatus: DraftCrystallizationGovernanceStatus;
    failureRecovery: {
        failedStatus: 'crystallization_failed';
        canRetryExecutionRoles: GovernanceRole[];
        retryExecutionReusesPassedProposal: boolean;
        canRollbackToReviewRoles: GovernanceRole[];
        canArchiveRoles: GovernanceRole[];
    };
}

export interface ForkBaselineResolvedView {
    circleId: number;
    policyProfile: CirclePolicyProfile;
    baseline: {
        sourceType: PolicyProfileSourceType;
        inheritanceMode: PolicyInheritanceMode;
        localEditability: PolicyLocalEditability;
        inheritsFromProfileId: string | null;
        inheritsFromCircleId: number | null;
        lv0AppliesToFutureCirclesOnly: boolean;
        inheritLockedMaterializedAtCreate: boolean;
        runtimeLiveParentLookup: false;
    };
    threshold: ForkPolicySnapshot;
}

export interface ForkThresholdResolvedView {
    circleId: number;
    enabled: boolean;
    thresholdMode: ForkPolicySnapshot['thresholdMode'];
    minimumContributions: number;
    minimumRole: GovernanceRole;
    requiresGovernanceVote: boolean;
}

export interface InheritanceResolvedView {
    circleId: number;
    sourceType: PolicyProfileSourceType;
    inheritanceMode: PolicyInheritanceMode;
    localEditability: PolicyLocalEditability;
    inheritsFromProfileId: string | null;
    inheritsFromCircleId: number | null;
    lv0AppliesToFutureCirclesOnly: boolean;
    inheritLockedMaterializedAtCreate: boolean;
    runtimeLiveParentLookup: false;
}

export interface Team04ForkResolvedInputs {
    circleId: number;
    forkThresholdResolvedView: ForkThresholdResolvedView;
    inheritanceResolvedView: InheritanceResolvedView;
    minimumFieldSet: {
        configVersion: number;
        effectiveFrom: Date;
        resolvedFromProfileVersion: number | null;
        inheritancePrefillSource: ForkPolicySnapshot['inheritancePrefillSource'];
        knowledgeLineageInheritance: ForkPolicySnapshot['knowledgeLineageInheritance'];
    };
}
