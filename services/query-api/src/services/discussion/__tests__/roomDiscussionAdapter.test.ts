import { jest } from "@jest/globals";

import { resolveRoomDiscussionContext } from "../roomDiscussionAdapter";

function buildPrismaMock(room: unknown) {
  return {
    communicationRoom: {
      findUnique: jest.fn(async () => room),
    },
  } as any;
}

describe("roomDiscussionAdapter", () => {
  test("resolves circle rooms with Plaza discussion capability to existing storage", async () => {
    const prisma = buildPrismaMock({
      roomKey: "circle:123",
      roomType: "circle",
      parentCircleId: 123,
      metadata: {
        capabilities: {
          plazaDiscussion: true,
          aiSummary: false,
          draftGeneration: true,
          crystallization: true,
        },
      },
    });

    await expect(resolveRoomDiscussionContext(prisma, "circle:123")).resolves.toEqual({
      roomKey: "circle:123",
      circleId: 123,
      storage: "circle_discussion_messages",
      capabilities: {
        plazaDiscussion: true,
        aiSummary: false,
        draftGeneration: true,
        crystallization: true,
      },
    });
  });

  test("uses computed circle defaults when the room row is missing", async () => {
    const prisma = buildPrismaMock(null);

    const context = await resolveRoomDiscussionContext(prisma, "circle:123");

    expect(context).toMatchObject({
      roomKey: "circle:123",
      circleId: 123,
      storage: "circle_discussion_messages",
      capabilities: {
        plazaDiscussion: true,
        aiSummary: true,
        draftGeneration: true,
        crystallization: true,
      },
    });
    expect(prisma.communicationRoom.findUnique).toHaveBeenCalledWith({
      where: { roomKey: "circle:123" },
      select: {
        roomKey: true,
        roomType: true,
        parentCircleId: true,
        metadata: true,
      },
    });
  });

  test("external rooms do not resolve to Plaza discussion storage", async () => {
    const prisma = buildPrismaMock({
      roomKey: "external:game:dungeon:run-1",
      roomType: "dungeon",
      parentCircleId: null,
      metadata: null,
    });

    await expect(
      resolveRoomDiscussionContext(prisma, "external:game:dungeon:run-1"),
    ).resolves.toBeNull();
  });

  test("circle rooms with disabled Plaza discussion return null", async () => {
    const prisma = buildPrismaMock({
      roomKey: "circle:123",
      roomType: "circle",
      parentCircleId: 123,
      metadata: {
        capabilities: {
          plazaDiscussion: false,
        },
      },
    });

    await expect(resolveRoomDiscussionContext(prisma, "circle:123")).resolves.toBeNull();
  });

  test("circle room rows with mismatched parent circle do not resolve", async () => {
    const prisma = buildPrismaMock({
      roomKey: "circle:123",
      roomType: "circle",
      parentCircleId: 456,
      metadata: {
        capabilities: {
          plazaDiscussion: true,
        },
      },
    });

    await expect(resolveRoomDiscussionContext(prisma, "circle:123")).resolves.toBeNull();
  });
});
