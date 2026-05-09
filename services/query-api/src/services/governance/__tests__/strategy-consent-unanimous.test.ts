import { evaluateConsentUnanimous } from "../strategies/consentUnanimous";

describe("consent.unanimous governance strategy", () => {
  test("accepts only after every required party consents", () => {
    const base = {
      config: {
        strategy: "consent.unanimous",
        requiredParties: ["wallet-a", "wallet-b"],
      },
    } as const;

    expect(
      evaluateConsentUnanimous({
        ...base,
        signals: [{ actorPubkey: "wallet-a", value: "approve" }],
      }),
    ).toMatchObject({ state: "active", reason: "consent_missing" });

    expect(
      evaluateConsentUnanimous({
        ...base,
        signals: [
          { actorPubkey: "wallet-a", value: "approve" },
          { actorPubkey: "wallet-b", value: "approve" },
        ],
      }),
    ).toMatchObject({ state: "accepted", reason: "unanimous_consent" });
  });

  test("rejects immediately when any required party rejects", () => {
    expect(
      evaluateConsentUnanimous({
        config: {
          strategy: "consent.unanimous",
          requiredParties: ["wallet-a", "wallet-b"],
        },
        signals: [
          { actorPubkey: "wallet-a", value: "approve" },
          { actorPubkey: "wallet-b", value: "reject" },
        ],
      }),
    ).toMatchObject({ state: "rejected", reason: "consent_rejected" });
  });
});
