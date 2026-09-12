import { hashCanonicalGovernanceValue } from './canonicalCodec';
import type {
  GovernanceProfileDefinition,
  GovernanceProfileDimension,
  GovernanceProfileTransitionOperation,
} from './governanceProfile';
import {
  CIRCLE_GOVERNANCE_PROFILE_V1,
  assertGovernanceProfileDefinitionBoundary,
  assertGovernanceProfileSupportsAction,
  assertGovernanceProfileTransitionPayload,
  createGovernanceProfileDefinition,
  createGovernanceProfileTransition,
  type GovernanceProfileTransitionArtifact,
} from './governanceProfile';

export type GovernanceProfileBindingState = 'draft' | 'active' | 'degraded' | 'retired';
export type GovernanceProfileCompatibilityStatus = 'ready' | 'blocked';

export interface GovernanceProfileWorkPin {
  profileBindingId: string;
  profileVersionRef: string;
  profileDefinitionDigest: string;
  definition: GovernanceProfileDefinition;
}

export interface GovernanceDirectOperationProfilePin extends GovernanceProfileWorkPin {
  profileBindingState: 'active' | 'draft';
  profilePinMode: 'active' | 'bootstrap_draft';
}

export interface GovernanceProfileCompatibilityEvidence {
  actionContracts: Readonly<Record<string, GovernanceProfileCompatibilityStatus>>;
  policyDimensions: Readonly<Record<string, GovernanceProfileCompatibilityStatus>>;
  providers: Readonly<Record<string, GovernanceProfileCompatibilityStatus>>;
  adapters: Readonly<Record<string, GovernanceProfileCompatibilityStatus>>;
  readbacks: Readonly<Record<string, GovernanceProfileCompatibilityStatus>>;
  uiSchemas: Readonly<Record<string, GovernanceProfileCompatibilityStatus>>;
}

export interface GovernanceProfileCompatibilityPlan {
  operation: GovernanceProfileTransitionOperation;
  preflightStatus: GovernanceProfileCompatibilityStatus;
  blockers: readonly string[];
  compatibilityPreflight: GovernanceProfileCompatibilityEvidence;
  preflightDigest: string;
  migrationPreview: Readonly<{
    fromProfileVersionRef: string | null;
    toProfileVersionRef: string;
    rollbackProfileVersionRef: string | null;
    addedActions: readonly string[];
    removedActions: readonly string[];
    addedProviders: readonly string[];
    removedProviders: readonly string[];
    addedAdapters: readonly string[];
    removedAdapters: readonly string[];
  }>;
  migrationPreviewDigest: string;
}

export function createGovernanceProfileCompatibilityPlan(input: {
  operation: GovernanceProfileTransitionOperation;
  currentProfile: GovernanceProfileDefinition | null;
  targetProfile: GovernanceProfileDefinition;
  evidence: GovernanceProfileCompatibilityEvidence;
}): GovernanceProfileCompatibilityPlan {
  if (input.currentProfile) assertGovernanceProfileDefinitionBoundary(input.currentProfile);
  assertGovernanceProfileDefinitionBoundary(input.targetProfile);
  if ((input.operation === 'bind') !== (input.currentProfile === null)
    || (input.currentProfile && input.currentProfile.versionRef === input.targetProfile.versionRef)) {
    throw new Error('governance_profile_compatibility_transition_invalid');
  }
  const blockers = [
    ...missingReadiness('action_contract', input.targetProfile.actionCatalog, input.evidence.actionContracts),
    ...missingReadiness(
      'policy_dimension',
      Object.keys(input.targetProfile.dimensionApplicability) as GovernanceProfileDimension[],
      input.evidence.policyDimensions,
    ),
    ...missingReadiness('provider', input.targetProfile.providerCapabilities, input.evidence.providers),
    ...missingReadiness('adapter', input.targetProfile.adapterCapabilities, input.evidence.adapters),
    ...missingReadiness('readback', input.targetProfile.adapterCapabilities, input.evidence.readbacks),
    ...missingReadiness('ui_schema', [input.targetProfile.uiSchemaMetadata.schemaId], input.evidence.uiSchemas),
  ].sort();
  const compatibilityPreflight = normalizeEvidence(input.evidence);
  const preflightFacts = {
    targetProfileVersionRef: input.targetProfile.versionRef,
    targetProfileDefinitionDigest: input.targetProfile.definitionDigest,
    compatibilityPreflight,
    blockers,
  };
  const migrationPreview = {
    fromProfileVersionRef: input.currentProfile?.versionRef ?? null,
    toProfileVersionRef: input.targetProfile.versionRef,
    rollbackProfileVersionRef: input.currentProfile?.versionRef ?? null,
    addedActions: difference(input.targetProfile.actionCatalog, input.currentProfile?.actionCatalog ?? []),
    removedActions: difference(input.currentProfile?.actionCatalog ?? [], input.targetProfile.actionCatalog),
    addedProviders: difference(input.targetProfile.providerCapabilities, input.currentProfile?.providerCapabilities ?? []),
    removedProviders: difference(input.currentProfile?.providerCapabilities ?? [], input.targetProfile.providerCapabilities),
    addedAdapters: difference(input.targetProfile.adapterCapabilities, input.currentProfile?.adapterCapabilities ?? []),
    removedAdapters: difference(input.currentProfile?.adapterCapabilities ?? [], input.targetProfile.adapterCapabilities),
  };
  return deepFreeze({
    operation: input.operation,
    preflightStatus: blockers.length === 0 ? 'ready' : 'blocked',
    blockers,
    compatibilityPreflight,
    preflightDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.profile-compatibility-preflight', preflightFacts,
    ),
    migrationPreview,
    migrationPreviewDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.profile-migration-preview', migrationPreview,
    ),
  });
}

