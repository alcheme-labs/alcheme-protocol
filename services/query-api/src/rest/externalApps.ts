import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";

import { registerExternalApp } from "../services/externalApps/registry";
import { openExternalAppProductionRegistrationRequest } from "../services/externalApps/productionRegistry";
import { shouldIncludeInDiscovery } from "../services/externalApps/discovery";
import { externalAppRegistryModeFromEnv } from "../services/externalApps/chainRegistryProjection";
import {
  buildExternalAppStabilityProjection,
  mapStoredStabilityProjection,
} from "../services/externalApps/stabilityProjection";
import type { ExternalAppStabilityProjectionView } from "../services/externalApps/stabilityTypes";
import {
  buildExternalAppStoreProjection,
  filterAndSortExternalAppStoreItems,
  type ExternalAppStoreProjectionView,
  type ExternalAppStoreSort,
} from "../services/externalApps/storeProjection";
import {
  assertRiskDisclaimerAcceptanceMatches,
  buildRiskDisclaimerAcceptance,
  buildRiskDisclaimerTerms,
  type ExternalAppRiskDisclaimerScope,
} from "../services/externalApps/riskDisclaimer";
import {
  createRiskDisclaimerReceiptVerifierFromEnv,
  type RiskDisclaimerReceiptVerifier,
} from "../services/externalApps/riskDisclaimerChainVerifier";
import { normalizeExternalAppId } from "../services/externalApps/validation";

