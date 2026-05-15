import {
  assertReviewCircleShape,
  type ReviewCircleLike,
} from "../governance/systemRoleBindings";

export type { ReviewCircleLike };

/**
 * Shape-only validator. This does not prove a circle is authorized for an
 * ExternalApp protocol role; callers that need authority must resolve an active
 * SystemGovernanceRoleBinding.
 */
export function assertReviewCircle(circle: ReviewCircleLike): void {
  assertReviewCircleShape(circle);
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
