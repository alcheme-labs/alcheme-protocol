import { normalizeExternalAppManifest } from "../manifest";
import { validateProductionManifestPlatformIdentity } from "../manifestPlatformValidation";

const baseManifest = {
  version: "1",
  appId: "last-ignition",
  name: "Last Ignition",
  homeUrl: "https://game.example.com",
  ownerWallet: "solana:devnet:owner",
  serverPublicKey: "server-key",
  allowedOrigins: ["https://game.example.com"],
  capabilities: ["communication.rooms"],
};

describe("external app production manifest platform validation", () => {
  it("accepts web, native, desktop, redirect, callback, and public signing key fields", () => {
    const manifest = normalizeExternalAppManifest({
      ...baseManifest,
      platforms: {
        nativeBundleIds: ["com.alcheme.game"],
        desktopAppIds: ["com.alcheme.desktop"],
        redirectUris: ["https://game.example.com/callback", "alchemegame://callback"],
        signingKeys: [{ kty: "OKP", crv: "Ed25519", x: "public-key" }],
      },
      callbacks: {
        serverCallbacks: ["https://game.example.com/webhook"],
      },
      policy: {
        approvedCustomRedirectSchemes: ["alchemegame"],
      },
    });

    expect(() => validateProductionManifestPlatformIdentity(manifest)).not.toThrow();
  });

  it("rejects private signing keys and unapproved custom redirect schemes", () => {
    const privateKeyManifest = normalizeExternalAppManifest({
      ...baseManifest,
      platforms: {
        signingKeys: [{ privateKey: "secret" }],
      },
    });
    expect(() => validateProductionManifestPlatformIdentity(privateKeyManifest)).toThrow(
      "external_app_manifest_private_signing_key_rejected",
    );

    const redirectManifest = normalizeExternalAppManifest({
      ...baseManifest,
      platforms: {
        redirectUris: ["badgame://callback"],
      },
      policy: {
        approvedCustomRedirectSchemes: ["alchemegame"],
      },
    });
    expect(() => validateProductionManifestPlatformIdentity(redirectManifest)).toThrow(
      "external_app_manifest_redirect_uri_unapproved",
    );
  });
});
