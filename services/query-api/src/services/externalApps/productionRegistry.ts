import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import {
  createPrismaGovernanceRequestStore,
  openGovernanceRequest,
  type GovernanceEligibleActor,
} from "../governance/policyEngine";
import {
  assertActiveExternalAppReviewBinding,
  EXTERNAL_APP_REVIEW_PRIMARY_ROLE,
  normalizeExternalAppGovernanceRoleKey,
  type ExternalAppGovernanceRoleKey,
  type SystemGovernanceRoleBindingPrisma,
} from "../governance/systemRoleBindings";
import {
  computeManifestHash,
  normalizeExternalAppManifest,
  type ExternalAppManifest,
} from "./manifest";
import { validateProductionManifestPlatformIdentity } from "./manifestPlatformValidation";
import {
  extractSolanaOwnerPubkey,
  verifyExternalAppOwnerAssertion,
} from "./ownerAssertion";
import {
  assertRiskDisclaimerAcceptanceMatches,
  buildRiskDisclaimerAcceptance,
} from "./riskDisclaimer";
import {
  createRiskDisclaimerReceiptVerifierFromEnv,
  type RiskDisclaimerReceiptVerifier,
} from "./riskDisclaimerChainVerifier";
import { normalizeExternalAppId } from "./validation";

interface DeveloperAgreementEvidence {
  scope: "developer_registration";
  disclaimerVersion: string;
  termsDigest: string;
  acceptanceDigest: string;
  signatureDigest: string | null;
  chainReceiptPda: string;
  chainReceiptDigest: string;
  txSignature: string;
}

