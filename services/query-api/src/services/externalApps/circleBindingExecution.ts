import crypto from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import {
  createPrismaGovernanceEngineStore,
  recordExecutionReceipt,
  type GovernanceExecutionReceiptRecord,
} from "../governance/policyEngine";
import { hashCanonicalGovernanceValue } from "../governance/canonicalCodec";
import { buildExternalGovernedActionIntentDigest } from "../governance/externalGovernedActionRecurrence";
import { externalAppRegistryModeFromEnv } from "./chainRegistryProjection";
import {
  buildExternalAppCircleBindingEffectDigest,
} from "./circleBindings";
import {
  lockAssertClockExternalProgramRuntimeApp,
  ExternalProgramRuntimeAuthorizationError,
} from "./runtimeAuthorizationGate";
import { solanaPublicKeysEqual } from "../identity/solanaPublicKey";
import {
  buildExternalAppCircleBindingOwnerApplicationSnapshot,
  CIRCLE_BINDING_OWNER_APPLICATION_KIND,
  CIRCLE_BINDING_OWNER_APPLICATION_SOURCE,
  EXTERNAL_APP_ATTACHED_CIRCLE_BIND_ACTION,
  EXTERNAL_APP_ATTACHED_CIRCLE_REVOKE_ACTION,
  EXTERNAL_APP_PRIMARY_CIRCLE_CHANGE_ACTION,
} from "./circleBindingOwnerApplication";

export const EXTERNAL_APP_CIRCLE_BINDING_EXECUTOR =
  "external_app_circle_binding";

const PRIMARY_BIND_APPLICATION_SOURCE = "app_owner_primary_bind_request";
const PRIMARY_BIND_APPLICATION_KIND = "primary_circle_bind_application_v1";

export type ExternalAppCircleBindingOperation = "activate" | "revoke";

export interface ExternalAppCircleBindingGovernanceRequest {
  id: string;
  homeIdentityBindingId?: string | null;
  invocationId?: string | null;
  actionType: string;
  targetType: string;
  targetRef: string;
  payload?: Record<string, unknown> | null;
  proposerPubkey: string;
  idempotencyKey?: string | null;
  state: string;
  executionMode?: "legacy_action_checkpoint" | "stage_decision_only" | "provider_bound_action" | null;
  executionModeDigest?: string | null;
  compatibilityBundleVersion?: string | null;
  executionAuthorizationStatus?: string | null;
}

