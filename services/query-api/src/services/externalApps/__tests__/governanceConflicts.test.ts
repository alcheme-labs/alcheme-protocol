import {
  assertExternalAppGovernanceParticipationAllowed,
  buildExternalAppConflictDisclosure,
  computeExternalAppVotingCap,
} from "../governanceConflicts";

describe("external app governance conflicts", () => {
  it("requires active recusal for owners, challengers, direct competitors, and paid promoters", () => {
    const disclosures = [
      buildExternalAppConflictDisclosure({
        externalAppId: "game-1",
        actorPubkey: "owner-wallet",
        role: "owner",
        source: "self_reported",
      }),
      buildExternalAppConflictDisclosure({
        externalAppId: "game-1",
        actorPubkey: "competitor-wallet",
        role: "direct_competitor",
        source: "reviewer_reported",
      }),
    ];

    expect(() =>
      assertExternalAppGovernanceParticipationAllowed({
        externalAppId: "game-1",
        actorPubkey: "owner-wallet",
        actionType: "external_app_bond_routing_execute",
        disclosures,
      }),
    ).toThrow("external_app_governance_recusal_required");

    expect(() =>
      assertExternalAppGovernanceParticipationAllowed({
        externalAppId: "game-1",
        actorPubkey: "competitor-wallet",
        actionType: "external_app_registry_revoke",
        disclosures,
      }),
    ).toThrow("external_app_governance_recusal_required");
  });

  it("caps major backers and affiliates but does not create a parallel review system", () => {
    const disclosures = [
      buildExternalAppConflictDisclosure({
        externalAppId: "game-1",
        actorPubkey: "backer-wallet",
        role: "major_backer",
        source: "projection",
      }),
      buildExternalAppConflictDisclosure({
        externalAppId: "game-1",
        actorPubkey: "affiliate-wallet",
        role: "affiliate",
        source: "self_reported",
      }),
    ];

    expect(
      computeExternalAppVotingCap({
        externalAppId: "game-1",
        actorPubkey: "backer-wallet",
        disclosures,
      }),
    ).toEqual({ cap: 0.25, reason: "major_backer" });
    expect(
      computeExternalAppVotingCap({
        externalAppId: "game-1",
        actorPubkey: "affiliate-wallet",
        disclosures,
      }),
    ).toEqual({ cap: 0.5, reason: "affiliate" });
  });
});
