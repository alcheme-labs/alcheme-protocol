import { isDeepStrictEqual } from 'node:util';

import type { GovernedActionDefinition } from './actionRegistry';
import { hashCanonicalGovernanceValue } from './canonicalCodec';
import {
  resolveActiveGovernanceProfileForWork,
  resolveActiveGovernanceProfilePin,
  resolveGovernanceProfileForDirectOperation,
} from './governanceProfileLifecycle';
import {
  assertGovernanceCaseActionProfileCompatibility,
  resolveGovernanceCaseActionDefinitionForDecision,
  resolveGovernanceCaseExternalActionAdapterReadiness,
} from './governanceCaseActionComposition';
import {
  requireResolvedExternalGovernedActionExecutionReadiness,
} from './externalGovernedActionReadiness';
import type { ExternalGovernanceHomeIdentityReadback } from './governanceHomeStore';
import { GOVERNED_ACTION_IDEMPOTENCY_SCOPE } from './governedActionInvocationLineage';
import {
  createGovernanceLegacyCompatibilityBundle,
  type GovernanceLegacyCompatibilityBundleInput,
} from './governanceLegacyCompatibilityBundle';
import {
  selectGovernanceCaseTemplateForInvocation,
  type GovernanceCaseTemplateSelection,
} from './governanceCaseTemplate';
import { resolveGovernedActionRuntimeContext } from './governedActionRuntimeContext';

const CONTRACT_DOMAIN = 'alcheme.governance.action-contract-seed';
const AUTHORITY_BINDING_DOMAIN = 'alcheme.governance.action-authority-binding-seed';
const PAYLOAD_DOMAIN = 'alcheme.governance.action-payload';

export interface GovernedActionGatewayRuntimeBinding {
  id: string;
  bindingType?: string;
  targetCircleId?: number;
  actionType?: string | null;
  actionPrefix?: string | null;
  policyId: string;
  policyVersionId: string;
  policyVersion: number;
  ruleId: string;
  committeeCircleId: number;
  authoritySourceType?: string;
  authoritySourceRef?: string;
  authoritySourceVersion?: string | null;
  authorityPurpose?: string;
  status?: string;
  targetAuthorizationStatus?: string;
  committeeMandateStatus?: string;
  authoritySelector?: Record<string, unknown>;
  authorityLimits?: Record<string, unknown>;
  authorityEffectiveFrom?: Date;
  authorityEffectiveUntil?: Date | null;
  authorityCanonicalState?: string | null;
  metadata?: unknown;
}

export interface GovernedActionGatewayRuntimeResolution {
  homeIdentityBindingId: string;
  governanceHomeType: string;
  governanceHomeRef: string;
  contractVersionId: string;
  contractDefinitionDigest: string;
  idempotencyScope: string;
  idempotencyWindowSeconds: number | null;
  appealPolicy: GovernedActionDefinition['appealPolicy'];
  profileBindingId: string;
  profileVersionRef: string;
  profileDefinitionDigest: string;
  authorityBindingId: string;
  authority: {
    sourceType: string;
    sourceRef: string;
    sourceVersion: string | null;
    selectorDigest: string;
    capabilityDigest: string;
  };
  requestPolicy?: {
    bindingId: string;
    domainBindingId: string;
    policyId: string;
    policyVersionId: string;
    policyVersion: number;
    ruleId: string;
    committeeCircleId: number;
  };
  payload?: Record<string, unknown>;
  riskFloor?: GovernedActionDefinition['impact'];
  payloadDigest: string;
  executionMode: 'legacy_action_checkpoint' | 'stage_decision_only' | 'provider_bound_action';
  compatibilityBundleVersion: string | null;
  executionModeDigest: string;
  externalIdentityReadback?: ExternalGovernanceHomeIdentityReadback;
  caseTemplate?: {
    selection: GovernanceCaseTemplateSelection;
    digest: string;
  };
}

export interface GovernedActionRuntimeSeedResolution {
  contractVersionId: string;
  contractDefinitionDigest: string;
  idempotencyScope: string;
  idempotencyWindowSeconds: number | null;
  appealPolicy: GovernedActionDefinition['appealPolicy'];
  authorityBindingId: string;
  authority: GovernedActionGatewayRuntimeResolution['authority'];
}

export interface GovernedDirectOperationRuntimeResolution {
  homeIdentityBindingId: string;
  governanceHomeType: string;
  governanceHomeRef: string;
  homeActivationState: 'legacy_unmigrated' | 'bootstrap_pending' | 'active';
  contractVersionId: string;
  contractDefinitionDigest: string;
  idempotencyScope: string;
  idempotencyWindowSeconds: number | null;
  appealPolicy: GovernedActionDefinition['appealPolicy'];
  profileBindingId: string;
  profileBindingState: 'active' | 'draft';
  profilePinMode: 'active' | 'bootstrap_draft';
  profileVersionRef: string;
  profileDefinitionDigest: string;
  authorityBindingId: string;
  authority: GovernedActionGatewayRuntimeResolution['authority'];
  policyVersionRef: string;
  authorityLimits: Record<string, unknown>;
  limitsDigest: string;
  payloadDigest: string;
  reasonDigest: string;
  preflightDigest: string;
  riskFloor: GovernedActionDefinition['impact'];
  capabilityValidUntil: Date | null;
}

export interface GovernedActionExecutionAuthorityReadback {
  authorityType: 'verified_actor_capability' | 'wallet' | 'multisig' | 'program' | 'provider';
  authorityRef: string;
  executionAdapter: string;
  providerRef: string;
  subjectAuthorityRef: string;
  readbackDigest: string;
}

interface RuntimeClient {
  governanceHomeIdentityBinding: { findMany(input: unknown): Promise<any[]> };
  governanceCompatibilityBundle: { findFirst(input: unknown): Promise<any> };
  governanceProfileBinding: { findFirst(input: unknown): Promise<any> };
  governanceBootstrapCeremony?: { findUnique(input: unknown): Promise<any> };
  governedActionContractVersion: {
    findUnique(input: unknown): Promise<any>;
    create(input: unknown): Promise<any>;
  };
  actionAuthorityPolicyBinding: {
    findUnique(input: unknown): Promise<any>;
    findMany(input: unknown): Promise<any[]>;
    create(input: unknown): Promise<any>;
    updateMany?(input: unknown): Promise<{ count: number }>;
  };
}

type RuntimePrisma = RuntimeClient & {
  $transaction<T>(operation: (tx: RuntimeClient) => Promise<T>): Promise<T>;
};

export async function resolveGovernedActionGatewayRuntime(
  dependencies: { prisma: RuntimePrisma; transactionClient?: boolean },
  input: {
    definition: GovernedActionDefinition;
    targetCircleId: number;
    targetType?: string;
    targetRef?: string;
    binding: GovernedActionGatewayRuntimeBinding;
    payload: Record<string, unknown>;
    appendCircleBindingFacts?: boolean;
    now: Date;
  },
): Promise<GovernedActionGatewayRuntimeResolution> {
  const { home, compatibility } = await resolveVerifiedLegacyCircleHome(
    dependencies.prisma,
    input.targetCircleId,
  );
  const binding = projectVerifiedLegacyCheckpointNetwork(
    input.binding,
    compatibility.network,
  );
  return resolveGovernedLegacyCheckpointRuntime(dependencies, {
    definition: input.definition,
    home,
    binding,
    targetType: input.targetType ?? input.definition.targetType,
    targetRef: input.targetRef ?? String(input.targetCircleId),
    payload: (requestPolicy) => ({
      ...input.payload,
      ...(input.appendCircleBindingFacts ? {
        targetCircleId: input.targetCircleId,
        bindingId: requestPolicy.domainBindingId,
        committeeCircleId: requestPolicy.committeeCircleId,
      } : {}),
    }),
    checkpointVersion: `${compatibility.id}:${compatibility.version}`,
    checkpointDigest: compatibility.bundleDigest,
    now: input.now,
  });
}

function projectVerifiedLegacyCheckpointNetwork(
  binding: GovernedActionGatewayRuntimeBinding,
  checkpointNetwork: unknown,
): GovernedActionGatewayRuntimeBinding {
  const verifiedNetwork = string(checkpointNetwork);
  if (verifiedNetwork !== 'solana:localnet') {
    throw new Error('governed_action_compatibility_bundle_mismatch');
  }
  const selector = record(binding.authoritySelector);
  const selectedEnvironment = string(selector.environment);
  if (selectedEnvironment && selectedEnvironment !== 'local_development') {
    throw new Error('governed_action_environment_mismatch');
  }
  const selectedNetwork = string(selector.network);
  if (selectedNetwork && selectedNetwork !== verifiedNetwork) {
    throw new Error('governed_action_network_mismatch');
  }
  return {
    ...binding,
    authoritySelector: {
      ...selector,
      environment: 'local_development',
      network: verifiedNetwork,
    },
  };
}

async function projectVerifiedBootstrapDecisionNetwork(
  prisma: RuntimePrisma,
  home: any,
  binding: GovernedActionGatewayRuntimeBinding,
): Promise<GovernedActionGatewayRuntimeBinding> {
  const selector = record(binding.authoritySelector);
  if (string(selector.network)) return binding;

  const circleId = Number(home?.homeRef);
  const metadata = record(binding.metadata);
  const ceremonyId = string(metadata.bootstrapCeremonyId);
  const configurationBundleId = string(metadata.configurationBundleId);
  const configurationBundleDigest = string(metadata.configurationBundleDigest);
  const activation = home?.activationState;
  const isCanonicalBootstrapBinding = home?.homeType === 'circle'
    && Number.isSafeInteger(circleId)
    && circleId > 0
    && binding.bindingType === 'self_governed'
    && binding.id === `circle-governance-self:${circleId}:circle`
    && binding.targetCircleId === circleId
    && binding.committeeCircleId === circleId
    && binding.actionType == null
    && binding.actionPrefix === 'circle'
    && binding.status === 'active'
    && binding.targetAuthorizationStatus === 'accepted'
    && binding.committeeMandateStatus === 'accepted'
    && binding.authorityCanonicalState === 'legacy_canonical'
    && ceremonyId.length > 0
    && configurationBundleId.length > 0
    && /^[a-f0-9]{64}$/.test(configurationBundleDigest)
    && activation?.state === 'active'
    && activation.bootstrapCeremonyId === ceremonyId
    && activation.bootstrapConfigurationBundleId === configurationBundleId
    && activation.bootstrapBundleDigest === configurationBundleDigest;
  if (!isCanonicalBootstrapBinding) {
    throw new Error('governed_action_network_required');
  }
  if (!prisma.governanceBootstrapCeremony) {
    throw new Error('governed_action_bootstrap_ceremony_required');
  }
  const ceremony = await prisma.governanceBootstrapCeremony.findUnique({
    where: { id: ceremonyId },
    select: {
      id: true,
      homeIdentityBindingId: true,
      configurationBundleId: true,
      configurationBundleDigest: true,
      state: true,
      signatureNetwork: true,
      effectiveAt: true,
    },
  });
  if (
    !ceremony
    || ceremony.id !== ceremonyId
    || ceremony.homeIdentityBindingId !== home.id
    || ceremony.configurationBundleId !== configurationBundleId
    || ceremony.configurationBundleDigest !== configurationBundleDigest
    || ceremony.state !== 'active'
    || !ceremony.effectiveAt
  ) {
    throw new Error('governed_action_bootstrap_ceremony_mismatch');
  }
  return {
    ...binding,
    authoritySelector: {
      ...selector,
      environment: string(selector.environment) || 'local_development',
      network: ceremony.signatureNetwork,
    },
  };
}

