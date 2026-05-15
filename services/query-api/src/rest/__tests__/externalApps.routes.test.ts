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
import {
  buildRiskDisclaimerTerms,
  computeRiskDisclaimerAcceptanceDigest,
} from "../../services/externalApps/riskDisclaimer";
import type { RiskDisclaimerReceiptVerifier } from "../../services/externalApps/riskDisclaimerChainVerifier";

function buildApp(
  prisma: any,
  deps?: { riskReceiptVerifier?: RiskDisclaimerReceiptVerifier },
) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/external-apps", externalAppRouter(prisma, {} as any, deps));
  return app;
}

function makeDeveloperAgreement(input: {
  externalAppId?: string;
  actorPubkey: string;
  manifestHash: string;
  policyEpochId?: string;
}) {
  const terms = buildRiskDisclaimerTerms("developer_registration");
  const policyEpochId = input.policyEpochId ?? "external-app-review-v1:1";
  const acceptanceDigest = computeRiskDisclaimerAcceptanceDigest({
    externalAppId: input.externalAppId ?? "last-ignition",
    actorPubkey: input.actorPubkey,
    scope: "developer_registration",
    policyEpochId,
    disclaimerVersion: terms.disclaimerVersion,
    termsDigest: terms.termsDigest,
    bindingDigest: input.manifestHash,
  });
  return {
    disclaimerVersion: terms.disclaimerVersion,
    termsDigest: terms.termsDigest,
    acceptanceDigest,
    signatureDigest: "sha256:" + "1".repeat(64),
    chainReceiptPda: "developer-agreement-receipt-pda",
    chainReceiptDigest: "2".repeat(64),
    txSignature: "developer-agreement-tx",
  };
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

  it("exposes scoped disclaimer terms before third-party acceptance", async () => {
    const response = await request(buildApp({})).get(
      "/api/v1/external-apps/risk-disclaimers/developer_registration",
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      scope: "developer_registration",
      disclaimerVersion: "external-app-developer-agreement-v1",
      onChainReceiptRequired: true,
    });
    expect(response.body.termsDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(response.body.terms).toContain("External app operators and participants accept their own app rules");
  });

  it("records chain-backed participant disclaimer acceptance", async () => {
    const terms = buildRiskDisclaimerTerms("external_app_entry");
    const acceptanceDigest = computeRiskDisclaimerAcceptanceDigest({
      externalAppId: "last-ignition",
      actorPubkey: "player-wallet",
      scope: "external_app_entry",
      policyEpochId: "epoch-1",
      disclaimerVersion: terms.disclaimerVersion,
      termsDigest: terms.termsDigest,
    });
    const prisma = {
      externalApp: {
        findUnique: jest.fn(async () => ({ id: "last-ignition" })),
      },
      externalAppRiskDisclaimerAcceptance: {
        create: jest.fn(async ({ data }: any) => data),
      },
    };
    const response = await request(buildApp(prisma))
      .post("/api/v1/external-apps/last-ignition/risk-disclaimer-acceptances")
      .send({
        actorPubkey: "player-wallet",
        scope: "external_app_entry",
        policyEpochId: "epoch-1",
        disclaimerVersion: terms.disclaimerVersion,
        termsDigest: terms.termsDigest,
        acceptanceDigest,
        signatureDigest: "sha256:" + "1".repeat(64),
        chainReceiptPda: "entry-risk-receipt-pda",
        chainReceiptDigest: "2".repeat(64),
        txSignature: "entry-risk-tx",
      });

    expect(response.status).toBe(201);
    expect(response.body.acceptance).toMatchObject({
      externalAppId: "last-ignition",
      actorPubkey: "player-wallet",
      scope: "external_app_entry",
      chainReceiptPda: "entry-risk-receipt-pda",
      txSignature: "entry-risk-tx",
    });
    expect(prisma.externalAppRiskDisclaimerAcceptance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        termsDigest: terms.termsDigest,
        acceptanceDigest,
      }),
    });
  });

  it("verifies a chain-backed participant disclaimer receipt before recording it", async () => {
    const terms = buildRiskDisclaimerTerms("external_app_entry");
    const acceptanceDigest = computeRiskDisclaimerAcceptanceDigest({
      externalAppId: "last-ignition",
      actorPubkey: "player-wallet",
      scope: "external_app_entry",
      policyEpochId: "epoch-1",
      disclaimerVersion: terms.disclaimerVersion,
      termsDigest: terms.termsDigest,
    });
    const riskReceiptVerifier: RiskDisclaimerReceiptVerifier = {
      verifyRiskDisclaimerReceipt: jest.fn(async () => undefined),
    };
    const prisma = {
      externalApp: {
        findUnique: jest.fn(async () => ({ id: "last-ignition" })),
      },
      externalAppRiskDisclaimerAcceptance: {
        create: jest.fn(async ({ data }: any) => data),
      },
    };

    const response = await request(buildApp(prisma, { riskReceiptVerifier }))
      .post("/api/v1/external-apps/last-ignition/risk-disclaimer-acceptances")
      .send({
        actorPubkey: "player-wallet",
        scope: "external_app_entry",
        policyEpochId: "epoch-1",
        disclaimerVersion: terms.disclaimerVersion,
        termsDigest: terms.termsDigest,
        acceptanceDigest,
        signatureDigest: "sha256:" + "1".repeat(64),
        chainReceiptPda: "entry-risk-receipt-pda",
        chainReceiptDigest: "2".repeat(64),
        txSignature: "entry-risk-tx",
      });

    expect(response.status).toBe(201);
    expect(riskReceiptVerifier.verifyRiskDisclaimerReceipt).toHaveBeenCalledWith({
      externalAppId: "last-ignition",
      actorPubkey: "player-wallet",
      scope: "external_app_entry",
      termsDigest: terms.termsDigest,
      acceptanceDigest,
      chainReceiptPda: "entry-risk-receipt-pda",
      chainReceiptDigest: "2".repeat(64),
      txSignature: "entry-risk-tx",
    });
  });

  it("rejects participant disclaimer acceptance when the chain receipt cannot be verified", async () => {
    const terms = buildRiskDisclaimerTerms("external_app_entry");
    const acceptanceDigest = computeRiskDisclaimerAcceptanceDigest({
      externalAppId: "last-ignition",
      actorPubkey: "player-wallet",
      scope: "external_app_entry",
      policyEpochId: "epoch-1",
      disclaimerVersion: terms.disclaimerVersion,
      termsDigest: terms.termsDigest,
    });
    const riskReceiptVerifier: RiskDisclaimerReceiptVerifier = {
      verifyRiskDisclaimerReceipt: jest.fn(async () => {
        throw new Error("external_app_risk_receipt_not_found");
      }),
    };
    const prisma = {
      externalApp: {
        findUnique: jest.fn(async () => ({ id: "last-ignition" })),
      },
      externalAppRiskDisclaimerAcceptance: {
        create: jest.fn(),
      },
    };

    const response = await request(buildApp(prisma, { riskReceiptVerifier }))
      .post("/api/v1/external-apps/last-ignition/risk-disclaimer-acceptances")
      .send({
        actorPubkey: "player-wallet",
        scope: "external_app_entry",
        policyEpochId: "epoch-1",
        disclaimerVersion: terms.disclaimerVersion,
        termsDigest: terms.termsDigest,
        acceptanceDigest,
        chainReceiptPda: "entry-risk-receipt-pda",
        chainReceiptDigest: "2".repeat(64),
        txSignature: "entry-risk-tx",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("external_app_risk_receipt_not_found");
    expect(prisma.externalAppRiskDisclaimerAcceptance.create).not.toHaveBeenCalled();
  });

  it("requires a manifest binding digest for developer registration acceptances", async () => {
    const terms = buildRiskDisclaimerTerms("developer_registration");
    const acceptanceDigest = computeRiskDisclaimerAcceptanceDigest({
      externalAppId: "last-ignition",
      actorPubkey: "developer-wallet",
      scope: "developer_registration",
      policyEpochId: "external-app-review-v1:1",
      disclaimerVersion: terms.disclaimerVersion,
      termsDigest: terms.termsDigest,
    });
    const prisma = {
      externalApp: {
        findUnique: jest.fn(async () => ({ id: "last-ignition" })),
      },
      externalAppRiskDisclaimerAcceptance: {
        create: jest.fn(),
      },
    };

    const response = await request(buildApp(prisma))
      .post("/api/v1/external-apps/last-ignition/risk-disclaimer-acceptances")
      .send({
        actorPubkey: "developer-wallet",
        scope: "developer_registration",
        policyEpochId: "external-app-review-v1:1",
        disclaimerVersion: terms.disclaimerVersion,
        termsDigest: terms.termsDigest,
        acceptanceDigest,
        chainReceiptPda: "developer-agreement-receipt-pda",
        chainReceiptDigest: "2".repeat(64),
        txSignature: "developer-agreement-tx",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe(
      "external_app_developer_agreement_binding_digest_required",
    );
    expect(prisma.externalAppRiskDisclaimerAcceptance.create).not.toHaveBeenCalled();
  });

  it("stores developer registration binding digest with the acceptance metadata", async () => {
    const terms = buildRiskDisclaimerTerms("developer_registration");
    const bindingDigest = "sha256:" + "4".repeat(64);
    const acceptanceDigest = computeRiskDisclaimerAcceptanceDigest({
      externalAppId: "last-ignition",
      actorPubkey: "developer-wallet",
      scope: "developer_registration",
      policyEpochId: "external-app-review-v1:1",
      disclaimerVersion: terms.disclaimerVersion,
      termsDigest: terms.termsDigest,
      bindingDigest,
    });
    const riskReceiptVerifier: RiskDisclaimerReceiptVerifier = {
      verifyRiskDisclaimerReceipt: jest.fn(async () => undefined),
    };
    const prisma = {
      externalApp: {
        findUnique: jest.fn(async () => ({ id: "last-ignition" })),
      },
      externalAppRiskDisclaimerAcceptance: {
        create: jest.fn(async ({ data }: any) => data),
      },
    };

    const response = await request(buildApp(prisma, { riskReceiptVerifier }))
      .post("/api/v1/external-apps/last-ignition/risk-disclaimer-acceptances")
      .send({
        actorPubkey: "developer-wallet",
        scope: "developer_registration",
        policyEpochId: "external-app-review-v1:1",
        disclaimerVersion: terms.disclaimerVersion,
        termsDigest: terms.termsDigest,
        acceptanceDigest,
        bindingDigest,
        chainReceiptPda: "developer-agreement-receipt-pda",
        chainReceiptDigest: "2".repeat(64),
        txSignature: "developer-agreement-tx",
        metadata: { source: "developer-dashboard" },
      });

    expect(response.status).toBe(201);
    expect(prisma.externalAppRiskDisclaimerAcceptance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: {
          source: "developer-dashboard",
          bindingDigest,
        },
      }),
    });
  });

  it("rejects participant disclaimer acceptance for an unknown external app", async () => {
    const terms = buildRiskDisclaimerTerms("external_app_entry");
    const acceptanceDigest = computeRiskDisclaimerAcceptanceDigest({
      externalAppId: "missing-game",
      actorPubkey: "player-wallet",
      scope: "external_app_entry",
      policyEpochId: "epoch-1",
      disclaimerVersion: terms.disclaimerVersion,
      termsDigest: terms.termsDigest,
    });
    const prisma = {
      externalApp: {
        findUnique: jest.fn(async () => null),
      },
      externalAppRiskDisclaimerAcceptance: {
        create: jest.fn(),
      },
    };
    const response = await request(buildApp(prisma))
      .post("/api/v1/external-apps/missing-game/risk-disclaimer-acceptances")
      .send({
        actorPubkey: "player-wallet",
        scope: "external_app_entry",
        policyEpochId: "epoch-1",
        disclaimerVersion: terms.disclaimerVersion,
        termsDigest: terms.termsDigest,
        acceptanceDigest,
        chainReceiptPda: "entry-risk-receipt-pda",
        chainReceiptDigest: "2".repeat(64),
        txSignature: "entry-risk-tx",
      });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("external_app_not_found");
    expect(prisma.externalAppRiskDisclaimerAcceptance.create).not.toHaveBeenCalled();
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
      externalAppStabilityProjection: {
        findMany: jest.fn(async () => [
          {
            externalAppId: "last-ignition",
            policyEpochId: "epoch-1",
            challengeState: "none",
            projectionStatus: "normal",
            publicLabels: ["Risk Notice"],
            riskScore: 12,
            trustScore: 78,
            supportSignalLevel: 4,
            supportIndependenceScore: 0.8,
            rollout: { exposed: true, bucket: 42, exposureBasisPoints: 5000 },
            formulaInputs: { parserVersion: "v3a.1" },
            formulaOutputs: { riskScore: 12, trustScore: 78 },
            bondDispositionState: {
              state: "locked_for_case",
              activeLockedAmountRaw: "100",
              totalRoutedAmountRaw: "0",
              activeCaseCount: 1,
              riskDisclaimerAccepted: true,
              riskDisclaimerRequired: true,
            },
            governanceState: {
              captureReviewStatus: "open",
              projectionDisputeStatus: "none",
              emergencyHoldStatus: "none",
              highImpactActionsPaused: true,
              labels: ["Capture Review"],
            },
            statusProvenance: { registryStatus: { source: "external_apps" } },
            updatedAt: new Date("2026-05-13T00:00:00.000Z"),
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
      stabilityProjection: {
        policyEpochId: "epoch-1",
        challengeState: "none",
        projectionStatus: "normal",
        publicLabels: ["Risk Notice"],
        bondDispositionState: {
          state: "locked_for_case",
          activeLockedAmountRaw: "100",
          totalRoutedAmountRaw: "0",
          activeCaseCount: 1,
          riskDisclaimerAccepted: true,
          riskDisclaimerRequired: true,
        },
        governanceState: {
          captureReviewStatus: "open",
          highImpactActionsPaused: true,
          labels: ["Capture Review"],
        },
      },
    });
    expect(prisma.externalAppStabilityProjection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          bondDispositionState: true,
          governanceState: true,
        }),
      }),
    );
    expect(response.body.apps[0]).not.toHaveProperty("serverPublicKey");
    expect(response.body.apps[0]).not.toHaveProperty("config");
  });

  it("returns a stability projection debug view without changing registry status", async () => {
    const prisma = {
      externalApp: {
        findUnique: jest.fn(async () => ({
          id: "last-ignition",
          name: "Last Ignition",
          status: "active",
          environment: "mainnet_production",
          registryStatus: "active",
          discoveryStatus: "listed",
          managedNodePolicy: "normal",
          capabilityPolicies: {},
          manifestHash: "sha256:abc",
          trustScore: "80",
          riskScore: "8",
          communityBackingLevel: "4",
          ownerBond: null,
          updatedAt: new Date("2026-05-13T00:00:00.000Z"),
        })),
      },
      externalAppStabilityProjection: {
        findFirst: jest.fn(async () => ({
          externalAppId: "last-ignition",
          policyEpochId: "epoch-1",
          challengeState: "dispute",
          projectionStatus: "projection_disputed",
          publicLabels: ["Under Challenge"],
          riskScore: 70,
          trustScore: 30,
          supportSignalLevel: 2,
          supportIndependenceScore: 0.4,
          rollout: { exposed: false, bucket: 9000, exposureBasisPoints: 5000 },
          formulaInputs: {},
          formulaOutputs: {},
          bondDispositionState: {
            state: "routed_by_policy",
            activeLockedAmountRaw: "0",
            totalRoutedAmountRaw: "50",
            activeCaseCount: 0,
            riskDisclaimerAccepted: true,
            riskDisclaimerRequired: true,
          },
          governanceState: {
            captureReviewStatus: "none",
            projectionDisputeStatus: "open",
            emergencyHoldStatus: "none",
            highImpactActionsPaused: true,
            labels: ["Projection Disputed"],
          },
          statusProvenance: { registryStatus: { source: "external_apps" } },
          updatedAt: new Date("2026-05-13T00:00:00.000Z"),
        })),
      },
    };

    const response = await request(buildApp(prisma)).get(
      "/api/v1/external-apps/last-ignition/stability-projection",
    );

    expect(response.status).toBe(200);
    expect(response.body.registryStatus).toBe("active");
    expect(response.body.stabilityProjection).toMatchObject({
      challengeState: "dispute",
      projectionStatus: "projection_disputed",
      publicLabels: ["Under Challenge"],
      bondDispositionState: {
        state: "routed_by_policy",
        totalRoutedAmountRaw: "50",
      },
      governanceState: {
        projectionDisputeStatus: "open",
        highImpactActionsPaused: true,
      },
    });
  });

  it("applies store query filters without exposing app config", async () => {
    const prisma = {
      externalApp: {
        findMany: jest.fn(async () => [
          {
            id: "last-ignition",
            name: "Last Ignition",
            status: "active",
            environment: "sandbox",
            registryStatus: "active",
            discoveryStatus: "listed",
            managedNodePolicy: "normal",
            capabilityPolicies: {},
            manifestHash: "sha256:abc",
            trustScore: "80",
            riskScore: "8",
            ownerBond: null,
            communityBackingLevel: "4",
            config: { manifest: { categoryTags: ["game"] } },
            updatedAt: new Date("2026-05-14T00:00:00.000Z"),
          },
          {
            id: "old-puzzle",
            name: "Old Puzzle",
            status: "active",
            environment: "sandbox",
            registryStatus: "active",
            discoveryStatus: "listed",
            managedNodePolicy: "normal",
            capabilityPolicies: {},
            manifestHash: "sha256:def",
            trustScore: "60",
            riskScore: "20",
            ownerBond: null,
            communityBackingLevel: null,
            config: { manifest: { categoryTags: ["puzzle"] } },
            updatedAt: new Date("2026-05-10T00:00:00.000Z"),
          },
        ]),
      },
    };

    const response = await request(buildApp(prisma)).get(
      "/api/v1/external-apps/discovery?q=ignition&category=game&sort=featured&limit=1",
    );

    expect(response.status).toBe(200);
    expect(response.body.apps.map((app: { id: string }) => app.id)).toEqual([
      "last-ignition",
    ]);
    expect(response.body.apps[0].storeProjection).toMatchObject({
      listingState: "listed_full",
      categoryTags: ["game"],
    });
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
    const developerAgreement = makeDeveloperAgreement({
      actorPubkey: ownerPubkey,
      manifestHash,
    });
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
        developerAgreement,
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
    const developerAgreement = makeDeveloperAgreement({
      actorPubkey: ownerPubkey,
      manifestHash,
    });
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
        developerAgreement,
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
    systemGovernanceRoleBinding: {
      findFirst: jest.fn(async () => ({
        id: "binding-1",
        domain: "external_app",
        roleKey: "external_app_review_primary",
        environment: "production",
        circleId: 7,
        policyId: "external-app-review-v1",
        policyVersionId: "external-app-review-v1:1",
        policyVersion: 1,
        status: "active",
        activatedAt: new Date("2026-05-14T00:00:00.000Z"),
      })),
    },
    circle: {
      findUnique: jest.fn(async () => ({
        id: 7,
        kind: "auxiliary",
        mode: "governance",
        circleType: "Secret",
      })),
    },
    governancePolicy: {
      findFirst: jest.fn(async () => ({
        id: "external-app-review-v1",
        scopeType: "external_app_review_circle",
        scopeRef: "7",
        status: "active",
      })),
    },
    governancePolicyVersion: {
      findFirst: jest.fn(async () => ({
        id: "external-app-review-v1:1",
        policyId: "external-app-review-v1",
        version: 1,
        status: "active",
      })),
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
    externalAppRiskDisclaimerAcceptance: {
      create: jest.fn(async ({ data }: any) => data),
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
