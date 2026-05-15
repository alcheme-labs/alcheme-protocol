#!/usr/bin/env node
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const queryApiRequire = createRequire(join(rootDir, "services/query-api/package.json"));
const apiBaseUrl = process.env.ALCHEME_API_BASE_URL ?? "http://127.0.0.1:4000/api/v1";
const appId = process.env.ALCHEME_EXTERNAL_APP_ID ?? "smoke-web3-game";

async function main() {
  const discovery = await fetchJson(
    `${apiBaseUrl}/external-apps/discovery?q=${encodeURIComponent(appId)}&sort=latest`,
  );
  const projection = await fetchOptionalJson(
    `${apiBaseUrl}/external-apps/${encodeURIComponent(appId)}/stability-projection`,
  );
  const db = await loadProjectionRows();

  if (projection.ok && projection.body?.stabilityProjection) {
    assertV3AProjectionShape(projection.body.stabilityProjection);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        appId,
        discoveryCount: Array.isArray(discovery.apps) ? discovery.apps.length : 0,
        stabilityProjection: projection.ok
          ? {
              found: true,
              projectionStatus: projection.body.stabilityProjection?.projectionStatus ?? null,
              registryStatus: projection.body.registryStatus ?? null,
            }
          : { found: false, reason: projection.reason },
        db,
      },
      null,
      2,
    ),
  );
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`external_app_v3a_fetch_failed:${response.status}:${url}`);
  return response.json();
}

async function fetchOptionalJson(url) {
  const response = await fetch(url);
  if (response.status === 404) return { ok: false, reason: "external_app_not_found" };
  if (!response.ok) throw new Error(`external_app_v3a_fetch_failed:${response.status}:${url}`);
  return { ok: true, body: await response.json() };
}

async function loadProjectionRows() {
  let PrismaClient;
  try {
    ({ PrismaClient } = queryApiRequire("@prisma/client"));
  } catch {
    return { skipped: true, reason: "prisma_client_unavailable" };
  }
  const prisma = new PrismaClient();
  try {
    const [
      app,
      stabilityProjection,
      storeProjection,
      projectionReceiptCount,
      evidenceReceiptCount,
      actorRelationCount,
    ] = await Promise.all([
      prisma.externalApp.findUnique({ where: { id: appId }, select: { id: true } }),
      prisma.externalAppStabilityProjection.findFirst({
        where: { externalAppId: appId },
        orderBy: { updatedAt: "desc" },
        select: {
          policyEpochId: true,
          projectionStatus: true,
          publicLabels: true,
          statusProvenance: true,
        },
      }),
      prisma.externalAppStoreProjection.findFirst({
        where: { externalAppId: appId },
        orderBy: { updatedAt: "desc" },
        select: {
          listingState: true,
          categoryTags: true,
          rankingOutput: true,
          continuityLabels: true,
        },
      }),
      prisma.externalAppProjectionReceipt.count({ where: { externalAppId: appId } }),
      prisma.externalAppEvidenceReceipt.count({ where: { externalAppId: appId } }),
      prisma.externalAppActorRelation.count({ where: { externalAppId: appId } }),
    ]);
    return {
      appFound: Boolean(app),
      stabilityProjection,
      storeProjection,
      projectionReceiptCount,
      evidenceReceiptCount,
      actorRelationCount,
      sections: {
        stabilityProjection: Boolean(stabilityProjection),
        storeSearchCategorySortProjection: Boolean(storeProjection),
        appOperatedExternalRouteProjection: Boolean(
          storeProjection?.continuityLabels &&
            JSON.stringify(storeProjection.continuityLabels).includes("App-Operated"),
        ),
        evidenceAndActorRelationProjection: evidenceReceiptCount + actorRelationCount > 0,
      },
    };
  } finally {
    await prisma.$disconnect();
  }
}

function assertV3AProjectionShape(projection) {
  if (typeof projection.projectionStatus !== "string") {
    throw new Error("external_app_v3a_projection_status_missing");
  }
  if (!Array.isArray(projection.publicLabels)) {
    throw new Error("external_app_v3a_public_labels_missing");
  }
  if (!projection.statusProvenance || typeof projection.statusProvenance !== "object") {
    throw new Error("external_app_v3a_status_provenance_missing");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