export async function resolveGovernedSystemRoleActionRuntime(
  dependencies: { prisma: RuntimePrisma; transactionClient?: boolean },
  input: {
    definition: GovernedActionDefinition;
    home: { id: string; homeType: string; homeRef: string };
    binding: GovernedActionGatewayRuntimeBinding;
    targetType: string;
    targetRef: string;
    payload: Record<string, unknown>;
    now: Date;
  },
): Promise<GovernedActionGatewayRuntimeResolution> {
  if (
    input.home.homeType !== 'external_app_system_role'
    || !input.home.homeRef.startsWith('external_app:')
    || input.binding.authoritySourceType !== 'system_governance_role_binding'
    || input.binding.authorityPurpose !== 'system_governance_review'
  ) {
    throw new Error('governed_system_role_runtime_binding_mismatch');
  }
  const checkpointFacts = {
    homeIdentityBindingId: input.home.id,
    homeRef: input.home.homeRef,
    roleBindingId: input.binding.id,
    policyId: input.binding.policyId,
    policyVersionId: input.binding.policyVersionId,
    policyVersion: input.binding.policyVersion,
    ruleId: input.binding.ruleId,
    authoritySourceVersion: input.binding.authoritySourceVersion ?? null,
  };
  const checkpointDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.system-role-checkpoint',
    checkpointFacts,
  );
  return resolveGovernedLegacyCheckpointRuntime(dependencies, {
    definition: input.definition,
    home: input.home,
    binding: input.binding,
    targetType: input.targetType,
    targetRef: input.targetRef,
    payload: input.payload,
    checkpointVersion: `system-role:${checkpointDigest.slice(0, 56)}`,
    checkpointDigest,
    now: input.now,
  });
}

async function resolveGovernedLegacyCheckpointRuntime(
  dependencies: { prisma: RuntimePrisma; transactionClient?: boolean },
  input: {
    definition: GovernedActionDefinition;
    home: { id: string; homeType: string; homeRef: string };
    binding: GovernedActionGatewayRuntimeBinding;
    targetType: string;
    targetRef: string;
    payload: Record<string, unknown> | ((requestPolicy: {
      domainBindingId: string;
      committeeCircleId: number;
    }) => Record<string, unknown>);
    checkpointVersion: string;
    checkpointDigest: string;
    now: Date;
  },
): Promise<GovernedActionGatewayRuntimeResolution> {
  const home = input.home;
  const profile = await resolveActiveGovernanceProfileForWork(dependencies.prisma, {
    homeIdentityBindingId: home.id,
    homeType: home.homeType,
    actionType: input.definition.actionType,
    executionAdapter: input.definition.executionAdapter,
  });

  const bindingForSeed = input.binding.authoritySourceType === 'governance_mandate'
    ? {
        ...input.binding,
        authoritySelector: {
          ...(input.binding.authoritySelector ?? {}),
          subjectType: input.targetType,
          subjectRef: input.targetRef,
        },
      }
    : input.binding;
  const runtimeContext = resolveGovernedActionRuntimeContext({
    binding: { authoritySelector: bindingForSeed.authoritySelector ?? {} },
  });
  const seeded = await ensureGovernedActionRuntimeSeeds(dependencies, {
    definition: input.definition,
    home,
    binding: bindingForSeed,
    now: input.now,
  });
  const selected = await resolveCanonicalActionAuthorityBinding(dependencies.prisma, {
    home,
    contractVersionId: seeded.contractVersionId,
    definition: input.definition,
    targetType: input.targetType,
    targetRef: input.targetRef,
    purpose: input.binding.authorityPurpose ?? 'collective_decision',
    environment: runtimeContext.environment,
    network: runtimeContext.network,
    now: input.now,
  });
  const requestPolicy = requestPolicyFromAuthorityBinding(selected);
  const payload = typeof input.payload === 'function'
    ? input.payload(requestPolicy)
    : input.payload;

  const payloadDigest = hashCanonicalGovernanceValue(PAYLOAD_DOMAIN, payload);
  const compatibilityBundleVersion = input.checkpointVersion;
  const executionModeDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.request-execution-mode',
    {
      executionMode: 'legacy_action_checkpoint',
      compatibilityBundleVersion,
      compatibilityBundleDigest: input.checkpointDigest,
      homeIdentityBindingId: home.id,
      contractVersionId: seeded.contractVersionId,
      profileBindingId: profile.profileBindingId,
      profileVersionRef: profile.profileVersionRef,
      profileDefinitionDigest: profile.profileDefinitionDigest,
      authorityBindingId: selected.id,
    },
  );
  return {
    homeIdentityBindingId: home.id,
    governanceHomeType: home.homeType,
    governanceHomeRef: home.homeRef,
    contractVersionId: seeded.contractVersionId,
    contractDefinitionDigest: seeded.contractDefinitionDigest,
    idempotencyScope: seeded.idempotencyScope,
    idempotencyWindowSeconds: seeded.idempotencyWindowSeconds,
    appealPolicy: seeded.appealPolicy,
    profileBindingId: profile.profileBindingId,
    profileVersionRef: profile.profileVersionRef,
    profileDefinitionDigest: profile.profileDefinitionDigest,
    authorityBindingId: selected.id,
    authority: authorityResolutionFromBinding(selected),
    requestPolicy,
    payload,
    riskFloor: resolvedRiskFloor(selected),
    payloadDigest,
    executionMode: 'legacy_action_checkpoint',
    compatibilityBundleVersion,
    executionModeDigest,
  };
}