export function buildProductionExternalAppRegistrationRequest(input: {
  externalAppId: string;
  proposerPubkey: string;
  reviewPolicyId: string;
  reviewPolicyVersionId: string;
  reviewPolicyVersion: number;
  reviewCircleId: number;
  reviewRoleKey?: ExternalAppGovernanceRoleKey;
  eligibleActors: GovernanceEligibleActor[];
  manifestHash: string;
  manifest: ExternalAppManifest;
  ownerAssertion: { payload: string; signature: string };
  developerAgreement: DeveloperAgreementEvidence;
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
      payload: {
        manifestHash: input.manifestHash,
        manifest: input.manifest,
        ownerAssertion: input.ownerAssertion,
        developerAgreement: input.developerAgreement,
        reviewCircleId: input.reviewCircleId,
        reviewPolicyId: input.reviewPolicyId,
        reviewPolicyVersionId: input.reviewPolicyVersionId,
        reviewPolicyVersion: input.reviewPolicyVersion,
        reviewRoleKey: input.reviewRoleKey ?? EXTERNAL_APP_REVIEW_PRIMARY_ROLE,
      },
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
  deps: { riskReceiptVerifier?: RiskDisclaimerReceiptVerifier } = {},
) {
  const externalAppId = normalizeExternalAppId(rawAppId);
  const reviewRoleKey = normalizeExternalAppGovernanceRoleKey(
    body.reviewRoleKey ?? EXTERNAL_APP_REVIEW_PRIMARY_ROLE,
  );

  const manifest = normalizeExternalAppManifest(body.manifest);
  if (manifest.appId !== externalAppId) {
    throw new Error("external_app_manifest_app_id_mismatch");
  }
  validateProductionManifestPlatformIdentity(manifest);
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

  const resolvedReviewBinding = await assertActiveExternalAppReviewBinding(
    prisma as unknown as SystemGovernanceRoleBindingPrisma,
    {
      roleKey: reviewRoleKey,
      environment: "production",
      circleId: optionalPositiveInteger(body.reviewCircleId),
      policyId: optionalNonEmptyString(body.reviewPolicyId),
      policyVersionId: optionalNonEmptyString(body.reviewPolicyVersionId),
      policyVersion: optionalPositiveInteger(body.reviewPolicyVersion),
    },
  );
  const reviewCircleId = resolvedReviewBinding.binding.circleId;
  const reviewPolicyId = resolvedReviewBinding.binding.policyId;
  const reviewPolicyVersionId = resolvedReviewBinding.binding.policyVersionId;
  const reviewPolicyVersion = resolvedReviewBinding.binding.policyVersion;
  const developerAgreement = normalizeDeveloperAgreementEvidence(
    body.developerAgreement,
    {
      externalAppId,
      proposerPubkey,
      policyEpochId: reviewPolicyVersionId,
      manifestHash,
    },
  );
  const riskReceiptVerifier =
    deps.riskReceiptVerifier ?? createRiskDisclaimerReceiptVerifierFromEnv();
  await riskReceiptVerifier.verifyRiskDisclaimerReceipt({
    externalAppId,
    actorPubkey: proposerPubkey,
    scope: "developer_registration",
    termsDigest: developerAgreement.termsDigest,
    acceptanceDigest: developerAgreement.acceptanceDigest,
    chainReceiptPda: developerAgreement.chainReceiptPda,
    chainReceiptDigest: developerAgreement.chainReceiptDigest,
    txSignature: developerAgreement.txSignature,
  });

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

  await (prisma as any).externalAppRiskDisclaimerAcceptance.create({
    data: buildRiskDisclaimerAcceptance({
      externalAppId,
      actorPubkey: proposerPubkey,
      scope: "developer_registration",
      policyEpochId: reviewPolicyVersionId,
      disclaimerVersion: developerAgreement.disclaimerVersion,
      termsDigest: developerAgreement.termsDigest,
      acceptanceDigest: developerAgreement.acceptanceDigest,
      source: "wallet_signature",
      signatureDigest: developerAgreement.signatureDigest,
      chainReceiptPda: developerAgreement.chainReceiptPda,
      chainReceiptDigest: developerAgreement.chainReceiptDigest,
      txSignature: developerAgreement.txSignature,
      metadata: {
        manifestHash,
        ownerWallet: manifest.ownerWallet,
        audience: "alcheme:external-app-developer-agreement",
      },
    }),
  });

  const requestInput = buildProductionExternalAppRegistrationRequest({
    externalAppId,
    proposerPubkey,
    reviewPolicyId,
    reviewPolicyVersionId,
    reviewPolicyVersion,
    reviewCircleId,
    reviewRoleKey,
    eligibleActors,
    manifestHash,
    manifest,
    ownerAssertion: {
      payload: String(ownerAssertion.payload),
      signature: String(ownerAssertion.signature),
    },
    developerAgreement,
    idempotencyKey: `${externalAppId}:${manifestHash}`,
    openedAt: new Date(),
  });
  return openGovernanceRequest(createPrismaGovernanceRequestStore(prisma), requestInput);
}

function normalizeDeveloperAgreementEvidence(
  value: unknown,
  expected: {
    externalAppId: string;
    proposerPubkey: string;
    policyEpochId: string;
    manifestHash: string;
  },
): DeveloperAgreementEvidence {
  if (!value || typeof value !== "object") {
    throw new Error("external_app_developer_agreement_required");
  }
  const record = value as Record<string, unknown>;
  const evidence: DeveloperAgreementEvidence = {
    scope: "developer_registration",
    disclaimerVersion: requiredString(
      record.disclaimerVersion,
      "external_app_developer_agreement_version_required",
    ),
    termsDigest: requiredString(
      record.termsDigest,
      "external_app_developer_agreement_terms_digest_required",
    ),
    acceptanceDigest: requiredString(
      record.acceptanceDigest,
      "external_app_developer_agreement_acceptance_digest_required",
    ),
    signatureDigest: optionalString(record.signatureDigest),
    chainReceiptPda: requiredString(
      record.chainReceiptPda,
      "external_app_developer_agreement_chain_receipt_required",
    ),
    chainReceiptDigest: requiredString(
      record.chainReceiptDigest,
      "external_app_developer_agreement_chain_receipt_digest_required",
    ),
    txSignature: requiredString(
      record.txSignature,
      "external_app_developer_agreement_tx_required",
    ),
  };
  assertRiskDisclaimerAcceptanceMatches({
    externalAppId: expected.externalAppId,
    actorPubkey: expected.proposerPubkey,
    scope: "developer_registration",
    policyEpochId: expected.policyEpochId,
    disclaimerVersion: evidence.disclaimerVersion,
    termsDigest: evidence.termsDigest,
    acceptanceDigest: evidence.acceptanceDigest,
    bindingDigest: expected.manifestHash,
    chainReceiptPda: evidence.chainReceiptPda,
    chainReceiptDigest: evidence.chainReceiptDigest,
    txSignature: evidence.txSignature,
    requireChainReceipt: true,
  });
  return evidence;
}

function requiredString(value: unknown, errorCode: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}

function optionalString(value: unknown): string | null {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function optionalNonEmptyString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new Error("invalid_external_app_review_binding_assertion");
  }
  return numeric;
}
