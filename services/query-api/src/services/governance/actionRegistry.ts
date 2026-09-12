export type GovernedActionImpact = "low" | "medium" | "high" | "critical";
export type GovernedActionFallbackAuthority =
  | "owner_admin"
  | "manager"
  | "moderator"
  | "none";
export type GovernedActionMode =
  | "optional"
  | "required_when_bound"
  | "always_required";
export type GovernedActionExecutionDomain =
  | "off_chain"
  | "on_chain_required"
  | "hybrid";
export type GovernedActionRuntimeAvailability =
  | "enabled"
  | "historical_read_only";

export type GovernedActionBindingRequirement = "exact_action_subject_purpose";

export const CIRCLE_MEMBER_REMOVE_ACTION_TYPE = "circle.membership.member.remove";
export const CIRCLE_FORK_ACTION_TYPE = "circle.lifecycle.fork";
export const CIRCLE_MERGE_SOURCE_APPROVE_ACTION_TYPE =
  "circle.lifecycle.merge.source_approve";
export const CIRCLE_MERGE_SUCCESSOR_ACCEPT_ACTION_TYPE =
  "circle.lifecycle.merge.successor_accept";
export const GOVERNANCE_GRANT_AGREEMENT_AMEND_ACTION_TYPE = "grant.agreement.amend";
export const GOVERNANCE_AUTHORITY_HEALTH_ACTION_TYPE =
  "circle.governance_binding.authority_health.check";
export const REALMS_PROVIDER_BINDING_CREATE_ACTION_TYPE =
  "circle.provider_binding.realms.create";
export const REALMS_PROVIDER_BOOTSTRAP_ACTION_TYPE =
  "circle.provider_binding.realms.bootstrap";
export const REALMS_PROVIDER_DISABLE_ACTION_TYPE =
  "circle.provider_binding.realms.disable";
export const REALMS_PROVIDER_RESTORE_ACTION_TYPE =
  "circle.provider_binding.realms.restore";
export const REALMS_EMERGENCY_ONCHAIN_PAUSE_ACTION_TYPE =
  "circle.provider_binding.realms.emergency_onchain_pause";
export const REALMS_EMERGENCY_ONCHAIN_UNPAUSE_ACTION_TYPE =
  "circle.provider_binding.realms.emergency_onchain_unpause";
export const REALMS_PROGRAM_UPGRADE_ACTION_TYPE =
  "circle.provider_binding.realms.program_upgrade";
export const REALMS_PROVIDER_DELEGATION_CONFORMANCE_ACTION_TYPE =
  "circle.provider_binding.realms.delegation_conformance";
export const REALMS_VOTING_POWER_CHALLENGE_CONFORMANCE_ACTION_TYPE =
  "circle.provider_binding.realms.voting_power_challenge_conformance";
export const SQUADS_PROVIDER_BINDING_CREATE_ACTION_TYPE =
  "circle.provider_binding.squads.create";
export const SQUADS_PROVIDER_BOOTSTRAP_ACTION_TYPE =
  "circle.provider_binding.squads.bootstrap";
export const SQUADS_PROVIDER_DISABLE_ACTION_TYPE =
  "circle.provider_binding.squads.disable";
export const SQUADS_PROVIDER_RESTORE_ACTION_TYPE =
  "circle.provider_binding.squads.restore";
export const GOVERNANCE_GRANT_PAYOUT_ACTION_TYPE =
  "circle.grant.payout.execute";
export const GOVERNANCE_PROVIDER_EXECUTION_TERMINAL_ABANDON_ACTION_TYPE =
  "circle.provider_execution.terminal_abandon";
export const GOVERNANCE_PROVIDER_EXECUTION_COMPENSATION_PLAN_ACTION_TYPE =
  "circle.provider_execution.compensation_plan";
export const GOVERNANCE_PROVIDER_EXECUTION_FUNDING_AMEND_ACTION_TYPE =
  "circle.provider_execution.funding_amend";
export const CONTENT_VISIBILITY_DOWNRANK_ACTION_TYPE =
  "content.visibility.downrank";
export const FEED_RANKING_POLICY_UPDATE_ACTION_TYPE =
  "feed.ranking.policy.update";
export const FEED_RECOMMENDATION_EXPERIMENT_START_ACTION_TYPE =
  "feed.recommendation.experiment.start";
export const FEED_RECOMMENDATION_EXPERIMENT_STOP_ACTION_TYPE =
  "feed.recommendation.experiment.stop";
export const OPERATOR_CAPABILITY_SUSPEND_ACTION_TYPE =
  "operator.capability.suspend";
export const REVISION_DIRECTION_ACCEPT_ACTION_TYPE =
  "circle.draft.revision_direction.accept";
export const LEGACY_REVISION_DIRECTION_ACCEPT_ACTION_TYPE =
  "revision_direction.accept";