export async function resolveGovernedActionDecisionStageRuntime(
  dependencies: { prisma: RuntimePrisma; transactionClient?: boolean },
  input: {
    definition: GovernedActionDefinition;
    targetCircleId: number;
    targetType: string;
    targetRef: string;
    binding: GovernedActionGatewayRuntimeBinding;
    payload: Record<string, unknown>;
    caseRef: string;
    stageRef: string;
    decisionInputDigest: string;
    caseTemplate?: {
      selection: GovernanceCaseTemplateSelection;
      digest: string;
    };
    caseTemplateDigest?: string;
    now: Date;
  },
): Promise<GovernedActionGatewayRuntimeResolution> {
  const home = await resolveVerifiedCircleHome(
    dependencies.prisma,
    input.targetCircleId,
    ['active'],
  );
  const frozenActionAuthority = input.caseTemplate?.selection.actionAuthority ?? null;
  const frozenResolution = frozenActionAuthority
    ? await resolveFrozenGovernedActionContractVersion(dependencies.prisma, {
      selected: input.caseTemplate?.selection.actionContract ?? null,
      authority: frozenActionAuthority,
    })
    : null;
  const runtimeDefinition = frozenResolution?.definition ?? input.definition;
  if (frozenResolution && runtimeDefinition.actionType !== input.definition.actionType) {
    throw new Error('governance_case_action_contract_snapshot_mismatch');
  }
  const profile = await resolveActiveGovernanceProfilePin(dependencies.prisma, {
    homeIdentityBindingId: home.id,
  });
  try {
    assertGovernanceCaseActionProfileCompatibility(profile.definition, {
      homeType: home.homeType,
      definition: runtimeDefinition,
    });
  } catch {
    throw new Error('governance_profile_active_binding_incompatible');
  }
  const decisionBinding = await projectVerifiedBootstrapDecisionNetwork(
    dependencies.prisma,
    home,
    input.binding,
  );
  const runtimeContext = resolveGovernedActionRuntimeContext({
    binding: { authoritySelector: decisionBinding.authoritySelector ?? {} },
  });
  const seeded = frozenResolution
    ? frozenResolution
    : await ensureGovernedActionRuntimeSeeds(dependencies, {
      definition: runtimeDefinition,
      home,
      binding: decisionBinding,
      now: input.now,
    });
  if (frozenActionAuthority) {
    const frozenContract = input.caseTemplate?.selection.actionContract;
    if (
      !frozenContract
      || frozenContract.actionType !== runtimeDefinition.actionType
      || frozenContract.contractVersionId !== seeded.contractVersionId
      || frozenContract.definitionDigest !== seeded.contractDefinitionDigest
    ) {
      throw new Error('governance_case_action_contract_snapshot_mismatch');
    }
  }
  const authoritySubject = resolveGovernedDecisionAuthoritySubject({
    ...input,
    definition: runtimeDefinition,
  });
  const selected = await resolveCanonicalActionAuthorityBinding(dependencies.prisma, {
    home,
    contractVersionId: seeded.contractVersionId,
    definition: runtimeDefinition,
    targetType: authoritySubject.type,
    targetRef: authoritySubject.ref,
    purpose: 'collective_decision',
    environment: runtimeContext.environment,
    network: runtimeContext.network,
    now: input.now,
  });
  const validatedRuntimeContext = resolveGovernedActionRuntimeContext({
    binding: { authoritySelector: decisionBinding.authoritySelector ?? {} },
    aapbSelectorNetwork: record(selected.selector).network,
  });
  if (runtimeDefinition.bindingRequirement === 'exact_action_subject_purpose') {
    const readinessSnapshot = requireResolvedExternalGovernedActionExecutionReadiness({
      home: { homeType: home.homeType, homeRef: home.homeRef },
      profilePin: profile,
      actionContract: {
        actionType: runtimeDefinition.actionType,
        contractVersionId: seeded.contractVersionId,
        definitionDigest: seeded.contractDefinitionDigest,
        runtimeAvailability: runtimeDefinition.runtimeAvailability,
        unavailableReason: runtimeDefinition.unavailableReason,
        executionAdapter: runtimeDefinition.executionAdapter,
        impact: runtimeDefinition.impact,
      },
      subject: authoritySubject,
      purpose: 'collective_decision',
      governanceBinding: decisionBinding,
      authorityBinding: selected,
      runtimeContext: validatedRuntimeContext,
      adapterReadiness: resolveGovernanceCaseExternalActionAdapterReadiness(
        runtimeDefinition,
        validatedRuntimeContext.network,
      ),
      now: input.now,
    });
    if (frozenActionAuthority && (
      frozenActionAuthority.action?.type !== readinessSnapshot.actionType
      || frozenActionAuthority.subject?.type !== readinessSnapshot.subject.type
      || frozenActionAuthority.subject?.ref !== readinessSnapshot.subject.ref
      || frozenActionAuthority.purpose !== readinessSnapshot.purpose
      || frozenActionAuthority.network !== readinessSnapshot.network
      || frozenActionAuthority.environment !== readinessSnapshot.environment
    )) {
      throw new Error('governance_case_action_readiness_snapshot_mismatch');
    }
  }
  if (frozenActionAuthority) {
    const resolved = authorityResolutionFromBinding(selected);
    if (
      selected.id !== frozenActionAuthority.authorityPolicyBinding.id
      || resolved.selectorDigest
        !== frozenActionAuthority.authorityPolicyBinding.bindingDigest
      || resolved.capabilityDigest
        !== frozenActionAuthority.authorityPolicyBinding.limitsDigest
    ) {
      throw new Error('governance_case_action_authority_snapshot_mismatch');
    }
  }
  const requestPolicy = requestPolicyFromAuthorityBinding(selected);
  const caseTemplate = input.caseTemplate ?? (input.caseTemplateDigest ? undefined
    : selectGovernanceCaseTemplateForInvocation({
    definition: runtimeDefinition,
    profileBindingId: profile.profileBindingId,
    profileVersionRef: profile.profileVersionRef,
    profileDefinitionDigest: profile.profileDefinitionDigest,
    contractVersionId: seeded.contractVersionId,
    contractDefinitionDigest: seeded.contractDefinitionDigest,
    home: { type: home.homeType, ref: home.homeRef },
    governedSubject: { type: input.targetType, ref: input.targetRef },
    authority: {
      sourceType: selected.sourceType,
      sourceRef: selected.sourceRef,
      sourceVersion: selected.sourceVersion,
      selector: record(selected.selector),
      limits: record(selected.limits),
    },
    scope: {
      type: 'circle_governance_committee',
      ref: String(requestPolicy.committeeCircleId),
    },
    }));
  const caseTemplateDigest = caseTemplate?.digest ?? input.caseTemplateDigest;
  if (!caseTemplateDigest || !/^[a-f0-9]{64}$/.test(caseTemplateDigest)) {
    throw new Error('governance_case_template_selection_digest_required');
  }
  const payloadDigest = hashCanonicalGovernanceValue(PAYLOAD_DOMAIN, input.payload);
  const executionMode = [
    'realms_provider_binding',
    'squads_provider_binding',
  ].includes(runtimeDefinition.executionAdapter)
    ? 'provider_bound_action'
    : 'stage_decision_only';
  const executionModeDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.request-execution-mode',
    {
      executionMode,
      caseRef: input.caseRef,
      stageRef: input.stageRef,
      decisionInputDigest: input.decisionInputDigest,
      templateSelectionDigest: caseTemplateDigest,
      homeIdentityBindingId: home.id,
      contractVersionId: seeded.contractVersionId,
      profileBindingId: profile.profileBindingId,
      profileVersionRef: profile.profileVersionRef,
      profileDefinitionDigest: profile.profileDefinitionDigest,
      authorityBindingId: selected.id,
      environment: validatedRuntimeContext.environment,
      network: validatedRuntimeContext.network,
    },
  );
  return {
    homeIdentityBindingId: home.id,
    governanceHomeType: home.homeType,
    governanceHomeRef: home.homeRef,
    contractVersionId: seeded.contractVersionId,
    contractDefinitionDigest: seeded.contractDefinitionDigest,
    idempotencyScope: seeded.idempotencyScope,
    idempotencyWindowSeconds: seeded.idempotencyWindowSeconds,
    appealPolicy: seeded.appealPolicy,
    profileBindingId: profile.profileBindingId,
    profileVersionRef: profile.profileVersionRef,
    profileDefinitionDigest: profile.profileDefinitionDigest,
    authorityBindingId: selected.id,
    authority: authorityResolutionFromBinding(selected),
    requestPolicy,
    payload: input.payload,
    riskFloor: resolvedRiskFloor(selected),
    payloadDigest,
    executionMode,
    compatibilityBundleVersion: null,
    executionModeDigest,
    ...(caseTemplate ? { caseTemplate } : {}),
  };
}

export function resolveGovernedDecisionAuthoritySubject(input: {
  definition: GovernedActionDefinition;
  targetCircleId: number;
  targetType: string;
  targetRef: string;
  binding: GovernedActionGatewayRuntimeBinding;
}): { type: string; ref: string } {
  if (input.definition.bindingRequirement === 'exact_action_subject_purpose') {
    return { type: input.targetType, ref: input.targetRef };
  }
  const selfGovernanceAction = [
    'circle.governance_binding.accept_mandate',
    'circle.governance_binding.deactivate',
    'circle.governance_binding.policy_version.update',
    'circle.governance_binding.replace',
    'circle.governance_binding.authority_health.check',
  ].includes(input.definition.actionType);
  const selector = record(input.binding.authoritySelector);
  const exactSelfGovernance = selfGovernanceAction
    && input.targetType === 'circle_governance_binding'
    && input.targetRef === input.binding.id
    && ['governance_mandate', 'circle_governance_binding']
      .includes(String(input.binding.authoritySourceType ?? ''))
    && input.binding.authorityPurpose === 'collective_decision'
    && string(selector.subjectType) === 'circle'
    && string(selector.subjectRef) === String(input.targetCircleId);
  const delegatedCommunicationMember = input.definition.actionType === 'communication.member.mute'
    && input.targetType === 'communication_room_member'
    && input.targetRef.startsWith(`${input.targetCircleId}:`)
    && input.binding.authorityPurpose === 'collective_decision'
    && string(selector.subjectType) === 'circle'
    && string(selector.subjectRef) === String(input.targetCircleId);
  const delegatedOperatorCapability = input.definition.actionType === 'operator.capability.suspend'
    && input.targetType === 'governed_operator_capability'
    && input.targetRef.startsWith(`${input.targetCircleId}:operator-capability:`)
    && input.binding.authorityPurpose === 'collective_decision'
    && string(selector.subjectType) === 'circle'
    && string(selector.subjectRef) === String(input.targetCircleId);
  return exactSelfGovernance
    || delegatedCommunicationMember
    || delegatedOperatorCapability
    ? { type: 'circle', ref: String(input.targetCircleId) }
    : { type: input.targetType, ref: input.targetRef };
}

