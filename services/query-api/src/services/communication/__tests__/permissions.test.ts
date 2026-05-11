import { jest } from "@jest/globals";
import { MemberRole, MemberStatus } from "@prisma/client";
import bs58 from "bs58";
import nacl from "tweetnacl";

import {
  canJoinVoice,
  canModerateRoom,
  canReadRoom,
  canWriteRoom,
  upsertCommunicationRoomMemberFromClaim,
} from "../permissions";

const NOW = new Date("2026-05-08T12:00:00.000Z");
const WALLET = "9QfRrR7dW7B8d8n3k3D6Vw6m3W9R2kA2jGk4dWpP1uHz";
const ROOM_KEY = "external:example-web3-game:dungeon:run-8791";

function activeRoom(overrides: Record<string, unknown> = {}) {
  return {
    roomKey: ROOM_KEY,
    roomType: "dungeon",
    externalAppId: "example-web3-game",
    parentCircleId: null,
    externalRoomId: "run-8791",
    lifecycleStatus: "active",
    expiresAt: null,
    endedAt: null,
    externalApp: {
      id: "example-web3-game",
      status: "active",
      serverPublicKey: null,
      claimAuthMode: "server_ed25519",
    },
    ...overrides,
  };
}

function roomMember(overrides: Record<string, unknown> = {}) {
  return {
    roomKey: ROOM_KEY,
    walletPubkey: WALLET,
    role: "member",
    canSpeak: true,
    muted: false,
    banned: false,
    leftAt: null,
    ...overrides,
  };
}

