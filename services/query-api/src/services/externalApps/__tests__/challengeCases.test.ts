import {
  assertExternalAppChallengeSettlementAllowed,
  buildExternalAppChallengeCaseProjection,
} from "../challengeCases";

describe("external app V3B challenge cases", () => {
  it("builds a bounded challenge projection with case and policy provenance", () => {
    expect(
      buildExternalAppChallengeCaseProjection({
        externalAppId: "game-1",
        appIdHash: "01".repeat(32),
        caseId: "02".repeat(32),
        challengerPubkey: "Challenger111111111111111111111111111111",
        challengeType: "server_key_mismatch",
        evidenceHash: "sha256:" + "03".repeat(32),
        mint: "Mint111111111111111111111111111111111111",
        amountRaw: "1000",
        policyEpochId: "epoch-v3b-local",
      }),
    ).toMatchObject({
      id: "v3b:challenge:game-1:0202020202020202020202020202020202020202020202020202020202020202",
      status: "open",
      challengeBondRaw: "1000",
      policyEpochId: "epoch-v3b-local",
    });
  });

  it("rejects subjective settlement without governance or arbitration receipt", () => {
    expect(() =>
      assertExternalAppChallengeSettlementAllowed({
        caseClass: "subjective",
        evidenceTier: 2,
      }),
    ).toThrow("external_app_challenge_subjective_settlement_requires_receipt");

    expect(() =>
      assertExternalAppChallengeSettlementAllowed({
        caseClass: "subjective",
        evidenceTier: 2,
        governanceReceiptId: "governance-receipt-1",
      }),
    ).not.toThrow();
  });

  it("blocks weak evidence and disputed projections from automatic settlement", () => {
    expect(() =>
      assertExternalAppChallengeSettlementAllowed({
        caseClass: "machine_verifiable",
        evidenceTier: 4,
        machineVerifiable: true,
      }),
    ).toThrow("external_app_challenge_evidence_too_weak_for_settlement");

    expect(() =>
      assertExternalAppChallengeSettlementAllowed({
        caseClass: "machine_verifiable",
        evidenceTier: 1,
        machineVerifiable: true,
        projectionStatus: "projection_disputed",
      }),
    ).toThrow("external_app_challenge_projection_disputed");
  });
});
