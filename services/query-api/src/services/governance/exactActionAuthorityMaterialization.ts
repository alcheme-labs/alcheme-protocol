import { hashCanonicalGovernanceValue } from './canonicalCodec';
import type { GovernedActionDefinition } from './actionRegistry';
import {
  boundedAuthoritySourceVersion,
  createGovernedActionContractVersionSeed,
  ensureGovernedActionContractVersion,
  governedActionAuthoritySeparationError,
} from './governedActionGatewayRuntime';
import { governanceMandateAuthoritySourceVersion } from './governanceMandateEffects';

const AUTHORITY_BINDING_DOMAIN = 'alcheme.governance.action-authority-binding-seed';

export type ExactActionAuthorityMaterializationOutcome =
  | 'skip'
  | 'noop'
  | 'create'
  | 'switch'
  | 'conflict'
  | 'reject';

export type ExactActionAuthorityMaterializationInput = {
  definition: GovernedActionDefinition;
  home: { homeType: string; homeRef: string };
  binding: {
    id: string;
    targetCircleId: number;
    committeeCircleId: number;
    actionType: string | null;
    actionPrefix: string | null;
    policyId: string;
    policyVersionId: string;
    policyVersion: number;
    ruleId: string;
    status: string;
    targetAuthorizationStatus: string;
    committeeMandateStatus: string;
  };
  mandate: {
    id: string;
    version: number;
    termsDigest: string;
    terms: unknown;
    subjectType: string;
    subjectRef: string;
    actionType: string | null;
    actionPrefix: string | null;
    environment: string;
    network: string;
    effectiveFrom: Date;
    effectiveUntil: Date | null;
    purposeBindings: ReadonlyArray<{
      purpose: string;
      actionSelector?: { actionType?: string | null; actionPrefix?: string | null };
    }>;
    minimumConstraints: {
      riskFloor?: string;
      minimumApprovalThreshold?: number;
      minimumTimelockSeconds?: number;
    };
  };
  contractVersionId?: string;
  contractSeed?: ReturnType<typeof createGovernedActionContractVersionSeed>;
  governedSupersede?: { previousAuthorityBindingId: string } | null;
  authoritySource?: {
    type: 'governance_mandate' | 'circle_governance_binding';
    ref: string;
    version: string;
  };
  now: Date;
};

export type ExactActionAuthorityMaterializationResult = {
  outcome: ExactActionAuthorityMaterializationOutcome;
  reasonCode: string | null;
  authorityBindingId: string | null;
  desired: ExactActionAuthorityBindingRecord | null;
  conflictingIds: string[];
};

export type ExactActionAuthorityBindingRecord = {
  id: string;
  governanceHomeType: string;
  governanceHomeRef: string;
  contractVersionId: string;
  sourceType: string;
  sourceRef: string;
  sourceVersion: string;
  purpose: string;
  selector: Record<string, unknown>;
  limits: Record<string, unknown>;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  status: string;
  bindingDigest: string;
  supersededAt: Date | null;
};