export async function resolveGovernedDirectOperationRuntime(
  dependencies: { prisma: RuntimePrisma; transactionClient?: boolean },
  input: {
    definition: GovernedActionDefinition;
    targetCircleId: number;
    targetType: string;
    targetRef: string;
    actorPubkey: string;
    payload: Record<string, unknown>;
    reasonCode: string;
    executionAuthorityReadback: GovernedActionExecutionAuthorityReadback;
    now: Date;
  },
): Promise<GovernedDirectOperationRuntimeResolution> {
  if (
    input.definition.targetType !== input.targetType
    || !['low', 'medium'].includes(input.definition.impact)
    || input.definition.governanceMode !== 'optional'
    || input.definition.fallbackAuthority !== 'owner_admin'
    || !input.definition.receiptRequired
  ) {
    throw new Error('governed_direct_operation_contract_not_eligible');
  }
  const reasonCode = input.reasonCode.trim();
  if (!reasonCode) throw new Error('governed_direct_operation_reason_required');
  if (reasonCode.length > 96) throw new Error('governed_direct_operation_reason_too_long');
  if (Buffer.byteLength(JSON.stringify(input.payload), 'utf8') > 4096) {
    throw new Error('governed_direct_operation_payload_limits_exceeded');
  }

  const home = await resolveVerifiedDirectOperationHome(
    dependencies.prisma,
    input.targetCircleId,
  );
  const profile = await resolveGovernanceProfileForDirectOperation(dependencies.prisma, {
    homeIdentityBindingId: home.id,
    homeType: home.homeType,
    homeActivationState: String(home.activationState.state),
    actionType: input.definition.actionType,
    executionAdapter: input.definition.executionAdapter,
  });
  const directPolicyVersionRef = 'circle-owner-admin-direct-policy:v1';
  const liveExecutionAuthority = input.executionAuthorityReadback;
  if (!liveExecutionAuthority.authorityRef.trim()
    || !liveExecutionAuthority.providerRef.trim()
    || !liveExecutionAuthority.subjectAuthorityRef.trim()
    || liveExecutionAuthority.executionAdapter !== input.definition.executionAdapter
    || !/^[a-f0-9]{64}$/.test(liveExecutionAuthority.readbackDigest)) {
    throw new Error('governed_direct_operation_execution_authority_readback_invalid');
  }
  const authorityLimits = {
    policyVersionRef: directPolicyVersionRef,
    operatorSelector: 'verified_circle_owner_or_admin',
    reasonRequired: true,
    reversible: true,
    maximumPayloadBytes: 4096,
    appealPath: 'governed_action_appeal',
    escalationPath: 'governance_case',
    riskFloor: input.definition.impact,
    executionAuthority: {
      type: liveExecutionAuthority.authorityType,
      ref: liveExecutionAuthority.authorityRef,
      adapter: liveExecutionAuthority.executionAdapter,
      providerRef: liveExecutionAuthority.providerRef,
      subjectAuthorityRef: liveExecutionAuthority.subjectAuthorityRef,
      readbackDigest: liveExecutionAuthority.readbackDigest,
    },
  };
  const seeded = await ensureGovernedActionRuntimeSeeds(dependencies, {
    definition: input.definition,
    home,
    binding: {
      id: `profile-role-direct:circle:${input.targetCircleId}`,
      policyId: 'circle-owner-admin-direct-policy',
      policyVersionId: directPolicyVersionRef,
      policyVersion: 1,
      ruleId: 'verified_circle_owner_or_admin',
      committeeCircleId: 0,
      authoritySourceType: 'wallet_capability_direct',
      authoritySourceRef: input.actorPubkey,
      authoritySourceVersion: directPolicyVersionRef,
      authorityPurpose: 'operational_execution',
      authoritySelector: {
        subjectType: input.targetType,
        subjectRef: input.targetRef,
        operatorSelector: 'verified_circle_owner_or_admin',
        actorPubkey: input.actorPubkey,
        environment: 'local_development',
        network: 'solana:localnet',
      },
      authorityLimits,
    },
    now: input.now,
  });
  const runtimeContext = resolveGovernedActionRuntimeContext({
    binding: {
      authoritySelector: {
        environment: 'local_development',
        network: 'solana:localnet',
      },
    },
  });
  const selected = await resolveCanonicalActionAuthorityBinding(dependencies.prisma, {
    home,
    contractVersionId: seeded.contractVersionId,
    definition: input.definition,
    targetType: input.targetType,
    targetRef: input.targetRef,
    purpose: 'operational_execution',
    actorPubkey: input.actorPubkey,
    environment: runtimeContext.environment,
    network: runtimeContext.network,
    now: input.now,
  });
  if (selected.id !== seeded.authorityBindingId) {
    throw new Error('governed_direct_operation_operator_runtime_required');
  }
  const selectedLimits = record(selected.limits);
  const policyVersionRef = string(selectedLimits.policyVersionRef);
  if (policyVersionRef !== directPolicyVersionRef) {
    throw new Error('governed_direct_operation_policy_version_mismatch');
  }
  const payloadDigest = hashCanonicalGovernanceValue(PAYLOAD_DOMAIN, input.payload);
  const reasonDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.action-reason',
    { reasonCode },
  );
  const limitsDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.action-authority-limits',
    selectedLimits,
  );
  const authority = authorityResolutionFromBinding(selected);
  const riskFloor = resolvedRiskFloor(selected);
  const preflightDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.direct-operation-preflight',
    {
      homeIdentityBindingId: home.id,
      homeActivationState: String(home.activationState.state),
      contractVersionId: seeded.contractVersionId,
      profileBindingId: profile.profileBindingId,
      profileBindingState: profile.profileBindingState,
      profilePinMode: profile.profilePinMode,
      profileVersionRef: profile.profileVersionRef,
      profileDefinitionDigest: profile.profileDefinitionDigest,
      authorityBindingId: selected.id,
      actorPubkey: input.actorPubkey,
      targetType: input.targetType,
      targetRef: input.targetRef,
      payloadDigest,
      reasonDigest,
      limitsDigest,
      policyVersionRef,
      executionAuthorityReadbackDigest: liveExecutionAuthority.readbackDigest,
      environment: runtimeContext.environment,
      network: runtimeContext.network,
    },
  );
  return {
    homeIdentityBindingId: home.id,
    governanceHomeType: home.homeType,
    governanceHomeRef: home.homeRef,
    homeActivationState: String(home.activationState.state) as GovernedDirectOperationRuntimeResolution['homeActivationState'],
    contractVersionId: seeded.contractVersionId,
    contractDefinitionDigest: seeded.contractDefinitionDigest,
    idempotencyScope: seeded.idempotencyScope,
    idempotencyWindowSeconds: seeded.idempotencyWindowSeconds,
    appealPolicy: seeded.appealPolicy,
    profileBindingId: profile.profileBindingId,
    profileBindingState: profile.profileBindingState,
    profilePinMode: profile.profilePinMode,
    profileVersionRef: profile.profileVersionRef,
    profileDefinitionDigest: profile.profileDefinitionDigest,
    authorityBindingId: selected.id,
    authority,
    policyVersionRef,
    authorityLimits: selectedLimits,
    limitsDigest,
    payloadDigest,
    reasonDigest,
    preflightDigest,
    riskFloor,
    capabilityValidUntil: null,
  };
}

export async function resolveGovernedSharedCommitteeOperationRuntime(
  dependencies: { prisma: RuntimePrisma; transactionClient?: boolean },
  input: {
    definition: GovernedActionDefinition;
    targetCircleId: number;
    targetType: string;
    targetRef: string;
    actorPubkey: string;
    payload: Record<string, unknown>;
    reasonCode: string;
    binding: GovernedActionGatewayRuntimeBinding & {
      bindingType: string;
      targetCircleId: number;
      status: string;
      targetAuthorizationStatus: string;
      committeeMandateStatus: string;
    };
    currentCommitteeOperators: Array<{
      pubkey: string;
      role?: string | null;
    }>;
    now: Date;
  },
): Promise<GovernedDirectOperationRuntimeResolution> {
  if (
    input.definition.targetType !== input.targetType
    || (input.definition.impact !== 'high'
      && !(input.definition.actionType === 'communication.message.hide'
        && input.definition.impact === 'low'))
    || input.definition.governanceMode !== 'always_required'
    || input.definition.fallbackAuthority !== 'none'
    || input.definition.executionDomain !== 'off_chain'
    || !input.definition.receiptRequired
  ) {
    throw new Error('governed_shared_committee_operation_contract_not_eligible');
  }
  if (
    input.binding.bindingType !== 'shared_committee'
    || input.binding.targetCircleId !== input.targetCircleId
    || input.binding.status !== 'active'
    || input.binding.targetAuthorizationStatus !== 'accepted'
    || input.binding.committeeMandateStatus !== 'accepted'
    || input.binding.authorityPurpose !== 'operational_execution'
  ) {
    throw new Error('governed_shared_committee_binding_required');
  }
  const mandateSelector = record(input.binding.authoritySelector);
  const operatorSelector = record(mandateSelector.operatorSelector);
  const mandateLimits = record(input.binding.authorityLimits);
  const operatorPolicy = record(mandateLimits.operatorPolicy);
  const frequencyPolicy = record(operatorPolicy.frequency);
  const appealPolicyLimit = record(operatorPolicy.appeal);
  const reauthorization = record(mandateLimits.reauthorization);
  const executionAuthorityRequirement = record(mandateLimits.executionAuthority);
  const termination = record(mandateLimits.termination);
  const frozenActors = Array.isArray(operatorSelector.frozenActors)
    ? operatorSelector.frozenActors.map((actor) => record(actor))
    : [];
  const allowedRoles = Array.isArray(operatorSelector.roles)
    ? operatorSelector.roles.map((role) => string(role)).filter(Boolean)
    : [];
  const currentActors = input.currentCommitteeOperators
    .map((actor) => ({
      pubkey: string(actor.pubkey),
      role: string(actor.role),
    }))
    .filter((actor) => actor.pubkey && allowedRoles.includes(actor.role))
    .sort((left, right) => left.pubkey.localeCompare(right.pubkey));
  const currentActorSetDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.mandate-operator-set',
    currentActors,
  );
  if (
    string(operatorSelector.mode) !== 'institution_roles'
    || allowedRoles.length === 0
    || allowedRoles.some((role) => !['Owner', 'Admin', 'Moderator'].includes(role))
    || new Set(allowedRoles).size !== allowedRoles.length
    || !Number.isSafeInteger(Number(operatorSelector.maximumActors))
    || Number(operatorSelector.maximumActors) < 1
    || Number(operatorSelector.maximumActors) > 50
    || frozenActors.length === 0
    || frozenActors.length > Number(operatorSelector.maximumActors)
    || string(operatorSelector.actorSetDigest) !== currentActorSetDigest
    || string(reauthorization.mode) !== 'exact_actor_set'
    || string(reauthorization.onMembershipOrRoleDrift) !== 'suspend_and_reauthorize'
    || reauthorization.newMembersInheritCapability !== false
    || string(executionAuthorityRequirement.type) !== 'target_adapter'
    || string(executionAuthorityRequirement.adapter) !== input.definition.executionAdapter
    || string(executionAuthorityRequirement.liveReadback) !== 'required_each_invocation'
    || string(termination.naturalExpiry) !== 'stop_new_invocations'
    || string(termination.appealSurvival) !== 'survives_until_resolved'
    || !Number.isSafeInteger(Number(operatorPolicy.maximumDurationSeconds))
    || Number(operatorPolicy.maximumDurationSeconds) < 5 * 60
    || Number(operatorPolicy.maximumDurationSeconds) > 24 * 60 * 60
    || !Number.isSafeInteger(Number(frequencyPolicy.windowSeconds))
    || Number(frequencyPolicy.windowSeconds) < 60
    || Number(frequencyPolicy.windowSeconds) > 60 * 60
    || !Number.isSafeInteger(Number(frequencyPolicy.maximumInvocations))
    || Number(frequencyPolicy.maximumInvocations) < 1
    || Number(frequencyPolicy.maximumInvocations) > 100
    || !Number.isSafeInteger(Number(appealPolicyLimit.maximumWindowSeconds))
    || Number(appealPolicyLimit.maximumWindowSeconds) < 60 * 60
    || Number(appealPolicyLimit.maximumWindowSeconds) > 7 * 24 * 60 * 60
    || string(operatorPolicy.targetScope) !== 'target_circle_exact_subject'
  ) {
    throw new Error('governed_shared_committee_operator_reauthorization_required');
  }
  const frozenOperator = frozenActors.find((actor) =>
    string(actor.pubkey) === input.actorPubkey
    && allowedRoles.includes(string(actor.role))
  );
  if (!frozenOperator) {
    throw new Error('governed_shared_committee_operator_not_eligible');
  }
  const requestedDurationSeconds = Number(input.payload.durationSeconds);
  if (!Number.isSafeInteger(requestedDurationSeconds)
    || requestedDurationSeconds <= 0
    || requestedDurationSeconds > Number(operatorPolicy.maximumDurationSeconds)) {
    throw new Error('governed_shared_committee_operation_duration_exceeds_policy');
  }
  if (input.definition.appealPolicy
    && input.definition.appealPolicy.windowSeconds > Number(appealPolicyLimit.maximumWindowSeconds)) {
    throw new Error('governed_shared_committee_operation_appeal_exceeds_policy');
  }
  const reasonCode = input.reasonCode.trim();
  if (!reasonCode) throw new Error('governed_direct_operation_reason_required');
  if (reasonCode.length > 96) throw new Error('governed_direct_operation_reason_too_long');
  if (Buffer.byteLength(JSON.stringify(input.payload), 'utf8') > 4096) {
    throw new Error('governed_direct_operation_payload_limits_exceeded');
  }

  const home = await resolveVerifiedSharedCommitteeOperationHome(
    dependencies.prisma,
    input.targetCircleId,
    input.definition.actionType,
  );
  const profile = await resolveActiveGovernanceProfileForWork(dependencies.prisma, {
    homeIdentityBindingId: home.id,
    homeType: home.homeType,
    actionType: input.definition.actionType,
    executionAdapter: input.definition.executionAdapter,
  });
  const payloadDigest = hashCanonicalGovernanceValue(PAYLOAD_DOMAIN, input.payload);
  const capabilityWindowSeconds = 300;
  const authorityLimits = {
    ...mandateLimits,
    operatorSelector: 'mandate_frozen_institution_roles',
    operatorSetDigest: currentActorSetDigest,
    payloadDigest,
    capabilityWindowSeconds,
    executionAuthority: {
      type: 'target_adapter',
      ref: input.definition.executionAdapter,
      adapter: input.definition.executionAdapter,
    },
    riskFloor: input.definition.impact,
  };
  const seeded = await ensureGovernedActionRuntimeSeeds(dependencies, {
    definition: input.definition,
    home,
    binding: {
      ...input.binding,
      authoritySourceType: 'shared_committee_operator_capability',
      authoritySourceRef: input.binding.authoritySourceRef ?? input.binding.id,
      authoritySourceVersion: input.binding.authoritySourceVersion
        ?? input.binding.policyVersionId,
      authorityPurpose: 'operational_execution',
      authoritySelector: {
        subjectType: input.targetType,
        subjectRef: input.targetRef,
        actorPubkey: input.actorPubkey,
        operatorSelector: 'mandate_frozen_institution_roles',
        operatorSetDigest: currentActorSetDigest,
        environment: 'local_development',
        network: 'solana:localnet',
      },
      authorityLimits,
    },
    now: input.now,
  });
  const runtimeContext = resolveGovernedActionRuntimeContext({
    binding: {
      authoritySelector: {
        environment: 'local_development',
        network: 'solana:localnet',
      },
    },
  });
  const selected = await resolveCanonicalActionAuthorityBinding(dependencies.prisma, {
    home,
    contractVersionId: seeded.contractVersionId,
    definition: input.definition,
    targetType: input.targetType,
    targetRef: input.targetRef,
    purpose: 'operational_execution',
    actorPubkey: input.actorPubkey,
    payloadDigest,
    environment: runtimeContext.environment,
    network: runtimeContext.network,
    now: input.now,
  });
  if (selected.id !== seeded.authorityBindingId) {
    throw new Error('governed_shared_committee_operator_runtime_required');
  }
  const selectedLimits = record(selected.limits);
  if (
    string(selectedLimits.operatorSelector) !== 'mandate_frozen_institution_roles'
    || string(selectedLimits.operatorSetDigest) !== currentActorSetDigest
    || string(selectedLimits.payloadDigest) !== payloadDigest
    || Number(selectedLimits.capabilityWindowSeconds) !== capabilityWindowSeconds
    || string(selectedLimits.domainBindingId) !== input.binding.id
    || !isDeepStrictEqual(record(selectedLimits.operatorPolicy), operatorPolicy)
  ) {
    throw new Error('governed_shared_committee_capability_mismatch');
  }
  const reasonDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.action-reason',
    { reasonCode },
  );
  const limitsDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.action-authority-limits',
    selectedLimits,
  );
  const authority = authorityResolutionFromBinding(selected);
  const riskFloor = resolvedRiskFloor(selected);
  const capabilityValidUntil = new Date(
    input.now.getTime() + capabilityWindowSeconds * 1000,
  );
  const policyVersionRef = input.binding.policyVersionId;
  const preflightDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.shared-committee-operation-preflight',
    {
      homeIdentityBindingId: home.id,
      contractVersionId: seeded.contractVersionId,
      profileBindingId: profile.profileBindingId,
      profileVersionRef: profile.profileVersionRef,
      profileDefinitionDigest: profile.profileDefinitionDigest,
      authorityBindingId: selected.id,
      domainBindingId: input.binding.id,
      committeeCircleId: input.binding.committeeCircleId,
      actorPubkey: input.actorPubkey,
      targetType: input.targetType,
      targetRef: input.targetRef,
      payloadDigest,
      reasonDigest,
      limitsDigest,
      policyVersionRef,
      capabilityValidUntil: capabilityValidUntil.toISOString(),
      environment: runtimeContext.environment,
      network: runtimeContext.network,
    },
  );
  return {
    homeIdentityBindingId: home.id,
    governanceHomeType: home.homeType,
    governanceHomeRef: home.homeRef,
    homeActivationState: 'active',
    contractVersionId: seeded.contractVersionId,
    contractDefinitionDigest: seeded.contractDefinitionDigest,
    idempotencyScope: seeded.idempotencyScope,
    idempotencyWindowSeconds: seeded.idempotencyWindowSeconds,
    appealPolicy: seeded.appealPolicy,
    profileBindingId: profile.profileBindingId,
    profileBindingState: 'active',
    profilePinMode: 'active',
    profileVersionRef: profile.profileVersionRef,
    profileDefinitionDigest: profile.profileDefinitionDigest,
    authorityBindingId: selected.id,
    authority,
    policyVersionRef,
    authorityLimits: selectedLimits,
    limitsDigest,
    payloadDigest,
    reasonDigest,
    preflightDigest,
    riskFloor,
    capabilityValidUntil,
  };
}

