import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";

import { buildExternalNodeProjection } from "../services/externalNodes/nodeProjection";

export function externalNodeRouter(prisma: PrismaClient, _redis: Redis): Router {
  const router = Router();

  router.get("/routes", async (_req, res, next) => {
    try {
      const nodes = await prisma.externalNode.findMany({
        where: { nodePolicyStatus: { in: ["normal", "restricted"] } },
        select: {
          id: true,
          operatorPubkey: true,
          nodeType: true,
          serviceUrl: true,
          capabilitiesDigest: true,
          protocolVersion: true,
          syncStatus: true,
          nodePolicyStatus: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 50,
      });
      const routes = nodes.map(buildExternalNodeProjection).filter(Boolean);
      return res.json({ routes });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
