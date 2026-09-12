import type { PrismaClient } from '@prisma/client';

import {
  createGovernedActionRegistry,
} from './actionRegistry';
import { GovernedActionGateway } from './governedActionGateway';
import {
  CIRCLE_GOVERNANCE_PROFILE_V1,
  CIRCLE_GOVERNANCE_PROFILE_V2,
  assertGovernanceProfileTransitionEnvelopePayload,
  createGovernanceProfileTransition,
  type GovernanceProfileDefinition,
  type GovernanceProfileTransitionOperation,
} from './governanceProfile';
import {
  activateGovernanceProfileBinding,
  prepareGovernanceProfileBinding,
  refreshGovernanceProfileBindingCompatibility,
  type GovernanceProfileCompatibilityEvidence,
} from './governanceProfileLifecycle';
import {
  STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE,
  getGovernanceCaseActionDefinition,
} from './governanceCaseActionComposition';
import { governanceCaseIdForRequest } from './governanceCase';
import {
  listCommitteeEligibleActors,
  resolveActiveCircleGovernanceBinding,
} from './circleGovernanceBindings';
import {
  createPrismaGovernanceRequestStore,
} from './policyEngine';
import { hashCanonicalGovernanceValue } from './canonicalCodec';
import type {
  GovernanceActionExecutionOutcome,
  GovernanceExecutableRequest,
} from './requestExecution';

const PROFILE_ACTION_PREFIX = 'governance.profile.';

export class GovernanceProfileTransitionExecutionError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string) {
    super(code);
    this.name = 'GovernanceProfileTransitionExecutionError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export async function openCircleGovernanceProfileTransitionRequest(
  prisma: PrismaClient,
  input: {
    circleId: number;
    operation: Extract<GovernanceProfileTransitionOperation, 'upgrade' | 'rollback'>;
    actorPubkey: string;
    actorRole: string;
    reasonCode: string;
    idempotencyKey: string;
    now?: Date;
  },
): Promise<{ request: any; caseId: string; transition: Record<string, unknown> }> {
  assertPositiveCircleId(input.circleId);
  if (input.actorRole !== 'Owner') {
    throw profileError(403, 'governance_profile_circle_owner_required');
  }
  const actorPubkey = requiredText(input.actorPubkey, 1, 44, 'governance_profile_actor_required');
  const reasonCode = requiredReasonCode(input.reasonCode);
  const idempotencyKey = requiredText(
    input.idempotencyKey,
    8,
    128,
    'governance_profile_idempotency_key_required',
  );
  const now = input.now ?? new Date();
  return (prisma as any).$transaction(async (tx: any) => {
    if (typeof tx.$executeRawUnsafe !== 'function') {
      throw profileError(503, 'governance_profile_transition_lock_unavailable');
    }
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      `governance-profile-transition:circle:${input.circleId}`,
    );
    const home = await resolveSingleActiveCircleHome(tx, input.circleId);
    const active = await tx.governanceProfileBinding.findFirst({
      where: { homeIdentityBindingId: home.id, state: 'active' },
      include: { definitionVersion: true },
    });
    if (!active?.definitionVersion?.definition) {
      throw profileError(409, 'governance_profile_active_binding_required');
    }
    const currentProfile = active.definitionVersion.definition as GovernanceProfileDefinition;
    if (input.operation === 'upgrade') {
      throw profileError(409, 'governance_profile_upgrade_retired');
    }
    if (input.operation === 'rollback') {
      await assertCircleProfileRollbackReady(tx, {
        circleId: input.circleId,
        homeIdentityBindingId: home.id,
        activeBinding: active,
      });
    }
    const targetProfile = profileTransitionTarget(input.operation, currentProfile);
    const transition = createGovernanceProfileTransition({
      operation: input.operation,
      homeIdentityBindingId: home.id,
      currentProfileVersionRef: currentProfile.versionRef,
      targetProfile,
      reasonCode,
    });
    const registry = createGovernedActionRegistry({ includeGovernanceHomeProfileActions: true });
    const gateway = new GovernedActionGateway({
      registry,
      resolveBinding: (bindingInput) => resolveActiveCircleGovernanceBinding(
        tx,
        bindingInput,
      ),
      listCommitteeEligibleActors: (eligibleInput) => listCommitteeEligibleActors(
        tx,
        eligibleInput,
      ),
      requestStore: createPrismaGovernanceRequestStore(tx),
      runtimePrisma: tx,
      runtimeTransactionClient: true,
      now: () => now,
    });
    const request = await gateway.openDecisionStageRequest({
      actionType: `${PROFILE_ACTION_PREFIX}${input.operation}`,
      targetCircleId: input.circleId,
      targetType: 'governance_home_identity_binding',
      targetRef: home.id,
      payload: transition as unknown as Record<string, unknown>,
      idempotencyKey,
      proposerPubkey: actorPubkey,
    });
    return {
      request,
      caseId: governanceCaseIdForRequest(request.id),
      transition: transition as unknown as Record<string, unknown>,
    };
  });
}

