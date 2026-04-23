import path from "path";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

import {
  clearExtensionCatalogCache,
  loadExtensionCatalog,
  type ExtensionRuntimeSnapshot,
} from "../src/services/extensionCatalog";

describe("extension catalog runtime truth", () => {
  const originalManifestRoot = process.env.EXTENSION_MANIFEST_ROOT;

  beforeEach(() => {
    process.env.EXTENSION_MANIFEST_ROOT = path.resolve(
      __dirname,
      "fixtures/extensions"
    );
    clearExtensionCatalogCache();
  });

  afterEach(() => {
    process.env.EXTENSION_MANIFEST_ROOT = originalManifestRoot;
    clearExtensionCatalogCache();
  });

  test("marks manifest-only extensions as not registered when chain registry has no entry", async () => {
    const catalog = await loadExtensionCatalog({
      runtimeLoader: async (): Promise<ExtensionRuntimeSnapshot> => ({
        source: "chain",
        reason: null,
        entries: {},
      }),
    });

    expect(catalog.capabilities[0].runtime).toMatchObject({
      source: "chain",
      registered: false,
      enabled: null,
      permissions: null,
      registrationStatus: "not_registered",
      reason: null,
    });
  });

  test("surfaces registered and enabled runtime truth separately from manifest truth", async () => {
    const catalog = await loadExtensionCatalog({
      runtimeLoader: async (): Promise<ExtensionRuntimeSnapshot> => ({
        source: "chain",
        reason: null,
        entries: {
          "4EMGqMpeUHg2nDdWBrYkej1t5pR7LJL1ehBnXHRZJbVV": {
            enabled: true,
            permissions: ["ReputationWrite"],
          },
        },
      }),
    });

    expect(catalog.capabilities[0]).toMatchObject({
      status: "active",
      runtime: {
        source: "chain",
        registered: true,
        enabled: true,
        permissions: ["ReputationWrite"],
        registrationStatus: "registered_enabled",
        reason: null,
      },
    });
  });

  test("surfaces registered but disabled runtime truth", async () => {
    const catalog = await loadExtensionCatalog({
      runtimeLoader: async (): Promise<ExtensionRuntimeSnapshot> => ({
        source: "chain",
        reason: null,
        entries: {
          "4EMGqMpeUHg2nDdWBrYkej1t5pR7LJL1ehBnXHRZJbVV": {
            enabled: false,
            permissions: ["ReputationWrite"],
          },
        },
      }),
    });

    expect(catalog.capabilities[0].runtime).toMatchObject({
      source: "chain",
      registered: true,
      enabled: false,
      permissions: ["ReputationWrite"],
      registrationStatus: "registered_disabled",
      reason: null,
    });
  });

  test("degrades explicitly when runtime truth is unavailable", async () => {
    const catalog = await loadExtensionCatalog({
      runtimeLoader: async (): Promise<ExtensionRuntimeSnapshot> => ({
        source: "unavailable",
        reason: "rpc_unavailable",
        entries: {},
      }),
    });

    expect(catalog.capabilities[0]).toMatchObject({
      status: "active",
      runtime: {
        source: "unavailable",
        registered: false,
        enabled: null,
        permissions: null,
        registrationStatus: "runtime_unavailable",
        reason: "rpc_unavailable",
      },
    });
  });

  test("marks manifest root as configured when EXTENSION_MANIFEST_ROOT is explicitly set", async () => {
    const catalog = await loadExtensionCatalog({
      runtimeLoader: async (): Promise<ExtensionRuntimeSnapshot> => ({
        source: "chain",
        reason: null,
        entries: {},
      }),
    });

    expect(catalog).toMatchObject({
      manifestSource: "configured",
      manifestReason: null,
    });
  });

  test("surfaces missing manifest root explicitly instead of silently returning an empty catalog", async () => {
    process.env.EXTENSION_MANIFEST_ROOT = path.resolve(
      __dirname,
      "fixtures/does-not-exist"
    );
    clearExtensionCatalogCache();

    const catalog = await loadExtensionCatalog({
      runtimeLoader: async (): Promise<ExtensionRuntimeSnapshot> => ({
        source: "chain",
        reason: null,
        entries: {},
      }),
    });

    expect(catalog).toMatchObject({
      manifestSource: "missing",
      manifestReason: "manifest_root_missing",
      capabilities: [],
      skippedFiles: [],
    });
  });
});
