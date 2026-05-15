#!/usr/bin/env node
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const queryApiRequire = createRequire(join(rootDir, "services/query-api/package.json"));
const apiBaseUrl = process.env.ALCHEME_API_BASE_URL ?? "http://127.0.0.1:4000/api/v1";
const appId = process.env.ALCHEME_EXTERNAL_APP_ID ?? "smoke-web3-game";

async function main() {
  const db = await inspectGovernanceTables();
  const projection = await fetchOptionalJson(
    `${apiBaseUrl}/external-apps/${encodeURIComponent(appId)}/stability-projection`,
  );
  if (projection.ok && projection.body?.stabilityProjection?.governanceState) {
    assertGovernanceProjectionShape(projection.body.stabilityProjection.governanceState);
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        appId,
        db,
        stabilityProjection: projection.ok
          ? {
              found: true,
              governanceState: projection.body.stabilityProjection?.governanceState ?? null,
              registryStatus: projection.body.registryStatus ?? null,
            }
          : { found: false, reason: projection.reason },
      },
      null,
      2,
    ),
  );
}

async function inspectGovernanceTables() {
  let PrismaClient;
  try {
    ({ PrismaClient } = queryApiRequire("@prisma/client"));
  } catch {
    return { skipped: true, reason: "prisma_client_unavailable" };
  }
  const prisma = new PrismaClient();
  try {
    const [
      conflictDisclosureCount,
      reviewerReputationCount,
      captureReviewCount,
      projectionDisputeCount,
      arbitrationReferenceCount,
      emergencyActionCount,
      correctionReceiptCount,
      latestProjection,
    ] = await Promise.all([
      prisma.externalAppGovernanceConflictDisclosure.count(),
      prisma.externalAppReviewerReputation.count(),
      prisma.externalAppCaptureReview.count(),
      prisma.externalAppProjectionDispute.count(),
      prisma.externalAppArbitrationReference.count(),
      prisma.externalAppEmergencyAction.count(),
      prisma.externalAppCorrectionReceipt.count(),
      prisma.externalAppStabilityProjection.findFirst({
        where: { externalAppId: appId },
        orderBy: { updatedAt: "desc" },
        select: { governanceState: true, statusProvenance: true },
      }),
    ]);
    const totalGovernanceRows =
      conflictDisclosureCount +
      reviewerReputationCount +
      captureReviewCount +
      projectionDisputeCount +
      arbitrationReferenceCount +
      emergencyActionCount +
      correctionReceiptCount;
    return {
      conflictDisclosureCount,
      reviewerReputationCount,
      captureReviewCount,
      projectionDisputeCount,
      arbitrationReferenceCount,
      emergencyActionCount,
      correctionReceiptCount,
      latestProjection,
      schemaReachable: {
        conflictAwareGovernance: true,
        captureReview: true,
        projectionDispute: true,
        arbitrationReference: true,
        emergencyCorrectionReceipts: true,
      },
      hasAnyGovernanceData: totalGovernanceRows > 0 || Boolean(latestProjection?.governanceState),
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function fetchOptionalJson(url) {
  const response = await fetch(url);
  if (response.status === 404) return { ok: false, reason: "external_app_not_found" };
  if (!response.ok) throw new Error(`external_app_v3d_fetch_failed:${response.status}:${url}`);
  return { ok: true, body: await response.json() };
}

function assertGovernanceProjectionShape(governanceState) {
  for (const field of [
    "captureReviewStatus",
    "projectionDisputeStatus",
    "emergencyHoldStatus",
    "highImpactActionsPaused",
    "labels",
  ]) {
    if (!(field in governanceState)) {
      throw new Error(`external_app_v3d_governance_state_missing_${field}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