export function assertGovernanceProfileBindingTransition(
  current: GovernanceProfileBindingState,
  next: GovernanceProfileBindingState,
): GovernanceProfileBindingState {
  const allowed = (current === 'draft' && next === 'active')
    || (current === 'active' && (next === 'degraded' || next === 'retired'))
    || (current === 'degraded' && next === 'retired');
  if (!allowed) throw new Error('governance_profile_binding_transition_invalid');
  return next;
}

export async function resolveActiveGovernanceProfileForWork(
  prisma: { governanceProfileBinding: { findFirst(input: unknown): Promise<any> } },
  input: {
    homeIdentityBindingId: string;
    homeType: string;
    actionType: string;
    executionAdapter: string;
  },
): Promise<GovernanceProfileWorkPin> {
  const pin = await resolveActiveGovernanceProfilePin(prisma, {
    homeIdentityBindingId: input.homeIdentityBindingId,
  });
  try {
    assertGovernanceProfileSupportsAction(pin.definition, {
      homeType: input.homeType,
      actionType: input.actionType,
      executionAdapter: input.executionAdapter,
    });
  } catch {
    throw new Error('governance_profile_active_binding_incompatible');
  }
  return pin;
}

export async function resolveGovernanceProfileForDirectOperation(
  prisma: { governanceProfileBinding: { findFirst(input: unknown): Promise<any> } },
  input: {
    homeIdentityBindingId: string;
    homeType: string;
    homeActivationState: string;
    actionType: string;
    executionAdapter: string;
  },
): Promise<GovernanceDirectOperationProfilePin> {
  if (input.homeActivationState === 'active'
    || input.homeActivationState === 'legacy_unmigrated') {
    return deepFreeze({
      ...await resolveActiveGovernanceProfileForWork(prisma, input),
      profileBindingState: 'active' as const,
      profilePinMode: 'active' as const,
    });
  }
  if (input.homeActivationState !== 'bootstrap_pending') {
    throw new Error('governance_profile_direct_operation_home_state_invalid');
  }

  const active = await prisma.governanceProfileBinding.findFirst({
    where: { homeIdentityBindingId: input.homeIdentityBindingId, state: 'active' },
    select: { id: true },
  });
  if (active) throw new Error('governance_bootstrap_profile_binding_active_conflict');

  const expectedBindingId = governanceBootstrapProfileBindingId(input.homeIdentityBindingId);
  const binding = await prisma.governanceProfileBinding.findFirst({
    where: {
      id: expectedBindingId,
      homeIdentityBindingId: input.homeIdentityBindingId,
      operation: 'bind',
      state: 'draft',
    },
    include: { definitionVersion: true },
  });
  if (!binding || binding.compatibilityStatus !== 'ready' || !binding.definitionVersion) {
    throw new Error('governance_bootstrap_profile_binding_required');
  }
  const definition = binding.definitionVersion.definition as GovernanceProfileDefinition;
  assertGovernanceProfileDefinitionBoundary(definition);
  if (definition.versionRef !== CIRCLE_GOVERNANCE_PROFILE_V1.versionRef
    || definition.definitionDigest !== CIRCLE_GOVERNANCE_PROFILE_V1.definitionDigest) {
    throw new Error('governance_bootstrap_profile_binding_builtin_profile_required');
  }
  try {
    assertGovernanceProfileSupportsAction(definition, {
      homeType: input.homeType,
      actionType: input.actionType,
      executionAdapter: input.executionAdapter,
    });
  } catch {
    throw new Error('governance_bootstrap_profile_binding_incompatible');
  }
  return deepFreeze({
    profileBindingId: String(binding.id),
    profileVersionRef: definition.versionRef,
    profileDefinitionDigest: definition.definitionDigest,
    definition: jsonValue(definition),
    profileBindingState: 'draft',
    profilePinMode: 'bootstrap_draft',
  });
}

