import bs58 from "bs58";
import nacl from "tweetnacl";

import {
  computeManifestHash,
  normalizeExternalAppManifest,
  type ExternalAppManifest,
} from "../manifest";
import {
  buildExternalAppOwnerAssertionPayload,
  encodeExternalAppOwnerAssertionPayload,
} from "../ownerAssertion";
import { openExternalAppProductionRegistrationRequest } from "../productionRegistry";
import { buildProductionExternalAppRegistrationRequest } from "../productionRegistry";
import {
  buildRiskDisclaimerTerms,
  computeRiskDisclaimerAcceptanceDigest,
} from "../riskDisclaimer";
import type { RiskDisclaimerReceiptVerifier } from "../riskDisclaimerChainVerifier";

function makeSignedManifest(): {
  manifest: ExternalAppManifest;
  ownerAssertion: { payload: string; signature: string };
} {
  const keyPair = nacl.sign.keyPair();
  const ownerPubkey = bs58.encode(Buffer.from(keyPair.publicKey));
  const manifest = normalizeExternalAppManifest({
    version: "1" as const,
    appId: "last-ignition",
    name: "Last Ignition",
    homeUrl: "https://game.example.com",
    ownerWallet: `solana:devnet:${ownerPubkey}`,
    serverPublicKey: "server-key",
    allowedOrigins: ["https://game.example.com"],
    capabilities: ["communication.rooms"],
  });
  const payload = buildExternalAppOwnerAssertionPayload({
    appId: manifest.appId,
    ownerWallet: manifest.ownerWallet,
    manifestHash: computeManifestHash(manifest),
    audience: "alcheme:external-app-production-registration",
    expiresAt: "2099-01-01T00:00:00.000Z",
    nonce: "nonce-1",
  });
  const encoded = encodeExternalAppOwnerAssertionPayload(payload);
  const signature = Buffer.from(
    nacl.sign.detached(Buffer.from(encoded), keyPair.secretKey),
  ).toString("base64");
  return { manifest, ownerAssertion: { payload: encoded, signature } };
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

function makeProductionPrisma() {
  const createdExternalApps: unknown[] = [];
  const governanceRequests: unknown[] = [];
  const riskDisclaimerAcceptances: unknown[] = [];
  return {
    createdExternalApps,
    governanceRequests,
    riskDisclaimerAcceptances,
    prisma: {
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
          supersededAt: null,
          createdByPubkey: "operator-wallet",
          sourceRequestId: "req-binding",
          sourceDecisionDigest: "a".repeat(64),
          sourceExecutionReceiptId: "receipt-binding",
          metadata: {},
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
          { role: "Admin", user: { pubkey: "reviewer-wallet" } },
        ]),
      },
      externalApp: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(async (input: unknown) => {
          createdExternalApps.push(input);
          return input;
        }),
        update: jest.fn(async (input: unknown) => input),
      },
      externalAppRiskDisclaimerAcceptance: {
        create: jest.fn(async (input: { data: unknown }) => {
          riskDisclaimerAcceptances.push(input.data);
          return input.data;
        }),
      },
      governanceRequest: {
        create: jest.fn(async (input: { data: unknown }) => {
          governanceRequests.push(input.data);
          return input.data;
        }),
      },
      governanceSnapshot: {
        create: jest.fn(async (input: { data: unknown }) => input.data),
      },
      governanceSignal: {
        create: jest.fn(async (input: { data: unknown }) => input.data),
      },
    },
  };
}

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
      ownerAssertion: { payload: "payload", signature: "signature" },
      developerAgreement: {
        scope: "developer_registration",
        disclaimerVersion: "external-app-developer-agreement-v1",
        termsDigest: "sha256:" + "0".repeat(64),
        acceptanceDigest: "sha256:" + "1".repeat(64),
        signatureDigest: "sha256:" + "3".repeat(64),
        chainReceiptPda: "receipt-pda",
        chainReceiptDigest: "2".repeat(64),
        txSignature: "tx",
      },
      idempotencyKey: "last-ignition:sha256:abc",
      openedAt: new Date("2026-05-13T00:00:00.000Z"),
    });

    expect(request.action.type).toBe("external_app_register");
    expect(request.scope).toEqual({ type: "external_app_review_circle", ref: "7" });
    expect(request.action.targetType).toBe("external_app");
    expect(request.action.targetRef).toBe("last-ignition");
    expect(request.action.payload).toMatchObject({
      manifestHash: "sha256:abc",
      manifest,
      developerAgreement: {
        scope: "developer_registration",
        chainReceiptPda: "receipt-pda",
      },
    });
  });

  it("requires a chain-anchored developer agreement before production registration", async () => {
    const { manifest, ownerAssertion } = makeSignedManifest();
    const { prisma } = makeProductionPrisma();

    await expect(
      openExternalAppProductionRegistrationRequest(
        prisma as never,
        "last-ignition",
        { manifest, ownerAssertion },
      ),
    ).rejects.toThrow("external_app_developer_agreement_required");
  });

  it("opens production registration through the default active system role binding", async () => {
    const { manifest, ownerAssertion } = makeSignedManifest();
    const { prisma, createdExternalApps, governanceRequests, riskDisclaimerAcceptances } = makeProductionPrisma();
    const developerAgreement = makeDeveloperAgreement({
      actorPubkey: manifest.ownerWallet.split(":").at(-1) ?? manifest.ownerWallet,
      manifestHash: computeManifestHash(manifest),
    });

    await openExternalAppProductionRegistrationRequest(
      prisma as never,
      "last-ignition",
      { manifest, ownerAssertion, developerAgreement },
    );

    expect(createdExternalApps[0]).toMatchObject({
      data: {
        id: "last-ignition",
        reviewCircleId: 7,
        reviewPolicyId: "external-app-review-v1",
      },
    });
    expect(governanceRequests[0]).toMatchObject({
      policyId: "external-app-review-v1",
      policyVersionId: "external-app-review-v1:1",
      policyVersion: 1,
      scopeType: "external_app_review_circle",
      scopeRef: "7",
      payload: {
        developerAgreement: {
          scope: "developer_registration",
          chainReceiptPda: "developer-agreement-receipt-pda",
          txSignature: "developer-agreement-tx",
        },
        reviewCircleId: 7,
        reviewPolicyId: "external-app-review-v1",
        reviewPolicyVersionId: "external-app-review-v1:1",
        reviewPolicyVersion: 1,
      },
    });
    expect(riskDisclaimerAcceptances[0]).toMatchObject({
      externalAppId: "last-ignition",
      scope: "developer_registration",
      policyEpochId: "external-app-review-v1:1",
      disclaimerVersion: "external-app-developer-agreement-v1",
      chainReceiptPda: "developer-agreement-receipt-pda",
      txSignature: "developer-agreement-tx",
    });
  });

  it("verifies developer agreement chain receipt before opening production registration", async () => {
    const { manifest, ownerAssertion } = makeSignedManifest();
    const { prisma } = makeProductionPrisma();
    const proposerPubkey = manifest.ownerWallet.split(":").at(-1) ?? manifest.ownerWallet;
    const manifestHash = computeManifestHash(manifest);
    const developerAgreement = makeDeveloperAgreement({
      actorPubkey: proposerPubkey,
      manifestHash,
    });
    const riskReceiptVerifier: RiskDisclaimerReceiptVerifier = {
      verifyRiskDisclaimerReceipt: jest.fn(async () => undefined),
    };

    await openExternalAppProductionRegistrationRequest(
      prisma as never,
      "last-ignition",
      { manifest, ownerAssertion, developerAgreement },
      { riskReceiptVerifier },
    );

    expect(riskReceiptVerifier.verifyRiskDisclaimerReceipt).toHaveBeenCalledWith({
      externalAppId: "last-ignition",
      actorPubkey: proposerPubkey,
      scope: "developer_registration",
      termsDigest: developerAgreement.termsDigest,
      acceptanceDigest: developerAgreement.acceptanceDigest,
      chainReceiptPda: developerAgreement.chainReceiptPda,
      chainReceiptDigest: developerAgreement.chainReceiptDigest,
      txSignature: developerAgreement.txSignature,
    });
  });

  it("rejects production registration when developer agreement chain receipt fails verification", async () => {
    const { manifest, ownerAssertion } = makeSignedManifest();
    const { prisma, governanceRequests, riskDisclaimerAcceptances } = makeProductionPrisma();
    const developerAgreement = makeDeveloperAgreement({
      actorPubkey: manifest.ownerWallet.split(":").at(-1) ?? manifest.ownerWallet,
      manifestHash: computeManifestHash(manifest),
    });
    const riskReceiptVerifier: RiskDisclaimerReceiptVerifier = {
      verifyRiskDisclaimerReceipt: jest.fn(async () => {
        throw new Error("external_app_risk_receipt_digest_mismatch");
      }),
    };

    await expect(
      openExternalAppProductionRegistrationRequest(
        prisma as never,
        "last-ignition",
        { manifest, ownerAssertion, developerAgreement },
        { riskReceiptVerifier },
      ),
    ).rejects.toThrow("external_app_risk_receipt_digest_mismatch");
    expect(riskDisclaimerAcceptances).toHaveLength(0);
    expect(governanceRequests).toHaveLength(0);
  });

  it("rejects caller-supplied review binding assertions that do not match the active binding", async () => {
    const { manifest, ownerAssertion } = makeSignedManifest();
    const { prisma } = makeProductionPrisma();
    const developerAgreement = makeDeveloperAgreement({
      actorPubkey: manifest.ownerWallet.split(":").at(-1) ?? manifest.ownerWallet,
      manifestHash: computeManifestHash(manifest),
    });

    await expect(
      openExternalAppProductionRegistrationRequest(
        prisma as never,
        "last-ignition",
        {
          manifest,
          ownerAssertion,
          developerAgreement,
          reviewCircleId: 999,
          reviewPolicyId: "external-app-review-v1",
          reviewPolicyVersionId: "external-app-review-v1:1",
        },
      ),
    ).rejects.toThrow("external_app_review_binding_mismatch");
  });
});
