import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";

import { registerExternalApp } from "../services/externalApps/registry";
import {
  openExternalAppProductionRegistrationRequest,
  openExternalAppServerKeyRevocationRequest,
  openExternalAppServerKeyRotationRequest,
} from "../services/externalApps/productionRegistry";
import {
  openSandboxExternalAppAppealRequest,
  openSandboxExternalAppDiscoveryDowngradeRequest,
} from "../services/externalApps/governanceAppeals";
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
import {
  activateExternalAppPrimaryCircleBinding,
  createExternalAppCircleBinding,
  listExternalAppCircleBindings,
  normalizeExternalAppCircleBindingKind,
} from "../services/externalApps/circleBindings";
import {
  isSandboxExternalAppCircleBinding,
} from "../services/externalApps/circleBindingExecution";
import {
  assertSandboxDirectCircleBindingWriteAllowed,
} from "../services/externalApps/sandboxCircleBindingAuthority";
import {
  ExternalProgramRuntimeAuthorizationError,
  lockAssertClockExternalProgramRuntimeApp,
} from "../services/externalApps/runtimeAuthorizationGate";
import {
  listPendingPrimaryCircleBindApplications,
  openPrimaryCircleBindGovernanceCase,
  requestPrimaryCircleBindApplication,
} from "../services/externalApps/primaryCircleBindCaseOpen";
import {
  EXTERNAL_APP_ATTACHED_CIRCLE_BIND_ACTION,
  EXTERNAL_APP_ATTACHED_CIRCLE_REVOKE_ACTION,
  EXTERNAL_APP_PRIMARY_CIRCLE_CHANGE_ACTION,
  listPendingExternalAppCircleBindingOwnerApplications,
  openExternalAppCircleBindingOwnerApplicationCase,
  requestExternalAppCircleBindingOwnerApplication,
  type ExternalAppCircleBindingOwnerAction,
} from "../services/externalApps/circleBindingOwnerApplication";
import { GovernanceCaseIntakeError } from "../services/governance/governanceCase";
import { requireAuthenticatedActor } from "../services/auth/actor";
import {
  requireCircleManagerForActor,
  requireSourceMaterialAccessForActor,
  sendAuthActorError,
} from "../services/auth/actorPermissions";
import { requirePrivateSidecarSurface } from "../config/services";
import {
  submitCommunicationMessageAsSourceMaterial,
  submitExternalSummaryAsSourceMaterial,
  submitVoiceRecapAsSourceMaterial,
  verifyExternalProgramSourceSubmissionClaim,
} from "../services/sourceMaterials/runtimeIntake";
import {
  normalizeSourceMaterialLifecycleStatus,
  normalizeSourceMaterialOriginType,
  normalizeSourceMaterialPrivacyClass,
} from "../services/sourceMaterials/lifecycle";
import { buildExternalProgramKnowledgeContextPackage } from "../services/externalApps/knowledgeContext";
import { buildExternalProgramRuntimeCapabilities } from "../services/externalApps/runtimeCapabilities";
import {
  buildExternalProgramErrorContract,
  getExternalProgramErrorHttpStatus,
} from "../services/externalApps/errorContract";
import { getExternalProgramReviewPolicyCurrent } from "../services/externalApps/reviewPolicyCurrent";
import {
  buildExternalProgramIntegrationStatus,
  buildExternalProgramPublicStatusSummary,
  summarizeCapabilityPolicies,
  toPublicStabilityProjection,
  toPublicStoreProjection,
} from "../services/externalApps/routeAReadModel";
import { buildExternalProgramDeveloperDashboard } from "../services/externalApps/developerPortal";
import {
  getExternalAppSourceMaterialStatusById,
  getExternalAppSourceMaterialStatusByOrigin,
} from "../services/externalApps/sourceMaterialLifecycleProjection";
import {
  verifyExternalProgramSourceMaterialStatusClaim,
  type SourceMaterialStatusClaimEnvelope,
} from "../services/externalApps/sourceMaterialStatusClaim";
import { registerSandboxExternalAppSelfService } from "../services/externalApps/selfServiceRegistration";
import { createExternalProgramNonceReplayStore } from "../services/externalApps/runtimeAuthorizationGate";
import {
  attestRegisteredExternalAppServerKey,
  normalizeExternalAppServerKeyProof,
} from "../services/externalApps/serverKeyProof";

