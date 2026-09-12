import { authenticatedApiFetch } from "@/lib/api/fetch";
import { resolveNodeRoute } from "@/lib/api/nodeRouting";
import {
  normalizeGovernedActionAppealNoAggravationBoundary,
  normalizeGovernedActionAppealRoutingReadback,
  type GovernedActionAppealNoAggravationBoundary,
  type GovernedActionAppealRoutingReadback,
} from "@/lib/api/governedActionAppealBoundary";

export interface CommunicationSessionResponse {
  ok: boolean;
  sessionId: string;
  walletPubkey: string;
  scopeType: "room";
  scopeRef: string;
  expiresAt: string;
  communicationAccessToken: string;
  signatureVerified?: boolean;
  room?: CircleCommunicationRoom;
}

export interface CommunicationSessionBootstrapPayload {
  v: 1;
  action: "communication_session_init";
  walletPubkey: string;
  scopeType: "room";
  scopeRef: string;
  clientTimestamp: string;
  nonce: string;
}

export interface CircleRoomVoicePolicyResponse {
  ok: boolean;
  room: CircleCommunicationRoom;
}

export interface CircleCommunicationRoom {
  roomKey: string;
  metadata?: {
    voicePolicy?: {
      maxSpeakers: number;
      overflowStrategy: string;
      source: string;
    };
  } | null;
}

