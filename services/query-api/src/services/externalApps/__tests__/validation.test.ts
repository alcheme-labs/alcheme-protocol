import {
  normalizeCapabilityPolicyMap,
  normalizeExternalAppDiscoveryStatus,
  normalizeExternalAppEnvironment,
  normalizeExternalAppId,
  normalizeExternalAppRegistryStatus,
  normalizeManagedNodePolicy,
} from "../validation";

describe("external app validation", () => {
  it("normalizes sandbox/devnet/mainnet environments", () => {
    expect(normalizeExternalAppEnvironment("sandbox")).toBe("sandbox");
    expect(normalizeExternalAppEnvironment("devnet_reviewed")).toBe("devnet_reviewed");
    expect(normalizeExternalAppEnvironment("mainnet_production")).toBe("mainnet_production");
  });

  it("rejects unknown environments", () => {
    expect(() => normalizeExternalAppEnvironment("production")).toThrow(
      "invalid_external_app_environment",
    );
  });

  it("normalizes status and policy fields", () => {
    expect(normalizeExternalAppRegistryStatus("pending")).toBe("pending");
    expect(normalizeExternalAppRegistryStatus("active")).toBe("active");
    expect(normalizeExternalAppRegistryStatus("suspended")).toBe("suspended");
    expect(normalizeExternalAppDiscoveryStatus("listed")).toBe("listed");
    expect(normalizeManagedNodePolicy("restricted")).toBe("restricted");
  });

  it("rejects v3 dispute state as v2 registry status", () => {
    expect(() => normalizeExternalAppRegistryStatus("disputed")).toThrow(
      "invalid_external_app_registry_status",
    );
  });

  it("keeps capability policy as explicit named capabilities", () => {
    expect(normalizeCapabilityPolicyMap({ voice: "limited", ai: "normal" })).toEqual({
      voice: "limited",
      ai: "normal",
    });
  });

  it("rejects invalid app id", () => {
    expect(() => normalizeExternalAppId("Bad App")).toThrow("invalid_external_app_id");
  });
});
