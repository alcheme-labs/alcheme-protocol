import type { PrismaClient } from "@prisma/client";

import {
  AuthActorError,
  resolveAuthenticatedActor,
  resolveCircleActorForAuthActor,
} from "../auth/actor";
import type {
  GovernanceLegacyExecutionCompatibilityDescriptor,
} from './legacyExecutionCompatibility';
import { hashCanonicalGovernanceValue } from './canonicalCodec';
import {
  isCurrentRealmsVotingPowerSecurityProfile,
  type RealmsVotingPowerSecurityProfile,
} from './realmsDevnetProvider';
import { validRealmsProviderFinalityTransitions } from './realmsProviderFinality';
import {
  getRealmsProviderTrustProfile,
  resolveRealmsProviderTrustReadiness,
} from './realmsProviderTrustProfile';
import {
  getSquadsProviderTrustProfile,
  resolveSquadsProviderTrustReadiness,
} from './squadsProviderTrustProfile';
import { buildProviderExecutionActionContext } from './providerExecutionActionContext';
import { REALMS_PROVIDER_DELEGATION_CONFORMANCE_ACTION_TYPE } from './actionRegistry';
import { isCurrentGovernanceCaseFrozenEvidencePolicy } from './governanceEvidenceShare';
import {
  buildGovernanceExecutionResourceMappingArtifact,
  buildNativeDecisionOutputArtifact,
  decisionOutputArtifactMatches,
  projectDecisionOutputArtifact,
} from './decisionOutputArtifact';
import { verifyProviderTransactionAttemptInventory } from './providerTransactionAttempt';
import { projectFeeAbstractionPlanReadback } from './koraFeeAbstraction';

export type GovernanceReadAudience = "public" | "member" | "operator";

export interface GovernanceReadProjectionReason {
  audience: GovernanceReadAudience;
  reason: string;
  publiclyReadable: boolean;
}

export type GovernanceDecisionReadStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'unavailable';

export type GovernanceExecutionReadStatus =
  | 'not_ready'
  | 'not_required'
  | 'pending'
  | 'executed'
  | 'expired'
  | 'failed'
  | 'skipped'
  | 'unavailable';

export interface GovernanceDecisionExecutionStatusProjection {
  decisionStatus: GovernanceDecisionReadStatus;
  executionStatus: GovernanceExecutionReadStatus;
}

export function projectGovernanceDecisionExecutionStatus(
  request: any,
): GovernanceDecisionExecutionStatusProjection {
  const requestState = normalizeRequestState(request?.state);
  const decision = normalizeDecisionStatus(request?.decision?.decision);
  const decisionStatus = decision && decisionMatchesRequestState(decision, requestState)
    ? decision
    : decision && requestState !== 'unavailable'
      ? 'unavailable'
      : requestState;

  const receipts = Array.isArray(request?.receipts) ? request.receipts : [];
  if (receipts.length > 0) {
    const latestReceipt = latestExecutionReceipt(receipts);
    if (isRealmsProviderExecutionExpiryCandidate(latestReceipt)) {
      return {
        decisionStatus,
        executionStatus: projectRealmsProviderExecutionExpiryReadback(
          request,
          latestReceipt,
        ) ? 'expired' : 'unavailable',
      };
    }
    if (
      latestReceipt?.executorModule === 'realms_provider_binding'
      && latestReceipt?.executionStatus === 'executed'
    ) {
      if (!verifiedRealmsProviderExecutionReceipt(request, latestReceipt)) {
        return { decisionStatus, executionStatus: 'unavailable' };
      }
      const reconciliation = projectRealmsProviderReconciliation(request, latestReceipt);
      if (reconciliation?.integrity === 'invalid') {
        return { decisionStatus, executionStatus: 'unavailable' };
      }
      if (reconciliation?.state === 'hold') {
        return { decisionStatus, executionStatus: 'pending' };
      }
    }
    if (
      latestReceipt?.executorModule === 'squads_provider_binding'
      && latestReceipt?.executionStatus === 'executed'
      && !verifiedSquadsProviderExecutionReceipt(request, latestReceipt)
    ) {
      return { decisionStatus, executionStatus: 'unavailable' };
    }
    const latestStatus = normalizeExecutionStatus(
      latestReceipt?.executionStatus,
    );
    return {
      decisionStatus,
      executionStatus: latestStatus ?? 'unavailable',
    };
  }

  return {
    decisionStatus,
    executionStatus: decisionStatus === 'accepted'
      ? 'pending'
      : decisionStatus === 'rejected'
        || decisionStatus === 'expired'
        || decisionStatus === 'cancelled'
        ? 'not_required'
        : decisionStatus === 'pending'
          ? 'not_ready'
          : 'unavailable',
  };
}

export function projectPublicGovernanceRequest(
  request: any,
  input: {
    executionCompatibility?: GovernanceLegacyExecutionCompatibilityDescriptor | null;
  } = {},
): {
  projection: GovernanceReadProjectionReason;
  request: Record<string, unknown>;
} {
  const decision = request?.decision
    ? compactObject({
      decision: optionalString(request.decision.decision),
      reason: optionalString(request.decision.reason),
      decidedAt: dateTime(request.decision.decidedAt),
      decisionDigest: optionalString(request.decision.decisionDigest),
    })
    : null;
  const status = projectGovernanceDecisionExecutionStatus(request);
  return {
    projection: {
      audience: "public",
      reason: "public_safe_default",
      publiclyReadable: true,
    },
    request: compactObject({
      id: requiredString(request?.id),
      actionType: requiredString(request?.actionType),
      targetType: requiredString(request?.targetType),
      targetRef: requiredString(request?.targetRef),
      state: requiredString(request?.state),
      openedAt: dateTime(request?.openedAt),
      expiresAt: dateTime(request?.expiresAt),
      resolvedAt: dateTime(request?.resolvedAt),
      decisionStatus: status.decisionStatus,
      executionStatus: status.executionStatus,
      decision,
      providerExecutionStatus: projectGovernancePublicProviderExecutionStatus(request),
      providerExecutionReference: projectGovernancePublicProviderExecutionReference(request),
      executionCompatibility: input.executionCompatibility ?? null,
    }),
  };
}

function normalizeRequestState(value: unknown): GovernanceDecisionReadStatus {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'active') return 'pending';
  if (
    normalized === 'accepted'
    || normalized === 'rejected'
    || normalized === 'expired'
    || normalized === 'cancelled'
  ) {
    return normalized;
  }
  return 'unavailable';
}

function normalizeDecisionStatus(
  value: unknown,
): 'accepted' | 'rejected' | 'expired' | 'cancelled' | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'accepted'
    || normalized === 'rejected'
    || normalized === 'expired'
    || normalized === 'cancelled'
    ? normalized
    : null;
}

function decisionMatchesRequestState(
  decision: 'accepted' | 'rejected' | 'expired' | 'cancelled',
  requestState: GovernanceDecisionReadStatus,
): boolean {
  return decision === requestState;
}

function normalizeExecutionStatus(
  value: unknown,
): 'executed' | 'failed' | 'skipped' | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'executed'
    || normalized === 'failed'
    || normalized === 'skipped'
    ? normalized
    : null;
}

export async function resolveGovernanceRequestReadProjection(
  req: any,
  prisma: PrismaClient,
  request: any,
): Promise<GovernanceReadProjectionReason> {
  const actor = await resolveAuthenticatedActor(req, prisma, {
    requireSessionCookie: true,
  });
  if (actor && request?.proposerPubkey === actor.pubkey) {
    return {
      audience: 'member',
      reason: 'request_proposer',
      publiclyReadable: false,
    };
  }
  const circleId = governanceRequestTargetCircleId(request);
  if (!circleId) {
    throw governanceReadDenied("governance_request_circle_unresolved");
  }
  return resolveGovernanceCircleReadProjection(req, prisma, circleId);
}

export async function resolveGovernanceCircleReadProjection(
  req: any,
  prisma: PrismaClient,
  circleId: number,
): Promise<GovernanceReadProjectionReason> {
  const circle = await prisma.circle.findUnique({
    where: { id: circleId },
    select: { id: true, circleType: true },
  });
  if (!circle) {
    throw governanceReadDenied("governance_request_circle_not_found");
  }

  const actor = await resolveAuthenticatedActor(req, prisma, {
    requireSessionCookie: true,
  });
  if (actor) {
    try {
      const circleActor = await resolveCircleActorForAuthActor(actor, prisma, {
        circleId,
        action: "circle.read",
      });
      if (circleActor) {
        const audience = circleActor.membership.role === "Owner"
          || circleActor.membership.role === "Admin"
          || circleActor.membership.role === "Moderator"
          ? "operator"
          : "member";
        return {
          audience,
          reason: audience === "operator" ? "circle_operator" : "circle_member",
          publiclyReadable: circle.circleType === "Open",
        };
      }
    } catch (error) {
      if (!(error instanceof AuthActorError) || circle.circleType !== "Open") {
        throw error;
      }
    }
  }

  if (circle.circleType === "Open") {
    return { audience: "public", reason: "public_safe_default", publiclyReadable: true };
  }
  throw governanceReadDenied("circle_visibility_denied");
}

export function projectGovernanceRequest(
  request: any,
  projection: GovernanceReadProjectionReason,
  input: {
    executionCompatibility?: GovernanceLegacyExecutionCompatibilityDescriptor | null;
  } = {},
): ReturnType<typeof projectPublicGovernanceRequest> {
  const result = projectPublicGovernanceRequest(request, input);
  if (projection.audience === "public") {
    return { ...result, projection };
  }
  const memberRequest = compactObject({
    ...result.request,
    decision: request?.decision
      ? compactObject({
          decision: optionalString(request.decision.decision),
          reason: optionalString(request.decision.reason),
          tally: projectAggregateGovernanceTally(request.decision.tally),
          decidedAt: dateTime(request.decision.decidedAt),
          decisionDigest: optionalString(request.decision.decisionDigest),
        })
      : null,
    policyVersion: Number.isInteger(Number(request?.policyVersion))
      ? Number(request.policyVersion)
      : null,
    ruleId: optionalString(request?.ruleId),
    scopeType: optionalString(request?.scopeType),
    scopeRef: optionalString(request?.scopeRef),
    preExecutionCost: projectGovernancePreExecutionCostReadback(request),
    providerResourceExecutionAdmission:
      projectGovernanceProviderResourceExecutionAdmissionReadback(request),
    providerExecution: projectGovernanceProviderExecutionReadback(request),
  });
  if (projection.audience === "member") {
    return { projection, request: memberRequest };
  }
  const operatorDecision = request?.decision
    ? compactObject({
        decision: optionalString(request.decision.decision),
        reason: optionalString(request.decision.reason),
        tally: isRecord(request.decision.tally) ? request.decision.tally : {},
        decidedAt: dateTime(request.decision.decidedAt),
        decisionDigest: optionalString(request.decision.decisionDigest),
        envelopeVersion: Number.isInteger(Number(request.decision.envelopeVersion))
          ? Number(request.decision.envelopeVersion)
          : null,
        requestDigest: optionalString(request.decision.requestDigest),
        payloadDigest: optionalString(request.decision.payloadDigest),
        policyDigest: optionalString(request.decision.policyDigest),
        snapshotDigest: optionalString(request.decision.snapshotDigest),
      })
    : null;
  return {
    projection,
    request: compactObject({
      ...memberRequest,
      decision: operatorDecision,
      policyId: optionalString(request?.policyId),
      policyVersionId: optionalString(request?.policyVersionId),
      idempotencyKey: optionalString(request?.idempotencyKey),
      proposerPubkey: optionalString(request?.proposerPubkey),
    }),
  };
}

export function projectGovernanceProviderResourceExecutionAdmissionReadback(
  request: any,
): Record<string, unknown> | null {
  if (request?.decision?.decision !== 'accepted') return null;
  const binding = request?.providerResourceBinding;
  if (!binding) return null;
  const payload = isRecord(request?.payload) ? request.payload : null;
  const payloadResource = isRecord(payload?.resourceBinding) ? payload.resourceBinding : null;
  const preflight = Array.isArray(request?.invocation?.costPreflights)
    ? request.invocation.costPreflights[0]
    : null;
  const receipts = Array.isArray(request?.receipts) ? request.receipts : [];
  const terminalReceipt = latestExecutionReceipt(receipts.filter((receipt: any) => (
    receipt?.executionStatus === 'executed'
      && ['realms_provider_binding', 'squads_provider_binding'].includes(receipt?.executorModule)
  )));
  const terminalEvidence = isRecord(terminalReceipt?.executionEvidence)
    ? terminalReceipt.executionEvidence
    : null;
  const explicitResourceIds = [
    optionalString(payloadResource?.id),
    optionalString(preflight?.quoteContext?.resourceBindingId),
    optionalString(terminalEvidence?.resourceBindingId),
    optionalString(terminalEvidence?.grantResourceBindingId),
  ].filter((value): value is string => Boolean(value));
  const providerModule = String(binding.provider ?? '').includes('squads')
    || String(binding.profileRef ?? '').includes('squads')
    ? 'squads_provider_binding'
    : String(binding.provider ?? '').includes('realms')
      || String(binding.profileRef ?? '').includes('realms')
      ? 'realms_provider_binding'
      : null;
  if (!providerModule) return null;
  const trust = providerModule === 'realms_provider_binding'
    ? resolveRealmsProviderTrustReadiness()
    : resolveSquadsProviderTrustReadiness();
  const artifactMapping = projectProviderExecutionResourceArtifactMapping(
    request,
    binding,
    providerModule,
  );
  const verifiedSlot = Number(binding.verifiedSlot);
  const authorities = Array.isArray(binding.authorityBindings)
    ? binding.authorityBindings.filter((authority: any) => (
      authority?.status === 'active'
      && authority?.network === binding.network
      && authority?.provider === binding.provider
      && authority?.profileRef === binding.profileRef
      && Number(authority?.profileVersion) === Number(binding.profileVersion)
      && authority?.providerResourceRef === binding.resourceRef
      && authority?.ownerProgramRef === binding.ownerProgramRef
      && optionalString(authority?.authorityRole)
      && optionalString(authority?.currentAuthority)
      && optionalString(authority?.custodyProvider)
      && optionalString(authority?.custodyStatus)
      && Array.isArray(authority?.allowedOperations)
      && authority.allowedOperations.length > 0
      && authority.allowedOperations.every(optionalString)
      && Number(authority?.verifiedSlot) === verifiedSlot
      && authority?.stateDigest === binding.stateDigest
      && authority?.sourceRequestId === request.id
      && authority?.sourceDecisionDigest === request.decision.decisionDigest
    ))
    : [];
  if (
    explicitResourceIds.length === 0
    || explicitResourceIds.some((resourceId) => resourceId !== binding.id)
    || binding.status !== 'active'
    || !optionalString(binding.network)
    || binding.network !== trust.chainId
    || !optionalString(binding.provider)
    || !optionalString(binding.capability)
    || !optionalString(binding.resourceType)
    || !optionalString(binding.resourceRef)
    || !optionalString(binding.ownerProgramRef)
    || binding.ownerProgramRef !== trust.programId
    || !optionalString(binding.purpose)
    || binding.profileRef !== trust.profileRef
    || Number(binding.profileVersion) !== Number(trust.profileVersion)
    || !Number.isSafeInteger(verifiedSlot)
    || verifiedSlot <= 0
    || !isSha256(binding.stateDigest)
    || !providerResourceBindingLineageMatchesRequest(binding, request)
    || authorities.length === 0
  ) return null;
  return {
    schemaVersion: 1,
    authority: 'canonical_governed_resource_and_active_authority_bindings',
    state: 'admitted_for_exact_provider_execution',
    source: 'explicit_request_preflight_or_terminal_receipt_resource_id',
    titleInferenceAllowed: false,
    requestId: String(request.id),
    decisionDigest: String(request.decision.decisionDigest),
    binding: {
      id: String(binding.id),
      cluster: String(binding.network),
      provider: String(binding.provider),
      providerModule,
      capability: String(binding.capability),
      resourceType: String(binding.resourceType),
      resourceRef: String(binding.resourceRef),
      ownerProgramRef: String(binding.ownerProgramRef),
      purpose: String(binding.purpose),
      profileRef: String(binding.profileRef),
      profileVersion: Number(binding.profileVersion),
      verifiedSlot,
      stateDigest: String(binding.stateDigest),
      status: 'active',
    },
    controllingAuthorities: authorities.map((authority: any) => ({
      bindingId: String(authority.id),
      role: String(authority.authorityRole),
      publicAuthority: String(authority.currentAuthority),
      custodyProvider: String(authority.custodyProvider),
      custodyStatus: String(authority.custodyStatus),
      allowedOperations: authority.allowedOperations.map(String),
      keyRefExposed: false,
    })),
    artifactMapping,
    executionAdmission: {
      exactResourceActive: true,
      exactOwnerProgramVerified: true,
      controllingAuthorityActive: true,
      providerStateReadbackVerified: true,
    },
  };
}

function projectProviderExecutionResourceArtifactMapping(
  request: any,
  binding: any,
  providerModule: 'realms_provider_binding' | 'squads_provider_binding',
): Record<string, unknown> | null {
  const artifacts = Array.isArray(request?.decisionOutputArtifacts)
    ? request.decisionOutputArtifacts
    : [];
  const artifact = artifacts.find((candidate: any) => (
    candidate?.kind === 'execution_resource_mapping'
  ));
  if (!artifact) return null;
  const projected = projectDecisionOutputArtifact(artifact, { includeSourceRef: false });
  const mapping = isRecord(artifact?.constraints?.resourceMapping)
    ? artifact.constraints.resourceMapping
    : null;
  const execution = isRecord(artifact?.constraints?.execution)
    ? artifact.constraints.execution
    : null;
  const enforcementBinding = isRecord(artifact?.constraints?.enforcementBinding)
    ? artifact.constraints.enforcementBinding
    : null;
  const authorityScope = isRecord(enforcementBinding?.authorityScope)
    ? enforcementBinding.authorityScope
    : null;
  let expectedEnforcementBinding: Record<string, unknown> | null = null;
  try {
    expectedEnforcementBinding = buildGovernanceExecutionResourceMappingArtifact({
      caseId: String(artifact.caseId ?? ''),
      subjectType: String(artifact.subjectType ?? ''),
      subjectRef: String(artifact.subjectRef ?? ''),
      decisionRequestId: String(request.id ?? ''),
      decision: String(request?.decision?.decision ?? ''),
      decisionDigest: String(request?.decision?.decisionDigest ?? ''),
      actionType: String(request.actionType ?? ''),
      targetType: String(request.targetType ?? ''),
      targetRef: String(request.targetRef ?? ''),
      actionPayload: request.payload,
      createdAt: artifact.createdAt instanceof Date
        ? artifact.createdAt
        : new Date(String(artifact.createdAt ?? '')),
    })?.constraints.enforcementBinding ?? null;
  } catch {
    return null;
  }
  const expectedSourceDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.execution-resource-mapping-source-v1',
    {
      actionType: request.actionType,
      targetType: request.targetType,
      targetRef: request.targetRef,
      payload: request.payload,
    },
  );
  if (
    projected.integrity !== 'verified'
    || artifact.decisionRequestId !== request.id
    || artifact.decisionDigest !== request?.decision?.decisionDigest
    || artifact.sourceDigest !== expectedSourceDigest
    || mapping?.actionType !== request.actionType
    || mapping?.caseSubject?.type !== request.targetType
    || mapping?.caseSubject?.ref !== request.targetRef
    || mapping?.actionTarget?.type !== request.targetType
    || mapping?.actionTarget?.ref !== request.targetRef
    || mapping?.executableResource?.bindingId !== binding.id
    || mapping?.source !== 'exact_accepted_request_payload'
    || mapping?.titleInferenceAllowed !== false
    || mapping?.governingDecisionDigest !== request.decision.decisionDigest
    || execution?.mode !== 'adapter'
    || execution?.adapterRef !== providerModule
    || execution?.providerReadiness !== 'canonical_resource_binding_required'
    || execution?.automaticExecution !== false
    || !enforcementBinding
    || !authorityScope
    || !expectedEnforcementBinding
    || hashCanonicalGovernanceValue(
      'alcheme.governance.execution-enforcement-binding-readback-v1',
      enforcementBinding,
    ) !== hashCanonicalGovernanceValue(
      'alcheme.governance.execution-enforcement-binding-readback-v1',
      expectedEnforcementBinding,
    )
    || enforcementBinding.resourceBindingId !== binding.id
    || enforcementBinding.providerModule !== providerModule
    || enforcementBinding.allowedAdapter !== providerModule
    || enforcementBinding.mode !== (providerModule === 'squads_provider_binding'
      ? 'multisig_threshold'
      : 'provider_onchain')
    || enforcementBinding.decisionLinkage?.requestId !== request.id
    || enforcementBinding.decisionLinkage?.decisionDigest !== request.decision.decisionDigest
    || enforcementBinding.verificationState !== 'frozen_pending_live_preflight'
    || enforcementBinding.bypassPrevented !== false
    || (Number.isSafeInteger(Number(binding.contractVersion))
      && Number(binding.contractVersion) > 0
      && Number(enforcementBinding.contractVersion) !== Number(binding.contractVersion))
    || Number(enforcementBinding.profileVersion) !== Number(binding.profileVersion)
    || authorityScope.source !== 'exact_request_authority_bindings_or_action_scope'
    || !isSha256(authorityScope.scopeDigest)
    || !Array.isArray(authorityScope.bindingIds)
    || authorityScope.bindingIds.some((id: unknown) => !optionalString(id))
    || !Array.isArray(enforcementBinding.allowedOperations)
    || enforcementBinding.allowedOperations.length === 0
    || new Set(enforcementBinding.allowedOperations).size
      !== enforcementBinding.allowedOperations.length
  ) return null;
  return {
    artifactId: String(artifact.id),
    artifactDigest: String(artifact.artifactDigest),
    decisionDigest: String(artifact.decisionDigest),
    resourceBindingId: String(binding.id),
    source: 'exact_accepted_request_payload',
    titleInferenceAllowed: false,
    adapterRef: providerModule,
    enforcementBinding: {
      resourceBindingId: String(enforcementBinding.resourceBindingId),
      authorityScopeDigest: String(authorityScope.scopeDigest),
      authorityBindingIds: authorityScope.bindingIds.map(String),
      providerModule,
      mode: String(enforcementBinding.mode),
      allowedAdapter: providerModule,
      allowedOperations: enforcementBinding.allowedOperations.map(String),
      residualBypassRisk: String(enforcementBinding.residualBypassRisk),
      bypassPrevented: false,
      verificationState: 'frozen_pending_live_preflight',
      contractVersion: Number(enforcementBinding.contractVersion),
      profileVersion: Number(enforcementBinding.profileVersion),
    },
  };
}

export function projectGovernanceProviderExecutionProgressReadback(
  request: any,
): Record<string, unknown> | null {
  if (request?.decision?.decision !== 'accepted') return null;
  if (Array.isArray(request?.receipts) && request.receipts.some((receipt: any) => (
    receipt?.executionStatus === 'executed'
      && ['realms_provider_binding', 'squads_provider_binding'].includes(receipt?.executorModule)
  ))) return null;
  const preflight = Array.isArray(request?.invocation?.costPreflights)
    ? request.invocation.costPreflights[0]
    : null;
  const estimatedCost = isRecord(preflight?.estimatedCost) ? preflight.estimatedCost : null;
  const checkpoint = isRecord(estimatedCost?.providerCheckpoint)
    ? estimatedCost.providerCheckpoint
    : null;
  const rawSteps = Array.isArray(checkpoint?.steps) ? checkpoint.steps : [];
  if (!checkpoint || rawSteps.length === 0 || rawSteps.length > 12) return null;
  const stepIds = rawSteps.map((step: any) => optionalString(step?.id));
  if (stepIds.some((stepId: string | null) => !stepId)
    || new Set(stepIds).size !== stepIds.length) return null;
  const profileRef = optionalString(preflight?.quoteContext?.profileRef)
    ?? optionalString(preflight?.payerPolicy?.profileRef);
  const delegation = stepIds.some((stepId: string | null) => (
    stepId === 'set_governance_delegate' || stepId === 'revoke_governance_delegate'
  )) || isRecord(checkpoint?.baseline);
  const expectedStepIds = delegation
    ? ['set_governance_delegate', 'revoke_governance_delegate']
    : profileRef?.includes('squads')
      ? [
          'create_multisig',
          'create_vault_transaction',
          'create_proposal',
          'approve_by_proposer',
          'approve_by_approver',
          'execute_vault_transaction',
        ]
      : [
          'create_community_mint',
          'create_realm_and_electorate',
          'create_governance',
          'create_and_sign_off_proposal',
          'cast_vote',
          'execute_no_asset_instruction',
        ];
  const statusOrder = ['quoted', 'signed', 'submitted', 'confirmed', 'finalized'];
  if (rawSteps.some((step: any, index: number) => (
    step.id !== expectedStepIds[index]
    || !statusOrder.includes(step.status)
    || !isSha256(step.manifestDigest)
    || (step.messageDigest !== undefined && !isSha256(step.messageDigest))
  ))) return null;
  const completed = rawSteps.filter((step: any) => step.status === 'finalized');
  if (completed.length === 0 || completed.length === expectedStepIds.length) return null;
  if (completed.some((step: any) => (
    !optionalString(step.signature)
    || !Number.isSafeInteger(Number(step.slot))
    || Number(step.slot) <= 0
    || !isSha256(step.messageDigest)
    || !isSha256(step.manifestDigest)
  ))) return null;
  const remaining = expectedStepIds.slice(completed.length);
  const activeStep = rawSteps.find((step: any) => step.status !== 'finalized') ?? null;
  const expiredAttemptCount = Array.isArray(checkpoint?.expiredAttempts)
    ? checkpoint.expiredAttempts.length
    : 0;
  const progress = {
    schemaVersion: 1,
    authority: 'canonical_cost_preflight_provider_checkpoint',
    state: 'partially_executed',
    aggregateRule: 'executed_only_when_all_ordered_steps_authoritatively_finalized',
    completed: completed.map((step: any) => ({
      stepId: String(step.id),
      expectedStateChange: PROVIDER_EXPECTED_STATE_CHANGES[String(step.id)],
      finality: 'finalized',
      actionReceipt: {
        authority: 'canonical_provider_checkpoint_finalized_transaction',
        providerReference: String(step.signature),
        observedSlot: Number(step.slot),
        messageDigest: String(step.messageDigest),
        manifestDigest: String(step.manifestDigest),
      },
      irreversibleChange: 'provider_state_change_finalized_requires_governed_compensation_if_abandoned',
    })),
    remaining,
    active: activeStep ? {
      stepId: String(activeStep.id),
      status: String(activeStep.status),
    } : null,
    expiredAttemptCount,
    compensation: {
      state: 'not_required_without_terminal_abandonment_decision',
      owner: 'unavailable_requires_governed_assignment',
      directOperatorMutationAllowed: false,
    },
    resolutionPolicy: {
      authority: 'original_decision_authority_or_frozen_contingency_rule',
      deterministicResume: {
        mode: 'same_artifact_next_ordered_step',
        originalArtifactRequired: true,
        sameRequestOnly: true,
      },
      choices: {
        replan: 'requires_original_decision_authority_case',
        acceptPartial: 'requires_original_decision_authority_case',
        compensate: 'requires_original_decision_authority_case',
        terminateRemaining: 'requires_original_decision_authority_case',
      },
      emergencyActorPermanentDeviationAllowed: false,
    },
    outcome: {
      authority: 'canonical_provider_checkpoint_and_terminal_resolution_case',
      realizedActionIds: completed.map((step: any) => String(step.id)),
      unrealizedActionIds: remaining,
      irreversibleImpacts: completed.map((step: any) => (
        `${String(step.id)} finalized at provider slot ${Number(step.slot)}`
      )),
      remainingObligations: [
        'continue_original_artifact_or_open_original_authority_resolution_case',
      ],
      acceptedResolution: null,
      followUpCaseId: null,
      publicRecord: {
        originalDecisionFullyExecuted: false,
        displayedExecutionState: 'partially_executed_not_originally_executed',
        acceptPartialShownAsExecuted: false,
      },
    },
    nextGate: activeStep && ['signed', 'submitted', 'confirmed'].includes(activeStep.status)
      ? 'authoritative_provider_finality_readback'
      : 'continue_next_ordered_provider_step',
  };
  const terminalAbandonment = projectGovernanceProviderExecutionTerminalAbandonment(
    request,
    progress,
  );
  return terminalAbandonment
    ? {
        ...progress,
        compensation: terminalAbandonment.compensation,
        outcome: {
          ...progress.outcome,
          remainingObligations: [
            'separate_governed_compensation_plan_required',
            'original_action_intent_remains_immutable',
          ],
          acceptedResolution: 'terminate_remaining_and_compensate' as const,
          followUpCaseId: String((terminalAbandonment.compensation.owner as any).caseId),
        },
        nextGate: 'separate_governed_compensation_execution',
      }
    : progress;
}

export interface GovernanceProviderExecutionTerminalAbandonmentPayload
  extends Record<string, unknown> {
  kind: 'provider_execution_terminal_abandonment';
  originalCaseId: string;
  originalRequestId: string;
  originalDecisionDigest: string;
  providerCheckpointDigest: string;
  completedActionReceiptDigests: string[];
  remainingActionIds: string[];
  irreversibleChanges: string[];
  compensationRequirement: 'governed_compensation_plan_required';
  directOperatorMutationAllowed: false;
  reason: string;
}

export function buildGovernanceProviderExecutionTerminalAbandonmentPayload(
  request: any,
  reason: string,
): GovernanceProviderExecutionTerminalAbandonmentPayload {
  const progress = projectGovernanceProviderExecutionProgressReadback(request);
  if (!progress || progress.state !== 'partially_executed') {
    throw new Error('governance_provider_terminal_abandonment_partial_execution_required');
  }
  return providerExecutionTerminalAbandonmentPayloadFromProgress(request, progress, reason);
}

function providerExecutionTerminalAbandonmentPayloadFromProgress(
  request: any,
  progress: Record<string, any>,
  reason: string,
): GovernanceProviderExecutionTerminalAbandonmentPayload {
  const originalCaseId = optionalString(request?.governanceCase?.id);
  const originalRequestId = optionalString(request?.id);
  const originalDecisionDigest = optionalString(request?.decision?.decisionDigest);
  const preflight = Array.isArray(request?.invocation?.costPreflights)
    ? request.invocation.costPreflights[0]
    : null;
  const checkpoint = isRecord(preflight?.estimatedCost?.providerCheckpoint)
    ? preflight.estimatedCost.providerCheckpoint
    : null;
  const normalizedReason = optionalString(reason);
  const completed = Array.isArray(progress.completed) ? progress.completed : [];
  const remaining = Array.isArray(progress.remaining) ? progress.remaining.map(String) : [];
  if (
    !originalCaseId
    || !originalRequestId
    || !isSha256(originalDecisionDigest)
    || !checkpoint
    || !normalizedReason
    || completed.length === 0
    || remaining.length === 0
    || progress.nextGate !== 'continue_next_ordered_provider_step'
  ) throw new Error('governance_provider_terminal_abandonment_facts_invalid');
  return {
    kind: 'provider_execution_terminal_abandonment',
    originalCaseId,
    originalRequestId,
    originalDecisionDigest: String(originalDecisionDigest),
    providerCheckpointDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.provider-checkpoint-v1', checkpoint,
    ),
    completedActionReceiptDigests: completed.map((item: any) => (
      hashCanonicalGovernanceValue(
        'alcheme.governance.provider-action-receipt-v1',
        { stepId: item.stepId, actionReceipt: item.actionReceipt },
      )
    )),
    remainingActionIds: remaining,
    irreversibleChanges: completed.map((item: any) => (
      `${String(item.stepId)} finalized at provider slot ${Number(item.actionReceipt?.observedSlot)}`
    )),
    compensationRequirement: 'governed_compensation_plan_required',
    directOperatorMutationAllowed: false,
    reason: normalizedReason,
  };
}

function projectGovernanceProviderExecutionTerminalAbandonment(
  request: any,
  progress: Record<string, any>,
): { compensation: Record<string, unknown> } | null {
  const candidates = Array.isArray(request?.providerExecutionTerminalAbandonmentCases)
    ? request.providerExecutionTerminalAbandonmentCases
    : [];
  for (const candidate of candidates) {
    const decision = candidate?.primaryRequest?.decision;
    const persistedArtifact = Array.isArray(candidate?.decisionOutputArtifacts)
      ? candidate.decisionOutputArtifacts[0]
      : null;
    const responsibility = Array.isArray(candidate?.responsibilities)
      ? candidate.responsibilities.find((item: any) => (
          item?.kind === 'execution'
          && ['assigned', 'accepted'].includes(String(item?.status ?? ''))
          && optionalString(item?.assigneePubkey)
          && Number.isSafeInteger(Number(item?.version))
          && Number(item.version) > 0
        ))
      : null;
    if (
      candidate?.caseType !== 'policy'
      || candidate?.relationshipKind !== 'supersedes'
      || candidate?.relatedCaseId !== request?.governanceCase?.id
      || candidate?.primaryRequest?.state !== 'accepted'
      || decision?.decision !== 'accepted'
      || !isSha256(decision?.decisionDigest)
      || !persistedArtifact
      || !responsibility
    ) continue;
    let expectedPayload: GovernanceProviderExecutionTerminalAbandonmentPayload;
    let expectedArtifact;
    try {
      const requestedActionPayload = isRecord(candidate?.requestedActionPayload)
        ? candidate.requestedActionPayload
        : null;
      expectedPayload = providerExecutionTerminalAbandonmentPayloadFromProgress(
        request,
        progress,
        String(requestedActionPayload?.reason ?? ''),
      );
      if (
        hashCanonicalGovernanceValue(
          'alcheme.governance.provider-execution-terminal-abandonment-v1',
          requestedActionPayload,
        )
        !== hashCanonicalGovernanceValue(
          'alcheme.governance.provider-execution-terminal-abandonment-v1',
          expectedPayload,
        )
      ) continue;
      expectedArtifact = buildNativeDecisionOutputArtifact({
        caseId: String(candidate.id),
        caseType: String(candidate.caseType),
        subjectType: String(candidate.subjectType ?? 'circle'),
        subjectRef: String(candidate.subjectRef ?? request.scopeRef ?? ''),
        decisionRequestId: String(candidate.primaryRequest.id),
        decision: String(decision.decision),
        decisionDigest: String(decision.decisionDigest),
        briefDraftPostId: candidate.briefDraftPostId,
        briefDraftVersion: candidate.briefDraftVersion,
        briefSnapshotDigest: candidate.briefSnapshotDigest,
        requestedActionPayload: expectedPayload,
        createdAt: persistedArtifact.createdAt instanceof Date
          ? persistedArtifact.createdAt
          : new Date(String(persistedArtifact.createdAt)),
      });
    } catch {
      continue;
    }
    if (!decisionOutputArtifactMatches(persistedArtifact, expectedArtifact)) continue;
    return {
      compensation: compactObject({
        state: 'compensation_required',
        owner: compactObject({
          authority: 'terminal_abandonment_case_execution_responsibility',
          caseId: String(candidate.id),
          pubkey: String(responsibility.assigneePubkey),
          responsibilityVersion: Number(responsibility.version),
          status: String(responsibility.status),
          deadlineAt: dateTime(responsibility.deadlineAt),
        }),
        directOperatorMutationAllowed: false,
        governingDecisionDigest: String(decision.decisionDigest),
      }),
    };
  }
  return null;
}

