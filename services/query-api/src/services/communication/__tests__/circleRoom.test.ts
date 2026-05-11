import { MemberRole, MemberStatus } from "@prisma/client";
import { describe, expect, jest, test } from "@jest/globals";

import { ensureCircleCommunicationRoom } from "../circleRoom";

const NOW = new Date("2026-05-11T12:00:00.000Z");
const WALLET = "wallet-speaker";

function buildPrismaMock(
  options: {
    circleMember?: Record<string, unknown> | null;
    existingRoom?: any;
    user?: Record<string, unknown> | null;
  } = {},
) {
  const rooms = new Map<string, any>();
  const members = new Map<string, any>();
  if (options.existingRoom) {
    rooms.set(options.existingRoom.roomKey, options.existingRoom);
  }

  return {
    circle: {
      findUnique: jest.fn(async () => ({ id: 130 })),
    },
    externalApp: {
      findUnique: jest.fn(async () => null),
    },
    communicationRoom: {
      findUnique: jest.fn(async ({ where }: any) => rooms.get(where.roomKey) ?? null),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const existing = rooms.get(where.roomKey);
        const next = existing
          ? { ...existing, ...update, updatedAt: NOW }
          : { ...create, createdAt: NOW, updatedAt: NOW };
        rooms.set(where.roomKey, next);
        return next;
      }),
    },
    communicationRoomMember: {
      findUnique: jest.fn(async ({ where }: any) => {
        return members.get(
          `${where.roomKey_walletPubkey.roomKey}:${where.roomKey_walletPubkey.walletPubkey}`,
        ) ?? null;
      }),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const key = `${where.roomKey_walletPubkey.roomKey}:${where.roomKey_walletPubkey.walletPubkey}`;
        const existing = members.get(key);
        const next = existing ? { ...existing, ...update } : { ...create, joinedAt: NOW };
        members.set(key, next);
        return next;
      }),
    },
    user: {
      findUnique: jest.fn(async () => options.user ?? { id: 7 }),
    },
    circleMember: {
      findUnique: jest.fn(async () =>
        options.circleMember === undefined
          ? {
              status: MemberStatus.Active,
              role: MemberRole.Admin,
            }
          : options.circleMember,
      ),
    },
  } as any;
}

describe("ensureCircleCommunicationRoom", () => {
  test("creates a first-party circle room with default voice policy and member row", async () => {
    const prisma = buildPrismaMock();

    const result = await ensureCircleCommunicationRoom(
      prisma,
      { circleId: 130, walletPubkey: WALLET },
      { now: NOW },
    );

    expect(result.room).toMatchObject({
      roomKey: "circle:130",
      roomType: "circle",
      parentCircleId: 130,
      knowledgeMode: "full",
      retentionPolicy: "persistent",
      metadata: {
        voicePolicy: {
          maxSpeakers: 16,
          overflowStrategy: "listen_only",
          source: "room_metadata",
        },
      },
    });
    expect(result.member).toMatchObject({
      roomKey: "circle:130",
      walletPubkey: WALLET,
      role: "member",
      canSpeak: true,
    });
  });

  test("preserves existing voice policy and unrelated metadata", async () => {
    const prisma = buildPrismaMock({
      existingRoom: {
        id: "circle:130",
        roomKey: "circle:130",
        roomType: "circle",
        parentCircleId: 130,
        externalAppId: null,
        externalRoomId: null,
        lifecycleStatus: "active",
        knowledgeMode: "full",
        transcriptionMode: "off",
        retentionPolicy: "persistent",
        metadata: {
          voicePolicy: {
            maxSpeakers: 4,
            overflowStrategy: "moderated_queue",
            source: "room_metadata",
          },
          capabilities: { plazaDiscussion: true },
          custom: "keep",
        },
        expiresAt: null,
        endedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    });

    const result = await ensureCircleCommunicationRoom(
      prisma,
      { circleId: 130, walletPubkey: WALLET },
      { now: NOW },
    );

    expect(result.room.metadata).toMatchObject({
      voicePolicy: {
        maxSpeakers: 4,
        overflowStrategy: "moderated_queue",
        source: "room_metadata",
      },
      capabilities: { plazaDiscussion: true },
      custom: "keep",
    });
  });

  test("rejects non-members before creating rooms or member rows", async () => {
    const prisma = buildPrismaMock({
      circleMember: null,
    });

    await expect(
      ensureCircleCommunicationRoom(
        prisma,
        { circleId: 130, walletPubkey: WALLET },
        { now: NOW },
      ),
    ).rejects.toMatchObject({
      message: "room_membership_required",
      statusCode: 403,
    });

    expect(prisma.communicationRoom.upsert).not.toHaveBeenCalled();
    expect(prisma.communicationRoomMember.upsert).not.toHaveBeenCalled();
  });
});
