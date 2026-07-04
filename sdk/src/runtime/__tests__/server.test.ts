import {
  buildKnowledgeContextClaimPayload,
  buildAppRoomClaimPayload,
  buildExternalAppOwnerAssertionPayload,
  buildPlatformCallbackPayload,
  buildSourceMaterialStatusClaimPayload,
  buildSourceSubmissionClaimPayload,
  computeExternalAppEvidenceHash,
  computeExternalAppManifestHash,
  computeSandboxExternalAppManifestHash,
  computeExternalAppReceiptDigest,
  computeExternalAppRiskDisclaimerAcceptanceDigest,
  computeExternalProgramSummaryDigest,
  computePlatformCallbackDigest,
  encodeAppRoomClaimPayload,
  encodeKnowledgeContextClaimPayload,
  encodeSourceMaterialStatusClaimPayload,
  encodeSourceSubmissionClaimPayload,
  EXTERNAL_PROGRAM_CLAIM_CONTRACT_VERSION,
  normalizeExternalAppManifest,
  normalizeSandboxExternalAppManifest,
  signExternalAppOwnerAssertion,
  signAppRoomClaim,
  signKnowledgeContextClaim,
  signSourceMaterialStatusClaim,
  signSourceSubmissionClaim,
} from "../../server";
import * as root from "../../index";

