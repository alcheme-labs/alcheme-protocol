import type { PrismaClient } from "@prisma/client";

import {
  buildExternalProgramIntegrationStatus,
  type ExternalProgramIntegrationStatus,
} from "./routeAReadModel";
import {
  buildExternalAppProvisioningStatusForApp,
  type ExternalProgramProvisioningStatus,
} from "./provisioning";

export interface ExternalProgramDeveloperAppSummary {
  appId: string;
  name: string;
  environment: string;
  status: string;
  registryStatus: string;
  discoveryStatus: string;
  nextAction: string;
  productionReviewStatus: string;
  activeKeyVersion: string | null;
  provisioning: ExternalProgramProvisioningStatus;
  errors: Array<{ code: string; severity: "blocking" | "warning" }>;
  updatedAt: string | null;
}

export async function buildExternalProgramDeveloperDashboard(
  prisma: PrismaClient,
  input: {
    ownerPubkey: string;
    buildIntegrationStatus?: (
      prisma: PrismaClient,
      externalAppId: string,
    ) => Promise<ExternalProgramIntegrationStatus | null>;
  },
): Promise<{ ownerPubkey: string; apps: ExternalProgramDeveloperAppSummary[] }> {
  const apps = await prisma.externalApp.findMany({
    where: { ownerPubkey: input.ownerPubkey },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      name: true,
      environment: true,
      status: true,
      registryStatus: true,
      discoveryStatus: true,
      updatedAt: true,
    },
  });
  const buildStatus =
    input.buildIntegrationStatus ?? buildExternalProgramIntegrationStatus;
  const summaries = await Promise.all(
    apps.map(async (app) => {
      const integration = await buildStatus(prisma, app.id);
      const provisioning = await buildExternalAppProvisioningStatusForApp(
        prisma as any,
        {
          externalAppId: app.id,
          environment: app.environment,
          publicView: false,
          ownerPubkey: input.ownerPubkey,
        },
      );
      return {
        appId: app.id,
        name: app.name,
        environment: app.environment,
        status: app.status,
        registryStatus: app.registryStatus,
        discoveryStatus: app.discoveryStatus,
        nextAction: integration?.nextAction ?? "repair_app_projection",
        productionReviewStatus:
          integration?.productionReview.status ?? "not_requested",
        activeKeyVersion:
          integration?.runtime.serverKeyLifecycle.activeKeyVersion ?? null,
        provisioning,
        errors: integration?.errors ?? [
          { code: "external_app_projection_unavailable", severity: "warning" },
        ],
        updatedAt: toIsoOrNull(app.updatedAt),
      };
    }),
  );
  return { ownerPubkey: input.ownerPubkey, apps: summaries };
}

function toIsoOrNull(raw: Date | string | null | undefined): string | null {
  if (!raw) return null;
  if (raw instanceof Date) return raw.toISOString();
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