export async function executeExternalAppCircleBindingGovernanceAction(
  prisma: PrismaClient,
  request: ExternalAppCircleBindingGovernanceRequest,
  input?: { decisionDigest?: string | null; now?: Date },
): Promise<{
  executionStatus: "executed" | "skipped" | "failed";
  executionRef: string | null;
  errorCode?: string | null;
  receipt?: GovernanceExecutionReceiptRecord | null;
  receiptId?: string;
} | null> {
  if (request.targetType !== "external_app_circle_binding") return null;
  const decisionDigest = String(input?.decisionDigest ?? "").trim();
  if (!/^[a-f0-9]{64}$/.test(decisionDigest)) {
    return {
      executionStatus: "failed",
      executionRef: request.targetRef,
      errorCode: "governance_decision_digest_required",
    };
  }

  const binding = await (prisma as any).externalAppCircleBinding.findUnique({
    where: { id: request.targetRef },
  });
  if (!binding) {
    return {
      executionStatus: "failed",
      executionRef: request.targetRef,
      errorCode: "external_app_circle_binding_not_found",
    };
  }

  const operation = resolveExternalAppCircleBindingOperation({
    actionType: request.actionType,
    bindingKind: String(binding.bindingKind || ""),
  });
  if (!operation) {
    return {
      executionStatus: "failed",
      executionRef: binding.id,
      errorCode: "external_app_circle_binding_governance_action_mismatch",
    };
  }

  const receiptId = buildExternalAppCircleBindingExecutionReceiptId({
    requestId: request.id,
    bindingId: binding.id,
    operation,
  });
  const idempotencyKey = buildExternalAppCircleBindingExecutionIdempotencyKey({
    bindingId: binding.id,
    operation,
  });

  if (typeof (prisma as any).$transaction !== "function") {
    return {
      executionStatus: "failed",
      executionRef: binding.id,
      errorCode: "external_app_circle_binding_execution_failed",
    };
  }

  let executed;
  try {
    executed = await (prisma as any).$transaction(async (tx: any) => {
    // Lock order matches sandbox path: App then Binding (avoid ABBA deadlock).
    const unlocked = await tx.externalAppCircleBinding.findUnique({
      where: { id: binding.id },
    });
    if (!unlocked) {
      throw new Error("external_app_circle_binding_not_found");
    }
    let authorityNow = input?.now ?? new Date();
    let lockedAppOwner: string | null = null;
    let lockedAppEnvironment: string | null = null;
    if (isCircleBindingOwnerApplicationAction(request.actionType)) {
      const locked = await lockAssertClockExternalProgramRuntimeApp(tx, {
        externalAppId: String(unlocked.externalAppId || ""),
        now: input?.now,
        registryMode: externalAppRegistryModeFromEnv(),
      });
      authorityNow = locked.authorityNow;
      lockedAppOwner = String(locked.app.ownerPubkey || "");
      lockedAppEnvironment = String(locked.app.environment || "");
    }
    if (typeof tx.$queryRawUnsafe === "function") {
      await tx.$queryRawUnsafe(
        `SELECT id FROM external_app_circle_bindings WHERE id = $1 FOR UPDATE`,
        binding.id,
      );
    }
    const current = await tx.externalAppCircleBinding.findUnique({
      where: { id: binding.id },
    });
    if (!current) {
      throw new Error("external_app_circle_binding_not_found");
    }

    let applicationAuthority: CircleBindingOwnerApplicationAuthority | null = null;
    if (
      operation === "activate"
      && (
        request.actionType === "external_app_primary_circle_bind"
        || request.actionType === EXTERNAL_APP_PRIMARY_CIRCLE_CHANGE_ACTION
      )
    ) {
      applicationAuthority = await assertPrimaryCircleBindOwnerApplicationAuthority(tx, {
        binding: current,
        request,
        decisionDigest,
      });
      if (!solanaPublicKeysEqual(lockedAppOwner, applicationAuthority.requestedByPubkey)) {
        throw new ExternalProgramRuntimeAuthorizationError(
          "primary_circle_bind_application_owner_mismatch",
          409,
        );
      }
      if (String(lockedAppEnvironment || "") !== applicationAuthority.environment) {
        throw new ExternalProgramRuntimeAuthorizationError(
          "primary_circle_bind_environment_drift",
          409,
        );
      }
    } else if (
      request.actionType === EXTERNAL_APP_ATTACHED_CIRCLE_BIND_ACTION
      || request.actionType === EXTERNAL_APP_ATTACHED_CIRCLE_REVOKE_ACTION
    ) {
      applicationAuthority = await assertAttachedCircleBindingOwnerApplicationAuthority(tx, {
        binding: current,
        request,
        decisionDigest,
        operation,
      });
      if (!solanaPublicKeysEqual(lockedAppOwner, applicationAuthority.requestedByPubkey)) {
        throw new ExternalProgramRuntimeAuthorizationError(
          "external_app_circle_binding_application_owner_mismatch",
          409,
        );
      }
      if (String(lockedAppEnvironment || "") !== applicationAuthority.environment) {
        throw new ExternalProgramRuntimeAuthorizationError(
          "external_app_circle_binding_environment_drift",
          409,
        );
      }
    }

    let executionEvidence: Record<string, unknown> | null = null;
    if (isCircleBindingOwnerApplicationAction(request.actionType)) {
      if (!applicationAuthority) {
        throw new ExternalProgramRuntimeAuthorizationError(
          "external_app_circle_binding_owner_application_required",
          409,
        );
      }
      // Evidence is immutable facts only — wall-clock lives on executedAt/effectiveAt.
      executionEvidence = {
        kind: "external_app_circle_binding_effect_v1",
        operation,
        bindingDigest: String(current.bindingDigest || ""),
        bindingEffectDigest: buildExternalAppCircleBindingEffectDigest({
          bindingDigest: String(current.bindingDigest || ""),
          governanceRequestId: request.id,
          governanceDecisionDigest: decisionDigest,
          operation,
        }),
        governanceCaseId: applicationAuthority.governanceCaseId,
        applicationEpoch: applicationAuthority.applicationEpoch,
        rationaleDigest: applicationAuthority.rationaleDigest,
        candidateRef: applicationAuthority.candidateRef,
        intentDigest: applicationAuthority.intentDigest,
        requestedByPubkey: applicationAuthority.requestedByPubkey,
        requestedAt: applicationAuthority.requestedAt,
      };
    }
    const executionEvidenceDigest = executionEvidence
      ? hashCanonicalGovernanceValue(
        "alcheme.governance.execution-receipt-evidence",
        executionEvidence,
      )
      : null;

    const existingReceipt = await tx.governanceExecutionReceipt.findUnique({
      where: {
        requestId_executorModule_idempotencyKey: {
          requestId: request.id,
          executorModule: EXTERNAL_APP_CIRCLE_BINDING_EXECUTOR,
          idempotencyKey,
        },
      },
    });
    if (existingReceipt) {
      if (
        applicationAuthority?.caseState !== "accepted_replay"
        || String(existingReceipt.requestId || "") !== request.id
        || String(existingReceipt.actionType || "") !== request.actionType
        || String(existingReceipt.executorModule || "")
          !== EXTERNAL_APP_CIRCLE_BINDING_EXECUTOR
        || String(existingReceipt.executionStatus || "") !== "executed"
        || String(existingReceipt.executionRef || "") !== current.id
        || String(existingReceipt.decisionDigest || "") !== decisionDigest
        || String(existingReceipt.id || "") !== receiptId
        || String(existingReceipt.idempotencyKey || "") !== idempotencyKey
        || String(existingReceipt.executionEvidenceDigest || "")
          !== String(executionEvidenceDigest || "")
        || hashCanonicalGovernanceValue(
          "alcheme.governance.execution-receipt-evidence",
          plainObject(existingReceipt.executionEvidence),
        ) !== executionEvidenceDigest
        || String(current.governanceRequestId || "") !== request.id
        || String(current.governanceDecisionDigest || "") !== decisionDigest
        || String(current.executionReceiptId || "") !== receiptId
        || String(current.source || "") !== "governance_executed"
        || String(current.status || "")
          !== (operation === "activate" ? "active" : "revoked")
      ) {
        throw new ExternalProgramRuntimeAuthorizationError(
          "external_app_circle_binding_execution_receipt_mismatch",
          409,
        );
      }
      return {
        binding: current,
        receipt: existingReceipt as GovernanceExecutionReceiptRecord,
      };
    }

    let executedBinding;
    if (operation === "activate") {
      if (String(current.bindingKind || "").toLowerCase() === "primary") {
        await tx.externalAppCircleBinding.updateMany({
          where: {
            externalAppId: String(current.externalAppId || ""),
            bindingKind: "primary",
            status: "active",
            id: { not: current.id },
          },
          data: {
            status: "superseded",
            supersededAt: authorityNow,
          },
        });
      }
      executedBinding = await tx.externalAppCircleBinding.update({
        where: { id: current.id },
        data: {
          status: "active",
          effectiveAt: authorityNow,
          supersededAt: null,
          revokedAt: null,
          governanceRequestId: request.id,
          governanceDecisionDigest: decisionDigest,
          executionReceiptId: receiptId,
          source: "governance_executed",
        },
      });
    } else {
      executedBinding = await tx.externalAppCircleBinding.update({
        where: { id: current.id },
        data: {
          status: "revoked",
          revokedAt: authorityNow,
          governanceRequestId: request.id,
          governanceDecisionDigest: decisionDigest,
          executionReceiptId: receiptId,
          source: "governance_executed",
        },
      });
    }

    const receipt = await recordExecutionReceipt(
      createPrismaGovernanceEngineStore(tx),
      {
        id: receiptId,
        requestId: request.id,
        actionType: request.actionType,
        executorModule: EXTERNAL_APP_CIRCLE_BINDING_EXECUTOR,
        executionStatus: "executed",
        executionRef: executedBinding.id,
        errorCode: null,
        decisionDigest,
        idempotencyKey,
        executedAt: authorityNow,
        executionEvidence,
      },
    );
    return {
      binding: executedBinding,
      receipt,
    };
    });
  } catch (error) {
    if (error instanceof ExternalProgramRuntimeAuthorizationError) {
      return {
        executionStatus: "failed",
        executionRef: binding.id,
        errorCode: error.code,
      };
    }
    throw error;
  }

  return {
    executionStatus: executed.receipt.executionStatus,
    executionRef: executed.receipt.executionRef ?? executed.binding.id,
    errorCode: executed.receipt.errorCode ?? null,
    receipt: executed.receipt,
    receiptId,
  };
}