export async function resolveGovernedSystemRoleOperationRuntime(
  dependencies: { prisma: RuntimePrisma; transactionClient?: boolean },
  input: {
    definition: GovernedActionDefinition;
    home: { id: string; homeType: string; homeRef: string };
    binding: GovernedActionGatewayRuntimeBinding;
    actorPubkey: string;
    targetType: string;
    targetRef: string;
    payload: Record<string, unknown>;
    reasonCode: string;
    expectedRoleKey: string;
    now: Date;
  },
): Promise<GovernedDirectOperationRuntimeResolution> {
  if (
    input.definition.targetType !== input.targetType
    || input.definition.impact !== 'high'
    || input.definition.governanceMode !== 'always_required'
    || input.definition.fallbackAuthority !== 'none'
    || input.definition.executionDomain !== 'off_chain'
    || !input.definition.receiptRequired
  ) {
    throw new Error('governed_system_role_operation_contract_not_eligible');
  }
  const selector = record(input.binding.authoritySelector);
  if (
    input.home.homeType !== 'platform_safety_system_role'
    || input.home.homeRef !== 'platform_safety:sandbox'
    || input.binding.authoritySourceType !== 'system_governance_role_binding'
    || input.binding.authorityPurpose !== 'operational_execution'
    || string(selector.actorPubkey) !== input.actorPubkey
    || string(selector.roleKey) !== input.expectedRoleKey
    || string(selector.subjectType) !== input.targetType
    || string(selector.subjectRef) !== input.targetRef
  ) {
    throw new Error('governed_system_role_operation_binding_mismatch');
  }
  const reasonCode = input.reasonCode.trim();
  if (!reasonCode) throw new Error('governed_direct_operation_reason_required');
  if (reasonCode.length > 96) throw new Error('governed_direct_operation_reason_too_long');
  if (Buffer.byteLength(JSON.stringify(input.payload), 'utf8') > 4096) {
    throw new Error('governed_direct_operation_payload_limits_exceeded');
  }

  const profile = await resolveActiveGovernanceProfileForWork(dependencies.prisma, {
    homeIdentityBindingId: input.home.id,
    homeType: input.home.homeType,
    actionType: input.definition.actionType,
    executionAdapter: input.definition.executionAdapter,
  });
  const runtimeContext = resolveGovernedActionRuntimeContext({
    binding: { authoritySelector: input.binding.authoritySelector ?? {} },
  });
  const seeded = await ensureGovernedActionRuntimeSeeds(dependencies, {
    definition: input.definition,
    home: input.home,
    binding: input.binding,
    now: input.now,
  });
  const payloadDigest = hashCanonicalGovernanceValue(PAYLOAD_DOMAIN, input.payload);
  const selected = await resolveCanonicalActionAuthorityBinding(dependencies.prisma, {
    home: input.home,
    contractVersionId: seeded.contractVersionId,
    definition: input.definition,
    targetType: input.targetType,
    targetRef: input.targetRef,
    purpose: 'operational_execution',
    actorPubkey: input.actorPubkey,
    payloadDigest,
    environment: runtimeContext.environment,
    network: runtimeContext.network,
    now: input.now,
  });
  if (
    selected.id !== seeded.authorityBindingId
    || selected.sourceType !== 'system_governance_role_binding'
    || selected.sourceRef !== input.binding.id
  ) {
    throw new Error('governed_system_role_operation_runtime_required');
  }
  const selectedSelector = record(selected.selector);
  const selectedLimits = record(selected.limits);
  if (
    string(selectedSelector.actorPubkey) !== input.actorPubkey
    || string(selectedSelector.roleKey) !== input.expectedRoleKey
    || string(selectedLimits.domainBindingId) !== input.binding.id
    || !isDeepStrictEqual(
      record(selectedLimits.platformSafetyPolicy),
      record(input.binding.authorityLimits?.platformSafetyPolicy),
    )
  ) {
    throw new Error('governed_system_role_operation_capability_mismatch');
  }
  const reasonDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.action-reason',
    { reasonCode },
  );
  const limitsDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.action-authority-limits',
    selectedLimits,
  );
  const capabilityValidUntil = new Date(input.now.getTime() + 5 * 60 * 1000);
  const preflightDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.system-role-operation-preflight',
    {
      homeIdentityBindingId: input.home.id,
      contractVersionId: seeded.contractVersionId,
      profileBindingId: profile.profileBindingId,
      profileVersionRef: profile.profileVersionRef,
      profileDefinitionDigest: profile.profileDefinitionDigest,
      authorityBindingId: selected.id,
      systemRoleBindingId: input.binding.id,
      actorPubkey: input.actorPubkey,
      roleKey: input.expectedRoleKey,
      targetType: input.targetType,
      targetRef: input.targetRef,
      payloadDigest,
      reasonDigest,
      limitsDigest,
      policyVersionRef: input.binding.policyVersionId,
      capabilityValidUntil: capabilityValidUntil.toISOString(),
      environment: runtimeContext.environment,
      network: runtimeContext.network,
    },
  );
  return {
    homeIdentityBindingId: input.home.id,
    governanceHomeType: input.home.homeType,
    governanceHomeRef: input.home.homeRef,
    homeActivationState: 'active',
    contractVersionId: seeded.contractVersionId,
    contractDefinitionDigest: seeded.contractDefinitionDigest,
    idempotencyScope: seeded.idempotencyScope,
    idempotencyWindowSeconds: seeded.idempotencyWindowSeconds,
    appealPolicy: seeded.appealPolicy,
    profileBindingId: profile.profileBindingId,
    profileBindingState: 'active',
    profilePinMode: 'active',
    profileVersionRef: profile.profileVersionRef,
    profileDefinitionDigest: profile.profileDefinitionDigest,
    authorityBindingId: selected.id,
    authority: authorityResolutionFromBinding(selected),
    policyVersionRef: input.binding.policyVersionId,
    authorityLimits: selectedLimits,
    limitsDigest,
    payloadDigest,
    reasonDigest,
    preflightDigest,
    riskFloor: resolvedRiskFloor(selected),
    capabilityValidUntil,
  };
}