export async function resolveActiveGovernanceProfilePin(
  prisma: { governanceProfileBinding: { findFirst(input: unknown): Promise<any> } },
  input: { homeIdentityBindingId: string },
): Promise<GovernanceProfileWorkPin> {
  const binding = await prisma.governanceProfileBinding.findFirst({
    where: { homeIdentityBindingId: input.homeIdentityBindingId, state: 'active' },
    include: { definitionVersion: true },
  });
  if (!binding || binding.compatibilityStatus !== 'ready' || !binding.definitionVersion) {
    throw new Error('governance_profile_active_binding_required');
  }
  const definition = binding.definitionVersion.definition as GovernanceProfileDefinition;
  assertGovernanceProfileDefinitionBoundary(definition);
  return deepFreeze({
    profileBindingId: String(binding.id),
    profileVersionRef: definition.versionRef,
    profileDefinitionDigest: definition.definitionDigest,
    definition: jsonValue(definition),
  });
}

export function assertPinnedGovernanceProfileCompatibility(
  pin: GovernanceProfileWorkPin,
  input: { homeType: string; actionType: string; executionAdapter: string },
): GovernanceProfileWorkPin {
  assertGovernanceProfileDefinitionBoundary(pin.definition);
  try {
    assertGovernanceProfileSupportsAction(pin.definition, {
      homeType: input.homeType,
      actionType: input.actionType,
      executionAdapter: input.executionAdapter,
    });
  } catch {
    throw new Error('governance_profile_pinned_adapter_incompatible_requires_migration');
  }
  return pin;
}

export function governanceBootstrapProfileBindingId(homeIdentityBindingId: string): string {
  return `governance-profile-binding:${hashCanonicalGovernanceValue(
    'alcheme.governance.bootstrap-profile-binding-id',
    { homeIdentityBindingId },
  ).slice(0, 48)}`;
}

function readyBuiltInGovernanceProfileCompatibilityEvidence(
  profile: GovernanceProfileDefinition,
): GovernanceProfileCompatibilityEvidence {
  if (profile.versionRef !== CIRCLE_GOVERNANCE_PROFILE_V1.versionRef
    || profile.definitionDigest !== CIRCLE_GOVERNANCE_PROFILE_V1.definitionDigest) {
    throw new Error('governance_bootstrap_profile_binding_builtin_profile_required');
  }
  const ready = (values: readonly string[]) => Object.fromEntries(
    [...values].sort().map((value) => [value, 'ready' as const]),
  );
  return deepFreeze({
    actionContracts: ready(profile.actionCatalog),
    policyDimensions: ready(Object.keys(profile.dimensionApplicability)),
    providers: ready(profile.providerCapabilities),
    adapters: ready(profile.adapterCapabilities),
    readbacks: ready(profile.adapterCapabilities),
    uiSchemas: ready([profile.uiSchemaMetadata.schemaId]),
  });
}