type CircleBindingOwnerApplicationAuthority = {
  requestedByPubkey: string;
  environment: string;
  governanceCaseId: string;
  applicationEpoch: number;
  rationaleDigest: string;
  candidateRef: string;
  intentDigest: string;
  requestedAt: string;
  caseState: "live_decision" | "accepted_replay";
};

async function assertPrimaryCircleBindOwnerApplicationAuthority(
  tx: any,
  input: {
    binding: any;
    request: ExternalAppCircleBindingGovernanceRequest;
    decisionDigest: string;
  },
): Promise<CircleBindingOwnerApplicationAuthority> {
  const meta = input.binding.metadata && typeof input.binding.metadata === "object"
    && !Array.isArray(input.binding.metadata)
    ? input.binding.metadata as Record<string, unknown>
    : null;
  const application = meta?.application && typeof meta.application === "object"
    && !Array.isArray(meta.application)
    ? meta.application as Record<string, unknown>
    : null;
  if (!application || application.kind !== PRIMARY_BIND_APPLICATION_KIND || application.frozen !== true) {
    throw new ExternalProgramRuntimeAuthorizationError(
      "primary_circle_bind_application_required",
      409,
    );
  }
  if (application.actionType !== input.request.actionType) {
    throw new ExternalProgramRuntimeAuthorizationError(
      "primary_circle_bind_application_action_mismatch",
      409,
    );
  }
  const requestedByPubkey = typeof application.requestedByPubkey === "string"
    ? application.requestedByPubkey.trim()
    : "";
  const environment = typeof application.environment === "string"
    ? application.environment.trim()
    : "";
  const candidateRef = typeof application.candidateRef === "string"
    ? application.candidateRef.trim()
    : "";
  const rationaleDigest = typeof application.rationaleDigest === "string"
    ? application.rationaleDigest.trim()
    : "";
  const requestedAt = typeof application.requestedAt === "string"
    ? application.requestedAt.trim()
    : "";
  const applicationEpoch = Number(application.applicationEpoch);
  const expectedCandidateRef = `${String(input.binding.externalAppId || "").trim()}:${Number(input.binding.circleId)}:primary`;
  if (
    !requestedByPubkey
    || !environment
    || candidateRef !== expectedCandidateRef
    || !/^[a-f0-9]{64}$/.test(rationaleDigest)
    || !requestedAt
    || Number.isNaN(Date.parse(requestedAt))
    || !Number.isSafeInteger(applicationEpoch)
    || applicationEpoch < 1
  ) {
    throw new ExternalProgramRuntimeAuthorizationError(
      "primary_circle_bind_application_required",
      409,
    );
  }
  const governanceCaseId = typeof meta?.governanceCaseId === "string"
    ? meta.governanceCaseId.trim()
    : "";
  if (!governanceCaseId) {
    throw new ExternalProgramRuntimeAuthorizationError(
      "primary_circle_bind_governance_case_required",
      409,
    );
  }
  if (typeof tx.governanceCase?.findUnique !== "function") {
    throw new ExternalProgramRuntimeAuthorizationError(
      "primary_circle_bind_governance_case_required",
      503,
    );
  }
  const governanceCase = await tx.governanceCase.findUnique({
    where: { id: governanceCaseId },
    select: {
      id: true,
      subjectType: true,
      subjectRef: true,
      decisionOutcome: true,
      casePhase: true,
      primaryRequestId: true,
      requestedActionPayload: true,
    },
  });
  if (!governanceCase) {
    throw new ExternalProgramRuntimeAuthorizationError(
      "primary_circle_bind_governance_case_missing",
      409,
    );
  }
  if (
    governanceCase.subjectType !== "external_app_circle_binding"
    || String(governanceCase.subjectRef || "") !== String(input.binding.id)
  ) {
    throw new ExternalProgramRuntimeAuthorizationError(
      "primary_circle_bind_governance_case_subject_mismatch",
      409,
    );
  }
  if (String(governanceCase.primaryRequestId || "") !== String(input.request.id)) {
    throw new ExternalProgramRuntimeAuthorizationError(
      "primary_circle_bind_governance_request_mismatch",
      409,
    );
  }

  const casePayload = governanceCase.requestedActionPayload
    && typeof governanceCase.requestedActionPayload === "object"
    && !Array.isArray(governanceCase.requestedActionPayload)
    ? governanceCase.requestedActionPayload as Record<string, unknown>
    : null;
  const operationPayload = casePayload?.operationPayload
    && typeof casePayload.operationPayload === "object"
    && !Array.isArray(casePayload.operationPayload)
    ? casePayload.operationPayload as Record<string, unknown>
    : null;
  const statePrecondition = casePayload?.statePrecondition
    && typeof casePayload.statePrecondition === "object"
    && !Array.isArray(casePayload.statePrecondition)
    ? casePayload.statePrecondition as Record<string, unknown>
    : null;
  const provenance = casePayload?.candidateProvenance
    && typeof casePayload.candidateProvenance === "object"
    && !Array.isArray(casePayload.candidateProvenance)
    ? casePayload.candidateProvenance as Record<string, unknown>
    : null;
  const frozenIntentDigest = typeof provenance?.intentDigest === "string"
    ? provenance.intentDigest.trim()
    : "";
  const frozenRationaleDigest = typeof provenance?.applicationRationaleDigest === "string"
    ? provenance.applicationRationaleDigest.trim()
    : "";
  const frozenCandidateRef = typeof provenance?.candidateRef === "string"
    ? provenance.candidateRef.trim()
    : "";
  const frozenSnapshotVersion = typeof provenance?.snapshotVersion === "string"
    ? provenance.snapshotVersion.trim()
    : "";
  const frozenSnapshotDigest = typeof provenance?.snapshotDigest === "string"
    ? provenance.snapshotDigest.trim()
    : "";
  const recurrenceEpoch = Number(provenance?.recurrenceEpoch);
  const expectedSnapshotVersion = `primary-circle-bind:v1:${candidateRef}`;
  const expectedSnapshotDigest = crypto
    .createHash("sha256")
    .update(candidateRef, "utf8")
    .digest("hex");
  const operationKeys = operationPayload ? Object.keys(operationPayload).sort() : [];
  const statePreconditionKeys = statePrecondition
    ? Object.keys(statePrecondition).sort()
    : [];
  // No Binding-metadata fallback: Case-frozen provenance is the sole authority.
  if (
    String(casePayload?.bindingId || "") !== String(input.binding.id)
    || operationKeys.join("|")
      !== "bindingCandidateRef|bindingKind|circleId|externalAppId"
    || String(operationPayload?.externalAppId || "")
      !== String(input.binding.externalAppId || "")
    || Number(operationPayload?.circleId) !== Number(input.binding.circleId)
    || String(operationPayload?.bindingKind || "") !== "primary"
    || String(operationPayload?.bindingCandidateRef || "") !== candidateRef
    || statePreconditionKeys.join("|") !== "bindingKind|bindingStatus"
    || String(statePrecondition?.bindingStatus || "") !== "pending"
    || String(statePrecondition?.bindingKind || "") !== "primary"
    || !/^[a-f0-9]{64}$/.test(frozenRationaleDigest)
    || frozenRationaleDigest !== rationaleDigest
    || String(provenance?.applicationRequestedByPubkey || "") !== requestedByPubkey
    || String(provenance?.applicationRequestedAt || "") !== requestedAt
    || Number(provenance?.applicationEpoch) !== applicationEpoch
    || !Number.isSafeInteger(recurrenceEpoch)
    || recurrenceEpoch < 1
    || frozenCandidateRef !== candidateRef
    || frozenSnapshotVersion !== expectedSnapshotVersion
    || frozenSnapshotDigest !== expectedSnapshotDigest
    || !/^[a-f0-9]{64}$/.test(frozenIntentDigest)
  ) {
    throw new ExternalProgramRuntimeAuthorizationError(
      "primary_circle_bind_frozen_application_mismatch",
      409,
    );
  }
  const recomputedIntentDigest = buildExternalGovernedActionIntentDigest({
    expectedSnapshotVersion: frozenSnapshotVersion,
    expectedSnapshotDigest: frozenSnapshotDigest,
    requestedActionPayload: operationPayload!,
    statePrecondition: statePrecondition!,
    rationaleDigest: frozenRationaleDigest,
  });
  if (recomputedIntentDigest !== frozenIntentDigest) {
    throw new ExternalProgramRuntimeAuthorizationError(
      "primary_circle_bind_frozen_application_mismatch",
      409,
    );
  }

  // Live: Case pending in decision_in_progress while Request/Decision already accepted.
  // Replay: Case accepted and still in outcome_review/closed (idempotent effect).
  const caseOutcome = String(governanceCase.decisionOutcome || "");
  const casePhase = String(governanceCase.casePhase || "");
  const liveDecisionExecution = caseOutcome === "pending"
    && casePhase === "decision_in_progress";
  const acceptedCaseReplay = caseOutcome === "accepted"
    && (casePhase === "outcome_review" || casePhase === "closed");
  if (!liveDecisionExecution && !acceptedCaseReplay) {
    throw new ExternalProgramRuntimeAuthorizationError(
      "primary_circle_bind_governance_case_not_ready",
      409,
    );
  }
  if (liveDecisionExecution) {
    if (typeof tx.externalAppCircleBinding?.findFirst !== "function") {
      throw new ExternalProgramRuntimeAuthorizationError(
        "primary_circle_bind_active_primary_lookup_unavailable",
        503,
      );
    }
    const competingPrimary = await tx.externalAppCircleBinding.findFirst({
      where: {
        externalAppId: String(input.binding.externalAppId || ""),
        bindingKind: "primary",
        status: "active",
        id: { not: String(input.binding.id) },
      },
      select: { id: true },
    });
    const expectsChange = input.request.actionType === EXTERNAL_APP_PRIMARY_CIRCLE_CHANGE_ACTION;
    if (Boolean(competingPrimary) !== expectsChange) {
      throw new ExternalProgramRuntimeAuthorizationError(
        "primary_circle_bind_application_action_state_mismatch",
        409,
      );
    }
  }
  const bindingSource = String(input.binding.source || "");
  const bindingStatus = String(input.binding.status || "");
  if (
    (liveDecisionExecution
      && (bindingSource !== PRIMARY_BIND_APPLICATION_SOURCE || bindingStatus !== "pending"))
    || (acceptedCaseReplay
      && (bindingSource !== "governance_executed" || bindingStatus !== "active"))
  ) {
    throw new ExternalProgramRuntimeAuthorizationError(
      "primary_circle_bind_legacy_application_quarantined",
      409,
    );
  }

  if (typeof tx.governanceRequest?.findUnique !== "function") {
    throw new ExternalProgramRuntimeAuthorizationError(
      "primary_circle_bind_governance_request_required",
      503,
    );
  }
  const authoritativeRequest = await tx.governanceRequest.findUnique({
    where: { id: input.request.id },
    select: {
      id: true,
      state: true,
      actionType: true,
      targetType: true,
      targetRef: true,
      caseRef: true,
      payload: true,
      decision: { select: { decision: true, decisionDigest: true } },
    },
  });
  if (
    !authoritativeRequest
    || String(authoritativeRequest.state || "") !== "accepted"
    || String(authoritativeRequest.actionType || "") !== input.request.actionType
    || String(authoritativeRequest.targetType || "") !== "external_app_circle_binding"
    || String(authoritativeRequest.targetRef || "") !== String(input.binding.id)
    || String(authoritativeRequest.caseRef || "") !== governanceCaseId
    || String(authoritativeRequest.decision?.decision || "") !== "accepted"
    || String(authoritativeRequest.decision?.decisionDigest || "") !== input.decisionDigest
  ) {
    throw new ExternalProgramRuntimeAuthorizationError(
      "primary_circle_bind_governance_request_mismatch",
      409,
    );
  }
  const authoritativeRequestPayload = authoritativeRequest.payload
    && typeof authoritativeRequest.payload === "object"
    && !Array.isArray(authoritativeRequest.payload)
    ? authoritativeRequest.payload as Record<string, unknown>
    : null;
  const inputRequestPayload = input.request.payload
    && typeof input.request.payload === "object"
    && !Array.isArray(input.request.payload)
    ? input.request.payload as Record<string, unknown>
    : null;
  const caseFrozenPayloadDigest = primaryCircleBindFrozenPayloadDigest(casePayload);
  if (
    !authoritativeRequestPayload
    || !inputRequestPayload
    || primaryCircleBindFrozenPayloadDigest(authoritativeRequestPayload)
      !== caseFrozenPayloadDigest
    || primaryCircleBindFrozenPayloadDigest(inputRequestPayload)
      !== caseFrozenPayloadDigest
  ) {
    throw new ExternalProgramRuntimeAuthorizationError(
      "primary_circle_bind_governance_request_mismatch",
      409,
    );
  }

  if (typeof tx.externalGovernedActionRecurrenceReservation?.findFirst !== "function") {
    throw new ExternalProgramRuntimeAuthorizationError(
      "primary_circle_bind_recurrence_reservation_required",
      503,
    );
  }
  const reservation = await tx.externalGovernedActionRecurrenceReservation.findFirst({
    where: {
      actionType: input.request.actionType,
      subjectType: "external_app_circle_binding",
      subjectRef: String(input.binding.id),
      recurrenceEpoch,
      governanceCaseId,
    },
    select: {
      actionType: true,
      subjectType: true,
      subjectRef: true,
      recurrenceEpoch: true,
      intentDigest: true,
      governanceCaseId: true,
    },
  });
  if (
    !reservation
    || String(reservation.actionType || "") !== input.request.actionType
    || String(reservation.subjectType || "") !== "external_app_circle_binding"
    || String(reservation.subjectRef || "") !== String(input.binding.id)
    || Number(reservation.recurrenceEpoch) !== recurrenceEpoch
    || String(reservation.governanceCaseId || "") !== governanceCaseId
    || String(reservation.intentDigest || "") !== frozenIntentDigest
  ) {
    throw new ExternalProgramRuntimeAuthorizationError(
      "primary_circle_bind_recurrence_reservation_mismatch",
      409,
    );
  }

  return {
    requestedByPubkey,
    environment,
    governanceCaseId,
    applicationEpoch,
    rationaleDigest,
    candidateRef,
    intentDigest: frozenIntentDigest,
    requestedAt,
    caseState: liveDecisionExecution ? "live_decision" : "accepted_replay",
  };
}