function buildPrismaMock(overrides: Record<string, unknown> = {}) {
  return {
    communicationRoom: {
      findUnique: jest.fn(async () => activeRoom()),
    },
    communicationRoomMember: {
      findUnique: jest.fn(async () => roomMember()),
      upsert: jest.fn(async ({ create, update }: any) => ({
        ...create,
        ...update,
      })),
    },
    user: {
      findUnique: jest.fn(async () => null),
    },
    circleMember: {
      findUnique: jest.fn(async () => null),
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

describe("communication permissions", () => {
  test("allows muted members to read but blocks text writes and voice publishing", async () => {
    const prisma = buildPrismaMock({
      communicationRoomMember: {
        findUnique: jest.fn(async () => roomMember({ muted: true })),
        upsert: jest.fn(),
      },
    });

    await expect(
      canReadRoom(
        prisma,
        { roomKey: ROOM_KEY, walletPubkey: WALLET },
        { now: NOW },
      ),
    ).resolves.toMatchObject({
      allowed: true,
      reason: "room_member",
    });
    await expect(
      canWriteRoom(
        prisma,
        { roomKey: ROOM_KEY, walletPubkey: WALLET },
        { now: NOW },
      ),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "member_muted",
    });
    await expect(
      canJoinVoice(
        prisma,
        { roomKey: ROOM_KEY, walletPubkey: WALLET },
        { now: NOW },
      ),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "member_muted",
    });
  });

  test("blocks banned members from read, write, and moderation paths", async () => {
    const prisma = buildPrismaMock({
      communicationRoomMember: {
        findUnique: jest.fn(async () =>
          roomMember({ role: "owner", banned: true }),
        ),
        upsert: jest.fn(),
      },
    });

    await expect(
      canReadRoom(
        prisma,
        { roomKey: ROOM_KEY, walletPubkey: WALLET },
        { now: NOW },
      ),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "member_banned",
    });
    await expect(
      canWriteRoom(
        prisma,
        { roomKey: ROOM_KEY, walletPubkey: WALLET },
        { now: NOW },
      ),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "member_banned",
    });
    await expect(
      canModerateRoom(
        prisma,
        { roomKey: ROOM_KEY, walletPubkey: WALLET },
        { now: NOW },
      ),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "member_banned",
    });
  });

  test("lets active circle members use circle-backed rooms without duplicating Plaza state", async () => {
    const prisma = buildPrismaMock({
      communicationRoom: {
        findUnique: jest.fn(async () =>
          activeRoom({
            roomKey: "circle:130",
            roomType: "circle",
            externalAppId: null,
            parentCircleId: 130,
            externalRoomId: null,
          }),
        ),
      },
      communicationRoomMember: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(),
      },
      circleMember: {
        findUnique: jest.fn(async () => ({
          status: MemberStatus.Active,
          role: MemberRole.Admin,
        })),
      },
    });

    await expect(
      canReadRoom(
        prisma,
        { roomKey: "circle:130", walletPubkey: WALLET, userId: 7 },
        { now: NOW },
      ),
    ).resolves.toMatchObject({
      allowed: true,
      reason: "circle_member",
    });
    await expect(
      canWriteRoom(
        prisma,
        { roomKey: "circle:130", walletPubkey: WALLET, userId: 7 },
        { now: NOW },
      ),
    ).resolves.toMatchObject({
      allowed: true,
      reason: "circle_member",
    });
    await expect(
      canModerateRoom(
        prisma,
        { roomKey: "circle:130", walletPubkey: WALLET, userId: 7 },
        { now: NOW },
      ),
    ).resolves.toMatchObject({
      allowed: true,
      reason: "circle_manager",
    });
  });

  test("resolves circle membership from wallet pubkey for session-authenticated REST access", async () => {
    const prisma = buildPrismaMock({
      communicationRoom: {
        findUnique: jest.fn(async () =>
          activeRoom({
            roomKey: "circle:130",
            roomType: "circle",
            externalAppId: null,
            parentCircleId: 130,
            externalRoomId: null,
          }),
        ),
      },
      communicationRoomMember: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(),
      },
      user: {
        findUnique: jest.fn(async () => ({ id: 7 })),
      },
      circleMember: {
        findUnique: jest.fn(async () => ({
          status: MemberStatus.Active,
          role: MemberRole.Admin,
        })),
      },
    });

    await expect(
      canReadRoom(
        prisma,
        { roomKey: "circle:130", walletPubkey: WALLET },
        { now: NOW },
      ),
    ).resolves.toMatchObject({
      allowed: true,
      reason: "circle_member",
    });
    await expect(
      canWriteRoom(
        prisma,
        { roomKey: "circle:130", walletPubkey: WALLET },
        { now: NOW },
      ),
    ).resolves.toMatchObject({
      allowed: true,
      reason: "circle_member",
    });
    await expect(
      canModerateRoom(
        prisma,
        { roomKey: "circle:130", walletPubkey: WALLET },
        { now: NOW },
      ),
    ).resolves.toMatchObject({
      allowed: true,
      reason: "circle_manager",
    });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { pubkey: WALLET },
      select: { id: true },
    });
  });

  test("upserts external room members only with a valid server-signed member claim", async () => {
    const { claim, serverPublicKey } = buildSignedClaim({
      externalAppId: "example-web3-game",
      roomType: "dungeon",
      externalRoomId: "run-8791",
      walletPubkeys: [WALLET],
      roles: { [WALLET]: "speaker" },
      expiresAt: "2026-05-08T12:05:00.000Z",
      nonce: "claim-1",
    });
    const prisma = buildPrismaMock({
      communicationRoom: {
        findUnique: jest.fn(async () =>
          activeRoom({
            externalApp: {
              id: "example-web3-game",
              status: "active",
              serverPublicKey,
              claimAuthMode: "server_ed25519",
            },
          }),
        ),
      },
    });

    await expect(
      upsertCommunicationRoomMemberFromClaim(
        prisma,
        { roomKey: ROOM_KEY, walletPubkey: WALLET, appRoomClaim: claim },
        { now: NOW },
      ),
    ).resolves.toMatchObject({
      roomKey: ROOM_KEY,
      walletPubkey: WALLET,
      role: "speaker",
      canSpeak: true,
      banned: false,
    });

    expect(prisma.communicationRoomMember.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          roomKey_walletPubkey: { roomKey: ROOM_KEY, walletPubkey: WALLET },
        },
        create: expect.objectContaining({ role: "speaker", canSpeak: true }),
      }),
    );
  });

  test("rejects expired and wallet-mismatched external member claims", async () => {
    const keyPair = nacl.sign.keyPair();
    const expired = buildSignedClaim(
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
    const mismatched = buildSignedClaim(
      {
        externalAppId: "example-web3-game",
        roomType: "dungeon",
        externalRoomId: "run-8791",
        walletPubkeys: ["6pUqMP3XGcw2eJDPGva7Jm1ug6zLRXJz2nzP7FNT3w62"],
        expiresAt: "2026-05-08T12:05:00.000Z",
        nonce: "mismatch",
      },
      keyPair,
    );
    const prisma = buildPrismaMock({
      communicationRoom: {
        findUnique: jest.fn(async () =>
          activeRoom({
            externalApp: {
              id: "example-web3-game",
              status: "active",
              serverPublicKey: expired.serverPublicKey,
              claimAuthMode: "server_ed25519",
            },
          }),
        ),
      },
    });

    await expect(
      upsertCommunicationRoomMemberFromClaim(
        prisma,
        {
          roomKey: ROOM_KEY,
          walletPubkey: WALLET,
          appRoomClaim: expired.claim,
        },
        { now: NOW },
      ),
    ).rejects.toThrow("appRoomClaim expired");
    await expect(
      upsertCommunicationRoomMemberFromClaim(
        prisma,
        {
          roomKey: ROOM_KEY,
          walletPubkey: WALLET,
          appRoomClaim: mismatched.claim,
        },
        { now: NOW },
      ),
    ).rejects.toThrow("appRoomClaim wallet mismatch");

    expect(prisma.communicationRoomMember.upsert).not.toHaveBeenCalled();
  });

  test("rejects external member claims that do not explicitly scope the wallet", async () => {
    const { claim, serverPublicKey } = buildSignedClaim({
      externalAppId: "example-web3-game",
      roomType: "dungeon",
      externalRoomId: "run-8791",
      expiresAt: "2026-05-08T12:05:00.000Z",
      nonce: "missing-wallet-scope",
    });
    const prisma = buildPrismaMock({
      communicationRoom: {
        findUnique: jest.fn(async () =>
          activeRoom({
            externalApp: {
              id: "example-web3-game",
              status: "active",
              serverPublicKey,
              claimAuthMode: "server_ed25519",
            },
          }),
        ),
      },
    });

    await expect(
      upsertCommunicationRoomMemberFromClaim(
        prisma,
        { roomKey: ROOM_KEY, walletPubkey: WALLET, appRoomClaim: claim },
        { now: NOW },
      ),
    ).rejects.toThrow("appRoomClaim wallet mismatch");

    expect(prisma.communicationRoomMember.upsert).not.toHaveBeenCalled();
  });
});
