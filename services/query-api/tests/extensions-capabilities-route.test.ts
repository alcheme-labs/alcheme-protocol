import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Router } from "express";

import { extensionRouter } from "../src/rest/extensions";
import { clearExtensionCatalogCache } from "../src/services/extensionCatalog";
import { loadConsistencyStatus } from "../src/services/consistency";

jest.mock("../src/services/consistency", () => ({
  loadConsistencyStatus: jest.fn(async () => ({
    indexerId: "indexer-test",
    readCommitment: "confirmed",
    indexedSlot: 12345,
    stale: false,
  })),
}));

const mockedLoadConsistencyStatus =
  loadConsistencyStatus as unknown as jest.MockedFunction<
    typeof loadConsistencyStatus
  >;

function getCapabilitiesHandler(router: Router) {
  const layer = (router as any).stack.find(
    (item: any) => item.route?.path === "/capabilities"
  );
  if (!layer?.route?.stack?.[0]?.handle) {
    throw new Error("extensions capabilities route handler not found");
  }
  return layer.route.stack[0].handle;
}

function createMockResponse() {
  return {
    statusCode: 200,
    payload: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.payload = payload;
      return this;
    },
  };
}

describe("extensions capability catalog route", () => {
  const originalManifestRoot = process.env.EXTENSION_MANIFEST_ROOT;
  const originalSolanaRpcUrl = process.env.SOLANA_RPC_URL;
  const originalRpcUrl = process.env.RPC_URL;
  const originalRuntimeRole = process.env.QUERY_API_RUNTIME_ROLE;
  const originalDeploymentProfile = process.env.QUERY_API_DEPLOYMENT_PROFILE;
  const originalPublicBaseUrl = process.env.QUERY_API_PUBLIC_BASE_URL;
  const originalSidecarBaseUrl = process.env.QUERY_API_SIDECAR_BASE_URL;

  beforeEach(() => {
    process.env.EXTENSION_MANIFEST_ROOT = path.resolve(
      __dirname,
      "fixtures/extensions"
    );
    delete process.env.SOLANA_RPC_URL;
    delete process.env.RPC_URL;
    delete process.env.QUERY_API_RUNTIME_ROLE;
    delete process.env.QUERY_API_DEPLOYMENT_PROFILE;
    delete process.env.QUERY_API_PUBLIC_BASE_URL;
    delete process.env.QUERY_API_SIDECAR_BASE_URL;
    clearExtensionCatalogCache();
    mockedLoadConsistencyStatus.mockResolvedValue({
      indexerId: "indexer-test",
      readCommitment: "confirmed",
      indexedSlot: 12345,
      stale: false,
    } as any);
  });

  afterEach(() => {
    process.env.EXTENSION_MANIFEST_ROOT = originalManifestRoot;
    process.env.SOLANA_RPC_URL = originalSolanaRpcUrl;
    process.env.RPC_URL = originalRpcUrl;
    process.env.QUERY_API_RUNTIME_ROLE = originalRuntimeRole;
    process.env.QUERY_API_DEPLOYMENT_PROFILE = originalDeploymentProfile;
    process.env.QUERY_API_PUBLIC_BASE_URL = originalPublicBaseUrl;
    process.env.QUERY_API_SIDECAR_BASE_URL = originalSidecarBaseUrl;
    clearExtensionCatalogCache();
    jest.clearAllMocks();
  });

  test("returns capability catalog with consistency metadata", async () => {
    const handler = getCapabilitiesHandler(
      extensionRouter({} as any, {} as any)
    );
    const res = createMockResponse();
    const next = jest.fn();

    await handler({} as any, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.payload).not.toHaveProperty("manifestsRoot");
    expect(res.payload).toMatchObject({
      manifestSource: "configured",
      manifestReason: null,
    });
    expect(res.payload.consistency).toMatchObject({
      indexerId: "indexer-test",
      indexedSlot: 12345,
      stale: false,
    });
    expect(res.payload.capabilities).toHaveLength(1);
    expect(res.payload.capabilities[0]).toMatchObject({
      extensionId: "contribution-engine",
      parserVersion: "v1",
      sdkPackage: "@alcheme/sdk",
      indexedSlot: 12345,
      stale: false,
      status: "active",
      runtime: {
        source: "unavailable",
        registrationStatus: "runtime_unavailable",
      },
    });
    expect(res.payload.skippedManifests).toContain(
      "broken/extension.manifest.json"
    );
  });

  test("surfaces missing manifest root explicitly without leaking server paths", async () => {
    process.env.EXTENSION_MANIFEST_ROOT = path.resolve(
      __dirname,
      "fixtures/does-not-exist"
    );
    clearExtensionCatalogCache();

    const handler = getCapabilitiesHandler(
      extensionRouter({} as any, {} as any)
    );
    const res = createMockResponse();
    const next = jest.fn();

    await handler({} as any, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.payload).not.toHaveProperty("manifestsRoot");
    expect(res.payload).toMatchObject({
      manifestSource: "missing",
      manifestReason: "manifest_root_missing",
      capabilities: [],
      skippedManifests: [],
    });
  });

  test("falls back to stale consistency snapshot when consistency service is unavailable", async () => {
    mockedLoadConsistencyStatus.mockRejectedValueOnce(
      new Error("consistency unavailable")
    );
    const handler = getCapabilitiesHandler(
      extensionRouter({} as any, {} as any)
    );
    const res = createMockResponse();
    const next = jest.fn();

    await handler({} as any, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.payload.consistency).toMatchObject({
      indexerId: "unknown",
      readCommitment: "unknown",
      indexedSlot: 0,
      stale: true,
    });
    expect(res.payload.capabilities[0]).toMatchObject({
      extensionId: "contribution-engine",
      indexedSlot: 0,
      stale: true,
      runtime: {
        source: "unavailable",
        registrationStatus: "runtime_unavailable",
      },
    });
  });

  test("advertises deployment runtime capabilities with explicit public-node-only sidecar boundaries", async () => {
    process.env.QUERY_API_RUNTIME_ROLE = "PUBLIC_NODE";
    process.env.QUERY_API_DEPLOYMENT_PROFILE = "public_node_only";
    process.env.QUERY_API_PUBLIC_BASE_URL = "https://public.alcheme.test";
    clearExtensionCatalogCache();

    const handler = getCapabilitiesHandler(extensionRouter({} as any, {} as any));
    const res = createMockResponse();
    const next = jest.fn();

    await handler(
      {
        protocol: "https",
        get(header: string) {
          if (header.toLowerCase() === "host") {
            return "public.alcheme.test";
          }
          return undefined;
        },
      } as any,
      res as any,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.payload.node).toMatchObject({
      runtimeRole: "PUBLIC_NODE",
      deploymentProfile: "public_node_only",
      publicBaseUrl: "https://public.alcheme.test",
      trustMode: "public_protocol",
      sidecar: {
        configured: false,
        discoverable: false,
        baseUrl: null,
        proxyMode: "none",
        authMode: "session_cookie",
      },
      routing: {
        preferredSource: "node_capabilities",
        publicNodeSafeApis: expect.arrayContaining([
          "graphql",
          "extensions_capabilities",
          "membership",
        ]),
        sidecarOwnedApis: expect.arrayContaining([
          "auth_session",
          "source_materials",
          "seeded",
          "discussion_runtime",
          "collab",
          "ghost_draft_private",
        ]),
        hostedOnlyExceptions: expect.any(Array),
      },
    });
  });
});