function providerResourceBindingLineageMatchesRequest(binding: any, request: any): boolean {
  const requestId = optionalString(request?.id);
  const decisionDigest = optionalString(request?.decision?.decisionDigest);
  if (!requestId || !isSha256(decisionDigest)) return false;
  if (
    binding?.sourceRequestId === requestId
    && binding?.sourceDecisionDigest === decisionDigest
  ) return true;
  const verification = isRecord(binding?.verification) ? binding.verification : null;
  if (!verification) return false;
  return [
    verification.delegationConformance,
    verification.continuityAdoption,
    verification.votingPowerChallenge,
    verification.providerDisable,
    verification.providerRestore,
    verification.grantSettlement,
  ].some((lineage) => (
    isRecord(lineage)
    && lineage.requestId === requestId
    && lineage.decisionDigest === decisionDigest
  ));
}

export function projectGovernanceAutomaticExecutionAvailabilityReadback(
  request: any,
): Record<string, unknown> | null {
  if (request?.decision?.decision !== 'accepted') return null;
  const preflight = Array.isArray(request?.invocation?.costPreflights)
    ? request.invocation.costPreflights[0]
    : null;
  const quote = isRecord(preflight?.quoteContext) ? preflight.quoteContext : null;
  const payer = preflight?.payerPolicy;
  const estimatedCost = isRecord(preflight?.estimatedCost) ? preflight.estimatedCost : null;
  const checkpoint = isRecord(estimatedCost?.providerCheckpoint)
    ? estimatedCost.providerCheckpoint
    : null;
  const profileRef = optionalString(quote?.profileRef);
  const binding = request?.providerResourceBinding;
  if (!preflight || !quote || !profileRef || !binding) return null;
  const providerModule = profileRef.includes('squads')
    ? 'squads_provider_binding'
    : profileRef.includes('realms')
      ? 'realms_provider_binding'
      : null;
  if (!providerModule) return null;
  const trust = providerModule === 'squads_provider_binding'
    ? resolveSquadsProviderTrustReadiness()
    : resolveRealmsProviderTrustReadiness();
  const authorityBindings = Array.isArray(binding?.authorityBindings)
    ? binding.authorityBindings
    : [];
  const exactAuthorities = authorityBindings.filter((authority: any) => (
    authority?.status === 'active'
    && authority?.profileRef === quote.profileRef
    && Number(authority?.profileVersion) === Number(quote.profileVersion)
    && authority?.providerResourceRef === binding.resourceRef
    && authority?.ownerProgramRef === binding.ownerProgramRef
    && optionalString(authority?.currentAuthority)
    && authority?.sourceRequestId === request.id
    && authority?.sourceDecisionDigest === request.decision.decisionDigest
    && Array.isArray(authority?.allowedOperations)
    && authority.allowedOperations.length > 0
  ));
  const checkpointSteps = Array.isArray(checkpoint?.steps) ? checkpoint.steps : [];
  const simulatedSteps = checkpointSteps.filter((step: any) => (
    ['quoted', 'signed', 'submitted', 'confirmed', 'finalized'].includes(step?.status)
    && isSha256(step?.manifestDigest)
    && isSha256(step?.messageDigest)
  ));
  const blockers: string[] = [];
  if (preflight.status !== 'ready') blockers.push('cost_preflight_not_ready');
  if (preflight?.estimatedCost?.status !== 'provider_in_progress') {
    blockers.push('provider_attempt_not_in_progress');
  }
  if (
    quote.chainId !== trust.chainId
    || quote.profileRef !== trust.profileRef
    || Number(quote.profileVersion) !== Number(trust.profileVersion)
  ) blockers.push('provider_trust_profile_not_current');
  if (
    binding.status !== 'active'
    || binding.id !== quote.resourceBindingId
    || binding.profileRef !== quote.profileRef
    || Number(binding.profileVersion) !== Number(quote.profileVersion)
    || binding.ownerProgramRef !== trust.programId
    || !providerResourceBindingLineageMatchesRequest(binding, request)
  ) blockers.push('governed_resource_binding_not_exact_active');
  if (exactAuthorities.length === 0) blockers.push('execution_authority_not_exact_active');
  if (
    payer?.id !== preflight.payerPolicyRef
    || payer?.status !== 'active'
    || payer?.sourceRequestId !== request.id
    || payer?.sourceDecisionDigest !== request.decision.decisionDigest
    || payer?.network !== quote.chainId
    || !optionalString(payer?.feePayerSignerRef)
  ) blockers.push('payer_policy_not_exact_active');
  if (simulatedSteps.length !== checkpointSteps.length || checkpointSteps.length === 0) {
    blockers.push('provider_simulation_checkpoint_not_verified');
  }
  const mode = providerModule === 'squads_provider_binding'
    ? 'multisig_threshold'
    : 'provider_onchain';
  const readinessState = blockers.length === 0
    ? 'ready'
    : blockers.some((blocker) => [
      'provider_trust_profile_not_current',
      'governed_resource_binding_not_exact_active',
      'execution_authority_not_exact_active',
    ].includes(blocker))
      ? 'degraded'
      : 'setup_required';
  const riskMaturity: 'stable' | 'experimental' = trust.riskMaturity;
  const riskConfirmationByMaturity: Record<'stable' | 'experimental', 'not_required' | 'required'> = {
    stable: 'not_required',
    experimental: 'required',
  };
  return {
    schemaVersion: 1,
    authority: 'canonical_preflight_provider_readiness',
    state: blockers.length === 0 ? 'ready' : 'blocked',
    readinessState,
    riskMaturity,
    stageGate: {
      openStage: readinessState === 'ready' ? 'allowed' : 'blocked',
      execute: readinessState === 'ready' ? 'allowed' : 'blocked',
      riskConfirmation: riskConfirmationByMaturity[riskMaturity],
      riskDoesNotOverrideReadiness: true,
      missingReadiness: blockers,
      enforcementReady: !blockers.includes('provider_simulation_checkpoint_not_verified')
        && exactAuthorities.length > 0,
      finalityReadbackConfigured: trust.mainnet === 'unavailable'
        && !blockers.includes('provider_trust_profile_not_current'),
    },
    providerModule,
    mode,
    decisionLinkage: {
      requestId: request.id,
      decisionDigest: request.decision.decisionDigest,
    },
    checks: {
      acceptedDecision: true,
      currentTrustProfile: !blockers.includes('provider_trust_profile_not_current'),
      activeExactResource: !blockers.includes('governed_resource_binding_not_exact_active'),
      activeExactAuthority: !blockers.includes('execution_authority_not_exact_active'),
      activeExactPayer: !blockers.includes('payer_policy_not_exact_active'),
      simulationCheckpoint: !blockers.includes('provider_simulation_checkpoint_not_verified'),
      instructionManifest: 'verified_adapter_manifest_only',
      opaqueInstructionsAllowed: false,
    },
    allowedOperations: [...new Set(exactAuthorities.flatMap((authority: any) => (
      authority.allowedOperations.map(String)
    )))].sort(),
    blockers,
    providerAutomatic: blockers.length === 0 ? 'ready' : 'blocked',
    walletManual: 'blocked_requires_explicit_wallet_confirmation',
    advisoryOnly: 'blocked_no_signed_transaction_generation',
    completionClaimAllowed: false,
    nextGate: blockers.length === 0
      ? 'provider_attempt_and_authoritative_readback'
      : 'repair_existing_readiness_facts_without_authority_or_payer_substitution',
  };
}

export function projectGovernanceProviderExecutionPreviewReadback(
  request: any,
): Record<string, unknown> | null {
  if (
    request?.actionType !== REALMS_PROVIDER_DELEGATION_CONFORMANCE_ACTION_TYPE
    || request?.decision?.decision !== 'accepted'
  ) return null;
  const preflight = Array.isArray(request?.invocation?.costPreflights)
    ? request.invocation.costPreflights[0]
    : null;
  const estimated = isRecord(preflight?.estimatedCost) ? preflight.estimatedCost : null;
  const checkpoint = isRecord(estimated?.providerCheckpoint)
    ? estimated.providerCheckpoint
    : null;
  const quote = isRecord(preflight?.quoteContext) ? preflight.quoteContext : null;
  const payer = preflight?.payerPolicy;
  const binding = request?.providerResourceBinding;
  const payload = isRecord(request?.payload) ? request.payload : null;
  const resource = isRecord(payload?.resourceBinding) ? payload.resourceBinding : null;
  const providerIntent = isRecord(payload?.providerIntent) ? payload.providerIntent : null;
  const trust = resolveRealmsProviderTrustReadiness();
  const steps = Array.isArray(checkpoint?.steps) ? checkpoint.steps : [];
  const quotedSteps = steps.filter((step: any) => step?.status === 'quoted');
  if (
    !preflight
    || preflight.status !== 'ready'
    || estimated?.status !== 'provider_in_progress'
    || !quote
    || !payer
    || !binding
    || !checkpoint
    || checkpoint.schemaVersion !== 1
    || !isSha256(checkpoint.planDigest)
    || quotedSteps.length !== 1
    || steps.some((step: any) => ['signed', 'submitted', 'confirmed'].includes(step?.status))
    || resource?.id !== binding.id
    || resource?.resourceRef !== binding.resourceRef
    || binding.status !== 'active'
    || binding.profileRef !== trust.profileRef
    || Number(binding.profileVersion) !== Number(trust.profileVersion)
    || binding.ownerProgramRef !== trust.programId
    || quote.resourceBindingId !== binding.id
    || payload?.chainId !== quote.chainId
    || quote.chainId !== trust.chainId
    || quote.profileRef !== trust.profileRef
    || Number(quote.profileVersion) !== Number(trust.profileVersion)
    || payload?.chainId !== payer.network
    || payload?.profileRef !== quote.profileRef
    || Number(payload?.profileVersion) !== Number(quote.profileVersion)
    || providerIntent?.programId !== binding.ownerProgramRef
    || providerIntent?.realm !== binding.resourceRef
    || !providerResourceBindingLineageMatchesRequest(binding, request)
    || payer.id !== preflight.payerPolicyRef
    || payer.status !== 'active'
    || payer.sourceRequestId !== request.id
    || payer.sourceDecisionDigest !== request.decision.decisionDigest
    || payer.network !== quote.chainId
    || !optionalString(payer.feePayerSignerRef)
  ) return null;
  const step = quotedSteps[0];
  const statePrecondition = isRecord(step?.statePrecondition) ? step.statePrecondition : null;
  const safety = isRecord(statePrecondition?.instructionSafety)
    ? statePrecondition.instructionSafety
    : null;
  const canonicalOwnerState = isRecord(statePrecondition?.canonicalOwnerState)
    ? statePrecondition.canonicalOwnerState
    : null;
  const operation = optionalString(step?.id);
  const summary = operation === 'set_governance_delegate'
    ? 'Set the frozen governance delegate on the exact TokenOwnerRecord.'
    : operation === 'revoke_governance_delegate'
      ? 'Revoke the governance delegate from the exact TokenOwnerRecord.'
      : null;
  const authorityBindings = Array.isArray(binding.authorityBindings)
    ? binding.authorityBindings
    : [];
  const voterAuthority = authorityBindings.find((authority: any) => (
    authority?.authorityRole === 'voter'
    && authority?.status === 'active'
    && authority?.sourceRequestId === request.id
    && authority?.sourceDecisionDigest === request.decision.decisionDigest
    && authority?.profileRef === trust.profileRef
    && Number(authority?.profileVersion) === Number(trust.profileVersion)
    && authority?.providerResourceRef === binding.resourceRef
    && authority?.ownerProgramRef === binding.ownerProgramRef
    && Array.isArray(authority?.allowedOperations)
    && authority.allowedOperations.includes(operation)
  ));
  const totalLimit = estimated.totalLimitLamports ?? estimated.totalBootstrapLimitLamports;
  const singleLimit = estimated.singleTransactionLimitLamports;
  const statePreconditionDigest = optionalString(statePrecondition?.digest);
  const statePreconditionFacts = statePrecondition
    ? Object.fromEntries(Object.entries(statePrecondition).filter(([key]) => key !== 'digest'))
    : null;
  const safetyDigest = optionalString(safety?.digest);
  const safetyFacts = safety
    ? Object.fromEntries(Object.entries(safety).filter(([key]) => key !== 'digest'))
    : null;
  if (
    !summary
    || !voterAuthority
    || !optionalString(voterAuthority.id)
    || !optionalString(voterAuthority.currentAuthority)
    || !optionalString(voterAuthority.custodyProvider)
    || !optionalString(providerIntent?.governingTokenMint)
    || !optionalString(providerIntent?.voterTokenOwnerRecord)
    || !optionalString(providerIntent?.voterOwner)
    || !optionalString(providerIntent?.delegate)
    || !optionalString(providerIntent?.voteRecord)
    || !statePrecondition
    || statePrecondition.schemaVersion !== 1
    || statePrecondition.authority !== 'independent_provider_readback_before_transit_sign'
    || statePrecondition.actionIntentDigest !== preflight.actionIntentDigest
    || statePrecondition.planDigest !== checkpoint.planDigest
    || statePrecondition.stepId !== operation
    || statePrecondition.manifestDigest !== step.manifestDigest
    || statePrecondition.messageDigest !== step.messageDigest
    || statePrecondition.chainId !== quote.chainId
    || statePrecondition.profileRef !== quote.profileRef
    || Number(statePrecondition.profileVersion) !== Number(quote.profileVersion)
    || statePrecondition.programId !== binding.ownerProgramRef
    || (operation === 'set_governance_delegate'
      ? statePrecondition.expectedDelegate !== null
      : statePrecondition.expectedDelegate !== providerIntent.delegate)
    || !Number.isSafeInteger(statePrecondition.observedSlot)
    || statePrecondition.observedSlot <= 0
    || !isSha256(statePrecondition.providerStateDigest)
    || !isSha256(statePreconditionDigest)
    || hashCanonicalGovernanceValue(
      'alcheme.governance.realms-delegation-pre-sign-state-v1',
      statePreconditionFacts,
    ) !== statePreconditionDigest
    || canonicalOwnerState?.schemaVersion !== 1
    || canonicalOwnerState?.authority !== 'canonical_resource_authority_payer_readback'
    || canonicalOwnerState?.resourceBindingId !== binding.id
    || canonicalOwnerState?.authorityBindingId !== voterAuthority.id
    || canonicalOwnerState?.payerPolicyId !== payer.id
    || canonicalOwnerState?.emergencyFreeze !== 'clear_fresh_p05_authority_health'
    || !isSha256(canonicalOwnerState?.stateDigest)
    || safety?.schemaVersion !== 1
    || safety?.authority !== 'provider_instruction_manifest_and_simulation'
    || safety?.simulation !== 'passed'
    || safety?.opaqueInstructions !== false
    || safety?.assetOutflowLamports !== 0
    || safety?.accountPrivilegeCheck !== 'exact_spl_governance_set_delegate_accounts'
    || safety?.instructionCount !== 1
    || safety?.transactionSignerCount !== 2
    || !Array.isArray(safety?.programIds)
    || JSON.stringify(safety.programIds) !== JSON.stringify([binding.ownerProgramRef])
    || !Array.isArray(safety?.writableAccountRefs)
    || JSON.stringify(safety.writableAccountRefs)
      !== JSON.stringify([providerIntent?.voterTokenOwnerRecord])
    || !isSha256(safetyDigest)
    || hashCanonicalGovernanceValue(
      'alcheme.governance.realms-delegation-instruction-safety-v1',
      safetyFacts,
    ) !== safetyDigest
    || !Number.isSafeInteger(step.feeLamports)
    || step.feeLamports < 0
    || !Number.isSafeInteger(step.authorizedCeilingLamports)
    || step.authorizedCeilingLamports < step.feeLamports
    || !/^\d+$/.test(String(totalLimit ?? ''))
    || !/^\d+$/.test(String(singleLimit ?? ''))
    || !isSha256(step.manifestDigest)
    || !isSha256(step.messageDigest)
    || !optionalString(step.recentBlockhash)
    || !Number.isSafeInteger(step.lastValidBlockHeight)
    || step.lastValidBlockHeight <= 0
  ) return null;
  if (
    BigInt(step.authorizedCeilingLamports) > BigInt(String(singleLimit))
    || BigInt(step.authorizedCeilingLamports) > BigInt(String(totalLimit))
  ) return null;
  return {
    schemaVersion: 1,
    authority: 'canonical_cost_preflight_pre_sign_state_and_active_binding',
    state: 'ready_to_sign',
    provider: 'realms_provider_binding',
    network: quote.chainId,
    enforcementMode: 'provider_onchain',
    decisionLinkage: {
      requestId: request.id,
      decisionDigest: request.decision.decisionDigest,
      actionIntentDigest: preflight.actionIntentDigest,
    },
    resource: {
      bindingId: binding.id,
      resourceRef: binding.resourceRef,
      ownerProgramRef: binding.ownerProgramRef,
      observedSlot: statePrecondition.observedSlot,
      stateDigest: statePrecondition.providerStateDigest,
    },
    signingAuthority: {
      role: 'voter',
      publicAuthority: voterAuthority.currentAuthority,
      custodyProvider: voterAuthority.custodyProvider,
      keyRefExposed: false,
      assignmentGrantsAuthority: false,
    },
    feePayer: {
      policyId: payer.id,
      role: 'separated_fee_payer_policy',
      economicBearer: payer.economicBearer,
      signerRefExposed: false,
    },
    estimate: {
      unit: 'lamports',
      quotedFee: step.feeLamports,
      authorizedCeiling: step.authorizedCeilingLamports,
      totalLimit: String(totalLimit),
    },
    instruction: {
      stepId: operation,
      summary,
      programIds: safety.programIds.map(String),
      accountScope: [
        { role: 'realm', ref: String(providerIntent.realm) },
        { role: 'governing_token_mint', ref: String(providerIntent.governingTokenMint) },
        { role: 'voter_token_owner_record', ref: String(providerIntent.voterTokenOwnerRecord) },
        { role: 'voter_owner', ref: String(providerIntent.voterOwner) },
        { role: 'governance_delegate', ref: String(providerIntent.delegate) },
        { role: 'vote_record', ref: String(providerIntent.voteRecord) },
      ],
      assetChange: 'none_no_real_assets',
      simulation: 'passed',
      opaqueInstructions: false,
      rawInstructionExposed: false,
      manifestDigest: step.manifestDigest,
      messageDigest: step.messageDigest,
      recentBlockhash: step.recentBlockhash,
      lastValidBlockHeight: step.lastValidBlockHeight,
    },
    bypassRisk: {
      known: 'custodied_authority_can_sign_allowed_provider_operations_outside_alcheme_request_path',
      prevented: false,
    },
    nextGate: 'provider_custody_sign_then_authoritative_finality_readback',
  };
}

function projectGovernancePreExecutionCostReadback(
  request: any,
): Record<string, unknown> | null {
  if (request?.decision?.decision !== 'accepted') return null;
  if (Array.isArray(request?.receipts) && request.receipts.some((receipt: any) => (
    receipt?.executionStatus === 'executed'
      && ['realms_provider_binding', 'squads_provider_binding'].includes(receipt?.executorModule)
  ))) return null;
  const preflight = Array.isArray(request?.invocation?.costPreflights)
    ? request.invocation.costPreflights[0]
    : null;
  const payer = preflight?.payerPolicy;
  const estimated = isRecord(preflight?.estimatedCost) ? preflight.estimatedCost : null;
  const quote = isRecord(preflight?.quoteContext) ? preflight.quoteContext : null;
  const lamportsText = (value: unknown): string | null => (
    Number.isSafeInteger(value) && Number(value) >= 0
      ? String(value)
      : typeof value === 'string' && /^\d+$/.test(value)
        ? value
        : null
  );
  const singleLimit = lamportsText(estimated?.singleTransactionLimitLamports);
  const totalLimit = lamportsText(
    estimated?.totalBootstrapLimitLamports
      ?? estimated?.totalVerticalLimitLamports
      ?? estimated?.totalLimitLamports,
  );
  if (
    !preflight
    || !['pending', 'ready'].includes(preflight.status)
    || !['pending_rpc_quote', 'provider_in_progress'].includes(estimated?.status)
    || !optionalString(preflight.id)
    || !optionalString(preflight.payerPolicyRef)
    || preflight.payerPolicyRef !== payer?.id
    || payer?.sourceRequestId !== request.id
    || payer?.sourceDecisionDigest !== request.decision.decisionDigest
    || payer?.status !== 'active'
    || !optionalString(payer?.network)
    || !optionalString(payer?.economicBearer)
    || !singleLimit
    || !totalLimit
    || !/^\d+$/.test(singleLimit)
    || !/^\d+$/.test(totalLimit)
    || !optionalString(quote?.chainId)
    || quote.chainId !== payer.network
    || !optionalString(quote?.profileRef)
    || !Number.isSafeInteger(quote?.profileVersion)
    || !optionalString(quote?.resourceBindingId)
  ) return null;
  return {
    schemaVersion: 1,
    state: estimated.status,
    preflightId: preflight.id,
    status: preflight.status,
    checkedAt: dateTime(preflight.checkedAt),
    expiresAt: dateTime(preflight.expiresAt),
    payer: {
      policyId: payer.id,
      network: payer.network,
      economicBearer: payer.economicBearer,
      feePayer: payer.feePayerSignerRef ? 'policy_bound' : 'not_configured',
      sponsor: payer.relayerRef ? 'relayer_configured' : 'not_configured',
      rentFunding: payer.rentFundingSourceRef ? 'policy_bound' : 'not_configured',
      refundRecipient: payer.refundRecipientRef ? 'policy_bound' : 'not_configured',
    },
    limits: {
      unit: 'lamports',
      singleTransaction: singleLimit,
      total: totalLimit,
    },
    provider: {
      chainId: quote.chainId,
      profileRef: quote.profileRef,
      profileVersion: quote.profileVersion,
      resourceBindingId: quote.resourceBindingId,
    },
    estimate: 'pending_provider_rpc_quote',
    rent: 'pending_provider_quote',
    refund: 'pending_terminal_reconciliation',
    executionProgress: projectGovernanceProviderExecutionProgressReadback(request),
    automaticExecutionAvailability:
      projectGovernanceAutomaticExecutionAvailabilityReadback(request),
    executionPreview: projectGovernanceProviderExecutionPreviewReadback(request),
    executionAuthorityPreflight:
      projectGovernanceProviderExecutionAuthorityPreflightReadback(request),
  };
}

export function projectGovernanceProviderExecutionAuthorityPreflightReadback(
  request: any,
): Record<string, unknown> | null {
  if (
    request?.actionType !== REALMS_PROVIDER_DELEGATION_CONFORMANCE_ACTION_TYPE
    || request?.executionMode !== 'provider_bound_action'
    || request?.decision?.decision !== 'accepted'
  ) return null;
  const invocation = request?.invocation;
  const snapshot = invocation?.authoritySnapshot;
  const authorityBinding = snapshot?.binding;
  const contractVersion = invocation?.contractVersion;
  const profileBinding = invocation?.profileBinding;
  const profileVersion = profileBinding?.definitionVersion;
  const limits = isRecord(authorityBinding?.limits) ? authorityBinding.limits : null;
  const selector = isRecord(authorityBinding?.selector) ? authorityBinding.selector : null;
  const preflight = Array.isArray(invocation?.costPreflights)
    ? invocation.costPreflights[0]
    : null;
  const checkedAt = preflight?.checkedAt ? new Date(preflight.checkedAt) : null;
  const validFrom = snapshot?.validFrom ? new Date(snapshot.validFrom) : null;
  const validUntil = snapshot?.validUntil ? new Date(snapshot.validUntil) : null;
  const bindingEffectiveFrom = authorityBinding?.effectiveFrom
    ? new Date(authorityBinding.effectiveFrom)
    : null;
  const bindingEffectiveUntil = authorityBinding?.effectiveUntil
    ? new Date(authorityBinding.effectiveUntil)
    : null;
  const expectedPayloadDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.action-payload',
    isRecord(request?.payload) ? request.payload : {},
  );
  const expectedSubjectDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.action-subject',
    { targetType: request?.targetType, targetRef: request?.targetRef },
  );
  const admission = projectGovernanceProviderResourceExecutionAdmissionReadback(request) as any;
  const preview = projectGovernanceProviderExecutionPreviewReadback(request) as any;
  const artifactMapping = admission?.artifactMapping;
  const enforcementBinding = artifactMapping?.enforcementBinding;
  const mandateVersion = Number(limits?.mandateVersion);
  const mandateTermsDigest = optionalString(limits?.mandateTermsDigest);
  const expectedSourceVersion = Number.isSafeInteger(mandateVersion)
    && mandateVersion > 0
    && isSha256(mandateTermsDigest)
    ? `v${mandateVersion}:${mandateTermsDigest.slice(0, 48)}`
    : null;
  const selectorMatches = selector?.actionType === request.actionType
    || (typeof selector?.actionPrefix === 'string'
      && request.actionType.startsWith(selector.actionPrefix));
  const executionAuthority = isRecord(limits?.executionAuthority)
    ? limits.executionAuthority
    : null;
  if (
    !invocation
    || !snapshot
    || !authorityBinding
    || !contractVersion
    || !profileBinding
    || !profileVersion
    || !limits
    || !selector
    || !preflight
    || !checkedAt
    || Number.isNaN(checkedAt.getTime())
    || !validFrom
    || Number.isNaN(validFrom.getTime())
    || !validUntil
    || Number.isNaN(validUntil.getTime())
    || !bindingEffectiveFrom
    || Number.isNaN(bindingEffectiveFrom.getTime())
    || (bindingEffectiveUntil && Number.isNaN(bindingEffectiveUntil.getTime()))
    || invocation.id !== request.invocationId
    || invocation.subjectType !== request.targetType
    || invocation.subjectRef !== request.targetRef
    || invocation.payloadDigest !== expectedPayloadDigest
    || invocation.preflightDigest !== request.executionModeDigest
    || contractVersion.id !== invocation.contractVersionId
    || contractVersion.actionType !== request.actionType
    || contractVersion.subjectType !== request.targetType
    || contractVersion.executionAdapter !== 'realms_provider_binding'
    || profileBinding.id !== invocation.profileBindingId
    || snapshot.invocationId !== invocation.id
    || snapshot.bindingId !== authorityBinding.id
    || snapshot.profileBindingId !== profileBinding.id
    || snapshot.profileVersionRef !== profileVersion.versionRef
    || snapshot.authoritySourceType !== authorityBinding.sourceType
    || snapshot.authoritySourceRef !== authorityBinding.sourceRef
    || snapshot.authoritySourceVersion !== authorityBinding.sourceVersion
    || snapshot.resolvedSubjectDigest !== expectedSubjectDigest
    || snapshot.resolvedPayloadDigest !== expectedPayloadDigest
    || snapshot.liveConfigDigest !== request.executionModeDigest
    || snapshot.decisionPath !== 'provider_bound_action'
    || !isSha256(snapshot.selectorDigest)
    || !isSha256(snapshot.capabilityDigest)
    || !isSha256(snapshot.snapshotDigest)
    || authorityBinding.status !== 'active'
    || authorityBinding.supersededAt != null
    || authorityBinding.sourceType !== 'governance_mandate'
    || authorityBinding.sourceRef !== limits.mandateId
    || authorityBinding.sourceVersion !== expectedSourceVersion
    || !selectorMatches
    || String(limits?.delegatorGovernanceHome?.type ?? '') !== invocation.governanceHomeType
    || String(limits?.delegatorGovernanceHome?.ref ?? '') !== invocation.governanceHomeRef
    || Number(limits?.targetCircleId) !== Number(request.targetRef)
    || executionAuthority?.type !== 'registered_adapter'
    || executionAuthority?.ref !== 'realms_provider_binding'
    || validFrom.getTime() > checkedAt.getTime()
    || validUntil.getTime() <= checkedAt.getTime()
    || bindingEffectiveFrom.getTime() > checkedAt.getTime()
    || (bindingEffectiveUntil && bindingEffectiveUntil.getTime() <= checkedAt.getTime())
    || !artifactMapping
    || artifactMapping.decisionDigest !== request.decision.decisionDigest
    || artifactMapping.resourceBindingId !== admission?.binding?.id
    || artifactMapping.adapterRef !== 'realms_provider_binding'
    || !enforcementBinding
    || enforcementBinding.resourceBindingId !== admission?.binding?.id
    || enforcementBinding.providerModule !== 'realms_provider_binding'
    || enforcementBinding.mode !== 'provider_onchain'
    || enforcementBinding.allowedAdapter !== 'realms_provider_binding'
    || enforcementBinding.verificationState !== 'frozen_pending_live_preflight'
    || enforcementBinding.bypassPrevented !== false
    || !isSha256(enforcementBinding.authorityScopeDigest)
    || !Array.isArray(enforcementBinding.allowedOperations)
    || !enforcementBinding.allowedOperations.includes(request.actionType)
    || (Array.isArray(enforcementBinding.authorityBindingIds)
      && enforcementBinding.authorityBindingIds.some((bindingId: string) => (
        !admission.controllingAuthorities.some((authority: any) => (
          authority.bindingId === bindingId
        ))
      )))
    || preview?.state !== 'ready_to_sign'
    || preview?.decisionLinkage?.requestId !== request.id
    || preview?.decisionLinkage?.decisionDigest !== request.decision.decisionDigest
    || preview?.resource?.bindingId !== admission?.binding?.id
    || preview?.resource?.ownerProgramRef !== admission?.binding?.ownerProgramRef
  ) return null;
  return {
    schemaVersion: 1,
    authority: 'invocation_snapshot_mandate_artifact_and_live_provider_readback',
    state: 'ready',
    executionAllowed: true,
    frozenAuthority: {
      invocationId: String(invocation.id),
      snapshotId: String(snapshot.id),
      snapshotDigest: String(snapshot.snapshotDigest),
      bindingId: String(authorityBinding.id),
      capabilityDigest: String(snapshot.capabilityDigest),
      validFrom: validFrom.toISOString(),
      validUntil: validUntil.toISOString(),
    },
    mandate: {
      id: String(limits.mandateId),
      version: mandateVersion,
      termsDigest: String(mandateTermsDigest),
      sourceVersion: String(expectedSourceVersion),
      purpose: String(authorityBinding.purpose),
    },
    governedDecision: {
      requestId: String(request.id),
      decisionDigest: String(request.decision.decisionDigest),
      artifactId: String(artifactMapping.artifactId),
      artifactDigest: String(artifactMapping.artifactDigest),
      actionType: String(request.actionType),
      subject: { type: String(request.targetType), ref: String(request.targetRef) },
      resourceBindingId: String(artifactMapping.resourceBindingId),
    },
    executionEnforcementBinding: {
      resourceBindingId: String(enforcementBinding.resourceBindingId),
      authorityScopeDigest: String(enforcementBinding.authorityScopeDigest),
      authorityBindingIds: [...enforcementBinding.authorityBindingIds],
      providerModule: 'realms_provider_binding',
      mode: 'provider_onchain',
      allowedAdapter: 'realms_provider_binding',
      allowedOperations: [...enforcementBinding.allowedOperations],
      residualBypassRisk: String(enforcementBinding.residualBypassRisk),
      bypassPrevented: false,
      verificationState: 'verified_live',
      contractVersion: Number(enforcementBinding.contractVersion),
      profileVersion: Number(enforcementBinding.profileVersion),
    },
    liveExecutionAuthority: {
      resolver: 'canonical_resource_authority_and_pre_sign_provider_state_readback',
      provider: 'realms_provider_binding',
      observedSlot: Number(preview.resource.observedSlot),
      providerStateDigest: String(preview.resource.stateDigest),
      canonicalBindingStateDigest: String(admission.binding.stateDigest),
      controllingAuthorityCount: admission.controllingAuthorities.length,
      result: 'verified',
    },
    emergencyFreeze: {
      source: 'p05_authority_health_runtime',
      observed: 'clear_fresh_p05_authority_health',
      state: 'verified_clear',
      executionAllowed: true,
    },
    checks: {
      resolvedActionAuthoritySnapshot: true,
      mandate: true,
      decisionAndArtifactDigest: true,
      actionAndSubjectScope: true,
      liveExecutionAuthority: true,
      emergencyFreeze: true,
    },
    nextGate: 'provider_custody_sign_then_authoritative_finality_readback',
  };
}

function withProviderPrivateEvidenceRelease<T extends Record<string, unknown> | null>(
  projection: T,
  privateEvidenceRelease: Record<string, unknown> | null,
): T {
  if (!projection || !privateEvidenceRelease) return projection;
  return compactObject({ ...projection, privateEvidenceRelease }) as T;
}