function primaryCircleBindFrozenPayloadDigest(
  payload: Record<string, unknown> | null,
): string {
  return hashCanonicalGovernanceValue(
    "alcheme.external-app.primary-circle-bind-frozen-payload",
    {
      bindingId: payload?.bindingId,
      operationPayload: payload?.operationPayload,
      statePrecondition: payload?.statePrecondition,
      candidateProvenance: payload?.candidateProvenance,
    },
  );
}

async function assertAttachedCircleBindingOwnerApplicationAuthority(
  tx: any,
  input: {
    binding: any;
    request: ExternalAppCircleBindingGovernanceRequest;
    decisionDigest: string;
    operation: ExternalAppCircleBindingOperation;
  },
): Promise<CircleBindingOwnerApplicationAuthority> {
  const metadata = plainObject(input.binding.metadata);
  const application = plainObject(metadata.application);
  const expectedAction = input.operation === "activate"
    ? EXTERNAL_APP_ATTACHED_CIRCLE_BIND_ACTION
    : EXTERNAL_APP_ATTACHED_CIRCLE_REVOKE_ACTION;
  const requestedByPubkey = optionalString(application.requestedByPubkey) ?? "";
  const environment = optionalString(application.environment) ?? "";
  const requestedAt = optionalString(application.requestedAt) ?? "";
  const rationaleDigest = optionalString(application.rationaleDigest) ?? "";
  const candidateRef = optionalString(application.candidateRef) ?? "";
  const snapshotVersion = optionalString(application.snapshotVersion) ?? "";
  const snapshotDigest = optionalString(application.snapshotDigest) ?? "";
  const applicationEpoch = Number(application.applicationEpoch);
  const governanceCaseId = optionalString(metadata.governanceCaseId) ?? "";
  if (
    application.kind !== CIRCLE_BINDING_OWNER_APPLICATION_KIND
    || application.actionType !== expectedAction
    || input.request.actionType !== expectedAction
    || application.frozen !== true
    || !requestedByPubkey
    || !environment
    || !requestedAt
    || Number.isNaN(Date.parse(requestedAt))
    || !/^[a-f0-9]{64}$/.test(rationaleDigest)
    || !Number.isSafeInteger(applicationEpoch)
    || applicationEpoch < 1
    || !governanceCaseId
  ) {
    throw new ExternalProgramRuntimeAuthorizationError(
      "external_app_circle_binding_owner_application_required",
      409,
    );
  }
  const snapshotBinding = input.operation === "revoke"
    ? { ...input.binding, status: "active" }
    : input.binding;
  const recomputedSnapshot = buildExternalAppCircleBindingOwnerApplicationSnapshot({
    actionType: expectedAction,
    binding: snapshotBinding,
  });
  if (
    candidateRef !== recomputedSnapshot.candidateRef
    || snapshotVersion !== recomputedSnapshot.snapshotVersion
    || snapshotDigest !== recomputedSnapshot.snapshotDigest
  ) {
    throw new ExternalProgramRuntimeAuthorizationError(
      "external_app_circle_binding_application_snapshot_mismatch",
      409,
    );
  }
  if (typeof tx.governanceCase?.findUnique !== "function") {
    throw new ExternalProgramRuntimeAuthorizationError(
      "external_app_circle_binding_governance_case_required",
      503,
    );
  }
  const governanceCase = await tx.governanceCase.findUnique({
    where: { id: governanceCaseId },
    select: {
      id: true,
      subjectType: true,
      subjectRef: true,
      decisionOutcome: true,
      casePhase: true,
      primaryRequestId: true,
      requestedActionPayload: true,
    },
  });
  if (
    !governanceCase
    || governanceCase.subjectType !== "external_app_circle_binding"
    || String(governanceCase.subjectRef || "") !== String(input.binding.id)
    || String(governanceCase.primaryRequestId || "") !== input.request.id
  ) {
    throw new ExternalProgramRuntimeAuthorizationError(
      "external_app_circle_binding_governance_case_mismatch",
      409,
    );
  }
  const casePayload = plainObject(governanceCase.requestedActionPayload);
  const operationPayload = plainObject(casePayload.operationPayload);
  const statePrecondition = plainObject(casePayload.statePrecondition);
  const provenance = plainObject(casePayload.candidateProvenance);
  const frozenIntentDigest = optionalString(provenance.intentDigest) ?? "";
  const recurrenceEpoch = Number(provenance.recurrenceEpoch);
  const operationKeys = Object.keys(operationPayload).sort().join("|");
  const stateKeys = Object.keys(statePrecondition).sort().join("|");
  if (
    String(casePayload.bindingId || "") !== String(input.binding.id)
    || operationKeys !== "bindingCandidateRef|bindingKind|circleId|externalAppId|operation"
    || String(operationPayload.externalAppId || "") !== String(input.binding.externalAppId)
    || Number(operationPayload.circleId) !== Number(input.binding.circleId)
    || operationPayload.bindingKind !== "attached"
    || operationPayload.bindingCandidateRef !== candidateRef
    || operationPayload.operation !== input.operation
    || stateKeys !== "bindingDigest|bindingKind|bindingStatus"
    || statePrecondition.bindingKind !== "attached"
    || statePrecondition.bindingStatus !== (input.operation === "activate" ? "pending" : "active")
    || statePrecondition.bindingDigest !== String(input.binding.bindingDigest || "")
    || provenance.candidateRef !== candidateRef
    || provenance.snapshotVersion !== snapshotVersion
    || provenance.snapshotDigest !== snapshotDigest
    || provenance.applicationRequestedByPubkey !== requestedByPubkey
    || provenance.applicationRequestedAt !== requestedAt
    || provenance.applicationRationaleDigest !== rationaleDigest
    || Number(provenance.applicationEpoch) !== applicationEpoch
    || !Number.isSafeInteger(recurrenceEpoch)
    || recurrenceEpoch < 1
    || !/^[a-f0-9]{64}$/.test(frozenIntentDigest)
  ) {
    throw new ExternalProgramRuntimeAuthorizationError(
      "external_app_circle_binding_frozen_application_mismatch",
      409,
    );
  }
  const recomputedIntentDigest = buildExternalGovernedActionIntentDigest({
    expectedSnapshotVersion: snapshotVersion,
    expectedSnapshotDigest: snapshotDigest,
    requestedActionPayload: operationPayload,
    statePrecondition,
    rationaleDigest,
  });
  if (recomputedIntentDigest !== frozenIntentDigest) {
    throw new ExternalProgramRuntimeAuthorizationError(
      "external_app_circle_binding_frozen_application_mismatch",
      409,
    );
  }
  const caseOutcome = String(governanceCase.decisionOutcome || "");
  const casePhase = String(governanceCase.casePhase || "");
  const liveDecisionExecution = caseOutcome === "pending"
    && casePhase === "decision_in_progress";
  const acceptedCaseReplay = caseOutcome === "accepted"
    && (casePhase === "outcome_review" || casePhase === "closed");
  const liveStatus = input.operation === "activate" ? "pending" : "active";
  const replayStatus = input.operation === "activate" ? "active" : "revoked";
  if (
    (!liveDecisionExecution && !acceptedCaseReplay)
    || (liveDecisionExecution && String(input.binding.status) !== liveStatus)
    || (input.operation === "activate"
      && liveDecisionExecution
      && String(input.binding.source) !== CIRCLE_BINDING_OWNER_APPLICATION_SOURCE)
    || (acceptedCaseReplay
      && (
        String(input.binding.status) !== replayStatus
        || String(input.binding.source) !== "governance_executed"
      ))
  ) {
    throw new ExternalProgramRuntimeAuthorizationError(
      "external_app_circle_binding_governance_case_not_ready",
      409,
    );
  }
  if (typeof tx.governanceRequest?.findUnique !== "function") {
    throw new ExternalProgramRuntimeAuthorizationError(
      "external_app_circle_binding_governance_request_required",
      503,
    );
  }
  const authoritativeRequest = await tx.governanceRequest.findUnique({
    where: { id: input.request.id },
    select: {
      id: true,
      state: true,
      actionType: true,
      targetType: true,
      targetRef: true,
      caseRef: true,
      payload: true,
      decision: { select: { decision: true, decisionDigest: true } },
    },
  });
  const casePayloadDigest = circleBindingFrozenPayloadDigest(casePayload);
  if (
    !authoritativeRequest
    || authoritativeRequest.state !== "accepted"
    || authoritativeRequest.actionType !== expectedAction
    || authoritativeRequest.targetType !== "external_app_circle_binding"
    || String(authoritativeRequest.targetRef) !== String(input.binding.id)
    || authoritativeRequest.caseRef !== governanceCaseId
    || authoritativeRequest.decision?.decision !== "accepted"
    || authoritativeRequest.decision?.decisionDigest !== input.decisionDigest
    || circleBindingFrozenPayloadDigest(plainObject(authoritativeRequest.payload))
      !== casePayloadDigest
    || circleBindingFrozenPayloadDigest(plainObject(input.request.payload))
      !== casePayloadDigest
  ) {
    throw new ExternalProgramRuntimeAuthorizationError(
      "external_app_circle_binding_governance_request_mismatch",
      409,
    );
  }
  if (typeof tx.externalGovernedActionRecurrenceReservation?.findFirst !== "function") {
    throw new ExternalProgramRuntimeAuthorizationError(
      "external_app_circle_binding_recurrence_reservation_required",
      503,
    );
  }
  const reservation = await tx.externalGovernedActionRecurrenceReservation.findFirst({
    where: {
      actionType: expectedAction,
      subjectType: "external_app_circle_binding",
      subjectRef: String(input.binding.id),
      recurrenceEpoch,
      governanceCaseId,
    },
    select: {
      actionType: true,
      subjectType: true,
      subjectRef: true,
      recurrenceEpoch: true,
      intentDigest: true,
      governanceCaseId: true,
    },
  });
  if (
    !reservation
    || reservation.actionType !== expectedAction
    || reservation.subjectType !== "external_app_circle_binding"
    || String(reservation.subjectRef) !== String(input.binding.id)
    || Number(reservation.recurrenceEpoch) !== recurrenceEpoch
    || reservation.governanceCaseId !== governanceCaseId
    || reservation.intentDigest !== frozenIntentDigest
  ) {
    throw new ExternalProgramRuntimeAuthorizationError(
      "external_app_circle_binding_recurrence_reservation_mismatch",
      409,
    );
  }
  return {
    requestedByPubkey,
    environment,
    governanceCaseId,
    applicationEpoch,
    rationaleDigest,
    candidateRef,
    intentDigest: frozenIntentDigest,
    requestedAt,
    caseState: liveDecisionExecution ? "live_decision" : "accepted_replay",
  };
}