function decodePayload<T>(encodedPayload: string): T {
  return JSON.parse(
    Buffer.from(encodedPayload, "base64url").toString("utf8"),
  ) as T;
}

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
    expect(root).not.toHaveProperty("signSourceSubmissionClaim");
    expect(root).not.toHaveProperty("signKnowledgeContextClaim");
    expect(root).not.toHaveProperty("signSourceMaterialStatusClaim");
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
      capabilities: ["voice.livekit", "communication.rooms"],
      callbacks: {
        eventsUrl: "https://game.example.com/callback",
      },
      policy: undefined,
    });
    expect(manifestHash).toBe(
      "sha256:b44a49a2a6083e0c9f891c0ca4f726a40dd13a48ca96a5cde06bf408dbfc7265",
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
    expect(
      buildExternalAppOwnerAssertionPayload({
        appId: "Last-Ignition",
        ownerWallet: manifest.ownerWallet,
        manifestHash,
        audience: "alcheme:external-app-sandbox-registration",
        expiresAt: "2026-05-13T00:10:00.000Z",
        nonce: "nonce-sandbox",
      }),
    ).toMatchObject({
      appId: "last-ignition",
      audience: "alcheme:external-app-sandbox-registration",
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
    const sandboxAssertion = await signExternalAppOwnerAssertion(
      {
        appId: "last-ignition",
        ownerWallet: manifest.ownerWallet,
        manifestHash,
        audience: "alcheme:external-app-sandbox-registration",
        expiresAt: "2026-05-13T00:10:00.000Z",
        nonce: "nonce-sandbox",
      },
      async (payload) => `signed:${payload}`,
    );
    expect(
      decodePayload<{ audience: string }>(sandboxAssertion.payload).audience,
    ).toBe("alcheme:external-app-sandbox-registration");
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

  it("builds sandbox manifest hashes for local development origins", () => {
    const sandboxManifest = {
      ...manifest,
      homeUrl: "http://localhost:5173",
      allowedOrigins: ["http://localhost:5173", "http://127.0.0.1:4173"],
    };

    expect(normalizeSandboxExternalAppManifest(sandboxManifest)).toMatchObject({
      appId: "last-ignition",
      homeUrl: "http://localhost:5173/",
      allowedOrigins: ["http://127.0.0.1:4173", "http://localhost:5173"],
    });
    expect(computeSandboxExternalAppManifestHash(sandboxManifest)).toMatch(
      /^sha256:[0-9a-f]{64}$/,
    );
    expect(() =>
      normalizeSandboxExternalAppManifest({
        ...sandboxManifest,
        allowedOrigins: ["http://game.example.com"],
      }),
    ).toThrow("invalid_external_app_manifest");
  });

  it("builds normalized app room claim payload", () => {
    const payload = buildAppRoomClaimPayload({
      externalAppId: "Last-Ignition",
      roomType: "Party",
      externalRoomId: "coop-1",
      serverKeyVersion: "2026-07-04-primary",
      transcriptionMode: "recap",
      voicePolicy: {
        maxSpeakers: 12,
        overflowStrategy: "Listen_Only",
        moderatorRoles: [" RaidLead ", "raidlead", "Guide"],
      },
      walletPubkeys: ["wallet-1"],
      expiresAt: "2026-05-13T00:10:00.000Z",
      nonce: "nonce-1",
    });
    expect(payload.claimContractVersion).toBe(
      EXTERNAL_PROGRAM_CLAIM_CONTRACT_VERSION,
    );
    expect(payload.serverKeyVersion).toBe("2026-07-04-primary");
    expect(payload.externalAppId).toBe("last-ignition");
    expect(payload.roomType).toBe("party");
    expect(payload.transcriptionMode).toBe("recap");
    expect(payload.voicePolicy).toEqual({
      maxSpeakers: 12,
      overflowStrategy: "listen_only",
      moderatorRoles: ["guide", "raidlead"],
    });
  });

  it("encodes and signs app room claims with host-provided signer", async () => {
    const input = {
      externalAppId: "last-ignition",
      roomType: "party",
      externalRoomId: "coop-1",
      serverKeyVersion: "2026-07-04-primary",
      transcriptionMode: "recap" as const,
      walletPubkeys: ["wallet-1"],
      expiresAt: "2026-05-13T00:10:00.000Z",
      nonce: "nonce-1",
    };
    const claim = await signAppRoomClaim(
      input,
      async (payload) => `signed:${payload}`,
    );
    expect(claim.payload).toBe(
      encodeAppRoomClaimPayload(buildAppRoomClaimPayload(input)),
    );
    expect(claim.signature).toBe(`signed:${claim.payload}`);
    expect(
      decodePayload<{ claimContractVersion: string; serverKeyVersion: string }>(
        claim.payload,
      ),
    ).toMatchObject({
      claimContractVersion: EXTERNAL_PROGRAM_CLAIM_CONTRACT_VERSION,
      serverKeyVersion: "2026-07-04-primary",
    });
  });

  it("builds, encodes, and signs source submission claims", async () => {
    const input = {
      externalAppId: "last-ignition",
      roomKey: "external:last-ignition:world:lobby",
      originType: "communication_message" as const,
      originRef: "envelope-1",
      targetCircleId: 130,
      summaryText: "Players agreed on a frost resistance strategy.",
      evidencePrivacyClass: "circle_only" as const,
      requestedLifecycleStatus: "submitted" as const,
      submittedByPubkey: "wallet-1",
      serverKeyVersion: "2026-07-04-primary",
      expiresAt: "2026-05-13T00:10:00.000Z",
      nonce: "nonce-source-1",
    };
    const payload = buildSourceSubmissionClaimPayload(input);
    expect(payload).toMatchObject({
      claimContractVersion: EXTERNAL_PROGRAM_CLAIM_CONTRACT_VERSION,
      serverKeyVersion: "2026-07-04-primary",
      externalAppId: "last-ignition",
      summaryDigest: computeExternalProgramSummaryDigest(input.summaryText),
    });

    const claim = await signSourceSubmissionClaim(
      input,
      async (encodedPayload) => `signed:${encodedPayload}`,
    );
    expect(claim.payload).toBe(encodeSourceSubmissionClaimPayload(payload));
    expect(claim.signature).toBe(`signed:${claim.payload}`);
    expect(decodePayload<typeof payload>(claim.payload)).toEqual(payload);
  });

  it("builds, encodes, and signs knowledge context claims", async () => {
    const input = {
      externalAppId: "last-ignition",
      roomKey: "external:last-ignition:world:lobby",
      circleId: 130,
      walletPubkey: "wallet-1",
      purpose: "room_sidebar",
      serverKeyVersion: "2026-07-04-primary",
      expiresAt: "2026-05-13T00:10:00.000Z",
      nonce: "nonce-knowledge-1",
    };
    const payload = buildKnowledgeContextClaimPayload(input);
    expect(payload).toMatchObject({
      claimContractVersion: EXTERNAL_PROGRAM_CLAIM_CONTRACT_VERSION,
      serverKeyVersion: "2026-07-04-primary",
      externalAppId: "last-ignition",
      requestedCapability: "knowledge_context",
    });

    const claim = await signKnowledgeContextClaim(
      input,
      async (encodedPayload) => `signed:${encodedPayload}`,
    );
    expect(claim.payload).toBe(encodeKnowledgeContextClaimPayload(payload));
    expect(claim.signature).toBe(`signed:${claim.payload}`);
    expect(decodePayload<typeof payload>(claim.payload)).toEqual(payload);
  });

  it("builds, encodes, and signs source material status claims", async () => {
    const byIdInput = {
      externalAppId: "Last-Ignition",
      sourceMaterialId: 42,
      serverKeyVersion: "2026-07-04-primary",
      expiresAt: "2026-05-13T00:10:00.000Z",
      nonce: "nonce-status-1",
    };
    const byIdPayload = buildSourceMaterialStatusClaimPayload(byIdInput);
    expect(byIdPayload).toEqual({
      claimContractVersion: EXTERNAL_PROGRAM_CLAIM_CONTRACT_VERSION,
      serverKeyVersion: "2026-07-04-primary",
      externalAppId: "last-ignition",
      sourceMaterialId: 42,
      purpose: "source_material_status",
      expiresAt: "2026-05-13T00:10:00.000Z",
      nonce: "nonce-status-1",
    });

    const byOriginPayload = buildSourceMaterialStatusClaimPayload({
      externalAppId: "last-ignition",
      originType: "external_summary",
      originRef: "boss-run-1",
      expiresAt: "2026-05-13T00:10:00.000Z",
      nonce: "nonce-status-2",
    });
    expect(byOriginPayload).toMatchObject({
      externalAppId: "last-ignition",
      originType: "external_summary",
      originRef: "boss-run-1",
      purpose: "source_material_status",
    });

    const claim = await signSourceMaterialStatusClaim(
      byIdInput,
      async (encodedPayload) => `signed:${encodedPayload}`,
    );
    expect(claim.payload).toBe(
      encodeSourceMaterialStatusClaimPayload(byIdPayload),
    );
    expect(claim.signature).toBe(`signed:${claim.payload}`);
    expect(decodePayload<typeof byIdPayload>(claim.payload)).toEqual(
      byIdPayload,
    );
    expect(() =>
      buildSourceMaterialStatusClaimPayload({
        externalAppId: "last-ignition",
        expiresAt: "2026-05-13T00:10:00.000Z",
        nonce: "nonce-status-3",
      }),
    ).toThrow("invalid_source_material_status_scope");
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
    expect(computePlatformCallbackDigest(callbackPayload)).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
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
    ).toBe(
      "sha256:b498509a2f778d5bf9963b5489a75e338cdc98ce24c6a8d11cfaa266276b96f2",
    );
  });
});
