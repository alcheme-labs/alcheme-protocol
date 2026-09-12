import { Router } from "express";
import rateLimit from "express-rate-limit";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";

import { findNearbyCircleLocations } from "../services/circleLocation/discovery";

const locationDiscoveryRateLimit = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

export function locationDiscoveryRouter(prisma: PrismaClient, _redis: Redis): Router {
  const router = Router();

  router.post("/nearby", locationDiscoveryRateLimit, async (req, res, next) => {
    try {
      const result = await findNearbyCircleLocations(prisma, req.body ?? {});
      return res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "");
      if (message.startsWith("invalid_location_discovery")) {
        return res.status(400).json({ error: message });
      }
      return next(error);
    }
  });

  return router;
}