interface GovernanceProfileLifecyclePrismaClient {
  $executeRawUnsafe?(query: string, ...values: unknown[]): Promise<unknown>;
  governanceHomeIdentityBinding: { findUnique(input: unknown): Promise<any> };
  governanceProfileDefinitionVersion: {
    findUnique(input: unknown): Promise<any>;
    create(input: unknown): Promise<any>;
    upsert(input: unknown): Promise<any>;
  };
  governanceProfileBinding: {
    findUnique(input: unknown): Promise<any>;
    findFirst(input: unknown): Promise<any>;
    create(input: unknown): Promise<any>;
    upsert(input: unknown): Promise<any>;
    updateMany(input: unknown): Promise<{ count: number }>;
  };
}

type GovernanceProfileLifecyclePrisma = GovernanceProfileLifecyclePrismaClient & {
  $transaction<T>(operation: (tx: GovernanceProfileLifecyclePrismaClient) => Promise<T>): Promise<T>;
};

export async function prepareBootstrapGovernanceProfileBinding(
  prisma: GovernanceProfileLifecyclePrisma,
  input: {
    homeIdentityBindingId: string;
    homeType: string;
    targetProfile: GovernanceProfileDefinition;
    now: Date;
  },
  options: { transactionClient?: boolean } = {},
): Promise<any> {
  assertGovernanceProfileSupportsAction(input.targetProfile, {
    homeType: input.homeType,
    actionType: 'governance.bootstrap.founding_confirmation',
    executionAdapter: 'governance_bootstrap_activation',
  });
  const transition = createGovernanceProfileTransition({
    operation: 'bind',
    homeIdentityBindingId: input.homeIdentityBindingId,
    currentProfileVersionRef: null,
    targetProfile: input.targetProfile,
    reasonCode: 'bootstrap_initial_profile_binding',
  });
  const evidence = readyBuiltInGovernanceProfileCompatibilityEvidence(input.targetProfile);
  const plan = createGovernanceProfileCompatibilityPlan({
    operation: 'bind', currentProfile: null, targetProfile: input.targetProfile, evidence,
  });
  const persist = async (tx: GovernanceProfileLifecyclePrismaClient) => {
    const home = await tx.governanceHomeIdentityBinding.findUnique({
      where: { id: input.homeIdentityBindingId }, include: { activationState: true },
    });
    if (!home || home.homeType !== input.homeType || home.status !== 'inactive'
      || home.activationState?.state !== 'bootstrap_pending') {
      throw new Error('governance_bootstrap_profile_binding_pending_home_required');
    }
    const active = await tx.governanceProfileBinding.findFirst({
      where: { homeIdentityBindingId: input.homeIdentityBindingId, state: 'active' },
    });
    if (active) throw new Error('governance_bootstrap_profile_binding_active_conflict');
    const definitionId = profileDefinitionId(input.targetProfile);
    const definition = await tx.governanceProfileDefinitionVersion.upsert({
      where: { versionRef: input.targetProfile.versionRef },
      update: {},
      create: {
        id: definitionId,
        profileId: input.targetProfile.profileId,
        version: input.targetProfile.version,
        versionRef: input.targetProfile.versionRef,
        definition: jsonValue(input.targetProfile),
        definitionDigest: input.targetProfile.definitionDigest,
        createdAt: input.now,
      },
    });
    assertStoredDefinition(definition, input.targetProfile);
    const desired = {
      id: governanceBootstrapProfileBindingId(input.homeIdentityBindingId),
      homeIdentityBindingId: input.homeIdentityBindingId,
      profileDefinitionVersionId: definition.id,
      operation: 'bind', state: 'draft', stateVersion: 0,
      transition: jsonValue(transition), transitionDigest: transition.transitionDigest,
      compatibilityStatus: plan.preflightStatus,
      compatibilityPreflight: jsonValue({ evidence: plan.compatibilityPreflight, blockers: plan.blockers }),
      compatibilityDigest: plan.preflightDigest,
      migrationPreview: jsonValue(plan.migrationPreview),
      migrationPreviewDigest: plan.migrationPreviewDigest,
      createdAt: input.now, updatedAt: input.now,
    };
    const binding = await tx.governanceProfileBinding.upsert({
      where: { id: desired.id },
      update: {},
      create: desired,
    });
    assertStoredBinding(binding, desired);
    return binding;
  };
  return options.transactionClient ? persist(prisma) : prisma.$transaction(persist);
}