export type RevisionDirectionAcceptActionType =
  | typeof REVISION_DIRECTION_ACCEPT_ACTION_TYPE
  | typeof LEGACY_REVISION_DIRECTION_ACCEPT_ACTION_TYPE;

export function isRevisionDirectionAcceptActionType(
  value: unknown,
): value is RevisionDirectionAcceptActionType {
  return value === REVISION_DIRECTION_ACCEPT_ACTION_TYPE
    || value === LEGACY_REVISION_DIRECTION_ACCEPT_ACTION_TYPE;
}
export const PLATFORM_SAFETY_CONTENT_QUARANTINE_ACTION_TYPE =
  "platform.safety.content.quarantine";
export const PLATFORM_SAFETY_CONTENT_RELEASE_ACTION_TYPE =
  "platform.safety.content.release";
export const PLATFORM_SAFETY_INCIDENT_DECLARE_ACTION_TYPE =
  "platform.safety.incident.declare";
export const PLATFORM_SAFETY_INCIDENT_ACTIVATION_RESOLVE_ACTION_TYPE =
  "platform.safety.incident.activation.resolve";
export const PLATFORM_SAFETY_INCIDENT_UPGRADE_ACTION_TYPE =
  "platform.safety.incident.upgrade";
export const PLATFORM_SAFETY_INCIDENT_EXTEND_ACTION_TYPE =
  "platform.safety.incident.extend";
export const PLATFORM_SAFETY_INCIDENT_MERGE_ACTION_TYPE =
  "platform.safety.incident.merge";
export const PLATFORM_SAFETY_INCIDENT_CLOSE_ACTION_TYPE =
  "platform.safety.incident.close";
export const PLATFORM_SAFETY_INCIDENT_REVIEW_ACTION_TYPE =
  "platform.safety.incident.review";
export const PLATFORM_SAFETY_AUTHORITY_CHANGE_PROPOSE_ACTION_TYPE =
  "platform.safety.authority.change.propose";
export const PLATFORM_SAFETY_AUTHORITY_CHANGE_APPROVE_ACTION_TYPE =
  "platform.safety.authority.change.approve";
export const PLATFORM_SAFETY_EVIDENCE_CAPTURE_ACTION_TYPE =
  "platform.safety.evidence.capture";
export const PLATFORM_SAFETY_EVIDENCE_BREAK_GLASS_READ_ACTION_TYPE =
  "platform.safety.evidence.break_glass.read";
export const PLATFORM_SAFETY_LEGAL_STATUS_APPEND_ACTION_TYPE =
  "platform.safety.legal.status.append";

export interface GovernedActionAppealPolicy {
  windowSeconds: number;
  conflictRule: "original_executor_and_appellant_excluded";
  resolutionPath: "independent_review_or_case";
}

export interface GovernedActionDefinition {
  actionType: string;
  targetType: string;
  impact: GovernedActionImpact;
  fallbackAuthority: GovernedActionFallbackAuthority;
  governanceMode: GovernedActionMode;
  executionAdapter: string;
  executionDomain: GovernedActionExecutionDomain;
  receiptRequired: boolean;
  idempotencyScope?: "governance_home_action_subject";
  idempotencyWindowSeconds?: number | null;
  appealPolicy?: GovernedActionAppealPolicy | null;
  runtimeAvailability?: GovernedActionRuntimeAvailability;
  unavailableReason?: string | null;
  bindingRequirement?: GovernedActionBindingRequirement;
}

export function governedActionUnavailableReason(
  definition: GovernedActionDefinition,
): string | null {
  if (definition.runtimeAvailability !== "historical_read_only") return null;
  return definition.unavailableReason?.trim() || "governed_action_historical_read_only";
}

export class GovernedActionRegistry {
  private readonly definitions = new Map<string, GovernedActionDefinition>();

  register(definition: GovernedActionDefinition): void {
    this.definitions.set(definition.actionType, { ...definition });
  }

  get(actionType: string): GovernedActionDefinition | null {
    return this.definitions.get(actionType) ?? null;
  }

  list(): GovernedActionDefinition[] {
    return Array.from(this.definitions.values()).map((definition) => ({
      ...definition,
    }));
  }
}

