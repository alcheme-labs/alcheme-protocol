import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import { sidecarHttpRouteMatchers } from "../config/apiSurfaceRegistry";
import { loadNodeRuntimeConfig } from "../config/services";
import { userRouter } from "./users";
import { postRouter } from "./posts";
import { circleRouter } from "./circles";
import { circleLocationRouter } from "./circleLocations";
import { circleAliasRouter } from "./circleAliases";
import { circleAuthorityRouter } from "./circleAuthority";
import { circleLifecycleRouter } from "./circleLifecycle";
import { searchRouter } from "./search";
import { verificationRouter } from "./verification";
import { crystalRouter } from "./crystals";
import { notificationRouter } from "./notifications";
import { aiRouter } from "./ai";
import { configurationCopilotRouter } from "./configurationCopilot";
import { settingsTextAssistRouter } from "./settingsTextAssist";
import { styleAdvisorRouter } from "./styleAdvisor";
import { stylePreferencesRouter } from "./stylePreferences";
import { guardianFindingsRouter } from "./guardianFindings";
import { sourceGroundedAskRouter } from "./sourceGroundedAsk";
import { circleGrowthAdvisorRouter } from "./circleGrowthAdvisor";
import { neutralEvaluationRouter } from "./neutralEvaluation";
import { discussionAnnouncementsRouter } from "./discussionAnnouncements";
import { discussionAnchoredInteractionsRouter } from "./discussionAnchoredInteractions";
import { discussionRouter } from "./discussion";
import { communicationRouter } from "./communication";
import { voiceRouter } from "./voice";
import { authRouter } from "./auth";
import { membershipRouter } from "./membership";
import { storageRouter } from "./storage";
import { extensionRouter } from "./extensions";
import { policyRouter } from "./policy";
import { draftLifecycleRouter } from "./draftLifecycle";
import { governanceRouter } from "./governance";
import { crystallizationRouter } from "./crystallization";
import { circleSummaryRouter } from "./circleSummary";
import { aiJobsRouter } from "./ai-jobs";
import { aiOperatingLayerRouter } from "./ai-operating-layer";
import { draftReferencesRouter } from "./draftReferences";
import { revisionDirectionRouter } from "./revisionDirection";
import { temporaryEditGrantRouter } from "./temporaryEditGrant";
import { forkRouter } from "./fork";
import { seededRouter } from "./seeded";
import { sourceMaterialsRouter } from "./sourceMaterials";
import { agentsRouter } from "./agents";
import { discussionAdminRouter } from "./discussionAdmin";
import { externalAppRouter } from "./externalApps";
import { externalNodeRouter } from "./externalNodes";
import { hostedAppRouter } from "./hostedApps";
import { locationDiscoveryRouter } from "./locationDiscovery";
import { platformSafetyRouter } from "./platformSafety";
import type { QueryApiRuntimeConfig } from "../config/services";

export function mountHostedAppRuntimeRoutes(
  router: Router,
  prisma: PrismaClient,
  redis: Redis,
  runtime: Pick<QueryApiRuntimeConfig, "hostedAppRuntimeEnabled">,
): void {
  if (runtime.hostedAppRuntimeEnabled) {
    router.use("/hosted-apps", hostedAppRouter(prisma, redis));
    return;
  }

  router.use("/hosted-apps", (_req, res) =>
    res.status(404).json({ error: "hosted_app_runtime_disabled" }),
  );
}

export function restRouter(prisma: PrismaClient, redis: Redis): Router {
  const router = Router();
  router.use((req, res, next) => {
    const runtime = loadNodeRuntimeConfig();
    if (runtime.runtimeRole === "PRIVATE_SIDECAR") {
      return next();
    }

    const matched = sidecarHttpRouteMatchers.find((entry) => entry.pattern.test(req.path));
    if (!matched) {
      return next();
    }

    return res.status(409).json({
      error: "private_sidecar_required",
      route: matched.route,
    });
  });

  router.use("/users", userRouter(prisma, redis));
  router.use("/auth", authRouter(prisma, redis));
  router.use("/membership", membershipRouter(prisma, redis));
  router.use("/posts", postRouter(prisma, redis));
  router.use("/circles", circleAliasRouter(prisma, redis));
  router.use("/circles", circleRouter(prisma, redis));
  router.use("/circles", circleAuthorityRouter(prisma, redis));
  router.use("/circles", circleLifecycleRouter(prisma, redis));
  router.use("/circle-locations", circleLocationRouter(prisma, redis));
  router.use("/location-discovery", locationDiscoveryRouter(prisma, redis));
  router.use("/crystals", crystalRouter(prisma, redis));
  router.use("/notifications", notificationRouter(prisma, redis));
  router.use("/search", searchRouter(prisma, redis));
  router.use("/verify", verificationRouter(prisma, redis));
  router.use("/ai", aiRouter(prisma, redis));
  router.use("/ai", configurationCopilotRouter(prisma, redis));
  router.use("/ai", settingsTextAssistRouter(prisma, redis));
  router.use("/ai", styleAdvisorRouter(prisma, redis));
  router.use("/ai", guardianFindingsRouter(prisma, redis));
  router.use("/ai", sourceGroundedAskRouter(prisma, redis));
  router.use("/ai", circleGrowthAdvisorRouter(prisma, redis));
  router.use("/ai", neutralEvaluationRouter(prisma, redis));
  router.use("/", stylePreferencesRouter(prisma, redis));
  router.use("/ai-jobs", aiJobsRouter(prisma, redis));
  router.use("/ai-operating-layer", aiOperatingLayerRouter(prisma, redis));
  router.use("/discussion", discussionAnnouncementsRouter(prisma, redis));
  router.use("/discussion", discussionAnchoredInteractionsRouter(prisma, redis));
  router.use("/discussion", discussionRouter(prisma, redis));
  router.use("/communication", communicationRouter(prisma, redis));
  router.use("/voice", voiceRouter(prisma, redis));
  router.use("/discussion/admin", discussionAdminRouter(prisma, redis));
  router.use("/storage", storageRouter(prisma, redis));
  router.use("/extensions", extensionRouter(prisma, redis));
  router.use("/external-apps", externalAppRouter(prisma, redis));
  mountHostedAppRuntimeRoutes(router, prisma, redis, loadNodeRuntimeConfig());
  router.use("/external-nodes", externalNodeRouter(prisma, redis));
  router.get("/health", async (_req, res) => {
    res.json({ status: "healthy", timestamp: new Date().toISOString() });
  });
  router.use("/policy", policyRouter(prisma, redis));
  router.use("/governance", governanceRouter(prisma, redis));
  router.use("/platform-safety", platformSafetyRouter(prisma, redis));
  router.use("/fork", forkRouter(prisma, redis));
  router.use("/crystallization", crystallizationRouter(prisma, redis));
  router.use("/draft-lifecycle", draftLifecycleRouter(prisma, redis));
  router.use("/revision-directions", revisionDirectionRouter(prisma, redis));
  router.use("/temporary-edit-grants", temporaryEditGrantRouter(prisma, redis));
  router.use("/circles", seededRouter(prisma, redis));
  router.use("/circles", sourceMaterialsRouter(prisma, redis));
  router.use("/circles", agentsRouter(prisma, redis));
  router.use("/circles", circleSummaryRouter(prisma, redis));
  router.use("/drafts", draftReferencesRouter(prisma, redis));

  return router;
}
