import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";

import { registerExternalApp } from "../services/externalApps/registry";
import { openExternalAppProductionRegistrationRequest } from "../services/externalApps/productionRegistry";

export function externalAppRouter(prisma: PrismaClient, _redis: Redis): Router {
  const router = Router();

  router.get("/discovery", async (_req, res, next) => {
    try {
      const apps = await prisma.externalApp.findMany({
        where: {
          status: "active",
          registryStatus: "active",
          discoveryStatus: { in: ["listed", "limited"] },
        },
        select: {
          id: true,
          name: true,
          registryStatus: true,
          discoveryStatus: true,
          managedNodePolicy: true,
          capabilityPolicies: true,
          manifestHash: true,
          trustScore: true,
          riskScore: true,
          communityBackingLevel: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 50,
      });
      res.json({ apps: apps.map(mapDiscoveryApp) });
    } catch (error) {
      next(error);
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
        ),
      });
    } catch (error) {
      return sendExternalAppError(res, error, next);
    }
  });

  return router;
}

function mapDiscoveryApp(app: {
  id: string;
  name: string;
  registryStatus: string;
  discoveryStatus: string;
  managedNodePolicy: string;
  capabilityPolicies: unknown;
  manifestHash: string | null;
  trustScore: string | null;
  riskScore: string | null;
  communityBackingLevel: string | null;
  updatedAt: Date;
}) {
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
  };
}

function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sendExternalAppError(res: any, error: unknown, next: (error: unknown) => void) {
  if (error instanceof Error && /^[a-z0-9_]+$/.test(error.message)) {
    return res.status(400).json({ error: error.message, message: error.message });
  }
  return next(error);
}