export async function prepareGovernanceProfileBinding(
  prisma: GovernanceProfileLifecyclePrisma,
  input: {
    bindingId: string;
    homeIdentityBindingId: string;
    transition: GovernanceProfileTransitionArtifact;
    currentProfile: GovernanceProfileDefinition | null;
    targetProfile: GovernanceProfileDefinition;
    evidence: GovernanceProfileCompatibilityEvidence;
    now: Date;
  },
): Promise<any> {
  const transition = assertGovernanceProfileTransitionPayload(
    `governance.profile.${input.transition.operation}`,
    input.transition as unknown as Record<string, unknown>,
  );
  if (transition.homeIdentityBindingId !== input.homeIdentityBindingId
    || transition.currentProfileVersionRef !== (input.currentProfile?.versionRef ?? null)
    || transition.targetProfileVersionRef !== input.targetProfile.versionRef
    || transition.targetProfileDefinitionDigest !== input.targetProfile.definitionDigest) {
    throw new Error('governance_profile_binding_transition_mismatch');
  }
  const plan = createGovernanceProfileCompatibilityPlan({
    operation: transition.operation,
    currentProfile: input.currentProfile,
    targetProfile: input.targetProfile,
    evidence: input.evidence,
  });
  return prisma.$transaction(async (tx) => {
    if (typeof tx.$executeRawUnsafe !== 'function') {
      throw new Error('governance_profile_binding_prepare_lock_required');
    }
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      `governance-profile-definition:${input.targetProfile.versionRef}`,
    );
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      `governance-profile-binding:${input.bindingId}`,
    );
    const home = await tx.governanceHomeIdentityBinding.findUnique({
      where: { id: input.homeIdentityBindingId },
      include: { activationState: true },
    });
    if (!home || home.status !== 'active' || home.activationState?.state !== 'active') {
      throw new Error('governance_profile_binding_active_home_required');
    }
    const definitionId = profileDefinitionId(input.targetProfile);
    const existingDefinition = await tx.governanceProfileDefinitionVersion.findUnique({
      where: { versionRef: input.targetProfile.versionRef },
    });
    const definition = existingDefinition ?? await tx.governanceProfileDefinitionVersion.create({
      data: {
        id: definitionId,
        profileId: input.targetProfile.profileId,
        version: input.targetProfile.version,
        versionRef: input.targetProfile.versionRef,
        definition: jsonValue(input.targetProfile),
        definitionDigest: input.targetProfile.definitionDigest,
        createdAt: input.now,
      },
    });
    assertStoredDefinition(definition, input.targetProfile);
    const desired = {
      id: input.bindingId,
      homeIdentityBindingId: input.homeIdentityBindingId,
      profileDefinitionVersionId: definition.id,
      operation: transition.operation,
      state: 'draft',
      stateVersion: 0,
      transition: jsonValue(transition),
      transitionDigest: transition.transitionDigest,
      compatibilityStatus: plan.preflightStatus,
      compatibilityPreflight: jsonValue({
        evidence: plan.compatibilityPreflight,
        blockers: plan.blockers,
      }),
      compatibilityDigest: plan.preflightDigest,
      migrationPreview: jsonValue(plan.migrationPreview),
      migrationPreviewDigest: plan.migrationPreviewDigest,
      createdAt: input.now,
      updatedAt: input.now,
    };
    const existing = await tx.governanceProfileBinding.findUnique({ where: { id: input.bindingId } });
    if (existing) {
      assertStoredBinding(existing, desired);
      return existing;
    }
    return tx.governanceProfileBinding.create({ data: desired });
  });
}

