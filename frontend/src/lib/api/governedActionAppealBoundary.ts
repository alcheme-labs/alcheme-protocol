export interface GovernedActionAppealNoAggravationBoundary {
  contract: "governed-action-appeal-no-aggravation-current";
  sameAppealEffect: "preserve_or_reduce_only";
  sameAppealOutcomes: readonly ["uphold", "modify_reduce", "revoke", "expire"];
  reReview: "requires_explicit_review_without_expanding_original_effect";
  aggravation: {
    disposition: "forbidden_in_current_appeal";
    nextAction: "separate_new_action_required";
    notice: "fresh_notice_required";
    defenseWindow: "fresh_defense_window_required";
    authority: "corresponding_high_risk_authority_chain_required";
    currentAutomaticProducer: "none";
  };
}

export interface GovernedActionAppealRoutingReadback {
  contract: "governed-action-appeal-routing-current";
  source: "canonical_receipt_action_type";
  selectedChannel: "circle_policy" | "operator_misconduct" | null;
  channels: {
    circlePolicy: {
      status: "configured" | "not_applicable";
      authorityClass: "circle_policy_independent_reviewer";
      visibility: "circle_actor_appellant_and_authorized_independent_reviewer";
      deadline: string | null;
      submission: { method: "POST"; path: string } | null;
    };
    operatorMisconduct: {
      status: "configured" | "not_applicable";
      authorityClass: "independent_circle_governance_or_unavailable";
      visibility: "affected_subject_and_independent_circle_reviewer";
      deadline: string | null;
      submission: { method: "POST"; path: string } | null;
    };
    platformSafetyLegal: {
      status: "unavailable_no_bound_authority";
      authorityClass: "not_bound";
      visibility: "unavailable";
      deadline: null;
      submission: null;
    };
  };
}

export function normalizeGovernedActionAppealRoutingReadback(
  value: any,
): GovernedActionAppealRoutingReadback {
  const circle = value?.channels?.circlePolicy;
  const operator = value?.channels?.operatorMisconduct;
  const safety = value?.channels?.platformSafetyLegal;
  const selected = value?.selectedChannel;
  const validSubmission = (submission: any) => submission === null
    || (submission?.method === "POST" && String(submission?.path || "").startsWith("/api/v1/"));
  const validDeadline = (deadline: any) => typeof deadline === "string"
    && !Number.isNaN(new Date(deadline).getTime());
  if (
    value?.contract !== "governed-action-appeal-routing-current"
    || value?.source !== "canonical_receipt_action_type"
    || ![null, "circle_policy", "operator_misconduct"].includes(selected)
    || !["configured", "not_applicable"].includes(circle?.status)
    || circle?.authorityClass !== "circle_policy_independent_reviewer"
    || circle?.visibility !== "circle_actor_appellant_and_authorized_independent_reviewer"
    || !validSubmission(circle?.submission)
    || (circle?.status === "configured") !== (circle?.submission !== null)
    || (circle?.status === "configured" && !validDeadline(circle?.deadline))
    || (circle?.status === "not_applicable" && circle?.deadline !== null)
    || !["configured", "not_applicable"].includes(operator?.status)
    || operator?.authorityClass !== "independent_circle_governance_or_unavailable"
    || operator?.visibility !== "affected_subject_and_independent_circle_reviewer"
    || !validSubmission(operator?.submission)
    || (operator?.status === "configured") !== (operator?.submission !== null)
    || (operator?.status === "configured" && !validDeadline(operator?.deadline))
    || (operator?.status === "not_applicable" && operator?.deadline !== null)
    || safety?.status !== "unavailable_no_bound_authority"
    || safety?.authorityClass !== "not_bound"
    || safety?.visibility !== "unavailable"
    || safety?.deadline !== null
    || safety?.submission !== null
    || (selected === "circle_policy" && (circle.status !== "configured" || circle.submission === null))
    || (selected === "operator_misconduct" && (operator.status !== "configured" || operator.submission === null))
    || (selected === null && (circle.status !== "not_applicable" || operator.status !== "not_applicable"))
  ) throw new Error("governed_action_appeal_routing_readback_invalid");
  return value as GovernedActionAppealRoutingReadback;
}

export function normalizeGovernedActionAppealNoAggravationBoundary(
  value: any,
): GovernedActionAppealNoAggravationBoundary {
  if (
    value?.contract !== "governed-action-appeal-no-aggravation-current"
    || value?.sameAppealEffect !== "preserve_or_reduce_only"
    || !Array.isArray(value?.sameAppealOutcomes)
    || value.sameAppealOutcomes.length !== 4
    || value.sameAppealOutcomes[0] !== "uphold"
    || value.sameAppealOutcomes[1] !== "modify_reduce"
    || value.sameAppealOutcomes[2] !== "revoke"
    || value.sameAppealOutcomes[3] !== "expire"
    || value?.reReview !== "requires_explicit_review_without_expanding_original_effect"
    || value?.aggravation?.disposition !== "forbidden_in_current_appeal"
    || value.aggravation.nextAction !== "separate_new_action_required"
    || value.aggravation.notice !== "fresh_notice_required"
    || value.aggravation.defenseWindow !== "fresh_defense_window_required"
    || value.aggravation.authority !== "corresponding_high_risk_authority_chain_required"
    || value.aggravation.currentAutomaticProducer !== "none"
  ) throw new Error("governed_action_appeal_no_aggravation_boundary_invalid");
  return value as GovernedActionAppealNoAggravationBoundary;
}