function projectProviderPrivateEvidenceReleaseReadback(
  request: any,
  receipt: any,
): Record<string, unknown> | null {
  const providerModule = receipt?.executorModule === 'realms_provider_binding'
    || receipt?.executorModule === 'squads_provider_binding'
    ? receipt.executorModule
    : null;
  if (!providerModule) return null;
  const requestPayload = isRecord(request?.payload) ? request.payload : {};
  const evidencePolicy = isRecord(requestPayload.evidencePolicy)
    ? requestPayload.evidencePolicy
    : null;
  const authorizationDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.provider-private-evidence-release-authorization',
    {
      requestId: optionalString(request?.id),
      decisionDigest: optionalString(request?.decision?.decisionDigest),
      providerModule,
      evidencePolicy,
    },
  );
  let canonicalRequestPayloadDigest: string | null = null;
  try {
    canonicalRequestPayloadDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.action-payload',
      requestPayload,
    );
  } catch {
    canonicalRequestPayloadDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.action-payload-fallback',
      {
        requestId: optionalString(request?.id),
        decisionDigest: optionalString(request?.decision?.decisionDigest),
        providerModule,
        evidencePolicy,
      },
    );
  }
  const requestPayloadDigest = optionalString(request?.decision?.payloadDigest)
    ?? optionalString(request?.invocation?.payloadDigest)
    ?? canonicalRequestPayloadDigest;
  const releaseRecord = isRecord(receipt?.executionEvidence?.privateEvidenceRelease)
    ? receipt.executionEvidence.privateEvidenceRelease
    : null;

  if (releaseRecord) {
    const providerResult = isRecord(releaseRecord.providerResult)
      ? releaseRecord.providerResult
      : null;
    const deletionReceipt = isRecord(releaseRecord.deletionReceipt)
      ? releaseRecord.deletionReceipt
      : null;
    const valid = releaseRecord.schemaVersion === 1
      && releaseRecord.provider === providerModule
      && optionalString(releaseRecord.purpose)
      && isSha256(releaseRecord.minimumPayloadDigest)
      && isRecord(releaseRecord.authorization)
      && releaseRecord.authorization.authority === 'governance_case_frozen_evidence_policy'
      && isSha256(releaseRecord.authorization.authorizationDigest)
      && dateTime(releaseRecord.sentAt)
      && providerResult?.source === 'provider_native_result'
      && ['accepted', 'rejected'].includes(String(providerResult?.status ?? ''))
      && dateTime(providerResult?.receivedAt)
      && deletionReceipt?.authority === 'provider_native_deletion_or_retention_receipt'
      && ['deleted', 'not_supported_retention_policy_recorded', 'not_required'].includes(
        String(deletionReceipt?.status ?? ''),
      )
      && releaseRecord.httpSuccessSelfProvesCompletion === false;
    if (!valid) {
      return {
        schemaVersion: 1,
        status: 'blocked',
        integrity: 'invalid',
        blocker: 'provider_private_evidence_release_record_invalid',
        provider: providerModule,
        purpose: optionalString(releaseRecord.purpose),
        minimumPayloadDigest: isSha256(releaseRecord.minimumPayloadDigest)
          ? releaseRecord.minimumPayloadDigest
          : requestPayloadDigest,
        authorization: {
          authority: 'governance_case_frozen_evidence_policy',
          authorizationDigest,
          packageCount: Array.isArray(evidencePolicy?.packages)
            ? evidencePolicy.packages.length
            : null,
        },
        sentAt: null,
        providerResult: null,
        deletionReceipt: null,
        completionAuthority: 'provider_result_and_deletion_receipt_required',
        httpSuccessSelfProvesCompletion: false,
      };
    }
    return {
      schemaVersion: 1,
      status: 'sent',
      integrity: 'verified',
      blocker: null,
      provider: providerModule,
      purpose: String(releaseRecord.purpose),
      minimumPayloadDigest: String(releaseRecord.minimumPayloadDigest),
      authorization: {
        authority: 'governance_case_frozen_evidence_policy',
        authorizationDigest: String(releaseRecord.authorization.authorizationDigest),
        packageCount: Number(releaseRecord.authorization.packageCount),
      },
      sentAt: dateTime(releaseRecord.sentAt),
      providerResult: {
        source: 'provider_native_result',
        status: String(providerResult!.status),
        receivedAt: dateTime(providerResult!.receivedAt),
      },
      deletionReceipt: {
        authority: 'provider_native_deletion_or_retention_receipt',
        status: String(deletionReceipt!.status),
        receiptDigest: optionalString(deletionReceipt!.receiptDigest),
        receivedAt: dateTime(deletionReceipt!.receivedAt),
      },
      completionAuthority: 'provider_result_and_deletion_receipt',
      httpSuccessSelfProvesCompletion: false,
    };
  }

  if (
    evidencePolicy !== null
    && (
      !isCurrentGovernanceCaseFrozenEvidencePolicy(evidencePolicy)
      || evidencePolicy.packages.length !== 0
    )
  ) {
    return {
      schemaVersion: 1,
      status: 'blocked',
      integrity: 'invalid',
      blocker: 'provider_private_evidence_release_record_required',
      provider: providerModule,
      purpose: 'provider_execution_private_evidence_release',
      minimumPayloadDigest: requestPayloadDigest,
      authorization: {
        authority: 'governance_case_frozen_evidence_policy',
        authorizationDigest,
        packageCount: Array.isArray(evidencePolicy?.packages)
          ? evidencePolicy.packages.length
          : null,
      },
      sentAt: null,
      providerResult: null,
      deletionReceipt: null,
      completionAuthority: 'provider_result_and_deletion_receipt_required',
      httpSuccessSelfProvesCompletion: false,
    };
  }

  return {
    schemaVersion: 1,
    status: 'not_sent',
    integrity: 'verified',
    blocker: null,
    provider: providerModule,
    purpose: 'provider_execution_without_private_evidence',
    minimumPayloadDigest: requestPayloadDigest,
    authorization: {
      authority: 'governance_case_frozen_evidence_policy',
      authorizationDigest,
      packageCount: 0,
    },
    sentAt: null,
    providerResult: null,
    deletionReceipt: {
      authority: 'provider_native_deletion_or_retention_receipt',
      status: 'not_required_not_sent',
      receiptDigest: null,
      receivedAt: null,
    },
    completionAuthority: 'not_applicable_no_private_evidence_sent',
    httpSuccessSelfProvesCompletion: false,
  };
}

export function projectGovernanceProviderExecutionReadback(
  request: any,
): Record<string, unknown> | null {
  const receipts = Array.isArray(request?.receipts)
    ? request.receipts.filter((receipt: any) => (
      receipt?.executorModule === 'realms_provider_binding'
      || receipt?.executorModule === 'squads_provider_binding'
    ))
    : [];
  if (receipts.length === 0) return null;
  const latest = latestExecutionReceipt(receipts);
  if (!latest) return null;
  const attempts = receipts.map((receipt: any) => ({
    receiptId: optionalString(receipt?.id),
    status: normalizeExecutionStatus(receipt?.executionStatus) ?? 'unavailable',
    errorCode: receipt?.executionStatus === 'failed'
      ? safeProviderExecutionErrorCode(receipt?.errorCode)
      : null,
    executedAt: dateTime(receipt?.executedAt),
  }));
  const failedAttemptCount = attempts.filter(
    (attempt: { status: string }) => attempt.status === 'failed',
  ).length;
  const linkage = {
    caseRef: optionalString(request?.caseRef),
    stageRef: optionalString(request?.stageRef),
    artifactStatus: 'not_applicable_provider_binding_activation',
    artifactRef: null,
  };
  const privateEvidenceRelease = projectProviderPrivateEvidenceReleaseReadback(request, latest);
  const profileRevalidation = latest.executorModule === 'realms_provider_binding'
    ? projectRealmsProviderProfileRevalidation(request?.providerResourceBinding)
    : null;
  if (profileRevalidation?.integrity === 'invalid') {
    return compactObject({
      schemaVersion: 1,
      status: 'held',
      integrity: 'invalid',
      blocker: 'provider_profile_revalidation_evidence_invalid',
      receiptId: optionalString(latest.id),
      evidenceDigest: optionalString(latest.executionEvidenceDigest),
      executedAt: dateTime(latest.executedAt),
      privateEvidenceRelease,
      attempts: { total: attempts.length, failed: failedAttemptCount, history: attempts },
      linkage,
    });
  }
  if (profileRevalidation?.integrity === 'verified') {
    const binding = request.providerResourceBinding;
    const reconciliationFallback = projectProviderReconciliationFallbackReadback({
      providerModule: 'realms_provider_binding',
      request,
      receipt: latest,
      provider: {
        resourceRef: binding.resourceRef,
        ownerProgramRef: binding.ownerProgramRef,
        profileRef: binding.profileRef,
        profileVersion: binding.profileVersion,
      },
      profileRevalidation,
      providerIncident: null,
    });
    return compactObject({
      schemaVersion: 1,
      status: 'held',
      integrity: 'verified',
      blocker: profileRevalidation.blocker,
      receiptId: optionalString(latest.id),
      evidenceDigest: optionalString(latest.executionEvidenceDigest),
      executedAt: dateTime(latest.executedAt),
      privateEvidenceRelease,
      provider: {
        module: 'realms_provider_binding',
        chainId: binding.network,
        profileRef: binding.profileRef,
        profileVersion: binding.profileVersion,
        resourceRef: binding.resourceRef,
        ownerProgramRef: binding.ownerProgramRef,
        profileRevalidation,
      },
      reconciliation: {
        state: 'hold',
        blocker: profileRevalidation.blocker,
        authority: profileRevalidation.authority,
        observedSlot: null,
        observedAt: profileRevalidation.observedAt,
        profileRevalidation,
        reconciliationFallback,
      },
      attempts: { total: attempts.length, failed: failedAttemptCount, history: attempts },
      linkage,
    });
  }
  if (isRealmsProviderExecutionExpiryCandidate(latest)) {
    const expiry = projectRealmsProviderExecutionExpiryReadback(request, latest);
    if (!expiry) {
      return compactObject({
        schemaVersion: 1,
        status: 'held',
        integrity: 'invalid',
        blocker: 'provider_execution_expiry_evidence_invalid',
        receiptId: optionalString(latest.id),
        evidenceDigest: optionalString(latest.executionEvidenceDigest),
      executedAt: dateTime(latest.executedAt),
      privateEvidenceRelease,
      attempts: { total: attempts.length, failed: failedAttemptCount, history: attempts },
      linkage,
      });
    }
    return compactObject({
      schemaVersion: 1,
      status: 'execution_expired',
      integrity: 'verified',
      blocker: 'realms_provider_blockhash_expired',
      receiptId: optionalString(latest.id),
      evidenceDigest: optionalString(latest.executionEvidenceDigest),
      executedAt: dateTime(latest.executedAt),
      expiry,
      privateEvidenceRelease,
      attempts: { total: attempts.length, failed: failedAttemptCount, history: attempts },
      retry: null,
      recovery: projectProviderExecutionRecovery(
        'realms_provider_blockhash_expired',
        null,
      ),
      linkage,
    });
  }
  if (latest.executionStatus !== 'executed') {
    const verification = isRecord(request?.providerResourceBinding?.verification)
      ? request.providerResourceBinding.verification
      : null;
    const retryValue = isRecord(verification?.retry) ? verification.retry : null;
    const retry = request?.providerResourceBinding?.status === 'hold'
      && request.providerResourceBinding.sourceRequestId === request?.id
      && request.providerResourceBinding.sourceDecisionDigest === request?.decision?.decisionDigest
      && retryValue?.mode === 'same_request_only'
      && retryValue?.requestId === request?.id
      && Number.isSafeInteger(Number(retryValue?.attemptCount))
      && Number(retryValue.attemptCount) > 0
      && dateTime(retryValue?.lastAttemptAt)
      && dateTime(retryValue?.nextRetryAt)
      ? {
          mode: 'same_request_only' as const,
          requestId: String(retryValue.requestId),
          attemptCount: Number(retryValue.attemptCount),
          lastAttemptAt: dateTime(retryValue.lastAttemptAt),
          nextRetryAt: dateTime(retryValue.nextRetryAt),
        }
      : null;
    const failureCode = latest.executionStatus === 'failed'
      ? retry
        ? safeProviderExecutionErrorCode(verification?.failureCode)
        : safeProviderExecutionErrorCode(latest.errorCode)
      : 'provider_execution_terminal_state_unavailable';
    return compactObject({
      schemaVersion: 1,
      status: latest.executionStatus === 'failed' ? 'failed' : 'held',
      integrity: 'verified',
      blocker: failureCode,
      receiptId: optionalString(latest.id),
      evidenceDigest: optionalString(latest.executionEvidenceDigest),
      executedAt: dateTime(latest.executedAt),
      privateEvidenceRelease,
      attempts: {
        total: attempts.length,
        failed: failedAttemptCount,
        history: attempts,
      },
      retry,
      recovery: projectProviderExecutionRecovery(failureCode, retry),
      linkage,
    });
  }
  const verified = latest.executorModule === 'squads_provider_binding'
    ? verifiedSquadsProviderExecutionReceipt(request, latest)
    : verifiedRealmsProviderExecutionReceipt(request, latest);
  if (!verified) {
    return compactObject({
      schemaVersion: 1,
      status: 'held',
      integrity: 'invalid',
      blocker: 'provider_execution_evidence_invalid',
      receiptId: optionalString(latest.id),
      evidenceDigest: optionalString(latest.executionEvidenceDigest),
      executedAt: dateTime(latest.executedAt),
      privateEvidenceRelease,
      attempts: {
        total: attempts.length,
        failed: failedAttemptCount,
        history: attempts,
      },
      linkage,
    });
  }
  const evidence = latest.executionEvidence as Record<string, any>;
  if (latest.executorModule === 'squads_provider_binding') {
    return withProviderPrivateEvidenceRelease(
      projectSquadsProviderExecution(request, latest, evidence, attempts, failedAttemptCount, linkage),
      privateEvidenceRelease,
    );
  }
  if (evidence.effect === 'realms_devnet_delegation_conformance_finalized') {
    return withProviderPrivateEvidenceRelease(
      projectRealmsDelegationProviderExecution(
        request,
        latest,
        evidence,
        attempts,
        failedAttemptCount,
        linkage,
      ),
      privateEvidenceRelease,
    );
  }
  if (evidence.effect === 'realms_voting_power_challenge_reopened') {
    return withProviderPrivateEvidenceRelease(
      projectRealmsVotingPowerChallengeExecution(
        request,
        latest,
        evidence,
        attempts,
        failedAttemptCount,
        linkage,
      ),
      privateEvidenceRelease,
    );
  }
  const providerReceipt = evidence.providerReceipt as Record<string, any>;
  const accountGraph = evidence.accountGraph as Record<string, any>;
  const plan = providerReceipt.plan as Record<string, any>;
  const addresses = plan.addresses as Record<string, any>;
  const expiredAttemptHistory = projectRealmsExpiredAttemptHistory(
    evidence.expiredAttemptHistory,
    plan,
  );
  const mechanism = request.decision.tally.mechanism as Record<string, any>;
  const reconciliation = projectRealmsProviderReconciliation(request, latest);
  const currentProfileReadiness = resolveRealmsProviderTrustReadiness();
  const currentProfile = getRealmsProviderTrustProfile();
  const bootstrapCostTransactions = providerReceipt.transactions.flatMap((transaction: any) => (
    Number.isSafeInteger(transaction.feeLamports)
      && transaction.feeLamports >= 0
      && Number.isSafeInteger(transaction.directRentLamports)
      && transaction.directRentLamports >= 0
      && Number.isSafeInteger(transaction.actualSpendLamports)
      && transaction.actualSpendLamports >= transaction.feeLamports + transaction.directRentLamports
      ? [{
          stepId: String(transaction.stepId),
          quotedFeeLamports: Number(transaction.feeLamports),
          directRentLamports: Number(transaction.directRentLamports),
          actualSpendLamports: Number(transaction.actualSpendLamports),
        }]
      : []
  ));
  const bootstrapCostReconciliation = bootstrapCostTransactions.length === providerReceipt.transactions.length
    && bootstrapCostTransactions.reduce((sum: number, transaction: {
      actualSpendLamports: number;
    }) => sum + transaction.actualSpendLamports, 0) === providerReceipt.totalSpendLamports
    ? {
        schemaVersion: 1,
        authority: 'canonical_cost_preflight_and_provider_receipt',
        payerPolicyId: evidence.payerPolicyId,
        payerRole: 'separated_fee_payer_policy',
        unit: 'lamports',
        transactions: bootstrapCostTransactions,
        totalDirectRentLamports: bootstrapCostTransactions.reduce((sum: number, transaction: {
          directRentLamports: number;
        }) => sum + transaction.directRentLamports, 0),
        totalSpendLamports: Number(providerReceipt.totalSpendLamports),
        finalBalanceLamports: Number(providerReceipt.finalBalanceLamports),
        fundingSource: providerReceipt.fundingSignature === null
          ? 'existing_finalized_balance'
          : 'solana_devnet_faucet',
        fundingSignature: providerReceipt.fundingSignature,
        reconciliation: 'transaction_sum_matches_provider_receipt',
        rent: 'provider_receipt_direct_rent_itemized',
        refund: 'unknown_no_provider_refund_disposition',
      }
    : null;
  if (reconciliation?.integrity === 'invalid') {
    return compactObject({
      schemaVersion: 1,
      status: 'held',
      integrity: 'invalid',
      blocker: 'provider_reconciliation_evidence_invalid',
      receiptId: optionalString(latest.id),
      evidenceDigest: optionalString(latest.executionEvidenceDigest),
      executedAt: dateTime(latest.executedAt),
      privateEvidenceRelease,
      attempts: {
        total: attempts.length,
        failed: failedAttemptCount,
        history: attempts,
      },
      linkage,
    });
  }
  const executionAuthorities = projectProviderExecutionAuthorities(request, {
    chainId: providerReceipt.chainId,
    profileRef: providerReceipt.profileRef,
    profileVersion: providerReceipt.profileVersion,
    resourceRef: accountGraph.resourceRef,
    ownerProgramRef: accountGraph.ownerProgramRef,
  });
  const authorityPaymentBoundary = projectProviderAuthorityPaymentBoundary(
    request,
    {
      chainId: providerReceipt.chainId,
      profileRef: providerReceipt.profileRef,
      profileVersion: providerReceipt.profileVersion,
      resourceRef: accountGraph.resourceRef,
      ownerProgramRef: accountGraph.ownerProgramRef,
    },
    executionAuthorities,
  );
  const mandateCostPolicy = projectProviderMandateCostPolicy(request);
  const fundingSourceFeePayerBoundary = projectProviderFundingSourceFeePayerBoundary(
    request,
    authorityPaymentBoundary,
    {
      fundingSourceRole: 'governed_resource_account',
      fundingSourceRef: accountGraph.resourceRef,
    },
  );
  const providerActionSafetyBoundary = projectProviderActionSafetyBoundary({
    request,
    receipt: latest,
    evidence,
    providerModule: 'realms_provider_binding',
    executionMode: 'realms',
    chainId: providerReceipt.chainId,
    resourceRef: accountGraph.resourceRef,
    ownerProgramRef: accountGraph.ownerProgramRef,
    planDigest: plan.planDigest,
    transactions: providerReceipt.transactions,
    projectHumanReadableAction: (transaction) => (
      projectRealmsBootstrapHumanReadableAction(
        transaction,
        plan,
        String(accountGraph.ownerProgramRef),
      )
    ),
  });
  const publishedCostReconciliation = bootstrapCostReconciliation
    && authorityPaymentBoundary
    && evidence.payerPolicyId === authorityPaymentBoundary.payerPolicyId
    ? {
        ...bootstrapCostReconciliation,
        economicBearer: authorityPaymentBoundary.economicBearer,
        sponsorRole: authorityPaymentBoundary.sponsorRole,
      }
    : null;
  const servicePayerAuthorityBoundary = projectServicePayerAuthorityBoundary({
    authorityPaymentBoundary,
    fundingSourceFeePayerBoundary,
    providerActionSafetyBoundary,
    costReconciliation: publishedCostReconciliation,
  });
  const providerCostControlBoundary = projectProviderCostControlBoundary({
    request,
    resourceBindingId: accountGraph.resourceRef,
    costReconciliation: publishedCostReconciliation,
  });
  const assetAuthoritySponsorBoundary = projectAssetAuthoritySponsorBoundary({
    servicePayerAuthorityBoundary,
    providerCostControlBoundary,
    providerActionSafetyBoundary,
  });
  const providerResourceLifecycle = projectProviderResourceLifecycleReadback({
    request,
    receipt: latest,
    providerModule: 'realms_provider_binding',
    resourceBinding: request?.providerResourceBinding,
    provider: {
      resourceRef: accountGraph.resourceRef,
      ownerProgramRef: accountGraph.ownerProgramRef,
      observedSlot: accountGraph.observedSlot,
      lastTransactionSlot: accountGraph.lastTransactionSlot,
      stateDigest: accountGraph.stateDigest,
    },
    executionAuthorities,
    transactions: providerReceipt.transactions,
  });
  const providerTrustObservation = projectProviderTrustObservation(
    providerReceipt.transactions,
    request,
  );
  const reconciliationFallback = projectProviderReconciliationFallbackReadback({
    providerModule: 'realms_provider_binding',
    request,
    receipt: latest,
    provider: {
      resourceRef: accountGraph.resourceRef,
      ownerProgramRef: accountGraph.ownerProgramRef,
      profileRef: providerReceipt.profileRef,
      profileVersion: providerReceipt.profileVersion,
    },
    profileRevalidation: null,
    providerIncident: reconciliation?.providerIncident ?? null,
  });
  return compactObject({
    schemaVersion: 1,
    status: reconciliation?.state === 'hold' ? 'held' : 'executed',
    integrity: 'verified',
    blocker: reconciliation?.blocker ?? null,
    recovery: reconciliation?.state === 'hold'
      ? projectProviderExecutionRecovery(reconciliation.blocker, null)
      : null,
    receiptId: optionalString(latest.id),
    evidenceDigest: optionalString(latest.executionEvidenceDigest),
    executedAt: dateTime(latest.executedAt),
    effect: evidence.effect,
    privateEvidenceRelease,
    provider: {
      module: 'realms_provider_binding',
      chainId: providerReceipt.chainId,
      profileRef: providerReceipt.profileRef,
      profileVersion: providerReceipt.profileVersion,
      finality: providerReceipt.providerFinality,
      resourceRef: accountGraph.resourceRef,
      ownerProgramRef: accountGraph.ownerProgramRef,
      observedSlot: accountGraph.observedSlot,
      lastTransactionSlot: accountGraph.lastTransactionSlot,
      stateDigest: accountGraph.stateDigest,
      proposalState: accountGraph.proposalState,
      instructionExecutionStatus: accountGraph.instructionExecutionStatus,
      noRealAssets: accountGraph.noRealAssets,
      transactionCount: providerReceipt.transactions.length,
      proposalTransactionReadback: {
        schemaVersion: 1,
        authority: 'provider_receipt_and_independent_finalized_readback',
        proposalRef: String(addresses.proposal),
        proposalTransactionRef: String(addresses.proposalTransaction),
        commitment: 'finalized',
        executionStatus: 'executed',
        instructions: providerReceipt.transactions.map((transaction: any) => {
          const action = projectRealmsBootstrapHumanReadableAction(
            transaction,
            plan,
            String(accountGraph.ownerProgramRef),
          );
          return {
            stepId: String(transaction.stepId),
            manifestDigest: String(transaction.manifestDigest),
            summary: action?.summary ?? String(transaction.stepId),
            programScope: action?.programScope ?? [String(accountGraph.ownerProgramRef)],
            signature: String(transaction.signature),
            slot: Number(transaction.slot),
            commitment: 'finalized',
            executionStatus: 'finalized',
            opaqueInstruction: false,
          };
        }),
      },
      executionPlanReadback: projectProviderExecutionPlanReadback({
        request,
        receipt: latest,
        evidence,
        providerModule: 'realms_provider_binding',
        executionMode: 'realms',
        chainId: providerReceipt.chainId,
        resourceRef: accountGraph.resourceRef,
        planDigest: plan.planDigest,
        transactions: providerReceipt.transactions,
        projectHumanReadableAction: (transaction) => (
          projectRealmsBootstrapHumanReadableAction(
            transaction,
            plan,
            String(accountGraph.ownerProgramRef),
          )
        ),
      }),
      providerActionSafetyBoundary,
      providerResourceLifecycle,
      servicePayerAuthorityBoundary,
      providerCostControlBoundary,
      assetAuthoritySponsorBoundary,
      attemptOwner: projectProviderTerminalAttemptOwner(request, latest, evidence),
      retryBoundary: projectProviderRetryBoundary(
        request,
        latest,
        evidence,
        providerReceipt.transactions,
      ),
      costReconciliation: publishedCostReconciliation,
      ...(expiredAttemptHistory ? { expiredAttemptHistory } : {}),
      profileRevalidation: {
        state: 'verified_current',
        profileDigest: currentProfileReadiness.profileDigest,
        decoderConformance: currentProfileReadiness.decoderConformance,
      },
      trustProfile: {
        profileDigest: currentProfileReadiness.profileDigest,
        readinessState: currentProfileReadiness.readinessState,
        riskMaturity: currentProfileReadiness.riskMaturity,
        genesisHash: currentProfile.chain.genesisHash,
        programId: currentProfile.deployment.programId,
        loaderProgramId: currentProfile.deployment.loaderProgramId,
        programDataAddress: currentProfile.deployment.programDataAddress,
        upgradeAuthority: currentProfile.deployment.upgradeAuthority,
        deployedProgramBytesSha256: currentProfile.deployment.deployedProgramBytesSha256,
        deploymentObservedSlot: currentProfile.deployment.observation.slot,
        deploymentObservedAt: currentProfile.deployment.observation.observedAt,
        decoderPackage: currentProfile.clientDecoder.packageName,
        decoderVersion: currentProfile.clientDecoder.version,
        decoderArtifactSha256: currentProfile.clientDecoder.tarballSha256,
        decoderConformance: currentProfileReadiness.decoderConformance,
        commitment: currentProfile.readback.commitment,
        rpcAccess: currentProfile.readback.rpc.access,
        rpcIndexerCrossCheck: 'rpc_finalized_only_indexer_not_configured',
        ...(providerTrustObservation ?? {}),
      },
      executionAuthorities,
      authorityPaymentBoundary,
      mandateCostPolicy,
      fundingSourceFeePayerBoundary,
      enforcementDisclosure: executionAuthorities ? {
        schemaVersion: 1,
        mode: 'provider_onchain',
        providerModule: 'realms_provider_binding',
        resourceRef: accountGraph.resourceRef,
        ownerProgramRef: accountGraph.ownerProgramRef,
        decisionLinkage: {
          requestId: request.id,
          decisionDigest: latest.decisionDigest,
        },
        allowedOperations: providerReceipt.transactions.map((transaction: any) => (
          String(transaction.stepId)
        )),
        verificationState: 'verified',
        version: providerReceipt.profileVersion,
        proofScope: 'spl_governance_owner_program_and_transit_signatures_match_accepted_decision',
        residualBypassRisk: 'custodied_authority_can_sign_allowed_provider_operations_outside_alcheme_request_path',
        bypassPrevented: false,
      } : null,
      transactions: providerReceipt.transactions.map((transaction: any, index: number) => ({
        stepId: String(transaction.stepId),
        signature: String(transaction.signature),
        slot: Number(transaction.slot),
        messageDigest: String(transaction.messageDigest),
        manifestDigest: String(transaction.manifestDigest),
        ...(projectProviderTransactionAttemptContext(transaction, request)
          ? { attemptContext: projectProviderTransactionAttemptContext(transaction, request) }
          : {}),
        ...(projectProviderExecutionActionContext({
          request,
          receipt: latest,
          evidence,
          transaction,
          transactions: providerReceipt.transactions,
          planDigest: plan.planDigest,
        }) ? {
            actionContext: projectProviderExecutionActionContext({
              request,
              receipt: latest,
              evidence,
              transaction: providerReceipt.transactions[index],
              transactions: providerReceipt.transactions,
              planDigest: plan.planDigest,
            }),
          } : {}),
        ...(projectRealmsBootstrapHumanReadableAction(
          transaction,
          plan,
          String(accountGraph.ownerProgramRef),
        ) ? {
            humanReadableAction: projectRealmsBootstrapHumanReadableAction(
              transaction,
              plan,
              String(accountGraph.ownerProgramRef),
            ),
          } : {}),
        feeLamports: Number(transaction.feeLamports),
        ...(Number.isSafeInteger(transaction.directRentLamports)
          ? { directRentLamports: Number(transaction.directRentLamports) }
          : {}),
        actualSpendLamports: Number(transaction.actualSpendLamports),
        finalityTransitions: transaction.finalityTransitions.map((transition: any) => ({
          state: transition.state,
          authority: transition.authority,
          ...(transition.slot === undefined ? {} : { slot: Number(transition.slot) }),
        })),
      })),
    },
    decisionMapping: {
      sourceDecisionDigest: latest.decisionDigest,
      sourceMechanism: {
        kind: mechanism.kind,
        contractDigest: mechanism.contractDigest,
        resultDigest: mechanism.resultDigest,
      },
      providerProposalRef: addresses.proposal,
      providerVoteRecordRef: addresses.voteRecord,
      providerVoterTokenOwnerRecordRef: addresses.voterTokenOwnerRecord,
      providerVote: 'approve',
      yesVoteWeight: accountGraph.yesVoteWeight,
      voterWeight: accountGraph.voterWeight,
      providerResult: 'completed',
      authorityBoundary: 'governance_voter_authorizes_request_provider_authority_executes_decision',
    },
    reconciliation: reconciliation
      ? {
        state: reconciliation.state,
        blocker: reconciliation.blocker,
        authority: reconciliation.authority,
        observedStateDigest: reconciliation.observedStateDigest,
        observedSlot: reconciliation.observedSlot,
        accountSemantics: reconciliation.accountSemantics,
        votingPowerSecurity: reconciliation.votingPowerSecurity,
        providerIncident: reconciliation.providerIncident,
        reconciliationFallback,
        observedAt: reconciliation.observedAt,
      }
      : null,
    attempts: {
      total: attempts.length,
      failed: failedAttemptCount,
      history: attempts,
    },
    linkage,
  });
}

export function projectGovernancePublicProviderExecutionReference(
  request: any,
): Record<string, unknown> | null {
  const execution = projectGovernanceProviderExecutionReadback(request) as any;
  const provider = execution?.provider;
  const reconciliation = execution?.reconciliation;
  const rawTransactions = Array.isArray(provider?.transactions) ? provider.transactions : [];
  const providerTransactions = rawTransactions.length <= 12
    && rawTransactions.every((transaction: any) => (
      optionalString(transaction?.stepId)
      && optionalString(transaction?.signature)
      && Number.isSafeInteger(Number(transaction?.slot))
      && Number(transaction.slot) > 0
    ))
    ? rawTransactions.map((transaction: any) => ({
        stepId: String(transaction.stepId),
        signature: String(transaction.signature),
        slot: Number(transaction.slot),
        commitment: 'finalized' as const,
      }))
    : null;
  const proposal = provider?.proposalTransactionReadback;
  const enforcement = provider?.enforcementDisclosure;
  const businessState = compactObject({
    proposalState: optionalString(provider?.proposalState),
    vaultTransactionState: optionalString(provider?.vaultTransactionState),
    instructionExecutionStatus: optionalString(provider?.instructionExecutionStatus),
    providerResult: optionalString(execution?.decisionMapping?.providerResult),
    historicalVoteInvariant: optionalString(execution?.decisionMapping?.historicalVoteInvariant),
    canonicalFundingStatus: optionalString(execution?.grantSettlement?.canonicalFundingStatus),
  });
  const residualBypassRisk = enforcement?.mode === 'provider_onchain'
    && enforcement?.providerModule === provider?.module
    && enforcement?.resourceRef === provider?.resourceRef
    && enforcement?.decisionLinkage?.requestId === request?.id
    && enforcement?.decisionLinkage?.decisionDigest === request?.decision?.decisionDigest
    && enforcement?.residualBypassRisk
      === 'custodied_authority_can_sign_allowed_provider_operations_outside_alcheme_request_path'
    && enforcement?.bypassPrevented === false
    ? {
        enforcementMode: 'provider_onchain' as const,
        risk: 'custodied_authority_can_sign_allowed_provider_operations_outside_alcheme_request_path' as const,
        bypassPrevented: false as const,
      }
    : enforcement?.mode === 'multisig_threshold'
      && enforcement?.providerModule === provider?.module
      && enforcement?.resourceRef === provider?.resourceRef
      && enforcement?.decisionLinkage?.requestId === request?.id
      && enforcement?.decisionLinkage?.decisionDigest === request?.decision?.decisionDigest
      && enforcement?.residualBypassRisk
        === 'threshold_signers_can_create_or_execute_transactions_outside_alcheme'
      && enforcement?.bypassPrevented === false
      ? {
          enforcementMode: 'multisig_threshold' as const,
          risk: 'threshold_signers_can_create_or_execute_transactions_outside_alcheme' as const,
          bypassPrevented: false as const,
        }
      : null;
  const executionAuthorizationReceipt = projectProviderExecutionAuthorizationReceiptReadback({
    request,
    execution,
    provider,
    reconciliation,
    businessState,
  });
  if (
    execution?.status !== 'executed'
    || execution?.integrity !== 'verified'
    || !provider
    || !reconciliation
    || reconciliation.state !== 'verified'
    || reconciliation.authority !== 'independent_provider_readback'
    || !['realms_provider_binding', 'squads_provider_binding'].includes(String(provider.module))
    || typeof provider.chainId !== 'string'
    || typeof provider.resourceRef !== 'string'
    || typeof execution.receiptId !== 'string'
    || !isSha256(execution.evidenceDigest)
    || provider.finality !== 'finalized'
    || !optionalString(provider.ownerProgramRef)
    || !providerTransactions
    || !residualBypassRisk
    || Object.keys(businessState).length === 0
  ) return null;
  const identity = {
    schemaVersion: 1,
    provider: provider.module,
    network: provider.chainId,
    resourceRef: provider.resourceRef,
    receiptId: execution.receiptId,
    receiptEvidenceDigest: execution.evidenceDigest,
    finality: 'finalized' as const,
    reconciliationAuthority: 'independent_provider_readback' as const,
    effect: optionalString(execution.effect),
    ownerProgramRef: String(provider.ownerProgramRef),
    proposalRef: optionalString(proposal?.proposalRef),
    proposalTransactionRef: optionalString(proposal?.proposalTransactionRef),
    transactions: providerTransactions,
    residualBypassRisk,
    businessState,
    ...(executionAuthorizationReceipt ? { executionAuthorizationReceipt } : {}),
  };
  return compactObject({
    ...identity,
    ref: `provider-execution:${hashCanonicalGovernanceValue(
      'alcheme.governance.public-provider-execution-reference-v1',
      identity,
    )}`,
    observedSlot: Number.isSafeInteger(reconciliation.observedSlot)
      ? reconciliation.observedSlot
      : null,
    observedAt: dateTime(reconciliation.observedAt),
    providerNative: {
      ownerProgramRef: identity.ownerProgramRef,
      proposalRef: identity.proposalRef,
      proposalTransactionRef: identity.proposalTransactionRef,
      transactions: identity.transactions,
      transactionCount: identity.transactions.length,
      rawTransactionExposed: false,
      signerKeyRefExposed: false,
    },
    residualBypassRisk: identity.residualBypassRisk,
    businessState: identity.businessState,
    ...(identity.executionAuthorizationReceipt
      ? { executionAuthorizationReceipt: identity.executionAuthorizationReceipt }
      : {}),
  });
}