export function createGovernedActionRegistry(input?: {
  includePhase1Defaults?: boolean;
  includeCircleLifecycleActions?: boolean;
  includeCircleAuthorityActions?: boolean;
  includeCirclePolicyActions?: boolean;
  includeCircleAgentActions?: boolean;
  includeCircleSeededActions?: boolean;
  includeSourceMaterialActions?: boolean;
  includeCommunicationActions?: boolean;
  includeFeedGovernanceActions?: boolean;
  includeDraftGovernanceActions?: boolean;
  includeCircleCommitteeProfileActions?: boolean;
  includeExternalAppActions?: boolean;
  includeExternalAppCircleBindingActions?: boolean;
  includeGovernanceBootstrapActions?: boolean;
  includeGovernanceHomeProfileActions?: boolean;
  includeGrantActions?: boolean;
  includeProviderExecutionLifecycleActions?: boolean;
  includeRealmsProviderBindingActions?: boolean;
  includeSquadsProviderBindingActions?: boolean;
  includePlatformSafetyActions?: boolean;
}): GovernedActionRegistry {
  const registry = new GovernedActionRegistry();
  if (input?.includePhase1Defaults) {
    registerPhase1GovernanceBindingActions(registry);
  }
  if (input?.includeCircleLifecycleActions) {
    registerCircleLifecycleActions(registry);
  }
  if (input?.includeCircleAuthorityActions) {
    registerCircleAuthorityActions(registry);
  }
  if (input?.includeCirclePolicyActions) {
    registerCirclePolicyActions(registry);
  }
  if (input?.includeCircleAgentActions) {
    registerCircleAgentActions(registry);
  }
  if (input?.includeCircleSeededActions) {
    registerCircleSeededActions(registry);
  }
  if (input?.includeSourceMaterialActions) {
    registerSourceMaterialActions(registry);
  }
  if (input?.includeCommunicationActions) {
    registerCommunicationActions(registry);
  }
  if (input?.includeFeedGovernanceActions) {
    registerFeedGovernanceActions(registry);
  }
  if (input?.includeDraftGovernanceActions) {
    registerDraftGovernanceActions(registry);
  }
  if (input?.includeCircleCommitteeProfileActions) {
    registerCircleCommitteeProfileActions(registry);
  }
  if (input?.includeExternalAppActions) {
    registerExternalAppActions(registry);
  }
  if (input?.includeExternalAppCircleBindingActions) {
    registerExternalAppCircleBindingActions(registry);
  }
  if (input?.includeGovernanceBootstrapActions) {
    registerGovernanceBootstrapActions(registry);
  }
  if (input?.includeGovernanceHomeProfileActions) {
    registerGovernanceHomeProfileActions(registry);
  }
  if (input?.includeGrantActions) {
    registerGovernanceGrantActions(registry);
  }
  if (input?.includeProviderExecutionLifecycleActions) {
    registerGovernanceProviderExecutionLifecycleActions(registry);
  }
  if (input?.includeRealmsProviderBindingActions) {
    registerRealmsProviderBindingActions(registry);
  }
  if (input?.includeSquadsProviderBindingActions) {
    registerSquadsProviderBindingActions(registry);
  }
  if (input?.includePlatformSafetyActions) {
    registerPlatformSafetyActions(registry);
  }
  return registry;
}

