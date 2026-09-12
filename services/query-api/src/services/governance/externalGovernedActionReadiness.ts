import { hashCanonicalGovernanceValue } from './canonicalCodec';
import type {
  GovernedActionDefinition,
  GovernedActionImpact,
  GovernedActionRuntimeAvailability,
} from './actionRegistry';
import type { GovernanceProfileWorkPin } from './governanceProfileLifecycle';

const REQUIRED_AUTHORITY_CAPABILITIES = [
  'policy_binding',
  'mandate_projection',
  'registered_adapter',
] as const;

const IMPACT_RANK: Record<GovernedActionImpact, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const SNAPSHOT_DOMAIN = 'alcheme.governance.external-governed-action-readiness-v1';

export type GovernanceHomeRef = {
  homeType: string;
  homeRef: string;
};

export type GovernedActionAdapterAvailability = {
  deployed: boolean;
  enabled: boolean;
};

export type GovernedActionSubjectRef = {
  type: string;
  ref: string;
};

export type ExactCircleGovernanceBinding = {
  id: string;
  status: string;
  actionType: string;
  subjectType: string;
  subjectRef: string;
  purpose: string;
  network: string;
  environment: string;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
};

export type ExactActionAuthorityPolicyBinding = {
  id: string;
  status: string;
  purpose: string;
  selector: {
    actionType?: string | null;
    actionPrefix?: string | null;
    subjectType?: string | null;
    subjectRef?: string | null;
    environment?: string | null;
    network?: string | null;
  };
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  riskFloor?: GovernedActionImpact | string | null;
};

export type FrozenGovernedActionContract = {
  actionType: string;
  contractVersionId: string;
  definitionDigest: string;
  runtimeAvailability?: GovernedActionRuntimeAvailability;
  unavailableReason?: string | null;
  executionAdapter: string;
  impact: GovernedActionImpact;
};

export type GovernedActionRuntimeContext = {
  network: string;
  environment: string;
  allowedNetworks: readonly string[];
  sourceDigest?: string;
};

export type GovernedActionAdapterReadiness = {
  adapter: string;
  available: boolean;
  network: string;
  reasonCode?: string;
};

export type FrozenExecutionReadinessSnapshot = {
  actionType: string;
  subject: GovernedActionSubjectRef;
  purpose: string;
  network: string;
  environment: string;
  networkSourceDigest?: string;
  contractVersionId: string;
  contractDefinitionDigest: string;
  governanceBindingId: string;
  authorityBindingId: string;
  adapter: string;
  evaluatedAt: string;
  snapshotDigest: string;
};

export type ExternalGovernedActionReadinessInput =
  | {
      phase: 'discovery';
      home: GovernanceHomeRef;
      profilePin: GovernanceProfileWorkPin;
      actionDefinition: GovernedActionDefinition;
      adapterAvailability: GovernedActionAdapterAvailability;
    }
  | {
      phase: 'execution';
      home: GovernanceHomeRef;
      profilePin: GovernanceProfileWorkPin;
      actionContract: FrozenGovernedActionContract;
      subject: GovernedActionSubjectRef;
      purpose: string;
      governanceBinding: ExactCircleGovernanceBinding | null;
      authorityBinding: ExactActionAuthorityPolicyBinding | null;
      runtimeContext: GovernedActionRuntimeContext;
      adapterReadiness: GovernedActionAdapterReadiness;
      now: Date;
    };

export type ResolvedExternalGovernedActionExecutionFacts = {
  home: GovernanceHomeRef;
  profilePin: GovernanceProfileWorkPin;
  actionContract: FrozenGovernedActionContract;
  subject: GovernedActionSubjectRef;
  purpose: string;
  governanceBinding: {
    id: string;
    status?: string | null;
    targetAuthorizationStatus?: string | null;
    committeeMandateStatus?: string | null;
    authorityPurpose?: string | null;
    authoritySelector?: Record<string, unknown> | null;
    authorityEffectiveFrom?: Date | null;
    authorityEffectiveUntil?: Date | null;
  } | null;
  authorityBinding: {
    id: string;
    status?: string | null;
    purpose?: string | null;
    selector?: unknown;
    limits?: unknown;
    effectiveFrom?: Date | null;
    effectiveUntil?: Date | null;
  } | null;
  runtimeContext: GovernedActionRuntimeContext;
  adapterReadiness: GovernedActionAdapterReadiness;
  now: Date;
};

export type ExternalGovernedActionReadinessResult =
  | { state: 'discoverable'; nextStep: 'configure_governance_binding' | 'select_subject' }
  | { state: 'ready'; snapshot: FrozenExecutionReadinessSnapshot }
  | { state: 'not_bound'; reasonCode: 'governed_action_exact_binding_required' }
  | { state: 'authority_not_ready'; reasonCode: string }
  | { state: 'adapter_unavailable'; reasonCode: string }
  | { state: 'network_mismatch'; reasonCode: string }
  | { state: 'historical_read_only'; reasonCode: string };