function projectProviderExecutionAuthorizationReceiptReadback(input: {
  request: any;
  execution: any;
  provider: any;
  reconciliation: any;
  businessState: Record<string, unknown>;
}): Record<string, unknown> | null {
  const attemptOwner = isRecord(input.provider?.attemptOwner) ? input.provider.attemptOwner : null;
  const plan = isRecord(input.provider?.executionPlanReadback)
    ? input.provider.executionPlanReadback
    : null;
  const duplicatePrevention = isRecord(plan?.duplicatePrevention)
    ? plan.duplicatePrevention
    : null;
  const duplicateChecks = isRecord(duplicatePrevention?.checks)
    ? duplicatePrevention.checks
    : null;
  const trustProfile = isRecord(input.provider?.trustProfile) ? input.provider.trustProfile : null;
  const actions = Array.isArray(plan?.actions) ? plan.actions : [];
  const operations = actions.map((action: any) => optionalString(action?.operation));
  const observedStateDigest = optionalString(input.reconciliation?.observedStateDigest)
    ?? optionalString(input.provider?.stateDigest);
  if (
    input.request?.decision?.decision !== 'accepted'
    || !optionalString(input.request?.id)
    || !isSha256(input.request?.decision?.decisionDigest)
    || input.execution?.receiptId == null
    || !isSha256(input.execution?.evidenceDigest)
    || input.execution?.status !== 'executed'
    || input.execution?.integrity !== 'verified'
    || input.provider?.finality !== 'finalized'
    || input.reconciliation?.state !== 'verified'
    || input.reconciliation?.authority !== 'independent_provider_readback'
    || !Number.isSafeInteger(input.reconciliation?.observedSlot)
    || input.reconciliation.observedSlot <= 0
    || !isSha256(observedStateDigest)
    || !attemptOwner
    || attemptOwner.status !== 'consumed'
    || attemptOwner.requestId !== input.request.id
    || attemptOwner.decisionDigest !== input.request.decision.decisionDigest
    || !optionalString(attemptOwner.preflightId)
    || !isSha256(attemptOwner.actionIntentDigest)
    || !isSha256(attemptOwner.transactionAttemptDigest)
    || !plan
    || plan.requestId !== input.request.id
    || plan.decisionDigest !== input.request.decision.decisionDigest
    || plan.actionIntentDigest !== attemptOwner.actionIntentDigest
    || plan.terminalTransactionAttemptDigest !== attemptOwner.transactionAttemptDigest
    || !isSha256(plan.planDigest)
    || !isSha256(plan.actionSetDigest)
    || plan.aggregateStatus !== 'executed'
    || duplicatePrevention?.authority
      !== 'canonical_action_intent_attempt_and_authoritative_provider_readback'
    || duplicatePrevention?.state !== 'protected_no_duplicate_action_observed'
    || duplicatePrevention?.duplicateActionObserved !== false
    || duplicateChecks?.uniqueActionIdempotencyKeys !== true
    || duplicateChecks?.uniqueProviderReferences !== true
    || duplicateChecks?.everyAttemptFinalized !== true
    || duplicateChecks?.everyAttemptManifestBound !== true
    || duplicateChecks?.authoritativeProviderReadback !== true
    || actions.length === 0
    || operations.some((operation: string | null) => !operation)
    || actions.some((action: any) => (
      action?.atomicity !== 'single_provider_transaction'
      || !Array.isArray(action?.attempts)
      || action.attempts.length !== 1
      || action.attempts[0]?.status !== 'finalized'
      || !isSha256(action.attempts[0]?.messageDigest)
      || !isSha256(action.attempts[0]?.manifestDigest)
    ))
    || !trustProfile
    || !isSha256(trustProfile.profileDigest)
    || !optionalString(input.provider?.profileRef)
    || !Number.isSafeInteger(input.provider?.profileVersion)
    || !optionalString(input.provider?.resourceRef)
    || !optionalString(input.provider?.ownerProgramRef)
    || Object.keys(input.businessState).length === 0
  ) return null;

  return {
    schemaVersion: 1,
    receiptRole: 'design_input_only',
    authority: 'canonical_request_decision_cost_preflight_and_provider_truth_readback',
    requestId: String(input.request.id),
    decisionDigest: String(input.request.decision.decisionDigest),
    receiptId: String(input.execution.receiptId),
    authorizationStatus: 'authorized',
    normalizedDecision: {
      decision: 'accepted',
      executionStatus: 'executed',
      decisionDigest: String(input.request.decision.decisionDigest),
      providerResult: optionalString(input.businessState.providerResult),
      businessStateAuthority: 'independent_provider_readback',
    },
    providerTruth: {
      authority: 'independent_provider_readback',
      providerNativeEvidenceDigest: String(input.execution.evidenceDigest),
      finalizedProviderNativeEvidence: true,
      dbReceiptIsProviderTruth: false,
    },
    issuerTrust: {
      mode: 'provider_native_trust_profile',
      issuerRef: String(input.provider.module),
      trustProfileDigest: String(trustProfile.profileDigest),
      jwsIngestion: 'not_applicable_provider_native_finalized_transaction',
      revocationIngestion: 'not_applicable_provider_native_finalized_transaction',
      providerProfileRef: String(input.provider.profileRef),
      providerProfileVersion: Number(input.provider.profileVersion),
    },
    operationPayloadTarget: {
      actionIntentDigest: String(plan.actionIntentDigest),
      planDigest: String(plan.planDigest),
      terminalTransactionAttemptDigest: String(plan.terminalTransactionAttemptDigest),
      actionSetDigest: String(plan.actionSetDigest),
      targetResourceRef: String(input.provider.resourceRef),
      ownerProgramRef: String(input.provider.ownerProgramRef),
      operations: operations.map(String),
      liveState: {
        authority: 'independent_provider_readback',
        observedSlot: Number(input.reconciliation.observedSlot),
        observedStateDigest,
        finality: 'finalized',
      },
    },
    oneTimeConsumption: {
      authority: 'canonical_cost_preflight',
      preflightId: String(attemptOwner.preflightId),
      status: 'consumed',
      atomicConsumption: 'single_cost_preflight_update_conflict_fail_closed',
      duplicateActionObserved: false,
    },
  };
}

export function projectGovernancePublicProviderExecutionStatus(
  request: any,
): Record<string, unknown> | null {
  const decisionExecution = projectGovernanceDecisionExecutionStatus(request);
  if (decisionExecution.decisionStatus !== 'accepted') return null;

  const execution = projectGovernanceProviderExecutionReadback(request) as any;
  if (
    !execution
    || !['executed', 'failed', 'held'].includes(String(execution.status))
    || !['verified', 'invalid'].includes(String(execution.integrity))
  ) return null;

  const recovery = isRecord(execution.recovery)
    && execution.recovery.acceptedDecisionPreserved === true
    ? compactObject({
        category: optionalString(execution.recovery.category),
        action: optionalString(execution.recovery.action),
        automaticMutation: execution.recovery.automaticMutation === false ? false : null,
        authorityChangeAllowed: execution.recovery.authorityChangeAllowed === false ? false : null,
        payerChangeAllowed: execution.recovery.payerChangeAllowed === false ? false : null,
        acceptedDecisionPreserved: true,
        decisionMutationAllowed: execution.recovery.decisionMutationAllowed === false ? false : null,
        retryMode: optionalString(execution.recovery.retryMode),
        nextEligibleAt: dateTime(execution.recovery.nextEligibleAt),
      })
    : null;
  const incident = isRecord(execution.reconciliation?.providerIncident)
    && execution.reconciliation.providerIncident.authority === 'independent_provider_readback'
    && execution.reconciliation.providerIncident.originalDecisionAndReceipt === 'preserved'
    ? compactObject({
        incidentId: optionalString(execution.reconciliation.providerIncident.incidentId),
        lifecycleState: optionalString(execution.reconciliation.providerIncident.lifecycleState),
        authority: 'independent_provider_readback',
        blocker: optionalString(execution.reconciliation.providerIncident.blocker),
        occurredAt: dateTime(execution.reconciliation.providerIncident.occurredAt),
        eventDigest: optionalString(execution.reconciliation.providerIncident.eventDigest),
        lastReconciledAt: dateTime(execution.reconciliation.providerIncident.lastReconciledAt),
        pendingExecution: optionalString(execution.reconciliation.providerIncident.pendingExecution),
        originalDecisionAndReceipt: 'preserved',
      })
    : null;

  return compactObject({
    schemaVersion: 1,
    status: execution.status,
    integrity: execution.integrity,
    blocker: optionalString(execution.blocker),
    acceptedDecisionPreserved: true,
    recovery,
    incident,
  });
}

function projectProviderReconciliationFallbackReadback(input: {
  providerModule: 'realms_provider_binding' | 'squads_provider_binding';
  request: any;
  receipt: any;
  provider: {
    resourceRef: unknown;
    ownerProgramRef: unknown;
    profileRef: unknown;
    profileVersion: unknown;
  };
  profileRevalidation: Record<string, any> | null;
  providerIncident: ProjectedRealmsProviderIncident | null;
}): Record<string, unknown> | null {
  const readiness = input.providerModule === 'squads_provider_binding'
    ? resolveSquadsProviderTrustReadiness()
    : resolveRealmsProviderTrustReadiness();
  const profile = input.providerModule === 'squads_provider_binding'
    ? getSquadsProviderTrustProfile()
    : getRealmsProviderTrustProfile();
  const policy = (profile as any).reconciliationPolicy;
  const incident = input.providerIncident;
  const revalidation = input.profileRevalidation?.integrity === 'verified'
    ? input.profileRevalidation
    : null;
  const sourceState = incident
    ? 'provider_incident'
    : revalidation
      ? 'profile_revalidation'
      : null;
  if (
    !policy
    || policy.schemaVersion !== 1
    || policy.authorityRef !== 'provider_trust_profile_reconciliation_policy'
    || policy.reconciliationAuthorityRef !== 'independent_provider_readback'
    || policy.conflictRule !== 'questioned_provider_program_decoder_cannot_adjudicate_itself'
    || policy.fallbackMechanism?.mode !== 'manual_recovery_only'
    || policy.fallbackMechanism?.independentFallbackProviderRef !== null
    || policy.fallbackMechanism?.activation !== 'fail_closed_when_independent_fallback_absent'
    || policy.fallbackMechanism?.operatorMaySelectProvider !== false
    || policy.fallbackMechanism?.questionedProviderMayAdjudicate !== false
    || policy.superseding?.artifactOwner !== 'DecisionOutputArtifact'
    || policy.superseding?.receiptOwner !== 'GovernanceExecutionReceipt'
    || policy.superseding?.materialChangeGate !== 'new_decision_stage_or_superseding_case'
    || policy.superseding?.required !== true
    || !sourceState
    || !optionalString(input.request?.id)
    || !isSha256(input.request?.decision?.decisionDigest)
    || !optionalString(input.receipt?.id)
    || !isSha256(input.receipt?.executionEvidenceDigest)
    || !optionalString(input.provider.resourceRef)
    || !optionalString(input.provider.ownerProgramRef)
  ) return null;
  const correctedState = revalidation
    ? {
        source: 'frozen_provider_trust_profile_target' as const,
        targetProfileRef: optionalString(revalidation.target?.profileRef),
        targetProfileVersion: Number.isSafeInteger(Number(revalidation.target?.profileVersion))
          ? Number(revalidation.target.profileVersion)
          : null,
        targetProfileDigest: isSha256(revalidation.target?.profileDigest)
          ? String(revalidation.target.profileDigest)
          : null,
        targetOwnerProgramRef: optionalString(revalidation.target?.ownerProgramRef),
        decoderConformance: optionalString(revalidation.target?.decoderConformance),
      }
    : {
        source: 'manual_recovery_pending' as const,
        targetProfileRef: null,
        targetProfileVersion: null,
        targetProfileDigest: null,
        targetOwnerProgramRef: null,
        decoderConformance: null,
      };
  if (
    correctedState.source === 'frozen_provider_trust_profile_target'
    && (
      !correctedState.targetProfileRef
      || !correctedState.targetProfileVersion
      || !correctedState.targetProfileDigest
      || !correctedState.targetOwnerProgramRef
      || !correctedState.decoderConformance
    )
  ) return null;
  const readback = {
    schemaVersion: 1,
    authority: 'frozen_trust_profile_and_independent_provider_readback' as const,
    sourceState,
    providerModule: input.providerModule,
    profileRef: readiness.profileRef,
    profileVersion: readiness.profileVersion,
    profileDigest: readiness.profileDigest,
    reconciliationAuthorityRef: policy.reconciliationAuthorityRef,
    decisionAuthorityRef: policy.decisionAuthorityRef,
    conflictRule: policy.conflictRule,
    originalEvidence: {
      requestId: String(input.request.id),
      receiptId: String(input.receipt.id),
      receiptEvidenceDigest: String(input.receipt.executionEvidenceDigest),
      originalDecisionDigest: String(input.request.decision.decisionDigest),
      preserved: true as const,
    },
    affectedObjects: {
      resourceRef: String(input.provider.resourceRef),
      ownerProgramRef: String(input.provider.ownerProgramRef),
      providerProfileRef: optionalString(input.provider.profileRef),
      providerProfileVersion: Number.isSafeInteger(Number(input.provider.profileVersion))
        ? Number(input.provider.profileVersion)
        : null,
      incidentId: incident?.incidentId ?? null,
      profileRevalidationBlocker: revalidation?.blocker ?? null,
    },
    correctedState,
    fallbackMechanism: {
      mode: 'manual_recovery_only' as const,
      independentFallbackProviderRef: null,
      activation: 'fail_closed_when_independent_fallback_absent' as const,
      operatorMaySelectProvider: false as const,
      questionedProviderMayAdjudicate: false as const,
    },
    superseding: {
      artifactOwner: 'DecisionOutputArtifact' as const,
      receiptOwner: 'GovernanceExecutionReceipt' as const,
      materialChangeGate: 'new_decision_stage_or_superseding_case' as const,
      required: true as const,
    },
  };
  return {
    ...readback,
    policyDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.provider-reconciliation-fallback-policy-readback-v1',
      readback,
    ),
  };
}

function projectRealmsProviderProfileRevalidation(binding: any): null | Record<string, any> {
  const verification = isRecord(binding?.verification) ? binding.verification : null;
  const value = isRecord(verification?.profileRevalidation)
    ? verification.profileRevalidation
    : null;
  if (!value) return null;
  const current = isRecord(value.current) ? value.current : null;
  const target = isRecord(value.target) ? value.target : null;
  const readiness = resolveRealmsProviderTrustReadiness();
  const observedAt = dateTime(value.observedAt);
  const triggers = Array.isArray(value.triggers) ? value.triggers : [];
  const validTriggers = new Set([
    'profile_ref_drift',
    'profile_version_drift',
    'profile_digest_drift',
    'program_drift',
  ]);
  const valid = (
    value.schemaVersion === 1
    && value.state === 'hold'
    && value.blocker === 'provider_profile_revalidation_required'
    && value.authority === 'frozen_provider_trust_profile'
    && value.resourceBindingId === binding?.id
    && ['degraded', 'disabled'].includes(String(binding?.status))
    && triggers.length > 0
    && triggers.every((trigger: unknown) => validTriggers.has(String(trigger)))
    && new Set(triggers).size === triggers.length
    && current?.profileRef === binding?.profileRef
    && current?.profileVersion === binding?.profileVersion
    && current?.profileDigest === (isSha256(verification?.profileDigest) ? verification.profileDigest : null)
    && current?.ownerProgramRef === binding?.ownerProgramRef
    && target?.profileRef === readiness.profileRef
    && target?.profileVersion === readiness.profileVersion
    && target?.profileDigest === readiness.profileDigest
    && target?.ownerProgramRef === readiness.programId
    && target?.decoderConformance === readiness.decoderConformance
    && value.transitionPolicy === 'governed_transition_plan_pin_suspend_reopen'
    && value.executionDisposition === 'blocked'
    && observedAt !== null
  );
  if (!valid) return { integrity: 'invalid' };
  return {
    integrity: 'verified',
    state: 'revalidation_required',
    blocker: 'provider_profile_revalidation_required',
    authority: 'frozen_provider_trust_profile',
    triggers: triggers.map(String),
    current,
    target,
    transitionPolicy: value.transitionPolicy,
    executionDisposition: value.executionDisposition,
    observedAt,
  };
}

function projectRealmsVotingPowerChallengeExecution(
  request: any,
  receipt: any,
  evidence: Record<string, any>,
  attempts: Array<any>,
  failedAttemptCount: number,
  linkage: Record<string, any>,
) {
  const post = isRecord(evidence.postReadback) ? evidence.postReadback : {};
  const security = post.votingPowerSecurity;
  const binding = request?.providerResourceBinding;
  const challenge = isRecord(binding?.verification?.votingPowerChallenge)
    ? binding.verification.votingPowerChallenge
    : {};
  return compactObject({
    schemaVersion: 1,
    status: 'executed',
    integrity: 'verified',
    blocker: null,
    receiptId: optionalString(receipt.id),
    evidenceDigest: optionalString(receipt.executionEvidenceDigest),
    executedAt: dateTime(receipt.executedAt),
    effect: evidence.effect,
    provider: {
      module: 'realms_provider_binding',
      chainId: security.source.chainId,
      profileRef: security.source.profileRef,
      profileVersion: security.source.profileVersion,
      finality: 'finalized',
      resourceRef: security.source.realm,
      ownerProgramRef: security.source.programId,
      observedSlot: post.observedSlot,
      lastTransactionSlot: null,
      stateDigest: post.observedStateDigest,
      proposalState: 'completed',
      instructionExecutionStatus: 'success',
      noRealAssets: true,
      transactionCount: 0,
      transactions: [],
    },
    reconciliation: {
      state: 'verified',
      blocker: null,
      authority: 'independent_provider_readback',
      observedStateDigest: post.observedStateDigest,
      observedSlot: post.observedSlot,
      accountSemantics: post.accountSemantics,
      votingPowerSecurity: security,
      votingPowerChallenge: {
        state: 'reopened',
        requestId: challenge.requestId,
        preObservedSlot: challenge.preReadback.observedSlot,
        postObservedSlot: challenge.postReadback.observedSlot,
        historicalTallyInvariant: 'unchanged',
        blocker: null,
      },
      observedAt: post.observedAt,
    },
    attempts: {
      total: attempts.length,
      failed: failedAttemptCount,
      history: attempts,
    },
    linkage,
  });
}

interface ProjectedRealmsProviderIncident {
  incidentId: string;
  lifecycleState: 'suspected' | 'confirmed' | 'contained' | 'reconciled';
  authority: 'independent_provider_readback';
  blocker: 'provider_readback_outage' | 'provider_readback_conflict' | null;
  occurredAt: string;
  eventDigest: string;
  lastReconciledAt: string | null;
  pendingExecution: 'blocked' | 'eligible_after_reconciliation';
  originalDecisionAndReceipt: 'preserved';
}

function projectRealmsProviderIncident(
  binding: any,
  receipt: any,
  accountGraph: Record<string, any> | null,
): { valid: boolean; latest: ProjectedRealmsProviderIncident | null } {
  const ledger = isRecord(binding?.verification?.providerIncidentLedger)
    ? binding.verification.providerIncidentLedger
    : null;
  if (ledger === null) return { valid: true, latest: null };
  if (ledger.schemaVersion !== 1 || !Array.isArray(ledger.events) || ledger.events.length === 0) {
    return { valid: false, latest: null };
  }
  let previousEventDigest: string | null = null;
  const openIncidents = new Map<string, Record<string, any>>();
  let latest: ProjectedRealmsProviderIncident | null = null;
  let lastReconciledAt: string | null = null;
  for (const raw of ledger.events) {
    if (!isRecord(raw)) return { valid: false, latest: null };
    const event = raw;
    const facts = { ...event };
    delete facts.eventDigest;
    const occurredAt = dateTime(event.occurredAt);
    if (
      event.schemaVersion !== 1
      || !isSha256(event.incidentId)
      || !['suspected', 'confirmed', 'contained', 'reconciled'].includes(String(event.lifecycleState))
      || event.authority !== 'independent_provider_readback'
      || event.resourceBindingId !== binding.id
      || event.receiptId !== receipt.id
      || event.originalReceiptEvidenceDigest !== receipt.executionEvidenceDigest
      || event.expectedStateDigest !== accountGraph?.stateDigest
      || event.previousEventDigest !== previousEventDigest
      || !isSha256(event.eventDigest)
      || event.eventDigest !== hashCanonicalGovernanceValue(
        'alcheme.governance.realms-provider-incident-event-v1',
        facts,
      )
      || occurredAt === null
    ) return { valid: false, latest: null };
    if (event.lifecycleState === 'suspected') {
      if (
        openIncidents.has(event.incidentId)
        || !['provider_readback_outage', 'provider_readback_conflict'].includes(String(event.blocker))
        || event.observedStateDigest !== null
        || event.observedSlot !== null
        || event.supersedesEventDigest !== null
      ) return { valid: false, latest: null };
      openIncidents.set(event.incidentId, event);
    } else if (event.lifecycleState === 'confirmed' || event.lifecycleState === 'contained') {
      const previous = openIncidents.get(String(event.incidentId));
      if (
        !previous
        || (event.lifecycleState === 'confirmed' && previous.lifecycleState !== 'suspected')
        || (event.lifecycleState === 'contained' && previous.lifecycleState !== 'confirmed')
        || (event.lifecycleState === 'confirmed'
          && new Date(String(event.occurredAt)).getTime()
            <= new Date(String(previous.occurredAt)).getTime())
        || (event.lifecycleState === 'contained'
          && event.occurredAt !== previous.occurredAt)
        || event.blocker !== previous.blocker
        || event.originalReceiptEvidenceDigest !== previous.originalReceiptEvidenceDigest
        || event.expectedStateDigest !== previous.expectedStateDigest
        || event.observedStateDigest !== null
        || event.observedSlot !== null
        || event.supersedesEventDigest !== previous.eventDigest
      ) return { valid: false, latest: null };
      openIncidents.set(String(event.incidentId), event);
    } else {
      const open = openIncidents.get(String(event.incidentId));
      if (
        !open
        || event.blocker !== null
        || !isSha256(event.observedStateDigest)
        || !Number.isSafeInteger(event.observedSlot)
        || Number(event.observedSlot) <= 0
        || event.supersedesEventDigest !== open.eventDigest
      ) return { valid: false, latest: null };
      openIncidents.delete(String(event.incidentId));
      lastReconciledAt = occurredAt;
    }
    previousEventDigest = String(event.eventDigest);
    latest = {
      incidentId: String(event.incidentId),
      lifecycleState: event.lifecycleState as ProjectedRealmsProviderIncident['lifecycleState'],
      authority: 'independent_provider_readback',
      blocker: event.blocker as ProjectedRealmsProviderIncident['blocker'],
      occurredAt,
      eventDigest: String(event.eventDigest),
      lastReconciledAt,
      pendingExecution: event.lifecycleState === 'reconciled'
        ? 'eligible_after_reconciliation'
        : 'blocked',
      originalDecisionAndReceipt: 'preserved',
    };
  }
  return { valid: true, latest };
}

function projectRealmsProviderReconciliation(
  request: any,
  receipt: any,
): null | {
  integrity: 'verified' | 'invalid';
  state: 'verified' | 'hold';
  blocker: 'provider_readback_outage' | 'provider_readback_conflict' | null;
  authority: 'independent_provider_readback';
  observedStateDigest: string | null;
  observedSlot: number | null;
  accountSemantics: {
    signatoryRecord: 'not_applicable_direct_governance_authority_signoff';
    voterWeightAddin: 'not_configured';
    maxVoterWeightAddin: 'not_configured';
    customPlugins: 'unavailable';
  } | null;
  votingPowerSecurity: RealmsVotingPowerSecurityProfile | null;
  votingPowerChallenge: {
    state: 'suspended' | 'reopened';
    requestId: string;
    preObservedSlot: number;
    postObservedSlot: number | null;
    historicalTallyInvariant: 'pending' | 'unchanged';
    blocker: 'challenge_resolution_pending' | null;
  } | null;
  providerIncident: ProjectedRealmsProviderIncident | null;
  observedAt: string;
} {
  const binding = request?.providerResourceBinding;
  if (binding == null) return null;
  const evidence = isRecord(receipt?.executionEvidence) ? receipt.executionEvidence : null;
  const providerReceipt = isRecord(evidence?.providerReceipt) ? evidence.providerReceipt : null;
  const accountGraph = isRecord(evidence?.accountGraph) ? evidence.accountGraph : null;
  const reconciliation = isRecord(binding?.verification)
    && isRecord(binding.verification.reconciliation)
    ? binding.verification.reconciliation
    : null;
  const state = reconciliation?.state;
  const blocker = reconciliation?.blocker ?? null;
  const observedStateDigest = reconciliation?.observedStateDigest ?? null;
  const observedSlot = reconciliation?.observedSlot ?? null;
  const accountSemantics = isRecord(reconciliation?.accountSemantics)
    ? reconciliation.accountSemantics
    : null;
  const votingPowerSecurity = reconciliation?.votingPowerSecurity ?? null;
  const votingPowerChallenge = isRecord(binding?.verification?.votingPowerChallenge)
    ? binding.verification.votingPowerChallenge
    : null;
  const challengePreReadback = isRecord(votingPowerChallenge?.preReadback)
    ? votingPowerChallenge.preReadback
    : null;
  const challengePostReadback = isRecord(votingPowerChallenge?.postReadback)
    ? votingPowerChallenge.postReadback
    : null;
  const observedAt = dateTime(reconciliation?.observedAt);
  const providerIncident = projectRealmsProviderIncident(binding, receipt, accountGraph);
  const valid = (
    reconciliation?.schemaVersion === 1
    && (state === 'verified' || state === 'hold')
    && reconciliation?.authority === 'independent_provider_readback'
    && reconciliation?.resourceBindingId === binding.id
    && reconciliation?.receiptId === receipt.id
    && reconciliation?.receiptEvidenceDigest === receipt.executionEvidenceDigest
    && reconciliation?.expectedStateDigest === accountGraph?.stateDigest
    && binding.resourceRef === accountGraph?.resourceRef
    && binding.ownerProgramRef === accountGraph?.ownerProgramRef
    && binding.profileRef === providerReceipt?.profileRef
    && binding.profileVersion === providerReceipt?.profileVersion
    && isSha256(binding.stateDigest)
    && observedAt != null
    && providerIncident.valid
    && (
      providerIncident.latest === null
      || (state === 'hold'
        ? ['suspected', 'confirmed', 'contained'].includes(providerIncident.latest.lifecycleState)
        : providerIncident.latest.lifecycleState === 'reconciled')
    )
    && (
      state === 'verified'
        ? binding.status === 'active'
          && blocker === null
          && isSha256(observedStateDigest)
          && binding.stateDigest === observedStateDigest
          && Number.isSafeInteger(observedSlot)
          && observedSlot > 0
          && accountSemantics?.signatoryRecord
            === 'not_applicable_direct_governance_authority_signoff'
          && accountSemantics?.voterWeightAddin === 'not_configured'
          && accountSemantics?.maxVoterWeightAddin === 'not_configured'
          && accountSemantics?.customPlugins === 'unavailable'
          && isCurrentRealmsVotingPowerSecurityProfile(votingPowerSecurity)
          && votingPowerSecurity.source.chainId === providerReceipt?.chainId
          && votingPowerSecurity.source.profileRef === binding.profileRef
          && votingPowerSecurity.source.profileVersion === binding.profileVersion
          && votingPowerSecurity.source.programId === binding.ownerProgramRef
          && votingPowerSecurity.source.realm === binding.resourceRef
          && votingPowerSecurity.source.snapshotSlot === observedSlot
        : binding.status === 'degraded'
          && (blocker === 'provider_readback_outage' || blocker === 'provider_readback_conflict')
          && observedStateDigest === null
          && observedSlot === null
          && accountSemantics === null
          && votingPowerSecurity === null
    )
    && (
      votingPowerChallenge === null
      || (
        votingPowerChallenge.schemaVersion === 1
        && ['suspended', 'reopened'].includes(String(votingPowerChallenge.state))
        && typeof votingPowerChallenge.requestId === 'string'
        && votingPowerChallenge.requestId.length > 0
        && Number.isSafeInteger(challengePreReadback?.observedSlot)
        && Number(challengePreReadback?.observedSlot) > 0
        && (
          votingPowerChallenge.state === 'reopened'
            ? Number.isSafeInteger(challengePostReadback?.observedSlot)
              && Number(challengePostReadback?.observedSlot) > 0
              && votingPowerChallenge.historicalTallyInvariant === 'unchanged'
              && votingPowerChallenge.blocker === null
            : votingPowerChallenge.historicalTallyInvariant === 'pending'
              && votingPowerChallenge.blocker === 'challenge_resolution_pending'
        )
      )
    )
  );
  if (!valid) {
    return {
      integrity: 'invalid',
      state: 'hold',
      blocker: 'provider_readback_conflict',
      authority: 'independent_provider_readback',
      observedStateDigest: null,
      observedSlot: null,
      accountSemantics: null,
      votingPowerSecurity: null,
      votingPowerChallenge: null,
      providerIncident: null,
      observedAt: observedAt ?? new Date(0).toISOString(),
    };
  }
  return {
    integrity: 'verified',
    state,
    blocker: blocker as 'provider_readback_outage' | 'provider_readback_conflict' | null,
    authority: 'independent_provider_readback',
    observedStateDigest: observedStateDigest as string | null,
    observedSlot: observedSlot as number | null,
    accountSemantics: accountSemantics as {
      signatoryRecord: 'not_applicable_direct_governance_authority_signoff';
      voterWeightAddin: 'not_configured';
      maxVoterWeightAddin: 'not_configured';
      customPlugins: 'unavailable';
    } | null,
    votingPowerSecurity: votingPowerSecurity as RealmsVotingPowerSecurityProfile | null,
    votingPowerChallenge: votingPowerChallenge === null ? null : {
      state: votingPowerChallenge.state as 'suspended' | 'reopened',
      requestId: String(votingPowerChallenge.requestId),
      preObservedSlot: Number(challengePreReadback?.observedSlot),
      postObservedSlot: votingPowerChallenge.state === 'reopened'
        ? Number(challengePostReadback?.observedSlot)
        : null,
      historicalTallyInvariant: votingPowerChallenge.state === 'reopened' ? 'unchanged' : 'pending',
      blocker: votingPowerChallenge.state === 'reopened' ? null : 'challenge_resolution_pending',
    },
    providerIncident: providerIncident.latest,
    observedAt,
  };
}

function latestExecutionReceipt(receipts: any[]): any | null {
  return receipts.reduce((latest: any | null, candidate: any) => {
    if (!latest) return candidate;
    const latestAt = new Date(latest?.executedAt ?? 0).getTime();
    const candidateAt = new Date(candidate?.executedAt ?? 0).getTime();
    if (candidateAt > latestAt) return candidate;
    if (candidateAt < latestAt) return latest;
    return String(candidate?.id ?? '').localeCompare(String(latest?.id ?? '')) > 0
      ? candidate
      : latest;
  }, null);
}

function projectProviderTransactionAttemptContext(
  transaction: any,
  request: any,
): Record<string, unknown> | null {
  const recentBlockhash = optionalString(transaction?.blockhash);
  const quotedFeeLamports = Number(transaction?.feeLamports);
  const preflight = Array.isArray(request?.invocation?.costPreflights)
    ? request.invocation.costPreflights[0]
    : null;
  const payer = preflight?.payerPolicy;
  const estimatedCost = isRecord(preflight?.estimatedCost) ? preflight.estimatedCost : null;
  const inventory = verifyProviderTransactionAttemptInventory(
    estimatedCost?.providerAttemptInventory,
  );
  const matchingAttempts = inventory?.attempts.filter((attempt) => (
    attempt.stepId === transaction?.stepId
    && attempt.providerReference === transaction?.signature
    && attempt.recentBlockhash === transaction?.blockhash
    && attempt.messageDigest === transaction?.messageDigest
    && attempt.manifestDigest === transaction?.manifestDigest
    && attempt.quotedFeeLamports === quotedFeeLamports
    && attempt.status === 'finalized'
  )) ?? [];
  const persistedAttempt = matchingAttempts.length === 1 ? matchingAttempts[0] : null;
  if (
    !recentBlockhash
    || !Number.isSafeInteger(quotedFeeLamports)
    || quotedFeeLamports < 0
    || !optionalString(transaction?.signature)
    || !isSha256(transaction?.messageDigest)
    || !isSha256(transaction?.manifestDigest)
    || !optionalString(preflight?.payerPolicyRef)
    || payer?.id !== preflight.payerPolicyRef
    || payer?.sourceRequestId !== request?.id
    || payer?.sourceDecisionDigest !== request?.decision?.decisionDigest
    || !inventory
    || inventory.actionIntentDigest !== preflight?.actionIntentDigest
    || inventory.payerPolicyId !== preflight?.payerPolicyRef
    || !persistedAttempt
    || persistedAttempt.quoteSlot === null
    || persistedAttempt.quotedAt === null
    || preflight?.transactionAttemptDigest !== inventory.latestAttemptDigest
  ) return null;
  return {
    schemaVersion: 1,
    authority: 'canonical_provider_attempt_inventory_and_terminal_receipt',
    persistenceAuthority: inventory.authority,
    transactionAttemptDigest: persistedAttempt.attemptDigest,
    attemptOrdinal: persistedAttempt.ordinal,
    recentBlockhash,
    quotedFeeLamports,
    feePayerRole: 'separated_fee_payer_policy',
    feePayerPolicyId: String(preflight.payerPolicyRef),
    feePayerBinding: 'canonical_payer_policy_and_solana_message_header',
    providerReference: String(transaction.signature),
    messageDigest: String(transaction.messageDigest),
    manifestDigest: String(transaction.manifestDigest),
    digestCoverage: 'message_digest_covers_fee_payer_and_compute_budget_instructions',
    quoteSlot: persistedAttempt.quoteSlot,
    quotedAt: persistedAttempt.quotedAt,
    quoteSlotState: 'verified_finalized_provider_quote',
    resimulationTrigger: persistedAttempt.resimulationTrigger,
    priorityFeeLamports: persistedAttempt.priorityFeeLamports,
    priorityFeeState: 'verified_zero_current_pinned_provider_constructor',
  };
}

function projectProviderTrustObservation(
  transactions: any[],
  request: any,
): { observationSlot: number; observationBlockhash: string } | null {
  for (const transaction of [...transactions].reverse()) {
    const attemptContext = projectProviderTransactionAttemptContext(transaction, request) as any;
    const observationSlot = Number(attemptContext?.quoteSlot);
    const observationBlockhash = optionalString(attemptContext?.recentBlockhash);
    if (
      Number.isSafeInteger(observationSlot)
      && observationSlot > 0
      && observationBlockhash
    ) {
      return { observationSlot, observationBlockhash };
    }
  }
  return null;
}

function projectProviderTerminalAttemptOwner(
  request: any,
  receipt: any,
  evidence: Record<string, any>,
): Record<string, unknown> | null {
  const preflight = Array.isArray(request?.invocation?.costPreflights)
    ? request.invocation.costPreflights[0]
    : null;
  const payer = preflight?.payerPolicy;
  if (
    !preflight
    || preflight.status !== 'consumed'
    || preflight.id !== evidence.preflightId
    || preflight.payerPolicyRef !== evidence.payerPolicyId
    || payer?.id !== evidence.payerPolicyId
    || payer?.sourceRequestId !== request?.id
    || payer?.sourceDecisionDigest !== receipt?.decisionDigest
    || receipt?.decisionDigest !== request?.decision?.decisionDigest
    || !isSha256(preflight.actionIntentDigest)
    || !isSha256(preflight.transactionAttemptDigest)
  ) return null;
  return {
    schemaVersion: 1,
    authority: 'canonical_cost_preflight',
    preflightId: preflight.id,
    payerPolicyId: preflight.payerPolicyRef,
    actionIntentDigest: preflight.actionIntentDigest,
    transactionAttemptDigest: preflight.transactionAttemptDigest,
    status: 'consumed',
    requestId: request.id,
    decisionDigest: receipt.decisionDigest,
  };
}

const PROVIDER_EXPECTED_STATE_CHANGES: Record<string, string> = {
  create_community_mint: 'community_governance_weight_mint_and_source_created',
  create_realm_and_electorate: 'realm_and_frozen_electorate_deposits_created',
  create_governance: 'governance_account_created_with_frozen_config',
  create_and_sign_off_proposal: 'proposal_instruction_inserted_and_signed_off',
  cast_vote: 'frozen_approve_vote_recorded',
  execute_no_asset_instruction: 'approved_zero_lamport_instruction_executed',
  set_governance_delegate: 'governance_delegate_set_to_frozen_delegate',
  revoke_governance_delegate: 'governance_delegate_revoked_to_none',
  create_multisig: 'two_of_three_multisig_created',
  create_vault_transaction: 'no_asset_memo_vault_transaction_created',
  create_proposal: 'proposal_created_for_frozen_vault_transaction',
  approve_by_proposer: 'proposer_member_approval_recorded',
  approve_by_approver: 'independent_approver_member_approval_recorded',
  execute_vault_transaction: 'approved_no_asset_vault_transaction_executed',
};