export function registerPlatformSafetyActions(
  registry: GovernedActionRegistry,
): void {
  registry.register({
    actionType: PLATFORM_SAFETY_CONTENT_QUARANTINE_ACTION_TYPE,
    targetType: "feed_post",
    impact: "high",
    fallbackAuthority: "none",
    governanceMode: "always_required",
    executionAdapter: "platform_safety",
    executionDomain: "off_chain",
    receiptRequired: true,
    idempotencyScope: "governance_home_action_subject",
    idempotencyWindowSeconds: 300,
    appealPolicy: {
      windowSeconds: 72 * 60 * 60,
      conflictRule: "original_executor_and_appellant_excluded",
      resolutionPath: "independent_review_or_case",
    },
  });
  registry.register({
    actionType: PLATFORM_SAFETY_CONTENT_RELEASE_ACTION_TYPE,
    targetType: "feed_post",
    impact: "high",
    fallbackAuthority: "none",
    governanceMode: "always_required",
    executionAdapter: "platform_safety",
    executionDomain: "off_chain",
    receiptRequired: true,
    idempotencyScope: "governance_home_action_subject",
    idempotencyWindowSeconds: 300,
    appealPolicy: null,
  });
  registry.register({
    actionType: PLATFORM_SAFETY_INCIDENT_ACTIVATION_RESOLVE_ACTION_TYPE,
    targetType: "platform_safety_incident",
    impact: "high",
    fallbackAuthority: "none",
    governanceMode: "always_required",
    executionAdapter: "platform_safety",
    executionDomain: "off_chain",
    receiptRequired: true,
    idempotencyScope: "governance_home_action_subject",
    idempotencyWindowSeconds: 300,
    appealPolicy: {
      windowSeconds: 72 * 60 * 60,
      conflictRule: "original_executor_and_appellant_excluded",
      resolutionPath: "independent_review_or_case",
    },
  });
  for (const actionType of [
    PLATFORM_SAFETY_INCIDENT_DECLARE_ACTION_TYPE,
    PLATFORM_SAFETY_INCIDENT_UPGRADE_ACTION_TYPE,
    PLATFORM_SAFETY_INCIDENT_EXTEND_ACTION_TYPE,
    PLATFORM_SAFETY_INCIDENT_MERGE_ACTION_TYPE,
    PLATFORM_SAFETY_INCIDENT_CLOSE_ACTION_TYPE,
    PLATFORM_SAFETY_INCIDENT_REVIEW_ACTION_TYPE,
    PLATFORM_SAFETY_AUTHORITY_CHANGE_PROPOSE_ACTION_TYPE,
    PLATFORM_SAFETY_AUTHORITY_CHANGE_APPROVE_ACTION_TYPE,
    PLATFORM_SAFETY_EVIDENCE_CAPTURE_ACTION_TYPE,
    PLATFORM_SAFETY_EVIDENCE_BREAK_GLASS_READ_ACTION_TYPE,
  ]) {
    registry.register({
      actionType,
      targetType: actionType.startsWith("platform.safety.authority.")
        ? "system_governance_role_binding"
        : [
            PLATFORM_SAFETY_EVIDENCE_CAPTURE_ACTION_TYPE,
            PLATFORM_SAFETY_EVIDENCE_BREAK_GLASS_READ_ACTION_TYPE,
          ].includes(actionType)
          ? "platform_safety_evidence"
          : actionType === PLATFORM_SAFETY_LEGAL_STATUS_APPEND_ACTION_TYPE
            ? "feed_post"
            : "platform_safety_incident",
      impact: "high",
      fallbackAuthority: "none",
      governanceMode: "always_required",
      executionAdapter: "platform_safety",
      executionDomain: "off_chain",
      receiptRequired: true,
      idempotencyScope: "governance_home_action_subject",
      idempotencyWindowSeconds: 300,
      appealPolicy: null,
    });
  }
  registry.register({
    actionType: PLATFORM_SAFETY_LEGAL_STATUS_APPEND_ACTION_TYPE,
    targetType: "feed_post",
    impact: "high",
    fallbackAuthority: "none",
    governanceMode: "always_required",
    executionAdapter: "platform_safety",
    executionDomain: "off_chain",
    receiptRequired: true,
    idempotencyScope: "governance_home_action_subject",
    idempotencyWindowSeconds: 300,
    appealPolicy: {
      windowSeconds: 30 * 24 * 60 * 60,
      conflictRule: "original_executor_and_appellant_excluded",
      resolutionPath: "independent_review_or_case",
    },
  });
}

export function registerSquadsProviderBindingActions(
  registry: GovernedActionRegistry,
): void {
  for (const definition of [
    {
      actionType: SQUADS_PROVIDER_BINDING_CREATE_ACTION_TYPE,
      executionDomain: 'off_chain' as const,
    },
    {
      actionType: SQUADS_PROVIDER_BOOTSTRAP_ACTION_TYPE,
      executionDomain: 'on_chain_required' as const,
    },
    {
      actionType: SQUADS_PROVIDER_DISABLE_ACTION_TYPE,
      executionDomain: 'off_chain' as const,
    },
    {
      actionType: SQUADS_PROVIDER_RESTORE_ACTION_TYPE,
      executionDomain: 'off_chain' as const,
    },
    {
      actionType: GOVERNANCE_GRANT_PAYOUT_ACTION_TYPE,
      executionDomain: 'on_chain_required' as const,
    },
  ]) {
    registry.register({
      ...definition,
      targetType: 'circle',
      impact: 'critical',
      fallbackAuthority: 'none',
      governanceMode: 'always_required',
      executionAdapter: 'squads_provider_binding',
      receiptRequired: true,
    });
  }
}

