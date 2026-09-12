import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import { loadNodeRuntimeConfig } from "../config/services";
import { loadConsistencyStatus } from "../services/consistency";
import { loadExtensionCatalog } from "../services/extensionCatalog";

export function extensionRouter(prisma: PrismaClient, _redis: Redis): Router {
  const router = Router();

  // GET /api/v1/extensions/capabilities
  router.get("/capabilities", async (req, res, next) => {
    try {
      const [catalog, consistency] = await Promise.all([
        loadExtensionCatalog(),
        loadConsistencyStatus(prisma).catch(() => null),
      ]);
      const runtime = loadNodeRuntimeConfig();
      const requestOrigin = (() => {
        const host = typeof req.get === "function" ? req.get("host") : null;
        if (!host) return null;
        const protocol = typeof (req as any).protocol === "string"
          ? (req as any).protocol
          : "http";
        return `${protocol}://${host}`;
      })();

      const consistencySnapshot = consistency
        ? {
            indexerId: consistency.indexerId,
            readCommitment: consistency.readCommitment,
            indexedSlot: consistency.indexedSlot,
            stale: consistency.stale,
          }
        : {
            indexerId: "unknown",
            readCommitment: "unknown",
          indexedSlot: 0,
          stale: true,
        };

      res.json({
        generatedAt: catalog.generatedAt,
        manifestSource: catalog.manifestSource,
        manifestReason: catalog.manifestReason,
        capabilities: catalog.capabilities.map((capability) => ({
          extensionId: capability.extensionId,
          displayName: capability.displayName,
          programId: capability.programId,
          version: capability.version,
          parserVersion: capability.parserVersion,
          status: capability.status,
          reason: capability.reason,
          sdkPackage: capability.sdkPackage,
          requiredPermissions: capability.requiredPermissions,
          tags: capability.tags,
          sourceManifestPath: capability.sourceManifestPath,
          runtime: capability.runtime,
          indexedSlot: consistencySnapshot.indexedSlot,
          stale: consistencySnapshot.stale,
        })),
        consistency: consistencySnapshot,
        skippedManifests: catalog.skippedFiles,
        node: {
          runtimeRole: runtime.runtimeRole,
          deploymentProfile: runtime.deploymentProfile,
          trustMode: runtime.runtimeRole === "PRIVATE_SIDECAR"
            ? "trusted_private"
            : "public_protocol",
          publicBaseUrl: runtime.publicBaseUrl || requestOrigin,
          sidecar: {
            configured: runtime.runtimeRole === "PRIVATE_SIDECAR" || runtime.sidecarDiscoverable,
            discoverable: runtime.sidecarDiscoverable,
            baseUrl: runtime.sidecarDiscoverable
              ? runtime.sidecarBaseUrl
              : runtime.runtimeRole === "PRIVATE_SIDECAR"
                ? requestOrigin
                : null,
            proxyMode: runtime.sidecarProxyMode,
            authMode: runtime.sidecarAuthMode,
          },
          routing: {
            preferredSource: "node_capabilities",
            publicNodeSafeApis: runtime.publicNodeSafeApis,
            sidecarOwnedApis: runtime.sidecarOwnedApis,
            hostedOnlyExceptions: runtime.hostedOnlyExceptions,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