export async function activateGovernanceProfileBinding(
  prisma: GovernanceProfileLifecyclePrisma,
  input: {
    bindingId: string;
    transitionDigest: string;
    evidence: GovernanceProfileCompatibilityEvidence;
    now: Date;
  },
): Promise<any> {
  return prisma.$transaction(async (tx) => {
    const draft = await tx.governanceProfileBinding.findUnique({
      where: { id: input.bindingId },
      include: { definitionVersion: true, identityBinding: { include: { activationState: true } } },
    });
    if (!draft || draft.state !== 'draft' || draft.compatibilityStatus !== 'ready'
      || draft.transitionDigest !== input.transitionDigest
      || draft.identityBinding?.status !== 'active'
      || draft.identityBinding?.activationState?.state !== 'active') {
      throw new Error('governance_profile_binding_draft_not_activatable');
    }
    const transition = assertGovernanceProfileTransitionPayload(
      `governance.profile.${draft.operation}`,
      draft.transition as Record<string, unknown>,
    );
    const active = await tx.governanceProfileBinding.findFirst({
      where: { homeIdentityBindingId: draft.homeIdentityBindingId, state: 'active' },
      include: { definitionVersion: true },
    });
    if ((draft.operation === 'bind' && active)
      || (draft.operation !== 'bind'
        && active?.definitionVersion?.versionRef !== transition.currentProfileVersionRef)) {
      throw new Error('governance_profile_binding_active_version_drift');
    }
    const currentProfile = active
      ? active.definitionVersion.definition as GovernanceProfileDefinition
      : null;
    const targetProfile = draft.definitionVersion.definition as GovernanceProfileDefinition;
    const plan = createGovernanceProfileCompatibilityPlan({
      operation: draft.operation,
      currentProfile,
      targetProfile,
      evidence: input.evidence,
    });
    if (plan.preflightStatus !== 'ready'
      || plan.preflightDigest !== draft.compatibilityDigest
      || plan.migrationPreviewDigest !== draft.migrationPreviewDigest) {
      throw new Error('governance_profile_binding_compatibility_preflight_failed');
    }
    if (active) {
      const retired = await tx.governanceProfileBinding.updateMany({
        where: { id: active.id, state: 'active', stateVersion: active.stateVersion },
        data: {
          state: 'retired', stateVersion: active.stateVersion + 1,
          retiredAt: input.now, updatedAt: input.now,
        },
      });
      if (retired.count !== 1) throw new Error('governance_profile_binding_activation_cas_failed');
    }
    const activated = await tx.governanceProfileBinding.updateMany({
      where: {
        id: draft.id, state: 'draft', stateVersion: draft.stateVersion,
        transitionDigest: input.transitionDigest,
      },
      data: {
        state: 'active', stateVersion: draft.stateVersion + 1,
        activatedAt: input.now, updatedAt: input.now,
      },
    });
    if (activated.count !== 1) throw new Error('governance_profile_binding_activation_cas_failed');
    return tx.governanceProfileBinding.findUnique({
      where: { id: draft.id }, include: { definitionVersion: true },
    });
  });
}

export async function refreshGovernanceProfileBindingCompatibility(
  prisma: GovernanceProfileLifecyclePrisma,
  input: {
    bindingId: string;
    evidence: GovernanceProfileCompatibilityEvidence;
    now: Date;
  },
): Promise<any> {
  return prisma.$transaction(async (tx) => {
    const draft = await tx.governanceProfileBinding.findUnique({
      where: { id: input.bindingId }, include: { definitionVersion: true },
    });
    if (!draft || draft.state !== 'draft') {
      throw new Error('governance_profile_binding_draft_refresh_required');
    }
    const transition = assertGovernanceProfileTransitionPayload(
      `governance.profile.${draft.operation}`,
      draft.transition as Record<string, unknown>,
    );
    const active = await tx.governanceProfileBinding.findFirst({
      where: { homeIdentityBindingId: draft.homeIdentityBindingId, state: 'active' },
      include: { definitionVersion: true },
    });
    if ((draft.operation === 'bind' && active)
      || (draft.operation !== 'bind'
        && active?.definitionVersion?.versionRef !== transition.currentProfileVersionRef)) {
      throw new Error('governance_profile_binding_active_version_drift');
    }
    const plan = createGovernanceProfileCompatibilityPlan({
      operation: draft.operation,
      currentProfile: active?.definitionVersion?.definition ?? null,
      targetProfile: draft.definitionVersion.definition,
      evidence: input.evidence,
    });
    const changed = await tx.governanceProfileBinding.updateMany({
      where: { id: draft.id, state: 'draft', stateVersion: draft.stateVersion },
      data: {
        stateVersion: draft.stateVersion + 1,
        compatibilityStatus: plan.preflightStatus,
        compatibilityPreflight: jsonValue({
          evidence: plan.compatibilityPreflight,
          blockers: plan.blockers,
        }),
        compatibilityDigest: plan.preflightDigest,
        migrationPreview: jsonValue(plan.migrationPreview),
        migrationPreviewDigest: plan.migrationPreviewDigest,
        updatedAt: input.now,
      },
    });
    if (changed.count !== 1) throw new Error('governance_profile_binding_refresh_cas_failed');
    return tx.governanceProfileBinding.findUnique({
      where: { id: draft.id }, include: { definitionVersion: true },
    });
  });
}