export function evaluateExternalGovernedActionReadiness(
  input: ExternalGovernedActionReadinessInput,
): ExternalGovernedActionReadinessResult {
  if (input.phase === 'discovery') {
    return evaluateDiscovery(input);
  }
  return evaluateExecution(input);
}

/**
 * Projects the canonical CGB/AAPB records into the shared readiness model.
 * It is intentionally read-only: callers must resolve the owners first and
 * this function never creates, repairs, or supersedes authority state.
 */
export function evaluateResolvedExternalGovernedActionExecutionReadiness(
  input: ResolvedExternalGovernedActionExecutionFacts,
): ExternalGovernedActionReadinessResult {
  const governanceSelector = asRecord(input.governanceBinding?.authoritySelector);
  const authoritySelector = asRecord(input.authorityBinding?.selector);
  const authorityLimits = asRecord(input.authorityBinding?.limits);
  const governanceBindingAccepted = input.governanceBinding?.status === 'active'
    && input.governanceBinding.targetAuthorizationStatus === 'accepted'
    && input.governanceBinding.committeeMandateStatus === 'accepted';
  return evaluateExternalGovernedActionReadiness({
    phase: 'execution',
    home: input.home,
    profilePin: input.profilePin,
    actionContract: input.actionContract,
    subject: input.subject,
    purpose: input.purpose,
    governanceBinding: input.governanceBinding
      ? {
          id: input.governanceBinding.id,
          status: governanceBindingAccepted ? 'active' : 'not_active',
          actionType: stringValue(governanceSelector.actionType),
          subjectType: stringValue(governanceSelector.subjectType),
          subjectRef: stringValue(governanceSelector.subjectRef),
          purpose: stringValue(input.governanceBinding.authorityPurpose),
          network: stringValue(governanceSelector.network),
          environment: stringValue(governanceSelector.environment),
          effectiveFrom: dateValue(input.governanceBinding.authorityEffectiveFrom),
          effectiveUntil: nullableDateValue(input.governanceBinding.authorityEffectiveUntil),
        }
      : null,
    authorityBinding: input.authorityBinding
      ? {
          id: input.authorityBinding.id,
          status: stringValue(input.authorityBinding.status),
          purpose: stringValue(input.authorityBinding.purpose),
          selector: {
            actionType: nullableStringValue(authoritySelector.actionType),
            actionPrefix: nullableStringValue(authoritySelector.actionPrefix),
            subjectType: nullableStringValue(authoritySelector.subjectType),
            subjectRef: nullableStringValue(authoritySelector.subjectRef),
            environment: nullableStringValue(authoritySelector.environment),
            network: nullableStringValue(authoritySelector.network),
          },
          effectiveFrom: dateValue(input.authorityBinding.effectiveFrom),
          effectiveUntil: nullableDateValue(input.authorityBinding.effectiveUntil),
          riskFloor: nullableStringValue(authorityLimits.riskFloor),
        }
      : null,
    runtimeContext: input.runtimeContext,
    adapterReadiness: input.adapterReadiness,
    now: input.now,
  });
}

export function requireResolvedExternalGovernedActionExecutionReadiness(
  input: ResolvedExternalGovernedActionExecutionFacts,
): FrozenExecutionReadinessSnapshot {
  const result = evaluateResolvedExternalGovernedActionExecutionReadiness(input);
  if (result.state !== 'ready') {
    throw new Error('reasonCode' in result
      ? result.reasonCode
      : 'governed_action_execution_not_ready');
  }
  return result.snapshot;
}

function evaluateDiscovery(
  input: Extract<ExternalGovernedActionReadinessInput, { phase: 'discovery' }>,
): ExternalGovernedActionReadinessResult {
  if (input.actionDefinition.runtimeAvailability === 'historical_read_only') {
    return {
      state: 'historical_read_only',
      reasonCode: input.actionDefinition.unavailableReason?.trim()
        || 'governed_action_historical_read_only',
    };
  }
  if (!hasExternalGovernedActionAuthorityCapabilities(
    input.profilePin.definition.authorityCapabilities,
  )) {
    return {
      state: 'authority_not_ready',
      reasonCode: 'governed_action_authority_capability_required',
    };
  }
  if (!input.actionDefinition.actionType?.trim()) {
    return {
      state: 'adapter_unavailable',
      reasonCode: 'governed_action_not_registered',
    };
  }
  if (!input.adapterAvailability.deployed || !input.adapterAvailability.enabled) {
    return {
      state: 'adapter_unavailable',
      reasonCode: 'governed_action_adapter_unavailable',
    };
  }
  return {
    state: 'discoverable',
    nextStep: 'configure_governance_binding',
  };
}

