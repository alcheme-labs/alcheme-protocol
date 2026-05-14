import { executeExternalAppDecision } from "../executionAdapter";
import type { GovernanceEngineStore } from "../../governance/policyEngine";
import { computeManifestHash, normalizeExternalAppManifest } from "../manifest";

function governanceStore(receipts: unknown[]): GovernanceEngineStore {
  return {
    getExecutionReceiptByMarker: async () => null,
    saveDecision: async () => {
      throw new Error("saveDecision should not be called by execution adapter");
    },
    saveExecutionReceipt: async (input) => {
      receipts.push(input);
      return input;
    },
  };
}

describe("external app execution adapter", () => {
  it("applies store listing approval and records receipt", async () => {
    const updates: unknown[] = [];
    const receipts: unknown[] = [];
    const prisma = {
      externalApp: {
        update: async (input: unknown) => {
          updates.push(input);
          return { id: "last-ignition" };
        },
      },
    };

    await executeExternalAppDecision({
      prisma,
      governanceStore: governanceStore(receipts),
      request: {
        id: "req-1",
        actionType: "approve_store_listing",
        targetRef: "last-ignition",
        payload: { discoveryStatus: "listed" },
      },
      decision: { decision: "accepted" },
      now: new Date("2026-05-13T00:00:00.000Z"),
    });

    expect(updates[0]).toMatchObject({
      where: { id: "last-ignition" },
      data: { discoveryStatus: "listed" },
    });
    expect(receipts).toHaveLength(1);
  });

  it("applies the reviewed manifest only after registration is accepted", async () => {
    const updates: unknown[] = [];
    const receipts: unknown[] = [];
    const manifest = normalizeExternalAppManifest({
      version: "1",
      appId: "last-ignition",
      name: "Last Ignition",
      homeUrl: "https://game.example.com",
      ownerWallet: "solana:devnet:11111111111111111111111111111111",
      serverPublicKey: "server-key",
      allowedOrigins: ["https://game.example.com"],
      capabilities: ["communication.rooms"],
    });
    const manifestHash = computeManifestHash(manifest);
    const prisma = {
      externalApp: {
        update: async (input: unknown) => {
          updates.push(input);
          return { id: "last-ignition" };
        },
      },
    };

    await executeExternalAppDecision({
      prisma,
      governanceStore: governanceStore(receipts),
      request: {
        id: "req-2",
        actionType: "external_app_register",
        targetRef: "last-ignition",
        payload: { manifest, manifestHash },
      },
      decision: { decision: "accepted" },
      now: new Date("2026-05-13T00:00:00.000Z"),
    });

    expect(updates[0]).toMatchObject({
      data: {
        name: "Last Ignition",
        registryStatus: "active",
        status: "active",
        serverPublicKey: "server-key",
        allowedOrigins: ["https://game.example.com"],
        manifestHash,
      },
    });
  });
});
