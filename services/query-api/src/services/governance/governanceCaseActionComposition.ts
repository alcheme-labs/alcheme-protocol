import {
  createGovernedActionRegistry,
  type GovernedActionRegistry,
  type GovernedActionDefinition,
} from './actionRegistry';
import {
  assertGovernanceProfileDefinitionBoundary,
  assertGovernanceProfileSupportsAction,
  type GovernanceProfileDefinition,
} from './governanceProfile';
import {
  hasExternalGovernedActionAuthorityCapabilities,
  type GovernedActionAdapterReadiness,
} from './externalGovernedActionReadiness';
import {
  isExternalActionCandidatePickerEnabled,
  isExternalActionIntakeEnabled,
} from './externalGovernedActionFlags';

export const STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE =
  'storage_fabric.authorize_provider_admission';

export const EXTERNAL_APP_PRIMARY_CIRCLE_BIND_ACTION_TYPE =
  'external_app_primary_circle_bind';

// Case-only: the native approval stage records the bound Draft as a policy
// document. This is not a Draft revision, crystallization or machine executor.
export const CIRCLE_POLICY_DOCUMENT_ADOPT_ACTION_TYPE = 'circle.policy.document.adopt';

const STORAGE_FABRIC_PROVIDER_ADMISSION_DEFINITION: GovernedActionDefinition = {
  actionType: STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE,
  targetType: 'external_provider',
  impact: 'high',
  fallbackAuthority: 'none',
  governanceMode: 'always_required',
  executionAdapter: 'manual_case_execution',
  executionDomain: 'off_chain',
  receiptRequired: true,
  idempotencyScope: 'governance_home_action_subject',
  idempotencyWindowSeconds: null,
  bindingRequirement: 'exact_action_subject_purpose',
};

const EXTERNAL_APP_PRIMARY_CIRCLE_BIND_DEFINITION: GovernedActionDefinition = {
  actionType: EXTERNAL_APP_PRIMARY_CIRCLE_BIND_ACTION_TYPE,
  targetType: 'external_app_circle_binding',
  impact: 'critical',
  fallbackAuthority: 'none',
  governanceMode: 'always_required',
  executionAdapter: 'external_app_circle_binding',
  executionDomain: 'off_chain',
  receiptRequired: true,
  idempotencyScope: 'governance_home_action_subject',
  idempotencyWindowSeconds: null,
  bindingRequirement: 'exact_action_subject_purpose',
};

function createRegistry(): GovernedActionRegistry {
  const registry = createGovernedActionRegistry({
    includePhase1Defaults: true,
    includeCirclePolicyActions: true,
    includeGrantActions: true,
    includeProviderExecutionLifecycleActions: true,
    includeCommunicationActions: true,
  });
  registry.register({
    actionType: CIRCLE_POLICY_DOCUMENT_ADOPT_ACTION_TYPE,
    targetType: 'circle',
    impact: 'medium',
    fallbackAuthority: 'none',
    governanceMode: 'always_required',
    executionAdapter: 'governance_case',
    executionDomain: 'off_chain',
    receiptRequired: false,
    bindingRequirement: 'exact_action_subject_purpose',
  });
  if (isProviderAdmissionCatalogEnabled()) {
    registry.register(STORAGE_FABRIC_PROVIDER_ADMISSION_DEFINITION);
  }
  if (isExternalActionIntakeEnabled()) {
    registry.register(EXTERNAL_APP_PRIMARY_CIRCLE_BIND_DEFINITION);
  }
  return registry;
}

export {
  isExternalActionCandidatePickerEnabled,
  isExternalActionIntakeEnabled,
};

export function isProviderAdmissionCatalogEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return String(env.GOVERNANCE_PROVIDER_ADMISSION_CATALOG_ENABLED || '')
    .trim().toLowerCase() === 'true';
}