export async function executeGovernanceProfileTransition(
  prisma: PrismaClient | Record<string, unknown>,
  request: GovernanceExecutableRequest,
  now: Date,
): Promise<GovernanceActionExecutionOutcome | null> {
  if (!request.actionType.startsWith(PROFILE_ACTION_PREFIX)) return null;
  const transition = assertGovernanceProfileTransitionEnvelopePayload(
    request.actionType,
    normalizeRecord(request.payload),
  );
  if (
    request.targetType !== 'governance_home_identity_binding'
    || request.targetRef !== transition.homeIdentityBindingId
  ) {
    throw new Error('governance_profile_execution_target_mismatch');
  }
  if (transition.operation === 'bind') {
    throw new Error('governance_profile_bind_bootstrap_only');
  }
  const db = prisma as any;
  const home = await db.governanceHomeIdentityBinding.findUnique({
    where: { id: transition.homeIdentityBindingId },
    include: { activationState: true },
  });
  if (!home || home.homeType !== 'circle' || home.status !== 'active'
    || home.activationState?.state !== 'active') {
    throw new Error('governance_profile_binding_active_home_required');
  }
  const active = await readActiveProfileBinding(db, home.id);
  const currentProfile = active?.definitionVersion?.definition as GovernanceProfileDefinition | undefined;
  if (!active || !currentProfile) {
    throw new Error('governance_profile_active_binding_required');
  }
  const bindingId = governanceProfileTransitionBindingId(home.id, transition.transitionDigest);
  if (
    active.id === bindingId
    && currentProfile.versionRef === transition.targetProfileVersionRef
    && currentProfile.definitionDigest === transition.targetProfileDefinitionDigest
  ) {
    return executedProfileOutcome(active, transition.transitionDigest);
  }
  if (transition.operation === 'upgrade') {
    throw new Error('governance_profile_upgrade_retired');
  }
  if (transition.operation === 'rollback') {
    await assertCircleProfileRollbackReady(db, {
      circleId: Number(home.homeRef),
      homeIdentityBindingId: home.id,
      activeBinding: active,
    });
  }
  const targetProfile = profileTransitionTarget(transition.operation, currentProfile);
  if (
    transition.currentProfileVersionRef !== currentProfile.versionRef
    || transition.targetProfileVersionRef !== targetProfile.versionRef
    || transition.targetProfileDefinitionDigest !== targetProfile.definitionDigest
  ) {
    throw new Error('governance_profile_binding_active_version_drift');
  }
  const evidence = createCircleProfileCompatibilityEvidence(targetProfile);
  try {
    const existing = await db.governanceProfileBinding.findUnique({ where: { id: bindingId } });
    if (existing) {
      await refreshGovernanceProfileBindingCompatibility(db, {
        bindingId,
        evidence,
        now,
      });
    } else {
      await prepareGovernanceProfileBinding(db, {
        bindingId,
        homeIdentityBindingId: home.id,
        transition,
        currentProfile,
        targetProfile,
        evidence,
        now,
      });
    }
    const activated = await activateGovernanceProfileBinding(db, {
      bindingId,
      transitionDigest: transition.transitionDigest,
      evidence,
      now,
    });
    return executedProfileOutcome(activated, transition.transitionDigest);
  } catch (error) {
    const converged = await readActiveProfileBinding(db, home.id);
    if (
      converged?.id === bindingId
      && converged?.definitionVersion?.versionRef === targetProfile.versionRef
      && converged?.definitionVersion?.definitionDigest === targetProfile.definitionDigest
    ) {
      return executedProfileOutcome(converged, transition.transitionDigest);
    }
    throw error;
  }
}