export function registerRealmsProviderBindingActions(
  registry: GovernedActionRegistry,
): void {
  registry.register({
    actionType: REALMS_PROVIDER_BINDING_CREATE_ACTION_TYPE,
    targetType: 'circle',
    impact: 'critical',
    fallbackAuthority: 'none',
    governanceMode: 'always_required',
    executionAdapter: 'realms_provider_binding',
    executionDomain: 'off_chain',
    receiptRequired: true,
  });
  registry.register({
    actionType: REALMS_PROVIDER_BOOTSTRAP_ACTION_TYPE,
    targetType: 'circle',
    impact: 'critical',
    fallbackAuthority: 'none',
    governanceMode: 'always_required',
    executionAdapter: 'realms_provider_binding',
    executionDomain: 'on_chain_required',
    receiptRequired: true,
  });
  registry.register({
    actionType: REALMS_PROVIDER_DISABLE_ACTION_TYPE,
    targetType: 'circle',
    impact: 'critical',
    fallbackAuthority: 'none',
    governanceMode: 'always_required',
    executionAdapter: 'realms_provider_binding',
    executionDomain: 'off_chain',
    receiptRequired: true,
  });
  registry.register({
    actionType: REALMS_PROVIDER_RESTORE_ACTION_TYPE,
    targetType: 'circle',
    impact: 'critical',
    fallbackAuthority: 'none',
    governanceMode: 'always_required',
    executionAdapter: 'realms_provider_binding',
    executionDomain: 'off_chain',
    receiptRequired: true,
  });
  registry.register({
    actionType: REALMS_EMERGENCY_ONCHAIN_PAUSE_ACTION_TYPE,
    targetType: 'circle',
    impact: 'critical',
    fallbackAuthority: 'none',
    governanceMode: 'always_required',
    executionAdapter: 'realms_provider_binding',
    executionDomain: 'on_chain_required',
    receiptRequired: true,
  });
  registry.register({
    actionType: REALMS_EMERGENCY_ONCHAIN_UNPAUSE_ACTION_TYPE,
    targetType: 'circle',
    impact: 'critical',
    fallbackAuthority: 'none',
    governanceMode: 'always_required',
    executionAdapter: 'realms_provider_binding',
    executionDomain: 'on_chain_required',
    receiptRequired: true,
  });
  registry.register({
    actionType: REALMS_PROGRAM_UPGRADE_ACTION_TYPE,
    targetType: 'circle',
    impact: 'critical',
    fallbackAuthority: 'none',
    governanceMode: 'always_required',
    executionAdapter: 'realms_provider_binding',
    executionDomain: 'on_chain_required',
    receiptRequired: true,
  });
  registry.register({
    actionType: REALMS_PROVIDER_DELEGATION_CONFORMANCE_ACTION_TYPE,
    targetType: 'circle',
    impact: 'critical',
    fallbackAuthority: 'none',
    governanceMode: 'always_required',
    executionAdapter: 'realms_provider_binding',
    executionDomain: 'on_chain_required',
    receiptRequired: true,
  });
  registry.register({
    actionType: REALMS_VOTING_POWER_CHALLENGE_CONFORMANCE_ACTION_TYPE,
    targetType: 'circle',
    impact: 'critical',
    fallbackAuthority: 'none',
    governanceMode: 'always_required',
    executionAdapter: 'realms_provider_binding',
    executionDomain: 'off_chain',
    receiptRequired: true,
  });
}

export function registerGovernanceGrantActions(registry: GovernedActionRegistry): void {
  registry.register({
    actionType: GOVERNANCE_GRANT_AGREEMENT_AMEND_ACTION_TYPE,
    targetType: 'circle',
    impact: 'high',
    fallbackAuthority: 'none',
    governanceMode: 'always_required',
    executionAdapter: 'governance_case',
    executionDomain: 'off_chain',
    receiptRequired: false,
  });
}

export function registerGovernanceProviderExecutionLifecycleActions(
  registry: GovernedActionRegistry,
): void {
  for (const actionType of [
    GOVERNANCE_PROVIDER_EXECUTION_TERMINAL_ABANDON_ACTION_TYPE,
    GOVERNANCE_PROVIDER_EXECUTION_COMPENSATION_PLAN_ACTION_TYPE,
    GOVERNANCE_PROVIDER_EXECUTION_FUNDING_AMEND_ACTION_TYPE,
  ]) registry.register({
      actionType,
      targetType: 'circle',
      impact: 'critical',
      fallbackAuthority: 'none',
      governanceMode: 'always_required',
      executionAdapter: 'governance_case',
      executionDomain: 'off_chain',
      receiptRequired: false,
    });
}

export function registerGovernanceHomeProfileActions(
  registry: GovernedActionRegistry,
): void {
  for (const operation of ['bind', 'upgrade', 'rollback'] as const) {
    registry.register({
      actionType: `governance.profile.${operation}`,
      targetType: 'governance_home_identity_binding',
      impact: 'high',
      fallbackAuthority: 'none',
      governanceMode: 'always_required',
      executionAdapter: 'governance_profile',
      executionDomain: 'off_chain',
      receiptRequired: true,
    });
  }
  registry.register({
    actionType: 'governance.home_identity.migrate',
    targetType: 'governance_home_identity_binding',
    impact: 'critical',
    fallbackAuthority: 'none',
    governanceMode: 'always_required',
    executionAdapter: 'governance_home_identity',
    executionDomain: 'hybrid',
    receiptRequired: true,
  });
}

export function registerGovernanceBootstrapActions(
  registry: GovernedActionRegistry,
): void {
  registry.register({
    actionType: 'governance.bootstrap.founding_confirmation',
    targetType: 'governance_configuration_bundle',
    impact: 'critical',
    fallbackAuthority: 'none',
    governanceMode: 'always_required',
    executionAdapter: 'governance_bootstrap_activation',
    executionDomain: 'hybrid',
    receiptRequired: true,
  });
}