type MaterializationTx = {
  actionAuthorityPolicyBinding: {
    findMany(input: unknown): Promise<any[]>;
    findUnique(input: { where: { id: string } }): Promise<any | null>;
    create(input: { data: Record<string, unknown> }): Promise<any>;
    updateMany(input: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  governedActionContractVersion?: {
    findUnique(input: unknown): Promise<any>;
    create(input: { data: Record<string, unknown> }): Promise<any>;
  };
};

export function requiresExactActionAuthorityMaterialization(
  definition: Pick<GovernedActionDefinition, 'bindingRequirement'> | null | undefined,
): boolean {
  return definition?.bindingRequirement === 'exact_action_subject_purpose';
}

export function evaluateExactActionAuthorityMaterialization(
  input: ExactActionAuthorityMaterializationInput,
  existingActive: readonly ExactActionAuthorityBindingRecord[],
): ExactActionAuthorityMaterializationResult {
  if (!requiresExactActionAuthorityMaterialization(input.definition)) {
    return {
      outcome: 'skip',
      reasonCode: 'governed_action_exact_binding_not_required',
      authorityBindingId: null,
      desired: null,
      conflictingIds: [],
    };
  }

  const rejection = exactBindingScopeRejection(input);
  if (rejection) {
    return {
      outcome: 'reject',
      reasonCode: rejection,
      authorityBindingId: null,
      desired: null,
      conflictingIds: [],
    };
  }

  const desired = buildDesiredExactAuthorityBinding(input);
  const exactExisting = existingActive.find((row) => row.id === desired.id
    || row.bindingDigest === desired.bindingDigest);
  if (exactExisting) {
    if (!sameExactAuthorityBinding(exactExisting, desired)) {
      return {
        outcome: 'conflict',
        reasonCode: 'governed_action_authority_binding_conflict',
        authorityBindingId: exactExisting.id,
        desired,
        conflictingIds: [exactExisting.id],
      };
    }
    return {
      outcome: 'noop',
      reasonCode: null,
      authorityBindingId: exactExisting.id,
      desired,
      conflictingIds: [],
    };
  }

  const conflicting = existingActive.filter((row) =>
    overlapsExactAuthorityScope(row, desired) && row.id !== desired.id);
  if (conflicting.length > 0) {
    if (
      input.governedSupersede?.previousAuthorityBindingId
      && conflicting.length === 1
      && conflicting[0].id === input.governedSupersede.previousAuthorityBindingId
    ) {
      return {
        outcome: 'switch',
        reasonCode: null,
        authorityBindingId: desired.id,
        desired,
        conflictingIds: [conflicting[0].id],
      };
    }
    return {
      outcome: 'conflict',
      reasonCode: 'governed_action_authority_binding_conflict',
      authorityBindingId: null,
      desired,
      conflictingIds: conflicting.map((row) => row.id),
    };
  }

  return {
    outcome: 'create',
    reasonCode: null,
    authorityBindingId: desired.id,
    desired,
    conflictingIds: [],
  };
}

export async function materializeExactActionAuthorityBinding(
  tx: MaterializationTx,
  input: ExactActionAuthorityMaterializationInput,
  options: { dryRun: boolean },
): Promise<ExactActionAuthorityMaterializationResult> {
  if (!requiresExactActionAuthorityMaterialization(input.definition)) {
    return evaluateExactActionAuthorityMaterialization(input, []);
  }

  const rejection = exactBindingScopeRejection(input);
  if (rejection) {
    throw new Error(rejection);
  }

  let contractVersionId = input.contractVersionId?.trim() || '';
  if (!options.dryRun) {
    if (!tx.governedActionContractVersion) {
      throw new Error('governed_action_contract_runtime_required');
    }
    const ensured = await ensureGovernedActionContractVersion(tx as any, {
      definition: input.definition,
      now: input.now,
    });
    contractVersionId = ensured.id;
  } else if (!contractVersionId) {
    const seed = input.contractSeed
      ?? createGovernedActionContractVersionSeed(input.definition, input.now);
    contractVersionId = seed.id;
  }

  const prepared: ExactActionAuthorityMaterializationInput = {
    ...input,
    contractVersionId,
  };
  const active = await loadActiveExactAuthorityCandidates(tx, prepared);
  const evaluated = evaluateExactActionAuthorityMaterialization(prepared, active);
  if (evaluated.outcome === 'reject') {
    throw new Error(evaluated.reasonCode || 'governed_action_exact_binding_required');
  }
  if (evaluated.outcome === 'conflict') {
    throw new Error(evaluated.reasonCode || 'governed_action_authority_binding_conflict');
  }
  if (evaluated.outcome === 'noop' || evaluated.outcome === 'skip') {
    return evaluated;
  }
  if (options.dryRun) {
    return evaluated;
  }

  const desired = evaluated.desired!;
  if (evaluated.outcome === 'switch') {
    const previousId = input.governedSupersede!.previousAuthorityBindingId;
    const superseded = await tx.actionAuthorityPolicyBinding.updateMany({
      where: {
        id: previousId,
        status: 'active',
        supersededAt: null,
      },
      data: {
        status: 'superseded',
        supersededAt: input.now,
        effectiveUntil: input.now,
      },
    });
    if (superseded.count !== 1) {
      throw new Error('governed_action_authority_binding_conflict');
    }
  }

  try {
    await tx.actionAuthorityPolicyBinding.create({ data: desired });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const existing = await tx.actionAuthorityPolicyBinding.findUnique({
      where: { id: desired.id },
    });
    if (!existing || !sameExactAuthorityBinding(existing, desired)) {
      throw new Error('governed_action_authority_binding_conflict');
    }
    return {
      outcome: 'noop',
      reasonCode: null,
      authorityBindingId: desired.id,
      desired,
      conflictingIds: [],
    };
  }

  return {
    ...evaluated,
    authorityBindingId: desired.id,
  };
}

export async function retireExactActionAuthorityBindingsForDomainBinding(
  tx: Pick<MaterializationTx, 'actionAuthorityPolicyBinding'>,
  input: {
    home: { homeType: string; homeRef: string };
    domainBindingId: string;
    retiredAt: Date;
  },
): Promise<number> {
  const candidates = await tx.actionAuthorityPolicyBinding.findMany({
    where: {
      governanceHomeType: input.home.homeType,
      governanceHomeRef: input.home.homeRef,
      status: 'active',
      supersededAt: null,
    },
  });
  const owned = candidates.filter((candidate) => (
    asRecord(candidate.limits).domainBindingId === input.domainBindingId
  ));
  let retired = 0;
  for (const candidate of owned) {
    const updated = await tx.actionAuthorityPolicyBinding.updateMany({
      where: {
        id: candidate.id,
        status: 'active',
        supersededAt: null,
      },
      data: {
        status: 'superseded',
        supersededAt: input.retiredAt,
        effectiveUntil: input.retiredAt,
      },
    });
    retired += updated.count;
  }
  return retired;
}

function exactBindingScopeRejection(
  input: ExactActionAuthorityMaterializationInput,
): string | null {
  if (
    input.binding.status !== 'active'
    || input.binding.targetAuthorizationStatus !== 'accepted'
    || input.binding.committeeMandateStatus !== 'accepted'
  ) {
    return 'governed_action_exact_binding_not_active';
  }

  const actionType = String(input.binding.actionType ?? input.mandate.actionType ?? '').trim();
  const actionPrefix = input.binding.actionPrefix ?? input.mandate.actionPrefix;
  if (!actionType || actionPrefix != null) {
    return 'governed_action_exact_binding_required';
  }
  if (actionType !== input.definition.actionType) {
    return 'governed_action_exact_binding_required';
  }

  const subjectType = String(input.mandate.subjectType ?? '').trim();
  const subjectRef = String(input.mandate.subjectRef ?? '').trim();
  if (!subjectType || !subjectRef) {
    return 'governed_action_exact_binding_required';
  }

  const purposeBinding = input.mandate.purposeBindings.find((binding) => (
    binding.purpose === 'collective_decision'
    && String(binding.actionSelector?.actionType ?? '') === actionType
    && (binding.actionSelector?.actionPrefix ?? null) == null
  ));
  if (!purposeBinding) {
    const hasWrongPurpose = input.mandate.purposeBindings.some((binding) => (
      String(binding.actionSelector?.actionType ?? '') === actionType
      && binding.purpose !== 'collective_decision'
    ));
    return hasWrongPurpose
      ? 'governed_action_exact_binding_purpose_mismatch'
      : 'governed_action_exact_binding_required';
  }

  const network = String(input.mandate.network ?? '').trim();
  if (!network) {
    return 'governed_action_exact_binding_network_required';
  }

  if (
    !isWithinWindow(input.mandate.effectiveFrom, input.mandate.effectiveUntil, input.now)
  ) {
    return 'governed_action_exact_binding_not_active';
  }

  return null;
}

export function buildExactAuthorityBindingFromProjectedGatewayBinding(input: {
  home: { homeType: string; homeRef: string };
  binding: {
    id: string;
    targetCircleId?: number;
    committeeCircleId: number;
    policyId: string;
    policyVersionId: string;
    policyVersion: number;
    ruleId: string;
    authoritySourceType?: string | null;
    authoritySourceRef?: string | null;
    authoritySourceVersion?: string | null;
    authorityPurpose?: string | null;
    authoritySelector?: Record<string, unknown> | null;
    authorityLimits?: Record<string, unknown> | null;
    authorityEffectiveFrom?: Date | null;
    authorityEffectiveUntil?: Date | null;
  };
  definition: GovernedActionDefinition;
  contractVersionId: string;
  now: Date;
}): ExactActionAuthorityBindingRecord {
  const selectorIn = asRecord(input.binding.authoritySelector);
  const limitsIn = asRecord(input.binding.authorityLimits);
  const targetCircleId = Number(
    input.binding.targetCircleId
    ?? selectorIn.targetCircleId
    ?? (input.home.homeType === 'circle' ? input.home.homeRef : NaN),
  );
  if (!Number.isSafeInteger(targetCircleId) || targetCircleId <= 0) {
    throw new Error('governed_action_exact_binding_required');
  }
  const effectiveFrom = input.binding.authorityEffectiveFrom
    ?? new Date(String(limitsIn.effectiveFrom ?? 'invalid'));
  const effectiveUntil = input.binding.authorityEffectiveUntil !== undefined
    ? input.binding.authorityEffectiveUntil
    : limitsIn.effectiveUntil == null
      ? null
      : new Date(String(limitsIn.effectiveUntil));
  if (Number.isNaN(effectiveFrom.getTime())) {
    throw new Error('governed_action_exact_binding_required');
  }
  const sourceType = input.binding.authoritySourceType === 'circle_governance_binding'
    ? 'circle_governance_binding'
    : 'governance_mandate';
  const sourceRef = String(
    input.binding.authoritySourceRef
    ?? (sourceType === 'governance_mandate' ? limitsIn.mandateId : null)
    ?? '',
  ).trim();
  if (!sourceRef) {
    throw new Error('governed_action_exact_binding_source_ref_required');
  }
  return buildExactAuthorityBindingRecord({
    home: input.home,
    definition: input.definition,
    contractVersionId: String(input.contractVersionId),
    actionType: input.definition.actionType,
    subjectType: String(selectorIn.subjectType ?? '').trim(),
    subjectRef: String(selectorIn.subjectRef ?? '').trim(),
    environment: String(selectorIn.environment || 'local_development').trim(),
    network: String(selectorIn.network ?? '').trim(),
    targetCircleId,
    mandateId: sourceType === 'governance_mandate'
      ? String(limitsIn.mandateId ?? input.binding.authoritySourceRef ?? '').trim()
      : null,
    mandateVersion: sourceType === 'governance_mandate'
      ? Number(limitsIn.mandateVersion)
      : null,
    mandateTermsDigest: sourceType === 'governance_mandate'
      ? String(limitsIn.mandateTermsDigest ?? '').trim()
      : null,
    committeeCircleId: input.binding.committeeCircleId,
    domainBindingId: input.binding.id,
    policyId: input.binding.policyId,
    policyVersionId: input.binding.policyVersionId,
    policyVersion: input.binding.policyVersion,
    ruleId: input.binding.ruleId,
    riskFloor: String(limitsIn.riskFloor || input.definition.impact),
    minimumApprovalThreshold: Number(limitsIn.minimumApprovalThreshold ?? 1),
    minimumTimelockSeconds: Number(limitsIn.minimumTimelockSeconds ?? 0),
    effectiveFrom,
    effectiveUntil,
    sourceType,
    sourceRef,
    sourceVersion: String(input.binding.authoritySourceVersion ?? ''),
  });
}

function buildDesiredExactAuthorityBinding(
  input: ExactActionAuthorityMaterializationInput,
): ExactActionAuthorityBindingRecord {
  const contractVersionId = String(
    input.contractVersionId
    || input.contractSeed?.id
    || createGovernedActionContractVersionSeed(input.definition, input.now).id,
  );
  const source = input.authoritySource ?? {
    type: 'governance_mandate' as const,
    ref: input.mandate.id,
    version: governanceMandateAuthoritySourceVersion(
      input.mandate.version,
      input.mandate.termsDigest,
    ),
  };
  return buildExactAuthorityBindingRecord({
    home: input.home,
    definition: input.definition,
    contractVersionId,
    actionType: input.definition.actionType,
    subjectType: String(input.mandate.subjectType).trim(),
    subjectRef: String(input.mandate.subjectRef).trim(),
    environment: String(input.mandate.environment || 'local_development').trim(),
    network: String(input.mandate.network).trim(),
    targetCircleId: input.binding.targetCircleId,
    mandateId: source.type === 'governance_mandate' ? input.mandate.id : null,
    mandateVersion: source.type === 'governance_mandate' ? input.mandate.version : null,
    mandateTermsDigest: source.type === 'governance_mandate' ? input.mandate.termsDigest : null,
    committeeCircleId: input.binding.committeeCircleId,
    domainBindingId: input.binding.id,
    policyId: input.binding.policyId,
    policyVersionId: input.binding.policyVersionId,
    policyVersion: input.binding.policyVersion,
    ruleId: input.binding.ruleId,
    riskFloor: String(input.mandate.minimumConstraints.riskFloor || input.definition.impact),
    minimumApprovalThreshold: Number(
      input.mandate.minimumConstraints.minimumApprovalThreshold ?? 1,
    ),
    minimumTimelockSeconds: Number(
      input.mandate.minimumConstraints.minimumTimelockSeconds ?? 0,
    ),
    effectiveFrom: input.mandate.effectiveFrom,
    effectiveUntil: input.mandate.effectiveUntil,
    sourceType: source.type,
    sourceRef: source.ref,
    sourceVersion: source.version,
  });
}

function buildExactAuthorityBindingRecord(input: {
  home: { homeType: string; homeRef: string };
  definition: GovernedActionDefinition;
  contractVersionId: string;
  actionType: string;
  subjectType: string;
  subjectRef: string;
  environment: string;
  network: string;
  targetCircleId: number;
  mandateId: string | null;
  mandateVersion: number | null;
  mandateTermsDigest: string | null;
  committeeCircleId: number;
  domainBindingId: string;
  policyId: string;
  policyVersionId: string;
  policyVersion: number;
  ruleId: string;
  riskFloor: string;
  minimumApprovalThreshold: number;
  minimumTimelockSeconds: number;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  sourceType: 'governance_mandate' | 'circle_governance_binding';
  sourceRef: string;
  sourceVersion: string;
}): ExactActionAuthorityBindingRecord {
  if (!input.sourceRef.trim()) {
    throw new Error('governed_action_exact_binding_source_ref_required');
  }
  const selector = {
    actionType: input.actionType,
    actionPrefix: null,
    subjectType: input.subjectType,
    subjectRef: input.subjectRef,
    environment: input.environment,
    network: input.network,
    targetCircleId: input.targetCircleId,
  };
  const limits = {
    mandateId: input.mandateId,
    mandateVersion: input.mandateVersion,
    mandateTermsDigest: input.mandateTermsDigest,
    targetCircleId: input.targetCircleId,
    committeeCircleId: input.committeeCircleId,
    domainBindingId: input.domainBindingId,
    policyId: input.policyId,
    policyVersionId: input.policyVersionId,
    policyVersion: input.policyVersion,
    ruleId: input.ruleId,
    riskFloor: input.riskFloor,
    minimumApprovalThreshold: input.minimumApprovalThreshold,
    minimumTimelockSeconds: input.minimumTimelockSeconds,
    effectiveFrom: input.effectiveFrom.toISOString(),
    effectiveUntil: input.effectiveUntil
      ? input.effectiveUntil.toISOString()
      : null,
    executionAuthority: {
      type: 'registered_adapter',
      ref: input.definition.executionAdapter,
    },
  };
  const facts = {
    governanceHomeType: input.home.homeType,
    governanceHomeRef: input.home.homeRef,
    contractVersionId: input.contractVersionId,
    sourceType: input.sourceType,
    sourceRef: input.sourceRef,
    sourceVersion: boundedAuthoritySourceVersion(input.sourceVersion) ?? '',
    purpose: 'collective_decision',
    selector,
    limits,
  };
  const separationError = governedActionAuthoritySeparationError(facts, {
    executionAdapter: input.definition.executionAdapter,
  });
  if (separationError) throw new Error(separationError);
  const bindingDigest = hashCanonicalGovernanceValue(AUTHORITY_BINDING_DOMAIN, facts);
  return {
    id: `action-authority:${bindingDigest.slice(0, 56)}`,
    ...facts,
    effectiveFrom: input.effectiveFrom,
    effectiveUntil: input.effectiveUntil,
    status: 'active',
    bindingDigest,
    supersededAt: null,
  };
}

async function loadActiveExactAuthorityCandidates(
  tx: MaterializationTx,
  input: ExactActionAuthorityMaterializationInput,
): Promise<ExactActionAuthorityBindingRecord[]> {
  const contractVersionId = String(input.contractVersionId || '');
  const rows = await tx.actionAuthorityPolicyBinding.findMany({
    where: {
      governanceHomeType: input.home.homeType,
      governanceHomeRef: input.home.homeRef,
      ...(contractVersionId ? { contractVersionId } : {}),
      purpose: 'collective_decision',
      status: 'active',
      supersededAt: null,
    },
  });
  return rows.map((row) => ({
    id: String(row.id),
    governanceHomeType: String(row.governanceHomeType),
    governanceHomeRef: String(row.governanceHomeRef),
    contractVersionId: String(row.contractVersionId),
    sourceType: String(row.sourceType),
    sourceRef: String(row.sourceRef),
    sourceVersion: String(row.sourceVersion ?? ''),
    purpose: String(row.purpose),
    selector: asRecord(row.selector),
    limits: asRecord(row.limits),
    effectiveFrom: new Date(row.effectiveFrom),
    effectiveUntil: row.effectiveUntil == null ? null : new Date(row.effectiveUntil),
    status: String(row.status),
    bindingDigest: String(row.bindingDigest),
    supersededAt: row.supersededAt == null ? null : new Date(row.supersededAt),
  }));
}

export function overlapsExactAuthorityScope(
  left: ExactActionAuthorityBindingRecord,
  right: ExactActionAuthorityBindingRecord,
): boolean {
  const leftSelector = asRecord(left.selector);
  const rightSelector = asRecord(right.selector);
  return left.governanceHomeType === right.governanceHomeType
    && left.governanceHomeRef === right.governanceHomeRef
    && left.contractVersionId === right.contractVersionId
    && left.purpose === right.purpose
    && String(leftSelector.actionType ?? '') === String(rightSelector.actionType ?? '')
    && String(leftSelector.subjectType ?? '') === String(rightSelector.subjectType ?? '')
    && String(leftSelector.subjectRef ?? '') === String(rightSelector.subjectRef ?? '')
    && String(leftSelector.network ?? '') === String(rightSelector.network ?? '')
    && String(leftSelector.environment ?? '') === String(rightSelector.environment ?? '');
}

function sameExactAuthorityBinding(
  left: ExactActionAuthorityBindingRecord | any,
  right: ExactActionAuthorityBindingRecord,
): boolean {
  return String(left.id) === right.id
    && String(left.bindingDigest) === right.bindingDigest
    && String(left.governanceHomeType) === right.governanceHomeType
    && String(left.governanceHomeRef) === right.governanceHomeRef
    && String(left.contractVersionId) === right.contractVersionId
    && String(left.sourceType) === right.sourceType
    && String(left.sourceRef) === right.sourceRef
    && String(left.sourceVersion ?? '') === right.sourceVersion
    && String(left.purpose) === right.purpose
    && String(left.status) === right.status
    && left.supersededAt == null
    && right.supersededAt == null;
}

function isWithinWindow(
  effectiveFrom: Date,
  effectiveUntil: Date | null,
  now: Date,
): boolean {
  const from = new Date(effectiveFrom).getTime();
  if (!Number.isFinite(from) || from > now.getTime()) return false;
  if (effectiveUntil == null) return true;
  const until = new Date(effectiveUntil).getTime();
  return Number.isFinite(until) && until >= now.getTime();
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function isUniqueConstraintError(error: unknown): boolean {
  return !!(error && typeof error === 'object' && 'code' in error
    && String((error as { code?: unknown }).code) === 'P2002');
}