export function externalAppRouter(
  prisma: PrismaClient,
  redis: Redis,
  deps: { riskReceiptVerifier?: RiskDisclaimerReceiptVerifier } = {},
): Router {
  const router = Router();
  const riskReceiptVerifier =
    deps.riskReceiptVerifier ?? createRiskDisclaimerReceiptVerifierFromEnv();
  const nonceReplayStore = createExternalProgramNonceReplayStore(redis);

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
      const rowsByAppId = new Map(
        discoveryRows.map((row) => [row.app.id, row]),
      );
      const filteredStoreItems = filterAndSortExternalAppStoreItems(
        discoveryRows.map((row) => row.storeProjection),
        query,
      );
      res.json({
        apps: filteredStoreItems
          .map((storeProjection) =>
            rowsByAppId.get(storeProjection.externalAppId),
          )
          .filter((row): row is (typeof discoveryRows)[number] => Boolean(row))
          .map((row) =>
            mapDiscoveryApp(
              row.app,
              row.stabilityProjection,
              row.storeProjection,
            ),
          ),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/risk-disclaimers/:scope", async (req, res, next) => {
    try {
      return res.json(
        buildRiskDisclaimerTerms(
          normalizeRiskDisclaimerScope(req.params.scope),
        ),
      );
    } catch (error) {
      return sendExternalAppError(res, error, next);
    }
  });

  router.get("/circle-bindings/by-circle/:circleId", async (req, res, next) => {
    try {
      const circleId = requiredPositiveInteger(
        req.params.circleId,
        "invalid_circle_id",
      );
      const actor = await requireAuthenticatedActor(req, prisma as any, {
        requireSessionCookie: true,
      });
      await requireSourceMaterialAccessForActor(prisma as any, {
        actor,
        circleId,
      });
      const bindings = await (prisma as any).externalAppCircleBinding.findMany({
        where: {
          circleId,
          status: { in: ["active", "pending"] },
        },
        include: {
          externalApp: {
            select: { id: true, name: true, status: true },
          },
        },
        orderBy: [
          { status: "asc" },
          { bindingKind: "desc" },
          { createdAt: "desc" },
        ],
      });
      return res.json({
        ok: true,
        circleId,
        bindings: (bindings ?? []).map(mapCircleExternalAppBinding),
      });
    } catch (error) {
      return sendExternalAppError(res, error, next);
    }
  });

  router.get("/runtime-capabilities", (_req, res) => {
    return res.json(buildExternalProgramRuntimeCapabilities());
  });

  router.get("/review-policy/current", async (_req, res, next) => {
    try {
      return res.json(await getExternalProgramReviewPolicyCurrent(prisma));
    } catch (error) {
      return sendExternalAppError(res, error, next);
    }
  });

  router.get("/error-contract", (_req, res) => {
    return res.json(buildExternalProgramErrorContract());
  });

  router.get("/developer/mine", async (req, res, next) => {
    try {
      const actor = await requireAuthenticatedActor(req, prisma, {
        requireSessionCookie: true,
      });
      return res.json(
        await buildExternalProgramDeveloperDashboard(prisma, {
          ownerPubkey: actor.pubkey,
        }),
      );
    } catch (error) {
      return sendExternalAppError(res, error, next);
    }
  });

  // Must be registered before "/:appId" so "primary-circle-bind" is not captured as an app id.
  router.get(
    "/primary-circle-bind/applications",
    async (req, res, next) => {
      try {
        const actor = await requireAuthenticatedActor(req, prisma, {
          allowLegacyBearer: true,
        });
        const circleId = requiredPositiveInteger(
          req.query?.circleId,
          "external_app_circle_binding_circle_id_required",
        );
        await requireCircleManagerForActor(prisma, {
          actor,
          circleId,
          allowModerator: true,
        });
        const applications = await listPendingPrimaryCircleBindApplications(
          prisma,
          { circleId },
        );
        return res.json({ ok: true, applications });
      } catch (error) {
        if (sendAuthActorError(res, error)) return;
        if (error instanceof GovernanceCaseIntakeError) {
          return res.status(error.statusCode).json({ error: error.code });
        }
        return sendExternalAppError(res, error, next);
      }
    },
  );

  router.get(
    "/circle-binding-owner-applications",
    async (req, res, next) => {
      try {
        const actor = await requireAuthenticatedActor(req, prisma, {
          allowLegacyBearer: true,
        });
        const circleId = requiredPositiveInteger(
          req.query.circleId,
          "invalid_circle_id",
        );
        await requireCircleManagerForActor(prisma, {
          actor,
          circleId,
          allowModerator: true,
        });
        return res.json({
          ok: true,
          applications: await listPendingExternalAppCircleBindingOwnerApplications(
            prisma,
            { circleId },
          ),
        });
      } catch (error) {
        if (sendAuthActorError(res, error)) return;
        return sendExternalAppError(res, error, next);
      }
    },
  );

  router.get("/:appId/integration-status", async (req, res, next) => {
    try {
      const externalAppId = normalizeExternalAppId(req.params.appId);
      const status = await buildExternalProgramIntegrationStatus(
        prisma,
        externalAppId,
      );
      if (!status) {
        return res.status(404).json({ error: "external_app_not_found" });
      }
      return res.json(status);
    } catch (error) {
      return sendExternalAppError(res, error, next);
    }
  });

  router.post("/:appId/server-key-verification", async (req, res, next) => {
    try {
      const externalAppId = normalizeExternalAppId(req.params.appId);
      const verification = await attestRegisteredExternalAppServerKey(
        prisma,
        {
          externalAppId,
          proof: normalizeExternalAppServerKeyProof(req.body?.serverKeyProof),
        },
      );
      return res.json({ ok: true, appId: externalAppId, verification });
    } catch (error) {
      return sendExternalAppError(res, error, next);
    }
  });

  router.get("/:appId/source-materials/status", async (req, res, next) => {
    try {
      const externalAppId = normalizeExternalAppId(req.params.appId);
      const originType = req.query.originType;
      const originRef = req.query.originRef;
      await verifyExternalProgramSourceMaterialStatusClaim(prisma as any, {
        externalAppId,
        originType: String(originType || ""),
        originRef: String(originRef || ""),
        sourceMaterialStatusClaim: readSourceMaterialStatusClaim(req),
        nonceReplayStore,
      });
      const status = await getExternalAppSourceMaterialStatusByOrigin(prisma, {
        externalAppId,
        originType,
        originRef,
      });
      if (!status) {
        return res.status(404).json({ error: "source_material_not_found" });
      }
      return res.json({ ok: true, status });
    } catch (error) {
      return sendExternalAppError(res, error, next);
    }
  });

  router.get(
    "/:appId/source-materials/:sourceMaterialId/status",
    async (req, res, next) => {
      try {
        const externalAppId = normalizeExternalAppId(req.params.appId);
        const sourceMaterialId = requiredPositiveInteger(
          req.params.sourceMaterialId,
          "invalid_source_material_id",
        );
        await verifyExternalProgramSourceMaterialStatusClaim(prisma as any, {
          externalAppId,
          sourceMaterialId,
          sourceMaterialStatusClaim: readSourceMaterialStatusClaim(req),
          nonceReplayStore,
        });
        const status = await getExternalAppSourceMaterialStatusById(prisma, {
          externalAppId,
          sourceMaterialId,
        });
        if (!status) {
          return res.status(404).json({ error: "source_material_not_found" });
        }
        return res.json({ ok: true, status });
      } catch (error) {
        return sendExternalAppError(res, error, next);
      }
    },
  );

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
      const storedProjection = await loadLatestStabilityProjection(
        prisma,
        app.id,
      );
      const stabilityProjection = storedProjection
        ? { ...storedProjection, registryStatus: app.registryStatus }
        : buildExternalAppStabilityProjection({ app });
      return res.json({
        appId: app.id,
        registryStatus: app.registryStatus,
        stabilityProjection: toPublicStabilityProjection(stabilityProjection),
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/:appId", async (req, res, next) => {
    try {
      const externalAppId = normalizeExternalAppId(req.params.appId);
      const app = await prisma.externalApp.findUnique({
        where: { id: externalAppId },
        select: externalAppDetailSelect(),
      });
      if (!app) {
        return res.status(404).json({ error: "external_app_not_found" });
      }
      const bindings = await listExternalAppCircleBindings(
        prisma,
        externalAppId,
      );
      const integrationStatus = await buildExternalProgramIntegrationStatus(
        prisma,
        externalAppId,
      );
      return res.json(mapExternalAppDetail(app, bindings, integrationStatus));
    } catch (error) {
      return sendExternalAppError(res, error, next);
    }
  });

  router.post("/sandbox-registrations", async (req, res, next) => {
    try {
      return res.status(201).json({
        ok: true,
        registration: await registerSandboxExternalAppSelfService(
          prisma as any,
          req.body,
        ),
      });
    } catch (error) {
      return sendExternalAppError(res, error, next);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const expectedToken = String(process.env.EXTERNAL_APP_ADMIN_TOKEN || "");
      const receivedToken = String(
        req.header("x-external-app-admin-token") || "",
      );
      if (!expectedToken) {
        return res
          .status(401)
          .json({ error: "missing_external_app_admin_token" });
      }
      if (receivedToken !== expectedToken) {
        return res
          .status(403)
          .json({ error: "invalid_external_app_admin_token" });
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
        config: withExternalAppRegistrationAudit(
          plainObject(req.body?.config),
          {
            source: "admin_fallback",
            event: "admin_token_sandbox_registration",
            directSandboxActivation:
              String(req.body?.status || "active")
                .trim()
                .toLowerCase() === "active",
          },
        ),
      });
      return res.status(201).json({ app });
    } catch (error) {
      return sendExternalAppError(res, error, next);
    }
  });

  router.post(
    "/:appId/production-registration-requests",
    async (req, res, next) => {
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
    },
  );

  router.post(
    "/:appId/server-key-rotation-requests",
    async (req, res, next) => {
      try {
        res.status(202).json({
          request: await openExternalAppServerKeyRotationRequest(
            prisma,
            req.params.appId,
            req.body,
          ),
        });
      } catch (error) {
        return sendExternalAppError(res, error, next);
      }
    },
  );

  router.post(
    "/:appId/server-key-revocation-requests",
    async (req, res, next) => {
      try {
        res.status(202).json({
          request: await openExternalAppServerKeyRevocationRequest(
            prisma,
            req.params.appId,
            req.body,
          ),
        });
      } catch (error) {
        return sendExternalAppError(res, error, next);
      }
    },
  );

  router.post(
    "/:appId/discovery-downgrade-requests",
    async (req, res, next) => {
      try {
        const actor = await requireAuthenticatedActor(req, prisma, {
          requireSessionCookie: true,
        });
        res.status(202).json({
          request: await openSandboxExternalAppDiscoveryDowngradeRequest(
            prisma,
            {
              externalAppId: req.params.appId,
              actorPubkey: actor.pubkey,
              discoveryStatus: req.body?.discoveryStatus,
              reasonCode: req.body?.reasonCode,
              idempotencyKey: req.body?.idempotencyKey,
            },
          ),
        });
      } catch (error) {
        return sendExternalAppError(res, error, next);
      }
    },
  );

  router.post(
    "/:appId/execution-receipts/:receiptId/appeal-requests",
    async (req, res, next) => {
      try {
        const actor = await requireAuthenticatedActor(req, prisma, {
          requireSessionCookie: true,
        });
        res.status(202).json({
          request: await openSandboxExternalAppAppealRequest(prisma, {
            externalAppId: req.params.appId,
            actorPubkey: actor.pubkey,
            originalExecutionReceiptId: req.params.receiptId,
            reasonCode: req.body?.reasonCode,
            evidence: req.body?.evidence,
            requestedOutcome: req.body?.requestedOutcome,
            modifiedDiscoveryStatus: req.body?.modifiedDiscoveryStatus,
          }),
        });
      } catch (error) {
        return sendExternalAppError(res, error, next);
      }
    },
  );

  router.get("/:appId/circle-bindings", async (req, res, next) => {
    try {
      const externalAppId = normalizeExternalAppId(req.params.appId);
      const app = await prisma.externalApp.findUnique({
        where: { id: externalAppId },
        select: { id: true },
      });
      if (!app) {
        return res.status(404).json({ error: "external_app_not_found" });
      }
      return res.json({
        bindings: (
          await listExternalAppCircleBindings(prisma, externalAppId)
        ).map(mapExternalAppPublicCircleBinding),
      });
    } catch (error) {
      return sendExternalAppError(res, error, next);
    }
  });

  router.post("/:appId/primary-circle-bind/requests", async (req, res, next) => {
    try {
      const actor = await requireAuthenticatedActor(req, prisma, {
        allowLegacyBearer: true,
      });
      const externalAppId = normalizeExternalAppId(req.params.appId);
      const circleId = requiredPositiveInteger(
        req.body?.circleId,
        "external_app_circle_binding_circle_id_required",
      );
      const result = await requestPrimaryCircleBindApplication(prisma, {
        externalAppId,
        circleId,
        rationale: String(req.body?.rationale || req.body?.requestedDecision || ""),
        requestedByPubkey: actor.pubkey,
        environment: optionalString(req.body?.environment) ?? undefined,
      });
      return res.status(result.replayed ? 200 : 201).json({
        ok: true,
        replayed: result.replayed,
        binding: mapExternalAppCircleBinding(result.binding),
      });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      if (error instanceof GovernanceCaseIntakeError) {
        return res.status(error.statusCode).json({ error: error.code });
      }
      return sendExternalAppError(res, error, next);
    }
  });

  router.post("/:appId/primary-circle-bind/cases", async (req, res, next) => {
    try {
      const actor = await requireAuthenticatedActor(req, prisma, {
        allowLegacyBearer: true,
      });
      const externalAppId = normalizeExternalAppId(req.params.appId);
      const circleId = requiredPositiveInteger(
        req.body?.circleId,
        "external_app_circle_binding_circle_id_required",
      );
      const circleActor = await requireCircleManagerForActor(prisma, {
        actor,
        circleId,
        allowModerator: true,
      });
      const result = await openPrimaryCircleBindGovernanceCase(prisma, {
        externalAppId,
        circleId,
        title: String(req.body?.title || "Bind primary Circle"),
        confirmOwnerApplication: req.body?.confirmOwnerApplication === true,
        applicationRef: optionalString(req.body?.applicationRef) ?? null,
        ownerRationaleDigest: optionalString(req.body?.ownerRationaleDigest) ?? null,
        // Free-form Manager rationale is rejected inside the opener.
        rationale: optionalString(req.body?.rationale)
          ?? optionalString(req.body?.requestedDecision)
          ?? undefined,
        openedByPubkey: actor.pubkey,
        actorRole: circleActor.membership.role,
        templateId: optionalString(req.body?.templateId) ?? undefined,
      });
      return res.status(result.replayed ? 200 : 201).json({
        ok: true,
        replayed: result.replayed,
        caseId: result.governanceCase.id,
        binding: mapExternalAppCircleBinding(result.binding),
      });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      if (error instanceof GovernanceCaseIntakeError) {
        return res.status(error.statusCode).json({ error: error.code });
      }
      return sendExternalAppError(res, error, next);
    }
  });

  router.post(
    "/:appId/circle-binding-owner-applications",
    async (req, res, next) => {
      try {
        const actor = await requireAuthenticatedActor(req, prisma, {
          allowLegacyBearer: true,
        });
        const externalAppId = normalizeExternalAppId(req.params.appId);
        const actionType = normalizeCircleBindingOwnerAction(req.body?.actionType);
        if (actionType === EXTERNAL_APP_PRIMARY_CIRCLE_CHANGE_ACTION) {
          return res.status(409).json({
            error: "external_app_primary_circle_change_uses_primary_bind_application",
            path: `/api/v1/external-apps/${externalAppId}/primary-circle-bind/requests`,
          });
        }
        const result = await requestExternalAppCircleBindingOwnerApplication(
          prisma,
          {
            externalAppId,
            circleId: requiredPositiveInteger(
              req.body?.circleId,
              "external_app_circle_binding_circle_id_required",
            ),
            actionType,
            bindingId: optionalString(req.body?.bindingId),
            rationale: String(req.body?.rationale || req.body?.requestedDecision || ""),
            requestedByPubkey: actor.pubkey,
          },
        );
        return res.status(result.replayed ? 200 : 201).json({
          ok: true,
          replayed: result.replayed,
          binding: mapExternalAppCircleBinding(result.binding),
        });
      } catch (error) {
        if (sendAuthActorError(res, error)) return;
        if (error instanceof GovernanceCaseIntakeError) {
          return res.status(error.statusCode).json({ error: error.code });
        }
        return sendExternalAppError(res, error, next);
      }
    },
  );

  router.post(
    "/:appId/circle-binding-owner-applications/cases",
    async (req, res, next) => {
      try {
        const actor = await requireAuthenticatedActor(req, prisma, {
          allowLegacyBearer: true,
        });
        const externalAppId = normalizeExternalAppId(req.params.appId);
        const circleId = requiredPositiveInteger(
          req.body?.circleId,
          "external_app_circle_binding_circle_id_required",
        );
        const circleActor = await requireCircleManagerForActor(prisma, {
          actor,
          circleId,
          allowModerator: true,
        });
        const actionType = normalizeCircleBindingOwnerAction(req.body?.actionType);
        const result = await openExternalAppCircleBindingOwnerApplicationCase(
          prisma,
          {
            externalAppId,
            circleId,
            actionType,
            title: String(req.body?.title || circleBindingOwnerActionTitle(actionType)),
            confirmOwnerApplication: req.body?.confirmOwnerApplication === true,
            applicationRef: String(req.body?.applicationRef || ""),
            ownerRationaleDigest: String(req.body?.ownerRationaleDigest || ""),
            openedByPubkey: actor.pubkey,
            actorRole: circleActor.membership.role,
            templateId: optionalString(req.body?.templateId) ?? undefined,
          },
        );
        return res.status(result.replayed ? 200 : 201).json({
          ok: true,
          replayed: result.replayed,
          caseId: result.governanceCase.id,
          binding: mapExternalAppCircleBinding(result.binding),
        });
      } catch (error) {
        if (sendAuthActorError(res, error)) return;
        if (error instanceof GovernanceCaseIntakeError) {
          return res.status(error.statusCode).json({ error: error.code });
        }
        return sendExternalAppError(res, error, next);
      }
    },
  );

  router.post("/:appId/circle-bindings", async (req, res, next) => {
    try {
      const externalAppId = normalizeExternalAppId(req.params.appId);
      const app = await prisma.externalApp.findUnique({
        where: { id: externalAppId },
        select: {
          id: true,
          environment: true,
          registryStatus: true,
          discoveryStatus: true,
        },
      });
      if (!app) {
        return res.status(404).json({ error: "external_app_not_found" });
      }

      const bindingKind = normalizeExternalAppCircleBindingKind(
        req.body?.bindingKind ?? "primary",
      );
      const circleId = requiredPositiveInteger(
        req.body?.circleId,
        "external_app_circle_binding_circle_id_required",
      );
      const hasAdminToken = isExternalAppAdminRequest(req);
      // Production/reviewed binds require Owner application producers. Only sandbox+admin
      // may create bindings without governance; re-check locked App inside the txn.
      if (!(app.environment === "sandbox" && hasAdminToken)) {
        if (bindingKind === "primary") {
          return res.status(409).json({
            error: "primary_circle_bind_owner_application_required",
            path: `/api/v1/external-apps/${externalAppId}/primary-circle-bind/requests`,
          });
        }
        return res.status(409).json({
          error: "circle_binding_owner_application_unavailable",
          bindingKind,
        });
      }
      const binding = await (prisma as any).$transaction(async (tx: any) => {
        const { app: lockedApp } =
          await lockAssertClockExternalProgramRuntimeApp(tx, {
            externalAppId,
            registryMode: externalAppRegistryModeFromEnv(),
          });
        if (String(lockedApp.environment || "").toLowerCase() !== "sandbox") {
          throw new ExternalProgramRuntimeAuthorizationError(
            "external_app_circle_binding_sandbox_direct_write_unavailable",
            409,
          );
        }
        return createExternalAppCircleBinding(tx, {
          externalAppId,
          circleId,
          bindingKind,
          environment: String(lockedApp.environment),
          status: "active",
          createdByPubkey: optionalString(req.body?.createdByPubkey) ?? null,
          governanceRequestId:
            optionalString(req.body?.governanceRequestId) ?? null,
          governanceDecisionDigest:
            optionalString(req.body?.governanceDecisionDigest) ?? null,
          executionReceiptId:
            optionalString(req.body?.executionReceiptId) ?? null,
          source: "backoffice",
          metadata: buildCircleBindingMetadata(req.body?.metadata, {
            registryStatus: lockedApp.registryStatus,
            discoveryStatus: app.discoveryStatus,
            requiresGovernance: false,
            audit: {
              source: "admin_fallback",
              event: "direct_sandbox_circle_binding_activation",
            },
          }),
        });
      });

      return res.status(201).json({
        ok: true,
        requiresGovernance: false,
        binding: mapExternalAppCircleBinding(binding),
      });
    } catch (error) {
      if (error instanceof ExternalProgramRuntimeAuthorizationError) {
        return res.status(error.statusCode).json({ error: error.code });
      }
      return sendExternalAppError(res, error, next);
    }
  });

  router.post(
    "/:appId/circle-bindings/:bindingId/activate",
    async (req, res, next) => {
      try {
        if (!isExternalAppAdminRequest(req)) {
          return res
            .status(403)
            .json({ error: "external_app_admin_token_required" });
        }
        const externalAppId = normalizeExternalAppId(req.params.appId);
        const existingBinding = await (
          prisma as any
        ).externalAppCircleBinding.findUnique({
          where: { id: req.params.bindingId },
        });
        if (
          !existingBinding ||
          existingBinding.externalAppId !== externalAppId
        ) {
          return res
            .status(404)
            .json({ error: "external_app_circle_binding_not_found" });
        }
        let binding;
        if (isSandboxExternalAppCircleBinding(existingBinding)) {
          try {
            binding = await (prisma as any).$transaction(async (tx: any) => {
              const gate = await assertSandboxDirectCircleBindingWriteAllowed(tx, {
                binding: existingBinding,
              });
              const nestedTx = {
                ...tx,
                $transaction: async (operation: (client: any) => Promise<unknown>) =>
                  operation(tx),
              };
              if (
                String(gate.binding.bindingKind || "").toLowerCase() !== "primary"
              ) {
                throw new ExternalProgramRuntimeAuthorizationError(
                  "external_app_circle_binding_owner_application_unavailable",
                  409,
                );
              }
              return activateExternalAppPrimaryCircleBinding(nestedTx as any, {
                externalAppId,
                bindingId: req.params.bindingId,
                effectiveAt: gate.authorityNow,
              });
            });
          } catch (error) {
            if (
              !(
                error instanceof ExternalProgramRuntimeAuthorizationError
                && error.code
                  === "external_app_circle_binding_sandbox_direct_write_unavailable"
              )
            ) {
              throw error;
            }
            // App left sandbox — fall through to production governance.
          }
        }
        if (!binding) {
          // The Decision transaction/reconciler owns accepted effects. This
          // compatibility route must never replay an adapter from body-supplied
          // Request or digest values.
          return res.status(409).json({ error: "automatic_execution_required" });
        }
        if (!binding) {
          return res
            .status(404)
            .json({ error: "external_app_circle_binding_not_found" });
        }
        return res.json({
          ok: true,
          binding: mapExternalAppCircleBinding(binding),
        });
      } catch (error) {
        if (error instanceof ExternalProgramRuntimeAuthorizationError) {
          return res.status(error.statusCode).json({ error: error.code });
        }
        return sendExternalAppError(res, error, next);
      }
    },
  );

  router.post(
    "/:appId/circle-bindings/:bindingId/revoke",
    async (req, res, next) => {
      try {
        if (!isExternalAppAdminRequest(req)) {
          return res
            .status(403)
            .json({ error: "external_app_admin_token_required" });
        }
        const externalAppId = normalizeExternalAppId(req.params.appId);
        const binding = await (
          prisma as any
        ).externalAppCircleBinding.findUnique({
          where: { id: req.params.bindingId },
        });
        if (!binding || binding.externalAppId !== externalAppId) {
          return res
            .status(404)
            .json({ error: "external_app_circle_binding_not_found" });
        }
        let revoked;
        if (isSandboxExternalAppCircleBinding(binding)) {
          // Sandbox revoke of attached/primary is sealed with historical actions;
          // only create-active sandbox bindings remain as the admin bootstrap path.
          return res.status(409).json({
            error: "external_app_circle_binding_owner_application_unavailable",
          });
        }
        if (!revoked) {
          return res.status(409).json({ error: "automatic_execution_required" });
        }
        if (!revoked) {
          return res
            .status(404)
            .json({ error: "external_app_circle_binding_not_found" });
        }
        return res.json({
          ok: true,
          binding: mapExternalAppCircleBinding(revoked),
        });
      } catch (error) {
        return sendExternalAppError(res, error, next);
      }
    },
  );

  router.post("/:appId/source-materials", async (req, res, next) => {
    try {
      const sidecarGate = requirePrivateSidecarSurface("source_materials");
      if (!sidecarGate.ok) {
        return res.status(sidecarGate.statusCode).json({
          error: sidecarGate.error,
          route: sidecarGate.route,
        });
      }

      const externalAppId = normalizeExternalAppId(req.params.appId);
      const originType = normalizeSourceMaterialOriginType(
        req.body?.originType,
      );
      if (
        originType !== "communication_message" &&
        originType !== "voice_recap" &&
        originType !== "external_summary"
      ) {
        throw new Error("unsupported_source_material_origin_type");
      }
      const originRef = requiredString(
        req.body?.originRef,
        "source_material_origin_ref_required",
      );
      const roomKey = requiredString(
        req.body?.roomKey,
        "source_material_room_key_required",
      );
      const targetCircleId = requiredPositiveInteger(
        req.body?.targetCircleId,
        "source_material_target_circle_id_required",
      );
      const summaryText = requiredRawText(
        req.body?.summaryText,
        "source_material_summary_text_required",
      );
      const evidencePrivacyClass = normalizeSourceMaterialPrivacyClass(
        req.body?.evidencePrivacyClass ?? "circle_only",
      );
      const requestedLifecycleStatus = req.body?.requestedLifecycleStatus
        ? normalizeSourceMaterialLifecycleStatus(
            req.body.requestedLifecycleStatus,
          )
        : undefined;
      if (
        requestedLifecycleStatus &&
        !["nominated", "submitted", "review_pending"].includes(
          requestedLifecycleStatus,
        )
      ) {
        throw new Error("invalid_source_material_requested_lifecycle_status");
      }
      const intakeLifecycleStatus = requestedLifecycleStatus as
        | "nominated"
        | "submitted"
        | "review_pending"
        | undefined;
      const submittedByPubkey =
        optionalString(req.body?.submittedByPubkey) ?? null;
      const verifiedClaim = await verifyExternalProgramSourceSubmissionClaim(
        prisma,
        {
          externalAppId,
          roomKey,
          originType,
          originRef,
          targetCircleId,
          summaryText,
          evidencePrivacyClass,
          requestedLifecycleStatus,
          submittedByPubkey,
          sourceSubmissionClaim: req.body?.sourceSubmissionClaim ?? null,
          nonceReplayStore,
        },
      );

      const common = {
        externalAppId,
        roomKey,
        targetCircleId,
        submittedByUserId: null,
        submittedByPubkey,
        summaryText,
        evidencePrivacyClass,
        requestedLifecycleStatus: intakeLifecycleStatus,
        claimDigest: verifiedClaim.claimDigest,
      };
      const material =
        originType === "communication_message"
          ? await submitCommunicationMessageAsSourceMaterial(prisma as any, {
              ...common,
              envelopeId: originRef,
            })
          : originType === "voice_recap"
            ? await submitVoiceRecapAsSourceMaterial(prisma as any, {
                ...common,
                voiceSessionId: originRef,
                transcriptText:
                  optionalString(req.body?.transcriptText) ?? null,
              })
            : await submitExternalSummaryAsSourceMaterial(prisma as any, {
                ...common,
                originRef,
              });

      return res.status(201).json({
        ok: true,
        sourceMaterialId: material.id,
        lifecycleStatus: material.lifecycleStatus,
        circleId: material.circleId,
        material,
      });
    } catch (error) {
      return sendExternalAppError(res, error, next);
    }
  });

  router.post("/:appId/knowledge-context", async (req, res, next) => {
    try {
      const externalAppId = normalizeExternalAppId(req.params.appId);
      return res.json(
        await buildExternalProgramKnowledgeContextPackage(prisma as any, {
          externalAppId,
          roomKey: req.body?.roomKey,
          walletPubkey: req.body?.walletPubkey,
          primaryCircleId: optionalPositiveInteger(req.body?.primaryCircleId),
          parentCircleId: optionalPositiveInteger(req.body?.parentCircleId),
          requestedCapability: req.body?.requestedCapability,
          purpose: req.body?.purpose,
          knowledgeContextClaim: req.body?.knowledgeContextClaim ?? null,
          nonceReplayStore,
        }),
      );
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
        throw new Error(
          "external_app_developer_agreement_binding_digest_required",
        );
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

      const acceptance = await (
        prisma as any
      ).externalAppRiskDisclaimerAcceptance.create({
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
          metadata: buildRiskDisclaimerMetadata(
            req.body?.metadata,
            bindingDigest,
          ),
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
    capabilitySummary: summarizeCapabilityPolicies(app.capabilityPolicies),
    manifestHash: app.manifestHash,
    trustScore: app.trustScore,
    riskScore: app.riskScore,
    communityBackingLevel: app.communityBackingLevel,
    updatedAt: app.updatedAt.toISOString(),
    stabilityProjection: toPublicStabilityProjection(stabilityProjection),
    storeProjection: storeProjection
      ? toPublicStoreProjection(storeProjection)
      : null,
  };
}

function externalAppDetailSelect() {
  return {
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
    communityBackingLevel: true,
    reviewCircleId: true,
    updatedAt: true,
  };
}

function mapExternalAppDetail(
  app: any,
  bindings: any[],
  integrationStatus?: Awaited<
    ReturnType<typeof buildExternalProgramIntegrationStatus>
  > | null,
) {
  const mappedBindings = bindings.map(mapExternalAppPublicCircleBinding);
  const primaryCircle =
    mappedBindings.find(
      (binding) =>
        binding.bindingKind === "primary" && binding.status === "active",
    ) ?? null;
  const attachedCircles = mappedBindings.filter(
    (binding) =>
      binding.bindingKind === "attached" && binding.status === "active",
  );
  return {
    app: {
      id: app.id,
      name: app.name,
      status: app.status,
      environment: app.environment,
      registryStatus: app.registryStatus,
      discoveryStatus: app.discoveryStatus,
      managedNodePolicy: app.managedNodePolicy,
      capabilitySummary: summarizeCapabilityPolicies(app.capabilityPolicies),
      manifestHash: app.manifestHash,
      trustScore: app.trustScore,
      riskScore: app.riskScore,
      communityBackingLevel: app.communityBackingLevel,
      updatedAt: app.updatedAt?.toISOString?.() ?? app.updatedAt,
    },
    primaryCircle,
    attachedCircles,
    reviewCircle: app.reviewCircleId
      ? {
          circleId: app.reviewCircleId,
        }
      : null,
    circleBindings: mappedBindings,
    publicStatus: integrationStatus
      ? buildExternalProgramPublicStatusSummary(integrationStatus)
      : null,
  };
}

function mapExternalAppCircleBinding(binding: any) {
  return {
    id: binding.id,
    externalAppId: binding.externalAppId,
    circleId: binding.circleId,
    bindingKind: binding.bindingKind,
    status: binding.status,
    environment: binding.environment,
    bindingDigest: binding.bindingDigest,
    governanceRequestId: binding.governanceRequestId ?? null,
    governanceDecisionDigest: binding.governanceDecisionDigest ?? null,
    executionReceiptId: binding.executionReceiptId ?? null,
    effectiveAt:
      binding.effectiveAt?.toISOString?.() ?? binding.effectiveAt ?? null,
    supersededAt:
      binding.supersededAt?.toISOString?.() ?? binding.supersededAt ?? null,
    revokedAt: binding.revokedAt?.toISOString?.() ?? binding.revokedAt ?? null,
    createdByPubkey: binding.createdByPubkey ?? null,
    source: binding.source,
    metadata: plainObject(binding.metadata),
    createdAt: binding.createdAt?.toISOString?.() ?? binding.createdAt ?? null,
    updatedAt: binding.updatedAt?.toISOString?.() ?? binding.updatedAt ?? null,
  };
}

function mapExternalAppPublicCircleBinding(binding: any) {
  return {
    id: binding.id,
    externalAppId: binding.externalAppId,
    circleId: binding.circleId,
    bindingKind: binding.bindingKind,
    status: binding.status,
    environment: binding.environment,
    effectiveAt:
      binding.effectiveAt?.toISOString?.() ?? binding.effectiveAt ?? null,
    supersededAt:
      binding.supersededAt?.toISOString?.() ?? binding.supersededAt ?? null,
    revokedAt: binding.revokedAt?.toISOString?.() ?? binding.revokedAt ?? null,
    source: binding.source,
    createdAt: binding.createdAt?.toISOString?.() ?? binding.createdAt ?? null,
    updatedAt: binding.updatedAt?.toISOString?.() ?? binding.updatedAt ?? null,
  };
}

function mapCircleExternalAppBinding(binding: any) {
  return {
    id: binding.id,
    appId: binding.externalApp?.id ?? binding.externalAppId,
    appName: binding.externalApp?.name ?? null,
    appStatus: binding.externalApp?.status ?? null,
    circleId: binding.circleId,
    bindingKind: binding.bindingKind,
    status: binding.status,
    governanceRequestId: binding.governanceRequestId ?? null,
    effectiveAt:
      binding.effectiveAt?.toISOString?.() ?? binding.effectiveAt ?? null,
    createdAt: binding.createdAt?.toISOString?.() ?? binding.createdAt ?? null,
  };
}

function parseDiscoveryQuery(query: Record<string, unknown>): {
  q?: string;
  category?: string;
  sort?: ExternalAppStoreSort;
  limit?: number;
} {
  const sort = String(query.sort || "latest")
    .trim()
    .toLowerCase();
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

function requiredPositiveInteger(value: unknown, errorCode: string): number {
  const parsed = optionalPositiveInteger(value);
  if (!parsed) throw new Error(errorCode);
  return parsed;
}

function normalizeRiskDisclaimerScope(
  value: unknown,
): ExternalAppRiskDisclaimerScope {
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

function requiredRawText(value: unknown, errorCode: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(errorCode);
  return value;
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
      projections.set(
        record.externalAppId,
        mapStoredStabilityProjection(record),
      );
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
    bondDispositionState: true,
    governanceState: true,
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

function normalizeCircleBindingOwnerAction(
  value: unknown,
): ExternalAppCircleBindingOwnerAction {
  const actionType = String(value || "").trim();
  if (
    actionType === EXTERNAL_APP_PRIMARY_CIRCLE_CHANGE_ACTION
    || actionType === EXTERNAL_APP_ATTACHED_CIRCLE_BIND_ACTION
    || actionType === EXTERNAL_APP_ATTACHED_CIRCLE_REVOKE_ACTION
  ) {
    return actionType;
  }
  throw new GovernanceCaseIntakeError(
    400,
    "external_app_circle_binding_owner_application_action_invalid",
  );
}

function circleBindingOwnerActionTitle(
  actionType: ExternalAppCircleBindingOwnerAction,
): string {
  if (actionType === EXTERNAL_APP_PRIMARY_CIRCLE_CHANGE_ACTION) {
    return "Change primary Circle";
  }
  if (actionType === EXTERNAL_APP_ATTACHED_CIRCLE_REVOKE_ACTION) {
    return "Revoke attached Circle";
  }
  return "Bind attached Circle";
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

function withExternalAppRegistrationAudit(
  config: Record<string, unknown>,
  audit: {
    source: "admin_fallback";
    event: string;
    directSandboxActivation: boolean;
  },
): Record<string, unknown> {
  return {
    ...config,
    audit: {
      ...plainObject(config.audit),
      source: audit.source,
      event: audit.event,
      directSandboxActivation: audit.directSandboxActivation,
    },
  };
}

function buildCircleBindingMetadata(
  metadata: unknown,
  system: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...plainObject(metadata),
    system,
  };
}

function isExternalAppAdminRequest(req: {
  header(name: string): string | undefined;
}): boolean {
  const expectedToken = String(process.env.EXTERNAL_APP_ADMIN_TOKEN || "");
  const receivedToken = String(req.header("x-external-app-admin-token") || "");
  return Boolean(expectedToken) && receivedToken === expectedToken;
}

function readSourceMaterialStatusClaim(req: {
  header(name: string): string | undefined;
}): SourceMaterialStatusClaimEnvelope | null {
  const payload = String(
    req.header("x-external-program-status-claim-payload") || "",
  );
  const signature = String(
    req.header("x-external-program-status-claim-signature") || "",
  );
  return payload && signature ? { payload, signature } : null;
}

function sendExternalAppError(
  res: any,
  error: unknown,
  next: (error: unknown) => void,
) {
  if (sendAuthActorError(res, error)) return;
  if (error instanceof Error && "code" in error) {
    const code = String((error as { code?: unknown }).code || error.message);
    if (/^[a-z0-9_]+$/.test(code)) {
      const statusCode = Number((error as { statusCode?: unknown }).statusCode);
      const status = Number.isSafeInteger(statusCode)
        ? statusCode
        : (getExternalProgramErrorHttpStatus(code) ?? 400);
      return res.status(status).json({ error: code, message: code });
    }
  }
  if (error instanceof Error && /^[a-z0-9_]+$/.test(error.message)) {
    const status = getExternalProgramErrorHttpStatus(error.message) ?? 400;
    return res
      .status(status)
      .json({ error: error.message, message: error.message });
  }
  return next(error);
}