export function registerPhase1GovernanceBindingActions(
  registry: GovernedActionRegistry,
): void {
  const common = {
    impact: "critical" as const,
    fallbackAuthority: "owner_admin" as const,
    governanceMode: "required_when_bound" as const,
    executionAdapter: "circle_governance_binding",
    executionDomain: "off_chain" as const,
    receiptRequired: true,
  };
  registry.register({
    ...common,
    actionType: "circle.governance_binding.create",
    targetType: "circle",
  });
  registry.register({
    ...common,
    actionType: "circle.governance_binding.replace",
    targetType: "circle_governance_binding",
  });
  registry.register({
    ...common,
    actionType: "circle.governance_binding.deactivate",
    targetType: "circle_governance_binding",
    fallbackAuthority: "none",
    governanceMode: "always_required",
  });
  registry.register({
    ...common,
    actionType: "circle.governance_binding.policy_version.update",
    targetType: "circle_governance_binding",
    fallbackAuthority: "none",
    governanceMode: "always_required",
  });
  registry.register({
    ...common,
    actionType: "circle.governance_binding.accept_mandate",
    targetType: "circle_governance_binding",
    fallbackAuthority: "none",
    governanceMode: "always_required",
  });
  registry.register({
    actionType: GOVERNANCE_AUTHORITY_HEALTH_ACTION_TYPE,
    targetType: "circle_governance_binding",
    impact: "high",
    fallbackAuthority: "none",
    governanceMode: "always_required",
    executionAdapter: "circle_governance_binding",
    executionDomain: "off_chain",
    receiptRequired: false,
  });
}

export function registerCircleLifecycleActions(
  registry: GovernedActionRegistry,
): void {
  const common = {
    targetType: "circle",
    impact: "critical" as const,
    fallbackAuthority: "owner_admin" as const,
    governanceMode: "required_when_bound" as const,
    executionAdapter: "circle_lifecycle",
    executionDomain: "hybrid" as const,
    receiptRequired: true,
  };
  registry.register({
    ...common,
    actionType: "circle.lifecycle.archive",
  });
  registry.register({
    ...common,
    actionType: "circle.lifecycle.restore",
  });
  registry.register({
    ...common,
    actionType: CIRCLE_FORK_ACTION_TYPE,
    fallbackAuthority: "none",
    governanceMode: "always_required",
  });
  registry.register({
    ...common,
    actionType: CIRCLE_MERGE_SOURCE_APPROVE_ACTION_TYPE,
    fallbackAuthority: "none",
    governanceMode: "always_required",
    executionDomain: "off_chain",
  });
  registry.register({
    ...common,
    actionType: CIRCLE_MERGE_SUCCESSOR_ACCEPT_ACTION_TYPE,
    fallbackAuthority: "none",
    governanceMode: "always_required",
    executionDomain: "off_chain",
  });
  registry.register({
    ...common,
    actionType: "circle.lifecycle.dissolve",
    fallbackAuthority: "none",
    governanceMode: "always_required",
    executionDomain: "off_chain",
  });
}

export function registerCircleAuthorityActions(
  registry: GovernedActionRegistry,
): void {
  registry.register({
    actionType: "circle.owner.transfer",
    targetType: "circle",
    impact: "critical",
    fallbackAuthority: "owner_admin",
    governanceMode: "required_when_bound",
    executionAdapter: "circle_authority",
    executionDomain: "off_chain",
    receiptRequired: true,
  });
}

export function registerCirclePolicyActions(
  registry: GovernedActionRegistry,
): void {
  const common = {
    targetType: "circle",
    impact: "high" as const,
    fallbackAuthority: "owner_admin" as const,
    governanceMode: "required_when_bound" as const,
    executionAdapter: "circle_policy",
    executionDomain: "off_chain" as const,
    receiptRequired: true,
  };
  registry.register({
    ...common,
    actionType: "circle.policy.membership.update",
    executionDomain: "hybrid",
  });
  registry.register({
    actionType: CIRCLE_MEMBER_REMOVE_ACTION_TYPE,
    targetType: "circle",
    impact: "critical",
    fallbackAuthority: "none",
    governanceMode: "always_required",
    executionAdapter: "circle_policy",
    executionDomain: "hybrid",
    receiptRequired: true,
  });
  registry.register({
    ...common,
    actionType: "circle.policy.profile.update",
  });
  registry.register({
    ...common,
    actionType: "circle.policy.draft_lifecycle.update",
    impact: "medium",
    governanceMode: "optional",
  });
  registry.register({
    ...common,
    actionType: "circle.policy.ghost.update",
  });
  registry.register({
    ...common,
    actionType: "circle.policy.genesis.update",
  });
  registry.register({
    ...common,
    actionType: "circle.policy.metadata.update",
    impact: "medium",
    governanceMode: "optional",
    idempotencyScope: "governance_home_action_subject",
    idempotencyWindowSeconds: 300,
    appealPolicy: {
      windowSeconds: 72 * 60 * 60,
      conflictRule: "original_executor_and_appellant_excluded",
      resolutionPath: "independent_review_or_case",
    },
  });
  registry.register({
    ...common,
    actionType: "circle.policy.community_profile.update",
    impact: "medium",
    governanceMode: "optional",
  });
  registry.register({
    ...common,
    actionType: "circle.policy.location.update",
  });
}