export async function ensureGovernedActionRuntimeSeeds(
  dependencies: { prisma: RuntimePrisma; transactionClient?: boolean },
  input: {
    definition: GovernedActionDefinition;
    home: { homeType: string; homeRef: string };
    binding: GovernedActionGatewayRuntimeBinding;
    now: Date;
  },
): Promise<GovernedActionRuntimeSeedResolution> {
  const contractSeed = createGovernedActionContractVersionSeed(input.definition, input.now);
  const exactBindingRequired =
    input.definition.bindingRequirement === 'exact_action_subject_purpose';
  const authoritySeed = exactBindingRequired
    ? buildExactAuthoritySeedFromProjectedBinding({
      home: input.home,
      binding: input.binding,
      definition: input.definition,
      contractVersionId: contractSeed.id,
      now: input.now,
    })
    : createAuthorityBindingSeed({
      home: input.home,
      binding: input.binding,
      actionType: input.definition.actionType,
      executionAdapter: input.definition.executionAdapter,
      contractVersionId: contractSeed.id,
      riskFloor: input.definition.impact,
      now: input.now,
    });
  await ensureRuntimeSeeds(
    dependencies.prisma,
    contractSeed,
    authoritySeed,
    dependencies.transactionClient === true,
    { exactBindingRequired },
  );
  return {
    contractVersionId: contractSeed.id,
    contractDefinitionDigest: contractSeed.definitionDigest,
    idempotencyScope: contractSeed.idempotencyScope,
    idempotencyWindowSeconds: contractSeed.idempotencyWindowSeconds,
    appealPolicy: input.definition.appealPolicy ?? null,
    authorityBindingId: authoritySeed.id,
    authority: {
      sourceType: authoritySeed.sourceType,
      sourceRef: authoritySeed.sourceRef,
      sourceVersion: authoritySeed.sourceVersion,
      selectorDigest: authoritySeed.bindingDigest,
      capabilityDigest: hashCanonicalGovernanceValue(AUTHORITY_BINDING_DOMAIN, authoritySeed.limits),
    },
  };
}

export async function ensureGovernedActionContractVersion(
  prisma: Pick<RuntimeClient, 'governedActionContractVersion'>,
  input: { definition: GovernedActionDefinition; now: Date },
): Promise<{ id: string; definitionDigest: string }> {
  const seed = createGovernedActionContractVersionSeed(input.definition, input.now);
  await ensureExactContract(prisma as RuntimeClient, seed);
  return { id: seed.id, definitionDigest: seed.definitionDigest };
}

export async function resolvePersistedGovernedActionContractVersion(
  prisma: Pick<RuntimeClient, 'governedActionContractVersion'>,
  input: { definition: GovernedActionDefinition; now: Date },
): Promise<{
  contractVersionId: string;
  contractDefinitionDigest: string;
  idempotencyScope: string;
  idempotencyWindowSeconds: number | null;
  appealPolicy: GovernedActionDefinition['appealPolicy'];
}> {
  const desired = createGovernedActionContractVersionSeed(input.definition, input.now);
  const existing = await prisma.governedActionContractVersion.findUnique({
    where: {
      actionType_version: {
        actionType: desired.actionType,
        version: desired.version,
      },
    },
  });
  if (!existing) {
    throw new Error('governed_action_contract_runtime_required');
  }
  if (!sameIgnoringTimestamps(existing, desired, ['createdAt', 'effectiveFrom'])) {
    throw new Error('governed_action_contract_immutable_mismatch');
  }
  return {
    contractVersionId: desired.id,
    contractDefinitionDigest: desired.definitionDigest,
    idempotencyScope: desired.idempotencyScope,
    idempotencyWindowSeconds: desired.idempotencyWindowSeconds,
    appealPolicy: input.definition.appealPolicy ?? null,
  };
}

export async function resolveFrozenGovernedActionContractVersion(
  prisma: Pick<RuntimeClient, 'governedActionContractVersion'>,
  input: {
    selected: GovernanceCaseTemplateSelection['actionContract'];
    authority: GovernanceCaseTemplateSelection['actionAuthority'];
  },
): Promise<{
  contractVersionId: string;
  contractDefinitionDigest: string;
  idempotencyScope: string;
  idempotencyWindowSeconds: number | null;
  appealPolicy: GovernedActionDefinition['appealPolicy'];
  definition: GovernedActionDefinition;
}> {
  const contractVersionId = String(input.selected?.contractVersionId ?? '').trim();
  if (!contractVersionId) {
    throw new Error('governed_action_contract_runtime_required');
  }
  const existing = await prisma.governedActionContractVersion.findUnique({
    where: { id: contractVersionId },
  });
  if (!existing) {
    throw new Error('governed_action_contract_runtime_required');
  }
  const frozenDefinition = record(existing.definition);
  if (
    !frozenDefinition
    || hashCanonicalGovernanceValue(CONTRACT_DOMAIN, frozenDefinition) !== existing.definitionDigest
    || input.selected?.actionType !== existing.actionType
    || input.selected?.definitionDigest !== existing.definitionDigest
  ) {
    throw new Error('governance_case_action_contract_snapshot_mismatch');
  }
  const resolved = resolveGovernanceCaseActionDefinitionForDecision(
    existing,
    input.selected,
    input.authority,
  );
  if (
    !resolved
    || resolved.actionType !== input.selected?.actionType
  ) {
    throw new Error('governance_case_action_contract_snapshot_mismatch');
  }
  return {
    contractVersionId: existing.id,
    contractDefinitionDigest: existing.definitionDigest,
    idempotencyScope: existing.idempotencyScope,
    idempotencyWindowSeconds: existing.idempotencyWindowSeconds,
    appealPolicy: resolved.appealPolicy ?? null,
    definition: resolved,
  };
}

export async function resolveCanonicalActionAuthorityBinding(
  prisma: Pick<RuntimeClient, 'actionAuthorityPolicyBinding'>,
  input: {
    home: { homeType: string; homeRef: string };
    contractVersionId: string;
    definition: GovernedActionDefinition;
    targetType: string;
    targetRef: string;
    purpose: string;
    actorPubkey?: string;
    payloadDigest?: string;
    environment: string;
    network: string;
    now: Date;
  },
): Promise<any> {
  const candidates = await prisma.actionAuthorityPolicyBinding.findMany({
    where: {
      governanceHomeType: input.home.homeType,
      governanceHomeRef: input.home.homeRef,
      contractVersionId: input.contractVersionId,
      purpose: input.purpose,
      status: 'active',
      supersededAt: null,
      effectiveFrom: { lte: input.now },
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: input.now } }],
    },
  });
  const matches = candidates.flatMap((candidate) => {
    if (
      candidate.governanceHomeType !== input.home.homeType
      || candidate.governanceHomeRef !== input.home.homeRef
      || candidate.contractVersionId !== input.contractVersionId
      || candidate.purpose !== input.purpose
      || candidate.status !== 'active'
      || candidate.supersededAt != null
      || new Date(candidate.effectiveFrom).getTime() > input.now.getTime()
      || (candidate.effectiveUntil
        && new Date(candidate.effectiveUntil).getTime() <= input.now.getTime())
    ) return [];
    const separationError = governedActionAuthoritySeparationError(candidate, input.definition);
    if (separationError) throw new Error(separationError);
    const selector = record(candidate.selector);
    const actionType = string(selector.actionType);
    const actionPrefix = string(selector.actionPrefix);
    const subjectType = string(selector.subjectType);
    const subjectRef = string(selector.subjectRef);
    const subjectPrefix = string(selector.subjectPrefix);
    const selectorActorPubkey = string(selector.actorPubkey);
    const exactRequired =
      input.definition.bindingRequirement === 'exact_action_subject_purpose';
    const actionMatches = exactRequired
      ? !!actionType
        && actionType === input.definition.actionType
        && !actionPrefix
      : (actionType
        ? actionType === input.definition.actionType
        : !!actionPrefix && input.definition.actionType.startsWith(actionPrefix));
    if (string(selector.environment) !== input.environment
      || string(selector.network) !== input.network
      || (selectorActorPubkey && selectorActorPubkey !== input.actorPubkey)
      || !actionMatches
      || (subjectType && subjectType !== input.targetType)
      || (subjectRef ? subjectRef !== input.targetRef
        : subjectPrefix ? !input.targetRef.startsWith(subjectPrefix) : false)) {
      return [];
    }
    const limits = record(candidate.limits);
    const boundPayloadDigest = string(limits.payloadDigest);
    if (boundPayloadDigest && boundPayloadDigest !== input.payloadDigest) return [];
    const riskFloor = string(limits.riskFloor);
    const risk = riskRank(riskFloor);
    if (risk < riskRank(input.definition.impact)) {
      throw new Error('governed_action_authority_risk_downgrade_forbidden');
    }
    const specificity = (actionType ? 32 : 16)
      + (subjectRef ? 16 : subjectPrefix ? 8 : subjectType ? 4 : 0)
      + (selector.targetCircleId === undefined ? 0 : 2)
      + 4;
    return [{ candidate, risk, specificity }];
  });
  if (matches.length === 0) throw new Error('governed_action_authority_binding_required');
  matches.sort((left, right) => right.risk - left.risk || right.specificity - left.specificity);
  const top = matches[0];
  const tied = matches.filter((item) =>
    item.risk === top.risk && item.specificity === top.specificity);
  if (tied.length !== 1) {
    throw new Error('governed_action_authority_binding_conflict');
  }
  return top.candidate;
}

