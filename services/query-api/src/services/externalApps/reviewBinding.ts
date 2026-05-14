export interface ReviewCircleLike {
  id: number;
  kind?: string | null;
  mode?: string | null;
  circleType?: string | null;
}

export function assertReviewCircle(circle: ReviewCircleLike): void {
  if (
    circle.kind !== "auxiliary" ||
    circle.mode !== "governance" ||
    circle.circleType !== "Secret"
  ) {
    throw new Error("external_app_review_circle_requires_governance_circle");
  }
}

export function buildExternalAppReviewBinding(input: {
  circleId: number;
  policyId: string;
}): { reviewCircleId: number; reviewPolicyId: string } {
  if (!Number.isSafeInteger(input.circleId) || input.circleId <= 0) {
    throw new Error("invalid_external_app_review_circle_id");
  }
  const policyId = input.policyId.trim();
  if (!policyId) {
    throw new Error("invalid_external_app_review_policy_id");
  }
  return {
    reviewCircleId: input.circleId,
    reviewPolicyId: policyId,
  };
}
