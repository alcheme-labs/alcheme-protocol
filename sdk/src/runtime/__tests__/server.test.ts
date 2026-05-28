import {
  buildAppRoomClaimPayload,
  buildExternalAppOwnerAssertionPayload,
  buildPlatformCallbackPayload,
  computeExternalAppEvidenceHash,
  computeExternalAppManifestHash,
  computeExternalAppReceiptDigest,
  computeExternalAppRiskDisclaimerAcceptanceDigest,
  computePlatformCallbackDigest,
  encodeAppRoomClaimPayload,
  normalizeExternalAppManifest,
  signExternalAppOwnerAssertion,
  signAppRoomClaim,
} from "../../server";
import * as root from "../../index";

describe("server runtime helpers", () => {
  const manifest = {
    version: "1",
    appId: "Last-Ignition",
    name: "Last Ignition",
    homeUrl: "https://game.example.com/",
    ownerWallet: "solana:devnet:owner-wallet",
    serverPublicKey: "server-key",
    allowedOrigins: ["https://game.example.com", "https://game.example.com"],
    platforms: {
      webOrigins: ["https://game.example.com"],
    },
    capabilities: ["voice.livekit", "communication.rooms"],
    callbacks: {
      eventsUrl: "https://game.example.com/callback",
    },
  };

  it("keeps server helpers out of the SDK root export", () => {
    expect(root).not.toHaveProperty("signAppRoomClaim");
    expect(root).not.toHaveProperty("signExternalAppOwnerAssertion");
  });

  it("builds stable manifest and owner assertion payloads", async () => {
    const manifestHash = computeExternalAppManifestHash(manifest);
    expect(normalizeExternalAppManifest(manifest)).toEqual({
      version: "1",
      appId: "last-ignition",
      name: "Last Ignition",
      homeUrl: "https://game.example.com/",
      ownerWallet: "solana:devnet:owner-wallet",
      serverPublicKey: "server-key",
      allowedOrigins: ["https://game.example.com"],
      platforms: {
        webOrigins: ["https://game.example.com"],
      },
      capabilities: ["communication.rooms", "voice.livekit"],
      callbacks: {
        eventsUrl: "https://game.example.com/callback",
      },
      policy: undefined,
    });
    expect(manifestHash).toBe(
      "sha256:55408284923202ecce82cb388d5c179b34847a79cdb6b6b075b7468ebb0b6257",
    );
    expect(
      buildExternalAppOwnerAssertionPayload({
        appId: "Last-Ignition",
        ownerWallet: manifest.ownerWallet,
        manifestHash,
        expiresAt: "2026-05-13T00:10:00.000Z",
        nonce: "nonce-1",
      }),
    ).toMatchObject({
      appId: "last-ignition",
      audience: "alcheme:external-app-production-registration",
      manifestHash,
    });
    const assertion = await signExternalAppOwnerAssertion(
      {
        appId: "last-ignition",
        ownerWallet: manifest.ownerWallet,
        manifestHash,
        expiresAt: "2026-05-13T00:10:00.000Z",
        nonce: "nonce-1",
      },
      async (payload) => `signed:${payload}`,
    );
    expect(assertion.signature).toBe(`signed:${assertion.payload}`);
  });

  it("matches production manifest canonicalization rules", () => {
    expect(() =>
      normalizeExternalAppManifest({
        ...manifest,
        homeUrl: "http://game.example.com",
      }),
    ).toThrow("invalid_external_app_manifest");
    expect(() =>
      normalizeExternalAppManifest({
        ...manifest,
        allowedOrigins: ["https://game.example.com/play"],
      }),
    ).toThrow("invalid_external_app_manifest");
    expect(() =>
      normalizeExternalAppManifest({
        ...manifest,
        serverPublicKey: null,
      }),
    ).toThrow("invalid_external_app_manifest");
  });

  it("builds normalized app room claim payload", () => {
    const payload = buildAppRoomClaimPayload({
      externalAppId: "Last-Ignition",
      roomType: "Party",
      externalRoomId: "coop-1",
      walletPubkeys: ["wallet-1"],
      expiresAt: "2026-05-13T00:10:00.000Z",
      nonce: "nonce-1",
    });
    expect(payload.externalAppId).toBe("last-ignition");
    expect(payload.roomType).toBe("party");
  });

  it("encodes and signs app room claims with host-provided signer", async () => {
    const input = {
      externalAppId: "last-ignition",
      roomType: "party",
      externalRoomId: "coop-1",
      walletPubkeys: ["wallet-1"],
      expiresAt: "2026-05-13T00:10:00.000Z",
      nonce: "nonce-1",
    };
    const claim = await signAppRoomClaim(input, async (payload) => `signed:${payload}`);
    expect(claim.payload).toBe(encodeAppRoomClaimPayload(buildAppRoomClaimPayload(input)));
    expect(claim.signature).toBe(`signed:${claim.payload}`);
  });

  it("builds callback, evidence, and receipt digests without private keys", () => {
    const bodyDigest = "sha256:" + "a".repeat(64);
    const callbackPayload = buildPlatformCallbackPayload({
      externalAppId: "last-ignition",
      callbackUrl: "https://game.example.com/callback",
      eventType: "room.started",
      bodyDigest,
      timestamp: "2026-05-13T00:10:00.000Z",
      nonce: "nonce-1",
    });
    expect(computePlatformCallbackDigest(callbackPayload)).toMatch(/^sha256:[a-f0-9]{64}$/);
    const evidenceHash = computeExternalAppEvidenceHash({
      externalAppId: "last-ignition",
      evidenceKind: "retained_log",
      evidenceBodyDigest: bodyDigest,
      submittedByPubkey: "reviewer-wallet",
      occurredAt: "2026-05-13T00:10:00.000Z",
    });
    expect(evidenceHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(
      computeExternalAppReceiptDigest({
        receiptType: "projection_receipt",
        externalAppId: "last-ignition",
        policyEpochId: "epoch-1",
        sourceDigest: evidenceHash,
        issuedAt: "2026-05-13T00:10:00.000Z",
        nonce: "nonce-2",
      }),
    ).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("builds production developer agreement acceptance digest for chain receipts", () => {
    expect(
      computeExternalAppRiskDisclaimerAcceptanceDigest({
        externalAppId: "last-ignition",
        actorPubkey: "11111111111111111111111111111111",
        scope: "developer_registration",
        policyEpochId: "external-app-review-v1:1",
        disclaimerVersion: "external-app-developer-agreement-v1",
        termsDigest: "sha256:" + "1".repeat(64),
        bindingDigest: "sha256:" + "2".repeat(64),
      }),
    ).toBe("sha256:b498509a2f778d5bf9963b5489a75e338cdc98ce24c6a8d11cfaa266276b96f2");
  });
});
