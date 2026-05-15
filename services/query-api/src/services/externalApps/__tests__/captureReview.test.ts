import {
  assertExternalAppHighImpactActionAllowed,
  buildExternalAppGovernanceRiskState,
  buildExternalAppProjectionDispute,
  buildExternalAppReviewCaptureCase,
} from "../captureReview";

describe("external app capture review and projection disputes", () => {
  it("pauses high-impact settlement while capture review is open", () => {
    const captureReview = buildExternalAppReviewCaptureCase({
      externalAppId: "game-1",
      openedByPubkey: "reviewer-wallet",
      evidenceDigest: "sha256:capture",
      status: "open",
    });

    expect(() =>
      assertExternalAppHighImpactActionAllowed({
        actionType: "external_app_bond_routing_execute",
        captureReviews: [captureReview],
        projectionDisputes: [],
      }),
    ).toThrow("external_app_capture_review_open");
  });

  it("blocks slashing, new delisting, and revocation while projection is disputed", () => {
    const dispute = buildExternalAppProjectionDispute({
      externalAppId: "game-1",
      openedByPubkey: "owner-wallet",
      projectionReceiptId: "projection-1",
      evidenceDigest: "sha256:projection",
      status: "open",
    });

    for (const actionType of [
      "external_app_owner_bond_slash",
      "downgrade_discovery_status",
      "external_app_registry_revoke",
    ] as const) {
      expect(() =>
        assertExternalAppHighImpactActionAllowed({
          actionType,
          captureReviews: [],
          projectionDisputes: [dispute],
        }),
      ).toThrow("external_app_projection_disputed");
    }
  });

  it("builds projection state for UI and REST without mutating registry status", () => {
    const state = buildExternalAppGovernanceRiskState({
      captureReviews: [
        buildExternalAppReviewCaptureCase({
          externalAppId: "game-1",
          openedByPubkey: "reviewer-wallet",
          evidenceDigest: "sha256:capture",
          status: "open",
        }),
      ],
      projectionDisputes: [
        buildExternalAppProjectionDispute({
          externalAppId: "game-1",
          openedByPubkey: "owner-wallet",
          projectionReceiptId: "projection-1",
          evidenceDigest: "sha256:projection",
          status: "open",
        }),
      ],
    });

    expect(state).toMatchObject({
      captureReviewStatus: "open",
      projectionDisputeStatus: "open",
      highImpactActionsPaused: true,
      labels: ["Capture review", "Projection disputed"],
    });
  });
});