function projectProviderExecutionActionContext(input: {
  request: any;
  receipt: any;
  evidence: Record<string, any>;
  transaction: any;
  transactions: any[];
  planDigest: unknown;
}): Record<string, unknown> | null {
  const attemptOwner = projectProviderTerminalAttemptOwner(
    input.request,
    input.receipt,
    input.evidence,
  );
  const actionIntentDigest = optionalString(attemptOwner?.actionIntentDigest)
    ?? optionalString(input.evidence?.actionIntentDigest)
    ?? optionalString(input.transaction?.statePrecondition?.actionIntentDigest);
  const planDigest = optionalString(input.planDigest);
  const stepId = optionalString(input.transaction?.stepId);
  const expectedStateChange = stepId ? PROVIDER_EXPECTED_STATE_CHANGES[stepId] : null;
  const lastValidBlockHeight = Number(input.transaction?.lastValidBlockHeight);
  if (
    !isSha256(actionIntentDigest)
    || !isSha256(planDigest)
    || !stepId
    || !expectedStateChange
    || !isSha256(input.transaction?.manifestDigest)
    || !Number.isSafeInteger(lastValidBlockHeight)
    || lastValidBlockHeight <= 0
    || !isRecord(input.transaction?.actionContext)
  ) return null;
  const expected = buildProviderExecutionActionContext({
    actionIntentDigest,
    planDigest,
    steps: input.transactions.map((transaction) => ({ id: String(transaction.stepId) })),
    step: {
      id: stepId,
      manifestDigest: String(input.transaction.manifestDigest),
      lastValidBlockHeight,
    },
    expectedStateChange,
  });
  try {
    if (
      hashCanonicalGovernanceValue(
        'alcheme.governance.provider-execution-action-context-v1',
        input.transaction.actionContext,
      ) !== hashCanonicalGovernanceValue(
        'alcheme.governance.provider-execution-action-context-v1',
        expected,
      )
    ) return null;
  } catch {
    return null;
  }
  return expected as unknown as Record<string, unknown>;
}

function projectProviderRetryBoundary(
  request: any,
  receipt: any,
  evidence: Record<string, any>,
  transactions: any[],
): Record<string, unknown> | null {
  const attemptOwner = projectProviderTerminalAttemptOwner(request, receipt, evidence);
  if (!attemptOwner || transactions.length === 0 || transactions.some((transaction) => (
    !optionalString(transaction?.stepId) || !isSha256(transaction?.manifestDigest)
  ))) return null;
  return {
    schemaVersion: 1,
    authority: 'canonical_action_intent_and_transaction_attempt',
    actionIntentDigest: attemptOwner.actionIntentDigest,
    terminalTransactionAttemptDigest: attemptOwner.transactionAttemptDigest,
    actionSetDigest: hashCanonicalGovernanceValue(
      'alcheme.governance.provider-execution-action-set-v1',
      transactions.map((transaction) => ({
        stepId: String(transaction.stepId),
        manifestDigest: String(transaction.manifestDigest),
        dependsOnStepIds: Array.isArray(transaction?.actionContext?.dependsOnStepIds)
          ? transaction.actionContext.dependsOnStepIds.map(String)
          : null,
      })),
    ),
    sameIntentRetry: {
      allowedChanges: ['fresh_blockhash', 'fee_quote', 'provider_attempt_reference'],
      requiresSameActionIntentDigest: true,
      requiresSameActionSetDigest: true,
      authoritativeExpiryRequired: true,
    },
    materialChangesRequire: 'new_decision_stage_or_superseding_case',
    materialChanges: [
      'recipient',
      'amount',
      'asset',
      'program',
      'account_privilege',
      'authority',
      'instruction_semantics',
      'action_set',
      'dependency_graph',
    ],
    automaticMaterialMutationAllowed: false,
  };
}

function projectProviderExecutionPlanReadback(input: {
  request: any;
  receipt: any;
  evidence: Record<string, any>;
  providerModule: 'realms_provider_binding' | 'squads_provider_binding';
  executionMode: 'realms' | 'squads';
  chainId: unknown;
  resourceRef: unknown;
  planDigest: unknown;
  transactions: any[];
  projectHumanReadableAction: (transaction: any) => Record<string, any> | null;
}): Record<string, unknown> | null {
  const attemptOwner = projectProviderTerminalAttemptOwner(
    input.request,
    input.receipt,
    input.evidence,
  );
  const retryBoundary = projectProviderRetryBoundary(
    input.request,
    input.receipt,
    input.evidence,
    input.transactions,
  );
  const chainId = optionalString(input.chainId);
  const resourceRef = optionalString(input.resourceRef);
  const planDigest = optionalString(input.planDigest);
  const mappingArtifactPresent = Array.isArray(input.request?.decisionOutputArtifacts)
    && input.request.decisionOutputArtifacts.some((artifact: any) => (
      artifact?.kind === 'execution_resource_mapping'
    ));
  const artifactMapping = input.request?.providerResourceBinding
    ? projectProviderExecutionResourceArtifactMapping(
      input.request,
      input.request.providerResourceBinding,
      input.providerModule,
    )
    : null;
  if (
    input.request?.decision?.decision !== 'accepted'
    || input.receipt?.decisionDigest !== input.request?.decision?.decisionDigest
    || !attemptOwner
    || !retryBoundary
    || !chainId
    || !resourceRef
    || !isSha256(planDigest)
    || (mappingArtifactPresent && !artifactMapping)
    || input.transactions.length === 0
    || input.transactions.length > 12
  ) return null;

  const actions = input.transactions.map((transaction, index) => {
    const action = input.projectHumanReadableAction(transaction);
    const actionContext = projectProviderExecutionActionContext({
      request: input.request,
      receipt: input.receipt,
      evidence: input.evidence,
      transaction,
      transactions: input.transactions,
      planDigest,
    }) as any;
    const attempt = projectProviderTransactionAttemptContext(transaction, input.request) as any;
    const stepId = optionalString(transaction?.stepId);
    if (
      !action
      || !actionContext
      || !attempt
      || !stepId
      || action.operation !== stepId
      || action.manifestDigest !== transaction.manifestDigest
      || actionContext.order !== index + 1
      || !Array.isArray(action.programScope)
      || action.programScope.length === 0
      || !action.programScope.every(optionalString)
      || !Array.isArray(action.accountScope)
      || !action.accountScope.every((account: any) => (
        optionalString(account?.role) && optionalString(account?.ref)
      ))
      || !Array.isArray(actionContext.dependsOnStepIds)
      || !actionContext.dependsOnStepIds.every((dependency: unknown) => (
        input.transactions.slice(0, index).some((candidate) => candidate?.stepId === dependency)
      ))
      || actionContext.aggregateRule !== 'all_ordered_steps_finalized'
      || action.opaqueInstructions !== false
      || !Number.isSafeInteger(Number(transaction?.slot))
      || Number(transaction.slot) <= 0
    ) return null;
    return {
      actionId: stepId,
      order: Number(actionContext.order),
      executor: input.executionMode,
      subject: { type: 'governed_resource', ref: resourceRef },
      network: chainId,
      operation: String(action.operation),
      instructionSemantics: String(actionContext.expectedStateChange),
      humanSummary: String(action.summary),
      programScope: action.programScope.map(String),
      accountScope: action.accountScope.map((account: any) => ({
        role: String(account.role),
        ref: String(account.ref),
      })),
      assetChange: String(action.assetChange),
      dependsOnActionIds: actionContext.dependsOnStepIds.map(String),
      atomicity: String(actionContext.atomicity),
      constraints: {
        simulation: String(action.simulation),
        enforcement: String(action.enforcement),
        opaqueInstructions: false,
        idempotencyKey: String(actionContext.idempotencyKey),
        deadline: actionContext.deadline,
      },
      attempts: [{
        ordinal: 1,
        status: 'finalized',
        providerReference: String(attempt.providerReference),
        slot: Number(transaction.slot),
        recentBlockhash: String(attempt.recentBlockhash),
        messageDigest: String(attempt.messageDigest),
        manifestDigest: String(attempt.manifestDigest),
      }],
    };
  });
  if (actions.some((action) => action === null)) return null;
  const actionIdempotencyKeys = actions.map((action: any) => (
    String(action.constraints.idempotencyKey)
  ));
  const providerReferences = actions.map((action: any) => (
    String(action.attempts[0].providerReference)
  ));
  if (
    new Set(actionIdempotencyKeys).size !== actions.length
    || new Set(providerReferences).size !== actions.length
  ) return null;

  return {
    schemaVersion: 1,
    authority: 'canonical_request_cost_preflight_provider_plan_and_terminal_receipt',
    outcome: 'provider_execution_plan',
    providerModule: input.providerModule,
    executionMode: input.executionMode,
    requestId: String(input.request.id),
    decisionDigest: String(input.receipt.decisionDigest),
    artifactLinkage: {
      status: artifactMapping
        ? 'mapped_execution_resource_artifact'
        : 'not_applicable_provider_binding_activation',
      artifactRef: artifactMapping ? artifactMapping.artifactId : null,
      artifactDigest: artifactMapping ? artifactMapping.artifactDigest : null,
      resourceBindingId: artifactMapping ? artifactMapping.resourceBindingId : null,
      titleInferenceAllowed: false,
    },
    actionIntentDigest: String(attemptOwner.actionIntentDigest),
    planDigest,
    terminalTransactionAttemptDigest: String(attemptOwner.transactionAttemptDigest),
    actionSetDigest: String(retryBoundary.actionSetDigest),
    intentBoundary: {
      governanceInput: 'canonical_request_payload',
      providerActions: 'verified_provider_plan_and_manifest',
      retryVariantFieldsExcluded: ['recent_blockhash', 'fee_quote', 'provider_attempt_reference'],
    },
    aggregateStatus: 'executed',
    aggregateRule: 'all_ordered_steps_finalized',
    duplicatePrevention: {
      authority: 'canonical_action_intent_attempt_and_authoritative_provider_readback',
      state: 'protected_no_duplicate_action_observed',
      actionIntentDigest: String(attemptOwner.actionIntentDigest),
      terminalTransactionAttemptDigest: String(attemptOwner.transactionAttemptDigest),
      actionSetDigest: String(retryBoundary.actionSetDigest),
      actionIdempotencyKeys,
      providerReferences,
      checks: {
        uniqueActionIdempotencyKeys: true,
        uniqueProviderReferences: true,
        everyAttemptFinalized: true,
        everyAttemptManifestBound: true,
        authoritativeProviderReadback: true,
      },
      duplicateActionObserved: false,
      duplicatePaymentObserved: 'not_applicable_no_real_asset_current_vertical',
      retryBoundary: 'same_intent_retry_requires_authoritative_expiry',
    },
    actions,
  };
}

function projectProviderActionSafetyBoundary(input: {
  request: any;
  receipt: any;
  evidence: Record<string, any>;
  providerModule: 'realms_provider_binding' | 'squads_provider_binding';
  executionMode: 'realms' | 'squads';
  chainId: unknown;
  resourceRef: unknown;
  ownerProgramRef: unknown;
  planDigest: unknown;
  transactions: any[];
  projectHumanReadableAction: (transaction: any) => Record<string, any> | null;
}): Record<string, unknown> | null {
  const plan = projectProviderExecutionPlanReadback(input);
  const retryBoundary = projectProviderRetryBoundary(
    input.request,
    input.receipt,
    input.evidence,
    input.transactions,
  ) as any;
  const chainId = optionalString(input.chainId);
  const resourceRef = optionalString(input.resourceRef);
  const ownerProgramRef = optionalString(input.ownerProgramRef);
  if (!plan || !retryBoundary || !chainId || !resourceRef || !ownerProgramRef) return null;
  const actions = input.transactions.map((transaction) => {
    const action = input.projectHumanReadableAction(transaction);
    if (
      !action
      || action.authority !== 'verified_provider_plan_and_receipt'
      || !optionalString(action.operation)
      || !Array.isArray(action.programScope)
      || action.programScope.length === 0
      || !action.programScope.every(optionalString)
      || !Array.isArray(action.accountScope)
      || action.accountScope.length === 0
      || !action.accountScope.every((account: any) => (
        optionalString(account?.role) && optionalString(account?.ref)
      ))
      || !['passed', 'required_passed_before_provider_signature']
        .includes(String(action.simulation))
      || !['provider_onchain', 'multisig_threshold'].includes(String(action.enforcement))
      || action.opaqueInstructions !== false
      || ![
        'governance_weight_supply_created_no_real_asset',
        'governance_weight_deposited_no_real_asset',
        'zero_lamport_self_transfer_no_real_asset',
        'none_no_real_assets',
      ].includes(String(action.assetChange))
      || !isSha256(action.manifestDigest)
    ) return null;
    const statePrecondition = isRecord(transaction?.statePrecondition)
      ? transaction.statePrecondition
      : null;
    const safety = isRecord(statePrecondition?.instructionSafety)
      ? statePrecondition.instructionSafety
      : null;
    if (safety && (
      safety.schemaVersion !== 1
      || safety.authority !== 'provider_instruction_manifest_and_simulation'
      || safety.simulation !== 'passed'
      || safety.opaqueInstructions !== false
      || safety.assetOutflowLamports !== 0
      || safety.accountPrivilegeCheck !== 'exact_spl_governance_set_delegate_accounts'
      || !Array.isArray(safety.programIds)
      || safety.programIds.length === 0
      || !safety.programIds.every(optionalString)
      || !Array.isArray(safety.writableAccountRefs)
      || safety.writableAccountRefs.length === 0
      || !safety.writableAccountRefs.every(optionalString)
      || !isSha256(safety.digest)
    )) return null;
    return {
      operation: String(action.operation),
      reviewedAdapter: input.providerModule,
      programScope: action.programScope.map(String),
      accountScope: action.accountScope.map((account: any) => ({
        role: String(account.role),
        ref: String(account.ref),
      })),
      allowlist: {
        programIds: safety?.programIds?.map(String) ?? action.programScope.map(String),
        accountPrivilegeCheck: safety?.accountPrivilegeCheck
          ?? 'reviewed_adapter_manifest_account_scope',
        maxAssetOutflowLamports: safety?.assetOutflowLamports ?? 0,
        opaqueInstructionsAllowed: false,
      },
      simulation: String(action.simulation),
      assetChange: String(action.assetChange),
      manifestDigest: String(action.manifestDigest),
      instructionSafetyDigest: optionalString(safety?.digest),
    };
  });
  if (actions.length === 0 || actions.some((action) => action === null)) return null;
  return {
    schemaVersion: 1,
    authority: 'reviewed_provider_adapter_instruction_safety',
    providerModule: input.providerModule,
    executionMode: input.executionMode,
    chainId,
    resourceRef,
    ownerProgramRef,
    decisionLinkage: {
      requestId: input.request.id,
      decisionDigest: input.receipt.decisionDigest,
      actionIntentDigest: retryBoundary.actionIntentDigest,
    },
    actionCount: actions.length,
    reviewedAdapter: input.providerModule,
    programAllowlist: [...new Set(actions.flatMap((action: any) => (
      action.allowlist.programIds
    )))].sort(),
    operationAllowlist: actions.map((action: any) => action.operation),
    checks: {
      reviewedAdapterOnly: true,
      programAllowlistVerified: true,
      accountPrivilegeChecked: true,
      assetConservation: 'zero_outflow_current_vertical',
      maxOutflowLamports: 0,
      simulationRequired: true,
      opaqueInstructionsAllowed: false,
      rawInstructionAutoExecutionAllowed: false,
      materialChangeRequiresNewDecision: true,
    },
    actions,
    retryMaterialChangeGate: retryBoundary.materialChangesRequire,
  };
}

function projectServicePayerAuthorityBoundary(input: {
  authorityPaymentBoundary: Record<string, any> | null;
  fundingSourceFeePayerBoundary: Record<string, any> | null;
  providerActionSafetyBoundary: Record<string, any> | null;
  costReconciliation: Record<string, any> | null;
}): Record<string, unknown> | null {
  const payment = input.authorityPaymentBoundary;
  const funding = input.fundingSourceFeePayerBoundary;
  const safety = input.providerActionSafetyBoundary;
  const cost = input.costReconciliation;
  if (
    !payment
    || !funding
    || !safety
    || !cost
    || !optionalString(payment.payerPolicyId)
    || payment.payerPolicyId !== funding.payerPolicyId
    || payment.payerPolicyId !== cost.payerPolicyId
    || payment.feePayerRole !== 'fee_payer_only'
    || payment.sponsorAuthorityGain !== 'none'
    || payment.privateKeyExposure !== 'none_public_readback_only'
    || funding.feePayerRole !== 'separated_fee_payer_policy'
    || funding.actualFeePayer !== 'canonical_payer_policy_fee_payer_signer'
    || funding.fundingSourceMaySignFees !== false
    || funding.executorCashFlowResponsibility !== 'forbidden'
    || cost.payerRole !== 'separated_fee_payer_policy'
    || cost.sponsorRole !== payment.sponsorRole
    || safety.authority !== 'reviewed_provider_adapter_instruction_safety'
    || safety.checks?.maxOutflowLamports !== 0
    || safety.checks?.opaqueInstructionsAllowed !== false
    || safety.checks?.rawInstructionAutoExecutionAllowed !== false
    || safety.checks?.materialChangeRequiresNewDecision !== true
    || safety.retryMaterialChangeGate !== 'new_decision_stage_or_superseding_case'
  ) return null;
  const operations = Array.isArray(safety.operationAllowlist)
    ? safety.operationAllowlist.map(String)
    : [];
  const restrictedMintOperation = operations.some((operation) => (
    operation.includes('mint')
  ))
    ? 'governance_weight_no_real_asset_requires_separate_resource_authority'
    : 'not_present_current_provider_action';
  return {
    schemaVersion: 1,
    authority: 'canonical_payer_fee_rent_only_asset_authority_separation',
    payerPolicyId: payment.payerPolicyId,
    economicBearer: payment.economicBearer,
    feeScope: 'approved_fee_and_rent_only',
    payerRole: 'separated_fee_payer_policy',
    actualFeePayer: 'canonical_payer_policy_fee_payer_signer',
    sponsorRole: payment.sponsorRole,
    sponsorAuthorityGain: 'none',
    servicePayerMayControlToken: false,
    servicePayerMayControlMetadata: false,
    servicePayerMayControlProgram: false,
    servicePayerMayControlGovernanceAuthority: false,
    mintFreezeUpdateAuthoritySource: 'asset_authority_policy_required',
    restrictedMintOperation,
    currentActionAssetOutflow: 'zero_outflow_current_vertical',
    rawInstructionAutoExecutionAllowed: false,
    longLivedUniversalKeyAllowed: false,
    materialAuthorityChangeRequires: 'new_decision_stage_or_superseding_case',
    costReadback: {
      unit: cost.unit,
      totalSpendLamports: cost.totalSpendLamports,
      totalDirectRentLamports: cost.totalDirectRentLamports,
      refund: cost.refund,
    },
  };
}

function projectProviderCostControlBoundary(input: {
  request: any;
  resourceBindingId: string | null;
  costReconciliation: Record<string, any> | null;
}): Record<string, unknown> | null {
  const preflight = Array.isArray(input.request?.invocation?.costPreflights)
    ? input.request.invocation.costPreflights[0]
    : null;
  const payer = preflight?.payerPolicy;
  const singleLimit = isRecord(payer?.singleLimit) ? payer.singleLimit : null;
  const periodLimit = isRecord(payer?.periodLimit) ? payer.periodLimit : null;
  const actionScope = isRecord(payer?.actionScope) ? payer.actionScope : null;
  const cost = input.costReconciliation;
  const lamportsText = (value: unknown): string | null => (
    Number.isSafeInteger(value) && Number(value) >= 0
      ? String(value)
      : typeof value === 'string' && /^\d+$/.test(value)
        ? value
        : null
  );
  const singleLamports = lamportsText(singleLimit?.lamports);
  const periodLamports = lamportsText(periodLimit?.lamports);
  const maximumWalletBalanceLamports = lamportsText(periodLimit?.maximumWalletBalanceLamports);
  const totalSpendLamports = Number(cost?.totalSpendLamports);
  const finalBalanceLamports = Number(cost?.finalBalanceLamports);
  const sourceDecisionDigest = optionalString(input.request?.decision?.decisionDigest);
  const payerPolicyDigest = optionalString(payer?.policyDigest);
  const actionScopeDigest = optionalString(payer?.actionScopeDigest);
  if (
    !preflight
    || !payer
    || !cost
    || !optionalString(preflight.id)
    || !optionalString(preflight.attemptKey)
    || !optionalString(preflight.payerPolicyRef)
    || preflight.payerPolicyRef !== payer.id
    || payer.id !== cost.payerPolicyId
    || payer.sourceRequestId !== input.request?.id
    || !sourceDecisionDigest
    || payer.sourceDecisionDigest !== sourceDecisionDigest
    || payer.status !== 'active'
    || !optionalString(payer.network)
    || !optionalString(payer.economicBearer)
    || !singleLimit
    || singleLimit.scope !== 'per_transaction'
    || !singleLamports
    || !periodLimit
    || !optionalString(periodLimit.scope)
    || !periodLamports
    || !actionScope
    || actionScope.schemaVersion !== 1
    || actionScope.actionType !== input.request?.actionType
    || actionScope.chainId !== payer.network
    || !actionScopeDigest
    || !isSha256(actionScopeDigest)
    || hashCanonicalGovernanceValue(
      'alcheme.governance.payer-policy-action-scope',
      actionScope,
    ) !== actionScopeDigest
    || !payerPolicyDigest
    || !isSha256(payerPolicyDigest)
    || cost.payerRole !== 'separated_fee_payer_policy'
    || cost.economicBearer !== payer.economicBearer
    || !Number.isSafeInteger(totalSpendLamports)
    || totalSpendLamports < 0
    || !Number.isSafeInteger(finalBalanceLamports)
    || finalBalanceLamports < 0
    || BigInt(String(totalSpendLamports)) > BigInt(singleLamports)
    || BigInt(String(totalSpendLamports)) > BigInt(periodLamports)
    || (maximumWalletBalanceLamports !== null
      && BigInt(String(finalBalanceLamports)) > BigInt(maximumWalletBalanceLamports))
    || (input.resourceBindingId !== null
      && optionalString(actionScope.resourceBindingId)
      && actionScope.resourceBindingId !== input.resourceBindingId)
  ) return null;
  const receiptDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.provider-cost-control-sponsor-receipt-v1',
    {
      requestId: input.request.id,
      decisionDigest: sourceDecisionDigest,
      payerPolicyId: payer.id,
      payerPolicyDigest,
      preflightId: preflight.id,
      actionType: input.request.actionType,
      network: payer.network,
      economicBearer: payer.economicBearer,
      sponsorRole: cost.sponsorRole,
      totalSpendLamports,
      finalBalanceLamports,
      refund: cost.refund,
    },
  );
  return {
    schemaVersion: 1,
    authority: 'canonical_payer_policy_cost_control_and_provider_receipt',
    payerPolicyId: payer.id,
    payerPolicyDigest,
    preflightId: preflight.id,
    attemptKey: preflight.attemptKey,
    scope: {
      homeIdentityBindingId: optionalString(input.request?.homeIdentityBindingId),
      circleRef: input.request?.scopeType === 'circle'
        ? optionalString(input.request?.scopeRef)
        : null,
      actorPubkey: optionalString(input.request?.invocation?.actorPubkey)
        ?? optionalString(input.request?.proposerPubkey),
      actionType: input.request.actionType,
      network: payer.network,
      resourceBindingId: input.resourceBindingId,
      actionScopeDigest,
    },
    timeWindow: {
      scope: String(periodLimit.scope),
      effectiveFrom: dateTime(payer.effectiveFrom),
      expiresAt: dateTime(payer.expiry ?? preflight.expiresAt),
      checkedAt: dateTime(preflight.checkedAt),
    },
    limits: {
      unit: 'lamports',
      singleTransactionLamports: singleLamports,
      periodLamports,
      maximumWalletBalanceLamports,
    },
    balance: {
      authority: 'provider_receipt_final_balance',
      finalBalanceLamports,
      state: maximumWalletBalanceLamports === null
        ? 'no_maximum_wallet_balance_configured'
        : 'within_configured_balance_limit',
    },
    rateLimit: {
      authority: 'invocation_attempt_key_and_payer_policy_period',
      duplicateAttemptKeyScopedToInvocation: true,
      actionWindowScope: String(periodLimit.scope),
    },
    alerts: {
      spendWithinSingleLimit: true,
      spendWithinPeriodLimit: true,
      finalBalanceWithinConfiguredMaximum: maximumWalletBalanceLamports === null
        ? 'not_configured'
        : true,
    },
    sponsorReceipt: {
      authority: 'provider_cost_control_sponsor_receipt',
      receiptDigest,
      sponsorRole: cost.sponsorRole,
      sponsorRef: optionalString(payer.relayerRef),
      economicBearer: payer.economicBearer,
      feePayerSignerRefExposed: false,
      refund: cost.refund,
      generatedFrom: 'payer_policy_cost_preflight_and_provider_receipt',
    },
    feeAbstractionPlan: projectFeeAbstractionPlanReadback({
      quoteContext: preflight.quoteContext,
      payerPolicyId: payer.id,
      economicBearer: payer.economicBearer,
    }),
  };
}

function projectAssetAuthoritySponsorBoundary(input: {
  servicePayerAuthorityBoundary: Record<string, any> | null;
  providerCostControlBoundary: Record<string, any> | null;
  providerActionSafetyBoundary: Record<string, any> | null;
}): Record<string, unknown> | null {
  const service = input.servicePayerAuthorityBoundary;
  const costControl = input.providerCostControlBoundary;
  const safety = input.providerActionSafetyBoundary;
  if (
    !service
    || !costControl
    || !safety
    || service.authority !== 'canonical_payer_fee_rent_only_asset_authority_separation'
    || costControl.authority !== 'canonical_payer_policy_cost_control_and_provider_receipt'
    || safety.authority !== 'reviewed_provider_adapter_instruction_safety'
    || !optionalString(service.payerPolicyId)
    || service.payerPolicyId !== costControl.payerPolicyId
    || service.economicBearer !== costControl.sponsorReceipt?.economicBearer
    || service.sponsorRole !== costControl.sponsorReceipt?.sponsorRole
    || service.sponsorAuthorityGain !== 'none'
    || service.actualFeePayer !== 'canonical_payer_policy_fee_payer_signer'
    || service.servicePayerMayControlToken !== false
    || service.servicePayerMayControlMetadata !== false
    || service.servicePayerMayControlProgram !== false
    || service.servicePayerMayControlGovernanceAuthority !== false
    || service.mintFreezeUpdateAuthoritySource !== 'asset_authority_policy_required'
    || service.currentActionAssetOutflow !== 'zero_outflow_current_vertical'
    || service.rawInstructionAutoExecutionAllowed !== false
    || service.longLivedUniversalKeyAllowed !== false
    || service.materialAuthorityChangeRequires !== 'new_decision_stage_or_superseding_case'
    || costControl.sponsorReceipt?.feePayerSignerRefExposed !== false
    || safety.checks?.assetConservation !== 'zero_outflow_current_vertical'
    || safety.checks?.maxOutflowLamports !== 0
    || safety.checks?.opaqueInstructionsAllowed !== false
    || safety.checks?.rawInstructionAutoExecutionAllowed !== false
    || safety.checks?.materialChangeRequiresNewDecision !== true
  ) return null;
  return {
    schemaVersion: 1,
    authority: 'canonical_asset_authority_policy_sponsor_separation',
    payerPolicyId: service.payerPolicyId,
    payerPolicyDigest: costControl.payerPolicyDigest,
    economicBearer: service.economicBearer,
    sponsorRole: service.sponsorRole,
    sponsorReceiptDigest: costControl.sponsorReceipt.receiptDigest,
    assetAuthority: {
      ownerIssuerMintFreezeUpdateSource: 'asset_authority_policy_required',
      currentActionAssetOutflow: 'zero_outflow_current_vertical',
      restrictedMintOperation: service.restrictedMintOperation,
      materialAuthorityChangeRequires: 'new_decision_stage_or_superseding_case',
    },
    sponsorSeparation: {
      sponsorMayPayFees: true,
      sponsorAuthorityGain: 'none',
      feePayerSignerRefExposed: false,
      sponsorMayControlToken: false,
      sponsorMayControlMetadata: false,
      sponsorMayControlProgram: false,
      sponsorMayControlGovernanceAuthority: false,
      longLivedUniversalKeyAllowed: false,
    },
    actionSafety: {
      providerModule: safety.providerModule,
      reviewedAdapter: safety.reviewedAdapter,
      actionCount: safety.actionCount,
      assetConservation: 'zero_outflow_current_vertical',
      maxOutflowLamports: 0,
      opaqueInstructionsAllowed: false,
      rawInstructionAutoExecutionAllowed: false,
    },
    linkage: {
      actionScopeDigest: costControl.scope.actionScopeDigest,
      resourceBindingId: costControl.scope.resourceBindingId,
      decisionDigest: safety.decisionLinkage?.decisionDigest,
      actionIntentDigest: safety.decisionLinkage?.actionIntentDigest,
    },
  };
}

const SOLANA_SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const SOLANA_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

function projectRealmsBootstrapHumanReadableAction(
  transaction: any,
  plan: Record<string, any>,
  ownerProgramRef: string,
): Record<string, unknown> | null {
  const planStep = Array.isArray(plan?.steps)
    ? plan.steps.find((step: any) => step?.id === transaction?.stepId)
    : null;
  if (!planStep || planStep.manifestDigest !== transaction?.manifestDigest) return null;
  const addresses = isRecord(plan?.addresses) ? plan.addresses : null;
  if (!addresses) return null;
  const configs: Record<string, {
    summary: string;
    programs: string[];
    accounts: Array<[string, string]>;
    assetChange: string;
  }> = {
    create_community_mint: {
      summary: 'Create the deterministic community governance-weight mint and token source.',
      programs: [SOLANA_SYSTEM_PROGRAM_ID, SOLANA_TOKEN_PROGRAM_ID],
      accounts: [
        ['community_mint', String(addresses.communityMint ?? '')],
        ['governing_token_source', String(addresses.governingTokenSource ?? '')],
      ],
      assetChange: 'governance_weight_supply_created_no_real_asset',
    },
    create_realm_and_electorate: {
      summary: 'Create the Realm and deposit frozen proposer and voter governance weights.',
      programs: [ownerProgramRef, SOLANA_TOKEN_PROGRAM_ID],
      accounts: [
        ['realm', String(addresses.realm ?? '')],
        ['realm_config', String(addresses.realmConfig ?? '')],
        ['community_mint', String(addresses.communityMint ?? '')],
        ['governing_token_source', String(addresses.governingTokenSource ?? '')],
        ['proposer_token_owner_record', String(addresses.proposerTokenOwnerRecord ?? '')],
        ['voter_token_owner_record', String(addresses.voterTokenOwnerRecord ?? '')],
      ],
      assetChange: 'governance_weight_deposited_no_real_asset',
    },
    create_governance: {
      summary: 'Create the Governance account with the frozen voting configuration.',
      programs: [ownerProgramRef],
      accounts: [
        ['realm', String(addresses.realm ?? '')],
        ['governance', String(addresses.governance ?? '')],
        ['proposer_token_owner_record', String(addresses.proposerTokenOwnerRecord ?? '')],
      ],
      assetChange: 'none_no_real_assets',
    },
    create_and_sign_off_proposal: {
      summary: 'Create the deterministic no-asset proposal, insert its instruction, and sign it off.',
      programs: [ownerProgramRef],
      accounts: [
        ['governance', String(addresses.governance ?? '')],
        ['proposal', String(addresses.proposal ?? '')],
        ['proposal_transaction', String(addresses.proposalTransaction ?? '')],
        ['proposer_token_owner_record', String(addresses.proposerTokenOwnerRecord ?? '')],
      ],
      assetChange: 'none_no_real_assets',
    },
    cast_vote: {
      summary: 'Cast the frozen approve vote with the voter governance weight.',
      programs: [ownerProgramRef],
      accounts: [
        ['governance', String(addresses.governance ?? '')],
        ['proposal', String(addresses.proposal ?? '')],
        ['voter_token_owner_record', String(addresses.voterTokenOwnerRecord ?? '')],
        ['vote_record', String(addresses.voteRecord ?? '')],
      ],
      assetChange: 'none_no_real_assets',
    },
    execute_no_asset_instruction: {
      summary: 'Execute the approved zero-lamport executor self-transfer.',
      programs: [ownerProgramRef, SOLANA_SYSTEM_PROGRAM_ID],
      accounts: [
        ['governance', String(addresses.governance ?? '')],
        ['proposal', String(addresses.proposal ?? '')],
        ['proposal_transaction', String(addresses.proposalTransaction ?? '')],
      ],
      assetChange: 'zero_lamport_self_transfer_no_real_asset',
    },
  };
  const config = configs[String(transaction.stepId)];
  if (!config || config.programs.some((program) => !program)
    || config.accounts.some(([, ref]) => !ref)) return null;
  return {
    schemaVersion: 1,
    authority: 'verified_provider_plan_and_receipt',
    operation: String(transaction.stepId),
    summary: config.summary,
    programScope: config.programs,
    accountScope: config.accounts.map(([role, ref]) => ({ role, ref })),
    assetChange: config.assetChange,
    simulation: 'required_passed_before_provider_signature',
    enforcement: 'provider_onchain',
    opaqueInstructions: false,
    manifestDigest: String(transaction.manifestDigest),
  };
}

function projectSquadsHumanReadableAction(
  transaction: any,
  addresses: Record<string, any>,
  accountGraph: Record<string, any>,
): Record<string, unknown> | null {
  if (!isRecord(addresses)) return null;
  const ownerProgramRef = optionalString(accountGraph?.ownerProgramRef);
  const configs: Record<string, { summary: string; accounts: Array<[string, string]> }> = {
    create_multisig: {
      summary: 'Create the deterministic 2-of-3 Squads multisig.',
      accounts: [['multisig', String(addresses.multisig ?? '')]],
    },
    create_vault_transaction: {
      summary: 'Create the no-asset memo vault transaction.',
      accounts: [
        ['multisig', String(addresses.multisig ?? '')],
        ['vault', String(addresses.vault ?? '')],
        ['vault_transaction', String(addresses.vaultTransaction ?? '')],
      ],
    },
    create_proposal: {
      summary: 'Create the proposal for the frozen vault transaction.',
      accounts: [
        ['multisig', String(addresses.multisig ?? '')],
        ['proposal', String(addresses.proposal ?? '')],
        ['vault_transaction', String(addresses.vaultTransaction ?? '')],
      ],
    },
    approve_by_proposer: {
      summary: 'Record the proposer member approval.',
      accounts: [
        ['multisig', String(addresses.multisig ?? '')],
        ['proposal', String(addresses.proposal ?? '')],
      ],
    },
    approve_by_approver: {
      summary: 'Record the independent approver member approval.',
      accounts: [
        ['multisig', String(addresses.multisig ?? '')],
        ['proposal', String(addresses.proposal ?? '')],
      ],
    },
    execute_vault_transaction: {
      summary: 'Execute the approved no-asset memo vault transaction.',
      accounts: [
        ['multisig', String(addresses.multisig ?? '')],
        ['vault', String(addresses.vault ?? '')],
        ['proposal', String(addresses.proposal ?? '')],
        ['vault_transaction', String(addresses.vaultTransaction ?? '')],
      ],
    },
  };
  const config = configs[String(transaction?.stepId)];
  if (!ownerProgramRef || !config || config.accounts.some(([, ref]) => !ref)) return null;
  const memoProgram = optionalString(accountGraph?.instructionProgram);
  return {
    schemaVersion: 1,
    authority: 'verified_provider_plan_and_receipt',
    operation: String(transaction.stepId),
    summary: config.summary,
    programScope: transaction.stepId === 'create_vault_transaction' && memoProgram
      ? [ownerProgramRef, memoProgram]
      : [ownerProgramRef],
    accountScope: config.accounts.map(([role, ref]) => ({ role, ref })),
    assetChange: 'none_no_real_assets',
    simulation: 'required_passed_before_provider_signature',
    enforcement: 'multisig_threshold',
    opaqueInstructions: false,
    manifestDigest: String(transaction.manifestDigest),
  };
}