export function registerCircleAgentActions(
  registry: GovernedActionRegistry,
): void {
  const common = {
    targetType: "circle",
    impact: "high" as const,
    fallbackAuthority: "owner_admin" as const,
    governanceMode: "required_when_bound" as const,
    executionAdapter: "circle_agent",
    executionDomain: "off_chain" as const,
    receiptRequired: true,
  };
  registry.register({
    ...common,
    actionType: "circle.agent.policy.update",
  });
  registry.register({
    ...common,
    actionType: "circle.agent.create",
  });
  registry.register({
    ...common,
    actionType: "circle.agent.owner_binding.update",
    targetType: "agent",
  });
}

export function registerCircleSeededActions(
  registry: GovernedActionRegistry,
): void {
  registry.register({
    actionType: "circle.seeded.replace_manifest",
    targetType: "circle",
    impact: "high",
    fallbackAuthority: "owner_admin",
    governanceMode: "required_when_bound",
    executionAdapter: "circle_seeded",
    executionDomain: "off_chain",
    receiptRequired: true,
  });
}

export function registerSourceMaterialActions(
  registry: GovernedActionRegistry,
): void {
  const common = {
    targetType: "source_material",
    impact: "high" as const,
    fallbackAuthority: "manager" as const,
    governanceMode: "required_when_bound" as const,
    executionAdapter: "source_material",
    executionDomain: "off_chain" as const,
    receiptRequired: true,
  };
  registry.register({
    ...common,
    actionType: "source_material.accept",
    impact: "medium",
  });
  registry.register({
    ...common,
    actionType: "source_material.reject",
  });
  registry.register({
    ...common,
    actionType: "source_material.redact",
    impact: "critical",
  });
  registry.register({
    ...common,
    actionType: "source_material.revoke",
    impact: "critical",
  });
}

export function registerCommunicationActions(
  registry: GovernedActionRegistry,
): void {
  registry.register({
    actionType: OPERATOR_CAPABILITY_SUSPEND_ACTION_TYPE,
    targetType: "governed_operator_capability",
    impact: "high",
    fallbackAuthority: "none",
    governanceMode: "always_required",
    executionAdapter: "communication",
    executionDomain: "off_chain",
    receiptRequired: true,
    idempotencyScope: "governance_home_action_subject",
    idempotencyWindowSeconds: 300,
    appealPolicy: {
      windowSeconds: 72 * 60 * 60,
      conflictRule: "original_executor_and_appellant_excluded",
      resolutionPath: "independent_review_or_case",
    },
  });
  registry.register({
    actionType: "communication.message.hide",
    targetType: "communication_message",
    impact: "low",
    fallbackAuthority: "none",
    governanceMode: "always_required",
    executionAdapter: "communication",
    executionDomain: "off_chain",
    receiptRequired: true,
    idempotencyScope: "governance_home_action_subject",
    idempotencyWindowSeconds: 300,
    appealPolicy: {
      windowSeconds: 72 * 60 * 60,
      conflictRule: "original_executor_and_appellant_excluded",
      resolutionPath: "independent_review_or_case",
    },
  });
  registry.register({
    actionType: "communication.member.mute",
    targetType: "communication_room_member",
    impact: "high",
    fallbackAuthority: "none",
    governanceMode: "always_required",
    executionAdapter: "communication",
    executionDomain: "off_chain",
    receiptRequired: true,
    idempotencyScope: "governance_home_action_subject",
    idempotencyWindowSeconds: 300,
    appealPolicy: {
      windowSeconds: 72 * 60 * 60,
      conflictRule: "original_executor_and_appellant_excluded",
      resolutionPath: "independent_review_or_case",
    },
  });
  registry.register({
    actionType: "communication.voice_policy.update",
    targetType: "communication_room",
    impact: "high",
    fallbackAuthority: "moderator",
    governanceMode: "required_when_bound",
    executionAdapter: "communication",
    executionDomain: "off_chain",
    receiptRequired: true,
  });
  registry.register({
    actionType: "room_upgrade_circle_propose",
    targetType: "communication_room",
    impact: "high",
    fallbackAuthority: "none",
    governanceMode: "always_required",
    executionAdapter: "communication_room_upgrade",
    executionDomain: "off_chain",
    receiptRequired: true,
  });
}

