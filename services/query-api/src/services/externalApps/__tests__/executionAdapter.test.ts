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

  it("does not activate required-mode app when chain registration fails", async () => {
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
        id: "req-3",
        actionType: "external_app_register",
        targetRef: "last-ignition",
        payload: {
          manifest,
          manifestHash,
          ownerAssertion: { payload: "payload", signature: "signature" },
          reviewCircleId: 7,
        },
      },
      decision: { decision: "accepted", decisionDigest: "1".repeat(64) },
      now: new Date("2026-05-13T00:00:00.000Z"),
      chainRegistry: {
        anchorExternalAppRegistration: async () => {
          throw new Error("external_app_registry_submit_failed");
        },
        anchorExecutionReceipt: async () => {
          throw new Error("should not anchor receipt");
        },
      },
    });

    expect(updates).toHaveLength(0);
    expect(receipts[0]).toMatchObject({
      executionStatus: "failed",
      errorCode: "external_app_registry_submit_failed",
    });
  });

  it("anchors execution receipt after successful chain registration", async () => {
    const receipts: unknown[] = [];
    const anchors: unknown[] = [];
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
        update: jest.fn(async () => ({ id: "last-ignition" })),
      },
      externalAppRegistryAnchor: {
        upsert: jest.fn(async (input: unknown) => {
          anchors.push(input);
          return input;
        }),
      },
    };
    const chainRegistry = {
      anchorExternalAppRegistration: jest.fn(async () => ({
        mode: "required" as const,
        status: "submitted" as const,
        txSignature: "tx-registration",
        recordPda: "record-pda",
      })),
      anchorExecutionReceipt: jest.fn(async () => ({
        mode: "required" as const,
        status: "submitted" as const,
        txSignature: "tx-receipt",
        recordPda: "record-pda",
      })),
    };

    await executeExternalAppDecision({
      prisma,
      governanceStore: governanceStore(receipts),
      request: {
        id: "req-4",
        actionType: "external_app_register",
        targetRef: "last-ignition",
        payload: {
          manifest,
          manifestHash,
          ownerAssertion: { payload: "payload", signature: "signature" },
          reviewCircleId: 7,
        },
      },
      decision: { decision: "accepted", decisionDigest: "1".repeat(64) },
      now: new Date("2026-05-13T00:00:00.000Z"),
      chainRegistry,
    });

    expect(chainRegistry.anchorExternalAppRegistration).toHaveBeenCalledTimes(1);
    expect(chainRegistry.anchorExecutionReceipt).toHaveBeenCalledTimes(1);
    expect(anchors).toHaveLength(2);
    expect(anchors[0]).toMatchObject({
      where: { appIdHash: expect.any(String) },
      update: { externalAppId: "last-ignition" },
    });
  });

  it("keeps v2 registry status pending when required receipt anchor fails", async () => {
    const receipts: unknown[] = [];
    const updates: unknown[] = [];
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
        update: jest.fn(async (input: unknown) => {
          updates.push(input);
          return { id: "last-ignition" };
        }),
      },
      externalAppRegistryAnchor: {
        upsert: jest.fn(async (input: unknown) => input),
      },
    };
    const chainRegistry = {
      anchorExternalAppRegistration: jest.fn(async () => ({
        mode: "required" as const,
        status: "submitted" as const,
        txSignature: "tx-registration",
        recordPda: "record-pda",
      })),
      anchorExecutionReceipt: jest.fn(async () => {
        throw new Error("receipt_anchor_failed");
      }),
    };

    await executeExternalAppDecision({
      prisma,
      governanceStore: governanceStore(receipts),
      request: {
        id: "req-receipt-failed",
        actionType: "external_app_register",
        targetRef: "last-ignition",
        payload: {
          manifest,
          manifestHash,
          ownerAssertion: { payload: "payload", signature: "signature" },
          reviewCircleId: 7,
        },
      },
      decision: { decision: "accepted", decisionDigest: "1".repeat(64) },
      now: new Date("2026-05-13T00:00:00.000Z"),
      chainRegistry,
    });

    expect(chainRegistry.anchorExternalAppRegistration).toHaveBeenCalledTimes(1);
    expect(chainRegistry.anchorExecutionReceipt).toHaveBeenCalledTimes(1);
    expect(updates.at(-1)).toMatchObject({
      where: { id: "last-ignition" },
      data: { status: "inactive", registryStatus: "pending" },
    });
  });

  it("does not write local chain anchors or receipt anchors when optional registry skips", async () => {
    const receipts: unknown[] = [];
    const anchors: unknown[] = [];
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
        update: jest.fn(async () => ({ id: "last-ignition" })),
      },
      externalAppRegistryAnchor: {
        upsert: jest.fn(async (input: unknown) => {
          anchors.push(input);
          return input;
        }),
      },
    };
    const chainRegistry = {
      anchorExternalAppRegistration: jest.fn(async () => ({
        mode: "optional" as const,
        status: "skipped" as const,
        reason: "external_app_registry_program_id_required",
      })),
      anchorExecutionReceipt: jest.fn(async () => {
        throw new Error("receipt anchor should not run when registration skipped");
      }),
    };

    await executeExternalAppDecision({
      prisma,
      governanceStore: governanceStore(receipts),
      request: {
        id: "req-5",
        actionType: "external_app_register",
        targetRef: "last-ignition",
        payload: {
          manifest,
          manifestHash,
          ownerAssertion: { payload: "payload", signature: "signature" },
          reviewCircleId: 7,
        },
      },
      decision: { decision: "accepted", decisionDigest: "1".repeat(64) },
      now: new Date("2026-05-13T00:00:00.000Z"),
      chainRegistry,
    });

    expect(chainRegistry.anchorExternalAppRegistration).toHaveBeenCalledTimes(1);
    expect(chainRegistry.anchorExecutionReceipt).not.toHaveBeenCalled();
    expect(anchors).toHaveLength(0);
    expect(receipts[0]).toMatchObject({ executionStatus: "executed" });
  });

  it("continues after local chain projection upsert failure because the indexer can recover", async () => {
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
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const prisma = {
      externalApp: {
        update: jest.fn(async () => ({ id: "last-ignition" })),
      },
      externalAppRegistryAnchor: {
        upsert: jest.fn(async () => {
          throw new Error("db_projection_failed");
        }),
      },
    };
    const chainRegistry = {
      anchorExternalAppRegistration: jest.fn(async () => ({
        mode: "required" as const,
        status: "submitted" as const,
        txSignature: "tx-registration",
        recordPda: "record-pda",
      })),
      anchorExecutionReceipt: jest.fn(async () => ({
        mode: "required" as const,
        status: "submitted" as const,
        txSignature: "tx-receipt",
        recordPda: "record-pda",
      })),
    };

    try {
      await executeExternalAppDecision({
        prisma,
        governanceStore: governanceStore(receipts),
        request: {
          id: "req-6",
          actionType: "external_app_register",
          targetRef: "last-ignition",
          payload: {
            manifest,
            manifestHash,
            ownerAssertion: { payload: "payload", signature: "signature" },
            reviewCircleId: 7,
          },
        },
        decision: { decision: "accepted", decisionDigest: "1".repeat(64) },
        now: new Date("2026-05-13T00:00:00.000Z"),
        chainRegistry,
      });

      expect(chainRegistry.anchorExecutionReceipt).toHaveBeenCalledTimes(1);
      expect(receipts[0]).toMatchObject({ executionStatus: "executed" });
      expect(warnSpy).toHaveBeenCalledWith(
        "[external-app-registry] local projection upsert failed",
        expect.objectContaining({ error: "db_projection_failed" }),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
