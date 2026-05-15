import {
  buildRiskDisclaimerAcceptance,
  buildRiskDisclaimerTerms,
  computeRiskDisclaimerAcceptanceDigest,
  assertRiskDisclaimerAcceptanceMatches,
  assertNoAlchemeLiabilityWording,
} from "../riskDisclaimer";

describe("external app risk disclaimer", () => {
  it("records acceptance by scope and policy epoch", () => {
    const terms = buildRiskDisclaimerTerms("external_app_entry");
    const acceptanceDigest = computeRiskDisclaimerAcceptanceDigest({
      externalAppId: "last-ignition",
      actorPubkey: "player-wallet",
      scope: "external_app_entry",
      policyEpochId: "epoch-1",
      disclaimerVersion: terms.disclaimerVersion,
      termsDigest: terms.termsDigest,
    });

    expect(
      buildRiskDisclaimerAcceptance({
        externalAppId: "last-ignition",
        actorPubkey: "player-wallet",
        scope: "external_app_entry",
        policyEpochId: "epoch-1",
        disclaimerVersion: terms.disclaimerVersion,
        termsDigest: terms.termsDigest,
        acceptanceDigest,
        source: "wallet_signature",
        signatureDigest: "sha256:abc",
        chainReceiptPda: "receipt-pda",
        chainReceiptDigest: "sha256:" + "1".repeat(64),
        txSignature: "tx-1",
      }),
    ).toMatchObject({
      externalAppId: "last-ignition",
      actorPubkey: "player-wallet",
      scope: "external_app_entry",
      policyEpochId: "epoch-1",
      termsDigest: terms.termsDigest,
      acceptanceDigest,
      chainReceiptPda: "receipt-pda",
      chainReceiptDigest: "1".repeat(64),
      txSignature: "tx-1",
    });
  });

  it("builds and validates a chain-anchored developer agreement digest", () => {
    const terms = buildRiskDisclaimerTerms("developer_registration");
    const acceptanceDigest = computeRiskDisclaimerAcceptanceDigest({
      externalAppId: "last-ignition",
      actorPubkey: "developer-wallet",
      scope: "developer_registration",
      policyEpochId: "external-app-review-v1:1",
      disclaimerVersion: terms.disclaimerVersion,
      termsDigest: terms.termsDigest,
      bindingDigest: "sha256:" + "2".repeat(64),
    });

    expect(terms).toMatchObject({
      scope: "developer_registration",
      disclaimerVersion: "external-app-developer-agreement-v1",
      onChainReceiptRequired: true,
    });
    expect(terms.termsDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(acceptanceDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(() =>
      assertRiskDisclaimerAcceptanceMatches({
        externalAppId: "last-ignition",
        actorPubkey: "developer-wallet",
        scope: "developer_registration",
        policyEpochId: "external-app-review-v1:1",
        disclaimerVersion: terms.disclaimerVersion,
        termsDigest: terms.termsDigest,
        acceptanceDigest,
        bindingDigest: "sha256:" + "2".repeat(64),
        chainReceiptPda: "receipt-pda",
        chainReceiptDigest: "3".repeat(64),
        txSignature: "tx-1",
        requireChainReceipt: true,
      }),
    ).not.toThrow();
  });

  it("keeps developer agreement acceptance digest aligned with SDK fixed vector", () => {
    expect(
      computeRiskDisclaimerAcceptanceDigest({
        externalAppId: "last-ignition",
        actorPubkey: "11111111111111111111111111111111",
        scope: "developer_registration",
        policyEpochId: "external-app-review-v1:1",
        disclaimerVersion: "external-app-developer-agreement-v1",
        termsDigest: "sha256:" + "1".repeat(64),
        bindingDigest: "sha256:" + "2".repeat(64),
      }),
    ).toBe("sha256:b498509a2f778d5bf9963b5489a75e338cdc98ce24c6a8d11cfaa266276b96f2");
  });

  it("rejects compensation and liability wording", () => {
    expect(() =>
      assertNoAlchemeLiabilityWording("Alcheme provides insurance and refunds."),
    ).toThrow("external_app_disclaimer_forbidden_liability_wording");
  });

  it("rejects bond-disposition notices that imply platform responsibility", () => {
    expect(() =>
      assertNoAlchemeLiabilityWording("This notice creates platform liability."),
    ).toThrow("external_app_disclaimer_forbidden_liability_wording");
  });
});
