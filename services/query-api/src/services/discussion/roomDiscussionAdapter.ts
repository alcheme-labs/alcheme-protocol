import type { PrismaClient } from "@prisma/client";

import { readRoomCapabilities } from "../communication/capabilities";

export interface RoomDiscussionContext {
  roomKey: string;
  circleId: number;
  storage: "circle_discussion_messages";
  capabilities: {
    plazaDiscussion: true;
    aiSummary: boolean;
    draftGeneration: boolean;
    crystallization: boolean;
  };
}

type RoomDiscussionPrisma = Pick<PrismaClient, "communicationRoom">;

interface CommunicationRoomRecord {
  roomKey: string;
  roomType: string;
  parentCircleId: number | null;
  metadata: unknown;
}

export async function resolveRoomDiscussionContext(
  prisma: RoomDiscussionPrisma,
  roomKey: string,
): Promise<RoomDiscussionContext | null> {
  const circleId = parseCircleRoomKey(roomKey);
  if (!circleId) return null;

  const room = (await prisma.communicationRoom.findUnique({
    where: { roomKey },
    select: {
      roomKey: true,
      roomType: true,
      parentCircleId: true,
      metadata: true,
    },
  })) as CommunicationRoomRecord | null;

  const roomType = room?.roomType ?? "circle";
  if (roomType !== "circle") return null;
  const resolvedCircleId = room?.parentCircleId ?? circleId;
  if (resolvedCircleId !== circleId) return null;

  const capabilities = readRoomCapabilities(room?.metadata, roomType);
  if (!capabilities.plazaDiscussion) return null;

  return {
    roomKey,
    circleId: resolvedCircleId,
    storage: "circle_discussion_messages",
    capabilities: {
      plazaDiscussion: true,
      aiSummary: capabilities.aiSummary,
      draftGeneration: capabilities.draftGeneration,
      crystallization: capabilities.crystallization,
    },
  };
}

function parseCircleRoomKey(roomKey: string): number | null {
  const match = /^circle:(\d+)$/.exec(roomKey.trim());
  if (!match) return null;
  const circleId = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(circleId) && circleId > 0 ? circleId : null;
}