export function resolveGovernanceCaseExternalActionAdapterReadiness(
  definition: GovernedActionDefinition,
  network: string,
): GovernedActionAdapterReadiness {
  if (definition.actionType === CIRCLE_POLICY_DOCUMENT_ADOPT_ACTION_TYPE
    && definition.executionAdapter === 'governance_case'
    && definition.executionDomain === 'off_chain'
    && definition.receiptRequired === false
    && definition.fallbackAuthority === 'none'
    && definition.governanceMode === 'always_required') {
    // Its runtime consumer is applyGovernanceCaseDecisionResolution, not an
    // external executor. Frozen exact authority still goes through all checks.
    return { adapter: definition.executionAdapter, available: true, network };
  }
  if (definition.actionType === STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE) {
    const available = isProviderAdmissionCatalogEnabled();
    return {
      adapter: definition.executionAdapter,
      available,
      network,
      ...(available ? {} : { reasonCode: 'governed_action_adapter_unavailable' }),
    };
  }
  if (definition.actionType === EXTERNAL_APP_PRIMARY_CIRCLE_BIND_ACTION_TYPE) {
    const available = isExternalActionIntakeEnabled();
    return {
      adapter: definition.executionAdapter,
      available,
      network,
      ...(available ? {} : { reasonCode: 'governed_action_adapter_unavailable' }),
    };
  }
  return {
    adapter: definition.executionAdapter,
    available: false,
    network,
    reasonCode: 'governed_action_adapter_readiness_owner_required',
  };
}

export function listGovernanceCaseActionDefinitions(): GovernedActionDefinition[] {
  return createRegistry().list();
}

export function getGovernanceCaseActionRegistry(): GovernedActionRegistry {
  return createRegistry();
}

export function getGovernanceCaseActionDefinition(
  actionType: string,
): GovernedActionDefinition | null {
  const definition = createRegistry().get(actionType);
  return definition ? { ...definition } : null;
}

