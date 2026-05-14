import {
  appIdHash,
  externalAppExecutionIntentDigest,
  manifestHashToBytes32Hex,
  normalizeHash32Hex,
  ownerAssertionHash,
  policyStateDigest,
  serverKeyHash,
  sha256Bytes32,
} from "../chainRegistryDigest";

describe("external app chain registry digests", () => {
  it("hashes app ids with the V2 domain separator", () => {
    expect(appIdHash("demo-game")).toBe(
      sha256Bytes32("alcheme:external-app:v2:demo-game"),
    );
  });

  it("normalizes sha256 manifest hashes to raw bytes32 hex", () => {
    const hex = "a".repeat(64);

    expect(manifestHashToBytes32Hex(`sha256:${hex}`)).toBe(hex);
  });

  it("rejects unsupported manifest hash algorithms", () => {
    expect(() => manifestHashToBytes32Hex("blake3:abc")).toThrow(
      "external_app_registry_manifest_hash_must_be_sha256",
    );
  });

  it("rejects malformed bytes32 hex values", () => {
    expect(() => normalizeHash32Hex("abc", "test_hash")).toThrow(
      "invalid_test_hash",
    );
  });

  it("builds deterministic non-prefixed bytes32 digests", () => {
    expect(serverKeyHash("server-key")).toMatch(/^[0-9a-f]{64}$/);
    expect(ownerAssertionHash("payload", "signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(policyStateDigest({ b: 2, a: 1 })).toBe(policyStateDigest({ a: 1, b: 2 }));
    expect(
      externalAppExecutionIntentDigest({
        action: "external_app_register",
        appId: "demo-game",
        decisionDigest: "f".repeat(64),
      }),
    ).toMatch(/^[0-9a-f]{64}$/);
  });
});
