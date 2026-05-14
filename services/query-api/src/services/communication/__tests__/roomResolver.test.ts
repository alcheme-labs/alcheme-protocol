import { jest } from "@jest/globals";
import bs58 from "bs58";
import nacl from "tweetnacl";

import { createAppRoomClaim, resolveCommunicationRoom } from "../roomResolver";

const NOW = new Date("2026-05-08T12:00:00.000Z");
const WALLET = "9QfRrR7dW7B8d8n3k3D6Vw6m3W9R2kA2jGk4dWpP1uHz";

function buildPrismaMock(overrides: Record<string, unknown> = {}) {
  return {
    circle: {
      findUnique: jest.fn(async () => ({ id: 130 })),
    },
    externalApp: {
      findUnique: jest.fn(async () => null),
    },
    communicationRoom: {
      upsert: jest.fn(async ({ create }: any) => ({
        ...create,
        createdAt: NOW,
        updatedAt: NOW,
      })),
    },
    ...overrides,
  } as any;
}

function buildSignedClaim(
  payload: Record<string, unknown>,
  keyPair = nacl.sign.keyPair(),
) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signature = Buffer.from(
    nacl.sign.detached(Buffer.from(encodedPayload), keyPair.secretKey),
  ).toString("base64");
  return {
    claim: {
      payload: encodedPayload,
      signature,
    },
    serverPublicKey: bs58.encode(Buffer.from(keyPair.publicKey)),
  };
}

