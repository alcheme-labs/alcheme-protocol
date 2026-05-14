import { assertReviewCircle, buildExternalAppReviewBinding } from "../reviewBinding";

describe("external app review binding", () => {
  it("accepts auxiliary governance secret circles", () => {
    expect(() =>
      assertReviewCircle({
        id: 7,
        kind: "auxiliary",
        mode: "governance",
        circleType: "Secret",
      }),
    ).not.toThrow();
  });

  it("rejects ordinary knowledge circles as review councils", () => {
    expect(() =>
      assertReviewCircle({
        id: 8,
        kind: "main",
        mode: "knowledge",
        circleType: "Open",
      }),
    ).toThrow("external_app_review_circle_requires_governance_circle");
  });

  it("builds stable binding metadata", () => {
    expect(
      buildExternalAppReviewBinding({
        circleId: 7,
        policyId: "external-app-review-v1",
      }),
    ).toEqual({
      reviewCircleId: 7,
      reviewPolicyId: "external-app-review-v1",
    });
  });
});