function projectRealmsDelegationHumanReadableAction(
  transaction: any,
  binding: Record<string, any>,
): Record<string, unknown> | null {
  const ownerProgramRef = optionalString(binding?.ownerProgramRef);
  const resourceRef = optionalString(binding?.resourceRef);
  const precondition = isRecord(transaction?.statePrecondition)
    ? transaction.statePrecondition
    : null;
  const safety = isRecord(precondition?.instructionSafety)
    ? precondition.instructionSafety
    : null;
  const tokenOwnerRecord = Array.isArray(safety?.writableAccountRefs)
    && safety.writableAccountRefs.length === 1
    ? optionalString(safety.writableAccountRefs[0])
    : null;
  const operation = String(transaction?.stepId ?? '');
  if (
    !['set_governance_delegate', 'revoke_governance_delegate'].includes(operation)
    || safety?.simulation !== 'passed'
    || safety?.opaqueInstructions !== false
    || safety?.assetOutflowLamports !== 0
    || !Array.isArray(safety?.programIds)
    || safety.programIds.length !== 1
    || !ownerProgramRef
    || safety.programIds[0] !== ownerProgramRef
    || !resourceRef
    || !tokenOwnerRecord
  ) return null;
  return {
    schemaVersion: 1,
    authority: 'verified_provider_plan_and_receipt',
    operation,
    summary: operation === 'set_governance_delegate'
      ? 'Set the frozen governance delegate on the exact TokenOwnerRecord.'
      : 'Revoke the governance delegate from the exact TokenOwnerRecord.',
    programScope: [ownerProgramRef],
    accountScope: [
      { role: 'governed_resource', ref: resourceRef },
      { role: 'voter_token_owner_record', ref: tokenOwnerRecord },
    ],
    assetChange: 'none_no_real_assets',
    simulation: 'passed',
    enforcement: 'provider_onchain',
    opaqueInstructions: false,
    manifestDigest: String(transaction.manifestDigest),
  };
}

function projectSquadsPreSignStateReadback(
  request: any,
  receipt: any,
  evidence: Record<string, any>,
  transactions: any[],
): Record<string, unknown> | null {
  const rows = Array.isArray(evidence.preSignStateReadbacks)
    ? evidence.preSignStateReadbacks
    : [];
  if (rows.length === 0) return null;
  const preflight = Array.isArray(request?.invocation?.costPreflights)
    ? request.invocation.costPreflights[0]
    : null;
  const expectedResourceId = optionalString(evidence.resourceBindingId)
    ?? optionalString(evidence.grantResourceBindingId);
  if (
    !preflight
    || !expectedResourceId
    || rows.some((row: any) => {
      const providerState = isRecord(row?.providerState) ? row.providerState : null;
      const transaction = transactions.find((candidate: any) => (
        (candidate?.stepId ?? candidate?.id) === providerState?.stepId
      ));
      return row?.schemaVersion !== 1
        || row?.authority !== 'canonical_owner_provider_state_and_p05_health'
        || row?.requestId !== request.id
        || row?.decisionDigest !== receipt.decisionDigest
        || row?.actionIntentDigest !== preflight.actionIntentDigest
        || row?.resourceBindingId !== expectedResourceId
        || !optionalString(row?.payerPolicyId)
        || !optionalString(row?.preflightId)
        || !optionalString(row?.role)
        || !optionalString(row?.operation)
        || !isSha256(row?.canonicalOwnerDigest)
        || !isSha256(row?.authorityHealthDigest)
        || row?.emergencyFreeze !== 'clear_fresh_p05_authority_health'
        || !isSha256(row?.digest)
        || !dateTime(row?.observedAt)
        || !providerState
        || !transaction
        || providerState.messageDigest !== transaction.messageDigest
        || providerState.manifestDigest !== transaction.manifestDigest
        || !Number.isSafeInteger(providerState.observedSlot)
        || providerState.observedSlot <= 0
        || !Number.isSafeInteger(providerState.feePayerBalanceLamports)
        || providerState.feePayerBalanceLamports < 0
        || !optionalString(providerState.recentBlockhash)
        || !Number.isSafeInteger(providerState.lastValidBlockHeight)
        || providerState.lastValidBlockHeight <= 0
        || !Number.isSafeInteger(providerState.feeLamports)
        || providerState.feeLamports < 0
        || !Number.isSafeInteger(providerState.authorizedCeilingLamports)
        || providerState.authorizedCeilingLamports < providerState.feeLamports
        || providerState.simulation !== 'passed';
    })
  ) return null;
  const latest = [...rows].sort((left: any, right: any) => (
    Number(right.providerState.observedSlot) - Number(left.providerState.observedSlot)
  ))[0];
  return {
    schemaVersion: 1,
    authority: 'persisted_cost_preflight_and_provider_receipt',
    state: 'verified',
    resourceBindingId: expectedResourceId,
    latestObservedSlot: Number(latest.providerState.observedSlot),
    signatureCheckCount: rows.length,
    statePreconditionDigests: rows.map((row: any) => String(row.digest)),
    checks: {
      finalizedProviderQuote: true,
      currentFeePayerBalance: true,
      canonicalResourceAuthorityPayer: true,
      currentTrustProfile: true,
      p05AuthorityHealthAndFreeze: true,
      messageAndManifestBound: true,
    },
    emergencyFreeze: 'clear_fresh_p05_authority_health',
    executionAllowedAtSignature: true,
  };
}

function projectSquadsProviderExecution(
  request: any,
  receipt: any,
  evidence: Record<string, any>,
  attempts: Array<any>,
  failedAttemptCount: number,
  linkage: Record<string, any>,
) {
  const currentProfile = getSquadsProviderTrustProfile();
  const currentProfileReadiness = resolveSquadsProviderTrustReadiness();
  const providerReceipt = evidence.providerReceipt as Record<string, any>;
  if (evidence.effect === 'squads_devnet_grant_payout_finalized') {
    return projectSquadsGrantPayoutExecution(
      request,
      receipt,
      evidence,
      attempts,
      failedAttemptCount,
      linkage,
    );
  }
  const accountGraph = evidence.accountGraph as Record<string, any>;
  const preSignStateReadback = projectSquadsPreSignStateReadback(
    request,
    receipt,
    evidence,
    providerReceipt.transactions,
  );
  const executionAuthorities = projectProviderExecutionAuthorities(request, {
    chainId: providerReceipt.chainId,
    profileRef: providerReceipt.profileRef,
    profileVersion: providerReceipt.profileVersion,
    resourceRef: accountGraph.resourceRef,
    ownerProgramRef: accountGraph.ownerProgramRef,
  });
  const authorityPaymentBoundary = projectProviderAuthorityPaymentBoundary(
    request,
    {
      chainId: providerReceipt.chainId,
      profileRef: providerReceipt.profileRef,
      profileVersion: providerReceipt.profileVersion,
      resourceRef: accountGraph.resourceRef,
      ownerProgramRef: accountGraph.ownerProgramRef,
    },
    executionAuthorities,
  );
  const mandateCostPolicy = projectProviderMandateCostPolicy(request);
  const fundingSourceFeePayerBoundary = projectProviderFundingSourceFeePayerBoundary(
    request,
    authorityPaymentBoundary,
    {
      fundingSourceRole: 'squads_vault',
      fundingSourceRef: providerReceipt.addresses.vault,
    },
  );
  const providerActionSafetyBoundary = projectProviderActionSafetyBoundary({
    request,
    receipt,
    evidence,
    providerModule: 'squads_provider_binding',
    executionMode: 'squads',
    chainId: providerReceipt.chainId,
    resourceRef: accountGraph.resourceRef,
    ownerProgramRef: accountGraph.ownerProgramRef,
    planDigest: providerReceipt.planDigest,
    transactions: providerReceipt.transactions,
    projectHumanReadableAction: (transaction) => (
      projectSquadsHumanReadableAction(
        transaction,
        providerReceipt.addresses,
        accountGraph,
      )
    ),
  });
  const publishedCostReconciliation = authorityPaymentBoundary
    && evidence.payerPolicyId === authorityPaymentBoundary.payerPolicyId ? {
    schemaVersion: 1,
    authority: 'canonical_cost_preflight_and_provider_receipt',
    payerPolicyId: evidence.payerPolicyId,
    payerRole: 'separated_fee_payer_policy',
    economicBearer: authorityPaymentBoundary.economicBearer,
    sponsorRole: authorityPaymentBoundary.sponsorRole,
    unit: 'lamports',
    transactions: providerReceipt.transactions.map((transaction: any) => ({
      stepId: String(transaction.stepId),
      quotedFeeLamports: Number(transaction.feeLamports),
      directRentLamports: null,
      actualSpendLamports: Number(transaction.actualSpendLamports),
    })),
    totalDirectRentLamports: null,
    totalSpendLamports: Number(providerReceipt.totalSpendLamports),
    finalBalanceLamports: Number(providerReceipt.finalBalanceLamports),
    fundingSource: 'existing_finalized_balance',
    fundingSignature: null,
    reconciliation: 'transaction_sum_matches_provider_receipt',
    rent: 'included_in_actual_spend_not_itemized',
    refund: 'unknown_no_provider_refund_disposition',
  } : null;
  const servicePayerAuthorityBoundary = projectServicePayerAuthorityBoundary({
    authorityPaymentBoundary,
    fundingSourceFeePayerBoundary,
    providerActionSafetyBoundary,
    costReconciliation: publishedCostReconciliation,
  });
  const providerCostControlBoundary = projectProviderCostControlBoundary({
    request,
    resourceBindingId: accountGraph.resourceRef,
    costReconciliation: publishedCostReconciliation,
  });
  const assetAuthoritySponsorBoundary = projectAssetAuthoritySponsorBoundary({
    servicePayerAuthorityBoundary,
    providerCostControlBoundary,
    providerActionSafetyBoundary,
  });
  const providerResourceLifecycle = projectProviderResourceLifecycleReadback({
    request,
    receipt,
    providerModule: 'squads_provider_binding',
    resourceBinding: request?.providerResourceBinding,
    provider: {
      resourceRef: accountGraph.resourceRef,
      ownerProgramRef: accountGraph.ownerProgramRef,
      observedSlot: accountGraph.observedSlot,
      lastTransactionSlot: accountGraph.lastTransactionSlot,
      stateDigest: accountGraph.stateDigest,
    },
    executionAuthorities,
    transactions: providerReceipt.transactions,
  });
  const providerTrustObservation = projectProviderTrustObservation(
    providerReceipt.transactions,
    request,
  );
  return compactObject({
    schemaVersion: 1,
    status: 'executed',
    integrity: 'verified',
    blocker: null,
    receiptId: optionalString(receipt.id),
    evidenceDigest: optionalString(receipt.executionEvidenceDigest),
    executedAt: dateTime(receipt.executedAt),
    effect: evidence.effect,
    provider: {
      module: 'squads_provider_binding',
      chainId: providerReceipt.chainId,
      profileRef: providerReceipt.profileRef,
      profileVersion: providerReceipt.profileVersion,
      finality: providerReceipt.providerFinality,
      resourceRef: accountGraph.resourceRef,
      ownerProgramRef: accountGraph.ownerProgramRef,
      observedSlot: accountGraph.observedSlot,
      lastTransactionSlot: accountGraph.lastTransactionSlot,
      stateDigest: accountGraph.stateDigest,
      proposalState: accountGraph.proposalState,
      vaultTransactionState: accountGraph.vaultTransactionState,
      approvedMemberCount: accountGraph.approvedMemberCount,
      noRealAssets: accountGraph.noRealAssets,
      transactionCount: providerReceipt.transactions.length,
      proposalTransactionReadback: {
        schemaVersion: 1,
        authority: 'provider_receipt_and_independent_finalized_readback',
        proposalRef: String(providerReceipt.addresses.proposal),
        proposalTransactionRef: String(providerReceipt.addresses.vaultTransaction),
        commitment: 'finalized',
        executionStatus: 'executed',
        instructions: providerReceipt.transactions.map((transaction: any) => {
          const action = projectSquadsHumanReadableAction(
            transaction,
            providerReceipt.addresses,
            accountGraph,
          );
          return {
            stepId: String(transaction.stepId),
            manifestDigest: String(transaction.manifestDigest),
            summary: action?.summary ?? String(transaction.stepId),
            programScope: action?.programScope ?? [String(accountGraph.ownerProgramRef)],
            signature: String(transaction.signature),
            slot: Number(transaction.slot),
            commitment: 'finalized',
            executionStatus: 'finalized',
            opaqueInstruction: false,
          };
        }),
      },
      executionPlanReadback: projectProviderExecutionPlanReadback({
        request,
        receipt,
        evidence,
        providerModule: 'squads_provider_binding',
        executionMode: 'squads',
        chainId: providerReceipt.chainId,
        resourceRef: accountGraph.resourceRef,
        planDigest: providerReceipt.planDigest,
        transactions: providerReceipt.transactions,
        projectHumanReadableAction: (transaction) => (
          projectSquadsHumanReadableAction(
            transaction,
            providerReceipt.addresses,
            accountGraph,
          )
        ),
      }),
      providerActionSafetyBoundary,
      providerResourceLifecycle,
      servicePayerAuthorityBoundary,
      providerCostControlBoundary,
      assetAuthoritySponsorBoundary,
      attemptOwner: projectProviderTerminalAttemptOwner(request, receipt, evidence),
      retryBoundary: projectProviderRetryBoundary(
        request,
        receipt,
        evidence,
        providerReceipt.transactions,
      ),
      transactions: providerReceipt.transactions.map((transaction: any, index: number) => ({
        stepId: String(transaction.stepId),
        signature: String(transaction.signature),
        slot: Number(transaction.slot),
        messageDigest: String(transaction.messageDigest),
        manifestDigest: String(transaction.manifestDigest),
        ...(projectProviderTransactionAttemptContext(transaction, request)
          ? { attemptContext: projectProviderTransactionAttemptContext(transaction, request) }
          : {}),
        ...(projectProviderExecutionActionContext({
          request,
          receipt,
          evidence,
          transaction,
          transactions: providerReceipt.transactions,
          planDigest: providerReceipt.planDigest,
        }) ? {
            actionContext: projectProviderExecutionActionContext({
              request,
              receipt,
              evidence,
              transaction: providerReceipt.transactions[index],
              transactions: providerReceipt.transactions,
              planDigest: providerReceipt.planDigest,
            }),
          } : {}),
        ...(projectSquadsHumanReadableAction(
          transaction,
          providerReceipt.addresses,
          accountGraph,
        ) ? {
            humanReadableAction: projectSquadsHumanReadableAction(
              transaction,
              providerReceipt.addresses,
              accountGraph,
            ),
          } : {}),
        finalityTransitions: transaction.finalityTransitions.map((transition: any) => ({
          state: transition.state,
          authority: transition.authority,
          ...(transition.slot === undefined ? {} : { slot: Number(transition.slot) }),
        })),
      })),
      trustProfile: {
        profileDigest: currentProfileReadiness.profileDigest,
        readinessState: currentProfileReadiness.readinessState,
        riskMaturity: currentProfileReadiness.riskMaturity,
        genesisHash: currentProfile.chain.genesisHash,
        programId: currentProfile.deployment.programId,
        loaderProgramId: currentProfile.deployment.loaderProgramId,
        programDataAddress: currentProfile.deployment.programDataAddress,
        upgradeAuthority: currentProfile.deployment.upgradeAuthority,
        deployedProgramBytesSha256: currentProfile.deployment.deployedProgramBytesSha256,
        deploymentObservedSlot: currentProfile.deployment.observation.slot,
        deploymentObservedAt: currentProfile.deployment.observation.observedAt,
        decoderPackage: currentProfile.clientDecoder.packageName,
        decoderVersion: currentProfile.clientDecoder.version,
        decoderArtifactSha256: currentProfile.clientDecoder.idlSha256,
        decoderConformance: currentProfileReadiness.decoderConformance,
        commitment: currentProfile.readback.commitment,
        rpcAccess: currentProfile.readback.rpc.access,
        rpcIndexerCrossCheck: 'rpc_finalized_only_indexer_not_configured',
        ...(providerTrustObservation ?? {}),
      },
      executionAuthorities,
      authorityPaymentBoundary,
      mandateCostPolicy,
      fundingSourceFeePayerBoundary,
      preSignStateReadback,
      enforcementDisclosure: executionAuthorities ? {
        schemaVersion: 1,
        mode: 'multisig_threshold',
        providerModule: 'squads_provider_binding',
        resourceRef: accountGraph.resourceRef,
        ownerProgramRef: accountGraph.ownerProgramRef,
        decisionLinkage: {
          requestId: request.id,
          decisionDigest: receipt.decisionDigest,
        },
        allowedOperations: providerReceipt.transactions.map((transaction: any) => (
          String(transaction.stepId)
        )),
        verificationState: 'verified',
        version: providerReceipt.profileVersion,
        proofScope: 'alcheme_constructed_transaction_matches_accepted_decision',
        residualBypassRisk: 'threshold_signers_can_create_or_execute_transactions_outside_alcheme',
        bypassPrevented: false,
      } : null,
      costReconciliation: publishedCostReconciliation,
    },
    reconciliation: {
      state: 'verified',
      blocker: null,
      authority: 'independent_provider_readback',
      observedStateDigest: accountGraph.stateDigest,
      observedSlot: accountGraph.observedSlot,
      accountSemantics: null,
      votingPowerSecurity: null,
      votingPowerChallenge: null,
      observedAt: dateTime(receipt.executedAt),
    },
    attempts: {
      total: attempts.length,
      failed: failedAttemptCount,
      history: attempts,
    },
    linkage,
  });
}

function projectSquadsGrantPayoutExecution(
  request: any,
  receipt: any,
  evidence: Record<string, any>,
  attempts: Array<any>,
  failedAttemptCount: number,
  linkage: Record<string, any>,
) {
  const providerReceipt = evidence.providerReceipt as Record<string, any>;
  const verification = isRecord(request?.providerResourceBinding?.verification)
    ? request.providerResourceBinding.verification
    : {};
  const checkpoint = isRecord(verification.providerCheckpoint)
    ? verification.providerCheckpoint
    : {};
  const steps = Array.isArray(checkpoint.steps) ? checkpoint.steps : [];
  const preSignStateReadback = projectSquadsPreSignStateReadback(
    request,
    receipt,
    evidence,
    steps,
  );
  return compactObject({
    schemaVersion: 1,
    status: 'executed',
    integrity: 'verified',
    blocker: null,
    receiptId: optionalString(receipt.id),
    evidenceDigest: optionalString(receipt.executionEvidenceDigest),
    executedAt: dateTime(receipt.executedAt),
    effect: evidence.effect,
    provider: {
      module: 'squads_provider_binding',
      chainId: providerReceipt.chainId,
      profileRef: providerReceipt.profileRef,
      profileVersion: providerReceipt.profileVersion,
      finality: providerReceipt.providerFinality,
      resourceRef: providerReceipt.vault,
      ownerProgramRef: request?.providerResourceBinding?.ownerProgramRef ?? null,
      observedSlot: providerReceipt.payoutSlot,
      lastTransactionSlot: providerReceipt.payoutSlot,
      stateDigest: providerReceipt.stateDigest,
      preSignStateReadback,
      proposalState: 'executed',
      vaultTransactionState: 'executed',
      approvedMemberCount: 2,
      noRealAssets: true,
      transactionCount: (providerReceipt.fundingSignature ? 1 : 0) + steps.length,
      transactions: [
        ...(providerReceipt.fundingSignature ? [{
          stepId: 'devnet_faucet_funding',
          signature: providerReceipt.fundingSignature,
          slot: providerReceipt.fundingSlot,
        }] : []),
        ...steps.map((step: any) => ({
          stepId: step.id,
          signature: step.signature,
          slot: step.slot,
          messageDigest: step.messageDigest,
          manifestDigest: step.manifestDigest,
          finalityTransitions: step.finalityTransitions,
        })),
      ],
    },
    grantSettlement: {
      agreementId: evidence.agreementId,
      trancheIntentId: evidence.trancheIntentId,
      resourceBindingId: evidence.grantResourceBindingId,
      recipient: providerReceipt.recipient,
      amountLamports: providerReceipt.amountLamports,
      fundingSource: providerReceipt.fundingSource,
      vaultBalanceAfterLamports: providerReceipt.vaultBalanceAfterLamports,
      recipientBalanceAfterLamports: providerReceipt.recipientBalanceAfterLamports,
      payoutSignature: providerReceipt.payoutSignature,
      payoutSlot: providerReceipt.payoutSlot,
      canonicalFundingStatus: evidence.canonicalFundingStatus,
    },
    reconciliation: {
      state: 'verified',
      blocker: null,
      authority: 'independent_provider_readback',
      observedStateDigest: providerReceipt.stateDigest,
      observedSlot: providerReceipt.payoutSlot,
      accountSemantics: null,
      votingPowerSecurity: null,
      votingPowerChallenge: null,
      observedAt: dateTime(receipt.executedAt),
    },
    attempts: {
      total: attempts.length,
      failed: failedAttemptCount,
      history: attempts,
    },
    linkage,
  });
}

function verifiedSquadsProviderExecutionReceipt(request: any, receipt: any): boolean {
  const evidence = isRecord(receipt?.executionEvidence) ? receipt.executionEvidence : null;
  if (!evidence) return false;
  if (evidence.effect === 'squads_devnet_grant_payout_finalized') {
    return verifiedSquadsGrantPayoutExecutionReceipt(request, receipt, evidence);
  }
  let expectedDigest: string;
  try {
    expectedDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.execution-receipt-evidence',
      evidence,
    );
  } catch {
    return false;
  }
  const providerReceipt = isRecord(evidence.providerReceipt) ? evidence.providerReceipt : null;
  const accountGraph = isRecord(evidence.accountGraph) ? evidence.accountGraph : null;
  const binding = request?.providerResourceBinding;
  const bindingVerification = isRecord(binding?.verification) ? binding.verification : null;
  const persistedReceipt = isRecord(bindingVerification?.providerReceipt)
    ? bindingVerification.providerReceipt
    : null;
  const persistedGraph = isRecord(bindingVerification?.accountGraph)
    ? bindingVerification.accountGraph
    : null;
  const continuity = isRecord(bindingVerification?.continuityAdoption)
    ? bindingVerification.continuityAdoption
    : null;
  const origin = isRecord(continuity?.origin) ? continuity.origin : null;
  const payload = isRecord(request?.payload) ? request.payload : null;
  const payloadResource = isRecord(payload?.resource) ? payload.resource : null;
  const payloadOrigin = isRecord(payload?.origin) ? payload.origin : null;
  const mechanism = isRecord(request?.decision?.tally?.mechanism)
    ? request.decision.tally.mechanism
    : null;
  const transactions = Array.isArray(providerReceipt?.transactions)
    ? providerReceipt.transactions
    : [];
  const expectedSteps = [
    'create_multisig',
    'create_vault_transaction',
    'create_proposal',
    'approve_by_proposer',
    'approve_by_approver',
    'execute_vault_transaction',
  ];
  let persistenceMatches = false;
  try {
    persistenceMatches = Boolean(persistedReceipt && persistedGraph)
      && hashCanonicalGovernanceValue('alcheme.governance.squads-provider-receipt', persistedReceipt)
        === hashCanonicalGovernanceValue('alcheme.governance.squads-provider-receipt', providerReceipt)
      && hashCanonicalGovernanceValue('alcheme.governance.squads-provider-account-graph', persistedGraph)
        === hashCanonicalGovernanceValue('alcheme.governance.squads-provider-account-graph', accountGraph);
  } catch {
    return false;
  }
  return (
    receipt.executorModule === 'squads_provider_binding'
    && receipt.executionStatus === 'executed'
    && receipt.executionEvidenceDigest === expectedDigest
    && isSha256(receipt.decisionDigest)
    && receipt.decisionDigest === request?.decision?.decisionDigest
    && evidence.schemaVersion === 1
    && evidence.effect === 'squads_existing_no_asset_resource_adopted_finalized'
    && evidence.providerTransaction === 'none'
    && evidence.activation === 'active'
    && providerReceipt?.schemaVersion === 1
    && providerReceipt?.chainId === 'solana:devnet'
    && typeof providerReceipt?.profileRef === 'string'
    && Number.isSafeInteger(providerReceipt?.profileVersion)
    && providerReceipt?.providerFinality === 'finalized'
    && providerReceipt?.fundingSignature === null
    && Number.isSafeInteger(providerReceipt?.totalSpendLamports)
    && providerReceipt.totalSpendLamports >= 0
    && Number.isSafeInteger(providerReceipt?.finalBalanceLamports)
    && providerReceipt.finalBalanceLamports >= 0
    && transactions.length === expectedSteps.length
    && transactions.every((transaction: any, index: number) => (
      isRecord(transaction)
      && transaction.stepId === expectedSteps[index]
      && typeof transaction.signature === 'string'
      && transaction.signature.length >= 64
      && transaction.signature.length <= 100
      && Number.isSafeInteger(transaction.slot)
      && transaction.slot > 0
      && (index === 0 || transaction.slot > transactions[index - 1].slot)
      && isSha256(transaction.messageDigest)
      && isSha256(transaction.manifestDigest)
      && Number.isSafeInteger(transaction.feeLamports)
      && transaction.feeLamports >= 0
      && (
        transaction.directRentLamports === undefined
        || (
          Number.isSafeInteger(transaction.directRentLamports)
          && transaction.directRentLamports >= 0
        )
      )
      && Number.isSafeInteger(transaction.actualSpendLamports)
      && transaction.actualSpendLamports >= transaction.feeLamports
        + (transaction.directRentLamports ?? 0)
      && validRealmsProviderFinalityTransitions(transaction.finalityTransitions, transaction.slot)
      && transaction.finalityTransitions.at(-1)?.state === 'finalized'
    ))
    && (
      providerReceipt?.fundingSignature === null
      || (
        typeof providerReceipt?.fundingSignature === 'string'
        && providerReceipt.fundingSignature.length >= 64
        && providerReceipt.fundingSignature.length <= 100
      )
    )
    && Number.isSafeInteger(providerReceipt?.totalSpendLamports)
    && providerReceipt.totalSpendLamports >= 0
    && providerReceipt.totalSpendLamports === transactions.reduce((sum: number, transaction: any) => (
      sum + transaction.actualSpendLamports
    ), 0)
    && Number.isSafeInteger(providerReceipt?.finalBalanceLamports)
    && providerReceipt.finalBalanceLamports >= 0
    && accountGraph?.schemaVersion === 1
    && accountGraph?.status === 'verified_finalized'
    && accountGraph?.resourceRef === receipt.executionRef
    && typeof accountGraph?.ownerProgramRef === 'string'
    && Number.isSafeInteger(accountGraph?.observedSlot)
    && Number.isSafeInteger(accountGraph?.lastTransactionSlot)
    && accountGraph.observedSlot >= accountGraph.lastTransactionSlot
    && isSha256(accountGraph?.stateDigest)
    && accountGraph?.threshold === 2
    && accountGraph?.memberCount === 3
    && accountGraph?.approvedMemberCount === 2
    && accountGraph?.proposalState === 'executed'
    && accountGraph?.vaultTransactionState === 'executed'
    && accountGraph?.noRealAssets === true
    && binding?.id === evidence.resourceBindingId
    && binding?.status === 'active'
    && binding?.sourceRequestId === request.id
    && binding?.sourceDecisionDigest === receipt.decisionDigest
    && binding?.resourceRef === accountGraph.resourceRef
    && binding?.ownerProgramRef === accountGraph.ownerProgramRef
    && binding?.stateDigest === accountGraph.stateDigest
    && persistenceMatches
    && continuity?.sourceRequestId === request.id
    && continuity?.sourceDecisionDigest === receipt.decisionDigest
    && continuity?.providerTransaction === 'none'
    && origin?.authority === 'provider_history_only'
    && payload?.operation === 'adopt_existing_finalized_no_asset_resource'
    && payload?.targetCircleId === 35
    && payload?.chainId === providerReceipt.chainId
    && payload?.profileRef === providerReceipt.profileRef
    && payload?.profileVersion === providerReceipt.profileVersion
    && payloadResource?.multisig === accountGraph.resourceRef
    && payloadResource?.expectedStateDigest === accountGraph.stateDigest
    && payloadOrigin?.historicalRequestRef === origin?.historicalRequestRef
    && payloadOrigin?.circleRef === origin?.circleRef
    && request?.decision?.decision === 'accepted'
    && mechanism?.kind === 'equal_weight_threshold'
    && isSha256(mechanism?.contractDigest)
    && isSha256(mechanism?.resultDigest)
  );
}

function verifiedSquadsGrantPayoutExecutionReceipt(
  request: any,
  receipt: any,
  evidence: Record<string, any>,
): boolean {
  const providerReceipt = isRecord(evidence.providerReceipt) ? evidence.providerReceipt : null;
  const payload = isRecord(request?.payload) ? request.payload : null;
  const agreement = isRecord(payload?.agreement) ? payload.agreement : null;
  const providerIntent = isRecord(payload?.providerIntent) ? payload.providerIntent : null;
  const payerAuthorization = isRecord(payload?.payerAuthorization) ? payload.payerAuthorization : null;
  const binding = request?.providerResourceBinding;
  const bindingVerification = isRecord(binding?.verification) ? binding.verification : null;
  const persistedReceipt = isRecord(bindingVerification?.providerReceipt)
    ? bindingVerification.providerReceipt
    : null;
  const providerCheckpoint = isRecord(bindingVerification?.providerCheckpoint)
    ? bindingVerification.providerCheckpoint
    : null;
  const checkpointFunding = isRecord(providerCheckpoint?.funding)
    ? providerCheckpoint.funding
    : null;
  const checkpointSteps = Array.isArray(providerCheckpoint?.steps)
    ? providerCheckpoint.steps
    : [];
  const expectedSteps = [
    'payout_create_vault_transaction',
    'payout_create_proposal',
    'payout_approve_by_proposer',
    'payout_approve_by_approver',
    'payout_execute_vault_transaction',
  ];
  let evidenceDigestMatches = false;
  let receiptPersistenceMatches = false;
  let balanceReadbackMatches = false;
  let feeCapMatches = false;
  try {
    evidenceDigestMatches = receipt.executionEvidenceDigest === hashCanonicalGovernanceValue(
      'alcheme.governance.execution-receipt-evidence',
      evidence,
    );
    receiptPersistenceMatches = Boolean(persistedReceipt) && hashCanonicalGovernanceValue(
      'alcheme.governance.squads-grant-payout-receipt-readback',
      persistedReceipt,
    ) === hashCanonicalGovernanceValue(
      'alcheme.governance.squads-grant-payout-receipt-readback',
      providerReceipt,
    );
    const amount = BigInt(String(providerReceipt?.amountLamports));
    const vaultBefore = BigInt(String(providerReceipt?.vaultBalanceBeforeLamports));
    const vaultAfter = BigInt(String(providerReceipt?.vaultBalanceAfterLamports));
    const recipientBefore = BigInt(String(providerReceipt?.recipientBalanceBeforeLamports));
    const recipientAfter = BigInt(String(providerReceipt?.recipientBalanceAfterLamports));
    const totalFeeAndRent = BigInt(String(providerReceipt?.totalFeeAndRentLamports));
    balanceReadbackMatches = amount > 0n
      && vaultBefore - amount === vaultAfter
      && recipientBefore + amount === recipientAfter;
    feeCapMatches = totalFeeAndRent >= 0n
      && totalFeeAndRent <= BigInt(String(payerAuthorization?.totalActionLimitLamports));
  } catch {
    return false;
  }
  return (
    receipt.executorModule === 'squads_provider_binding'
    && receipt.executionStatus === 'executed'
    && receipt.executionRef === providerReceipt?.payoutSignature
    && isSha256(receipt.decisionDigest)
    && receipt.decisionDigest === request?.decision?.decisionDigest
    && evidenceDigestMatches
    && evidence.schemaVersion === 1
    && evidence.effect === 'squads_devnet_grant_payout_finalized'
    && evidence.canonicalFundingStatus === 'paid'
    && evidence.agreementId === agreement?.id
    && evidence.trancheIntentId === agreement?.trancheIntentId
    && typeof evidence.payerPolicyId === 'string'
    && typeof evidence.assetAuthorityPolicyId === 'string'
    && typeof evidence.preflightId === 'string'
    && providerReceipt?.schemaVersion === 1
    && providerReceipt?.chainId === 'solana:devnet'
    && providerReceipt?.chainId === payload?.chainId
    && providerReceipt?.profileRef === payload?.profileRef
    && providerReceipt?.profileVersion === payload?.profileVersion
    && providerReceipt?.agreementId === agreement?.id
    && providerReceipt?.trancheIntentId === agreement?.trancheIntentId
    && providerReceipt?.milestoneResultDigest === agreement?.milestoneResultDigest
    && providerReceipt?.multisig === payload?.resourceBinding?.multisig
    && providerReceipt?.vault === providerIntent?.vault
    && providerReceipt?.transactionIndex === providerIntent?.transactionIndex
    && providerReceipt?.recipient === providerIntent?.recipient
    && providerReceipt?.amountLamports === providerIntent?.amountLamports
    && providerReceipt?.vaultBalanceBeforeLamports === providerIntent?.vaultFundingTargetLamports
    && providerReceipt?.providerFinality === 'finalized'
    && ['solana_devnet_faucet', 'existing_finalized_balance']
      .includes(providerReceipt?.fundingSource)
    && (
      (providerReceipt.fundingSource === 'solana_devnet_faucet'
        && typeof providerReceipt.fundingSignature === 'string'
        && providerReceipt.fundingSignature.length >= 64
        && providerReceipt.fundingSignature.length <= 100)
      || (providerReceipt.fundingSource === 'existing_finalized_balance'
        && providerReceipt.fundingSignature === null)
    )
    && typeof providerReceipt?.payoutSignature === 'string'
    && providerReceipt.payoutSignature.length >= 64
    && providerReceipt.payoutSignature.length <= 100
    && Number.isSafeInteger(providerReceipt?.fundingSlot)
    && providerReceipt.fundingSlot > 0
    && Number.isSafeInteger(providerReceipt?.payoutSlot)
    && providerReceipt.payoutSlot >= providerReceipt.fundingSlot
    && isSha256(providerReceipt?.stateDigest)
    && providerCheckpoint?.schemaVersion === 1
    && checkpointFunding?.status === 'finalized'
    && checkpointFunding?.source === providerReceipt.fundingSource
    && (
      checkpointFunding?.signature === providerReceipt.fundingSignature
      || (providerReceipt.fundingSource === 'existing_finalized_balance'
        && checkpointFunding?.signature == null)
    )
    && checkpointFunding?.slot === providerReceipt.fundingSlot
    && checkpointSteps.length === expectedSteps.length
    && checkpointSteps.every((step: any, index: number) => (
      isRecord(step)
      && step.id === expectedSteps[index]
      && step.status === 'finalized'
      && typeof step.signature === 'string'
      && step.signature.length >= 64
      && step.signature.length <= 100
      && Number.isSafeInteger(step.slot)
      && step.slot > 0
      && isSha256(step.messageDigest)
      && isSha256(step.manifestDigest)
      && validRealmsProviderFinalityTransitions(step.finalityTransitions, step.slot)
    ))
    && checkpointSteps.at(-1)?.signature === providerReceipt.payoutSignature
    && checkpointSteps.at(-1)?.slot === providerReceipt.payoutSlot
    && balanceReadbackMatches
    && feeCapMatches
    && binding?.id === evidence.grantResourceBindingId
    && binding?.status === 'active'
    && binding?.sourceRequestId === request.id
    && binding?.sourceDecisionDigest === receipt.decisionDigest
    && binding?.resourceRef === providerReceipt.vault
    && binding?.ownerProgramRef === payload?.providerIntent?.programId
    && String(binding?.verifiedSlot) === String(providerReceipt.payoutSlot)
    && binding?.stateDigest === providerReceipt.stateDigest
    && bindingVerification?.grantSettlement?.providerFinality === 'finalized'
    && receiptPersistenceMatches
    && request?.decision?.decision === 'accepted'
  );
}