export async function readCircleGovernanceProfileTransitionState(
  prisma: PrismaClient,
  input: { circleId: number },
): Promise<Record<string, unknown>> {
  assertPositiveCircleId(input.circleId);
  const home = await resolveSingleActiveCircleHome(prisma, input.circleId);
  const bindings = await (prisma as any).governanceProfileBinding.findMany({
    where: { homeIdentityBindingId: home.id },
    include: { definitionVersion: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  const receipts = await (prisma as any).governanceExecutionReceipt.findMany({
    where: {
      actionType: { in: ['governance.profile.upgrade', 'governance.profile.rollback'] },
      request: { targetType: 'governance_home_identity_binding', targetRef: home.id },
    },
    include: { request: { select: { id: true, state: true } } },
    orderBy: [{ executedAt: 'desc' }, { id: 'desc' }],
    take: 20,
  });
  return {
    circleId: input.circleId,
    homeIdentityBindingId: home.id,
    active: projectProfileBinding(bindings.find((binding: any) => binding.state === 'active') ?? null),
    history: bindings.map(projectProfileBinding),
    receipts: receipts.map((receipt: any) => ({
      id: receipt.id,
      requestId: receipt.requestId,
      requestState: receipt.request?.state ?? null,
      actionType: receipt.actionType,
      executionStatus: receipt.executionStatus,
      executionRef: receipt.executionRef,
      errorCode: receipt.errorCode,
      decisionDigest: receipt.decisionDigest,
      executedAt: receipt.executedAt,
    })),
  };
}

export function governanceProfileTransitionBindingId(
  homeIdentityBindingId: string,
  transitionDigest: string,
): string {
  return `governance-profile-binding:${hashCanonicalGovernanceValue(
    'alcheme.governance.profile-transition-binding-id',
    { homeIdentityBindingId, transitionDigest },
  ).slice(0, 56)}`;
}

function createCircleProfileCompatibilityEvidence(
  targetProfile: GovernanceProfileDefinition,
): GovernanceProfileCompatibilityEvidence {
  if (
    targetProfile.versionRef !== CIRCLE_GOVERNANCE_PROFILE_V1.versionRef
    && targetProfile.versionRef !== CIRCLE_GOVERNANCE_PROFILE_V2.versionRef
  ) {
    throw new Error('governance_profile_target_not_builtin_circle_profile');
  }
  const providerAdmission = getGovernanceCaseActionDefinition(
    STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE,
  );
  const providerAdmissionReady = providerAdmission?.targetType === 'external_provider'
    && providerAdmission.executionAdapter === 'manual_case_execution'
    && providerAdmission.receiptRequired === true;
  const ready = (values: readonly string[], blocked: ReadonlySet<string> = new Set()) =>
    Object.fromEntries([...values].sort().map((value) => [
      value,
      blocked.has(value) ? 'blocked' as const : 'ready' as const,
    ]));
  const blockedActions = new Set<string>();
  const blockedAdapters = new Set<string>();
  if (targetProfile.versionRef === CIRCLE_GOVERNANCE_PROFILE_V2.versionRef
    && !providerAdmissionReady) {
    blockedActions.add('storage_fabric.*');
    blockedAdapters.add('manual_case_execution');
  }
  return {
    actionContracts: ready(targetProfile.actionCatalog, blockedActions),
    policyDimensions: ready(Object.keys(targetProfile.dimensionApplicability)),
    providers: ready(targetProfile.providerCapabilities),
    adapters: ready(targetProfile.adapterCapabilities, blockedAdapters),
    readbacks: ready(targetProfile.adapterCapabilities, blockedAdapters),
    uiSchemas: ready([targetProfile.uiSchemaMetadata.schemaId]),
  } as GovernanceProfileCompatibilityEvidence;
}

function profileTransitionTarget(
  operation: Extract<GovernanceProfileTransitionOperation, 'upgrade' | 'rollback'>,
  currentProfile: GovernanceProfileDefinition,
): GovernanceProfileDefinition {
  if (operation === 'upgrade') {
    throw profileError(409, 'governance_profile_upgrade_retired');
  }
  if (
    operation === 'rollback'
    && currentProfile.versionRef === CIRCLE_GOVERNANCE_PROFILE_V2.versionRef
    && currentProfile.definitionDigest === CIRCLE_GOVERNANCE_PROFILE_V2.definitionDigest
  ) return CIRCLE_GOVERNANCE_PROFILE_V1;
  throw profileError(409, `governance_profile_${operation}_transition_unavailable`);
}

async function assertCircleProfileRollbackReady(
  prisma: any,
  input: {
    circleId: number;
    homeIdentityBindingId?: string;
    activeBinding: {
      compatibilityStatus?: string | null;
      state?: string | null;
    };
  },
): Promise<void> {
  if (input.activeBinding.state !== 'active') {
    throw profileError(409, 'governance_profile_rollback_active_binding_required');
  }
  if (input.activeBinding.compatibilityStatus !== 'ready') {
    throw profileError(409, 'governance_profile_rollback_compatibility_mismatch');
  }
  if (typeof prisma.circleGovernanceBinding?.findMany === 'function') {
    const pending = await prisma.circleGovernanceBinding.findMany({
      where: {
        targetCircleId: input.circleId,
        status: { in: ['pending_mandate', 'pending'] },
      },
      take: 1,
    });
    if (Array.isArray(pending) && pending.length > 0) {
      throw profileError(409, 'governance_profile_rollback_pending_binding');
    }
  }
  const homeIdentityBindingId = String(input.homeIdentityBindingId ?? '').trim();
  if (
    homeIdentityBindingId
    && typeof prisma.governanceCase?.findFirst === 'function'
  ) {
    const inFlight = await prisma.governanceCase.findFirst({
      where: {
        homeIdentityBindingId,
        NOT: {
          casePhase: { in: ['closed', 'archived', 'completed', 'cancelled', 'rejected'] },
        },
      },
      select: { id: true },
    });
    if (inFlight) {
      throw profileError(409, 'governance_profile_rollback_inflight_case');
    }
  }
}

async function resolveSingleActiveCircleHome(prisma: PrismaClient, circleId: number): Promise<any> {
  const homes = await (prisma as any).governanceHomeIdentityBinding.findMany({
    where: { homeType: 'circle', homeRef: String(circleId), supersededAt: null },
    orderBy: { identityVersion: 'desc' },
    take: 2,
  });
  if (homes.length !== 1) {
    throw profileError(
      409,
      homes.length === 0
        ? 'governance_profile_circle_home_required'
        : 'governance_profile_circle_home_ambiguous',
    );
  }
  if (homes[0].status !== 'active') {
    throw profileError(409, 'governance_profile_circle_home_inactive');
  }
  return homes[0];
}

async function readActiveProfileBinding(prisma: any, homeIdentityBindingId: string): Promise<any> {
  return prisma.governanceProfileBinding.findFirst({
    where: { homeIdentityBindingId, state: 'active' },
    include: { definitionVersion: true },
  });
}

function executedProfileOutcome(
  binding: any,
  transitionDigest: string,
): GovernanceActionExecutionOutcome {
  return {
    executionStatus: 'executed',
    executionRef: binding.id,
    executionEvidence: {
      profileBindingId: binding.id,
      profileVersionRef: binding.definitionVersion?.versionRef ?? null,
      profileDefinitionDigest: binding.definitionVersion?.definitionDigest ?? null,
      transitionDigest,
    },
  };
}

function projectProfileBinding(binding: any): Record<string, unknown> | null {
  if (!binding) return null;
  return {
    id: binding.id,
    operation: binding.operation,
    state: binding.state,
    stateVersion: binding.stateVersion,
    profileVersionRef: binding.definitionVersion?.versionRef ?? null,
    profileDefinitionDigest: binding.definitionVersion?.definitionDigest ?? null,
    transitionDigest: binding.transitionDigest,
    compatibilityStatus: binding.compatibilityStatus,
    compatibilityDigest: binding.compatibilityDigest,
    migrationPreviewDigest: binding.migrationPreviewDigest,
    activatedAt: binding.activatedAt,
    retiredAt: binding.retiredAt,
    createdAt: binding.createdAt,
    updatedAt: binding.updatedAt,
  };
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function requiredText(value: unknown, min: number, max: number, code: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (normalized.length < min || normalized.length > max) throw profileError(400, code);
  return normalized;
}

function requiredReasonCode(value: unknown): string {
  const normalized = requiredText(value, 3, 128, 'governance_profile_reason_code_required');
  if (!/^[a-z0-9][a-z0-9_.-]*$/.test(normalized)) {
    throw profileError(400, 'governance_profile_reason_code_invalid');
  }
  return normalized;
}

function assertPositiveCircleId(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw profileError(400, 'invalid_circle_id');
}

function profileError(statusCode: number, code: string): GovernanceProfileTransitionExecutionError {
  return new GovernanceProfileTransitionExecutionError(statusCode, code);
}
