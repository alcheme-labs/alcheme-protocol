import { buildProductionExternalAppRegistrationRequest } from "../productionRegistry";

describe("production external app registry request", () => {
  it("builds a governance request for production registration", () => {
    const manifest = {
      version: "1" as const,
      appId: "last-ignition",
      name: "Last Ignition",
      homeUrl: "https://game.example.com/",
      ownerWallet: "solana:devnet:11111111111111111111111111111111",
      serverPublicKey: "server-key",
      allowedOrigins: ["https://game.example.com"],
      capabilities: ["communication.rooms"],
    };
    const request = buildProductionExternalAppRegistrationRequest({
      externalAppId: "last-ignition",
      proposerPubkey: "11111111111111111111111111111111",
      reviewPolicyId: "external-app-review-v1",
      reviewPolicyVersionId: "external-app-review-v1:1",
      reviewPolicyVersion: 1,
      reviewCircleId: 7,
      eligibleActors: [
        {
          pubkey: "reviewer-wallet",
          role: "Admin",
          weight: "1",
          source: "external_app_review_circle",
        },
      ],
      manifestHash: "sha256:abc",
      manifest,
      idempotencyKey: "last-ignition:sha256:abc",
      openedAt: new Date("2026-05-13T00:00:00.000Z"),
    });

    expect(request.action.type).toBe("external_app_register");
    expect(request.scope).toEqual({ type: "external_app_review_circle", ref: "7" });
    expect(request.action.targetType).toBe("external_app");
    expect(request.action.targetRef).toBe("last-ignition");
    expect(request.action.payload).toMatchObject({ manifestHash: "sha256:abc", manifest });
  });
});
