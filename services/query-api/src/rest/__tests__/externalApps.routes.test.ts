import express from "express";
import request from "supertest";
import { jest } from "@jest/globals";
import bs58 from "bs58";
import nacl from "tweetnacl";

import { externalAppRouter } from "../externalApps";
import { computeManifestHash, normalizeExternalAppManifest } from "../../services/externalApps/manifest";
import {
  buildExternalAppOwnerAssertionPayload,
  encodeExternalAppOwnerAssertionPayload,
} from "../../services/externalApps/ownerAssertion";

function buildApp(prisma: any) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/external-apps", externalAppRouter(prisma, {} as any));
  return app;
}

describe("external apps routes", () => {
  const previousToken = process.env.EXTERNAL_APP_ADMIN_TOKEN;
  const previousRegistryMode = process.env.EXTERNAL_APP_REGISTRY_MODE;

  afterEach(() => {
    process.env.EXTERNAL_APP_ADMIN_TOKEN = previousToken;
    process.env.EXTERNAL_APP_REGISTRY_MODE = previousRegistryMode;
  });

  it("requires admin token for sandbox registration", async () => {
    process.env.EXTERNAL_APP_ADMIN_TOKEN = "secret";
    const response = await request(buildApp({})).post("/api/v1/external-apps").send({});
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("invalid_external_app_admin_token");
  });

  it("registers sandbox external app records", async () => {
    process.env.EXTERNAL_APP_ADMIN_TOKEN = "secret";
    const prisma = {
      externalApp: {
        upsert: jest.fn(async ({ create }: any) => create),
      },
    };
    const response = await request(buildApp(prisma))
      .post("/api/v1/external-apps")
      .set("x-external-app-admin-token", "secret")
      .send({
        id: "last-ignition",
        name: "Last Ignition",
        ownerPubkey: "owner-wallet",
        allowedOrigins: ["http://127.0.0.1:4173"],
        claimAuthMode: "wallet_only_dev",
        config: { environment: "sandbox", reviewLevel: "sandbox" },
      });
    expect(response.status).toBe(201);
    expect(response.body.app).toMatchObject({
      id: "last-ignition",
      claimAuthMode: "wallet_only_dev",
    });
  });

  it("lists only safe active discovery fields", async () => {
    const prisma = {
      externalApp: {
        findMany: jest.fn(async () => [
          {
            id: "last-ignition",
            name: "Last Ignition",
            registryStatus: "active",
            discoveryStatus: "listed",
            managedNodePolicy: "normal",
            capabilityPolicies: { voice: "normal" },
            manifestHash: "sha256:abc",
            trustScore: "10",
            riskScore: "1",
            communityBackingLevel: "4",
            updatedAt: new Date("2026-05-13T00:00:00.000Z"),
            serverPublicKey: "should-not-leak",
            config: { internal: true },
          },
        ]),
      },
    };

    const response = await request(buildApp(prisma)).get("/api/v1/external-apps/discovery");

    expect(response.status).toBe(200);
    expect(prisma.externalApp.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "active",
          registryStatus: "active",
          discoveryStatus: { in: ["listed", "limited"] },
        }),
      }),
    );
    expect(response.body.apps[0]).toMatchObject({
      id: "last-ignition",
      capabilityPolicies: { voice: "normal" },
      updatedAt: "2026-05-13T00:00:00.000Z",
    });
    expect(response.body.apps[0]).not.toHaveProperty("serverPublicKey");
    expect(response.body.apps[0]).not.toHaveProperty("config");
  });

  it("requires confirmed chain anchor and receipt for production discovery in required mode", async () => {
    process.env.EXTERNAL_APP_REGISTRY_MODE = "required";
    const prisma = {
      externalApp: {
        findMany: jest.fn(async () => [
          {
            id: "anchored-game",
            name: "Anchored Game",
            environment: "mainnet_production",
            registryStatus: "active",
            discoveryStatus: "listed",
            managedNodePolicy: "normal",
            capabilityPolicies: {},
            manifestHash: "sha256:anchored",
            trustScore: null,
            riskScore: null,
            communityBackingLevel: null,
            updatedAt: new Date("2026-05-13T00:00:00.000Z"),
          },
          {
            id: "unanchored-game",
            name: "Unanchored Game",
            environment: "mainnet_production",
            registryStatus: "active",
            discoveryStatus: "listed",
            managedNodePolicy: "normal",
            capabilityPolicies: {},
            manifestHash: "sha256:unanchored",
            trustScore: null,
            riskScore: null,
            communityBackingLevel: null,
            updatedAt: new Date("2026-05-13T00:00:00.000Z"),
          },
        ]),
      },
      externalAppRegistryAnchor: {
        findMany: jest.fn(async () => [
          {
            externalAppId: "anchored-game",
            registryStatus: "active",
            finalityStatus: "confirmed",
            receiptFinalityStatus: "confirmed",
          },
        ]),
      },
    };

    const response = await request(buildApp(prisma)).get("/api/v1/external-apps/discovery");

    expect(response.status).toBe(200);
    expect(response.body.apps.map((app: { id: string }) => app.id)).toEqual([
      "anchored-game",
    ]);
    expect(prisma.externalAppRegistryAnchor.findMany).toHaveBeenCalledWith({
      where: { externalAppId: { in: ["anchored-game", "unanchored-game"] } },
      select: {
        externalAppId: true,
        registryStatus: true,
        finalityStatus: true,
        receiptFinalityStatus: true,
      },
    });
  });

  it("opens production registration as governance request without activating app", async () => {
    const keyPair = nacl.sign.keyPair();
    const ownerPubkey = bs58.encode(Buffer.from(keyPair.publicKey));
    const manifest = {
      version: "1",
      appId: "last-ignition",
      name: "Last Ignition",
      homeUrl: "https://game.example.com",
      ownerWallet: `solana:devnet:${ownerPubkey}`,
      serverPublicKey: "server-key",
      allowedOrigins: ["https://game.example.com"],
      capabilities: ["communication.rooms", "voice.livekit"],
    };
    const manifestHash = computeManifestHash(normalizeExternalAppManifest(manifest));
    const assertionPayload = encodeExternalAppOwnerAssertionPayload(
      buildExternalAppOwnerAssertionPayload({
        appId: "last-ignition",
        ownerWallet: manifest.ownerWallet,
        manifestHash,
        audience: "alcheme:external-app-production-registration",
        expiresAt: "2030-05-13T00:10:00.000Z",
        nonce: "nonce-1",
      }),
    );
    const ownerAssertion = {
      payload: assertionPayload,
      signature: Buffer.from(
        nacl.sign.detached(Buffer.from(assertionPayload), keyPair.secretKey),
      ).toString("base64"),
    };
    const prisma = buildProductionPrismaMock();

    const response = await request(buildApp(prisma))
      .post("/api/v1/external-apps/last-ignition/production-registration-requests")
      .send({
        reviewCircleId: 7,
        reviewPolicyId: "external-app-review-v1",
        reviewPolicyVersionId: "external-app-review-v1:1",
        reviewPolicyVersion: 1,
        manifest,
        ownerAssertion,
      });

    expect(response.status).toBe(202);
    expect(response.body.request.actionType).toBe("external_app_register");
    expect(prisma.externalApp.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerPubkey,
          status: "inactive",
          registryStatus: "pending",
          manifestHash,
        }),
      }),
    );
  });

  it("does not replace active runtime app credentials before governance acceptance", async () => {
    const keyPair = nacl.sign.keyPair();
    const ownerPubkey = bs58.encode(Buffer.from(keyPair.publicKey));
    const manifest = {
      version: "1",
      appId: "last-ignition",
      name: "Last Ignition",
      homeUrl: "https://game.example.com",
      ownerWallet: `solana:devnet:${ownerPubkey}`,
      serverPublicKey: "new-server-key",
      allowedOrigins: ["https://new-game.example.com"],
      capabilities: ["communication.rooms"],
    };
    const manifestHash = computeManifestHash(normalizeExternalAppManifest(manifest));
    const assertionPayload = encodeExternalAppOwnerAssertionPayload(
      buildExternalAppOwnerAssertionPayload({
        appId: "last-ignition",
        ownerWallet: manifest.ownerWallet,
        manifestHash,
        audience: "alcheme:external-app-production-registration",
        expiresAt: "2030-05-13T00:10:00.000Z",
        nonce: "nonce-1",
      }),
    );
    const prisma = buildProductionPrismaMock({
      existingApp: { status: "active", registryStatus: "active" },
    });

    const response = await request(buildApp(prisma))
      .post("/api/v1/external-apps/last-ignition/production-registration-requests")
      .send({
        reviewCircleId: 7,
        reviewPolicyId: "external-app-review-v1",
        reviewPolicyVersionId: "external-app-review-v1:1",
        reviewPolicyVersion: 1,
        manifest,
        ownerAssertion: {
          payload: assertionPayload,
          signature: Buffer.from(
            nacl.sign.detached(Buffer.from(assertionPayload), keyPair.secretKey),
          ).toString("base64"),
        },
      });

    expect(response.status).toBe(202);
    expect(prisma.externalApp.update).toHaveBeenCalledWith({
      where: { id: "last-ignition" },
      data: {
        reviewCircleId: 7,
        reviewPolicyId: "external-app-review-v1",
      },
    });
  });
});

function buildProductionPrismaMock(options: { existingApp?: unknown } = {}) {
  return {
    circle: {
      findUnique: jest.fn(async () => ({
        id: 7,
        kind: "auxiliary",
        mode: "governance",
        circleType: "Secret",
      })),
    },
    governancePolicy: {
      findFirst: jest.fn(async () => ({ id: "external-app-review-v1" })),
    },
    governancePolicyVersion: {
      findFirst: jest.fn(async () => ({ id: "external-app-review-v1:1" })),
    },
    circleMember: {
      findMany: jest.fn(async () => [
        {
          role: "Admin",
          user: { pubkey: "reviewer-wallet" },
        },
      ]),
    },
    externalApp: {
      findUnique: jest.fn(async () => options.existingApp ?? null),
      create: jest.fn(async ({ data }: any) => data),
      update: jest.fn(async ({ data }: any) => data),
    },
    governanceRequest: {
      create: jest.fn(async ({ data }: any) => data),
    },
    governanceSnapshot: {
      create: jest.fn(async ({ data }: any) => data),
    },
    governanceSignal: {
      create: jest.fn(async ({ data }: any) => data),
    },
  };
}