function evaluateExecution(
  input: Extract<ExternalGovernedActionReadinessInput, { phase: 'execution' }>,
): ExternalGovernedActionReadinessResult {
  if (input.actionContract.runtimeAvailability === 'historical_read_only') {
    return {
      state: 'historical_read_only',
      reasonCode: input.actionContract.unavailableReason?.trim()
        || 'governed_action_historical_read_only',
    };
  }
  if (!hasExternalGovernedActionAuthorityCapabilities(
    input.profilePin.definition.authorityCapabilities,
  )) {
    return {
      state: 'authority_not_ready',
      reasonCode: 'governed_action_authority_capability_required',
    };
  }

  const subjectType = input.subject.type.trim();
  const subjectRef = input.subject.ref.trim();
  const purpose = input.purpose.trim();
  if (!subjectType || !subjectRef || !purpose) {
    return {
      state: 'not_bound',
      reasonCode: 'governed_action_exact_binding_required',
    };
  }

  const binding = input.governanceBinding;
  if (
    !binding
    || binding.status !== 'active'
    || binding.actionType !== input.actionContract.actionType
    || binding.subjectType !== subjectType
    || binding.subjectRef !== subjectRef
    || binding.purpose !== purpose
    || binding.environment !== input.runtimeContext.environment
    || !isWithinWindow(binding.effectiveFrom, binding.effectiveUntil, input.now)
  ) {
    return {
      state: 'not_bound',
      reasonCode: 'governed_action_exact_binding_required',
    };
  }

  const authority = input.authorityBinding;
  if (
    !authority
    || authority.status !== 'active'
    || authority.purpose !== purpose
    || authority.selector.actionType !== input.actionContract.actionType
    || authority.selector.actionPrefix
    || authority.selector.subjectType !== subjectType
    || authority.selector.subjectRef !== subjectRef
    || authority.selector.environment !== input.runtimeContext.environment
    || !isWithinWindow(authority.effectiveFrom, authority.effectiveUntil, input.now)
    || !riskFloorSatisfied(authority.riskFloor, input.actionContract.impact)
  ) {
    return {
      state: 'authority_not_ready',
      reasonCode: 'governed_action_authority_not_ready',
    };
  }

  const runtimeNetwork = input.runtimeContext.network.trim();
  const adapterNetwork = input.adapterReadiness.network.trim();
  const bindingNetwork = binding.network.trim();
  const authorityNetwork = String(authority.selector.network ?? '').trim();
  if (
    !runtimeNetwork
    || !input.runtimeContext.allowedNetworks.includes(runtimeNetwork)
    || bindingNetwork !== runtimeNetwork
    || authorityNetwork !== runtimeNetwork
    || adapterNetwork !== runtimeNetwork
  ) {
    return {
      state: 'network_mismatch',
      reasonCode: 'governed_action_network_mismatch',
    };
  }

  if (!input.adapterReadiness.available) {
    return {
      state: 'adapter_unavailable',
      reasonCode: input.adapterReadiness.reasonCode?.trim()
        || 'governed_action_adapter_unavailable',
    };
  }
  if (input.adapterReadiness.adapter !== input.actionContract.executionAdapter) {
    return {
      state: 'adapter_unavailable',
      reasonCode: 'governed_action_adapter_mismatch',
    };
  }

  const evaluatedAt = input.now.toISOString();
  const networkSourceDigest = input.runtimeContext.sourceDigest?.trim() || undefined;
  const snapshotBase = {
    actionType: input.actionContract.actionType,
    subject: { type: subjectType, ref: subjectRef },
    purpose,
    network: runtimeNetwork,
    environment: input.runtimeContext.environment,
    ...(networkSourceDigest ? { networkSourceDigest } : {}),
    contractVersionId: input.actionContract.contractVersionId,
    contractDefinitionDigest: input.actionContract.definitionDigest,
    governanceBindingId: binding.id,
    authorityBindingId: authority.id,
    adapter: input.actionContract.executionAdapter,
    evaluatedAt,
  };
  return {
    state: 'ready',
    snapshot: {
      ...snapshotBase,
      snapshotDigest: hashCanonicalGovernanceValue(SNAPSHOT_DOMAIN, snapshotBase),
    },
  };
}

export function hasExternalGovernedActionAuthorityCapabilities(
  capabilities: readonly string[],
): boolean {
  return REQUIRED_AUTHORITY_CAPABILITIES.every((capability) =>
    capabilities.includes(capability));
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
  return Number.isFinite(until) && until > now.getTime();
}

function riskFloorSatisfied(
  riskFloor: GovernedActionImpact | string | null | undefined,
  actionImpact: GovernedActionImpact,
): boolean {
  if (typeof riskFloor !== 'string' || !(riskFloor in IMPACT_RANK)) return false;
  return IMPACT_RANK[riskFloor as GovernedActionImpact] >= IMPACT_RANK[actionImpact];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nullableStringValue(value: unknown): string | null {
  if (value == null) return null;
  const normalized = stringValue(value);
  return normalized || null;
}

function dateValue(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value ?? 'invalid'));
}

function nullableDateValue(value: unknown): Date | null {
  return value == null ? null : dateValue(value);
}
