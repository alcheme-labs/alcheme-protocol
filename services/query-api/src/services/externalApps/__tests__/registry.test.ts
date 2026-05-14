import { jest } from "@jest/globals";

import { registerExternalApp } from "../registry";

function prismaMock() {
  return {
    externalApp: {
      upsert: jest.fn(async ({ create }: any) => create),
    },
  } as any;
}

describe("registerExternalApp", () => {
  it("creates a sandbox wallet-only app with normalized origins", async () => {
    const prisma = prismaMock();
    await registerExternalApp(prisma, {
      id: "Last-Ignition",
      name: "Last Ignition",
      ownerPubkey: "owner-wallet",
      allowedOrigins: ["http://127.0.0.1:4173/", "http://127.0.0.1:4173"],
      claimAuthMode: "wallet_only_dev",
      config: { environment: "sandbox", reviewLevel: "sandbox" },
    });
    expect(prisma.externalApp.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          id: "last-ignition",
          allowedOrigins: ["http://127.0.0.1:4173"],
          claimAuthMode: "wallet_only_dev",
          registryStatus: "active",
        }),
      }),
    );
  });

  it("rejects invalid app ids and missing server keys", async () => {
    await expect(
      registerExternalApp(prismaMock(), {
        id: "Bad App",
        name: "Bad",
        ownerPubkey: "owner",
        allowedOrigins: [],
        claimAuthMode: "wallet_only_dev",
      }),
    ).rejects.toThrow("invalid_external_app_id");

    await expect(
      registerExternalApp(prismaMock(), {
        id: "valid-app",
        name: "Valid",
        ownerPubkey: "owner",
        allowedOrigins: [],
        claimAuthMode: "server_ed25519",
      }),
    ).rejects.toThrow("external_app_server_public_key_required");
  });

  it("rejects wallet-only reviewed or production semantics", async () => {
    await expect(
      registerExternalApp(prismaMock(), {
        id: "valid-app",
        name: "Valid",
        ownerPubkey: "owner",
        allowedOrigins: [],
        claimAuthMode: "wallet_only_dev",
        config: { environment: "mainnet_production", reviewLevel: "sandbox" },
      }),
    ).rejects.toThrow("wallet_only_dev_requires_sandbox_environment");

    await expect(
      registerExternalApp(prismaMock(), {
        id: "valid-app",
        name: "Valid",
        ownerPubkey: "owner",
        allowedOrigins: [],
        claimAuthMode: "wallet_only_dev",
        config: { environment: "sandbox", reviewLevel: "reviewed" },
      }),
    ).rejects.toThrow("production_review_requires_governance_decision");

    await expect(
      registerExternalApp(prismaMock(), {
        id: "valid-app",
        name: "Valid",
        ownerPubkey: "owner",
        allowedOrigins: [],
        claimAuthMode: "server_ed25519",
        serverPublicKey: "server-key",
        config: { environment: "devnet_reviewed", reviewLevel: "sandbox" },
      }),
    ).rejects.toThrow("production_review_requires_governance_decision");
  });
});