export function authorityResolutionFromBinding(binding: any) {
  return {
    sourceType: String(binding.sourceType),
    sourceRef: String(binding.sourceRef),
    sourceVersion: binding.sourceVersion == null ? null : String(binding.sourceVersion),
    selectorDigest: String(binding.bindingDigest),
    capabilityDigest: hashCanonicalGovernanceValue(AUTHORITY_BINDING_DOMAIN, record(binding.limits)),
  };
}

function requestPolicyFromAuthorityBinding(binding: any) {
  const limits = record(binding.limits);
  const policyVersion = Number(limits.policyVersion);
  const committeeCircleId = Number(limits.committeeCircleId);
  const result = {
    bindingId: String(binding.id),
    domainBindingId: string(limits.domainBindingId),
    policyId: string(limits.policyId),
    policyVersionId: string(limits.policyVersionId),
    policyVersion,
    ruleId: string(limits.ruleId),
    committeeCircleId,
  };
  if (!result.domainBindingId || !result.policyId || !result.policyVersionId || !result.ruleId
    || !Number.isInteger(policyVersion) || policyVersion <= 0
    || !Number.isInteger(committeeCircleId) || committeeCircleId < 0) {
    throw new Error('governed_action_authority_policy_facts_invalid');
  }
  return result;
}

function resolvedRiskFloor(binding: any): GovernedActionDefinition['impact'] {
  const value = string(record(binding.limits).riskFloor);
  if (!['low', 'medium', 'high', 'critical'].includes(value)) {
    throw new Error('governed_action_authority_risk_floor_invalid');
  }
  return value as GovernedActionDefinition['impact'];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function string(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function riskRank(value: unknown): number {
  const ranks: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
  return ranks[string(value)] ?? 0;
}

function stricterRiskFloor(
  requested: unknown,
  actionRisk: GovernedActionDefinition['impact'],
): GovernedActionDefinition['impact'] {
  if (requested == null) return actionRisk;
  const normalized = string(requested);
  if (!['low', 'medium', 'high', 'critical'].includes(normalized)) {
    throw new Error('governed_action_authority_risk_floor_invalid');
  }
  return riskRank(normalized) >= riskRank(actionRisk)
    ? normalized as GovernedActionDefinition['impact']
    : actionRisk;
}

async function resolveVerifiedLegacyCircleHome(
  prisma: RuntimePrisma,
  targetCircleId: number,
): Promise<{ home: any; compatibility: any }> {
  const home = await resolveVerifiedCircleHome(prisma, targetCircleId, ['legacy_unmigrated']);
  const compatibility = await prisma.governanceCompatibilityBundle.findFirst({
    where: { homeIdentityBindingId: home.id, circleId: targetCircleId },
    orderBy: { version: 'desc' },
  });
  if (!compatibility) throw new Error('governed_action_compatibility_bundle_required');
  if (
    compatibility.homeIdentityBindingId !== home.id
    || compatibility.circleId !== targetCircleId
    || compatibility.network !== 'solana:localnet'
    || !Number.isInteger(compatibility.version)
    || !/^[a-f0-9]{64}$/.test(compatibility.bundleDigest)
  ) {
    throw new Error('governed_action_compatibility_bundle_mismatch');
  }
  verifyStoredCompatibilityBundle(compatibility, home.id, targetCircleId);
  return { home, compatibility };
}

async function resolveVerifiedDirectOperationHome(
  prisma: RuntimePrisma,
  targetCircleId: number,
): Promise<any> {
  const home = await resolveVerifiedCircleHome(
    prisma,
    targetCircleId,
    ['legacy_unmigrated', 'bootstrap_pending', 'active'],
  );
  if (home.activationState.state === 'legacy_unmigrated') {
    return (await resolveVerifiedLegacyCircleHome(prisma, targetCircleId)).home;
  }
  return home;
}

async function resolveVerifiedSharedCommitteeOperationHome(
  prisma: RuntimePrisma,
  targetCircleId: number,
  actionType: string,
): Promise<any> {
  const home = await resolveVerifiedCircleHome(
    prisma,
    targetCircleId,
    ['communication.member.mute', 'communication.message.hide'].includes(actionType)
      ? ['legacy_unmigrated', 'active']
      : ['legacy_unmigrated'],
  );
  if (home.activationState.state === 'legacy_unmigrated') {
    return (await resolveVerifiedLegacyCircleHome(prisma, targetCircleId)).home;
  }
  return home;
}

async function resolveVerifiedCircleHome(
  prisma: RuntimePrisma,
  targetCircleId: number,
  allowedActivationStates: string[],
): Promise<any> {
  const homes = await prisma.governanceHomeIdentityBinding.findMany({
    where: {
      homeType: 'circle',
      homeRef: String(targetCircleId),
      supersededAt: null,
    },
    include: { activationState: true },
    orderBy: { identityVersion: 'desc' },
    take: 2,
  });
  if (homes.length === 0) throw new Error('governed_action_canonical_home_required');
  if (homes.length !== 1) throw new Error('governed_action_canonical_home_ambiguous');
  const home = homes[0];
  if (
    home.homeType !== 'circle'
    || home.homeRef !== String(targetCircleId)
    || home.supersededAt != null
    || !home.activationState
  ) {
    throw new Error('governed_action_canonical_home_mismatch');
  }
  if (!allowedActivationStates.includes(String(home.activationState.state))) {
    throw new Error('governed_action_stage_mode_runtime_required');
  }
  return home;
}

function verifyStoredCompatibilityBundle(
  compatibility: any,
  homeIdentityBindingId: string,
  circleId: number,
): void {
  const stored = compatibility.bundle;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    throw new Error('governed_action_compatibility_bundle_invalid');
  }
  const {
    schemaVersion,
    canonicalCodecVersion,
    ...rawInput
  } = stored as Record<string, unknown>;
  if (schemaVersion !== 1 || canonicalCodecVersion !== 1) {
    throw new Error('governed_action_compatibility_bundle_invalid');
  }
  let verified;
  try {
    verified = createGovernanceLegacyCompatibilityBundle(
      rawInput as unknown as GovernanceLegacyCompatibilityBundleInput,
    );
  } catch {
    throw new Error('governed_action_compatibility_bundle_invalid');
  }
  if (
    verified.digest !== compatibility.bundleDigest
    || verified.bundle.homeIdentity.ref !== homeIdentityBindingId
    || verified.bundle.circleProjection.circleId !== circleId
    || verified.bundle.chainReadback.circleId !== circleId
  ) {
    throw new Error('governed_action_compatibility_bundle_mismatch');
  }
  if (verified.bundle.blockers.length > 0) {
    throw new Error('governed_action_compatibility_bundle_blocked');
  }
}

async function ensureRuntimeSeeds(
  prisma: RuntimePrisma,
  contract: any,
  authority: any,
  transactionClient: boolean,
  options?: { exactBindingRequired?: boolean },
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const persist = async (tx: RuntimeClient) => {
        await ensureExactContract(tx, contract);
        await ensureExactAuthorityBinding(tx, authority, {
          conflictMode: options?.exactBindingRequired ? 'fail_closed' : 'auto_supersede',
          createIfMissing: options?.exactBindingRequired ? false : true,
        });
      };
      if (transactionClient) await persist(prisma);
      else await prisma.$transaction(persist);
      return;
    } catch (error) {
      if (!isUniqueConstraintError(error) || attempt === 2) throw error;
    }
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return !!(error && typeof error === 'object' && 'code' in error
    && String((error as { code?: unknown }).code) === 'P2002');
}

export function createGovernedActionContractVersionSeed(
  definition: GovernedActionDefinition,
  now: Date,
) {
  const idempotencyScope = definition.idempotencyScope
    ?? GOVERNED_ACTION_IDEMPOTENCY_SCOPE;
  const idempotencyWindowSeconds = definition.idempotencyWindowSeconds ?? null;
  if (
    idempotencyWindowSeconds !== null
    && (!Number.isSafeInteger(idempotencyWindowSeconds) || idempotencyWindowSeconds <= 0)
  ) {
    throw new Error('governed_action_idempotency_window_invalid');
  }
  const appealPolicy = definition.appealPolicy ?? null;
  if (appealPolicy && (
    !Number.isSafeInteger(appealPolicy.windowSeconds)
    || appealPolicy.windowSeconds <= 0
    || appealPolicy.conflictRule !== 'original_executor_and_appellant_excluded'
    || appealPolicy.resolutionPath !== 'independent_review_or_case'
  )) {
    throw new Error('governed_action_appeal_policy_invalid');
  }
  const reviewTimingPolicy = definition.actionType === 'communication.member.mute'
    ? 'policy_selected_pre_or_post_execution'
    : definition.impact === 'critical'
      ? 'pre_execution'
      : 'policy_defined';
  const frozen = {
    actionType: definition.actionType,
    subjectType: definition.targetType,
    payloadSchemaVersion: 'governed-action-payload-v1',
    impact: definition.impact,
    fallbackAuthority: definition.fallbackAuthority,
    governanceMode: definition.governanceMode,
    executionAdapter: definition.executionAdapter,
    executionDomain: definition.executionDomain,
    receiptRequired: definition.receiptRequired,
    idempotencyScope,
    idempotencyWindowSeconds,
    recurrenceRule: 'new_facts_or_idempotency_window_v1',
    appealPolicy,
    ...(definition.bindingRequirement
      ? { bindingRequirement: definition.bindingRequirement }
      : {}),
    ...(definition.actionType === 'communication.member.mute'
      ? { reviewTimingPolicy }
      : {}),
  };
  const definitionDigest = hashCanonicalGovernanceValue(CONTRACT_DOMAIN, frozen);
  // Internal contract schema version only. Exact-binding semantics alter the
  // canonical authorization contract and must never alias an older v3 row.
  const version = definition.bindingRequirement === 'exact_action_subject_purpose'
    ? 4
    : definition.actionType === 'communication.member.mute'
      ? 5
      : 3;
  return {
    id: `governed-contract:${definitionDigest.slice(0, 56)}`,
    actionType: definition.actionType,
    version,
    subjectType: definition.targetType,
    payloadSchemaVersion: 'governed-action-payload-v1',
    definition: frozen,
    definitionDigest,
    canonicalCodecVersion: 'governance-canonical-codec-v1',
    executionAdapter: definition.executionAdapter,
    executionDomain: definition.executionDomain,
    riskFloor: definition.impact,
    reviewTiming: reviewTimingPolicy,
    idempotencyScope,
    idempotencyWindowSeconds,
    effectiveFrom: now,
    supersededAt: null,
  };
}