export function externalAppRouter(
  prisma: PrismaClient,
  _redis: Redis,
  deps: { riskReceiptVerifier?: RiskDisclaimerReceiptVerifier } = {},
): Router {
  const router = Router();
  const riskReceiptVerifier =
    deps.riskReceiptVerifier ?? createRiskDisclaimerReceiptVerifierFromEnv();

  router.get("/discovery", async (req, res, next) => {
    try {
      const registryMode = externalAppRegistryModeFromEnv();
      const query = parseDiscoveryQuery(req.query);
      const apps = await prisma.externalApp.findMany({
        where: {
          status: "active",
          registryStatus: "active",
          discoveryStatus: { in: ["listed", "limited"] },
        },
        select: {
          id: true,
          name: true,
          status: true,
          environment: true,
          registryStatus: true,
          discoveryStatus: true,
          managedNodePolicy: true,
          capabilityPolicies: true,
          manifestHash: true,
          trustScore: true,
          riskScore: true,
          ownerBond: true,
          communityBackingLevel: true,
          config: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 100,
      });

      const registryAnchorsByAppId =
        registryMode === "required" &&
        apps.some((app) => app.environment === "mainnet_production")
          ? await loadRegistryAnchorsByAppId(
              prisma,
              apps
                .filter((app) => app.environment === "mainnet_production")
                .map((app) => app.id),
            )
          : new Map();
      const visibleApps = apps.filter((app) =>
        shouldIncludeInDiscovery({
          status: app.status,
          environment: app.environment,
          discoveryStatus: app.discoveryStatus,
          registryStatus: app.registryStatus,
          registryMode,
          registryAnchor: registryAnchorsByAppId.get(app.id) ?? null,
        }),
      );
      const stabilityProjectionsByAppId = await loadStabilityProjectionsByAppId(
        prisma,
        visibleApps.map((app) => app.id),
      );
      const discoveryRows = visibleApps.map((app) => {
        const stabilityProjection =
          stabilityProjectionsByAppId.get(app.id) ??
          buildExternalAppStabilityProjection({
            app,
            registryAnchor: registryAnchorsByAppId.get(app.id) ?? null,
          });
        return {
          app,
          stabilityProjection,
          storeProjection: buildExternalAppStoreProjection({
            app,
            stabilityProjection,
          }),
        };
      });
      const rowsByAppId = new Map(discoveryRows.map((row) => [row.app.id, row]));
      const filteredStoreItems = filterAndSortExternalAppStoreItems(
        discoveryRows.map((row) => row.storeProjection),
        query,
      );
      res.json({
        apps: filteredStoreItems
          .map((storeProjection) => rowsByAppId.get(storeProjection.externalAppId))
          .filter((row): row is (typeof discoveryRows)[number] => Boolean(row))
          .map((row) =>
            mapDiscoveryApp(row.app, row.stabilityProjection, row.storeProjection),
          ),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/risk-disclaimers/:scope", async (req, res, next) => {
    try {
      return res.json(buildRiskDisclaimerTerms(normalizeRiskDisclaimerScope(req.params.scope)));
    } catch (error) {
      return sendExternalAppError(res, error, next);
    }
  });

  router.get("/:appId/stability-projection", async (req, res, next) => {
    try {
      const app = await prisma.externalApp.findUnique({
        where: { id: req.params.appId },
        select: {
          id: true,
          name: true,
          status: true,
          environment: true,
          registryStatus: true,
          discoveryStatus: true,
          managedNodePolicy: true,
          capabilityPolicies: true,
          manifestHash: true,
          trustScore: true,
          riskScore: true,
          ownerBond: true,
          communityBackingLevel: true,
          updatedAt: true,
        },
      });
      if (!app) {
        return res.status(404).json({ error: "external_app_not_found" });
      }
      const storedProjection = await loadLatestStabilityProjection(prisma, app.id);
      const stabilityProjection = storedProjection
        ? { ...storedProjection, registryStatus: app.registryStatus }
        : buildExternalAppStabilityProjection({ app });
      return res.json({
        appId: app.id,
        registryStatus: app.registryStatus,
        stabilityProjection,
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const expectedToken = String(process.env.EXTERNAL_APP_ADMIN_TOKEN || "");
      const receivedToken = String(req.header("x-external-app-admin-token") || "");
      if (!expectedToken) {
        return res.status(401).json({ error: "missing_external_app_admin_token" });
      }
      if (receivedToken !== expectedToken) {
        return res.status(403).json({ error: "invalid_external_app_admin_token" });
      }
      const app = await registerExternalApp(prisma, {
        id: req.body?.id,
        name: req.body?.name,
        ownerPubkey: req.body?.ownerPubkey,
        allowedOrigins: Array.isArray(req.body?.allowedOrigins)
          ? req.body.allowedOrigins
          : [],
        serverPublicKey: req.body?.serverPublicKey ?? null,
        claimAuthMode: req.body?.claimAuthMode,
        status: req.body?.status,
        config: plainObject(req.body?.config),
      });
      return res.status(201).json({ app });
    } catch (error) {
      return sendExternalAppError(res, error, next);
    }
  });

  router.post("/:appId/production-registration-requests", async (req, res, next) => {
    try {
      res.status(202).json({
        request: await openExternalAppProductionRegistrationRequest(
          prisma,
          req.params.appId,
          req.body,
          { riskReceiptVerifier },
        ),
      });
    } catch (error) {
      return sendExternalAppError(res, error, next);
    }
  });

  router.post("/:appId/risk-disclaimer-acceptances", async (req, res, next) => {
    try {
      const externalAppId = normalizeExternalAppId(req.params.appId);
      const app = await prisma.externalApp.findUnique({
        where: { id: externalAppId },
        select: { id: true },
      });
      if (!app) {
        return res.status(404).json({ error: "external_app_not_found" });
      }
      const actorPubkey = requiredString(
        req.body?.actorPubkey,
        "external_app_risk_disclaimer_actor_pubkey_required",
      );
      const scope = normalizeRiskDisclaimerScope(req.body?.scope);
      const policyEpochId = requiredString(
        req.body?.policyEpochId,
        "external_app_risk_disclaimer_policy_epoch_id_required",
      );
      const disclaimerVersion = requiredString(
        req.body?.disclaimerVersion,
        "external_app_risk_disclaimer_disclaimer_version_required",
      );
      const termsDigest = requiredString(
        req.body?.termsDigest,
        "external_app_risk_disclaimer_terms_digest_required",
      );
      const acceptanceDigest = requiredString(
        req.body?.acceptanceDigest,
        "external_app_risk_disclaimer_acceptance_digest_required",
      );
      const bindingDigest = optionalString(req.body?.bindingDigest);
      if (scope === "developer_registration" && !bindingDigest) {
        throw new Error("external_app_developer_agreement_binding_digest_required");
      }
      const chainReceiptPda = requiredString(
        req.body?.chainReceiptPda,
        "external_app_risk_disclaimer_chain_receipt_required",
      );
      const chainReceiptDigest = requiredString(
        req.body?.chainReceiptDigest,
        "external_app_risk_disclaimer_chain_receipt_digest_required",
      );
      const txSignature = requiredString(
        req.body?.txSignature,
        "external_app_risk_disclaimer_tx_signature_required",
      );

      assertRiskDisclaimerAcceptanceMatches({
        externalAppId,
        actorPubkey,
        scope,
        policyEpochId,
        disclaimerVersion,
        termsDigest,
        acceptanceDigest,
        bindingDigest: bindingDigest ?? undefined,
        chainReceiptPda,
        chainReceiptDigest,
        txSignature,
        requireChainReceipt: true,
      });
      await riskReceiptVerifier.verifyRiskDisclaimerReceipt({
        externalAppId,
        actorPubkey,
        scope,
        termsDigest,
        acceptanceDigest,
        chainReceiptPda,
        chainReceiptDigest,
        txSignature,
      });

      const acceptance = await (prisma as any).externalAppRiskDisclaimerAcceptance.create({
        data: buildRiskDisclaimerAcceptance({
          externalAppId,
          actorPubkey,
          scope,
          policyEpochId,
          disclaimerVersion,
          termsDigest,
          acceptanceDigest,
          source: "wallet_signature",
          signatureDigest: optionalString(req.body?.signatureDigest),
          chainReceiptPda,
          chainReceiptDigest,
          txSignature,
          metadata: buildRiskDisclaimerMetadata(req.body?.metadata, bindingDigest),
        }),
      });

      return res.status(201).json({ acceptance });
    } catch (error) {
      return sendExternalAppError(res, error, next);
    }
  });

  return router;
}

function mapDiscoveryApp(
  app: {
    id: string;
    name: string;
    status?: string;
    environment?: string;
    registryStatus: string;
    discoveryStatus: string;
    managedNodePolicy: string;
    capabilityPolicies: unknown;
    manifestHash: string | null;
    trustScore: string | null;
    riskScore: string | null;
    ownerBond?: string | null;
    communityBackingLevel: string | null;
    config?: unknown;
    updatedAt: Date;
  },
  stabilityProjection: ExternalAppStabilityProjectionView,
  storeProjection?: ExternalAppStoreProjectionView,
) {
  return {
    id: app.id,
    name: app.name,
    registryStatus: app.registryStatus,
    discoveryStatus: app.discoveryStatus,
    managedNodePolicy: app.managedNodePolicy,
    capabilityPolicies: plainObject(app.capabilityPolicies),
    manifestHash: app.manifestHash,
    trustScore: app.trustScore,
    riskScore: app.riskScore,
    communityBackingLevel: app.communityBackingLevel,
    updatedAt: app.updatedAt.toISOString(),
    stabilityProjection,
    storeProjection,
  };
}

function parseDiscoveryQuery(query: Record<string, unknown>): {
  q?: string;
  category?: string;
  sort?: ExternalAppStoreSort;
  limit?: number;
} {
  const sort = String(query.sort || "latest").trim().toLowerCase();
  return {
    q: optionalString(query.q),
    category: optionalString(query.category),
    sort: sort === "featured" || sort === "trending" ? sort : "latest",
    limit: optionalPositiveInteger(query.limit),
  };
}

function optionalString(value: unknown): string | undefined {
  const normalized = String(value || "").trim();
  return normalized || undefined;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : undefined;
}

function normalizeRiskDisclaimerScope(value: unknown): ExternalAppRiskDisclaimerScope {
  const scope = String(value || "").trim();
  if (
    scope === "developer_registration" ||
    scope === "external_app_entry" ||
    scope === "challenge_bond" ||
    scope === "bond_disposition"
  ) {
    return scope;
  }
  throw new Error("external_app_risk_disclaimer_scope_invalid");
}

function requiredString(value: unknown, errorCode: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}

async function loadStabilityProjectionsByAppId(
  prisma: PrismaClient,
  externalAppIds: string[],
): Promise<Map<string, ExternalAppStabilityProjectionView>> {
  if (externalAppIds.length === 0) return new Map();
  const projectionClient = (prisma as any).externalAppStabilityProjection;
  if (!projectionClient) return new Map();
  const records = await projectionClient.findMany({
    where: { externalAppId: { in: externalAppIds } },
    orderBy: { updatedAt: "desc" },
    select: stabilityProjectionSelect(),
  });
  const projections = new Map<string, ExternalAppStabilityProjectionView>();
  for (const record of records) {
    if (!projections.has(record.externalAppId)) {
      projections.set(record.externalAppId, mapStoredStabilityProjection(record));
    }
  }
  return projections;
}

async function loadLatestStabilityProjection(
  prisma: PrismaClient,
  externalAppId: string,
): Promise<ExternalAppStabilityProjectionView | null> {
  const projectionClient = (prisma as any).externalAppStabilityProjection;
  if (!projectionClient) return null;
  const record = await projectionClient.findFirst({
    where: { externalAppId },
    orderBy: { updatedAt: "desc" },
    select: stabilityProjectionSelect(),
  });
  return record ? mapStoredStabilityProjection(record) : null;
}

function stabilityProjectionSelect() {
  return {
    externalAppId: true,
    policyEpochId: true,
    challengeState: true,
    projectionStatus: true,
    publicLabels: true,
    riskScore: true,
    trustScore: true,
    supportSignalLevel: true,
    supportIndependenceScore: true,
    rollout: true,
    formulaInputs: true,
    formulaOutputs: true,
    bondDispositionState: true,
    governanceState: true,
    statusProvenance: true,
    updatedAt: true,
  };
}

async function loadRegistryAnchorsByAppId(
  prisma: PrismaClient,
  externalAppIds: string[],
): Promise<
  Map<
    string,
    {
      registryStatus: string;
      finalityStatus: string;
      receiptFinalityStatus: string;
    }
  >
> {
  if (externalAppIds.length === 0) return new Map();
  const registryAnchorClient = (prisma as any).externalAppRegistryAnchor;
  if (!registryAnchorClient) return new Map();
  const anchors: Array<{
    externalAppId: string;
    registryStatus: string;
    finalityStatus: string;
    receiptFinalityStatus: string;
  }> = await registryAnchorClient.findMany({
    where: { externalAppId: { in: externalAppIds } },
    select: {
      externalAppId: true,
      registryStatus: true,
      finalityStatus: true,
      receiptFinalityStatus: true,
    },
  });
  return new Map(
    anchors.map((anchor) => [
      anchor.externalAppId,
      {
        registryStatus: anchor.registryStatus,
        finalityStatus: anchor.finalityStatus,
        receiptFinalityStatus: anchor.receiptFinalityStatus,
      },
    ]),
  );
}

function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function buildRiskDisclaimerMetadata(
  metadata: unknown,
  bindingDigest?: string,
): Record<string, unknown> {
  const normalized = plainObject(metadata);
  return bindingDigest ? { ...normalized, bindingDigest } : normalized;
}

function sendExternalAppError(res: any, error: unknown, next: (error: unknown) => void) {
  if (error instanceof Error && /^[a-z0-9_]+$/.test(error.message)) {
    return res.status(400).json({ error: error.message, message: error.message });
  }
  return next(error);
}
