import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import {
  createPrismaGovernanceRequestStore,
  openGovernanceRequest,
  type GovernanceEligibleActor,
} from "../governance/policyEngine";
import {
  computeManifestHash,
  normalizeExternalAppManifest,
  type ExternalAppManifest,
} from "./manifest";
import {
  extractSolanaOwnerPubkey,
  verifyExternalAppOwnerAssertion,
} from "./ownerAssertion";
import { assertReviewCircle } from "./reviewBinding";
import { normalizeExternalAppId } from "./validation";

export function buildProductionExternalAppRegistrationRequest(input: {
  externalAppId: string;
  proposerPubkey: string;
  reviewPolicyId: string;
  reviewPolicyVersionId: string;
  reviewPolicyVersion: number;
  reviewCircleId: number;
  eligibleActors: GovernanceEligibleActor[];
  manifestHash: string;
  manifest: ExternalAppManifest;
  idempotencyKey: string;
  openedAt: Date;
}) {
  if (input.eligibleActors.length === 0) {
    throw new Error("external_app_review_requires_eligible_actors");
  }
  return {
    id: randomUUID(),
    policyId: input.reviewPolicyId,
    policyVersionId: input.reviewPolicyVersionId,
    policyVersion: input.reviewPolicyVersion,
    ruleId: "external_app_register",
    scope: { type: "external_app_review_circle", ref: String(input.reviewCircleId) },
    action: {
      type: "external_app_register",
      targetType: "external_app",
      targetRef: input.externalAppId,
      payload: { manifestHash: input.manifestHash, manifest: input.manifest },
      idempotencyKey: input.idempotencyKey,
    },
    proposerPubkey: input.proposerPubkey,
    eligibleActors: input.eligibleActors,
    openedAt: input.openedAt,
  };
}

export async function openExternalAppProductionRegistrationRequest(
  prisma: PrismaClient,
  rawAppId: string,
  body: Record<string, unknown>,
) {
  const externalAppId = normalizeExternalAppId(rawAppId);
  const reviewCircleId = Number(body.reviewCircleId);
  const reviewPolicyId = String(body.reviewPolicyId || "").trim();
  const reviewPolicyVersionId = String(body.reviewPolicyVersionId || "").trim();
  const reviewPolicyVersion = Number(body.reviewPolicyVersion || 1);
  if (
    !Number.isSafeInteger(reviewCircleId) ||
    reviewCircleId <= 0 ||
    !reviewPolicyId ||
    !reviewPolicyVersionId
  ) {
    throw new Error("invalid_external_app_production_registration_request");
  }

  const manifest = normalizeExternalAppManifest(body.manifest);
  if (manifest.appId !== externalAppId) {
    throw new Error("external_app_manifest_app_id_mismatch");
  }
  const manifestHash = computeManifestHash(manifest);
  const ownerAssertion = body.ownerAssertion as
    | { payload?: unknown; signature?: unknown }
    | undefined;
  if (!ownerAssertion?.payload || !ownerAssertion.signature) {
    throw new Error("external_app_owner_assertion_required");
  }
  verifyExternalAppOwnerAssertion({
    assertion: {
      payload: String(ownerAssertion.payload),
      signature: String(ownerAssertion.signature),
    },
    expected: {
      appId: externalAppId,
      ownerWallet: manifest.ownerWallet,
      manifestHash,
      audience: "alcheme:external-app-production-registration",
    },
    now: new Date(),
  });
  const proposerPubkey = extractSolanaOwnerPubkey(manifest.ownerWallet);

  const reviewCircle = await prisma.circle.findUnique({
    where: { id: reviewCircleId },
    select: { id: true, kind: true, mode: true, circleType: true },
  });
  if (!reviewCircle) {
    throw new Error("external_app_review_circle_not_found");
  }
  assertReviewCircle(reviewCircle);

  const reviewPolicy = await prisma.governancePolicy.findFirst({
    where: {
      id: reviewPolicyId,
      scopeType: "external_app_review_circle",
      scopeRef: String(reviewCircleId),
      status: "active",
    },
    select: { id: true },
  });
  if (!reviewPolicy) {
    throw new Error("external_app_review_policy_not_found");
  }
  const reviewPolicyVersionRecord = await prisma.governancePolicyVersion.findFirst({
    where: {
      id: reviewPolicyVersionId,
      policyId: reviewPolicyId,
      version: reviewPolicyVersion,
      status: "active",
    },
    select: { id: true },
  });
  if (!reviewPolicyVersionRecord) {
    throw new Error("external_app_review_policy_version_not_found");
  }

  const reviewMembers = await prisma.circleMember.findMany({
    where: { circleId: reviewCircleId, status: "Active" },
    include: { user: { select: { pubkey: true } } },
  });
  const eligibleActors = reviewMembers.map((member) => ({
    pubkey: member.user.pubkey,
    role: String(member.role),
    weight: "1",
    source: "external_app_review_circle",
  }));
  if (eligibleActors.length === 0) {
    throw new Error("external_app_review_requires_eligible_actors");
  }

  const existingApp = await prisma.externalApp.findUnique({
    where: { id: externalAppId },
    select: { status: true, registryStatus: true },
  });
  const preservesActiveRuntime =
    existingApp?.status === "active" && existingApp.registryStatus === "active"
      ? true
      : false;

  if (!existingApp) {
    await prisma.externalApp.create({
      data: {
        id: externalAppId,
        name: manifest.name,
        ownerPubkey: proposerPubkey,
        status: "inactive",
        serverPublicKey: manifest.serverPublicKey,
        claimAuthMode: "server_ed25519",
        allowedOrigins: manifest.allowedOrigins,
        config: { manifest } as unknown as Prisma.InputJsonValue,
        environment: "mainnet_production",
        registryStatus: "pending",
        discoveryStatus: "unlisted",
        managedNodePolicy: "restricted",
        manifestHash,
        reviewCircleId,
        reviewPolicyId,
      },
    });
  } else if (preservesActiveRuntime) {
    await prisma.externalApp.update({
      where: { id: externalAppId },
      data: {
        reviewCircleId,
        reviewPolicyId,
      },
    });
  } else {
    await prisma.externalApp.update({
      where: { id: externalAppId },
      data: {
        name: manifest.name,
        ownerPubkey: proposerPubkey,
        status: "inactive",
        serverPublicKey: manifest.serverPublicKey,
        allowedOrigins: manifest.allowedOrigins,
        config: { manifest } as unknown as Prisma.InputJsonValue,
        environment: "mainnet_production",
        registryStatus: "pending",
        manifestHash,
        reviewCircleId,
        reviewPolicyId,
      },
    });
  }

  const requestInput = buildProductionExternalAppRegistrationRequest({
    externalAppId,
    proposerPubkey,
    reviewPolicyId,
    reviewPolicyVersionId,
    reviewPolicyVersion,
    reviewCircleId,
    eligibleActors,
    manifestHash,
    manifest,
    idempotencyKey: `${externalAppId}:${manifestHash}`,
    openedAt: new Date(),
  });
  return openGovernanceRequest(createPrismaGovernanceRequestStore(prisma), requestInput);
}