export async function transitionGovernanceProfileBindingState(
  prisma: GovernanceProfileLifecyclePrisma,
  input: {
    bindingId: string;
    nextState: 'degraded' | 'retired';
    now: Date;
  },
): Promise<any> {
  return prisma.$transaction(async (tx) => {
    const binding = await tx.governanceProfileBinding.findUnique({ where: { id: input.bindingId } });
    if (!binding) throw new Error('governance_profile_binding_missing');
    assertGovernanceProfileBindingTransition(binding.state, input.nextState);
    const changed = await tx.governanceProfileBinding.updateMany({
      where: { id: binding.id, state: binding.state, stateVersion: binding.stateVersion },
      data: {
        state: input.nextState,
        stateVersion: binding.stateVersion + 1,
        degradedAt: input.nextState === 'degraded' ? input.now : binding.degradedAt,
        retiredAt: input.nextState === 'retired' ? input.now : binding.retiredAt,
        updatedAt: input.now,
      },
    });
    if (changed.count !== 1) throw new Error('governance_profile_binding_transition_cas_failed');
    return tx.governanceProfileBinding.findUnique({ where: { id: binding.id } });
  });
}

function missingReadiness(
  prefix: string,
  required: readonly string[],
  evidence: Readonly<Record<string, GovernanceProfileCompatibilityStatus>>,
): string[] {
  return [...new Set(required)]
    .filter((value) => evidence[value] !== 'ready')
    .map((value) => `${prefix}:${value}`);
}

function profileDefinitionId(profile: GovernanceProfileDefinition): string {
  return `governance-profile-definition:${profile.definitionDigest.slice(0, 64)}`;
}

function jsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertStoredDefinition(existing: any, expected: GovernanceProfileDefinition): void {
  const stored = existing.definition as GovernanceProfileDefinition;
  const {
    versionRef: _versionRef,
    definitionDigest: _definitionDigest,
    ...storedBody
  } = stored;
  const canonicalStored = createGovernanceProfileDefinition(storedBody);
  const {
    versionRef: _expectedVersionRef,
    definitionDigest: _expectedDefinitionDigest,
    ...expectedBody
  } = expected;
  const canonicalExpected = createGovernanceProfileDefinition(expectedBody);
  if (existing.profileId !== expected.profileId
    || existing.version !== expected.version
    || existing.versionRef !== expected.versionRef
    || existing.definitionDigest !== expected.definitionDigest
    || canonicalExpected.versionRef !== expected.versionRef
    || canonicalExpected.definitionDigest !== expected.definitionDigest
    || canonicalStored.versionRef !== expected.versionRef
    || canonicalStored.definitionDigest !== expected.definitionDigest) {
    throw new Error('governance_profile_definition_immutable_mismatch');
  }
}

function assertStoredBinding(existing: any, expected: Record<string, unknown>): void {
  for (const key of [
    'homeIdentityBindingId', 'profileDefinitionVersionId', 'operation', 'transitionDigest',
    'compatibilityStatus', 'compatibilityDigest', 'migrationPreviewDigest',
  ]) {
    if (existing[key] !== expected[key]) throw new Error('governance_profile_binding_idempotency_mismatch');
  }
  for (const key of ['transition', 'compatibilityPreflight', 'migrationPreview']) {
    if (hashCanonicalGovernanceValue(
      'alcheme.governance.profile-binding-json-field', { key, value: existing[key] },
    ) !== hashCanonicalGovernanceValue(
      'alcheme.governance.profile-binding-json-field', { key, value: expected[key] },
    )) {
      throw new Error('governance_profile_binding_idempotency_mismatch');
    }
  }
}

function normalizeEvidence(
  evidence: GovernanceProfileCompatibilityEvidence,
): GovernanceProfileCompatibilityEvidence {
  return Object.fromEntries(Object.entries(evidence).map(([key, value]) => [
    key,
    Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))),
  ])) as unknown as GovernanceProfileCompatibilityEvidence;
}

function difference(left: readonly string[], right: readonly string[]): string[] {
  const other = new Set(right);
  return [...new Set(left)].filter((value) => !other.has(value)).sort();
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}
