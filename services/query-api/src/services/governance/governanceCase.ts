import { createHash } from 'node:crypto';

import { hashCanonicalGovernanceValue } from './canonicalCodec';
import { assertGovernanceHomeAllowsNewIntake } from './governanceHomeLifecycleGate';
import {
  buildNativeGovernanceMechanismContract,
  evaluateFrozenNativeGovernanceMechanism,
  resolveFrozenNativeGovernanceMechanism,
  verifyFrozenNativeGovernanceMechanismResult,
  type NativeGovernanceMechanismContract,
} from './nativeGovernanceMechanism';
import { canonicalSolanaPublicKeyString } from '../identity/solanaPublicKey';
import type { GovernanceRequestRecord } from './policyEngine';
import { loadManualDiscussionDraftSourceMessages } from '../discussion/draftSourceConsumption';
import {
  assertGovernanceCaseTemplateProposer,
  governanceCaseTemplateSelectionDigest,
  isCurrentGovernanceCaseInstitutionalResponsibility,
  NATIVE_CASE_CONFLICT_OF_INTEREST_POLICY,
  selectGovernanceCaseTemplateForIntake,
  type GovernanceCaseAuthorityResolutionInput,
  type GovernanceCaseTemplateSelection,
  type GovernanceCaseType,
} from './governanceCaseTemplate';
import type { GovernanceCasePolicySimulation } from './governanceCaseDecisionStage';
import {
  GovernanceCaseWorkflowError,
  initialGovernanceCaseWorkflowData,
  governanceCaseActualOutcomeDigest,
  normalizeGovernanceCaseActualOutcome,
  type GovernanceCasePhase,
} from './governanceCaseWorkflow';
import {
  extractGovernanceBriefClaims,
  extractGovernanceBriefSectionBodies,
  resolveGovernanceBriefReadiness,
} from './governanceBrief';
import { projectGovernanceManualExecutionControlReadback } from './governanceCaseInbox';
import { projectDecisionOutputArtifact } from './decisionOutputArtifact';
import { projectGovernanceGrantAgreement } from './governanceGrantAgreement';
import type { DraftDiscussionTimelineEventRecord } from '../draftDiscussionLifecycle';
import {
  isCurrentGovernanceCaseFrozenEvidencePolicy,
  type GovernanceCaseFrozenEvidencePolicy,
} from './governanceEvidenceShare';
import { SOURCE_MATERIAL_GROUNDING_STATUSES } from '../sourceMaterials/lifecycle';
import { toGhostDraftResultView } from '../ghostDraft/readModel';
import { projectGovernanceCaseBlockers } from './governanceCaseBlocker';
import {
  EXTERNAL_APP_PRIMARY_CIRCLE_BIND_ACTION_TYPE,
  CIRCLE_POLICY_DOCUMENT_ADOPT_ACTION_TYPE,
  getGovernanceCaseActionDefinition,
  STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE,
} from './governanceCaseActionComposition';
import {
  assertOperationPayload,
  assertStatePrecondition,
} from './routeAProviderAdmissionCredential';
import {
  createExternalGovernedActionIntake,
  ExternalGovernedActionIntakeError,
  hasClientMachineFieldOverrides,
  mapIntakeErrorToIntakeError,
} from './externalGovernedActionIntake';
import { isExternalActionCandidatePickerEnabled, isExternalActionIntakeEnabled } from './externalGovernedActionFlags';
import type { StorageFabricProviderAdmissionCandidateClient } from './storageFabricProviderAdmissionCandidateClient';
import { ProviderAdmissionCandidateClientError } from './storageFabricProviderAdmissionCandidateClient';
import {
  assertExternalGovernedActionRecurrenceAvailable,
  bindExternalGovernedActionRecurrenceReservationCase,
  buildExternalGovernedActionIntentDigest,
  buildExternalGovernedActionRecurrenceKey,
  ExternalGovernedActionRecurrenceError,
  reserveExternalGovernedActionRecurrenceInTransaction,
  resolveExternalGovernedActionRecurrenceEpoch,
  type ExternalGovernedActionRecurrenceReservationInput,
} from './externalGovernedActionRecurrence';

export type GovernanceCaseOriginKind =
  | 'native_invocation'
  | 'legacy_request'
  | 'manual_item'
  | 'plaza_selection'
  | 'public_url'
  | 'external_proposal';

export type GovernanceCaseIntakeOriginKind = Exclude<GovernanceCaseOriginKind, 'legacy_request'>;

export type GovernanceCaseRelationshipKind = 'related' | 'supersedes';

export interface GovernanceCaseOriginSnapshot {
  schemaVersion: 1;
  kind: 'plaza_message_selection';
  circleId: number;
  sourceSetDigest: string;
  sources: Array<{
    type: 'discussion_message';
    ref: string;
    authorPubkey: string;
    payloadDigest: string;
    lamport: string;
    clientTimestamp: string;
    messageKind: string;
    authMode: string;
    signatureVerified: boolean;
  }>;
  visibility: {
    sourceOwner: 'circle_discussion';
    circleType: string;
    caseProjection: 'member_or_operator';
    contentAccess: 'not_granted_by_case';
    publicProjection: 'withheld';
  };
}

export type GovernanceCaseFieldGroup =
  | 'case_identity'
  | 'origin'
  | 'brief'
  | 'source_fact'
  | 'ai_suggestion'
  | 'review_opinion'
  | 'decision'
  | 'execution'
  | 'outcome'
  | 'authority'
  | 'artifact'
  | 'raw_ballot';

export interface GovernanceCaseFieldVisibilityDecision {
  fieldGroup: GovernanceCaseFieldGroup;
  decision: 'allow' | 'redact' | 'deny';
  reason: string;
}

export interface GovernanceCaseIntakeSuggestion {
  caseId: string;
  title: string;
  phase: GovernanceCasePhase;
  canonicalUrl: string;
  reasons: Array<'same_external_ref' | 'same_title' | 'similar_title' | 'active_same_subject'>;
  recommendedAction: 'merge' | GovernanceCaseRelationshipKind;
}

export interface GovernanceCaseRecord {
  id: string;
  homeIdentityBindingId: string | null;
  primaryRequestId: string | null;
  invocationId: string | null;
  originKind: GovernanceCaseOriginKind;
  originRef: string;
  subjectType: string;
  subjectRef: string;
  title: string;
  requestedDecision: string;
  requestedActionPayload: Record<string, unknown> | null;
  caseType: GovernanceCaseType;
  templateSelection: GovernanceCaseTemplateSelection;
  templateSelectionDigest: string;
  profileBindingId: string;
  actionContractVersionId: string | null;
  relationshipKind: GovernanceCaseRelationshipKind | null;
  relatedCaseId: string | null;
  relationshipReason: string | null;
  briefDraftPostId: number | null;
  briefDraftVersion: number | null;
  briefSnapshotDigest: string | null;
  briefBoundByPubkey: string | null;
  briefBoundAt: Date | null;
  decisionStagePlan?: Record<string, unknown> | null;
  decisionStagePlanDigest?: string | null;
  decisionOutcome?: string | null;
  casePhase: GovernanceCasePhase;
  caseVersion: number;
  idempotencyKey: string;
  openedByPubkey: string | null;
  sourceMessageIds: string[];
  originSnapshot: GovernanceCaseOriginSnapshot | null;
  originSnapshotDigest: string | null;
  sourceUrl: string | null;
  openedAt: Date;
}

export interface NativeGovernanceCaseTemplate {
  selection: GovernanceCaseTemplateSelection;
  digest: string;
  decisionStagePlan?: Record<string, unknown> | null;
  decisionStagePlanDigest?: string | null;
}

export class GovernanceCaseIntakeError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string) {
    super(code);
    this.name = 'GovernanceCaseIntakeError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function governanceCaseIdForRequest(requestId: string): string {
  return `governance_case:${requestId}`;
}

export function buildNativeGovernanceCaseForRequest(
  request: GovernanceRequestRecord,
  template: NativeGovernanceCaseTemplate,
): GovernanceCaseRecord | null {
  if (!request.homeIdentityBindingId || !request.invocationId) return null;
  return {
    id: governanceCaseIdForRequest(request.id),
    homeIdentityBindingId: request.homeIdentityBindingId,
    primaryRequestId: request.id,
    invocationId: request.invocationId,
    originKind: 'native_invocation',
    originRef: request.caseRef ?? request.invocationId,
    subjectType: request.targetType,
    subjectRef: request.targetRef,
    title: request.actionType,
    requestedDecision: requestedDecisionForAction(request),
    requestedActionPayload: request.payload ?? null,
    caseType: template.selection.caseType,
    templateSelection: template.selection,
    templateSelectionDigest: template.digest,
    profileBindingId: template.selection.profile.bindingId,
    actionContractVersionId: template.selection.actionContract?.contractVersionId ?? null,
    relationshipKind: null,
    relatedCaseId: null,
    relationshipReason: null,
    briefDraftPostId: null,
    briefDraftVersion: null,
    briefSnapshotDigest: null,
    briefBoundByPubkey: null,
    briefBoundAt: null,
    decisionStagePlan: template.decisionStagePlan ?? null,
    decisionStagePlanDigest: template.decisionStagePlanDigest ?? null,
    decisionOutcome: template.decisionStagePlan ? 'pending' : null,
    casePhase: 'decision_in_progress',
    caseVersion: 1,
    idempotencyKey: request.idempotencyKey,
    openedByPubkey: request.proposerPubkey,
    sourceMessageIds: [],
    originSnapshot: null,
    originSnapshotDigest: null,
    sourceUrl: null,
    openedAt: request.openedAt,
  };
}

export function buildNativeInvocationDecisionStagePlan(input: {
  requestId: string;
  stageRef: string;
  payloadDigest: string;
  frozenAt: Date;
  expiresAt: Date;
  evidencePolicy: GovernanceCaseFrozenEvidencePolicy;
  committeeCircleId: number;
  policyId: string;
  policyVersionId: string;
  policyVersion: number;
  ruleId: string;
  policyConfigDigest: string;
  policyRules: unknown;
  snapshotDigest: string;
  templateSelection: GovernanceCaseTemplateSelection;
}): { plan: Record<string, unknown>; digest: string } {
  const mechanism = input.templateSelection.decisionMechanism;
  if (
    !mechanism
    || (mechanism.kind !== 'equal_weight_threshold'
    && mechanism.kind !== 'quadratic_voice_credits'
    && mechanism.kind !== 'quadratic_funding')
  ) {
    throw new Error('governance_case_native_decision_mechanism_required');
  }
  const providerVersion = mechanism.kind === 'quadratic_voice_credits'
    ? `quadratic-voice-credits:${input.policyVersionId}`
    : mechanism.kind === 'quadratic_funding'
      ? `quadratic-funding:${input.policyVersionId}`
      : `committee-member-threshold:${input.policyVersionId}`;
  const plan = {
    schemaVersion: 1,
    resolutionRule: 'all_required',
    frozenAt: input.frozenAt.toISOString(),
    brief: null,
    decisionInput: {
      kind: 'native_invocation_action',
      payloadDigest: input.payloadDigest,
    },
    evidencePolicy: input.evidencePolicy,
    conflictOfInterest: {
      policy: { ...NATIVE_CASE_CONFLICT_OF_INTEREST_POLICY },
      disclosures: [],
    },
    stages: [{
      stageRef: input.stageRef,
      order: 1,
      purpose: 'approval',
      institutionalAuthority: {
        type: 'circle_governance_committee',
        ref: String(input.committeeCircleId),
        version: `${input.policyVersionId}:${input.ruleId}`,
      },
      provider: { type: 'alcheme_internal', version: providerVersion },
      mechanism: buildNativeGovernanceMechanismContract({
        requestId: input.requestId,
        policyId: input.policyId,
        policyVersionId: input.policyVersionId,
        policyVersion: input.policyVersion,
        ruleId: input.ruleId,
        policyConfigDigest: input.policyConfigDigest,
        policyRules: input.policyRules,
        snapshotDigest: input.snapshotDigest,
        expiresAt: input.expiresAt,
        mechanism,
      }),
      requiredForApproval: true,
      vetoOnReject: true,
      startCondition: 'native_invocation_frozen',
      expiresAt: input.expiresAt.toISOString(),
      onExpire: 'reject_case',
      onUnavailable: 'block_case',
      shortCircuitRule: 'required_rejection_terminates',
      decisionRef: { type: 'governance_request', ref: input.requestId },
    }],
  };
  return {
    plan,
    digest: hashCanonicalGovernanceValue(
      'alcheme.governance.case-decision-stage-plan',
      plan,
    ),
  };
}

