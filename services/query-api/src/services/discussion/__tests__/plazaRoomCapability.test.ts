import { jest } from "@jest/globals";

import {
  PlazaDiscussionCapabilityError,
  resolvePlazaDiscussionContextForWrite,
} from "../plazaRoomCapability";

const NOW = new Date("2026-05-11T12:00:00.000Z");
const WALLET = "9QfRrR7dW7B8d8n3k3D6Vw6m3W9R2kA2jGk4dWpP1uHz";

function buildPrismaMock(options: {
  activeMember?: boolean;
  existingRoom?: any;
} = {}) {
  const rooms = new Map<string, any>();
  if (options.existingRoom) {
    rooms.set(options.existingRoom.roomKey, options.existingRoom);
  }

  return {
    circle: {
      findUnique: jest.fn(async () => ({ id: 123 })),
    },
    user: {
      findUnique: jest.fn(async () => ({ id: 77 })),
    },
    circleMember: {
      findUnique: jest.fn(async () =>
        options.activeMember === false
          ? null
          : { status: "Active", role: "Member" },
      ),
    },
    externalApp: {
      findUnique: jest.fn(async () => null),
    },
    communicationRoom: {
      findUnique: jest.fn(async ({ where }: any) => rooms.get(where.roomKey) ?? null),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const existing = rooms.get(where.roomKey);
        const next = existing ? { ...existing, ...update } : create;
        rooms.set(where.roomKey, next);
        return next;
      }),
    },
    communicationRoomMember: {
      upsert: jest.fn(async ({ create }: any) => create),
    },
  } as any;
}

describe("plazaRoomCapability", () => {
  test("active member writes ensure the circle room and resolve Plaza discussion context", async () => {
    const prisma = buildPrismaMock();

    const context = await resolvePlazaDiscussionContextForWrite(prisma, {
      circleId: 123,
      walletPubkey: WALLET,
      activeCircleMember: true,
      now: NOW,
    });

    expect(context).toMatchObject({
      roomKey: "circle:123",
      circleId: 123,
      storage: "circle_discussion_messages",
    });
    expect(prisma.communicationRoom.upsert).toHaveBeenCalled();
    expect(prisma.communicationRoomMember.upsert).toHaveBeenCalled();
  });

  test("visitor writes use computed defaults without creating communication rooms", async () => {
    const prisma = buildPrismaMock({ activeMember: false });

    const context = await resolvePlazaDiscussionContextForWrite(prisma, {
      circleId: 123,
      walletPubkey: WALLET,
      activeCircleMember: false,
      now: NOW,
    });

    expect(context).toMatchObject({
      roomKey: "circle:123",
      circleId: 123,
      storage: "circle_discussion_messages",
    });
    expect(prisma.communicationRoom.upsert).not.toHaveBeenCalled();
    expect(prisma.communicationRoomMember.upsert).not.toHaveBeenCalled();
  });

  test("disabled Plaza discussion capability blocks discussion writes", async () => {
    const prisma = buildPrismaMock({
      existingRoom: {
        roomKey: "circle:123",
        roomType: "circle",
        parentCircleId: 123,
        metadata: {
          capabilities: {
            plazaDiscussion: false,
          },
        },
      },
    });

    await expect(
      resolvePlazaDiscussionContextForWrite(prisma, {
        circleId: 123,
        walletPubkey: WALLET,
        activeCircleMember: false,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(PlazaDiscussionCapabilityError);
  });
});