export function registerFeedGovernanceActions(
  registry: GovernedActionRegistry,
): void {
  for (const definition of [{
    actionType: CONTENT_VISIBILITY_DOWNRANK_ACTION_TYPE,
    targetType: "feed_post",
  }, {
    actionType: FEED_RANKING_POLICY_UPDATE_ACTION_TYPE,
    targetType: "feed_ranking_policy",
  }, {
    actionType: FEED_RECOMMENDATION_EXPERIMENT_START_ACTION_TYPE,
    targetType: "feed_recommendation_experiment",
  }, {
    actionType: FEED_RECOMMENDATION_EXPERIMENT_STOP_ACTION_TYPE,
    targetType: "feed_recommendation_experiment",
  }]) registry.register({
    actionType: definition.actionType,
    targetType: definition.targetType,
    impact: "high",
    fallbackAuthority: "none",
    governanceMode: "always_required",
    executionAdapter: "feed_ranking",
    executionDomain: "off_chain",
    receiptRequired: true,
    idempotencyScope: "governance_home_action_subject",
    idempotencyWindowSeconds: 300,
    appealPolicy: {
      windowSeconds: 72 * 60 * 60,
      conflictRule: "original_executor_and_appellant_excluded",
      resolutionPath: "independent_review_or_case",
    },
  });
}

export function registerDraftGovernanceActions(
  registry: GovernedActionRegistry,
): void {
  const common = {
    impact: "medium" as const,
    fallbackAuthority: "manager" as const,
    governanceMode: "required_when_bound" as const,
    executionAdapter: "draft_governance",
    executionDomain: "off_chain" as const,
    receiptRequired: true,
  };
  registry.register({
    ...common,
    actionType: "temporary_edit_grant.approve",
    targetType: "temporary_edit_grant",
  });
  for (const actionType of [
    REVISION_DIRECTION_ACCEPT_ACTION_TYPE,
    LEGACY_REVISION_DIRECTION_ACCEPT_ACTION_TYPE,
  ]) {
    registry.register({
      ...common,
      actionType,
      targetType: "revision_direction",
    });
  }
}

export function registerCircleCommitteeProfileActions(
  registry: GovernedActionRegistry,
): void {
  registry.register({
    actionType: "circle.governance_binding.committee_profile.update",
    targetType: "circle",
    impact: "high",
    fallbackAuthority: "owner_admin",
    governanceMode: "required_when_bound",
    executionAdapter: "circle_committee_profile",
    executionDomain: "off_chain",
    receiptRequired: true,
  });
}

export function registerExternalAppActions(
  registry: GovernedActionRegistry,
): void {
  const common = {
    targetType: "external_app",
    fallbackAuthority: "none" as const,
    governanceMode: "always_required" as const,
    executionAdapter: "external_app",
    executionDomain: "hybrid" as const,
    receiptRequired: true,
  };
  registry.register({
    ...common,
    actionType: "external_app_register",
    impact: "critical",
    executionDomain: "on_chain_required",
  });
  registry.register({
    ...common,
    actionType: "external_app_server_key_rotate",
    impact: "critical",
    executionDomain: "on_chain_required",
  });
  registry.register({
    ...common,
    actionType: "external_app_server_key_revoke",
    impact: "critical",
    executionDomain: "off_chain",
  });
  registry.register({
    ...common,
    actionType: "approve_store_listing",
    impact: "high",
  });
  registry.register({
    ...common,
    actionType: "approve_managed_node_quota",
    impact: "high",
  });
  registry.register({
    ...common,
    actionType: "downgrade_discovery_status",
    impact: "high",
  });
  registry.register({
    ...common,
    actionType: "external_app_appeal_resolution",
    impact: "high",
    executionDomain: "off_chain",
  });
  registry.register({
    ...common,
    actionType: "limit_capability",
    impact: "critical",
  });
  registry.register({
    ...common,
    actionType: "emergency_hold",
    impact: "critical",
  });
  registry.register({
    ...common,
    actionType: "external_app_provisioning_grant",
    impact: "critical",
    executionDomain: "off_chain",
  });
  registry.register({
    ...common,
    actionType: "external_app_provisioning_revoke",
    impact: "critical",
    executionDomain: "off_chain",
  });
}

export function registerExternalAppCircleBindingActions(
  registry: GovernedActionRegistry,
): void {
  const common = {
    targetType: "external_app_circle_binding",
    impact: "high" as const,
    fallbackAuthority: "none" as const,
    governanceMode: "always_required" as const,
    executionAdapter: "external_app_circle_binding",
    executionDomain: "off_chain" as const,
    receiptRequired: true,
  };
  registry.register({
    ...common,
    actionType: "external_app_primary_circle_bind",
    impact: "critical" as const,
  });
  for (const actionType of [
    "external_app_primary_circle_change",
    "external_app_attached_circle_bind",
    "external_app_attached_circle_revoke",
  ] as const) {
    registry.register({
      ...common,
      actionType,
      impact: actionType.startsWith("external_app_primary")
        ? ("critical" as const)
        : ("high" as const),
    });
  }
}