function verifiedRealmsProviderExecutionReceipt(request: any, receipt: any): boolean {
  const evidence = receipt?.executionEvidence;
  if (!isRecord(evidence)) return false;
  let expectedDigest: string;
  try {
    expectedDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.execution-receipt-evidence',
      evidence,
    );
  } catch {
    return false;
  }
  const providerReceipt = isRecord(evidence.providerReceipt) ? evidence.providerReceipt : null;
  const accountGraph = isRecord(evidence.accountGraph) ? evidence.accountGraph : null;
  const plan = isRecord(providerReceipt?.plan) ? providerReceipt.plan : null;
  const addresses = isRecord(plan?.addresses) ? plan.addresses : null;
  const mechanism = isRecord(request?.decision?.tally?.mechanism)
    ? request.decision.tally.mechanism
    : null;
  const binding = request?.providerResourceBinding;
  const bindingVerification = isRecord(binding?.verification) ? binding.verification : null;
  const currentProfileReadiness = resolveRealmsProviderTrustReadiness();
  const transactions = Array.isArray(providerReceipt?.transactions)
    ? providerReceipt.transactions
    : [];
  if (evidence.effect === 'realms_devnet_delegation_conformance_finalized') {
    return verifiedRealmsDelegationProviderExecutionReceipt(
      request,
      receipt,
      evidence,
      expectedDigest,
    );
  }
  if (evidence.effect === 'realms_voting_power_challenge_reopened') {
    const pre = isRecord(evidence.preReadback) ? evidence.preReadback : null;
    const post = isRecord(evidence.postReadback) ? evidence.postReadback : null;
    const preSecurity = isRecord(pre?.votingPowerSecurity) ? pre.votingPowerSecurity : null;
    const postSecurity = isRecord(post?.votingPowerSecurity) ? post.votingPowerSecurity : null;
    const binding = request?.providerResourceBinding;
    const challenge = isRecord(binding?.verification?.votingPowerChallenge)
      ? binding.verification.votingPowerChallenge
      : null;
    const challengePre = isRecord(challenge?.preReadback) ? challenge.preReadback : null;
    const challengePost = isRecord(challenge?.postReadback) ? challenge.postReadback : null;
    return (
      receipt.executorModule === 'realms_provider_binding'
      && receipt.executionStatus === 'executed'
      && receipt.executionEvidenceDigest === expectedDigest
      && receipt.decisionDigest === request?.decision?.decisionDigest
      && evidence.schemaVersion === 1
      && evidence.noProviderTransaction === true
      && evidence.historicalTallyInvariant === 'unchanged'
      && evidence.resourceBindingId === binding?.id
      && pre?.state === 'verified'
      && post?.state === 'verified'
      && isCurrentRealmsVotingPowerSecurityProfile(preSecurity)
      && isCurrentRealmsVotingPowerSecurityProfile(postSecurity)
      && Number.isSafeInteger(pre?.observedSlot)
      && Number(pre?.observedSlot) > 0
      && Number.isSafeInteger(post?.observedSlot)
      && Number(post?.observedSlot) > 0
      && isSha256(pre?.observedStateDigest)
      && isSha256(post?.observedStateDigest)
      && hashCanonicalGovernanceValue('alcheme.governance.vote-record-facts', preSecurity.voteRecord)
        === hashCanonicalGovernanceValue('alcheme.governance.vote-record-facts', postSecurity.voteRecord)
      && challenge?.schemaVersion === 1
      && challenge?.state === 'reopened'
      && challenge?.requestId === request.id
      && challenge?.decisionDigest === receipt.decisionDigest
      && challenge?.resolution === 'authoritative_readback_matched_frozen_historical_tally'
      && challenge?.historicalTallyInvariant === 'unchanged'
      && challenge?.blocker === null
      && Number(challengePre?.observedSlot) === Number(pre?.observedSlot)
      && challengePre?.observedStateDigest === pre?.observedStateDigest
      && Number(challengePost?.observedSlot) === Number(post?.observedSlot)
      && challengePost?.observedStateDigest === post?.observedStateDigest
    );
  }
  return (
    receipt.executorModule === 'realms_provider_binding'
    && receipt.executionStatus === 'executed'
    && isSha256(receipt.executionEvidenceDigest)
    && receipt.executionEvidenceDigest === expectedDigest
    && isSha256(receipt.decisionDigest)
    && receipt.decisionDigest === request?.decision?.decisionDigest
    && evidence.schemaVersion === 1
    && evidence.effect === 'realms_devnet_no_asset_vertical_finalized'
    && providerReceipt?.schemaVersion === 1
    && providerReceipt?.chainId === currentProfileReadiness.chainId
    && providerReceipt?.profileRef === currentProfileReadiness.profileRef
    && providerReceipt?.profileVersion === currentProfileReadiness.profileVersion
    && binding?.profileRef === currentProfileReadiness.profileRef
    && binding?.profileVersion === currentProfileReadiness.profileVersion
    && bindingVerification?.profileDigest === currentProfileReadiness.profileDigest
    && providerReceipt?.providerFinality === 'finalized'
    && plan?.schemaVersion === 1
    && isSha256(plan?.planDigest)
    && Number.isSafeInteger(plan?.programVersion)
    && typeof addresses?.proposal === 'string'
    && addresses.proposal.length > 0
    && typeof addresses?.voteRecord === 'string'
    && addresses.voteRecord.length > 0
    && typeof addresses?.voterTokenOwnerRecord === 'string'
    && addresses.voterTokenOwnerRecord.length > 0
    && transactions.length > 0
    && transactions.every((transaction: any) => (
      isRecord(transaction)
      && typeof transaction.stepId === 'string'
      && transaction.stepId.length > 0
      && typeof transaction.signature === 'string'
      && transaction.signature.length >= 64
      && transaction.signature.length <= 100
      && Number.isSafeInteger(transaction.slot)
      && transaction.slot > 0
      && isSha256(transaction.messageDigest)
      && isSha256(transaction.manifestDigest)
      && Number.isSafeInteger(transaction.feeLamports)
      && transaction.feeLamports >= 0
      && (
        transaction.directRentLamports === undefined
        || (
          Number.isSafeInteger(transaction.directRentLamports)
          && transaction.directRentLamports >= 0
        )
      )
      && Number.isSafeInteger(transaction.actualSpendLamports)
      && transaction.actualSpendLamports >= transaction.feeLamports
        + (transaction.directRentLamports ?? 0)
      && validRealmsProviderFinalityTransitions(transaction.finalityTransitions, transaction.slot)
      && transaction.finalityTransitions.at(-1)?.state === 'finalized'
    ))
    && (
      providerReceipt?.fundingSignature === null
      || (
        typeof providerReceipt?.fundingSignature === 'string'
        && providerReceipt.fundingSignature.length >= 64
        && providerReceipt.fundingSignature.length <= 100
      )
    )
    && Number.isSafeInteger(providerReceipt?.totalSpendLamports)
    && providerReceipt.totalSpendLamports >= 0
    && providerReceipt.totalSpendLamports === transactions.reduce((sum: number, transaction: any) => (
      sum + transaction.actualSpendLamports
    ), 0)
    && Number.isSafeInteger(providerReceipt?.finalBalanceLamports)
    && providerReceipt.finalBalanceLamports >= 0
    && (
      evidence.expiredAttemptHistory === undefined
      || projectRealmsExpiredAttemptHistory(evidence.expiredAttemptHistory, plan) !== null
    )
    && accountGraph?.schemaVersion === 1
    && accountGraph?.status === 'verified_finalized'
    && typeof accountGraph?.resourceRef === 'string'
    && accountGraph.resourceRef === receipt.executionRef
    && typeof accountGraph?.ownerProgramRef === 'string'
    && Number.isSafeInteger(accountGraph?.observedSlot)
    && Number.isSafeInteger(accountGraph?.lastTransactionSlot)
    && accountGraph.observedSlot >= accountGraph.lastTransactionSlot
    && isSha256(accountGraph?.stateDigest)
    && accountGraph?.proposalState === 'completed'
    && accountGraph?.instructionExecutionStatus === 'success'
    && accountGraph?.noRealAssets === true
    && /^\d+$/.test(String(accountGraph?.yesVoteWeight ?? ''))
    && BigInt(String(accountGraph.yesVoteWeight)) > 0n
    && /^\d+$/.test(String(accountGraph?.voterWeight ?? ''))
    && BigInt(String(accountGraph.voterWeight)) >= BigInt(String(accountGraph.yesVoteWeight))
    && request?.decision?.decision === 'accepted'
    && mechanism?.kind === 'equal_weight_threshold'
    && isSha256(mechanism?.contractDigest)
    && isSha256(mechanism?.resultDigest)
  );
}

function projectRealmsExpiredAttemptHistory(
  value: unknown,
  plan: Record<string, any> | null,
): Record<string, unknown> | null {
  if (!isRecord(value) || value.schemaVersion !== 1
    || value.authority !== 'canonical_cost_preflight_checkpoint'
    || !Array.isArray(value.attempts)
    || value.attempts.length > 24
    || !Array.isArray(plan?.steps)) return null;
  const manifests = new Map<string, string>(plan.steps.flatMap((step: any) => (
    isRecord(step) && typeof step.id === 'string' && isSha256(step.manifestDigest)
      ? [[step.id, step.manifestDigest] as [string, string]]
      : []
  )));
  const messageDigests = new Set<string>();
  const attempts = value.attempts.flatMap((raw: unknown) => {
    if (!isRecord(raw)) return [];
    const stepId = optionalString(raw.stepId);
    const manifestDigest = optionalString(raw.manifestDigest);
    const messageDigest = optionalString(raw.messageDigest);
    const recentBlockhash = optionalString(raw.recentBlockhash);
    const lastValidBlockHeight = Number(raw.lastValidBlockHeight);
    const expiredAtBlockHeight = Number(raw.expiredAtBlockHeight);
    if (
      !stepId
      || !isSha256(manifestDigest)
      || manifests.get(stepId) !== manifestDigest
      || !isSha256(messageDigest)
      || messageDigests.has(messageDigest)
      || !recentBlockhash
      || !Number.isSafeInteger(lastValidBlockHeight)
      || lastValidBlockHeight < 0
      || !Number.isSafeInteger(expiredAtBlockHeight)
      || expiredAtBlockHeight <= lastValidBlockHeight
      || raw.disposition !== 'authoritative_expiry_same_intent_manual_retry'
    ) return [];
    messageDigests.add(messageDigest);
    return [{
      stepId,
      manifestDigest,
      messageDigest,
      recentBlockhash,
      lastValidBlockHeight,
      expiredAtBlockHeight,
      disposition: 'authoritative_expiry_same_intent_manual_retry',
    }];
  });
  if (attempts.length !== value.attempts.length) return null;
  return {
    schemaVersion: 1,
    authority: 'canonical_cost_preflight_checkpoint',
    attempts,
  };
}

function verifiedRealmsDelegationProviderExecutionReceipt(
  request: any,
  receipt: any,
  evidence: Record<string, any>,
  expectedDigest: string,
): boolean {
  const providerReceipt = isRecord(evidence.providerReceipt) ? evidence.providerReceipt : null;
  const reconciliation = isRecord(evidence.reconciliation) ? evidence.reconciliation : null;
  const binding = request?.providerResourceBinding;
  const bindingVerification = isRecord(binding?.verification) ? binding.verification : null;
  const bindingReconciliation = isRecord(bindingVerification?.reconciliation)
    ? bindingVerification.reconciliation
    : null;
  const lifecycle = isRecord(bindingVerification?.delegationConformance)
    ? bindingVerification.delegationConformance
    : null;
  const authorityTransition = isRecord(lifecycle?.authorityTransition)
    ? lifecycle.authorityTransition
    : null;
  const baseline = isRecord(providerReceipt?.baseline) ? providerReceipt.baseline : null;
  const setReadback = isRecord(providerReceipt?.setReadback) ? providerReceipt.setReadback : null;
  const revokeReadback = isRecord(providerReceipt?.revokeReadback)
    ? providerReceipt.revokeReadback
    : null;
  const transactions = Array.isArray(providerReceipt?.transactions)
    ? providerReceipt.transactions
    : [];
  const mechanism = isRecord(request?.decision?.tally?.mechanism)
    ? request.decision.tally.mechanism
    : null;
  const finalizedTransaction = (
    transaction: any,
    expectedStepId: string,
    expectedDelegate: string | null,
    expectedProviderStateDigest: string,
  ): boolean => {
    const precondition = isRecord(transaction?.statePrecondition)
      ? transaction.statePrecondition
      : null;
    const canonicalOwnerState = isRecord(precondition?.canonicalOwnerState)
      ? precondition.canonicalOwnerState
      : null;
    const instructionSafety = isRecord(precondition?.instructionSafety)
      ? precondition.instructionSafety
      : null;
    const instructionSafetyFacts = instructionSafety
      ? Object.fromEntries(Object.entries(instructionSafety).filter(([key]) => key !== 'digest'))
      : null;
    if (!precondition) return false;
    const { digest, ...preconditionFacts } = precondition;
    return isRecord(transaction)
    && transaction.stepId === expectedStepId
    && typeof transaction.signature === 'string'
    && transaction.signature.length >= 64
    && transaction.signature.length <= 100
    && Number.isSafeInteger(transaction.slot)
    && transaction.slot > 0
    && isSha256(transaction.messageDigest)
    && isSha256(transaction.manifestDigest)
    && Number.isSafeInteger(transaction.feeLamports)
    && transaction.feeLamports >= 0
    && Number.isSafeInteger(transaction.actualSpendLamports)
    && transaction.actualSpendLamports >= 0
    && transaction.actualSpendLamports >= transaction.feeLamports
    && transaction.actualSpendLamports <= 50_000
    && precondition.schemaVersion === 1
    && precondition.authority === 'independent_provider_readback_before_transit_sign'
    && precondition.chainId === providerReceipt?.chainId
    && precondition.profileRef === providerReceipt?.profileRef
    && precondition.profileVersion === providerReceipt?.profileVersion
    && precondition.programId === binding?.ownerProgramRef
    && precondition.actionIntentDigest === lifecycle?.actionIntentDigest
    && precondition.planDigest === providerReceipt?.planDigest
    && precondition.stepId === transaction.stepId
    && precondition.manifestDigest === transaction.manifestDigest
    && precondition.messageDigest === transaction.messageDigest
    && precondition.expectedDelegate === expectedDelegate
    && Number.isSafeInteger(precondition.observedSlot)
    && precondition.observedSlot > 0
    && precondition.observedSlot <= transaction.slot
    && precondition.providerStateDigest === expectedProviderStateDigest
    && Number.isSafeInteger(precondition.feePayerBalanceLamports)
    && precondition.feePayerBalanceLamports >= 0
    && canonicalOwnerState?.schemaVersion === 1
    && canonicalOwnerState.authority === 'canonical_resource_authority_payer_readback'
    && canonicalOwnerState.resourceBindingId === binding?.id
    && canonicalOwnerState.authorityBindingId === authorityTransition?.bindingId
    && canonicalOwnerState.payerPolicyId === evidence?.payerPolicyId
    && ['not_configured_p05_gate', 'clear_fresh_p05_authority_health']
      .includes(canonicalOwnerState.emergencyFreeze)
    && isSha256(canonicalOwnerState.stateDigest)
    && instructionSafety?.schemaVersion === 1
    && instructionSafety.authority === 'provider_instruction_manifest_and_simulation'
    && Array.isArray(instructionSafety.programIds)
    && instructionSafety.programIds.length === 1
    && instructionSafety.programIds[0] === binding?.ownerProgramRef
    && instructionSafety.instructionCount === 1
    && instructionSafety.transactionSignerCount === 2
    && Array.isArray(instructionSafety.writableAccountRefs)
    && instructionSafety.writableAccountRefs.length === 1
    && instructionSafety.writableAccountRefs[0] === baseline?.tokenOwnerRecord
    && instructionSafety.accountPrivilegeCheck === 'exact_spl_governance_set_delegate_accounts'
    && instructionSafety.assetOutflowLamports === 0
    && instructionSafety.opaqueInstructions === false
    && instructionSafety.simulation === 'passed'
    && isSha256(instructionSafety.digest)
    && instructionSafety.digest === hashCanonicalGovernanceValue(
      'alcheme.governance.realms-delegation-instruction-safety-v1',
      instructionSafetyFacts,
    )
    && isSha256(digest)
    && digest === hashCanonicalGovernanceValue(
      'alcheme.governance.realms-delegation-pre-sign-state-v1',
      preconditionFacts,
    )
    && validRealmsProviderFinalityTransitions(transaction.finalityTransitions, transaction.slot)
    && transaction.finalityTransitions.at(-1)?.state === 'finalized';
  };
  const sameHistoricalVoteFacts = Boolean(
    baseline
    && setReadback
    && revokeReadback
    && [setReadback, revokeReadback].every((readback) => (
      readback.tokenOwnerRecord === baseline.tokenOwnerRecord
      && readback.voterOwner === baseline.voterOwner
      && readback.voteRecord === baseline.voteRecord
      && readback.voteRecordVoter === baseline.voteRecordVoter
      && readback.depositAmount === baseline.depositAmount
      && readback.yesVoteWeight === baseline.yesVoteWeight
    )),
  );
  return (
    receipt.executorModule === 'realms_provider_binding'
    && receipt.executionStatus === 'executed'
    && isSha256(receipt.executionEvidenceDigest)
    && receipt.executionEvidenceDigest === expectedDigest
    && isSha256(receipt.decisionDigest)
    && receipt.decisionDigest === request?.decision?.decisionDigest
    && receipt.executionRef === binding?.resourceRef
    && evidence.schemaVersion === 1
    && typeof evidence.resourceBindingId === 'string'
    && evidence.resourceBindingId === binding?.id
    && providerReceipt?.schemaVersion === 1
    && providerReceipt.chainId === 'solana:devnet'
    && providerReceipt.profileRef === binding?.profileRef
    && providerReceipt.profileVersion === binding?.profileVersion
    && providerReceipt.providerFinality === 'finalized'
    && providerReceipt.finalDelegate === null
    && providerReceipt.historicalVoteInvariant === 'unchanged'
    && Number.isSafeInteger(providerReceipt.totalSpendLamports)
    && providerReceipt.totalSpendLamports >= 0
    && providerReceipt.totalSpendLamports <= 100_000
    && Number.isSafeInteger(providerReceipt.finalBalanceLamports)
    && providerReceipt.finalBalanceLamports >= 0
    && transactions.length === 2
    && baseline !== null
    && setReadback !== null
    && revokeReadback !== null
    && finalizedTransaction(
      transactions[0],
      'set_governance_delegate',
      null,
      baseline.stateDigest,
    )
    && finalizedTransaction(
      transactions[1],
      'revoke_governance_delegate',
      authorityTransition?.delegate,
      setReadback.stateDigest,
    )
    && providerReceipt.totalSpendLamports === transactions.reduce(
      (total: number, transaction: any) => total + transaction.actualSpendLamports,
      0,
    )
    && setReadback.governanceDelegate === authorityTransition?.delegate
    && revokeReadback.governanceDelegate === null
    && baseline.governanceDelegate === null
    && Number.isSafeInteger(setReadback.observedSlot)
    && setReadback.observedSlot >= transactions[0].slot
    && Number.isSafeInteger(revokeReadback?.observedSlot)
    && revokeReadback.observedSlot >= transactions[1].slot
    && revokeReadback.observedSlot >= setReadback.observedSlot
    && sameHistoricalVoteFacts
    && reconciliation?.schemaVersion === 1
    && reconciliation.state === 'verified'
    && reconciliation.blocker === null
    && reconciliation.authority === 'independent_provider_readback'
    && reconciliation.resourceBindingId === binding?.id
    && isSha256(reconciliation.observedStateDigest)
    && reconciliation.observedStateDigest === binding?.stateDigest
    && Number.isSafeInteger(reconciliation.observedSlot)
    && reconciliation.observedSlot >= revokeReadback.observedSlot
    && isCurrentRealmsVotingPowerSecurityProfile(reconciliation.votingPowerSecurity)
    && reconciliation.votingPowerSecurity.source.snapshotSlot === reconciliation.observedSlot
    && binding?.status === 'active'
    && bindingReconciliation?.state === 'verified'
    && bindingReconciliation?.observedStateDigest === reconciliation.observedStateDigest
    && bindingReconciliation?.observedSlot === reconciliation.observedSlot
    && lifecycle?.state === 'completed'
    && lifecycle.requestId === request?.id
    && lifecycle.decisionDigest === receipt.decisionDigest
    && lifecycle.historicalVoteInvariant === 'unchanged'
    && authorityTransition?.scope === 'provider_delegation_conformance_only'
    && authorityTransition?.role === 'voter'
    && request?.decision?.decision === 'accepted'
    && mechanism?.kind === 'equal_weight_threshold'
    && isSha256(mechanism?.contractDigest)
    && isSha256(mechanism?.resultDigest)
  );
}

function projectRealmsDelegationProviderExecution(
  request: any,
  receipt: any,
  evidence: Record<string, any>,
  attempts: Array<Record<string, unknown>>,
  failedAttemptCount: number,
  linkage: Record<string, unknown>,
): Record<string, unknown> {
  const providerReceipt = evidence.providerReceipt as Record<string, any>;
  const reconciliation = evidence.reconciliation as Record<string, any>;
  const binding = request.providerResourceBinding as Record<string, any>;
  const mechanism = request.decision.tally.mechanism as Record<string, any>;
  const lifecycle = binding.verification.delegationConformance as Record<string, any>;
  const authorityTransition = lifecycle.authorityTransition as Record<string, any>;
  const executionAuthorities = projectProviderExecutionAuthorities(request, {
    chainId: providerReceipt.chainId,
    profileRef: providerReceipt.profileRef,
    profileVersion: providerReceipt.profileVersion,
    resourceRef: binding.resourceRef,
    ownerProgramRef: binding.ownerProgramRef,
  });
  const authorityPaymentBoundary = projectProviderAuthorityPaymentBoundary(
    request,
    {
      chainId: providerReceipt.chainId,
      profileRef: providerReceipt.profileRef,
      profileVersion: providerReceipt.profileVersion,
      resourceRef: binding.resourceRef,
      ownerProgramRef: binding.ownerProgramRef,
    },
    executionAuthorities,
  );
  const mandateCostPolicy = projectProviderMandateCostPolicy(request);
  const fundingSourceFeePayerBoundary = projectProviderFundingSourceFeePayerBoundary(
    request,
    authorityPaymentBoundary,
    {
      fundingSourceRole: 'governed_resource_account',
      fundingSourceRef: binding.resourceRef,
    },
  );
  const providerActionSafetyBoundary = projectProviderActionSafetyBoundary({
    request,
    receipt,
    evidence,
    providerModule: 'realms_provider_binding',
    executionMode: 'realms',
    chainId: providerReceipt.chainId,
    resourceRef: binding.resourceRef,
    ownerProgramRef: binding.ownerProgramRef,
    planDigest: providerReceipt.planDigest,
    transactions: providerReceipt.transactions,
    projectHumanReadableAction: (transaction) => (
      projectRealmsDelegationHumanReadableAction(transaction, binding)
    ),
  });
  const publishedCostReconciliation = authorityPaymentBoundary
    && evidence.payerPolicyId === authorityPaymentBoundary.payerPolicyId ? {
    schemaVersion: 1,
    authority: 'canonical_cost_preflight_and_provider_receipt',
    payerPolicyId: evidence.payerPolicyId,
    payerRole: 'separated_fee_payer_policy',
    economicBearer: authorityPaymentBoundary.economicBearer,
    sponsorRole: authorityPaymentBoundary.sponsorRole,
    unit: 'lamports',
    transactions: providerReceipt.transactions.map((transaction: any) => ({
      stepId: String(transaction.stepId),
      quotedFeeLamports: Number(transaction.feeLamports),
      directRentLamports: 0,
      actualSpendLamports: Number(transaction.actualSpendLamports),
    })),
    totalDirectRentLamports: 0,
    totalSpendLamports: Number(providerReceipt.totalSpendLamports),
    finalBalanceLamports: Number(providerReceipt.finalBalanceLamports),
    fundingSource: 'existing_finalized_balance',
    fundingSignature: null,
    reconciliation: 'transaction_sum_matches_provider_receipt',
    rent: 'not_applicable_delegation_no_account_creation',
    refund: 'not_applicable_no_refund',
  } : null;
  const servicePayerAuthorityBoundary = projectServicePayerAuthorityBoundary({
    authorityPaymentBoundary,
    fundingSourceFeePayerBoundary,
    providerActionSafetyBoundary,
    costReconciliation: publishedCostReconciliation,
  });
  const providerCostControlBoundary = projectProviderCostControlBoundary({
    request,
    resourceBindingId: binding.resourceRef,
    costReconciliation: publishedCostReconciliation,
  });
  const assetAuthoritySponsorBoundary = projectAssetAuthoritySponsorBoundary({
    servicePayerAuthorityBoundary,
    providerCostControlBoundary,
    providerActionSafetyBoundary,
  });
  return compactObject({
    schemaVersion: 1,
    status: 'executed',
    integrity: 'verified',
    blocker: null,
    receiptId: optionalString(receipt.id),
    evidenceDigest: optionalString(receipt.executionEvidenceDigest),
    executedAt: dateTime(receipt.executedAt),
    effect: evidence.effect,
    provider: {
      module: 'realms_provider_binding',
      chainId: providerReceipt.chainId,
      profileRef: providerReceipt.profileRef,
      profileVersion: providerReceipt.profileVersion,
      finality: providerReceipt.providerFinality,
      resourceRef: binding.resourceRef,
      ownerProgramRef: binding.ownerProgramRef,
      observedSlot: reconciliation.observedSlot,
      stateDigest: reconciliation.observedStateDigest,
      noRealAssets: true,
      transactionCount: providerReceipt.transactions.length,
      executionPlanReadback: projectProviderExecutionPlanReadback({
        request,
        receipt,
        evidence,
        providerModule: 'realms_provider_binding',
        executionMode: 'realms',
        chainId: providerReceipt.chainId,
        resourceRef: binding.resourceRef,
        planDigest: providerReceipt.planDigest,
        transactions: providerReceipt.transactions,
        projectHumanReadableAction: (transaction) => (
          projectRealmsDelegationHumanReadableAction(transaction, binding)
        ),
      }),
      providerActionSafetyBoundary,
      servicePayerAuthorityBoundary,
      providerCostControlBoundary,
      assetAuthoritySponsorBoundary,
      attemptOwner: projectProviderTerminalAttemptOwner(request, receipt, evidence),
      retryBoundary: projectProviderRetryBoundary(
        request,
        receipt,
        evidence,
        providerReceipt.transactions,
      ),
      transactions: providerReceipt.transactions.map((transaction: any, index: number) => ({
        stepId: String(transaction.stepId),
        signature: String(transaction.signature),
        slot: Number(transaction.slot),
        messageDigest: String(transaction.messageDigest),
        manifestDigest: String(transaction.manifestDigest),
        ...(projectProviderTransactionAttemptContext(transaction, request)
          ? { attemptContext: projectProviderTransactionAttemptContext(transaction, request) }
          : {}),
        ...(projectProviderExecutionActionContext({
          request,
          receipt,
          evidence,
          transaction,
          transactions: providerReceipt.transactions,
          planDigest: providerReceipt.planDigest,
        }) ? {
            actionContext: projectProviderExecutionActionContext({
              request,
              receipt,
              evidence,
              transaction: providerReceipt.transactions[index],
              transactions: providerReceipt.transactions,
              planDigest: providerReceipt.planDigest,
            }),
          } : {}),
        ...(projectRealmsDelegationHumanReadableAction(transaction, binding)
          ? {
              humanReadableAction: projectRealmsDelegationHumanReadableAction(
                transaction,
                binding,
              ),
            }
          : {}),
        statePrecondition: transaction.statePrecondition,
        finalityTransitions: transaction.finalityTransitions.map((transition: any) => ({
          state: transition.state,
          authority: transition.authority,
          ...(transition.slot === undefined ? {} : { slot: Number(transition.slot) }),
        })),
      })),
      executionAuthorities,
      authorityPaymentBoundary,
      mandateCostPolicy,
      fundingSourceFeePayerBoundary,
      enforcementDisclosure: executionAuthorities ? {
        schemaVersion: 1,
        mode: 'provider_onchain',
        providerModule: 'realms_provider_binding',
        resourceRef: binding.resourceRef,
        ownerProgramRef: binding.ownerProgramRef,
        decisionLinkage: {
          requestId: request.id,
          decisionDigest: receipt.decisionDigest,
        },
        allowedOperations: providerReceipt.transactions.map((transaction: any) => (
          String(transaction.stepId)
        )),
        verificationState: 'verified',
        version: providerReceipt.profileVersion,
        proofScope: 'spl_governance_owner_program_and_transit_signatures_match_accepted_decision',
        residualBypassRisk: 'custodied_authority_can_sign_allowed_provider_operations_outside_alcheme_request_path',
        bypassPrevented: false,
      } : null,
      costReconciliation: publishedCostReconciliation,
    },
    decisionMapping: {
      sourceDecisionDigest: receipt.decisionDigest,
      sourceMechanism: {
        kind: mechanism.kind,
        contractDigest: mechanism.contractDigest,
        resultDigest: mechanism.resultDigest,
      },
      providerDelegate: authorityTransition.delegate,
      providerFinalDelegate: null,
      providerResult: 'delegation_set_and_revoked',
      historicalVoteInvariant: 'unchanged',
      authorityBoundary: 'governance_voter_authorizes_request_provider_authority_executes_decision',
    },
    reconciliation: {
      state: reconciliation.state,
      blocker: reconciliation.blocker,
      authority: reconciliation.authority,
      observedStateDigest: reconciliation.observedStateDigest,
      observedSlot: reconciliation.observedSlot,
      votingPowerSecurity: reconciliation.votingPowerSecurity,
      observedAt: reconciliation.observedAt,
    },
    attempts: {
      total: attempts.length,
      failed: failedAttemptCount,
      history: attempts,
    },
    linkage,
  });
}

function isRealmsProviderExecutionExpiryCandidate(receipt: any): boolean {
  return receipt?.executorModule === 'realms_provider_binding'
    && receipt?.executionStatus === 'failed'
    && receipt?.errorCode === 'realms_provider_blockhash_expired'
    && receipt?.executionEvidence != null;
}

function projectRealmsProviderExecutionExpiryReadback(
  request: any,
  receipt: any,
): Record<string, unknown> | null {
  if (!isRealmsProviderExecutionExpiryCandidate(receipt)) return null;
  const evidence = isRecord(receipt.executionEvidence)
    ? receipt.executionEvidence
    : null;
  const preflight = Array.isArray(request?.invocation?.costPreflights)
    ? request.invocation.costPreflights[0]
    : null;
  const checkpoint = isRecord(preflight?.estimatedCost?.providerCheckpoint)
    ? preflight.estimatedCost.providerCheckpoint
    : null;
  const steps = Array.isArray(checkpoint?.steps) ? checkpoint.steps : [];
  const step = steps.find((candidate: any) => candidate?.id === evidence?.stepId);
  let expectedEvidenceDigest: string;
  try {
    expectedEvidenceDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.execution-receipt-evidence',
      evidence,
    );
  } catch {
    return null;
  }
  const finalityTransitions = Array.isArray(step?.finalityTransitions)
    ? step.finalityTransitions
    : null;
  const lastTransition = finalityTransitions?.at(-1)?.state ?? null;
  const expectedLastTransition = step?.status === 'signed'
    ? null
    : step?.status === 'submitted'
      ? 'submitted'
      : step?.status === 'confirmed'
        ? 'confirmed'
        : 'invalid';
  if (
    request?.state !== 'accepted'
    || request?.decision?.decision !== 'accepted'
    || !isSha256(request?.decision?.decisionDigest)
    || receipt?.decisionDigest !== request.decision.decisionDigest
    || !isSha256(receipt?.executionEvidenceDigest)
    || receipt.executionEvidenceDigest !== expectedEvidenceDigest
    || evidence?.schemaVersion !== 1
    || evidence?.kind !== 'realms_provider_execution_expiry'
    || evidence?.state !== 'execution_expired'
    || evidence?.authority !== 'solana_rpc_finalized_block_height_and_missing_signature_status'
    || evidence?.commitment !== 'finalized'
    || !isSha256(evidence?.planDigest)
    || checkpoint?.planDigest !== evidence.planDigest
    || !optionalString(evidence?.stepId)
    || !isSha256(evidence?.manifestDigest)
    || !isSha256(evidence?.messageDigest)
    || !optionalString(evidence?.signature)
    || String(evidence.signature).length < 64
    || String(evidence.signature).length > 100
    || !Number.isSafeInteger(Number(evidence?.lastValidBlockHeight))
    || Number(evidence.lastValidBlockHeight) < 0
    || !Number.isSafeInteger(Number(evidence?.observedBlockHeight))
    || Number(evidence.observedBlockHeight) <= Number(evidence.lastValidBlockHeight)
    || evidence?.signatureStatus !== 'not_found'
    || evidence?.providerEffect !== 'not_observed'
    || evidence?.retryBoundary !== 'same_intent_manual_retry_only'
    || !step
    || !['signed', 'submitted', 'confirmed'].includes(String(step.status))
    || step.manifestDigest !== evidence.manifestDigest
    || step.messageDigest !== evidence.messageDigest
    || step.signature !== evidence.signature
    || Number(step.lastValidBlockHeight) !== Number(evidence.lastValidBlockHeight)
    || !validRealmsProviderFinalityTransitions(finalityTransitions)
    || lastTransition !== expectedLastTransition
  ) return null;
  return {
    schemaVersion: 1,
    state: 'execution_expired',
    authority: 'solana_rpc_finalized_block_height_and_missing_signature_status',
    commitment: 'finalized',
    planDigest: String(evidence.planDigest),
    stepId: String(evidence.stepId),
    manifestDigest: String(evidence.manifestDigest),
    messageDigest: String(evidence.messageDigest),
    providerReference: String(evidence.signature),
    lastValidBlockHeight: Number(evidence.lastValidBlockHeight),
    observedBlockHeight: Number(evidence.observedBlockHeight),
    signatureStatus: 'not_found',
    providerEffect: 'not_observed',
    automaticRetryAllowed: false,
    sameIntentRetry: 'manual_only',
    nextGate: 'manual_same_intent_retry_or_governed_terminal_abandonment',
  };
}

function safeProviderExecutionErrorCode(value: unknown): string {
  const code = String(value ?? '').trim().toLowerCase();
  if (
    code.startsWith('429_')
    || code.includes('too_many_requests')
    || code.includes('rate_limited')
  ) {
    return 'provider_rate_limited';
  }
  if (code.startsWith('airdrop_') || code.includes('funding_unavailable')) {
    return 'funding_unavailable';
  }
  if (
    code === 'realms_provider_submission_rejected'
    || code === 'squads_provider_submission_rejected'
    || code === 'provider_submission_rejected'
  ) {
    return 'provider_submission_rejected';
  }
  const allowed = new Set([
    'realms_provider_attempt_status_ambiguous',
    'realms_provider_blockhash_expired',
    'realms_provider_preflight_simulation_failed',
    'realms_provider_account_graph_state_mismatch',
    'unsupported_canonical_governance_value',
  ]);
  return allowed.has(code) ? code : 'provider_execution_failed';
}