export interface ModerationReport {
  schemaVersion: 1;
  reportKind: "member_moderation" | "operator_misconduct";
  id: string;
  circleId: number;
  roomKey: string;
  reporter: { visibility: string; pubkey: string | null };
  subject: { type: "communication_room_member" | "governed_operator_capability"; ref: string; snapshotDigest: string };
  reasonCode: string;
  sealedEvidence: { statement: string; digest: string; visibility: string };
  reporterStatus: {
    state: "received" | "triaged" | "action_taken" | "no_violation" | "transferred" | "closed";
    updatedAt: string;
    closedAt: string | null;
    detailVisibility: "status_only_subject_private_outcome_withheld";
    reporterRightsImpact: "none_report_triage_is_not_governed_action";
  };
  triage: null | {
    ownerPubkey: string | null;
    slaAt: string;
    status: "submitted" | "triaged" | "closed";
    priority: "low" | "normal" | "high" | "urgent";
    duplicateOfReportId: string | null;
    abuseSignal: "none" | "suspected" | "confirmed";
    resolutionKind: "action_taken" | "no_violation" | "transferred" | "closed" | null;
    resolutionReceiptId: string | null;
    closedAt: string | null;
  };
  actionPreflight: {
    actionType: "communication.member.mute" | "operator.capability.suspend";
    subjectType: "communication_room_member" | "governed_operator_capability";
    subjectRef: string;
    scope: string;
    reasonCode: string;
    maximumDurationSeconds: 86400;
    expiry: "scheduler_and_read_reconciliation";
    notification: "subject_notification_and_canonical_state_readback";
    appeal: "canonical_operation_receipt_window";
    automaticExecution: "forbidden";
    availability: "available_separate_manual_action" | "available_separate_temporary_governed_action";
    authority: "separate_exact_governed_invocation_required";
  };
  operatorMisconduct: null | {
    targetOperatorPubkey: string;
    targetActionType: string;
    targetSubjectType: string;
    targetSubjectRef: string;
    triageStatus: "blocked_no_independent_authority";
    reportedOperatorAccess: "forbidden";
    reportedCommitteeAccess: "forbidden";
    automaticSuspension: "forbidden";
  };
  minimumShare: null | {
    caseId: string;
    packageId: string;
    status: "requested" | "authorized" | "denied" | "revoked";
    purpose: "moderation_case_review_only";
    digest: string;
    expiresAt: string | null;
  };
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface TemporaryCommunicationMuteResult {
  replayed: boolean;
  member: {
    roomKey: string;
    walletPubkey: string;
    muted: boolean;
    banned: boolean;
    mutedAt: string | null;
    muteExpiresAt: string | null;
    muteNoticeAvailableAt: string | null;
  };
  receipt: {
    id: string;
    subjectRef: string;
    reasonCode: string;
    appealWindowEndsAt: string;
    receiptDigest: string;
  };
  contract: {
    contractVersion: "communication-member-temporary-mute-current";
    durationSeconds: number;
    maximumDurationSeconds: 86400;
    expiresAt: string;
    automaticExpiry: "scheduler_and_read_reconciliation";
    notification: "subject_notification_and_canonical_state_readback";
    reviewTiming: "pre_execution" | "post_execution_ratification";
    ratification: {
      required: boolean;
      caseOwner: "governance_case" | null;
      deadline: string | null;
      originalOperatorEligible: false;
      onRejectOrTimeout: "expire_and_unmute_exact_member" | "not_applicable";
    };
    appeal: "canonical_operation_receipt_window";
  };
  ratificationCase: null | { id: string; url: string; deadline: string };
}

export interface CommunicationRestrictionAppealAccess {
  access: "canonical_subject_wallet_session";
  membershipRequired: false;
  grantsOtherCirclePermissions: false;
  resolutionBoundary: GovernedActionAppealNoAggravationBoundary;
  action: "temporary_communication_mute" | "temporary_communication_message_hide";
  scope: unknown;
  publicSafeReason: string;
  policy: Record<string, string | number>;
  deadline: string;
  routing: GovernedActionAppealRoutingReadback;
  reporter: { visibility: "redacted" };
  evidence: { visibility: "appellant_and_independent_resolver_only" };
  status: "available" | "expired" | "open" | "resolved" | "governance_case_pending" | "blocked_no_independent_authority";
  canSubmit: boolean;
  appeal: null | {
    id: string;
    state: string;
    resolutionPath: "independent_review" | "governance_case_appeal_resolution";
    governanceCaseRef: string | null;
    governanceCaseUrl: string | null;
    appealResolutionArtifactRef: string | null;
    openedAt: string;
    resolution: null | { outcome: string; resolvedAt: string };
  };
}

export interface EffectiveCommunicationSubjectRestrictionState {
  subject: { type: "communication_member"; circleId: number; walletPubkey: string };
  composition: {
    source: "canonical_operation_effects";
    rule: "cumulative_scope_with_risk_floor_priority";
    persistedProjection: false;
  };
  status: "clear" | "restricted" | "restored";
  activeEffectCount: number;
  activeEffects: Array<{
    actionType: "communication.member.mute" | "communication.message.hide";
    subjectType: "communication_room_member" | "communication_message";
    subjectRef: string;
    targetRef: string;
    priority: { source: "governed_action_risk_floor"; riskFloor: "low" | "medium" | "high" | "critical"; rank: number };
    scope: unknown;
    expiresAt: string;
    authority: {
      bindingId: string;
      sourceType: string;
      sourceRef: string;
      sourceVersion: string | null;
      policyVersionRef: string;
    };
    receipt: { id: string; receiptDigest: string };
    effect: { id: string; state: string; authorityCanReleaseOnlyThisEffect: true };
    appeal: {
      ref: string;
      deadline: string;
      routing: GovernedActionAppealRoutingReadback;
      status: string;
      canSubmit: boolean;
      id: string | null;
    };
  }>;
}

export interface CommunicationModerationState {
  member: TemporaryCommunicationMuteResult["member"];
  effectiveRestrictionState: EffectiveCommunicationSubjectRestrictionState;
  restriction: null | {
    type: "temporary_communication_mute";
    scope: string;
    reasonCode: string;
    mutedAt: string;
    expiresAt: string;
    noticeAvailableAt: string;
    receipt: TemporaryCommunicationMuteResult["receipt"];
    effect: {
      id: string;
      state: string;
      events: Array<{ sequence: number; toState: string; reasonCode: string; occurredAt: string }>;
    };
    ratification: {
      required: boolean;
      caseId: string | null;
      caseUrl: string | null;
      deadline: string | null;
      status: string;
    };
    appealAccess: CommunicationRestrictionAppealAccess & {
      action: "temporary_communication_mute";
      scope: string;
      policy: {
        contractVersion: string;
        durationSeconds: number;
        maximumDurationSeconds: number;
        automaticExpiry: string;
        appeal: string;
      };
    };
  };
}

export interface ModerationOutcomeReadback {
  schemaVersion: 1;
  circleId: number;
  scope: {
    actionTypes: Array<"communication.member.mute" | "communication.message.hide">;
    source: "canonical_operation_receipt_effect_and_appeal_resolution";
    visibility: "circle_member_aggregate_no_actor_subject_reason_or_evidence";
  };
  actions: {
    total: number;
    byType: Record<"communication.member.mute" | "communication.message.hide", number>;
    repeated: number;
    recurrenceRateBps: number;
  };
  appeals: {
    opened: number;
    pending: number;
    resolved: number;
    privacyStatus: "available" | "insufficient_sample";
    minimumSampleSize: number;
    minimumDistinctSubjects: number;
    outcomes: null | {
      uphold: number;
      modify: number;
      revoke: number;
      expiredWithoutMeritsDecision: number;
    };
    correctedActionCount: number | null;
    correctedActionRateBps: number | null;
    duration: null | { averageSeconds: number; medianSeconds: number };
  };
  operatorConcentration: {
    privacyStatus: "available" | "insufficient_sample";
    minimumSampleSize: number;
    minimumDistinctOperators: number;
    distinctOperatorCount: number | null;
    topOperatorShareBps: number | null;
  };
  incentiveBoundary: "moderation_volume_is_never_contribution_or_performance";
}

export interface TemporaryCommunicationMessageHideResult {
  replayed: boolean;
  message: {
    envelopeId: string;
    roomKey: string;
    hidden: boolean;
    hiddenAt: string | null;
    hideExpiresAt: string | null;
    reasonCode: string | null;
    evidenceDigest: string | null;
    deleted: boolean;
  };
  receipt: TemporaryCommunicationMuteResult["receipt"];
  contract: {
    contractVersion: "communication-message-hide-current";
    durationSeconds: number;
    maximumDurationSeconds: 86400;
    expiresAt: string;
    scope: "circle_room_member_read_surface";
    publicProjection: "redacted_while_hidden";
    restore: "scheduler_and_read_reconciliation";
    notification: "subject_notification_and_canonical_state_readback";
    appeal: "canonical_operation_receipt_window";
    delete: "forbidden_separate_high_risk_retention_contract";
  };
}

export interface CommunicationMessageHideState {
  message: TemporaryCommunicationMessageHideResult["message"];
  effectiveRestrictionState: EffectiveCommunicationSubjectRestrictionState | null;
  restriction: null | {
    type: "temporary_communication_message_hide";
    scope: "circle_room_member_read_surface";
    reasonCode: string;
    expiresAt: string;
    noticeAvailableAt: string;
    receipt: TemporaryCommunicationMuteResult["receipt"];
    effect: { id: string; state: string; events: Array<{ sequence: number; toState: string; reasonCode: string; occurredAt: string }> };
    evidenceDigest: string;
    publicProjection: "redacted_while_hidden";
    delete: "not_executed";
    appealAccess: CommunicationRestrictionAppealAccess & {
      action: "temporary_communication_message_hide";
      scope: "circle_room_member_read_surface";
      policy: {
        contractVersion: string;
        durationSeconds: number;
        maximumDurationSeconds: number;
        restore: string;
        notification: string;
        appeal: string;
        delete: string;
      };
    };
  };
}

export async function executeTemporaryCommunicationMessageHide(input: {
  circleId: number | string;
  envelopeId: string;
  reasonCode: string;
  durationSeconds: number;
  idempotencyKey: string;
}): Promise<TemporaryCommunicationMessageHideResult> {
  const circleId = String(input.circleId).trim();
  const route = await resolveNodeRoute("communication_runtime");
  const response = await authenticatedApiFetch(
    `${route.urlBase}/api/v1/communication/circles/${encodeURIComponent(circleId)}/operator-actions/message-hide`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw buildRequestError(response, payload, "temporary message hide failed");
  if (payload?.contract?.contractVersion !== "communication-message-hide-current"
    || payload?.contract?.durationSeconds !== input.durationSeconds
    || payload?.contract?.maximumDurationSeconds !== 86400
    || payload?.contract?.publicProjection !== "redacted_while_hidden"
    || payload?.contract?.notification !== "subject_notification_and_canonical_state_readback"
    || payload?.contract?.appeal !== "canonical_operation_receipt_window"
    || payload?.contract?.delete !== "forbidden_separate_high_risk_retention_contract"
    || payload?.message?.envelopeId !== input.envelopeId
    || payload?.message?.deleted !== false
    || (payload?.message?.hidden !== true && payload?.replayed !== true)
    || !/^[a-f0-9]{64}$/.test(String(payload?.message?.evidenceDigest ?? ""))
    || !String(payload?.receipt?.id ?? "")) {
    throw new Error("temporary_message_hide_readback_invalid");
  }
  return payload as TemporaryCommunicationMessageHideResult;
}

export async function fetchCommunicationMessageHideState(input: {
  circleId: number | string;
  envelopeId: string;
}): Promise<CommunicationMessageHideState> {
  const circleId = String(input.circleId).trim();
  const route = await resolveNodeRoute("communication_runtime");
  const response = await authenticatedApiFetch(
    `${route.urlBase}/api/v1/communication/circles/${encodeURIComponent(circleId)}/messages/${encodeURIComponent(input.envelopeId)}/moderation-state`,
    { method: "GET", cache: "no-store" },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw buildRequestError(response, payload, "message hide state failed");
  if (payload?.state?.message?.envelopeId !== input.envelopeId
    || payload?.state?.message?.roomKey !== `circle:${Number(circleId)}`
    || typeof payload?.state?.message?.deleted !== "boolean") {
    throw new Error("message_hide_state_readback_invalid");
  }
  if (payload.state.restriction) {
    if (payload.state.restriction.type !== "temporary_communication_message_hide"
      || payload.state.restriction.receipt?.subjectRef !== `${Number(circleId)}:${input.envelopeId}`
      || payload.state.restriction.appealAccess?.action !== "temporary_communication_message_hide") {
      throw new Error("message_hide_restriction_readback_invalid");
    }
    normalizeGovernedActionAppealNoAggravationBoundary(
      payload.state.restriction.appealAccess.resolutionBoundary,
    );
    normalizeCommunicationAppealRouting(
      payload.state.restriction.appealAccess.routing,
      Number(circleId),
    );
  }
  if (payload.state.effectiveRestrictionState) {
    validateEffectiveCommunicationRestrictionState(
      payload.state.effectiveRestrictionState,
      Number(circleId),
    );
  }
  return payload.state as CommunicationMessageHideState;
}

export async function executeTemporaryCommunicationMute(input: {
  circleId: number | string;
  targetMemberPubkey: string;
  reasonCode: string;
  durationSeconds: number;
  reviewTiming: "pre_execution" | "post_execution_ratification";
  idempotencyKey: string;
}): Promise<TemporaryCommunicationMuteResult> {
  const circleId = String(input.circleId).trim();
  const route = await resolveNodeRoute("communication_runtime");
  const response = await authenticatedApiFetch(
    `${route.urlBase}/api/v1/communication/circles/${encodeURIComponent(circleId)}/operator-actions/member-mute`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, muted: true }),
    },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw buildRequestError(response, payload, "temporary communication mute failed");
  if (payload?.contract?.contractVersion !== "communication-member-temporary-mute-current"
    || payload?.contract?.maximumDurationSeconds !== 86400
    || payload?.contract?.durationSeconds !== input.durationSeconds
    || payload?.contract?.reviewTiming !== input.reviewTiming
    || payload?.contract?.ratification?.required
      !== (input.reviewTiming === "post_execution_ratification")
    || (payload?.member?.muted !== true && payload?.replayed !== true)
    || !String(payload?.receipt?.id || "")
    || payload?.receipt?.subjectRef !== `${Number(circleId)}:${input.targetMemberPubkey}`) {
    throw new Error("temporary_communication_mute_readback_invalid");
  }
  return payload as TemporaryCommunicationMuteResult;
}

export async function fetchCommunicationModerationState(
  circleIdInput: number | string,
): Promise<CommunicationModerationState> {
  const circleId = String(circleIdInput).trim();
  const route = await resolveNodeRoute("communication_runtime");
  const response = await authenticatedApiFetch(
    `${route.urlBase}/api/v1/communication/circles/${encodeURIComponent(circleId)}/moderation-state`,
    { method: "GET", cache: "no-store" },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw buildRequestError(response, payload, "communication moderation state failed");
  if (!payload?.state?.member || payload.state.member.roomKey !== `circle:${Number(circleId)}`) {
    throw new Error("communication_moderation_state_readback_invalid");
  }
  validateEffectiveCommunicationRestrictionState(
    payload.state.effectiveRestrictionState,
    Number(circleId),
  );
  if (payload.state.restriction) {
    normalizeGovernedActionAppealNoAggravationBoundary(
      payload.state.restriction.appealAccess?.resolutionBoundary,
    );
    normalizeCommunicationAppealRouting(
      payload.state.restriction.appealAccess?.routing,
      Number(circleId),
    );
  }
  return payload.state as CommunicationModerationState;
}

function validateEffectiveCommunicationRestrictionState(
  value: any,
  circleId: number,
): asserts value is EffectiveCommunicationSubjectRestrictionState {
  const effects = value?.activeEffects;
  if (Array.isArray(effects)) {
    effects.forEach((effect: any) => {
      normalizeCommunicationAppealRouting(effect?.appeal?.routing, circleId);
    });
  }
  if (value?.subject?.type !== "communication_member"
    || value.subject.circleId !== circleId
    || value?.composition?.source !== "canonical_operation_effects"
    || value.composition.rule !== "cumulative_scope_with_risk_floor_priority"
    || value.composition.persistedProjection !== false
    || !["clear", "restricted", "restored"].includes(value?.status)
    || !Number.isSafeInteger(value?.activeEffectCount)
    || !Array.isArray(effects)
    || effects.length !== value.activeEffectCount
    || (effects.length > 0) !== (value.status === "restricted")
    || effects.some((effect: any) => (
      !["communication.member.mute", "communication.message.hide"].includes(effect?.actionType)
      || !String(effect?.authority?.bindingId ?? "")
      || !String(effect?.receipt?.id ?? "")
      || !/^[a-f0-9]{64}$/.test(String(effect?.receipt?.receiptDigest ?? ""))
      || !String(effect?.effect?.id ?? "")
      || effect?.effect?.authorityCanReleaseOnlyThisEffect !== true
      || !Number.isSafeInteger(effect?.priority?.rank)
      || !String(effect?.expiresAt ?? "")
      || !String(effect?.appeal?.ref ?? "")
    ))) {
    throw new Error("effective_communication_restriction_state_invalid");
  }
}

function normalizeCommunicationAppealRouting(value: any, circleId: number) {
  const routing = normalizeGovernedActionAppealRoutingReadback(value);
  const expectedPath = `/api/v1/communication/circles/${circleId}/moderation-state/appeals`;
  if (routing.selectedChannel !== "operator_misconduct"
    || routing.channels.operatorMisconduct.submission?.path !== expectedPath) {
    throw new Error("communication_appeal_routing_readback_invalid");
  }
  return routing;
}

export async function fetchModerationOutcomes(
  circleIdInput: number | string,
): Promise<ModerationOutcomeReadback> {
  const circleId = Number(String(circleIdInput).trim());
  const route = await resolveNodeRoute("communication_runtime");
  const response = await authenticatedApiFetch(
    `${route.urlBase}/api/v1/communication/circles/${encodeURIComponent(circleId)}/moderation-outcomes`,
    { method: "GET", cache: "no-store" },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw buildRequestError(response, payload, "moderation outcomes read failed");
  const value = payload?.outcomes;
  const validInteger = (candidate: unknown) => Number.isSafeInteger(candidate) && Number(candidate) >= 0;
  const validBps = (candidate: unknown) => validInteger(candidate) && Number(candidate) <= 10_000;
  const expectedBps = (numerator: number, denominator: number) => (
    denominator === 0 ? 0 : Math.round((numerator / denominator) * 10_000)
  );
  const actionTypes = value?.scope?.actionTypes;
  const byType = value?.actions?.byType;
  const appealOutcomes = value?.appeals?.outcomes;
  const duration = value?.appeals?.duration;
  if (
    value?.schemaVersion !== 1
    || value?.circleId !== circleId
    || !Array.isArray(actionTypes)
    || actionTypes.length !== 2
    || actionTypes[0] !== "communication.member.mute"
    || actionTypes[1] !== "communication.message.hide"
    || value?.scope?.source !== "canonical_operation_receipt_effect_and_appeal_resolution"
    || value?.scope?.visibility !== "circle_member_aggregate_no_actor_subject_reason_or_evidence"
    || value?.incentiveBoundary !== "moderation_volume_is_never_contribution_or_performance"
    || !validInteger(value?.actions?.total)
    || !validInteger(byType?.["communication.member.mute"])
    || !validInteger(byType?.["communication.message.hide"])
    || byType["communication.member.mute"] + byType["communication.message.hide"] !== value.actions.total
    || !validInteger(value?.actions?.repeated)
    || value.actions.repeated > value.actions.total
    || !validBps(value?.actions?.recurrenceRateBps)
    || value.actions.recurrenceRateBps !== expectedBps(value.actions.repeated, value.actions.total)
    || !validInteger(value?.appeals?.opened)
    || !validInteger(value?.appeals?.pending)
    || !validInteger(value?.appeals?.resolved)
    || value.appeals.pending + value.appeals.resolved !== value.appeals.opened
    || value.appeals.opened > value.actions.total
    || value.appeals.minimumSampleSize !== 5
    || value.appeals.minimumDistinctSubjects !== 3
    || value.operatorConcentration?.minimumSampleSize !== 5
    || value.operatorConcentration?.minimumDistinctOperators !== 3
    || !["available", "insufficient_sample"].includes(value?.appeals?.privacyStatus)
    || !["available", "insufficient_sample"].includes(value?.operatorConcentration?.privacyStatus)
    || (value.appeals.privacyStatus === "available" && (
      value.appeals.resolved < 5
      || !appealOutcomes
      || !validInteger(appealOutcomes.uphold)
      || !validInteger(appealOutcomes.modify)
      || !validInteger(appealOutcomes.revoke)
      || !validInteger(appealOutcomes.expiredWithoutMeritsDecision)
      || appealOutcomes.uphold + appealOutcomes.modify + appealOutcomes.revoke
        + appealOutcomes.expiredWithoutMeritsDecision !== value.appeals.resolved
      || value.appeals.correctedActionCount !== appealOutcomes.modify + appealOutcomes.revoke
      || value.appeals.correctedActionRateBps !== expectedBps(
        value.appeals.correctedActionCount,
        value.appeals.resolved,
      )
      || !duration
      || !validInteger(duration.averageSeconds)
      || !validInteger(duration.medianSeconds)
    ))
    || (value.appeals.privacyStatus === "insufficient_sample" && (
      value.appeals.resolved >= 5
      || appealOutcomes !== null
      || value.appeals.correctedActionCount !== null
      || value.appeals.correctedActionRateBps !== null
      || duration !== null
    ))
    || (value.operatorConcentration.privacyStatus === "available"
      && (value.actions.total < 5
        || !validInteger(value.operatorConcentration.distinctOperatorCount)
        || value.operatorConcentration.distinctOperatorCount < 3
        || value.operatorConcentration.distinctOperatorCount > value.actions.total
        || !validBps(value.operatorConcentration.topOperatorShareBps)))
    || (value.operatorConcentration.privacyStatus === "insufficient_sample"
      && (value.actions.total >= 5
        || value.operatorConcentration.distinctOperatorCount !== null
        || value.operatorConcentration.topOperatorShareBps !== null))
  ) throw new Error("moderation_outcome_readback_invalid");
  return {
    schemaVersion: 1,
    circleId,
    scope: {
      actionTypes: ["communication.member.mute", "communication.message.hide"],
      source: "canonical_operation_receipt_effect_and_appeal_resolution",
      visibility: "circle_member_aggregate_no_actor_subject_reason_or_evidence",
    },
    actions: {
      total: value.actions.total,
      byType: {
        "communication.member.mute": byType["communication.member.mute"],
        "communication.message.hide": byType["communication.message.hide"],
      },
      repeated: value.actions.repeated,
      recurrenceRateBps: value.actions.recurrenceRateBps,
    },
    appeals: {
      opened: value.appeals.opened,
      pending: value.appeals.pending,
      resolved: value.appeals.resolved,
      privacyStatus: value.appeals.privacyStatus,
      minimumSampleSize: 5,
      minimumDistinctSubjects: 3,
      outcomes: appealOutcomes,
      correctedActionCount: value.appeals.correctedActionCount,
      correctedActionRateBps: value.appeals.correctedActionRateBps,
      duration,
    },
    operatorConcentration: {
      privacyStatus: value.operatorConcentration.privacyStatus,
      minimumSampleSize: 5,
      minimumDistinctOperators: 3,
      distinctOperatorCount: value.operatorConcentration.distinctOperatorCount,
      topOperatorShareBps: value.operatorConcentration.topOperatorShareBps,
    },
    incentiveBoundary: "moderation_volume_is_never_contribution_or_performance",
  };
}

export async function submitCommunicationModerationAppeal(input: {
  circleId: number | string;
  originalReceiptId: string;
  reasonCode: string;
  counterStatement: string;
}): Promise<{ replayed: boolean; appeal: NonNullable<CommunicationModerationState["restriction"]>["appealAccess"]["appeal"] }> {
  const circleId = String(input.circleId).trim();
  const route = await resolveNodeRoute("communication_runtime");
  const response = await authenticatedApiFetch(
    `${route.urlBase}/api/v1/communication/circles/${encodeURIComponent(circleId)}/moderation-state/appeals`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originalReceiptId: input.originalReceiptId,
        reasonCode: input.reasonCode,
        evidence: { counterStatement: input.counterStatement },
      }),
    },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw buildRequestError(response, payload, "moderation appeal submit failed");
  if (!String(payload?.appeal?.id ?? "")
    || payload.appeal.originalReceiptId !== input.originalReceiptId
    || !["independent_review", "governance_case_appeal_resolution"].includes(payload.appeal.resolutionPath)) {
    throw new Error("communication_moderation_appeal_readback_invalid");
  }
  return { replayed: payload.replayed === true, appeal: payload.appeal };
}

export async function submitModerationReport(input: {
  circleId: number | string;
  targetMemberPubkey: string;
  reporterVisibility: "withheld_from_subject" | "institutional_actor";
  reasonCode: "spam" | "harassment" | "credible_safety_risk" | "impersonation" | "other";
  evidenceStatement: string;
  idempotencyKey: string;
}): Promise<{ replayed: boolean; report: ModerationReport }> {
  const circleId = String(input.circleId).trim();
  const route = await resolveNodeRoute("communication_runtime");
  const response = await authenticatedApiFetch(
    `${route.urlBase}/api/v1/communication/circles/${encodeURIComponent(circleId)}/moderation-reports`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw buildRequestError(response, payload, "moderation report submit failed");
  return normalizeModerationReportMutation(payload, Number(circleId), "reporter");
}

export async function submitOperatorMisconductReport(input: {
  circleId: number | string;
  targetOperatorPubkey: string;
  targetActionType: string;
  targetSubjectType: string;
  targetSubjectRef: string;
  reasonCode: "spam" | "harassment" | "credible_safety_risk" | "impersonation" | "other";
  evidenceStatement: string;
  idempotencyKey: string;
}): Promise<{ replayed: boolean; report: ModerationReport }> {
  const circleId = String(input.circleId).trim();
  const route = await resolveNodeRoute("communication_runtime");
  const response = await authenticatedApiFetch(
    `${route.urlBase}/api/v1/communication/circles/${encodeURIComponent(circleId)}/operator-misconduct-reports`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw buildRequestError(response, payload, "operator misconduct report submit failed");
  return normalizeModerationReportMutation(payload, Number(circleId), "reporter");
}

export async function fetchModerationReports(circleIdInput: number | string): Promise<{
  canTriage: boolean;
  reports: ModerationReport[];
}> {
  const circleId = String(circleIdInput).trim();
  const route = await resolveNodeRoute("communication_runtime");
  const response = await authenticatedApiFetch(
    `${route.urlBase}/api/v1/communication/circles/${encodeURIComponent(circleId)}/moderation-reports`,
    { method: "GET", cache: "no-store" },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw buildRequestError(response, payload, "moderation report read failed");
  if (payload?.schemaVersion !== 1 || Number(payload?.circleId) !== Number(circleId) || !Array.isArray(payload?.reports)) {
    throw new Error("moderation_report_readback_invalid");
  }
  return {
    canTriage: payload.canTriage === true,
    reports: payload.reports.map((value: unknown) => normalizeModerationReport(
      value,
      Number(circleId),
      payload.canTriage === true ? "triage" : "reporter",
    )),
  };
}

export async function triageModerationReport(input: {
  circleId: number | string;
  reportId: string;
  expectedVersion: number;
  transition: "triage" | "resolve";
  priority: NonNullable<ModerationReport["triage"]>["priority"];
  abuseSignal: NonNullable<ModerationReport["triage"]>["abuseSignal"];
  duplicateOfReportId?: string | null;
  resolutionKind?: NonNullable<ModerationReport["triage"]>["resolutionKind"];
  actionReceiptId?: string | null;
}): Promise<ModerationReport> {
  const circleId = String(input.circleId).trim();
  const route = await resolveNodeRoute("communication_runtime");
  const response = await authenticatedApiFetch(
    `${route.urlBase}/api/v1/communication/circles/${encodeURIComponent(circleId)}/moderation-reports/${encodeURIComponent(input.reportId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw buildRequestError(response, payload, "moderation report triage failed");
  return normalizeModerationReportMutation(payload, Number(circleId), "triage").report;
}

export async function delegateModerationReportMinimumShare(input: {
  circleId: number | string;
  reportId: string;
  idempotencyKey: string;
}): Promise<{
  replayed: boolean;
  caseId: string;
  caseUrl: string;
  package: {
    id: string;
    purpose: "moderation_case_review_only";
    status: "authorized";
    digest: string;
    expiresAt: string;
  };
}> {
  const circleId = String(input.circleId).trim();
  const route = await resolveNodeRoute("communication_runtime");
  const response = await authenticatedApiFetch(
    `${route.urlBase}/api/v1/communication/circles/${encodeURIComponent(circleId)}/moderation-reports/${encodeURIComponent(input.reportId)}/minimum-share`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idempotencyKey: input.idempotencyKey }),
    },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw buildRequestError(response, payload, "moderation report minimum share failed");
  if (
    !String(payload?.caseId ?? "")
    || payload?.caseUrl !== `/governance/cases/${encodeURIComponent(String(payload.caseId))}`
    || !String(payload?.package?.id ?? "")
    || payload?.package?.purpose !== "moderation_case_review_only"
    || payload?.package?.status !== "authorized"
    || !/^[a-f0-9]{64}$/.test(String(payload?.package?.digest ?? ""))
    || Number.isNaN(new Date(payload?.package?.expiresAt).getTime())
  ) throw new Error("moderation_report_minimum_share_readback_invalid");
  return payload;
}

function normalizeModerationReportMutation(
  value: any,
  circleId: number,
  audience: "reporter" | "triage",
): {
  replayed: boolean;
  report: ModerationReport;
} {
  return {
    replayed: value?.replayed === true,
    report: normalizeModerationReport(value?.report, circleId, audience),
  };
}

function normalizeModerationReport(value: any, circleId: number, audience: "reporter" | "triage"): ModerationReport {
  const digest = /^[a-f0-9]{64}$/;
  const operatorMisconduct = value?.reportKind === "operator_misconduct";
  const projectionAudience = operatorMisconduct ? "reporter" : audience;
  const reporterState = String(value?.reporterStatus?.state ?? "");
  const reporterClosed = ["action_taken", "no_violation", "transferred", "closed"].includes(reporterState);
  const triageClosed = value?.triage?.status === "closed";
  if (
    value?.schemaVersion !== 1
    || !["member_moderation", "operator_misconduct"].includes(value?.reportKind)
    || Number(value?.circleId) !== circleId
    || !String(value?.id || "")
    || value?.roomKey !== `circle:${circleId}`
    || value?.subject?.type !== (operatorMisconduct ? "governed_operator_capability" : "communication_room_member")
    || !String(value?.subject?.ref || "").startsWith(`${circleId}:`)
    || !digest.test(String(value?.subject?.snapshotDigest || ""))
    || !digest.test(String(value?.sealedEvidence?.digest || ""))
    || !["received", "triaged", "action_taken", "no_violation", "transferred", "closed"].includes(reporterState)
    || value?.reporterStatus?.detailVisibility !== "status_only_subject_private_outcome_withheld"
    || value?.reporterStatus?.reporterRightsImpact !== "none_report_triage_is_not_governed_action"
    || Number.isNaN(new Date(value?.reporterStatus?.updatedAt).getTime())
    || (reporterClosed !== (value?.reporterStatus?.closedAt != null))
    || (reporterClosed && Number.isNaN(new Date(value.reporterStatus.closedAt).getTime()))
    || (projectionAudience === "reporter" && value?.triage !== null)
    || (projectionAudience === "triage" && (
      value?.triage == null
      || !["submitted", "triaged", "closed"].includes(value.triage.status)
      || !["low", "normal", "high", "urgent"].includes(value.triage.priority)
      || !["none", "suspected", "confirmed"].includes(value.triage.abuseSignal)
      || (triageClosed !== (value.triage.resolutionKind != null))
      || (value.triage.resolutionKind === "action_taken") !== (value.triage.resolutionReceiptId != null)
      || (value.triage.resolutionKind != null && !["action_taken", "no_violation", "transferred", "closed"].includes(value.triage.resolutionKind))
    ))
    || value?.actionPreflight?.automaticExecution !== "forbidden"
    || value?.actionPreflight?.actionType !== (operatorMisconduct
      ? "operator.capability.suspend"
      : "communication.member.mute")
    || value?.actionPreflight?.availability !== (operatorMisconduct
      ? "available_separate_temporary_governed_action"
      : "available_separate_manual_action")
    || (operatorMisconduct && (
      value?.triage !== null
      || !String(value?.operatorMisconduct?.targetOperatorPubkey ?? "")
      || !String(value?.operatorMisconduct?.targetActionType ?? "")
      || !String(value?.operatorMisconduct?.targetSubjectType ?? "")
      || !String(value?.operatorMisconduct?.targetSubjectRef ?? "")
      || value.operatorMisconduct.triageStatus !== "blocked_no_independent_authority"
      || value.operatorMisconduct.reportedOperatorAccess !== "forbidden"
      || value.operatorMisconduct.reportedCommitteeAccess !== "forbidden"
      || value.operatorMisconduct.automaticSuspension !== "forbidden"
    ))
    || (!operatorMisconduct && value?.operatorMisconduct !== null)
    || (projectionAudience === "reporter" && value?.minimumShare !== null)
    || (projectionAudience === "triage" && value?.minimumShare != null && (
      !String(value.minimumShare.caseId ?? "")
      || !String(value.minimumShare.packageId ?? "")
      || !["requested", "authorized", "denied", "revoked"].includes(value.minimumShare.status)
      || value.minimumShare.purpose !== "moderation_case_review_only"
      || !digest.test(String(value.minimumShare.digest ?? ""))
      || (value.minimumShare.expiresAt != null
        && Number.isNaN(new Date(value.minimumShare.expiresAt).getTime()))
    ))
    || !Number.isSafeInteger(Number(value?.version))
    || Number(value.version) <= 0
    || (value?.triage != null && Number.isNaN(new Date(value.triage.slaAt).getTime()))
  ) throw new Error("moderation_report_readback_invalid");
  return value as ModerationReport;
}

export function buildCommunicationSessionBootstrapMessage(
  payload: CommunicationSessionBootstrapPayload,
): string {
  return `alcheme-communication-session:${JSON.stringify(payload)}`;
}

export async function createCommunicationSession(input: {
  walletPubkey: string;
  roomKey: string;
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
  ttlSec?: number;
  clientMeta?: Record<string, unknown>;
}): Promise<CommunicationSessionResponse> {
  return requestCommunicationSession({
    ...input,
    endpointPath: "/api/v1/communication/sessions",
    bodyRoomKey: input.roomKey,
  });
}

export async function ensureCircleCommunicationRoomSession(input: {
  circleId: number | string;
  walletPubkey?: string;
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
  ttlSec?: number;
  clientMeta?: Record<string, unknown>;
}): Promise<CommunicationSessionResponse> {
  const circleId = String(input.circleId).trim();
  if (!circleId) {
    throw new Error("missing_circle_id");
  }
  const roomKey = `circle:${circleId}`;
  const response = await requestCommunicationSession({
    walletPubkey: input.walletPubkey,
    roomKey,
    signMessage: input.signMessage,
    ttlSec: input.ttlSec,
    clientMeta: input.clientMeta,
    endpointPath: `/api/v1/communication/circles/${encodeURIComponent(circleId)}/room-session`,
    bodyRoomKey: roomKey,
    trustedActorSession: true,
  });
  return response;
}

export async function updateCircleRoomVoicePolicy(input: {
  circleId: number | string;
  communicationSessionToken: string;
  maxSpeakers: number;
  overflowStrategy: "listen_only" | "deny" | "queue" | "moderated_queue";
}): Promise<CircleRoomVoicePolicyResponse> {
  const circleId = String(input.circleId).trim();
  if (!circleId) {
    throw new Error("missing_circle_id");
  }
  const route = await resolveNodeRoute("communication_runtime");
  const response = await authenticatedApiFetch(
    `${route.urlBase}/api/v1/communication/circles/${encodeURIComponent(circleId)}/room/voice-policy`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.communicationSessionToken}`,
      },
      body: JSON.stringify({
        maxSpeakers: input.maxSpeakers,
        overflowStrategy: input.overflowStrategy,
      }),
    },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw buildRequestError(response, payload, "voice policy request failed");
  }
  return payload as CircleRoomVoicePolicyResponse;
}

async function requestCommunicationSession(input: {
  walletPubkey?: string;
  roomKey: string;
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
  ttlSec?: number;
  clientMeta?: Record<string, unknown>;
  endpointPath: string;
  bodyRoomKey: string;
  trustedActorSession?: boolean;
}): Promise<CommunicationSessionResponse> {
  if (!input.trustedActorSession && !input.signMessage) {
    throw new Error("wallet_signature_required");
  }
  if (!input.trustedActorSession && !input.walletPubkey) {
    throw new Error("missing_wallet_pubkey");
  }

  const clientTimestamp = new Date().toISOString();
  const nonce = randomNonce();
  let signedMessage: string | undefined;
  let signature: string | undefined;
  if (input.signMessage && input.walletPubkey) {
    const signedPayload: CommunicationSessionBootstrapPayload = {
      v: 1,
      action: "communication_session_init",
      walletPubkey: input.walletPubkey,
      scopeType: "room",
      scopeRef: input.roomKey,
      clientTimestamp,
      nonce,
    };
    signedMessage = buildCommunicationSessionBootstrapMessage(signedPayload);
    signature = bytesToBase64(
      await input.signMessage(new TextEncoder().encode(signedMessage)),
    );
  }
  const route = await resolveNodeRoute("communication_runtime");
  const response = await authenticatedApiFetch(`${route.urlBase}${input.endpointPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      walletPubkey: input.walletPubkey,
      roomKey: input.bodyRoomKey,
      clientTimestamp,
      nonce,
      signedMessage,
      signature,
      ttlSec: input.ttlSec,
      clientMeta: input.clientMeta,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw buildRequestError(
      response,
      payload,
      "communication session request failed",
    );
  }
  const record =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : null;
  return (
    record && "session" in record
      ? {
          ...((record.session ?? {}) as Record<string, unknown>),
          room: record.room,
        }
      : payload
  ) as CommunicationSessionResponse;
}

function randomNonce(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `${Date.now()}${Math.random().toString(16).slice(2, 10)}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let binary = "";
    for (let index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }
    return btoa(binary);
  }
  throw new Error("base64_encoding_unavailable");
}

function buildRequestError(
  response: Response,
  payload: unknown,
  fallback: string,
): Error {
  const record =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : null;
  const message =
    typeof record?.message === "string"
      ? record.message
      : typeof record?.error === "string"
        ? record.error
        : `${fallback}: ${response.status}`;
  const error = new Error(message) as Error & {
    code?: string;
    status?: number;
    details?: unknown;
  };
  if (typeof record?.error === "string") {
    error.code = record.error;
  }
  error.status = response.status;
  if (record && "details" in record) {
    error.details = record.details;
  }
  return error;
}