function circleBindingFrozenPayloadDigest(
  payload: Record<string, unknown>,
): string {
  return hashCanonicalGovernanceValue(
    "alcheme.external-app.circle-binding-frozen-payload",
    {
      bindingId: payload.bindingId,
      operationPayload: payload.operationPayload,
      statePrecondition: payload.statePrecondition,
      candidateProvenance: payload.candidateProvenance,
    },
  );
}

function isCircleBindingOwnerApplicationAction(actionType: string): boolean {
  return actionType === "external_app_primary_circle_bind"
    || actionType === EXTERNAL_APP_PRIMARY_CIRCLE_CHANGE_ACTION
    || actionType === EXTERNAL_APP_ATTACHED_CIRCLE_BIND_ACTION
    || actionType === EXTERNAL_APP_ATTACHED_CIRCLE_REVOKE_ACTION;
}

export function isSandboxExternalAppCircleBinding(binding: any): boolean {
  return (
    String(binding?.environment || "")
      .trim()
      .toLowerCase() === "sandbox"
  );
}

export function buildExternalAppCircleBindingExecutionIdempotencyKey(input: {
  bindingId: string;
  operation: ExternalAppCircleBindingOperation;
}): string {
  const raw = `${EXTERNAL_APP_CIRCLE_BINDING_EXECUTOR}:${input.operation}:${input.bindingId}`;
  if (raw.length <= 128) return raw;
  const digest = crypto.createHash("sha256").update(raw).digest("hex");
  return `${EXTERNAL_APP_CIRCLE_BINDING_EXECUTOR}:${input.operation}:${digest}`;
}

export function buildExternalAppCircleBindingExecutionReceiptId(input: {
  requestId: string;
  bindingId: string;
  operation: ExternalAppCircleBindingOperation;
}): string {
  const raw = `external-app-binding:${input.requestId}:${input.bindingId}:${input.operation}`;
  if (raw.length <= 96) return raw;
  const digest = crypto
    .createHash("sha256")
    .update(raw)
    .digest("hex")
    .slice(0, 20);
  return `external-app-binding:${digest}:${input.operation}`;
}

function resolveExternalAppCircleBindingOperation(input: {
  actionType: string;
  bindingKind: string;
}): ExternalAppCircleBindingOperation | null {
  const actionType = input.actionType.trim();
  const bindingKind = input.bindingKind.trim().toLowerCase();
  if (bindingKind === "primary") {
    if (
      actionType === "external_app_primary_circle_bind" ||
      actionType === "external_app_primary_circle_change"
    ) {
      return "activate";
    }
    return null;
  }
  if (bindingKind === "attached") {
    if (actionType === "external_app_attached_circle_bind") return "activate";
    if (actionType === "external_app_attached_circle_revoke") return "revoke";
  }
  return null;
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