export function resolveGovernanceCaseActionDefinitionForDecision(
  frozenContract: {
    id?: unknown;
    actionType?: unknown;
    executionAdapter?: unknown;
    executionDomain?: unknown;
    riskFloor?: unknown;
    definitionDigest?: unknown;
    definition?: unknown;
    contractVersionId?: unknown;
  } | null | undefined,
  frozenSelection?: {
    bindingRequirement?: unknown;
  } | null,
  frozenAuthority?: {
    action?: { type?: unknown; selector?: { actionType?: unknown; actionPrefix?: unknown } };
    subject?: { type?: unknown; ref?: unknown };
    purpose?: unknown;
    authorityPolicyBinding?: { id?: unknown; bindingDigest?: unknown; limitsDigest?: unknown };
  } | null,
): GovernedActionDefinition | null {
  if (!frozenContract || typeof frozenContract !== 'object') return null;
  const frozen = asRecord(frozenContract.definition);
  if (!frozen) return null;

  const actionType = stringField(frozen.actionType) || stringField(frozenContract.actionType);
  const executionAdapter = stringField(frozen.executionAdapter)
    || stringField(frozenContract.executionAdapter);
  const executionDomain = stringField(frozen.executionDomain)
    || stringField(frozenContract.executionDomain);
  const impact = stringField(frozen.impact) || stringField(frozenContract.riskFloor);
  const targetType = stringField(frozen.subjectType);
  const fallbackAuthority = stringField(frozen.fallbackAuthority);
  const governanceMode = stringField(frozen.governanceMode);
  if (
    !actionType
    || !executionAdapter
    || !executionDomain
    || !impact
    || !targetType
    || !fallbackAuthority
    || !governanceMode
    || typeof frozen.receiptRequired !== 'boolean'
  ) return null;

  if (
    (typeof frozenContract.actionType === 'string'
      && frozenContract.actionType.trim() !== actionType)
    || (typeof frozenContract.executionAdapter === 'string'
      && frozenContract.executionAdapter.trim() !== executionAdapter)
    || (typeof frozenContract.executionDomain === 'string'
      && frozenContract.executionDomain.trim() !== executionDomain)
    || (typeof frozenContract.riskFloor === 'string'
      && frozenContract.riskFloor.trim() !== impact)
  ) return null;

  if (
    !['low', 'medium', 'high', 'critical'].includes(impact)
    || !['optional', 'required_when_bound', 'always_required'].includes(governanceMode)
    || !['owner_admin', 'manager', 'moderator', 'none'].includes(fallbackAuthority)
    || !['off_chain', 'on_chain_required', 'hybrid'].includes(executionDomain)
  ) return null;

  const definition: GovernedActionDefinition = {
    actionType,
    targetType,
    impact: impact as GovernedActionDefinition['impact'],
    fallbackAuthority: fallbackAuthority as GovernedActionDefinition['fallbackAuthority'],
    governanceMode: governanceMode as GovernedActionDefinition['governanceMode'],
    executionAdapter,
    executionDomain: executionDomain as GovernedActionDefinition['executionDomain'],
    receiptRequired: frozen.receiptRequired,
  };
  if (typeof frozen.idempotencyScope === 'string') {
    definition.idempotencyScope = frozen.idempotencyScope as GovernedActionDefinition['idempotencyScope'];
  }
  if (frozen.idempotencyWindowSeconds === null
    || typeof frozen.idempotencyWindowSeconds === 'number') {
    definition.idempotencyWindowSeconds = frozen.idempotencyWindowSeconds;
  }
  if (frozen.appealPolicy === null) {
    definition.appealPolicy = null;
  } else if (frozen.appealPolicy && typeof frozen.appealPolicy === 'object') {
    definition.appealPolicy = frozen.appealPolicy as GovernedActionDefinition['appealPolicy'];
  }
  if (frozen.runtimeAvailability === 'enabled'
    || frozen.runtimeAvailability === 'historical_read_only') {
    definition.runtimeAvailability = frozen.runtimeAvailability;
  }
  if (typeof frozen.unavailableReason === 'string' || frozen.unavailableReason === null) {
    definition.unavailableReason = frozen.unavailableReason as string | null;
  }
  const legacyExactAuthority =
    frozenAuthority?.action?.type === actionType
    && frozenAuthority.action.selector?.actionType === actionType
    && frozenAuthority.action.selector?.actionPrefix == null
    && frozenAuthority.subject?.type === targetType
    && frozenAuthority.purpose === 'collective_decision'
    && Boolean(stringField(frozenAuthority.authorityPolicyBinding?.id))
    && /^[a-f0-9]{64}$/.test(stringField(
      frozenAuthority.authorityPolicyBinding?.bindingDigest,
    ))
    && /^[a-f0-9]{64}$/.test(stringField(
      frozenAuthority.authorityPolicyBinding?.limitsDigest,
    ));
  if (
    frozen.bindingRequirement === 'exact_action_subject_purpose'
    || frozenSelection?.bindingRequirement === 'exact_action_subject_purpose'
    || legacyExactAuthority
  ) {
    definition.bindingRequirement = 'exact_action_subject_purpose';
  }
  return definition;
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function assertGovernanceCaseActionProfileCompatibility(
  profile: GovernanceProfileDefinition,
  input: { homeType: string; definition: GovernedActionDefinition },
): GovernanceProfileDefinition {
  if (input.definition.bindingRequirement === 'exact_action_subject_purpose') {
    assertGovernanceProfileDefinitionBoundary(profile);
    if (
      !profile.supportedHomeTypes.includes(input.homeType)
      || !hasExternalGovernedActionAuthorityCapabilities(profile.authorityCapabilities)
    ) {
      throw new Error('governance_profile_action_capability_mismatch');
    }
    return profile;
  }
  return assertGovernanceProfileSupportsAction(profile, {
    homeType: input.homeType,
    actionType: input.definition.actionType,
    executionAdapter: input.definition.executionAdapter,
  });
}