function projectProviderExecutionRecovery(
  errorCode: unknown,
  retry: {
    mode: 'same_request_only';
    requestId: string;
    attemptCount: number;
    lastAttemptAt: string | null;
    nextRetryAt: string | null;
  } | null,
): Record<string, unknown> {
  const code = safeProviderExecutionErrorCode(errorCode);
  const common = {
    automaticMutation: false,
    authorityChangeAllowed: false,
    payerChangeAllowed: false,
    acceptedDecisionPreserved: true,
    decisionMutationAllowed: false,
    retryMode: retry ? 'same_request_only' : 'blocked_until_recovery_fact',
    nextEligibleAt: retry?.nextRetryAt ?? null,
  };
  if (code === 'provider_rate_limited') {
    return { ...common, category: 'provider_backoff', action: 'wait_for_persisted_retry_window' };
  }
  if (code === 'funding_unavailable') {
    return { ...common, category: 'funding_blocked', action: 'open_funding_amendment_or_restore_existing_payer' };
  }
  if (code === 'realms_provider_preflight_simulation_failed') {
    return { ...common, category: 'simulation_failed', action: 'repair_preflight_or_open_superseding_case' };
  }
  if (code === 'provider_submission_rejected') {
    return {
      ...common,
      category: 'submission_rejected',
      action: 'inspect_rejection_then_repair_or_open_superseding_case',
    };
  }
  if (code === 'realms_provider_attempt_status_ambiguous') {
    return { ...common, category: 'finality_ambiguous', action: 'authoritative_readback_before_any_resend' };
  }
  if (code === 'realms_provider_blockhash_expired') {
    return {
      ...common,
      category: 'blockhash_expired',
      action: 'prepare_same_request_rebuild_after_authoritative_expiry',
      retryMode: 'same_request_only',
    };
  }
  if (
    code === 'realms_provider_account_graph_state_mismatch'
    || errorCode === 'provider_readback_conflict'
  ) {
    return { ...common, category: 'provider_state_conflict', action: 'independent_reconciliation_required' };
  }
  if (errorCode === 'provider_readback_outage') {
    return { ...common, category: 'provider_outage', action: 'restore_readback_then_reconcile_same_receipt' };
  }
  return { ...common, category: 'manual_review', action: 'inspect_existing_attempt_without_resend' };
}

function projectProviderResourceLifecycleReadback(input: {
  request: any;
  receipt: any;
  providerModule: 'realms_provider_binding' | 'squads_provider_binding';
  resourceBinding: any;
  provider: {
    resourceRef: unknown;
    ownerProgramRef: unknown;
    observedSlot: unknown;
    lastTransactionSlot: unknown;
    stateDigest: unknown;
  };
  executionAuthorities: Array<Record<string, unknown>> | null;
  transactions: Array<any>;
}): Record<string, unknown> | null {
  const { request, receipt, resourceBinding, provider } = input;
  const authorities = Array.isArray(input.executionAuthorities)
    ? input.executionAuthorities
    : [];
  const transactions = Array.isArray(input.transactions) ? input.transactions : [];
  const observedSlot = Number(provider.observedSlot);
  const lastTransactionSlot = provider.lastTransactionSlot === null
    ? null
    : Number(provider.lastTransactionSlot);
  const authorityRoles = authorities.flatMap((authority) => (
    optionalString(authority.role)
      && optionalString(authority.custodyProvider)
      && optionalString(authority.custodyStatus)
      && optionalString(authority.status)
      && Array.isArray(authority.allowedOperations)
      && authority.allowedOperations.length > 0
      && Number.isSafeInteger(Number(authority.verifiedSlot))
      && Number(authority.verifiedSlot) > 0
      ? [{
          role: String(authority.role),
          custodyProvider: String(authority.custodyProvider),
          custodyStatus: String(authority.custodyStatus),
          status: String(authority.status),
          verifiedSlot: Number(authority.verifiedSlot),
        }]
      : []
  ));
  const finalizedTransactions = transactions.length > 0
    && transactions.every((transaction: any) => (
      optionalString(transaction?.stepId)
      && optionalString(transaction?.signature)
      && Number.isSafeInteger(Number(transaction?.slot))
      && Number(transaction.slot) > 0
      && Array.isArray(transaction?.finalityTransitions)
      && transaction.finalityTransitions.at(-1)?.state === 'finalized'
    ));
  if (
    !resourceBinding
    || resourceBinding.id !== request?.providerResourceBinding?.id
    || resourceBinding.sourceRequestId !== request?.id
    || resourceBinding.sourceDecisionDigest !== receipt?.decisionDigest
    || resourceBinding.status !== 'active'
    || resourceBinding.resourceRef !== provider.resourceRef
    || resourceBinding.ownerProgramRef !== provider.ownerProgramRef
    || !optionalString(resourceBinding.id)
    || !optionalString(provider.resourceRef)
    || !optionalString(provider.ownerProgramRef)
    || !Number.isSafeInteger(observedSlot)
    || observedSlot <= 0
    || (lastTransactionSlot !== null && (
      !Number.isSafeInteger(lastTransactionSlot)
      || lastTransactionSlot <= 0
      || observedSlot < lastTransactionSlot
    ))
    || !isSha256(provider.stateDigest)
    || receipt?.executionStatus !== 'executed'
    || receipt?.executorModule !== input.providerModule
    || receipt?.decisionDigest !== request?.decision?.decisionDigest
    || !isSha256(receipt?.executionEvidenceDigest)
    || authorityRoles.length === 0
    || authorityRoles.length !== authorities.length
    || authorityRoles.some((authority) => (
      authority.custodyProvider !== 'openbao_transit'
      || authority.custodyStatus !== 'verified'
      || authority.status !== 'active'
    ))
    || !finalizedTransactions
  ) return null;
  const bindingVerification = isRecord(resourceBinding.verification)
    ? resourceBinding.verification
    : {};
  const resourceReadback = optionalString(bindingVerification.resourceReadback)
    ?? optionalString(bindingVerification.accountGraph?.status)
    ?? optionalString(bindingVerification.accountGraph?.accountGraph?.status)
    ?? optionalString(bindingVerification.providerReceipt?.providerFinality);
  return {
    schemaVersion: 1,
    authority: 'provider_receipt_resource_binding_authority_binding_and_independent_readback',
    state: 'available',
    providerModule: input.providerModule,
    resourceBindingId: String(resourceBinding.id),
    resourceRef: String(provider.resourceRef),
    ownerProgramRef: String(provider.ownerProgramRef),
    sourceRequestId: String(request.id),
    sourceDecisionDigest: String(receipt.decisionDigest),
    observedSlot,
    lastTransactionSlot,
    stateDigest: String(provider.stateDigest),
    phases: [
      {
        phase: 'created',
        authority: 'GovernedResourceBinding',
        evidenceRef: String(resourceBinding.id),
      },
      {
        phase: 'bootstrap_verified',
        authority: 'provider_receipt_and_finalized_transaction_readback',
        evidenceRef: String(receipt.executionEvidenceDigest),
      },
      {
        phase: 'authority_transferred',
        authority: 'ResourceAuthorityBinding',
        evidenceRef: authorityRoles.map((authority) => authority.role).sort().join(','),
      },
      {
        phase: 'old_authority_revoked',
        authority: 'openbao_transit_custody_readback',
        evidenceRef: 'no_temporary_wallet_or_service_key_authority_retained',
      },
      {
        phase: 'readback_verified',
        authority: 'independent_provider_readback',
        evidenceRef: resourceReadback ?? 'verified_finalized',
      },
      {
        phase: 'available',
        authority: 'GovernedResourceBinding',
        evidenceRef: String(resourceBinding.status),
      },
    ],
    permissionResidue: {
      fallbackAuthority: 'none',
      temporaryWalletAuthority: 'revoked_or_not_retained',
      serviceKeyAuthority: 'not_retained',
      signerKeyExposure: 'none_public_authority_only',
      authorityRoles,
    },
  };
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function projectAggregateGovernanceTally(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  return compactObject({
    schemaVersion: value.schemaVersion,
    strategy: value.strategy,
    eligible: value.eligible,
    approvalThreshold: value.approvalThreshold,
    rejectionThreshold: value.rejectionThreshold,
    approved: value.approved,
    rejected: value.rejected,
    quorum: isRecord(value.quorum) ? value.quorum : null,
    ignoredSignalCount: value.ignoredSignalCount,
    voteReplacement: isRecord(value.voteReplacement) ? value.voteReplacement : null,
    mechanism: isRecord(value.mechanism)
      ? compactObject({
          kind: optionalString(value.mechanism.kind),
          contractDigest: optionalString(value.mechanism.contractDigest),
          resultDigest: optionalString(value.mechanism.resultDigest),
          evaluatorState: optionalString(value.mechanism.evaluatorState),
        })
      : null,
  });
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export type GovernanceMandateHealthStatus =
  | 'active'
  | 'pending'
  | 'suspended'
  | 'inactive'
  | 'unavailable';

export interface GovernanceMandateHealthProjection {
  status: GovernanceMandateHealthStatus;
  reason:
    | 'within_effective_window'
    | 'acceptance_pending'
    | 'authority_binding_not_active'
    | 'effective_window_not_started'
    | 'effective_window_ended'
    | 'mandate_terminal'
    | 'mandate_owner_facts_unavailable';
  lifecycleStatus: string | null;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  observedAt: string;
}

export function projectGovernanceMandateHealth(
  binding: any,
  mandateVersion: any,
  now: Date,
): GovernanceMandateHealthProjection {
  const observedAt = now.toISOString();
  const lifecycleStatus = optionalString(binding?.mandate?.status);
  const effectiveFrom = dateTime(mandateVersion?.effectiveFrom);
  const effectiveUntil = dateTime(mandateVersion?.effectiveUntil);
  const unavailable = (): GovernanceMandateHealthProjection => ({
    status: 'unavailable',
    reason: 'mandate_owner_facts_unavailable',
    lifecycleStatus,
    effectiveFrom,
    effectiveUntil,
    observedAt,
  });
  if (!lifecycleStatus || !effectiveFrom || !effectiveUntil) return unavailable();
  const from = new Date(effectiveFrom).getTime();
  const until = new Date(effectiveUntil).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(until) || from >= until) return unavailable();
  if (lifecycleStatus === 'offered' || lifecycleStatus === 'countered') {
    return {
      status: 'pending',
      reason: 'acceptance_pending',
      lifecycleStatus,
      effectiveFrom,
      effectiveUntil,
      observedAt,
    };
  }
  if (['rejected', 'expired', 'deactivated'].includes(lifecycleStatus)) {
    return {
      status: 'inactive',
      reason: 'mandate_terminal',
      lifecycleStatus,
      effectiveFrom,
      effectiveUntil,
      observedAt,
    };
  }
  if (lifecycleStatus !== 'active') return unavailable();
  if (
    binding?.status !== 'active'
    || binding?.targetAuthorizationStatus !== 'accepted'
    || binding?.committeeMandateStatus !== 'accepted'
  ) {
    return {
      status: 'suspended',
      reason: 'authority_binding_not_active',
      lifecycleStatus,
      effectiveFrom,
      effectiveUntil,
      observedAt,
    };
  }
  if (now.getTime() < from) {
    return {
      status: 'suspended',
      reason: 'effective_window_not_started',
      lifecycleStatus,
      effectiveFrom,
      effectiveUntil,
      observedAt,
    };
  }
  if (now.getTime() >= until) {
    return {
      status: 'suspended',
      reason: 'effective_window_ended',
      lifecycleStatus,
      effectiveFrom,
      effectiveUntil,
      observedAt,
    };
  }
  return {
    status: 'active',
    reason: 'within_effective_window',
    lifecycleStatus,
    effectiveFrom,
    effectiveUntil,
    observedAt,
  };
}

export function projectGovernanceBinding(
  binding: any,
  projection: GovernanceReadProjectionReason,
  input: {
    eligibleActorCount?: number | null;
    operationReceipt?: {
      id: string;
      actorPubkey: string;
      executionAdapter: string;
      executionStatus: string;
    } | null;
    now?: Date;
  } = {},
): Record<string, unknown> {
  const mandateVersion = Array.isArray(binding?.mandate?.versions)
    ? binding.mandate.versions.find(
      (version: any) => version?.version === binding.mandate.currentVersion,
    ) ?? null
    : null;
  const mandateTerms = objectRecord(mandateVersion?.terms) ?? {};
  const common = {
    id: requiredString(binding?.id),
    bindingType: requiredString(binding?.bindingType),
    targetCircleId: positiveInteger(binding?.targetCircleId),
    actionType: optionalString(binding?.actionType),
    actionPrefix: optionalString(binding?.actionPrefix),
    committeeCircleId: positiveInteger(binding?.committeeCircleId),
    policyVersion: Number.isInteger(Number(binding?.policyVersion))
      ? Number(binding.policyVersion)
      : null,
    executionMode: optionalString(binding?.executionMode) ?? "off_chain",
    status: requiredString(binding?.status),
    targetAuthorizationStatus: requiredString(binding?.targetAuthorizationStatus),
    committeeMandateStatus: requiredString(binding?.committeeMandateStatus),
    mandateId: optionalString(binding?.mandateId),
    mandate: binding?.mandate ? compactObject({
      id: optionalString(binding.mandate.id),
      delegatorGovernanceHome: objectRecord(mandateTerms.delegatorGovernanceHome) ?? {},
      delegateAuthority: objectRecord(mandateTerms.delegateAuthority) ?? {},
      subject: objectRecord(mandateTerms.subject) ?? {},
      feePolicy: objectRecord(mandateTerms.feePolicy) ?? {},
      effectPolicy: objectRecord(mandateTerms.effectPolicy),
      status: optionalString(binding.mandate.status),
      currentVersion: Number.isInteger(Number(binding.mandate.currentVersion))
        ? Number(binding.mandate.currentVersion)
        : null,
      currentTermsDigest: optionalString(binding.mandate.currentTermsDigest),
      targetAuthorizationStatus: optionalString(binding.mandate.targetAuthorizationStatus),
      committeeAcceptanceStatus: optionalString(binding.mandate.committeeAcceptanceStatus),
      acceptanceExpiresAt: dateTime(binding.mandate.acceptanceExpiresAt),
      purposeBindings: Array.isArray(mandateVersion?.purposeBindings)
        ? mandateVersion.purposeBindings.map((item: any) => compactObject({
          purpose: optionalString(item?.purpose),
          actionType: optionalString(item?.actionSelector?.actionType ?? item?.actionType),
          actionPrefix: optionalString(item?.actionSelector?.actionPrefix ?? item?.actionPrefix),
        }))
        : [],
      purposes: Array.isArray(mandateVersion?.purposeBindings)
        ? mandateVersion.purposeBindings.map((item: any) => optionalString(item?.purpose)).filter(Boolean)
        : [],
      environment: optionalString(mandateVersion?.environment),
      network: optionalString(mandateVersion?.network),
      effectiveFrom: dateTime(mandateVersion?.effectiveFrom),
      effectiveUntil: dateTime(mandateVersion?.effectiveUntil),
      health: projectGovernanceMandateHealth(
        binding,
        mandateVersion,
        input.now ?? new Date(),
      ),
    }) : null,
    activatedAt: dateTime(binding?.activatedAt),
    supersededAt: dateTime(binding?.supersededAt),
    eligibleActorCount: input.eligibleActorCount ?? null,
    authorityTransparency: projectBindingAuthorityTransparency(
      binding,
      mandateVersion,
      projection,
      input.eligibleActorCount ?? null,
      input.operationReceipt ?? null,
    ),
  };
  if (projection.audience === "public") {
    return compactObject(common);
  }
  const member = {
    ...common,
    policyId: optionalString(binding?.policyId),
    policyVersionId: optionalString(binding?.policyVersionId),
    ruleId: optionalString(binding?.ruleId),
    committeeMandateRequestId: optionalString(binding?.committeeMandateRequestId),
  };
  if (projection.audience === "member") {
    return compactObject(member);
  }
  return compactObject({
    ...member,
    createdByPubkey: optionalString(binding?.createdByPubkey),
    sourceRequestId: optionalString(binding?.sourceRequestId),
    sourceDecisionDigest: optionalString(binding?.sourceDecisionDigest),
    sourceExecutionReceiptId: optionalString(binding?.sourceExecutionReceiptId),
    metadata: objectRecord(binding?.metadata),
  });
}

function projectBindingAuthorityTransparency(
  binding: any,
  mandateVersion: any,
  projection: GovernanceReadProjectionReason,
  eligibleActorCount: number | null,
  operationReceipt: {
    id: string;
    actorPubkey: string;
    executionAdapter: string;
    executionStatus: string;
  } | null,
): Record<string, unknown> {
  const bindingType = requiredString(binding?.bindingType);
  const authorityMode = bindingType === 'local_auxiliary'
    ? 'delegated_auxiliary'
    : bindingType === 'shared_committee'
      ? 'delegated_committee'
      : bindingType === 'self_governed'
        ? 'self_governed'
        : 'unavailable';
  const purposeBindings = Array.isArray(mandateVersion?.purposeBindings)
    ? mandateVersion.purposeBindings
    : [];
  const purposes = purposeBindings
    .map((item: any) => optionalString(item?.purpose))
    .filter(Boolean);
  const operationalBinding = purposeBindings.find(
    (item: any) => item?.purpose === 'operational_execution',
  );
  const operational = Boolean(operationalBinding);
  const collective = purposes.includes('collective_decision');
  const operatorPolicy = operationalBinding?.operatorPolicy ?? null;
  const mandateTerms = objectRecord(mandateVersion?.terms) ?? {};
  const delegator = objectRecord(mandateTerms.delegatorGovernanceHome) ?? {};
  const delegate = objectRecord(mandateTerms.delegateAuthority) ?? {};
  const subject = objectRecord(mandateTerms.subject) ?? {};
  const hasMandate = bindingType === 'shared_committee' && Boolean(binding?.mandateId);
  const mandateIdentityMismatch = hasMandate && (
    delegator.type !== 'circle'
    || delegator.ref !== String(binding?.targetCircleId ?? '')
    || delegate.type !== 'circle_governance_committee'
    || delegate.ref !== String(binding?.committeeCircleId ?? '')
    || !requiredString(subject.type)
    || !requiredString(subject.ref)
  );
  const operationPurposeMismatch = Boolean(operationReceipt) && !operational;
  const integrityInvalid = operationPurposeMismatch || mandateIdentityMismatch;
  const decisionAuthority = !collective
    ? { type: 'not_applicable', reason: 'operational_execution' }
    : {
        type: authorityMode === 'self_governed'
          ? 'self_governed_electorate'
          : 'delegated_committee_electorate',
        home: { type: 'circle', ref: String(binding?.committeeCircleId ?? '') },
        electorate: 'frozen_request_snapshot',
        eligibleActorCount,
      };
  return compactObject({
    schemaVersion: 1,
    authorityMode,
    integrity: integrityInvalid ? 'invalid' : 'verified',
    availability: integrityInvalid
      ? 'invalid'
      : binding?.status === 'active'
      && binding?.targetAuthorizationStatus === 'accepted'
      && binding?.committeeMandateStatus === 'accepted'
      ? 'active'
      : 'not_active',
    delegator: hasMandate
      ? delegator
      : { type: 'circle', ref: String(binding?.targetCircleId ?? '') },
    delegate: hasMandate
      ? delegate
      : { type: 'circle', ref: String(binding?.committeeCircleId ?? '') },
    subject: hasMandate
      ? subject
      : { type: 'circle', ref: String(binding?.targetCircleId ?? '') },
    scope: {
      actionType: optionalString(binding?.actionType),
      actionPrefix: optionalString(binding?.actionPrefix),
    },
    mandate: {
      purposes,
      version: Number.isInteger(Number(binding?.mandate?.currentVersion))
        ? Number(binding.mandate.currentVersion)
        : null,
    },
    decisionAuthority,
    operatorAuthority: operationPurposeMismatch
      ? {
          type: 'unavailable',
          reason: 'operational_receipt_without_operational_mandate',
        }
      : operational
      ? {
          type: 'mandate_operator',
          actor: 'resolved_per_invocation',
          proof: 'invocation_authority_snapshot',
          selectorMode: optionalString(operatorPolicy?.selector?.mode),
          roles: stringArray(operatorPolicy?.selector?.roles),
          frozenActorCount: Array.isArray(operatorPolicy?.selector?.frozenActors)
            ? operatorPolicy.selector.frozenActors.length
            : null,
          maximumActors: Number.isSafeInteger(Number(operatorPolicy?.selector?.maximumActors))
            ? Number(operatorPolicy.selector.maximumActors)
            : null,
          operatorSetDigest: optionalString(operatorPolicy?.selector?.actorSetDigest),
          limits: objectRecord(operatorPolicy?.limits),
          reauthorization: objectRecord(operatorPolicy?.reauthorization),
        }
      : { type: 'not_applicable', reason: purposes.join('+') || 'purpose_unavailable' },
    executionAuthority: {
      type: 'action_contract',
      adapter: operationReceipt?.executionAdapter
        ?? optionalString(operatorPolicy?.executionAuthorityRequirement?.adapter)
        ?? 'resolved_per_action_invocation',
      executor: operationReceipt ? 'operation_receipt' : 'resolved_at_execution',
      executionMode: optionalString(binding?.executionMode) ?? 'off_chain',
    },
    stageProvider: {
      authority: 'separate',
      status: 'not_projected_in_binding',
    },
    receipt: {
      status: operationReceipt ? 'recorded' : 'not_recorded',
      integrity: operationPurposeMismatch ? 'purpose_mismatch' : 'verified',
      executionStatus: operationReceipt?.executionStatus ?? null,
      ref: projection.audience === 'operator' ? operationReceipt?.id ?? null : null,
      actor: projection.audience === 'operator'
        ? operationReceipt?.actorPubkey ?? null
        : operationReceipt
          ? 'recorded_redacted'
          : null,
    },
  });
}

export function projectGovernanceCommitteeProfile(
  profile: any,
  projection: GovernanceReadProjectionReason,
): Record<string, unknown> {
  const common = {
    circleId: positiveInteger(profile?.circleId),
    availabilityStatus: requiredString(profile?.availabilityStatus),
    defaultStrategy: requiredString(profile?.defaultStrategy),
    electorateTemplate: objectRecord(profile?.electorateTemplate),
    availabilityExpiresAt: dateTime(profile?.availabilityExpiresAt),
  };
  if (projection.audience === "public") {
    return compactObject(common);
  }
  const member = {
    ...common,
    allowedActionPrefixes: stringArray(profile?.allowedActionPrefixes),
    windowMinutes: Number.isInteger(Number(profile?.windowMinutes))
      ? Number(profile.windowMinutes)
      : null,
    availabilityOpenedAt: dateTime(profile?.availabilityOpenedAt),
    activatedAt: dateTime(profile?.activatedAt),
    deactivatedAt: dateTime(profile?.deactivatedAt),
  };
  if (projection.audience === "member") {
    return compactObject(member);
  }
  return compactObject({
    ...member,
    updatedByPubkey: optionalString(profile?.updatedByPubkey),
    lastMandateRequestId: optionalString(profile?.lastMandateRequestId),
    lastMandateRequestAt: dateTime(profile?.lastMandateRequestAt),
  });
}

function governanceRequestTargetCircleId(request: any): number | null {
  if (request?.targetType === "circle") {
    return positiveInteger(request.targetRef);
  }
  if (request?.scopeType === "circle") {
    return positiveInteger(request.scopeRef);
  }
  return null;
}

function projectProviderExecutionAuthorities(
  request: any,
  expected: {
    chainId: string;
    profileRef: string;
    profileVersion: number;
    resourceRef: string;
    ownerProgramRef: string;
  },
): Array<Record<string, unknown>> | null {
  const resource = request?.providerResourceBinding;
  const bindings = Array.isArray(resource?.authorityBindings)
    ? resource.authorityBindings.filter((binding: any) => binding?.authorityRole !== 'fee_payer')
    : [];
  if (bindings.length === 0) return null;
  const projected = bindings.map((binding: any) => {
    const allowedOperations = stringArray(binding?.allowedOperations);
    const verifiedSlot = Number(binding?.verifiedSlot);
    const exact = (
      binding?.governedResourceBindingId === resource.id
      && binding?.network === expected.chainId
      && binding?.profileRef === expected.profileRef
      && Number(binding?.profileVersion) === Number(expected.profileVersion)
      && binding?.ownerProgramRef === expected.ownerProgramRef
      && (binding?.providerResourceRef === null
        || binding?.providerResourceRef === expected.resourceRef)
      && optionalString(binding?.authorityRole) !== null
      && optionalString(binding?.custodyProvider) !== null
      && optionalString(binding?.custodyStatus) !== null
      && optionalString(binding?.status) !== null
      && allowedOperations !== null
      && allowedOperations.length > 0
      && Number.isSafeInteger(verifiedSlot)
      && verifiedSlot > 0
    );
    if (!exact) return null;
    return {
      role: String(binding.authorityRole),
      publicAuthority: optionalString(binding.currentAuthority),
      custodyProvider: String(binding.custodyProvider),
      custodyStatus: String(binding.custodyStatus),
      allowedOperations,
      verifiedSlot,
      status: String(binding.status),
      sourceRequestId: optionalString(binding.sourceRequestId),
      sourceDecisionDigest: isSha256(binding.sourceDecisionDigest)
        ? binding.sourceDecisionDigest
        : null,
    };
  });
  return projected.every((binding: unknown) => binding !== null)
    ? projected as Array<Record<string, unknown>>
    : null;
}

function projectProviderMandateCostPolicy(request: any): Record<string, unknown> | null {
  const actionAuthority = objectRecord(request?.governanceCase?.templateSelection?.actionAuthority);
  const policy = objectRecord(actionAuthority?.mandateCostPolicy);
  if (
    actionAuthority?.sourceType !== 'governance_mandate'
    || !policy
    || policy.schemaVersion !== 1
    || policy.authority !== 'frozen_governance_mandate_version_fee_policy'
    || policy.policySource !== 'GovernanceMandateVersion.terms.feePolicy'
    || policy.mandateId !== actionAuthority.mandateId
    || Number(policy.mandateVersion) !== Number(actionAuthority.mandateVersion)
    || policy.mandateTermsDigest !== actionAuthority.mandateTermsDigest
    || policy.payerAuthority !== 'separate_from_governance_authority'
    || policy.payerAuthoritySeparatedFromDecisionAuthority !== true
    || policy.silentTransferToVoterOperatorExecutorAllowed !== false
    || policy.executionCostBearer !== 'same_as_mandate_fee_policy'
  ) return null;
  const expectedCostClasses = ['decision', 'review', 'operational', 'appeal', 'execution'];
  const classes = Array.isArray(policy.costClasses) ? policy.costClasses : [];
  const projectedClasses = classes.flatMap((candidate: unknown) => {
    const item = objectRecord(candidate);
    if (
      !item
      || !expectedCostClasses.includes(String(item.costClass))
      || (item.mode !== 'no_fee' && item.mode !== 'capped_external_quote')
      || !['delegator', 'delegate', 'shared'].includes(String(item.economicBearer))
      || (item.maximumAmountMinor !== null && !optionalString(item.maximumAmountMinor))
      || (item.unit !== null && !optionalString(item.unit))
    ) return [];
    return [{
      costClass: String(item.costClass),
      mode: item.mode,
      economicBearer: item.economicBearer,
      maximumAmountMinor: item.maximumAmountMinor === null
        ? null
        : String(item.maximumAmountMinor),
      unit: item.unit === null ? null : String(item.unit),
    }];
  });
  const specialBudget = objectRecord(policy.specialBudget);
  if (
    projectedClasses.length !== expectedCostClasses.length
    || expectedCostClasses.some((costClass) => (
      projectedClasses.filter((item) => item.costClass === costClass).length !== 1
    ))
    || specialBudget?.mode !== 'not_managed_by_mandate'
    || (specialBudget.maximumAmountMinor !== null
      && !optionalString(specialBudget.maximumAmountMinor))
    || (specialBudget.unit !== null && !optionalString(specialBudget.unit))
  ) return null;
  return {
    schemaVersion: 1,
    authority: 'frozen_governance_mandate_version_fee_policy',
    mandateId: String(policy.mandateId),
    mandateVersion: Number(policy.mandateVersion),
    mandateTermsDigest: String(policy.mandateTermsDigest),
    policySource: 'GovernanceMandateVersion.terms.feePolicy',
    costClasses: projectedClasses,
    specialBudget: {
      mode: 'not_managed_by_mandate',
      maximumAmountMinor: specialBudget.maximumAmountMinor === null
        ? null
        : String(specialBudget.maximumAmountMinor),
      unit: specialBudget.unit === null ? null : String(specialBudget.unit),
    },
    payerAuthority: 'separate_from_governance_authority',
    payerAuthoritySeparatedFromDecisionAuthority: true,
    silentTransferToVoterOperatorExecutorAllowed: false,
    executionCostBearer: 'same_as_mandate_fee_policy',
  };
}

function projectProviderFundingSourceFeePayerBoundary(
  request: any,
  authorityPaymentBoundary: Record<string, unknown> | null,
  fundingSource: {
    fundingSourceRole: 'governed_resource_account' | 'squads_vault';
    fundingSourceRef: unknown;
  },
): Record<string, unknown> | null {
  const preflight = Array.isArray(request?.invocation?.costPreflights)
    ? request.invocation.costPreflights[0]
    : null;
  const payer = preflight?.payerPolicy;
  const fundingSourceRef = optionalString(fundingSource.fundingSourceRef);
  const payerPolicyId = optionalString(authorityPaymentBoundary?.payerPolicyId);
  const feePayerSignerRef = optionalString(payer?.feePayerSignerRef);
  const relayerRef = optionalString(payer?.relayerRef);
  const reimbursementPolicy = objectRecord(payer?.reimbursementPolicy);
  const reimbursementPolicyRef = optionalString(reimbursementPolicy?.policyId)
    ?? optionalString(reimbursementPolicy?.id)
    ?? null;
  const approvedPaymentPath = relayerRef
    ? 'explicit_relayer_sponsor'
    : reimbursementPolicyRef
      ? 'governed_reimbursement_policy'
      : 'governance_approved_payer_policy';
  if (
    !authorityPaymentBoundary
    || !preflight
    || !payer
    || !fundingSourceRef
    || !payerPolicyId
    || !feePayerSignerRef
    || payer.id !== payerPolicyId
    || preflight.payerPolicyRef !== payerPolicyId
    || payer.sourceRequestId !== request?.id
    || payer.sourceDecisionDigest !== request?.decision?.decisionDigest
    || feePayerSignerRef === fundingSourceRef
    || authorityPaymentBoundary.feePayerRole !== 'fee_payer_only'
    || authorityPaymentBoundary.sponsorAuthorityGain !== 'none'
  ) return null;
  return {
    schemaVersion: 1,
    authority: 'canonical_payer_policy_resource_or_vault_separation',
    payerPolicyId,
    fundingSourceRole: fundingSource.fundingSourceRole,
    fundingSourceRef,
    feePayerRole: 'separated_fee_payer_policy',
    actualFeePayer: 'canonical_payer_policy_fee_payer_signer',
    feePayerSignerRefExposed: false,
    fundingSourceMaySignFees: false,
    approvedPaymentPath,
    sponsorRole: authorityPaymentBoundary.sponsorRole,
    reimbursementPolicy: reimbursementPolicyRef
      ? 'governed_reimbursement_policy_configured'
      : 'not_configured',
    reimbursementPolicyRef,
    executorCashFlowResponsibility: 'forbidden',
    silentExecutorCostTransferAllowed: false,
    economicBearer: authorityPaymentBoundary.economicBearer,
  };
}

function projectProviderAuthorityPaymentBoundary(
  request: any,
  expected: {
    chainId: string;
    profileRef: string;
    profileVersion: number;
    resourceRef: string;
    ownerProgramRef: string;
  },
  executionAuthorities: Array<Record<string, unknown>> | null,
): Record<string, unknown> | null {
  const resource = request?.providerResourceBinding;
  const bindings = Array.isArray(resource?.authorityBindings)
    ? resource.authorityBindings
    : [];
  const feePayerBindings = bindings.filter((binding: any) => binding?.authorityRole === 'fee_payer');
  const executionBindings = bindings.filter((binding: any) => binding?.authorityRole !== 'fee_payer');
  const preflight = Array.isArray(request?.invocation?.costPreflights)
    ? request.invocation.costPreflights[0]
    : null;
  const payer = preflight?.payerPolicy;
  const feePayer = feePayerBindings.length === 1 ? feePayerBindings[0] : null;
  const feePayerKeyRef = optionalString(feePayer?.keyRef);
  const feePayerPublicKey = optionalString(feePayer?.currentAuthority);
  const economicBearer = optionalString(payer?.economicBearer);
  if (
    !executionAuthorities
    || executionAuthorities.length === 0
    || !feePayer
    || !feePayerKeyRef
    || !feePayerPublicKey
    || !economicBearer
    || payer?.id !== preflight?.payerPolicyRef
    || payer?.sourceRequestId !== request?.id
    || payer?.sourceDecisionDigest !== request?.decision?.decisionDigest
    || payer?.feePayerSignerRef !== feePayerKeyRef
    || feePayer?.governedResourceBindingId !== resource?.id
    || feePayer?.network !== expected.chainId
    || feePayer?.profileRef !== expected.profileRef
    || Number(feePayer?.profileVersion) !== Number(expected.profileVersion)
    || feePayer?.ownerProgramRef !== expected.ownerProgramRef
    || (feePayer?.providerResourceRef !== null
      && feePayer?.providerResourceRef !== expected.resourceRef)
    || feePayer?.status !== 'active'
    || !optionalString(feePayer?.custodyProvider)
    || executionBindings.length !== executionAuthorities.length
    || executionBindings.some((binding: any) => (
      !optionalString(binding?.keyRef)
      || !optionalString(binding?.currentAuthority)
      || binding.keyRef === feePayerKeyRef
      || binding.currentAuthority === feePayerPublicKey
    ))
  ) return null;
  return {
    schemaVersion: 1,
    authority: 'canonical_resource_authority_and_payer_policy',
    payerPolicyId: payer.id,
    economicBearer,
    feePayerRole: 'fee_payer_only',
    sponsorRole: optionalString(payer.relayerRef)
      ? 'explicit_relayer_from_payer_policy'
      : 'not_configured',
    feePayerCustodyProvider: String(feePayer.custodyProvider),
    executionAuthorityRoles: executionAuthorities.map((authority) => String(authority.role)),
    executionCustodyProviders: [...new Set(executionAuthorities.map((authority) => (
      String(authority.custodyProvider)
    )))].sort(),
    separation: 'verified_distinct_public_keys_and_key_refs',
    sponsorAuthorityGain: 'none',
    privateKeyExposure: 'none_public_readback_only',
  };
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function governanceReadDenied(reason: string): AuthActorError {
  return new AuthActorError(
    403,
    "governance_read_audience_denied",
    "governance request is not visible to this audience",
    reason,
    false,
  );
}

function requiredString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function dateTime(value: unknown): string | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .map((item) => optionalString(item))
    .filter((item): item is string => item !== null);
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function compactObject(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}
