import { computeManifestHash, normalizeExternalAppManifest } from "../manifest";

describe("external app manifest", () => {
  it("normalizes required fields and computes stable hash", () => {
    const manifest = normalizeExternalAppManifest({
      version: "1",
      appId: "last-ignition",
      name: "Last Ignition",
      homeUrl: "https://game.example.com",
      ownerWallet: "solana:devnet:11111111111111111111111111111111",
      serverPublicKey: "server-key",
      allowedOrigins: ["https://game.example.com"],
      platforms: {
        webOrigins: ["https://game.example.com"],
      },
      capabilities: ["communication.rooms", "voice.livekit"],
    });

    expect(manifest.appId).toBe("last-ignition");
    expect(computeManifestHash(manifest)).toMatch(/^sha256:/);
  });

  it("rejects mismatched app id", () => {
    expect(() => normalizeExternalAppManifest({ version: "1", appId: "Bad App" })).toThrow(
      "invalid_external_app_manifest",
    );
  });

  it("rejects malformed allowed origins", () => {
    expect(() =>
      normalizeExternalAppManifest({
        version: "1",
        appId: "last-ignition",
        name: "Last Ignition",
        homeUrl: "https://game.example.com",
        ownerWallet: "solana:devnet:11111111111111111111111111111111",
        serverPublicKey: "server-key",
        allowedOrigins: ["https://game.example.com/path"],
        capabilities: ["communication.rooms"],
      }),
    ).toThrow("invalid_external_app_manifest");
  });

  it("requires production manifest URLs to use HTTPS", () => {
    expect(() =>
      normalizeExternalAppManifest({
        version: "1",
        appId: "last-ignition",
        name: "Last Ignition",
        homeUrl: "http://game.example.com",
        ownerWallet: "solana:devnet:11111111111111111111111111111111",
        serverPublicKey: "server-key",
        allowedOrigins: ["http://game.example.com"],
        capabilities: ["communication.rooms"],
      }),
    ).toThrow("invalid_external_app_manifest");
  });
});