describe("resolveCommunicationRoom", () => {
  test("resolves external rooms idempotently with a valid app claim", async () => {
    const { claim, serverPublicKey } = buildSignedClaim({
      externalAppId: "example-web3-game",
      roomType: "dungeon",
      externalRoomId: "run-8791",
      walletPubkeys: [WALLET],
      expiresAt: "2026-05-08T12:05:00.000Z",
      nonce: "claim-1",
    });
    const prisma = buildPrismaMock({
      externalApp: {
        findUnique: jest.fn(async () => ({
          id: "example-web3-game",
          status: "active",
          serverPublicKey,
          claimAuthMode: "server_ed25519",
        })),
      },
    });

    const first = await resolveCommunicationRoom(
      prisma,
      {
        externalAppId: "example-web3-game",
        roomType: "dungeon",
        externalRoomId: "run-8791",
        parentCircleId: 130,
        ttlSec: 7200,
        appRoomClaim: claim,
        walletPubkey: WALLET,
      },
      { now: NOW },
    );
    const second = await resolveCommunicationRoom(
      prisma,
      {
        externalAppId: "example-web3-game",
        roomType: "dungeon",
        externalRoomId: "run-8791",
        parentCircleId: 130,
        ttlSec: 7200,
        appRoomClaim: claim,
        walletPubkey: WALLET,
      },
      { now: NOW },
    );

    expect(first.roomKey).toBe("external:example-web3-game:dungeon:run-8791");
    expect(second.roomKey).toBe(first.roomKey);
    expect(first.knowledgeMode).toBe("off");
    expect(first.metadata).toEqual({
      capabilities: {
        textChat: true,
        voice: true,
        voiceClip: false,
        transcriptRecap: false,
        plazaDiscussion: false,
        aiSummary: false,
        draftGeneration: false,
        crystallization: false,
        governance: false,
      },
    });
    expect(prisma.communicationRoom.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { roomKey: first.roomKey },
      }),
    );
    const firstUpsert = prisma.communicationRoom.upsert.mock.calls[0][0] as any;
    const secondUpsert = prisma.communicationRoom.upsert.mock.calls[1][0] as any;
    expect(firstUpsert.create.metadata).toEqual(first.metadata);
    expect(firstUpsert.update.metadata).toBeUndefined();
    expect(secondUpsert.update.metadata).toBeUndefined();
  });

  test("rejects external rooms while app registration is not approved", async () => {
    const { claim, serverPublicKey } = buildSignedClaim({
      externalAppId: "example-web3-game",
      roomType: "dungeon",
      externalRoomId: "run-8791",
      walletPubkeys: [WALLET],
      expiresAt: "2026-05-08T12:05:00.000Z",
      nonce: "claim-1",
    });
    const prisma = buildPrismaMock({
      externalApp: {
        findUnique: jest.fn(async () => ({
          id: "example-web3-game",
          status: "active",
          registryStatus: "pending",
          serverPublicKey,
          claimAuthMode: "server_ed25519",
        })),
      },
    });

    await expect(
      resolveCommunicationRoom(
        prisma,
        {
          externalAppId: "example-web3-game",
          roomType: "dungeon",
          externalRoomId: "run-8791",
          appRoomClaim: claim,
          walletPubkey: WALLET,
        },
        { now: NOW },
      ),
    ).rejects.toMatchObject({ code: "external_app_not_approved" });
  });

  test("rejects production external rooms without confirmed chain registry receipt in required mode", async () => {
    const { claim, serverPublicKey } = buildSignedClaim({
      externalAppId: "example-web3-game",
      roomType: "dungeon",
      externalRoomId: "run-8791",
      walletPubkeys: [WALLET],
      expiresAt: "2026-05-08T12:05:00.000Z",
      nonce: "claim-1",
    });
    const prisma = buildPrismaMock({
      externalApp: {
        findUnique: jest.fn(async () => ({
          id: "example-web3-game",
          status: "active",
          environment: "mainnet_production",
          registryStatus: "active",
          serverPublicKey,
          claimAuthMode: "server_ed25519",
        })),
      },
      externalAppRegistryAnchor: {
        findUnique: jest.fn(async () => ({
          registryStatus: "active",
          finalityStatus: "submitted",
          receiptFinalityStatus: "pending",
        })),
      },
    });

    await expect(
      resolveCommunicationRoom(
        prisma,
        {
          externalAppId: "example-web3-game",
          roomType: "dungeon",
          externalRoomId: "run-8791",
          appRoomClaim: claim,
          walletPubkey: WALLET,
        },
        { now: NOW, externalAppRegistryMode: "required" },
      ),
    ).rejects.toMatchObject({ code: "external_app_registry_anchor_required" });
  });

  test("reuses circle room keys and defaults knowledge capture to full", async () => {
    const prisma = buildPrismaMock();

    const room = await resolveCommunicationRoom(
      prisma,
      {
        roomType: "circle",
        parentCircleId: 130,
        createdByPubkey: WALLET,
      },
      { now: NOW },
    );

    expect(room).toMatchObject({
      roomKey: "circle:130",
      roomType: "circle",
      parentCircleId: 130,
      knowledgeMode: "full",
      metadata: {
        capabilities: {
          textChat: true,
          voice: true,
          voiceClip: true,
          transcriptRecap: false,
          plazaDiscussion: true,
          aiSummary: true,
          draftGeneration: true,
          crystallization: true,
          governance: true,
        },
      },
    });
    expect(prisma.communicationRoom.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          id: "circle:130",
          externalAppId: null,
        }),
      }),
    );
  });

  test("drops unsigned circle voice policy metadata unless the caller is an explicit first-party path", async () => {
    const prisma = buildPrismaMock();

    const room = await resolveCommunicationRoom(
      prisma,
      {
        roomType: "circle",
        parentCircleId: 130,
        createdByPubkey: WALLET,
        metadata: {
          voicePolicy: {
            maxSpeakers: 1,
            overflowStrategy: "deny",
          },
          custom: "keep",
        },
      },
      { now: NOW },
    );

    expect(room.metadata).toEqual({
      custom: "keep",
      capabilities: {
        textChat: true,
        voice: true,
        voiceClip: true,
        transcriptRecap: false,
        plazaDiscussion: true,
        aiSummary: true,
        draftGeneration: true,
        crystallization: true,
        governance: true,
      },
    });
  });

  test("keeps circle voice policy metadata only for trusted first-party room callers", async () => {
    const prisma = buildPrismaMock();

    const room = await resolveCommunicationRoom(
      prisma,
      {
        roomType: "circle",
        parentCircleId: 130,
        createdByPubkey: WALLET,
        trustedFirstPartyMetadata: true,
        metadata: {
          voicePolicy: {
            maxSpeakers: 8,
            overflowStrategy: "queue",
            source: "room_metadata",
          },
        },
      },
      { now: NOW },
    );

    expect(room.metadata).toEqual({
      voicePolicy: {
        maxSpeakers: 8,
        overflowStrategy: "queue",
        source: "room_metadata",
      },
      capabilities: {
        textChat: true,
        voice: true,
        voiceClip: true,
        transcriptRecap: false,
        plazaDiscussion: true,
        aiSummary: true,
        draftGeneration: true,
        crystallization: true,
        governance: true,
      },
    });
  });

  test("keeps transcription off unless the signed app claim authorizes the requested mode", async () => {
    const keyPair = nacl.sign.keyPair();
    const baseClaim = buildSignedClaim(
      {
        externalAppId: "example-web3-game",
        roomType: "dungeon",
        externalRoomId: "run-8791",
        walletPubkeys: [WALLET],
        expiresAt: "2026-05-08T12:05:00.000Z",
        nonce: "claim-no-transcription",
      },
      keyPair,
    );
    const prisma = buildPrismaMock({
      externalApp: {
        findUnique: jest.fn(async () => ({
          id: "example-web3-game",
          status: "active",
          serverPublicKey: baseClaim.serverPublicKey,
          claimAuthMode: "server_ed25519",
        })),
      },
    });

    const unsafeRequest = await resolveCommunicationRoom(
      prisma,
      {
        externalAppId: "example-web3-game",
        roomType: "dungeon",
        externalRoomId: "run-8791",
        transcriptionMode: "full",
        appRoomClaim: baseClaim.claim,
        walletPubkey: WALLET,
      },
      { now: NOW },
    );

    expect(unsafeRequest.transcriptionMode).toBe("off");
    expect(unsafeRequest.metadata.capabilities.transcriptRecap).toBe(false);

    const authorizedClaim = buildSignedClaim(
      {
        externalAppId: "example-web3-game",
        roomType: "dungeon",
        externalRoomId: "run-8791",
        transcriptionMode: "recap",
        walletPubkeys: [WALLET],
        expiresAt: "2026-05-08T12:05:00.000Z",
        nonce: "claim-recap",
      },
      keyPair,
    );

    const authorizedRequest = await resolveCommunicationRoom(
      prisma,
      {
        externalAppId: "example-web3-game",
        roomType: "dungeon",
        externalRoomId: "run-8791",
        transcriptionMode: "recap",
        appRoomClaim: authorizedClaim.claim,
        walletPubkey: WALLET,
      },
      { now: NOW },
    );

    expect(authorizedRequest.transcriptionMode).toBe("recap");
    expect(authorizedRequest.metadata.capabilities.transcriptRecap).toBe(true);
    const authorizedUpsert = prisma.communicationRoom.upsert.mock.calls[1][0] as any;
    expect(authorizedUpsert.update.metadata.capabilities.transcriptRecap).toBe(true);
  });

  test("persists only the signed room voice policy for external app rooms", async () => {
    const { claim, serverPublicKey } = buildSignedClaim({
      externalAppId: "example-web3-game",
      roomType: "dungeon",
      externalRoomId: "run-8791",
      walletPubkeys: [WALLET],
      voicePolicy: {
        maxSpeakers: 12,
        overflowStrategy: "moderated_queue",
        moderatorRoles: ["host", "moderator"],
      },
      expiresAt: "2026-05-08T12:05:00.000Z",
      nonce: "claim-voice-policy",
    });
    const prisma = buildPrismaMock({
      externalApp: {
        findUnique: jest.fn(async () => ({
          id: "example-web3-game",
          status: "active",
          serverPublicKey,
          claimAuthMode: "server_ed25519",
        })),
      },
    });

    const room = await resolveCommunicationRoom(
      prisma,
      {
        externalAppId: "example-web3-game",
        roomType: "dungeon",
        externalRoomId: "run-8791",
        appRoomClaim: claim,
        walletPubkey: WALLET,
        metadata: {
          voicePolicy: {
            maxSpeakers: 99,
            overflowStrategy: "deny",
          },
        },
      },
      { now: NOW },
    );

    expect(room.metadata).toEqual({
      voicePolicy: {
        maxSpeakers: 12,
        overflowStrategy: "moderated_queue",
        moderatorRoles: ["host", "moderator"],
        source: "app_room_claim",
      },
      capabilities: {
        textChat: true,
        voice: true,
        voiceClip: false,
        transcriptRecap: false,
        plazaDiscussion: false,
        aiSummary: false,
        draftGeneration: false,
        crystallization: false,
        governance: false,
      },
    });
  });

  test("rejects missing parent circles before upserting", async () => {
    const prisma = buildPrismaMock({
      circle: {
        findUnique: jest.fn(async () => null),
      },
    });

    await expect(
      resolveCommunicationRoom(
        prisma,
        {
          roomType: "circle",
          parentCircleId: 999,
        },
        { now: NOW },
      ),
    ).rejects.toThrow("Parent circle not found");

    expect(prisma.communicationRoom.upsert).not.toHaveBeenCalled();
  });

  test("rejects tampered or expired app room claims", async () => {
    const keyPair = nacl.sign.keyPair();
    const { claim, serverPublicKey } = buildSignedClaim(
      {
        externalAppId: "example-web3-game",
        roomType: "dungeon",
        externalRoomId: "run-8791",
        walletPubkeys: [WALLET],
        expiresAt: "2026-05-08T11:59:00.000Z",
        nonce: "expired",
      },
      keyPair,
    );
    const prisma = buildPrismaMock({
      externalApp: {
        findUnique: jest.fn(async () => ({
          id: "example-web3-game",
          status: "active",
          serverPublicKey,
          claimAuthMode: "server_ed25519",
        })),
      },
    });

    await expect(
      resolveCommunicationRoom(
        prisma,
        {
          externalAppId: "example-web3-game",
          roomType: "dungeon",
          externalRoomId: "run-8791",
          appRoomClaim: claim,
          walletPubkey: WALLET,
        },
        { now: NOW },
      ),
    ).rejects.toThrow("appRoomClaim expired");

    const valid = buildSignedClaim(
      {
        externalAppId: "example-web3-game",
        roomType: "dungeon",
        externalRoomId: "run-8791",
        walletPubkeys: [WALLET],
        expiresAt: "2026-05-08T12:05:00.000Z",
        nonce: "valid",
      },
      keyPair,
    );

    await expect(
      resolveCommunicationRoom(
        prisma,
        {
          externalAppId: "example-web3-game",
          roomType: "dungeon",
          externalRoomId: "run-8792",
          appRoomClaim: valid.claim,
          walletPubkey: WALLET,
        },
        { now: NOW },
      ),
    ).rejects.toThrow("appRoomClaim does not match room");
  });

  test("createAppRoomClaim encodes a deterministic payload for app servers", () => {
    const claim = createAppRoomClaim({
      externalAppId: "example-web3-game",
      roomType: "dungeon",
      externalRoomId: "run-8791",
      walletPubkeys: [WALLET],
      expiresAt: "2026-05-08T12:05:00.000Z",
      nonce: "claim-1",
    });

    expect(
      JSON.parse(Buffer.from(claim.payload, "base64url").toString("utf8")),
    ).toEqual({
      externalAppId: "example-web3-game",
      roomType: "dungeon",
      externalRoomId: "run-8791",
      walletPubkeys: [WALLET],
      expiresAt: "2026-05-08T12:05:00.000Z",
      nonce: "claim-1",
    });
  });
});
