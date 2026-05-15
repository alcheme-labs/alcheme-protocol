import { Prisma, PrismaClient } from "@prisma/client";

import {
  assertReviewCircleShape,
  EXTERNAL_APP_REVIEW_PRIMARY_ROLE,
} from "../services/query-api/src/services/governance/systemRoleBindings";

const prisma = new PrismaClient();

async function main() {
  const circleId = readPositiveInteger("EXTERNAL_APP_REVIEW_PRIMARY_CIRCLE_ID");
  const policyId = readRequiredString("EXTERNAL_APP_REVIEW_PRIMARY_POLICY_ID");
  const policyVersionId = readRequiredString(
    "EXTERNAL_APP_REVIEW_PRIMARY_POLICY_VERSION_ID",
  );
  const environment =
    process.env.EXTERNAL_APP_REVIEW_PRIMARY_ENVIRONMENT?.trim() || "production";
  if (environment !== "sandbox" && environment !== "production") {
    throw new Error("EXTERNAL_APP_REVIEW_PRIMARY_ENVIRONMENT must be sandbox or production");
  }

  const circle = await prisma.circle.findUnique({
    where: { id: circleId },
    select: { id: true, kind: true, mode: true, circleType: true },
  });
  if (!circle) throw new Error("external_app_review_circle_not_found");
  assertReviewCircleShape(circle);

  const policy = await prisma.governancePolicy.findFirst({
    where: {
      id: policyId,
      scopeType: "external_app_review_circle",
      scopeRef: String(circleId),
      status: "active",
    },
    select: { id: true },
  });
  if (!policy) throw new Error("external_app_review_policy_not_found");

  const policyVersion = await prisma.governancePolicyVersion.findFirst({
    where: {
      id: policyVersionId,
      policyId,
      status: "active",
    },
    select: { id: true, version: true },
  });
  if (!policyVersion) {
    throw new Error("external_app_review_policy_version_not_found");
  }

  const existing = await prisma.systemGovernanceRoleBinding.findFirst({
    where: {
      domain: "external_app",
      roleKey: EXTERNAL_APP_REVIEW_PRIMARY_ROLE,
      environment,
      status: "active",
    },
  });
  if (existing) {
    if (
      existing.circleId !== circleId ||
      existing.policyId !== policyId ||
      existing.policyVersionId !== policyVersionId
    ) {
      throw new Error("external_app_review_primary_binding_already_exists");
    }
    console.log(
      JSON.stringify({
        ok: true,
        action: "unchanged",
        bindingId: existing.id,
        circleId,
        policyId,
        policyVersionId,
        environment,
      }),
    );
    return;
  }

  const binding = await prisma.systemGovernanceRoleBinding.create({
    data: {
      id: `external_app:${EXTERNAL_APP_REVIEW_PRIMARY_ROLE}:${environment}:bootstrap`,
      domain: "external_app",
      roleKey: EXTERNAL_APP_REVIEW_PRIMARY_ROLE,
      environment,
      circleId,
      policyId,
      policyVersionId,
      policyVersion: policyVersion.version,
      status: "active",
      activatedAt: new Date(),
      createdByPubkey:
        process.env.EXTERNAL_APP_REVIEW_PRIMARY_CREATED_BY_PUBKEY?.trim() || null,
      metadata: {
        source: "bootstrap-external-app-governance-role-bindings",
      } as Prisma.InputJsonValue,
    },
  });

  console.log(
    JSON.stringify({
      ok: true,
      action: "created",
      bindingId: binding.id,
      circleId,
      policyId,
      policyVersionId,
      environment,
    }),
  );
}

function readRequiredString(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readPositiveInteger(name: string): number {
  const value = Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
