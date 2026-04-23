import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import {
  loadNodeRuntimeConfig,
  type NodeApiSurface,
} from "../config/services";
import { userRouter } from "./users";
import { postRouter } from "./posts";
import { circleRouter } from "./circles";
import { searchRouter } from "./search";
import { verificationRouter } from "./verification";
import { crystalRouter } from "./crystals";
import { notificationRouter } from "./notifications";
import { aiRouter } from "./ai";
import { discussionRouter } from "./discussion";
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
import { draftReferencesRouter } from "./draftReferences";
import { revisionDirectionRouter } from "./revisionDirection";
import { temporaryEditGrantRouter } from "./temporaryEditGrant";
import { forkRouter } from "./fork";
import { seededRouter } from "./seeded";
import { sourceMaterialsRouter } from "./sourceMaterials";
import { agentsRouter } from "./agents";
import { discussionAdminRouter } from "./discussionAdmin";

export function restRouter(prisma: PrismaClient, redis: Redis): Router {
  const router = Router();
  const sidecarRouteMatchers: Array<{
    route: Extract<NodeApiSurface, "auth_session" | "source_materials" | "seeded" | "discussion_runtime" | "ghost_draft_private">;
    pattern: RegExp;
  }> = [
    { route: "auth_session", pattern: /^\/auth\/session(?:\/|$)/ },
    { route: "ghost_draft_private", pattern: /^\/ai\/ghost-drafts(?:\/|$)/ },
    { route: "discussion_runtime", pattern: /^\/discussion\/drafts(?:\/|$)/ },
    { route: "discussion_runtime", pattern: /^\/discussion\/admin(?:\/|$)/ },
    { route: "discussion_runtime", pattern: /^\/discussion\/sessions(?:\/|$)/ },
    { route: "discussion_runtime", pattern: /^\/revision-directions(?:\/|$)/ },
    { route: "discussion_runtime", pattern: /^\/temporary-edit-grants(?:\/|$)/ },
    { route: "discussion_runtime", pattern: /^\/storage(?:\/|$)/ },
    { route: "source_materials", pattern: /^\/circles\/[^/]+\/source-materials(?:\/|$)/ },
    { route: "seeded", pattern: /^\/circles\/[^/]+\/seeded(?:\/|$)/ },
  ];

  router.use((req, res, next) => {
    const runtime = loadNodeRuntimeConfig();
    if (runtime.runtimeRole === "PRIVATE_SIDECAR") {
      return next();
    }

    const matched = sidecarRouteMatchers.find((entry) => entry.pattern.test(req.path));
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
  router.use("/circles", circleRouter(prisma, redis));
  router.use("/crystals", crystalRouter(prisma, redis));
  router.use("/notifications", notificationRouter(prisma, redis));
  router.use("/search", searchRouter(prisma, redis));
  router.use("/verify", verificationRouter(prisma, redis));
  router.use("/ai", aiRouter(prisma, redis));
  router.use("/ai-jobs", aiJobsRouter(prisma, redis));
  router.use("/discussion", discussionRouter(prisma, redis));
  router.use("/discussion/admin", discussionAdminRouter(prisma, redis));
  router.use("/storage", storageRouter(prisma, redis));
  router.use("/extensions", extensionRouter(prisma, redis));
  router.use("/policy", policyRouter(prisma, redis));
  router.use("/governance", governanceRouter(prisma, redis));
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