function buildExactAuthoritySeedFromProjectedBinding(input: {
  home: { homeType: string; homeRef: string };
  binding: GovernedActionGatewayRuntimeBinding;
  definition: GovernedActionDefinition;
  contractVersionId: string;
  now: Date;
}) {
  // Lazy require avoids circular init with exactActionAuthorityMaterialization.
  const {
    buildExactAuthorityBindingFromProjectedGatewayBinding,
  } = require('./exactActionAuthorityMaterialization') as typeof import('./exactActionAuthorityMaterialization');
  return buildExactAuthorityBindingFromProjectedGatewayBinding(input);
}

function requireExactAuthorityOverlap() {
  return require('./exactActionAuthorityMaterialization') as typeof import('./exactActionAuthorityMaterialization');
}

function createAuthorityBindingSeed(input: {
  home: any;
  binding: GovernedActionGatewayRuntimeBinding;
  actionType: string;
  executionAdapter: string;
  contractVersionId: string;
  riskFloor: GovernedActionDefinition['impact'];
  now: Date;
}) {
  const requestedSourceVersion = input.binding.authoritySourceVersion
    ?? `${input.binding.policyVersionId}:${input.binding.ruleId}`;
  const runtimeContext = resolveGovernedActionRuntimeContext({
    binding: { authoritySelector: input.binding.authoritySelector ?? {} },
  });
  const selector = {
    ...(input.binding.authoritySelector ?? {}),
    actionType: input.actionType,
    environment: runtimeContext.environment,
    network: runtimeContext.network,
    ...(input.home.homeType === 'circle' ? {
      targetCircleId: Number(input.home.homeRef),
    } : {}),
  };
  const limits = {
    ...(input.binding.authorityLimits ?? {}),
    executionAuthority: input.binding.authorityLimits?.executionAuthority ?? {
      type: 'registered_adapter',
      ref: input.executionAdapter,
    },
    policyId: input.binding.policyId,
    policyVersionId: input.binding.policyVersionId,
    policyVersion: input.binding.policyVersion,
    ruleId: input.binding.ruleId,
    committeeCircleId: input.binding.committeeCircleId,
    domainBindingId: input.binding.id,
    riskFloor: stricterRiskFloor(
      input.binding.authorityLimits?.riskFloor,
      input.riskFloor,
    ),
  };
  const facts = {
    governanceHomeType: input.home.homeType,
    governanceHomeRef: input.home.homeRef,
    contractVersionId: input.contractVersionId,
    sourceType: input.binding.authoritySourceType ?? 'circle_governance_binding',
    sourceRef: input.binding.authoritySourceRef ?? input.binding.id,
    sourceVersion: boundedAuthoritySourceVersion(requestedSourceVersion),
    purpose: input.binding.authorityPurpose ?? 'collective_decision',
    selector,
    limits,
  };
  const separationError = governedActionAuthoritySeparationError(facts, {
    executionAdapter: input.executionAdapter,
  });
  if (separationError) throw new Error(separationError);
  const bindingDigest = hashCanonicalGovernanceValue(AUTHORITY_BINDING_DOMAIN, facts);
  return {
    id: `action-authority:${bindingDigest.slice(0, 56)}`,
    ...facts,
    effectiveFrom: input.binding.authorityEffectiveFrom ?? input.now,
    effectiveUntil: input.binding.authorityEffectiveUntil ?? null,
    status: 'active',
    bindingDigest,
    supersededAt: null,
  };
}

export function governedActionAuthoritySeparationError(
  binding: any,
  definition: Pick<GovernedActionDefinition, 'executionAdapter'>,
): string | null {
  const sourceType = string(binding?.sourceType).toLowerCase();
  if (
    !sourceType
    || sourceType === 'profile_role_direct'
    || sourceType.includes('assignment')
    || sourceType.includes('electorate')
    || sourceType.includes('payer')
  ) {
    return 'governed_action_authority_derivation_forbidden';
  }
  if (containsAuthorityDerivationKey(binding?.selector)
    || containsAuthorityDerivationKey(binding?.limits)) {
    return 'governed_action_authority_derivation_forbidden';
  }
  const selector = record(binding?.selector);
  const executionAuthority = record(record(binding?.limits).executionAuthority);
  if (string(binding?.purpose) === 'operational_execution') {
    const sourceType = string(binding?.sourceType);
    const directActorCapability = sourceType === 'wallet_capability_direct'
      && string(executionAuthority.type) === 'verified_actor_capability'
      && string(executionAuthority.ref) === string(selector.actorPubkey);
    const delegatedTargetAdapter = sourceType === 'shared_committee_operator_capability'
      && string(executionAuthority.type) === 'target_adapter'
      && string(executionAuthority.ref) === definition.executionAdapter;
    const systemRoleRegisteredAdapter = sourceType === 'system_governance_role_binding'
      && !!string(selector.actorPubkey)
      && string(executionAuthority.type) === 'registered_adapter'
      && string(executionAuthority.ref) === definition.executionAdapter;
    if (!directActorCapability && !delegatedTargetAdapter && !systemRoleRegisteredAdapter) {
      return 'governed_action_execution_authority_separation_required';
    }
  } else if (
    string(executionAuthority.type) !== 'registered_adapter'
    || string(executionAuthority.ref) !== definition.executionAdapter
  ) {
    return 'governed_action_execution_authority_separation_required';
  }
  return null;
}

const FORBIDDEN_AUTHORITY_DERIVATION_KEYS = new Set([
  'role',
  'roles',
  'memberrole',
  'assignment',
  'assignedto',
  'assignee',
  'taskowner',
  'eligibleactors',
  'eligiblevoter',
  'voterpubkey',
  'payerref',
  'payerpubkey',
  'feepayersignerref',
  'economicbearer',
  'relayerref',
]);

function containsAuthorityDerivationKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsAuthorityDerivationKey);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(([key, nested]) => (
    FORBIDDEN_AUTHORITY_DERIVATION_KEYS.has(key.replace(/[^a-z0-9]/gi, '').toLowerCase())
    || containsAuthorityDerivationKey(nested)
  ));
}

export function boundedAuthoritySourceVersion(value: string | null): string | null {
  if (value === null || value.length <= 64) return value;
  return `authority-source-v1:${hashCanonicalGovernanceValue(
    'alcheme.governance.authority-source-version',
    value,
  ).slice(0, 44)}`;
}

async function ensureExactContract(client: RuntimeClient, desired: any): Promise<void> {
  const existing = await client.governedActionContractVersion.findUnique({
    where: { actionType_version: { actionType: desired.actionType, version: desired.version } },
  });
  if (!existing) {
    await client.governedActionContractVersion.create({ data: desired });
    return;
  }
  if (!sameIgnoringTimestamps(existing, desired, ['createdAt', 'effectiveFrom'])) {
    throw new Error('governed_action_contract_immutable_mismatch');
  }
}

async function ensureExactAuthorityBinding(
  client: RuntimeClient,
  desired: any,
  options?: {
    conflictMode?: 'auto_supersede' | 'fail_closed';
    createIfMissing?: boolean;
  },
): Promise<void> {
  const conflictMode = options?.conflictMode ?? 'auto_supersede';
  const createIfMissing = options?.createIfMissing ?? true;
  if (conflictMode === 'auto_supersede' && client.actionAuthorityPolicyBinding.updateMany) {
    await client.actionAuthorityPolicyBinding.updateMany({
      where: {
        governanceHomeType: desired.governanceHomeType,
        governanceHomeRef: desired.governanceHomeRef,
        contractVersionId: desired.contractVersionId,
        purpose: desired.purpose,
        sourceType: desired.sourceType,
        sourceRef: desired.sourceRef,
        status: 'active',
        supersededAt: null,
        id: { not: desired.id },
      },
      data: {
        status: 'superseded',
        supersededAt: desired.effectiveFrom,
      },
    });
  } else if (conflictMode === 'fail_closed' && client.actionAuthorityPolicyBinding.findMany) {
    const peers = await client.actionAuthorityPolicyBinding.findMany({
      where: {
        governanceHomeType: desired.governanceHomeType,
        governanceHomeRef: desired.governanceHomeRef,
        contractVersionId: desired.contractVersionId,
        purpose: desired.purpose,
        status: 'active',
        supersededAt: null,
        id: { not: desired.id },
      },
    });
    const { overlapsExactAuthorityScope } = requireExactAuthorityOverlap();
    const conflicts = peers.filter((peer: any) => overlapsExactAuthorityScope(peer, desired));
    if (conflicts.length > 0) {
      throw new Error('governed_action_authority_binding_conflict');
    }
  }
  const existing = await client.actionAuthorityPolicyBinding.findUnique({ where: { id: desired.id } });
  if (!existing) {
    if (!createIfMissing) {
      throw new Error('governed_action_authority_binding_required');
    }
    await client.actionAuthorityPolicyBinding.create({ data: desired });
    return;
  }
  if (!sameIgnoringTimestamps(existing, desired, ['createdAt', 'effectiveFrom'])) {
    throw new Error('governed_action_authority_binding_immutable_mismatch');
  }
}

function sameIgnoringTimestamps(left: any, right: any, ignored: string[]): boolean {
  const clean = (value: any) => Object.fromEntries(
    Object.entries(value).filter(([key]) => !ignored.includes(key)),
  );
  return isDeepStrictEqual(clean(left), clean(right));
}