export async function createGovernanceCaseIntake(
  prisma: any,
  input: {
    circleId: number;
    title: string;
    requestedDecision: string;
    requestedActionPayload?: Record<string, unknown> | null;
    statePrecondition?: Record<string, unknown> | null;
    candidateRef?: string | null;
    expectedSnapshotVersion?: string | null;
    expectedSnapshotDigest?: string | null;
    rationale?: string | null;
    caseType: GovernanceCaseType;
    templateId: string;
    actionType?: string | null;
    subjectType?:
      | 'circle'
      | 'circle_governance_binding'
      | 'communication_room_member'
      | 'feed_post'
      | 'governed_operator_capability'
      | 'external_provider'
      | 'external_app_circle_binding';
    subjectRef?: string | null;
    authorityBindingId?: string | null;
    authorityResolution?: GovernanceCaseAuthorityResolutionInput;
    decisionMechanismKind?: 'equal_weight_threshold' | 'quadratic_voice_credits' | 'quadratic_funding' | null;
    quadraticVoiceChoices?: unknown;
    quadraticFundingRound?: unknown;
    selectionRanking?: unknown;
    originKind: GovernanceCaseIntakeOriginKind;
    sourceInvocationId?: string | null;
    sourceReceiptId?: string | null;
    sourceMessageIds?: string[] | null;
    sourceUrl?: string | null;
    idempotencyKey: string;
    openedByPubkey: string;
    actorRole: string;
    relationshipKind?: GovernanceCaseRelationshipKind | null;
    relatedCaseId?: string | null;
    relationshipReason?: string | null;
    openedAt?: Date;
    candidateClient?: StorageFabricProviderAdmissionCandidateClient | null;
    afterPersist?: (tx: any, governanceCase: any) => Promise<void>;
    recurrenceReservation?: ExternalGovernedActionRecurrenceReservationInput | null;
  },
): Promise<{ governanceCase: any; replayed: boolean }> {
  if (!Number.isSafeInteger(input.circleId) || input.circleId <= 0) {
    throw new GovernanceCaseIntakeError(400, 'invalid_circle_id');
  }
  const title = requiredText(input.title, 3, 160, 'governance_case_title_required');
  let requestedDecision = requiredText(
    input.requestedDecision,
    10,
    2000,
    'governance_case_requested_decision_required',
  );
  const templateId = requiredText(
    input.templateId,
    3,
    96,
    'governance_case_template_required',
  );
  const actionType = typeof input.actionType === 'string' && input.actionType.trim()
    ? input.actionType.trim()
    : null;
  let subjectType = input.subjectType ?? 'circle';
  let subjectRefRaw = typeof input.subjectRef === 'string' ? input.subjectRef.trim() : '';
  let subjectRef = subjectRefRaw || (subjectType === 'circle' ? String(input.circleId) : '');
  let requestedActionPayload = input.requestedActionPayload ?? null;
  if (actionType === CIRCLE_POLICY_DOCUMENT_ADOPT_ACTION_TYPE && (
    requestedActionPayload != null || input.statePrecondition != null
  )) {
    // The only adopted content is the later, server-bound Brief snapshot.
    // Never let this record-only action smuggle a different machine effect.
    throw new GovernanceCaseIntakeError(400, 'governance_case_document_adoption_invalid');
  }
  let idempotencyKeyInput = input.idempotencyKey;
  const openedAt = input.openedAt ?? new Date();
  let recurrenceReservation: ExternalGovernedActionRecurrenceReservationInput | null =
    input.recurrenceReservation ?? null;
  if (actionType === STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE) {
    if (!isExternalActionCandidatePickerEnabled()) {
      throw new GovernanceCaseIntakeError(404, 'provider_admission_candidate_picker_disabled');
    }
    if (hasClientMachineFieldOverrides(
      input.requestedActionPayload,
      input.statePrecondition,
    )) {
      throw new GovernanceCaseIntakeError(
        400,
        'provider_admission_machine_field_override_rejected',
      );
    }
    const candidateRef = String(input.candidateRef || '').trim();
    const expectedSnapshotVersion = String(input.expectedSnapshotVersion || '').trim();
    const expectedSnapshotDigest = String(input.expectedSnapshotDigest || '').trim();
    if (!candidateRef || !expectedSnapshotVersion || !expectedSnapshotDigest) {
      throw new GovernanceCaseIntakeError(400, 'provider_admission_candidate_ref_required');
    }
    let resolved: {
      subjectType: 'external_provider';
      subjectRef: string;
      requestedActionPayload: Record<string, unknown>;
      statePrecondition: Record<string, unknown>;
      requestedDecision: string;
      candidateProvenance: Record<string, unknown>;
    };
    let recurrenceKey = '';
    try {
      const intake = createExternalGovernedActionIntake({
        candidateClient: input.candidateClient ?? null,
      });
      const prepared = await intake.prepareIntent({
        confirmingActorSession: {
          actorPubkey: input.openedByPubkey,
          actorRole: input.actorRole,
        },
        verifiedProducerContext: {
          kind: 'native_user',
          actorPubkey: input.openedByPubkey,
          actorRole: input.actorRole,
        },
        circleId: input.circleId,
        actionType: STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE,
        candidateRef,
        expectedSnapshotVersion,
        expectedSnapshotDigest,
        rationale: input.rationale || requestedDecision,
      });
      const confirmed = await intake.confirmAndOpenCase({
        confirmingActorSession: {
          actorPubkey: input.openedByPubkey,
          actorRole: input.actorRole,
        },
        verifiedProducerContext: {
          kind: 'native_user',
          actorPubkey: input.openedByPubkey,
          actorRole: input.actorRole,
        },
        preparation: prepared,
        confirmedPreviewDigest: prepared.preparationDigest,
        idempotencyKey: 'pending-recurrence',
        openCase: async (facts) => ({
          caseId: 'pending-create',
          replayed: false,
          facts,
        }),
      });
      const facts = (confirmed as any).facts;
      assertProviderAdmissionCandidateNotExpired(
        facts.candidateProvenance?.expiresAt,
        openedAt,
      );
      resolved = {
        subjectType: 'external_provider',
        subjectRef: facts.subjectRef,
        requestedActionPayload: facts.requestedActionPayload,
        statePrecondition: facts.statePrecondition ?? {},
        requestedDecision: facts.requestedDecision,
        candidateProvenance: facts.candidateProvenance,
      };
      const rationaleText = String(input.rationale || resolved.requestedDecision || '').trim();
      const intentDigest = buildExternalGovernedActionIntentDigest({
        expectedSnapshotVersion: String(
          facts.candidateProvenance?.snapshotVersion || expectedSnapshotVersion,
        ),
        expectedSnapshotDigest: String(
          facts.candidateProvenance?.snapshotDigest || expectedSnapshotDigest,
        ),
        requestedActionPayload: resolved.requestedActionPayload,
        statePrecondition: resolved.statePrecondition,
        rationaleDigest: createHash('sha256').update(rationaleText, 'utf8').digest('hex'),
      });
      const recurrenceEpoch = await resolveExternalGovernedActionRecurrenceEpoch(prisma, {
        circleId: input.circleId,
        actionType: STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE,
        subjectType: 'external_provider',
        subjectRef: resolved.subjectRef,
      });
      recurrenceKey = buildExternalGovernedActionRecurrenceKey({
        circleId: input.circleId,
        actionType: STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE,
        candidateRef,
        recurrenceEpoch,
      });
      resolved.candidateProvenance = {
        ...resolved.candidateProvenance,
        recurrenceEpoch,
        intentDigest,
      };
      recurrenceReservation = {
        actionType: STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE,
        subjectType: 'external_provider',
        subjectRef: resolved.subjectRef,
        recurrenceEpoch,
        intentDigest,
      };
      await assertExternalGovernedActionRecurrenceAvailable(prisma, {
        circleId: input.circleId,
        actionType: STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE,
        subjectType: 'external_provider',
        subjectRef: resolved.subjectRef,
        recurrenceKey,
        intentDigest,
        recurrenceEpoch,
      });
    } catch (error) {
      if (error instanceof ExternalGovernedActionRecurrenceError) {
        throw new GovernanceCaseIntakeError(
          error.statusCode,
          error.existingCaseId
            ? `${error.code}:${error.existingCaseId}`
            : error.code,
        );
      }
      const mapped = mapIntakeErrorToIntakeError(error);
      if (mapped) {
        throw new GovernanceCaseIntakeError(mapped.statusCode, mapped.code);
      }
      if (error instanceof ProviderAdmissionCandidateClientError) {
        throw new GovernanceCaseIntakeError(error.statusCode, error.code);
      }
      if (error instanceof ExternalGovernedActionIntakeError) {
        throw new GovernanceCaseIntakeError(error.statusCode, error.code);
      }
      throw error;
    }
    idempotencyKeyInput = recurrenceKey;
    subjectType = resolved.subjectType;
    subjectRef = resolved.subjectRef;
    subjectRefRaw = resolved.subjectRef;
    requestedDecision = resolved.requestedDecision;
    const operationPayload = asIntakeRecord(resolved.requestedActionPayload);
    const statePrecondition = asIntakeRecord(resolved.statePrecondition);
    if (!operationPayload || !statePrecondition) {
      throw new GovernanceCaseIntakeError(
        400,
        'route_a_provider_admission_operation_payload_invalid',
      );
    }
    try {
      assertOperationPayload(operationPayload, subjectRef);
      assertStatePrecondition(statePrecondition, operationPayload.providerId);
    } catch (error) {
      if (error instanceof GovernanceCaseWorkflowError) {
        throw new GovernanceCaseIntakeError(error.statusCode, error.code);
      }
      throw error;
    }
    requestedActionPayload = {
      operationPayload,
      statePrecondition,
      candidateProvenance: resolved.candidateProvenance,
    };
  }
  if (actionType === EXTERNAL_APP_PRIMARY_CIRCLE_BIND_ACTION_TYPE) {
    if (!isExternalActionIntakeEnabled()) {
      throw new GovernanceCaseIntakeError(404, 'external_action_intake_disabled');
    }
    if (subjectType !== 'external_app_circle_binding' || !subjectRef) {
      throw new GovernanceCaseIntakeError(400, 'governance_case_subject_invalid');
    }
    const bindPayload = asIntakeRecord(
      requestedActionPayload && typeof requestedActionPayload === 'object'
        ? (requestedActionPayload as any).operationPayload
        : null,
    ) ?? asIntakeRecord(requestedActionPayload);
    if (!bindPayload) {
      throw new GovernanceCaseIntakeError(400, 'governance_case_subject_invalid');
    }
    const payloadCircleId = Number(bindPayload.circleId);
    const payloadExternalAppId = String(bindPayload.externalAppId || '').trim();
    if (
      !Number.isSafeInteger(payloadCircleId)
      || payloadCircleId !== input.circleId
      || !payloadExternalAppId
      || String(bindPayload.bindingKind || '') !== 'primary'
    ) {
      throw new GovernanceCaseIntakeError(400, 'governance_case_subject_invalid');
    }
    const binding = await prisma.externalAppCircleBinding.findUnique({
      where: { id: subjectRef },
      select: {
        id: true,
        circleId: true,
        externalAppId: true,
        bindingKind: true,
        status: true,
      },
    });
    if (
      !binding
      || binding.circleId !== input.circleId
      || binding.externalAppId !== payloadExternalAppId
      || String(binding.bindingKind || '') !== 'primary'
      || !['pending', 'active'].includes(String(binding.status || ''))
    ) {
      throw new GovernanceCaseIntakeError(400, 'governance_case_subject_invalid');
    }
  }
  if (
    (subjectType === 'circle' && subjectRef !== String(input.circleId))
    || (subjectType === 'circle_governance_binding' && !input.authorityBindingId)
    || (subjectType === 'communication_room_member'
      && !subjectRef.startsWith(`${input.circleId}:`))
    || (subjectType === 'feed_post'
      && !subjectRef.startsWith(`${input.circleId}:`))
    || (subjectType === 'governed_operator_capability'
      && !subjectRef.startsWith(`${input.circleId}:operator-capability:`))
    || (subjectType === 'external_provider' && !subjectRef)
    || (subjectType === 'external_app_circle_binding' && !subjectRef)
  ) {
    throw new GovernanceCaseIntakeError(400, 'governance_case_subject_invalid');
  }
  const idempotencyKey = requiredText(
    idempotencyKeyInput,
    8,
    128,
    'governance_case_idempotency_key_required',
  );
  const openedByPubkey = requiredText(
    input.openedByPubkey,
    1,
    44,
    'governance_case_actor_required',
  );
  if (!isIntakeOriginKind(input.originKind)) {
    throw new GovernanceCaseIntakeError(400, 'governance_case_origin_invalid');
  }
  const relationship = normalizeRelationship(
    input.relationshipKind,
    input.relatedCaseId,
    input.relationshipReason,
  );

  const homes = await prisma.governanceHomeIdentityBinding.findMany({
    where: {
      homeType: 'circle',
      homeRef: String(input.circleId),
      supersededAt: null,
    },
    orderBy: { identityVersion: 'desc' },
    take: 2,
  });
  if (homes.length === 0) {
    throw new GovernanceCaseIntakeError(409, 'governance_case_home_required');
  }
  if (homes.length !== 1) {
    throw new GovernanceCaseIntakeError(409, 'governance_case_home_ambiguous');
  }
  const home = homes[0];
  if (home.homeType !== 'circle' || String(home.homeRef) !== String(input.circleId)) {
    throw new GovernanceCaseIntakeError(409, 'governance_case_home_mismatch');
  }

  const source = await normalizeIntakeSource(prisma, {
    ...input,
    actionType,
    subjectType,
    subjectRef,
    idempotencyKey,
  });
  const caseDigest = hashCanonicalGovernanceValue('alcheme.governance.case-intake-id', {
    homeIdentityBindingId: home.id,
    idempotencyKey,
  });
  const caseId = `governance_case:${caseDigest.slice(0, 56)}`;
  const persist = async (tx: any) => {
    const persistNow = new Date();
    let reservationHandle: { reservationId: string } | null = null;
    if (recurrenceReservation) {
      try {
        const reserved = await reserveExternalGovernedActionRecurrenceInTransaction(tx, {
          homeIdentityBindingId: home.id,
          actionType: recurrenceReservation.actionType,
          subjectType: recurrenceReservation.subjectType,
          subjectRef: recurrenceReservation.subjectRef,
          recurrenceEpoch: recurrenceReservation.recurrenceEpoch,
          intentDigest: recurrenceReservation.intentDigest,
        });
        if (reserved.kind === 'replay' && reserved.governanceCaseId) {
          const replayedCase = await tx.governanceCase.findUnique({
            where: { id: reserved.governanceCaseId },
            include: {
              homeIdentityBinding: { select: { homeType: true, homeRef: true } },
              primaryRequest: true,
              responsibilities: true,
              timelineEvents: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
            },
          });
          if (!replayedCase) {
            throw new GovernanceCaseIntakeError(
              409,
              `external_governed_action_recurrence_dangling_case:${reserved.governanceCaseId}`,
            );
          }
          return { governanceCase: replayedCase, replayed: true };
        }
        reservationHandle = { reservationId: reserved.reservationId };
      } catch (error) {
        if (error instanceof ExternalGovernedActionRecurrenceError) {
          throw new GovernanceCaseIntakeError(
            error.statusCode,
            error.existingCaseId ? `${error.code}:${error.existingCaseId}` : error.code,
          );
        }
        throw error;
      }
    }
    const expected = {
      title,
      requestedDecision,
      requestedActionPayload,
      subjectType,
      subjectRef,
      originKind: input.originKind,
      originRef: source.originRef,
      invocationId: source.invocationId,
      sourceMessageIds: source.sourceMessageIds,
      originSnapshotDigest: source.originSnapshotDigest,
      sourceUrl: source.sourceUrl,
      openedByPubkey,
      caseType: input.caseType,
      templateId,
      actionType,
      decisionMechanismKind: input.decisionMechanismKind ?? 'equal_weight_threshold',
      quadraticVoiceChoices: input.quadraticVoiceChoices ?? null,
      quadraticFundingRound: input.quadraticFundingRound ?? null,
      selectionRanking: input.selectionRanking ?? null,
      relationshipKind: relationship.kind,
      relatedCaseId: relationship.caseId,
      relationshipReason: relationship.reason,
    };
    const existing = await tx.governanceCase.findFirst({
      where: { homeIdentityBindingId: home.id, idempotencyKey },
      include: {
        homeIdentityBinding: { select: { homeType: true, homeRef: true } },
        primaryRequest: true,
        responsibilities: true,
        timelineEvents: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
    });
    if (existing) {
      assertMatchingIntake(existing, expected);
      await assertGovernanceCandidateReferences(tx, {
        homeIdentityBindingId: home.id,
        circleId: input.circleId,
        decisionMechanism: (existing.templateSelection as GovernanceCaseTemplateSelection | null)?.decisionMechanism,
        selectionRanking: (existing.templateSelection as GovernanceCaseTemplateSelection | null)?.selectionRanking,
      });
      if (reservationHandle) {
        await bindExternalGovernedActionRecurrenceReservationCase(tx, {
          reservationId: reservationHandle.reservationId,
          governanceCaseId: existing.id,
        });
      }
      return { governanceCase: existing, replayed: true };
    }
    try {
      await assertGovernanceHomeAllowsNewIntake(tx, {
        circleId: input.circleId,
        actionType,
        payload: requestedActionPayload,
        authoritySourceType: input.authorityResolution?.binding?.authoritySourceType ?? null,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : 'governance_home_lifecycle_check_failed';
      throw new GovernanceCaseIntakeError(409, code);
    }
    const authorityResolution = input.caseType === 'policy'
      ? input.authorityResolution ?? await resolveGovernanceCaseIntakeMandateAuthority(tx, {
        targetCircleId: input.circleId,
        actionType,
        authorityBindingId: input.authorityBindingId ?? null,
        subjectType,
        subjectRef,
        now: openedAt,
      })
      : null;
    const explicitSelfAuthorityHealth = actionType === 'circle.governance_binding.authority_health.check'
      && authorityResolution?.binding?.id === input.authorityBindingId
      && authorityResolution?.binding?.bindingType === 'self_governed'
      && authorityResolution?.binding?.authoritySourceType === 'circle_governance_binding'
      && authorityResolution?.binding?.authorityPurpose === 'collective_decision';
    const exactSelfGovernedAuthority = isExactSelfGovernedCaseAuthority(authorityResolution, {
      targetCircleId: input.circleId,
      actionType,
      subjectType,
      subjectRef,
      authorityBindingId: input.authorityBindingId ?? null,
      now: openedAt,
    });
    if (input.authorityResolution && (
      authorityResolution?.binding?.id !== input.authorityBindingId
      || authorityResolution?.binding?.targetCircleId !== input.circleId
      || (
        !['governance_mandate', 'governance_recovery_policy']
          .includes(String(authorityResolution?.binding?.authoritySourceType ?? ''))
        && !explicitSelfAuthorityHealth
        && !exactSelfGovernedAuthority
      )
      || authorityResolution?.binding?.authorityPurpose !== 'collective_decision'
    )) {
      throw new GovernanceCaseIntakeError(409, 'governance_case_mandate_authority_unavailable');
    }
    const template = await selectGovernanceCaseTemplateForIntake(tx, {
      homeIdentityBindingId: home.id,
      homeType: home.homeType,
      homeRef: home.homeRef,
      caseType: input.caseType,
      templateId,
      actionType,
      decisionMechanismKind: input.decisionMechanismKind,
      quadraticVoiceChoices: input.quadraticVoiceChoices,
      quadraticFundingRound: input.quadraticFundingRound,
      selectionRanking: input.selectionRanking,
      targetCircleId: input.circleId,
      subjectType,
      subjectRef,
      authorityResolution,
      originKind: input.originKind,
      now: openedAt,
    });
    await assertGovernanceCandidateReferences(tx, {
      homeIdentityBindingId: home.id,
      circleId: input.circleId,
      decisionMechanism: template.selection.decisionMechanism,
      selectionRanking: template.selection.selectionRanking,
    });
    assertGovernanceCaseTemplateProposer(template.selection, input.actorRole);
    if (relationship.caseId) {
      const relatedCase = await tx.governanceCase.findUnique({
        where: { id: relationship.caseId },
        select: {
          id: true,
          homeIdentityBindingId: true,
          casePhase: true,
          primaryRequest: { select: { state: true } },
        },
      });
      const targetIsValid = relationship.kind === 'supersedes'
        ? isActiveGovernanceCase(relatedCase) || isGovernanceCaseSupersedable(relatedCase)
        : isActiveGovernanceCase(relatedCase);
      if (!relatedCase || relatedCase.homeIdentityBindingId !== home.id || !targetIsValid) {
        throw new GovernanceCaseIntakeError(409, 'governance_case_relationship_target_invalid');
      }
    }
    if (actionType === STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE) {
      const provenance = asIntakeRecord(
        asIntakeRecord(requestedActionPayload)?.candidateProvenance,
      );
      // After authority locks: wall-clock, not transaction-start NOW().
      let finalNow = new Date();
      if (typeof tx.$queryRawUnsafe === 'function') {
        const rows = await tx.$queryRawUnsafe(
          `SELECT clock_timestamp() AS "now"`,
        ) as Array<{ now: Date | string }>;
        const dbNow = rows?.[0]?.now;
        if (dbNow) finalNow = dbNow instanceof Date ? dbNow : new Date(dbNow);
      }
      assertProviderAdmissionCandidateNotExpired(provenance?.expiresAt, finalNow);
    }
    const saved = await tx.governanceCase.create({
      data: {
        id: caseId,
        homeIdentityBindingId: home.id,
        primaryRequestId: null,
        invocationId: source.invocationId,
        originKind: input.originKind,
        originRef: source.originRef,
        subjectType,
        subjectRef,
        title,
        requestedDecision,
        requestedActionPayload,
        caseType: input.caseType,
        templateSelection: template.selection,
        templateSelectionDigest: template.digest,
        profileBindingId: template.selection.profile.bindingId,
        actionContractVersionId: template.selection.actionContract?.contractVersionId ?? null,
        idempotencyKey,
        openedByPubkey,
        sourceMessageIds: source.sourceMessageIds,
        originSnapshot: source.originSnapshot,
        originSnapshotDigest: source.originSnapshotDigest,
        sourceUrl: source.sourceUrl,
        relationshipKind: relationship.kind,
        relatedCaseId: relationship.caseId,
        relationshipReason: relationship.reason,
        openedAt,
        ...initialGovernanceCaseWorkflowData({
          caseId,
          phase: 'intake',
          coordinatorPubkey: openedByPubkey,
          openedAt,
        }),
      },
      include: {
        responsibilities: true,
        timelineEvents: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
    });
    const governanceCase = {
      ...saved,
      homeIdentityBinding: { homeType: home.homeType, homeRef: home.homeRef },
      primaryRequest: null,
    };
    if (reservationHandle) {
      await bindExternalGovernedActionRecurrenceReservationCase(tx, {
        reservationId: reservationHandle.reservationId,
        governanceCaseId: governanceCase.id,
      });
    }
    if (typeof input.afterPersist === 'function') {
      await input.afterPersist(tx, governanceCase);
    }
    return {
      governanceCase,
      replayed: false,
    };
  };
  try {
    return typeof prisma.$transaction === 'function'
      ? await prisma.$transaction((tx: any) => persist(tx))
      : await persist(prisma);
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const raced = await prisma.governanceCase.findFirst({
      where: {
        homeIdentityBindingId: home.id,
        idempotencyKey,
      },
      include: {
        homeIdentityBinding: { select: { homeType: true, homeRef: true } },
        primaryRequest: true,
        responsibilities: true,
        timelineEvents: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!raced) throw error;
    assertMatchingIntake(raced, {
      title,
      requestedDecision,
      requestedActionPayload,
      subjectType,
      subjectRef,
      originKind: input.originKind,
      originRef: source.originRef,
      invocationId: source.invocationId,
      sourceMessageIds: source.sourceMessageIds,
      originSnapshotDigest: source.originSnapshotDigest,
      sourceUrl: source.sourceUrl,
      openedByPubkey,
      caseType: input.caseType,
      templateId,
      actionType,
      decisionMechanismKind: input.decisionMechanismKind ?? 'equal_weight_threshold',
      quadraticVoiceChoices: input.quadraticVoiceChoices ?? null,
      quadraticFundingRound: input.quadraticFundingRound ?? null,
      selectionRanking: input.selectionRanking ?? null,
      relationshipKind: relationship.kind,
      relatedCaseId: relationship.caseId,
      relationshipReason: relationship.reason,
    });
    await assertGovernanceCandidateReferences(prisma, {
      homeIdentityBindingId: home.id,
      circleId: input.circleId,
      decisionMechanism: (raced.templateSelection as GovernanceCaseTemplateSelection | null)?.decisionMechanism,
      selectionRanking: (raced.templateSelection as GovernanceCaseTemplateSelection | null)?.selectionRanking,
    });
    if (recurrenceReservation && typeof prisma.$transaction === 'function') {
      try {
        await prisma.$transaction(async (tx: any) => {
          const reserved = await reserveExternalGovernedActionRecurrenceInTransaction(tx, {
            homeIdentityBindingId: home.id,
            actionType: recurrenceReservation.actionType,
            subjectType: recurrenceReservation.subjectType,
            subjectRef: recurrenceReservation.subjectRef,
            recurrenceEpoch: recurrenceReservation.recurrenceEpoch,
            intentDigest: recurrenceReservation.intentDigest,
          });
          if (reserved.kind === 'replay' && reserved.governanceCaseId) {
            if (reserved.governanceCaseId !== raced.id) {
              throw new ExternalGovernedActionRecurrenceError(
                409,
                'external_governed_action_recurrence_conflict',
                reserved.governanceCaseId,
              );
            }
            return;
          }
          await bindExternalGovernedActionRecurrenceReservationCase(tx, {
            reservationId: reserved.reservationId,
            governanceCaseId: raced.id,
          });
        });
      } catch (bindError) {
        if (bindError instanceof ExternalGovernedActionRecurrenceError) {
          throw new GovernanceCaseIntakeError(
            bindError.statusCode,
            bindError.existingCaseId ? `${bindError.code}:${bindError.existingCaseId}` : bindError.code,
          );
        }
        throw bindError;
      }
    }
    return { governanceCase: raced, replayed: true };
  }
}

async function assertGovernanceCandidateReferences(
  prisma: any,
  input: {
    homeIdentityBindingId: string;
    circleId: number;
    decisionMechanism: GovernanceCaseTemplateSelection['decisionMechanism'] | null | undefined;
    selectionRanking: GovernanceCaseTemplateSelection['selectionRanking'] | null | undefined;
  },
): Promise<void> {
  const refs = [
    ...(input.decisionMechanism?.kind === 'quadratic_funding'
      ? [
          ...input.decisionMechanism.round.projects.map((project) => project.projectRef),
          ...input.decisionMechanism.round.excludedProjects.map((project) => project.projectRef),
        ]
      : []),
    ...(input.selectionRanking
      ? [
          ...input.selectionRanking.candidateSnapshot.eligibleCandidates
            .map((candidate) => candidate.candidateRef),
          ...input.selectionRanking.candidateSnapshot.excludedCandidates
            .map((candidate) => candidate.candidateRef),
        ]
      : []),
  ];
  for (const projectRef of refs) {
    if (projectRef.startsWith('case:')) {
      const caseId = projectRef.slice('case:'.length);
      const governanceCase = caseId
        ? await prisma.governanceCase.findUnique({
          where: { id: caseId },
          select: { homeIdentityBindingId: true },
        })
        : null;
      if (governanceCase?.homeIdentityBindingId !== input.homeIdentityBindingId) {
        throw new GovernanceCaseIntakeError(400, 'governance_case_candidate_ref_invalid');
      }
      continue;
    }
    if (projectRef.startsWith('artifact:')) {
      const artifactId = projectRef.slice('artifact:'.length);
      const artifact = artifactId
        ? await prisma.decisionOutputArtifact.findUnique({
          where: { id: artifactId },
          select: {
            governanceCase: { select: { homeIdentityBindingId: true } },
          },
        })
        : null;
      if (artifact?.governanceCase?.homeIdentityBindingId !== input.homeIdentityBindingId) {
        throw new GovernanceCaseIntakeError(400, 'governance_case_candidate_ref_invalid');
      }
      continue;
    }
    const draftMatch = /^draft:(\d+):(\d+)$/.exec(projectRef);
    if (draftMatch) {
      const draftPostId = Number(draftMatch[1]);
      const draftVersion = Number(draftMatch[2]);
      const [snapshot, post] = await Promise.all([
        prisma.draftVersionSnapshot.findUnique({
          where: { draftPostId_draftVersion: { draftPostId, draftVersion } },
          select: { draftPostId: true },
        }),
        prisma.post.findUnique({
          where: { id: draftPostId },
          select: { circleId: true },
        }),
      ]);
      if (!snapshot || post?.circleId !== input.circleId) {
        throw new GovernanceCaseIntakeError(400, 'governance_case_candidate_ref_invalid');
      }
      continue;
    }
    throw new GovernanceCaseIntakeError(400, 'governance_case_candidate_ref_invalid');
  }
}

export async function findGovernanceCaseIntakeSuggestions(
  prisma: any,
  input: {
    circleId: number;
    title: string;
    originKind: GovernanceCaseIntakeOriginKind;
    sourceMessageIds?: string[] | null;
    sourceUrl?: string | null;
  },
): Promise<GovernanceCaseIntakeSuggestion[]> {
  if (!Number.isSafeInteger(input.circleId) || input.circleId <= 0) {
    throw new GovernanceCaseIntakeError(400, 'invalid_circle_id');
  }
  const title = requiredText(input.title, 3, 160, 'governance_case_title_required');
  if (!isIntakeOriginKind(input.originKind)) {
    throw new GovernanceCaseIntakeError(400, 'governance_case_origin_invalid');
  }
  if (input.originKind === 'native_invocation') {
    throw new GovernanceCaseIntakeError(400, 'governance_case_native_source_required');
  }
  const homes = await prisma.governanceHomeIdentityBinding.findMany({
    where: {
      homeType: 'circle',
      homeRef: String(input.circleId),
      supersededAt: null,
    },
    orderBy: { identityVersion: 'desc' },
    take: 2,
  });
  if (homes.length !== 1) {
    throw new GovernanceCaseIntakeError(
      409,
      homes.length === 0 ? 'governance_case_home_required' : 'governance_case_home_ambiguous',
    );
  }
  const source = await normalizeIntakeSource(prisma, {
    circleId: input.circleId,
    originKind: input.originKind,
    sourceMessageIds: input.sourceMessageIds,
    sourceUrl: input.sourceUrl,
    sourceInvocationId: null,
    sourceReceiptId: null,
    actionType: null,
    subjectType: 'circle',
    subjectRef: String(input.circleId),
    idempotencyKey: 'case-preflight-only',
  });
  const candidates = await prisma.governanceCase.findMany({
    where: { homeIdentityBindingId: homes[0].id },
    include: { primaryRequest: { select: { state: true } } },
    orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
    take: 100,
  });
  return candidates
    .filter((candidate: any) => (
      isActiveGovernanceCase(candidate) || isGovernanceCaseSupersedable(candidate)
    ))
    .map((candidate: any) => buildIntakeSuggestion(candidate, {
      title,
      originKind: input.originKind,
      subjectRef: String(input.circleId),
      sourceUrl: source.sourceUrl,
    }))
    .filter((value: GovernanceCaseIntakeSuggestion | null): value is GovernanceCaseIntakeSuggestion => !!value)
    .sort((left: GovernanceCaseIntakeSuggestion, right: GovernanceCaseIntakeSuggestion) => (
      suggestionRank(left) - suggestionRank(right)
    ))
    .slice(0, 5);
}

export function governanceCasePhaseFromRequestState(
  state: GovernanceRequestRecord['state'],
): 'decision_in_progress' | 'outcome_review' {
  return state === 'active' ? 'decision_in_progress' : 'outcome_review';
}

export function governanceCaseCanonicalPath(caseId: string): string {
  return `/governance/cases/${encodeURIComponent(caseId)}`;
}

function verifiedGovernanceCaseOriginSnapshot(value: any): GovernanceCaseOriginSnapshot | null {
  const snapshot = value?.originSnapshot;
  const digest = String(value?.originSnapshotDigest || '').trim().toLowerCase();
  if (
    !snapshot
    || typeof snapshot !== 'object'
    || Array.isArray(snapshot)
    || value?.originKind !== 'plaza_selection'
    || snapshot.schemaVersion !== 1
    || snapshot.kind !== 'plaza_message_selection'
    || !Number.isInteger(snapshot.circleId)
    || !isSha256Digest(String(snapshot.sourceSetDigest || ''))
    || !Array.isArray(snapshot.sources)
    || snapshot.sources.length === 0
    || !snapshot.sources.every((source: any) => (
      source?.type === 'discussion_message'
      && typeof source.ref === 'string'
      && source.ref.trim().length > 0
      && typeof source.authorPubkey === 'string'
      && source.authorPubkey.trim().length > 0
      && isSha256Digest(String(source.payloadDigest || ''))
      && /^\d+$/.test(String(source.lamport || ''))
      && Number.isFinite(new Date(String(source.clientTimestamp || '')).getTime())
      && typeof source.messageKind === 'string'
      && source.messageKind.trim().length > 0
      && typeof source.authMode === 'string'
      && source.authMode.trim().length > 0
      && typeof source.signatureVerified === 'boolean'
    ))
    || snapshot.visibility?.sourceOwner !== 'circle_discussion'
    || typeof snapshot.visibility?.circleType !== 'string'
    || !snapshot.visibility.circleType.trim()
    || snapshot.visibility?.caseProjection !== 'member_or_operator'
    || snapshot.visibility?.contentAccess !== 'not_granted_by_case'
    || snapshot.visibility?.publicProjection !== 'withheld'
    || !isSha256Digest(digest)
  ) return null;
  const sourceMessageIds = Array.isArray(value?.sourceMessageIds)
    ? value.sourceMessageIds.map((item: unknown) => String(item))
    : [];
  if (JSON.stringify(sourceMessageIds) !== JSON.stringify(
    snapshot.sources.map((source: GovernanceCaseOriginSnapshot['sources'][number]) => source.ref),
  )) return null;
  const sourceSetDigest = hashCanonicalGovernanceValue(
    'alcheme.governance.case-origin-source-set.v1',
    { circleId: snapshot.circleId, sources: snapshot.sources },
  );
  if (sourceSetDigest !== String(snapshot.sourceSetDigest).toLowerCase()) return null;
  return hashCanonicalGovernanceValue(
    'alcheme.governance.case-origin-snapshot.v1',
    snapshot,
  ) === digest
    ? snapshot as GovernanceCaseOriginSnapshot
    : null;
}

export function projectGovernanceCase(
  value: any,
  projectedRequest: Record<string, unknown> | null,
  input: {
    includePrivateOriginRefs?: boolean;
    workflowAudience?: 'public' | 'member' | 'operator';
    viewerPubkey?: string | null;
    responsibilityCandidates?: Array<{
      pubkey: string;
      handle: string;
      displayName: string | null;
      role: string;
      eligibleResponsibilityKinds: Array<'coordinator' | 'review' | 'execution' | 'outcome'>;
    }>;
    policySimulation?: GovernanceCasePolicySimulation | null;
  } = {},
): Record<string, unknown> {
  const home = value?.homeIdentityBinding;
  const workflowAudience = input.workflowAudience ?? 'public';
  const workflowVisible = workflowAudience !== 'public';
  const originSnapshot = verifiedGovernanceCaseOriginSnapshot(value);
  const hasStoredOriginSnapshot = value?.originSnapshot != null || value?.originSnapshotDigest != null;
  const coordinator = Array.isArray(value?.responsibilities)
    ? value.responsibilities.find((item: any) => item.kind === 'coordinator') ?? null
    : null;
  const sectionReadiness = workflowVisible && value?.briefSnapshot
    ? resolveGovernanceBriefReadiness({
        contentSnapshot: String(value.briefSnapshot.contentSnapshot || ''),
        ownerPubkey: coordinator?.assigneePubkey || null,
      })
    : null;
  const reviewSnapshotReady = Boolean(
    value?.briefWorkflowState?.documentStatus === 'review'
    && Number(value.briefWorkflowState.currentSnapshotVersion) === Number(value?.briefDraftVersion),
  );
  const briefClaimProjection = projectGovernanceBriefClaims(value, workflowAudience);
  const ballotDisclosure = projectGovernanceCaseBallotDisclosure(
    value,
    workflowAudience,
    input.viewerPubkey ?? null,
  );
  const memberRights = projectGovernanceCaseMemberRights(
    value,
    workflowAudience,
    input.viewerPubkey ?? null,
  );
  return {
    id: String(value?.id ?? ''),
    readerAudience: workflowAudience,
    originKind: projectedOriginKind(value?.originKind),
    phase: projectCasePhase(value),
    title: String(value?.title ?? ''),
    requestedDecision: String(value?.requestedDecision ?? ''),
    requestedAction: workflowVisible
      && value?.requestedActionPayload
      && (!memberRights || workflowAudience === 'operator')
      ? { payload: value.requestedActionPayload }
      : null,
    configurationTransitionReadback: workflowVisible
      && value?.configurationTransitionReadback
      ? value.configurationTransitionReadback
      : null,
    configurationTransitionAuditRecord: value?.configurationTransitionReadback?.auditRecord
      ? workflowVisible
        ? value.configurationTransitionReadback.auditRecord.authorized
        : value.configurationTransitionReadback.auditRecord.public
      : null,
    memberRights,
    caseType: String(value?.caseType ?? 'legacy_unclassified'),
    template: projectTemplateSelection(
      value?.templateSelection,
      value?.templateSelectionDigest,
      workflowVisible,
    ),
    governanceHome: home
      ? {
          type: String(home.homeType ?? ''),
          ref: String(home.homeRef ?? ''),
        }
      : null,
    governedSubject: {
      type: String(value?.subjectType ?? ''),
      ref: String(value?.subjectRef ?? ''),
    },
    canonicalUrl: governanceCaseCanonicalPath(String(value?.id ?? '')),
    openedAt: dateTime(value?.openedAt),
    proposerPubkey: workflowVisible && value?.openedByPubkey
      ? String(value.openedByPubkey)
      : null,
    fieldVisibility: projectGovernanceCaseFieldVisibility(workflowAudience, ballotDisclosure),
    origin: {
      kind: String(value?.originKind ?? ''),
      ref: input.includePrivateOriginRefs ? String(value?.originRef ?? '') : null,
      sourceUrl: value?.sourceUrl == null ? null : String(value.sourceUrl),
      sourceMessageIds: input.includePrivateOriginRefs && Array.isArray(value?.sourceMessageIds)
        ? value.sourceMessageIds.map((item: unknown) => String(item))
        : [],
      snapshot: input.includePrivateOriginRefs ? originSnapshot : null,
      snapshotDigest: input.includePrivateOriginRefs && originSnapshot
        ? String(value.originSnapshotDigest).toLowerCase()
        : null,
      snapshotIntegrity: !input.includePrivateOriginRefs
        ? 'withheld'
        : originSnapshot
          ? 'verified'
          : hasStoredOriginSnapshot
            ? 'invalid'
            : 'unavailable',
    },
    relationship: value?.relationshipKind && value?.relatedCaseId
      ? {
          kind: String(value.relationshipKind),
          caseId: String(value.relatedCaseId),
          canonicalUrl: governanceCaseCanonicalPath(String(value.relatedCaseId)),
          reason: value?.relationshipReason == null ? null : String(value.relationshipReason),
          recordedAt: dateTime(value?.openedAt),
          recordedBy: {
            homeType: home ? String(home.homeType ?? '') : '',
            homeRef: home ? String(home.homeRef ?? '') : '',
            actorPubkey: workflowVisible && value?.openedByPubkey
              ? String(value.openedByPubkey)
              : null,
          },
        }
      : null,
    corrections: Array.isArray(value?.relatedCases)
      ? value.relatedCases.flatMap((correction: any) => (
          correction?.relationshipKind === 'supersedes'
          && correction?.id
          && correction?.relationshipReason
            ? [{
                caseId: String(correction.id),
                canonicalUrl: governanceCaseCanonicalPath(String(correction.id)),
                reason: String(correction.relationshipReason),
                recordedAt: dateTime(correction.openedAt),
                recordedBy: {
                  homeType: home ? String(home.homeType ?? '') : '',
                  homeRef: home ? String(home.homeRef ?? '') : '',
                  actorPubkey: workflowVisible && correction?.openedByPubkey
                    ? String(correction.openedByPubkey)
                    : null,
                },
              }]
            : []
        ))
      : [],
    brief: workflowVisible
      && Number.isInteger(value?.briefDraftPostId)
      && Number.isInteger(value?.briefDraftVersion)
      && isSha256Digest(value?.briefSnapshotDigest)
      ? {
          draftPostId: Number(value.briefDraftPostId),
          draftVersion: Number(value.briefDraftVersion),
          snapshotDigest: String(value.briefSnapshotDigest),
          boundByPubkey: value?.briefBoundByPubkey == null ? null : String(value.briefBoundByPubkey),
          boundAt: dateTime(value?.briefBoundAt),
          contentHistory: projectGovernanceBriefContentHistory(value),
          actors: projectGovernanceBriefActors(value),
          sources: projectGovernanceBriefSourceCards(value?.briefSourceMaterials),
          claims: briefClaimProjection.claims,
          coverage: briefClaimProjection.coverage,
          readiness: sectionReadiness
            ? {
                ...sectionReadiness,
                documentStatus: value?.briefWorkflowState?.documentStatus == null
                  ? null
                  : String(value.briefWorkflowState.documentStatus),
                currentSnapshotVersion: Number.isInteger(value?.briefWorkflowState?.currentSnapshotVersion)
                  ? Number(value.briefWorkflowState.currentSnapshotVersion)
                  : null,
                reviewSnapshotReady,
                readyForEvidenceReview: sectionReadiness.sectionReady && reviewSnapshotReady,
              }
            : null,
        }
      : null,
    primaryRequest: projectedRequest,
    executionAuthorityHeader: projectGovernanceCaseExecutionAuthorityHeader(
      projectedRequest,
      workflowVisible,
    ),
    caseAuthorityMatrix: projectGovernanceCaseAuthorityMatrix(
      value,
      projectedRequest,
      workflowVisible,
    ),
    caseBlockers: workflowVisible ? projectGovernanceCaseBlockers(value) : [],
    manualExecutionControl: workflowVisible
      ? projectGovernanceManualExecutionControlReadback(
          value,
          (projectedRequest as any)?.providerExecution ?? null,
        )
      : null,
    policySimulation: workflowVisible ? input.policySimulation ?? null : null,
    ballotDisclosure,
    voteSummary: projectGovernanceCaseVoteSummary(
      value,
      input.viewerPubkey ?? null,
      workflowAudience,
    ),
    decisionAuthorityStages: projectGovernanceCaseDecisionAuthorityStages(value),
    decisionStages: workflowVisible ? projectGovernanceCaseDecisionStages(value) : null,
    decisionOutputArtifacts: workflowVisible && Array.isArray(value?.decisionOutputArtifacts)
      ? value.decisionOutputArtifacts.map((artifact: any) => projectDecisionOutputArtifact(
          artifact,
          { includeSourceRef: true },
        ))
      : [],
    grantAgreements: workflowVisible && Array.isArray(value?.grantAgreements)
      ? value.grantAgreements.map(projectGovernanceGrantAgreement)
      : [],
    actualOutcome: workflowVisible ? projectGovernanceCaseActualOutcome(value) : null,
    workflow: {
      legacy: !value?.casePhase || !Number.isInteger(value?.caseVersion),
      version: Number.isInteger(value?.caseVersion) ? value.caseVersion : null,
      canManage: workflowAudience === 'operator',
      responsibilities: workflowVisible && Array.isArray(value?.responsibilities)
        ? value.responsibilities.map(projectResponsibility)
        : [],
      timeline: projectGovernanceCaseTimeline(value, workflowAudience),
      candidates: workflowVisible ? input.responsibilityCandidates ?? [] : [],
    },
  };
}

function projectGovernanceCaseAuthorityMatrix(
  value: any,
  projectedRequest: Record<string, unknown> | null,
  workflowVisible: boolean,
): Record<string, unknown> | null {
  if (!workflowVisible) return null;
  const decisionAuthorityStages = projectGovernanceCaseDecisionAuthorityStages(value) as any;
  const executionAuthorityHeader = projectGovernanceCaseExecutionAuthorityHeader(
    projectedRequest,
    workflowVisible,
  ) as any;
  const actualOutcome = projectGovernanceCaseActualOutcome(value) as any;
  const originKind = String(value?.originKind ?? '');
  const originSnapshotDigest = isSha256Digest(value?.originSnapshotDigest)
    ? String(value.originSnapshotDigest).toLowerCase()
    : null;
  const discussionEntry = {
    phase: 'discussion',
    binding: originSnapshotDigest
      ? 'unique_authority'
      : 'reconciled_rule',
    authority: originSnapshotDigest
      ? {
          type: 'circle_discussion_snapshot',
          ref: originSnapshotDigest,
          version: 'origin_snapshot_digest',
        }
      : null,
    reconciledRule: originSnapshotDigest
      ? null
      : {
          rule: 'case_origin_intake_authority_without_discussion_snapshot',
          owner: 'governance_case_origin',
          reason: originKind || 'origin_unavailable',
        },
    source: 'case_origin_discussion_or_intake',
  };
  const decisionEntries = decisionAuthorityStages.integrity === 'verified'
    && Array.isArray(decisionAuthorityStages.stages)
    && decisionAuthorityStages.stages.length > 0
    ? decisionAuthorityStages.stages.map((stage: any) => ({
        phase: 'decision',
        binding: 'unique_authority',
        authority: {
          type: String(stage.decisionAuthority.type),
          ref: String(stage.decisionAuthority.ref),
          version: String(stage.decisionAuthority.version),
        },
        reconciledRule: null,
        source: stage.decisionAuthority.authorityClass === 'workflow_stage'
          ? 'frozen_workflow_stage_authority'
          : 'frozen_institutional_decision_authority',
      }))
    : [{
        phase: 'decision',
        binding: 'reconciled_rule',
        authority: null,
        reconciledRule: {
          rule: 'decision_authority_not_frozen_or_invalid',
          owner: 'governance_case_decision_stage_projection',
          reason: String(decisionAuthorityStages.integrity ?? 'unavailable'),
        },
        source: 'decision_authority_stage_projection',
      }];
  const executionEntry = executionAuthorityHeader?.state?.integrity === 'verified'
    ? {
        phase: 'execution',
        binding: executionAuthorityHeader.executionAuthorities.length > 0
          ? 'unique_authority'
          : 'reconciled_rule',
        authority: executionAuthorityHeader.executionAuthorities.length > 0
          ? {
              type: 'provider_execution_authority',
              ref: executionAuthorityHeader.executionAuthorities
                .map((authority: any) => `${authority.role}:${authority.publicAuthority ?? authority.custodyProvider}`)
                .sort()
                .join('|'),
              version: String(executionAuthorityHeader.technicalProvider?.profileVersion ?? 'preflight'),
            }
          : null,
        reconciledRule: executionAuthorityHeader.executionAuthorities.length > 0
          ? null
          : {
              rule: 'execution_not_required_or_not_yet_authorized',
              owner: 'governance_case_execution_authority_header',
              reason: String(executionAuthorityHeader.state.executionStatus),
            },
        source: String(executionAuthorityHeader.technicalProvider?.source ?? 'execution_authority_header'),
      }
    : {
        phase: 'execution',
        binding: 'reconciled_rule',
        authority: null,
        reconciledRule: {
          rule: 'execution_authority_unavailable',
          owner: 'governance_case_execution_authority_header',
          reason: String(executionAuthorityHeader?.state?.providerStatus ?? 'unavailable'),
        },
        source: 'execution_authority_header',
      };
  const outcomeEntry = actualOutcome?.integrity === 'verified'
    ? {
        phase: 'outcome',
        binding: 'unique_authority',
        authority: {
          type: 'governance_case_actual_outcome',
          ref: String(actualOutcome.digest),
          version: String(actualOutcome.recordedAt),
        },
        reconciledRule: null,
        source: 'canonical_actual_outcome_digest',
      }
    : {
        phase: 'outcome',
        binding: 'reconciled_rule',
        authority: null,
        reconciledRule: {
          rule: 'outcome_resolved_by_decision_output_artifact_or_terminal_receipt',
          owner: 'decision_output_artifact_and_execution_receipt_projection',
          reason: actualOutcome?.integrity === 'invalid'
            ? 'actual_outcome_integrity_invalid'
            : 'actual_outcome_not_recorded',
        },
        source: 'outcome_projection',
      };
  const entries = [
    discussionEntry,
    ...decisionEntries,
    executionEntry,
    outcomeEntry,
  ];
  const complete = entries.every((entry: any) => (
    entry.binding === 'unique_authority'
      ? entry.authority?.type && entry.authority?.ref && entry.authority?.version
      : entry.reconciledRule?.rule && entry.reconciledRule?.owner
  ));
  return {
    schemaVersion: 1,
    integrity: complete ? 'verified' : 'invalid',
    entries,
    boundary: 'discussion_decision_execution_outcome_each_has_unique_authority_or_reconciled_rule',
  };
}

function projectGovernanceCaseExecutionAuthorityHeader(
  projectedRequest: Record<string, unknown> | null,
  workflowVisible: boolean,
): Record<string, unknown> | null {
  if (!workflowVisible || !projectedRequest) return null;
  const request = projectedRequest as any;
  const state = {
    decisionStatus: String(request.decisionStatus ?? 'unavailable'),
    executionStatus: String(request.executionStatus ?? 'unavailable'),
    providerStatus: 'unavailable',
    integrity: 'unavailable',
    receiptId: null as string | null,
    blocker: null as string | null,
  };
  const providerExecution = request.providerExecution;
  const provider = providerExecution?.integrity === 'verified'
    && providerExecution?.provider
    && (
      providerExecution.provider.module === 'realms_provider_binding'
      || providerExecution.provider.module === 'squads_provider_binding'
    )
    ? providerExecution.provider
    : null;
  if (provider) {
    const authorities = Array.isArray(provider.executionAuthorities)
      ? provider.executionAuthorities.flatMap((authority: any) => (
          authority
          && typeof authority.role === 'string'
          && authority.role.trim()
          && typeof authority.custodyProvider === 'string'
          && authority.custodyProvider.trim()
          && Array.isArray(authority.allowedOperations)
            ? [{
                role: String(authority.role),
                publicAuthority: authority.publicAuthority == null
                  ? null
                  : String(authority.publicAuthority),
                custodyProvider: String(authority.custodyProvider),
                custodyStatus: String(authority.custodyStatus ?? ''),
                allowedOperations: authority.allowedOperations.map(String),
                verifiedSlot: Number(authority.verifiedSlot),
                status: String(authority.status ?? ''),
                sourceRequestId: authority.sourceRequestId == null
                  ? null
                  : String(authority.sourceRequestId),
                sourceDecisionDigest: authority.sourceDecisionDigest == null
                  ? null
                  : String(authority.sourceDecisionDigest),
                source: 'provider_native_receipt_and_readback',
              }]
            : []
        ))
      : [];
    return {
      schemaVersion: 1,
      technicalProvider: {
        module: provider.module,
        network: String(provider.chainId),
        profileRef: String(provider.profileRef),
        profileVersion: Number(provider.profileVersion),
        resourceRef: String(provider.resourceRef),
        ownerProgramRef: String(provider.ownerProgramRef),
        observedSlot: Number(provider.observedSlot),
        source: 'provider_native_receipt_and_readback',
      },
      executionAuthorities: authorities,
      state: {
        ...state,
        providerStatus: String(providerExecution.status),
        integrity: 'verified',
        receiptId: providerExecution.receiptId == null
          ? null
          : String(providerExecution.receiptId),
        blocker: providerExecution.blocker == null
          ? null
          : String(providerExecution.blocker),
      },
      boundary: 'workflow_assignment_and_payer_are_not_execution_authority',
    };
  }

  const preflight = request.preExecutionCost?.executionAuthorityPreflight;
  const admission = request.providerResourceExecutionAdmission;
  if (
    preflight?.authority === 'invocation_snapshot_mandate_artifact_and_live_provider_readback'
    && preflight?.state === 'ready'
    && preflight?.executionAllowed === true
    && preflight?.liveExecutionAuthority?.result === 'verified'
    && admission?.authority === 'canonical_governed_resource_and_active_authority_bindings'
    && admission?.state === 'admitted_for_exact_provider_execution'
    && admission?.binding
    && Array.isArray(admission.controllingAuthorities)
  ) {
    const binding = admission.binding;
    return {
      schemaVersion: 1,
      technicalProvider: {
        module: String(binding.providerModule),
        network: String(binding.cluster),
        profileRef: String(binding.profileRef),
        profileVersion: Number(binding.profileVersion),
        resourceRef: String(binding.resourceRef),
        ownerProgramRef: String(binding.ownerProgramRef),
        observedSlot: Number(preflight.liveExecutionAuthority.observedSlot),
        source: 'live_execution_authority_preflight',
      },
      executionAuthorities: admission.controllingAuthorities.map((authority: any) => ({
        role: String(authority.role),
        publicAuthority: String(authority.publicAuthority),
        custodyProvider: String(authority.custodyProvider),
        custodyStatus: String(authority.custodyStatus),
        allowedOperations: Array.isArray(authority.allowedOperations)
          ? authority.allowedOperations.map(String)
          : [],
        verifiedSlot: Number(binding.verifiedSlot),
        status: 'active',
        sourceRequestId: String(admission.requestId),
        sourceDecisionDigest: String(admission.decisionDigest),
        source: 'canonical_resource_authority_binding',
      })),
      state: {
        ...state,
        providerStatus: 'preflight_ready',
        integrity: 'verified',
      },
      boundary: 'workflow_assignment_and_payer_are_not_execution_authority',
    };
  }

  return {
    schemaVersion: 1,
    technicalProvider: null,
    executionAuthorities: [],
    state,
    boundary: 'workflow_assignment_and_payer_are_not_execution_authority',
  };
}

function projectGovernanceCaseMemberRights(
  value: unknown,
  audience: 'public' | 'member' | 'operator',
  viewerPubkey: string | null,
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const governanceCase = value as Record<string, any>;
  const payload = governanceCase.requestedActionPayload as Record<string, any> | null;
  if (
    !payload
    || payload.kind !== 'circle_member_removal'
    || payload.actionType !== 'circle.membership.member.remove'
    || payload.impact !== 'permanent_member_removal'
    || !Number.isSafeInteger(payload.targetUserId)
    || typeof payload.targetPubkey !== 'string'
    || typeof payload.publicReason !== 'string'
    || !/^[a-f0-9]{64}$/.test(String(payload.evidence?.digest ?? ''))
    || !Number.isSafeInteger(payload.appeal?.windowSeconds)
    || payload.appeal.windowSeconds <= 0
    || !dateTime(payload.appeal?.deadline)
    || payload.appeal?.effectBeforeDeadline !== 'forbidden'
  ) return null;
  const respondent = viewerPubkey === payload.targetPubkey;
  if (audience === 'public') {
    return {
      actionType: payload.actionType,
      impact: payload.impact,
      notice: 'affected_member_protected',
    };
  }
  const request = governanceCase.primaryRequest;
  const decisionDigest = typeof request?.decision?.decisionDigest === 'string'
    && /^[a-f0-9]{64}$/.test(request.decision.decisionDigest)
    ? request.decision.decisionDigest
    : null;
  const acceptedArtifact = decisionDigest && Array.isArray(governanceCase.decisionOutputArtifacts)
    ? governanceCase.decisionOutputArtifacts.find((artifact: any) => (
        artifact?.caseId === governanceCase.id
        && artifact?.decisionRequestId === request?.id
        && artifact?.decisionDigest === decisionDigest
        && artifact?.kind === 'policy_document'
        && artifact?.finality === 'alcheme_native_decision'
        && /^[a-f0-9]{64}$/.test(String(artifact?.artifactDigest ?? ''))
      )) ?? null
    : null;
  const decisionState = String(request?.decision?.decision ?? request?.state ?? 'pending');
  const authorizationStatus = decisionState === 'accepted'
    ? acceptedArtifact
      ? 'accepted_artifact'
      : 'blocked_missing_accepted_artifact'
    : ['rejected', 'expired', 'cancelled'].includes(decisionState)
      ? 'terminal_without_authorization'
      : 'pending_decision';
  return {
    actionType: payload.actionType,
    impact: payload.impact,
    viewerRole: respondent
      ? 'respondent_appellant'
      : audience === 'operator'
        ? 'operator'
        : 'observer',
    targetUserId: payload.targetUserId,
    targetRole: String(payload.targetRole ?? ''),
    publicReason: payload.publicReason,
    evidenceDigest: String(payload.evidence.digest),
    appealWindowSeconds: payload.appeal.windowSeconds,
    appealDeadline: dateTime(payload.appeal.deadline),
    effectBeforeDeadline: 'forbidden',
    reporter: {
      visibility: String(payload.reporter?.visibility ?? 'withheld'),
      pubkey: audience === 'operator' && payload.reporter?.visibility === 'institutional_actor'
        ? governanceCase.openedByPubkey ?? null
        : null,
    },
    authorization: {
      status: authorizationStatus,
      artifactId: acceptedArtifact?.id ?? null,
      artifactDigest: acceptedArtifact?.artifactDigest ?? null,
      decisionDigest: acceptedArtifact?.decisionDigest ?? decisionDigest,
      source: acceptedArtifact ? 'native_decision_output_artifact' : null,
    },
    executionStatus: String(payload.execution?.status ?? 'unavailable'),
    providerFinality: String(payload.execution?.providerFinality ?? 'not_available'),
    membershipEffect: 'not_executed_by_p05',
  };
}

export async function createGovernanceCaseAudienceExport(
  prisma: any,
  input: {
    caseId: string;
    audience: 'public' | 'operator';
    actorPubkey?: string | null;
    purpose?: string | null;
    idempotencyKey?: string | null;
    now?: Date;
  },
): Promise<{ export: Record<string, unknown>; replayed: boolean }> {
  const caseId = String(input.caseId || '').trim();
  if (!caseId || caseId.length > 128) {
    throw new GovernanceCaseWorkflowError(400, 'governance_case_id_required');
  }
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx: any) => {
    const governanceCase = await tx.governanceCase.findUnique({
      where: { id: caseId },
      include: {
        homeIdentityBinding: { select: { homeType: true, homeRef: true } },
        responsibilities: { orderBy: [{ kind: 'asc' }] },
        timelineEvents: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        relatedCases: { orderBy: [{ openedAt: 'asc' }, { id: 'asc' }] },
        decisionOutputArtifacts: { orderBy: [{ ordinal: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!governanceCase) {
      throw new GovernanceCaseWorkflowError(404, 'governance_case_not_found');
    }
    let replayed = false;
    let exportedAt = now;
    if (input.audience === 'operator') {
      const actorPubkey = String(input.actorPubkey || '').trim();
      const purpose = String(input.purpose || '').trim();
      const idempotencyKey = String(input.idempotencyKey || '').trim();
      if (!actorPubkey) {
        throw new GovernanceCaseWorkflowError(401, 'governance_case_export_actor_required');
      }
      if (purpose.length < 3 || purpose.length > 500) {
        throw new GovernanceCaseWorkflowError(400, 'governance_case_export_purpose_invalid');
      }
      if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
        throw new GovernanceCaseWorkflowError(400, 'governance_case_idempotency_key_required');
      }
      const replay = governanceCase.timelineEvents.find(
        (event: any) => event.idempotencyKey === idempotencyKey,
      );
      if (replay) {
        if (
          replay.eventType !== 'case_export_recorded'
          || replay.actorPubkey !== actorPubkey
          || replay.reason !== purpose
          || replay.toState !== 'allowed'
        ) {
          throw new GovernanceCaseWorkflowError(409, 'governance_case_idempotency_conflict');
        }
        replayed = true;
        exportedAt = new Date(replay.createdAt);
      } else {
        const auditEvent = await tx.governanceCaseTimelineEvent.create({ data: {
          id: `governance_case_event:${hashCanonicalGovernanceValue(
            'alcheme.governance.case-timeline-event-id',
            { caseId, idempotencyKey },
          ).slice(0, 56)}`,
          caseId,
          eventType: 'case_export_recorded',
          responsibilityKind: null,
          actorPubkey,
          subjectPubkey: null,
          fromState: governanceCase.casePhase ?? 'intake',
          toState: 'allowed',
          reason: purpose,
          idempotencyKey,
          caseVersion: Number.isInteger(governanceCase.caseVersion)
            ? governanceCase.caseVersion
            : 0,
          responsibilityVersion: null,
          briefDraftPostId: governanceCase.briefDraftPostId,
          briefDraftVersion: governanceCase.briefDraftVersion,
          briefSnapshotDigest: governanceCase.briefSnapshotDigest,
          createdAt: now,
        } });
        governanceCase.timelineEvents.push(auditEvent);
      }
    }
    const projectedCase = projectGovernanceCase(governanceCase, null, {
      includePrivateOriginRefs: input.audience === 'operator',
      workflowAudience: input.audience,
      viewerPubkey: input.audience === 'operator' ? input.actorPubkey : null,
    });
    return {
      replayed,
      export: {
        schemaVersion: 1,
        audience: input.audience,
        exportedAt: exportedAt.toISOString(),
        case: projectedCase,
      },
    };
  });
}

function projectGovernanceCaseFieldVisibility(
  audience: 'public' | 'member' | 'operator',
  ballotDisclosure: Record<string, unknown> | null,
): GovernanceCaseFieldVisibilityDecision[] {
  if (audience === 'public') {
    return [
      visibilityDecision('case_identity', 'allow', 'open_circle_public_record'),
      visibilityDecision('origin', 'redact', 'public_source_url_only'),
      visibilityDecision('brief', 'deny', 'private_draft_authorized_members_only'),
      visibilityDecision('source_fact', 'deny', 'private_draft_authorized_members_only'),
      visibilityDecision('ai_suggestion', 'deny', 'private_draft_authorized_members_only'),
      visibilityDecision('review_opinion', 'redact', 'public_review_basis_only'),
      visibilityDecision('decision', 'allow', 'public_decision_summary'),
      visibilityDecision('execution', 'redact', 'public_execution_status_only'),
      visibilityDecision('outcome', 'redact', 'public_outcome_status_only'),
      visibilityDecision('authority', 'redact', 'public_home_subject_only'),
      visibilityDecision('artifact', 'deny', 'authorized_members_only'),
      projectRawBallotFieldVisibility(ballotDisclosure),
    ];
  }

  const audienceReason = audience === 'operator'
    ? 'authorized_circle_operator'
    : 'authorized_circle_member';
  return [
    visibilityDecision('case_identity', 'allow', audienceReason),
    visibilityDecision('origin', 'allow', audienceReason),
    visibilityDecision('brief', 'allow', audienceReason),
    visibilityDecision('source_fact', 'allow', audienceReason),
    visibilityDecision('ai_suggestion', 'allow', audienceReason),
    visibilityDecision('review_opinion', 'allow', audienceReason),
    visibilityDecision('decision', 'allow', audienceReason),
    visibilityDecision('execution', 'allow', audienceReason),
    visibilityDecision('outcome', 'allow', audienceReason),
    visibilityDecision('authority', 'allow', audienceReason),
    visibilityDecision('artifact', 'allow', audienceReason),
    projectRawBallotFieldVisibility(ballotDisclosure),
  ];
}

function visibilityDecision(
  fieldGroup: GovernanceCaseFieldGroup,
  decision: GovernanceCaseFieldVisibilityDecision['decision'],
  reason: string,
): GovernanceCaseFieldVisibilityDecision {
  return { fieldGroup, decision, reason };
}

function projectRawBallotFieldVisibility(
  ballotDisclosure: Record<string, unknown> | null,
): GovernanceCaseFieldVisibilityDecision {
  if (!ballotDisclosure) {
    return visibilityDecision('raw_ballot', 'deny', 'ballot_policy_not_available');
  }
  const visible = ballotDisclosure.state === 'visible';
  const reason = typeof ballotDisclosure.reason === 'string'
    ? ballotDisclosure.reason
    : 'ballot_policy_not_available';
  return visibilityDecision('raw_ballot', visible ? 'allow' : 'deny', reason);
}

function projectGovernanceBriefActors(value: any): Record<string, unknown> {
  const sourceMaterials = Array.isArray(value?.briefSourceMaterials)
    ? value.briefSourceMaterials
    : [];
  const snsWalletDisplayByPubkey = value?.snsWalletDisplayByPubkey
    && typeof value.snsWalletDisplayByPubkey === 'object'
    ? value.snsWalletDisplayByPubkey as Record<string, { secondarySnsLabel?: string | null }>
    : {};
  const secondaryFor = (pubkey: string | null): string | null => {
    if (!pubkey) return null;
    const label = snsWalletDisplayByPubkey[pubkey]?.secondarySnsLabel;
    return typeof label === 'string' && label.trim().toLowerCase().endsWith('.sol')
      ? label.trim()
      : null;
  };
  const externalAuthors = sourceMaterials.flatMap((material: any) => (
    Number.isSafeInteger(material?.id)
    && typeof material?.externalAuthorLabel === 'string'
    && material.externalAuthorLabel.trim()
      ? [{ sourceMaterialId: Number(material.id), label: material.externalAuthorLabel.trim() }]
      : []
  ));
  const materialSubmitters = (Array.isArray(value?.briefSourceSubmitterFacts)
    ? value.briefSourceSubmitterFacts
    : []).flatMap((material: any) => {
    if (!Number.isSafeInteger(material?.id)) return [];
    const userId = Number.isSafeInteger(material?.uploadedByUserId) && material.uploadedByUserId > 0
      ? Number(material.uploadedByUserId)
      : null;
    const pubkey = typeof material?.submittedByPubkey === 'string' && material.submittedByPubkey.trim()
      ? material.submittedByPubkey.trim()
      : null;
    return userId || pubkey
      ? [{
          sourceMaterialId: Number(material.id),
          userId,
          pubkey,
          secondarySnsLabel: secondaryFor(pubkey),
        }]
      : [];
  });
  const briefContributors = Number.isSafeInteger(value?.briefSnapshot?.createdBy)
    && value.briefSnapshot.createdBy > 0
    ? [{ userId: Number(value.briefSnapshot.createdBy), draftVersion: Number(value.briefDraftVersion) }]
    : [];
  const reviewers = (Array.isArray(value?.responsibilities) ? value.responsibilities : [])
    .flatMap((responsibility: any) => (
      responsibility?.kind === 'review'
      && typeof responsibility?.assigneePubkey === 'string'
      && responsibility.assigneePubkey.trim()
      && ['assigned', 'accepted', 'declined', 'escalated', 'absent'].includes(responsibility?.status)
        ? [{
            pubkey: responsibility.assigneePubkey.trim(),
            status: String(responsibility.status),
            secondarySnsLabel: secondaryFor(responsibility.assigneePubkey.trim()),
          }]
        : []
    ));
  return { externalAuthors, materialSubmitters, briefContributors, reviewers };
}

function projectGovernanceBriefContentHistory(value: any): Array<Record<string, unknown>> {
  if (
    !Number.isSafeInteger(value?.briefDraftPostId)
    || !isSha256Digest(value?.briefSnapshotDigest)
    || !Array.isArray(value?.briefAiAcceptanceHistory)
  ) return [];
  return value.briefAiAcceptanceHistory.flatMap((acceptance: any) => {
    const mode = acceptance?.acceptanceMode;
    if (
      !Number.isSafeInteger(acceptance?.id)
      || !Number.isSafeInteger(acceptance?.acceptedByUserId)
      || !['auto_fill', 'accept_replace', 'accept_suggestion'].includes(mode)
      || acceptance?.changed !== true
      || !isSha256Digest(acceptance?.resultingWorkingCopyHash)
      || !acceptance?.generation
    ) return [];
    try {
      const generation = toGhostDraftResultView(acceptance.generation);
      const acceptedAt = dateTime(acceptance.acceptedAt);
      const generatedAt = dateTime(generation.generatedAt);
      if (
        generation.postId !== value.briefDraftPostId
        || !acceptedAt
        || !generatedAt
        || generatedAt > acceptedAt
        || !isSha256Digest(generation.provenance.sourceDigest)
      ) return [];
      const suggestion = mode === 'accept_suggestion'
        ? generation.suggestions.find((item) => item.suggestionId === acceptance.acceptedSuggestionId)
        : null;
      if (mode === 'accept_suggestion' && !suggestion) return [];
      const content = mode === 'accept_suggestion'
        ? String(suggestion?.suggestedText || '').trim()
        : String(generation.draftText || '').trim();
      if (!content) return [];
      return [{
        id: `ghost-draft-acceptance:${acceptance.id}`,
        contentKind: mode === 'accept_suggestion' ? 'ai_suggestion' : 'ai_draft',
        aiGeneration: {
          generationId: generation.generationId,
          generatedAt,
          model: generation.model,
          sourceDigest: generation.provenance.sourceDigest,
          summary: suggestion?.summary == null ? null : String(suggestion.summary),
          content,
        },
        humanAcceptance: {
          acceptedByUserId: Number(acceptance.acceptedByUserId),
          acceptedAt,
          mode,
          resultingWorkingCopyHash: String(acceptance.resultingWorkingCopyHash),
        },
        snapshotRelation: acceptance.resultingWorkingCopyHash === value.briefSnapshotDigest
          ? 'exact_snapshot'
          : 'before_snapshot',
      }];
    } catch {
      return [];
    }
  });
}

function projectGovernanceBriefSourceCards(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((material: any) => {
    if (
      material?.originType !== 'external_url_capture'
      || typeof material?.canonicalUrl !== 'string'
      || !material.canonicalUrl.startsWith('https://')
      || typeof material?.externalAuthorLabel !== 'string'
      || !material.externalAuthorLabel.trim()
      || !isSha256Digest(material?.contentDigest)
      || !Number.isSafeInteger(material?.sourceVersion)
      || material.sourceVersion < 1
    ) {
      return [];
    }
    const sourcePublishedAt = dateTime(material.sourcePublishedAt);
    const capturedAt = dateTime(material.capturedAt);
    if (!sourcePublishedAt || !capturedAt) return [];
    const versionDiff = projectSourceMaterialVersionDiff(material.versionDiff);
    if (material.sourceVersion > 1 && (!Number.isSafeInteger(material.previousVersionId) || !versionDiff)) {
      return [];
    }
    return [{
      id: Number(material.id),
      name: String(material.name ?? ''),
      canonicalUrl: material.canonicalUrl,
      externalAuthorLabel: material.externalAuthorLabel.trim(),
      publishedAt: sourcePublishedAt,
      capturedAt,
      contentDigest: material.contentDigest,
      sourceVersion: material.sourceVersion,
      previousVersionId: material.sourceVersion > 1 ? material.previousVersionId : null,
      versionDiff,
      chunks: Array.isArray(material.chunks)
        ? material.chunks.flatMap((chunk: any) => (
            Number.isSafeInteger(chunk?.id)
            && Number.isSafeInteger(chunk?.chunkIndex)
            && isSha256Digest(chunk?.textDigest)
              ? [{ id: chunk.id, index: chunk.chunkIndex, digest: chunk.textDigest }]
              : []
          ))
        : [],
      chunkCount: Number.isSafeInteger(material.chunkCount) && material.chunkCount >= 0
        ? material.chunkCount
        : 0,
    }];
  });
}

function projectGovernanceBriefClaims(
  value: any,
  audience: 'public' | 'member' | 'operator',
): {
  claims: Array<Record<string, unknown>>;
  coverage: { total: number; supported: number; stale: number; redacted: number; unsupported: number };
} {
  const empty = { claims: [], coverage: { total: 0, supported: 0, stale: 0, redacted: 0, unsupported: 0 } };
  if (
    !value?.briefSnapshot
    || !isSha256Digest(value.briefSnapshotDigest)
    || value.briefSnapshot.contentHash !== value.briefSnapshotDigest
  ) return empty;
  const bindings = Array.isArray(value.timelineEvents)
    ? value.timelineEvents.filter((event: any) => (
        event?.eventType === 'brief_claim_evidence_bound'
        && event.briefSnapshotDigest === value.briefSnapshotDigest
      ))
    : [];
  const sourceStates = new Map<number, any>(
    (Array.isArray(value.briefClaimBindingSourceStates) ? value.briefClaimBindingSourceStates : [])
      .filter((state: any) => Number.isSafeInteger(state?.id))
      .map((state: any) => [state.id, state]),
  );
  const claims = extractGovernanceBriefClaims({
    snapshotDigest: value.briefSnapshotDigest,
    contentSnapshot: String(value.briefSnapshot.contentSnapshot || ''),
  }).map((claim) => {
    const classified: Array<{
      status: 'supported' | 'stale' | 'redacted';
      binding: Record<string, unknown> | null;
    }> = bindings
      .filter((event: any) => event.claimId === claim.id)
      .map((event: any) => classifyGovernanceBriefClaimBinding(event, claim.digest, sourceStates, audience));
    const coverageStatus = classified.some((item) => item.status === 'supported')
      ? 'supported'
      : classified.some((item) => item.status === 'redacted')
        ? 'redacted'
        : classified.some((item) => item.status === 'stale')
          ? 'stale'
          : 'unsupported';
    return {
      ...claim,
      coverageStatus,
      bindings: classified.flatMap((item) => item.binding ? [item.binding] : []),
    };
  });
  return {
    claims,
    coverage: {
      total: claims.length,
      supported: claims.filter((claim) => claim.coverageStatus === 'supported').length,
      stale: claims.filter((claim) => claim.coverageStatus === 'stale').length,
      redacted: claims.filter((claim) => claim.coverageStatus === 'redacted').length,
      unsupported: claims.filter((claim) => claim.coverageStatus === 'unsupported').length,
    },
  };
}

function classifyGovernanceBriefClaimBinding(
  event: any,
  claimDigest: string,
  sourceStates: Map<number, any>,
  audience: 'public' | 'member' | 'operator',
): { status: 'supported' | 'stale' | 'redacted'; binding: Record<string, unknown> | null } {
  const state = Number.isSafeInteger(event?.sourceMaterialId)
    ? sourceStates.get(event.sourceMaterialId)
    : null;
  const privacyClass = String(state?.evidencePrivacyClass || '');
  const lifecycleStatus = String(state?.lifecycleStatus || '');
  const accessRedacted = lifecycleStatus === 'redacted'
    || ['redacted', 'sealed'].includes(privacyClass)
    || (privacyClass === 'reviewer_only' && audience !== 'operator');
  if (accessRedacted) return { status: 'redacted', binding: null };
  const chunk = Array.isArray(state?.chunks)
    ? state.chunks.find((candidate: any) => candidate?.id === event?.sourceMaterialChunkId)
    : null;
  const valid = event?.claimDigest === claimDigest
    && Number.isSafeInteger(event?.sourceMaterialId)
    && isSha256Digest(event?.sourceMaterialDigest)
    && Number.isSafeInteger(event?.sourceMaterialChunkId)
    && isSha256Digest(event?.sourceMaterialChunkDigest)
    && state?.contentDigest === event.sourceMaterialDigest
    && chunk?.textDigest === event.sourceMaterialChunkDigest
    && SOURCE_MATERIAL_GROUNDING_STATUSES.includes(lifecycleStatus as any);
  if (!valid) return { status: 'stale', binding: null };
  return {
    status: 'supported',
    binding: {
      id: String(event.id),
      sourceMaterialId: event.sourceMaterialId,
      sourceMaterialDigest: event.sourceMaterialDigest,
      sourceMaterialChunkId: event.sourceMaterialChunkId,
      sourceMaterialChunkDigest: event.sourceMaterialChunkDigest,
      boundByPubkey: event.actorPubkey == null ? null : String(event.actorPubkey),
      boundAt: dateTime(event.createdAt),
    },
  };
}

function projectSourceMaterialVersionDiff(value: any): Record<string, unknown> | null {
  if (
    !value
    || !Number.isSafeInteger(value.previousVersion)
    || value.previousVersion < 1
    || !isSha256Digest(value.previousContentDigest)
    || !Number.isSafeInteger(value.addedChunks)
    || value.addedChunks < 0
    || !Number.isSafeInteger(value.removedChunks)
    || value.removedChunks < 0
    || !Number.isSafeInteger(value.unchangedChunks)
    || value.unchangedChunks < 0
  ) return null;
  return {
    previousVersion: value.previousVersion,
    previousContentDigest: value.previousContentDigest,
    addedChunks: value.addedChunks,
    removedChunks: value.removedChunks,
    unchangedChunks: value.unchangedChunks,
  };
}

function projectGovernanceCaseTimeline(
  value: any,
  audience: 'public' | 'member' | 'operator',
): Array<Record<string, unknown>> {
  const currentBrief = {
    draftPostId: value?.briefDraftPostId,
    draftVersion: value?.briefDraftVersion,
    snapshotDigest: value?.briefSnapshotDigest,
  };
  const caseEvents = Array.isArray(value?.timelineEvents)
    ? value.timelineEvents
        .filter((event: any) => audience !== 'public' || (
          event.eventType === 'review_conclusion_recorded'
          && event.toState !== 'signoff_granted'
          && typeof event.reviewPublicBasis === 'string'
          && event.reviewPublicBasis.trim().length >= 3
        ))
        .map((event: any) => audience === 'public'
          ? projectPublicDissentTimelineEvent(event, currentBrief)
          : projectTimelineEvent(event, currentBrief))
    : [];
  const reviewEvents = audience !== 'public' && Array.isArray(value?.reviewTimelineEvents)
    ? value.reviewTimelineEvents.map((event: DraftDiscussionTimelineEventRecord) => (
        projectDraftDiscussionTimelineEvent(event, Number(value?.briefDraftPostId))
      ))
    : [];
  return [...caseEvents, ...reviewEvents].sort((left, right) => {
    const byTime = String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? ''));
    return byTime || String(left.id ?? '').localeCompare(String(right.id ?? ''));
  });
}

function projectPublicDissentTimelineEvent(
  value: any,
  currentBrief: { draftPostId: unknown; draftVersion: unknown; snapshotDigest: unknown },
): Record<string, unknown> {
  const projected = projectTimelineEvent(value, currentBrief);
  return {
    ...projected,
    actorPubkey: null,
    subjectPubkey: null,
    reason: null,
    caseVersion: null,
    responsibilityVersion: null,
    briefDraftPostId: null,
    briefDraftVersion: null,
    briefSnapshotDigest: null,
  };
}

function projectDraftDiscussionTimelineEvent(
  value: DraftDiscussionTimelineEventRecord,
  draftPostId: number,
): Record<string, unknown> {
  const transitions: Record<DraftDiscussionTimelineEventRecord['action'], {
    eventType: string;
    fromState: string | null;
    toState: string;
  }> = {
    create: { eventType: 'review_issue_created', fromState: null, toState: 'open' },
    followup: { eventType: 'review_issue_replied', fromState: 'open', toState: 'open' },
    accept: { eventType: 'review_issue_accepted', fromState: 'proposed', toState: 'accepted' },
    reject: { eventType: 'review_issue_rejected', fromState: 'proposed', toState: 'rejected' },
    apply: { eventType: 'review_issue_applied', fromState: 'accepted', toState: 'applied' },
  };
  const transition = transitions[value.action];
  return {
    id: `draft-discussion:${value.id}`,
    eventType: transition.eventType,
    responsibilityKind: 'review',
    actorPubkey: value.actorPubkey == null ? null : String(value.actorPubkey),
    actorUserId: value.actorUserId,
    subjectPubkey: null,
    fromState: transition.fromState,
    toState: transition.toState,
    reason: null,
    caseVersion: null,
    responsibilityVersion: null,
    briefDraftPostId: draftPostId,
    briefDraftVersion: value.targetVersion,
    briefSnapshotDigest: null,
    briefSnapshotStatus: null,
    briefSnapshotInvalidationReason: null,
    reviewPublicBasis: null,
    reviewThreadId: value.threadId,
    createdAt: value.createdAt,
  };
}

function projectGovernanceCaseActualOutcome(value: any): Record<string, unknown> | null {
  const hasAnyMetadata = value?.actualOutcome != null
    || value?.actualOutcomeDigest != null
    || value?.outcomeRecordedByPubkey != null
    || value?.outcomeRecordedAt != null;
  if (!hasAnyMetadata) return null;
  try {
    const actualOutcome = normalizeGovernanceCaseActualOutcome(value.actualOutcome);
    const digest = governanceCaseActualOutcomeDigest(actualOutcome);
    if (
      digest !== value.actualOutcomeDigest
      || !value.outcomeRecordedByPubkey
      || !value.outcomeRecordedAt
    ) throw new Error('actual_outcome_integrity_invalid');
    return {
      integrity: 'verified',
      ...actualOutcome,
      digest,
      recordedByPubkey: String(value.outcomeRecordedByPubkey),
      recordedAt: dateTime(value.outcomeRecordedAt),
    };
  } catch {
    return {
      integrity: 'invalid',
      summary: null,
      quantitativeImpact: [],
      deviations: [],
      failures: [],
      outstandingObligations: [],
      observationPeriod: null,
      digest: isSha256Digest(value?.actualOutcomeDigest) ? value.actualOutcomeDigest : null,
      recordedByPubkey: null,
      recordedAt: null,
    };
  }
}

function projectGovernanceCaseBallotDisclosure(
  value: any,
  audience: 'public' | 'member' | 'operator',
  viewerPubkey: string | null,
): Record<string, unknown> | null {
  const request = value?.primaryRequest;
  if (!request?.snapshot || !value?.decisionStagePlan) return null;
  try {
    const eligibleActors = Array.isArray(request.snapshot.eligibleActors)
      ? request.snapshot.eligibleActors
      : [];
    const viewer = viewerPubkey ? canonicalSolanaPublicKeyString(viewerPubkey) : null;
    const viewerEligible = Boolean(viewer && eligibleActors.some((actor: any) => (
      canonicalSolanaPublicKeyString(String(actor?.pubkey || '')) === viewer
    )));
    const frozenRequest = {
      ...request,
      governanceCase: { decisionStagePlan: value.decisionStagePlan },
    };
    const contract = resolveFrozenNativeGovernanceMechanism(frozenRequest);
    const mode = contract.parameters.ballotDisclosure.mode;
    const terminal = Boolean(request.decision)
      && ['accepted', 'rejected', 'expired', 'cancelled'].includes(String(request.state));
    const visibility = resolveRawBallotVisibility({
      mode,
      audience,
      viewerEligible,
      terminal,
    });
    const tally = evaluateFrozenNativeGovernanceMechanism({
      request: frozenRequest,
      eligibleActors,
      signals: Array.isArray(request.signals) ? request.signals : [],
    }).tally as Record<string, any> | undefined;
    const acceptedChoices = contract.kind === 'quadratic_voice_credits'
      || contract.kind === 'quadratic_funding'
      ? Array.isArray(tally?.submissions) ? tally.submissions : []
      : Array.isArray(tally?.choices) ? tally.choices : [];
    return {
      mode,
      state: visibility.visible ? 'visible' : 'withheld',
      reason: visibility.reason,
      rawSignals: visibility.visible
        ? acceptedChoices.map((choice: any) => ({
            actorPubkey: String(choice.actorPubkey ?? ''),
            choice: contract.kind === 'quadratic_voice_credits'
              ? 'quadratic_voice_credits'
              : contract.kind === 'quadratic_funding'
                ? 'quadratic_funding'
              : String(choice.choice ?? ''),
            ...(contract.kind === 'quadratic_voice_credits'
              ? {
                choiceVector: Array.isArray(choice.choiceVector) ? choice.choiceVector : [],
                cost: Number(choice.cost ?? 0),
              }
              : {}),
            ...(contract.kind === 'quadratic_funding'
              ? {
                commitments: Array.isArray(choice.commitments) ? choice.commitments : [],
                totalCommitment: Number(choice.totalCommitment ?? 0),
              }
              : {}),
          }))
        : [],
    };
  } catch {
    return {
      mode: null,
      state: 'withheld',
      reason: 'mechanism_integrity_conflict',
      rawSignals: [],
    };
  }
}

function resolveRawBallotVisibility(input: {
  mode: NativeGovernanceMechanismContract['parameters']['ballotDisclosure']['mode'];
  audience: 'public' | 'member' | 'operator';
  viewerEligible: boolean;
  terminal: boolean;
}): { visible: boolean; reason: string } {
  if (input.mode === 'public') {
    return { visible: true, reason: 'policy_public' };
  }
  if (input.mode === 'member') {
    return input.audience === 'public'
      ? { visible: false, reason: 'circle_membership_required' }
      : { visible: true, reason: 'policy_member' };
  }
  if (input.mode === 'eligible_only') {
    return input.viewerEligible
      ? { visible: true, reason: 'frozen_electorate_eligible' }
      : { visible: false, reason: 'frozen_electorate_required' };
  }
  if (input.mode === 'aggregate_until_close') {
    return input.audience !== 'public' && input.terminal
      ? { visible: true, reason: 'ballot_closed' }
      : { visible: false, reason: input.audience === 'public'
          ? 'public_record_safe_default'
          : 'ballot_active_aggregate_only' };
  }
  return { visible: false, reason: 'provider_definition_unavailable' };
}

function projectGovernanceCaseVoteSummary(
  value: any,
  viewerPubkey: string | null,
  audience: 'public' | 'member' | 'operator',
): Record<string, unknown> | null {
  const request = value?.primaryRequest;
  if (!request?.snapshot) return null;
  const sections = audience !== 'public' && value?.briefSnapshot
    ? extractGovernanceBriefSectionBodies(String(value.briefSnapshot.contentSnapshot || ''))
    : {};
  const viewer = viewerPubkey ? canonicalSolanaPublicKeyString(viewerPubkey) : null;
  const eligibleActors = Array.isArray(request.snapshot.eligibleActors)
    ? request.snapshot.eligibleActors
    : [];
  const eligibleActor = viewer
    ? eligibleActors.find((actor: any) =>
        canonicalSolanaPublicKeyString(String(actor?.pubkey || '')) === viewer)
    : null;
  const policyRules = request.policyVersionRecord?.rules;
  const rules = policyRules && typeof policyRules === 'object' && !Array.isArray(policyRules)
    && Array.isArray((policyRules as any).rules)
    ? (policyRules as any).rules
    : [];
  const rule = rules.find((candidate: any) => candidate?.id === request.ruleId) ?? null;
  const viewerSignal = viewer
    ? (Array.isArray(request.signals) ? request.signals : []).find((signal: any) => (
        (signal?.signalType === 'committee_vote'
          || signal?.signalType === 'quadratic_voice_credits'
          || signal?.signalType === 'quadratic_funding')
        && canonicalSolanaPublicKeyString(String(signal?.actorPubkey || '')) === viewer
      )) ?? null
    : null;
  const stagePlan = value?.decisionStagePlan;
  const approvalStage = Array.isArray(stagePlan?.stages)
    ? stagePlan.stages.find((stage: any) => stage?.purpose === 'approval') ?? null
    : null;
  let mechanismVerification: ReturnType<typeof verifyFrozenNativeGovernanceMechanismResult> | null = null;
  let ballotContract: ReturnType<typeof resolveFrozenNativeGovernanceMechanism> | null = null;
  let currentTally: Record<string, any> | null = null;
  let ballotState: 'pending' | 'held' | 'terminal' = request.decision ? 'terminal' : 'pending';
  let ballotReason = request.decision ? 'terminal_decision_recorded' : 'threshold_pending';
  try {
    if (approvalStage?.mechanism) {
      const frozenRequest = {
        ...request,
        governanceCase: { decisionStagePlan: stagePlan },
      };
      ballotContract = resolveFrozenNativeGovernanceMechanism(frozenRequest);
      currentTally = (evaluateFrozenNativeGovernanceMechanism({
        request: frozenRequest,
        eligibleActors,
        signals: Array.isArray(request.signals) ? request.signals : [],
      }).tally ?? {}) as Record<string, any>;
      mechanismVerification = verifyFrozenNativeGovernanceMechanismResult({
        request: frozenRequest,
      });
      if (mechanismVerification.status === 'invalid') {
        ballotState = 'held';
        ballotReason = 'result_integrity_conflict';
      } else if (!request.decision && currentTally?.tie?.status === 'tied') {
        ballotReason = 'tie_pending_until_deadline';
      } else if (!request.decision && ballotContract.kind === 'quadratic_voice_credits') {
        ballotReason = 'awaiting_qv_signals';
      } else if (!request.decision && ballotContract.kind === 'quadratic_funding') {
        ballotReason = 'awaiting_qf_commitments';
      }
    }
  } catch {
    mechanismVerification = {
      status: 'invalid',
      contractDigest: '',
      resultDigest: null,
    };
    ballotState = 'held';
    ballotReason = 'mechanism_integrity_conflict';
  }

  return {
    requestedDecision: String(value?.requestedDecision ?? ''),
    evidence: sections.supporting_evidence ?? null,
    argumentsFor: sections.arguments_for ?? null,
    argumentsAgainst: sections.arguments_against ?? null,
    risks: sections.risks ?? null,
    rule: rule
      ? {
          id: String(rule.id ?? request.ruleId ?? ''),
          strategy: String(rule.strategy ?? ''),
          threshold: rule.threshold && typeof rule.threshold === 'object'
            ? rule.threshold
            : null,
          voteReplacement: rule.voteReplacement && typeof rule.voteReplacement === 'object'
            ? rule.voteReplacement
            : { mode: 'not_allowed', deadline: 'request_expires_at' },
        }
      : null,
    policyVersion: Number.isInteger(Number(request.policyVersion))
      ? Number(request.policyVersion)
      : null,
    snapshotDigest: String(request.snapshot.sourceDigest ?? ''),
    deadline: dateTime(request.expiresAt),
    provider: approvalStage?.provider
      ? {
          type: String(approvalStage.provider.type ?? ''),
          version: String(approvalStage.provider.version ?? ''),
        }
      : null,
    finality: ballotContract
      ? {
          source: ballotContract.finality.source,
          terminalStates: ballotContract.finality.terminalStates,
        }
      : null,
    mechanism: mechanismVerification,
    ballot: {
      state: ballotState,
      reason: ballotReason,
      choices: ballotContract?.kind === 'quadratic_voice_credits'
        ? ballotContract.inputs.signals.choiceSet
        : ballotContract?.kind === 'quadratic_funding'
          ? ballotContract.inputs.signals.projects
          : ballotContract?.inputs.signals.choices ?? [],
      quorum: currentTally?.quorum
        ? {
            numerator: Number(currentTally.quorum.numerator ?? currentTally.quorum.participation ?? 0),
            denominator: Number(currentTally.quorum.denominator ?? currentTally.eligible ?? 0),
            required: Number(currentTally.quorum.required ?? currentTally.approvalThreshold ?? 0),
            met: Boolean(currentTally.quorum.met),
          }
        : null,
      tally: currentTally && ballotContract?.kind === 'equal_weight_threshold'
        ? {
            approved: Number(currentTally.approved ?? 0),
            rejected: Number(currentTally.rejected ?? 0),
            abstained: Number(currentTally.abstained ?? 0),
            eligible: Number(currentTally.eligible ?? 0),
            ignored: Number(currentTally.ignoredSignalCount ?? 0),
          }
        : null,
      quadraticVoice: ballotContract?.kind === 'quadratic_voice_credits'
        ? {
            creditBudgetPerActor: ballotContract.parameters.creditBudgetPerActor,
            costFormula: ballotContract.parameters.costFormula,
            completion: ballotContract.parameters.completion,
            choices: currentTally?.choices ?? [],
            submitted: Number(currentTally?.submitted ?? 0),
            pending: Number(currentTally?.pending ?? eligibleActors.length),
            activationReadiness: ballotContract.provider.activationReadiness,
          }
        : null,
      quadraticFunding: ballotContract?.kind === 'quadratic_funding'
        ? {
            roundRef: ballotContract.parameters.roundRef,
            budgetUnit: ballotContract.parameters.budgetUnit,
            matchingBudget: ballotContract.parameters.matchingBudget,
            commitmentCapPerActorPerProject: ballotContract.parameters.commitmentCapPerActorPerProject,
            formula: ballotContract.parameters.formula,
            rounding: ballotContract.parameters.rounding,
            candidateSnapshot: currentTally?.candidateSnapshot ?? null,
            contributionSnapshotDigest: currentTally?.contributionSnapshotDigest ?? null,
            projects: currentTally?.projects ?? [],
            submitted: Number(currentTally?.submitted ?? 0),
            pending: Number(currentTally?.pending ?? eligibleActors.length),
            allocatedMatchingUnits: Number(currentTally?.allocatedMatchingUnits ?? 0),
            unallocatedMatchingUnits: Number(currentTally?.unallocatedMatchingUnits ?? ballotContract.parameters.matchingBudget),
            settlement: currentTally?.settlement ?? null,
            activationReadiness: ballotContract.provider.activationReadiness,
          }
        : null,
      abstention: ballotContract?.kind === 'equal_weight_threshold'
        ? ballotContract.parameters.abstention
        : null,
      tie: ballotContract?.kind === 'equal_weight_threshold'
        ? ballotContract.parameters.tie
        : null,
      earlyFinalization: ballotContract?.kind === 'equal_weight_threshold'
        ? ballotContract.parameters.earlyFinalization
        : null,
      voteHistory: ballotContract?.kind === 'equal_weight_threshold'
        ? ballotContract.parameters.voteHistory
        : null,
      deadline: ballotContract?.parameters.deadline ?? null,
      providerMapping: ballotContract?.kind === 'equal_weight_threshold'
        ? ballotContract.provider.mapping
        : null,
    },
    submission: viewerSignal
      ? {
          status: 'recorded',
          choice: String(viewerSignal.value ?? ''),
          recordedAt: dateTime(viewerSignal.createdAt),
          replacement: 'not_allowed',
          reason: 'governance_signal_replacement_not_allowed',
        }
      : {
          status: 'not_submitted',
          choice: null,
          recordedAt: null,
          replacement: 'not_allowed',
          reason: null,
        },
    eligibility: viewer
      ? eligibleActor
        ? {
            status: 'eligible',
            weight: String(eligibleActor.weight ?? '1'),
            reason: 'frozen_snapshot_eligible',
          }
        : {
            status: 'ineligible',
            weight: null,
            reason: 'not_in_frozen_electorate',
          }
      : {
          status: 'wallet_required',
          weight: null,
          reason: 'authenticated_wallet_required',
        },
  };
}

function projectCasePhase(value: any): GovernanceCasePhase {
  if (
    value?.casePhase === 'intake'
    || value?.casePhase === 'proposal_drafting'
    || value?.casePhase === 'evidence_review'
    || value?.casePhase === 'ready_for_decision'
    || value?.casePhase === 'decision_in_progress'
    || value?.casePhase === 'execution_preparation'
    || value?.casePhase === 'execution_in_progress'
    || value?.casePhase === 'outcome_review'
    || value?.casePhase === 'closed'
    || value?.casePhase === 'archived'
  ) {
    return value.casePhase;
  }
  return value?.primaryRequest
    ? governanceCasePhaseFromRequestState(value.primaryRequest.state)
    : 'intake';
}

function projectGovernanceCaseDecisionStages(value: any): Record<string, unknown> | null {
  const plan = value?.decisionStagePlan;
  if (!plan || !value?.decisionStagePlanDigest) return null;
  const digest = hashCanonicalGovernanceValue('alcheme.governance.case-decision-stage-plan', plan);
  if (digest !== value.decisionStagePlanDigest) {
    return { integrity: 'invalid', resolutionRule: null, stages: [], outcome: null };
  }
  if (!isCurrentGovernanceCaseFrozenEvidencePolicy(plan.evidencePolicy)) {
    return { integrity: 'invalid', resolutionRule: null, stages: [], outcome: null };
  }
  const timeline = Array.isArray(value.timelineEvents) ? value.timelineEvents : [];
  const stages = Array.isArray(plan.stages) ? plan.stages.map((stage: any) => {
    if (stage.purpose === 'review_gate') {
      const event = timeline.find((item: any) => item.id === stage.decisionRef?.ref);
      const current = event
        && event.eventType === 'review_conclusion_recorded'
        && event.toState === 'signoff_granted'
        && Number(event.briefDraftPostId) === Number(value.briefDraftPostId)
        && Number(event.briefDraftVersion) === Number(value.briefDraftVersion)
        && event.briefSnapshotDigest === value.briefSnapshotDigest;
      return { ...stage, state: current ? 'accepted' : 'reconciliation_required' };
    }
    return { ...stage, state: String(value.primaryRequest?.state ?? 'unavailable') };
  }) : [];
  return {
    integrity: 'verified',
    digest: value.decisionStagePlanDigest,
    resolutionRule: plan.resolutionRule,
    frozenAt: plan.frozenAt,
    evidencePolicy: plan.evidencePolicy ?? null,
    outcome: value.decisionOutcome ?? 'pending',
    stages,
  };
}

function projectGovernanceCaseDecisionAuthorityStages(value: any): Record<string, unknown> {
  const selection = value?.templateSelection;
  const selectionDigest = value?.templateSelectionDigest;
  if (!governanceCaseTemplateSelectionMatchesDigest(selection, selectionDigest)) {
    return { integrity: 'invalid', stages: [] };
  }
  const responsibility = selection.institutionalResponsibility;
  if (!isCurrentGovernanceCaseInstitutionalResponsibility(responsibility)) {
    return { integrity: 'not_frozen', stages: [] };
  }
  if (value?.decisionStagePlan || value?.decisionStagePlanDigest) {
    const decisionStages = projectGovernanceCaseDecisionStages(value) as any;
    if (decisionStages?.integrity !== 'verified' || !Array.isArray(decisionStages.stages)) {
      return { integrity: 'invalid', stages: [] };
    }
    const stages = decisionStages.stages.flatMap((stage: any) => {
      const authority = stage?.institutionalAuthority;
      if (
        !String(stage?.stageRef ?? '').trim()
        || !Number.isSafeInteger(stage?.order)
        || stage.order <= 0
        || (stage?.purpose !== 'review_gate' && stage?.purpose !== 'approval')
        || !String(authority?.type ?? '').trim()
        || !String(authority?.ref ?? '').trim()
        || !String(authority?.version ?? '').trim()
      ) return [];
      return [{
        stageRef: stage.stageRef,
        order: stage.order,
        purpose: stage.purpose,
        decisionAuthority: {
          authorityClass: authority.type === 'case_review_assignee'
            ? 'workflow_stage'
            : 'institutional',
          type: authority.type,
          ref: authority.ref,
          version: authority.version,
        },
        state: String(stage.state ?? 'unavailable'),
      }];
    });
    if (stages.length !== decisionStages.stages.length) {
      return { integrity: 'invalid', stages: [] };
    }
    return { integrity: 'verified', stages };
  }
  const primaryRequestId = String(value?.primaryRequestId ?? '').trim();
  if (!primaryRequestId) return { integrity: 'not_frozen', stages: [] };
  const request = value?.primaryRequest;
  const requestId = String(request?.id ?? '').trim();
  const scopeType = String(request?.scopeType ?? '').trim();
  const scopeRef = String(request?.scopeRef ?? '').trim();
  const policyVersionId = String(request?.policyVersionId ?? '').trim();
  const ruleId = String(request?.ruleId ?? '').trim();
  const expectedScopeType = responsibility.sourceType === 'governance_mandate'
    ? 'circle_governance_committee'
    : 'external_app_review_circle';
  if (
    requestId !== primaryRequestId
    || scopeType !== expectedScopeType
    || scopeRef !== responsibility.decidingCircleHome.ref
    || !policyVersionId
    || !ruleId
  ) return { integrity: 'invalid', stages: [] };
  return {
    integrity: 'verified',
    stages: [{
      stageRef: String(request.stageRef ?? '').trim() || primaryRequestId,
      order: 1,
      purpose: 'approval',
      decisionAuthority: {
        authorityClass: 'institutional',
        type: scopeType,
        ref: scopeRef,
        version: `${policyVersionId}:${ruleId}`,
      },
      state: String(request.state ?? 'unavailable'),
    }],
  };
}

function projectResponsibility(value: any): Record<string, unknown> {
  return {
    kind: String(value?.kind ?? ''),
    assigneePubkey: String(value?.assigneePubkey ?? ''),
    status: String(value?.status ?? ''),
    version: Number(value?.version ?? 0),
    assignedByPubkey: String(value?.assignedByPubkey ?? ''),
    assignedAt: dateTime(value?.assignedAt),
    deadlineAt: dateTime(value?.deadlineAt),
    respondedAt: dateTime(value?.respondedAt),
    reason: value?.reason == null ? null : String(value.reason),
  };
}

function projectTimelineEvent(
  value: any,
  currentBrief: { draftPostId: unknown; draftVersion: unknown; snapshotDigest: unknown },
): Record<string, unknown> {
  const isReviewConclusion = value?.eventType === 'review_conclusion_recorded';
  const reviewMatchesCurrentBrief = isReviewConclusion
    && Number(value?.briefDraftPostId) === Number(currentBrief.draftPostId)
    && Number(value?.briefDraftVersion) === Number(currentBrief.draftVersion)
    && isSha256Digest(value?.briefSnapshotDigest)
    && value.briefSnapshotDigest === currentBrief.snapshotDigest;
  return {
    id: String(value?.id ?? ''),
    eventType: String(value?.eventType ?? ''),
    responsibilityKind: value?.responsibilityKind == null
      ? null
      : String(value.responsibilityKind),
    actorPubkey: value?.actorPubkey == null ? null : String(value.actorPubkey),
    actorUserId: null,
    subjectPubkey: value?.subjectPubkey == null ? null : String(value.subjectPubkey),
    fromState: value?.fromState == null ? null : String(value.fromState),
    toState: value?.toState == null ? null : String(value.toState),
    reason: value?.reason == null ? null : String(value.reason),
    caseVersion: Number(value?.caseVersion ?? 0),
    responsibilityVersion: value?.responsibilityVersion == null
      ? null
      : Number(value.responsibilityVersion),
    responsibilityDeadlineAt: dateTime(value?.responsibilityDeadlineAt),
    briefDraftPostId: value?.briefDraftPostId == null ? null : Number(value.briefDraftPostId),
    briefDraftVersion: value?.briefDraftVersion == null ? null : Number(value.briefDraftVersion),
    briefSnapshotDigest: isSha256Digest(value?.briefSnapshotDigest)
      ? String(value.briefSnapshotDigest)
      : null,
    briefSnapshotStatus: isReviewConclusion
      ? reviewMatchesCurrentBrief ? 'current' : 'invalidated'
      : null,
    briefSnapshotInvalidationReason: isReviewConclusion && !reviewMatchesCurrentBrief
      ? 'brief_snapshot_changed'
      : null,
    reviewPublicBasis: isReviewConclusion && typeof value?.reviewPublicBasis === 'string'
      ? value.reviewPublicBasis.trim()
      : null,
    reviewThreadId: null,
    createdAt: dateTime(value?.createdAt),
  };
}

function requestedDecisionForAction(request: GovernanceRequestRecord): string {
  return `Approve ${request.actionType} for ${request.targetType}:${request.targetRef}?`;
}

function isSha256Digest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function normalizeRelationship(
  kind: unknown,
  caseId: unknown,
  reason: unknown,
): { kind: GovernanceCaseRelationshipKind | null; caseId: string | null; reason: string | null } {
  const providedKind = typeof kind === 'string' && kind.trim() ? kind.trim() : null;
  if (providedKind && providedKind !== 'related' && providedKind !== 'supersedes') {
    throw new GovernanceCaseIntakeError(400, 'governance_case_relationship_invalid');
  }
  const normalizedKind = kind === 'related' || kind === 'supersedes' ? kind : null;
  const normalizedCaseId = typeof caseId === 'string' && caseId.trim() ? caseId.trim() : null;
  if ((normalizedKind == null) !== (normalizedCaseId == null)) {
    throw new GovernanceCaseIntakeError(400, 'governance_case_relationship_invalid');
  }
  if (normalizedCaseId && normalizedCaseId.length > 128) {
    throw new GovernanceCaseIntakeError(400, 'governance_case_relationship_invalid');
  }
  const normalizedReason = typeof reason === 'string' && reason.trim() ? reason.trim() : null;
  if (normalizedKind === 'supersedes') {
    if (!normalizedReason || normalizedReason.length < 10 || normalizedReason.length > 1000) {
      throw new GovernanceCaseIntakeError(400, 'governance_case_relationship_reason_required');
    }
  } else if (normalizedReason != null) {
    throw new GovernanceCaseIntakeError(400, 'governance_case_relationship_invalid');
  }
  return { kind: normalizedKind, caseId: normalizedCaseId, reason: normalizedReason };
}

function isActiveGovernanceCase(value: any): boolean {
  if (value?.casePhase === 'closed' || value?.casePhase === 'archived') return false;
  if (!value?.casePhase && value?.primaryRequest) return value.primaryRequest.state === 'active';
  return true;
}

function isGovernanceCaseSupersedable(value: any): boolean {
  if (!value) return false;
  if (value.casePhase === 'closed' || value.casePhase === 'archived') return true;
  return ['accepted', 'rejected', 'expired', 'cancelled'].includes(value?.primaryRequest?.state);
}

function buildIntakeSuggestion(
  candidate: any,
  input: {
    title: string;
    originKind: GovernanceCaseIntakeOriginKind;
    subjectRef: string;
    sourceUrl: string | null;
  },
): GovernanceCaseIntakeSuggestion | null {
  const reasons: GovernanceCaseIntakeSuggestion['reasons'] = [];
  const externalOrigin = input.originKind === 'public_url' || input.originKind === 'external_proposal';
  if (externalOrigin && candidate.sourceUrl && candidate.sourceUrl === input.sourceUrl) {
    reasons.push('same_external_ref');
  }
  const similarity = titleSimilarity(input.title, String(candidate.title ?? ''));
  if (similarity === 1) reasons.push('same_title');
  else if (similarity >= 0.6) reasons.push('similar_title');
  if (
    isActiveGovernanceCase(candidate)
    && candidate.subjectType === 'circle'
    && String(candidate.subjectRef) === input.subjectRef
  ) {
    reasons.push('active_same_subject');
  }
  if (reasons.length === 0) return null;
  const recommendedAction = reasons.includes('same_external_ref') || reasons.includes('same_title')
    ? 'merge'
    : 'related';
  return {
    caseId: String(candidate.id),
    title: String(candidate.title ?? ''),
    phase: projectCasePhase(candidate),
    canonicalUrl: governanceCaseCanonicalPath(String(candidate.id)),
    reasons,
    recommendedAction,
  };
}

function titleSimilarity(left: string, right: string): number {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  if (Array.from(leftTokens).join(' ') === Array.from(rightTokens).join(' ')) return 1;
  const intersection = Array.from(leftTokens).filter((token) => rightTokens.has(token)).length;
  return intersection / new Set([...leftTokens, ...rightTokens]).size;
}

function titleTokens(value: string): Set<string> {
  const words = value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const tokens = new Set(words);
  for (const word of words) {
    const hanCharacters = Array.from(word).filter((character) => /\p{Script=Han}/u.test(character));
    for (let index = 0; index < hanCharacters.length - 1; index += 1) {
      tokens.add(`${hanCharacters[index]}${hanCharacters[index + 1]}`);
    }
  }
  return tokens;
}

function suggestionRank(value: GovernanceCaseIntakeSuggestion): number {
  if (value.reasons.includes('same_external_ref')) return 0;
  if (value.reasons.includes('same_title')) return 1;
  if (value.reasons.includes('similar_title')) return 2;
  return 3;
}

function requiredText(
  value: unknown,
  minLength: number,
  maxLength: number,
  code: string,
): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (normalized.length < minLength || normalized.length > maxLength) {
    throw new GovernanceCaseIntakeError(400, code);
  }
  return normalized;
}

function asIntakeRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function assertProviderAdmissionCandidateNotExpired(
  expiresAt: unknown,
  now: Date,
): void {
  if (typeof expiresAt !== 'string' || !expiresAt.trim()) return;
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now.getTime()) {
    throw new GovernanceCaseIntakeError(409, 'provider_admission_candidate_expired');
  }
}

function isIntakeOriginKind(value: unknown): value is GovernanceCaseIntakeOriginKind {
  return value === 'native_invocation'
    || value === 'manual_item'
    || value === 'plaza_selection'
    || value === 'public_url'
    || value === 'external_proposal';
}

function projectedOriginKind(value: unknown): GovernanceCaseOriginKind {
  if (
    value === 'legacy_request'
    || value === 'manual_item'
    || value === 'plaza_selection'
    || value === 'public_url'
    || value === 'external_proposal'
  ) {
    return value;
  }
  return 'native_invocation';
}

async function normalizeIntakeSource(
  prisma: any,
  input: {
    circleId: number;
    originKind: GovernanceCaseIntakeOriginKind;
    sourceMessageIds?: string[] | null;
    sourceUrl?: string | null;
    sourceInvocationId?: string | null;
    sourceReceiptId?: string | null;
    actionType?: string | null;
    subjectType: string;
    subjectRef: string;
    idempotencyKey: string;
  },
): Promise<{
  originRef: string;
  invocationId: string | null;
  sourceMessageIds: string[];
  originSnapshot: GovernanceCaseOriginSnapshot | null;
  originSnapshotDigest: string | null;
  sourceUrl: string | null;
}> {
  if (input.originKind === 'native_invocation') {
    const invocationId = String(input.sourceInvocationId ?? '').trim();
    const receiptId = String(input.sourceReceiptId ?? '').trim();
    if (!invocationId || !receiptId || !input.actionType) {
      throw new GovernanceCaseIntakeError(400, 'governance_case_native_origin_required');
    }
    const receipt = await prisma.operationReceipt.findUnique({
      where: { id: receiptId },
      include: { invocation: { include: { contractVersion: true } } },
    });
    if (
      !receipt
      || receipt.invocationId !== invocationId
      || receipt.invocation?.id !== invocationId
      || receipt.invocation?.governanceHomeType !== 'circle'
      || receipt.invocation?.governanceHomeRef !== String(input.circleId)
      || receipt.invocation?.subjectType !== input.subjectType
      || receipt.invocation?.subjectRef !== input.subjectRef
      || receipt.invocation?.contractVersion?.actionType !== input.actionType
    ) throw new GovernanceCaseIntakeError(409, 'governance_case_native_origin_mismatch');
    return {
      originRef: `operation_receipt:${receiptId}`,
      invocationId,
      sourceMessageIds: [],
      originSnapshot: null,
      originSnapshotDigest: null,
      sourceUrl: null,
    };
  }

  if (input.originKind === 'plaza_selection') {
    const requestedIds = Array.from(new Set(
      (input.sourceMessageIds ?? [])
        .map((item) => String(item ?? '').trim())
        .filter(Boolean),
    ));
    if (requestedIds.length === 0) {
      throw new GovernanceCaseIntakeError(400, 'governance_case_source_messages_required');
    }
    if (requestedIds.length > 20) {
      throw new GovernanceCaseIntakeError(400, 'governance_case_source_messages_invalid');
    }
    const loaded = await loadManualDiscussionDraftSourceMessages(prisma, {
      circleId: input.circleId,
      sourceMessageIds: requestedIds,
    });
    const sourceMessageIds = loaded.sourceMessages.map((message) => message.envelopeId);
    if (sourceMessageIds.length !== requestedIds.length || loaded.filteredSourceMessageIds.length > 0) {
      throw new GovernanceCaseIntakeError(400, 'governance_case_source_messages_invalid');
    }
    const circle = await prisma.circle.findUnique({
      where: { id: input.circleId },
      select: { id: true, circleType: true },
    });
    if (!circle || circle.id !== input.circleId || !String(circle.circleType || '').trim()) {
      throw new GovernanceCaseIntakeError(409, 'governance_case_source_visibility_unavailable');
    }
    const sources = loaded.sourceMessages.map((message) => {
      const authorPubkey = String(message.senderPubkey || '').trim();
      const payloadDigest = String(message.payloadHash || '').trim().toLowerCase();
      const clientTimestamp = message.clientTimestamp instanceof Date
        ? message.clientTimestamp
        : new Date(String(message.clientTimestamp || ''));
      if (
        !authorPubkey
        || !/^[a-f0-9]{64}$/.test(payloadDigest)
        || !Number.isFinite(clientTimestamp.getTime())
      ) {
        throw new GovernanceCaseIntakeError(409, 'governance_case_source_message_provenance_invalid');
      }
      return {
        type: 'discussion_message' as const,
        ref: message.envelopeId,
        authorPubkey,
        payloadDigest,
        lamport: message.lamport.toString(),
        clientTimestamp: clientTimestamp.toISOString(),
        messageKind: String(message.messageKind || 'plain'),
        authMode: String(message.authMode || 'unknown'),
        signatureVerified: message.signatureVerified === true,
      };
    });
    const sourceSetDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.case-origin-source-set.v1',
      { circleId: input.circleId, sources },
    );
    const originSnapshot: GovernanceCaseOriginSnapshot = {
      schemaVersion: 1,
      kind: 'plaza_message_selection',
      circleId: input.circleId,
      sourceSetDigest,
      sources,
      visibility: {
        sourceOwner: 'circle_discussion',
        circleType: String(circle.circleType),
        caseProjection: 'member_or_operator',
        contentAccess: 'not_granted_by_case',
        publicProjection: 'withheld',
      },
    };
    const originSnapshotDigest = hashCanonicalGovernanceValue(
      'alcheme.governance.case-origin-snapshot.v1',
      originSnapshot,
    );
    const digest = hashCanonicalGovernanceValue(
      'alcheme.governance.case-plaza-origin',
      { circleId: input.circleId, sourceMessageIds, originSnapshotDigest },
    );
    return {
      originRef: `plaza:${digest.slice(0, 56)}`,
      invocationId: null,
      sourceMessageIds,
      originSnapshot,
      originSnapshotDigest,
      sourceUrl: null,
    };
  }

  if (input.originKind === 'public_url' || input.originKind === 'external_proposal') {
    const sourceUrl = normalizePublicSourceUrl(input.sourceUrl);
    const digest = hashCanonicalGovernanceValue(
      'alcheme.governance.case-url-origin',
      { originKind: input.originKind, sourceUrl },
    );
    return {
      originRef: `${input.originKind}:${digest.slice(0, 56)}`,
      invocationId: null,
      sourceMessageIds: [],
      originSnapshot: null,
      originSnapshotDigest: null,
      sourceUrl,
    };
  }

  const digest = hashCanonicalGovernanceValue(
    'alcheme.governance.case-manual-origin',
    { circleId: input.circleId, idempotencyKey: input.idempotencyKey },
  );
  return {
    originRef: `manual:${digest.slice(0, 56)}`,
    invocationId: null,
    sourceMessageIds: [],
    originSnapshot: null,
    originSnapshotDigest: null,
    sourceUrl: null,
  };
}

function normalizePublicSourceUrl(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new GovernanceCaseIntakeError(400, 'governance_case_source_url_invalid');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new GovernanceCaseIntakeError(400, 'governance_case_source_url_invalid');
  }
  parsed.hash = '';
  const normalized = parsed.toString();
  if (normalized.length > 2048) {
    throw new GovernanceCaseIntakeError(400, 'governance_case_source_url_invalid');
  }
  return normalized;
}

function assertMatchingIntake(
  existing: any,
  expected: {
    title: string;
    requestedDecision: string;
    requestedActionPayload: Record<string, unknown> | null;
    subjectType: string;
    subjectRef: string;
    originKind: GovernanceCaseIntakeOriginKind;
    originRef: string;
    invocationId: string | null;
    sourceMessageIds: string[];
    originSnapshotDigest: string | null;
    sourceUrl: string | null;
    openedByPubkey: string;
    caseType: GovernanceCaseType;
    templateId: string;
    actionType: string | null;
    decisionMechanismKind: 'equal_weight_threshold' | 'quadratic_voice_credits' | 'quadratic_funding';
    quadraticVoiceChoices: unknown;
    quadraticFundingRound: unknown;
    selectionRanking: unknown;
    relationshipKind: GovernanceCaseRelationshipKind | null;
    relatedCaseId: string | null;
    relationshipReason: string | null;
  },
): void {
  const existingIds = Array.isArray(existing?.sourceMessageIds)
    ? existing.sourceMessageIds.map((item: unknown) => String(item))
    : [];
  const templateSelection = existing?.templateSelection
    && typeof existing.templateSelection === 'object'
    && !Array.isArray(existing.templateSelection)
    ? existing.templateSelection as Record<string, any>
    : {};
  const storedActionType = typeof templateSelection.actionContract?.actionType === 'string'
    ? templateSelection.actionContract.actionType
    : null;
  const storedMechanismKind = templateSelection.decisionMechanism?.kind ?? null;
  const storedQvChoices = Array.isArray(templateSelection.decisionMechanism?.choiceSet)
    ? templateSelection.decisionMechanism.choiceSet.map((choice: any) => choice?.label)
    : null;
  const expectedQvChoices = expected.decisionMechanismKind === 'quadratic_voice_credits'
    && Array.isArray(expected.quadraticVoiceChoices)
    ? expected.quadraticVoiceChoices.map((choice) => String(choice ?? '').trim())
    : null;
  const storedQfRound = storedMechanismKind === 'quadratic_funding'
    ? fundingRoundComparable(templateSelection.decisionMechanism?.round)
    : null;
  const expectedQfRound = expected.decisionMechanismKind === 'quadratic_funding'
    ? fundingRoundComparable(expected.quadraticFundingRound)
    : null;
  const storedSelectionRanking = selectionRankingComparable(templateSelection.selectionRanking);
  const expectedSelectionRanking = selectionRankingComparable(expected.selectionRanking);
  if (
    existing?.title !== expected.title
    || existing?.requestedDecision !== expected.requestedDecision
    || hashCanonicalGovernanceValue(
      'alcheme.governance.case-requested-action',
      existing?.requestedActionPayload ?? null,
    ) !== hashCanonicalGovernanceValue(
      'alcheme.governance.case-requested-action',
      expected.requestedActionPayload,
    )
    || existing?.subjectType !== expected.subjectType
    || existing?.subjectRef !== expected.subjectRef
    || existing?.originKind !== expected.originKind
    || existing?.originRef !== expected.originRef
    || (existing?.invocationId ?? null) !== expected.invocationId
    || existing?.openedByPubkey !== expected.openedByPubkey
    || existing?.caseType !== expected.caseType
    || templateSelection.templateId !== expected.templateId
    || storedActionType !== expected.actionType
    || storedMechanismKind !== (expected.caseType === 'policy' ? expected.decisionMechanismKind : null)
    || JSON.stringify(storedQvChoices) !== JSON.stringify(
      expectedQvChoices,
    )
    || JSON.stringify(storedQfRound) !== JSON.stringify(expectedQfRound)
    || JSON.stringify(storedSelectionRanking) !== JSON.stringify(expectedSelectionRanking)
    || (existing?.relationshipKind ?? null) !== expected.relationshipKind
    || (existing?.relatedCaseId ?? null) !== expected.relatedCaseId
    || (existing?.relationshipReason ?? null) !== expected.relationshipReason
    || existing?.sourceUrl !== expected.sourceUrl
    || JSON.stringify(existingIds) !== JSON.stringify(expected.sourceMessageIds)
    || (existing?.originSnapshotDigest ?? null) !== expected.originSnapshotDigest
  ) {
    throw new GovernanceCaseIntakeError(409, 'governance_case_idempotency_conflict');
  }
}

function selectionRankingComparable(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const selection = value as Record<string, any>;
  const candidateSnapshot = selection.candidateSnapshot
    && typeof selection.candidateSnapshot === 'object'
    && !Array.isArray(selection.candidateSnapshot)
    ? selection.candidateSnapshot
    : selection;
  const rawCandidates = Array.isArray(candidateSnapshot.eligibleCandidates)
    ? candidateSnapshot.eligibleCandidates
    : Array.isArray(selection.candidates) ? selection.candidates : [];
  const rawExcluded = Array.isArray(candidateSnapshot.excludedCandidates)
    ? candidateSnapshot.excludedCandidates
    : Array.isArray(selection.excludedCandidates) ? selection.excludedCandidates : [];
  return {
    seatCount: Number(selection.seatCount),
    candidates: rawCandidates.map((candidate: any) => ({
      label: String(candidate?.label ?? '').trim(),
      candidateRef: String(candidate?.candidateRef ?? '').trim(),
      score: Number(candidate?.score),
    })),
    excludedCandidates: rawExcluded.map((candidate: any) => ({
      candidateRef: String(candidate?.candidateRef ?? '').trim(),
      reason: String(candidate?.reason ?? '').trim(),
    })),
  };
}

function fundingRoundComparable(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const round = value as Record<string, any>;
  return {
    roundRef: String(round.roundRef ?? '').trim(),
    budgetUnit: String(round.budgetUnit ?? '').trim(),
    matchingBudget: Number(round.matchingBudget),
    commitmentCapPerActorPerProject: Number(round.commitmentCapPerActorPerProject),
    projects: Array.isArray(round.projects) ? round.projects.map((project: any) => ({
      label: String(project?.label ?? '').trim(),
      projectRef: String(project?.projectRef ?? '').trim(),
      recipientRef: String(project?.recipientRef ?? '').trim(),
      allocationCap: Number(project?.allocationCap),
    })) : [],
    excludedProjects: Array.isArray(round.excludedProjects)
      ? round.excludedProjects.map((project: any) => ({
          projectRef: String(project?.projectRef ?? '').trim(),
          reason: String(project?.reason ?? '').trim(),
        }))
      : [],
  };
}

function projectTemplateSelection(
  value: unknown,
  digest: unknown,
  includePrivateAuthority: boolean,
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const selection = value as Record<string, any>;
  const selectionIntegrity = governanceCaseTemplateSelectionMatchesDigest(selection, digest);
  return {
    templateId: String(selection.templateId ?? ''),
    templateVersion: Number(selection.templateVersion ?? 0),
    labelKey: String(selection.labelKey ?? ''),
    readinessState: String(selection.readinessState ?? ''),
    profile: selection.profile ?? null,
    participationPolicy: selection.participationPolicy ?? null,
    actionContract: selection.actionContract ?? null,
    actionAuthority: includePrivateAuthority ? selection.actionAuthority ?? null : null,
    institutionalResponsibility: selectionIntegrity
      && isCurrentGovernanceCaseInstitutionalResponsibility(selection.institutionalResponsibility)
      ? selection.institutionalResponsibility
      : null,
    decisionProvider: String(selection.decisionProvider ?? ''),
    decisionMechanism: selection.decisionMechanism ?? null,
    executionProvider: String(selection.executionProvider ?? ''),
    sourceProvider: String(selection.sourceProvider ?? ''),
    executionPreparation: String(selection.executionPreparation ?? ''),
    reviewPolicy: projectReviewPolicy(selection.reviewPolicy),
    outcomePolicy: projectOutcomePolicy(selection.outcomePolicy),
    digest: typeof digest === 'string' ? digest : null,
  };
}

function governanceCaseTemplateSelectionMatchesDigest(
  value: unknown,
  digest: unknown,
): value is GovernanceCaseTemplateSelection {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || typeof digest !== 'string'
    || !/^[a-f0-9]{64}$/.test(digest)
  ) return false;
  try {
    return governanceCaseTemplateSelectionDigest(value as GovernanceCaseTemplateSelection) === digest;
  } catch {
    return false;
  }
}

async function resolveGovernanceCaseIntakeMandateAuthority(
  prisma: any,
  input: {
    targetCircleId: number;
    actionType: string | null;
    authorityBindingId: string | null;
    subjectType: string;
    subjectRef: string;
    now: Date;
  },
): Promise<any> {
  if (!input.actionType) {
    throw new GovernanceCaseIntakeError(400, 'governance_case_action_contract_required');
  }
  try {
    const { resolveActiveCircleGovernanceBinding } = await import('./circleGovernanceBindings');
    const resolution = await resolveActiveCircleGovernanceBinding(prisma, {
      targetCircleId: input.targetCircleId,
      actionType: input.actionType,
      purpose: 'collective_decision',
      authorityBindingId: input.authorityBindingId,
      subjectType: input.subjectType,
      subjectRef: input.subjectRef,
      now: input.now,
    });
    const explicitSelfAuthorityHealth = input.actionType === 'circle.governance_binding.authority_health.check'
      && resolution?.binding?.id === input.authorityBindingId
      && resolution?.binding?.bindingType === 'self_governed'
      && resolution?.binding?.authoritySourceType === 'circle_governance_binding'
      && resolution?.binding?.authorityPurpose === 'collective_decision';
    const exactSelfGovernedAuthority = isExactSelfGovernedCaseAuthority(resolution, input);
    if (
      !resolution
      || (
        resolution.binding.authoritySourceType !== 'governance_mandate'
        && !explicitSelfAuthorityHealth
        && !exactSelfGovernedAuthority
      )
    ) {
      throw new GovernanceCaseIntakeError(409, 'governance_case_mandate_authority_required');
    }
    return resolution;
  } catch (error) {
    if (error instanceof GovernanceCaseIntakeError) throw error;
    if (error instanceof Error && (
      error.message.startsWith('governance_mandate_')
      || error.message.startsWith('circle_governance_')
      || error.message.startsWith('local_auxiliary_')
    )) {
      throw new GovernanceCaseIntakeError(409, 'governance_case_mandate_authority_unavailable');
    }
    throw error;
  }
}

function isExactSelfGovernedCaseAuthority(
  resolution: any,
  input: {
    targetCircleId: number;
    actionType: string | null;
    subjectType: string;
    subjectRef: string;
    authorityBindingId?: string | null;
    now: Date;
  },
): boolean {
  const binding = resolution?.binding;
  const selector = asIntakeRecord(binding?.authoritySelector);
  const limits = asIntakeRecord(binding?.authorityLimits);
  const definition = input.actionType
    ? getGovernanceCaseActionDefinition(input.actionType)
    : null;
  const effectiveFrom = binding?.authorityEffectiveFrom instanceof Date
    ? binding.authorityEffectiveFrom
    : new Date(String(binding?.authorityEffectiveFrom ?? 'invalid'));
  const effectiveUntil = binding?.authorityEffectiveUntil instanceof Date
    ? binding.authorityEffectiveUntil
    : new Date(String(binding?.authorityEffectiveUntil ?? 'invalid'));
  return Boolean(
    binding
    && selector
    && limits
    && definition?.bindingRequirement === 'exact_action_subject_purpose'
    && binding.bindingType === 'self_governed'
    && binding.status === 'active'
    && binding.targetAuthorizationStatus === 'accepted'
    && binding.committeeMandateStatus === 'accepted'
    && binding.targetCircleId === input.targetCircleId
    && binding.committeeCircleId === input.targetCircleId
    && (!input.authorityBindingId || binding.id === input.authorityBindingId)
    && binding.authoritySourceType === 'circle_governance_binding'
    && binding.authoritySourceRef === binding.id
    && String(binding.authoritySourceVersion ?? '').trim()
    && binding.authorityPurpose === 'collective_decision'
    && selector.actionType === input.actionType
    && selector.actionPrefix == null
    && selector.subjectType === input.subjectType
    && selector.subjectRef === input.subjectRef
    && selector.targetCircleId === input.targetCircleId
    && selector.environment === 'local_development'
    && typeof selector.network === 'string'
    && selector.network.length > 0
    && limits.domainBindingId === binding.id
    && limits.policyId === binding.policyId
    && limits.policyVersionId === binding.policyVersionId
    && limits.policyVersion === binding.policyVersion
    && limits.ruleId === binding.ruleId
    && !Number.isNaN(effectiveFrom.getTime())
    && !Number.isNaN(effectiveUntil.getTime())
    && effectiveFrom <= input.now
    && input.now < effectiveUntil
  );
}

function projectOutcomePolicy(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const policy = value as Record<string, unknown>;
  if (
    policy.closeSignoff !== 'accepted_outcome_reviewer'
    || policy.highImpactThreshold !== 'high'
    || policy.executorSeparation !== 'required'
  ) return null;
  return {
    closeSignoff: policy.closeSignoff,
    highImpactThreshold: policy.highImpactThreshold,
    executorSeparation: policy.executorSeparation,
  };
}

function projectReviewPolicy(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const policy = value as Record<string, unknown>;
  if (
    policy.reviewerReplacement !== 'manager_or_current_reviewer'
    || policy.appeal !== 'not_available'
    || policy.higherReviewGate !== 'review_responsibility_escalation'
  ) return null;
  return {
    reviewerReplacement: policy.reviewerReplacement,
    appeal: policy.appeal,
    higherReviewGate: policy.higherReviewGate,
  };
}

function dateTime(value: unknown): string | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002');
}
