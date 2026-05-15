import {
  assertBondDispositionActionNameAllowed,
  assertBondDispositionRequestAllowed,
  buildBondDispositionCaseProjection,
  summarizeBondDispositionState,
} from "../bondDisposition";

describe("external app bond disposition", () => {
  const activePolicy = {
    policyEpochId: "epoch-1",
    policyId: "policy-1",
    policyDigest: "sha256:policy",
    mint: "mint-1",
    maxCaseAmountRaw: "1000",
    status: "active" as const,
  };

  it("builds case projections with normalized amounts and related parties", () => {
    expect(
      buildBondDispositionCaseProjection({
        externalAppId: "game-1",
        policyEpochId: "epoch-1",
        appIdHash: "hash-1",
        caseId: "case-1",
        policyId: "policy-1",
        initiatorPubkey: "wallet-1",
        mint: "mint-1",
        requestedAmountRaw: "500",
        lockedAmountRaw: "250",
        routedAmountRaw: "50",
        evidenceHash: "sha256:evidence",
        rulingDigest: "sha256:ruling",
        status: "locked_for_case",
        relatedPartyRoles: ["owner", "unknown", "paid_promoter"],
      }),
    ).toMatchObject({
      id: "game-1:case-1",
      requestedAmountRaw: "500",
      lockedAmountRaw: "250",
      routedAmountRaw: "50",
      relatedPartyRoles: ["owner", "paid_promoter"],
    });
  });

  it("requires accepted risk notice and retained evidence before opening a request", () => {
    expect(() =>
      assertBondDispositionRequestAllowed({
        policy: activePolicy,
        requestedAmountRaw: "100",
        riskDisclaimerAccepted: false,
        evidenceAvailable: true,
      }),
    ).toThrow("external_app_risk_disclaimer_required");

    expect(() =>
      assertBondDispositionRequestAllowed({
        policy: activePolicy,
        requestedAmountRaw: "100",
        riskDisclaimerAccepted: true,
        evidenceAvailable: false,
      }),
    ).toThrow("external_app_bond_disposition_evidence_required");
  });

  it("rejects inactive policies, oversized requests, and liability-style action names", () => {
    expect(() =>
      assertBondDispositionRequestAllowed({
        policy: { ...activePolicy, status: "paused", paused: true },
        requestedAmountRaw: "100",
        riskDisclaimerAccepted: true,
        evidenceAvailable: true,
      }),
    ).toThrow("external_app_bond_disposition_policy_not_active");

    expect(() =>
      assertBondDispositionRequestAllowed({
        policy: activePolicy,
        requestedAmountRaw: "1001",
        riskDisclaimerAccepted: true,
        evidenceAvailable: true,
      }),
    ).toThrow("external_app_bond_disposition_amount_exceeds_policy");

    expect(() => assertBondDispositionActionNameAllowed("make_whole")).toThrow(
      "external_app_disclaimer_forbidden_liability_wording",
    );
  });

  it("summarizes active locks and routed amounts without changing registry status", () => {
    expect(
      summarizeBondDispositionState({
        riskDisclaimerAccepted: true,
        cases: [
          { status: "locked_for_case", lockedAmountRaw: "200", routedAmountRaw: "0" },
          { status: "routed_by_policy", lockedAmountRaw: "0", routedAmountRaw: "75" },
        ],
      }),
    ).toEqual({
      state: "locked_for_case",
      activeLockedAmountRaw: "200",
      totalRoutedAmountRaw: "75",
      activeCaseCount: 1,
      riskDisclaimerAccepted: true,
      riskDisclaimerRequired: true,
    });
  });
});
